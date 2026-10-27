'use strict';

const http = require('http');

/**
 * 微信能力服务的客户端。
 *
 * 真正干活的是 bridge/pal_rpc.py（和收发消息的桥接在同一个进程里）。
 * 网页只跟 Node 说话，Node 再转发到这里，这样浏览器不用知道 RPC 端口和令牌。
 */
class WeChatBridge {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.lastError = '';
    this.lastOkAt = 0;
  }

  get settings() {
    return this.config.bridge || {};
  }

  get port() {
    return Number(this.settings.rpcPort) || 8791;
  }

  get token() {
    return String(this.settings.token || (this.config.gateway && this.config.gateway.wechat && this.config.gateway.wechat.inboundToken) || '');
  }

  reload() {}

  request(path, { method = 'GET', body = null, timeout = 45000 } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          path,
          method,
          headers: {
            'x-pal-token': this.token,
            ...(payload ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length } : {}),
          },
          timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let data;
            try {
              data = text ? JSON.parse(text) : {};
            } catch (_) {
              data = { ok: false, error: text.slice(0, 200) };
            }
            if (res.statusCode >= 400) {
              const err = new Error(data.error || `微信服务返回 ${res.statusCode}`);
              err.code = res.statusCode === 401 ? 'TOKEN' : 'HTTP';
              err.data = data;
              return reject(err);
            }
            this.lastOkAt = Date.now();
            this.lastError = '';
            resolve(data);
          });
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('微信服务响应超时'));
      });
      req.on('error', (err) => {
        this.lastError = err.code === 'ECONNREFUSED' ? '桥接没有在运行' : err.message;
        const e = new Error(this.lastError);
        e.code = err.code || 'NETWORK';
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async health() {
    try {
      const data = await this.request('/health', { timeout: 2500 });
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message, online: false };
    }
  }

  sessions(limit = 200) {
    return this.request(`/sessions?limit=${encodeURIComponent(limit)}`);
  }

  messages(chat, limit = 50, offset = 0) {
    return this.request(
      `/messages?chat=${encodeURIComponent(chat)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      { timeout: 30000 }
    );
  }

  media(chat, localId, kind = 'image') {
    return this.request(
      `/media?chat=${encodeURIComponent(chat)}&local_id=${encodeURIComponent(localId)}&kind=${encodeURIComponent(kind)}`,
      { timeout: 90000 }
    );
  }

  contacts(q = '') {
    return this.request(`/contacts?q=${encodeURIComponent(q)}`, { timeout: 15000 });
  }

  moments(limit = 20, offset = 0) {
    return this.request(`/moments?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`, {
      timeout: 60000,
    });
  }

  momentMedia(md5, size = 0, width = 0, height = 0) {
    const q = new URLSearchParams({ md5, size: String(size), w: String(width), h: String(height) });
    return this.request(`/moments/media?${q}`, { timeout: 60000 });
  }

  send(chat, name, segments) {
    return this.request('/send', { method: 'POST', body: { chat, name, segments }, timeout: 180000 });
  }

  likeMoment(username, text, cancel = false) {
    return this.request('/moments/like', { method: 'POST', body: { username, text, cancel }, timeout: 180000 });
  }

  commentMoment(username, text, content, replyTo = '') {
    return this.request('/moments/comment', {
      method: 'POST',
      body: { username, text, content, reply_to: replyTo },
      timeout: 180000,
    });
  }

  postMoment(text, images = []) {
    return this.request('/moments/post', { method: 'POST', body: { text, images }, timeout: 60000 });
  }
}

module.exports = { WeChatBridge };
