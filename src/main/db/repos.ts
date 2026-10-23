import { createHash, randomUUID } from 'node:crypto'
import type { Database } from './database'
import { compressText, decompressText } from './compress'
import type {
  Account,
  AccountInput,
  Address,
  AttachmentMeta,
  Folder,
  FolderRole,
  MessageDetail,
  MessageFlags,
  MessagePage,
  MessageQuery,
  MessageSummary,
  SecurityMode
} from '@shared/types'

export const FLAG = {
  seen: 1,
  answered: 2,
  flagged: 4,
  deleted: 8,
  draft: 16,
  forwarded: 32
} as const

export function flagsToMask(flags: Partial<MessageFlags>): number {
  let mask = 0
  if (flags.seen) mask |= FLAG.seen
  if (flags.answered) mask |= FLAG.answered
  if (flags.flagged) mask |= FLAG.flagged
  if (flags.deleted) mask |= FLAG.deleted
  if (flags.draft) mask |= FLAG.draft
  if (flags.forwarded) mask |= FLAG.forwarded
  return mask
}

export function maskToFlags(mask: number): MessageFlags {
  return {
    seen: (mask & FLAG.seen) !== 0,
    answered: (mask & FLAG.answered) !== 0,
    flagged: (mask & FLAG.flagged) !== 0,
    deleted: (mask & FLAG.deleted) !== 0,
    draft: (mask & FLAG.draft) !== 0,
    forwarded: (mask & FLAG.forwarded) !== 0
  }
}

export function messageRowId(folderId: string, uid: number): string {
  return createHash('sha1').update(`${folderId}|${uid}`).digest('hex').slice(0, 20)
}

interface AccountRow {
  id: string
  email: string
  display_name: string
  color: string
  imap_host: string
  imap_port: number
  imap_security: string
  smtp_host: string
  smtp_port: number
  smtp_security: string
  username: string
  auth_kind: string
  oauth_provider: string | null
  sort_order: number
  disabled: number
  created_at: number
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    imap: {
      host: row.imap_host,
      port: row.imap_port,
      security: row.imap_security as SecurityMode
    },
    smtp: {
      host: row.smtp_host,
      port: row.smtp_port,
      security: row.smtp_security as SecurityMode
    },
    username: row.username,
    authKind: row.auth_kind as Account['authKind'],
    oauthProvider: (row.oauth_provider as Account['oauthProvider']) ?? undefined,
    sortOrder: row.sort_order,
    disabled: row.disabled === 1,
    createdAt: row.created_at
  }
}

export class AccountsRepo {
  constructor(private db: Database) {}

  list(): Account[] {
    return this.db
      .all<AccountRow>('SELECT * FROM accounts ORDER BY sort_order, email')
      .map(mapAccount)
  }

  get(id: string): Account | undefined {
    const row = this.db.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', id)
    return row ? mapAccount(row) : undefined
  }

  findByEmail(email: string): Account | undefined {
    const row = this.db.get<AccountRow>(
      'SELECT * FROM accounts WHERE lower(email) = lower(?)',
      email
    )
    return row ? mapAccount(row) : undefined
  }

