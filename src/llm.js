'use strict';

/**
 * OpenAI 兼容的大模型客户端。
 *
 * 只依赖 Node 内置模块：DeepSeek、智谱、通义、硅基流动、Ollama、LM Studio……
 * 只要对方提供 /chat/completions，就能在这里用。
 */
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { resolveRuntime, maskKey } = require('./config');

const MESSAGES = {
  nokey: '还没有填 API Key。打开右上角「设置 → 模型服务」，填一个就能开始聊了。',
  http_401: 'API Key 没有被接受（401），检查一下有没有复制完整。',
  http_402: '这个账户的余额用完了（402），去服务商那边充值一下。',
  http_403: '这个 Key 没有权限用当前模型（403），换一个模型试试。',
  http_404: '服务商那边没有这个模型（404）。检查一下模型名，或者换一个。',
  http_429: '请求太频繁或额度用完了（429）。等一会儿再试，或者换个模型。',
  timeout: '服务商一直没有响应，超时了。网络不稳的话可以再试一次。',
  network: '连不上服务商。检查一下网络、代理，或者 Base URL 是否写错。',
  empty: '模型这次什么都没返回，再说一次试试？',
  default: '请求模型时出错了，稍后再试。',
};

class LlmError extends Error {
  constructor(userMessage, { code = 'unknown', status = 0, retryable = false, detail = '' } = {}) {
    super(detail || userMessage);
    this.name = 'LlmError';
    this.userMessage = userMessage || MESSAGES.default;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function friendlyForStatus(status, detail = '') {
  if (status === 401) return MESSAGES.http_401;
  if (status === 402) return MESSAGES.http_402;
  if (status === 403) return MESSAGES.http_403;
  if (status === 429) return MESSAGES.http_429;
  if (status === 404 && /model/i.test(String(detail))) return MESSAGES.http_404;
  return MESSAGES.default;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 回复「跑飞」的识别：又长又没标点，或者同一段反复出现。 */
function looksDegenerate(text) {
  const value = String(text || '').trim();
  if (value.length < 90) return false;
  const punct = (value.match(/[，。！？!?；;、…~～\n]/g) || []).length;
  if (punct === 0) return true;
  if (value.length > 160 && punct / value.length < 0.006) return true;
  const seen = new Map();
  for (let i = 0; i + 6 <= value.length; i += 1) {
    const gram = value.slice(i, i + 6);
    const count = (seen.get(gram) || 0) + 1;
    if (count >= 4) return true;
    seen.set(gram, count);
  }
  return false;
}

/** 被 max_tokens 截断时退到最后一个完整句子，别发半句话。 */
function cutToSentence(text) {
  const value = String(text || '').trim();
  if (value.length <= 40) return value;
  const marks = [...value.matchAll(/[。！？!?…~～]/g)];
  const limit = Math.floor(value.length * 0.6);
  const last = marks.filter((m) => m.index >= limit).pop();
  return last ? value.slice(0, last.index + 1) : value;
}

/** 把 SSE 缓冲切成一帧一帧的 data。 */
function drainSse(buffer, onData) {
  let rest = buffer;
  for (;;) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match) break;
    const block = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (data) onData(data);
  }
  return rest;
}

class LlmClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.reload();
  }

  reload() {
    const runtime = resolveRuntime(this.config);
    this.runtime = runtime;
    this.provider = runtime.provider;
    this.providerLabel = runtime.providerLabel;
    this.apiKey = runtime.apiKey;
    this.baseUrl = runtime.baseUrl;
    this.model = runtime.model;
    this.temperature = runtime.temperature;
    this.maxTokens = runtime.maxTokens;
    this.timeoutMs = runtime.timeoutMs;
    this.mock = runtime.mock;
    this.needsKey = runtime.needsKey;
    return this;
  }

  get isMock() {
    return this.mock || (this.needsKey && !this.apiKey);
  }

  endpoint() {
    const base = String(this.baseUrl || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    if (!base) return '';
    return base + '/chat/completions';
  }

  describe() {
    return {
      mock: this.isMock,
      provider: this.provider,
      providerLabel: this.providerLabel,
      needsKey: this.needsKey,
      model: this.model,
      baseUrl: this.baseUrl,
      keyMasked: maskKey(this.apiKey),
      temperature: this.temperature,
    };
  }

  buildPayload({ system, turns = [], stream = false, maxTokens, safe = false }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: String(system) });
    for (const turn of turns) {
      if (!turn || !turn.content) continue;
      const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'system' ? 'system' : 'user';
      messages.push({ role, content: String(turn.content) });
    }
    let temperature = safe ? Math.min(0.7, this.temperature) : this.temperature;
    // 智谱的 temperature 只接受 0~1
    if (this.provider === 'zhipu') temperature = Math.min(temperature, 0.99);
    const payload = {
      model: this.model,
      messages,
      stream,
      temperature: Math.max(0, Math.min(2, temperature)),
      max_tokens: safe
        ? Math.min(Math.max(Number(maxTokens) || this.maxTokens, 900), 2000)
        : Math.min(Number(maxTokens) || this.maxTokens, this.maxTokens),
    };
    return payload;
  }

  _open(payload, { signal } = {}) {
    const endpoint = this.endpoint();
    if (!endpoint) throw new LlmError(MESSAGES.default, { code: 'no_baseurl', detail: 'empty baseUrl' });
    if (this.needsKey && !this.apiKey) throw new LlmError(MESSAGES.nokey, { code: 'nokey' });
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new LlmError('Base URL 格式不对，检查一下（要完整的 http(s) 地址）。', {
        code: 'bad_url',
        detail: `invalid baseUrl: ${this.baseUrl}`,
      });
    }
    const mod = url.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: payload.stream ? 'text/event-stream' : 'application/json',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'http:' ? 80 : 443),
          path: url.pathname + url.search,
          method: 'POST',
          headers,
        },
        (res) => resolve({ req, res })
      );
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new LlmError(MESSAGES.timeout, { code: 'timeout', detail: `timeout ${this.timeoutMs}ms` }));
      });
      req.on('error', (err) => {
        if (err instanceof LlmError) return reject(err);
        reject(
          new LlmError(MESSAGES.network, {
            code: 'network',
            retryable: true,
            detail: `${err.code || ''} ${err.message}`.trim(),
          })
        );
      });
      if (signal) {
        if (signal.aborted) req.destroy(new LlmError('aborted', { code: 'aborted' }));
        else signal.addEventListener('abort', () => req.destroy(new LlmError('aborted', { code: 'aborted' })), { once: true });
      }
      req.end(body);
    });
  }

  _readAll(res) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          res.destroy();
          reject(new LlmError(MESSAGES.default, { code: 'too_large', detail: 'response too large' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', (err) =>
        reject(new LlmError(MESSAGES.network, { code: 'network', retryable: true, detail: 'response: ' + err.message }))
      );
    });
  }

  async _errorFrom(res) {
    let text = '';
    try {
      text = await this._readAll(res);
    } catch {
      /* ignore */
    }
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.error?.message || json.message || text;
    } catch {
      /* ignore */
    }
    return new LlmError(friendlyForStatus(res.statusCode, detail), {
      code: `http_${res.statusCode}`,
      status: res.statusCode,
      retryable: res.statusCode === 429 || res.statusCode >= 500,
      detail: `HTTP ${res.statusCode}: ${String(detail).slice(0, 300)}`,
    });
  }

  /** 非流式：一次拿回完整回复。微信桥接和主动消息用这个。 */
  async complete({ system, turns, maxTokens, signal }) {
    let lastError = null;
    let sawDegenerate = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const safe = attempt > 0;
      try {
        const payload = this.buildPayload({ system, turns, stream: false, maxTokens, safe });
        const { res } = await this._open(payload, { signal });
        if (res.statusCode !== 200) throw await this._errorFrom(res);
        const raw = await this._readAll(res);
        let json;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new LlmError(MESSAGES.empty, { code: 'bad_json', detail: 'invalid json: ' + raw.slice(0, 200) });
        }
        const choice = (json && json.choices && json.choices[0]) || {};
        const text = String((choice.message && choice.message.content) || '').trim();
        if (!text) throw new LlmError(MESSAGES.empty, { code: 'empty' });
        const truncated = choice.finish_reason === 'length';
        const degenerate = looksDegenerate(text);
        if ((degenerate || truncated) && !safe) {
          sawDegenerate = true;
          this.logger &&
            this.logger.warn(`回复${degenerate ? '像是跑飞了' : '被长度截断'}（${text.length} 字），用更稳的参数重试一次`);
          continue;
        }
        return truncated ? cutToSentence(text) : text;
      } catch (err) {
        lastError = err;
        const llmError = err instanceof LlmError ? err : new LlmError(MESSAGES.default, { detail: String(err && err.message) });
        if (!llmError.retryable || attempt === 2 || llmError.code === 'aborted') {
          if (sawDegenerate && llmError.retryable && !llmError.code.startsWith('http_4')) break;
          throw llmError;
        }
        await sleep(700 * (attempt + 1));
      }
    }
    throw lastError || new LlmError(MESSAGES.empty, { code: 'empty' });
  }

  /** 流式：网页聊天用，边生成边显示。 */
  async *stream({ system, turns, signal }) {
    const payload = this.buildPayload({ system, turns, stream: true });
    const { req, res } = await this._open(payload, { signal });
    if (res.statusCode !== 200) throw await this._errorFrom(res);
    res.setEncoding('utf8');
    let buffer = '';
    let sent = 0;
    let finished = false;
    let streamError = null;
    const pending = [];
    try {
      for await (const chunk of res) {
        buffer += chunk;
        buffer = drainSse(buffer, (data) => {
          if (data === '[DONE]') {
            finished = true;
            return;
          }
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            return;
          }
          if (json && json.error) {
            streamError = new LlmError(MESSAGES.default, {
              code: 'stream_error',
              detail: String(json.error.message || ''),
            });
            return;
          }
          const piece = json?.choices?.[0]?.delta?.content;
          if (piece) {
            sent += piece.length;
            pending.push(piece);
          }
        });
        while (pending.length) yield pending.shift();
        if (streamError) throw streamError;
        if (finished) break;
      }
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (signal && signal.aborted) return;
      throw new LlmError(MESSAGES.network, { code: 'network', detail: 'stream: ' + (err && err.message) });
    } finally {
      try { req.destroy(); } catch { /* ignore */ }
      try { res.destroy(); } catch { /* ignore */ }
    }
    if (!sent) throw new LlmError(MESSAGES.empty, { code: 'empty' });
  }

  /** 设置面板的「测试连接」。 */
  async probe() {
    const started = Date.now();
    const base = {
      provider: this.provider,
      providerLabel: this.providerLabel,
      model: this.model,
      baseUrl: this.baseUrl,
      ms: 0,
    };
    if (this.isMock) return { ...base, ok: false, ms: 0, message: MESSAGES.nokey };
    try {
      const sample = await this.complete({
        system: '你是一个连接测试助手，只回答被要求的内容。',
        turns: [{ role: 'user', content: '只回复两个字：你好' }],
        maxTokens: 24,
      });
      return { ...base, ok: true, ms: Date.now() - started, sample: String(sample).slice(0, 40) };
    } catch (err) {
      const message = err instanceof LlmError ? err.userMessage : MESSAGES.default;
      const detail = (err && (err.detail || err.message)) || '';
      return { ...base, ok: false, ms: Date.now() - started, message, detail: String(detail).slice(0, 300) };
    }
  }
}

module.exports = { LlmClient, LlmError, MESSAGES, looksDegenerate, cutToSentence };
