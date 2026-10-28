import { useStore } from '../store'
import { Icon } from './Icon'

interface DomainGroup {
  domain: string
  color: string
  unread: number
  accounts: number
}

/** Официальные логотипы (Simple Icons): Gmail и Mail.ru. */
const GMAIL_PATH =
  'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z'

const MAILRU_PATH =
  'M15.61 12c0 1.99-1.62 3.61-3.61 3.61-1.99 0-3.61-1.62-3.61-3.61 0-1.99 1.62-3.61 3.61-3.61 1.99 0 3.61 1.62 3.61 3.61M12 0C5.383 0 0 5.383 0 12s5.383 12 12 12c2.424 0 4.761-.722 6.76-2.087l.034-.024-1.617-1.879-.027.017A9.494 9.494 0 0 1 12 21.54c-5.26 0-9.54-4.28-9.54-9.54 0-5.26 4.28-9.54 9.54-9.54 5.26 0 9.54 4.28 9.54 9.54a9.63 9.63 0 0 1-.225 2.05c-.301 1.239-1.169 1.618-1.82 1.568-.654-.053-1.42-.52-1.426-1.661V12A6.076 6.076 0 0 0 12 5.93 6.076 6.076 0 0 0 5.93 12 6.076 6.076 0 0 0 12 18.07a6.02 6.02 0 0 0 4.3-1.792 3.9 3.9 0 0 0 3.32 1.805c.874 0 1.74-.292 2.437-.821.719-.547 1.256-1.336 1.553-2.285.047-.154.135-.504.135-.507l.002-.013c.175-.76.253-1.52.253-2.457 0-6.617-5.383-12-12-12'

function brandFor(domain: string): { kind: 'gmail' | 'mailru' | 'yandex' | 'generic'; color: string } {
  const value = domain.toLowerCase()
  if (value === 'gmail.com' || value === 'googlemail.com') return { kind: 'gmail', color: '#ea4335' }
  if (['mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'internet.ru'].includes(value)) {
    return { kind: 'mailru', color: '#005ff9' }
  }
  if (value.startsWith('yandex.') || value === 'ya.ru') return { kind: 'yandex', color: '#fc3f1d' }
  return { kind: 'generic', color: '' }
}

/**
 * Фильтр по домену: круглые кнопки-логотипы (itxr, gmail, yandex, mail.ru…).
 * Показывает входящие всех ящиков выбранного домена.
 */
export default function DomainSwitcher(): React.JSX.Element | null {
  const accounts = useStore((state) => state.accounts)
  const folders = useStore((state) => state.folders)
  const selection = useStore((state) => state.selection)
  const policy = useStore((state) => state.policy)
  const selectDomain = useStore((state) => state.selectDomain)
  const selectUnified = useStore((state) => state.selectUnified)
  const openSetup = useStore((state) => state.openSetup)

  if (accounts.length === 0) return null

  const groups = new Map<string, DomainGroup>()
  for (const account of accounts) {
    const domain = account.email.split('@')[1]?.toLowerCase()
    if (!domain) continue
    const group = groups.get(domain) ?? {
      domain,
      color: account.color,
      unread: 0,
      accounts: 0
    }
    group.accounts += 1
    group.unread += folders
      .filter((folder) => folder.accountId === account.id && folder.role === 'inbox')
      .reduce((sum, folder) => sum + folder.unread, 0)
    groups.set(domain, group)
  }

  const allowAdd = policy.values.allowAccountManagement !== false
  const allActive =
    selection.kind === 'unified' && !selection.domain && !selection.accountId

  return (
    <div className="domain-chips" role="tablist" aria-label="Фильтр по домену">
      <button
        className={`domain-chip ${allActive ? 'active' : ''}`}
        onClick={() => void selectUnified(undefined)}
        title="Все входящие (все домены)"
      >
        <Icon name="inbox" size={15} />
      </button>

      {Array.from(groups.values()).map((group) => {
        const active = selection.kind === 'unified' && selection.domain === group.domain
        const brand = brandFor(group.domain)
        const color = brand.kind === 'generic' ? group.color : brand.color
        return (
          <button
            key={group.domain}
            className={`domain-chip ${active ? 'active' : ''}`}
            style={{ '--chip-color': color } as React.CSSProperties}
            onClick={() => void selectDomain(group.domain)}
            title={`${group.domain} · ${group.accounts} ${
              group.accounts === 1 ? 'ящик' : 'ящика'
            }${group.unread > 0 ? ` · непрочитанных: ${group.unread}` : ''}`}
          >
            <span className="domain-mark" style={{ background: '#ffffff' }}>
              {brand.kind === 'gmail' && (
                <svg viewBox="0 0 24 24" className="brand-svg" aria-hidden="true">
                  <path d={GMAIL_PATH} fill="#ea4335" />
                </svg>
              )}
              {brand.kind === 'mailru' && (
                <svg viewBox="0 0 24 24" className="brand-svg" aria-hidden="true">
                  <path d={MAILRU_PATH} fill="#005ff9" />
                </svg>
              )}
              {brand.kind === 'yandex' && (
                <span className="brand-letter" style={{ color: '#fc3f1d' }}>
                  Я
                </span>
              )}
              {brand.kind === 'generic' && (
                <span
                  className="brand-letter"
                  style={{
                    color: group.color,
                    background: `color-mix(in srgb, ${group.color} 12%, #ffffff)`,
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%'
                  }}
                >
                  {group.domain.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            {group.unread > 0 && (
              <span className="domain-badge">{group.unread > 99 ? '99+' : group.unread}</span>
            )}
          </button>
        )
      })}

      {allowAdd && (
        <button className="domain-chip add" title="Добавить почтовый ящик" onClick={() => openSetup()}>
          +
        </button>
      )}
    </div>
  )
}
