// Генератор ADMX/ADML и справочника политик из единого каталога.
// Запуск: node tools/gen-admx.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'src/shared/policy-catalog.json'), 'utf8'))

const RUN_INSTALL = String.raw`.\Install-KurierADMX.ps1 -Backup`
const UNC_PATH = String.raw`\\domain\sysvol\domain\Policies\PolicyDefinitions`
const RUN_TEST = String.raw`.\Test-Policy.ps1`
const HKLM_KEY = String.raw`HKLM\SOFTWARE\Policies\Kurier`
const HKCU_KEY = String.raw`HKCU\SOFTWARE\Policies\Kurier`

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const categoryId = (name) => name.replace(/\\/g, '_')
const valueId = (policy) => `${policy.registryName}_Value`

function elementFor(policy) {
  switch (policy.type) {
    case 'string':
      return `<text id="${valueId(policy)}" valueName="${policy.registryName}" required="false" />`
    case 'number':
      return `<decimal id="${valueId(policy)}" valueName="${policy.registryName}" minValue="${policy.min ?? 0}" maxValue="${policy.max ?? 999999}" />`
    case 'multistring':
      return `<multiText id="${valueId(policy)}" valueName="${policy.registryName}" />`
    case 'enum':
      return [
        `<enum id="${valueId(policy)}" valueName="${policy.registryName}" required="false">`,
        ...policy.enum.map(
          (value) =>
            `  <item displayName="$(string.${policy.registryName}_${value})">\n    <value><string>${escapeXml(value)}</string></value>\n  </item>`
        ),
        '</enum>'
      ].join('\n')
    default:
      return null
  }
}

