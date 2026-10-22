/**
 * Веб-режим GG Email: тот же main-код, но транспорт — HTTP + SSE.
 * Позволяет работать с реальной почтой в браузере, без установки Electron.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { LogLevel } from '@shared/types'
import { policyValue } from '@shared/policy'
import { AppContext } from '../main/app-context'
import { createApiHandlers } from '../main/ipc'
import { configureLogger, createLogger } from '../main/logger'
import { startPolicyWatcher } from '../main/policy'
import { paths } from '../main/paths'

const log = createLogger('web')

const TOKEN = process.env.GGEMAIL_TOKEN ?? process.env.GGEMAIL_TOKEN ?? randomBytes(24).toString('hex')
const PORT = Number(process.env.GGEMAIL_PORT ?? 4173)
const HOST = process.env.GGEMAIL_HOST ?? '127.0.0.1'
const RENDERER_DIR = join(__dirname, '..', 'renderer')

interface SseClient {
  res: ServerResponse
}

const sseClients = new Set<SseClient>()

function broadcast(channel: string, payload: unknown): void {
  const frame = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const client of sseClients) {
    try {
      client.res.write(frame)
    } catch {
      sseClients.delete(client)
    }
  }
}

function tokenFrom(request: IncomingMessage, url: URL): string {
  const header = request.headers['x-gg-token']
  if (typeof header === 'string' && header) return header
  const query = url.searchParams.get('token')
  if (query) return query
  const cookie = request.headers.cookie ?? ''
  const match = cookie.match(/(?:^|;\s*)gg_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

function authorized(request: IncomingMessage, url: URL): boolean {
  return tokenFrom(request, url) === TOKEN
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(data)
}

async function readBody(request: IncomingMessage, limit = 60 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Слишком большой запрос'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
}

async function serveStatic(url: URL, response: ServerResponse): Promise<boolean> {
  let filePath = normalize(join(RENDERER_DIR, decodeURIComponent(url.pathname)))
  if (!filePath.startsWith(normalize(RENDERER_DIR))) return false
  const info = await stat(filePath).catch(() => null)
  if (!info || info.isDirectory()) return false
  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600'
  })
  createReadStream(filePath).pipe(response)
  return true
}

function pageWithBoot(html: string): string {
  // CSP запрещает inline-скрипты, поэтому конфигурация отдаётся отдельным файлом.
  const tag = '<script src="/api/boot.js"></script>'
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`
}

async function main(): Promise<void> {
  const ctx = await AppContext.create()
  configureLogger(policyValue<LogLevel>(ctx.policy, 'logLevel', 'warn'), paths.logs)

  const handlers = createApiHandlers(ctx, () => null)
  const fakeEvent = {
    senderFrame: { url: `http://${HOST}:${PORT}` },
    sender: null
  }

  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => broadcast(channel, payload) }
  }
  ctx.attachWindow(fakeWindow as unknown as BrowserWindow)

  const indexHtml = pageWithBoot(await readFile(join(RENDERER_DIR, 'index.html'), 'utf8'))

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
    try {
      if (url.pathname === '/api/events') {
        if (!authorized(request, url)) return json(response, 401, { error: 'unauthorized' })
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        })
        response.write(': connected\n\n')
        const client: SseClient = { res: response }
        sseClients.add(client)
        const ping = setInterval(() => {
          try {
            response.write(': ping\n\n')
          } catch {
            /* клиент отключился */
          }
        }, 25_000)
        request.on('close', () => {
          clearInterval(ping)
          sseClients.delete(client)
        })
        return
      }

      if (url.pathname === '/api/boot.js') {
        response.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        })
        response.end(`window.__GG_WEB__=${JSON.stringify({ token: TOKEN, base: '' })};`)
        return
      }

      if (url.pathname === '/api/call' && request.method === 'POST') {
        if (!authorized(request, url)) return json(response, 401, { error: 'unauthorized' })
        const body = JSON.parse(await readBody(request)) as {
          channel?: string
          args?: unknown[]
        }
        const handler = body.channel ? handlers[body.channel] : undefined
        if (!handler) return json(response, 404, { ok: false, error: 'Неизвестный метод' })
        try {
          const result = await handler(fakeEvent as never, ...(body.args ?? []))
          return json(response, 200, { ok: true, result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn(`Ошибка ${body.channel}`, message)
          return json(response, 200, { ok: false, error: message })
        }
      }

      if (url.pathname.startsWith('/api/attachment/')) {
        if (!authorized(request, url)) return json(response, 401, { error: 'unauthorized' })
        const id = decodeURIComponent(url.pathname.slice('/api/attachment/'.length))
        const attachment = ctx.messages.attachment(id)
        if (!attachment?.path) return json(response, 404, { error: 'not found' })
        const inline = url.searchParams.get('inline') === '1'
        const filename = encodeURIComponent(attachment.filename)
        response.writeHead(200, {
          'Content-Type': attachment.contentType || 'application/octet-stream',
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
          'Cache-Control': 'private, max-age=300'
        })
        createReadStream(attachment.path).pipe(response)
        return
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!authorized(request, url)) {
          response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(
            `<html><body style="font-family:Segoe UI,sans-serif;padding:40px;background:#f5f5f7">
             <h2>GG Email</h2><p>Откройте ссылку, которую напечатал сервер — в ней одноразовый токен доступа.</p>
             </body></html>`
          )
          return
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Set-Cookie': `gg_token=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Strict; Path=/`
        })
        response.end(indexHtml)
        return
      }

      if (await serveStatic(url, response)) return
      response.writeHead(404).end()
    } catch (error) {
      log.error('Ошибка HTTP', error)
      if (!response.headersSent) json(response, 500, { error: 'internal error' })
      else response.end()
    }
  })

  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve))
  log.info(`Веб-режим запущен: http://${HOST}:${PORT}`)

  ctx.updater.init()
  ctx.startBackgroundJobs()
  const stopWatcher = startPolicyWatcher()
  void ctx.startAll()

  console.log('')
  console.log('  GG Email (веб-режим)')
  console.log(`  Откройте: http://${HOST}:${PORT}/?token=${TOKEN}`)
  console.log(`  Профиль:  ${paths.root}`)
  console.log('')

  const shutdown = async (): Promise<void> => {
    stopWatcher()
    await ctx.stopAll().catch(() => undefined)
    ctx.close()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch((error) => {
  console.error('Не удалось запустить веб-режим:', error)
  process.exit(1)
})
