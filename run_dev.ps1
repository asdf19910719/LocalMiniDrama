# Start the development stack: ComfyUI, backend, frontend, and ChatGPT browser.
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$comfyRoot = if ($env:COMFYUI_ROOT) { $env:COMFYUI_ROOT } else { 'E:\AI\ComfyUI_windows_portable' }
$nodeRoot = if ($env:DIRECTOR_NODE_ROOT) { $env:DIRECTOR_NODE_ROOT } else { 'E:\AI\tools\node-v22.22.3-win-x64' }
$npmCommand = Join-Path $nodeRoot 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCommand)) {
  throw "Director requires Node 22.22.3. Set DIRECTOR_NODE_ROOT. Missing: $npmCommand"
}

Write-Host 'Starting ComfyUI when port 8188 is not already listening...' -ForegroundColor Cyan
$comfyListening = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue
if (-not $comfyListening) {
  $comfyBat = Join-Path $comfyRoot 'run_nvidia_gpu.bat'
  if (Test-Path -LiteralPath $comfyBat) {
    Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$comfyRoot`" && run_nvidia_gpu.bat" -WindowStyle Normal
  } else {
    Write-Warning "ComfyUI was not found at $comfyRoot. Set COMFYUI_ROOT or start it manually."
  }
}

Write-Host 'Starting backend...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$projectRoot\backend-node'; & '$npmCommand' run dev" -WindowStyle Normal
Write-Host 'Starting frontend...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$projectRoot\frontweb'; & '$npmCommand' run dev" -WindowStyle Normal

$backendReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5679/health' -TimeoutSec 2 | Out-Null
    $backendReady = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if ($backendReady) {
  & (Join-Path $projectRoot 'start_chatgpt_browser.ps1')
} else {
  Write-Warning 'Backend did not become healthy within 60 seconds; ChatGPT browser startup was skipped.'
}

Write-Host 'Development services started.' -ForegroundColor Green
Write-Host '  ComfyUI: http://127.0.0.1:8188'
Write-Host '  Backend: http://127.0.0.1:5679'
Write-Host '  Frontend: http://127.0.0.1:3013'
Start-Process 'http://127.0.0.1:3013'
