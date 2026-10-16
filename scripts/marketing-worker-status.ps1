param([string]$WorkerRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$statusPath = Join-Path $WorkerRoot '.vercel\marketing-worker-service\status.json'
if (-not (Test-Path -LiteralPath $statusPath)) { Write-Output 'Worker has not reported a status yet.'; exit 1 }
$report = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$alive = $null -ne (Get-Process -Id $report.pid -ErrorAction SilentlyContinue)
[pscustomobject]@{
  Running = $alive
  Fresh = (([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($report.updatedAt)).TotalMinutes -lt 65)
  State = $report.state
  LastCheckUtc = $report.updatedAt
  LastSuccessUtc = $report.lastSuccessAt
  ConsecutiveFailures = $report.failures
  Issue = $report.issue
} | Format-List
