$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = if ($env:WAREHOUSE_WIZARD_PORT) { [int]$env:WAREHOUSE_WIZARD_PORT } else { 8088 }
$url = "http://localhost:$port/"

function Test-PortOpen {
  param([int]$Port)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $iar.AsyncWaitHandle.WaitOne(250, $false)
    if ($connected) {
      $client.EndConnect($iar)
    }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

Write-Host "Warehouse Wizard local launcher" -ForegroundColor Cyan
Write-Host "Project: $root"
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is required before first launch. Install Node.js LTS from https://nodejs.org/, then run this launcher again."
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm install
}

if (Test-PortOpen -Port $port) {
  Write-Host "Port $port is already in use. Opening the existing local app at $url" -ForegroundColor Yellow
} else {
  Write-Host "Starting local dev server on $url" -ForegroundColor Yellow
  # Dev server (vite). No service worker is registered in dev mode, so code
  # changes are always served fresh -- no stale precache, no manual SW clearing.
  $devArgs = @("vite", "--host", "127.0.0.1", "--port", "$port", "--strictPort")
  $dev = Start-Process -FilePath "npx.cmd" -ArgumentList $devArgs -WorkingDirectory $root -PassThru -WindowStyle Hidden
  # Dev server needs a moment to compile and start listening before we open the browser.
  for ($i = 0; $i -lt 60; $i++) {
    if ($dev.HasExited) {
      throw "The local dev server stopped before the browser could open."
    }
    if (Test-PortOpen -Port $port) { break }
    Start-Sleep -Milliseconds 500
  }
}

$opened = $false
$browserPaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

foreach ($browser in $browserPaths) {
  if ($browser -and (Test-Path $browser)) {
    Start-Process -FilePath $browser -ArgumentList $url
    $opened = $true
    break
  }
}

if (-not $opened) {
  Start-Process $url
}

Write-Host ""
Write-Host "Warehouse Wizard is running locally at $url" -ForegroundColor Green
Write-Host "This window can stay open while you use the app. Close it when finished."
Read-Host "Press Enter to stop this launcher window"
