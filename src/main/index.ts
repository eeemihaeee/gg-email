import { app, BrowserWindow, Menu, net, protocol, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { AppContext } from './app-context'
import { registerIpc } from './ipc'
import { configureLogger, createLogger } from './logger'
import { paths } from './paths'
import { policyValue } from '@shared/policy'
import { startPolicyWatcher } from './policy'

const log = createLogger('main')

// Позволяет держать профиль (кеш Chromium, БД, логи) рядом с проектом —
// используется в автотестах и при переносимой установке.
if (process.env.GGEMAIL_USER_DATA) {
  app.setPath('userData', process.env.GGEMAIL_USER_DATA)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kurier-att',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null
let stopping = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.gg.email')

  await app.whenReady()

  context = await AppContext.create()
  configureLogger(policyValue(context.policy, 'logLevel', 'warn'), paths.logs)
  registerAttachmentProtocol(context)

  nativeTheme.themeSource = 'system'
  Menu.setApplicationMenu(buildMenu())

  createWindow(context)
  registerIpc(context, () => mainWindow)

  context.updater.init()
  const stopWatcher = startPolicyWatcher()
  context.startBackgroundJobs()
  void context.startAll()

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && context) createWindow(context)
  })

  app.on('before-quit', (event) => {
    if (stopping) return
    stopping = true
    event.preventDefault()
    stopWatcher()
    void shutdown().finally(() => {
      app.exit(0)
    })
  })
}

async function shutdown(): Promise<void> {
  try {
    await context?.stopAll()
  } catch (error) {
    log.warn('Ошибка остановки синхронизации', error)
  }
  try {
    context?.close()
  } catch (error) {
    log.warn('Ошибка закрытия БД', error)
  }
}

function createWindow(ctx: AppContext): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1115',
      symbolColor: '#e6e8eb',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      webviewTag: false
    }
  })

  mainWindow = window
  ctx.attachWindow(window)

  window.once('ready-to-show', () => {
    window.show()
    void maybeCapture(window)
  })

  window.on('closed', () => {
    mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Вложения отдаются по схеме kurier-att://, чтобы HTML-письма могли
 * показывать встроенные картинки (cid:) без доступа к файловой системе.
 */
function registerAttachmentProtocol(ctx: AppContext): void {
  protocol.handle('kurier-att', async (request) => {
    try {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.pathname.replace(/^\//, '')) || url.hostname
      const attachment = ctx.messages.attachment(id)
      if (!attachment?.path) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(attachment.path).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

async function maybeCapture(window: BrowserWindow): Promise<void> {
  const target = process.env.GGEMAIL_SCREENSHOT
  if (!target) return
  const delayMs = Number(process.env.GGEMAIL_SCREENSHOT_DELAY ?? 1800)
  setTimeout(async () => {
    try {
      const image = await window.webContents.capturePage()
      await writeFile(target, image.toPNG())
      log.info(`Скриншот сохранён: ${target}`)
    } catch (error) {
      log.error('Не удалось сделать скриншот', error)
    } finally {
      if (process.env.GGEMAIL_SCREENSHOT_EXIT !== '0') app.exit(0)
    }
  }, delayMs)
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Масштаб 100%' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'Папка данных',
          click: () => {
            void shell.openPath(paths.root)
          }
        }
      ]
    }
  ])
}
