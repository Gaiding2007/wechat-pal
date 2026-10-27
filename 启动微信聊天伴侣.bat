@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 微信聊天伴侣

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
where node >nul 2>nul
if errorlevel 1 if /i "%NODE%"=="node" (
  echo   [!] 没有找到 Node 运行环境，runtime\node.exe 也丢了。
  echo       重新解压完整压缩包，或者安装 Node 18+：https://nodejs.org/
  pause
  exit /b 1
)

rem 本机代理关掉时，残留的代理变量会让国内接口连不上
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="

echo.
echo   ==========================================
echo     微信聊天伴侣  wechat-pal
echo   ==========================================
echo.
echo   启动后浏览器会自动打开 http://127.0.0.1:8787
echo   第一次用会进入演示模式，填了 API Key 就真的聊。
echo   接微信：先开这个窗口，再双击「启动微信桥接.bat」。
echo.
echo   Ctrl+C 停止服务。
echo.

"%NODE%" server.js
set "CODE=%ERRORLEVEL%"
echo.
echo   服务已退出（code %CODE%）。
pause >nul
exit /b %CODE%