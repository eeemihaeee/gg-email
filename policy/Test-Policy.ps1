<#
.SYNOPSIS
    Тестирует применение политик GG Email без домена.

.DESCRIPTION
    Записывает значения в HKCU\SOFTWARE\Policies\GG Email (пользовательская ветка),
    запускает клиент и показывает, что он видит. Для проверки машинных политик
    используйте -Scope Machine (нужны права администратора).

.PARAMETER Remove
    Удаляет тестовые значения.

.EXAMPLE
    .\Test-Policy.ps1 -Scope User
    .\Test-Policy.ps1 -Remove
#>
[CmdletBinding()]
param(
    [ValidateSet('User', 'Machine')]
    [string]$Scope = 'User',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = if ($Scope -eq 'Machine') { 'HKLM:\SOFTWARE\Policies\GG Email' } else { 'HKCU:\SOFTWARE\Policies\GG Email' }

if ($Remove) {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Тестовые политики удалены из $root"
    return
}

if (-not (Test-Path $root)) {
    New-Item -Path $root -Force | Out-Null
}

New-ItemProperty -Path $root -Name 'UpdateMode' -Value 'notify' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $root -Name 'UpdateChannel' -Value 'beta' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $root -Name 'BlockRemoteContent' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $root -Name 'SyncIntervalMinutes' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $root -Name 'LogLevel' -Value 'debug' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $root -Name 'AutoconfigUrl' -Value 'https://autoconfig.company.ru/mail/config-v1.1.xml?emailaddress=%EMAIL%' -PropertyType String -Force | Out-Null

Write-Host "Записаны тестовые политики в $root:"
Get-ItemProperty $root | Format-List
Write-Host 'Запустите GG Email: в настройках, раздел «Политики», должны отобразиться применённые значения.'
Write-Host "Удалить: .\Test-Policy.ps1 -Remove"
