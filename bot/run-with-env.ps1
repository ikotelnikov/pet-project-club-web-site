param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Command
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$localEnvPath = Join-Path $scriptDir "local-env.ps1"

if (Test-Path $localEnvPath) {
  . $localEnvPath
}

if (-not $env:BOT_REPO_ROOT) {
  $env:BOT_REPO_ROOT = $projectRoot
}

if (-not $env:BOT_CONTENT_ROOT) {
  $env:BOT_CONTENT_ROOT = Join-Path $projectRoot "content"
}

if (-not $env:BOT_ASSETS_ROOT) {
  $env:BOT_ASSETS_ROOT = Join-Path $projectRoot "assets"
}

if (-not $env:TELEGRAM_OFFSET_STATE_PATH) {
  $env:TELEGRAM_OFFSET_STATE_PATH = Join-Path $projectRoot "bot\state\telegram-offset.json"
}

if (-not $Command -or $Command.Count -eq 0) {
  throw "Usage: .\bot\run-with-env.ps1 <command> [args...]"
}

& $Command[0] @($Command | Select-Object -Skip 1)
$exitCode = $LASTEXITCODE

if ($null -ne $exitCode) {
  exit $exitCode
}
