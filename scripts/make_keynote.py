#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wechat-pal keynote film.
Style reference: lemo-opuscar / dark-keynote
(dark stage, hairline grid, one accent, UI-as-hero, captions as toast).
All frames are drawn with Pillow; narration is Edge TTS (zh-CN-XiaoyiNeural).
"""
from __future__ import annotations

import math
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "video" / "keynote"
OUT.mkdir(parents=True, exist_ok=True)
SHOTS = ROOT / "dist" / "video" / "shots"
FFMPEG = ROOT / "runtime" / "ffmpeg" / "bin" / "ffmpeg.exe"
PY = ROOT / "runtime" / "python" / "python.exe" if (ROOT / "runtime/python/python.exe").exists() else Path(sys.executable)

W, H = 1920, 1080
FPS = 24
ACCENT = (183, 243, 74)
INK = (244, 246, 240)
MUTED = (156, 163, 152)
DIM = (90, 96, 90)
BG = (8, 10, 9)

F_TITLE = r"C:\Windows\Fonts\msyhbd.ttc"
F_BODY = r"C:\Windows\Fonts\msyh.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t, s=1.3):
    t = max(0.0, min(1.0, t))
    return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2


def fade(t, a=0.0, b=1.0):
    return max(0.0, min(1.0, (t - a) / max(1e-6, b - a)))


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- assets ---
def rounded_card(src: Image.Image, width: int, radius: int = 18, border=1) -> Image.Image:
    src = src.convert("RGB")
    ratio = width / src.width
    im = src.resize((width, max(1, int(src.height * ratio))), Image.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, outline=(255, 255, 255, 26), width=border)
    return out


def with_shadow(card: Image.Image, blur=38, spread=18) -> Image.Image:
    pad = blur + spread
    canvas = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        [pad, pad + 12, pad + card.width, pad + card.height + 12],
        radius=20,
        fill=(0, 0, 0, 170),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(card, (pad, pad))
    return canvas


def paste_alpha(base: Image.Image, im: Image.Image, xy, alpha=1.0):
    if alpha >= 0.999:
        base.alpha_composite(im, (int(xy[0]), int(xy[1])))
        return
    tmp = im.copy()
    a = tmp.getchannel("A").point(lambda v: int(v * alpha))
    tmp.putalpha(a)
    base.alpha_composite(tmp, (int(xy[0]), int(xy[1])))


def draw_text(draw, xy, text, fnt, fill, anchor="la", spacing=8, stroke=0, stroke_fill=None):
    if "\n" in text:
        draw.multiline_text(xy, text, font=fnt, fill=fill, anchor=anchor, spacing=spacing,
                            stroke_width=stroke, stroke_fill=stroke_fill)
    else:
        draw.text(xy, text, font=fnt, fill=fill, anchor=anchor,
                  stroke_width=stroke, stroke_fill=stroke_fill)


# ------------------------------------------------------------- background ---
def make_stage() -> Image.Image:
    y = np.linspace(0, 1, H)[:, None]
    top = np.array([13, 15, 14], dtype=float)
    bottom = np.array([5, 6, 6], dtype=float)
    grad = top * (1 - y) + bottom * y
    stage = np.repeat(grad[:, None, :], W, axis=1).astype(np.uint8)
    im = Image.fromarray(stage, "RGB").convert("RGBA")

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy, r = W // 2, 300, 900
    for i in range(16, 0, -1):
        rr = int(r * i / 16)
        a = int(1.6 * (16 - i))
        gd.ellipse([cx - rr, cy - rr // 2, cx + rr, cy + rr // 2], fill=(120, 150, 120, a))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    im.alpha_composite(glow)

    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, W, 48):
        gd.line([(x, 0), (x, H)], fill=(255, 255, 255, 5 if (x // 48) % 4 else 9), width=1)
    for y in range(0, H, 48):
        gd.line([(0, y), (W, y)], fill=(255, 255, 255, 5 if (y // 48) % 4 else 9), width=1)
    im.alpha_composite(grid)

    # vignette
    vg = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vg)
    vd.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=255)
    vg = vg.filter(ImageFilter.GaussianBlur(220))
    black = Image.new("RGBA", (W, H), (0, 0, 0, 110))
    im = Image.composite(im, black, vg) if False else im
    # simpler corner darkening
    corners = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(corners)
    for i in range(10):
        a = int(10 * (10 - i) / 10)
        cd.rectangle([i * 18, i * 18, W - i * 18, H - i * 18], outline=(0, 0, 0, a), width=18)
    im.alpha_composite(corners)
    return im


STAGE = make_stage()
T_TITLE = font(F_TITLE, 132)
T_TITLE_S = font(F_TITLE, 92)
T_HEAD = font(F_TITLE, 58)
T_SUB = font(F_BODY, 34)
T_BODY = font(F_BODY, 30)
T_SMALL = font(F_BODY, 24)
T_MONO = font(F_MONO, 22)
T_MONO_S = font(F_MONO, 18)
T_CAPTION = font(F_BODY, 32)


def caption(im, text, a=1.0):
    d = ImageDraw.Draw(im)
    text = (text or "").strip()
    if not text:
        return
    maxw = 1080
    words = text
    # wrap by characters (Chinese)
    lines, cur = [], ""
    for ch in words:
        if d.textlength(cur + ch, font=T_CAPTION) > maxw:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    lines = lines[-2:]
    tw = max(d.textlength(l, font=T_CAPTION) for l in lines)
    th = len(lines) * 44
    padx, pady = 34, 20
    bw, bh = tw + padx * 2 + 34, th + pady * 2
    x, y = (W - bw) // 2, H - 78 - bh
    lab = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lab)
    ld.rounded_rectangle([x, y, x + bw, y + bh], radius=bh // 2, fill=(10, 12, 10, int(205 * a)),
                         outline=(255, 255, 255, int(28 * a)), width=1)
    ld.ellipse([x + 22, y + bh // 2 - 5, x + 32, y + bh // 2 + 5], fill=ACCENT + (int(255 * a),))
    ty = y + pady
    for line in lines:
        ld.text((x + padx + 26, ty), line, font=T_CAPTION, fill=INK + (int(255 * a),))
        ty += 44
    im.alpha_composite(lab)


# --------------------------------------------------------------- assets ----
raw_icon = Image.open(ROOT / "assets/persona/whale-girl-icon.png").convert("RGB")
ICON = rounded_card(raw_icon, 104, radius=24)
ICON_BIG = rounded_card(raw_icon, 320, radius=36)

raw_portrait = Image.open(ROOT / "assets/persona/whale-girl.png").convert("RGBA")


def character_card(src: Image.Image, width: int, pad: int = 22) -> Image.Image:
    im = src.copy()
    scale = (width - pad * 2) / im.width
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    card = Image.new("RGBA", (width, im.height + pad * 2), (246, 242, 233, 255))
    card.alpha_composite(im, (pad, pad))
    return with_shadow(rounded_card(card, width, radius=22))


PORTRAIT = character_card(raw_portrait, 430)
PORTRAIT_S = character_card(raw_portrait, 330, pad=18)


def shot(name, width, radius=16):
    return with_shadow(rounded_card(Image.open(SHOTS / name), width, radius=radius))


CHAT = shot("01-chat.png", 900)
WECHAT = shot("02-wechat.png", 1120)
MOMENTS = shot("03-moments.png", 900)
LIFE = shot("05-life.png", 760)
PERSONA = shot("06-persona.png", 860)
CHAT_DEMO = with_shadow(rounded_card(Image.open(ROOT / "dist/video/chat-demo.png").convert("RGB"), 660, radius=26))
PERSONA_RAW = Image.open(ROOT / "dist/video/shots/06-persona.png").convert("RGB").crop((680, 70, 1530, 930))
PERSONA_CROP = with_shadow(rounded_card(PERSONA_RAW, 900, radius=20))
INSTALL_CROP = Image.open(ROOT / "dist/video/bg-install.png").convert("RGB").crop((1040, 200, 1800, 840))
INSTALL = with_shadow(rounded_card(INSTALL_CROP, 560, radius=12))

# ------------------------------------------------------------- narration ---
SCENES = [
    dict(
        key="intro",
        voice="嗨，我是鲸鱼娘。今天想给你看一个，能住进微信里的小家伙。",
        caption=["嗨，我是鲸鱼娘。", "今天想给你看一个，能住进微信里的小家伙。"],
        dur=None,
    ),
    dict(
        key="chat",
        voice="她叫 wechat-pal。你把微信交给她，她就会在聊天里回你。文字、图片，都可以。",
        caption=["她叫 wechat-pal。", "你把微信交给她，她就会在聊天里回你。文字、图片，都可以。"],
    ),
    dict(
        key="persona",
        voice="不只是鲸鱼娘。你可以换一套人格，改她的名字、说话方式，甚至导入你自己写的人设。",
        caption=["不只是鲸鱼娘。", "改名字、改说话方式，或者导入你自己写的人设。"],
    ),
    dict(
        key="install",
        voice="安装很简单。下载安装包，选个文件夹，双击，就好了。",
        caption=["安装很简单。", "下载安装包，选个文件夹，双击，就好了。"],
    ),
    dict(
        key="moments",
        voice="朋友圈、图片、语音、文件，她都能看见。你不在的时候，她也有自己的小生活。",
        caption=["朋友圈、图片、语音、文件，她都能看见。", "你不在的时候，她也有自己的小生活。"],
    ),
    dict(
        key="life",
        voice="她不是那种只会说早安的机器人。你可以教她说话，也可以，慢慢养大她。",
        caption=["她不是只会说早安的机器人。", "你可以教她说话，也可以，慢慢养大她。"],
    ),
    dict(
        key="end",
        voice="wechat-pal。把鲸鱼娘，养进微信。也可以换成，你自己的那个人。GitHub 搜 Gaiding2007。",
        caption=["把鲸鱼娘，养进微信。", "也可以换成，你自己的那个人。"],
    ),
]

import asyncio
import edge_tts


async def tts(text: str, path: Path):
    com = edge_tts.Communicate(text, "zh-CN-XiaoyiNeural", rate="+6%", pitch="+6Hz")
    await com.save(str(path))


def prep_audio():
    for i, s in enumerate(SCENES):
        mp3 = OUT / f"voice_{i}.mp3"
        wav = OUT / f"voice_{i}.wav"
        if not mp3.exists() or mp3.stat().st_size < 1000:
            asyncio.run(tts(s["voice"], mp3))
        subprocess.run([str(FFMPEG), "-y", "-i", str(mp3), "-ar", "44100", "-ac", "2", str(wav)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        with wave.open(str(wav), "rb") as w:
            dur = w.getnframes() / w.getframerate()
        s["audio"] = wav
        s["dur"] = max(4.6, dur + 1.25)
    return sum(s["dur"] for s in SCENES)


def build_audio(total: float, starts):
    n = int(total * 44100) + 44100
    music = np.zeros((n, 2), dtype=np.float32)
    voice = np.zeros((n, 2), dtype=np.float32)
    t = np.arange(n) / 44100
    # soft pad
    chords = [(130.81, 164.81, 196.00), (110.00, 130.81, 164.81),
              (87.31, 130.81, 174.61), (98.00, 123.47, 146.83)]
    for k, ch in enumerate(chords * 8):
        seg = (t >= k * 4) & (t < (k + 1) * 4)
        if not seg.any():
            continue
        tt = t[seg] - k * 4
        env = np.minimum(1, tt / 1.8) * np.minimum(1, (4 - tt) / 1.4)
        for j, f in enumerate(ch):
            music[seg] += (0.010 * env * np.sin(2 * np.pi * f * tt + j)).reshape(-1, 1)
    # 场景转场 ping
    for st in starts:
        i0 = int(st * 44100)
        ln = int(0.09 * 44100)
        if i0 + ln >= n:
            continue
        tt = np.arange(ln) / 44100
        ping = 0.045 * np.sin(2 * np.pi * 1760 * tt) * np.exp(-tt * 42)
        music[i0:i0 + ln, 0] += ping
        music[i0:i0 + ln, 1] += ping
    # BGM
    bgm_path = OUT / "bgm.wav"
    if bgm_path.exists():
        with wave.open(str(bgm_path), "rb") as w:
            bd = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
            bd = bd.reshape(-1, 2)
        if bd.shape[0] < n:
            bd = np.tile(bd, (n // bd.shape[0] + 1, 1))
        music += bd[:n] * 0.26
    # 旁白
    for s, st in zip(SCENES, starts):
        with wave.open(str(s["audio"]), "rb") as w:
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        data = data.reshape(-1, 2)
        i0 = int((st + 0.25) * 44100)
        ln = min(data.shape[0], n - i0)
        voice[i0:i0 + ln] += data[:ln] * 0.92
    # 人声包络：有旁白时把 BGM 压到 26%，间隙回到 100%
    block = 1024
    nb = int(np.ceil(n / block))
    env = np.zeros(nb)
    mono = np.max(np.abs(voice), axis=1)
    for b in range(nb):
        env[b] = mono[b * block:(b + 1) * block].max() if b * block < n else 0
    target = np.where(env > 0.015, 0.18, 0.85)
    smooth = np.zeros(nb)
    cur = 1.0
    atk = 0.35
    rel = 0.06
    for b in range(nb):
        cur += (target[b] - cur) * (atk if target[b] < cur else rel)
        smooth[b] = cur
    gain = np.interp(np.arange(n), np.arange(nb) * block, smooth)
    master = music * gain[:, None] + voice
    master = np.clip(master, -1, 1)
    out = (master * 32767).astype(np.int16)
    with wave.open(str(OUT / "soundtrack.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(out.tobytes())


# --------------------------------------------------------------- scenes ----
def label(d, text, xy, color=MUTED):
    d.text(xy, text, font=T_MONO_S, fill=color)


def scene_intro(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "WECHAT-PAL / 3.3.1", (96, 84), ACCENT)
    a = ease_out(fade(p, 0.0, 0.45))
    y = int(lerp(30, 0, a))
    d.text((92, 380 + y), "把鲸鱼娘", font=T_TITLE, fill=INK + (int(255 * a),))
    d.text((92, 520 + y), "养进微信", font=T_TITLE, fill=ACCENT + (int(255 * a),))
    d.text((96, 700 + y), "一个能住进微信里的 AI 搭子", font=T_SUB, fill=MUTED + (int(255 * a),))
    d.text((96, 748 + y), "会聊天 · 会画画 · 有朋友圈 · 有自己的生活", font=T_SMALL, fill=DIM + (int(255 * a),))
    if p > 0.18:
        ca = ease_out(fade(p, 0.18, 0.45))
        paste_alpha(im, PORTRAIT, (1180, 245 + math.sin(t * 0.9) * 8), ca)


def scene_chat(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "01 / WECHAT", (96, 84), ACCENT)
    d.text((92, 140), "她会在微信里回你。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.05, 0.45))
    chat = CHAT_DEMO.resize((int(CHAT_DEMO.width * 0.98), int(CHAT_DEMO.height * 0.98)), Image.LANCZOS)
    paste_alpha(im, chat, (80 - (1 - a) * 60, 240), a)
    items = [("文字回复", "像朋友一样接话"), ("图片回复", "画完直接发到微信"), ("语音/表情", "收得到，也看得懂")]
    for i, (h, s2) in enumerate(items):
        aa = ease_out(fade(p, 0.30 + i * 0.12, 0.55 + i * 0.12))
        y = 330 + i * 150 + (1 - aa) * 24
        d.ellipse([1240, y + 10, 1254, y + 24], fill=ACCENT + (int(255 * aa),))
        d.text((1274, y), h, font=T_HEAD, fill=INK + (int(255 * aa),))
        d.text((1274, y + 72), s2, font=T_SMALL, fill=MUTED + (int(255 * aa),))


def scene_persona(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "02 / PERSONA", (96, 84), ACCENT)
    d.text((92, 140), "不只是鲸鱼娘。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.05, 0.45))
    paste_alpha(im, PERSONA_CROP, (40 - (1 - a) * 50, 250), a)
    items = [("名字 / 外貌", "头像、配色、别名"), ("性格 / 说话方式", "提示词、口癖、边界"),
             ("导入 / 导出", "两套预设，也能自己写")]
    for i, (h, s2) in enumerate(items):
        aa = ease_out(fade(p, 0.30 + i * 0.12, 0.55 + i * 0.12))
        y = 330 + i * 150 + (1 - aa) * 24
        d.ellipse([1240, y + 10, 1254, y + 24], fill=ACCENT + (int(255 * aa),))
        d.text((1274, y), h, font=T_HEAD, fill=INK + (int(255 * aa),))
        d.text((1274, y + 72), s2, font=T_SMALL, fill=MUTED + (int(255 * aa),))


def scene_install(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "03 / INSTALL", (96, 84), ACCENT)
    d.text((92, 140), "装好，就能用。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.04, 0.42))
    paste_alpha(im, INSTALL, (1080 - (1 - a) * 60, 300), a)
    steps = [("01", "双击安装包", "可以自己选目录"), ("02", "打开网页", "浏览器自动跳转"), ("03", "填一个模型 Key", "或者先用演示模式")]
    for i, (n, h, s) in enumerate(steps):
        aa = ease_out(fade(p, 0.22 + i * 0.14, 0.5 + i * 0.14))
        y = 310 + i * 165 + (1 - aa) * 30
        d.text((96, y), n, font=T_MONO, fill=ACCENT + (int(255 * aa),))
        d.text((168, y - 10), h, font=T_SUB, fill=INK + (int(255 * aa),))
        d.text((168, y + 44), s, font=T_SMALL, fill=MUTED + (int(255 * aa),))


def scene_wechat(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "03 / WECHAT", (96, 84), ACCENT)
    d.text((92, 140), "她住在你的微信里。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.04, 0.42))
    paste_alpha(im, WECHAT, (400, 235 - (1 - a) * 30), a)
    chips = ["真实会话", "图片", "语音", "文件"]
    for i, c in enumerate(chips):
        aa = ease_out(fade(p, 0.32 + i * 0.1, 0.55 + i * 0.1))
        y = 300 + i * 88
        d.rounded_rectangle([96, y, 264, y + 58], radius=29, fill=(19, 22, 19, int(150 * aa)),
                            outline=(255, 255, 255, int(25 * aa)), width=1)
        d.text((126, y + 15), c, font=T_SMALL, fill=INK + (int(255 * aa),))


def scene_moments(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "04 / MOMENTS", (96, 84), ACCENT)
    d.text((92, 140), "朋友圈，也会看，也会回。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.04, 0.42))
    paste_alpha(im, MOMENTS, (130 - (1 - a) * 50, 255), a)
    d.text((1150, 340), "点赞", font=T_HEAD, fill=INK)
    d.text((1150, 430), "评论", font=T_HEAD, fill=INK)
    d.text((1150, 520), "发一条", font=T_HEAD, fill=DIM)
    d.text((1152, 640), "发布仍在实验", font=T_SMALL, fill=MUTED)
    d.text((1152, 680), "其他都已接通", font=T_SMALL, fill=MUTED)
    d.ellipse([1122, 352, 1140, 370], fill=ACCENT)


def scene_life(im, p, t):
    d = ImageDraw.Draw(im)
    label(d, "05 / LIFE", (96, 84), ACCENT)
    d.text((92, 140), "她有自己的生活。", font=T_HEAD, fill=INK)
    a = ease_out(fade(p, 0.04, 0.42))
    paste_alpha(im, LIFE, (86, 300 - (1 - a) * 24), a)
    paste_alpha(im, PORTRAIT_S, (1120, 170), ease_out(fade(p, 0.18, 0.45)))
    aa = ease_out(fade(p, 0.40, 0.62))
    d.text((1124, 780), "心情 72   精力 80   亲近度 12", font=T_SMALL, fill=MUTED + (int(255 * aa),))


def scene_end(im, p, t):
    d = ImageDraw.Draw(im)
    a = ease_out(fade(p, 0.02, 0.4))
    paste_alpha(im, ICON_BIG, ((W - 320) // 2, 168 - (1 - a) * 20), a)
    d.text((W // 2, 540), "把鲸鱼娘，养进微信。", font=T_TITLE_S, fill=INK, anchor="mm")
    d.text((W // 2, 650), "github.com/Gaiding2007/wechat-pal", font=T_MONO, fill=ACCENT, anchor="mm")
    d.text((W // 2, 706), "MIT · 自带运行时 · 双击即用", font=T_SMALL, fill=MUTED, anchor="mm")


SCENE_FN = dict(intro=scene_intro, chat=scene_chat, persona=scene_persona, install=scene_install,
                moments=scene_moments, life=scene_life, end=scene_end)


# ------------------------------------------------------------- subtitles ----
def write_srt(starts):
    def ts(sec):
        h = int(sec // 3600)
        m = int(sec % 3600 // 60)
        s = int(sec % 60)
        ms = int((sec - int(sec)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    idx = 1
    lines = []
    for s, st in zip(SCENES, starts):
        caps = s["caption"]
        total = sum(len(c) for c in caps)
        cur = st + 0.25
        for c in caps:
            dur = max(1.2, (s["dur"] - 0.4) * len(c) / total)
            lines += [str(idx), f"{ts(cur)} --> {ts(cur + dur)}", c, ""]
            idx += 1
            cur += dur
    (OUT / "wechat-pal.srt").write_text("\n".join(lines), encoding="utf-8")


# ------------------------------------------------------------------ main ----
def main():
    total = prep_audio()
    starts, acc = [], 0.0
    for s in SCENES:
        starts.append(acc)
        acc += s["dur"]
    total = acc
    build_audio(total, starts)
    write_srt(starts)

    wav = OUT / "soundtrack.wav"
    out = ROOT / "dist" / "wechat-pal-intro.mp4"
    cmd = [str(FFMPEG), "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(FPS), "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "medium",
           "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for s, st in zip(SCENES, starts):
        frames = max(1, int(round(s["dur"] * FPS)))
        for i in range(frames):
            p = i / frames
            im = STAGE.copy()
            fn = SCENE_FN[s["key"]]
            fn(im, p, st + p * s["dur"])
            cap = s["caption"][0] if p < 0.52 else s["caption"][-1]
            caption(im, cap, fade(p, 0.06, 0.2))
            proc.stdin.write(im.convert("RGB").tobytes())
        print(f"{s['key']}: {s['dur']:.1f}s", flush=True)
    proc.stdin.close()
    proc.wait()
    print("FINAL", out, out.stat().st_size, f"{total:.1f}s")


if __name__ == "__main__":
    main()