function buildAdmx() {
  const categories = catalog.categories
    .map((category) => {
      const id = categoryId(category.name)
      if (!category.parent) return `    <category name="${id}" displayName="$(string.${id})" />`
      return [
        `    <category name="${id}" displayName="$(string.${id})">`,
        `      <parentCategory ref="${categoryId(category.parent)}" />`,
        '    </category>'
      ].join('\n')
    })
    .join('\n')

  const policies = catalog.policies
    .map((policy) => {
      const presentation =
        policy.type === 'boolean' ? '' : ` presentation="$(presentation.${policy.registryName})"`
      const lines = [
        `    <policy name="${policy.registryName}" class="Both" displayName="$(string.${policy.registryName})" explainText="$(string.${policy.registryName}_Help)"${presentation} key="${catalog.rootKey}" valueName="${policy.registryName}">`,
        `      <parentCategory ref="${categoryId(policy.category)}" />`,
        '      <supportedOn ref="windows:SUPPORTED_Windows_10_0" />'
      ]

      if (policy.type === 'boolean') {
        lines.push(
          '      <enabledValue>',
          '        <decimal value="1" />',
          '      </enabledValue>',
          '      <disabledValue>',
          '        <decimal value="0" />',
          '      </disabledValue>'
        )
      } else {
        const element = elementFor(policy)
          .split('\n')
          .map((line) => `        ${line}`)
          .join('\n')
        lines.push('      <elements>', element, '      </elements>')
      }
      lines.push('    </policy>')
      return lines.join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <policyNamespaces>
    <target prefix="kurier" namespace="Kurier.Mail" />
    <using prefix="windows" namespace="Microsoft.Policies.Windows" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <categories>
${categories}
  </categories>
  <policies>
${policies}
  </policies>
</policyDefinitions>
`
}

const ENUM_LABELS = {
  auto: { ru: 'Автоматически', en: 'Automatic' },
  notify: { ru: 'Уведомлять', en: 'Notify' },
  disabled: { ru: 'Отключено', en: 'Disabled' },
  stable: { ru: 'Стабильный', en: 'Stable' },
  beta: { ru: 'Бета', en: 'Beta' },
  internal: { ru: 'Внутренний', en: 'Internal' },
  error: { ru: 'Только ошибки', en: 'Errors only' },
  warn: { ru: 'Предупреждения', en: 'Warnings' },
  info: { ru: 'Информация', en: 'Information' },
  debug: { ru: 'Отладка', en: 'Debug' },
  ru: { ru: 'Русский', en: 'Russian' },
  en: { ru: 'Английский', en: 'English' }
}

function buildAdml(lang) {
  const strings = []

  for (const category of catalog.categories) {
    const id = categoryId(category.name)
    strings.push(`      <string id="${id}">${escapeXml(category.displayName[lang])}</string>`)
  }

  for (const policy of catalog.policies) {
    strings.push(`      <string id="${policy.registryName}">${escapeXml(policy.title[lang])}</string>`)
    strings.push(
      `      <string id="${policy.registryName}_Help">${escapeXml(policy.description[lang])}</string>`
    )
    if (policy.type === 'enum') {
      for (const value of policy.enum) {
        const label = ENUM_LABELS[value]?.[lang] ?? value
        strings.push(
          `      <string id="${policy.registryName}_${value}">${escapeXml(label)}</string>`
        )
      }
    }
  }

  const presentations = catalog.policies
    .filter((policy) => policy.type !== 'boolean')
    .map((policy) => {
      const id = valueId(policy)
      const label = escapeXml(policy.title[lang])
      switch (policy.type) {
        case 'string':
          return `      <presentation id="${policy.registryName}">\n        <textBox refId="${id}"><label>${label}</label></textBox>\n      </presentation>`
        case 'number':
          return `      <presentation id="${policy.registryName}">\n        <decimalTextBox refId="${id}" defaultValue="${policy.default}" spinStep="1">${label}</decimalTextBox>\n      </presentation>`
        case 'multistring':
          return `      <presentation id="${policy.registryName}">\n        <multiTextBox refId="${id}">${label}</multiTextBox>\n      </presentation>`
        case 'enum':
          return `      <presentation id="${policy.registryName}">\n        <dropdownList refId="${id}" defaultItem="0" noSort="true">${label}</dropdownList>\n      </presentation>`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <displayName>${lang === 'ru' ? 'Kurier Почта' : 'Kurier Mail'}</displayName>
  <description>${lang === 'ru' ? 'Политики корпоративного почтового клиента Kurier' : 'Kurier corporate mail client policies'}</description>
  <resources>
    <stringTable>
${strings.join('\n')}
    </stringTable>
    <presentationTable>
${presentations}
    </presentationTable>
  </resources>
</policyDefinitionResources>
`
}

function defaultLabel(policy) {
  if (policy.type === 'boolean') return policy.default ? 'Включено' : 'Отключено'
  if (policy.type === 'multistring') return `\`${String(policy.default).split(',')[0]}, …\``
  return `\`${policy.default}\``
}

function buildReadme() {
  const rows = catalog.policies
    .map(
      (policy) =>
        `| ${policy.title.ru} | \`${policy.registryName}\` | ${policy.type} | ${defaultLabel(policy)} | ${policy.description.ru.replace(/\|/g, '\\|')} |`
    )
    .join('\n')

  return `# Политики Kurier (ADMX/ADML)

Файлы в этом каталоге генерируются из \`src/shared/policy-catalog.json\`:

\`\`\`powershell
npm run admx
\`\`\`

## Установка

\`\`\`powershell
# локально (нужны права администратора)
${RUN_INSTALL}

# или в центральном хранилище домена
${UNC_PATH}
\`\`\`

После установки откройте \`gpedit.msc\` → Административные шаблоны → **Kurier Почта**.
В домене используется \`gpmc.msc\`; шаблоны подхватываются из Central Store.

## Ветки реестра

| Ветка | Назначение | Приоритет |
|---|---|---|
| \`${HKLM_KEY}\` | машинная политика (GPO компьютера) | выше |
| \`${HKCU_KEY}\` | пользовательская политика (GPO пользователя) | ниже |

Клиент читает обе ветки, машинное значение побеждает. Некорректные значения
игнорируются и попадают в диагностику (раздел «Политики» в настройках).

## Справочник политик

| Политика | Значение реестра | Тип | По умолчанию | Описание |
|---|---|---|---|---|
${rows}

## Быстрая проверка без домена

\`\`\`powershell
${RUN_TEST}            # записать тестовые значения в HKCU
${RUN_TEST} -Remove    # удалить
\`\`\`

## Рекомендованный набор для компании

| Политика | Значение | Зачем |
|---|---|---|
| \`AutoconfigUrl\` | \`https://autoconfig.company.ru/mail/config-v1.1.xml?emailaddress=%EMAIL%\` | пользователь вводит только адрес и пароль |
| \`AllowAccountManagement\` | Отключено | фиксированный список ящиков |
| \`UpdateMode\` | \`auto\` | обновления без участия пользователя |
| \`UpdateChannel\` | \`stable\` | только стабильные выпуски |
| \`UpdateDeferDays\` | \`2\` | откат «плохого» релиза до массовой установки |
| \`BlockRemoteContent\` | Включено | защита от трекеров |
| \`RequireTls\` | Включено | запрет открытых соединений |
| \`MaxCacheSizeMb\` | \`2048\` | предсказуемый размер кеша |
`
}

const outDir = join(root, 'policy')
mkdirSync(join(outDir, 'ru-RU'), { recursive: true })
mkdirSync(join(outDir, 'en-US'), { recursive: true })

writeFileSync(join(outDir, 'Kurier.admx'), buildAdmx(), 'utf8')
writeFileSync(join(outDir, 'ru-RU', 'Kurier.adml'), buildAdml('ru'), 'utf8')
writeFileSync(join(outDir, 'en-US', 'Kurier.adml'), buildAdml('en'), 'utf8')
writeFileSync(join(outDir, 'README.md'), buildReadme(), 'utf8')

console.log(`ADMX: ${catalog.policies.length} политик, ${catalog.categories.length} категорий`)
console.log('  policy/Kurier.admx')
console.log('  policy/ru-RU/Kurier.adml')
console.log('  policy/en-US/Kurier.adml')
console.log('  policy/README.md')
