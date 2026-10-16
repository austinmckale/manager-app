param([string]$WorkerRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$WorkerRoot = (Resolve-Path -LiteralPath $WorkerRoot).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$servicePath = Join-Path $WorkerRoot 'scripts\marketing-worker-service.mjs'
foreach ($required in @($servicePath, (Join-Path $WorkerRoot '.env.intake-production-verified'), (Join-Path $WorkerRoot 'node_modules\tsx'))) {
  if (-not (Test-Path -LiteralPath $required)) { throw 'Worker files, private environment and installed dependencies are required.' }
}
$taskName = 'RHI Pros Local Marketing Worker'
$launcherPath = Join-Path $WorkerRoot 'scripts\start-marketing-worker.ps1'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcherPath + '"') -WorkingDirectory $WorkerRoot
$logon = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $watchdog) -Settings $settings -Principal $principal -Description 'Local-only RHI transcription and draft preparation. No outbound delivery or publishing.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'RHI worker installed and started. It runs while this Windows account is signed in, independently of Codex.'
