import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let cachedRoot: string | null = null

/** Корень пользовательских данных. Переопределяется KURIER_USER_DATA для тестов. */
export function dataRoot(): string {
  if (cachedRoot) return cachedRoot
  const override = process.env.KURIER_USER_DATA
  cachedRoot = override ? override : app.getPath('userData')
  ensureDir(cachedRoot)
  return cachedRoot
}

export function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

export const paths = {
  get root(): string {
    return dataRoot()
  },
  get db(): string {
    return join(dataRoot(), 'kurier.db')
  },
  get secrets(): string {
    return join(dataRoot(), 'secrets.bin')
  },
  get settings(): string {
    return join(dataRoot(), 'settings.json')
  },
  get logs(): string {
    return ensureDir(join(dataRoot(), 'logs'))
  },
  get attachments(): string {
    return ensureDir(join(dataRoot(), 'attachments'))
  },
  get cache(): string {
    return ensureDir(join(dataRoot(), 'cache'))
  },
  attachmentDir(messageId: string): string {
    return ensureDir(join(dataRoot(), 'attachments', messageId.replace(/[^\w.-]/g, '_')))
  }
}
