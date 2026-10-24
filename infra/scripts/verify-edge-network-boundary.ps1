param([switch]$Live)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFile = Join-Path $repositoryRoot 'compose.yaml'
$rendered = & docker compose -f $composeFile config --no-interpolate --format json
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration did not render.' }
$config = ($rendered -join "`n") | ConvertFrom-Json

$expectedNetworks = @{
  cloudflared = @('edge')
  proxy = @('edge', 'internal')
  api = @('internal', 'provider_egress')
  worker = @('internal', 'provider_egress')
  web = @('internal')
}
foreach ($service in $expectedNetworks.Keys) {
  $actual = @($config.services.$service.networks.PSObject.Properties.Name | Sort-Object)
  $expected = @($expectedNetworks[$service] | Sort-Object)
  if (($actual -join ',') -ne ($expected -join ',')) {
    throw "Unexpected networks for $service. Expected $($expected -join ','), got $($actual -join ',')."
  }
}

if (-not $config.networks.internal.internal) {
  throw 'The application data network must remain externally isolated.'
}
if (-not $config.networks.provider_egress -or $config.networks.provider_egress.internal) {
  throw 'The provider egress network must allow outbound traffic.'
}
$egressMembers = @($config.services.PSObject.Properties | Where-Object {
  $_.Value.networks.PSObject.Properties.Name -contains 'provider_egress'
} | ForEach-Object Name | Sort-Object)
if (($egressMembers -join ',') -ne 'api,worker') {
  throw "Only API and worker may join provider egress, got $($egressMembers -join ',')."
}

$ports = @($config.services.proxy.ports)
if ($ports.Count -ne 2 -or @($ports | Where-Object { $_.host_ip -ne '127.0.0.1' }).Count -gt 0) {
  throw 'Proxy host ports must be published only on 127.0.0.1.'
}
if ((@($ports | ForEach-Object { "{0}:{1}" -f $_.published, $_.target } | Sort-Object) -join ',') -ne '443:443,80:80') {
  throw 'Unexpected proxy host port mappings.'
}

Write-Output 'Edge network boundary configuration: PASS'

if ($Live) {
  $projectName = [string]$config.name
  $edgeNetwork = "${projectName}_edge"
  foreach ($service in $expectedNetworks.Keys) {
    $containerId = (& docker compose -f $composeFile ps -q $service).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Running $service container not found." }
    $inspection = (& docker inspect $containerId | ConvertFrom-Json)[0]
    $actual = @($inspection.NetworkSettings.Networks.PSObject.Properties.Name | ForEach-Object {
      if ($_ -eq $edgeNetwork) { 'edge' } elseif ($_ -eq "${projectName}_internal") { 'internal' } elseif ($_ -eq "${projectName}_provider_egress") { 'provider_egress' } else { $_ }
    } | Sort-Object)
    $expected = @($expectedNetworks[$service] | Sort-Object)
    if (($actual -join ',') -ne ($expected -join ',')) {
      throw "Running $service network membership differs from the tested configuration."
    }
  }

  $probe = @'
const unreachable = async (name, port) => {
  try {
    await fetch(`http://${name}:${port}/health/live`, { signal: AbortSignal.timeout(4000) });
    throw new Error(`${name} is directly reachable on the edge network`);
  } catch (error) {
    if (error.message.includes('directly reachable')) throw error;
  }
};
await unreachable('api', 3001);
await unreachable('worker', 3002);
const response = await fetch('http://proxy:80/health/live', { signal: AbortSignal.timeout(4000) });
if (response.status !== 200) throw new Error('Proxy health route is unavailable on the edge network');
'@
  & docker run --rm --network $edgeNetwork node:24-alpine node --input-type=module -e $probe
  if ($LASTEXITCODE -ne 0) { throw 'Live edge-network reachability probe failed.' }

  $dnsProbe = @'
require('node:dns').lookup('lookaside.fbsbx.com', (error) => {
  if (error) {
    console.error(`Provider DNS unavailable: ${error.code}`);
    process.exitCode = 1;
  }
});
'@
  $httpsProbe = @'
fetch('https://lookaside.fbsbx.com/', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10000),
}).catch((error) => {
  console.error(`Provider HTTPS unavailable: ${error.cause?.code ?? error.name}`);
  process.exitCode = 1;
});
'@
  foreach ($service in @('api', 'worker')) {
    $containerId = (& docker compose -f $composeFile ps -q $service).Trim()
    & docker exec $containerId node -e $dnsProbe
    if ($LASTEXITCODE -ne 0) { throw "Live provider DNS unavailable from $service." }
    & docker exec $containerId node -e $httpsProbe
    if ($LASTEXITCODE -ne 0) { throw "Live provider HTTPS unavailable from $service." }
  }
  Write-Output 'Live edge network boundary: PASS'
}
