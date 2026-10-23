import { ipcMain, shell, BrowserWindow, app, dialog, type IpcMainInvokeEvent } from 'electron'
import { copyFile } from 'node:fs/promises'
import { CHANNELS } from '@shared/ipc'
import type { UserSettings } from '@shared/ipc'
import type {
  Account,
  AccountInput,
  AccountTestResult,
  AppInfo,
  BootstrapState,
  DraftPayload,
  Folder,
  FolderRole,
  MessageDetail,
  MessageFlags,
  MessagePage,
  MessageQuery,
  CacheStats,
  PolicyState,
  UpdaterState
} from '@shared/types'
import { isValidEmail } from '@shared/providers'
import { isBlockedAttachment, policyValue } from '@shared/policy'
import { AppContext } from './app-context'
import { secrets } from './secrets'
import { paths } from './paths'
import { createLogger } from './logger'
import { testImapConnection } from './mail/imap'
import { testSmtpConnection } from './mail/smtp'
import { autoconfigure } from './mail/autoconfig'
import { authorize } from './mail/oauth'

const log = createLogger('ipc')

const DEFAULT_SETTINGS: UserSettings = {
  language: 'auto',
  theme: 'system',
  density: 'comfortable',
  previewPane: 'right',
  notifications: true,
  syncAllFolders: false,
  signature: ''
}

const COLORS = ['#f23c30', '#f2994a', '#27ae60', '#2d9cdb', '#9b51e0', '#eb5757']

function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const trusted =
    url.startsWith('file://') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.0.0.1')
  if (!trusted) throw new Error('Недоверенный источник IPC-запроса')
}

export type ApiHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<unknown> | unknown
export type ApiHandlers = Record<string, ApiHandler>

function validateAccountInput(input: AccountInput): void {
  if (!input?.email || !isValidEmail(input.email)) throw new Error('Некорректный адрес почты')
  for (const endpoint of [input.imap, input.smtp]) {
    if (!endpoint?.host?.trim()) throw new Error('Не указан сервер')
    if (!Number.isInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535) {
      throw new Error('Некорректный порт')
    }
    if (!['tls', 'starttls', 'none'].includes(endpoint.security)) {
      throw new Error('Некорректный режим шифрования')
    }
  }
}

/**
 * Обработчики API не зависят от транспорта: их использует и Electron IPC,
 * и встроенный веб-сервер (режим «GG Email в браузере»).
 */
