param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFile,

  [string]$BotUsername = 'SalesAitoBot',

  [string]$TokenFile
)

$ErrorActionPreference = 'Stop'

function Set-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string[]]$Lines,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $prefix = "$Name="
  $updated = $false
  $result = foreach ($line in $Lines) {
    if ($line.StartsWith($prefix, [StringComparison]::Ordinal)) {
      $updated = $true
      "$prefix$Value"
    } else {
      $line
    }
  }

  if (-not $updated) {
    $result += "$prefix$Value"
  }

  return @($result)
}

function ConvertFrom-SecureValue {
  param([Parameter(Mandatory = $true)][Security.SecureString]$Value)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$secureToken = $null
if ([string]::IsNullOrWhiteSpace($TokenFile)) {
  $secureToken = Read-Host 'Вставте token від BotFather (символи не відображатимуться)' -AsSecureString
  $token = ConvertFrom-SecureValue $secureToken
} else {
  $resolvedTokenFile = (Resolve-Path -LiteralPath $TokenFile).Path
  $token = (Get-Content -LiteralPath $resolvedTokenFile -Raw).Trim()
}

try {
  if ($token -notmatch '^\d{8,12}:[A-Za-z0-9_-]{25,}$') {
    throw 'Token має неправильний формат. Налаштування не змінено.'
  }

  $secretBytes = [byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
  $webhookSecret = [Convert]::ToBase64String($secretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $lines = @(Get-Content -LiteralPath $resolvedEnvFile)
  $lines = Set-EnvValue -Lines $lines -Name 'TELEGRAM_BOT_TOKEN' -Value $token
  $lines = Set-EnvValue -Lines $lines -Name 'TELEGRAM_BOT_USERNAME' -Value $BotUsername
  $lines = Set-EnvValue -Lines $lines -Name 'TELEGRAM_WEBHOOK_SECRET' -Value $webhookSecret
  Set-Content -LiteralPath $resolvedEnvFile -Value $lines -Encoding utf8

  Write-Host 'Telegram credentials збережено. Значення не виводилися на екран.'
} finally {
  $token = $null
  if ($null -ne $secureToken) {
    $secureToken.Dispose()
  }
}
