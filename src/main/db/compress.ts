import { gzipSync, gunzipSync } from 'node:zlib'

/**
 * Тела писем сжимаются перед записью в SQLite: HTML-письма сжимаются в 4–8 раз,
 * что напрямую уменьшает размер кеша (одна из главных претензий к Thunderbird).
 */
export function compressText(value: string | null | undefined): Uint8Array | null {
  if (!value) return null
  return gzipSync(Buffer.from(value, 'utf8'), { level: 6 })
}

export function decompressText(value: unknown): string {
  if (!value) return ''
  try {
    const buffer = Buffer.isBuffer(value)
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value)
        : Buffer.from(value as ArrayBuffer)
    return gunzipSync(buffer).toString('utf8')
  } catch {
    // На случай повреждённой записи не роняем список писем.
    return ''
  }
}
