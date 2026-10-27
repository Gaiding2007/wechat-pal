'use strict';

/**
 * 配置读取。
 *
 * 优先级：data/settings.json（网页设置面板里改的） > config.json（手改/AI 改的） > 内置默认值。
 * 所有服务商都走 OpenAI 兼容的 /chat/completions，换服务只要换 baseUrl + model。
 */
const fs = require('node:fs');
const path = require('node:path');

const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    needsKey: true,
    hint: '去 platform.deepseek.com 创建 API Key，按量计费，中文口语自然。',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  zhipu: {
    label: '智谱 GLM-4-Flash（有免费额度）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    needsKey: true,
    hint: 'bigmodel.cn 注册即可用 GLM-4-Flash，免费额度够日常聊天。',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4.5-flash'],
  },
  qwen: {
    label: '通义千问（DashScope）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    needsKey: true,
    hint: '阿里云百炼开通后创建 Key。限流（429）时换 qwen-plus 试试。',
    models: ['qwen-flash', 'qwen-plus', 'qwen-turbo', 'qwen-max'],
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    needsKey: true,
    hint: '注册送额度，开源模型都有；模型名一般带斜杠。',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
  },
  ollama: {
    label: '本地 Ollama（免费、离线）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
    hint: '先装 Ollama 并执行 ollama pull qwen2.5:7b。数据不出本机，不需要 Key。',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen3:8b', 'deepseek-r1:7b', 'glm4:9b', 'llama3.1:8b'],
  },
  custom: {
    label: '自定义（任意 OpenAI 兼容接口）',
    baseUrl: '',
    model: '',
    needsKey: true,
    hint: '填接口地址和模型名即可；本地 / 内网地址可以不填 Key。',
    models: [],
  },
};

const DEFAULT_CONFIG = {
  server: { host: '127.0.0.1', port: 8787, openBrowser: true },
  llm: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.9,
    maxTokens: 700,
    timeoutMs: 45000,
  },
  persona: {
    id: 'whale',
    name: '鲸鱼娘',
    userName: '',
    aliases: ['鲸鱼娘', '小鲸鱼', '哦鲸鲸', '大肥鱼'],
    customPrompt: '',
  },
  chat: {
    privateMaxChars: 140,
    groupMaxChars: 70,
    maxBubbles: 3,
    historyTurns: 20,
    groupHistoryTurns: 12,
    groupRequireAt: true,
    groupFreeChat: false,
    groupFreeChatChance: 10,
    groupCooldownSec: 20,
    groupEngagedMinutes: 6,
    groupSilentMinutes: 20,
    groupMuteDefaultMinutes: 30,
    emojiLevel: 'normal',
  },
  group: { mutedGroups: [] },
  links: { enabled: true, maxLinks: 2 },
  websearch: { enabled: true, maxResults: 4 },
  memory: { autoExtract: true, everyMessages: 8, maxNotes: 8 },
  vision: {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    timeoutMs: 30000,
    stickerScreenshot: false,
  },
  imagegen: {
    enabled: true,
    apiKey: '',
    baseUrl: 'https://maas.qianwenaiapi.com',
    model: 'qwen-image-3.0',
    timeoutMs: 180000,
  },
  care: {
    enabled: false,
    windows: ['09:00-12:00', '14:00-23:00'],
    everyMinutes: 180,
    jitterMinutes: 30,
    maxPerDay: 3,
    quietAfterMinutes: 20,
  },
  gateway: {
    wechat: { enabled: true, inboundToken: 'change-me-wechat', outboundUrl: '', outboundHeaders: {} },
  },
  // 桥接进程里的本机能力接口：网页查历史、看图、发图、刷朋友圈都走它
  bridge: { rpcPort: 8791, token: '' },
  // 可选工具：ffmpeg 静态包地址留空用内置地址，界面里的「安装」按钮会下载到 runtime/ffmpeg
  tools: { ffmpegUrl: '', autoInstall: true },
  // 微信桥接会读这一段，键名与桥接脚本保持一致
  wechat: {
    dbDir: '',
    staleAfterSec: 180,
    quoteReply: true,
    keyboardFallback: true,
    backgroundSend: false,
    gameWhitelist: [],
    awayNotice: true,
    returnNotice: true,
    queuedMaxAgeSec: 300,
    queuedMaxChats: 2,
    lowBatteryPercent: 5,
    digestMinutes: 30,
    ignoreSenders: [],
    goodnightText: '不早啦，早点睡，晚安。',
  },
  voice: {
    enabled: false,
    apiKey: '',
    baseUrl: '',
    model: 'qwen3-asr-flash',
    timeoutMs: 90000,
    maxSeconds: 120,
  },
  share: { enabled: false, everyMinutes: 120, sources: ['bilibili'] },
  admin: { spell: true, minutes: 10, allowAll: false },
  debug: { allowAll: false },
  log: { level: 'info' },
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 深拷贝基础值，避免合并结果反过来改到 DEFAULT_CONFIG。 */
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlain(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
    return out;
  }
  return value;
}

