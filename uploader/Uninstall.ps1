Unregister-ScheduledTask -TaskName 'MTC Uploader' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*MTC-Uploader.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path $env:LOCALAPPDATA 'MTCUploader') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'MTC uploader removed. Your inbox and Excel folders were not touched.'
