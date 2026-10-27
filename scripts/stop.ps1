# 停止 wechat-pal 的网页服务、桥接和热键守护。
# 只结束命令行里带本项目路径的进程，不会误伤其它 node/python。
$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$rootFull = [System.IO.Path]::GetFullPath($root)
$port = 8787
try {
  $cfg = Get-Content (Join-Path $root 'config.json') -Raw -Encoding utf8 | ConvertFrom-Json
  if ($cfg.server.port) { $port = [int]$cfg.server.port }
} catch { }

$killed = @()
$self = $PID

# 0) 先立暂停标记：桥接守护循环看到 data\PAUSED 就不会 3 秒后又把桥接拉起来
try {
  New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $root 'data\PAUSED') -Value ([string](Get-Date -Format 'o')) -Encoding UTF8
  Write-Host "  已写入 data\PAUSED（防止桥接自动重启）"
} catch {
  Write-Host "  ! 写 data\PAUSED 失败：$($_.Exception.Message)"
}

# 1) 占用端口的监听进程
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $listeners) {
  if ($procId -and $procId -ne $self) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    $killed += "端口 $port / PID $procId"
  }
}

# 2) 命令行属于本项目的 node / python
$pattern = [regex]::Escape($rootFull)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $line = $_.CommandLine
  if (-not $line) { return }
  if ($line -notmatch $pattern) { return }
  if ($line -match 'server\.js' -or $line -match 'wechat_bridge\.py' -or $line -match 'hotkey_daemon\.py' -or $line -match 'bridge_loop' -or $line -match '启动微信桥接') {
    if ($_.ProcessId -ne $self) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $killed += "PID $($_.ProcessId)"
    }
  }
}

# 保底：PAUSED 不删除；启动桥接时由 启动微信桥接.bat 删除

if ($killed.Count -gt 0) {
  Write-Host "  已停止：$($killed -join '，')"
} else {
  Write-Host "  没有发现正在运行的伴侣进程。"
}
