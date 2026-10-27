@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 微信桥接 · wechat-pal

rem 从 DSH 工作区/沙箱复制出来的文件夹会带「低完整性」标签，导致桥接以 Low
rem 权限运行、UIA 打不开微信（报「未找到 Weixin.dll」）。启动时先恢复 Medium。
icacls "%~dp0" /setintegritylevel (OI)(CI)M /T /C >nul 2>&1

set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" (
  echo   [X] 没找到 runtime\python\python.exe
  echo       这个包是解压即用的，请重新解压完整压缩包。
  pause
  exit /b 1
)
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"

set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "WECHAT_BRIDGE_WAIT=1"

rem 手动启动 = 明确要跑，清掉「一键终止」留下的暂停标记
if exist "data\PAUSED" del /q "data\PAUSED" >nul 2>&1

echo.
echo   ==========================================
echo     微信桥接  ·  wechat-pal
echo   ==========================================
echo.
echo   1. 先由你自己普通双击打开微信 4.x 并完成登录
echo      （主窗口停在聊天列表；不要用管理员身份运行微信）
echo   2. 只读微信数据库收消息，用界面自动化发消息
echo   3. 连上后显示登录账号、数据库目录
echo.
echo   微信还没打开也没关系，这个窗口每 5 秒自动找一次，
echo   最多等 60 分钟；登录好之后会自动连上。
echo.
echo   ※ 桥接故意不代开微信：代开时两边权限可能不一致，
echo     会出现「未找到 Weixin.dll」「SetWindowPos 拒绝访问」，发不出消息。
echo.
echo   找不到数据库时：双击「打开配置目录.bat」，
echo   或打开网页 设置 → 微信 → 微信数据库目录，粘贴 xwechat_files 路径。
echo.
echo   Ctrl+C 停止桥接。
echo.

netstat -ano | findstr /c:":8787" | findstr /c:"LISTENING" >nul 2>nul
if errorlevel 1 (
  echo   网页服务没在跑，先在后台启动它……
  set "NO_OPEN=1"
  start "wechat-pal-server" /min "%NODE%" server.js
  timeout /t 2 /nobreak >nul
)

echo   ------------------------------ 桥接日志 ------------------------------
echo.

rem 守护循环：code 7 / 原生崩溃后自动拉起，避免窗口直接退出
call "%~dp0scripts\bridge_loop.bat"
set "CODE=%ERRORLEVEL%"

echo.
echo   桥接已退出（code %CODE%）。
echo   日志：data\wechat-bridge-4x.log
if not "%CODE%"=="0" (
  echo.
  echo   如果一直连不上，双击「一键修复并自检.bat」看看哪一步没通过。
)
pause >nul
exit /b %CODE%
