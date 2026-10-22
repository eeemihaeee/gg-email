import { ImapFlow } from 'imapflow'
import type { Account, AuthKind, MessageFlags, ServerEndpoint } from '@shared/types'
import { createLogger } from '../logger'
import { secrets } from '../secrets'

const log = createLogger('imap')

export interface ImapCredentials {
  user: string
  pass?: string
  accessToken?: string
}

export function credentialsFor(account: Account): ImapCredentials {
  const kind: AuthKind = account.authKind
  const value = secrets.get(account.id)
  if (!value) throw new Error('Нет сохранённого пароля для учётной записи')
  if (kind === 'oauth2') return { user: account.username, accessToken: value }
  return { user: account.username, pass: value }
}

export function buildClientOptions(
  endpoint: ServerEndpoint,
  auth: ImapCredentials
): ConstructorParameters<typeof ImapFlow>[0] {
  return {
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.security === 'tls',
    // STARTTLS: соединение открывается в открытом виде и апгрейдится.
    doSTARTTLS: endpoint.security === 'starttls',
    auth,
    logger: false,
    socketTimeout: 120_000,
    greetingTimeout: 20_000,
    tls: {
      servername: endpoint.host,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    },
    disableAutoIdle: false,
    emitLogs: false
  }
}

export function createImapClient(account: Account): ImapFlow {
  const auth = credentialsFor(account)
  return new ImapFlow(buildClientOptions(account.imap, auth))
}

export function flagsToMask(flags: Set<string> | string[] | undefined): number {
  const list = flags ? Array.from(flags) : []
  let mask = 0
  for (const flag of list) {
    switch (flag.toLowerCase()) {
      case '\\seen':
        mask |= 1
        break
      case '\\answered':
        mask |= 2
        break
      case '\\flagged':
        mask |= 4
        break
      case '\\deleted':
        mask |= 8
        break
      case '\\draft':
        mask |= 16
        break
      case '$forwarded':
        mask |= 32
        break
      default:
        break
    }
  }
  return mask
}

export function maskToImapFlags(flags: Partial<MessageFlags>): string[] {
  const result: string[] = []
  if (flags.seen !== undefined) result.push('\\Seen')
  if (flags.flagged !== undefined) result.push('\\Flagged')
  if (flags.answered !== undefined) result.push('\\Answered')
  if (flags.draft !== undefined) result.push('\\Draft')
  return result
}

/** Адреса из конверта IMAP в наш формат. */
export function normalizeAddresses(
  list: Array<{ name?: string; address?: string }> | undefined
): Array<{ name: string; email: string }> {
  if (!list) return []
  return list
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name ?? '', email: item.address as string }))
}

export function parseImapDate(value: string | Date | undefined): number {
  if (!value) return Date.now()
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : Date.now()
}

export interface ConnectionTestResult {
  ok: boolean
  error?: string
  folders?: number
}

/** Проверка подключения без сохранения учётной записи (мастер настройки). */
export async function testImapConnection(
  endpoint: ServerEndpoint,
  auth: ImapCredentials
): Promise<ConnectionTestResult> {
  const client = new ImapFlow(buildClientOptions(endpoint, auth))
  try {
    await client.connect()
    const folders = await client.list()
    return { ok: true, folders: folders.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn('Проверка IMAP не удалась', { host: endpoint.host, error: message })
    return { ok: false, error: message }
  } finally {
    try {
      await client.logout()
    } catch {
      /* соединение могло не открыться */
    }
  }
}
