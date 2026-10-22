import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../store'
import { Icon } from './Icon'
import { formatListDate, initials, senderLabel } from '../lib/format'

export default function MessageList(): React.JSX.Element {
  const messages = useStore((state) => state.messages)
  const selectedId = useStore((state) => state.selectedId)
  const openMessage = useStore((state) => state.openMessage)
  const toggleFlag = useStore((state) => state.toggleFlag)
  const deleteMessage = useStore((state) => state.deleteMessage)
  const settings = useStore((state) => state.settings)
  const selection = useStore((state) => state.selection)
  const folders = useStore((state) => state.folders)
  const accounts = useStore((state) => state.accounts)
  const query = useStore((state) => state.query)
  const listLoading = useStore((state) => state.listLoading)
  const hasMore = useStore((state) => state.hasMore)
  const loadMore = useStore((state) => state.loadMessages)
  const syncFolder = useStore((state) => state.selectFolder)

  const scrollRef = useRef<HTMLDivElement>(null)
  const rowHeight = settings?.density === 'compact' ? 58 : 76

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10
  })

  const activeFolder =
    selection.kind === 'folder' ? folders.find((folder) => folder.id === selection.folderId) : null
  const activeAccount =
    accounts.find((account) => account.id === selection.accountId) ?? null

  const title =
    selection.kind === 'unified'
      ? activeAccount
        ? `Входящие — ${activeAccount.displayName || activeAccount.email}`
        : 'Все входящие'
      : activeFolder?.name ?? 'Папка'

  const sync = useStore((state) => state.sync)
  const accountError = selection.accountId
    ? sync[selection.accountId]?.error
    : Object.values(sync).find((status) => status.error)?.error
  const accountPhase = selection.accountId ? sync[selection.accountId]?.phase : undefined

  return (
    <section className="list-pane">
      <header className="list-header">
        <div className="list-title">
          <h2>{title}</h2>
          <span className="list-count">{messages.length}</span>
        </div>
        <div className="list-actions">
          {activeFolder && (
            <button
              className="icon-btn"
              title="Обновить папку"
              onClick={() => void syncFolder(activeFolder.id)}
            >
              <Icon name="refresh" size={16} />
            </button>
          )}
        </div>
      </header>

      {messages.length === 0 && !listLoading && (
        <div className="list-empty">
          <Icon name={accountError ? 'warning' : 'inbox'} size={38} />
          <p>
            {accountError
              ? 'Не удалось подключиться к почтовому серверу'
              : query
                ? 'Ничего не найдено'
                : selection.kind === 'unified'
                  ? 'Входящие пусты'
                  : 'В этой папке нет писем'}
          </p>
          {accountError ? (
            <span className="empty-error">{accountError}</span>
          ) : (
            !query &&
            selection.kind === 'unified' && (
              <span className="dim">Новые письма появятся здесь автоматически</span>
            )
          )}
          {accountError && accountPhase === 'offline' && (
            <div className="empty-actions">
              <span className="dim small">Проверьте адрес, порт и пароль приложения</span>
              <button
                className="btn compact"
                onClick={() => {
                  const accountId = selection.accountId
                  void window.kurier.sync
                    .now(accountId)
                    .then(() => useStore.getState().pushToast('info', 'Повторная попытка подключения…'))
                    .catch((error: Error) => useStore.getState().pushToast('error', error.message))
                }}
              >
                Повторить
              </button>
            </div>
          )}
        </div>
      )}

      <div className="list-scroll" ref={scrollRef}>
        <div className="list-virtual" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index]
            const selected = message.id === selectedId
            const unread = !message.flags.seen
            return (
              <div
                key={message.id}
                className={`msg-row ${selected ? 'selected' : ''} ${unread ? 'unread' : ''}`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
                onClick={() => void openMessage(message.id)}
              >
                <div className="msg-avatar">{initials(senderLabel(message.from))}</div>
                <div className="msg-main">
                  <div className="msg-line">
                    <span className="msg-sender">{senderLabel(message.from)}</span>
                    <span className="msg-date">{formatListDate(message.date)}</span>
                  </div>
                  <div className="msg-line">
                    <span className="msg-subject">{message.subject}</span>
                  </div>
                  <div className="msg-line">
                    <span className="msg-snippet">{message.snippet || ' '}</span>
                    <span className="msg-flags">
                      {message.hasAttachments && <Icon name="paperclip" size={13} />}
                      {message.flags.flagged && <Icon name="star-filled" size={13} className="star" />}
                    </span>
                  </div>
                </div>
                <div className="msg-hover-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    className="icon-btn tiny"
                    title={message.flags.flagged ? 'Снять флажок' : 'Пометить'}
                    onClick={() => void toggleFlag(message.id)}
                  >
                    <Icon name={message.flags.flagged ? 'star-filled' : 'star'} size={15} />
                  </button>
                  <button
                    className="icon-btn tiny"
                    title="Удалить"
                    onClick={() => void deleteMessage(message.id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                {unread && <span className="unread-dot" />}
              </div>
            )
          })}
        </div>

        {hasMore && (
          <button
            className="load-more"
            onClick={() => void loadMore(false)}
            disabled={listLoading}
          >
            {listLoading ? 'Загрузка…' : 'Показать ещё'}
          </button>
        )}
      </div>
    </section>
  )
}
