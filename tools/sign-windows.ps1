param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Thumbprint,
  [string]$Pfx,
  [string]$PfxPassword,
  [string]$Timestamp = 'http://timestamp.digicert.com'
)

# Подпись собранного установщика сертификатом, установленным на этой машине
# (EV-токен, HSM или PFX). CI может собирать неподписанный артефакт, а подпись
# выполняется там, где есть доступ к ключу.
$ErrorActionPreference = 'Stop'
$file = Get-Item $Path
$signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' |
  Sort-Object FullName -Descending | Select-Object -First 1).FullName
if (-not $signtool) { throw 'signtool.exe не найден: установите Windows SDK' }

$args = @('sign', '/fd', 'sha256', '/td', 'sha256', '/tr', $Timestamp, '/v')
if ($Pfx) {
  $args += @('/f', $Pfx)
  if ($PfxPassword) { $args += @('/p', $PfxPassword) }
} elseif ($Thumbprint) {
  $args += @('/sha1', ($Thumbprint -replace '\s', ''))
} else {
  throw 'Укажите -Thumbprint (сертификат в хранилище) или -Pfx (файл сертификата)'
}
$args += $file.FullName

& $signtool @args
if ($LASTEXITCODE -ne 0) { throw "signtool завершился с кодом $LASTEXITCODE" }

$signature = Get-AuthenticodeSignature $file.FullName
$signature | Format-List Status, StatusMessage, SignerCertificate
if ($signature.Status -ne 'Valid') { throw "Подпись недействительна: $($signature.StatusMessage)" }
Write-Host "Подписано: $($file.FullName)" -ForegroundColor Green
