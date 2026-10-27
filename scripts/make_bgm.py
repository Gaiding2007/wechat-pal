# -*- coding: utf-8 -*-
"""生成 Dark Tech Keynote 风格的轻电子 BGM（无版权素材，纯合成）。"""
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "video" / "keynote"
OUT.mkdir(parents=True, exist_ok=True)
SR = 44100
DUR = 95.0
N = int(SR * DUR)
t = np.arange(N) / SR

rng = np.random.default_rng(20261027)
left = np.zeros(N)
right = np.zeros(N)

# A minor 9 -> F maj7 -> C maj7 -> G6，每小节 3.2s
chords = [
    [220.00, 261.63, 329.63, 392.00],
    [174.61, 220.00, 261.63, 349.23],
    [130.81, 164.81, 196.00, 246.94],
    [196.00, 246.94, 293.66, 392.00],
]
bar = 3.2
bars = int(DUR / bar) + 1
for k in range(bars):
    ch = chords[k % 4]
    t0 = k * bar
    seg = (t >= t0) & (t < t0 + bar)
    tt = t[seg] - t0
    env = np.minimum(1, tt / 0.9) * np.minimum(1, np.maximum(0, (bar - tt)) / 1.1)
    for j, f in enumerate(ch):
        # 柔和 pad，左右轻微失谐
        left[seg] += 0.030 * env * np.sin(2 * np.pi * (f * 0.997) * tt + j)
        right[seg] += 0.030 * env * np.sin(2 * np.pi * (f * 1.003) * tt + j)
        left[seg] += 0.008 * env * np.sin(2 * np.pi * 2 * f * tt)
        right[seg] += 0.008 * env * np.sin(2 * np.pi * 2 * f * tt)
    # 低音
    root = ch[0] / 2
    left[seg] += 0.055 * env * np.sin(2 * np.pi * root * tt)
    right[seg] += 0.055 * env * np.sin(2 * np.pi * root * tt)

# 八分音符琶音
step = bar / 8
for k in range(int(DUR / step) + 1):
    t0 = k * step
    if t0 >= DUR:
        break
    ch = chords[int(t0 / bar) % 4]
    f = ch[(k * 3) % len(ch)] * 2
    i0 = int(t0 * SR)
    ln = int(0.55 * SR)
    if i0 + ln >= N:
        break
    tt = np.arange(ln) / SR
    env = np.exp(-tt * 5.2) * np.minimum(1, tt / 0.005)
    tone = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)
    pan = 0.35 if k % 2 == 0 else 0.65
    left[i0:i0 + ln] += 0.050 * env * tone * (1 - pan)
    right[i0:i0 + ln] += 0.050 * env * tone * pan

# 轻 kick + hat，后半段进入
for k in range(int(DUR / 0.8) + 1):
    t0 = 8.0 + k * 0.8
    if t0 >= DUR:
        break
    i0 = int(t0 * SR)
    ln = int(0.30 * SR)
    if i0 + ln >= N:
        break
    tt = np.arange(ln) / SR
    kick = 0.085 * np.sin(2 * np.pi * (55 - 20 * tt) * tt) * np.exp(-tt * 14)
    left[i0:i0 + ln] += kick
    right[i0:i0 + ln] += kick

for k in range(int(DUR / 0.4) + 1):
    t0 = 8.2 + k * 0.4
    if t0 >= DUR:
        break
    i0 = int(t0 * SR)
    ln = int(0.06 * SR)
    if i0 + ln >= N:
        break
    tt = np.arange(ln) / SR
    noise = rng.normal(0, 1, ln)
    noise = np.diff(np.concatenate([[0], noise]))
    hat = 0.010 * noise * np.exp(-tt * 70)
    left[i0:i0 + ln] += hat
    right[i0:i0 + ln] += hat

# 淡入淡出
fade = int(1.2 * SR)
left[:fade] *= np.linspace(0, 1, fade)
right[:fade] *= np.linspace(0, 1, fade)
left[-fade:] *= np.linspace(1, 0, fade)
right[-fade:] *= np.linspace(1, 0, fade)

master = np.stack([left, right], axis=1)
peak = np.max(np.abs(master)) or 1
master = master / peak * 0.80
out = (master * 32767).astype(np.int16)
path = OUT / "bgm.wav"
with wave.open(str(path), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
print(path, path.stat().st_size)
