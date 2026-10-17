param([string]$WorkerRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$WorkerRoot = (Resolve-Path -LiteralPath $WorkerRoot).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$servicePath = Join-Path $WorkerRoot 'scripts\marketing-worker-service.mjs'
$launcherPath = Join-Path $WorkerRoot 'scripts\start-marketing-worker.vbs'
$scriptHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
foreach ($required in @($servicePath, $launcherPath, $scriptHost, (Join-Path $WorkerRoot 'scripts\start-marketing-worker.ps1'), (Join-Path $WorkerRoot '.env.intake-production-verified'), (Join-Path $WorkerRoot 'node_modules\tsx'))) {
  if (-not (Test-Path -LiteralPath $required)) { throw 'Worker files, private environment and installed dependencies are required.' }
}
$taskName = 'RHI Pros Local Marketing Worker'
# A console executable as the task action can flash before -WindowStyle takes effect.
# Use the GUI script host, which creates the PowerShell child hidden from startup.
$action = New-ScheduledTaskAction -Execute $scriptHost -Argument ('//B //NoLogo "' + $launcherPath + '"') -WorkingDirectory $WorkerRoot
$logon = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $watchdog) -Settings $settings -Principal $principal -Description 'RHI marketing worker. Processing mode and automatic generation are controlled in the app; owner approval is required for publishing.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'RHI worker installed and started. It runs while this Windows account is signed in, independently of Codex.'
