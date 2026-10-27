'use strict';

/**
 * 微信聊天伴侣 · 服务端
 *
 * 一个文件把 HTTP 服务、静态页面、聊天接口和微信桥接口都装下，
 * 不引任何第三方依赖：npm install 都不用跑，node server.js 就能用。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const {
  PROVIDERS,
  loadConfig,
  ensureConfigFile,
  resolveRuntime,
  loadSettings,
  saveSettings,
  saveConfigPaths,
  maskKey,
  readJson,
} = require('./src/config');
const { createLogger } = require('./src/logger');
const { Store } = require('./src/store');
const { Life } = require('./src/life');
const { LlmClient, LlmError } = require('./src/llm');
const { loadPersonas, findPersona, publicPersona, greetingFor, timeLabel, buildSystem } = require('./src/persona');
const { PersonaStore } = require('./src/personaStore');
const { Companion } = require('./src/chat');
const { VisionClient, VisionError } = require('./src/vision');
const { ImageGen, ImageGenError } = require('./src/imagegen');
const { WeChatGateway } = require('./src/gateway');
const { WeChatBridge } = require('./src/wechat');
const { careDue } = require('./src/care');
const { shareVideo } = require('./src/share');
const { Tools } = require('./src/tools');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const BODY_LIMIT = { json: 512 * 1024, chat: 256 * 1024, vision: 16 * 1024 * 1024 };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function boot() {
  const config = loadConfig();
  ensureConfigFile(config.root);
  const logger = createLogger({ file: config.paths.logFile, level: (config.log && config.log.level) || 'info' });
  const store = new Store({
    file: config.paths.storeFile,
    logger,
    maxMessages: Number(config.memory.maxMessages) || 300,
    maxSessions: Number(config.memory.maxSessions) || 120,
  });
  const llm = new LlmClient({ config, logger });
  let personas = loadPersonas(config.paths.personaDir, logger);
  const personaStore = new PersonaStore({ config, logger, presets: personas });
  const vision = new VisionClient({ config, logger });
  const imagegen = new ImageGen({ config, logger });
  const companion = new Companion({ config, store, llm, logger, personas, personaStore, imagegen });
  const gateway = new WeChatGateway({ config, companion, logger });
  const wechat = new WeChatBridge({ config, logger });
  const life = new Life({ config, logger });
  const tools = new Tools({ config, logger, root: config.paths.root });
  if (config.tools.autoInstall !== false && !tools.status().ffmpeg.available) {
    // 缺 ffmpeg 时后台装一次：微信图片/表情是 wxgf/HEVC，没有它看不了。
    // 装不上不阻塞启动，设置页会显示原因并给「安装」按钮。
    setTimeout(() => {
      tools.installFfmpeg().then((r) => {
        if (r.started) logger.info('首次启动缺少 ffmpeg，正在后台下载…');
      }).catch(() => {});
    }, 1200);
  }

  if (!personas.length) logger.warn('personas/ 里没有可用的人设文件，先放一个 JSON 进去。');

  // ---- 小工具 -------------------------------------------------------------

  const queues = new Map();
  function enqueue(key, task) {
    const tail = queues.get(key) || Promise.resolve();
    const run = tail.then(task, task);
    const guarded = run.catch(() => {});
    queues.set(key, guarded);
    guarded.then(() => {
      if (queues.get(key) === guarded) queues.delete(key);
    });
    return run;
  }

  function sendJson(res, status, data) {
    if (res.writableEnded) return;
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function sendError(res, status, message, extra = {}) {
    sendJson(res, status, { ok: false, error: message, ...extra });
  }

  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error('body too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function readJsonBody(req, limit = BODY_LIMIT.json) {
    const raw = await readRaw(req, limit);
    if (!raw.length) return {};
    try {
      return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw Object.assign(new Error('请求内容不是合法的 JSON'), { status: 400 });
    }
  }

  function createSse(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    return {
      send(event, data) {
        if (closed || res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      end() {
        if (closed) return;
        try {
          res.end();
        } catch {
          /* ignore */
        }
      },
      get closed() {
        return closed;
      },
    };
  }

  const PAUSE_FILE = path.join(config.paths.dataDir, 'PAUSED');

  /** 「启动热键」按 PageUp 后留下这个标记，桥接消息不再回复，直到 PageDown。 */
  function paused() {
    try {
      return fs.existsSync(PAUSE_FILE);
    } catch {
      return false;
    }
  }

  function settingsView() {
    const runtime = resolveRuntime(config);
    const s = loadSettings(config);
    const visionCfg = config.vision || {};
    return {
      ok: true,
      provider: runtime.provider,
      providerLabel: runtime.providerLabel,
      needsKey: runtime.needsKey,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      temperature: runtime.temperature,
      mock: runtime.mock,
      hasKey: Boolean(runtime.apiKey),
      keyMasked: maskKey(runtime.apiKey),
      userName: store.profile.userName || runtime.userName,
      personaId: runtime.personaId,
      personaCustomPrompt: runtime.customPrompt,
      careEnabled: Boolean(config.care.enabled),
      bridgeEnabled: Boolean(config.gateway.wechat.enabled),
      bridgeToken: String((config.gateway.wechat && config.gateway.wechat.inboundToken) || ''),
      wechat: { dbDir: String((config.wechat && config.wechat.dbDir) || '') },
      vision: {
        enabled: vision.enabled,
        model: vision.model,
        hasKey: Boolean(visionCfg.apiKey),
        stickerScreenshot: Boolean(visionCfg.stickerScreenshot),
        keyMasked: maskKey(visionCfg.apiKey || (s.keys || {}).zhipu || ''),
      },
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        baseUrl: p.baseUrl,
        model: p.model,
        models: p.models,
        needsKey: p.needsKey,
        hint: p.hint,
      })),
      limits: {
        privateMaxChars: personaStore.get().privateMaxChars || config.chat.privateMaxChars,
        groupMaxChars: personaStore.get().groupMaxChars || config.chat.groupMaxChars,
        maxBubbles: personaStore.get().maxBubbles || config.chat.maxBubbles,
      },
      group: {
        emojiLevel: ['low', 'normal', 'normal', 'high'][Number(personaStore.get().emojiLevel) || 0] || 'normal',
        requireAt: Boolean(config.chat.groupRequireAt),
        freeChat: Boolean(config.chat.groupFreeChat),
        freeChatChance: Number(config.chat.groupFreeChatChance) || 0,
        cooldownSec: Number(config.chat.groupCooldownSec) || 0,
        engagedMinutes: Number(config.chat.groupEngagedMinutes) || 0,
        silentMinutes: Number(config.chat.groupSilentMinutes) || 0,
        muteDefaultMinutes: Number(config.chat.groupMuteDefaultMinutes) || 0,
        muted: (config.group && config.group.mutedGroups) || [],
      },
      links: { enabled: Boolean(config.links && config.links.enabled), maxLinks: Number((config.links && config.links.maxLinks) || 2) },
      share: { enabled: Boolean(config.share && config.share.enabled), everyMinutes: Number((config.share && config.share.everyMinutes) || 120) },
      voice: {
        enabled: Boolean(config.voice && config.voice.enabled),
        hasKey: Boolean(config.voice && config.voice.apiKey),
        model: (config.voice && config.voice.model) || '',
        baseUrl: (config.voice && config.voice.baseUrl) || '',
        keyMasked: maskKey((config.voice && config.voice.apiKey) || (s.keys || {}).voice || ''),
      },
      imagegen: imagegen.status(),
      admin: { spell: Boolean(config.admin && config.admin.spell), minutes: Number((config.admin && config.admin.minutes) || 10) },
    };
  }

  function personaView() {
    const persona = personaStore.get();
    return {
      ...publicPersona(persona),
      presetId: persona.presetId || 'custom',
      greeting: greetingFor(persona, new Date()),
    };
  }

  function presetView(persona) {
    return {
      id: persona.id,
      name: persona.name,
      avatar: persona.avatar,
      color: persona.color,
      tagline: persona.tagline,
    };
  }

  function sessionView(session) {
    if (!session) return null;
    return {
      id: session.id,
      channel: session.channel,
      type: session.type,
      title: session.title,
      chatId: session.chatId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        name: m.name || '',
        ts: m.ts,
      })),
      notes: session.notes.map((n) => ({ id: n.id, text: n.text, source: n.source, ts: n.ts })),
    };
  }

  async function digestSince(sinceIso) {
    const since = sinceIso ? new Date(sinceIso).getTime() : 0;
    const items = [];
    for (const session of store.sessions.values()) {
      for (const message of session.messages) {
        const ts = new Date(message.ts).getTime();
        if (Number.isFinite(ts) && ts > since) {
          items.push({ ts, text: `${session.title}｜${message.role === 'user' ? '对方' : '我'}：${message.text}` });
        }
      }
    }
    items.sort((a, b) => a.ts - b.ts);
    if (!items.length) return { count: 0, text: '' };
    const recent = items.slice(-12);
    let text = '';
    try {
      text = await llm.complete({
        system: '你是消息摘要助手。用一两句口语概括下面这些微信消息里发生了什么，不要用列表，不要加结论。',
        turns: [{ role: 'user', content: recent.map((i) => i.text).join('\n') }],
        maxTokens: 160,
      });
    } catch {
      text = recent.map((i) => i.text).join('\n');
    }
    return { count: items.length, text: String(text).trim() };
  }

  // ---- 路由 ---------------------------------------------------------------

  async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || 'GET';
    const parts = pathname.split('/').filter(Boolean);

    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (pathname === '/api/status' && method === 'GET') {
      const runtime = resolveRuntime(config);
      const bridgeInfo = await wechat.health();
      sendJson(res, 200, {
        ok: true,
        app: { name: 'wechat-pal', displayName: '微信聊天伴侣', version: require('./package.json').version || '2.0.0' },
        persona: personaView(),
        llm: {
          provider: runtime.provider,
          providerLabel: runtime.providerLabel,
          model: runtime.model,
          baseUrl: runtime.baseUrl,
          temperature: runtime.temperature,
          mock: runtime.mock,
          needsKey: runtime.needsKey,
          hasKey: Boolean(runtime.apiKey),
          keyMasked: maskKey(runtime.apiKey),
        },
        vision: vision.describe(),
        gateway: gateway.status(),
        bridge: bridgeInfo,
        stats: store.stats(),
        care: { enabled: Boolean(config.care.enabled), nextDue: careDue({ config }) },
        life: life.snapshot(),
        tools: tools.status(),
        time: timeLabel(new Date()),
      });
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      sendJson(res, 200, settingsView());
      return;
    }

    if (pathname === '/api/settings' && method === 'POST') {
      const body = await readJsonBody(req);
      const patch = {};
      for (const key of ['provider', 'baseUrl', 'model', 'userName', 'personaId', 'personaCustomPrompt']) {
        if (typeof body[key] === 'string') patch[key] = body[key].trim();
      }
      if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
        patch.temperature = Math.max(0, Math.min(2, body.temperature));
      }
      if (typeof body.mock === 'boolean') patch.mock = body.mock;
      if (typeof body.apiKey === 'string' && body.apiKey.trim() && !body.apiKey.includes('****')) {
        patch.apiKey = body.apiKey.trim();
      }
      if (body.clearApiKey) {
        patch.apiKey = '';
        patch.keys = { [patch.provider || loadSettings(config).provider || config.llm.provider]: '' };
      }
      saveSettings(config, patch);
      if (typeof patch.userName === 'string') {
        store.profile.userName = patch.userName;
        store.markDirty();
      }

      const advanced = {};
      if (typeof body.careEnabled === 'boolean') advanced['care.enabled'] = body.careEnabled;
      if (typeof body.bridgeEnabled === 'boolean') advanced['gateway.wechat.enabled'] = body.bridgeEnabled;
      if (typeof body.linksEnabled === 'boolean') advanced['links.enabled'] = body.linksEnabled;
      if (typeof body.shareEnabled === 'boolean') advanced['share.enabled'] = body.shareEnabled;
      if (typeof body.voiceEnabled === 'boolean') advanced['voice.enabled'] = body.voiceEnabled;
      if (typeof body.emojiLevel === 'string' && ['low', 'normal', 'high'].includes(body.emojiLevel)) {
        const level = { low: 0, normal: 2, high: 3 }[body.emojiLevel];
        personaStore.save({ emojiLevel: level });
      }
      if (typeof body.voiceApiKey === 'string' && body.voiceApiKey.trim() && !body.voiceApiKey.includes('****')) {
        advanced['voice.apiKey'] = body.voiceApiKey.trim();
      }
      if (body.clearVoiceKey) advanced['voice.apiKey'] = '';
      if (typeof body.voiceBaseUrl === 'string') advanced['voice.baseUrl'] = body.voiceBaseUrl.trim();
      if (typeof body.voiceModel === 'string') advanced['voice.model'] = body.voiceModel.trim();
      if (typeof body.wechatBackgroundSend === 'boolean') advanced['wechat.backgroundSend'] = body.wechatBackgroundSend;
      if (Number.isFinite(Number(body.wechatStaleAfterSec))) {
        advanced['wechat.staleAfterSec'] = Math.max(30, Math.min(3600, Math.round(Number(body.wechatStaleAfterSec))));
      }
      if (typeof body.visionStickerShot === 'boolean') advanced['vision.stickerScreenshot'] = body.visionStickerShot;
      if (typeof body.groupRequireAt === 'boolean') advanced['chat.groupRequireAt'] = body.groupRequireAt;
      if (typeof body.groupFreeChat === 'boolean') advanced['chat.groupFreeChat'] = body.groupFreeChat;
      if (Number.isFinite(Number(body.groupFreeChatChance))) {
        advanced['chat.groupFreeChatChance'] = Math.max(0, Math.min(100, Math.round(Number(body.groupFreeChatChance))));
      }
      if (Number.isFinite(Number(body.groupCooldownSec))) {
        advanced['chat.groupCooldownSec'] = Math.max(0, Math.min(600, Math.round(Number(body.groupCooldownSec))));
      }
      if (Number.isFinite(Number(body.groupEngagedMinutes))) {
        advanced['chat.groupEngagedMinutes'] = Math.max(0, Math.min(240, Math.round(Number(body.groupEngagedMinutes))));
      }
      if (Number.isFinite(Number(body.groupSilentMinutes))) {
        advanced['chat.groupSilentMinutes'] = Math.max(0, Math.min(1440, Math.round(Number(body.groupSilentMinutes))));
      }
      if (Number.isFinite(Number(body.groupMuteDefaultMinutes))) {
        advanced['chat.groupMuteDefaultMinutes'] = Math.max(0, Math.min(1440, Math.round(Number(body.groupMuteDefaultMinutes))));
      }
      if (Array.isArray(body.mutedGroups)) {
        advanced['group.mutedGroups'] = body.mutedGroups
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 50);
      }
      if (typeof body.visionApiKey === 'string' && body.visionApiKey.trim() && !body.visionApiKey.includes('****')) {
        advanced['vision.apiKey'] = body.visionApiKey.trim();
      }
      if (body.clearVisionKey) advanced['vision.apiKey'] = '';
      if (typeof body.imagegenKey === 'string' && body.imagegenKey.trim() && !body.imagegenKey.includes('****')) {
        advanced['imagegen.apiKey'] = body.imagegenKey.trim();
      }
      if (body.clearImagegenKey) advanced['imagegen.apiKey'] = '';
      if (typeof body.imagegenBaseUrl === 'string') advanced['imagegen.baseUrl'] = body.imagegenBaseUrl.trim();
      if (typeof body.imagegenModel === 'string') advanced['imagegen.model'] = body.imagegenModel.trim();
      if (typeof body.imagegenEnabled === 'boolean') advanced['imagegen.enabled'] = body.imagegenEnabled;
      if (typeof body.wechatDbDir === 'string') {
        advanced['wechat.dbDir'] = body.wechatDbDir.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').slice(0, 300);
      }
      if (Object.keys(advanced).length) saveConfigPaths(config, advanced);

      llm.reload();
      vision.reload();
      imagegen.reload();
      logger.info(
        `设置已更新：${llm.providerLabel} / ${llm.model || '未填模型'}${llm.isMock ? '（演示模式）' : ''}`
      );
      sendJson(res, 200, settingsView());
      return;
    }

    if (pathname === '/api/settings/test' && method === 'POST') {
      llm.reload();
      const result = await llm.probe();
      sendJson(res, 200, { ok: result.ok, result });
      return;
    }

    if (pathname === '/api/vision/test' && method === 'POST') {
      vision.reload();
      sendJson(res, 200, { ok: true, vision: vision.describe() });
      return;
    }

    if (pathname === '/api/vision' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.vision);
      vision.reload();
      try {
        const text = await vision.describeImage({
          image: body.image,
          mime: body.mime,
          prompt: body.prompt,
        });
        sendJson(res, 200, { ok: true, text });
      } catch (err) {
        const message = err instanceof VisionError ? err.userMessage : '看图失败了，稍后再试。';
        sendJson(res, 200, { ok: false, error: message });
      }
      return;
    }

    if (pathname === '/api/image/generate' && method === 'POST') {
      const body = await readJsonBody(req);
      imagegen.reload();
      try {
        const out = await imagegen.generate(body.prompt, { size: body.size });
        sendJson(res, 200, { ok: true, ...out });
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          error: err instanceof ImageGenError ? err.message : '生图失败了，稍后再试。',
          detail: err && err.detail ? String(err.detail).slice(0, 200) : '',
        });
      }
      return;
    }

    if (pathname === '/api/image/status' && method === 'GET') {
      imagegen.reload();
      sendJson(res, 200, { ok: true, ...imagegen.status() });
      return;
    }

    if (pathname === '/api/personas' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        activeId: personaStore.get().presetId || 'custom',
        presets: personas.map(presetView),
        active: personaView(),
      });
      return;
    }

    if (pathname === '/api/persona' && method === 'GET') {
      sendJson(res, 200, { ok: true, persona: personaView() });
      return;
    }

    if (pathname === '/api/persona' && method === 'POST') {
      const body = await readJsonBody(req);
      const patch = isPlainObject(body.persona) ? body.persona : body;
      if (patch.name !== undefined && !String(patch.name).trim()) {
        sendError(res, 400, '名字不能空着');
        return;
      }
      const saved = personaStore.save(patch);
      logger.info(`人设更新：${saved.name}`);
      sendJson(res, 200, { ok: true, persona: personaView() });
      return;
    }

    if (pathname === '/api/persona/preset' && method === 'POST') {
      const body = await readJsonBody(req);
      const saved = personaStore.applyPreset(String(body.id || '').trim());
      if (!saved) {
        sendError(res, 404, '没有这个预设');
        return;
      }
      logger.info(`切换人设：${saved.name}`);
      sendJson(res, 200, { ok: true, persona: personaView(), activeId: saved.presetId, presets: personas.map(presetView) });
      return;
    }

    if (pathname === '/api/persona/reset' && method === 'POST') {
      const body = await readJsonBody(req);
      const saved = personaStore.reset(String(body.id || '').trim());
      if (!saved) {
        sendError(res, 404, '没有可恢复的预设');
        return;
      }
      sendJson(res, 200, { ok: true, persona: personaView() });
      return;
    }

    if (pathname === '/api/persona/import' && method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const saved = personaStore.import(body.persona || body);
        sendJson(res, 200, { ok: true, persona: personaView() });
        logger.info(`导入人设：${saved.name}`);
      } catch (err) {
        sendError(res, err.status || 400, err.message || '导入失败');
      }
      return;
    }

    if (pathname === '/api/persona/export' && method === 'GET') {
      const persona = personaStore.get();
      const name = `persona-${persona.id || 'custom'}.json`;
      const body = JSON.stringify({ ...persona, exportedAt: new Date().toISOString() }, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (pathname === '/api/persona/reload' && method === 'POST') {
      personas = loadPersonas(config.paths.personaDir, logger);
      personaStore.presets = personas;
      sendJson(res, 200, { ok: true, presets: personas.map(presetView), persona: personaView() });
      return;
    }

    if (pathname === '/api/sessions' && method === 'GET') {
      sendJson(res, 200, { ok: true, sessions: store.list() });
      return;
    }

    if (pathname === '/api/sessions' && method === 'DELETE') {
      store.clearAll();
      sendJson(res, 200, { ok: true, sessions: [] });
      return;
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const body = await readJsonBody(req);
      const session = store.create({
        channel: 'web',
        type: 'private',
        title: String(body.title || '新对话').slice(0, 30),
      });
      sendJson(res, 200, { ok: true, session: sessionView(session) });
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'sessions' && parts[2]) {
      const session = store.get(parts[2]);
      if (!session) {
        sendError(res, 404, '对话不存在');
        return;
      }
      if (method === 'GET' && parts.length === 3) {
        sendJson(res, 200, { ok: true, session: sessionView(session) });
        return;
      }
      if (method === 'DELETE' && parts.length === 3) {
        store.remove(session.id);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === 'POST' && parts[3] === 'clear') {
        session.messages = [];
        session.updatedAt = new Date().toISOString();
        store.markDirty();
        sendJson(res, 200, { ok: true, session: sessionView(session) });
        return;
      }
    }

    if (pathname === '/api/reset' && method === 'POST') {
      const body = await readJsonBody(req);
      const session = store.get(String(body.sessionId || ''));
      if (!session) {
        sendError(res, 404, '对话不存在');
        return;
      }
      session.messages = [];
      store.markDirty();
      sendJson(res, 200, { ok: true, session: sessionView(session) });
      return;
    }

    if (pathname === '/api/chat' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.chat);
      const text = String(body.text || '').trim();
      if (!text) {
        sendError(res, 400, '说点什么吧');
        return;
      }
      const session = body.sessionId ? store.get(String(body.sessionId)) : store.create({ channel: 'web' });
      if (!session) {
        sendError(res, 404, '对话不存在');
        return;
      }
      const sse = createSse(res);
      const controller = new AbortController();
      res.on('close', () => {
        if (!sse.closed) controller.abort();
      });
      sse.send('meta', {
        sessionId: session.id,
        persona: { name: companion.persona.name, avatar: companion.persona.avatar },
        mock: llm.isMock,
      });
      try {
        const result = await enqueue(session.id, () =>
          companion.handle(
            { channel: 'web', sessionId: session.id, chatType: session.type, text },
            { onDelta: (piece) => sse.send('delta', { text: piece }), signal: controller.signal }
          )
        );
        if (result.action === 'reply') {
          life.note('陪你聊了几句，心情不错。', { mood: 1, energy: -1, affinity: 1 });
          sse.send('done', {
            ok: true,
            sessionId: result.sessionId,
            text: result.text,
            bubbles: result.bubbles,
            images: result.images || [],
            mock: llm.isMock,
            sessions: store.list(),
          });
        } else if (result.action === 'error') {
          sse.send('error', { ok: false, error: result.error || '生成失败了，再试一次？' });
        } else {
          sse.send('done', { ok: true, sessionId: result.sessionId, text: '', bubbles: [] });
        }
      } catch (err) {
        logger.error('聊天接口异常：' + ((err && err.stack) || err));
        sse.send('error', { ok: false, error: '服务端出了点问题，看看终端日志。' });
      } finally {
        sse.end();
      }
      return;
    }

    if (pathname === '/api/memory' && method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || '';
      const session = store.get(sessionId);
      if (!session) {
        sendError(res, 404, '对话不存在');
        return;
      }
      sendJson(res, 200, { ok: true, notes: sessionView(session).notes });
      return;
    }

    if (pathname === '/api/memory' && method === 'POST') {
      const body = await readJsonBody(req);
      const session = store.get(String(body.sessionId || ''));
      if (!session) {
        sendError(res, 404, '对话不存在');
        return;
      }
      const note = store.addNote(session.id, String(body.text || ''), 'user');
      sendJson(res, 200, { ok: true, note, notes: sessionView(session).notes });
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'memory' && parts[2] && method === 'DELETE') {
      const sessionId = url.searchParams.get('sessionId') || '';
      const ok = store.removeNote(sessionId, parts[2]);
      sendJson(res, 200, { ok, notes: (store.get(sessionId) || { notes: [] }).notes });
      return;
    }

    if (pathname === '/api/care/due' && method === 'GET') {
      if (paused()) {
        sendJson(res, 200, { ok: true, due: false, reason: 'paused' });
        return;
      }
      const last = Number(url.searchParams.get('last') || 0);
      const sentToday = Number(url.searchParams.get('sentToday') || 0);
      const result = careDue({ config, lastMs: last, sentToday, now: new Date() });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/care' && method === 'GET') {
      const chatId = url.searchParams.get('chat') || '';
      const session = chatId
        ? store.ensure({ channel: 'wechat', chatId, type: 'private', title: '微信聊天' })
        : [...store.sessions.values()]
            .filter((s) => s.channel === 'wechat')
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      if (!session) {
        sendJson(res, 200, { ok: true, text: '' });
        return;
      }
      try {
        const text = await enqueue(`care:${session.id}`, () => companion.careMessage(session));
        sendJson(res, 200, { ok: true, text: text || '', sessionId: session.id });
      } catch (err) {
        const message = err instanceof LlmError ? err.userMessage : '现在还不适合主动说话。';
        logger.warn('主动消息生成失败：' + ((err && (err.detail || err.message)) || err));
        sendJson(res, 200, { ok: false, text: '', error: message });
      }
      return;
    }

    if (pathname === '/api/digest' && method === 'GET') {
      const since = url.searchParams.get('since') || '';
      const digest = await digestSince(since);
      sendJson(res, 200, { ok: true, ...digest });
      return;
    }

    if (pathname === '/api/share' && method === 'GET') {
      try {
        const result = await shareVideo({
          config,
          persona: personaStore.get(),
          llm,
          topic: url.searchParams.get('topic') || '',
        });
        sendJson(res, 200, result);
      } catch (err) {
        logger.warn('分享生成失败：' + ((err && err.message) || err));
        sendJson(res, 200, { ok: false, enabled: Boolean(config.share.enabled), video: null, comment: '' });
      }
      return;
    }

    if (pathname === '/api/bridge/heartbeat' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, gateway.heartbeat(body));
      return;
    }

    if (pathname === '/webhook/wechat' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.json);
      const auth = gateway.verify(req, body);
      if (!auth.ok) {
        gateway.counters.rejected += 1;
        sendJson(res, auth.status, { ok: false, action: 'ignore', error: auth.error });
        return;
      }
      if (paused()) {
        gateway.counters.ignored += 1;
        sendJson(res, 200, { ok: true, action: 'ignore', reason: 'paused' });
        return;
      }
      try {
        const result = await enqueue(`wx:${body.chat_id || 'unknown'}`, () => gateway.handle(body));
        sendJson(res, result.status, result.json);
      } catch (err) {
        logger.error('微信消息处理失败：' + ((err && err.stack) || err));
        sendJson(res, 200, { action: 'ignore', reason: 'server-error' });
      }
      return;
    }

    // ---------- 微信能力（由桥接进程里的本机接口提供） ----------
    if (pathname === '/api/wechat/health' && method === 'GET') {
      sendJson(res, 200, await wechat.health());
      return;
    }

    if (pathname === '/api/wechat/sessions' && method === 'GET') {
      try {
        sendJson(res, 200, await wechat.sessions(Number(url.searchParams.get('limit')) || 200));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/wechat/messages' && method === 'GET') {
      const chat = url.searchParams.get('chat') || '';
      if (!chat) {
        sendError(res, 400, '缺少 chat');
        return;
      }
      try {
        sendJson(
          res,
          200,
          await wechat.messages(chat, Number(url.searchParams.get('limit')) || 50, Number(url.searchParams.get('offset')) || 0)
        );
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/wechat/media' && method === 'GET') {
      const chat = url.searchParams.get('chat') || '';
      const localId = Number(url.searchParams.get('localId')) || 0;
      const kind = url.searchParams.get('kind') || 'image';
      try {
        sendJson(res, 200, await wechat.media(chat, localId, kind));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/wechat/contacts' && method === 'GET') {
      try {
        sendJson(res, 200, await wechat.contacts(url.searchParams.get('q') || ''));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/wechat/send' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.vision);
      try {
        sendJson(res, 200, await wechat.send(String(body.chat || ''), String(body.name || ''), body.segments || []));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/wechat/upload' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.vision);
      const data = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
      const extRaw = path.extname(String(body.name || '')).toLowerCase();
      const ext = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.m4a', '.silk', '.mp4', '.pdf', '.doc', '.docx', '.zip'].includes(extRaw) ? extRaw : '.bin';
      if (!data || data.length > 20 * 1024 * 1024) {
        sendJson(res, 200, { ok: false, error: '文件为空或超过 15MB' });
        return;
      }
      const dir = path.join(config.paths.dataDir, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      sendJson(res, 200, { ok: true, path: file, name: String(body.name || name), size: fs.statSync(file).size });
      return;
    }

    if (pathname === '/api/moments' && method === 'GET') {
      try {
        sendJson(res, 200, await wechat.moments(Number(url.searchParams.get('limit')) || 20, Number(url.searchParams.get('offset')) || 0));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/moments/media' && method === 'GET') {
      try {
        sendJson(res, 200, await wechat.momentMedia(
          url.searchParams.get('md5') || '',
          Number(url.searchParams.get('size')) || 0,
          Number(url.searchParams.get('w')) || 0,
          Number(url.searchParams.get('h')) || 0
        ));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/moments/like' && method === 'POST') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, 200, await wechat.likeMoment(String(body.username || ''), String(body.text || ''), Boolean(body.cancel)));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/moments/comment' && method === 'POST') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, 200, await wechat.commentMoment(String(body.username || ''), String(body.text || ''), String(body.content || ''), String(body.replyTo || '')));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/moments/post' && method === 'POST') {
      const body = await readJsonBody(req);
      try {
        sendJson(res, 200, await wechat.postMoment(String(body.text || ''), body.images || []));
      } catch (err) {
        sendJson(res, 200, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/life' && method === 'GET') {
      sendJson(res, 200, { ok: true, ...life.snapshot(), persona: personaView() });
      return;
    }

    if (pathname === '/api/tools' && method === 'GET') {
      sendJson(res, 200, { ok: true, ...tools.status() });
      return;
    }

    if (pathname === '/api/tools/ffmpeg' && method === 'POST') {
      const r = await tools.installFfmpeg();
      sendJson(res, 200, { ok: true, ...r, ...tools.status() });
      return;
    }

    if (pathname === '/api/life/nudge' && method === 'POST') {
      const body = await readJsonBody(req);
      life.note(String(body.text || '被关心了一下。'), {
        mood: Number(body.mood) || 0,
        energy: Number(body.energy) || 0,
        affinity: Number(body.affinity) || 0,
      });
      sendJson(res, 200, { ok: true, ...life.snapshot() });
      return;
    }

    if (pathname === '/api/stickers' && method === 'GET') {
      const dir = path.join(config.paths.dataDir, 'stickers');
      fs.mkdirSync(dir, { recursive: true });
      const items = fs
        .readdirSync(dir)
        .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
        .slice(0, 300)
        .map((name) => ({ name, url: '/stickers/' + encodeURIComponent(name), path: path.join(dir, name) }));
      sendJson(res, 200, { ok: true, stickers: items });
      return;
    }

    if (pathname === '/api/stickers' && method === 'POST') {
      const body = await readJsonBody(req, BODY_LIMIT.vision);
      const data = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!data) {
        sendJson(res, 200, { ok: false, error: '没有图片数据' });
        return;
      }
      const ext = /\.png$/i.test(String(body.name || '')) ? '.png' : '.jpg';
      const dir = path.join(config.paths.dataDir, 'stickers');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
      fs.writeFileSync(path.join(dir, name), Buffer.from(data, 'base64'));
      sendJson(res, 200, { ok: true, sticker: { name, url: '/stickers/' + encodeURIComponent(name), path: path.join(dir, name) } });
      return;
    }

    if (pathname === '/api/debug/state' && method === 'GET') {
      // 调试用：只给本机，方便排查为什么模型不回复
      sendJson(res, 200, {
        ok: true,
        runtime: { ...llm.describe() },
        persona: companion.persona.id,
        sessions: store.stats(),
        gateway: gateway.status(),
        config: {
          chat: config.chat,
          memory: config.memory,
          care: config.care,
          gateway: { wechat: { enabled: config.gateway.wechat.enabled, tokenSet: Boolean(gateway.token()) } },
        },
      });
      return;
    }

    if (pathname === '/api/debug/prompt' && method === 'POST') {
      const body = await readJsonBody(req);
      const session = body.sessionId ? store.get(String(body.sessionId)) : null;
      const { buildSystem } = require('./src/persona');
      const system = buildSystem({
        persona: companion.persona,
        config,
        runtime: llm.runtime,
        session: session || { title: '调试' },
        isGroup: Boolean(body.group),
        userName: llm.runtime.userName,
        notes: session ? store.notes(session.id).map((n) => n.text) : [],
        now: new Date(),
      });
      sendJson(res, 200, { ok: true, system });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendError(res, 404, '没有这个接口');
      return;
    }

    if (pathname.startsWith('/wechat-media/') && (method === 'GET' || method === 'HEAD')) {
      serveDataMedia(req, res, pathname.slice('/wechat-media/'.length));
      return;
    }

    if (pathname.startsWith('/persona-image/') && (method === 'GET' || method === 'HEAD')) {
      serveDataMedia(req, res, pathname.slice('/persona-image/'.length), path.join(config.paths.root, 'assets', 'persona'));
      return;
    }

    if (pathname.startsWith('/stickers/') && (method === 'GET' || method === 'HEAD')) {
      serveDataMedia(req, res, pathname.slice('/stickers/'.length), path.join(config.paths.dataDir, 'stickers'));
      return;
    }

    if (pathname.startsWith('/images/') && (method === 'GET' || method === 'HEAD')) {
      serveDataMedia(req, res, pathname.slice('/images/'.length), path.join(config.paths.dataDir, 'images'));
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      serveStatic(req, res, pathname);
      return;
    }

    sendError(res, 404, '没有这个接口');
  }

  function serveStatic(req, res, pathname) {
    const webDir = config.paths.webDir;
    const pages = { '/persona': 'persona.html', '/persona/': 'persona.html', '/debug': 'debug.html' };
    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (pages[pathname]) relative = pages[pathname];
    if (relative.includes('..')) {
      sendError(res, 403, 'forbidden');
      return;
    }
    let file = path.resolve(webDir, relative);
    if (!file.startsWith(path.resolve(webDir))) {
      sendError(res, 403, 'forbidden');
      return;
    }
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {
      stat = null;
    }
    if (stat && stat.isDirectory()) {
      file = path.join(file, 'index.html');
      try {
        stat = fs.statSync(file);
      } catch {
        stat = null;
      }
    }
    if (!stat || !stat.isFile()) {
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (!path.extname(pathname)) {
        // 前端是单页应用，未知路径回首页
        file = path.join(webDir, 'index.html');
        try {
          stat = fs.statSync(file);
        } catch {
          stat = null;
        }
      }
    }
    if (!stat || !stat.isFile()) {
      sendError(res, 404, '文件不存在');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  function serveDataMedia(req, res, relative, baseDir) {
    const base = path.resolve(baseDir || path.join(config.paths.dataDir, 'wechat-media'));
    const file = path.resolve(base, decodeURIComponent(relative));
    if (!file.startsWith(base)) {
      sendError(res, 403, 'forbidden');
      return;
    }
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      sendError(res, 404, '文件不存在');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      const status = err && err.status ? err.status : 500;
      if (!res.headersSent) sendJson(res, status, { ok: false, error: err.message || '服务端错误' });
      else res.end();
      if (status >= 500) logger.error((err && err.stack) || String(err));
    });
  });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  const host = config.server.host || '127.0.0.1';
  const port = Number(config.server.port) || 8787;
  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    const url = `http://${displayHost}:${port}/`;
    logger.info('────────────────────────────────────────');
    logger.info('  微信聊天伴侣 已启动');
    logger.info(`  打开：${url}`);
    logger.info(`  模型：${llm.providerLabel} / ${llm.model || '未选择'}${llm.isMock ? '（演示模式，未配置 Key）' : ''}`);
    logger.info(`  人设：${companion.persona.name} · ${personas.length} 套可用`);
    logger.info(`  微信桥接：${gateway.enabled ? '已启用' : '未启用'}（POST /webhook/wechat）`);
    logger.info('────────────────────────────────────────');
    if (config.server.openBrowser && !process.env.NO_OPEN) openBrowser(url);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`端口 ${port} 被占用了。关闭占用的程序，或改 config.json 里的 server.port（也可用环境变量 PORT=xxxx）。`);
    } else {
      logger.error('HTTP 服务出错：' + ((err && err.stack) || err));
    }
    process.exit(1);
  });

  let closing = false;
  function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info(`收到 ${signal}，保存数据后退出…`);
    store.flush();
    logger.info('已保存，再见。');
    logger.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('未捕获异常：' + ((err && err.stack) || err)));
  process.on('unhandledRejection', (err) => logger.error('未处理的 Promise 拒绝：' + ((err && err.stack) || err)));

  return { server, config, store, logger, llm };
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打不开浏览器不算错误，用户手动打开就行 */
  }
}

if (require.main === module) {
  boot();
}

module.exports = { boot };
