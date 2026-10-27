# -*- coding: utf-8 -*-
"""用 edge-tts + ffmpeg 生成 B 站介绍视频（1920x1080，xfade 转场）。"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VID = os.path.join(ROOT, 'dist', 'video')
SHOTS = os.path.join(VID, 'shots')
FF = os.path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffmpeg.exe')
FP = os.path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffprobe.exe')
PY = r'C:\Users\14127\AppData\Local\Programs\Python\Python313\python.exe'
FONT = 'C\\:/Windows/Fonts/msyh.ttc'
VOICE = 'zh-CN-XiaoyiNeural'

SEGS = [
    ('intro', os.path.join(VID, 'bg-intro.png'), '如果鲸鱼娘住进你的微信，会是什么样？', ''),
    ('chat', os.path.join(SHOTS, '01-chat.png'), '她叫鲸鱼娘。会读你真实的微信消息，图片、语音、文件，都看得懂。', '她叫鲸鱼娘，不是只会说早安的机器人'),
    ('wechat', os.path.join(SHOTS, '02-wechat.png'), '群里聊到一半，她也会接话。被点到名，不会答错人。', '群聊里接得住话，也认得出是谁在说'),
    ('moments', os.path.join(SHOTS, '03-moments.png'), '朋友圈能刷，能点赞，也能认真评论。', '朋友圈不是摆设，她会看，也会回'),
    ('stickers', os.path.join(SHOTS, '04-stickers.png'), '她还会发表情包。你让她画，她就画一张发过来。', '表情包和生图，都是她自己挑的'),
    ('life', os.path.join(SHOTS, '05-life.png'), '她有自己的心情和作息。和你聊几句，会真的影响她。', '心情、精力、亲近度，都会慢慢变'),
    ('persona', os.path.join(SHOTS, '06-persona.png'), '人设全部可以改。长相、说话方式，都由你定。', '人设不是 Prompt，是可以慢慢养的角色'),
    ('install', os.path.join(VID, 'bg-install.png'), '现在有了安装包。双击，选个目录，就能用。不用装 Python。', '安装包自带运行环境，选目录即可'),
    ('end', os.path.join(VID, 'bg-end.png'), 'wechat-pal。一个可以养在微信里的搭子。', ''),
]


def run(args, **kw):
    p = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if p.returncode != 0:
        raise RuntimeError('CMD FAILED: ' + ' '.join(args) + '\n' + (p.stderr or '')[-2000:])
    return p.stdout


def dur(path):
    import re
    p = subprocess.run([FF, '-i', path, '-f', 'null', '-'], capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', p.stderr or '')
    if not m:
        raise RuntimeError('no duration: ' + (p.stderr or '')[-800:])
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def tts(text, out):
    if os.path.exists(out):
        os.remove(out)
    run([PY, '-m', 'edge_tts', '--voice', VOICE, '--rate=+8%', '--pitch=+3Hz',
         '--text', text, '--write-media', out])


def srt_text(i, s):
    return s.replace("'", '')


def main():
    os.makedirs(os.path.join(VID, 'tts'), exist_ok=True)
    clips, voices, durations = [], [], []
    for i, (name, img, text, sub) in enumerate(SEGS):
        mp3 = os.path.join(VID, 'tts', f'{i:02d}-{name}.mp3')
        tts(text, mp3)
        d = dur(mp3)
        gap = 0.9 if i == len(SEGS) - 1 else 0.3
        total = d + 0.9
        subfile = os.path.join(VID, 'tts', f'{i:02d}-sub.txt')
        with open(subfile, 'w', encoding='utf-8') as f:
            f.write(sub or text)
        clip = os.path.join(VID, 'tts', f'{i:02d}.mp4')
        vf = (
            'scale=1920:1080:force_original_aspect_ratio=decrease,'
            'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x17302a,'
            'format=yuv420p'
        )
        if sub:
            sub_ff = subfile.replace('\\', '/').replace(':', '\\:')
            vf += (
                f",drawbox=x=0:y=ih-230:w=iw:h=230:color=black@0.28:t=fill"
                f",drawtext=fontfile='{FONT}':textfile='{sub_ff}':fontcolor=white:fontsize=46:"
                f"line_spacing=12:box=1:boxcolor=black@0.18:boxborderw=20:"
                f"x=(w-text_w)/2:y=h-155"
            )
        vf += ",fade=t=in:st=0:d=0.35,fade=t=out:st=" + f"{max(0.1, total-0.35):.2f}" + ":d=0.35"
        run([FF, '-y', '-loop', '1', '-i', img, '-i', mp3,
             '-t', f'{total:.3f}', '-r', '30',
             '-vf', vf,
             '-af', 'apad',
             '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
             '-c:a', 'aac', '-b:a', '192k', clip])
        clips.append(clip)
        voices.append(mp3)
        durations.append(total)
        print(f'{i} {name}: {d:.2f}s + 0.9 = {total:.2f}s')

    # 视频/音频 concat（ffmpeg 4.1 没有 xfade），用短淡入淡出衔接
    inputs = []
    for c in clips:
        inputs += ['-i', c]
    n = len(clips)
    vcat = ''.join(f'[{i}:v]' for i in range(n)) + f'concat=n={n}:v=1:a=0[vout]'
    acat = ''.join(f'[{i}:a]' for i in range(n)) + f'concat=n={n}:v=0:a=1[aout]'
    video = os.path.join(VID, 'video-only.mp4')
    run([FF, '-y', *inputs, '-filter_complex', vcat + ';' + acat,
         '-map', '[vout]', '-map', '[aout]',
         '-c:v', 'libx264', '-crf', '19', '-preset', 'medium',
         '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', video])
    total = dur(video)
    print('video', total)

    # 环境底噪 + 低音铺底
    bgm = os.path.join(VID, 'bgm.wav')
    run([FF, '-y', '-f', 'lavfi', '-i', f'sine=frequency=110:sample_rate=44100:duration={total:.2f}',
         '-f', 'lavfi', '-i', f'sine=frequency=164.81:sample_rate=44100:duration={total:.2f}',
         '-f', 'lavfi', '-i', f'sine=frequency=220:sample_rate=44100:duration={total:.2f}',
         '-filter_complex',
         '[0:a]volume=0.5[a0];[1:a]volume=0.28[a1];[2:a]volume=0.16[a2];'
         '[a0][a1][a2]amix=inputs=3,lowpass=f=700,tremolo=f=0.12:d=0.35,'
         f'afade=t=in:d=2,afade=t=out:st={max(0,total-3):.2f}:d=3,volume=0.22[out]',
         '-map', '[out]', '-ar', '44100', '-ac', '2', bgm])

    final = os.path.join(ROOT, 'dist', 'wechat-pal-intro.mp4')
    run([FF, '-y', '-i', video, '-i', bgm,
         '-filter_complex', '[0:a]volume=1.0[voice];[1:a]volume=0.16[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=0[a]',
         '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-movflags', '+faststart', final])
    print('FINAL', final, os.path.getsize(final), dur(final))


if __name__ == '__main__':
    main()
