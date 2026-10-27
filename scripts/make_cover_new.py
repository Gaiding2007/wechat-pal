# -*- coding: utf-8 -*-
"""Build a bold 1146x717 Bilibili cover with the new transparent artwork."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1146, 717
BG = (11, 21, 18)
ACCENT = (183, 243, 74)
INK = (245, 246, 242)
MUTED = (150, 160, 152)
DIM = (100, 112, 104)

F_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
F_BODY = r"C:\Windows\Fonts\msyh.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def rounded(im, r):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0], im.size[1]], radius=r, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def fit(path, max_w, max_h):
    im = Image.open(path).convert("RGBA")
    scale = min(max_w / im.width, max_h / im.height)
    return im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)


def glow(im, pos, color=(183, 243, 74), radius=100, alpha=55):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = pos
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(42))
    im.alpha_composite(layer)


cover = Image.new("RGBA", (W, H), BG + (255,))
d = ImageDraw.Draw(cover, "RGBA")

# 背景：大色块 + 发丝网格
d.ellipse([760, -260, 1280, 260], fill=(31, 73, 62, 255))
d.ellipse([-260, 520, 240, 1020], fill=(20, 40, 34, 255))
for x in range(40, W, 48):
    d.line([(x, 0), (x, H)], fill=(255, 255, 255, 6), width=1)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=(255, 255, 255, 6), width=1)

# 顶部标识
d.text((52, 34), "WECHAT-PAL  /  3.3.1", font=font(F_MONO, 18), fill=(226, 255, 176, 255))

# 标题
t1 = font(F_BOLD, 92)
t2 = font(F_BOLD, 108)
d.text((50, 108), "我把鲸鱼娘", font=t1, fill=INK + (255,))
d.text((46, 204), "养进了微信", font=t2, fill=ACCENT + (255,))

d.text((54, 348), "会聊天 · 会画画 · 换人格", font=font(F_BODY, 30), fill=(225, 231, 224, 255))
d.text((54, 394), "有朋友圈，也有自己的生活", font=font(F_BODY, 25), fill=MUTED + (255,))

# 角色
glow(cover, (925, 360), radius=180, alpha=45)
d = ImageDraw.Draw(cover, "RGBA")
full = fit(os.path.join(ROOT, "assets", "persona", "whale-girl.png"), 430, 640)
cover.alpha_composite(full, (760, 38))

# 左下 Q 版
chibi = fit(os.path.join(ROOT, "assets", "persona", "whale-girl-chibi-cutout.png"), 160, 160)
cover.alpha_composite(chibi, (58, 468))

# 标签
tags = ["真实微信", "朋友圈", "可换人格"]
x = 54
y = 658
for tag in tags:
    f = font(F_BODY, 21)
    tw = d.textlength(tag, font=f)
    d.rounded_rectangle([x, y, x + tw + 34, y + 42], radius=21, fill=(17, 30, 25, 230),
                        outline=ACCENT + (110,), width=1)
    d.text((x + 17, y + 8), tag, font=f, fill=INK + (255,))
    x += tw + 50

# 底部链接

out = os.path.join(ROOT, "dist", "bilibili-cover.png")
cover.convert("RGB").save(out, quality=95)
print(out, cover.size)
