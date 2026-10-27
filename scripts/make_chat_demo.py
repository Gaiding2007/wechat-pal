# -*- coding: utf-8 -*-
"""合成一张「微信聊天」演示图：鲸鱼娘文字回复 + 图片回复，字大清晰。"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "video" / "chat-demo.png"
ICON = ROOT / "assets" / "persona" / "whale-girl-icon.png"
ART = ROOT / "assets" / "persona" / "whale-girl-chibi.png"

W, H = 1120, 1100
im = Image.new("RGB", (W, H), "#f4f1eb")
d = ImageDraw.Draw(im)
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"
font = lambda s, b=False: ImageFont.truetype(FB if b else F, s)

# 卡片
d.rounded_rectangle([24, 24, W - 24, H - 24], 28, fill="#fbfaf7")
# 顶部
d.rounded_rectangle([24, 24, W - 24, 118], 28, fill="#ffffff")
d.rectangle([24, 90, W - 24, 118], fill="#ffffff")
d.line([24, 118, W - 24, 118], fill="#e4dfd4", width=2)
avatar = Image.open(ICON).convert("RGB").resize((66, 66), Image.LANCZOS)
mask = Image.new("L", (66, 66), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, 66, 66], 33, fill=255)
im.paste(avatar, (52, 38), mask)
d.text((136, 48), "鲸鱼娘", font=font(28, True), fill="#23211d")
d.ellipse([140, 88, 152, 100], fill="#2f6b5e")
d.text((160, 78), "在线 · 微信桥接", font=font(18), fill="#7d786e")

# 时间
d.text((W // 2 - 52, 146), "今天 21:14", font=font(18), fill="#9a9489")


def wrap(text, fnt, maxw):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=fnt) <= maxw:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def bubble(text, who, y, img=None):
    fnt = font(30)
    pad_x, pad_y, lh = 26, 20, 46
    if img:
        maxw = 390
        lines = []
    else:
        maxw = 560
        lines = wrap(text, fnt, maxw - pad_x * 2)
    tw = max(d.textlength(l, font=fnt) for l in lines) if lines else 320
    bw = int(tw + pad_x * 2) if not img else 330
    bh = len(lines) * lh + pad_y * 2 if not img else 364
    if who == "me":
        x = W - 52 - bw
        fill = "#2f6b5e"
        color = "#ffffff"
    else:
        x = 132
        fill = "#ffffff"
        color = "#23211d"
        d.ellipse([x - 58, y + 4, x - 6, y + 56], fill="#2f6b5e")
        ico = Image.open(ICON).convert("RGB").resize((52, 52), Image.LANCZOS)
        mk = Image.new("L", (52, 52), 0)
        ImageDraw.Draw(mk).ellipse([0, 0, 52, 52], fill=255)
        im.paste(ico, (x - 58, y + 4), mk)
    if not img:
        d.rounded_rectangle([x, y, x + bw, y + bh], 18, fill=fill,
                            outline="#e4dfd4" if who != "me" else None, width=1)
        for i, line in enumerate(lines):
            d.text((x + pad_x, y + pad_y + i * lh), line, font=fnt, fill=color)
    else:
        d.rounded_rectangle([x, y, x + 330, y + 364], 18, fill="#ffffff",
                            outline="#e4dfd4", width=1)
        art = Image.open(ART).convert("RGB")
        art.thumbnail((300, 300), Image.LANCZOS)
        art = art.resize((300, 300), Image.LANCZOS)
        im.paste(art, (x + 15, y + 15))
        d.text((x + 15, y + 320), "画好了。带着这个去面试吧。", font=font(21), fill="#23211d")
    return y + bh + 26


y = 190
y = bubble("今天面试，有点紧张。", "me", y)
y = bubble("先深呼吸一下。你已经准备很久了，能行。", "bot", y)
y = bubble("给我画一张加油的图吧。", "me", y)
y = bubble("", "bot", y, img=True)
y = bubble("嗯，那我收下了。", "me", y)

OUT.parent.mkdir(parents=True, exist_ok=True)
im.save(OUT)
print(OUT, OUT.stat().st_size)
