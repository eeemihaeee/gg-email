# Kurier — корпоративный почтовый клиент

Kurier — лёгкий почтовый клиент для Windows, созданный как замена Mozilla Thunderbird
в компании с собственным почтовым сервером **mailcow** и внешними ящиками
(Gmail, Яндекс, Mail.ru, любой IMAP/SMTP).

![Интерфейс Kurier](docs/screenshots/main.png)

## Зачем

Thunderbird плохо подходит для управляемого парка рабочих мест:

| Проблема | Как решает Kurier |
|---|---|
| Кеш в mbox-файлах ломается, «Индекс повреждён», письма пропадают из списка | Кеш — SQLite (WAL + FTS5), тела писем сжаты, кеш можно удалить и восстановить с сервера в любой момент |
| Высокое потребление RAM и диска | Один процесс, список на виртуализации, тела писем загружаются по требованию, лимит кеша из политики |
| Несколько аккаунтов неудобны: общий список, путаница папок | «Все входящие» + отдельный цвет и дерево папок для каждого ящика, независимая синхронизация |
| Обновления требуют прав администратора | Установка per-user в `%LOCALAPPDATA%\Programs\Kurier`, дифференциальные автообновления |
| Нет управления через GPO | 22 политики ADMX/ADML: серверы, обновления, безопасность, кеш, интерфейс |
| Не работает с Gmail/Яндексом без «танцев» | Пресеты провайдеров, автонастройка, OAuth2 с client_id из политики, пароли приложений |

## Возможности

- **Мультиаккаунтность**: mailcow, Gmail, Яндекс, Mail.ru, Outlook.com, произвольный IMAP/SMTP.
- **Единый ящик**: «Все входящие» по всем аккаунтам, цветовые метки, раздельные папки.
- **Надёжный кеш**: SQLite WAL, инкрементальная синхронизация по UID/UIDVALIDITY,
  IMAP IDLE, периодическая сверка удалённых писем, полнотекстовый поиск FTS5.
- **Быстрый интерфейс**: React + виртуализированный список, тела писем по требованию.
- **Безопасность**: пароли в DPAPI (`safeStorage`), HTML-письма в sandboxed iframe с CSP,
  блокировка внешних картинок, запрет опасных вложений политикой, TLS 1.2+.
- **OAuth2** для Gmail и Яндекса (PKCE, loopback-redirect, client_id задаётся политикой).
- **Автонастройка**: внутренний autoconfig из политики → autoconfig домена → well-known →
  база Thunderbird ISPDB → встроенные пресеты → предположение `imap.<домен>`.
- **Обновления**: NSIS per-user, дифференциальные (blockmap), каналы stable/beta/internal,
  интервал, отсрочка установки и полное отключение — через GPO.
- **ADMX/ADML** с русской и английской локализацией, скрипты установки и создания GPO.

## Быстрый старт (разработка)

Требуется Node.js 22+ (проект проверен на Node 22.21 / Electron 45).

```powershell
npm install
npm run dev
```

> Если среда запрещает lifecycle-скрипты npm (песочницы, некоторые CI), используйте
> `npm install --ignore-scripts` и затем `node node_modules/electron/install.js`.
> Переменная `electron_config_cache` задаёт каталог загрузки бинарника.

Сборка и установщик:

```powershell
npm run build        # out/ (main, preload, renderer)
npm run dist         # release/Kurier-Setup-<версия>.exe (NSIS, per-user)
```

Проверки:

```powershell
npm run typecheck    # main + renderer
npm test             # 22 модульных теста (vitest)
npm run admx         # перегенерировать ADMX/ADML/README из каталога политик
```

## Политики

![Применённые политики](docs/screenshots/policies.png)

```powershell
# установить шаблоны (нужны права администратора)
.\policy\Install-KurierADMX.ps1 -Backup

# создать GPO с рекомендованными настройками (RSAT)
.\policy\New-KurierGPO.ps1 -AutoconfigUrl "https://autoconfig.company.ru/mail/config-v1.1.xml?emailaddress=%EMAIL%"
```

Политики читаются из `HKLM\SOFTWARE\Policies\Kurier` и `HKCU\SOFTWARE\Policies\Kurier`
(машинное значение приоритетнее). Полный справочник —
[policy/README.md](policy/README.md), руководство администратора —
[docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md).

## Документация

| Документ | Для кого |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | разработчики: устройство, синхронизация, кеш, безопасность |
| [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | администраторы: развёртывание, ADMX, обновления, диагностика |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | пользователи: горячие клавиши, несколько ящиков, поиск |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | разработчики: сборка, тесты, добавление политик и провайдеров |
| [policy/README.md](policy/README.md) | справочник политик ADMX |

## Структура репозитория

```
src/
  main/            Electron main: IMAP/SMTP, кеш, синхронизация, политики, обновления
    db/            SQLite-схема, репозитории, сжатие
    mail/          imap, smtp, mime, autoconfig, oauth, sync
    policy.ts      чтение реестра GPO и слияние значений
    updater.ts     electron-updater + политики каналов/отсрочки
    ipc.ts         типизированные IPC-обработчики
  preload/         contextBridge-API (window.kurier)
  renderer/        React-интерфейс (zustand, виртуальный список, DOMPurify)
  shared/          типы, каталог политик, провайдеры, IPC-контракт
policy/            сгенерированные ADMX/ADML, скрипты установки и GPO
tools/             генератор ADMX, статический сервер для визуальных проверок
tests/             модульные тесты (vitest)
build/             иконка и NSIS-включения
```

## Статус и ограничения MVP

Собрано и проверено в этой итерации:

- установщик `release/Kurier-Setup-0.1.0.exe` (110 МБ, SHA-256
  `3A87039F3C4F03893727BB12135F278B1053D3F3E7E9E25665D6720A93F2E420`), `latest.yml` и blockmap для дифференциальных обновлений;
- `app.asar` (25,6 МБ) содержит `out/main`, `out/preload`, `out/renderer` и
  production-зависимости;
- сборка `electron-vite`, строгая типизация TypeScript (main + renderer);
- 22 модульных теста: политики, роли папок, кеш SQLite, FTS-поиск, флаги,
  перемещение писем, сжатие тел, вытеснение кеша;
- интерфейс — скриншоты сняты с собранного renderer-а в headless Chromium
  (демо-режим `?demo=1`, синтетические данные);
- ADMX/ADML (ru-RU, en-US) сгенерированы из каталога политик и проходят
  XML-валидацию.

Не проверено в среде сборки (требуется интерактивная сессия Windows):

- запуск GUI Electron: процесс падает с `0xC0000005` до `app.ready` внутри
  песочницы агента (Chromium не может инициализироваться в job-объекте);
  на обычном рабочем месте запуск выполняется ярлыком/`Kurier.exe`;
- живая синхронизация с mailcow/Gmail и OAuth2 end-to-end (нужны реальные
  учётные данные и зарегистрированные client_id);
- установка обновления «по воздуху» (нужен HTTPS-сервер обновлений и сертификат).

Ограничения текущего MVP:

- интерфейс локализован на русский (политика `DefaultLanguage` зарезервирована);
- нет календаря, адресной книги и S/MIME;
- черновики хранятся только на сервере (локального автосохранения пока нет);
- `PreconfiguredAccounts` читается, но мастер пока не подставляет шаблоны автоматически.

## Лицензия

Внутренний проект (`UNLICENSED`).
