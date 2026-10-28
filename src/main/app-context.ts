import { app, BrowserWindow, shell } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, CacheStats, PolicyState, SyncStatus } from '@shared/types'
import { policyValue } from '@shared/policy'
import { EVENTS, type ToastEvent, type ChangesEvent } from '@shared/ipc'
import { Database } from './db/database'
import {
  AccountsRepo,
  FoldersRepo,
  MessagesRepo,
  OutboxRepo,
  SettingsRepo
} from './db/repos'
import { paths } from './paths'
import { createLogger } from './logger'
import { AccountSyncer, type SyncEvent } from './mail/sync'
import { UpdateService } from './updater'
import { refreshPolicy } from './policy'

const log = createLogger('app')

export class AppContext {
  readonly db: Database
  readonly accounts: AccountsRepo
  readonly folders: FoldersRepo
  readonly messages: MessagesRepo
  readonly outbox: OutboxRepo
  readonly settings: SettingsRepo
  readonly syncers = new Map<string, AccountSyncer>()
  policy: PolicyState
  updater: UpdateService

  private window: BrowserWindow | null = null
  private timers: NodeJS.Timeout[] = []

  constructor(policy: PolicyState) {
    this.policy = policy
    this.db = new Database(paths.db)
    this.accounts = new AccountsRepo(this.db)
    this.folders = new FoldersRepo(this.db)
    this.messages = new MessagesRepo(this.db, this.db.fts5)
    this.outbox = new OutboxRepo(this.db)
    this.settings = new SettingsRepo(this.db)
    // Фирменные цвета для известных провайдеров (точка у ящика).
    for (const account of this.accounts.list()) {
      const domain = account.email.split('@')[1]?.toLowerCase() ?? ''
      const brand =
        domain === 'gmail.com' || domain === 'googlemail.com'
          ? '#ea4335'
          : domain.startsWith('yandex.') || domain === 'ya.ru'
            ? '#fc3f1d'
            : ['mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'internet.ru'].includes(domain)
              ? '#005ff9'
              : undefined
      if (brand && account.color !== brand) this.accounts.update(account.id, { color: brand })
    }

    this.updater = new UpdateService(
      policy,
      (state) => this.broadcast(EVENTS.updaterState, state),
      {
        get: (key) => this.settings.get<number>(key, 0),
        set: (key, value) => this.settings.set(key, value)
      }
    )
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  broadcast(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  toast(toast: ToastEvent): void {
    this.broadcast(EVENTS.toast, toast)
  }

  private onSyncEvent = (event: SyncEvent): void => {
    switch (event.type) {
      case 'status':
        this.broadcast(EVENTS.syncStatus, event.status)
        break
      case 'messages':
        this.broadcast(EVENTS.messagesChanged, {
          accountId: event.accountId,
          folderIds: event.folderIds
        } satisfies ChangesEvent)
        break
      case 'folders':
        this.broadcast(EVENTS.foldersChanged, { accountId: event.accountId })
        break
      case 'error':
        this.toast({ kind: 'error', message: event.error })
        break
    }
  }

  private createSyncer(account: Account): AccountSyncer {
    return new AccountSyncer(account, {
      db: this.db,
      accounts: this.accounts,
      folders: this.folders,
      messages: this.messages,
      outbox: this.outbox,
      emit: this.onSyncEvent
    })
  }

  async startAccount(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId)
    if (!account || account.disabled) return
    if (this.syncers.has(accountId)) return
    const syncer = this.createSyncer(account)
    this.syncers.set(accountId, syncer)
    try {
      await syncer.start()
    } catch (error) {
      log.error(`Не удалось запустить синхронизацию ${account.email}`, error)
      this.broadcast(EVENTS.syncStatus, {
        accountId,
        phase: 'error',
        error: (error as Error).message
      } satisfies SyncStatus)
    }
  }

  async stopAccount(accountId: string): Promise<void> {
    const syncer = this.syncers.get(accountId)
    this.syncers.delete(accountId)
    await syncer?.stop()
  }

  async restartAccount(accountId: string): Promise<void> {
    await this.stopAccount(accountId)
    await this.startAccount(accountId)
  }

  async startAll(): Promise<void> {
    for (const account of this.accounts.list()) {
      if (!account.disabled) await this.startAccount(account.id)
    }
  }

  async stopAll(): Promise<void> {
    for (const accountId of Array.from(this.syncers.keys())) {
      await this.stopAccount(accountId)
    }
  }

  syncer(accountId: string): AccountSyncer | undefined {
    return this.syncers.get(accountId)
  }

  async syncAll(): Promise<void> {
    for (const accountId of this.syncers.keys()) {
      const syncer = this.syncers.get(accountId)
      if (syncer) await syncer.syncAll('manual')
    }
  }

  async handlePolicyChange(policy: PolicyState): Promise<void> {
    this.policy = policy
    this.updater.applyPolicy(policy)
    this.startBackgroundJobs()
    this.broadcast(EVENTS.policyChanged, policy)
  }

  /**
   * Фоновые задачи: резервная синхронизация по интервалу из политики и
   * обслуживание кеша (срок хранения + лимит размера).
   */
  startBackgroundJobs(): void {
    this.stopBackgroundJobs()
    const syncMinutes = Math.max(
      1,
      Number(policyValue<number>(this.policy, 'syncIntervalMinutes', 5))
    )
    const syncTimer = setInterval(() => {
      void this.syncAll()
    }, syncMinutes * 60_000)
    syncTimer.unref?.()

    const maintenanceTimer = setInterval(() => this.runMaintenance(), 30 * 60_000)
    maintenanceTimer.unref?.()

    this.timers.push(syncTimer, maintenanceTimer)
    this.runMaintenance()
  }

  stopBackgroundJobs(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  runMaintenance(): void {
    try {
      const retentionDays = Math.max(
        1,
        Number(policyValue<number>(this.policy, 'cacheRetentionDays', 365))
      )
      this.messages.evictBodies(Date.now() - retentionDays * 86_400_000)

      const maxMb = Math.max(256, Number(policyValue<number>(this.policy, 'maxCacheSizeMb', 4096)))
      const limitBytes = maxMb * 1024 * 1024
      if (this.messages.bodyBytes() > limitBytes) {
        const evicted = this.messages.evictOldestBodies(Math.floor(limitBytes * 0.9))
        log.info(`Кеш превысил ${maxMb} МБ, вытеснено тел писем: ${evicted}`)
      }
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE);')
    } catch (error) {
      log.warn('Обслуживание кеша не удалось', error)
    }
  }

  async applyPolicyFromRegistry(): Promise<void> {
    const next = await refreshPolicy()
    await this.handlePolicyChange(next)
  }


  cacheStats(): CacheStats {
    const dbBytes = statSync(paths.db).size
    const attachmentsBytes = directorySize(paths.attachments)
    const bodyBytes = this.messages.bodyBytes()
    const messages = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')?.n ?? 0
    const accounts = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts')?.n ?? 0
    const oldest = this.db.get<{ at: number | null }>(
      'SELECT MIN(body_fetched_at) AS at FROM messages WHERE body_state = 1'
    )
    return {
      dbBytes,
      bodyBytes,
      attachmentsBytes,
      totalBytes: dbBytes + attachmentsBytes,
      messages,
      accounts,
      oldestBodyAt: oldest?.at ?? null
    }
  }

  /** Удаляет тела писем и сжимает базу, не трогая заголовки и аккаунты. */
  clearBodies(): number {
    const removed = this.messages.evictAllBodies()
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
    this.toast({
      kind: 'success',
      message: `Тела писем удалены (${removed}), база сжата. Заголовки и аккаунты сохранены.`
    })
    return removed
  }
  async openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Разрешены только http(s)-ссылки')
    await shell.openExternal(url)
  }

  /** Полный сброс кеша: письма и вложения. Аккаунты и настройки сохраняются. */
  async clearCache(): Promise<void> {
    await this.stopAll()
    this.db.transaction(() => {
      this.db.run('DELETE FROM messages')
      this.db.run('DELETE FROM attachments')
      this.db.run('DELETE FROM pending_ops')
      if (this.db.fts5) this.db.run('DELETE FROM message_fts')
      this.db.run('UPDATE folders SET uid_next = NULL, uid_validity = NULL, highest_modseq = NULL, total = 0, unread = 0, last_sync_at = NULL')
    })
    this.db.compact()
    const { rm } = await import('node:fs/promises')
    await rm(paths.attachments, { recursive: true, force: true })
    await this.startAll()
    this.toast({ kind: 'success', message: 'Кеш очищен, письма загружаются заново' })
  }

  close(): void {
    this.stopBackgroundJobs()
    this.db.close()
  }

  static async create(): Promise<AppContext> {
    const policy = await refreshPolicy()
    const context = new AppContext(policy)
    log.info('Контекст приложения создан', {
      version: app.getVersion(),
      policy: policy.source,
      fts: context.db.fts5
    })
    return context
  }
}

function directorySize(path: string): number {
  try {
    let total = 0
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) total += directorySize(full)
      else total += statSync(full).size
    }
    return total
  } catch {
    return 0
  }
}