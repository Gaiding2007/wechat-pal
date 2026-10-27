'use strict';

/**
 * 人设系统。
 *
 * 一套人设 = 一个 JSON（personas/*.json 是内置预设，data/persona.json 是当前生效的那份）。
 * 这里只负责：读入并补全字段、拼系统提示词、清洗和切分模型输出。
 * 「回不回」的判断也在这里，网页聊天和微信桥接共用。
 */
const fs = require('node:fs');
const path = require('node:path');

const STYLE_PRESETS = {
  default: { label: '按上面的性格自然说话', text: '' },
  gentle: {
    label: '温柔、慢一点',
    text: '语气放软，不急，不抢话；先接住对方的情绪，再说自己的看法。',
  },
  tsundere: {
    label: '傲娇、嘴硬心软',
    text: '嘴上不饶人，先别扭一下再好好回答；被夸会嘴硬，但心里受用；不刻薄，不拿对方的痛处开玩笑。',
  },
  tieba: {
    label: '贴吧腔、爱抬杠',
    text: '像在回帖：短、冲、带梗，先来一句「典」或「就这」，再给正经建议；见好就收，不追着人咬。',
  },
  calm: { label: '安静、有分寸', text: '话不多，句子短，不追问；对方不想说就不勉强。' },
  playful: {
    label: '活泼、爱逗',
    text: '语气轻快，爱接话、爱开玩笑，但不拿对方在意的事开玩笑。',
  },
};

const EMOJI_RULES = [
  '不用 emoji，也不用颜文字。',
  'emoji 很少用，整段最多一个，不要堆。',
  '偶尔带一个 emoji，一句最多一个。',
  '可以多用一点 emoji，但别刷屏。',
];

const PERSONALITY_MAX = 12;
const TAG_MAX = 24;

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function stringList(value, max = 20) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\n,，、;；]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const cleaned = text(item).replace(/^[-*·]\s*/, '').slice(0, TAG_MAX * 3);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeMaster(raw) {
  const source = isPlain(raw) ? raw : {};
  return {
    enabled: Boolean(source.enabled),
    title: text(source.title, '主人').slice(0, 12) || '主人',
    names: stringList(source.names, 10),
    wxids: stringList(source.wxids, 20),
  };
}

/** 任意来源（预设文件、导入的 JSON、网页提交）→ 完整、可安全使用的对象。 */
function normalizePersona(raw, file = '') {
  const source = isPlain(raw) ? raw : {};
  const fallbackName = path.basename(file, '.json') || '伴侣';
  const name = text(source.name, fallbackName).slice(0, 24) || fallbackName;
  const id =
    (text(source.id) || path.basename(file, '.json') || name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'persona';
  const stylePreset = STYLE_PRESETS[text(source.stylePreset)] ? text(source.stylePreset) : 'default';

  return {
    id,
    name,
    aliases: stringList(source.aliases, 12).length ? stringList(source.aliases, 12) : [name],
    avatar: text(source.avatar, name.slice(0, 1)).slice(0, 2) || name.slice(0, 1),
    avatarImage: text(source.avatarImage).slice(0, 200),
    color: /^#[0-9a-f]{6}$/i.test(text(source.color)) ? text(source.color) : '#2f6fb3',
    tagline: text(source.tagline).slice(0, 60),
    age: text(source.age).slice(0, 40),
    identity: text(source.identity).slice(0, 120),
    appearance: text(source.appearance).slice(0, 300),
    background: text(source.background).slice(0, 800),
    personality: stringList(source.personality, PERSONALITY_MAX),
    speakingStyle: stringList(source.speakingStyle, PERSONALITY_MAX),
    interests: stringList(source.interests, PERSONALITY_MAX),
    boundaries: stringList(source.boundaries, PERSONALITY_MAX),
    greeting: text(source.greeting).slice(0, 80),
    suggestions: stringList(source.suggestions, 3),
    selfies: stringList(source.selfies, 8),
    stylePreset,
    styleText: text(source.styleText).slice(0, 800),
    emojiLevel: clampInt(source.emojiLevel, 0, 3, 2),
    emotions: source.emotions !== false,
    proactive: Boolean(source.proactive),
    opinions: source.opinions !== false,
    links: source.links !== false,
    privateMaxChars: clampInt(source.privateMaxChars, 40, 300, 140),
    groupMaxChars: clampInt(source.groupMaxChars, 30, 200, 70),
    maxBubbles: clampInt(source.maxBubbles, 1, 4, 3),
    historyTurns: clampInt(source.historyTurns, 4, 80, 20),
    groupHistoryTurns: clampInt(source.groupHistoryTurns, 2, 60, 12),
    master: normalizeMaster(source.master),
    systemPrompt: text(source.systemPrompt).slice(0, 2000),
    customPrompt: text(source.customPrompt).slice(0, 1000),
    source: text(source.source, file ? 'preset' : 'custom'),
    presetId: text(source.presetId).slice(0, 32),
    file: file || '',
  };
}

function loadPersonas(dir, logger) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json'));
  } catch (err) {
    logger && logger.warn('读取人设目录失败：' + err.message);
    return [];
  }
  const list = [];
  for (const name of files.sort()) {
    const file = path.join(dir, name);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const persona = normalizePersona(raw, file);
      persona.source = 'preset';
      list.push(persona);
    } catch (err) {
      logger && logger.warn(`人设 ${name} 读取失败：${err.message}`);
    }
  }
  return list;
}

