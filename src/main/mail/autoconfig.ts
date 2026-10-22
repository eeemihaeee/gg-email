import { presetForEmail } from '@shared/providers'
import type { AutoconfigResult, SecurityMode } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('autoconfig')

const TIMEOUT_MS = 8000

function substitute(value: string, email: string): string {
  const [local, domain] = email.split('@')
  return value
    .replace(/%EMAILADDRESS%/gi, email)
    .replace(/%EMAILLOCALPART%/gi, local ?? '')
    .replace(/%EMAILDOMAIN%/gi, domain ?? '')
    .replace(/%EMAIL%/gi, email)
}

function socketTypeToSecurity(value: string | undefined): SecurityMode {
  const type = (value ?? '').toUpperCase()
  if (type.includes('SSL') || type.includes('TLS') && !type.includes('STARTTLS')) return 'tls'
  if (type.includes('STARTTLS')) return 'starttls'
  return 'none'
}

function tag(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return match ? match[1].trim() : undefined
}

function serversOfType(xml: string, type: 'imap' | 'smtp'): string[] {
  const result: string[] = []
  const regex = new RegExp(`<${type === 'imap' ? 'incomingServer' : 'outgoingServer'}[^>]*>([\\s\\S]*?)</${type === 'imap' ? 'incomingServer' : 'outgoingServer'}>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    const block = match[0]
    const serverType = block.match(/type="([^"]+)"/i)?.[1]?.toLowerCase()
    if (serverType === type) result.push(match[1])
  }
  return result
}

function parseThunderbirdConfig(
  xml: string,
  email: string,
  source: string
): AutoconfigResult | null {
  const incoming = serversOfType(xml, 'imap')[0]
  const outgoing = serversOfType(xml, 'smtp')[0]
  if (!incoming || !outgoing) return null

  const imapHost = tag(incoming, 'hostname')
  const smtpHost = tag(outgoing, 'hostname')
  if (!imapHost || !smtpHost) return null

  const preset = presetForEmail(email)
  return {
    email,
    imap: {
      host: substitute(imapHost, email),
      port: Number(tag(incoming, 'port') ?? 993),
      security: socketTypeToSecurity(tag(incoming, 'socketType'))
    },
    smtp: {
      host: substitute(smtpHost, email),
      port: Number(tag(outgoing, 'port') ?? 465),
      security: socketTypeToSecurity(tag(outgoing, 'socketType'))
    },
    username: substitute(tag(incoming, 'username') ?? '%EMAILADDRESS%', email),
    authKind: preset?.authKind ?? 'password',
    oauthProvider: preset?.oauthProvider,
    source
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Kurier/0.1', ...(init?.headers ?? {}) }
    })
    if (!response.ok) return null
    return await response.text()
  } catch (error) {
    log.debug(`Автонастройка недоступна: ${url}`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Ищет настройки серверов в порядке приоритета:
 *  1. внутренний autoconfig из политики (если задан);
 *  2. autoconfig.<домен>;
 *  3. <домен>/.well-known/autoconfig;
 *  4. база Thunderbird ISPDB.
 * Возвращает null, если ничего не найдено — тогда используются пресеты/ручной ввод.
 */
export async function autoconfigure(
  email: string,
  options: { autoconfigUrl?: string } = {}
): Promise<AutoconfigResult | null> {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  const encoded = encodeURIComponent(email)

  const urls: Array<{ url: string; source: string }> = []
  if (options.autoconfigUrl) {
    const template = options.autoconfigUrl.includes('%EMAIL%')
      ? options.autoconfigUrl
      : `${options.autoconfigUrl}${options.autoconfigUrl.includes('?') ? '&' : '?'}emailaddress=%EMAIL%`
    urls.push({ url: substitute(template, email), source: 'policy-autoconfig' })
  }
  urls.push(
    {
      url: `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encoded}`,
      source: 'autoconfig-subdomain'
    },
    {
      url: `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${encoded}`,
      source: 'well-known'
    },
    {
      url: `https://autoconfig.thunderbird.net/v1.1/${domain}`,
      source: 'thunderbird-ispdb'
    }
  )

  for (const candidate of urls) {
    const xml = await fetchText(candidate.url)
    if (!xml || !xml.includes('<clientConfig')) continue
    const parsed = parseThunderbirdConfig(xml, email, candidate.source)
    if (parsed) {
      log.info(`Автонастройка найдена (${candidate.source})`, { email, host: parsed.imap.host })
      return parsed
    }
  }

  const preset = presetForEmail(email)
  if (preset) {
    return {
      email,
      imap: { ...preset.imap },
      smtp: { ...preset.smtp },
      username: email,
      authKind: preset.authKind,
      oauthProvider: preset.oauthProvider,
      source: 'builtin-preset'
    }
  }

  return null
}
