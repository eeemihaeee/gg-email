import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { safeStorage } from 'electron'
import { paths } from './paths'
import { createLogger } from './logger'
import type { AccountSecret, AuthKind } from '@shared/types'

const log = createLogger('secrets')

type SecretFile = Record<string, AccountSecret>

let cache: SecretFile | null = null

function load(): SecretFile {
  if (cache) return cache
  try {
    if (!existsSync(paths.secrets)) {
      cache = {}
      return cache
    }
    const raw = readFileSync(paths.secrets)
    let json: string
    if (safeStorage.isEncryptionAvailable()) {
      try {
        json = safeStorage.decryptString(raw)
      } catch {
        // Файл мог быть записан без шифрования (смена политики ОС).
        json = raw.toString('utf8')
      }
    } else {
      json = raw.toString('utf8')
    }
    cache = JSON.parse(json) as SecretFile
    return cache
  } catch (error) {
    log.error('Не удалось прочитать хранилище секретов', error)
    cache = {}
    return cache
  }
}

function persist(data: SecretFile): void {
  const json = JSON.stringify(data)
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  const tmp = `${paths.secrets}.tmp`
  writeFileSync(tmp, payload, { mode: 0o600 })
  renameSync(tmp, paths.secrets)
}

/**
 * Пароли и refresh-токены хранятся в отдельном файле, зашифрованном DPAPI
 * (Windows) через Electron safeStorage. В SQLite секретов нет.
 */
export const secrets = {
  get(accountId: string): string | undefined {
    return load()[accountId]?.value
  },

  kind(accountId: string): AuthKind | undefined {
    return load()[accountId]?.kind
  },

  set(accountId: string, value: string, kind: AuthKind): void {
    const data = load()
    data[accountId] = { value, kind, updatedAt: Date.now() }
    persist(data)
  },

  remove(accountId: string): void {
    const data = load()
    if (!(accountId in data)) return
    delete data[accountId]
    persist(data)
  },

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }
}