  add(input: AccountInput): Account {
    const id = randomUUID()
    const now = Date.now()
    const order = (this.db.get<{ max: number }>('SELECT COALESCE(MAX(sort_order), -1) AS max FROM accounts')?.max ?? -1) + 1
    this.db.run(
      `INSERT INTO accounts (id, email, display_name, color, imap_host, imap_port, imap_security,
        smtp_host, smtp_port, smtp_security, username, auth_kind, oauth_provider, sort_order, disabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id,
      input.email,
      input.displayName || input.email,
      input.color ?? '#2f6fed',
      input.imap.host,
      input.imap.port,
      input.imap.security,
      input.smtp.host,
      input.smtp.port,
      input.smtp.security,
      input.username || input.email,
      input.authKind ?? 'password',
      input.oauthProvider ?? null,
      order,
      now
    )
    const account = this.get(id)
    if (!account) throw new Error('Не удалось создать учётную запись')
    return account
  }

  update(id: string, patch: Partial<Account>): Account {
    const current = this.get(id)
    if (!current) throw new Error('Учётная запись не найдена')
    const next: Account = { ...current, ...patch }
    this.db.run(
      `UPDATE accounts SET email = ?, display_name = ?, color = ?, imap_host = ?, imap_port = ?,
        imap_security = ?, smtp_host = ?, smtp_port = ?, smtp_security = ?, username = ?,
        auth_kind = ?, oauth_provider = ?, sort_order = ?, disabled = ? WHERE id = ?`,
      next.email,
      next.displayName,
      next.color,
      next.imap.host,
      next.imap.port,
      next.imap.security,
      next.smtp.host,
      next.smtp.port,
      next.smtp.security,
      next.username,
      next.authKind,
      next.oauthProvider ?? null,
      next.sortOrder,
      next.disabled ? 1 : 0,
      id
    )
    return this.get(id)!
  }

  remove(id: string): void {
    this.db.run('DELETE FROM accounts WHERE id = ?', id)
  }
}

interface FolderRow {
  id: string
  account_id: string
  path: string
  name: string
  delimiter: string
  role: string
  uid_validity: number | null
  uid_next: number | null
  highest_modseq: number | null
  total: number
  unread: number
  last_sync_at: number | null
}

function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter,
    role: row.role as FolderRole,
    total: row.total,
    unread: row.unread,
    uidValidity: row.uid_validity,
    uidNext: row.uid_next,
    highestModseq: row.highest_modseq,
    lastSyncAt: row.last_sync_at
  }
}

export class FoldersRepo {
  constructor(private db: Database) {}

  list(accountId?: string): Folder[] {
    const rows = accountId
      ? this.db.all<FolderRow>('SELECT * FROM folders WHERE account_id = ? ORDER BY path', accountId)
      : this.db.all<FolderRow>('SELECT * FROM folders ORDER BY account_id, path')
    return rows.map(mapFolder)
  }

  get(id: string): Folder | undefined {
    const row = this.db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id)
    return row ? mapFolder(row) : undefined
  }

  findByPath(accountId: string, path: string): Folder | undefined {
    const row = this.db.get<FolderRow>(
      'SELECT * FROM folders WHERE account_id = ? AND path = ?',
      accountId,
      path
    )
    return row ? mapFolder(row) : undefined
  }

  upsert(
    accountId: string,
    path: string,
    name: string,
    delimiter: string,
    role: FolderRole
  ): Folder {
    const existing = this.findByPath(accountId, path)
    if (existing) {
      this.db.run(
        'UPDATE folders SET name = ?, delimiter = ?, role = ? WHERE id = ?',
        name,
        delimiter,
        role,
        existing.id
      )
      return { ...existing, name, delimiter, role }
    }
    const id = randomUUID()
    this.db.run(
      'INSERT INTO folders (id, account_id, path, name, delimiter, role) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      accountId,
      path,
      name,
      delimiter,
      role
    )
    return this.get(id)!
  }

  updateSyncState(
    id: string,
    state: {
      uidValidity?: number | null
      uidNext?: number | null
      highestModseq?: number | null
      total?: number
      unread?: number
      lastSyncAt?: number
    }
  ): void {
    const current = this.get(id)
    if (!current) return
    this.db.run(
      `UPDATE folders SET uid_validity = ?, uid_next = ?, highest_modseq = ?, total = ?, unread = ?, last_sync_at = ?
       WHERE id = ?`,
      state.uidValidity ?? current.uidValidity,
      state.uidNext ?? current.uidNext,
      state.highestModseq ?? current.highestModseq,
      state.total ?? current.total,
      state.unread ?? current.unread,
      state.lastSyncAt ?? current.lastSyncAt,
      id
    )
  }

  recomputeCounts(folderId: string): void {
    const row = this.db.get<{ total: number; unread: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN (flags & 1) = 0 THEN 1 ELSE 0 END), 0) AS unread
       FROM messages WHERE folder_id = ?`,
      folderId
    )
    this.db.run(
      'UPDATE folders SET total = ?, unread = ? WHERE id = ?',
      row?.total ?? 0,
      row?.unread ?? 0,
      folderId
    )
  }

  remove(id: string): void {
    this.db.run('DELETE FROM folders WHERE id = ?', id)
  }

  removeMissing(accountId: string, keepPaths: string[]): void {
    if (keepPaths.length === 0) return
    const placeholders = keepPaths.map(() => '?').join(',')
    this.db.run(
      `DELETE FROM folders WHERE account_id = ? AND path NOT IN (${placeholders})`,
      accountId,
      ...keepPaths
    )
  }
}

export interface MessageUpsert {
  accountId: string
  folderId: string
  uid: number
  modseq?: number | null
  messageId?: string | null
  subject?: string
  from?: Address[]
  to?: Address[]
  cc?: Address[]
  replyTo?: Address[]
  date: number
  internalDate?: number | null
  size?: number
  flags: number
  hasAttachments?: boolean
  snippet?: string
  threadKey?: string | null
}

