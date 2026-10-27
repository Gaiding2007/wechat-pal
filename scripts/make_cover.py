# 生成 B 站投稿封面 1146x717
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
out = root / "dist" / "bilibili-cover.png"
W, H = 1146, 717
bg = (28, 43, 40)
img = Image.new("RGB", (W, H), bg)
d = ImageDraw.Draw(img)

for x, y, r, c in [(1000, 120, 180, (47, 107, 94)), (1090, 560, 120, (62, 124, 116)), (90, 640, 80, (47, 107, 94))]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=c)

font_big = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 82)
font_mid = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 36)
font_small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 26)

d.text((70, 110), "我把鲸鱼娘", font=font_big, fill=(246, 244, 239))
d.text((70, 215), "养进了微信", font=font_big, fill=(121, 191, 174))
d.text((74, 345), "会聊天 · 会画画 · 有朋友圈", font=font_mid, fill=(228, 223, 212))
d.text((74, 392), "也有自己的生活和心情", font=font_mid, fill=(228, 223, 212))
d.text((74, 470), "wechat-pal / 微信聊天伴侣", font=font_small, fill=(160, 200, 190))

try:
    shot = Image.open(root / "docs" / "v3" / "01-chat.png").convert("RGB")
    shot.thumbnail((380, 238))
    x = W - shot.width - 48
    y = H - shot.height - 40
    img.paste(shot, (x, y))
    d.rectangle([x - 2, y - 2, x + shot.width + 2, y + shot.height + 2], outline=(121, 191, 174), width=2)
except Exception as e:
    print("shot skipped:", e)

img.save(out)
print(out, out.stat().st_size)
