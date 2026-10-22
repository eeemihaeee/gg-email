import DOMPurify from 'dompurify'
import type { AttachmentMeta } from '@shared/types'

export interface RenderOptions {
  allowRemote: boolean
  cidMap: Record<string, string>
}

const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption', 'center', 'cite', 'code',
  'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'q',
  's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'wbr'
]

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align',
      'valign', 'style', 'class', 'target', 'rel', 'border', 'cellpadding', 'cellspacing',
      'bgcolor', 'color', 'face', 'size', 'dir', 'lang'
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'srcdoc', 'formaction'],
    KEEP_CONTENT: true
  })
}

/**
 * Готовит HTML-письмо к показу в изолированном iframe:
 *  - удаляет активный контент (DOMPurify);
 *  - подменяет cid: на внутреннюю схему kurier-att://;
 *  - блокирует внешние картинки и стили, если пользователь не разрешил;
 *  - задаёт CSP, который физически запрещает скрипты и сторонние запросы.
 */
export function buildMessageDocument(html: string, attachments: AttachmentMeta[], options: RenderOptions): string {
  const map: Record<string, string> = { ...options.cidMap }
  for (const attachment of attachments) {
    if (attachment.contentId) {
      map[attachment.contentId.replace(/^<|>$/g, '')] = `kurier-att://attachment/${attachment.id}`
    }
  }

  let sanitized = sanitizeHtml(html)
  sanitized = sanitized.replace(/(src|href)=["']cid:([^"']+)["']/gi, (_match, attr, cid) => {
    const key = decodeURIComponent(cid).replace(/^<|>$/g, '')
    const replacement = map[key] ?? map[cid] ?? ''
    return replacement ? `${attr}="${replacement}"` : `${attr}=""`
  })

  if (!options.allowRemote) {
    sanitized = sanitized
      .replace(/(<img[^>]+src=["'])https?:[^"']*(["'])/gi, '$1$2')
      .replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none')
      .replace(/@import[^;]+;/gi, '')
  }

  const imgSources = options.allowRemote ? "'self' kurier-att: data: https: http:" : 'kurier-att: data:'
  const csp = [
    "default-src 'none'",
    `img-src ${imgSources}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src 'none'",
    "script-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<base target="_blank">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #1f2328; }
  body {
    font: 14px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    padding: 18px 22px 28px;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; }
  blockquote {
    margin: 0 0 0 2px; padding-left: 12px; border-left: 3px solid #d0d7de; color: #57606a;
  }
  pre { white-space: pre-wrap; font-family: Consolas, "Courier New", monospace; font-size: 12.5px; }
  a { color: #0969da; }
  @media (prefers-color-scheme: dark) {
    html, body { background: #16191d; color: #d8dde3; }
    blockquote { border-left-color: #3a424b; color: #9aa4af; }
    a { color: #6cb0ff; }
  }
</style>
</head><body>${sanitized}</body></html>`
}

/** Текстовая версия для писем без HTML. */
export function buildTextDocument(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src kurier-att: data:">
<style>
  html, body { margin: 0; background: #fff; color: #1f2328; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding: 18px 22px 28px; white-space: pre-wrap; word-wrap: break-word; }
  @media (prefers-color-scheme: dark) { html, body { background: #16191d; color: #d8dde3; } }
</style></head><body>${escaped}</body></html>`
}
