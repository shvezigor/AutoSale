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
  api = @('internal')
  worker = @('internal')
  web = @('internal')
}
foreach ($service in $expectedNetworks.Keys) {
  $actual = @($config.services.$service.networks.PSObject.Properties.Name | Sort-Object)
  $expected = @($expectedNetworks[$service] | Sort-Object)
  if (($actual -join ',') -ne ($expected -join ',')) {
    throw "Unexpected networks for $service. Expected $($expected -join ','), got $($actual -join ',')."
  }
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
      if ($_ -eq $edgeNetwork) { 'edge' } elseif ($_ -eq "${projectName}_internal") { 'internal' } else { $_ }
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
  Write-Output 'Live edge network boundary: PASS'
}
