param(
  [string]$Organization = 'GG Email',
  [string]$CommonName = 'GG Email',
  [string]$OutDir = 'build\\certs',
  [string]$PfxPassword = 'GGEmail-Internal-2026'
)

# Создаёт внутренний code-signing сертификат:
#   - корневой CA (10 лет) для распространения через GPO;
#   - подписывающий сертификат (3 года) + PFX для CI.
# PFX и пароль — секреты: не коммитить, хранить в защищённом месте.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null

# Удаляем прежние сертификаты этой организации, чтобы не плодить цепочки.
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -like "*O=$Organization*" } |
  ForEach-Object { Remove-Item "Cert:\CurrentUser\My\$($_.Thumbprint)" -Force -ErrorAction SilentlyContinue }

$root = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=$Organization Internal CA, O=$Organization, C=RU" `
  -KeyUsage CertSign, CRLSign, DigitalSignature `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA -KeyLength 4096 -HashAlgorithm SHA256 `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(10) `
  -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1')

$leaf = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=$CommonName, O=$Organization, C=RU" `
  -Signer $root `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(3) `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')

$rootCer = Join-Path $OutDir 'gg-email-root.cer'
$leafCer = Join-Path $OutDir 'gg-email-codesign.cer'
$leafPfx = Join-Path $OutDir 'gg-email-codesign.pfx'
$rootPfx = Join-Path $OutDir 'gg-email-root.pfx'

Export-Certificate -Cert $root -FilePath $rootCer -Type CERT | Out-Null
Export-Certificate -Cert $leaf -FilePath $leafCer -Type CERT | Out-Null
Export-PfxCertificate -Cert $root -FilePath $rootPfx -Password (ConvertTo-SecureString $PfxPassword -AsPlainText -Force) | Out-Null
Export-PfxCertificate -Cert $leaf -FilePath $leafPfx -Password (ConvertTo-SecureString $PfxPassword -AsPlainText -Force) | Out-Null

Write-Host 'Готово. Файлы:' -ForegroundColor Green
Write-Host "  Root CA (для GPO, Trusted Root): $rootCer"
Write-Host "  Code signing (Trusted Publishers): $leafCer"
Write-Host "  PFX для CI (секрет!): $leafPfx"
Write-Host "  Пароль PFX: $PfxPassword"
Write-Host ''
Write-Host "Отпечаток подписи: $($leaf.Thumbprint)"
Write-Host ''
Write-Host 'Дальше:'
Write-Host '  1. Root CA и Code signing — в GPO: Computer Configuration → Security Settings →'
Write-Host '     Public Key Policies → Trusted Root Certification Authorities / Trusted Publishers.'
Write-Host '  2. PFX → в секреты GitHub: CSC_LINK (base64) и CSC_KEY_PASSWORD.'
Write-Host '  3. Ноутбуки без домена: запустить tools/trust-certificate.ps1 с этими .cer.'
