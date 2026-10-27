@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 终止微信聊天伴侣

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

echo.
echo   ==========================================
echo     停止 微信聊天伴侣 / 微信桥接 / 热键
echo   ==========================================
echo.
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
echo.
pause >nul