interface MessageRow {
  id: string
  account_id: string
  folder_id: string
  uid: number
  modseq: number | null
  message_id: string | null
  subject: string
  from_json: string
  to_json: string
  cc_json: string
  reply_to_json: string
  date: number
  internal_date: number | null
  size: number
  flags: number
  has_attachments: number
  snippet: string
  thread_key: string | null
  body_state: number
  text_gz: Uint8Array | null
  html_gz: Uint8Array | null
  attachments_json: string
  headers_json: string
  body_fetched_at: number | null
  account_email?: string
  folder_path?: string
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    accountEmail: row.account_email ?? '',
    folderId: row.folder_id,
    folderPath: row.folder_path ?? '',
    uid: row.uid,
    messageId: row.message_id,
    subject: row.subject || '(без темы)',
    from: parseJson<Address[]>(row.from_json, []),
    to: parseJson<Address[]>(row.to_json, []),
    date: row.date,
    size: row.size,
    flags: maskToFlags(row.flags),
    hasAttachments: row.has_attachments === 1,
    snippet: row.snippet,
    threadKey: row.thread_key
  }
}

export interface MessageBody {
  text: string
  html: string | null
  attachments: AttachmentMeta[]
  headers: Record<string, string>
}

export class MessagesRepo {
  constructor(
    private db: Database,
    private fts5: boolean
  ) {}

  upsertMany(rows: MessageUpsert[]): number {
    if (rows.length === 0) return 0
    return this.db.transaction(() => {
      let written = 0
      for (const row of rows) {
        const id = messageRowId(row.folderId, row.uid)
        const result = this.db.run(
          `INSERT INTO messages (id, account_id, folder_id, uid, modseq, message_id, subject,
            from_json, to_json, cc_json, reply_to_json, date, internal_date, size, flags,
            has_attachments, snippet, thread_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             modseq = excluded.modseq,
             flags = excluded.flags,
             subject = CASE WHEN excluded.subject <> '' THEN excluded.subject ELSE messages.subject END,
             has_attachments = excluded.has_attachments`,
          id,
          row.accountId,
          row.folderId,
          row.uid,
          row.modseq ?? null,
          row.messageId ?? null,
          row.subject ?? '',
          JSON.stringify(row.from ?? []),
          JSON.stringify(row.to ?? []),
          JSON.stringify(row.cc ?? []),
          JSON.stringify(row.replyTo ?? []),
          row.date,
          row.internalDate ?? null,
          row.size ?? 0,
          row.flags,
          row.hasAttachments ? 1 : 0,
          row.snippet ?? '',
          row.threadKey ?? null
        )
        written += result.changes
        if (this.fts5) {
          this.indexMessage(id, row.subject ?? '', row.from ?? [], row.to ?? [], row.snippet ?? '')
        }
      }
      return written
    })
  }

  private indexMessage(
    id: string,
    subject: string,
    from: Address[],
    to: Address[],
    body: string
  ): void {
    if (!this.fts5) return
    this.db.run('DELETE FROM message_fts WHERE message_id = ?', id)
    this.db.run(
      'INSERT INTO message_fts (message_id, subject, from_text, to_text, body_text) VALUES (?, ?, ?, ?, ?)',
      id,
      subject,
      from.map((a) => `${a.name} ${a.email}`).join(' '),
      to.map((a) => `${a.name} ${a.email}`).join(' '),
      body
    )
  }

