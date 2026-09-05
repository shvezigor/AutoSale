param([Parameter(Mandatory = $true)][string]$EnvFile)
$ErrorActionPreference = 'Stop'
$deploymentEnv = (Resolve-Path -LiteralPath $EnvFile).Path
$deploymentRoot = Split-Path -Parent $PSScriptRoot
Push-Location $deploymentRoot
try {
  $configuration = (& docker compose --env-file $deploymentEnv -p autosale config --format json | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0) { throw 'Compose configuration failed.' }
  foreach ($service in @('api', 'worker')) {
    if ([string]::IsNullOrWhiteSpace($configuration.services.$service.environment.DATABASE_URL)) {
      throw "DATABASE_URL is missing for $service. Deployment stopped before touching running containers."
    }
  }
  & docker compose --env-file $deploymentEnv -p autosale build api web worker
  if ($LASTEXITCODE -ne 0) { throw 'Build failed. Running containers were not changed.' }
  & docker compose --env-file $deploymentEnv -p autosale up -d --no-deps api web worker
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. Inspect container status.' }
  & docker compose --env-file $deploymentEnv -p autosale ps
} finally { Pop-Location }
