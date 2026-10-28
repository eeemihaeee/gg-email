param(
  [Parameter(Mandatory = $true)][string]$RootCertificate,
  [Parameter(Mandatory = $true)][string]$PublisherCertificate,
  [switch]$Machine
)

# Устанавливает доверие к внутреннему сертификату GG Email на компьютере
# без домена. Без -Machine — только для текущего пользователя (без прав админа);
# с -Machine — для всех пользователей (нужен запуск от администратора).
$ErrorActionPreference = 'Stop'

function Add-Cert([string]$path, [string]$store) {
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Resolve-Path $path)
  $storeObject = New-Object System.Security.Cryptography.X509Certificates.X509Store $store, 'CurrentUser'
  $storeObject.Open('ReadWrite')
  try {
    $storeObject.Add($cert)
  } finally {
    $storeObject.Close()
  }
  Write-Host "  CurrentUser\\$store ← $($cert.Subject)"
}

Write-Host 'Доверие GG Email (текущий пользователь)'
Add-Cert $RootCertificate 'Root'
Add-Cert $PublisherCertificate 'TrustedPublisher'

if ($Machine) {
  if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Для -Machine нужен запуск от администратора'
  }
  Write-Host 'Доверие GG Email (все пользователи)'
  Import-Certificate -FilePath (Resolve-Path $RootCertificate) -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  Import-Certificate -FilePath (Resolve-Path $PublisherCertificate) -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
  Write-Host '  LocalMachine\Root и LocalMachine\TrustedPublisher обновлены'
}

Write-Host 'Готово. Установщик GG Email больше не должен показывать «Неизвестный издатель».' -ForegroundColor Green
