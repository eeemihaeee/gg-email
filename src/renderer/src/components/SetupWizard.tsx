import { useState } from 'react'
import type { AccountInput, AutoconfigResult, SecurityMode } from '@shared/types'
import { useStore } from '../store'
import { Icon } from './Icon'
import { SECURITY_LABEL, presetForEmail } from '@shared/providers'

type Step = 'email' | 'server' | 'done'

interface FormState {
  email: string
  displayName: string
  password: string
  username: string
  imapHost: string
  imapPort: number
  imapSecurity: SecurityMode
  smtpHost: string
  smtpPort: number
  smtpSecurity: SecurityMode
  authKind: 'password' | 'oauth2'
  oauthProvider?: 'google' | 'yandex'
  source: string
}

const EMPTY: FormState = {
  email: '',
  displayName: '',
  password: '',
  username: '',
  imapHost: '',
  imapPort: 993,
  imapSecurity: 'tls',
  smtpHost: '',
  smtpPort: 465,
  smtpSecurity: 'tls',
  authKind: 'password',
  source: ''
}

export default function SetupWizard(): React.JSX.Element {
  const accounts = useStore((state) => state.accounts)
  const policy = useStore((state) => state.policy)
  const closeOverlay = useStore((state) => state.closeOverlay)
  const addAccount = useStore((state) => state.addAccount)
  const pushToast = useStore((state) => state.pushToast)

  const [step, setStep] = useState<Step>('email')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const patch = (values: Partial<FormState>): void => setForm((current) => ({ ...current, ...values }))

  const applyAutoconfig = (result: AutoconfigResult): void => {
    patch({
      imapHost: result.imap.host,
      imapPort: result.imap.port,
      imapSecurity: result.imap.security,
      smtpHost: result.smtp.host,
      smtpPort: result.smtp.port,
      smtpSecurity: result.smtp.security,
      username: result.username,
      authKind: result.oauthProvider ? 'oauth2' : 'password',
      oauthProvider: result.oauthProvider,
      source: result.source
    })
  }

  const discover = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const result = await window.kurier.accounts.autoconfigure(form.email.trim())
      if (result) {
        applyAutoconfig(result)
        setStep('server')
      } else {
        const preset = presetForEmail(form.email)
        patch({
          imapHost: form.imapHost || `imap.${form.email.split('@')[1] ?? ''}`,
          smtpHost: form.smtpHost || `smtp.${form.email.split('@')[1] ?? ''}`,
          username: form.email,
          authKind: preset?.authKind ?? 'password',
          oauthProvider: preset?.oauthProvider,
          source: 'guess'
        })
        setAdvanced(true)
        setStep('server')
        setError('Автонастройка не найдена — проверьте серверы вручную')
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const oauthLogin = async (): Promise<void> => {
    const provider = form.oauthProvider ?? (form.email.endsWith('@gmail.com') ? 'google' : 'yandex')
    setBusy(true)
    setError(null)
    try {
      const result = await window.kurier.oauth.start(provider, form.email)
      if (!result.ok || !result.refreshToken) {
        setError(result.error ?? 'Не удалось войти через OAuth2')
        return
      }
      patch({
        authKind: 'oauth2',
        oauthProvider: provider,
        password: result.refreshToken
      })
      pushToast('success', 'Вход выполнен, можно сохранить учётную запись')
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setTestResult(null)
    try {
      const input = toInput()
      const result = await window.kurier.accounts.test(input)
      const parts: string[] = []
      parts.push(result.imap?.ok ? 'IMAP: подключение успешно' : `IMAP: ${result.imap?.error ?? 'ошибка'}`)
      parts.push(result.smtp?.ok ? 'SMTP: подключение успешно' : `SMTP: ${result.smtp?.error ?? 'ошибка'}`)
      setTestResult(parts.join(' · '))
      if (!result.ok) setError('Одно из подключений не удалось — проверьте настройки и пароль')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function toInput(): AccountInput {
    return {
      email: form.email.trim(),
      displayName: form.displayName.trim() || form.email.trim(),
      password: form.password || undefined,
      imap: { host: form.imapHost.trim(), port: Number(form.imapPort), security: form.imapSecurity },
      smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort), security: form.smtpSecurity },
      username: form.username.trim() || form.email.trim(),
      authKind: form.authKind,
      oauthProvider: form.oauthProvider
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await addAccount(toInput())
      setStep('done')
      pushToast('success', 'Учётная запись добавлена, идёт синхронизация')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const oauthConfigured =
    (form.oauthProvider === 'google' && Boolean(policy.values.googleClientId)) ||
    (form.oauthProvider === 'yandex' && Boolean(policy.values.yandexClientId))

  return (
    <div className="modal-backdrop">
      <div className="wizard">
        <header className="wizard-head">
          <div>
            <div className="eyebrow">Настройка</div>
            <h1>Добавление почтового ящика</h1>
          </div>
          {accounts.length > 0 && (
            <button className="icon-btn" onClick={closeOverlay} title="Закрыть">
              <Icon name="close" size={18} />
            </button>
          )}
        </header>

        <div className="wizard-steps">
          <span className={step === 'email' ? 'active' : 'done'}>1. Адрес</span>
          <span className={step === 'server' ? 'active' : step === 'done' ? 'done' : ''}>2. Серверы</span>
          <span className={step === 'done' ? 'active' : ''}>3. Готово</span>
        </div>

        {step === 'email' && (
          <div className="wizard-body">
            <p className="dim">
              GG Email поддерживает mailcow, Gmail, Яндекс, Mail.ru и любой сервер IMAP/SMTP.
              Настройки серверов подставятся автоматически.
            </p>
            <label className="field">
              <span>Адрес электронной почты</span>
              <input
                autoFocus
                type="email"
                value={form.email}
                placeholder="ivanov@example.com"
                onChange={(event) => patch({ email: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && form.email.includes('@')) void discover()
                }}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Отображаемое имя</span>
              <input
                value={form.displayName}
                placeholder="Иван Иванов"
                onChange={(event) => patch({ displayName: event.target.value })}
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="wizard-actions">
              <span className="flex-spacer" />
              <button className="btn primary" onClick={() => void discover()} disabled={!form.email.includes('@') || busy}>
                {busy ? 'Поиск настроек…' : 'Продолжить'}
              </button>
            </div>
          </div>
        )}

        {step === 'server' && (
          <div className="wizard-body">
            <div className="server-summary">
              <div>
                <div className="server-label">IMAP</div>
                <div>{form.imapHost}:{form.imapPort} · {SECURITY_LABEL[form.imapSecurity]}</div>
              </div>
              <div>
                <div className="server-label">SMTP</div>
                <div>{form.smtpHost}:{form.smtpPort} · {SECURITY_LABEL[form.smtpSecurity]}</div>
              </div>
              <span className="dim small">
                {form.source === 'builtin-preset'
                  ? 'известный провайдер'
                  : form.source === 'policy-autoconfig'
                    ? 'внутренняя автонастройка'
                    : form.source === 'guess'
                      ? 'предположение'
                      : 'автонастройка'}
              </span>
            </div>

            {form.authKind === 'oauth2' && oauthConfigured && (
              <div className="oauth-box">
                <div>
                  <strong>Вход через OAuth2</strong>
                  <p className="dim small">
                    Рекомендуется для Gmail и Яндекс.Почты: пароль приложения не требуется.
                  </p>
                </div>
                <button className="btn" onClick={() => void oauthLogin()} disabled={busy}>
                  Войти
                </button>
              </div>
            )}

            <label className="field">
              <span>{form.authKind === 'oauth2' ? 'Токен (заполнится после входа)' : 'Пароль приложения'}</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => patch({ password: event.target.value })}
                placeholder={form.authKind === 'oauth2' ? 'нажмите «Войти»' : 'пароль'}
              />
            </label>

            <button className="link-toggle" onClick={() => setAdvanced(!advanced)}>
              <Icon name={advanced ? 'chevron-down' : 'chevron-right'} size={14} /> Дополнительные настройки
            </button>

            {advanced && (
              <div className="advanced-grid">
                <label className="field">
                  <span>IMAP сервер</span>
                  <input value={form.imapHost} onChange={(event) => patch({ imapHost: event.target.value })} spellCheck={false} />
                </label>
                <label className="field narrow">
                  <span>Порт</span>
                  <input
                    type="number"
                    value={form.imapPort}
                    onChange={(event) => patch({ imapPort: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Шифрование</span>
                  <select
                    value={form.imapSecurity}
                    onChange={(event) => patch({ imapSecurity: event.target.value as SecurityMode })}
                  >
                    <option value="tls">SSL/TLS</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="none">Без шифрования</option>
                  </select>
                </label>
                <label className="field">
                  <span>SMTP сервер</span>
                  <input value={form.smtpHost} onChange={(event) => patch({ smtpHost: event.target.value })} spellCheck={false} />
                </label>
                <label className="field narrow">
                  <span>Порт</span>
                  <input
                    type="number"
                    value={form.smtpPort}
                    onChange={(event) => patch({ smtpPort: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Шифрование</span>
                  <select
                    value={form.smtpSecurity}
                    onChange={(event) => patch({ smtpSecurity: event.target.value as SecurityMode })}
                  >
                    <option value="tls">SSL/TLS</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="none">Без шифрования</option>
                  </select>
                </label>
                <label className="field wide">
                  <span>Имя пользователя</span>
                  <input value={form.username} onChange={(event) => patch({ username: event.target.value })} spellCheck={false} />
                </label>
              </div>
            )}

            {testResult && <div className="form-info">{testResult}</div>}
            {error && <div className="form-error">{error}</div>}

            <div className="wizard-actions">
              <button className="btn ghost" onClick={() => setStep('email')}>
                Назад
              </button>
              <button className="btn" onClick={() => void test()} disabled={busy}>
                Проверить подключение
              </button>
              <span className="flex-spacer" />
              <button
                className="btn primary"
                onClick={() => void save()}
                disabled={busy || !form.password || !form.imapHost || !form.smtpHost}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="wizard-body centered">
            <div className="done-icon">
              <Icon name="check" size={30} />
            </div>
            <h2>Ящик добавлен</h2>
            <p className="dim">
              GG Email загружает заголовки писем в локальный кеш. Это занимает несколько секунд,
              интерфейс уже доступен.
            </p>
            <button className="btn primary" onClick={closeOverlay}>
              Перейти к почте
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
