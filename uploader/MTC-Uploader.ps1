<#
  Al Ras Steel MTC Tracker - store PC uploader
  - Sends new PO copies / MTCs saved in the inbox folder to the company's workspace.
  - Saves approved ERP Excel files (MTC-{PUR#}.xlsx) into the Excel folder.
  - Keeps a list of sent files, so anything saved while offline is sent on the next run.
  Runs in a loop (started at logon by the scheduled task that Install.ps1 creates).
#>
param([switch]$Once)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Home_ = Join-Path $env:LOCALAPPDATA 'MTCUploader'
$ConfigPath = Join-Path $Home_ 'config.json'
$StatePath = Join-Path $Home_ 'state.json'
$LogPath = Join-Path $Home_ 'uploader.log'
$IntervalSeconds = 30
$Extensions = @('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif')

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  if ((Get-Item $LogPath).Length -gt 5MB) { Move-Item $LogPath "$LogPath.old" -Force }
}

function Get-Config {
  if (-not (Test-Path $ConfigPath)) { throw "Not installed: run Install.ps1 first." }
  $c = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  # The uploader key is stored encrypted for this Windows user (DPAPI)
  $secure = ConvertTo-SecureString $c.key_protected
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  return [pscustomobject]@{ server = $c.server.TrimEnd('/'); key = $key; inbox = $c.inbox; excel = $c.excel }
}

function Get-State {
  if (Test-Path $StatePath) {
    $s = Get-Content $StatePath -Raw | ConvertFrom-Json
    $h = @{}
    foreach ($p in $s.sent.PSObject.Properties) { $h[$p.Name] = $p.Value }
    return $h
  }
  return @{}
}

function Save-State($sent) {
  $tmp = "$StatePath.tmp"
  (@{ sent = $sent } | ConvertTo-Json -Depth 4) | Set-Content -Path $tmp -Encoding UTF8
  Move-Item $tmp $StatePath -Force
}

function Invoke-Api($cfg, [string]$method, [string]$path, $body) {
  $headers = @{ Authorization = "Bearer $($cfg.key)" }
  $uri = "$($cfg.server)$path"
  if ($null -ne $body) {
    $json = $body | ConvertTo-Json -Depth 5
    return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 120
  }
  return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -TimeoutSec 120
}

function Send-NewFiles($cfg, $sent) {
  if (-not (Test-Path $cfg.inbox)) { New-Item -ItemType Directory -Path $cfg.inbox -Force | Out-Null }
  $files = Get-ChildItem -Path $cfg.inbox -File -Recurse | Where-Object {
    $Extensions -contains $_.Extension.ToLower() -and $_.Name -notlike '~$*' -and
    $_.LastWriteTime -lt (Get-Date).AddSeconds(-10)   # wait until the scanner / save has finished
  }
  foreach ($f in $files) {
    $stamp = '{0}|{1}|{2}' -f $f.FullName, $f.Length, $f.LastWriteTimeUtc.Ticks
    if ($sent.ContainsKey($stamp)) { continue }
    try {
      $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower()
      $prep = Invoke-Api $cfg 'Post' '/api/uploader/prepare' @{ name = $f.Name; sha256 = $hash; size = $f.Length }
      if ($prep.skip) {
        Write-Log "Skipped $($f.Name): $($prep.reason)"
      } else {
        $ctype = if ($f.Extension -ieq '.pdf') { 'application/pdf' } elseif ($f.Extension -ieq '.png') { 'image/png' } else { 'image/jpeg' }
        Invoke-WebRequest -Method Put -Uri $prep.upload_url -InFile $f.FullName -ContentType $ctype -Headers @{ 'x-upsert' = 'true' } -UseBasicParsing -TimeoutSec 600 | Out-Null
        $done = Invoke-Api $cfg 'Post' '/api/uploader/complete' @{ path = $prep.path; name = $f.Name; sha256 = $hash; size = $f.Length }
        $po = if ($done.pur) { "PO $($done.pur)" } else { 'no PUR# in the name: assign it in the tracker' }
        Write-Log "Sent $($f.Name) as $($done.kind), $po"
      }
      $sent[$stamp] = (Get-Date).ToString('s')
      Save-State $sent
    } catch {
      Write-Log "Will retry $($f.Name): $($_.Exception.Message)"
    }
  }
}

function Save-ApprovedExcel($cfg) {
  if (-not (Test-Path $cfg.excel)) { New-Item -ItemType Directory -Path $cfg.excel -Force | Out-Null }
  $pending = Invoke-Api $cfg 'Get' '/api/uploader/pending' $null
  foreach ($item in $pending.items) {
    try {
      $target = Join-Path $cfg.excel $item.file_name
      $tmp = "$target.download"
      Invoke-WebRequest -Uri "$($cfg.server)/api/uploader/excel?batch=$($item.batch_id)" -Headers @{ Authorization = "Bearer $($cfg.key)" } -OutFile $tmp -UseBasicParsing -TimeoutSec 120
      Move-Item $tmp $target -Force
      Invoke-Api $cfg 'Post' '/api/uploader/ack' @{ batch_id = $item.batch_id; version = $item.version; saved_path = $target } | Out-Null
      Write-Log "Saved $target"
    } catch {
      Write-Log "Could not save $($item.file_name) yet: $($_.Exception.Message)"
    }
  }
}

New-Item -ItemType Directory -Path $Home_ -Force | Out-Null
Write-Log 'Uploader started'
while ($true) {
  try {
    $cfg = Get-Config
    $sent = Get-State
    Invoke-Api $cfg 'Get' '/api/uploader/config' $null | Out-Null   # heartbeat: admins see "last sync"
    Send-NewFiles $cfg $sent
    Save-ApprovedExcel $cfg
  } catch {
    Write-Log "Offline or error, will retry: $($_.Exception.Message)"
  }
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
}
