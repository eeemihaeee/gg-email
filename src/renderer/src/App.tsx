import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from './store'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import MessageList from './components/MessageList'
import Reader from './components/Reader'
import Composer from './components/Composer'
import SetupWizard from './components/SetupWizard'
import SettingsPanel from './components/SettingsPanel'
import Toasts from './components/Toasts'
import StatusBar from './components/StatusBar'

export default function App(): React.JSX.Element {
  const ready = useStore((state) => state.ready)
  const view = useStore((state) => state.view)
  const compose = useStore((state) => state.compose)
  const initError = useStore((state) => state.initError)

  useEffect(() => {
    const store = useStore.getState()
    const unsubscribeStatus = window.kurier.on('event:sync-status', (status) =>
      useStore.getState().applySyncStatus(status)
    )
    const unsubscribeMessages = window.kurier.on('event:messages-changed', (payload) => {
      void useStore.getState().onMessagesChanged(payload.folderIds)
    })
    const unsubscribeFolders = window.kurier.on('event:folders-changed', (payload) => {
      void useStore.getState().onFoldersChanged(payload.accountId)
    })
    const unsubscribePolicy = window.kurier.on('event:policy-changed', (policy) => {
      useStore.getState().setPolicy(policy)
      store.pushToast('info', 'Политики организации обновлены')
    })
    const unsubscribeUpdater = window.kurier.on('event:updater-state', (state) => {
      useStore.getState().setUpdater(state)
    })
    const unsubscribeToast = window.kurier.on('event:toast', (toast) => {
      store.pushToast(toast.kind, toast.message)
    })
    return () => {
      unsubscribeStatus()
      unsubscribeMessages()
      unsubscribeFolders()
      unsubscribePolicy()
      unsubscribeUpdater()
      unsubscribeToast()
    }
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (typing) return

      const store = useStore.getState()
      if (event.key === 'F5') {
        event.preventDefault()
        void store.syncNow()
      } else if (event.key === 'c') {
        event.preventDefault()
        store.startCompose('new')
      } else if (event.key === 'r' && store.detail) {
        event.preventDefault()
        store.startCompose('reply', store.detail)
      } else if (event.key === 'a' && store.detail) {
        event.preventDefault()
        store.startCompose('replyAll', store.detail)
      } else if (event.key === 'f' && store.detail) {
        event.preventDefault()
        store.startCompose('forward', store.detail)
      } else if (event.key === 'Escape') {
        if (store.compose) store.discardCompose()
        else if (store.view !== 'mail') store.closeOverlay()
        else store.closeMessage()
      } else if (event.key === 'Delete' && store.selectedId) {
        event.preventDefault()
        void store.deleteMessage(store.selectedId)
      } else if (event.key === 's' && store.selectedId) {
        event.preventDefault()
        void store.toggleFlag(store.selectedId)
      } else if (event.key === 'j' || event.key === 'k') {
        const index = store.messages.findIndex((message) => message.id === store.selectedId)
        const nextIndex = event.key === 'j' ? index + 1 : index - 1
        const next = store.messages[nextIndex]
        if (next) {
          event.preventDefault()
          void store.openMessage(next.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (initError) {
    return (
      <div className="fatal">
        <h1>GG Email не смог запуститься</h1>
        <p>{initError}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className={`app ${ready ? 'ready' : 'loading'}`}>
      <TitleBar />
      <div className="workspace">
        <Sidebar />
        <MessageList />
        <Reader />
      </div>
      <StatusBar />
      {view === 'setup' && createPortal(<SetupWizard />, document.body)}
      {view === 'settings' && createPortal(<SettingsPanel />, document.body)}
      {compose && createPortal(<Composer />, document.body)}
      <Toasts />
      {!ready && (
        <div className="boot-splash">
          <div className="boot-logo">K</div>
          <div className="boot-text">Запуск GG Email…</div>
        </div>
      )}
    </div>
  )
}
