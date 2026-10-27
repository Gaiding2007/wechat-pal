@echo off
chcp 65001 >nul
setlocal
title 微信聊天伴侣 安装
set "SRC=%~dp0"
set "DST=%LOCALAPPDATA%\Programs\wechat-pal"
echo.
echo   微信聊天伴侣 wechat-pal
echo   ------------------------------------
echo   安装位置：%DST%
echo.
echo   安装会覆盖程序文件，但不会删除 data 里的聊天记录和设置。
echo   请先关闭正在运行的「微信聊天伴侣」和「微信桥接」窗口。
echo.
pause
if not exist "%LOCALAPPDATA%\Programs" mkdir "%LOCALAPPDATA%\Programs"
echo 正在复制文件（约 300MB，第一次会慢一点）...
robocopy "%SRC%." "%DST%" /E /XD dist .git /NFL /NDL /NJH /NJS /R:1 /W:1 >nul
if errorlevel 8 (
  echo.
  echo 复制失败。请确认没有程序占用文件，或把压缩包解压到别的目录再试。
  pause
  exit /b 1
)
echo 正在创建快捷方式...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $d=[Environment]::GetFolderPath('Desktop'); $lnk=$ws.CreateShortcut((Join-Path $d '微信聊天伴侣.lnk')); $lnk.TargetPath=Join-Path '%DST%' '启动微信聊天伴侣.bat'; $lnk.WorkingDirectory='%DST%'; $lnk.Description='微信聊天伴侣 wechat-pal'; $lnk.Save(); $sm=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'; $lnk2=$ws.CreateShortcut((Join-Path $sm '微信聊天伴侣.lnk')); $lnk2.TargetPath=Join-Path '%DST%' '启动微信聊天伴侣.bat'; $lnk2.WorkingDirectory='%DST%'; $lnk2.Save()" >nul 2>nul
echo.
echo 安装完成，正在启动...
start "" "%DST%\启动微信聊天伴侣.bat"
echo.
echo 以后从桌面「微信聊天伴侣」启动即可。
echo 要连微信：先在微信里登录好，再双击安装目录里的「启动微信桥接.bat」。
timeout /t 5 >nul
exit /b 0
