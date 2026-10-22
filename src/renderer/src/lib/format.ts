import type { Address, MessageDetail, MessageSummary } from '@shared/types'

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function formatListDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  if (sameDay) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
  }
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

export function senderLabel(from: Address[]): string {
  if (from.length === 0) return '(неизвестный отправитель)'
  const first = from[0]
  return first.name || first.email
}

export function shortAddress(address: Address): string {
  return address.name || address.email
}

export function initials(value: string): string {
  const clean = value.trim()
  if (!clean) return '?'
  const parts = clean.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function colorFor(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i += 1) hash = (hash * 31 + email.charCodeAt(i)) | 0
  const palette = ['#2f6fed', '#0f9d58', '#c5221f', '#f29900', '#7b1fa2', '#00838f', '#5f6368']
  return palette[Math.abs(hash) % palette.length]
}

export function quoteText(message: MessageDetail): string {
  const header = `${senderLabel(message.from)} <${message.from[0]?.email ?? ''}> писал(а) ${formatFullDate(message.date)}:`
  const body = message.textBody
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `\n\n${header}\n${body}`
}

export function replySubject(subject: string, prefix = 'Re'): string {
  const clean = subject.replace(/^((re|fw|fwd|ответ|пересл)\s*:\s*)+/i, '')
  return `${prefix}: ${clean}`
}

export function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

export function matchesSearch(message: MessageSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    message.subject.toLowerCase().includes(needle) ||
    message.from.some((address) =>
      `${address.name} ${address.email}`.toLowerCase().includes(needle)
    ) ||
    message.snippet.toLowerCase().includes(needle)
  )
}
