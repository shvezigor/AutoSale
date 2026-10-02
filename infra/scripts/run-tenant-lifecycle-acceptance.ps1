[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 18080
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFile = Join-Path $repositoryRoot 'compose.yaml'
$acceptanceComposeFile = Join-Path $repositoryRoot 'infra\compose.lifecycle-acceptance.yaml'
$projectName = "salesaito_lifecycle_acceptance_$PID"
$baseUrl = "http://127.0.0.1:$Port"
$started = $false

function New-RandomBytes([int]$Length) {
  $bytes = [byte[]]::new($Length)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return $bytes
}

function New-UrlSafeSecret([int]$Length = 32) {
  return [Convert]::ToBase64String((New-RandomBytes $Length)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-AcceptanceCompose([string[]]$CommandArguments) {
  & docker compose -p $projectName -f $composeFile -f $acceptanceComposeFile @CommandArguments
  if ($LASTEXITCODE -ne 0) {
    $composeExitCode = $LASTEXITCODE
    & docker compose -p $projectName -f $composeFile -f $acceptanceComposeFile logs --no-color --tail 100 api worker
    throw "Acceptance Docker Compose command failed with exit code $composeExitCode"
  }
}

function Register-FictionalOwner([string]$Email, [string]$Password, [string]$TenantName) {
  $registration = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/register" -ContentType 'application/json' -Body (@{
    email = $Email
    password = $Password
    name = $TenantName
    tenantName = $TenantName
  } | ConvertTo-Json -Compress)
  if (-not $registration.previewUrl) {
    throw 'The isolated development stack did not return an email verification preview URL'
  }
  $verification = Invoke-WebRequest -UseBasicParsing -Uri $registration.previewUrl
  if ($verification.StatusCode -ne 200) {
    throw "Fictional owner verification failed with HTTP $($verification.StatusCode)"
  }
}

if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use; rerun with -Port <free-port>"
}

$postgresPassword = New-UrlSafeSecret
$apiPassword = New-UrlSafeSecret
$workerPassword = New-UrlSafeSecret
$backupPassword = New-UrlSafeSecret
$minioAccessKey = "acceptance$((New-UrlSafeSecret 12).ToLowerInvariant())"
$minioSecretKey = New-UrlSafeSecret
$adminPassword = "Aa1!$(New-UrlSafeSecret 24)"
$ownerAPassword = "Aa1!$(New-UrlSafeSecret 24)"
$ownerBPassword = "Aa1!$(New-UrlSafeSecret 24)"
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$adminEmail = "admin-$runId@lifecycle.test"
$ownerAEmail = "owner-a-$runId@lifecycle.test"
$ownerBEmail = "owner-b-$runId@lifecycle.test"

