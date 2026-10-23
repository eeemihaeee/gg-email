/**
 * Демонстрационный режим для документации и визуальных проверок.
 * Включается только в браузере (без Electron) при ?demo=1 и подменяет
 * window.kurier полностью синтетическими данными — в продакшене не используется.
 */
import type { KurierApi } from '@shared/ipc'
import type {
  Account,
  Folder,
  MessageDetail,
  MessageFlags,
  MessageSummary,
  PolicyState
} from '@shared/types'

const now = Date.now()
const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const accounts: Account[] = [
  {
    id: 'acc-1',
    email: 'i.petrov@company.ru',
    displayName: 'Иван Петров',
    color: '#4c8dff',
    imap: { host: 'mail.company.ru', port: 993, security: 'tls' },
    smtp: { host: 'mail.company.ru', port: 465, security: 'tls' },
    username: 'i.petrov@company.ru',
    authKind: 'password',
    sortOrder: 0,
    disabled: false,
    createdAt: now - 90 * day
  },
  {
    id: 'acc-2',
    email: 'm.sokolova@company.ru',
    displayName: 'Мария Соколова',
    color: '#3ddc84',
    imap: { host: 'mail.company.ru', port: 993, security: 'tls' },
    smtp: { host: 'mail.company.ru', port: 465, security: 'tls' },
    username: 'm.sokolova@company.ru',
    authKind: 'password',
    sortOrder: 1,
    disabled: false,
    createdAt: now - 60 * day
  },
  {
    id: 'acc-3',
    email: 'ivan.petrov@gmail.com',
    displayName: 'Личная почта',
    color: '#ff5d5d',
    imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    username: 'ivan.petrov@gmail.com',
    authKind: 'oauth2',
    oauthProvider: 'google',
    sortOrder: 2,
    disabled: false,
    createdAt: now - 30 * day
  }
]

interface DemoFolder extends Folder {
  role: Folder['role']
}

function makeFolders(accountId: string, unread: number, total: number): DemoFolder[] {
  const base = [
    { role: 'inbox', name: 'Входящие', path: 'INBOX' },
    { role: 'drafts', name: 'Черновики', path: 'Drafts' },
    { role: 'sent', name: 'Отправленные', path: 'Sent' },
    { role: 'junk', name: 'Спам', path: 'Junk' },
    { role: 'archive', name: 'Архив', path: 'Archive' },
    { role: 'trash', name: 'Корзина', path: 'Trash' }
  ] as const
  return base.map((folder, index) => ({
    id: `${accountId}-${folder.role}`,
    accountId,
    path: folder.path,
    name: folder.name,
    delimiter: '/',
    role: folder.role,
    total: folder.role === 'inbox' ? total : Math.round(total / 3),
    unread: folder.role === 'inbox' ? unread : 0,
    uidValidity: 1,
    uidNext: 100 + index,
    highestModseq: 0,
    lastSyncAt: now - 2 * minute
  }))
}

const folders: Folder[] = [
  ...makeFolders('acc-1', 3, 148),
  ...makeFolders('acc-2', 1, 47),
  ...makeFolders('acc-3', 2, 12),
  {
    id: 'acc-1-projects',
    accountId: 'acc-1',
    path: 'Projects/1C',
    name: '1C',
    delimiter: '/',
    role: 'other',
    total: 24,
    unread: 0,
    uidValidity: 1,
    uidNext: 25,
    highestModseq: 0,
    lastSyncAt: now - hour
  }
]

interface DemoMessage {
  id: string
  accountId: string
  folderId: string
  folderPath: string
  uid: number
  from: { name: string; email: string }[]
  to: { name: string; email: string }[]
  subject: string
  date: number
  snippet: string
  flags: MessageFlags
  hasAttachments?: boolean
  html: string
  text: string
}

const flag = (seen: boolean, flagged = false, hasAttachments = false): MessageFlags => ({
  seen,
  flagged,
  answered: false,
  forwarded: false,
  draft: false,
  deleted: false,
  ...(hasAttachments ? {} : {})
})

