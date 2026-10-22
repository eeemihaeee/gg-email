import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

export default function TitleBar(): React.JSX.Element {
  const query = useStore((state) => state.query)
  const setQuery = useStore((state) => state.setQuery)
  const syncNow = useStore((state) => state.syncNow)
  const openSettings = useStore((state) => state.openSettings)
  const startCompose = useStore((state) => state.startCompose)
  const accounts = useStore((state) => state.accounts)
  const sync = useStore((state) => state.sync)
  const listLoading = useStore((state) => state.listLoading)
  const [value, setValue] = useState(query)
  const inputRef = useRef<HTMLInputElement>(null)

  const syncing = Object.values(sync).some(
    (status) => status.phase === 'syncing' || status.phase === 'connecting'
  )

  useEffect(() => {
    setValue(query)
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (value !== query) void setQuery(value)
    }, 350)
    return () => clearTimeout(timer)
  }, [value, query, setQuery])

  useEffect(() => {
    const focus = (event: KeyboardEvent): void => {
      if (event.key === '/' && !(event.target as HTMLElement)?.closest('input,textarea')) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focus)
    return () => window.removeEventListener('keydown', focus)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="logo-mark">GG</span>
        <span className="brand-name">GG Email</span>
      </div>

      <div className="titlebar-search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={value}
          placeholder="Поиск по почте"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setValue('')
              inputRef.current?.blur()
            }
          }}
          spellCheck={false}
        />
        {value ? (
          <button className="icon-btn tiny" onClick={() => setValue('')} title="Очистить">
            <Icon name="close" size={14} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>

      <div className="titlebar-actions">
        <button
          className="icon-btn"
          onClick={() => void syncNow()}
          title="Проверить почту (F5)"
          disabled={listLoading}
        >
          <Icon name="refresh" size={18} className={syncing ? 'spin' : undefined} />
        </button>
        <button
          className="btn primary compact"
          onClick={() => startCompose('new')}
          disabled={accounts.length === 0}
          title="Написать письмо (C)"
        >
          <Icon name="draft" size={16} />
          <span>Написать</span>
        </button>
        <button className="icon-btn" onClick={openSettings} title="Настройки">
          <Icon name="settings" size={18} />
        </button>
      </div>
    </header>
  )
}
