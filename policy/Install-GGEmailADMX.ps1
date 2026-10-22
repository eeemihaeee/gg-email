<#
.SYNOPSIS
    Устанавливает файлы ADMX/ADML GG Email в центральное хранилище политик.

.DESCRIPTION
    Копирует GGEmail.admx и локализации в C:\Windows\PolicyDefinitions.
    Требуются права администратора. После установки политики доступны в
    редакторе групповых политик:
      Конфигурация компьютера → Административные шаблоны → GG Email Почта
      Конфигурация пользователя → Административные шаблоны → GG Email Почта

.PARAMETER PolicyStore
    Необязательный путь к папке Policies конкретной GPO
    (\\domain\sysvol\domain\Policies\{GUID}\Policies). Если указан,
    файлы копируются туда вместо локального хранилища.

.PARAMETER Backup
    Создать резервную копию существующих файлов перед заменой.

.EXAMPLE
    .\Install-GGEmailADMX.ps1 -Backup
#>
[CmdletBinding()]
param(
    [string]$PolicyStore,
    [switch]$Backup
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$admxSource = Join-Path $scriptRoot 'GGEmail.admx'

if (-not (Test-Path $admxSource)) {
    throw "Не найден $admxSource. Соберите файлы командой: npm run admx"
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $PolicyStore) {
    if (-not $isAdmin) {
        throw 'Нужны права администратора (или укажите -PolicyStore для папки GPO).'
    }
    $PolicyStore = Join-Path $env:windir 'PolicyDefinitions'
}

$targets = @(
    @{ Source = (Join-Path $scriptRoot 'GGEmail.admx'); Destination = (Join-Path $PolicyStore 'GGEmail.admx') },
    @{ Source = (Join-Path $scriptRoot 'ru-RU\GGEmail.adml'); Destination = (Join-Path $PolicyStore 'ru-RU\GGEmail.adml') },
    @{ Source = (Join-Path $scriptRoot 'en-US\GGEmail.adml'); Destination = (Join-Path $PolicyStore 'en-US\GGEmail.adml') }
)

foreach ($target in $targets) {
    if (-not (Test-Path $target.Source)) {
        throw "Не найден $($target.Source)"
    }
    $directory = Split-Path -Parent $target.Destination
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }
    if ($Backup -and (Test-Path $target.Destination)) {
        Copy-Item $target.Destination "$($target.Destination).bak" -Force
    }
    Copy-Item $target.Source $target.Destination -Force
    Write-Host "Установлено: $($target.Destination)"
}

Write-Host ''
Write-Host 'Готово. Откройте gpedit.msc или консоль управления групповыми политиками.'
Write-Host 'Раздел: Административные шаблоны → GG Email Почта.'
