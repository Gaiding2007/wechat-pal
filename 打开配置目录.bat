@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
echo 正在打开 wechat-pal 配置目录……
if exist "%~dp0config.json" (
  explorer /select,"%~dp0config.json"
) else (
  explorer "%~dp0"
)