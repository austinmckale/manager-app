param([string]$WorkerRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$WorkerRoot = (Resolve-Path -LiteralPath $WorkerRoot).Path
$toggleScript = Join-Path $WorkerRoot 'scripts\set-marketing-worker.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell)) { throw 'Windows PowerShell was not found.' }
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $desktop)) { throw 'The current user Desktop folder was not found.' }
$shortcutPath = Join-Path $desktop 'RHI AI.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $toggleScript + '" -Action Toggle'
$shortcut.WorkingDirectory = $WorkerRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Turn RHI local AI on or off so this PC can be used for games.'
$shortcut.Save()
Write-Output $shortcutPath
