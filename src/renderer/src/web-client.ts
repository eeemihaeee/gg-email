import { CHANNELS, EVENTS, type KurierApi, type UserSettings } from '@shared/ipc'
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

export interface WebBoot {
  token: string
  base: string
}

/**
 * Клиент веб-режима: те же методы, что у preload-API, но через HTTP + SSE.
 * Позволяет открывать GG Email в браузере и работать с реальной почтой.
 */
export function installWebApi(boot: WebBoot): void {
  const base = boot.base ?? ''
  const token = boot.token

  const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const response = await fetch(`${base}/api/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gg-token': token
      },
      body: JSON.stringify({ channel, args })
    })
    if (response.status === 401) throw new Error('Сессия истекла — перезапустите сервер GG Email')
    const data = (await response.json()) as { ok: boolean; result?: T; error?: string }
    if (!data.ok) throw new Error(data.error ?? `Ошибка HTTP ${response.status}`)
    return data.result as T
  }

  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  // В режиме скриншота не открываем SSE, иначе headless-браузер не дождётся
  // состояния network idle и не сделает снимок.
  const screenshotMode = new URLSearchParams(window.location.search).has('screenshot')
  const source = screenshotMode
    ? null
    : new EventSource(`${base}/api/events?token=${encodeURIComponent(token)}`)
  if (source) {
    source.onmessage = (event: MessageEvent) => {
      try {
        const { channel, payload } = JSON.parse(event.data) as {
          channel: string
          payload: unknown
        }
        for (const listener of listeners.get(channel) ?? []) listener(payload)
      } catch {
        /* игнорируем некорректный кадр */
      }
    }
  }

  const on = (channel: string, listener: (payload: never) => void): (() => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    const set = listeners.get(channel)!
    set.add(listener as (payload: unknown) => void)
    return () => set.delete(listener as (payload: unknown) => void)
  }

  const attachmentUrl = (id: string, inline = false): string =>
    `${base}/api/attachment/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}${
      inline ? '&inline=1' : ''
    }`

  const api: KurierApi = {
    bootstrap: () => call<BootstrapState>(CHANNELS.bootstrap),
    accounts: {
      list: () => call<Account[]>(CHANNELS.accountsList),
      add: (input: AccountInput) => call<Account>(CHANNELS.accountAdd, input),
      update: (id: string, patch: Partial<Account>) =>
        call<Account>(CHANNELS.accountUpdate, id, patch),
      remove: (id: string) => call<void>(CHANNELS.accountRemove, id),
      test: (input: AccountInput) => call<AccountTestResult>(CHANNELS.accountTest, input),
      autoconfigure: (email: string) =>
        call<AutoconfigResult | null>(CHANNELS.accountAutoconfigure, email),
      setSecret: (id: string, secret: string) =>
        call<void>(CHANNELS.accountSetSecret, id, secret)
    },
    folders: {
      list: (accountId?: string) => call<Folder[]>(CHANNELS.foldersList, accountId)
    },
    messages: {
      list: (query: MessageQuery) => call<MessagePage>(CHANNELS.messagesList, query),
      get: (id: string) => call<MessageDetail>(CHANNELS.messageGet, id),
      setFlags: (id: string, flags: MessageFlags) =>
        call<void>(CHANNELS.messageFlags, id, flags),
      move: (id: string, role: FolderRole) => call<void>(CHANNELS.messageMove, id, role),
      remove: (id: string) => call<void>(CHANNELS.messageDelete, id),
      loadOlder: (folderId: string, beforeUid: number) =>
        call<number>(CHANNELS.messageLoadOlder, folderId, beforeUid),
      openAttachment: async (id: string) => {
        window.open(attachmentUrl(id, true), '_blank', 'noopener')
      },
      saveAttachment: async (id: string) => {
        const link = document.createElement('a')
        link.href = attachmentUrl(id)
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        return null
      },
      attachmentUrl: async (id: string) => attachmentUrl(id, true)
    },
    composer: {
      send: (draft: DraftPayload) => call<SendResult>(CHANNELS.composerSend, draft)
    },
    settings: {
      get: () => call<UserSettings>(CHANNELS.settingsGet),
      set: (patch) => call<UserSettings>(CHANNELS.settingsSet, patch)
    },
    policy: {
      get: () => call<PolicyState>(CHANNELS.policyGet)
    },
    sync: {
      now: (accountId?: string) => call<void>(CHANNELS.syncNow, accountId),
      all: () => call<void>(CHANNELS.syncAll),
      folder: (folderId: string) => call<void>(CHANNELS.syncFolder, folderId)
    },
    updater: {
      check: () => call<UpdaterState>(CHANNELS.updaterCheck),
      install: () => call<void>(CHANNELS.updaterInstall),
      state: () => call<UpdaterState>(CHANNELS.updaterState)
    },
    app: {
      info: () => call<AppInfo>(CHANNELS.appInfo),
      openDataFolder: () => call<void>(CHANNELS.appOpenData),
      openExternal: async (url: string) => {
        // В WebView2/браузере надёжнее открыть ссылку через window.open:
        // WebView2 перехватывает её в NewWindowRequested и отдаёт системному браузеру.
        const opened = window.open(url, '_blank', 'noopener')
        if (!opened) await call<void>(CHANNELS.appOpenExternal, url)
      },
      clearCache: () => call<void>(CHANNELS.appClearCache),
      clearBodies: () => call<void>(CHANNELS.appClearBodies),
      cacheStats: () => call<CacheStats>(CHANNELS.appCacheStats)
    },
    oauth: {
      start: (provider, email) =>
        call<{ ok: boolean; refreshToken?: string; error?: string }>(
          CHANNELS.oauthStart,
          provider,
          email
        )
    },
    window: {
      minimize: () => undefined,
      maximize: () => undefined,
      close: () => undefined
    },
    on: ((event: string, listener: (payload: never) => void) => {
      const known = Object.values(EVENTS) as string[]
      if (!known.includes(event)) throw new Error(`Неизвестный канал событий: ${event}`)
      return on(event, listener)
    }) as KurierApi['on']
  }

  ;(window as unknown as { kurier: KurierApi }).kurier = api
  void (null as unknown as SyncStatus)
}
