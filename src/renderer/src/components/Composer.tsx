import { useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { formatSize } from '../lib/format'

export default function Composer(): React.JSX.Element | null {
  const compose = useStore((state) => state.compose)
  const accounts = useStore((state) => state.accounts)
  const updateCompose = useStore((state) => state.updateCompose)
  const sendCompose = useStore((state) => state.sendCompose)
  const discardCompose = useStore((state) => state.discardCompose)
  const addAttachment = useStore((state) => state.addComposeAttachment)
  const removeAttachment = useStore((state) => state.removeComposeAttachment)
  const [showCc, setShowCc] = useState(false)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!compose) return null

  const titles: Record<string, string> = {
    new: 'Новое письмо',
    reply: 'Ответ',
    replyAll: 'Ответ всем',
    forward: 'Переслать'
  }

  const account = accounts.find((item) => item.id === compose.accountId)

  const handleSend = async (): Promise<void> => {
    if (sending) return
    setSending(true)
    try {
      await sendCompose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="composer" onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          void handleSend()
        }
      }}>
        <header className="composer-head">
          <h2>{titles[compose.mode]}</h2>
          {accounts.length > 1 ? (
            <select
              className="account-select"
              value={compose.accountId}
              onChange={(event) => updateCompose({ accountId: event.target.value })}
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email}
                </option>
              ))}
            </select>
          ) : (
            <span className="dim">{account?.email}</span>
          )}
          <span className="flex-spacer" />
          <button className="icon-btn" onClick={discardCompose} title="Закрыть (Esc)">
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="composer-fields">
          <label className="field">
            <span>Кому</span>
            <input
              autoFocus={compose.mode === 'new'}
              value={compose.to}
              onChange={(event) => updateCompose({ to: event.target.value })}
              placeholder="name@example.com"
              spellCheck={false}
            />
            <button className="field-link" onClick={() => setShowCc(!showCc)} type="button">
              Копия
            </button>
          </label>

          {showCc && (
            <>
              <label className="field">
                <span>Копия</span>
                <input
                  value={compose.cc}
                  onChange={(event) => updateCompose({ cc: event.target.value })}
                  placeholder="cc@example.com"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Скрытая</span>
                <input
                  value={compose.bcc}
                  onChange={(event) => updateCompose({ bcc: event.target.value })}
                  placeholder="bcc@example.com"
                  spellCheck={false}
                />
              </label>
            </>
          )}

          <label className="field">
            <span>Тема</span>
            <input
              value={compose.subject}
              onChange={(event) => updateCompose({ subject: event.target.value })}
              placeholder="Тема письма"
            />
          </label>
        </div>

        <textarea
          className="composer-body"
          value={compose.body}
          onChange={(event) => updateCompose({ body: event.target.value })}
          placeholder="Текст письма…"
          spellCheck
        />

        {compose.attachments.length > 0 && (
          <div className="composer-attachments">
            {compose.attachments.map((attachment, index) => (
              <div key={`${attachment.filename}-${index}`} className="attachment-chip">
                <Icon name="paperclip" size={14} />
                <div className="attachment-meta">
                  <span className="attachment-name">{attachment.filename}</span>
                  <span className="dim small">{formatSize(attachment.size)}</span>
                </div>
                <button
                  className="icon-btn tiny"
                  onClick={() => void removeAttachment(index)}
                  title="Убрать"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <footer className="composer-foot">
          <button className="btn primary" onClick={() => void handleSend()} disabled={sending}>
            {sending ? <Icon name="spinner" size={16} className="spin" /> : <Icon name="send" size={16} />}
            <span>{sending ? 'Отправка…' : 'Отправить'}</span>
          </button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Вложить файл">
            <Icon name="paperclip" size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              for (const file of files) void addAttachment(file)
              event.target.value = ''
            }}
          />
          <span className="dim small">Ctrl+Enter — отправить</span>
          <span className="flex-spacer" />
          <button className="btn ghost" onClick={discardCompose}>
            Отменить
          </button>
        </footer>
      </div>
    </div>
  )
}
