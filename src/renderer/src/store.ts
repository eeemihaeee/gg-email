import { create } from 'zustand'
import type {
  Account,
  AccountInput,
  AppInfo,
  Folder,
  FolderRole,
  MessageDetail,
  MessageFlags,
  MessageSummary,
  PolicyState,
  SyncStatus,
  UpdaterState
} from '@shared/types'
import type { UserSettings } from '@shared/ipc'
import { quoteText, replySubject, senderLabel } from './lib/format'

export interface ViewSelection {
  kind: 'unified' | 'folder'
  accountId?: string
  folderId?: string
}

export interface ComposeAttachment {
  filename: string
  contentType: string
  size: number
  contentBase64: string
}

export interface ComposeState {
  mode: 'new' | 'reply' | 'replyAll' | 'forward'
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string[]
  attachments: ComposeAttachment[]
}

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  message: string
}

type View = 'mail' | 'settings' | 'setup'

interface Store {
  ready: boolean
  initError: string | null
  accounts: Account[]
  folders: Folder[]
  policy: PolicyState
  appInfo: AppInfo | null
  updater: UpdaterState
  settings: UserSettings | null
  sync: Record<string, SyncStatus>

  view: View
  selection: ViewSelection
  messages: MessageSummary[]
  total: number
  hasMore: boolean
  listLoading: boolean
  query: string

  selectedId: string | null
  detail: MessageDetail | null
  detailLoading: boolean
  allowRemote: Record<string, boolean>

  compose: ComposeState | null
  toasts: Toast[]

  init(): Promise<void>
  openSettings(): void
  openSetup(): void
  closeOverlay(): void

  selectUnified(accountId?: string): Promise<void>
  selectFolder(folderId: string): Promise<void>
  refreshFolders(): Promise<void>
  setQuery(query: string): Promise<void>
  loadMessages(reset?: boolean, limit?: number): Promise<void>
  loadOlder(): Promise<void>

  openMessage(id: string): Promise<void>
  closeMessage(): void
  toggleFlag(id: string): Promise<void>
  setSeen(id: string, seen: boolean): Promise<void>
  deleteMessage(id: string): Promise<void>
  allowRemoteFor(id: string): void

  startCompose(mode: 'new' | 'reply' | 'replyAll' | 'forward', message?: MessageDetail): void
  updateCompose(patch: Partial<ComposeState>): void
  addComposeAttachment(file: File): Promise<void>
  removeComposeAttachment(index: number): Promise<void>
  sendCompose(): Promise<void>
  discardCompose(): void

  addAccount(input: AccountInput): Promise<Account>
  updateSettings(patch: Partial<UserSettings>): Promise<void>
  syncNow(): Promise<void>
  checkUpdates(): Promise<void>
  installUpdate(): Promise<void>
  clearCache(): Promise<void>

  applySyncStatus(status: SyncStatus): void
  onFoldersChanged(accountId: string): Promise<void>
  onMessagesChanged(folderIds: string[]): Promise<void>
  pushToast(kind: Toast['kind'], message: string): void
  dismissToast(id: string): void
  setPolicy(policy: PolicyState): void
  setUpdater(state: UpdaterState): void
}

const EMPTY_POLICY: PolicyState = {
  managed: false,
  source: 'none',
  values: {},
  locked: [],
  errors: []
}

function parseAddresses(value: string): Array<{ name: string; email: string }> {
  return value
    .split(/[,;]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^(.*)<([^>]+)>$/)
      if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() }
      return { name: '', email: chunk }
    })
}

