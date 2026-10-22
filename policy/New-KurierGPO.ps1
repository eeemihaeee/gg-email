<#
.SYNOPSIS
    Создаёт GPO с рекомендованными настройками Kurier.

.DESCRIPTION
    Требуется модуль GroupPolicy (RSAT) и права на создание GPO в домене.
    Политики записываются в HKLM\SOFTWARE\Policies\Kurier.

.EXAMPLE
    .\New-KurierGPO.ps1 -Name 'Kurier Mail' -AutoconfigUrl 'https://autoconfig.company.ru/mail/config-v1.1.xml?emailaddress=%EMAIL%'
#>
[CmdletBinding()]
param(
    [string]$Name = 'Kurier Mail',
    [string]$AutoconfigUrl = '',
    [ValidateSet('auto', 'notify', 'disabled')]
    [string]$UpdateMode = 'auto',
    [ValidateSet('stable', 'beta', 'internal')]
    [string]$UpdateChannel = 'stable',
    [switch]$DisableAccountManagement
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Module -ListAvailable -Name GroupPolicy)) {
    throw 'Не найден модуль GroupPolicy. Установите RSAT: Get-WindowsCapability -Online | Where-Object Name -like "RSAT.GroupPolicy*" | Add-WindowsCapability -Online'
}

$existing = Get-GPO -Name $Name -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "GPO «$Name» уже существует — обновляю настройки."
    $gpo = $existing
} else {
    $gpo = New-GPO -Name $Name -Comment 'Политики почтового клиента Kurier'
    Write-Host "Создана GPO «$Name» ($($gpo.Id))."
}

$key = 'SOFTWARE\Policies\Kurier'

function Set-PolicyValue {
    param([string]$ValueName, $Value, [string]$Type = 'String')
    Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName $ValueName -Type $Type -Value $Value | Out-Null
}

Set-PolicyValue -ValueName 'UpdateMode' -Value $UpdateMode
Set-PolicyValue -ValueName 'UpdateChannel' -Value $UpdateChannel
Set-PolicyValue -ValueName 'BlockRemoteContent' -Value 1 -Type DWord
Set-PolicyValue -ValueName 'RequireTls' -Value 1 -Type DWord
Set-PolicyValue -ValueName 'AllowHtmlMail' -Value 1 -Type DWord
Set-PolicyValue -ValueName 'SyncIntervalMinutes' -Value 5 -Type DWord
Set-PolicyValue -ValueName 'MaxCacheSizeMb' -Value 4096 -Type DWord
Set-PolicyValue -ValueName 'LogLevel' -Value 'warn'

if ($AutoconfigUrl) {
    Set-PolicyValue -ValueName 'AutoconfigUrl' -Value $AutoconfigUrl
    Write-Host "Автонастройка: $AutoconfigUrl"
}

if ($DisableAccountManagement) {
    Set-PolicyValue -ValueName 'AllowAccountManagement' -Value 0 -Type DWord
}

Write-Host ''
Write-Host "GPO готова. Привяжите её к подразделению:"
Write-Host "  New-GPLink -Name '$Name' -Target 'OU=Users,DC=company,DC=ru'"
Write-Host 'Не забудьте установить ADMX: .\Install-KurierADMX.ps1'
