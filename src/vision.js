'use strict';

/**
 * 看图：走智谱 GLM-4V（便宜、有免费额度），接口同样是 OpenAI 兼容格式。
 * 桥接把图片 base64 发到 /api/vision，这里负责转成模型能读的 data URL。
 */
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { loadSettings } = require('./config');

const OK_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MESSAGES = {
  disabled: '还没有配置看图用的 Key。在设置里填智谱的 API Key 就能看图了。',
  tooLarge: '这张图太大了（超过 6MB），压缩一下再发。',
  badType: '这个格式的图片看不了，发 PNG 或 JPG 吧。',
  empty: '图里没看出什么内容，换一张清楚的试试？',
  network: '看图服务连不上，稍后再试。',
  default: '看图失败了，稍后再试。',
};

class VisionError extends Error {
  constructor(userMessage, detail = '') {
    super(detail || userMessage);
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

class VisionClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.reload();
  }

  reload() {
    const vision = this.config.vision || {};
    const settings = loadSettings(this.config);
    const keys = settings.keys || {};
    const llm = this.config.llm || {};
    const key = String(
      vision.apiKey || keys.zhipu || (String(llm.provider) === 'zhipu' ? settings.apiKey || llm.apiKey : '') || ''
    ).trim();
    this.apiKey = key;
    this.baseUrl = String(vision.baseUrl || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
    this.model = String(vision.model || 'glm-4v-flash');
    this.timeoutMs = Number(vision.timeoutMs) || 30000;
    return this;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  describe() {
    return { enabled: this.enabled, model: this.model, baseUrl: this.baseUrl };
  }

  async describeImage({ image, mime = 'image/jpeg', prompt = '' }) {
    if (!this.enabled) throw new VisionError(MESSAGES.disabled, 'no vision api key');
    const base64 = String(image || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!base64) throw new VisionError(MESSAGES.empty, 'empty image');
    if (base64.length > 8 * 1024 * 1024) throw new VisionError(MESSAGES.tooLarge, 'image too large');
    const type = OK_MIME.has(String(mime).toLowerCase()) ? String(mime).toLowerCase() : 'image/jpeg';
    const question =
      prompt ||
      '用两三句口语描述这张图里有什么。如果是聊天截图，说出大概在聊什么；如果是表情包，说出它想表达的情绪。不要用列表，不要用 Markdown。';

    const body = JSON.stringify({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${type};base64,${base64}` } },
            { type: 'text', text: question },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.4,
    });
    const url = new URL(`${this.baseUrl}/chat/completions`);
    const mod = url.protocol === 'http:' ? http : https;
    const raw = await new Promise((resolve, reject) => {
      const req = mod.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'http:' ? 80 : 443),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              let detail = text;
              try {
                detail = JSON.parse(text).error?.message || text;
              } catch {
                /* ignore */
              }
              reject(new VisionError(MESSAGES.default, `HTTP ${res.statusCode}: ${String(detail).slice(0, 200)}`));
              return;
            }
            resolve(text);
          });
        }
      );
      req.setTimeout(this.timeoutMs, () => req.destroy(new VisionError(MESSAGES.network, 'vision timeout')));
      req.on('error', (err) =>
        reject(err instanceof VisionError ? err : new VisionError(MESSAGES.network, String(err.message)))
      );
      req.end(body);
    });

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new VisionError(MESSAGES.empty, 'invalid json');
    }
    const text = String(json?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new VisionError(MESSAGES.empty, 'empty content');
    return text;
  }
}

module.exports = { VisionClient, VisionError, MESSAGES };
