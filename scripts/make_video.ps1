# 生成 B 站介绍视频（静音截图 + 中文 TTS + 字幕）
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$ff = Join-Path $root 'runtime\ffmpeg\bin\ffmpeg.exe'
$font = 'C\:/Windows/Fonts/msyh.ttc'
$out = Join-Path $root 'dist\video'
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Speech

$segments = @(
  @{ img = 'docs\v3\01-chat.png';      title = '微信聊天伴侣 wechat-pal'; text = '这是微信聊天伴侣，一个能住进你微信里的 AI 搭子。'; wait = 1.0 },
  @{ img = 'docs\v3\02-wechat.png';    title = '真实微信会话';            text = '她叫鲸鱼娘。能读你真实的微信会话，图片、语音、文件，都能看懂。'; wait = 1.0 },
  @{ img = 'docs\v3\03-moments.png';   title = '朋友圈';                  text = '朋友圈也能刷，能点赞，也能评论。'; wait = 0.8 },
  @{ img = 'docs\v3\04-stickers.png';  title = '表情与生图';              text = '她还会画画，会发表情包，聊天里说一句“画一张”，她就真的去画。'; wait = 1.0 },
  @{ img = 'docs\v3\05-life.png';      title = '她有自己的状态';          text = '她有自己的心情、精力和作息。你跟她聊天，她会真的受影响。'; wait = 1.0 },
  @{ img = 'docs\v3\09-settings-chat.png'; title = '人设完全自定义';       text = '人设可以完全自定义，从性格、说话方式，到主人绑定。'; wait = 0.8 },
  @{ img = 'docs\v3\07-settings.png';  title = '开箱即用';                 text = '双击启动，自带运行环境，不用装 Python，也不用 pip。'; wait = 1.0 },
  @{ img = 'docs\v3\01-chat.png';      title = 'wechat-pal';               text = 'wechat-pal，一个可以养在自己微信里的搭子。开源在 GitHub。'; wait = 1.2 }
)

$concat = New-Object System.Collections.Generic.List[string]
$i = 0
foreach ($s in $segments) {
  $i++
  $n = '{0:d2}' -f $i
  $textFile = Join-Path $out "cap-$n.txt"
  [IO.File]::WriteAllText($textFile, $s.title, (New-Object Text.UTF8Encoding($false)))
  $wav = Join-Path $out "voice-$n.wav"
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('Microsoft Huihui Desktop')
  $synth.Rate = 0
  $synth.SetOutputToWaveFile($wav)
  $synth.Speak($s.text)
  $synth.Dispose()

  # 22.05kHz / 16-bit / 单声道 WAV：44100 字节/秒
  $seconds = ((Get-Item $wav).Length - 44) / 44100 + [double]$s.wait
  $seconds = [math]::Round($seconds, 2)

  $img = Join-Path $root $s.img
  $clip = Join-Path $out "clip-$n.mp4"
  $capPath = ($textFile -replace '\\', '/') -replace ':', '\:'
  $vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf6f4ef,drawbox=y=860:w=iw:h=220:color=0x1c2b28@0.78:t=fill,drawtext=fontfile='$font':textfile='$capPath':fontcolor=white:fontsize=64:x=90:y=930"
  & $ff -y -hide_banner -loglevel error -loop 1 -i $img -i $wav -t $seconds -r 30 `
    -vf $vf -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
    -c:a aac -b:a 160k -ar 44100 -ac 2 -shortest $clip
  if ($LASTEXITCODE -ne 0) { throw "clip $n failed" }
  $concat.Add("file '$clip'")
}

$list = Join-Path $out 'concat.txt'
[IO.File]::WriteAllLines($list, $concat, (New-Object Text.UTF8Encoding($false)))
$final = Join-Path $root 'dist\wechat-pal-intro.mp4'
& $ff -y -hide_banner -loglevel error -f concat -safe 0 -i $list -c copy $final
if ($LASTEXITCODE -ne 0) { throw 'concat failed' }
Write-Host "done: $final"