function body(paragraphs: string[], signature = 'С уважением,\nИван Петров\nОтдел ИТ-инфраструктуры\n+7 (343) 000-00-00'): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2328">
    ${paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('')}
    <p style="margin:18px 0 0;color:#5b6470;white-space:pre-line">${signature}</p>
  </div>`
}

const demoMessages: DemoMessage[] = [
  {
    id: 'm1',
    accountId: 'acc-1',
    folderId: 'acc-1-inbox',
    folderPath: 'INBOX',
    uid: 141,
    from: [{ name: 'Анна Ковалёва', email: 'a.kovaleva@company.ru' }],
    to: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    subject: 'Согласование бюджета на Q4',
    date: now - 12 * minute,
    snippet: 'Иван, добрый день! Направляю обновлённую смету на четвёртый квартал — с учётом закупки',
    flags: flag(false, true),
    hasAttachments: true,
    html: body([
      'Иван, добрый день!',
      'Направляю обновлённую смету на четвёртый квартал — с учётом закупки серверного оборудования и продления поддержки mailcow. Основные изменения выделил в таблице.',
      'Прошу посмотреть до пятницы: если всё согласовано, отправлю на подпись финансовому директору.'
    ], 'С уважением,\nАнна Ковалёва\nФинансовый отдел'),
    text: 'Иван, добрый день! Направляю обновлённую смету на четвёртый квартал...'
  },
  {
    id: 'm2',
    accountId: 'acc-2',
    folderId: 'acc-2-inbox',
    folderPath: 'INBOX',
    uid: 58,
    from: [{ name: 'Служба поддержки', email: 'support@mailcow.company.ru' }],
    to: [{ name: 'Мария Соколова', email: 'm.sokolova@company.ru' }],
    subject: 'Плановые работы на почтовом сервере 25 октября',
    date: now - 46 * minute,
    snippet: 'Уважаемые пользователи! В субботу с 02:00 до 04:00 будут проводиться плановые работы',
    flags: flag(false),
    html: body([
      'Уважаемые пользователи!',
      'В субботу, 25 октября, с 02:00 до 04:00 будут проводиться плановые работы на почтовом сервере. Возможны кратковременные перерывы в доступе по IMAP и SMTP.',
      'Письма, отправленные в этот период, не будут потеряны: клиенты поставят их в очередь и досладут автоматически.'
    ], 'Служба поддержки\nmailcow.company.ru'),
    text: 'Уважаемые пользователи! В субботу с 02:00 до 04:00 будут проводиться плановые работы...'
  },
  {
    id: 'm3',
    accountId: 'acc-1',
    folderId: 'acc-1-inbox',
    folderPath: 'INBOX',
    uid: 140,
    from: [{ name: 'Сергей Волков', email: 's.volkov@company.ru' }],
    to: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    subject: 'Re: Регламент обновления 1С и почтового клиента',
    date: now - 2 * hour,
    snippet: 'Поддерживаю переход на per-user установку. Тогда обновления не потребуют',
    flags: flag(false, false, true),
    hasAttachments: true,
    html: body([
      'Поддерживаю переход на per-user установку. Тогда обновления не потребуют прав администратора и мы снимем часть заявок первой линии.',
      'Приложил черновик регламента — посмотри раздел про откат версии.'
    ], 'Сергей Волков\nНачальник службы поддержки'),
    text: 'Поддерживаю переход на per-user установку...'
  },
  {
    id: 'm4',
    accountId: 'acc-1',
    folderId: 'acc-1-inbox',
    folderPath: 'INBOX',
    uid: 139,
    from: [{ name: 'Мария Соколова', email: 'm.sokolova@company.ru' }],
    to: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    subject: 'Доступ к общим ящикам для нового отдела',
    date: now - 5 * hour,
    snippet: 'Нужно добавить пять сотрудников в общий ящик sales@ и выдать права на ответ',
    flags: flag(true),
    html: body([
      'Нужно добавить пять сотрудников в общий ящик sales@ и выдать права на ответ от имени ящика.',
      'Список сотрудников — во вложении к тикету SD-2841.'
    ], 'Мария Соколова\nОтдел продаж'),
    text: 'Нужно добавить пять сотрудников в общий ящик sales@...'
  },
  {
    id: 'm5',
    accountId: 'acc-3',
    folderId: 'acc-3-inbox',
    folderPath: 'INBOX',
    uid: 33,
    from: [{ name: 'Яндекс.Паспорт', email: 'noreply@yandex.ru' }],
    to: [{ name: 'Иван Петров', email: 'ivan.petrov@gmail.com' }],
    subject: 'Вход в аккаунт с нового устройства',
    date: now - 7 * hour,
    snippet: 'Мы заметили вход в ваш аккаунт с нового устройства: Windows 11, Екатеринбург',
    flags: flag(false),
    html: body([
      'Мы заметили вход в ваш аккаунт с нового устройства: Windows 11, Екатеринбург.',
      'Если это были вы, ничего делать не нужно.'
    ], 'Команда Яндекс ID'),
    text: 'Мы заметили вход в ваш аккаунт с нового устройства...'
  },
  {
    id: 'm6',
    accountId: 'acc-1',
    folderId: 'acc-1-inbox',
    folderPath: 'INBOX',
    uid: 138,
    from: [{ name: 'Бухгалтерия', email: 'buh@company.ru' }],
    to: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    subject: 'Счёт № 4412 на оплату хостинга',
    date: now - 1 * day,
    snippet: 'Во вложении счёт на оплату услуг хостинга за октябрь. Просьба оплатить до 30 числа',
    flags: flag(true, false, true),
    hasAttachments: true,
    html: body([
      'Во вложении счёт на оплату услуг хостинга за октябрь.',
      'Просьба оплатить до 30 числа и прислать платёжное поручение.'
    ], 'Бухгалтерия'),
    text: 'Во вложении счёт на оплату услуг хостинга за октябрь...'
  },
  {
    id: 'm7',
    accountId: 'acc-2',
    folderId: 'acc-2-inbox',
    folderPath: 'INBOX',
    uid: 57,
    from: [{ name: 'Ольга Смирнова', email: 'o.smirnova@company.ru' }],
    to: [{ name: 'Мария Соколова', email: 'm.sokolova@company.ru' }],
    subject: 'Итоги встречи по миграции на mailcow',
    date: now - 1 * day - 3 * hour,
    snippet: 'Коллеги, зафиксировал решения: переезд до 15 ноября, старый сервер оставляем',
    flags: flag(true),
    html: body([
      'Коллеги, зафиксировал решения по встрече:',
      '1. Переезд завершаем до 15 ноября.<br>2. Старый сервер оставляем в режиме только чтения на месяц.<br>3. Клиент настраиваем через автонастройку и групповые политики.'
    ], 'Ольга Смирнова\nПроектный офис'),
    text: 'Коллеги, зафиксировал решения...'
  },
  {
    id: 'm8',
    accountId: 'acc-1',
    folderId: 'acc-1-inbox',
    folderPath: 'INBOX',
    uid: 137,
    from: [{ name: 'GitHub', email: 'notifications@github.com' }],
    to: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    subject: '[kurier] Сборка 0.1.0 прошла успешно',
    date: now - 2 * day,
    snippet: 'Workflow build-windows завершён: артефакты nsis и blockmap загружены в релиз',
    flags: flag(true),
    html: body([
      'Workflow <b>build-windows</b> завершён успешно.',
      'Артефакты <code>GG-Email-Setup-0.1.0.exe</code> и <code>GG-Email-Setup-0.1.0.exe.blockmap</code> загружены в релиз.'
    ], 'GitHub Actions'),
    text: 'Workflow build-windows завершён успешно...'
  },
  {
    id: 'm9',
    accountId: 'acc-1',
    folderId: 'acc-1-sent',
    folderPath: 'Sent',
    uid: 90,
    from: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    to: [{ name: 'Анна Ковалёва', email: 'a.kovaleva@company.ru' }],
    subject: 'Re: Согласование бюджета на Q4',
    date: now - 3 * hour,
    snippet: 'Анна, посмотрел. По серверам вопросов нет, по поддержке прошу уточнить объём',
    flags: flag(true),
    html: body(['Анна, посмотрел. По серверам вопросов нет, по поддержке прошу уточнить объём часов.']),
    text: 'Анна, посмотрел...'
  },
  {
    id: 'm10',
    accountId: 'acc-1',
    folderId: 'acc-1-drafts',
    folderPath: 'Drafts',
    uid: 12,
    from: [{ name: 'Иван Петров', email: 'i.petrov@company.ru' }],
    to: [{ name: 'Сергей Волков', email: 's.volkov@company.ru' }],
    subject: 'План внедрения ADMX-политик',
    date: now - 4 * hour,
    snippet: 'Сергей, предлагаю разбить внедрение на три этапа: пилот на ИТ-отделе',
    flags: { ...flag(false), draft: true },
    html: body(['Сергей, предлагаю разбить внедрение на три этапа: пилот на ИТ-отделе, затем финансы, затем все остальные.']),
    text: 'Сергей, предлагаю разбить внедрение...'
  }
]

const policy: PolicyState = {
  managed: true,
  source: 'registry-machine',
  values: {
    updateMode: 'auto',
    updateChannel: 'stable',
    updateCheckIntervalHours: 6,
    updateDeferDays: 2,
    blockRemoteContent: true,
    allowHtmlMail: true,
    allowAccountManagement: true,
    showPolicyBanner: true,
    requireTls: true,
    maxCacheSizeMb: 4096,
    cacheRetentionDays: 180,
    syncIntervalMinutes: 5,
    logLevel: 'warn'
  },
  locked: [
    'updateMode',
    'updateChannel',
    'updateCheckIntervalHours',
    'blockRemoteContent',
    'requireTls',
    'maxCacheSizeMb'
  ],
  errors: []
}

function toSummary(message: DemoMessage): MessageSummary {
  return {
    id: message.id,
    accountId: message.accountId,
    accountEmail: accounts.find((account) => account.id === message.accountId)?.email ?? '',
    folderId: message.folderId,
    folderPath: message.folderPath,
    uid: message.uid,
    messageId: `<${message.id}@demo>`,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    size: 24_000,
    flags: message.flags,
    hasAttachments: Boolean(message.hasAttachments),
    snippet: message.snippet,
    threadKey: message.id
  }
}

export function installDemoApi(): void {
  const state = {
    messages: demoMessages.map(toSummary),
    query: ''
  }

  const api: KurierApi = {
    bootstrap: async () => ({
      accounts,
      folders,
      policy,
      app: {
        name: 'GG Email',
        version: '0.1.0',
        electron: '45.0.0',
        chrome: '140',
        node: '24.22.0',
        platform: 'win32',
        arch: 'x64',
        userDataPath: 'C:\\Users\\ivan\\AppData\\Roaming\\GG Email',
        dataPath: 'C:\\Users\\ivan\\AppData\\Roaming\\GG Email',
        isPackaged: true
      },
      updater: { status: 'idle', nextCheckAt: now + hour },
      sync: []
    }),
    accounts: {
      list: async () => accounts,
      add: async () => accounts[0],
      update: async () => accounts[0],
      remove: async () => undefined,
      test: async () => ({ ok: true, imap: { ok: true, folders: 9 }, smtp: { ok: true } }),
      autoconfigure: async (email: string) => ({
        email,
        imap: { host: 'mail.company.ru', port: 993, security: 'tls' },
        smtp: { host: 'mail.company.ru', port: 465, security: 'tls' },
        username: email,
        authKind: 'password',
        source: 'policy-autoconfig'
      }),
      setSecret: async () => undefined
    },
    folders: {
      list: async (accountId?: string) =>
        accountId ? folders.filter((folder) => folder.accountId === accountId) : folders
    },
    messages: {
      list: async (query) => {
        let items = state.messages
        if (query.accountId) items = items.filter((item) => item.accountId === query.accountId)
        if (query.folderId) items = items.filter((item) => item.folderId === query.folderId)
        if (query.role) {
          const roleFolders = new Set(
            folders.filter((folder) => folder.role === query.role).map((folder) => folder.id)
          )
          items = items.filter((item) => roleFolders.has(item.folderId))
        }
        if (query.query) {
          const needle = query.query.toLowerCase()
          items = items.filter(
            (item) =>
              item.subject.toLowerCase().includes(needle) ||
              item.snippet.toLowerCase().includes(needle) ||
              item.from.some((address) => address.name.toLowerCase().includes(needle))
          )
        }
        if (query.unreadOnly) items = items.filter((item) => !item.flags.seen)
        const sorted = [...items].sort((a, b) => b.date - a.date)
        const offset = query.offset ?? 0
        const limit = query.limit ?? 100
        return {
          items: sorted.slice(offset, offset + limit),
          total: sorted.length,
          hasMore: offset + limit < sorted.length
        }
      },
      get: async (id: string) => {
        const message = demoMessages.find((item) => item.id === id)
        if (!message) throw new Error('Письмо не найдено')
        const summary = toSummary(message)
        return {
          ...summary,
          cc: [],
          bcc: [],
          replyTo: [],
          textBody: message.text,
          htmlBody: message.html,
          bodyFetched: true,
          headers: {},
          attachments: message.hasAttachments
            ? [
                {
                  id: `${id}-att-1`,
                  filename: 'Смета_Q4_2026.xlsx',
                  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  size: 148_234,
                  inline: false
                }
              ]
            : []
        } as MessageDetail
      },
      setFlags: async (id: string, flags: MessageFlags) => {
        state.messages = state.messages.map((item) =>
          item.id === id ? { ...item, flags } : item
        )
      },
      move: async () => undefined,
      remove: async (id: string) => {
        state.messages = state.messages.filter((item) => item.id !== id)
      },
      loadOlder: async () => 0,
      openAttachment: async () => undefined,
      saveAttachment: async () => null,
      attachmentUrl: async () => ''
    },
    composer: {
      send: async () => ({ ok: true, messageId: 'demo' })
    },
    settings: {
      get: async () => ({
        language: 'auto' as const,
        theme: 'system' as const,
        density: 'comfortable' as const,
        previewPane: 'right' as const,
        notifications: true,
        syncAllFolders: false,
        signature: 'С уважением,\nИван Петров\nОтдел ИТ-инфраструктуры'
      }),
      set: async (patch) => ({ ...patch }) as never
    },
    policy: {
      get: async () => policy
    },
    sync: {
      now: async () => undefined,
      all: async () => undefined,
      folder: async () => undefined
    },
    updater: {
      check: async () => ({ status: 'idle' as const }),
      install: async () => undefined,
      state: async () => ({ status: 'idle' as const })
    },
    app: {
      info: async () => ({
        name: 'GG Email',
        version: '0.1.0',
        electron: '45.0.0',
        chrome: '140',
        node: '24.22.0',
        platform: 'win32',
        arch: 'x64',
        userDataPath: '',
        dataPath: '',
        isPackaged: true
      }),
      openDataFolder: async () => undefined,
      openExternal: async () => undefined,
      clearCache: async () => undefined,
      clearBodies: async () => undefined,
      cacheStats: async () => ({
        dbBytes: 24_500_000,
        bodyBytes: 12_000_000,
        attachmentsBytes: 8_400_000,
        totalBytes: 32_900_000,
        messages: 207,
        accounts: 3,
        oldestBodyAt: Date.now() - 40 * 86_400_000
      })
    },
    oauth: {
      start: async () => ({ ok: false, error: 'демо-режим' })
    },
    window: {
      minimize: () => undefined,
      maximize: () => undefined,
      close: () => undefined
    },
    on: () => () => undefined
  }

  ;(window as unknown as { kurier: KurierApi }).kurier = api
  void state
}
