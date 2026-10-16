$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node -ErrorAction Stop).Source
$servicePath = Join-Path $PSScriptRoot 'marketing-worker-service.mjs'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_HOST = '127.0.0.1:11434'
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  $ollamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path -LiteralPath $ollamaPath) {
    Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WorkingDirectory $workerRoot -WindowStyle Hidden | Out-Null
  }
}
$workerProcess = Start-Process -FilePath $nodePath -ArgumentList @('"' + $servicePath + '"') -WorkingDirectory $workerRoot -WindowStyle Hidden -Wait -PassThru
exit $workerProcess.ExitCode
