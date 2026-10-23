param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot '../../Caddyfile')
)

$ErrorActionPreference = 'Stop'
$config = (Resolve-Path -LiteralPath $ConfigPath).Path
$container = 'autosale-caddy-timing-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$marker = 'private-probe-' + [guid]::NewGuid().ToString('N')
$started = $false

try {
  & docker run --detach --rm --network none --name $container --mount "type=bind,source=$config,target=/etc/caddy/Caddyfile,readonly" caddy:2.10.2-alpine caddy run --config /etc/caddy/Caddyfile --adapter caddyfile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated Caddy test container.' }
  $started = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    & docker exec $container wget -q -O /dev/null http://127.0.0.1:2019/config/ 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $ready) { throw 'The isolated Caddy admin endpoint did not become ready.' }

  foreach ($path in @("/dashboard?probe=$marker", "/orders?_rsc=$marker", "/private/$marker")) {
    & docker exec $container wget -q -O /dev/null --header "Cookie: probe=$marker" --header "X-Private-Probe: $marker" "http://127.0.0.1$path" 2>$null
  }

  $logLines = & docker exec $container cat /data/workspace-navigation-timing.log 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The scoped route-timing log file was not created.' }
  $accessLogs = @(
    $logLines |
      ForEach-Object {
        try { $_ | ConvertFrom-Json -ErrorAction Stop } catch { $null }
      } |
      Where-Object { $_ -and $_.msg -eq 'handled request' }
  )

  if ($accessLogs.Count -ne 2) { throw "Expected two scoped access-log entries, found $($accessLogs.Count)." }
  $routes = @($accessLogs | ForEach-Object { $_.route } | Sort-Object)
  if (($routes -join ',') -ne 'dashboard,orders') { throw 'The access logs do not contain only the bounded workspace route labels.' }

  foreach ($entry in $accessLogs) {
    $fields = @($entry.PSObject.Properties.Name)
    if ($fields -contains 'request' -or $fields -contains 'resp_headers') { throw 'An access log retained request or response metadata.' }
    if ($null -eq $entry.duration -or $null -eq $entry.status) { throw 'An access log lacks duration or status.' }
    if (($entry | ConvertTo-Json -Depth 8 -Compress).Contains($marker)) { throw 'An access log retained a private URL, cookie or header marker.' }
  }

  Write-Output 'Caddy route timing verified: two bounded entries, no private request or response metadata.'
} finally {
  if ($started) { & docker stop $container 2>$null | Out-Null }
}
