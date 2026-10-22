import { ImapFlow } from 'imapflow'
import type {
  Account,
  DraftPayload,
  Folder,
  FolderRole,
  MessageDetail,
  MessageFlags,
  SendResult,
  SyncStatus
} from '@shared/types'
import { detectFolderRole } from '@shared/providers'
import type { Database } from '../db/database'
import type { MessageUpsert } from '../db/repos'
import { AccountsRepo, FoldersRepo, MessagesRepo, OutboxRepo, flagsToMask, messageRowId } from '../db/repos'
import { createLogger } from '../logger'
import { backoff, Mutex } from '../util/mutex'
import { createImapClient, flagsToMask as imapFlagsToMask, normalizeAddresses, parseImapDate } from './imap'
import { parseRawMessage, makeSnippet } from './mime'
import { buildRawMessage, sendPrepared } from './smtp'

function describeError(error: unknown): string {
  if (typeof error === 'string') return error
  const value = error as {
    message?: string
    responseText?: string
    serverResponseCode?: string
    authenticationFailed?: boolean
  }
  const parts = [value.message ?? String(error)]
  if (value.responseText && !parts.includes(value.responseText)) parts.push(value.responseText)
  if (value.serverResponseCode) parts.push(value.serverResponseCode)
  return parts.filter(Boolean).join(' · ')
}

function friendlyError(message: string): string {
  const value = message.toLowerCase()
  if (
    value.includes('command failed') ||
    value.includes('authentication') ||
    value.includes('invalid credentials') ||
    value.includes('auth')
  ) {
    const code = message.match(/AUTHENTICATIONFAILED|LOGIN failed|\[[A-Z_]+\]/i)?.[0]
    const detail = code ? ` Код сервера: ${code}.` : ''
    return (
      'Сервер отклонил логин или пароль. В mailcow проверьте пароль ящика и доступ по IMAP/SMTP ' +
      '(после нескольких неудачных попыток возможен временный бан fail2ban); для Gmail и Яндекса ' +
      'нужен пароль приложения (или OAuth).' +
      detail
    )
  }
  if (value.includes('certificate') || value.includes('self signed')) {
    return 'Сертификат сервера не доверенный: обратитесь в ИТ-отдел'
  }
  if (value.includes('timeout') || value.includes('timed out')) {
    return 'Сервер не отвечает: проверьте сеть, VPN и порт'
  }
  if (value.includes('econnrefused') || value.includes('enotfound')) {
    return 'Сервер недоступен: проверьте адрес и порт'
  }
  return message
}
const log = createLogger('sync')

const INITIAL_BATCH = 200
const FETCH_BATCH = 250
const MAX_PER_RUN = 2000
const RECONCILE_INTERVAL_MS = 15 * 60_000
const RECONCILE_MAX_MESSAGES = 50_000

export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'messages'; accountId: string; folderIds: string[] }
  | { type: 'folders'; accountId: string }
  | { type: 'error'; accountId: string; error: string }

export interface SyncContext {
  db: Database
  accounts: AccountsRepo
  folders: FoldersRepo
  messages: MessagesRepo
  outbox: OutboxRepo
  emit: (event: SyncEvent) => void
}

interface FetchQuery {
  uid: true
  envelope: true
  flags: true
  size: true
  internalDate: true
  bodyStructure: true
  modseq?: true
}

export class AccountSyncer {
  private client: ImapFlow | null = null
  private mutex = new Mutex()
  private timer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = true
  private reconnectAttempt = 0
  private status: SyncStatus
  private folderDebounce = new Map<string, NodeJS.Timeout>()
  private lastReconcile = new Map<string, number>()
  private syncing = false
  private connecting = false
  private lastError = ''

  constructor(
    private account: Account,
    private ctx: SyncContext
  ) {
    this.status = { accountId: account.id, phase: 'idle' }
  }

  get accountId(): string {
    return this.account.id
  }

