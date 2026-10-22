/**
 * Схема локального кеша. Версия хранится в PRAGMA user_version.
 *
 * Принципы:
 *  - заголовки писем хранятся всегда (дёшево), тела — по требованию и сжатыми;
 *  - кеш можно удалить в любой момент: он полностью восстановим с сервера;
 *  - никаких mbox/JSON-файлов на миллионы записей — только SQLite WAL.
 */
export const SCHEMA_VERSION = 1

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT '#2f6fed',
    imap_host     TEXT NOT NULL,
    imap_port     INTEGER NOT NULL,
    imap_security TEXT NOT NULL,
    smtp_host     TEXT NOT NULL,
    smtp_port     INTEGER NOT NULL,
    smtp_security TEXT NOT NULL,
    username      TEXT NOT NULL,
    auth_kind     TEXT NOT NULL DEFAULT 'password',
    oauth_provider TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    name          TEXT NOT NULL,
    delimiter     TEXT NOT NULL DEFAULT '/',
    role          TEXT NOT NULL DEFAULT 'other',
    uid_validity  INTEGER,
    uid_next      INTEGER,
    highest_modseq INTEGER,
    total         INTEGER NOT NULL DEFAULT 0,
    unread        INTEGER NOT NULL DEFAULT 0,
    last_sync_at  INTEGER,
    UNIQUE (account_id, path)
  );
  CREATE INDEX IF NOT EXISTS idx_folders_account ON folders(account_id, role);

  CREATE TABLE IF NOT EXISTS messages (
    id             TEXT PRIMARY KEY,
    account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder_id      TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    uid            INTEGER NOT NULL,
    modseq         INTEGER,
    message_id     TEXT,
    subject        TEXT NOT NULL DEFAULT '',
    from_json      TEXT NOT NULL DEFAULT '[]',
    to_json        TEXT NOT NULL DEFAULT '[]',
    cc_json        TEXT NOT NULL DEFAULT '[]',
    reply_to_json  TEXT NOT NULL DEFAULT '[]',
    date           INTEGER NOT NULL,
    internal_date  INTEGER,
    size           INTEGER NOT NULL DEFAULT 0,
    flags          INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    snippet        TEXT NOT NULL DEFAULT '',
    thread_key     TEXT,
    body_state     INTEGER NOT NULL DEFAULT 0,
    text_gz        BLOB,
    html_gz        BLOB,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    headers_json   TEXT NOT NULL DEFAULT '{}',
    body_fetched_at INTEGER,
    UNIQUE (folder_id, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_account_date ON messages(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_key);
  CREATE INDEX IF NOT EXISTS idx_messages_messageid ON messages(message_id);

  CREATE TABLE IF NOT EXISTS attachments (
    id            TEXT PRIMARY KEY,
    message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    content_type  TEXT NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    content_id    TEXT,
    path          TEXT,
    inline        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

  CREATE TABLE IF NOT EXISTS pending_ops (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT
  );

  CREATE TABLE IF NOT EXISTS outbox (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    payload     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    created_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    sent_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    account_id  TEXT NOT NULL,
    folder_id   TEXT,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    fetched     INTEGER NOT NULL DEFAULT 0,
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
]
