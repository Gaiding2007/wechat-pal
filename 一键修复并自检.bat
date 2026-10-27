@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 自检 · 微信聊天伴侣

rem 顺手修复「低完整性」标签（从沙箱/工作区复制出来的文件夹会有）
icacls "%~dp0" /setintegritylevel (OI)(CI)M /T /C >nul 2>&1

set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" (
  echo   [!] 没找到 runtime\python\python.exe，请重新解压完整包。
  pause
  exit /b 1
)

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "WECHAT_BRIDGE_WAIT="
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="

echo.
echo   不会发送任何消息，只检查依赖、微信、配置和服务状态。
echo.
"%PY%" "%~dp0bridge\selftest.py"

echo.
pause >nul