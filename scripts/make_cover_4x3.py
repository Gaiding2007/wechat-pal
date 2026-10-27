# -*- coding: utf-8 -*-
"""4:3 version of the Bilibili cover (1200x900)."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 900
BG = (11, 21, 18)
ACCENT = (183, 243, 74)
INK = (245, 246, 242)
MUTED = (150, 160, 152)

F_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
F_BODY = r"C:\Windows\Fonts\msyh.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def fit(path, max_w, max_h):
    im = Image.open(path).convert("RGBA")
    scale = min(max_w / im.width, max_h / im.height)
    return im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)


def glow(im, pos, color=(183, 243, 74), radius=120, alpha=55):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = pos
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(46))
    im.alpha_composite(layer)


cover = Image.new("RGBA", (W, H), BG + (255,))
d = ImageDraw.Draw(cover, "RGBA")

# 背景块与网格
d.ellipse([840, -280, 1420, 300], fill=(31, 73, 62, 255))
d.ellipse([-300, 640, 300, 1240], fill=(20, 40, 34, 255))
for x in range(40, W, 48):
    d.line([(x, 0), (x, H)], fill=(255, 255, 255, 6), width=1)
for y in range(0, H, 48):
    d.line([(0, y), (W, y)], fill=(255, 255, 255, 6), width=1)

d.text((52, 38), "WECHAT-PAL  /  3.3.1", font=font(F_MONO, 18), fill=(226, 255, 176, 255))

# 标题
d.text((50, 130), "我把鲸鱼娘", font=font(F_BOLD, 96), fill=INK + (255,))
d.text((46, 232), "养进了微信", font=font(F_BOLD, 112), fill=ACCENT + (255,))
d.text((54, 388), "会聊天 · 会画画 · 换人格", font=font(F_BODY, 31), fill=(225, 231, 224, 255))
d.text((54, 436), "有朋友圈，也有自己的生活", font=font(F_BODY, 26), fill=MUTED + (255,))

# 角色
glow(cover, (965, 430), radius=200, alpha=45)
d = ImageDraw.Draw(cover, "RGBA")
full = fit(os.path.join(ROOT, "assets", "persona", "whale-girl.png"), 480, 790)
cover.alpha_composite(full, (760, 42))

# 功能行
features = ["文字 · 图片 · 语音 · 文件", "朋友圈 · 点赞 · 评论", "自定义人格 · 生图 · 自拍"]
for i, line in enumerate(features):
    yy = 500 + i * 46
    d.ellipse([58, yy + 9, 70, yy + 21], fill=ACCENT + (255,))
    d.text((84, yy), line, font=font(F_BODY, 23), fill=(205, 214, 205, 255))

# Q 版
chibi = fit(os.path.join(ROOT, "assets", "persona", "whale-girl-chibi-cutout.png"), 170, 170)
cover.alpha_composite(chibi, (58, 640))

# 标签
tags = ["真实微信", "朋友圈", "可换人格"]
x, y = 54, 824
for tag in tags:
    f = font(F_BODY, 21)
    tw = d.textlength(tag, font=f)
    d.rounded_rectangle([x, y, x + tw + 34, y + 42], radius=21, fill=(17, 30, 25, 230),
                        outline=ACCENT + (110,), width=1)
    d.text((x + 17, y + 8), tag, font=f, fill=INK + (255,))
    x += tw + 50

out = os.path.join(ROOT, "dist", "bilibili-cover-4x3.png")
cover.convert("RGB").save(out, quality=95)
print(out, cover.size)

