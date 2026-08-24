# 启动开发环境：后端 + 前端
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$comfyRoot = if ($env:COMFYUI_ROOT) { $env:COMFYUI_ROOT } else { 'E:\AI\ComfyUI_windows_portable' }
$nodeRoot = if ($env:DIRECTOR_NODE_ROOT) { $env:DIRECTOR_NODE_ROOT } else { 'E:\AI\tools\node-v22.22.3-win-x64' }
$npmCommand = Join-Path $nodeRoot 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCommand)) {
  throw "Director requires Node 22.22.3. Set DIRECTOR_NODE_ROOT to its extracted directory. Missing: $npmCommand"
}

Write-Host "启动 ComfyUI（若 8188 尚未监听）..." -ForegroundColor Cyan
$comfyListening = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue
if (-not $comfyListening) {
  $comfyBat = Join-Path $comfyRoot 'run_nvidia_gpu.bat'
  if (Test-Path -LiteralPath $comfyBat) {
    Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$comfyRoot`" && run_nvidia_gpu.bat" -WindowStyle Normal
  } else {
    Write-Warning "ComfyUI 未找到：$comfyRoot。请设置 COMFYUI_ROOT 或手动启动 ComfyUI。"
  }
} else {
  Write-Host "ComfyUI 已在 8188 端口运行。" -ForegroundColor DarkGray
}

Write-Host "启动后端服务 (backend-node)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend-node'; & '$npmCommand' run dev" -WindowStyle Normal

Write-Host "启动前端服务 (frontweb)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontweb'; & '$npmCommand' run dev" -WindowStyle Normal

Write-Host "开发服务器已启动！" -ForegroundColor Green
Write-Host "  ComfyUI: http://localhost:8188" -ForegroundColor Yellow
Write-Host "  后端: http://localhost:5679" -ForegroundColor Yellow
Write-Host "  前端: http://localhost:3013" -ForegroundColor Yellow
Start-Process 'http://localhost:3013'
