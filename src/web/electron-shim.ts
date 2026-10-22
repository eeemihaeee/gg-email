/**
 * Минимальная реализация Electron API для веб-режима.
 * Позволяет переиспользовать весь код main-процесса в обычном Node.js:
 * вместо DPAPI используется AES-256-GCM с ключом в профиле пользователя,
 * вместо shell — запуск программ Windows, вместо IPC — HTTP-транспорт.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import pkg from '../../package.json'

const dataDir =
  process.env.GGEMAIL_USER_DATA ??
  process.env.GGEMAIL_USER_DATA ??
  join(process.env.APPDATA ?? process.cwd(), 'GG Email')

mkdirSync(dataDir, { recursive: true })

const keyFile = join(dataDir, 'web-secret.key')

function encryptionKey(): Buffer {
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 })
  }
  return readFileSync(keyFile)
}

export const app = {
  getPath: (_name?: string): string => dataDir,
  getName: (): string => 'GG Email',
  getVersion: (): string => pkg.version,
  isPackaged: false,
  setPath: (): void => undefined,
  setName: (): void => undefined,
  whenReady: async (): Promise<void> => undefined,
  on: (): void => undefined,
  once: (): void => undefined,
  quit: (): void => undefined,
  exit: (): void => undefined,
  requestSingleInstanceLock: (): boolean => true,
  disableHardwareAcceleration: (): void => undefined,
  setAppUserModelId: (): void => undefined
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (value: string): Buffer => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  },
  decryptString: (payload: Buffer): string => {
    try {
      const iv = payload.subarray(0, 12)
      const tag = payload.subarray(12, 28)
      const data = payload.subarray(28)
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    } catch {
      // Файл мог быть создан до включения шифрования.
      return payload.toString('utf8')
    }
  }
}

function launch(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch {
    /* запуск внешних программ в веб-режиме не критичен */
  }
}

export const shell = {
  openPath: async (path: string): Promise<string> => {
    if (process.platform === 'win32') launch('explorer.exe', [path])
    else launch('xdg-open', [path])
    return ''
  },
  openExternal: async (url: string): Promise<void> => {
    if (process.platform === 'win32') launch('rundll32.exe', ['url.dll,FileProtocolHandler', url])
    else launch('xdg-open', [url])
  }
}

export class BrowserWindow {
  static fromWebContents(): null {
    return null
  }

  static getAllWindows(): BrowserWindow[] {
    return []
  }
}

export const dialog = {
  showSaveDialog: async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true })
}

export const ipcMain = {
  handle: (): void => undefined,
  on: (): void => undefined
}

export const nativeTheme = {
  themeSource: 'system' as const
}

export default { app, safeStorage, shell, BrowserWindow, dialog, ipcMain, nativeTheme }
