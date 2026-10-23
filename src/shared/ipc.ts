import type {
  CacheStats,
  Account,
  AccountInput,
  AccountTestResult,
  AppInfo,
  AutoconfigResult,
  BootstrapState,
  DraftPayload,
  Folder,
  FolderRole,
  MessageDetail,
  MessageFlags,
  MessagePage,
  MessageQuery,
  PolicyState,
  SendResult,
  SyncStatus,
  UpdaterState
} from './types'

export const CHANNELS = {
  bootstrap: 'app:bootstrap',
  accountsList: 'accounts:list',
  accountAdd: 'accounts:add',
  accountUpdate: 'accounts:update',
  accountRemove: 'accounts:remove',
  accountTest: 'accounts:test',
  accountAutoconfigure: 'accounts:autoconfigure',
  accountSetSecret: 'accounts:set-secret',
  foldersList: 'folders:list',
  messagesList: 'messages:list',
  messageGet: 'messages:get',
  messageFlags: 'messages:flags',
  messageMove: 'messages:move',
  messageDelete: 'messages:delete',
  messageLoadOlder: 'messages:load-older',
  messageOpenAttachment: 'messages:open-attachment',
  messageSaveAttachment: 'messages:save-attachment',
  messageAttachmentUrl: 'messages:attachment-url',
  composerSend: 'composer:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  policyGet: 'policy:get',
  syncNow: 'sync:now',
  syncAll: 'sync:all',
  syncFolder: 'sync:folder',
  updaterCheck: 'updater:check',
  updaterInstall: 'updater:install',
  updaterState: 'updater:state',
  appInfo: 'app:info',
  appOpenData: 'app:open-data',
  appOpenExternal: 'app:open-external',
  appClearCache: 'app:clear-cache',
  appClearBodies: 'app:clear-bodies',
  appCacheStats: 'app:cache-stats',
  oauthStart: 'oauth:start',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close'
} as const

export const EVENTS = {
  syncStatus: 'event:sync-status',
  messagesChanged: 'event:messages-changed',
  foldersChanged: 'event:folders-changed',
  policyChanged: 'event:policy-changed',
  updaterState: 'event:updater-state',
  toast: 'event:toast'
} as const

export interface UserSettings {
  language: 'auto' | 'ru' | 'en'
  theme: 'system' | 'light' | 'dark'
  density: 'comfortable' | 'compact'
  previewPane: 'right' | 'bottom' | 'off'
  notifications: boolean
  syncAllFolders: boolean
  signature: string
  lastAccountId?: string
  lastFolderId?: string
  windowBounds?: { x: number; y: number; width: number; height: number }
  updateDeferredUntil?: number
}

export interface ToastEvent {
  kind: 'info' | 'error' | 'success'
  message: string
}

export interface ChangesEvent {
  accountId: string
  folderIds: string[]
}

export interface KurierApi {
  bootstrap(): Promise<BootstrapState>
  accounts: {
    list(): Promise<Account[]>
    add(input: AccountInput): Promise<Account>
    update(id: string, patch: Partial<Account>): Promise<Account>
    remove(id: string): Promise<void>
    test(input: AccountInput): Promise<AccountTestResult>
    autoconfigure(email: string): Promise<AutoconfigResult | null>
    setSecret(id: string, secret: string): Promise<void>
  }
  folders: {
    list(accountId?: string): Promise<Folder[]>
  }
  messages: {
    list(query: MessageQuery): Promise<MessagePage>
    get(id: string): Promise<MessageDetail>
    setFlags(id: string, flags: MessageFlags): Promise<void>
    move(id: string, role: FolderRole): Promise<void>
    remove(id: string): Promise<void>
    loadOlder(folderId: string, beforeUid: number): Promise<number>
    openAttachment(id: string): Promise<void>
    saveAttachment(id: string): Promise<string | null>
    attachmentUrl(id: string): Promise<string>
  }
  composer: {
    send(draft: DraftPayload): Promise<SendResult>
  }
  settings: {
    get(): Promise<UserSettings>
    set(patch: Partial<UserSettings>): Promise<UserSettings>
  }
  policy: {
    get(): Promise<PolicyState>
  }
  sync: {
    now(accountId?: string): Promise<void>
    all(): Promise<void>
    folder(folderId: string): Promise<void>
  }
  updater: {
    check(): Promise<UpdaterState>
    install(): Promise<void>
    state(): Promise<UpdaterState>
  }
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openExternal(url: string): Promise<void>
    clearCache(): Promise<void>
    clearBodies(): Promise<void>
    cacheStats(): Promise<CacheStats>
  }
  oauth: {
    start(provider: 'google' | 'yandex', email?: string): Promise<{ ok: boolean; refreshToken?: string; error?: string }>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  on(event: typeof EVENTS.syncStatus, listener: (status: SyncStatus) => void): () => void
  on(event: typeof EVENTS.messagesChanged, listener: (payload: ChangesEvent) => void): () => void
  on(event: typeof EVENTS.foldersChanged, listener: (payload: { accountId: string }) => void): () => void
  on(event: typeof EVENTS.policyChanged, listener: (policy: PolicyState) => void): () => void
  on(event: typeof EVENTS.updaterState, listener: (state: UpdaterState) => void): () => void
  on(event: typeof EVENTS.toast, listener: (toast: ToastEvent) => void): () => void
}
