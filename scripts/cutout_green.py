# -*- coding: utf-8 -*-
"""绿幕抠图：去背景 + 去绿边，输出透明 PNG。"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent


def cut(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im).astype(np.int16)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    # 绿幕判定：绿色明显高于红蓝
    green = (g > r + 18) & (g > b + 8) & (g > 55)
    alpha = np.where(green, 0, 255).astype(np.uint8)
    # 去绿边：把仍偏绿的像素的 G 压到 max(R,B)
    spill = (~green) & (g > np.maximum(r, b) + 4)
    rgb2 = rgb.copy()
    rgb2[:, :, 1] = np.where(spill, np.maximum(rgb2[:, :, 0], rgb2[:, :, 2]), rgb2[:, :, 1])
    a = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.55))
    out = Image.fromarray(np.dstack([rgb2.astype(np.uint8), np.asarray(a)]), "RGBA")
    out.save(dst)
    bg = Image.new("RGB", out.size, (24, 68, 58))
    bg.paste(out, (0, 0), out)
    bg.save(dst.with_name(dst.stem + "-preview.jpg"), quality=88)
    print(dst, out.size)


cut(ROOT / "assets/persona/whale-girl-green.png", ROOT / "assets/persona/whale-girl-cutout.png")
cut(ROOT / "assets/persona/whale-girl-chibi-green.png", ROOT / "assets/persona/whale-girl-chibi-cutout.png")
