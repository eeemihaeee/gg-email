import catalog from './policy-catalog.json'
import type { PolicyState, PolicyType, PolicyValue } from './types'

export interface PolicyDefinition {
  key: string
  registryName: string
  type: PolicyType
  category: string
  default: boolean | string | number
  enum?: string[]
  min?: number
  max?: number
  title: { en: string; ru: string }
  description: { en: string; ru: string }
}

export interface PolicyCatalog {
  version: number
  rootKey: string
  valuePrefix: string
  categories: Array<{ name: string; parent?: string; displayName: { en: string; ru: string } }>
  policies: PolicyDefinition[]
}

export const POLICY_CATALOG = catalog as unknown as PolicyCatalog

export const POLICY_DEFINITIONS: PolicyDefinition[] = POLICY_CATALOG.policies

export const POLICY_ROOT_KEY = POLICY_CATALOG.rootKey

export type PolicyValues = Record<string, PolicyValue>

export function defaultPolicyValues(): PolicyValues {
  const values: PolicyValues = {}
  for (const def of POLICY_DEFINITIONS) {
    if (def.type === 'multistring') {
      values[def.key] = String(def.default)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    } else {
      values[def.key] = def.default
    }
  }
  return values
}

function coerce(def: PolicyDefinition, raw: unknown): PolicyValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  switch (def.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      const text = String(raw).trim().toLowerCase()
      if (['1', 'true', 'yes', 'on'].includes(text)) return true
      if (['0', 'false', 'no', 'off'].includes(text)) return false
      return undefined
    }
    case 'number': {
      const num = Number(raw)
      if (!Number.isFinite(num)) return undefined
      const min = def.min ?? Number.MIN_SAFE_INTEGER
      const max = def.max ?? Number.MAX_SAFE_INTEGER
      return Math.min(max, Math.max(min, Math.round(num)))
    }
    case 'enum': {
      const text = String(raw).trim()
      const allowed = def.enum ?? []
      return allowed.includes(text) ? text : undefined
    }
    case 'multistring': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',')
      const normalized = list
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
      return normalized
    }
    case 'string':
    default:
      return String(raw)
  }
}

/**
 * Приводит «сырые» значения из реестра к типизированному состоянию политик.
 * Некорректные значения отбрасываются с записью в errors — клиент продолжает
 * работать на значениях по умолчанию.
 */
export function buildPolicyState(
  rawValues: Record<string, unknown>,
  source: PolicyState['source'] = 'none'
): PolicyState {
  const values = defaultPolicyValues()
  const locked: string[] = []
  const errors: string[] = []

  for (const def of POLICY_DEFINITIONS) {
    // Значения могут прийти и как AutoconfigUrl, и как autoconfigUrl.
    const raw =
      rawValues[def.key] !== undefined ? rawValues[def.key] : rawValues[def.registryName]
    if (raw === undefined) continue
    const coerced = coerce(def, raw)
    if (coerced === undefined) {
      errors.push(`Некорректное значение политики ${def.registryName}: ${String(raw)}`)
      continue
    }
    values[def.key] = coerced
    locked.push(def.key)
  }

  return {
    managed: locked.length > 0,
    source: locked.length > 0 ? source : 'none',
    values,
    locked,
    errors
  }
}

export function policyValue<T extends PolicyValue>(
  state: PolicyState,
  key: string,
  fallback: T
): T {
  const value = state.values[key]
  return (value === undefined ? fallback : value) as T
}

/** Проверяет расширение вложения по политике BlockedAttachmentExtensions. */
export function isBlockedAttachment(filename: string, blocked: PolicyValue | undefined): boolean {
  if (!Array.isArray(blocked) || blocked.length === 0) return false
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return false
  const extension = filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return blocked.map((item) => String(item).toLowerCase().replace(/^\./, '')).includes(extension)
}
