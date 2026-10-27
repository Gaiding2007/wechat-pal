@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"

echo.
echo   正在把当前文件夹恢复成「普通完整性」(Medium)……
echo   如果之前是从沙箱/工作区复制出来的，文件会带 Low 标签，
echo   桥接就会发不出消息；这一步把它清掉。
echo.

icacls "%~dp0" /setintegritylevel (OI)(CI)M /T /C >nul 2>&1

if errorlevel 1 (
  echo   [!] 修复失败。请右键这个 bat，选择「以管理员身份运行」再试一次。
) else (
  echo   [OK] 已修复。现在可以双击「启动微信桥接.bat」。
)

echo.
pause
