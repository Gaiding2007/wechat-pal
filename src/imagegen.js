'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE = 'https://maas.qianwenaiapi.com';
const DEFAULT_MODEL = 'qwen-image-3.0';

class ImageGenError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ImageGenError';
    this.detail = detail || '';
  }
}

class ImageGen {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.reload();
  }

  reload() {
    const cfg = (this.config && this.config.imagegen) || {};
    const keys = (this.config && this.config.settings && this.config.settings.keys) || {};
    this.enabled = cfg.enabled !== false;
    this.baseUrl = String(cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.model = String(cfg.model || DEFAULT_MODEL);
    this.apiKey = String(cfg.apiKey || keys.image || keys.dashscope || '');
    this.timeoutMs = Math.max(10000, Number(cfg.timeoutMs) || 180000);
  }

  get ready() {
    return this.enabled && Boolean(this.apiKey);
  }

  status() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      model: this.model,
      baseUrl: this.baseUrl,
      keyMasked: this.apiKey ? this.apiKey.slice(0, 4) + '****' + this.apiKey.slice(-4) : '',
    };
  }

  async generate(prompt, { size } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new ImageGenError('想画点什么？给我一句描述。');
    if (!this.enabled) throw new ImageGenError('生图功能是关闭的，可以在设置里打开。');
    if (!this.apiKey) throw new ImageGenError('还没有填生图 Key。设置 → 生图 里填 DashScope / 千问的 Key。');
    const body = { model: this.model, prompt: text, n: 1 };
    if (size) body.size = String(size);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.baseUrl + '/compatible-mode/v1/images/generations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new ImageGenError('生图超时了，再试一次或换个短一点的描述。');
      throw new ImageGenError('连不上生图服务，检查一下网络和 Base URL。', err && err.message);
    }
    clearTimeout(timer);

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      throw new ImageGenError('生图服务返回的不是 JSON（HTTP ' + res.status + '）。');
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.code)) || '';
      throw new ImageGenError('生图失败（HTTP ' + res.status + '）' + (msg ? '：' + String(msg).slice(0, 120) : ''));
    }
    const item = data && Array.isArray(data.data) ? data.data[0] : null;
    const url = item && (item.url || item.image_url);
    const b64 = item && item.b64_json;
    if (!url && !b64) throw new ImageGenError('生图服务没有返回图片，再试一次？');

    const dir = path.join(this.config.paths.dataDir, 'stickers');
    fs.mkdirSync(dir, { recursive: true });
    const name = 'gen-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.png';
    const file = path.join(dir, name);
    if (b64) {
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    } else {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      } catch (err) {
        throw new ImageGenError('图片生成了，但下载失败：' + (err && err.message));
      } finally {
        clearTimeout(t);
      }
    }
    const bytes = fs.statSync(file).size;
    if (this.logger) this.logger.info(`生图完成：${name}（${Math.round(bytes / 1024)} KB）`);
    return { file, name, url: '/stickers/' + name, bytes, model: this.model };
  }
}

module.exports = { ImageGen, ImageGenError, DEFAULT_BASE, DEFAULT_MODEL };
