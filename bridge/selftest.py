#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键自检：不发送任何消息，只检查「能不能跑起来」。

检查项：
  1. 随包 Python / 依赖是否齐全
  2. 微信 4.x 是否在运行、数据库是否找得到
  3. config.json 是否可解析，令牌是否还是默认值
  4. 网页服务是否在 8787 上
  5. ffmpeg（可选，用来看图）

用法：
  runtime\\python\\python.exe bridge\\selftest.py
或者双击「一键修复并自检.bat」。
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config.json")
PORT = 8787
# 随包 Python 可能带 _pth 配置，显式把 bridge 目录放进 sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OK = "[ OK ]"
BAD = "[ !! ]"
WARN = "[ ?? ]"


def line(tag, text, hint=""):
    print(f"{tag} {text}")
    if hint:
        print(f"       -> {hint}")


def check_integrity():
    """低完整性进程打不开微信，UIA 会报「未找到 Weixin.dll」。"""
    try:
        out = subprocess.run(["whoami", "/groups"], capture_output=True,
                             text=True, errors="replace", timeout=8).stdout or ""
        m = re.search(r"S-1-16-(\d+)", out)
        rid = int(m.group(1)) if m else None
    except Exception as exc:  # noqa: BLE001
        line(WARN, "读不到进程完整性级别", repr(exc))
        return
    if rid is None:
        line(WARN, "读不到进程完整性级别")
    elif rid < 0x2000:
        line(BAD, "当前是低完整性 (Low) 运行，会发不出消息",
             "双击「修复权限.bat」，或直接用「启动微信桥接.bat」启动（它会自动修复）")
    else:
        line(OK, "进程完整性正常（Medium）")


def check_import(name, attr=None):
    try:
        mod = __import__(name)
        if attr:
            getattr(mod, attr)
        return True
    except Exception as exc:  # noqa: BLE001
        line(BAD, f"依赖 {name} 导入失败：{exc}", "重新解压完整包，runtime 目录可能不完整")
        return False


def check_process():
    try:
        from wechat_bridge import find_weixin_process
    except Exception as exc:  # noqa: BLE001
        line(WARN, f"微信进程检查没跑起来：{exc}")
        return None
    proc = find_weixin_process()
    if proc is not None:
        line(OK, f"微信进程在运行：Weixin.exe（PID {proc.pid}）")
        return True
    line(BAD, "没有找到 Weixin.exe / WeChat.exe", "先打开微信并登录，再启动桥接")
    return False


def check_db(running=True):
    try:
        from wechatauto import WeChatDB
    except Exception as exc:  # noqa: BLE001
        line(BAD, f"wechatauto 不可用：{exc}")
        return False
    db_dir = ""
    try:
        from wechat_bridge import resolve_db_dir
        db_dir = resolve_db_dir()
    except Exception as exc:  # noqa: BLE001
        line(WARN, f"数据库目录自动检测没跑起来：{exc}", "可以手动在网页 设置 → 微信 → 微信数据库目录 里填")
        db_dir = ""
    if db_dir:
        line(OK, f"微信数据库目录：{db_dir}")
    else:
        line(BAD, "没找到微信数据库目录", "双击「打开配置目录.bat」，在 config.json 的 wechat.dbDir 填 xwechat_files 路径")
    if not running:
        line(WARN, "微信主程序没运行，先打开并登录，再启动桥接", "登录后桥接会自动重试，不需要重启")
        return False
    try:
        from wechat_bridge import patch_wechatdb_process_lookup
        patch_wechatdb_process_lookup()
    except Exception:  # noqa: BLE001
        pass
    try:
        db = WeChatDB(db_dir=db_dir) if db_dir else WeChatDB()
        line(OK, f"能读到微信数据库：{db.db_dir}")
        try:
            info = db.get_self_info() or {}
            name = info.get("nick_name") or info.get("remark") or db.wxid
            line(OK, f"当前登录账号：{name}")
        except Exception:  # noqa: BLE001
            pass
        return True
    except Exception as exc:  # noqa: BLE001
        hint = "微信要停在已登录界面，不是扫码页"
        line(BAD, f"读不到微信数据库：{exc}", hint)
        return False


def check_config():
    if not os.path.exists(CONFIG):
        line(WARN, "还没有 config.json", "双击「启动微信聊天伴侣.bat」会自动生成")
        return {}
    try:
        with open(CONFIG, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except Exception as exc:  # noqa: BLE001
        line(BAD, f"config.json 解析失败：{exc}", "删掉它，重新启动伴侣会自动生成")
        return {}
    line(OK, "config.json 解析正常")
    gw = ((cfg.get("gateway") or {}).get("wechat") or {})
    token = gw.get("inboundToken") or ""
    if not token:
        line(BAD, "gateway.wechat.inboundToken 是空的", "在设置页复制令牌，填进 config.json")
    elif token == "change-me-wechat":
        line(WARN, "令牌还是默认的 change-me-wechat", "能用，但建议改成随机字符串")
    else:
        line(OK, "桥接令牌已设置")
    if not gw.get("enabled", True):
        line(BAD, "gateway.wechat.enabled = false", "设置页打开「启用网关」")
    return cfg


def check_server():
    port = PORT
    try:
        with open(CONFIG, "r", encoding="utf-8-sig") as f:
            port = int(((json.load(f).get("server") or {}).get("port")) or PORT)
    except Exception:  # noqa: BLE001
        pass
    sock = socket.socket()
    sock.settimeout(1.2)
    try:
        sock.connect(("127.0.0.1", port))
        sock.close()
    except OSError:
        line(BAD, f"网页服务没有在 {port} 端口上", "双击「启动微信聊天伴侣.bat」")
        return False
    line(OK, f"网页服务在线：http://127.0.0.1:{port}/")
    return True


def check_ffmpeg():
    if shutil.which("ffmpeg"):
        line(OK, "ffmpeg 在 PATH 里")
        return True
    for folder in (
        os.path.join(ROOT, "runtime", "ffmpeg", "bin"),
        os.path.join(ROOT, "tools", "ffmpeg", "bin"),
        r"C:\ffmpeg\bin",
    ):
        if os.path.isfile(os.path.join(folder, "ffmpeg.exe")):
            line(OK, f"找到 ffmpeg：{folder}")
            return True
    line(WARN, "没有 ffmpeg（不影响文字聊天，只影响看图/表情）", "可选：解压到 C:\\ffmpeg")
    return False


def main():
    print("=" * 62)
    print("  微信聊天伴侣 · 自检")
    print("=" * 62)
    print(f"  目录：{ROOT}")
    print(f"  Python：{sys.version.split()[0]}  ({sys.executable})")
    print("-" * 62)

    check_integrity()
    deps = all(
        check_import(name, attr)
        for name, attr in (
            ("wechatauto", "WeChatDB"),
            ("psutil", None),
            ("win32com", None),
            ("requests", None),
        )
    )
    if deps:
        line(OK, "随包依赖齐全")
    check_ffmpeg()
    has_wechat = check_process()
    check_config()
    check_server()
    check_db(has_wechat)

    print("-" * 62)
    print("自检结束。上面标 [ !! ] 的项按提示处理后，重新双击对应 bat。")
    print("=" * 62)


if __name__ == "__main__":
    main()
