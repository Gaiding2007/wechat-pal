@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
start "" "http://127.0.0.1:8787/debug"