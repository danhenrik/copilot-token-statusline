#!/usr/bin/env pwsh
# Thin wrapper around the cross-platform Node installer (install.js) that sits
# next to this script. All arguments are forwarded, e.g.:
#   .\install.ps1 --hide-builtin-context
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install.js'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node was not found on PATH. Install Node.js (the Copilot CLI already needs it) and retry.'
  exit 1
}
& node $installer @args
exit $LASTEXITCODE
