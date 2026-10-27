'use strict';

/**
 * 聊天编排：决定回不回、拼上下文、调用模型、切分多条消息、维护记忆。
 *
 * 网页聊天和微信桥接共用这一套逻辑，区别只在「回不回」的判断和输出方式：
 * 网页走流式，微信走一次性回复。
 */
const fs = require('node:fs');
const path = require('node:path');
const { LlmError } = require('./llm');
const {
  buildSystem,
  cleanReply,
  splitBubbles,
  shouldReply,
  mentionsName,
  timeLabel,
} = require('./persona');
const { demoReply, demoCare } = require('./demo');
const { linkNotes } = require('./links');
const { searchText } = require('./websearch');

const MEMORY_REMEMBER = /^(?:记住|记一下|帮我记住|别忘(?:了)?)[:：,，\s]*(.+)$/;
const MEMORY_FORGET = /^(?:忘掉|忘记|删掉|删除)(?:记忆)?[:：,，\s]*(.+)$/;
const MEMORY_LIST = /^(?:你记得什么|你记得啥|你的记忆|记忆列表|你还记得什么)[？?]?$/;
const SET_NAME = /^我叫\s*([^\s，。！？,.!?]{1,12})$/;

const FALLBACK_REPLY = '嗯，我在呢。刚才有点走神，你再说一遍？';

