param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Off', 'On', 'Status', 'Toggle')]
  [string]$Action
)

$ErrorActionPreference = 'Continue'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$TaskName = 'RHI Pros Local Marketing Worker'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StatusPath = Join-Path $RepoRoot '.vercel\marketing-worker-service\status.json'

function Get-OllamaExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  $command = Get-Command -Name 'ollama.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { $candidates += $command.Source }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
}

function Get-MarketingTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Test-TaskDisabled {
  $task = Get-MarketingTask
  return ($null -ne $task -and [string]$task.State -eq 'Disabled')
}

function Test-OllamaRunning {
  return $null -ne (Get-Process -Name 'ollama' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Stop-LocalModels {
  $ollamaExe = Get-OllamaExecutable
  if (-not $ollamaExe) { return }
  & $ollamaExe stop 'qwen3.5:4b' 2>&1 | Out-Null
  & $ollamaExe stop 'qwen3.5:9b' 2>&1 | Out-Null
  & $ollamaExe stop 'qwen2.5vl:3b' 2>&1 | Out-Null
}

function Show-AiMessage {
  param([Parameter(Mandatory = $true)][string]$Body)
  $shell = New-Object -ComObject WScript.Shell
  # 64 = information icon, 4096 = system modal. Zero seconds waits until OK is clicked.
  [void]$shell.Popup($Body, 0, 'RHI local AI', 4160)
}

function Get-ScheduledTaskStateLine {
  $task = Get-MarketingTask
  if ($null -eq $task) {
    return 'Scheduled task: not found.'
  }
  return "Scheduled task: $([string]$task.State)."
}

function Get-OllamaLoadedModelNote {
  $ollamaExe = Get-OllamaExecutable
  if (-not $ollamaExe) {
    return 'Local models are not loaded.'
  }
  $names = New-Object System.Collections.Generic.List[string]
  $lines = & $ollamaExe ps 2>&1 | ForEach-Object { "$_" }
  foreach ($line in @($lines)) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed -match '^(?i)NAME\s+') { continue }
    if ($trimmed -match '^(?i)(error:|time=|level=|failed|warning:)') { continue }
    $name = ($trimmed -split '\s+', 2)[0]
    if ($name -match '^[A-Za-z0-9][A-Za-z0-9._:\-]*$') {
      $names.Add($name)
    }
  }
  if ($names.Count -gt 0) {
    return "The model is still loaded ($($names -join ', ')). This is not proof the GPU is free."
  }
  return 'Local models are not loaded.'
}

function Get-ActionDetailText {
  return "$(Get-ScheduledTaskStateLine)`r`n$(Get-OllamaLoadedModelNote)"
}

function Test-PassStillRunning {
  $hybridStatus = Join-Path (Split-Path -Parent $RepoRoot) 'manager-app-marketing-hybrid-20261017\.vercel\marketing-worker-service\status.json'
  foreach ($path in @($StatusPath, $hybridStatus)) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
      $report = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json
      if ([string]$report.state -eq 'processing') { return $true }
    } catch {
      continue
    }
  }
  return $false
}

function Set-WorkerOff {
  if (Test-PassStillRunning) {
    Write-Output 'A pass is still running.'
    Show-AiMessage -Body ("A pass is still running. The task was not turned off.`r`n`r`n" + (Get-ActionDetailText))
    return
  }
  Disable-ScheduledTask -TaskName $TaskName -ErrorAction Continue | Out-Null
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Stop-LocalModels
  Write-Output 'RHI local AI is off.'
  $offIntro = 'Local AI is now off. The marketing worker is disabled and local models were asked to stop. You can use this PC for games. If a pass was already running, it may finish first. Turn AI on again with this shortcut when you want drafts to resume.'
  Show-AiMessage -Body ($offIntro + "`r`n`r`n" + (Get-ActionDetailText))
}

function Set-WorkerOn {
  Enable-ScheduledTask -TaskName $TaskName -ErrorAction Continue | Out-Null
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
  Write-Output 'RHI local AI is on.'
  $onIntro = 'Local AI is now on. The marketing worker is enabled and will check in on its next cycle. New uploads are processed only when automatic processing is on in Processing and review.'
  Show-AiMessage -Body ($onIntro + "`r`n`r`n" + (Get-ActionDetailText))
}

function Show-WorkerStatus {
  $task = Get-MarketingTask
  if ($null -ne $task -and [string]$task.State -ne 'Disabled') {
    $summary = 'RHI local AI is on.'
  } else {
    $summary = 'RHI local AI is off.'
  }
  $taskLine = Get-ScheduledTaskStateLine
  if (Test-OllamaRunning) {
    $ollamaLine = 'Ollama: running.'
  } else {
    $ollamaLine = 'Ollama: not running.'
  }
  $modelLine = Get-OllamaLoadedModelNote
  Write-Output $summary
  Write-Output $taskLine
  Write-Output $ollamaLine
  Write-Output $modelLine
  Show-AiMessage -Body "$summary`r`n$taskLine`r`n$ollamaLine`r`n$modelLine"
}

switch ($Action) {
  'Off' { Set-WorkerOff }
  'On' { Set-WorkerOn }
  'Status' { Show-WorkerStatus }
  'Toggle' {
    if (Test-TaskDisabled) { Set-WorkerOn } else { Set-WorkerOff }
  }
}
