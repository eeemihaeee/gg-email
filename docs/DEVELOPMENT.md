# Разработка

## Стек

| Слой | Технологии |
|---|---|
| Оболочка | Electron 45, electron-vite 6, Vite 8 |
| UI | React 19, zustand, @tanstack/react-virtual, DOMPurify |
| Почта | imapflow, nodemailer, mailparser |
| Данные | встроенный `node:sqlite` (без нативных модулей) |
| Язык | TypeScript 5.9, strict |
| Тесты | vitest |
| Сборка | electron-builder (NSIS, per-user) |

`node:sqlite` выбран осознанно: нет нативной сборки, нет ABI-конфликтов при
обновлении Electron, база переносима между версиями.

## Установка зависимостей

```powershell
npm install --ignore-scripts
node node_modules/electron/install.js
```

`--ignore-scripts` нужен только в средах, где npm не может запускать lifecycle-скрипты.
Для загрузки Electron можно задать кэш:

```powershell
$env:electron_config_cache = "$PWD\.cache\electron"
node node_modules/electron/install.js
```

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | запуск Electron с HMR renderer-а |
| `npm run build` | сборка `out/` (main, preload, renderer) |
| `npm run typecheck` | `tsc` для main и renderer |
| `npm test` | модульные тесты vitest |
| `npm run dist` | сборка + NSIS-установщик в `release/` |
| `npm run web` | веб-режим: сборка серверного бандла и запуск на 127.0.0.1:4173 |
| `npm run dist:publish` | сборка и публикация релиза в GitHub (нужен `GH_TOKEN`) |
| `npm run build:web` | только сборка `out/web/server.cjs` |
| `npm run admx` | генерация ADMX/ADML и справочника политик |

## Структура

```
src/main/            main-процесс
  index.ts           окно, протокол kurier-att://, меню, жизненный цикл
  app-context.ts     composition root, фоновые задачи
  ipc.ts             обработчики IPC (валидация, права, политики)
  policy.ts          чтение HKLM/HKCU, наблюдатель, GGEMAIL_POLICY_FILE
  secrets.ts         DPAPI-хранилище
  updater.ts         electron-updater + политики
  db/                Database (node:sqlite), схема, репозитории
  mail/              imap, smtp, mime, autoconfig, oauth, sync
src/preload/         contextBridge-обёртка window.kurier
src/renderer/        React-приложение
  store.ts           состояние и действия (zustand)
  components/        панели, список, читалка, мастер, настройки
  lib/               форматирование, санитайзер HTML
src/shared/          типы, каталог политик, пресеты провайдеров, IPC-контракт
policy/              сгенерированные ADMX/ADML, PowerShell-скрипты
tools/               генератор ADMX, статический сервер для скриншотов
tests/               vitest
```

## Как добавить политику

1. Добавьте запись в `src/shared/policy-catalog.json` (ключ, `registryName`, тип,
   значение по умолчанию, категория, тексты ru/en).
2. Выполните `npm run admx` — ADMX/ADML и `policy/README.md` перегенерируются.
3. Используйте значение в коде: `policyValue(ctx.policy, 'myPolicy', default)`.
4. Если политика блокирует действие — проверьте её в IPC-обработчике, а не только в UI.
5. Добавьте тест в `tests/policy.test.ts`, если есть специфичная нормализация.

Правила:

- имя значения реестра = `registryName`, ключ модели = `key` (camelCase);
- enum обязан содержать значение по умолчанию;
- числовые политики обязаны иметь `min`/`max`;
- машинная политика приоритетнее пользовательской — это поведение `policy.ts`.

## Как добавить провайдера

`src/shared/providers.ts`:

```ts
{
  id: 'newprovider',
  label: 'Новый провайдер',
  domains: ['example.com'],
  imap: { host: 'imap.example.com', port: 993, security: 'tls' },
  smtp: { host: 'smtp.example.com', port: 465, security: 'tls' },
  authKind: 'password'
}
```

Пресет используется для подстановки серверов и как fallback после автонастройки.

## Отладка

- Логи: `%APPDATA%\GG Email\logs\kurier.log`; уровень — политика `LogLevel` или
  `GGEMAIL_POLICY_FILE`.
- Отдельный профиль: `GGEMAIL_USER_DATA=C:\temp\gg-profile npm run dev`.
- Политики без домена:

  ```powershell
  $env:GGEMAIL_POLICY_FILE = "$PWD\tests\fixtures\policy.json"
  npm run dev
  ```

- DevTools: `Ctrl+Shift+I` (меню «Вид»).
- Скриншот окна: `GGEMAIL_SCREENSHOT=shot.png npm run dev` (main сделает снимок и выйдет).
- Демонстрационный режим без Electron: `npm run build`, затем
  `node tools/serve-renderer.mjs out/renderer 4321` и откройте
  `http://127.0.0.1:4321/?demo=1&open=1` — интерфейс с синтетическими данными.

## Тесты

```powershell
npm test                 # модульные тесты
npm run test:integration # IMAP/SMTP + синхронизация на GreenMail (нужна Java 17+)
```

Интеграционные тесты скачивают `greenmail-standalone` в `.cache/` и поднимают
локальный сервер на портах 3143 (IMAP) и 3025 (SMTP): проверяются вход IMAP/SMTP,
сквозная синхронизация письма в SQLite и отправка через `buildRawMessage`/`sendPrepared`.
Без `GGEMAIL_IT=1` они пропускаются. В CI шаг выполняется в Windows-job с Java 17.


```powershell
npm test
```

Покрыто: нормализация политик, роли папок и пресеты провайдеров, схема SQLite и
миграции, инкрементальная вставка, FTS-поиск, фильтры, флаги, перемещение,
сжатие тел, вытеснение кеша, каскадное удаление.

Для тестов main-модулей `tests/setup.ts` подменяет Electron API (app, safeStorage).

## Сборка установщика

```powershell
npm run dist
```

Конфигурация — `electron-builder.yml`: NSIS, `perMachine: false`,
`requestedExecutionLevel: asInvoker`, `differentialPackage: true`.
Артефакты: `release/GG-Email-Setup-<ver>.exe`, `.blockmap`, `latest.yml`.

## CI

`.github/workflows/build.yml`: typecheck → тесты → сборка → установщик,
артефакты прикладываются к запуску; на тег `v*` создаётся релиз.

## Соглашения

- TypeScript strict, без `any` в новом коде (исключение — границы внешних библиотек).
- Все IPC-каналы описаны в `src/shared/ipc.ts`, обработчики проверяют источник вызова.
- Секреты никогда не попадают в SQLite, логи и renderer (кроме момента ввода).
- Пользовательские строки интерфейса — на русском; новые политики — с локализацией ru/en.
