# Подпись кода и нотаризация

Документ описывает, как включить подпись Windows- и macOS-сборок в CI.
Пока сертификаты не заданы, CI собирает **неподписанные** артефакты:
Windows показывает SmartScreen, macOS — «приложение повреждено».

## Если Azure недоступен (Россия)

Azure Trusted Signing требует подписку Azure и организационную identity
validation — из РФ это сейчас недоступно. Рабочие варианты:

1. **OV-сертификат Code Signing в PFX** от CA, входящего в Microsoft Trusted
   Root Program (Certum, GlobalSign, Sectigo, DigiCert — через партнёров/реселлеров).
   Экспортируемый PFX кладётся в секреты `CSC_LINK` (base64) и
   `CSC_KEY_PASSWORD`; CI подпишет и проверит подпись. SmartScreen доверяет
   постепенно, по мере загрузок.
2. **EV-сертификат на токене/HSM**: CI собирает установщик, подпись выполняется
   локально скриптом `tools/sign-windows.ps1` там, где подключён токен:
   ```powershell
   .\tools\sign-windows.ps1 -Path release\GG-Email-Setup-0.4.1.exe -Thumbprint <отпечаток>
   ```
   EV даёт доверие SmartScreen сразу.
3. **Внутреннее развёртывание без интернета**: самоподписанный сертификат +
   распространение через GPO/Intune в «Доверенные издатели». SmartScreen не
   участвует, но и внешние пользователи такую подпись не увидят.

Важно: сертификаты российских УЦ (Минцифры) не входят в Microsoft Trusted Root
Program — Windows покажет «Неизвестный издатель», даже если подпись валидна.
Для внешней раздачи нужен сертификат CA из списка Microsoft.

## Azure Trusted Signing (выбранный вариант)

CI уже умеет подписывать через Azure: если задан секрет `AZURE_CLIENT_ID`,
workflow генерирует `electron-builder.azure.yml` и собирает с ним; если нет —
собирает неподписанный артефакт.

### Что создать в Azure

1. Подписка Azure → зарегистрировать resource provider `Microsoft.CodeSigning`.
2. Создать **Trusted Signing account** (регион, например East US).
3. Пройти **Identity validation** (Organization) — юридическое название компании.
   Это же название попадёт в сертификат и в `publisherName`.
4. Создать **Certificate profile** типа *Public Trust* в этом аккаунте.
5. App registration (Entra ID) → client secret.
6. Назначить приложению роль **Trusted Signing Certificate Profile Signer**
   на Trusted Signing account.

### Секреты GitHub Actions

| Secret | Пример / значение |
| --- | --- |
| `AZURE_TENANT_ID` | tenant GUID |
| `AZURE_CLIENT_ID` | client ID приложения |
| `AZURE_CLIENT_SECRET` | client secret |
| `AZURE_PUBLISHER_NAME` | юридическое название из identity validation |
| `AZURE_ENDPOINT` | `https://eus.codesigning.azure.net/` |
| `AZURE_SIGNING_ACCOUNT` | имя Trusted Signing account |
| `AZURE_CERT_PROFILE` | имя certificate profile |

После добавления секретов: тег `v0.4.1` → CI подпишет установщик, выполнит
`Get-AuthenticodeSignature` и опубликует релиз с `SHA256SUMS.txt`.
SmartScreen для Trusted Signing доверяет сразу, как для EV.

### Ограничения

- Нужна подписка Azure и пройденная identity validation (может занять дни).
- `publisherName` должен **точно** совпадать с названием в сертификате.
- Для подписи используется облачный ключ, токен не нужен.

## Windows (альтернатива: OV/EV PFX)


### Что нужно

Один из вариантов:

1. **OV/EV сертификат Code Signing** (USB-токен или облачный HSM). Для EV
   SmartScreen доверяет сразу; для OV репутация набирается со временем.
2. **Azure Trusted Signing** (проще для CI): аккаунт Azure, Trusted Signing
   account, certificate profile, service principal с ролью «Trusted Signing
   Certificate Profile Signer».

### Важно про EV и CI

EV-сертификат обычно лежит на USB-токене или в HSM — GitHub Actions такой
токен использовать не может. Для CI нужен один из вариантов:

