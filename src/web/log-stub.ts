/** Простой файловый логгер вместо electron-log для веб-режима. */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const LEVELS = ['error', 'warn', 'info', 'debug'] as const

const fileTransport = {
  level: 'warn' as string,
  maxSize: 5 * 1024 * 1024,
  path: '',
  _resolver: null as null | (() => string),
  set resolvePathFn(fn: () => string) {
    this._resolver = fn
    this.path = fn()
  },
  get resolvePathFn(): (() => string) | null {
    return this._resolver
  }
}

function write(level: string, args: unknown[]): void {
  const order = ['error', 'warn', 'info', 'debug']
  if (order.indexOf(level) > order.indexOf(fileTransport.level)) return
  const text = args
    .map((value) => {
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    })
    .join(' ')
  const line = `[${new Date().toISOString()}] [${level}] ${text}\n`
  if (fileTransport.path) {
    try {
      mkdirSync(dirname(fileTransport.path), { recursive: true })
      appendFileSync(fileTransport.path, line)
    } catch {
      /* логгер не должен ронять приложение */
    }
  }
  if (level === 'error' || level === 'warn') process.stderr.write(line)
}

const log = {
  transports: {
    file: fileTransport,
    console: { level: 'warn' as string }
  },
  errorHandler: {
    startCatching: (): void => undefined
  },
  error: (...args: unknown[]): void => write('error', args),
  warn: (...args: unknown[]): void => write('warn', args),
  info: (...args: unknown[]): void => write('info', args),
  debug: (...args: unknown[]): void => write('debug', args),
  log: (...args: unknown[]): void => write('info', args)
}

export default log
export const transports = log.transports
export const errorHandler = log.errorHandler
void LEVELS
