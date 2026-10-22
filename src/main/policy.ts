import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPolicyState, POLICY_ROOT_KEY } from '@shared/policy'
import type { PolicyState } from '@shared/types'
import { createLogger } from './logger'

const log = createLogger('policy')

interface RegistryEntry {
  type: string
  value: string
}

const REG_LINE = /^\s{2,}(.+?)\s{4,}(REG_[A-Z_]+)\s{4,}(.*)$/

function regExe(): string {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  return join(root, 'System32', 'reg.exe')
}

function decodeOem(buffer: Buffer): string {
  // reg.exe пишет в кодировке консоли (cp866 в русской Windows).
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('ibm866').decode(buffer)
    } catch {
      return buffer.toString('latin1')
    }
  }
}

function queryKey(hive: 'HKLM' | 'HKCU'): Promise<Record<string, RegistryEntry>> {
  return new Promise((resolve) => {
    execFile(
      regExe(),
      ['query', `${hive}\\${POLICY_ROOT_KEY}`, '/s'],
      { windowsHide: true, timeout: 10_000, encoding: 'buffer' },
      (error, stdout) => {
        if (error || !stdout) {
          resolve({})
          return
        }
        const text = decodeOem(stdout as unknown as Buffer)
        const entries: Record<string, RegistryEntry> = {}
        let lastValue: string | null = null
        for (const line of text.split(/\r?\n/)) {
          if (/^\s*$/.test(line)) continue
          if (/^\S/.test(line) && !/^\s/.test(line)) {
            // строка ключа реестра — сбрасываем «текущее значение»
            lastValue = null
            continue
          }
          const match = line.match(REG_LINE)
          if (match) {
            const [, name, type, value] = match
            entries[name.trim()] = { type, value }
            lastValue = name.trim()
            continue
          }
          // Продолжение REG_MULTI_SZ или длинного значения.
          if (lastValue && /^\s{4,}/.test(line)) {
            entries[lastValue].value += `\n${line.trim()}`
          }
        }
        resolve(entries)
      }
    )
  })
}

function parseEntry(entry: RegistryEntry): unknown {
  switch (entry.type) {
    case 'REG_DWORD': {
      const raw = entry.value.trim()
      return raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw)
    }
    case 'REG_QWORD': {
      const raw = entry.value.trim()
      return raw.startsWith('0x') ? parseInt(raw, 16) : Number(raw)
    }
    case 'REG_MULTI_SZ':
      return entry.value.split(/\\0|\n/).map((item) => item.trim()).filter(Boolean)
    case 'REG_BINARY':
      return undefined
    case 'REG_SZ':
    case 'REG_EXPAND_SZ':
    default:
      return entry.value
  }
}

function readRegistry(): Promise<{ values: Record<string, unknown>; source: PolicyState['source'] }> {
  return Promise.all([queryKey('HKLM'), queryKey('HKCU')]).then(([machine, user]) => {
    const values: Record<string, unknown> = {}
    let source: PolicyState['source'] = 'none'
    // Машинная политика имеет приоритет над пользовательской.
    for (const [name, entry] of Object.entries(user)) {
      const parsed = parseEntry(entry)
      if (parsed !== undefined) {
        values[name] = parsed
        source = 'registry-user'
      }
    }
    for (const [name, entry] of Object.entries(machine)) {
      const parsed = parseEntry(entry)
      if (parsed !== undefined) {
        values[name] = parsed
        source = 'registry-machine'
      }
    }
    return { values, source }
  })
}

function readFileSource(file: string): { values: Record<string, unknown>; source: PolicyState['source'] } {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const values = (parsed.values ?? parsed) as Record<string, unknown>
    return { values, source: 'file' }
  } catch (error) {
    log.error(`Не удалось прочитать файл политик ${file}`, error)
    return { values: {}, source: 'none' }
  }
}

/** Приводит имена реестра (AutoconfigUrl) к ключам модели (autoconfigUrl). */
function normalizeKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const camel = key.charAt(0).toLowerCase() + key.slice(1)
    result[camel] = value
  }
  return result
}

export async function loadPolicy(): Promise<PolicyState> {
  const fileOverride = process.env.GGEMAIL_POLICY_FILE
  if (fileOverride && existsSync(fileOverride)) {
    const { values, source } = readFileSource(fileOverride)
    return buildPolicyState(normalizeKeys(values), source)
  }
  const { values, source } = await readRegistry()
  const state = buildPolicyState(normalizeKeys(values), source)
  if (state.errors.length > 0) log.warn('Ошибки политик', state.errors)
  return state
}

let cache: PolicyState | null = null
let listeners: Array<(state: PolicyState) => void> = []

export function cachedPolicy(): PolicyState {
  return cache ?? buildPolicyState({}, 'none')
}

export async function refreshPolicy(): Promise<PolicyState> {
  const next = await loadPolicy()
  const changed = JSON.stringify(next.values) !== JSON.stringify(cache?.values)
  cache = next
  if (changed) {
    for (const listener of listeners) {
      try {
        listener(next)
      } catch (error) {
        log.error('Ошибка обработчика политик', error)
      }
    }
  }
  return next
}

export function onPolicyChanged(listener: (state: PolicyState) => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((item) => item !== listener)
  }
}

/**
 * Опрос реестра. GPO применяется при входе пользователя и по расписанию,
 * поэтому клиент проверяет изменения раз в 2 минуты, не нагружая систему.
 */
export function startPolicyWatcher(intervalMs = 120_000): () => void {
  void refreshPolicy()
  const timer = setInterval(() => {
    void refreshPolicy()
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
