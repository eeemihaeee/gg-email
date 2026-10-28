import { useStore } from '../store'
import { initials } from '../lib/format'

/**
 * «Сферы» ящиков в шапке: быстрый переход к входящим конкретного аккаунта.
 * Позволяет не смешивать всю почту в одном общем списке.
 */
export default function AccountSwitcher(): React.JSX.Element | null {
  const accounts = useStore((state) => state.accounts)
  const folders = useStore((state) => state.folders)
  const selection = useStore((state) => state.selection)
  const policy = useStore((state) => state.policy)
  const selectUnified = useStore((state) => state.selectUnified)
  const openSetup = useStore((state) => state.openSetup)

  if (accounts.length === 0) return null

  const unreadFor = (accountId: string): number =>
    folders
      .filter((folder) => folder.accountId === accountId && folder.role === 'inbox')
      .reduce((sum, folder) => sum + folder.unread, 0)

  const allowAdd = policy.values.allowAccountManagement !== false

  return (
    <div className="account-switcher" role="tablist" aria-label="Почтовые ящики">
      {accounts.map((account) => {
        const unread = unreadFor(account.id)
        const active =
          selection.kind === 'unified' && selection.accountId === account.id
        return (
          <button
            key={account.id}
            role="tab"
            aria-selected={active}
            className={`account-sphere ${active ? 'active' : ''}`}
            style={{ '--sphere-color': account.color } as React.CSSProperties}
            title={`${account.displayName || account.email}\n${account.email}${
              unread > 0 ? `\nНепрочитанных: ${unread}` : ''
            }`}
            onClick={() => void selectUnified(account.id)}
          >
            <span className="sphere-initials">{initials(account.displayName || account.email)}</span>
            {unread > 0 && <span className="sphere-badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        )
      })}
      {allowAdd && (
        <button
          className="account-sphere add"
          title="Добавить почтовый ящик"
          onClick={() => openSetup()}
        >
          +
        </button>
      )}
    </div>
  )
}
