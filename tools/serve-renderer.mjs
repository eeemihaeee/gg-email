// Мини-сервер для визуальной проверки собранного renderer-а
// (используется в скриптах скриншотов, не входит в поставку).
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] ?? 'out/renderer'
const port = Number(process.argv[3] ?? 4321)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let filePath = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!filePath.startsWith(normalize(root))) {
      response.writeHead(403).end()
      return
    }
    let info = await stat(filePath).catch(() => null)
    if (!info || info.isDirectory()) {
      filePath = join(root, 'index.html')
      info = await stat(filePath)
    }
    const content = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    response.end(content)
  } catch (error) {
    response.writeHead(500).end(String(error))
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`renderer: http://127.0.0.1:${port}`)
})
