@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 重置微信聊天伴侣

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

echo.
echo   ==========================================
echo     恢复出厂设置
echo   ==========================================
echo.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset.ps1"
if errorlevel 1 (
  echo.
  pause >nul
  exit /b 1
)

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
echo.
echo   重新启动伴侣……
echo.
"%NODE%" server.js
set "CODE=%ERRORLEVEL%"
echo.
pause >nul
exit /b %CODE%