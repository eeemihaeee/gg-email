import { useEffect, useRef, useState } from 'react'
import type { AttachmentMeta } from '@shared/types'
import { Icon } from './Icon'
import { formatSize } from '../lib/format'
import { useStore } from '../store'

interface Props {
  attachment: AttachmentMeta
  onClose: () => void
}

function isImage(type: string): boolean {
  return type.startsWith('image/') && !type.includes('svg')
}

function isPdf(type: string): boolean {
  return type === 'application/pdf'
}

function isText(type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'message/rfc822'
  )
}

/** Просмотр вложений внутри приложения: картинки, PDF, текст. */
export default function AttachmentViewer({ attachment, onClose }: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printRef = useRef<HTMLIFrameElement>(null)
  const pushToast = useStore((state) => state.pushToast)

  useEffect(() => {
    let cancelled = false
    void window.kurier.messages
      .attachmentUrl(attachment.id)
      .then(async (value) => {
        if (cancelled) return
        setUrl(value)
        if (isText(attachment.contentType)) {
          try {
            const response = await fetch(value)
            const body = await response.text()
            if (!cancelled) setText(body.slice(0, 500_000))
          } catch {
            if (!cancelled) setText(null)
          }
        }
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message)
      })
    return () => {
      cancelled = true
    }
  }, [attachment.id, attachment.contentType])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const download = async (): Promise<void> => {
    try {
      await window.kurier.messages.saveAttachment(attachment.id)
    } catch (caught) {
      pushToast('error', (caught as Error).message)
    }
  }

  const print = (): void => {
    if (isPdf(attachment.contentType)) {
      printRef.current?.contentWindow?.print()
      return
    }
    const html = isImage(attachment.contentType)
      ? `<html><body style="margin:0"><img src="${url}" style="max-width:100%"></body></html>`
      : `<html><body style="font:13px/1.5 Consolas,monospace;white-space:pre-wrap;padding:16px">${escapeHtml(
          text ?? ''
        )}</body></html>`
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) return
    doc.open()
    doc.write(html)
    doc.close()
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 30_000)
    }
  }

  const canPrint = isPdf(attachment.contentType) || isImage(attachment.contentType) || Boolean(text)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="attachment-viewer" onClick={(event) => event.stopPropagation()}>
        <header className="attachment-viewer-head">
          <Icon name="paperclip" size={16} />
          <div className="attachment-viewer-title">
            <strong>{attachment.filename}</strong>
            <span className="dim small">
              {attachment.contentType} · {formatSize(attachment.size)}
            </span>
          </div>
          <span className="flex-spacer" />
          {canPrint && (
            <button className="icon-btn" title="Печать" onClick={print}>
              <Icon name="printer" size={17} />
            </button>
          )}
          <button className="icon-btn" title="Скачать" onClick={() => void download()}>
            <Icon name="download" size={17} />
          </button>
          <button className="icon-btn" title="Закрыть (Esc)" onClick={onClose}>
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="attachment-viewer-body">
          {error && <div className="form-error">{error}</div>}
          {!error && isImage(attachment.contentType) && url && (
            <img className="attachment-image" src={url} alt={attachment.filename} />
          )}
          {!error && isPdf(attachment.contentType) && url && (
            <iframe
              ref={printRef}
              className="attachment-pdf"
              title={attachment.filename}
              src={url}
            />
          )}
          {!error && isText(attachment.contentType) && (
            <pre className="attachment-text">{text ?? 'Загрузка…'}</pre>
          )}
          {!error &&
            !isImage(attachment.contentType) &&
            !isPdf(attachment.contentType) &&
            !isText(attachment.contentType) && (
              <div className="attachment-unknown">
                <Icon name="paperclip" size={36} />
                <p>Предпросмотр для этого типа файлов недоступен.</p>
                <button className="btn primary" onClick={() => void download()}>
                  <Icon name="download" size={15} /> Скачать файл
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