- **OV-сертификат в экспортируемом `.pfx`** — самый простой путь;
- **EV/OV в облачном HSM** (Azure Trusted Signing, DigiCert KeyLocker,
  GlobalSign Atlas) — тогда в CI настраивается доступ к облачному ключу.

Если сертификат уже установлен на этой машине, экспорт в PFX:

```powershell
# отпечаток сертификата
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Format-List Subject, Thumbprint

# экспорт (пароль задаёте сами)
certutil -p "ПарольPFX" -exportPFX My <Thumbprint> gg-email-codesign.pfx

# base64 для секрета CSC_LINK
[Convert]::ToBase64String([IO.File]::ReadAllBytes("gg-email-codesign.pfx")) | Set-Clipboard
```

Дальше: GitHub → Settings → Secrets → Actions:

- `CSC_LINK` — вставленный base64 (одной строкой);
- `CSC_KEY_PASSWORD` — пароль PFX.

После этого CI подпишет установщик, `GG Email.exe` и uninstaller, поставит
метку времени DigiCert (подпись останется действительной после истечения
сертификата) и выполнит `Get-AuthenticodeSignature` — при невалидной подписи
сборка упадёт. В релиз также кладётся `SHA256SUMS.txt`.

Для OV SmartScreen начинает доверять не сразу: репутация набирается по мере
загрузок. EV даёт доверие сразу, но требует токен/HSM.

### Как передать в electron-builder

В GitHub → Settings → Secrets and variables → Actions добавить:

| Secret | Значение |
| --- | --- |
| `CSC_LINK` | base64 от `.pfx` (или путь/URL к файлу) |
| `CSC_KEY_PASSWORD` | пароль `.pfx` |

Для Azure Trusted Signing electron-builder использует
[`azureTrustedSigning`](https://www.electron.build/code-signing) в конфиге:
`win.azureSignOptions` (endpoint, codeSigningAccountName, certificateProfileName)
и переменные `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

### Проверка

```powershell
signtool verify /pa /v "release\GG-Email-Setup-0.4.0.exe"
Get-AuthenticodeSignature "release\GG-Email-Setup-0.4.0.exe" | Format-List
```

Установщик, `GG Email.exe` и uninstaller подписываются одним сертификатом;
`electron-updater` проверяет подпись при обновлении.

## macOS

### Что нужно

1. Apple Developer Program ($99/год).
2. Сертификат **Developer ID Application** (не «Mac App Distribution»).
3. App-specific password для Apple ID (или API key) для нотаризации.

### Секреты GitHub Actions

| Secret | Значение |
| --- | --- |
| `CSC_LINK` | base64 от `.p12` с Developer ID Application + приватный ключ |
| `CSC_KEY_PASSWORD` | пароль `.p12` |
| `APPLE_ID` | Apple ID разработчика |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | Team ID (10 символов) |

### Изменения в конфиге

В `electron-builder.yml` сейчас стоит `mac.identity: null` — это отключает
подпись. Перед включением сертификатов **удалите эту строку** и уберите
`CSC_IDENTITY_AUTO_DISCOVERY: 'false'` из шага macOS в
`.github/workflows/build.yml`.

Нотаризация включается автоматически, когда заданы `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` и `APPLE_TEAM_ID` (electron-builder 26).

### Проверка

```bash
codesign --verify --deep --strict --verbose=2 "GG Email.app"
spctl --assess --type execute --verbose=4 "GG Email.app"
xcrun stapler validate "GG-Email-0.4.0-arm64.dmg"
```

Без подписи пользователь может открыть приложение так:

```bash
xattr -dr com.apple.quarantine /Applications/GG\ Email.app
```

Но **автообновление на macOS требует подписи** (Squirrel.Mac проверяет
signature), поэтому для боевой эксплуатации сертификат обязателен.

## Чек-лист релиза

- [ ] сертификаты добавлены в секреты репозитория;
- [ ] `mac.identity` удалён, `CSC_IDENTITY_AUTO_DISCOVERY` убран;
- [ ] тег `vX.Y.Z` запушен, CI собрал Windows + macOS;
- [ ] `latest.yml` и `latest-mac.yml` в релизе;
- [ ] `signtool verify` и `spctl --assess` проходят;
- [ ] обновление с предыдущей версии проверено на чистой машине.
