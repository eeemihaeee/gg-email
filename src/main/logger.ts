import log from 'electron-log/main'
import type { LogLevel } from '@shared/types'

let currentLevel: LogLevel = 'warn'

const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

export function configureLogger(level: LogLevel, logDir?: string): void {
  currentLevel = LEVELS.includes(level) ? level : 'warn'
  log.transports.file.level = currentLevel
  log.transports.console.level = currentLevel
  if (logDir) log.transports.file.resolvePathFn = () => `${logDir}/kurier.log`
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.errorHandler.startCatching({ showDialog: false })
}

/** Маскирует потенциально чувствительные значения перед записью в лог. */
export function redact(value: string): string {
  return value
    .replace(/(password|passwd|pass|token|secret|authorization)([=:]\s*)\S+/gi, '$1$2***')
    .replace(/([A-Za-z0-9+/=]{40,})/g, '***')
}

function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const text = meta === undefined ? message : `${message} ${safeJson(meta)}`
  log[level](`[${scope}] ${redact(text)}`)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

export interface Logger {
  error(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  debug(message: string, meta?: unknown): void
}

export function createLogger(scope: string): Logger {
  return {
    error: (message, meta) => write('error', scope, message, meta),
    warn: (message, meta) => write('warn', scope, message, meta),
    info: (message, meta) => write('info', scope, message, meta),
    debug: (message, meta) => write('debug', scope, message, meta)
  }
}

export { log }
