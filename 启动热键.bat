@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
set "PY=%~dp0runtime\python\pythonw.exe"
if not exist "%PY%" set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" (
  echo   [!] 没找到 runtime\python，请重新解压完整包。
  pause
  exit /b 1
)
start "" "%PY%" "%~dp0tools\hotkey_daemon.py"
echo.
echo   热键守护已在后台启动（无窗口）。
echo   PageUp  = 暂停自动回复
echo   PageDown = 恢复自动回复
echo   日志：data\hotkey.log
timeout /t 3 /nobreak >nul