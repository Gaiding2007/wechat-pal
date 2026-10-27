# -*- coding: utf-8 -*-
"""生成几张鲸鱼娘风格的示例表情（扁平、圆角、可直接发送）。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "stickers")
os.makedirs(OUT, exist_ok=True)

SPECS = [
    ("在呢", "#eaf3f8", "#2f6fb3"),
    ("吃白饭", "#fdf1e4", "#c9773f"),
    ("摸鱼中", "#e9f4ec", "#3d8f66"),
    ("别气", "#f7ecf1", "#b45a7a"),
]


def font(size):
    for name in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf"):
        path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def whale(draw, cx, cy, scale, color):
    s = scale
    # 身体
    draw.ellipse((cx - 78 * s, cy - 52 * s, cx + 62 * s, cy + 54 * s), fill=color)
    # 尾巴
    draw.polygon(
        [
            (cx + 56 * s, cy - 6 * s),
            (cx + 104 * s, cy - 40 * s),
            (cx + 92 * s, cy + 6 * s),
            (cx + 110 * s, cy + 34 * s),
            (cx + 58 * s, cy + 24 * s),
        ],
        fill=color,
    )
    # 肚子
    draw.ellipse((cx - 52 * s, cy + 6 * s, cx + 42 * s, cy + 54 * s), fill="#ffffff")
    # 眼睛
    draw.ellipse((cx - 44 * s, cy - 18 * s, cx - 26 * s, cy + 2 * s), fill="#ffffff")
    draw.ellipse((cx - 34 * s, cy - 10 * s, cx - 27 * s, cy + 1 * s), fill="#1e2733")
    # 腮红
    draw.ellipse((cx - 56 * s, cy + 12 * s, cx - 40 * s, cy + 24 * s), fill="#f4a8b8")
    # 水柱
    draw.arc((cx - 10 * s, cy - 92 * s, cx + 26 * s, cy - 50 * s), 200, 520, fill="#8fc7e8", width=max(2, int(5 * s)))


def main():
    for i, (text, bg, accent) in enumerate(SPECS, 1):
        img = Image.new("RGB", (320, 320), bg)
        d = ImageDraw.Draw(img)
        # 底纹方块
        rounded(d, (18, 18, 302, 302), 46, "#ffffff")
        d.rounded_rectangle((18, 18, 302, 302), radius=46, outline=accent, width=4)
        whale(d, 160, 150, 1.0, accent)
        f = font(34)
        box = d.textbbox((0, 0), text, font=f)
        tw = box[2] - box[0]
        d.text(((320 - tw) / 2, 244), text, font=f, fill="#23211d")
        path = os.path.join(OUT, "whale-%d.png" % i)
        img.save(path, "PNG")
        print("wrote", path)


if __name__ == "__main__":
    main()
