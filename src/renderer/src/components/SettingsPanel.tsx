import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import { POLICY_DEFINITIONS } from '@shared/policy'
import type { CacheStats } from '@shared/types'
import { formatSize } from '../lib/format'

type Tab = 'accounts' | 'appearance' | 'security' | 'storage' | 'updates' | 'about'

function formatPolicyValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Включено' : 'Отключено'
  if (value === '') return '—'
  return String(value)
}

export default function SettingsPanel(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    const allowed: Tab[] = ['accounts', 'appearance', 'security', 'storage', 'updates', 'about']
    return allowed.includes(requested as Tab) ? (requested as Tab) : 'accounts'
  })
  const closeOverlay = useStore((state) => state.closeOverlay)
  const openSetup = useStore((state) => state.openSetup)
  const accounts = useStore((state) => state.accounts)
  const policy = useStore((state) => state.policy)
  const settings = useStore((state) => state.settings)
  const updater = useStore((state) => state.updater)
  const appInfo = useStore((state) => state.appInfo)
  const updateSettings = useStore((state) => state.updateSettings)
  const checkUpdates = useStore((state) => state.checkUpdates)
  const installUpdate = useStore((state) => state.installUpdate)
  const clearCache = useStore((state) => state.clearCache)

  const [stats, setStats] = useState<CacheStats | null>(null)
  const refreshStats = async (): Promise<void> => {
    setStats(await window.kurier.app.cacheStats())
  }
  const clearBodies = async (): Promise<void> => {
    await window.kurier.app.clearBodies()
    await refreshStats()
  }
  useEffect(() => {
    if (tab === 'storage') void refreshStats()
  }, [tab])

  const allowManage = policy.values.allowAccountManagement !== false

  const removeAccount = async (id: string, email: string): Promise<void> => {
    if (!window.confirm(`Удалить учётную запись ${email}? Локальный кеш писем будет удалён.`)) return
    const { accounts: list } = useStore.getState()
    const account = list.find((item) => item.id === id)
    if (!account) return
    await window.kurier.accounts.remove(id)
    const next = await window.kurier.accounts.list()
    const folders = await window.kurier.folders.list()
    useStore.setState({ accounts: next, folders, view: next.length > 0 ? 'settings' : 'setup' })
  }

  return (
    <div className="settings-backdrop">
      <div className="settings">
        <header className="settings-head">
          <h1>Настройки</h1>
          <button className="icon-btn" onClick={closeOverlay} title="Закрыть">
            <Icon name="close" size={19} />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav">
            <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
              <Icon name="mail" size={16} /> Учётные записи
            </button>
            <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
              <Icon name="palette" size={16} /> Интерфейс
            </button>
            <button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}>
              <Icon name="shield" size={16} /> Политики
            </button>
            <button className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}>
              <Icon name="cloud" size={16} /> Хранилище
            </button>
            <button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>
              <Icon name="download" size={16} /> Обновления
            </button>
            <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
              <Icon name="info" size={16} /> О программе
            </button>
          </nav>

          <div className="settings-content">
            {tab === 'accounts' && (
              <section>
                <h2>Почтовые ящики</h2>
                {accounts.length === 0 && <p className="dim">Пока нет ни одной учётной записи.</p>}
                <div className="account-cards">
                  {accounts.map((account) => (
                    <div key={account.id} className="account-card">
                      <span className="account-dot" style={{ background: account.color }} />
                      <div className="account-card-main">
                        <strong>{account.displayName || account.email}</strong>
                        <span className="dim small">{account.email}</span>
                        <span className="dim small">
                          IMAP {account.imap.host}:{account.imap.port} · SMTP {account.smtp.host}:
                          {account.smtp.port} · {account.authKind === 'oauth2' ? 'OAuth2' : 'пароль'}
                        </span>
                      </div>
                      {allowManage && (
                        <>
                        <button
                          className="btn ghost compact"
                          onClick={() => openSetup(account)}
                        >
                          Изменить
                        </button>
                        <button
                          className="link-btn"
                          onClick={() => void removeAccount(account.id, account.email)}
                        >
                          Удалить
                        </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {allowManage ? (
                  <button className="btn" onClick={() => openSetup()}>
                    <Icon name="plus" size={16} /> Добавить ящик
                  </button>
                ) : (
                  <div className="notice">
                    <Icon name="lock" size={15} /> Добавление ящиков заблокировано администратором.
                  </div>
                )}
              </section>
            )}

            {tab === 'appearance' && (
              <section>
                <h2>Интерфейс</h2>
                <label className="field">
                  <span>Тема</span>
                  <select
                    value={settings?.theme ?? 'system'}
                    onChange={(event) => void updateSettings({ theme: event.target.value as 'system' })}
                  >
                    <option value="system">Как в системе</option>
                    <option value="dark">Тёмная</option>
                    <option value="light">Светлая</option>
                  </select>
                </label>
                <label className="field">
                  <span>Плотность списка</span>
                  <select
                    value={settings?.density ?? 'comfortable'}
                    onChange={(event) => void updateSettings({ density: event.target.value as 'comfortable' })}
                  >
                    <option value="comfortable">Комфортная</option>
                    <option value="compact">Компактная</option>
                  </select>
                </label>
              </section>
            )}

            {tab === 'security' && (
              <section>
                <h2>Политики организации</h2>
                <div className={`notice ${policy.managed ? 'ok' : ''}`}>
                  <Icon name={policy.managed ? 'shield' : 'warning'} size={15} />
                  {policy.managed
                    ? `Активны ${policy.locked.length} управляемых настроек (${policy.source}).`
                    : 'Политики не применены — используются локальные настройки.'}
                </div>
                <div className="policy-table">
                  {POLICY_DEFINITIONS.map((definition) => {
                    const locked = policy.locked.includes(definition.key)
                    if (!locked) return null
                    return (
                      <div key={definition.key} className="policy-row">
                        <div>
                          <div>{definition.title.ru}</div>
                          <div className="dim small">{definition.description.ru}</div>
                        </div>
                        <div className="policy-value">{formatPolicyValue(policy.values[definition.key])}</div>
                      </div>
                    )
                  })}
                  {policy.locked.length === 0 && <p className="dim">Нет управляемых настроек.</p>}
                </div>
                {policy.errors.length > 0 && (
                  <div className="form-error">{policy.errors.join('; ')}</div>
                )}
              </section>
            )}

            {tab === 'updates' && (
              <section>
                <h2>Обновления</h2>
                <div className="updater-card">
                  <div>
                    <strong>GG Email {appInfo?.version}</strong>
                    <div className="dim small">
                      Канал: {String(policy.values.updateChannel ?? 'stable')} · режим:{' '}
                      {String(policy.values.updateMode ?? 'auto')}
                    </div>
                    <div className="dim small">
                      {updater.status === 'idle' && 'Обновления не найдены'}
                      {updater.status === 'checking' && 'Проверка…'}
                      {updater.status === 'available' && `Доступна версия ${updater.version}`}
                      {updater.status === 'downloading' && `Загрузка ${updater.percent ?? 0}%`}
                      {updater.status === 'ready' && `Версия ${updater.version} готова к установке`}
                      {updater.status === 'error' && `Ошибка: ${updater.error}`}
                      {updater.status === 'disabled' && 'Автообновление отключено'}
                    </div>
                  </div>
                  <div className="updater-actions">
                    <button className="btn" onClick={() => void checkUpdates()}>
                      Проверить
                    </button>
                    {updater.status === 'ready' && (
                      <button className="btn primary" onClick={() => void installUpdate()}>
                        Установить
                      </button>
                    )}
                  </div>
                </div>
                <p className="dim small">
                  Обновления устанавливаются в профиль пользователя (%LOCALAPPDATA%\Programs\GG Email)
                  и не требуют прав администратора. Администратор управляет каналом, интервалом и
                  отсрочкой через групповые политики.
                </p>
              </section>
            )}

            {tab === 'storage' && (
              <section>
                <h2>Кеш и хранилище</h2>
                <div className="storage-cards">
                  <div className="storage-card"><span>База данных</span><strong>{formatSize(stats?.dbBytes ?? 0)}</strong></div>
                  <div className="storage-card"><span>Тела писем</span><strong>{formatSize(stats?.bodyBytes ?? 0)}</strong></div>
                  <div className="storage-card"><span>Вложения</span><strong>{formatSize(stats?.attachmentsBytes ?? 0)}</strong></div>
                  <div className="storage-card"><span>Всего</span><strong>{formatSize(stats?.totalBytes ?? 0)}</strong></div>
                </div>
                <p className="dim small">
                  Заголовки писем хранятся всегда, а тела и вложения можно удалить — они загрузятся заново при открытии письма.
                </p>
                <div className="policy-table">
                  <div className="policy-row"><div>Лимит кеша</div><div className="policy-value">{String(policy.values.maxCacheSizeMb ?? '—')} МБ</div></div>
                  <div className="policy-row"><div>Срок хранения тел</div><div className="policy-value">{String(policy.values.cacheRetentionDays ?? '—')} дн.</div></div>
                  <div className="policy-row"><div>Писем в кеше</div><div className="policy-value">{stats?.messages ?? 0}</div></div>
                </div>
                <div className="button-row">
                  <button className="btn" onClick={() => void refreshStats()}>Обновить</button>
                  <button className="btn" onClick={() => void clearBodies()}>Удалить тела писем</button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      if (window.confirm('Очистить весь кеш? Письма останутся на сервере.')) void clearCache()
                    }}
                  >
                    Очистить весь кеш
                  </button>
                </div>
              </section>
            )}

            {tab === 'about' && (
              <section>
                <h2>О программе</h2>
                <dl className="about-list">
                  <dt>Версия</dt>
                  <dd>{appInfo?.version}</dd>
                  <dt>Electron</dt>
                  <dd>{appInfo?.electron}</dd>
                  <dt>Chromium</dt>
                  <dd>{appInfo?.chrome}</dd>
                  <dt>Node.js</dt>
                  <dd>{appInfo?.node}</dd>
                  <dt>Платформа</dt>
                  <dd>{appInfo?.platform} {appInfo?.arch}</dd>
                  <dt>Данные</dt>
                  <dd className="mono">{appInfo?.dataPath}</dd>
                </dl>
                <div className="button-row">
                  <button className="btn" onClick={() => void window.kurier.app.openDataFolder()}>
                    <Icon name="folder" size={15} /> Открыть папку данных
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      if (window.confirm('Очистить локальный кеш писем? Данные на сервере не изменятся.')) {
                        void clearCache()
                      }
                    }}
                  >
                    <Icon name="trash-empty" size={15} /> Очистить кеш
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
