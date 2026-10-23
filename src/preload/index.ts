import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  EVENTS,
  type ChangesEvent,
  type KurierApi,
  type ToastEvent,
  type UserSettings
} from '@shared/ipc'
import type {
  Account,
  AccountInput,
  AccountTestResult,
  AppInfo,
  AutoconfigResult,
  BootstrapState,
  CacheStats,
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
} from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: KurierApi = {
  bootstrap: () => ipcRenderer.invoke(CHANNELS.bootstrap) as Promise<BootstrapState>,
  accounts: {
    list: () => ipcRenderer.invoke(CHANNELS.accountsList) as Promise<Account[]>,
    add: (input: AccountInput) =>
      ipcRenderer.invoke(CHANNELS.accountAdd, input) as Promise<Account>,
    update: (id: string, patch: Partial<Account>) =>
      ipcRenderer.invoke(CHANNELS.accountUpdate, id, patch) as Promise<Account>,
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.accountRemove, id) as Promise<void>,
    test: (input: AccountInput) =>
      ipcRenderer.invoke(CHANNELS.accountTest, input) as Promise<AccountTestResult>,
    autoconfigure: (email: string) =>
      ipcRenderer.invoke(CHANNELS.accountAutoconfigure, email) as Promise<AutoconfigResult | null>,
    setSecret: (id: string, secret: string) =>
      ipcRenderer.invoke(CHANNELS.accountSetSecret, id, secret) as Promise<void>
  },
  folders: {
    list: (accountId?: string) =>
      ipcRenderer.invoke(CHANNELS.foldersList, accountId) as Promise<Folder[]>
  },
  messages: {
    list: (query: MessageQuery) =>
      ipcRenderer.invoke(CHANNELS.messagesList, query) as Promise<MessagePage>,
    get: (id: string) => ipcRenderer.invoke(CHANNELS.messageGet, id) as Promise<MessageDetail>,
    setFlags: (id: string, flags: MessageFlags) =>
      ipcRenderer.invoke(CHANNELS.messageFlags, id, flags) as Promise<void>,
    move: (id: string, role: FolderRole) =>
      ipcRenderer.invoke(CHANNELS.messageMove, id, role) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.messageDelete, id) as Promise<void>,
    loadOlder: (folderId: string, beforeUid: number) =>
      ipcRenderer.invoke(CHANNELS.messageLoadOlder, folderId, beforeUid) as Promise<number>,
    openAttachment: (id: string) =>
      ipcRenderer.invoke(CHANNELS.messageOpenAttachment, id) as Promise<void>,
    saveAttachment: (id: string) =>
      ipcRenderer.invoke(CHANNELS.messageSaveAttachment, id) as Promise<string | null>,
    attachmentUrl: (id: string) =>
      ipcRenderer.invoke(CHANNELS.messageAttachmentUrl, id) as Promise<string>
  },
  composer: {
    send: (draft: DraftPayload) =>
      ipcRenderer.invoke(CHANNELS.composerSend, draft) as Promise<SendResult>
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet) as Promise<UserSettings>,
    set: (patch: Partial<UserSettings>) =>
      ipcRenderer.invoke(CHANNELS.settingsSet, patch) as Promise<UserSettings>
  },
  policy: {
    get: () => ipcRenderer.invoke(CHANNELS.policyGet) as Promise<PolicyState>
  },
  sync: {
    now: (accountId?: string) => ipcRenderer.invoke(CHANNELS.syncNow, accountId) as Promise<void>,
    all: () => ipcRenderer.invoke(CHANNELS.syncAll) as Promise<void>,
    folder: (folderId: string) =>
      ipcRenderer.invoke(CHANNELS.syncFolder, folderId) as Promise<void>
  },
  updater: {
    check: () => ipcRenderer.invoke(CHANNELS.updaterCheck) as Promise<UpdaterState>,
    install: () => ipcRenderer.invoke(CHANNELS.updaterInstall) as Promise<void>,
    state: () => ipcRenderer.invoke(CHANNELS.updaterState) as Promise<UpdaterState>
  },
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
    openDataFolder: () => ipcRenderer.invoke(CHANNELS.appOpenData) as Promise<void>,
    openExternal: (url: string) =>
      ipcRenderer.invoke(CHANNELS.appOpenExternal, url) as Promise<void>,
    clearCache: () => ipcRenderer.invoke(CHANNELS.appClearCache) as Promise<void>,
    clearBodies: () => ipcRenderer.invoke(CHANNELS.appClearBodies) as Promise<void>,
    cacheStats: () => ipcRenderer.invoke(CHANNELS.appCacheStats) as Promise<CacheStats>
  },
  oauth: {
    start: (provider: 'google' | 'yandex', email?: string) =>
      ipcRenderer.invoke(CHANNELS.oauthStart, provider, email) as Promise<{
        ok: boolean
        refreshToken?: string
        error?: string
      }>
  },
  window: {
    minimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
    maximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
    close: () => ipcRenderer.send(CHANNELS.windowClose)
  },
  on: ((event: string, listener: (payload: any) => void) => {
    switch (event) {
      case EVENTS.syncStatus:
        return subscribe<SyncStatus>(EVENTS.syncStatus, listener)
      case EVENTS.messagesChanged:
        return subscribe<ChangesEvent>(EVENTS.messagesChanged, listener)
      case EVENTS.foldersChanged:
        return subscribe<{ accountId: string }>(EVENTS.foldersChanged, listener)
      case EVENTS.policyChanged:
        return subscribe<PolicyState>(EVENTS.policyChanged, listener)
      case EVENTS.updaterState:
        return subscribe<UpdaterState>(EVENTS.updaterState, listener)
      case EVENTS.toast:
        return subscribe<ToastEvent>(EVENTS.toast, listener)
      default:
        throw new Error(`Неизвестный канал событий: ${event}`)
    }
  }) as KurierApi['on']
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('kurier', api)
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).kurier = api
}
