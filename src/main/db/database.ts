import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION, MIGRATIONS } from './schema'
import { createLogger } from '../logger'

const log = createLogger('db')

export type Row = Record<string, unknown>

/**
 * Тонкая обёртка над встроенным в Node (и Electron) модулем node:sqlite.
 * Не требует нативной сборки — это важно для обновлений без переустановки
 * и для совместимости с будущими версиями Electron.
 */
export class Database {
  private db: DatabaseSync
  private txDepth = 0
  /** Доступен ли FTS5 в данной сборке SQLite. */
  readonly fts5: boolean
  readonly file: string

  constructor(file: string) {
    this.file = file
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA synchronous = NORMAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.db.exec('PRAGMA wal_autocheckpoint = 1000;')
    this.fts5 = this.detectFts5()
    this.migrate()
  }

  private detectFts5(): boolean {
    try {
      this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts_probe USING fts5(x);')
      this.db.exec('DROP TABLE IF EXISTS __fts_probe;')
      log.info('FTS5 доступен')
      return true
    } catch (error) {
      log.warn('FTS5 недоступен, поиск будет по префиксам', error)
      return false
    }
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    const current = row?.user_version ?? 0
    if (current >= SCHEMA_VERSION) {
      this.ensureSearchIndex()
      return
    }
    for (let version = current; version < SCHEMA_VERSION; version += 1) {
      const sql = MIGRATIONS[version]
      this.transaction(() => {
        this.db.exec(sql)
        this.db.exec(`PRAGMA user_version = ${version + 1}`)
      })
      log.info(`Схема обновлена до версии ${version + 1}`)
    }
    this.ensureSearchIndex()
  }

  private ensureSearchIndex(): void {
    if (!this.fts5) return
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        message_id UNINDEXED,
        subject,
        from_text,
        to_text,
        body_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  all<T = Row>(sql: string, ...params: Array<string | number | null | Uint8Array>): T[] {
    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as T[]
  }

  get<T = Row>(sql: string, ...params: Array<string | number | null | Uint8Array>): T | undefined {
    const stmt = this.db.prepare(sql)
    return stmt.get(...params) as T | undefined
  }

  run(
    sql: string,
    ...params: Array<string | number | null | Uint8Array>
  ): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0)
    }
  }

  /** Вложенные транзакции реализованы через SAVEPOINT. */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.txDepth}`
    if (this.txDepth === 0) this.db.exec('BEGIN IMMEDIATE;')
    else this.db.exec(`SAVEPOINT ${savepoint};`)
    this.txDepth += 1
    try {
      const result = fn()
      this.txDepth -= 1
      if (this.txDepth === 0) this.db.exec('COMMIT;')
      else this.db.exec(`RELEASE ${savepoint};`)
      return result
    } catch (error) {
      this.txDepth -= 1
      if (this.txDepth === 0) this.db.exec('ROLLBACK;')
      else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint};`)
      throw error
    }
  }

  /** Оптимизация и сжатие БД (VACUUM нельзя выполнять в транзакции). */
  compact(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    this.db.exec('VACUUM;')
  }

  close(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    } catch {
      /* ignore */
    }
    this.db.close()
  }
}
