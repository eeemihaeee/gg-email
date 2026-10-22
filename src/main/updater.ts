import { app } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { PolicyState, UpdaterState } from '@shared/types'
import { policyValue } from '@shared/policy'
import { createLogger } from './logger'

const log = createLogger('updater')

/**
 * РћР±РЅРѕРІР»РµРЅРёСЏ:
 *  - СѓСЃС‚Р°РЅРѕРІРєР° per-user (NSIS, %LOCALAPPDATA%\Programs\GG Email) вЂ” Р±РµР· РїСЂР°РІ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°;
 *  - РґРёС„С„РµСЂРµРЅС†РёР°Р»СЊРЅС‹Рµ Р·Р°РіСЂСѓР·РєРё (blockmap) вЂ” РєР°С‡Р°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ СЂР°Р·РЅРёС†Р°;
 *  - РєР°РЅР°Р», РёРЅС‚РµСЂРІР°Р», РѕС‚СЃСЂРѕС‡РєР° Рё РїРѕР»РЅС‹Р№ Р·Р°РїСЂРµС‚ СѓРїСЂР°РІР»СЏСЋС‚СЃСЏ С‡РµСЂРµР· ADMX/GPO.
 */
export class UpdateService {
  private state: UpdaterState = { status: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private policy: PolicyState
  private deferredUntil = 0

  constructor(
    policy: PolicyState,
    private emitState: (state: UpdaterState) => void,
    private deferStore: { get(key: string): number; set(key: string, value: number): void }
  ) {
    this.policy = policy
  }

  private setState(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch }
    this.emitState(this.state)
  }

  init(): void {
    if (!app.isPackaged) {
      this.setState({ status: 'disabled' })
      log.info('Р РµР¶РёРј СЂР°Р·СЂР°Р±РѕС‚РєРё: Р°РІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРµ РѕС‚РєР»СЋС‡РµРЅРѕ')
      return
    }
    const mode = policyValue<string>(this.policy, 'updateMode', 'auto')
    if (mode === 'disabled') {
      this.setState({ status: 'disabled' })
      return
    }

    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = mode === 'auto'
    autoUpdater.allowPrerelease = policyValue<string>(this.policy, 'updateChannel', 'stable') !== 'stable'
    autoUpdater.channel = policyValue<string>(this.policy, 'updateChannel', 'stable')
    autoUpdater.disableWebInstaller = true

    const baseUrl = policyValue(this.policy, 'updateBaseUrl', '')
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      autoUpdater.setFeedURL({ provider: 'generic', url: baseUrl.trim() })
    }

    this.wireEvents()
    this.deferredUntil = this.deferStore.get('updateDeferredUntil') ?? 0
    this.scheduleNextCheck(true)
  }

  private wireEvents(): void {
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      this.setState({ status: 'available', version: info.version })
    )
    autoUpdater.on('update-not-available', () => this.setState({ status: 'idle', percent: 0 }))
    autoUpdater.on('download-progress', (progress) =>
      this.setState({
        status: 'downloading',
        percent: Math.round(progress.percent),
        version: this.state.version
      })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.onDownloaded(info))
    autoUpdater.on('error', (error) => {
      log.warn('РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ', error.message)
      this.setState({ status: 'error', error: error.message })
    })
  }

  private onDownloaded(info: UpdateInfo): void {
    const deferDays = Number(policyValue<number>(this.policy, 'updateDeferDays', 0))
    const mode = policyValue<string>(this.policy, 'updateMode', 'auto')
    if (deferDays > 0) {
      this.deferredUntil = Date.now() + deferDays * 86_400_000
      this.deferStore.set('updateDeferredUntil', this.deferredUntil)
      log.info(`РћР±РЅРѕРІР»РµРЅРёРµ ${info.version} РѕС‚Р»РѕР¶РµРЅРѕ РЅР° ${deferDays} РґРЅ.`)
      this.setState({ status: 'ready', version: info.version })
      return
    }
    if (mode === 'notify') {
      this.setState({ status: 'ready', version: info.version })
      return
    }
    this.setState({ status: 'ready', version: info.version })
  }

  private scheduleNextCheck(immediate = false): void {
    if (this.timer) clearTimeout(this.timer)
    const hours = Number(policyValue(this.policy, 'updateCheckIntervalHours', 6))
    const interval = Math.max(1, hours) * 3_600_000
    const nextCheckAt = Date.now() + (immediate ? 30_000 : interval)
    this.setState({ nextCheckAt })
    this.timer = setTimeout(() => {
      void this.check()
      this.scheduleNextCheck()
    }, immediate ? 30_000 : interval)
    this.timer.unref?.()
  }

  async check(manual = false): Promise<UpdaterState> {
    if (!app.isPackaged) return this.state
    const mode = policyValue<string>(this.policy, 'updateMode', 'auto')
    if (mode === 'disabled') {
      this.setState({ status: 'disabled' })
      return this.state
    }
    if (this.state.status === 'downloading' || this.state.status === 'checking') return this.state

    if (this.deferredUntil > 0 && Date.now() >= this.deferredUntil) {
      this.deferredUntil = 0
      this.deferStore.set('updateDeferredUntil', 0)
    }

    try {
      await autoUpdater.checkForUpdates()
      if (manual) log.info('РџСЂРѕРІРµСЂРєР° РѕР±РЅРѕРІР»РµРЅРёР№ Р·Р°РїСѓС‰РµРЅР° РІСЂСѓС‡РЅСѓСЋ')
    } catch (error) {
      this.setState({ status: 'error', error: (error as Error).message })
    }
    return this.state
  }

  install(): void {
    if (this.state.status !== 'ready') return
    if (this.deferredUntil > Date.now()) {
      log.info('РЈСЃС‚Р°РЅРѕРІРєР° РѕС‚Р»РѕР¶РµРЅР° РїРѕР»РёС‚РёРєРѕР№')
      return
    }
    log.info('РџРµСЂРµР·Р°РїСѓСЃРє РґР»СЏ СѓСЃС‚Р°РЅРѕРІРєРё РѕР±РЅРѕРІР»РµРЅРёСЏ')
    autoUpdater.quitAndInstall(true, true)
  }

  applyPolicy(policy: PolicyState): void {
    const previousMode = policyValue<string>(this.policy, 'updateMode', 'auto')
    this.policy = policy
    const mode = policyValue<string>(policy, 'updateMode', 'auto')
    if (mode === 'disabled') {
      if (this.timer) clearTimeout(this.timer)
      this.setState({ status: 'disabled' })
      return
    }
    if (previousMode === 'disabled' || this.state.status === 'disabled') {
      this.init()
      return
    }
    autoUpdater.allowPrerelease = policyValue<string>(policy, 'updateChannel', 'stable') !== 'stable'
    autoUpdater.channel = policyValue<string>(policy, 'updateChannel', 'stable')
    this.scheduleNextCheck()
  }

  snapshot(): UpdaterState {
    return this.state
  }
}
