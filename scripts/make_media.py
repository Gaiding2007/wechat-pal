# -*- coding: utf-8 -*-
"""生成视频用的封面/标题卡/结尾卡（Pillow）。"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'video')
os.makedirs(OUT, exist_ok=True)
WHALE = os.path.join(ROOT, 'assets', 'persona', 'whale-girl.png')
W, H = 1920, 1080
BG = (23, 48, 42)
ACCENT = (124, 199, 180)
MUTED = (176, 196, 190)

FONT_B = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_R = 'C:/Windows/Fonts/msyh.ttc'
def font(size, bold=True):
    return ImageFont.truetype(FONT_B if bold else FONT_R, size, index=0)

def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out

def shadow_card(base, box, radius=44, blur=34, alpha=120):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=(0, 0, 0, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)

def whale_block(size=720, rotate=0):
    im = Image.open(WHALE).convert('RGB')
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
    im = im.resize((size, size), Image.LANCZOS)
    im = rounded(im, 60)
    if rotate:
        im = im.rotate(rotate, expand=True, resample=Image.BICUBIC)
    return im

def portrait(w, h, radius=28):
    """把透明角色图等比放进 w×h 的圆角卡片，米白底。"""
    im = Image.open(WHALE).convert('RGBA')
    scale = min((w - 18) / im.width, (h - 18) / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    card = Image.new('RGBA', (w, h), (246, 242, 233, 255))
    card.alpha_composite(im, ((w - nw) // 2, (h - nh) // 2))
    return rounded(card, radius)

def background():
    base = Image.new('RGBA', (W, H), BG + (255,))
    d = ImageDraw.Draw(base, 'RGBA')
    # 右上大圆 + 左下小圆
    d.ellipse([W - 620, -260, W + 260, 620], fill=(47, 107, 94, 120))
    d.ellipse([-240, H - 420, 320, H + 140], fill=(47, 107, 94, 80))
    d.ellipse([W - 210, H - 150, W + 90, H + 150], fill=(124, 199, 180, 40))
    return base

def intro(path):
    base = background()
    d = ImageDraw.Draw(base)
    d.text((120, 190), '我把鲸鱼娘', font=font(118), fill=(255, 255, 255, 255))
    d.text((120, 340), '养进了微信', font=font(128), fill=ACCENT + (255,))
    d.text((124, 540), '会聊天 · 会画画 · 有朋友圈', font=font(46, False), fill=MUTED + (255,))
    d.text((124, 630), '也有自己的生活和心情', font=font(46, False), fill=MUTED + (255,))
    d.text((124, 880), 'wechat-pal / 微信聊天伴侣', font=font(34, False), fill=(150, 175, 168, 255))
    card_box = [1130, 120, 1750, 960]
    shadow_card(base, card_box)
    base.alpha_composite(portrait(620, 840), (1130, 120))
    d2 = ImageDraw.Draw(base)
    d2.rounded_rectangle(card_box, radius=28, outline=(124, 199, 180, 90), width=2)
    base.convert('RGB').save(path, quality=95)

def end(path):
    base = background()
    d = ImageDraw.Draw(base)
    d.text((0, 250), 'wechat-pal', font=font(150), fill=(255, 255, 255, 255), anchor='ma')
    d.text((0, 450), '一个可以养在微信里的搭子', font=font(68), fill=ACCENT + (255,), anchor='ma')
    d.text((0, 560), 'github.com/Gaiding2007/wechat-pal', font=font(40, False), fill=MUTED + (255,), anchor='ma')
    im = portrait(280, 340, radius=20)
    base.alpha_composite(im, ((W - 280) // 2, 640))
    base.convert('RGB').save(path, quality=95)

def install(path):
    base = background()
    d = ImageDraw.Draw(base)
    d.text((120, 200), '双击安装', font=font(118), fill=(255, 255, 255, 255))
    d.text((124, 360), '选个目录，就能用', font=font(58), fill=ACCENT + (255,))
    items = ['自带 Node / Python / ffmpeg', '自定义安装目录', '桌面快捷方式，双击即用']
    y = 500
    for it in items:
        d.ellipse([124, y + 12, 148, y + 36], fill=ACCENT + (255,))
        d.text((170, y), it, font=font(40, False), fill=MUTED + (255,))
        y += 84
    # 模拟安装向导
    win = [1060, 220, 1780, 820]
    shadow_card(base, win)
    d.rounded_rectangle(win, radius=22, fill=(250, 249, 245, 255), outline=(210, 206, 196, 255), width=2)
    d.rectangle([1060, 220, 1780, 292], fill=(238, 235, 228, 255))
    d.text((1088, 238), 'wechat-pal 安装程序', font=font(30), fill=(40, 40, 36, 255))
    d.text((1092, 330), '选择安装位置', font=font(30), fill=(40, 40, 36, 255))
    d.rounded_rectangle([1092, 390, 1640, 448], radius=10, fill=(255, 255, 255, 255), outline=(210, 206, 196, 255), width=2)
    d.text((1110, 405), r'C:\Users\你\AppData\Local\Programs\wechat-pal', font=font(24, False), fill=(90, 88, 82, 255))
    d.rounded_rectangle([1652, 390, 1748, 448], radius=10, fill=(47, 107, 94, 255))
    d.text((1680, 407), '浏览', font=font(24, False), fill=(255, 255, 255, 255))
    d.text((1092, 500), '磁盘占用：约 300 MB', font=font(26, False), fill=(120, 118, 110, 255))
    d.rounded_rectangle([1092, 600, 1748, 618], radius=9, fill=(229, 226, 216, 255))
    d.rounded_rectangle([1092, 600, 1520, 618], radius=9, fill=(47, 107, 94, 255))
    d.text((1092, 640), '安装中：释放运行时和资源…', font=font(24, False), fill=(120, 118, 110, 255))
    d.rounded_rectangle([1560, 730, 1748, 788], radius=12, fill=(47, 107, 94, 255))
    d.text((1630, 746), '下一步', font=font(26, False), fill=(255, 255, 255, 255))
    base.convert('RGB').save(path, quality=95)

def cover(path):
    # B站封面：1146x717，鲸鱼娘 + 标题
    cw, ch = 1146, 717
    base = Image.new('RGBA', (cw, ch), BG + (255,))
    d = ImageDraw.Draw(base, 'RGBA')
    d.ellipse([cw - 430, -170, cw + 120, 380], fill=(47, 107, 94, 150))
    d.ellipse([-150, ch - 260, 210, ch + 100], fill=(47, 107, 94, 100))
    d.text((64, 94), '我把鲸鱼娘', font=font(84), fill=(255, 255, 255, 255))
    d.text((64, 190), '养进了微信', font=font(92), fill=ACCENT + (255,))
    d.text((66, 320), '会聊天 · 会画画 · 换人格', font=font(32, False), fill=MUTED + (255,))
    d.text((66, 372), '有朋友圈，也有自己的生活', font=font(32, False), fill=MUTED + (255,))
    d.text((66, 610), 'wechat-pal / 微信聊天伴侣', font=font(24, False), fill=(150, 175, 168, 255))
    # 右侧截图卡片
    im = portrait(380, 540, radius=22)
    box = [cw - 440, 70, cw - 60, 650]
    shadow_card(base, box, radius=22, blur=24, alpha=120)
    base.alpha_composite(im, (cw - 440, 70))
    d.rounded_rectangle(box, radius=22, outline=(124, 199, 180, 100), width=2)
    labels = ['真实微信', '朋友圈', '可换人格']
    x = cw - 440
    for lb in labels:
        tw = d.textlength(lb, font=font(24, False))
        d.rounded_rectangle([x, 620, x + tw + 36, 668], radius=24, fill=(47, 107, 94, 180), outline=(124, 199, 180, 90), width=1)
        d.text((x + 18, 631), lb, font=font(24, False), fill=(255, 255, 255, 255))
        x += tw + 52
    base.convert('RGB').save(path, quality=95)

if __name__ == '__main__':
    intro(os.path.join(OUT, 'bg-intro.png'))
    end(os.path.join(OUT, 'bg-end.png'))
    install(os.path.join(OUT, 'bg-install.png'))
    cover(os.path.join(ROOT, 'dist', 'bilibili-cover.png'))
    print('ok')
