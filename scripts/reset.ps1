# 恢复出厂：停止进程，清空 data/ 和 config.json，下一次启动会重新生成。
# 不会删除代码、runtime、人设预设或 docs。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host '  这会清空：对话记录、记忆、人设修改、API Key、桥接令牌。' -ForegroundColor Yellow
Write-Host '  人设预设和程序文件会保留。' -ForegroundColor Yellow
$answer = Read-Host '  输入 yes 继续'
if ($answer -ne 'yes') {
  Write-Host '  已取消。'
  exit 1
}

& (Join-Path $PSScriptRoot 'stop.ps1')

$data = Join-Path $root 'data'
if (Test-Path $data) {
  Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $root 'config.json') -Force -ErrorAction SilentlyContinue

Write-Host '  已清空。重新启动伴侣即可。' -ForegroundColor Green
