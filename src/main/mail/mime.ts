import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { simpleParser } from 'mailparser'
import type { Address } from '@shared/types'
import { paths } from '../paths'
import { createLogger } from '../logger'

const log = createLogger('mime')

export interface ParsedAttachment {
  id: string
  filename: string
  contentType: string
  size: number
  contentId?: string
  inline: boolean
  path?: string
}

export interface ParsedMessage {
  messageId: string | null
  subject: string
  from: Address[]
  to: Address[]
  cc: Address[]
  replyTo: Address[]
  date: number
  text: string
  html: string | null
  attachments: ParsedAttachment[]
  headers: Record<string, string>
}

function toAddresses(value: unknown): Address[] {
  const object = value as { value?: Array<{ name?: string; address?: string }> } | undefined
  if (!object?.value) return []
  return object.value
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name ?? '', email: item.address as string }))
}

export function sanitizeFilename(name: string, fallback = 'attachment'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

/**
 * Разбирает исходное MIME-сообщение. Вложения сразу сохраняются на диск,
 * в SQLite остаются только метаданные — кеш не раздувается.
 */
export async function parseRawMessage(source: Buffer, messageRowId: string): Promise<ParsedMessage> {
  const parsed = await simpleParser(source)
  const dir = paths.attachmentDir(messageRowId)
  await mkdir(dir, { recursive: true })

  const attachments: ParsedAttachment[] = []
  const usedNames = new Set<string>()

  for (const attachment of parsed.attachments ?? []) {
    const id = randomUUID()
    let filename = sanitizeFilename(attachment.filename ?? `attachment-${attachments.length + 1}`)
    if (usedNames.has(filename)) {
      const dot = filename.lastIndexOf('.')
      const base = dot > 0 ? filename.slice(0, dot) : filename
      const ext = dot > 0 ? filename.slice(dot) : ''
      filename = `${base}-${attachments.length + 1}${ext}`
    }
    usedNames.add(filename)
    const filePath = join(dir, filename)
    await writeFile(filePath, attachment.content)
    attachments.push({
      id,
      filename,
      contentType: attachment.contentType ?? 'application/octet-stream',
      size: attachment.content?.length ?? attachment.size ?? 0,
      contentId: attachment.cid ?? undefined,
      inline: Boolean(attachment.cid) && attachment.related === true,
      path: filePath
    })
  }

  const headers: Record<string, string> = {}
  const interesting = [
    'message-id',
    'in-reply-to',
    'references',
    'list-unsubscribe',
    'list-id',
    'reply-to',
    'return-path',
    'x-mailer',
    'authentication-results',
    'received-spf'
  ]
  for (const key of interesting) {
    const value = parsed.headers.get(key)
    if (value === undefined) continue
    headers[key] = Array.isArray(value) ? value.map(String).join(' ') : String(value)
  }

  const text = parsed.text ?? ''
  const html = typeof parsed.html === 'string' ? parsed.html : null

  log.debug('Письмо разобрано', {
    attachments: attachments.length,
    textLength: text.length,
    htmlLength: html?.length ?? 0
  })

  return {
    messageId: parsed.messageId ?? null,
    subject: parsed.subject ?? '',
    from: toAddresses(parsed.from),
    to: toAddresses(parsed.to),
    cc: toAddresses(parsed.cc),
    replyTo: toAddresses(parsed.replyTo),
    date: parsed.date?.getTime() ?? Date.now(),
    text,
    html,
    attachments,
    headers
  }
}

/** Короткий текст для превью в списке писем. */
export function makeSnippet(text: string, html: string | null, length = 180): string {
  const source = text.trim() || (html ? html.replace(/<[^>]+>/g, ' ') : '')
  const normalized = source
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, length)
}
