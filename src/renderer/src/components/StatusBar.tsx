import { useStore } from '../store'
import { Icon } from './Icon'
import { plural } from '../lib/format'

export default function StatusBar(): React.JSX.Element {
  const appInfo = useStore((state) => state.appInfo)
  const sync = useStore((state) => state.sync)
  const accounts = useStore((state) => state.accounts)
  const messages = useStore((state) => state.messages)
  const total = useStore((state) => state.total)
  const listLoading = useStore((state) => state.listLoading)
  const policy = useStore((state) => state.policy)
  const syncNow = useStore((state) => state.syncNow)

  const syncing = Object.values(sync).filter(
    (status) => status.phase === 'syncing' || status.phase === 'connecting'
  ).length
  const offline = Object.values(sync).filter((status) => status.phase === 'offline').length
  const lastError = Object.values(sync).find((status) => status.error)?.error

  return (
    <footer className="statusbar">
      <div className="status-left">
        <button className="status-item clickable" onClick={() => void syncNow()} title="Синхронизировать">
          <Icon
            name={syncing > 0 ? 'spinner' : 'refresh'}
            size={13}
            className={syncing > 0 ? 'spin' : undefined}
          />
          <span>
            {syncing > 0
              ? 'Синхронизация…'
              : offline > 0
                ? `Нет связи (${offline})`
                : 'Синхронизировано'}
          </span>
        </button>
        {lastError && offline > 0 && (
          <span className="status-item error" title={lastError}>
            <Icon name="warning" size={13} />
            <span className="truncate">{lastError}</span>
          </span>
        )}
      </div>

      <div className="status-right">
        {listLoading && <span className="status-item">Загрузка…</span>}
        <span className="status-item">
          {messages.length > 0
            ? `${messages.length} из ${total} ${plural(total, ['письма', 'писем', 'писем'])}`
            : `${total} ${plural(total, ['письмо', 'письма', 'писем'])}`}
        </span>
        <span className="status-item dim">{accounts.length} акк.</span>
        {policy.managed && (
          <span className="status-item dim" title={`Источник: ${policy.source}`}>
            <Icon name="shield" size={12} /> GPO
          </span>
        )}
        <span className="status-item dim">v{appInfo?.version ?? '—'}</span>
      </div>
    </footer>
  )
}