function deepMerge(base, extra) {
  const out = cloneValue(base);
  if (!isPlain(extra)) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (key.startsWith('_')) continue;
    if (isPlain(value) && isPlain(out[key])) out[key] = deepMerge(out[key], value);
    else if (value !== undefined && value !== null) out[key] = cloneValue(value);
  }
  return out;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** 旧版 config.json 的键名，读的时候顺手搬过来，不强制用户重写配置。 */
const LEGACY = [
  ['deepseek.apiKey', 'llm.apiKey'],
  ['deepseek.baseUrl', 'llm.baseUrl'],
  ['deepseek.model', 'llm.model'],
  ['deepseek.temperature', 'llm.temperature'],
  ['deepseek.maxTokens', 'llm.maxTokens'],
  ['deepseek.timeoutMs', 'llm.timeoutMs'],
  ['provider', 'llm.provider'],
  ['persona.ownerName', 'persona.userName'],
  ['chat.groupMaxChars', 'chat.groupMaxChars'],
  ['group.requireAt', 'chat.groupRequireAt'],
];

function pickPath(obj, dotted) {
  return dotted.split('.').reduce((node, key) => (isPlain(node) ? node[key] : undefined), obj);
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let node = obj;
  for (const key of parts.slice(0, -1)) {
    if (!isPlain(node[key])) node[key] = {};
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

function migrateLegacy(raw) {
  const out = isPlain(raw) ? JSON.parse(JSON.stringify(raw)) : {};
  for (const [from, to] of LEGACY) {
    const value = pickPath(out, from);
    if (value === undefined || value === null || value === '') continue;
    if (pickPath(out, to) === undefined) setPath(out, to, value);
  }
  return out;
}

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function isLocalUrl(url) {
  const value = String(url || '').trim().toLowerCase();
  if (!/^https?:\/\//.test(value)) return false;
  return (
    /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(value) ||
    /\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:|\/|$)/.test(
      value
    )
  );
}

function ensureConfigFile(root) {
  const file = path.join(root, 'config.json');
  if (!fs.existsSync(file)) writeJsonAtomic(file, DEFAULT_CONFIG);
  return file;
}

function loadConfig({ root = projectRoot(), env = process.env } = {}) {
  const configFile = path.join(root, 'config.json');
  const fromFile = migrateLegacy(readJson(configFile, {}) || {});
  const cfg = deepMerge(DEFAULT_CONFIG, fromFile);
  cfg.server.port = Number(env.PORT || cfg.server.port) || 8787;
  cfg.server.host = env.HOST || cfg.server.host;
  if (env.DEEPSEEK_MODEL) cfg.llm.model = env.DEEPSEEK_MODEL;
  if (env.DEEPSEEK_BASE_URL) cfg.llm.baseUrl = env.DEEPSEEK_BASE_URL;
  if (env.LLM_PROVIDER) cfg.llm.provider = env.LLM_PROVIDER;
  return {
    ...cfg,
    root,
    env,
    paths: {
      root,
      dataDir: path.join(root, 'data'),
      storeFile: path.join(root, 'data', 'store.json'),
      settingsFile: path.join(root, 'data', 'settings.json'),
      personaFile: path.join(root, 'data', 'persona.json'),
      logFile: path.join(root, 'data', 'app.log'),
      personaDir: path.join(root, 'personas'),
      webDir: path.join(root, 'web'),
      configFile,
    },
  };
}

/** 把用户在网页上改的高级开关写回 config.json（只动指定路径，别覆盖手写注释外的键）。 */
function saveConfigPaths(cfg, paths) {
  const raw = migrateLegacy(readJson(cfg.paths.configFile, {}) || {});
  for (const [dotted, value] of Object.entries(paths || {})) setPath(raw, dotted, value);
  writeJsonAtomic(cfg.paths.configFile, raw);
  for (const [dotted, value] of Object.entries(paths || {})) setPath(cfg, dotted, value);
  return raw;
}

function loadSettings(cfg) {
  return readJson(cfg.paths.settingsFile, {}) || {};
}

function saveSettings(cfg, patch) {
  const current = loadSettings(cfg);
  const next = { ...current, ...patch };
  const keys = { ...(current.keys || {}) };
  for (const [name, value] of Object.entries((patch && patch.keys) || {})) {
    if (name && value) keys[name] = String(value).trim();
  }
  const provider = String(next.provider || current.provider || cfg.llm.provider || '').trim();
  if (patch && patch.apiKey) {
    next.apiKey = String(patch.apiKey).trim();
    if (provider) keys[provider] = next.apiKey;
  } else if (provider && provider !== String(current.provider || '').trim()) {
    // 切换服务商时自动取这家之前存过的 Key，避免把智谱的 Key 拿去打 DeepSeek
    next.apiKey = keys[provider] || '';
  }
  if (Object.keys(keys).length) next.keys = keys;
  writeJsonAtomic(cfg.paths.settingsFile, next);
  return next;
}

function resolveRuntime(cfg) {
  const settings = loadSettings(cfg);
  const llmCfg = cfg.llm || {};
  const provider = String(settings.provider || llmCfg.provider || 'deepseek').trim();
  const preset = PROVIDERS[provider] || PROVIDERS.custom;
  const envKey = (cfg.env && cfg.env.DEEPSEEK_API_KEY) || '';
  const savedKeys = settings.keys || {};
  const apiKey = String(
    settings.apiKey || savedKeys[provider] || llmCfg.apiKey || envKey || ''
  ).trim();
  const baseUrl = String(settings.baseUrl || llmCfg.baseUrl || preset.baseUrl || '').trim();
  const model = String(settings.model || llmCfg.model || preset.model || '').trim();
  const local = isLocalUrl(baseUrl);
  const needsKey = provider === 'ollama' ? false : Boolean(preset.needsKey) && !local;
  const mock =
    typeof settings.mock === 'boolean' ? settings.mock : !apiKey && needsKey;
  const temperature = Math.max(
    0,
    Math.min(2, Number(typeof settings.temperature === 'number' ? settings.temperature : llmCfg.temperature) || 0.9)
  );
  return {
    settings,
    provider,
    preset,
    providerLabel: preset.label,
    apiKey,
    baseUrl,
    model,
    temperature,
    mock,
    needsKey,
    isLocal: local,
    timeoutMs: Number(llmCfg.timeoutMs) || 45000,
    maxTokens: Number(llmCfg.maxTokens) || 700,
    userName: String(settings.userName || cfg.persona.userName || '').trim(),
    personaId: String(settings.personaId || cfg.persona.id || 'whale').trim(),
    customPrompt: String(
      settings.personaCustomPrompt !== undefined ? settings.personaCustomPrompt : cfg.persona.customPrompt || ''
    ),
  };
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 10) return value.slice(0, 2) + '****';
  return `${value.slice(0, 5)}****${value.slice(-4)}`;
}

module.exports = {
  PROVIDERS,
  DEFAULT_CONFIG,
  loadConfig,
  ensureConfigFile,
  loadSettings,
  saveSettings,
  saveConfigPaths,
  resolveRuntime,
  maskKey,
  isLocalUrl,
  deepMerge,
  readJson,
  writeJsonAtomic,
  projectRoot,
};
