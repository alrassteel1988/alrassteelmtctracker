<#
  Installs the MTC uploader for the current Windows user on a store PC.
  Run in PowerShell:  powershell -ExecutionPolicy Bypass -File .\Install.ps1
#>
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Home_ = Join-Path $env:LOCALAPPDATA 'MTCUploader'
New-Item -ItemType Directory -Path $Home_ -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'MTC-Uploader.ps1') (Join-Path $Home_ 'MTC-Uploader.ps1') -Force

Write-Host 'Al Ras Steel MTC Tracker uploader setup' -ForegroundColor Cyan
$server = Read-Host 'Tracker web address (e.g. https://mtc.alrassteel.com)'
$secure = Read-Host 'Uploader key (from Settings and uploaders)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
  $cfgRemote = Invoke-RestMethod -Uri ($server.TrimEnd('/') + '/api/uploader/config') -Headers @{ Authorization = "Bearer $key" }
} catch {
  Write-Host "The tracker did not accept this key: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
Write-Host "Key accepted: $($cfgRemote.name) for $($cfgRemote.company)" -ForegroundColor Green
$inbox = Read-Host "MTC inbox folder [$($cfgRemote.inbox_folder)]"
if (-not $inbox) { $inbox = $cfgRemote.inbox_folder }
$excel = Read-Host "Excel folder [$($cfgRemote.excel_folder)]"
if (-not $excel) { $excel = $cfgRemote.excel_folder }
New-Item -ItemType Directory -Path $inbox -Force | Out-Null
New-Item -ItemType Directory -Path $excel -Force | Out-Null

@{
  server = $server.TrimEnd('/')
  key_protected = ($secure | ConvertFrom-SecureString)   # encrypted for this Windows user
  inbox = $inbox
  excel = $excel
} | ConvertTo-Json | Set-Content (Join-Path $Home_ 'config.json') -Encoding UTF8

$script = Join-Path $Home_ 'MTC-Uploader.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'MTC Uploader' -Action $action -Trigger $trigger -Settings $settings -Description 'Al Ras Steel MTC Tracker uploader' -Force | Out-Null
Start-ScheduledTask -TaskName 'MTC Uploader'

Write-Host ''
Write-Host "Done. Save PO copies and MTCs into $inbox (name them starting with the PUR#, e.g. 'L0037354 MTC.pdf')." -ForegroundColor Green
Write-Host "Approved Excel files will appear in $excel. Log: $Home_\uploader.log"
