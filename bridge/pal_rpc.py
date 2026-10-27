# -*- coding: utf-8 -*-
"""本机微信能力服务（给网页控制台用）。

只监听 127.0.0.1，靠 x-pal-token 头校验。它和 wechat_bridge.py 共用同一个
WeChatDB / 发送锁 / 日志，不单独再开一个微信会话。

接口（全部 JSON）：
  GET  /health
  GET  /sessions?limit=200
  GET  /messages?chat=<wxid>&limit=50&offset=0
  GET  /media?chat=<wxid>&local_id=123&kind=image
  GET  /contacts?q=...
  GET  /moments?limit=20&offset=0
  POST /send            {chat, chat_type, segments:[{type,text|path|name}]}
  POST /moments/like    {tid, cancel?}
  POST /moments/comment {tid, content, reply_to?}
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Optional

VERSION = "3.0.0"


def _safe_name(name: str) -> str:
    keep = []
    for ch in str(name or ""):
        if ch.isalnum() or ch in "._-@":
            keep.append(ch)
        else:
            keep.append("_")
    out = "".join(keep).strip("._") or "item"
    return out[:80]


class PalContext:
    """由 wechat_bridge.py 填进来的一组能力。"""

    def __init__(self, **kw):
        self.db = kw["db"]
        self.media = kw.get("media")            # () -> MediaDownloader
        self.display_name = kw.get("display_name") or (lambda u: u)
        self.send_text = kw.get("send_text")    # (text, name, wxid) -> bool
        self.send_media = kw.get("send_media")  # (path, kind, name, wxid) -> bool
        self.log = kw.get("log") or print
        self.root = kw.get("root") or os.getcwd()
        self.token = kw.get("token") or ""
        self.port = int(kw.get("port") or 8791)
        self.get_sessions = kw.get("get_sessions")
        self.moment_db = kw.get("moment_db")    # () -> MomentDB
        self.media_dir = kw.get("media_dir") or os.path.join(self.root, "data", "wechat-media")
        os.makedirs(self.media_dir, exist_ok=True)

    # ---- 媒体 ----
    def _media_url(self, path: str) -> str:
        rel = os.path.relpath(path, self.media_dir).replace("\\", "/")
        return "/wechat-media/" + urllib.parse.quote(rel)

    def _copy_into_media(self, src: str, sub: str = "") -> str:
        if not src or not os.path.isfile(src):
            return ""
        base = os.path.basename(src)
        folder = os.path.join(self.media_dir, _safe_name(sub)) if sub else self.media_dir
        os.makedirs(folder, exist_ok=True)
        dst = os.path.join(folder, base)
        if os.path.abspath(src) != os.path.abspath(dst):
            try:
                shutil.copyfile(src, dst)
            except Exception:
                return ""
        return self._media_url(dst)

    # ---- 对外数据 ----
    def health(self) -> dict:
        info = {}
        try:
            info = self.db.get_self_info() or {}
        except Exception:
            pass
        return {
            "ok": True,
            "online": True,
            "version": VERSION,
            "account": info.get("nick_name") or info.get("remark") or self.db.wxid,
            "wxid": self.db.wxid,
            "dbDir": getattr(self.db, "db_dir", ""),
            "time": int(time.time()),
        }

    def sessions(self, limit: int = 200) -> dict:
        rows = self.get_sessions() if self.get_sessions else self.db.get_sessions(limit=limit)
        out = []
        for s in rows or []:
            u = s.get("username") or ""
            if not u:
                continue
            out.append({
                "username": u,
                "title": self.display_name(u),
                "type": "group" if u.endswith("@chatroom") else "private",
                "lastText": str(s.get("summary") or s.get("last_msg") or s.get("content") or "").strip(),
                "lastTime": int(s.get("last_time") or s.get("last_timestamp") or 0),
                "lastSender": s.get("last_sender") or "",
                "unread": int(s.get("unread_count") or s.get("unread") or 0),
            })
        return {"ok": True, "sessions": out[:limit]}

    def messages(self, chat: str, limit: int = 50, offset: int = 0) -> dict:
        rows = self.db.get_messages(chat, limit=limit, offset=offset) or []
        # 数据库返回新→旧，网页要按时间正序
        rows = list(reversed(rows))
        out = []
        for m in rows:
            out.append(self._row(m, chat))
        return {"ok": True, "chat": chat, "title": self.display_name(chat), "messages": out}

    def _row(self, m: dict, chat: str) -> dict:
        sender = m.get("sender_username") or ""
        mtype = m.get("type") or ""
        content = m.get("content") or ""
        text = content
        media = None
        system = False
        link = ""
        # 群聊消息的 content 前面带发送者 wxid（"wxid_xxx:\n正文"），去掉
        if chat.endswith("@chatroom") and mtype == "文本":
            import re as _re
            text = _re.sub(r"^[A-Za-z0-9_\-]{4,}:\s*", "", text).strip()
        media_kinds = {
            "图片": "image", "语音": "voice", "视频": "video",
            "文件/链接/卡片": "file", "表情": "sticker", "动画表情": "sticker",
        }
        if mtype in media_kinds:
            kind = media_kinds[mtype]
            if mtype == "文件/链接/卡片":
                import re as _re
                title = _re.search(r"<title>(.*?)</title>", content, _re.S)
                url = _re.search(r"<url>(.*?)</url>", content, _re.S)
                text = (title.group(1).strip() if title else "") or "[文件/链接/卡片]"
                if url:
                    link = url.group(1).strip()
                # 有 url 的当链接卡片，没 url 的按文件下载
                if link:
                    kind = "link"
                media = {
                    "kind": kind, "localId": m.get("local_id"), "shard": m.get("shard"),
                    "md5": m.get("md5") or "", "url": link,
                }
            else:
                text = {"图片": "[图片]", "语音": "[语音]", "视频": "[视频]",
                        "表情": "[表情]", "动画表情": "[表情]"}.get(mtype, "")
                media = {
                    "kind": kind, "localId": m.get("local_id"), "shard": m.get("shard"),
                    "md5": m.get("md5") or "",
                }
        elif mtype in ("系统消息", "音视频通话", "位置", "红包"):
            system = mtype in ("系统消息", "音视频通话")
            if mtype == "位置":
                text = "[位置]"
            elif mtype == "红包":
                text = "[红包]"
            else:
                text = content[:200]
            media = None
        return {
            "id": "%s:%s:%s" % (chat, m.get("shard") or "", m.get("local_id")),
            "seq": m.get("sort_seq") or 0,
            "time": int(m.get("create_time") or 0),
            "sender": sender,
            "senderName": self.db.get_nickname(sender) if sender and sender != self.db.wxid else "我",
            "isSelf": sender == self.db.wxid,
            "type": mtype,
            "text": text,
            "media": media,
            "link": link,
            "system": system,
        }

    def media_for(self, chat: str, local_id: int, kind: str = "image") -> dict:
        dl = self.media() if self.media else None
        if not dl:
            return {"ok": False, "error": "媒体下载器未初始化"}
        kind = (kind or "image").lower()
        path = ""
        try:
            if kind in ("image", "sticker"):
                path = dl.download_image(chat, int(local_id)) or ""
            elif kind == "voice":
                path = dl.download_voice(chat, int(local_id)) or ""
            elif kind == "video":
                path = dl.download_video(chat, int(local_id)) or ""
            elif kind == "file":
                path = dl.download_file(chat, int(local_id)) or ""
            else:
                return {"ok": False, "error": "未知媒体类型"}
        except Exception as exc:
            self.log("下载媒体失败：", repr(exc))
            return {"ok": False, "error": str(exc)[:200]}
        if not path or not os.path.isfile(path):
            return {"ok": False, "error": "微信本地没有缓存这张图/这段语音"}
        # 微信语音是 SILK，浏览器播不了；转成 16k 单声道 WAV
        if kind == "voice" and os.path.splitext(path)[1].lower() in (".silk", ".slk"):
            try:
                import io as _io
                import wave
                import pysilk
                pcm = _io.BytesIO()
                with open(path, "rb") as f:
                    pysilk.decode(f, pcm, 16000)
                raw = pcm.getvalue()
                dst = os.path.join(self.media_dir, _safe_name(chat), _safe_name(str(local_id)) + ".wav")
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with wave.open(dst, "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(16000)
                    w.writeframes(raw)
                return {"ok": True, "url": self._media_url(dst), "mime": "audio/wav", "kind": "voice",
                        "seconds": round(len(raw) / 32000.0, 1)}
            except Exception as exc:
                self.log("语音转 WAV 失败：", repr(exc))
                return {"ok": False, "error": "这段语音转码失败，可能缺少 pysilk"}
        mime = ""
        ext = os.path.splitext(path)[1].lower()
        try:
            with open(path, "rb") as f:
                head = f.read(16)
            if head[:4] == b"wxgf" and kind in ("image", "sticker"):
                conv = None
                try:
                    conv = dl._wxgf_to_jpg(open(path, "rb").read())
                except Exception:
                    conv = None
                if conv:
                    dst = os.path.join(self.media_dir, _safe_name(chat), _safe_name(str(local_id)) + ".jpg")
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    with open(dst, "wb") as f:
                        f.write(conv)
                    return {"ok": True, "url": self._media_url(dst), "mime": "image/jpeg", "kind": "image"}
            if head[:3] == b"\xff\xd8\xff":
                mime = "image/jpeg"
            elif head[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            elif head[:3] == b"GIF":
                mime = "image/gif"
            elif head[:4] == b"RIFF":
                mime = "audio/wav"
            else:
                mime = {"voice": "audio/silk", "video": "video/mp4", "file": "application/octet-stream"}.get(kind, "application/octet-stream")
        except Exception:
            pass
        url = self._copy_into_media(path, chat)
        if not url:
            return {"ok": False, "error": "复制媒体到网页目录失败"}
        return {"ok": True, "url": url, "mime": mime, "kind": kind}

    def contacts(self, q: str = "") -> dict:
        rows = []
        try:
            rows = self.db.search_contact(q) if q else self.db.get_sessions(limit=300)
        except Exception as exc:
            self.log("搜索联系人失败：", repr(exc))
        out = []
        seen = set()
        for r in rows or []:
            u = r.get("username") or r.get("wxid") or ""
            if not u or u in seen or u.endswith("@chatroom"):
                continue
            seen.add(u)
            out.append({"username": u, "title": self.display_name(u),
                        "remark": r.get("remark") or "", "nickname": r.get("nick_name") or ""})
        return {"ok": True, "contacts": out[:100]}

    # ---- 朋友圈 ----
    def _moment_db(self):
        if self.moment_db:
            return self.moment_db()
        from wechatauto.moment import MomentDB
        return MomentDB(self.db)

    def moments(self, limit: int = 20, offset: int = 0) -> dict:
        """只读文字/点赞/评论，不在这里解图。

        解图要逐个 find_local_media / 解密，遇到大缓存会卡几十秒，
        所以图片交给 /moments/media 按需下载。
        """
        mdb = self._moment_db()
        rows = mdb.get_moments(limit=limit, offset=offset) or []
        out = []
        for f in rows:
            images = []
            for idx, img in enumerate(f.get("images") or []):
                images.append({
                    "md5": img.get("md5"),
                    "index": idx,
                    "size": img.get("size") or 0,
                    "width": img.get("width") or 0,
                    "height": img.get("height") or 0,
                    "url": "",
                    "remoteUrl": img.get("url") or "",
                })
            loc = f.get("location")
            if isinstance(loc, dict):
                loc = loc.get("poi_name") or loc.get("city") or loc.get("name") or ""
            elif loc is None:
                loc = ""
            else:
                loc = str(loc)
            out.append({
                "tid": f.get("tid"), "id": f.get("id"), "username": f.get("username"),
                "nickname": f.get("nickname") or self.display_name(f.get("username") or ""),
                "text": f.get("text") or "", "location": loc,
                "time": int(f.get("create_time") or 0),
                "images": images,
                "likes": [{"nickname": x.get("nickname") or "", "username": x.get("username") or ""}
                          for x in (f.get("likes") or [])],
                "comments": [{"nickname": x.get("nickname") or "", "content": x.get("content") or "",
                              "commentId": x.get("comment_id") or "", "username": x.get("username") or ""}
                             for x in (f.get("comments") or [])],
            })
        return {"ok": True, "moments": out, "hasMore": len(out) >= limit}

    def _image_key_ready(self) -> bool:
        """朋友圈缓存图要先有图片 AES 密钥，否则 decrypt_image 会阻塞 120 秒。"""
        try:
            workdir = getattr(self.db, "workdir", "") or ""
            return bool(workdir) and os.path.exists(os.path.join(workdir, "image_keys.json"))
        except Exception:
            return False

    def moment_media(self, md5: str, size: int = 0, width: int = 0, height: int = 0) -> dict:
        mdb = self._moment_db()
        if not md5:
            return {"ok": False, "error": "缺少图片 md5"}
        if not self._image_key_ready():
            return {
                "ok": False,
                "needKey": True,
                "error": "还没有拿到微信图片密钥：在微信里点开任意一张图片看大图，保持几秒，然后回来重试。",
            }
        try:
            local = mdb.find_local_media(md5, "image", int(size or 0), int(width or 0), int(height or 0))
        except Exception as exc:
            return {"ok": False, "error": "查找本地图片失败：%s" % str(exc)[:120]}
        if not local:
            return {"ok": False, "error": "本机缓存里没有这张图（可能没在手机上点开过）"}
        url = self._copy_into_media(local, "moments")
        if not url:
            return {"ok": False, "error": "复制图片失败"}
        return {"ok": True, "url": url}

    def _moment_target(self, username: str, text: str = ""):
        """按作者 + 正文找动态。feed 的 tid 是作者 wxid，不是数据库数字 tid。"""
        mdb = self._moment_db()
        if not username:
            return None, None
        try:
            rows = mdb.get_moments(limit=200, username=username) or []
        except Exception:
            rows = []
        if not rows:
            try:
                rows = [f for f in (mdb.get_moments(limit=300) or []) if f.get("username") == username]
            except Exception:
                rows = []
        want = (text or "").strip()
        for f in rows:
            if not want or (f.get("text") or "").strip() == want:
                return mdb, f
        try:
            sample = [((f.get("text") or "").strip())[:12] for f in rows[:6]]
        except Exception:
            sample = []
        self.log("朋友圈定位失败 username=%r want=%r rows=%d sample=%r" % (username, want[:30], len(rows), sample))
        return mdb, None

    def moment_like(self, username: str, text: str = "", cancel: bool = False) -> dict:
        mdb, feed = self._moment_target(username, text)
        if not feed:
            return {"ok": False, "error": "找不到这条朋友圈"}
        try:
            from wechatauto import WeChat, WeChatGUI
            from wechatauto.moment import Moment
            wx = WeChat(db=self.db, gui=WeChatGUI())
            res = Moment(wx).LikeMoment(publisher=feed.get("nickname"), keyword=(feed.get("text") or "")[:18],
                                        db=mdb, max_screens=120)
            return {"ok": True, "result": str(res)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300]}

    def moment_comment(self, username: str, text: str, content: str, reply_to: Optional[str] = None) -> dict:
        mdb, feed = self._moment_target(username, text)
        if not feed:
            return {"ok": False, "error": "找不到这条朋友圈"}
        if not (content or "").strip():
            return {"ok": False, "error": "评论内容为空"}
        try:
            from wechatauto import WeChat, WeChatGUI
            from wechatauto.moment import Moment
            wx = WeChat(db=self.db, gui=WeChatGUI())
            res = Moment(wx).CommentMoment(publisher=feed.get("nickname"), keyword=(feed.get("text") or "")[:18],
                                           content=content.strip(), db=mdb, max_screens=120)
            return {"ok": True, "result": str(res)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300]}


def _make_handler(ctx: PalContext):
    class Handler(BaseHTTPRequestHandler):
        server_version = "wechat-pal-rpc/3"

        def log_message(self, fmt, *args):
            pass

        def _send(self, code: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass

        def _authorized(self) -> bool:
            if not ctx.token:
                return True
            return self.headers.get("x-pal-token", "") == ctx.token

        def _body(self) -> dict:
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if n <= 0 or n > 8 * 1024 * 1024:
                    return {}
                raw = self.rfile.read(n)
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return {}

        def do_GET(self):  # noqa: N802
            if not self._authorized():
                return self._send(401, {"ok": False, "error": "token 不对"})
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            try:
                if u.path == "/health":
                    return self._send(200, ctx.health())
                if u.path == "/sessions":
                    return self._send(200, ctx.sessions(int((q.get("limit") or [200])[0])))
                if u.path == "/messages":
                    chat = (q.get("chat") or [""])[0]
                    if not chat:
                        return self._send(400, {"ok": False, "error": "缺少 chat"})
                    return self._send(200, ctx.messages(chat, int((q.get("limit") or [50])[0]), int((q.get("offset") or [0])[0])))
                if u.path == "/media":
                    chat = (q.get("chat") or [""])[0]
                    lid = int((q.get("local_id") or ["0"])[0])
                    kind = (q.get("kind") or ["image"])[0]
                    return self._send(200, ctx.media_for(chat, lid, kind))
                if u.path == "/contacts":
                    return self._send(200, ctx.contacts((q.get("q") or [""])[0]))
                if u.path == "/moments":
                    return self._send(200, ctx.moments(int((q.get("limit") or [20])[0]), int((q.get("offset") or [0])[0])))
                if u.path == "/moments/media":
                    return self._send(200, ctx.moment_media(
                        (q.get("md5") or [""])[0],
                        int((q.get("size") or [0])[0]),
                        int((q.get("w") or [0])[0]),
                        int((q.get("h") or [0])[0]),
                    ))
                return self._send(404, {"ok": False, "error": "没有这个接口"})
            except Exception as exc:
                ctx.log("RPC GET 失败 %s：%r" % (u.path, exc))
                return self._send(500, {"ok": False, "error": str(exc)[:300]})

        def do_POST(self):  # noqa: N802
            if not self._authorized():
                return self._send(401, {"ok": False, "error": "token 不对"})
            u = urllib.parse.urlparse(self.path)
            body = self._body()
            try:
                if u.path == "/send":
                    chat = str(body.get("chat") or "")
                    name = str(body.get("name") or ctx.display_name(chat))
                    results = []
                    for seg in body.get("segments") or []:
                        st = str(seg.get("type") or "text")
                        if st == "text":
                            ok = bool(ctx.send_text(str(seg.get("text") or ""), name, chat))
                        else:
                            path = str(seg.get("path") or "")
                            if path.startswith("/wechat-media/"):
                                rel = urllib.parse.unquote(path[len("/wechat-media/"):])
                                path = os.path.join(ctx.media_dir, rel.replace("/", os.sep))
                            kind = "file" if st == "file" else "image"
                            ok = bool(ctx.send_media(path, kind, name, chat)) if ctx.send_media else False
                        results.append({"type": st, "ok": ok})
                        time.sleep(0.4)
                    return self._send(200, {"ok": any(r["ok"] for r in results), "results": results})
                if u.path == "/moments/like":
                    return self._send(200, ctx.moment_like(str(body.get("username") or ""),
                                                          str(body.get("text") or ""), bool(body.get("cancel"))))
                if u.path == "/moments/comment":
                    return self._send(200, ctx.moment_comment(str(body.get("username") or ""),
                                                              str(body.get("text") or ""),
                                                              str(body.get("content") or ""),
                                                              body.get("reply_to")))
                if u.path == "/moments/post":
                    return self._send(200, {"ok": False, "error": "微信 4.x 的「发表朋友圈」是自绘界面，当前版本还没有稳定的自动发布接口。可以先在手机/微信里手动发，网页端负责浏览、点赞和评论。"})
                return self._send(404, {"ok": False, "error": "没有这个接口"})
            except Exception as exc:
                ctx.log("RPC POST 失败 %s：%r" % (u.path, exc))
                return self._send(500, {"ok": False, "error": str(exc)[:300]})

    return Handler


def serve(ctx: PalContext) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", ctx.port), _make_handler(ctx))
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, name="pal-rpc", daemon=True)
    t.start()
    ctx.log("能力接口已启动：http://127.0.0.1:%d（token 校验%s）" % (ctx.port, "开" if ctx.token else "关"))
    return srv