function findPersona(list, id) {
  const target = text(id);
  if (!target) return list[0] || null;
  return list.find((p) => p.id === target) || list.find((p) => p.name === target) || list[0] || null;
}

function publicPersona(persona) {
  if (!persona) return null;
  const keys = [
    'id',
    'name',
    'aliases',
    'avatar',
    'avatarImage',
    'color',
    'tagline',
    'age',
    'identity',
    'appearance',
    'background',
    'personality',
    'speakingStyle',
    'interests',
    'boundaries',
    'greeting',
    'suggestions',
    'selfies',
    'stylePreset',
    'styleText',
    'emojiLevel',
    'emotions',
    'proactive',
    'opinions',
    'links',
    'privateMaxChars',
    'groupMaxChars',
    'maxBubbles',
    'historyTurns',
    'groupHistoryTurns',
    'master',
    'systemPrompt',
    'customPrompt',
  ];
  const out = {};
  for (const key of keys) out[key] = persona[key];
  return out;
}

function timeLabel(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function partOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour < 6) return '凌晨';
  if (hour < 9) return '清晨';
  if (hour < 12) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

function dateLabel(date = new Date()) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日，星期${week}`;
}

/** 拼系统提示词。人设只描述「她是谁」，规则和边界写死在这里。 */
function buildSystem({
  persona,
  config = {},
  runtime = {},
  isGroup = false,
  userName = '',
  speakerName = '',
  isMaster = false,
  notes = [],
  linkNotes = [],
  searchNotes = [],
  now = new Date(),
}) {
  const chat = config.chat || {};
  const lines = [];
  const style = STYLE_PRESETS[persona.stylePreset] || STYLE_PRESETS.default;
  const maxBubbles = persona.maxBubbles || chat.maxBubbles || 3;
  const totalChars = isGroup
    ? persona.groupMaxChars || chat.groupMaxChars || 70
    : persona.privateMaxChars || chat.privateMaxChars || 140;
  const perLine = Math.max(24, Math.min(60, Math.round(totalChars / Math.max(1, Math.min(2, maxBubbles)))));

  lines.push(
    `你在微信上和一个${isMaster ? persona.master.title || '重要的人' : '朋友'}聊天，你是「${persona.name}」。`
  );
  lines.push('');
  lines.push('【关于你】');
  if (persona.age) lines.push(`- 年龄：${persona.age}`);
  if (persona.identity) lines.push(`- 身份：${persona.identity}`);
  if (persona.appearance) lines.push(`- 外貌：${persona.appearance}`);
  if (persona.background) lines.push(`- 经历：${persona.background}`);
  const otherNames = persona.aliases.filter((a) => a !== persona.name);
  if (otherNames.length) lines.push(`- 别人也会叫我：${otherNames.join('、')}`);
  if (!persona.age && !persona.identity && !persona.background) {
    lines.push(`- ${persona.tagline || '一个普通人。'}`);
  }

  if (persona.personality.length) {
    lines.push('');
    lines.push('【性格】');
    lines.push(persona.personality.join('、') + '。');
  }

  lines.push('');
  lines.push('【说话方式】');
  lines.push('- 像在微信上聊天：短句、口语，别写作文，别用 Markdown、列表、标题。');
  lines.push('- 不用「（微笑）」「（拍拍你）」这类括号动作来表演，也不用旁白解释自己在干什么。');
  lines.push('- 不主动提自己是 AI、模型、程序；被直接问到就照实说，但不反复强调。');
  lines.push('- 不重复上一句的开头，不每句都叫对方名字。');
  for (const item of persona.speakingStyle) lines.push(`- ${item}`);
  if (style.text) lines.push(`- ${style.text}`);
  if (persona.styleText) lines.push(`- ${persona.styleText}`);
  lines.push(`- ${EMOJI_RULES[persona.emojiLevel] || EMOJI_RULES[1]}`);
  if (persona.proactive) {
    lines.push('- 偶尔可以先在括号里写一句很短的内心话，再开口；一次回复最多一句，不滥用。');
  }
  if (persona.emotions) {
    lines.push('- 你是有情绪的：会高兴、会烦、会不好意思，但不会歇斯底里，也不会一直卖惨。');
  }
  if (persona.opinions) {
    lines.push('- 对事情有自己的看法，可以直说喜欢或不喜欢，也可以不同意对方；不同意不等于刻薄。');
  }

  lines.push('');
  lines.push('【怎么和对方相处】');
  lines.push('- 先接住对方的话和情绪，再回应；对方只是随口一说时，不用硬给建议。');
  lines.push('- 不用命令口气，不说「你必须」「你应该」，也不用「为你好」压人。');
  lines.push('- 不知道的事就说不知道，不编经历、不编数据、不假装记得没发生过的事。');
  lines.push('- 对方认真求助时，先给一个能马上做的小步骤；对方不想聊时，不追问。');
  if (isMaster) {
    lines.push(
      `- 对方是你的${persona.master.title || '主人'}。你可以比平时更放松、更听话一点，但不要失去自己的判断，也不要越过下面的边界。`
    );
  } else if (userName) {
    lines.push(`- 对方希望你叫他「${userName}」，但不用每句都叫。`);
  }

  lines.push('');
  lines.push('【边界】');
  lines.push('- 不假装真人身份去骗人，不冒充官方，不承诺自己做不到的事。');
  lines.push('- 不替对方做重大决定（分手、辞职、借钱、投资），可以帮着把利弊说清楚。');
  lines.push('- 对方提到自伤、伤人、被侵害时，认真对待，建议找身边信任的人或专业帮助；不提供危险步骤。');
  lines.push('- 不接低俗、羞辱、歧视性的玩笑；遇到就平静地说不接，然后换个话题。');
  for (const item of persona.boundaries) lines.push(`- ${item}`);

  lines.push('');
  lines.push('【现在】');
  lines.push(`- 时间：${dateLabel(now)} ${timeLabel(now)}（${partOfDay(now)}）`);
  if (isGroup) {
    lines.push('- 场景：一个微信群里。群里可能有好几个人。');
    const who = speakerName || userName;
    if (who) {
      lines.push(`- 最后这句话是「${who}」说的。只回 ${who}，不要把别人的话当成 ${who} 说的，也不要替别人回答。`);
      lines.push(`- 如果 ${who} 在说别人的事（比如「老大说了什么」），就顺着回应 ${who}；需要另一个人来解释时，可以说「这你得问他」。`);
      lines.push('- 如果对方问的是「老大/别人说了什么、怎么想」，而你没在场、也不知道细节，不要替别人编，也不要猜，更不要让对方截图或复述；直接说「这是老大说的，你去问他准」。');
      lines.push('- 例子：对方说「老大刚才说的那个方案你觉得行吗？」→ 你回「这是老大说的，你去问他准，我可不敢替他拿主意。」');
    } else {
      lines.push('- 只回最后说话的那个人，不要把几个人的话混成一个人说的。');
    }
    if (chat.groupRequireAt) lines.push('- 这次已经是在跟你说话，直接接话，不用再等 @。');
  } else {
    lines.push('- 场景：一对一私聊。');
  }
  if (userName) lines.push(`- 对方：${userName}`);
  if (isMaster) lines.push(`- 对方是你的${persona.master.title || '主人'}。`);

  if (notes.length) {
    lines.push('');
    lines.push('【你记得的事】');
    for (const note of notes.slice(-10)) lines.push(`- ${note}`);
  }
  if (linkNotes.length) {
    lines.push('');
    lines.push('【对方刚发的链接】');
    for (const item of linkNotes) lines.push(`- ${item}`);
    lines.push('可以在回复里自然提一句，但不要复述整段摘要。');
  }
  if (searchNotes.length) {
    lines.push('');
    lines.push('【网上搜到的（刚查的，可以引用标题和链接）】');
    for (const item of searchNotes) lines.push(item);
    lines.push('- 如果里面有视频链接，可以直接把链接发过去，再补一句你看到的感觉。');
  }
  if (persona.systemPrompt) {
    lines.push('');
    lines.push('【人设补充】');
    lines.push(persona.systemPrompt);
  }
  if (persona.customPrompt) {
    lines.push('');
    lines.push('【额外约定】');
    lines.push(persona.customPrompt);
  }
  if (runtime && runtime.extraSystem) {
    lines.push('');
    lines.push(runtime.extraSystem);
  }

  lines.push('');
  lines.push('【这次回复】');
  lines.push('- 只输出你要发出去的消息本身，不要解释、不要加引号、不要写「我：」。');
  lines.push(
    `- 拆成 1 到 ${maxBubbles} 条短消息，每条单独一行；每条尽量不超过 ${perLine} 字，整段不超过 ${totalChars} 字。`
  );
  lines.push('- 想不出说什么就简短接一句，不要为了凑字数硬聊。');

  return lines.join('\n');
}

/** 清掉模型偶尔带出来的格式噪音，保留正常的标点和换行。 */
function cleanReply(input, { name = '' } = {}) {
  let value = String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .trim();

  const prefix = name ? new RegExp(`^\\s*(?:我|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*[:：]\\s*`) : /^\s*我\s*[:：]\s*/;
  value = value
    .split('\n')
    .map((line) => line.replace(prefix, '').replace(/^["“「『'](.*)["”」』']$/, '$1').trim())
    .filter((line) => line && !/^[（(]?(?:注|说明|解释)[）)]?[:：]/.test(line))
    .join('\n');

  return value.replace(/\n{3,}/g, '\n\n').trim();
}

/** 按行和标点切成几条，尽量不把一句话切成两半。 */
function splitBubbles(input, { maxChars = 70, maxBubbles = 3 } = {}) {
  const limit = Math.max(20, Number(maxChars) || 70);
  const count = Math.max(1, Math.min(6, Number(maxBubbles) || 3));
  const textValue = String(input || '').trim();
  if (!textValue) return [];

  // 一条换行 = 一个气泡，这是模型最明确的分条信号，不要擅自合并；
  // 只有单行太长时才按句号/问号拆开，再按字数攒回若干条。
  const bubbles = [];
  for (const rawLine of textValue.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= limit) {
      bubbles.push(line);
      continue;
    }
    const sentences = line.match(/[^。！？!?…~～;；]+[。！？!?…~～;；]*/g) || [line];
    let buffer = '';
    for (const part of sentences) {
      const sentence = part.trim();
      if (!sentence) continue;
      if (!buffer) {
        buffer = sentence;
      } else if (buffer.length + sentence.length <= limit) {
        buffer += sentence;
      } else {
        bubbles.push(buffer);
        buffer = sentence;
      }
    }
    if (buffer) bubbles.push(buffer);
  }

  if (bubbles.length > count) {
    const head = bubbles.slice(0, count - 1);
    head.push(bubbles.slice(count - 1).join(''));
    return head.map((b) => b.trim()).filter(Boolean);
  }
  return bubbles.map((b) => b.trim()).filter(Boolean);
}

function mentionsName(textValue, persona) {
  const value = String(textValue || '');
  if (!value) return false;
  const names = [persona.name, ...(persona.aliases || [])].filter(Boolean);
  return names.some((name) => value.includes(name));
}

/** 回不回这条消息。群里没被叫到就不烧 token。 */
function shouldReply({ text: textValue, isGroup = false, atMe = false, persona, config = {}, rng = Math.random }) {
  if (!isGroup) return { reply: true, reason: 'private' };
  if (atMe) return { reply: true, reason: 'at' };
  if (persona && mentionsName(textValue, persona)) return { reply: true, reason: 'name' };
  const chat = config.chat || {};
  const chance = Math.max(0, Math.min(100, Number(chat.groupFreeChatChance) || 0));
  if (chance && rng() * 100 < chance) return { reply: true, reason: 'chance' };
  return { reply: false, reason: 'group-silent' };
}

function greetingFor(persona, now = new Date()) {
  if (!persona) return '';
  if (persona.greeting) return persona.greeting;
  const hour = now.getHours();
  if (hour < 6) return '还没睡？';
  if (hour < 11) return '早，今天怎么样？';
  if (hour < 14) return '吃了吗？';
  if (hour < 18) return '下午好。';
  if (hour < 23) return '在呢，今天过得怎么样？';
  return '这么晚了，还不睡？';
}

module.exports = {
  STYLE_PRESETS,
  loadPersonas,
  normalizePersona,
  findPersona,
  buildSystem,
  cleanReply,
  splitBubbles,
  mentionsName,
  shouldReply,
  greetingFor,
  publicPersona,
  timeLabel,
  partOfDay,
  dateLabel,
};
