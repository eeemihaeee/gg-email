import type {
  Address,
  AuthKind,
  FolderRole,
  OAuthProvider,
  SecurityMode,
  ServerEndpoint
} from './types'

export interface ProviderPreset {
  id: string
  label: string
  domains: string[]
  imap: ServerEndpoint
  smtp: ServerEndpoint
  authKind: AuthKind
  oauthProvider?: OAuthProvider
  /** Подсказка пользователю, как включить доступ для почтовых клиентов. */
  hint?: { ru: string; en: string }
}

/**
 * Проверенные настройки популярных провайдеров. Используются, когда
 * автонастройка (autoconfig/autodiscover) недоступна.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    authKind: 'oauth2',
    oauthProvider: 'google',
    hint: {
      ru: 'Для Gmail нужен OAuth2 (настраивается администратором) либо пароль приложения при включённой двухэтапной аутентификации.',
      en: 'Gmail requires OAuth2 (configured by the administrator) or an app password with 2-step verification enabled.'
    }
  },
  {
    id: 'yandex',
    label: 'Яндекс Почта',
    domains: [
      'yandex.ru',
      'yandex.com',
      'yandex.by',
      'yandex.kz',
      'yandex.ua',
      'ya.ru'
    ],
    imap: { host: 'imap.yandex.ru', port: 993, security: 'tls' },
    smtp: { host: 'smtp.yandex.ru', port: 465, security: 'tls' },
    authKind: 'oauth2',
    oauthProvider: 'yandex',
    hint: {
      ru: 'Для Яндекса включите «Пароли приложений» в Яндекс ID или используйте OAuth2, настроенный администратором.',
      en: 'For Yandex enable app passwords in Yandex ID or use OAuth2 configured by the administrator.'
    }
  },
  {
    id: 'mailru',
    label: 'Mail.ru',
    domains: ['mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'internet.ru'],
    imap: { host: 'imap.mail.ru', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.ru', port: 465, security: 'tls' },
    authKind: 'password',
    hint: {
      ru: 'Mail.ru требует пароль для внешнего приложения (создаётся в настройках безопасности).',
      en: 'Mail.ru requires an app-specific password created in the security settings.'
    }
  },
  {
    id: 'outlook',
    label: 'Outlook.com / Microsoft 365',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    imap: { host: 'outlook.office365.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls' },
    authKind: 'password',
    hint: {
      ru: 'Microsoft 365 с современной аутентификацией требует OAuth2; для личных ящиков работает пароль приложения.',
      en: 'Microsoft 365 with modern authentication requires OAuth2; personal mailboxes accept app passwords.'
    }
  }
]

export function presetForEmail(email: string): ProviderPreset | undefined {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return undefined
  return PROVIDER_PRESETS.find((preset) => preset.domains.includes(domain))
}

export function guessEndpoints(email: string): { imap: ServerEndpoint; smtp: ServerEndpoint } | null {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  const preset = presetForEmail(email)
  if (preset) return { imap: { ...preset.imap }, smtp: { ...preset.smtp } }
  return {
    imap: { host: `imap.${domain}`, port: 993, security: 'tls' },
    smtp: { host: `smtp.${domain}`, port: 465, security: 'tls' }
  }
}

const ROLE_BY_NAME: Array<[RegExp, FolderRole]> = [
  [/^(inbox|входящие)$/i, 'inbox'],
  [/^(sent|sent mail|sent items|отправленные|отправлено)$/i, 'sent'],
  [/^(drafts?|черновики)$/i, 'drafts'],
  [/^(trash|deleted|deleted items|deleted messages|корзина|удал[её]нные)$/i, 'trash'],
  [/^(junk|spam|junk e-?mail|спам|нежелательная почта)$/i, 'junk'],
  [/^(archive|archives|архив)$/i, 'archive'],
  [/^(outbox|исходящие)$/i, 'outbox']
]

const ROLE_BY_SPECIAL_USE: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
  '\\All': 'archive',
  '\\Flagged': 'other'
}

/** Определяет роль папки по special-use флагам и имени (включая русские названия). */
export function detectFolderRole(
  path: string,
  specialUse?: string,
  attributes?: string[]
): FolderRole {
  if (specialUse && ROLE_BY_SPECIAL_USE[specialUse]) {
    return ROLE_BY_SPECIAL_USE[specialUse]
  }
  for (const attr of attributes ?? []) {
    if (ROLE_BY_SPECIAL_USE[attr]) return ROLE_BY_SPECIAL_USE[attr]
  }
  // Gmail: [Gmail]/Sent Mail, [Gmail]/All Mail, [Gmail]/Trash, [Gmail]/Spam
  const segments = path.split(/[/.]/).filter(Boolean)
  const name = segments[segments.length - 1] ?? path
  for (const [pattern, role] of ROLE_BY_NAME) {
    if (pattern.test(name)) return role
  }
  if (path.toUpperCase() === 'INBOX') return 'inbox'
  return 'other'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

export function parseAddressList(value: string): Address[] {
  if (!value?.trim()) return []
  return value
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^(.*)<([^>]+)>$/)
      if (match) {
        return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() }
      }
      return { name: '', email: chunk }
    })
}

export function formatAddress(address: Address): string {
  return address.name ? `"${address.name}" <${address.email}>` : address.email
}

export const SECURITY_LABEL: Record<SecurityMode, string> = {
  tls: 'SSL/TLS',
  starttls: 'STARTTLS',
  none: 'без шифрования'
}

/** Провайдеры, для которых пароль приложения заведомо не подходит. */
export function requiresOAuth(email: string): boolean {
  const preset = presetForEmail(email)
  return preset?.authKind === 'oauth2'
}