function sanitizeIncoming(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .trim()
    .slice(0, 2000);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Companion {
  constructor({ config, store, llm, logger, personas, personaStore, imagegen = null, now = () => new Date(), rng = Math.random }) {
    this.config = config;
    this.store = store;
    this.llm = llm;
    this.logger = logger;
    this.personas = personas || [];
    this.personaStore = personaStore || null;
    this.imagegen = imagegen;
    this.now = now;
    this.rng = rng;
    this.memoryBusy = new Set();
  }

  setPersonas(list) {
    this.personas = list || [];
  }

  get persona() {
    if (this.personaStore) return this.personaStore.get();
    const id = this.llm.runtime.personaId;
    return this.personas.find((p) => p.id === id) || this.personas[0] || {
      id: 'whale',
      name: this.config.persona.name || '鲸鱼娘',
      avatar: '鲸',
      color: '#2f6fb3',
      tagline: '',
      personality: [],
      speakingStyle: [],
      interests: [],
      boundaries: [],
      suggestions: [],
      greeting: '',
    };
  }

  /** 这个人是不是人设里配置的「主人」。网页端默认算，微信端按 wxid / 昵称匹配。 */
  isMaster(input, persona, channel) {
    const master = persona.master || {};
    if (!master.enabled) return false;
    if (channel === 'web') return true;
    const senderId = String(input.senderId || input.sender_id || '').trim();
    const senderName = String(input.senderName || input.nickname || '').trim();
    if (senderId && (master.wxids || []).some((id) => id && senderId.includes(String(id).trim()))) return true;
    if (senderName && (master.names || []).some((name) => name && senderName.includes(String(name).trim()))) {
      return true;
    }
    return false;
  }

  resolveSession({ channel = 'web', sessionId = '', chatId = '', chatType = 'private', title = '', senderName = '' }) {
    if (channel === 'wechat') {
      return this.store.ensure({
        channel: 'wechat',
        type: chatType === 'group' ? 'group' : 'private',
        chatId,
        title: title || (chatType === 'group' ? '微信群聊' : senderName ? `和${senderName}的聊天` : '微信聊天'),
      });
    }
    return this.store.getOrCreateWeb(sessionId);
  }

  /** 记忆类指令用固定回复更快也更准，不必每次都问模型。 */
  handleMemoryCommand(text, session, persona) {
    let match = text.match(MEMORY_REMEMBER);
    if (match) {
      const fact = match[1].trim().replace(/[。！!]+$/, '');
      if (!fact) return { reply: '要记什么呀？说清楚一点。' };
      const note = this.store.addNote(session.id, fact, 'user');
      if (!note) return { reply: '这件事我记得了，不用再记一遍。' };
      return { reply: `好，我记住了：${fact}` };
    }

    match = text.match(MEMORY_FORGET);
    if (match) {
      const removed = this.store.removeNoteByText(session.id, match[1].trim());
      return { reply: removed ? `好，我把「${removed.text}」忘了。` : '这条我没记过，或者已经忘了。' };
    }

    if (MEMORY_LIST.test(text)) {
      const notes = this.store.notes(session.id);
      if (!notes.length) return { reply: '现在还没记什么。你说「记住：…」，我就会记下来。' };
      return { reply: '我记得这些：\n' + notes.map((n) => `· ${n.text}`).join('\n') };
    }

    match = text.match(SET_NAME);
    if (match) {
      const name = match[1].trim();
      this.store.profile.userName = name;
      this.store.addNote(session.id, `对方叫${name}`, 'user');
      this.store.markDirty();
      return { reply: `好，${name}，我记住了。`, name };
    }

    return null;
  }

  buildTurns(session, { isGroup, historyTurns }) {
    const messages = session.messages.slice(-Math.max(2, historyTurns));
    const nameOf = (m) => String(m.name || '').trim();
    return messages
      .filter((m) => m && m.text)
      .map((m) => {
        if (isGroup && m.role === 'user') {
          const who = nameOf(m);
          return { role: 'user', content: who ? `${who}：${m.text}` : m.text };
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text };
      });
  }

  /**
   * 群聊里的「顺着接话」判断：不是只有 @ 和叫名字才回。
   * 规则尽量保守，避免刷屏：同一个人刚聊过、她刚回过且对方在说她、
   * 或者明显是在问「你 / 在吗 / 帮我」这类话。
   */
  contextTrigger(input, session, text, persona) {
    const chat = this.config.chat || {};
    if (chat.groupContextReply === false) return { reply: false, reason: 'context-off' };
    const now = Date.now();
    const meta = session.meta || {};
    const key = String(input.senderId || input.senderName || '');
    const value = String(text || '').trim();
    if (!value) return { reply: false, reason: 'empty' };
    if (mentionsName(value, persona)) return { reply: true, reason: 'name' };

    // 同一个人刚被她接过话，继续说就继续接
    if (meta.engagedBy && meta.engagedBy === key && Number(meta.engagedUntil) > now) {
      return { reply: true, reason: 'engaged' };
    }

    // 她刚回过，且这句话在说她 / 问她
    const last = [...session.messages].reverse().find((m) => m.role === 'assistant');
    const sinceLast = last ? now - Date.parse(last.ts) : Infinity;
    if (sinceLast < 120000 && /你|您|鲸|肥鱼|鱼片|在吗|人呢|不理|回我/.test(value)) {
      return { reply: true, reason: 'followup' };
    }

    // 群友在聊「你/我」这种带指向的话，多半是在跟她说话；用户明确要求「有关自己的都回」
    if (/你|您/.test(value) && /我|咱|老大|鲸|鱼/.test(value) && value.length >= 4) {
      return { reply: true, reason: 'context' };
    }

    // 明显在向她提问 / 求助，而不是群友之间聊天
    if (
      /^(在吗|在不在|人呢|理我|回我|帮我|问你|问你个事|你觉得|你说|怎么办|为啥|为什么|怎么|能不能|可不可以)/.test(
        value
      ) &&
      value.length >= 2
    ) {
      return { reply: true, reason: 'directed' };
    }

    return { reply: false, reason: 'group-silent' };
  }

  /**
   * 处理一条消息。
   * @returns {Promise<{action: 'reply'|'ignore'|'error', text?: string, bubbles?: string[], reason?: string, error?: string, sessionId: string}>}
   */
  async handle(input, { onDelta, signal } = {}) {
    const channel = input.channel === 'wechat' ? 'wechat' : 'web';
    const isGroup = input.chatType === 'group';
    const text = sanitizeIncoming(input.text);
    const persona = this.persona;
    const session = this.resolveSession({
      channel,
      sessionId: input.sessionId,
      chatId: input.chatId,
      chatType: input.chatType,
      title: input.title,
      senderName: input.senderName,
    });

    if (!text) return { action: 'ignore', reason: 'empty', sessionId: session.id };
    const startedAt = Date.now();
    session.meta = session.meta || {};
    session.meta.lastInboundAt = startedAt;
    this.store.markDirty();
    this.store.addMessage(session.id, {
      role: 'user',
      text,
      name: input.senderName || '',
      source: channel,
      hidden: /^（对方/.test(text) || /^（系统/.test(text),
    });

    // 「发张自拍」直接发人设自拍图，不让模型凭空生成别人的脸
    const selfieRe = /(?:发|来|给|看).{0,6}(?:自拍|照片|自画像)|你的(?:自拍|照片|样子)|看看你|长什么样/;
    if (selfieRe.test(text) && !(isGroup && !input.atMe)) {
      const root = (this.config.paths && this.config.paths.root) || process.cwd();
      const list = (persona.selfies || [])
        .map((p) => (path.isAbsolute(p) ? p : path.join(root, p)))
        .filter((p) => fs.existsSync(p));
      if (list.length) {
        const file = list[0];
        const name = path.basename(file);
        const said = '喏，我长这样。别盯着看太久啊。';
        this.store.addMessage(session.id, {
          role: 'assistant',
          text: said,
          source: channel,
          name: persona.name,
          images: [{ url: `/persona-image/${encodeURIComponent(name)}`, name }],
        });
        return {
          action: 'reply',
          text: said,
          bubbles: [said],
          images: [{ path: file, name, url: `/persona-image/${encodeURIComponent(name)}` }],
          reason: 'selfie',
          sessionId: session.id,
        };
      }
    }

    // 「画一张…」这类指令直接走生图，不让模型假装画
    const drawMatch = text.match(/(?:^|[\s，,。])(?:帮我|给我)?\s*(?:画|绘制|生成|来)\s*(?:一|两)?\s*(?:张|幅|个|只)?\s*([\s\S]{2,})$/);
    const drawPrompt = drawMatch ? drawMatch[1].trim() : '';
    if (drawPrompt) {
      if (!this.imagegen || !this.imagegen.ready) {
        const said = '想画可以呀，不过得先去网页 设置 → 生图 填一把 DashScope / 千问的 Key。';
        this.store.addMessage(session.id, { role: 'assistant', text: said, source: channel, name: persona.name });
        return { action: 'reply', text: said, bubbles: [said], reason: 'image-no-key', sessionId: session.id };
      }
      if (isGroup && !input.atMe) {
        return { action: 'ignore', reason: 'image-need-at', sessionId: session.id };
      }
      try {
        const img = await this.imagegen.generate(drawPrompt);
        const said = '画好了。';
        this.store.addMessage(session.id, {
          role: 'assistant',
          text: said,
          source: channel,
          name: persona.name,
          images: [{ url: img.url, name: img.name }],
        });
        return {
          action: 'reply',
          text: said,
          bubbles: [said],
          images: [{ path: img.file, name: img.name, url: img.url }],
          reason: 'image',
          sessionId: session.id,
        };
      } catch (err) {
        return { action: 'error', reason: 'imagegen', error: err && err.message ? err.message : '生图失败了。', sessionId: session.id };
      }
    }

    const decision = shouldReply({
      text,
      isGroup,
      atMe: Boolean(input.atMe),
      persona,
      config: this.config,
      rng: this.rng,
    });

    let reason = decision.reason;
    let reply = decision.reply;
    if (isGroup && !reply) {
      const ctx = this.contextTrigger(input, session, text, persona);
      if (ctx.reply) {
        reply = true;
        reason = ctx.reason;
      }
    }

    if (!reply) {
      // 群里没被叫到：只记录，不回
      return { action: 'ignore', reason, sessionId: session.id };
    }

    // 记下「这次接上了」，后面几分钟内同一人继续说，就顺着接
    const personKey = String(input.senderId || input.senderName || '');
    const engagedMinutes = Number((this.config.chat && this.config.chat.groupEngagedMinutes) || 6);
    session.meta = session.meta || {};
    session.meta.engagedBy = personKey;
    session.meta.engagedUntil = Date.now() + Math.max(1, engagedMinutes) * 60000;
    session.meta.lastReplyAt = new Date().toISOString();
    this.store.markDirty();

    const memory = this.handleMemoryCommand(text, session, persona);
    if (memory) {
      const clean = cleanReply(memory.reply, { name: persona.name });
      this.store.addMessage(session.id, { role: 'assistant', text: clean, source: channel });
      return {
        action: 'reply',
        text: clean,
        bubbles: splitBubbles(clean, {
          maxChars: isGroup ? persona.groupMaxChars : persona.privateMaxChars,
          maxBubbles: persona.maxBubbles,
        }),
        reason: 'memory',
        sessionId: session.id,
      };
    }

    const chat = this.config.chat || {};
    const runtime = this.llm.runtime;
    const userName = this.store.profile.userName || runtime.userName || (channel === 'wechat' ? input.senderName : '') || '';
    const isMaster = this.isMaster(input, persona, channel);

    // 没配 Key 时走演示回复，先把交互跑通，页面上会标明「演示模式」
    if (this.llm.isMock) {
      await new Promise((resolve) => setTimeout(resolve, onDelta ? 420 : 0));
      const demo = demoReply(text, { persona });
      if (onDelta) onDelta(demo.text);
      this.store.addMessage(session.id, { role: 'assistant', text: demo.text, source: 'demo', name: persona.name });
      return {
        action: 'reply',
        text: demo.text,
        bubbles: demo.bubbles,
        reason: 'demo',
        mock: true,
        sessionId: session.id,
      };
    }

    const notes = persona.links && (this.config.links ? this.config.links.enabled !== false : true)
      ? await linkNotes(text, { maxLinks: (this.config.links && this.config.links.maxLinks) || 2 })
      : [];
    const searchNotes = await this.maybeSearch(text, persona);

    const system = buildSystem({
      persona,
      config: this.config,
      runtime,
      isGroup,
      userName,
      speakerName: isGroup ? (input.senderName || '') : '',
      isMaster,
      notes: this.store.notes(session.id).map((n) => n.text),
      linkNotes: notes,
      searchNotes,
      now: this.now(),
    });
    const turns = this.buildTurns(session, {
      isGroup,
      historyTurns: isGroup ? persona.groupHistoryTurns : persona.historyTurns,
    });

    let full = '';
    try {
      if (onDelta) {
        for await (const piece of this.llm.stream({ system, turns, signal })) {
          full += piece;
          onDelta(piece);
        }
      } else {
        full = await this.llm.complete({ system, turns, signal });
      }
    } catch (err) {
      if (err && err.code === 'aborted') return { action: 'ignore', reason: 'aborted', sessionId: session.id };
      const message = err instanceof LlmError ? err.userMessage : '请求模型时出错了，稍后再试。';
      this.logger && this.logger.error('生成回复失败：' + ((err && (err.detail || err.message)) || err));
      return { action: 'error', reason: 'llm_error', error: message, sessionId: session.id };
    }

    // 生成期间同一会话又来了新消息：这条已经过时，别再发出去
    if (session.meta && Number(session.meta.lastInboundAt) > startedAt) {
      this.logger && this.logger.info(`回复被新消息打断，丢弃旧回复：${text.slice(0, 20)}`);
      return { action: 'ignore', reason: 'superseded', sessionId: session.id };
    }
    let clean = cleanReply(full, { name: persona.name });
    if (!clean) clean = FALLBACK_REPLY;
    const maxChars = isGroup ? persona.groupMaxChars : persona.privateMaxChars;
    const bubbles = splitBubbles(clean, {
      maxChars,
      maxBubbles: Math.max(1, Math.min(4, Number(persona.maxBubbles) || Number(chat.maxBubbles) || 3)),
    });
    const stored = bubbles.length ? bubbles.join('\n') : clean;
    this.store.addMessage(session.id, {
      role: 'assistant',
      text: stored,
      source: channel,
      name: persona.name,
    });
    this.maybeExtractMemory(session);

    return {
      action: 'reply',
      text: stored,
      bubbles: bubbles.length ? bubbles : [clean],
      reason,
      sessionId: session.id,
    };
  }

  /** 用户让她「搜一下 / 找个教程 / 视频链接」时，先替她查一眼。 */
  async maybeSearch(text, persona) {
    const web = this.config.websearch || {};
    if (web.enabled === false) return [];
    const value = String(text || '');
    const intent = /(?:搜|查|找).{0,12}(?:教程|视频|链接|资料|相关|一下)|教程|视频链接|搜一下|帮我搜|联网|网上查/.test(
      value
    );
    if (!intent) return [];
    let query = value
      .replace(/@\S+/g, ' ')
      .replace(/帮我搜一下|帮我搜|搜一下|查一下|找一下|你能|可以|能不能|给我|发个|分享一个?/g, ' ')
      .replace(new RegExp(persona.name, 'g'), ' ')
      .replace(/[？?。！!,，]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (query.length < 2) query = value.slice(0, 60);
    try {
      const results = await searchText(query, {
        limit: Math.max(1, Math.min(6, Number(web.maxResults) || 4)),
        timeoutMs: 6000,
      });
      if (!results) return [];
      return [results];
    } catch {
      return [];
    }
  }

  /** 每隔若干条消息，后台提炼长期记忆；失败就安静跳过，不影响聊天。 */
  maybeExtractMemory(session) {
    const memory = this.config.memory || {};
    if (!memory.autoExtract) return;
    if (this.memoryBusy.has(session.id)) return;
    if (session.notes.length >= (Number(memory.maxNotes) || 8)) return;
    const userTurns = session.messages.filter((m) => m.role === 'user').length;
    const every = Math.max(4, Number(memory.everyMessages) || 8);
    if (userTurns === 0 || userTurns % every !== 0) return;
    this.memoryBusy.add(session.id);
    const recent = session.messages
      .slice(-14)
      .map((m) => `${m.role === 'user' ? '对方' : '我'}：${m.text}`)
      .join('\n');
    const system = [
      '你是记忆整理助手。从聊天记录里提取「关于对方」的、长期稳定的信息，供以后聊天时参考。',
      '只提取：称呼、居住城市、工作/学业、家人或重要关系、长期喜好和厌恶、重要日期、明确的长期计划。',
      '不要提取：一次性的情绪、当下的天气、临时安排、猜测和评价。',
      '输出 JSON 数组，每项一句话（不超过 30 字，以「对方」开头），最多 2 项。没有值得记的就输出 []。',
      '不要输出解释，不要 Markdown。',
    ].join('\n');
    Promise.resolve()
      .then(() =>
        this.llm.complete({
          system,
          turns: [{ role: 'user', content: recent }],
          maxTokens: 180,
        })
      )
      .then((raw) => {
        const match = String(raw || '').match(/\[[\s\S]*\]/);
        if (!match) return;
        const items = JSON.parse(match[0]);
        if (!Array.isArray(items)) return;
        for (const item of items.slice(0, 2)) {
          const fact = String(item || '').trim().replace(/\s+/g, ' ');
          if (fact.length < 4 || fact.length > 60) continue;
          if (session.notes.length >= (Number(memory.maxNotes) || 8)) break;
          const duplicated = session.notes.some(
            (n) => n.text === fact || n.text.includes(fact.slice(0, 8)) || fact.includes(n.text.slice(0, 8))
          );
          if (duplicated) continue;
          this.store.addNote(session.id, fact, 'auto');
        }
      })
      .catch((err) => this.logger && this.logger.debug('自动记忆跳过：' + (err && err.message)))
      .finally(() => this.memoryBusy.delete(session.id));
  }

  /** 主动搭话：挑一句自然、不带压力的开场。 */
  async careMessage(session, { signal } = {}) {
    const persona = this.persona;
    const chat = this.config.chat || {};
    if (this.llm.isMock) {
      const bubbles = demoCare();
      const text = bubbles.join('\n');
      this.store.addMessage(session.id, { role: 'assistant', text, source: 'care', name: persona.name });
      return text;
    }
    const system = buildSystem({
      persona,
      config: this.config,
      runtime: this.llm.runtime,
      isGroup: false,
      userName: this.store.profile.userName || this.llm.runtime.userName || '',
      isMaster: Boolean(persona.master && persona.master.enabled),
      notes: this.store.notes(session.id).map((n) => n.text),
      now: this.now(),
    });
    const lastOwn = session.messages
      .filter((m) => m.role === 'assistant')
      .slice(-3)
      .map((m) => m.text)
      .join(' / ');
    const task = [
      '',
      '【现在不是回复，而是你先开口找对方说话】',
      `- 现在是${timeLabel(this.now())}，你想主动问候一下。`,
      lastOwn ? `- 你最近说过：${lastOwn}。这次换个说法，别重复。` : '',
      '- 一句话就够，最多两条；不要质问对方为什么不回，不要连续追问，不要卖惨。',
      '- 可以顺着你们之前聊过的事问一句，也可以只是很轻地打个招呼。',
      '- 只输出消息本身。',
    ]
      .filter(Boolean)
      .join('\n');
    const raw = await this.llm.complete({
      system: system + '\n' + task,
      turns: [{ role: 'user', content: '（现在是我主动找你的时候，发一句吧）' }],
      maxTokens: 120,
      signal,
    });
    const clean = cleanReply(raw, { name: persona.name });
    const bubbles = splitBubbles(clean, {
      maxChars: persona.privateMaxChars,
      maxBubbles: 2,
    });
    const text = bubbles.join('\n');
    if (text) {
      this.store.addMessage(session.id, { role: 'assistant', text, source: 'care', name: persona.name });
    }
    return text;
  }
}

module.exports = { Companion, sanitizeIncoming, MEMORY_REMEMBER, MEMORY_FORGET, MEMORY_LIST, SET_NAME };
