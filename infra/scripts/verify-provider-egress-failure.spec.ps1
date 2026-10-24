# Run only against the local Compose stack; all provider traffic is read-only.
$ErrorActionPreference = 'Stop'
$realDocker = (Get-Command docker.exe).Source
$verification = Join-Path $PSScriptRoot 'verify-edge-network-boundary.ps1'

function docker {
  if ($args.Count -ge 5 -and $args[0] -eq 'exec' -and
      ($args -join ' ').Contains('https://lookaside.fbsbx.com/')) {
    $global:LASTEXITCODE = 42
    return
  }
  & $realDocker @args
}

try {
  & $verification -Live | Out-Null
  throw 'The live boundary check accepted a failed provider HTTPS probe.'
} catch {
  if ($_.Exception.Message -notlike '*provider HTTPS unavailable*') {
    throw
  }
}

Write-Output 'Provider HTTPS failure detection: PASS'