  private searchClause(query: string): { sql: string; params: string[] } | null {
    const tokens = query
      .replace(/["'*^:()]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 8)
    if (tokens.length === 0) return null
    if (!this.fts5) {
      return {
        sql: `(m.subject LIKE ? OR m.from_json LIKE ? OR m.snippet LIKE ?)`,
        params: [`%${tokens.join(' ')}%`, `%${tokens.join(' ')}%`, `%${tokens.join(' ')}%`]
      }
    }
    const expression = tokens.map((token) => `"${token}"*`).join(' AND ')
    return {
      sql: `m.id IN (SELECT message_id FROM message_fts WHERE message_fts MATCH ?)`,
      params: [expression]
    }
  }

  list(query: MessageQuery): MessagePage {
    const where: string[] = []
    const params: Array<string | number> = []

    if (query.accountId) {
      where.push('m.account_id = ?')
      params.push(query.accountId)
    }
    if (query.folderId) {
      where.push('m.folder_id = ?')
      params.push(query.folderId)
    }
    if (query.role) {
      where.push('f.role = ?')
      params.push(query.role)
    }
    if (query.unreadOnly) where.push('(m.flags & 1) = 0')
    if (query.flaggedOnly) where.push('(m.flags & 4) <> 0')

    const search = query.query?.trim() ? this.searchClause(query.query) : null
    if (search) {
      where.push(search.sql)
      params.push(...search.params)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const offset = Math.max(query.offset ?? 0, 0)

    const totalRow = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM messages m JOIN folders f ON f.id = m.folder_id ${whereSql}`,
      ...params
    )

    const rows = this.db.all<MessageRow>(
      `SELECT m.*, a.email AS account_email, f.path AS folder_path
       FROM messages m
       JOIN accounts a ON a.id = m.account_id
       JOIN folders f ON f.id = m.folder_id
       ${whereSql}
       ORDER BY m.date DESC, m.uid DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    )

    const total = totalRow?.total ?? 0
    return {
      items: rows.map(mapSummary),
      total,
      hasMore: offset + rows.length < total
    }
  }

  get(id: string): MessageDetail | undefined {
    const row = this.db.get<MessageRow>(
      `SELECT m.*, a.email AS account_email, f.path AS folder_path
       FROM messages m JOIN accounts a ON a.id = m.account_id JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ?`,
      id
    )
    if (!row) return undefined
    const summary = mapSummary(row)
    const attachments = this.db.all<{
      id: string
      filename: string
      content_type: string
      size: number
      content_id: string | null
      inline: number
    }>('SELECT * FROM attachments WHERE message_id = ?', id)
    return {
      ...summary,
      cc: parseJson<Address[]>(row.cc_json, []),
      bcc: [],
      replyTo: parseJson<Address[]>(row.reply_to_json, []),
      textBody: decompressText(row.text_gz),
      htmlBody: decompressText(row.html_gz) || null,
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
        contentId: a.content_id ?? undefined,
        inline: a.inline === 1
      })),
      headers: parseJson<Record<string, string>>(row.headers_json, {}),
      bodyFetched: row.body_state === 1
    }
  }

  bodyState(id: string): number {
    return this.db.get<{ body_state: number }>('SELECT body_state FROM messages WHERE id = ?', id)?.body_state ?? -1
  }

  saveBody(
    id: string,
    folderId: string,
    body: MessageBody,
    attachments: Array<{
      id: string
      filename: string
      contentType: string
      size: number
      contentId?: string
      path?: string
      inline: boolean
    }>
  ): void {
    this.db.transaction(() => {
      const row = this.db.get<{ subject: string; from_json: string; to_json: string }>(
        'SELECT subject, from_json, to_json FROM messages WHERE id = ?',
        id
      )
      this.db.run(
        `UPDATE messages SET body_state = 1, text_gz = ?, html_gz = ?, attachments_json = ?,
         headers_json = ?, body_fetched_at = ?, has_attachments = ? WHERE id = ?`,
        compressText(body.text) as unknown as Uint8Array,
        compressText(body.html) as unknown as Uint8Array,
        JSON.stringify(body.attachments),
        JSON.stringify(body.headers),
        Date.now(),
        attachments.length > 0 ? 1 : 0,
        id
      )
      this.db.run('DELETE FROM attachments WHERE message_id = ?', id)
      for (const att of attachments) {
        this.db.run(
          'INSERT INTO attachments (id, message_id, filename, content_type, size, content_id, path, inline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          att.id,
          id,
          att.filename,
          att.contentType,
          att.size,
          att.contentId ?? null,
          att.path ?? null,
          att.inline ? 1 : 0
        )
      }
      if (this.fts5 && row) {
        this.indexMessage(
          id,
          row.subject,
          parseJson<Address[]>(row.from_json, []),
          parseJson<Address[]>(row.to_json, []),
          `${body.text}\n${stripHtml(body.html ?? '')}`.slice(0, 20000)
        )
      }
      void folderId
    })
  }

  attachment(id: string): { path: string | null; filename: string; contentType: string } | undefined {
    const row = this.db.get<{
      path: string | null
      filename: string
      content_type: string
    }>('SELECT path, filename, content_type FROM attachments WHERE id = ?', id)
    if (!row) return undefined
    return { path: row.path, filename: row.filename, contentType: row.content_type }
  }

  setFlags(id: string, flags: number): void {
    this.db.run('UPDATE messages SET flags = ? WHERE id = ?', flags, id)
  }

  setFlagsBulk(ids: string[], flags: number): void {
    this.db.transaction(() => {
      for (const id of ids) this.setFlags(id, flags)
    })
  }

  move(id: string, folderId: string, uid: number): string {
    const row = this.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)
    if (!row) throw new Error('Письмо не найдено')
    const nextId = messageRowId(folderId, uid)
    this.db.transaction(() => {
      this.db.run('UPDATE attachments SET message_id = ? WHERE message_id = ?', nextId, id)
      this.db.run('UPDATE messages SET id = ?, folder_id = ?, uid = ? WHERE id = ?', nextId, folderId, uid, id)
      if (this.fts5) {
        this.db.run('UPDATE message_fts SET message_id = ? WHERE message_id = ?', nextId, id)
      }
    })
    return nextId
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM messages WHERE id = ?', id)
      if (this.fts5) this.db.run('DELETE FROM message_fts WHERE message_id = ?', id)
    })
  }

  removeByFolder(folderId: string): void {
    this.db.transaction(() => {
      if (this.fts5) {
        this.db.run(
          'DELETE FROM message_fts WHERE message_id IN (SELECT id FROM messages WHERE folder_id = ?)',
          folderId
        )
      }
      this.db.run('DELETE FROM messages WHERE folder_id = ?', folderId)
    })
  }

  countUnread(accountId?: string): number {
    const row = accountId
      ? this.db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND (flags & 1) = 0',
          accountId
        )
      : this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE (flags & 1) = 0')
    return row?.n ?? 0
  }

  /** Удаляет тела писем старше N дней, сохраняя заголовки. */
  evictBodies(olderThanMs: number): number {
    const result = this.db.run(
      `UPDATE messages SET text_gz = NULL, html_gz = NULL, body_state = 0, body_fetched_at = NULL
       WHERE body_state = 1 AND body_fetched_at < ?`,
      olderThanMs
    )
    return result.changes
  }

  /** Удаляет все тела писем (заголовки остаются). */
  evictAllBodies(): number {
    return this.db.run(
      'UPDATE messages SET text_gz = NULL, html_gz = NULL, body_state = 0, body_fetched_at = NULL WHERE body_state = 1'
    ).changes
  }
  /** Приблизительный размер кеша тел писем в байтах. */
  bodyBytes(): number {
    const row = this.db.get<{ bytes: number }>(
      `SELECT COALESCE(SUM(LENGTH(text_gz)), 0) + COALESCE(SUM(LENGTH(html_gz)), 0) AS bytes FROM messages`
    )
    return row?.bytes ?? 0
  }

  /** Вытесняет самые старые тела писем, пока размер кеша не опустится до targetBytes. */
  evictOldestBodies(targetBytes: number): number {
    const rows = this.db.all<{ id: string; size: number }>(
      `SELECT id, COALESCE(LENGTH(text_gz), 0) + COALESCE(LENGTH(html_gz), 0) AS size
       FROM messages WHERE body_state = 1 ORDER BY COALESCE(body_fetched_at, 0) ASC`
    )
    let total = rows.reduce((sum, row) => sum + row.size, 0)
    let removed = 0
    for (const row of rows) {
      if (total <= targetBytes) break
      this.db.run(
        'UPDATE messages SET text_gz = NULL, html_gz = NULL, body_state = 0, body_fetched_at = NULL WHERE id = ?',
        row.id
      )
      total -= row.size
      removed += 1
    }
    return removed
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

export class SettingsRepo {
  constructor(private db: Database) {}

  all(): Record<string, unknown> {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  get<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  set(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value)
    )
  }
}

export interface OutboxRow {
  id: string
  account_id: string
  payload: string
  status: string
  created_at: number
  attempts: number
  last_error: string | null
  sent_at: number | null
}

export class OutboxRepo {
  constructor(private db: Database) {}

  enqueue(accountId: string, payload: string): string {
    const id = randomUUID()
    this.db.run(
      'INSERT INTO outbox (id, account_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      accountId,
      payload,
      'queued',
      Date.now()
    )
    return id
  }

  pending(accountId?: string): OutboxRow[] {
    return accountId
      ? this.db.all<OutboxRow>(
          "SELECT * FROM outbox WHERE account_id = ? AND status = 'queued' ORDER BY created_at",
          accountId
        )
      : this.db.all<OutboxRow>("SELECT * FROM outbox WHERE status = 'queued' ORDER BY created_at")
  }

  markSent(id: string): void {
    this.db.run("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?", Date.now(), id)
  }

  markFailed(id: string, error: string): void {
    this.db.run(
      "UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
      error.slice(0, 500),
      id
    )
  }

  retry(id: string): void {
    this.db.run("UPDATE outbox SET status = 'queued', attempts = attempts + 1 WHERE id = ?", id)
  }
}
