/**
 * Общие типы, разделяемые main-, preload- и renderer-процессами.
 * Здесь нет ни Node-, ни DOM-зависимостей.
 */

export type SecurityMode = 'tls' | 'starttls' | 'none'

export interface ServerEndpoint {
  host: string
  port: number
  security: SecurityMode
}

export type AuthKind = 'password' | 'oauth2'
export type OAuthProvider = 'google' | 'yandex'

export type FolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'outbox'
  | 'other'

export interface Account {
  id: string
  email: string
  displayName: string
  /** Цвет-метка аккаунта в интерфейсе (hex). */
  color: string
  imap: ServerEndpoint
  smtp: ServerEndpoint
  username: string
  authKind: AuthKind
  oauthProvider?: OAuthProvider
  sortOrder: number
  disabled: boolean
  createdAt: number
}

export interface AccountSecret {
  /** Пароль приложения либо refresh-token OAuth2. */
  value: string
  kind: AuthKind
  updatedAt: number
}

export interface AccountTestResult {
  ok: boolean
  imap?: { ok: boolean; error?: string; folders?: number }
  smtp?: { ok: boolean; error?: string }
  autoconfigSource?: string
}

export interface AutoconfigResult {
  email: string
  imap: ServerEndpoint
  smtp: ServerEndpoint
  username: string
  authKind: AuthKind
  oauthProvider?: OAuthProvider
  source: string
}

export interface Folder {
  id: string
  accountId: string
  path: string
  name: string
  delimiter: string
  role: FolderRole
  total: number
  unread: number
  uidValidity: number | null
  uidNext: number | null
  highestModseq: number | null
  lastSyncAt: number | null
}

export interface MessageFlags {
  seen: boolean
  flagged: boolean
  answered: boolean
  forwarded: boolean
  draft: boolean
  deleted: boolean
}

export interface Address {
  name: string
  email: string
}

export interface AttachmentMeta {
  id: string
  filename: string
  contentType: string
  size: number
  contentId?: string
  inline: boolean
}

export interface MessageSummary {
  id: string
  accountId: string
  accountEmail: string
  folderId: string
  folderPath: string
  uid: number
  messageId: string | null
  subject: string
  from: Address[]
  to: Address[]
  date: number
  size: number
  flags: MessageFlags
  hasAttachments: boolean
  snippet: string
  threadKey: string | null
}

export interface MessageDetail extends MessageSummary {
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  textBody: string
  htmlBody: string | null
  attachments: AttachmentMeta[]
  headers: Record<string, string>
  bodyFetched: boolean
}

export interface DraftAttachment {
  filename: string
  contentType: string
  contentBase64: string
}

export interface DraftPayload {
  accountId: string
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  text: string
  html?: string
  inReplyTo?: string
  references?: string[]
  attachments: DraftAttachment[]
}

export interface SendResult {
  ok: boolean
  messageId?: string
  error?: string
}

export type SyncPhase = 'idle' | 'connecting' | 'discovering' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  accountId: string
  phase: SyncPhase
  folder?: string
  fetched?: number
  total?: number
  error?: string
  lastSyncAt?: number
}

export interface MessageQuery {
  accountId?: string
  folderId?: string
  role?: FolderRole
  /** Фильтр по домену почты (все ящики @itxr.ru и т.п.). */
  domain?: string
  /** Поисковый запрос; пустая строка — без фильтра. */
  query?: string
  unreadOnly?: boolean
  flaggedOnly?: boolean
  limit?: number
  offset?: number
}

export interface MessagePage {
  items: MessageSummary[]
  total: number
  hasMore: boolean
}

export interface AccountInput {
  email: string
  displayName: string
  password?: string
  imap: ServerEndpoint
  smtp: ServerEndpoint
  username?: string
  authKind?: AuthKind
  oauthProvider?: OAuthProvider
  color?: string
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'disabled'
  version?: string
  percent?: number
  error?: string
  /** Время следующей автоматической проверки (мс). */
  nextCheckAt?: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  userDataPath: string
  dataPath: string
  isPackaged: boolean
}

export interface BootstrapState {
  accounts: Account[]
  folders: Folder[]
  policy: PolicyState
  app: AppInfo
  updater: UpdaterState
  /** Текущее состояние синхронизации по аккаунтам (чтобы после перезагрузки страницы
   * пользователь сразу видел ошибку подключения, а не пустой список). */
  sync: SyncStatus[]
}

/** Итоговое состояние политик, уже применённое к настройкам. */
export interface PolicyState {
  managed: boolean
  source: 'none' | 'registry-machine' | 'registry-user' | 'file'
  values: Record<string, PolicyValue>
  /** Настройки, заблокированные администратором для изменения в UI. */
  locked: string[]
  errors: string[]
}

export type PolicyValue = boolean | string | number | string[]

/** Разрешённый тип значения политики. */
export type PolicyType = 'boolean' | 'string' | 'enum' | 'number' | 'multistring'

/** Статистика локального кеша для экрана «Хранилище». */
export interface CacheStats {
  dbBytes: number
  bodyBytes: number
  attachmentsBytes: number
  totalBytes: number
  messages: number
  accounts: number
  oldestBodyAt: number | null
}