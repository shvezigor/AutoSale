param([Parameter(Mandatory = $true)][string]$EnvFile)
$ErrorActionPreference = 'Stop'
$deploymentEnv = (Resolve-Path -LiteralPath $EnvFile).Path
$deploymentRoot = Split-Path -Parent $PSScriptRoot
Push-Location $deploymentRoot
try {
  $configuration = (& docker compose --env-file $deploymentEnv -p autosale config --format json | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed.' }
  $migrationDatabaseUrl = $configuration.services.migrate.environment.DATABASE_URL
  if ([string]::IsNullOrWhiteSpace($migrationDatabaseUrl)) {
    throw 'Owner DATABASE_URL is missing for migrations. Deployment stopped before touching running containers.'
  }
  foreach ($service in @('api', 'worker')) {
    $runtimeDatabaseUrl = $configuration.services.$service.environment.DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($runtimeDatabaseUrl)) {
      throw "DATABASE_URL is missing for $service. Deployment stopped before touching running containers."
    }
    if ($runtimeDatabaseUrl -eq $migrationDatabaseUrl) {
      throw "$service must not use the owner DATABASE_URL. Deployment stopped before touching running containers."
    }
  }
  & docker compose --env-file $deploymentEnv -p autosale build migrate database_roles api web worker
  if ($LASTEXITCODE -ne 0) { throw 'Build failed. Running containers were not changed.' }
  & docker compose --env-file $deploymentEnv -p autosale run --rm migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Running application containers were not changed.' }
  & docker compose --env-file $deploymentEnv -p autosale run --rm --no-deps database_roles
  if ($LASTEXITCODE -ne 0) { throw 'Runtime database role provisioning failed. Running application containers were not changed.' }
  & docker compose --env-file $deploymentEnv -p autosale up -d --no-deps api web worker
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. Inspect container status.' }
  & docker compose --env-file $deploymentEnv -p autosale ps
} finally { Pop-Location }