export function createApiHandlers(
  ctx: AppContext,
  getWindow: () => BrowserWindow | null
): ApiHandlers {
  const handlers: ApiHandlers = {}
  const handle = <T>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
  ): void => {
    handlers[channel] = fn as ApiHandler
  }

  handle<BootstrapState>(CHANNELS.bootstrap, async () => ({
    accounts: ctx.accounts.list(),
    folders: ctx.folders.list(),
    policy: ctx.policy,
    app: appInfo(),
    updater: ctx.updater.snapshot(),
    sync: Array.from(ctx.syncers.values()).map((syncer) => syncer.getStatus())
  }))

  // ---------------------------------------------------------------- аккаунты
  handle<Account[]>(CHANNELS.accountsList, () => ctx.accounts.list())

  handle<Account>(CHANNELS.accountAdd, async (_event, input: AccountInput) => {
    if (!policyValue(ctx.policy, 'allowAccountManagement', true)) {
      throw new Error('Администратор запретил добавлять учётные записи')
    }
    validateAccountInput(input)
    if (ctx.accounts.findByEmail(input.email)) {
      throw new Error('Учётная запись с таким адресом уже добавлена')
    }
    const requireTls = policyValue(ctx.policy, 'requireTls', true)
    if (requireTls && (input.imap.security === 'none' || input.smtp.security === 'none')) {
      throw new Error('Политика безопасности требует шифрованное соединение (SSL/TLS или STARTTLS)')
    }
    if ((input.authKind ?? 'password') === 'password' && !input.password) {
      throw new Error('Не указан пароль')
    }
    const color = input.color ?? COLORS[ctx.accounts.list().length % COLORS.length]
    const account = ctx.accounts.add({ ...input, color })
    if (input.password) {
      secrets.set(account.id, input.password, input.authKind ?? 'password')
    }
    await ctx.startAccount(account.id)
    return account
  })

  handle<Account>(CHANNELS.accountUpdate, async (_event, id: string, patch: Partial<Account>) => {
    if (!policyValue(ctx.policy, 'allowAccountManagement', true)) {
      throw new Error('Администратор запретил изменять учётные записи')
    }
    const updated = ctx.accounts.update(id, patch)
    await ctx.restartAccount(id)
    return updated
  })

  handle<void>(CHANNELS.accountRemove, async (_event, id: string) => {
    if (!policyValue(ctx.policy, 'allowAccountManagement', true)) {
      throw new Error('Администратор запретил удалять учётные записи')
    }
    await ctx.stopAccount(id)
    secrets.remove(id)
    ctx.accounts.remove(id)
  })

  handle<AccountTestResult>(CHANNELS.accountTest, async (_event, input: AccountInput) => {
    validateAccountInput(input)
    const user = input.username || input.email
    const password = input.password ?? ''
    const [imap, smtp] = await Promise.all([
      testImapConnection(input.imap, { user, pass: password }),
      testSmtpConnection(input.smtp, user, password)
    ])
    return {
      ok: imap.ok && smtp.ok,
      imap,
      smtp
    }
  })

  handle(CHANNELS.accountAutoconfigure, async (_event, email: string) => {
    if (!isValidEmail(email)) throw new Error('Некорректный адрес почты')
    const policyUrl = policyValue(ctx.policy, 'autoconfigUrl', '')
    return autoconfigure(email, { autoconfigUrl: typeof policyUrl === 'string' ? policyUrl : '' })
  })

  handle<void>(CHANNELS.accountSetSecret, async (_event, id: string, secret: string) => {
    const account = ctx.accounts.get(id)
    if (!account) throw new Error('Учётная запись не найдена')
    secrets.set(id, secret, account.authKind)
    await ctx.restartAccount(id)
  })

  // -------------------------------------------------------------------- папки
  handle<Folder[]>(CHANNELS.foldersList, (_event, accountId?: string) => ctx.folders.list(accountId))

  // ------------------------------------------------------------------ письма
  handle<MessagePage>(CHANNELS.messagesList, (_event, query: MessageQuery) => {
    return ctx.messages.list(query)
  })

  handle<MessageDetail>(CHANNELS.messageGet, async (_event, id: string) => {
    const cached = ctx.messages.get(id)
    if (!cached) throw new Error('Письмо не найдено в локальном кеше')
    if (cached.bodyFetched) return cached
    const syncer = ctx.syncer(cached.accountId)
    if (!syncer) throw new Error('Учётная запись отключена — тело письма недоступно офлайн')
    try {
      return await syncer.ensureBody(id)
    } catch (error) {
      const fallback = ctx.messages.get(id)
      if (fallback) return fallback
      throw error
    }
  })

  handle<void>(CHANNELS.messageFlags, async (_event, id: string, flags: MessageFlags) => {
    const message = ctx.messages.get(id)
    if (!message) throw new Error('Письмо не найдено')
    const syncer = ctx.syncer(message.accountId)
    if (!syncer) {
      ctx.messages.setFlags(id, flagsToMaskLocal(flags))
      return
    }
    await syncer.setFlags(id, flags)
  })

  handle<void>(CHANNELS.messageMove, async (_event, id: string, role: FolderRole) => {
    const message = ctx.messages.get(id)
    if (!message) throw new Error('Письмо не найдено')
    const syncer = ctx.syncer(message.accountId)
    if (!syncer) throw new Error('Нет соединения с сервером')
    await syncer.moveToRole(id, role)
  })

  handle<void>(CHANNELS.messageDelete, async (_event, id: string) => {
    const message = ctx.messages.get(id)
    if (!message) return
    const syncer = ctx.syncer(message.accountId)
    if (!syncer) throw new Error('Нет соединения с сервером')
    const trash = ctx.folders.list(message.accountId).find((folder) => folder.role === 'trash')
    if (trash && trash.id === message.folderId) {
      await syncer.deleteForever(id)
    } else if (trash) {
      await syncer.moveToRole(id, 'trash')
    } else {
      await syncer.deleteForever(id)
    }
  })

  handle<number>(CHANNELS.messageLoadOlder, async (_event, folderId: string, beforeUid: number) => {
    const folder = ctx.folders.get(folderId)
    if (!folder) return 0
    const syncer = ctx.syncer(folder.accountId)
    if (!syncer) return 0
    return syncer.loadOlder(folderId, beforeUid)
  })

  handle<void>(CHANNELS.messageOpenAttachment, async (_event, id: string) => {
    const attachment = ctx.messages.attachment(id)
    if (!attachment?.path) throw new Error('Вложение не найдено в кеше')
    if (isBlockedAttachment(attachment.filename, ctx.policy.values.blockedAttachmentExtensions)) {
      throw new Error('Открытие вложений этого типа запрещено политикой безопасности')
    }
    const error = await shell.openPath(attachment.path)
    if (error) throw new Error(error)
  })

  handle<string | null>(CHANNELS.messageSaveAttachment, async (event, id: string) => {
    const attachment = ctx.messages.attachment(id)
    if (!attachment?.path) throw new Error('Вложение не найдено в кеше')
    if (isBlockedAttachment(attachment.filename, ctx.policy.values.blockedAttachmentExtensions)) {
      throw new Error('Сохранение вложений этого типа запрещено политикой безопасности')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showSaveDialog(window, { defaultPath: attachment.filename })
      : await dialog.showSaveDialog({ defaultPath: attachment.filename })
    if (result.canceled || !result.filePath) return null
    await copyFile(attachment.path, result.filePath)
    return result.filePath
  })

  /** URL для показа вложения внутри приложения (без внешнего браузера). */
  handle<string>(CHANNELS.messageAttachmentUrl, (_event, id: string) => {
    if (!ctx.messages.attachment(id)) throw new Error('Вложение не найдено в кеше')
    return `kurier-att://attachment/${encodeURIComponent(id)}`
  })

  // ------------------------------------------------------------------ отправка
  handle(CHANNELS.composerSend, async (_event, draft: DraftPayload) => {
    const account = ctx.accounts.get(draft.accountId)
    if (!account) throw new Error('Учётная запись не найдена')
    if (!draft.to?.length) throw new Error('Укажите хотя бы одного получателя')
    let syncer = ctx.syncer(account.id)
    if (!syncer) {
      await ctx.startAccount(account.id)
      syncer = ctx.syncer(account.id)
    }
    if (!syncer) throw new Error('Не удалось подключиться к серверу')
    return syncer.send(draft)
  })

  // ------------------------------------------------------------------ настройки
  handle<UserSettings>(CHANNELS.settingsGet, () => {
    const stored = ctx.settings.get<Partial<UserSettings>>('user', {})
    return { ...DEFAULT_SETTINGS, ...stored }
  })

  handle<UserSettings>(CHANNELS.settingsSet, (_event, patch: Partial<UserSettings>) => {
    const stored = ctx.settings.get<Partial<UserSettings>>('user', {})
    const next = { ...DEFAULT_SETTINGS, ...stored, ...patch }
    ctx.settings.set('user', next)
    return next
  })

  handle<PolicyState>(CHANNELS.policyGet, () => ctx.policy)

  // -------------------------------------------------------------- синхронизация
  handle<void>(CHANNELS.syncAll, async () => {
    for (const account of ctx.accounts.list()) {
      if (account.disabled) continue
      if (!ctx.syncer(account.id)) await ctx.startAccount(account.id)
    }
    await ctx.syncAll()
  })

  handle<void>(CHANNELS.syncNow, async (_event, accountId?: string) => {
    if (accountId) {
      if (!ctx.syncer(accountId)) await ctx.startAccount(accountId)
      await ctx.syncer(accountId)?.syncAll('manual')
    } else {
      await ctx.syncAll()
    }
  })

  handle<void>(CHANNELS.syncFolder, async (_event, folderId: string) => {
    const folder = ctx.folders.get(folderId)
    if (!folder) return
    if (!ctx.syncer(folder.accountId)) await ctx.startAccount(folder.accountId)
    await ctx.syncer(folder.accountId)?.syncFolder(folderId)
  })

  // ------------------------------------------------------------------ обновления
  handle<UpdaterState>(CHANNELS.updaterCheck, async () => ctx.updater.check(true))
  handle<void>(CHANNELS.updaterInstall, () => ctx.updater.install())
  handle<UpdaterState>(CHANNELS.updaterState, () => ctx.updater.snapshot())

  // -------------------------------------------------------------------- приложение
  handle<AppInfo>(CHANNELS.appInfo, () => appInfo())

  handle<void>(CHANNELS.appOpenData, async () => {
    await shell.openPath(paths.root)
  })

  handle<void>(CHANNELS.appOpenExternal, async (_event, url: string) => {
    await ctx.openExternal(url)
  })

  handle<void>(CHANNELS.appClearCache, async () => {
    await ctx.clearCache()
  })

  handle<CacheStats>(CHANNELS.appCacheStats, () => ctx.cacheStats())

  handle<void>(CHANNELS.appClearBodies, () => {
    ctx.clearBodies()
  })

  handle(CHANNELS.oauthStart, async (_event, provider: 'google' | 'yandex', email?: string) => {
    try {
      const tokens = await authorize(provider, ctx.policy, email)
      return { ok: true, refreshToken: tokens.refreshToken }
    } catch (error) {
      log.warn('OAuth не выполнен', (error as Error).message)
      return { ok: false, error: (error as Error).message }
    }
  })

  // ------------------------------------------------------------------- окно
  handle<void>(CHANNELS.windowMinimize, () => {
    getWindow()?.minimize()
  })
  handle<void>(CHANNELS.windowMaximize, () => {
    const window = getWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  handle<void>(CHANNELS.windowClose, () => {
    getWindow()?.close()
  })

  return handlers
}

export function registerIpc(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  for (const [channel, handler] of Object.entries(createApiHandlers(ctx, getWindow))) {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrusted(event)
      return handler(event, ...args)
    })
  }
}

function flagsToMaskLocal(flags: MessageFlags): number {
  let mask = 0
  if (flags.seen) mask |= 1
  if (flags.answered) mask |= 2
  if (flags.flagged) mask |= 4
  if (flags.deleted) mask |= 8
  if (flags.draft) mask |= 16
  if (flags.forwarded) mask |= 32
  return mask
}

export function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    dataPath: paths.root,
    isPackaged: app.isPackaged
  }
}
