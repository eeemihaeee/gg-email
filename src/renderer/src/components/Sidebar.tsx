import { useState } from 'react'
import type { Account, Folder, FolderRole } from '@shared/types'
import { useStore } from '../store'
import { Icon, type IconName } from './Icon'

const ROLE_ORDER: FolderRole[] = ['inbox', 'drafts', 'sent', 'junk', 'archive', 'trash']

const ROLE_ICON: Record<FolderRole, IconName> = {
  inbox: 'inbox',
  drafts: 'draft',
  sent: 'send',
  junk: 'junk',
  archive: 'archive',
  trash: 'trash',
  outbox: 'send',
  other: 'folder'
}

const ROLE_LABEL: Record<FolderRole, string> = {
  inbox: 'Входящие',
  drafts: 'Черновики',
  sent: 'Отправленные',
  junk: 'Спам',
  archive: 'Архив',
  trash: 'Корзина',
  outbox: 'Исходящие',
  other: 'Папка'
}

function isActive(
  selection: ReturnType<typeof useStore.getState>['selection'],
  folder?: Folder,
  accountId?: string
): boolean {
  if (folder) return selection.kind === 'folder' && selection.folderId === folder.id
  return selection.kind === 'unified' && selection.accountId === accountId
}

function AccountSection({ account }: { account: Account }): React.JSX.Element {
  const folders = useStore((state) => state.folders)
  const selection = useStore((state) => state.selection)
  const sync = useStore((state) => state.sync[account.id])
  const selectFolder = useStore((state) => state.selectFolder)
  const selectUnified = useStore((state) => state.selectUnified)
  const [expanded, setExpanded] = useState(false)

  const accountFolders = folders.filter((folder) => folder.accountId === account.id)
  const byRole = new Map<FolderRole, Folder>()
  for (const folder of accountFolders) {
    if (!byRole.has(folder.role) || folder.role === 'inbox') byRole.set(folder.role, folder)
  }
  const known = ROLE_ORDER.map((role) => byRole.get(role)).filter(Boolean) as Folder[]
  const others = accountFolders.filter((folder) => !ROLE_ORDER.includes(folder.role))
  const inbox = byRole.get('inbox')
  const unread = inbox?.unread ?? 0

  return (
    <div className="account">
      <button
        className={`account-head ${isActive(selection, undefined, account.id) ? 'active' : ''}`}
        onClick={() => void selectUnified(account.id)}
        title={`${account.email} — все входящие`}
      >
        <span className="account-dot" style={{ background: account.color }} />
        <span className="account-email">{account.displayName || account.email}</span>
        {sync && (sync.phase === 'syncing' || sync.phase === 'connecting') && (
          <Icon name="spinner" size={13} className="spin dim" />
        )}
        {sync?.phase === 'offline' && <Icon name="warning" size={13} className="warn" />}
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>

      <div className="folder-list">
        {known.map((folder) => {
          const active = isActive(selection, folder)
          return (
            <button
              key={folder.id}
              className={`folder-row role-${folder.role} ${active ? 'active' : ''}`}
              onClick={() => void selectFolder(folder.id)}
              title={folder.path}
            >
              <Icon name={ROLE_ICON[folder.role]} size={16} />
              <span className="folder-name">{ROLE_LABEL[folder.role]}</span>
              {folder.role === 'inbox' && folder.unread > 0 && (
                <span className="count">{folder.unread}</span>
              )}
            </button>
          )
        })}

        {others.length > 0 && (
          <button className="folder-row subtle" onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
            <span className="folder-name">Другие папки</span>
            <span className="count subtle-count">{others.length}</span>
          </button>
        )}

        {expanded &&
          others.map((folder) => (
            <button
              key={folder.id}
              className={`folder-row nested ${isActive(selection, folder) ? 'active' : ''}`}
              onClick={() => void selectFolder(folder.id)}
              title={folder.path}
            >
              <Icon name="folder" size={15} />
              <span className="folder-name">{folder.name}</span>
              {folder.unread > 0 && <span className="count">{folder.unread}</span>}
            </button>
          ))}
      </div>
    </div>
  )
}

export default function Sidebar(): React.JSX.Element {
  const allAccounts = useStore((state) => state.accounts)
  const folders = useStore((state) => state.folders)
  const selection = useStore((state) => state.selection)
  const policy = useStore((state) => state.policy)
  const openSetup = useStore((state) => state.openSetup)
  const openSettings = useStore((state) => state.openSettings)
  const selectUnified = useStore((state) => state.selectUnified)

  const accounts = selection.domain
    ? allAccounts.filter((account) =>
        account.email.toLowerCase().endsWith('@' + selection.domain!.toLowerCase())
      )
    : allAccounts

  const unifiedUnread = folders
    .filter((folder) => folder.role === 'inbox')
    .reduce((sum, folder) => sum + folder.unread, 0)

  const allowAdd = policy.values.allowAccountManagement !== false
  const showBanner = policy.managed && policy.values.showPolicyBanner !== false

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <button
          className={`unified-row ${selection.kind === 'unified' && !selection.accountId ? 'active' : ''}`}
          onClick={() => void selectUnified(undefined)}
        >
          <Icon name="mail" size={17} />
          <span className="folder-name">Все входящие</span>
          {unifiedUnread > 0 && <span className="badge">{unifiedUnread}</span>}
        </button>

        <div className="sidebar-section-title">Учётные записи</div>
        {accounts.map((account) => (
          <AccountSection key={account.id} account={account} />
        ))}

        {accounts.length === 0 && (
          <div className="empty-hint">
            Добавьте почтовый ящик, чтобы начать работу.
          </div>
        )}

        {allowAdd && (
          <button className="add-account" onClick={() => openSetup()}>
            <Icon name="plus" size={16} />
            <span>Добавить учётную запись</span>
          </button>
        )}
      </div>

      <div className="sidebar-footer">
        {showBanner && (
          <div className="policy-hint" title={policy.errors.join('\n') || undefined}>
            <Icon name="shield" size={15} />
            <span>Политики организации</span>
          </div>
        )}
        <button className="footer-link" onClick={openSettings}>
          <Icon name="settings" size={16} />
          <span>Настройки</span>
        </button>
      </div>
    </aside>
  )
}
