import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import type { OAuthProvider } from '@shared/types'
import type { PolicyState } from '@shared/types'
import { policyValue } from '@shared/policy'
import { secrets } from '../secrets'
import { createLogger } from '../logger'

const log = createLogger('oauth')

interface ProviderConfig {
  authUrl: string
  tokenUrl: string
  scope: string
  extraAuthParams: Record<string, string>
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://mail.google.com/ email profile',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  },
  yandex: {
    authUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    scope: 'mail:imap_full mail:smtp',
    extraAuthParams: {}
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function clientIdFor(provider: OAuthProvider, policy: PolicyState): string | undefined {
  const key = provider === 'google' ? 'googleClientId' : 'yandexClientId'
  const value = policyValue(policy, key, '')
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function clientSecretFor(provider: OAuthProvider, policy: PolicyState): string | undefined {
  const key = provider === 'google' ? 'googleClientSecret' : 'yandexClientSecret'
  const value = policyValue(policy, key, '')
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function exchangeToken(
  provider: OAuthProvider,
  params: Record<string, string>
): Promise<OAuthTokens> {
  const config = PROVIDERS[provider]
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000)
  })
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!response.ok || !data.access_token) {
    throw new Error(
      `OAuth ${provider}: ${data.error_description ?? data.error ?? `HTTP ${response.status}`}`
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolve(address.port)
      else reject(new Error('Не удалось определить порт'))
    })
  })
}

/** Авторизация через браузер с loopback-редиректом и PKCE. */
export async function authorize(
  provider: OAuthProvider,
  policy: PolicyState,
  emailHint?: string
): Promise<OAuthTokens> {
  if (!policyValue(policy, 'allowOAuth', true)) {
    throw new Error('OAuth запрещён политикой безопасности')
  }
  const clientId = clientIdFor(provider, policy)
  if (!clientId) {
    throw new Error(
      'OAuth не настроен: администратор должен задать Client ID в групповой политике'
    )
  }

  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const server = createServer()
  const port = await listen(server)
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

  const config = PROVIDERS[provider]
  const url = new URL(config.authUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(config.extraAuthParams)) {
    url.searchParams.set(key, value)
  }
  if (emailHint) url.searchParams.set('login_hint', emailHint)

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Время ожидания авторизации истекло'))
    }, 5 * 60_000)

    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      if (requestUrl.pathname !== '/oauth/callback') {
        response.writeHead(404).end()
        return
      }
      const code = requestUrl.searchParams.get('code')
      const receivedState = requestUrl.searchParams.get('state')
      const error = requestUrl.searchParams.get('error')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<html><body style="font-family:Segoe UI,sans-serif;padding:40px">
         <h2>${error ? 'Не удалось войти' : 'Готово'}</h2>
         <p>${error ? 'Окно можно закрыть и вернуться в GG Email.' : 'Можно закрыть эту вкладку и вернуться в GG Email.'}</p>
         </body></html>`
      )
      clearTimeout(timeout)
      server.close()
      if (error) reject(new Error(`OAuth отклонён: ${error}`))
      else if (receivedState !== state) reject(new Error('OAuth: неверный state'))
      else if (code) resolve(code)
      else reject(new Error('OAuth: код не получен'))
    })
  })

  await shell.openExternal(url.toString())
  const code = await codePromise

  const params: Record<string, string> = {
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  }
  const secret = clientSecretFor(provider, policy)
  if (secret) params.client_secret = secret

  const tokens = await exchangeToken(provider, params)
  log.info(`OAuth ${provider} выполнен успешно`)
  return tokens
}

async function refresh(
  provider: OAuthProvider,
  policy: PolicyState,
  refreshToken: string
): Promise<OAuthTokens> {
  const clientId = clientIdFor(provider, policy)
  if (!clientId) throw new Error('OAuth не настроен администратором')
  const params: Record<string, string> = {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }
  const secret = clientSecretFor(provider, policy)
  if (secret) params.client_secret = secret
  return exchangeToken(provider, params)
}

/**
 * Возвращает действующий access token, обновляя его при необходимости.
 * Refresh token хранится в защищённом хранилище (DPAPI).
 */
export async function accessToken(
  accountId: string,
  provider: OAuthProvider,
  policy: PolicyState
): Promise<string> {
  const cached = tokenCache.get(accountId)
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken

  const refreshToken = secrets.get(accountId)
  if (!refreshToken) throw new Error('Нет сохранённого токена OAuth — войдите заново')
  const tokens = await refresh(provider, policy, refreshToken)
  tokenCache.set(accountId, {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt
  })
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    secrets.set(accountId, tokens.refreshToken, 'oauth2')
  }
  return tokens.accessToken
}

export function forgetToken(accountId: string): void {
  tokenCache.delete(accountId)
}
