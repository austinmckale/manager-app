param(
  [ValidateSet('Off', 'On', 'Status', 'Toggle')]
  [string]$Action = 'Status'
)
$ErrorActionPreference = 'Continue'
$taskName = 'RHI Pros Local Marketing Worker'
$root = Split-Path $PSScriptRoot -Parent
$statusPath = Join-Path $root '.vercel\marketing-worker-service\status.json'

function Get-TaskState {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) { return 'Missing' }
  return [string]$task.State
}

function Stop-LocalModels {
  $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (-not (Test-Path -LiteralPath $ollama)) {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if ($command) { $ollama = $command.Source } else { return }
  }
  foreach ($model in @('qwen3.5:4b', 'qwen2.5vl:3b')) {
    & $ollama stop $model *> $null
  }
}

function Switch-Off {
  if (Test-Path -LiteralPath $statusPath) {
    $status = Get-Content -LiteralPath $statusPath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($status.state -eq 'processing') {
      Write-Output 'A marketing pass is still running. The task will not be killed. Turn it off again after that pass finishes if the PC is still busy.'
      return
    }
  }
  Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  Stop-LocalModels
  Write-Output 'RHI local AI is off.'
}

function Switch-On {
  Enable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  Write-Output 'RHI local AI is on.'
}

switch ($Action) {
  'Off' { Switch-Off }
  'On' { Switch-On }
  'Toggle' { if ((Get-TaskState) -eq 'Disabled') { Switch-On } else { Switch-Off } }
  default {
    $state = Get-TaskState
    if ($state -eq 'Disabled') { Write-Output 'RHI local AI is off.' } else { Write-Output "RHI local AI is on. Task state: $state." }
  }
}
