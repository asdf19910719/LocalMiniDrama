@echo off
setlocal
set ROOT=%~dp0
if not defined COMFYUI_ROOT set COMFYUI_ROOT=E:\AI\ComfyUI_windows_portable
if not defined DIRECTOR_NODE_ROOT set DIRECTOR_NODE_ROOT=E:\AI\tools\node-v22.22.3-win-x64
if not exist "%DIRECTOR_NODE_ROOT%\npm.cmd" (
  echo Director requires Node 22.22.3.
  echo Set DIRECTOR_NODE_ROOT to its extracted directory.
  exit /b 1
)

echo [0/3] Checking backend port 5679...
netstat -ano > "%TEMP%\lmd_netstat.txt" 2>&1
findstr ":5679 " "%TEMP%\lmd_netstat.txt" | findstr "LISTENING" > "%TEMP%\lmd_port.txt" 2>&1
for /f "tokens=5" %%a in (%TEMP%\lmd_port.txt) do (
  echo   Killing old process on port 5679 ^(PID %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)
del "%TEMP%\lmd_netstat.txt" >nul 2>&1
del "%TEMP%\lmd_port.txt" >nul 2>&1

echo [1/3] Starting ComfyUI (if not already running)...
netstat -ano | findstr ":8188 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  if exist "%COMFYUI_ROOT%\run_nvidia_gpu.bat" (
    start "ComfyUI" /D "%COMFYUI_ROOT%" cmd /k run_nvidia_gpu.bat
  ) else (
    echo   ComfyUI not found at %COMFYUI_ROOT%
    echo   Set COMFYUI_ROOT or start ComfyUI manually before generating H3 video.
  )
) else (
  echo   ComfyUI is already listening on port 8188.
)

echo [2/3] Starting backend (backend-node)...
start "Backend" cmd /k "cd /d %ROOT%backend-node && "%DIRECTOR_NODE_ROOT%\npm.cmd" run dev"

echo [3/3] Starting frontend (frontweb)...
start "Frontend" cmd /k "cd /d %ROOT%frontweb && "%DIRECTOR_NODE_ROOT%\npm.cmd" run dev"

echo.
echo Done.
echo   ComfyUI: http://127.0.0.1:8188
echo   Backend: http://127.0.0.1:5679
echo   Frontend: http://127.0.0.1:3013

timeout /t 8 /nobreak >nul
start http://127.0.0.1:3013
endlocal
