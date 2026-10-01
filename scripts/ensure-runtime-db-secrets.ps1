param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [switch]$Rotate
)

$ErrorActionPreference = 'Stop'
$resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$secretNames = @('POSTGRES_API_PASSWORD', 'POSTGRES_WORKER_PASSWORD', 'POSTGRES_BACKUP_PASSWORD')
$content = [System.IO.File]::ReadAllText($resolvedEnvFile)
$newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
$changed = $false

function New-UrlSafeSecret {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Get-EnvValue([string]$Name, [string]$Text) {
  $match = [regex]::Match($Text, "(?m)^$([regex]::Escape($Name))=(.*)$")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim()
}

foreach ($name in $secretNames) {
  $existing = Get-EnvValue $name $content
  if ($Rotate -or [string]::IsNullOrWhiteSpace($existing)) {
    $secret = New-UrlSafeSecret
    if ($null -eq $existing) {
      if ($content.Length -gt 0 -and -not $content.EndsWith($newline)) { $content += $newline }
      $content += "$name=$secret$newline"
    } else {
      $content = [regex]::Replace(
        $content,
        "(?m)^$([regex]::Escape($name))=.*$",
        "$name=$secret"
      )
    }
    $changed = $true
  }
}

$apiPassword = Get-EnvValue 'POSTGRES_API_PASSWORD' $content
$workerPassword = Get-EnvValue 'POSTGRES_WORKER_PASSWORD' $content
$backupPassword = Get-EnvValue 'POSTGRES_BACKUP_PASSWORD' $content
$ownerPassword = Get-EnvValue 'POSTGRES_PASSWORD' $content
foreach ($value in @($apiPassword, $workerPassword, $backupPassword)) {
  if ($value.Length -lt 32 -or $value -notmatch '^[A-Za-z0-9_-]+$') {
    throw 'Runtime database secrets must be different URL-safe values with at least 32 characters.'
  }
}
$distinctPasswords = @($apiPassword, $workerPassword, $backupPassword) | Select-Object -Unique
if ($distinctPasswords.Count -ne 3) {
  throw 'API, worker, and backup database secrets must be different.'
}
if (-not [string]::IsNullOrWhiteSpace($ownerPassword) -and $ownerPassword -in @($apiPassword, $workerPassword, $backupPassword)) {
  throw 'API, worker, and backup database secrets must be different from the owner secret.'
}

if ($changed) {
  [System.IO.File]::WriteAllText($resolvedEnvFile, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host 'Runtime database secrets prepared. Their values were not printed.'
} else {
  Write-Host 'Runtime database secrets are already present and valid.'
}
