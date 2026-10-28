import { useStore } from '../store'
import { Icon } from './Icon'

interface DomainGroup {
  domain: string
  color: string
  unread: number
  accounts: number
}

interface Mark {
  label: string
  color: string
  background: string
  weight?: number
}

/** Простая «иконка» провайдера: буква в фирменном цвете. */
function markFor(domain: string, fallbackColor: string): Mark {
  const value = domain.toLowerCase()
  if (value === 'gmail.com' || value === 'googlemail.com') {
    return { label: 'M', color: '#ea4335', background: '#ffffff', weight: 800 }
  }
  if (value.startsWith('yandex.') || value === 'ya.ru') {
    return { label: 'Я', color: '#fc3f1d', background: '#ffffff', weight: 800 }
  }
  if (['mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'internet.ru'].includes(value)) {
    return { label: '@', color: '#005ff9', background: '#ffffff', weight: 700 }
  }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(value)) {
    return { label: 'O', color: '#0078d4', background: '#ffffff', weight: 700 }
  }
  return {
    label: value.charAt(0).toUpperCase(),
    color: fallbackColor,
    background: 'color-mix(in srgb, ' + fallbackColor + ' 14%, #ffffff)'
  }
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
        const mark = markFor(group.domain, group.color)
        return (
          <button
            key={group.domain}
            className={`domain-chip ${active ? 'active' : ''}`}
            style={{ '--chip-color': mark.color } as React.CSSProperties}
            onClick={() => void selectDomain(group.domain)}
            title={`${group.domain} · ${group.accounts} ${
              group.accounts === 1 ? 'ящик' : 'ящика'
            }${group.unread > 0 ? ` · непрочитанных: ${group.unread}` : ''}`}
          >
            <span
              className="domain-mark"
              style={{
                color: mark.color,
                background: mark.background,
                fontWeight: mark.weight ?? 600
              }}
            >
              {mark.label}
            </span>
            {group.unread > 0 && (
              <span className="domain-badge">{group.unread > 99 ? '99+' : group.unread}</span>
            )}
          </button>
        )
      })}

      {allowAdd && (
        <button className="domain-chip add" title="Добавить почтовый ящик" onClick={openSetup}>
          +
        </button>
      )}
    </div>
  )
}
