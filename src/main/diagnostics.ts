import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import type { AppInfo } from '@shared/types'
import type { AppContext } from './app-context'
import { paths } from './paths'

interface ZipEntry {
  name: string
  data: Buffer
}

/** CRC-32 (IEEE) для ZIP. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]!
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

/** Минимальный ZIP (без внешних зависимостей), сжатие deflate. */
function buildZip(entries: ZipEntry[]): Buffer {
  const now = new Date()
  const stamp = dosTime(now)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const checksum = crc32(entry.data)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, compressed)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + compressed.length
  }

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, ...centrals, end])
}

function tail(file: string, limit = 512 * 1024): string {
  try {
    const size = statSync(file).size
    const raw = readFileSync(file)
    return raw.subarray(Math.max(0, size - limit)).toString('utf8')
  } catch {
    return ''
  }
}

/**
 * Собирает диагностический архив: версия, платформа, политика, аккаунты
 * (без паролей), статусы синхронизации, кеш и хвост лога.
 */
export function exportDiagnostics(ctx: AppContext, appInfo: AppInfo): string {
  const logFile = join(paths.logs, 'gg-email.log')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `GG-Email-Diagnostics-${stamp}.zip`

  const entries: ZipEntry[] = [
    {
      name: 'summary.json',
      data: Buffer.from(
        JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            app: appInfo,
            platform: process.platform,
            arch: process.arch,
            node: process.versions.node,
            electron: process.versions.electron,
            policy: ctx.policy,
            cache: ctx.cacheStats(),
            accountsCount: ctx.accounts.list().length
          },
          null,
          2
        ),
        'utf8'
      )
    },
    {
      name: 'accounts.json',
      data: Buffer.from(
        JSON.stringify(
          ctx.accounts.list().map((account) => ({
            id: account.id,
            email: account.email,
            displayName: account.displayName,
            username: account.username,
            imap: account.imap,
            smtp: account.smtp,
            authKind: account.authKind,
            oauthProvider: account.oauthProvider,
            disabled: account.disabled
          })),
          null,
          2
        ),
        'utf8'
      )
    },
    {
      name: 'sync.json',
      data: Buffer.from(
        JSON.stringify(
          Array.from(ctx.syncers.values()).map((syncer) => syncer.getStatus()),
          null,
          2
        ),
        'utf8'
      )
    },
    {
      name: 'settings.json',
      data: Buffer.from(JSON.stringify(ctx.settings.all(), null, 2), 'utf8')
    },
    { name: 'logs/gg-email.log', data: Buffer.from(tail(logFile), 'utf8') }
  ]

  const archive = buildZip(entries)
  const target = join(paths.root, fileName)
  writeFileSync(target, archive)
  return target
}

export function diagnosticsFolder(): string {
  return paths.root
}

export function diagnosticsExists(path: string): boolean {
  return existsSync(path)
}
