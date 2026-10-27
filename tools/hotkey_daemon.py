#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全局热键：PageUp 暂停自动回复，PageDown 恢复。

暂停时会在 data/PAUSED 留下标记，网页服务和桥接都会遵守：
  - 微信来消息不再自动回复
  - 主动搭话也不会再发
再按 PageDown 删除标记，恢复正常。

用法：
  runtime\\python\\pythonw.exe tools\\hotkey_daemon.py
或双击「启动热键.bat」。日志在 data/hotkey.log。
"""
import ctypes
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
FLAG = os.path.join(DATA, "PAUSED")
LOG_FILE = os.path.join(DATA, "hotkey.log")

VK_PRIOR = 0x21  # PageUp
VK_NEXT = 0x22  # PageDown

user32 = ctypes.windll.user32


def log(*parts):
    line = "[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), " ".join(str(p) for p in parts))
    try:
        os.makedirs(DATA, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def beep(times=2, freq=880):
    try:
        import winsound

        for _ in range(times):
            winsound.Beep(freq, 120)
            time.sleep(0.06)
    except Exception:  # noqa: BLE001
        pass


def paused():
    return os.path.exists(FLAG)


def pause():
    os.makedirs(DATA, exist_ok=True)
    with open(FLAG, "w", encoding="utf-8") as handle:
        handle.write(time.strftime("%Y-%m-%d %H:%M:%S"))
    log("已暂停自动回复（PageDown 恢复）")
    beep(1, 660)


def resume():
    try:
        os.remove(FLAG)
    except OSError:
        pass
    log("已恢复自动回复")
    beep(2, 990)


def main():
    os.makedirs(DATA, exist_ok=True)
    log("热键守护已启动：PageUp 暂停，PageDown 恢复")
    held = {VK_PRIOR: False, VK_NEXT: False}
    while True:
        for vk, action in ((VK_PRIOR, "pause"), (VK_NEXT, "resume")):
            down = bool(user32.GetAsyncKeyState(vk) & 0x8000)
            if down and not held[vk]:
                held[vk] = True
                if action == "pause":
                    if not paused():
                        pause()
                else:
                    if paused():
                        resume()
                    else:
                        log("当前没有暂停标记，忽略 PageDown")
            elif not down and held[vk]:
                held[vk] = False
        time.sleep(0.12)


if __name__ == "__main__":
    main()
