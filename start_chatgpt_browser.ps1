param(
  [string]$BrowserPath = '',
  [string]$ProfilePath = '',
  [int]$RemoteDebuggingPort = 9223,
  [int]$StartupTimeoutSeconds = 10
)

$extensionPath = Join-Path $PSScriptRoot 'browser-extension'
try {
  $runtimeConfig = Invoke-RestMethod -Uri 'http://127.0.0.1:5679/api/v1/settings/image-generation' -TimeoutSec 3
  $chatgptConfig = $runtimeConfig.data.chatgpt_web
  if ($chatgptConfig.enabled -eq $false) {
    Write-Host 'ChatGPT web image channel is disabled; browser startup skipped.' -ForegroundColor DarkGray
    return
  }
  if (-not $BrowserPath) { $BrowserPath = [string]$chatgptConfig.executable }
  if (-not $ProfilePath) { $ProfilePath = [string]$chatgptConfig.profile }
} catch {
  Write-Host 'Image-generation settings are unavailable; using local browser defaults.' -ForegroundColor DarkGray
}
if (-not $BrowserPath -and $env:CHATGPT_BROWSER_PATH) { $BrowserPath = $env:CHATGPT_BROWSER_PATH }
if (-not $BrowserPath) {
  $playwrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  $BrowserPath = Get-ChildItem -LiteralPath $playwrightRoot -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'chrome-win64\chrome.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if (-not $ProfilePath) { $ProfilePath = if ($env:CHATGPT_BROWSER_PROFILE) { $env:CHATGPT_BROWSER_PROFILE } else { Join-Path $PSScriptRoot 'data\chatgpt-browser-profile' } }
if (-not $BrowserPath -or -not (Test-Path -LiteralPath $BrowserPath)) {
  Write-Warning 'Chrome for Testing was not found. Configure its executable in API configuration or set CHATGPT_BROWSER_PATH.'
  return
}
if (-not (Test-Path -LiteralPath (Join-Path $extensionPath 'manifest.json'))) { throw "AIStory extension manifest not found: $extensionPath" }
New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null

$arguments = @(
  '--do-not-de-elevate',
  '--no-sandbox',
  "--user-data-dir=`"$ProfilePath`"",
  "--remote-debugging-port=$RemoteDebuggingPort",
  '--no-first-run',
  '--no-default-browser-check',
  "--disable-extensions-except=`"$extensionPath`"",
  "--load-extension=`"$extensionPath`"",
  'https://chatgpt.com/'
)
$browserProcess = Start-Process -FilePath $BrowserPath -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -PassThru
$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$browserReady = $false
do {
  $browserReady = [bool](Get-NetTCPConnection -LocalPort $RemoteDebuggingPort -State Listen -ErrorAction SilentlyContinue)
  if ($browserReady -or $browserProcess.HasExited) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)

if (-not $browserReady) {
  Write-Warning "ChatGPT browser failed to become ready on port $RemoteDebuggingPort."
  return
}
Write-Host "ChatGPT browser started with AIStory extension." -ForegroundColor Green
Write-Host "Profile: $ProfilePath"
Write-Host "Sign in to ChatGPT once on first launch; this profile will be reused later."
