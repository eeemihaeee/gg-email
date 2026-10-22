import { useMemo } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { formatFullDate, formatSize, senderLabel } from '../lib/format'
import { buildMessageDocument, buildTextDocument } from '../lib/sanitize'
import { isBlockedAttachment } from '@shared/policy'

export default function Reader(): React.JSX.Element | null {
  const detail = useStore((state) => state.detail)
  const loading = useStore((state) => state.detailLoading)
  const allowRemoteMap = useStore((state) => state.allowRemote)
  const allowRemoteFor = useStore((state) => state.allowRemoteFor)
  const toggleFlag = useStore((state) => state.toggleFlag)
  const deleteMessage = useStore((state) => state.deleteMessage)
  const startCompose = useStore((state) => state.startCompose)
  const policy = useStore((state) => state.policy)
  const closeMessage = useStore((state) => state.closeMessage)

  const allowRemote =
    detail !== null
      ? (allowRemoteMap[detail.id] ?? policy.values.blockRemoteContent === false)
      : false
  const allowHtml = policy.values.allowHtmlMail !== false

  const hasRemoteContent = useMemo(() => {
    if (!detail?.htmlBody) return false
    return /(src|href)=["']https?:/i.test(detail.htmlBody) || /url\(\s*['"]?https?:/i.test(detail.htmlBody)
  }, [detail?.htmlBody])

  const document = useMemo(() => {
    if (!detail) return ''
    if (allowHtml && detail.htmlBody) {
      return buildMessageDocument(detail.htmlBody, detail.attachments, {
        allowRemote,
        cidMap: {}
      })
    }
    return buildTextDocument(detail.textBody || '(письмо без текста)')
  }, [detail, allowRemote, allowHtml])

  if (loading && !detail) {
    return (
      <section className="reader-pane">
        <div className="reader-loading">
          <Icon name="spinner" size={26} className="spin" />
          <span>Загружаем письмо…</span>
        </div>
      </section>
    )
  }

  if (!detail) {
    return (
      <section className="reader-pane empty">
        <div className="reader-placeholder">
          <div className="placeholder-logo">GG</div>
          <h3>Выберите письмо</h3>
          <p className="dim">
            GG Email хранит заголовки всех писем локально, поэтому список открывается мгновенно
            даже без сети.
          </p>
          <div className="shortcut-grid">
            <span><kbd>C</kbd> написать</span>
            <span><kbd>R</kbd> ответить</span>
            <span><kbd>/</kbd> поиск</span>
            <span><kbd>Del</kbd> в корзину</span>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="reader-pane">
      <header className="reader-header">
        <div className="reader-actions">
          <button className="icon-btn" title="Ответить (R)" onClick={() => startCompose('reply', detail)}>
            <Icon name="reply" size={17} />
          </button>
          <button className="icon-btn" title="Ответить всем (A)" onClick={() => startCompose('replyAll', detail)}>
            <Icon name="reply-all" size={17} />
          </button>
          <button className="icon-btn" title="Переслать (F)" onClick={() => startCompose('forward', detail)}>
            <Icon name="forward" size={17} />
          </button>
          <span className="divider" />
          <button
            className="icon-btn"
            title="Пометить"
            onClick={() => void toggleFlag(detail.id)}
          >
            <Icon name={detail.flags.flagged ? 'star-filled' : 'star'} size={17} className={detail.flags.flagged ? 'star' : undefined} />
          </button>
          <button className="icon-btn" title="Удалить (Del)" onClick={() => void deleteMessage(detail.id)}>
            <Icon name="trash" size={17} />
          </button>
          <span className="flex-spacer" />
          <button className="icon-btn" title="Закрыть (Esc)" onClick={closeMessage}>
            <Icon name="close" size={17} />
          </button>
        </div>

        <h1 className="reader-subject">{detail.subject}</h1>

        <div className="reader-meta">
          <div className="reader-avatar">{senderLabel(detail.from).slice(0, 1).toUpperCase()}</div>
          <div className="reader-meta-text">
            <div className="reader-from">
              <strong>{senderLabel(detail.from)}</strong>
              <span className="dim">&lt;{detail.from[0]?.email}&gt;</span>
            </div>
            <div className="reader-to dim">
              кому: {detail.to.map((address) => address.email).join(', ') || '—'}
              {detail.cc.length > 0 && ` · копия: ${detail.cc.map((a) => a.email).join(', ')}`}
            </div>
          </div>
          <div className="reader-date">{formatFullDate(detail.date)}</div>
        </div>
      </header>

      {!allowRemote && hasRemoteContent && (
        <div className="remote-banner">
          <Icon name="image" size={16} />
          <span>Внешние изображения заблокированы для защиты от трекеров.</span>
          <button className="btn ghost compact" onClick={() => allowRemoteFor(detail.id)}>
            Показать
          </button>
        </div>
      )}

      <div className="reader-body">
        <iframe
          key={`${detail.id}:${allowRemote}:${allowHtml}`}
          className="mail-frame"
          title="Тело письма"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={document}
        />
      </div>

      {detail.attachments.length > 0 && (
        <div className="attachments">
          {detail.attachments.map((attachment) => {
            const blocked = isBlockedAttachment(
              attachment.filename,
              policy.values.blockedAttachmentExtensions
            )
            return (
              <button
                key={attachment.id}
                className={`attachment-chip ${blocked ? 'blocked' : ''}`}
                title={
                  blocked
                    ? 'Вложения этого типа запрещены политикой безопасности'
                    : `Открыть ${attachment.filename}`
                }
                disabled={blocked}
                onClick={() => {
                  void window.kurier.messages.openAttachment(attachment.id).catch((error: Error) => {
                    useStore.getState().pushToast('error', error.message)
                  })
                }}
              >
                <Icon name={blocked ? 'lock' : 'paperclip'} size={15} />
                <div className="attachment-meta">
                  <span className="attachment-name">{attachment.filename}</span>
                  <span className="dim small">
                    {blocked ? 'заблокировано политикой' : formatSize(attachment.size)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
