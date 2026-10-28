# Подпись кода и нотаризация

Документ описывает, как включить подпись Windows- и macOS-сборок в CI.
Пока сертификаты не заданы, CI собирает **неподписанные** артефакты:
Windows показывает SmartScreen, macOS — «приложение повреждено».

## Windows

### Что нужно

Один из вариантов:

1. **OV/EV сертификат Code Signing** (USB-токен или облачный HSM). Для EV
   SmartScreen доверяет сразу; для OV репутация набирается со временем.
2. **Azure Trusted Signing** (проще для CI): аккаунт Azure, Trusted Signing
   account, certificate profile, service principal с ролью «Trusted Signing
   Certificate Profile Signer».

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
