import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyTheme, useStore } from './store'
import { installDemoApi } from './demo/mock'

const params = new URLSearchParams(window.location.search)
const demo = params.has('demo') && !('kurier' in window)
if (demo) installDemoApi()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Не найден корневой элемент')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

void useStore
  .getState()
  .init()
  .then(async () => {
    applyTheme(useStore.getState().settings)
    if (demo) {
      const store = useStore.getState()
      store.pushToast('info', 'Демонстрационный режим: данные синтетические')
      const requestedView = params.get('view')
      if (requestedView === 'settings') store.openSettings()
      if (requestedView === 'setup') store.openSetup()
      if (params.has('open') && store.messages[0]) {
        await store.openMessage(store.messages[0].id)
      }
    }
  })