$acceptanceEnvironment = @{
  ACCEPTANCE_PORT = "$Port"
  NODE_ENV = 'development'
  POSTGRES_DB = 'autosale_acceptance'
  POSTGRES_USER = 'autosale'
  POSTGRES_PASSWORD = $postgresPassword
  DATABASE_URL = "postgresql://autosale:$postgresPassword@postgres:5432/autosale_acceptance"
  POSTGRES_API_PASSWORD = $apiPassword
  POSTGRES_WORKER_PASSWORD = $workerPassword
  POSTGRES_BACKUP_PASSWORD = $backupPassword
  REDIS_URL = 'redis://redis:6379'
  DEFAULT_TENANT_ID = [Guid]::NewGuid().ToString()
  DEFAULT_TENANT_KEY = 'acceptance-default'
  META_VERIFY_TOKEN = New-UrlSafeSecret
  META_APP_SECRET = New-UrlSafeSecret
  META_APP_ID = '999999999999999'
  META_GRAPH_API_VERSION = 'v23.0'
  INTEGRATION_ENCRYPTION_KEY = [Convert]::ToBase64String((New-RandomBytes 32))
  MINIO_ROOT_USER = $minioAccessKey
  MINIO_ROOT_PASSWORD = $minioSecretKey
  S3_ENDPOINT = 'http://minio:9000'
  S3_REGION = 'us-east-1'
  S3_BUCKET = 'salesaito-lifecycle-acceptance'
  S3_ACCESS_KEY_ID = $minioAccessKey
  S3_SECRET_ACCESS_KEY = $minioSecretKey
  OPENAI_API_KEY = "sk-fictional-$(New-UrlSafeSecret 20)"
  OPENAI_MODEL = 'gpt-5.4-mini'
  CATALOGUE_AI_STRUCTURE_ANALYSIS = 'false'
  NOVA_POSHTA_DELIVERY_ENABLED = 'false'
  GOOGLE_SERVICE_ACCOUNT_FILE = ''
  GOOGLE_OAUTH_CLIENT_ID = ''
  GOOGLE_OAUTH_CLIENT_SECRET = ''
  GOOGLE_OAUTH_REDIRECT_URI = ''
  GOOGLE_SIGN_IN_ENABLED = 'false'
  GOOGLE_SIGN_IN_REDIRECT_URI = ''
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = ''
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY = ''
  SESSION_COOKIE_NAME = 'salesaito_acceptance_session'
  SESSION_PEPPER = New-UrlSafeSecret
  AUTH_TOKEN_PEPPER = New-UrlSafeSecret
  APP_PUBLIC_URL = $baseUrl
  CLOUDFLARE_TUNNEL_TOKEN = 'fictional-disabled-tunnel-token'
  SMTP_HOST = ''
  SMTP_PORT = '587'
  SMTP_USER = ''
  SMTP_PASSWORD = ''
  SMTP_FROM = 'Sales AITO Acceptance <no-reply@lifecycle.test>'
  TELEGRAM_BOT_TOKEN = ''
  TELEGRAM_BOT_USERNAME = ''
  TELEGRAM_WEBHOOK_SECRET = ''
  DEMO_LEAD_EMAIL = ''
}

foreach ($entry in $acceptanceEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
}

try {
  $started = $true
  Invoke-AcceptanceCompose @('up', '-d', '--build', '--wait', '--wait-timeout', '240')

  $bootstrapPayload = @{
    email = $adminEmail
    name = 'Fictional Lifecycle Admin'
    password = $adminPassword
  } | ConvertTo-Json -Compress
  $bootstrapPayload | & docker compose -p $projectName -f $composeFile -f $acceptanceComposeFile exec -T api node dist/cli/bootstrap-auth.js admin | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Platform-admin bootstrap failed with exit code $LASTEXITCODE"
  }

  Register-FictionalOwner -Email $ownerAEmail -Password $ownerAPassword -TenantName 'Fictional Lifecycle A'
  Register-FictionalOwner -Email $ownerBEmail -Password $ownerBPassword -TenantName 'Fictional Lifecycle B'

  $env:E2E_TENANT_LIFECYCLE_LIVE = '1'
  $env:E2E_BASE_URL = $baseUrl
  $env:E2E_ADMIN_EMAIL = $adminEmail
  $env:E2E_ADMIN_PASSWORD = $adminPassword
  $env:E2E_LIFECYCLE_OWNER_A_EMAIL = $ownerAEmail
  $env:E2E_LIFECYCLE_OWNER_A_PASSWORD = $ownerAPassword
  $env:E2E_LIFECYCLE_OWNER_B_EMAIL = $ownerBEmail
  $env:E2E_LIFECYCLE_OWNER_B_PASSWORD = $ownerBPassword

  Push-Location $repositoryRoot
  try {
    & pnpm exec playwright test tests/e2e/tenant-data-lifecycle.spec.ts
    if ($LASTEXITCODE -ne 0) {
      throw "Tenant lifecycle acceptance failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  Write-Output 'Tenant lifecycle isolated acceptance passed'
} finally {
  if ($started) {
    & docker compose -p $projectName -f $composeFile -f $acceptanceComposeFile down --volumes --remove-orphans | Out-Null
  }
}
