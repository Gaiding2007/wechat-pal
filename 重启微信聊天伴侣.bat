@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 重启微信聊天伴侣

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

echo.
echo   正在停止旧进程……
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
timeout /t 2 /nobreak >nul

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"

echo.
echo   重新启动……
echo.
"%NODE%" server.js
set "CODE=%ERRORLEVEL%"
echo.
echo   服务已退出（code %CODE%）。
pause >nul
exit /b %CODE%