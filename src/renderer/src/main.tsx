import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyTheme, useStore } from './store'
import { installDemoApi } from './demo/mock'
import { installWebApi, type WebBoot } from './web-client'

const params = new URLSearchParams(window.location.search)
const webBoot = (window as unknown as { __GG_WEB__?: WebBoot }).__GG_WEB__
const demo = !webBoot && params.has('demo') && !('kurier' in window)
if (webBoot) installWebApi(webBoot)
else if (demo) installDemoApi()

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
