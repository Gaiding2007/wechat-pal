@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions
cd /d "%~dp0.."

rem 优先用包里自带的 Python（解压即用，不需要用户装）
set "PY=%~dp0..\runtime\python\python.exe"
if not exist "%PY%" set "PY=python"

rem 本机代理没开时，残留的 HTTPS_PROXY 会让识别/模型请求连不上
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "WECHAT_BRIDGE_WAIT=1"

:wait_paused
if exist "data\PAUSED" (
  timeout /t 5 /nobreak >nul
  goto wait_paused
)

:loop
echo.
echo [%date% %time%] 启动微信桥接……
"%PY%" -u "bridge\wechat_bridge.py"
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="0" (
  echo [%date% %time%] 桥接正常退出（code=0），不再自动重启。
  exit /b 0
)
if "%CODE%"=="1" (
  echo [%date% %time%] 桥接启动失败（code=1，组件/依赖没加载）。看 data\wechat-bridge-4x.log。
  exit /b 1
)
if "%CODE%"=="2" (
  echo [%date% %time%] 桥接提示需要处理（code=2，比如微信没开或数据库路径没找到）。
  echo [%date% %time%] 按上面日志里的提示操作，然后关掉这个窗口重新双击「启动微信桥接.bat」。
  exit /b 2
)
if "%CODE%"=="7" (
  echo [%date% %time%] 发送看门狗要求重启（code=7），3 秒后自动重启…
) else (
  echo [%date% %time%] 桥接异常退出（code=%CODE%）。负数是原生崩溃，3 秒后自动重启…
)

timeout /t 3 /nobreak >nul
if exist "data\PAUSED" goto wait_paused
goto loop
