import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

const dataDir = mkdtempSync(join(tmpdir(), 'kurier-test-'))
process.env.GGEMAIL_USER_DATA = dataDir

// Минимальная замена Electron API, чтобы main-модули можно было тестировать в Node.
vi.mock('electron', () => ({
  app: {
    getPath: () => dataDir,
    getName: () => 'GG Email',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    setPath: () => undefined
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => undefined
  },
  BrowserWindow: class {
    static fromWebContents(): null {
      return null
    }
  },
  ipcMain: { handle: () => undefined },
  dialog: { showSaveDialog: async () => ({ canceled: true }) }
}))