  getStatus(): SyncStatus {
    return this.status
  }

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    this.setStatus({ phase: 'connecting' })
    await this.connect()
    this.timer = setInterval(() => {
      void this.syncAll('interval')
    }, 5 * 60_000)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    for (const timeout of this.folderDebounce.values()) clearTimeout(timeout)
    this.folderDebounce.clear()
    const client = this.client
    this.client = null
    if (client) {
      try {
        await client.logout()
      } catch {
        /* соединение уже закрыто */
      }
    }
    this.setStatus({ phase: 'idle' })
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch, accountId: this.account.id }
    this.ctx.emit({ type: 'status', status: this.status })
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    this.setStatus({ phase: 'connecting' })
    const client = await createImapClient(this.account)
    this.client = client
    this.lastError = ''
    this.connecting = true

    client.on('error', (error: Error) => {
      this.lastError = describeError(error)
      log.warn(`Ошибка соединения ${this.account.email}`, error.message)
    })
    client.on('close', () => {
      if (this.stopped || this.connecting) return
      this.handleDisconnect(friendlyError(this.lastError || 'Соединение закрыто сервером'))
    })
    client.on('exists', (data: { path: string }) => {
      const folder = this.ctx.folders.findByPath(this.account.id, data.path)
      if (folder) this.scheduleFolderSync(folder.id)
    })
    client.on('flags', (data: { path: string; uid: number; flags: Set<string> }) => {
      const folder = this.ctx.folders.findByPath(this.account.id, data.path)
      if (!folder) return
      const mask = imapFlagsToMask(data.flags)
      this.ctx.db.run(
        'UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?',
        mask,
        folder.id,
        data.uid
      )
      this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
    })
    client.on('expunge', (data: { path: string }) => {
      const folder = this.ctx.folders.findByPath(this.account.id, data.path)
      if (folder) this.scheduleFolderSync(folder.id)
    })

    try {
      await client.connect()
      this.connecting = false
    } catch (error) {
      this.connecting = false
      const message = describeError(error)
      this.lastError = message
      this.handleDisconnect(friendlyError(message))
      return
    }

    this.reconnectAttempt = 0
    try {
      await this.discoverFolders()
      await this.syncAll('connect')
      await this.replayPendingOps()
    } catch (error) {
      log.error('Ошибка первичной синхронизации', error)
      this.setStatus({ phase: 'error', error: (error as Error).message })
    }
  }

  private handleDisconnect(reason: string): void {
    if (this.stopped) return
    log.warn(`Соединение с ${this.account.email} потеряно: ${reason}`)
    this.client = null
    this.setStatus({ phase: 'offline', error: reason })
    if (this.reconnectTimer) return
    const wait = backoff(this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, wait)
    this.reconnectTimer.unref?.()
  }

  private async discoverFolders(): Promise<void> {
    const client = this.client
    if (!client) return
    this.setStatus({ phase: 'discovering' })
    const list = await client.list()
    const paths: string[] = []
    for (const mailbox of list) {
      if (!mailbox.listed) continue
      const role = this.resolveRole(mailbox)
      const folder = this.ctx.folders.upsert(
        this.account.id,
        mailbox.path,
        mailbox.name,
        mailbox.delimiter ?? '/',
        role
      )
      paths.push(folder.path)
      void mailbox
    }
    this.ctx.folders.removeMissing(this.account.id, paths)
    this.ctx.emit({ type: 'folders', accountId: this.account.id })
  }

  private resolveRole(mailbox: {
    path: string
    name: string
    specialUse?: string
    flags?: Set<string>
  }): FolderRole {
    const special = mailbox.specialUse ?? undefined
    const attributes = special ? [special] : Array.from(mailbox.flags ?? [])
    const role = detectFolderRole(mailbox.path, special, attributes)
    return role
  }

  /** Синхронизирует папки с письмами: INBOX, системные папки и выбранные пользователем. */
  private foldersToSync(): Folder[] {
    const all = this.ctx.folders.list(this.account.id)
    const important: FolderRole[] = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']
    return all.filter((folder) => important.includes(folder.role))
  }

  async syncAll(_reason: string): Promise<void> {
    if (this.stopped || this.syncing) return
    if (!this.client?.usable) return
    this.syncing = true
    try {
      const folders = this.foldersToSync()
      for (const folder of folders) {
        if (this.stopped) break
        try {
          await this.enqueue(() => this.syncFolderInner(folder))
        } catch (error) {
          log.warn(`Не удалось синхронизировать ${folder.path}`, (error as Error).message)
        }
      }
      await this.enqueue(() => this.openInbox())
    } finally {
      this.syncing = false
      this.setStatus({ phase: 'idle', lastSyncAt: Date.now(), folder: undefined })
    }
  }

  async syncFolder(folderId: string): Promise<void> {
    const folder = this.ctx.folders.get(folderId)
    if (!folder) return
    await this.enqueue(() => this.syncFolderInner(folder))
  }

  private scheduleFolderSync(folderId: string): void {
    if (this.folderDebounce.has(folderId)) return
    const timeout = setTimeout(() => {
      this.folderDebounce.delete(folderId)
      void this.syncFolder(folderId).catch((error) => log.warn('Отложенная синхронизация', error))
    }, 1500)
    timeout.unref?.()
    this.folderDebounce.set(folderId, timeout)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return this.mutex.run(task)
  }

  private async open(path: string): Promise<void> {
    const client = this.client
    if (!client) throw new Error('Нет соединения с сервером')
    if (client.mailbox && client.mailbox.path === path) return
    await client.mailboxOpen(path)
  }

  private async openInbox(): Promise<void> {
    const inbox = this.ctx.folders
      .list(this.account.id)
      .find((folder) => folder.role === 'inbox')
    if (inbox) await this.open(inbox.path)
  }

  private async syncFolderInner(folder: Folder): Promise<void> {
    const client = this.client
    if (!client?.usable) throw new Error('Нет соединения')
    this.setStatus({ phase: 'syncing', folder: folder.path })
    await this.open(folder.path)

    const mailbox = client.mailbox
    if (!mailbox) throw new Error(`Папка ${folder.path} недоступна`)

    const uidValidity = Number(mailbox.uidValidity)
    let current = folder
    if (current.uidValidity !== null && Number(current.uidValidity) !== uidValidity) {
      log.info(`UIDVALIDITY изменился в ${folder.path}, кеш папки сброшен`)
      this.ctx.messages.removeByFolder(folder.id)
      this.ctx.folders.updateSyncState(folder.id, {
        uidValidity,
        uidNext: 1,
        highestModseq: 0
      })
      current = this.ctx.folders.get(folder.id) ?? folder
    }

    const serverNext = Number(mailbox.uidNext)
    const maxUid =
      this.ctx.db.get<{ max: number | null }>(
        'SELECT MAX(uid) AS max FROM messages WHERE folder_id = ?',
        folder.id
      )?.max ?? 0

    let from = maxUid > 0 ? maxUid + 1 : Math.max(1, serverNext - INITIAL_BATCH)
    let fetched = 0

    while (from < serverNext && fetched < MAX_PER_RUN && !this.stopped) {
      const to = Math.min(serverNext - 1, from + FETCH_BATCH - 1)
      const rows = await this.fetchRange(from, to, Boolean(mailbox.highestModseq))
      if (rows.length > 0) {
        this.ctx.messages.upsertMany(rows)
        fetched += rows.length
        this.setStatus({ phase: 'syncing', folder: folder.path, fetched, total: serverNext - from })
      }
      from = to + 1
    }

    await this.updateFolderStats(current)

    if (fetched > 0) {
      this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
    }
    await this.maybeReconcile(current, Number(mailbox.exists))
  }

  private async fetchRange(
    fromUid: number,
    toUid: number,
    useModseq: boolean
  ): Promise<MessageUpsert[]> {
    const client = this.client
    if (!client) return []
    const query: FetchQuery = {
      uid: true,
      envelope: true,
      flags: true,
      size: true,
      internalDate: true,
      bodyStructure: true
    }
    if (useModseq) query.modseq = true

    const folder = this.currentFolder()
    if (!folder) return []

    const rows: MessageUpsert[] = []
    for await (const message of client.fetch(`${fromUid}:${toUid}`, query, { uid: true })) {
      const uid = Number(message.uid)
      const envelope = message.envelope
      rows.push(
        toUpsert(this.account, folder, uid, {
          subject: envelope?.subject ?? '',
          from: normalizeAddresses(envelope?.from),
          to: normalizeAddresses(envelope?.to),
          cc: normalizeAddresses(envelope?.cc),
          messageId: envelope?.messageId ?? null,
          date: parseImapDate(envelope?.date ?? message.internalDate),
          size: message.size ?? 0,
          flags: imapFlagsToMask(message.flags),
          modseq: message.modseq ? Number(message.modseq) : null,
          hasAttachments: bodyHasAttachments(message.bodyStructure)
        })
      )
    }
    return rows
  }

  private currentFolder(): Folder | null {
    const mailbox = this.client?.mailbox
    if (!mailbox) return null
    return this.ctx.folders.findByPath(this.account.id, mailbox.path) ?? null
  }

  private async updateFolderStats(folder: Folder): Promise<void> {
    const client = this.client
    if (!client?.usable) return
    const mailbox = client.mailbox || null
    try {
      const status = await client.status(folder.path, { messages: true, unseen: true })
      const statusObject = status || null
      this.ctx.folders.updateSyncState(folder.id, {
        total: statusObject?.messages ?? folder.total,
        unread: statusObject?.unseen ?? folder.unread,
        uidNext: Number(mailbox?.uidNext ?? folder.uidNext ?? 0) || undefined,
        highestModseq: mailbox?.highestModseq
          ? Number(mailbox.highestModseq)
          : folder.highestModseq,
        lastSyncAt: Date.now()
      })
    } catch (error) {
      log.debug('STATUS не удался', (error as Error).message)
      this.ctx.folders.recomputeCounts(folder.id)
    }
    this.ctx.emit({ type: 'folders', accountId: this.account.id })
  }

  /** Удаляет из кеша письма, удалённые на сервере другим клиентом. */
  private async maybeReconcile(folder: Folder, serverCount: number): Promise<void> {
    const last = this.lastReconcile.get(folder.id) ?? 0
    if (Date.now() - last < RECONCILE_INTERVAL_MS) return
    if (serverCount > RECONCILE_MAX_MESSAGES) return
    this.lastReconcile.set(folder.id, Date.now())

    const client = this.client
    if (!client?.usable) return
    try {
      const serverUids = new Set<number>()
      for await (const message of client.fetch('1:*', { uid: true }, { uid: true })) {
        serverUids.add(Number(message.uid))
      }
      const local = this.ctx.db.all<{ uid: number }>(
        'SELECT uid FROM messages WHERE folder_id = ?',
        folder.id
      )
      let removed = 0
      for (const row of local) {
        if (!serverUids.has(row.uid)) {
          this.ctx.messages.remove(messageRowId(folder.id, row.uid))
          removed += 1
        }
      }
      if (removed > 0) {
        log.info(`Удалено устаревших писем из кеша: ${removed}`)
        this.ctx.folders.recomputeCounts(folder.id)
        this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
      }
    } catch (error) {
      log.debug('Сверка папки не удалась', (error as Error).message)
    }
  }

  /** Догружает старые письма папки (кнопка «Показать ещё»). */
  async loadOlder(folderId: string, beforeUid: number, limit = INITIAL_BATCH): Promise<number> {
    const folder = this.ctx.folders.get(folderId)
    if (!folder) return 0
    return this.enqueue(async () => {
      const client = this.client
      if (!client?.usable) throw new Error('Нет соединения')
      await this.open(folder.path)
      const to = Math.max(1, beforeUid - 1)
      const from = Math.max(1, to - limit + 1)
      if (to < 1) return 0
      const mailbox = client.mailbox || null
      const rows = await this.fetchRange(from, to, Boolean(mailbox?.highestModseq))
      this.ctx.messages.upsertMany(rows)
      if (rows.length > 0) {
        this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
      }
      return rows.length
    })
  }

  /** Загружает и разбирает тело письма по требованию. */
  async ensureBody(messageId: string): Promise<MessageDetail> {
    const existing = this.ctx.messages.get(messageId)
    if (!existing) throw new Error('Письмо не найдено в кеше')
    if (existing.bodyFetched) return existing

    return this.enqueue(async () => {
      const current = this.ctx.messages.get(messageId)
      if (current?.bodyFetched) return current
      const client = this.client
      if (!client?.usable) throw new Error('Нет соединения с сервером')
      const folder = this.ctx.folders.get(existing.folderId)
      if (!folder) throw new Error('Папка письма не найдена')
      await this.open(folder.path)

      const message = await client.fetchOne(String(existing.uid), { source: true }, { uid: true })
      if (!message || !message.source) throw new Error('Сервер не вернул тело письма')

      const parsed = await parseRawMessage(Buffer.from(message.source), messageId)
      const snippet = makeSnippet(parsed.text, parsed.html)

      this.ctx.messages.saveBody(
        messageId,
        folder.id,
        {
          text: parsed.text,
          html: parsed.html,
          attachments: parsed.attachments.map((attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            contentId: attachment.contentId,
            inline: attachment.inline
          })),
          headers: parsed.headers
        },
        parsed.attachments
      )
      this.ctx.db.run('UPDATE messages SET snippet = ? WHERE id = ?', snippet, messageId)
      this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
      return this.ctx.messages.get(messageId)!
    })
  }

  async setFlags(messageId: string, next: MessageFlags): Promise<void> {
    const message = this.ctx.messages.get(messageId)
    if (!message) throw new Error('Письмо не найдено')
    const mask = flagsToMask(next)
    this.ctx.messages.setFlags(messageId, mask)

    const add: string[] = []
    const remove: string[] = []
    const previous = message.flags
    for (const key of ['seen', 'flagged', 'answered', 'draft'] as const) {
      const imapFlag = `\\${key[0].toUpperCase()}${key.slice(1)}`
      if (next[key] && !previous[key]) add.push(imapFlag)
      if (!next[key] && previous[key]) remove.push(imapFlag)
    }
    if (add.length === 0 && remove.length === 0) return

    try {
      await this.enqueue(async () => {
        const client = this.client
        if (!client?.usable) throw new Error('Нет соединения')
        const folder = this.ctx.folders.get(message.folderId)
        if (!folder) throw new Error('Папка не найдена')
        await this.open(folder.path)
        if (add.length > 0) await client.messageFlagsAdd(String(message.uid), add, { uid: true })
        if (remove.length > 0) {
          await client.messageFlagsRemove(String(message.uid), remove, { uid: true })
        }
      })
    } catch (error) {
      // Откатываем оптимистичное изменение и откладываем операцию.
      this.ctx.messages.setFlags(messageId, flagsToMask(previous))
      this.queueOp('flags', {
        accountId: this.account.id,
        messageId,
        folderPath: message.folderPath,
        uid: message.uid,
        flags: next
      })
      throw error
    }
    this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [message.folderId] })
  }

  async moveToRole(messageId: string, role: FolderRole): Promise<void> {
    const message = this.ctx.messages.get(messageId)
    if (!message) throw new Error('Письмо не найдено')
    const target = this.ctx.folders.list(this.account.id).find((folder) => folder.role === role)
    if (!target) throw new Error(`Папка «${role}» не найдена`)
    const folder = this.ctx.folders.get(message.folderId)
    if (!folder) throw new Error('Папка не найдена')
    if (target.id === folder.id) return

    await this.enqueue(async () => {
      const client = this.client
      if (!client?.usable) throw new Error('Нет соединения')
      await this.open(folder.path)
      const result = await client.messageMove(String(message.uid), target.path, { uid: true })
      const mapped = result && typeof result === 'object' ? result.uidMap?.get(message.uid) : undefined
      const newUid = Number(mapped ?? message.uid)
      this.ctx.messages.move(messageId, target.id, newUid)
      this.ctx.folders.recomputeCounts(folder.id)
      this.ctx.folders.recomputeCounts(target.id)
    })
    this.ctx.emit({
      type: 'messages',
      accountId: this.account.id,
      folderIds: [folder.id, target.id]
    })
  }

  /** Безвозвратное удаление письма (из корзины или при отсутствии корзины). */
  async deleteForever(messageId: string): Promise<void> {
    const message = this.ctx.messages.get(messageId)
    if (!message) return
    const folder = this.ctx.folders.get(message.folderId)
    if (!folder) return
    await this.enqueue(async () => {
      const client = this.client
      if (!client?.usable) throw new Error('Нет соединения')
      await this.open(folder.path)
      await client.messageDelete(String(message.uid), { uid: true })
      this.ctx.messages.remove(messageId)
      this.ctx.folders.recomputeCounts(folder.id)
    })
    this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [folder.id] })
  }

  async send(draft: DraftPayload): Promise<SendResult> {    const prepared = await buildRawMessage(this.account, draft)
    const result = await sendPrepared(this.account, prepared)
    if (!result.ok) {
      this.ctx.outbox.enqueue(this.account.id, JSON.stringify(draft))
      return { ok: false, error: result.error }
    }
    try {
      await this.appendToSent(prepared.raw)
    } catch (error) {
      log.warn('Не удалось сохранить копию в «Отправленные»', (error as Error).message)
      this.queueOp('append', {
        accountId: this.account.id,
        folderPath: 'sent',
        content: prepared.raw.toString('base64')
      })
    }
    return result
  }

  private async appendToSent(raw: Buffer): Promise<void> {
    const sent = this.ctx.folders.list(this.account.id).find((folder) => folder.role === 'sent')
    if (!sent) return
    await this.enqueue(async () => {
      const client = this.client
      if (!client?.usable) throw new Error('Нет соединения')
      await client.append(sent.path, raw, ['\\Seen'])
      this.ctx.folders.recomputeCounts(sent.id)
      this.ctx.emit({ type: 'messages', accountId: this.account.id, folderIds: [sent.id] })
    })
  }

  private queueOp(kind: string, payload: Record<string, unknown>): void {
    this.ctx.db.run(
      `INSERT INTO pending_ops (id, account_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      this.account.id,
      kind,
      JSON.stringify(payload),
      Date.now()
    )
  }

  private async replayPendingOps(): Promise<void> {
    const ops = this.ctx.db.all<{ id: string; kind: string; payload: string }>(
      "SELECT id, kind, payload FROM pending_ops WHERE account_id = ? AND attempts < 5 ORDER BY created_at",
      this.account.id
    )
    for (const op of ops) {
      try {
        const payload = JSON.parse(op.payload) as Record<string, unknown>
        if (op.kind === 'flags') {
          await this.setFlags(payload.messageId as string, payload.flags as MessageFlags)
        } else if (op.kind === 'append') {
          await this.appendToSent(Buffer.from(payload.content as string, 'base64'))
        }
        this.ctx.db.run('DELETE FROM pending_ops WHERE id = ?', op.id)
      } catch (error) {
        log.debug('Не удалось повторить отложенную операцию', (error as Error).message)
        this.ctx.db.run('UPDATE pending_ops SET attempts = attempts + 1 WHERE id = ?', op.id)
      }
    }
  }
}

function toUpsert(
  account: Account,
  folder: Folder,
  uid: number,
  data: {
    subject: string
    from: Array<{ name: string; email: string }>
    to: Array<{ name: string; email: string }>
    cc: Array<{ name: string; email: string }>
    messageId: string | null
    date: number
    size: number
    flags: number
    modseq: number | null
    hasAttachments: boolean
  }
): MessageUpsert {
  return {
    accountId: account.id,
    folderId: folder.id,
    uid,
    modseq: data.modseq,
    messageId: data.messageId,
    subject: data.subject,
    from: data.from,
    to: data.to,
    cc: data.cc,
    date: data.date,
    size: data.size,
    flags: data.flags,
    hasAttachments: data.hasAttachments,
    threadKey: data.messageId ? data.messageId.replace(/[<>]/g, '') : null
  }
}

function bodyHasAttachments(structure: unknown): boolean {
  if (!structure || typeof structure !== 'object') return false
  const node = structure as {
    disposition?: string
    childNodes?: unknown[]
    type?: string
  }
  if (node.disposition?.toLowerCase() === 'attachment') return true
  if (Array.isArray(node.childNodes)) {
    return node.childNodes.some((child) => bodyHasAttachments(child))
  }
  return false
}