export const useStore = create<Store>()((set, get) => ({
  ready: false,
  initError: null,
  accounts: [],
  folders: [],
  policy: EMPTY_POLICY,
  appInfo: null,
  updater: { status: 'idle' },
  settings: null,
  sync: {},

  view: 'mail',
  selection: { kind: 'unified' },
  messages: [],
  total: 0,
  hasMore: false,
  listLoading: false,
  query: '',

  selectedId: null,
  detail: null,
  detailLoading: false,
  allowRemote: {},

  compose: null,
  toasts: [],

  async init() {
    try {
      const [state, settings] = await Promise.all([
        window.kurier.bootstrap(),
        window.kurier.settings.get()
      ])
      const firstAccount = state.accounts[0]
      const hasAccounts = state.accounts.length > 0
      set({
        ready: true,
        accounts: state.accounts,
        folders: state.folders,
        policy: state.policy,
        appInfo: state.app,
        updater: state.updater,
        settings,
        view: hasAccounts ? 'mail' : 'setup',
        selection: firstAccount
          ? { kind: 'unified', accountId: firstAccount.id }
          : { kind: 'unified' }
      })
      if (hasAccounts) await get().loadMessages(true)
    } catch (error) {
      set({ ready: true, initError: (error as Error).message })
    }
  },

  openSettings() {
    set({ view: 'settings' })
  },

  openSetup() {
    set({ view: 'setup' })
  },

  closeOverlay() {
    set({ view: get().accounts.length > 0 ? 'mail' : 'setup' })
  },

  async selectUnified(accountId) {
    set({
      selection: { kind: 'unified', accountId },
      selectedId: null,
      detail: null,
      query: ''
    })
    await get().loadMessages(true)
  },

  async selectFolder(folderId) {
    const folder = get().folders.find((item) => item.id === folderId)
    set({
      selection: { kind: 'folder', folderId, accountId: folder?.accountId },
      selectedId: null,
      detail: null,
      query: ''
    })
    await get().loadMessages(true)
    if (folder) void window.kurier.sync.folder(folderId)
  },

  async refreshFolders() {
    const folders = await window.kurier.folders.list()
    set({ folders })
  },

  async setQuery(query) {
    set({ query })
    await get().loadMessages(true)
  },

  async loadMessages(reset = false, limit = 100) {
    const { selection, query, messages } = get()
    const offset = reset ? 0 : messages.length
    set({ listLoading: true })
    try {
      const page = await window.kurier.messages.list({
        accountId: selection.accountId,
        folderId: selection.kind === 'folder' ? selection.folderId : undefined,
        role: selection.kind === 'unified' ? 'inbox' : undefined,
        query: query.trim() || undefined,
        limit,
        offset
      })
      set({
        messages: reset ? page.items : [...messages, ...page.items],
        total: page.total,
        hasMore: page.hasMore,
        listLoading: false
      })
    } catch (error) {
      set({ listLoading: false })
      get().pushToast('error', (error as Error).message)
    }
  },

  async loadOlder() {
    const { selection, messages, hasMore } = get()
    if (!hasMore || messages.length === 0) return
    if (selection.kind !== 'folder' || !selection.folderId) return
    const oldest = messages[messages.length - 1]
    set({ listLoading: true })
    try {
      await window.kurier.messages.loadOlder(selection.folderId, oldest.uid)
      await get().loadMessages(true, Math.min(500, messages.length + 100))
    } catch (error) {
      get().pushToast('error', (error as Error).message)
    } finally {
      set({ listLoading: false })
    }
  },

  async openMessage(id) {
    set({ selectedId: id, detailLoading: true, detail: null })
    try {
      const detail = await window.kurier.messages.get(id)
      set({ detail, detailLoading: false })
      if (!detail.flags.seen) {
        void get().setSeen(id, true)
      }
    } catch (error) {
      set({ detailLoading: false })
      get().pushToast('error', (error as Error).message)
    }
  },

  closeMessage() {
    set({ selectedId: null, detail: null })
  },

  async toggleFlag(id) {
    const message = get().messages.find((item) => item.id === id)
    const detail = get().detail
    const current = message?.flags.flagged ?? detail?.flags.flagged ?? false
    const next: MessageFlags = {
      ...(message?.flags ?? detail?.flags ?? {
        seen: false,
        flagged: false,
        answered: false,
        forwarded: false,
        draft: false,
        deleted: false
      }),
      flagged: !current
    }
    set({
      messages: get().messages.map((item) => (item.id === id ? { ...item, flags: next } : item)),
      detail: detail && detail.id === id ? { ...detail, flags: next } : detail
    })
    try {
      await window.kurier.messages.setFlags(id, next)
    } catch (error) {
      get().pushToast('error', (error as Error).message)
      await get().loadMessages(true)
    }
  },

  async setSeen(id, seen) {
    const message = get().messages.find((item) => item.id === id)
    const detail = get().detail
    const base = message?.flags ?? detail?.flags
    if (!base) return
    const next: MessageFlags = { ...base, seen }
    set({
      messages: get().messages.map((item) => (item.id === id ? { ...item, flags: next } : item)),
      detail: detail && detail.id === id ? { ...detail, flags: next } : detail
    })
    try {
      await window.kurier.messages.setFlags(id, next)
    } catch (error) {
      get().pushToast('error', (error as Error).message)
    }
  },

  async deleteMessage(id) {
    try {
      await window.kurier.messages.remove(id)
      set({
        messages: get().messages.filter((item) => item.id !== id),
        selectedId: null,
        detail: null,
        total: Math.max(0, get().total - 1)
      })
      await get().refreshFolders()
      get().pushToast('success', 'Письмо перемещено в корзину')
    } catch (error) {
      get().pushToast('error', (error as Error).message)
    }
  },

  allowRemoteFor(id) {
    set({ allowRemote: { ...get().allowRemote, [id]: true } })
  },

  startCompose(mode, message) {
    const { accounts, selection, settings } = get()
    const accountId =
      message?.accountId ?? selection.accountId ?? accounts[0]?.id ?? ''
    const signature = settings?.signature ?? ''
    let draft: ComposeState = {
      mode,
      accountId,
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      body: signature,
      attachments: []
    }

    if (message && mode !== 'new') {
      const primary = message.from[0]?.email ?? ''
      if (mode === 'forward') {
        draft = {
          ...draft,
          subject: replySubject(message.subject, 'Fwd'),
          body: `${signature}\n\n---------- Пересланное сообщение ----------\nОт: ${senderLabel(message.from)} <${primary}>\nДата: ${new Date(message.date).toLocaleString('ru-RU')}\nТема: ${message.subject}\n\n${message.textBody}`
        }
      } else {
        const recipients = [primary]
        if (mode === 'replyAll') {
          recipients.push(
            ...message.to
              .filter((address) => address.email !== message.accountEmail)
              .map((address) => address.email)
          )
        }
        draft = {
          ...draft,
          to: recipients.filter(Boolean).join(', '),
          subject: replySubject(message.subject),
          body: `${signature}${quoteText(message)}`,
          inReplyTo: message.messageId ?? undefined,
          references: [message.messageId ?? ''].filter(Boolean)
        }
      }
    }

    set({ compose: draft })
  },

  updateCompose(patch) {
    const compose = get().compose
    if (!compose) return
    set({ compose: { ...compose, ...patch } })
  },

  async addComposeAttachment(file) {
    const compose = get().compose
    if (!compose) return
    if (file.size > 20 * 1024 * 1024) {
      get().pushToast('error', 'Вложение больше 20 МБ не поддерживается')
      return
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    set({
      compose: {
        ...compose,
        attachments: [
          ...compose.attachments,
          {
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            contentBase64: base64
          }
        ]
      }
    })
  },

  async removeComposeAttachment(index) {
    const compose = get().compose
    if (!compose) return
    set({
      compose: {
        ...compose,
        attachments: compose.attachments.filter((_item, i) => i !== index)
      }
    })
  },

  async sendCompose() {
    const compose = get().compose
    if (!compose) return
    if (!compose.to.trim()) {
      get().pushToast('error', 'Укажите получателя')
      return
    }
    const result = await window.kurier.composer.send({
      accountId: compose.accountId,
      to: parseAddresses(compose.to),
      cc: parseAddresses(compose.cc),
      bcc: parseAddresses(compose.bcc),
      subject: compose.subject,
      text: compose.body,
      inReplyTo: compose.inReplyTo,
      references: compose.references,
      attachments: compose.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        contentBase64: attachment.contentBase64
      }))
    })
    if (result.ok) {
      get().pushToast('success', 'Письмо отправлено')
      set({ compose: null })
      await get().loadMessages(true)
    } else {
      get().pushToast('error', `Не удалось отправить: ${result.error ?? 'неизвестная ошибка'}`)
    }
  },

  discardCompose() {
    set({ compose: null })
  },

  async addAccount(input) {
    const account = await window.kurier.accounts.add(input)
    const [accounts, folders] = await Promise.all([
      window.kurier.accounts.list(),
      window.kurier.folders.list()
    ])
    set({
      accounts,
      folders,
      view: 'mail',
      selection: { kind: 'unified', accountId: account.id }
    })
    await get().loadMessages(true)
    return account
  },

  async updateSettings(patch) {
    const settings = await window.kurier.settings.set(patch)
    set({ settings })
    applyTheme(settings)
  },

  async syncNow() {
    await window.kurier.sync.all()
    await get().loadMessages(true)
    await get().refreshFolders()
  },

  async checkUpdates() {
    const updater = await window.kurier.updater.check()
    set({ updater })
  },

  async installUpdate() {
    await window.kurier.updater.install()
  },

  async clearCache() {
    await window.kurier.app.clearCache()
    await get().loadMessages(true)
    await get().refreshFolders()
  },

  applySyncStatus(status) {
    set({ sync: { ...get().sync, [status.accountId]: status } })
  },

  async onFoldersChanged() {
    await get().refreshFolders()
  },

  async onMessagesChanged(folderIds) {
    const { selection, selectedId } = get()
    const relevant =
      selection.kind === 'folder' && selection.folderId
        ? folderIds.includes(selection.folderId)
        : true
    if (!relevant) return
    await get().loadMessages(true)
    if (selectedId) {
      const stillThere = get().messages.some((message) => message.id === selectedId)
      if (!stillThere) set({ selectedId: null, detail: null })
    }
  },

  pushToast(kind, message) {
    const toast: Toast = { id: `${Date.now()}-${Math.random()}`, kind, message }
    set({ toasts: [...get().toasts, toast] })
    setTimeout(() => get().dismissToast(toast.id), kind === 'error' ? 7000 : 4000)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
  },

  setPolicy(policy) {
    set({ policy })
  },

  setUpdater(updater) {
    set({ updater })
  }
}))

export function applyTheme(settings: UserSettings | null): void {
  if (!settings) return
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.density = settings.density
}

export function folderRoleLabel(role: FolderRole): string {
  switch (role) {
    case 'inbox':
      return 'Входящие'
    case 'sent':
      return 'Отправленные'
    case 'drafts':
      return 'Черновики'
    case 'trash':
      return 'Корзина'
    case 'junk':
      return 'Спам'
    case 'archive':
      return 'Архив'
    default:
      return 'Папка'
  }
}
