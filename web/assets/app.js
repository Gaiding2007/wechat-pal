'use strict';

/**
 * 微信聊天伴侣 · 前端
 * 原生 JS，无框架。所有渲染都走 DOM API，避免把聊天内容当 HTML 拼。
 */
(() => {
  // ---------- 状态 ----------
  const S = {
    status: null,
    persona: { name: '鲸鱼娘', avatar: '鲸', greeting: '', tagline: '', suggestions: [] },
    personas: [],
    sessions: [],
    session: null,
    currentId: null,
    settings: null,
    notes: [],
    streaming: false,
    mock: true,
    lastText: '',
    lastDividerTs: 0,
  };

  // ---------- 元素 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const els = {
    side: $('#side'),
    scrim: $('#scrim'),
    sessionList: $('#sessionList'),
    btnNew: $('#btnNew'),
    btnSettings: $('#btnSettings'),
    btnSettings2: $('#btnSettings2'),
    btnMemory: $('#btnMemory'),
    btnClear: $('#btnClear'),
    btnSide: $('#btnSide'),
    peerName: $('#peerName'),
    peerAvatar: $('#peerAvatar'),
    peerStatus: $('#peerStatus'),
    peerDot: $('#peerDot'),
    modeBadge: $('#modeBadge'),
    banner: $('#banner'),
    bannerText: $('#bannerText'),
    bannerBtn: $('#bannerBtn'),
    stream: $('#stream'),
    thread: $('#thread'),
    input: $('#input'),
    btnSend: $('#btnSend'),
    drawer: $('#drawer'),
    drawerBody: $('#drawerBody'),
    btnCloseDrawer: $('#btnCloseDrawer'),
    toast: $('#toast'),
    // 设置表单
    fProvider: $('#fProvider'),
    providerHint: $('#providerHint'),
    fKey: $('#fKey'),
    keyTip: $('#keyTip'),
    fBase: $('#fBase'),
    fModel: $('#fModel'),
    modelList: $('#modelList'),
    fTemp: $('#fTemp'),
    tempVal: $('#tempVal'),
    fUserName: $('#fUserName'),
    fCustom: $('#fCustom'),
    fVisionKey: $('#fVisionKey'),
    visionKeyTip: $('#visionKeyTip'),
    fStickerShot: $('#fStickerShot'),
    fEmoji: $('#fEmoji'),
    fImagegen: $('#fImagegen'),
    fImagegenKey: $('#fImagegenKey'),
    imagegenKeyTip: $('#imagegenKeyTip'),
    fImagegenBase: $('#fImagegenBase'),
    fImagegenModel: $('#fImagegenModel'),
    fVoice: $('#fVoice'),
    fVoiceKey: $('#fVoiceKey'),
    voiceKeyTip: $('#voiceKeyTip'),
    fVoiceBase: $('#fVoiceBase'),
    fVoiceModel: $('#fVoiceModel'),
    fDbDir: $('#fDbDir'),
    fBridge: $('#fBridge'),
    fCare: $('#fCare'),
    fRequireAt: $('#fRequireAt'),
    fFreeChat: $('#fFreeChat'),
    fChance: $('#fChance'),
    fCooldown: $('#fCooldown'),
    fEngaged: $('#fEngaged'),
    fSilent: $('#fSilent'),
    fMute: $('#fMute'),
    fMuted: $('#fMuted'),
    fLinks: $('#fLinks'),
    fShare: $('#fShare'),
    btnEditPersona: $('#btnEditPersona'),
    bridgeDot: $('#bridgeDot'),
    bridgeState: $('#bridgeState'),
    bridgeHint: $('#bridgeHint'),
    bridgeToken: $('#bridgeToken'),
    btnCopyToken: $('#btnCopyToken'),
    ffmpegState: $('#ffmpegState'),
    btnInstallFfmpeg: $('#btnInstallFfmpeg'),
    btnSave: $('#btnSave'),
    btnTest: $('#btnTest'),
    btnClearKey: $('#btnClearKey'),
    testResult: $('#testResult'),
    personaList: $('#personaList'),
    noteList: $('#noteList'),
    fNote: $('#fNote'),
    btnAddNote: $('#btnAddNote'),
    btnWipe: $('#btnWipe'),
  };

  let overlaySide = false;
  let drawerOpen = false;
  let toastTimer = 0;
  let pendingRow = null;
  let typingRow = null;

  // ---------- 小工具 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function dividerLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    if (dayKey(d) === dayKey(now)) return `今天 ${clock(d)}`;
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(yest)) return `昨天 ${clock(d)}`;
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock(d)}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function sessionTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    if (dayKey(d) === dayKey(now)) return clock(d);
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(yest)) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function icon(id, cls = 'ico') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  function toast(message, ms = 2200) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  async function api(path, { method = 'GET', body, signal } = {}) {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
    if (!res.ok || (data && data.ok === false)) {
      throw new Error((data && (data.error || data.message)) || `请求失败（${res.status}）`);
    }
    return data;
  }

  function nearBottom() {
    const s = els.stream;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
  }

  function scrollBottom({ smooth = false, force = false } = {}) {
    if (!force && !nearBottom()) return;
    els.stream.scrollTo({ top: els.stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------- 顶部/品牌 ----------
  function renderChrome() {
    const p = S.persona || {};
    const llm = (S.status && S.status.llm) || {};
    els.peerName.textContent = p.name || '聊天伴侣';
    const avImg = String(p.avatarImage || '').trim();
    if (avImg) {
      els.peerAvatar.textContent = '';
      els.peerAvatar.classList.add('has-image');
      els.peerAvatar.style.backgroundColor = p.color || '';
      els.peerAvatar.style.backgroundImage = 'url("' + avImg.replace(/"/g, '') + '")';
      els.peerAvatar.style.backgroundSize = '125%';
      els.peerAvatar.style.backgroundPosition = 'center 24%';
      els.peerAvatar.style.color = 'transparent';
    } else {
      els.peerAvatar.textContent = p.avatar || (p.name || '伴').slice(0, 1);
      els.peerAvatar.classList.remove('has-image');
      els.peerAvatar.style.backgroundImage = '';
      els.peerAvatar.style.background = p.color || '';
      els.peerAvatar.style.color = p.color ? '#fff' : '';
    }

    const isMock = Boolean(llm.mock);
    S.mock = isMock;
    els.peerDot.classList.toggle('on', !isMock);
    els.peerStatus.textContent = isMock
      ? '演示模式 · 还没有连接模型'
      : `${llm.providerLabel || '模型'} · ${llm.model || '默认'}`;
    els.modeBadge.textContent = isMock ? '演示模式' : '模型在线';
    els.modeBadge.classList.toggle('live', !isMock);
    els.banner.hidden = !isMock;
    if (isMock) {
      els.bannerText.textContent = llm.needsKey
        ? '还没有连接模型，先用演示回复走通流程。填上 API Key 就能真的聊起来。'
        : '现在是演示模式。在设置里关掉演示模式，就会用真实模型回复。';
    }
    document.title = `${p.name || '微信聊天伴侣'} · 微信聊天伴侣`;
    els.btnClear.disabled = !S.session || !S.session.messages.length;
  }

  // ---------- 会话列表 ----------
  function renderSessions() {
    els.sessionList.replaceChildren();
    if (!S.sessions.length) {
      const empty = el('div', 'list-empty');
      empty.append('还没有对话。');
      empty.append(document.createElement('br'));
      empty.append('点上面的「新对话」开始。');
      els.sessionList.append(empty);
      return;
    }
    for (const s of S.sessions) {
      const item = el('button', 'session' + (s.id === S.currentId ? ' active' : ''));
      item.type = 'button';
      item.setAttribute('role', 'listitem');
      if (s.id === S.currentId) item.setAttribute('aria-current', 'true');

      const title = el('span', 't', s.title || '新对话');
      const meta = el('span', 'meta');
      const time = el('span', 'time', sessionTime(s.updatedAt));
      meta.append(time);
      if (s.channel === 'wechat') meta.append(el('span', 'tag', '微信'));

      const del = el('span', 'del');
      del.setAttribute('role', 'button');
      del.setAttribute('tabindex', '0');
      del.setAttribute('aria-label', '删除对话');
      del.append(icon('i-trash'));
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeSession(s);
      });
      del.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          removeSession(s);
        }
      });

      item.append(title, meta, del);
      item.addEventListener('click', () => openSession(s.id));
      els.sessionList.append(item);
    }
  }

  async function refreshSessions() {
    const data = await api('/api/sessions');
    S.sessions = data.sessions || [];
    renderSessions();
  }

  async function openSession(id) {
    if (S.streaming) {
      toast('等它说完这句再换吧');
      return;
    }
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(id)}`);
      S.session = data.session;
      S.currentId = id;
      renderMessages();
      renderSessions();
      renderChrome();
      closeSide();
      els.stream.scrollTop = els.stream.scrollHeight;
      els.input.focus();
    } catch (err) {
      toast(err.message);
      await refreshSessions();
    }
  }

  async function newSession() {
    if (S.session && !S.session.messages.length) {
      els.input.focus();
      toast('已经在新的对话里了');
      return;
    }
    try {
      const data = await api('/api/sessions', { method: 'POST', body: {} });
      await refreshSessions();
      await openSession(data.session.id);
    } catch (err) {
      toast(err.message);
    }
  }

  async function removeSession(s) {
    const label = s.title || '这段对话';
    if (!window.confirm(`删除「${label}」？聊天记录和记忆都会一起删掉。`)) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (S.currentId === s.id) {
        S.session = null;
        S.currentId = null;
        renderMessages();
      }
      await refreshSessions();
      renderChrome();
      toast('已删除');
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- 消息渲染 ----------
  function appendDivider(iso) {
    const row = el('div', 'divider');
    row.textContent = dividerLabel(iso);
    els.thread.append(row);
  }

  function maybeDivider(iso) {
    const ts = new Date(iso).getTime() || Date.now();
    const gap = ts - S.lastDividerTs;
    const newDay = !S.lastDividerTs || dayKey(new Date(ts)) !== dayKey(new Date(S.lastDividerTs));
    if (!S.lastDividerTs || newDay || gap > 12 * 60 * 1000) {
      appendDivider(iso);
      S.lastDividerTs = ts;
    }
  }

  function appendUser(text) {
    const row = el('div', 'msg user');
    row.append(el('div', 'bubble', text));
    els.thread.append(row);
  }

  function appendBotLines(lines) {
    for (const line of lines) {
      if (!line) continue;
      const row = el('div', 'msg bot');
      row.append(el('div', 'bubble', line));
      els.thread.append(row);
    }
  }

  function appendBotImages(images) {
    for (const it of images || []) {
      const src = it && (it.url || it.path);
      if (!src) continue;
      const row = el('div', 'msg bot');
      const bubble = el('div', 'bubble image-bubble');
      const img = el('img');
      img.src = src;
      img.alt = (it && it.name) || '生成的图片';
      img.loading = 'lazy';
      bubble.append(img);
      row.append(bubble);
      els.thread.append(row);
    }
  }

  function splitLines(text) {
    return String(text || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function renderWelcome() {
    const p = S.persona || {};
    const wrap = el('div', 'welcome');
    const avatar = el('div', 'big-avatar', p.avatarImage ? '' : (p.avatar || (p.name || '伴').slice(0, 1)));
    if (p.avatarImage) {
      avatar.classList.add('has-image');
      avatar.style.backgroundImage = 'url("' + String(p.avatarImage).replace(/"/g, '') + '")';
      avatar.style.backgroundSize = '125%';
      avatar.style.backgroundPosition = 'center 18%';
      avatar.style.backgroundColor = p.color || '';
    } else if (p.color) {
      avatar.style.background = p.color;
      avatar.style.color = '#fff';
    }
    const name = el('h2', null, p.name || '微信聊天伴侣');
    const tagline = el('p', 'tagline', p.tagline || '一个愿意听你说话的朋友');
    const greeting = el('p', 'greeting', p.greeting || '在呢，今天怎么样？');
    wrap.append(avatar, name, tagline, greeting);

    const suggestions = Array.isArray(p.suggestions) && p.suggestions.length
      ? p.suggestions.slice(0, 3)
      : ['今天有点累', '想找人说说话', '最近有点迷茫'];
    const chips = el('div', 'chips');
    for (const text of suggestions) {
      const chip = el('button', 'chip', text);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        els.input.value = text;
        autoGrow();
        updateSendState();
        send();
      });
      chips.append(chip);
    }
    wrap.append(chips);
    els.thread.append(wrap);
  }

  function renderMessages() {
    els.thread.replaceChildren();
    els.thread.classList.remove('center');
    if (!S.session || !S.session.messages.length) {
      els.thread.classList.add('center');
      renderWelcome();
      els.stream.scrollTop = 0;
      renderChrome();
      return;
    }
    S.lastDividerTs = 0;
    for (const m of S.session.messages) {
      maybeDivider(m.ts);
      if (m.role === 'user') appendUser(m.text);
      else {
        appendBotLines(splitLines(m.text));
        if (m.images) appendBotImages(m.images);
      }
    }
    els.stream.scrollTop = els.stream.scrollHeight;
    renderChrome();
  }

  function ensureTyping() {
    if (typingRow) return;
    typingRow = el('div', 'msg bot');
    const bubble = el('div', 'bubble typing-bubble');
    for (let i = 0; i < 3; i += 1) bubble.append(el('i'));
    typingRow.append(bubble);
    els.thread.append(typingRow);
    scrollBottom({ force: true });
  }

  function removeTyping() {
    if (typingRow) {
      typingRow.remove();
      typingRow = null;
    }
  }

  function renderPending(text) {
    if (!pendingRow) {
      pendingRow = el('div', 'msg bot');
      const bubble = el('div', 'bubble');
      pendingRow.append(bubble);
      els.thread.append(pendingRow);
    }
    const bubble = pendingRow.firstChild;
    bubble.textContent = text;
    const cursor = el('span', 'cursor');
    bubble.append(cursor);
    scrollBottom();
  }

  function removePending() {
    if (pendingRow) {
      pendingRow.remove();
      pendingRow = null;
    }
  }

  function showError(message) {
    const row = el('div', 'notice warn');
    const text = el('span', null, `${message || '消息没发出去'} `);
    row.append(text);
    if (S.lastText) {
      const retry = el('button', null, '重试');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        row.remove();
        send(S.lastText);
      });
      row.append(retry);
    }
    els.thread.append(row);
    scrollBottom({ force: true });
  }

  // ---------- 流式聊天 ----------
  async function streamChat(sessionId, text, handlers) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `回复失败（${res.status}）`);
    }
    if (!res.body) throw new Error('浏览器不支持流式回复');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatch = (chunk) => {
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) return;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      if (handlers[event]) handlers[event](payload);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx >= 0) {
        dispatch(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  }

  async function send(textOverride) {
    const text = String(textOverride !== undefined ? textOverride : els.input.value).trim();
    if (!text || S.streaming) return;

    if (!S.session) {
      try {
        const data = await api('/api/sessions', { method: 'POST', body: {} });
        S.session = data.session;
        S.currentId = data.session.id;
        await refreshSessions();
      } catch (err) {
        toast(err.message);
        return;
      }
    }

    S.lastText = text;
    els.input.value = '';
    autoGrow();
    updateSendState();

    if (els.thread.querySelector('.welcome')) {
      els.thread.replaceChildren();
      els.thread.classList.remove('center');
    }
    const userMsg = { role: 'user', text, ts: new Date().toISOString() };
    S.session.messages.push(userMsg);
    maybeDivider(userMsg.ts);
    appendUser(text);
    scrollBottom({ force: true });

    S.streaming = true;
    updateSendState();
    ensureTyping();

    let pendingText = '';
    let gotDone = false;

    try {
      await streamChat(S.session.id, text, {
        meta: (data) => {
          if (data.mock !== undefined) S.mock = Boolean(data.mock);
        },
        delta: (data) => {
          removeTyping();
          pendingText += data.text || '';
          renderPending(pendingText);
        },
        done: (data) => {
          gotDone = true;
          removeTyping();
          removePending();
          const replyText = data.text || pendingText;
          const bubbles = Array.isArray(data.bubbles) && data.bubbles.length ? data.bubbles : splitLines(replyText);
          if (replyText) {
            const assistantTs = new Date().toISOString();
            S.session.messages.push({ role: 'assistant', text: replyText, ts: assistantTs, images: data.images || [] });
            maybeDivider(assistantTs);
            appendBotLines(bubbles);
            appendBotImages(data.images);
          }
          if (Array.isArray(data.sessions)) {
            S.sessions = data.sessions;
            renderSessions();
          }
          if (data.mock !== undefined) {
            S.mock = Boolean(data.mock);
            renderChrome();
          }
          scrollBottom();
        },
        error: (data) => {
          removeTyping();
          removePending();
          showError(data.error || '这次没回上来');
        },
      });
    } catch (err) {
      removeTyping();
      removePending();
      if (!gotDone) showError(err.message || '网络好像断了');
    } finally {
      S.streaming = false;
      updateSendState();
      renderChrome();
      scrollBottom();
      els.input.focus();
    }
  }

  // ---------- 输入框 ----------
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 168)}px`;
  }

  function updateSendState() {
    els.btnSend.disabled = S.streaming || !els.input.value.trim();
  }

  // ---------- 设置 ----------
  function buildProviderOptions() {
    const providers = (S.settings && S.settings.providers) || [];
    els.fProvider.replaceChildren();
    for (const p of providers) {
      const opt = el('option', null, p.label || p.id);
      opt.value = p.id;
      els.fProvider.append(opt);
    }
  }

  function providerById(id) {
    return ((S.settings && S.settings.providers) || []).find((p) => p.id === id) || null;
  }

  function applyProviderDefaults(id, { keepValues = false } = {}) {
    const p = providerById(id);
    if (!p) return;
    if (!keepValues) {
      els.fBase.value = p.baseUrl || '';
      els.fModel.value = p.model || '';
    }
    els.providerHint.textContent = p.hint || (p.needsKey ? '需要填 API Key' : '本地服务，通常不需要 Key');
    els.keyTip.textContent = p.needsKey ? 'Key 只保存在本机的 config.json，不会上传。' : '这个服务跑在本机，Key 可以留空。';
    els.fKey.placeholder = S.settings && S.settings.hasKey && S.settings.provider === id
      ? `已保存：${S.settings.keyMasked}（留空不修改）`
      : '粘贴你的 API Key';
    els.modelList.replaceChildren();
    for (const m of p.models || []) {
      const opt = el('option');
      opt.value = m;
      els.modelList.append(opt);
    }
  }

  function fillSettingsForm(settings) {
    S.settings = settings;
    buildProviderOptions();
    els.fProvider.value = settings.provider || 'deepseek';
    applyProviderDefaults(settings.provider || 'deepseek', { keepValues: true });
    els.fBase.value = settings.baseUrl || '';
    els.fModel.value = settings.model || '';
    els.fKey.value = '';
    els.fKey.placeholder =
      settings.hasKey ? `已保存：${settings.keyMasked}（留空不修改）` : '粘贴你的 API Key';
    els.keyTip.textContent = settings.hasKey ? '已经保存了 Key。要换就直接粘贴新的。' : 'Key 只保存在本机，不会上传到别处。';
    els.fTemp.value = String(settings.temperature ?? 0.9);
    els.tempVal.textContent = Number(els.fTemp.value).toFixed(2).replace(/0$/, '');
    els.fUserName.value = settings.userName || '';
    els.fCustom.value = (S.persona && S.persona.customPrompt) || '';
    els.fBridge.checked = Boolean(settings.bridgeEnabled);
    els.fCare.checked = Boolean(settings.careEnabled);
    if (els.fRequireAt) els.fRequireAt.checked = Boolean(settings.group && settings.group.requireAt);
    if (els.fFreeChat) els.fFreeChat.checked = Boolean(settings.group && settings.group.freeChat);
    if (els.fChance) els.fChance.value = String((settings.group && settings.group.freeChatChance) || 0);
    if (els.fCooldown) els.fCooldown.value = String((settings.group && settings.group.cooldownSec) || 0);
    if (els.fEngaged) els.fEngaged.value = String((settings.group && settings.group.engagedMinutes) ?? 6);
    if (els.fSilent) els.fSilent.value = String((settings.group && settings.group.silentMinutes) ?? 20);
    if (els.fMute) els.fMute.value = String((settings.group && settings.group.muteDefaultMinutes) ?? 30);
    if (els.fMuted) els.fMuted.value = ((settings.group && settings.group.muted) || []).join('\n');
    if (els.fLinks) els.fLinks.checked = Boolean(settings.links && settings.links.enabled);
    if (els.fShare) els.fShare.checked = Boolean(settings.share && settings.share.enabled);
    if (els.fEmoji) els.fEmoji.value = (settings.group && settings.group.emojiLevel) || 'normal';
    if (els.fStickerShot) els.fStickerShot.checked = Boolean(settings.vision && settings.vision.stickerScreenshot);
    if (els.fImagegen) els.fImagegen.checked = Boolean(settings.imagegen && settings.imagegen.enabled);
    if (els.fImagegenKey) {
      els.fImagegenKey.value = '';
      els.fImagegenKey.placeholder =
        settings.imagegen && settings.imagegen.ready
          ? `已保存：${settings.imagegen.keyMasked}（留空不修改）`
          : 'DashScope / 千问 API Key';
    }
    if (els.imagegenKeyTip) {
      els.imagegenKeyTip.textContent = settings.imagegen && settings.imagegen.ready
        ? '已配置生图。'
        : '不填则不能生图；和看图 Key 不是一回事。';
    }
    if (els.fImagegenBase) els.fImagegenBase.value = (settings.imagegen && settings.imagegen.baseUrl) || '';
    if (els.fImagegenModel) els.fImagegenModel.value = (settings.imagegen && settings.imagegen.model) || '';
    if (els.fVoice) els.fVoice.checked = Boolean(settings.voice && settings.voice.enabled);
    if (els.fVoiceKey) {
      els.fVoiceKey.value = '';
      els.fVoiceKey.placeholder = (settings.voice && settings.voice.keyMasked)
        ? '已保存 ' + settings.voice.keyMasked + '（留空不修改）'
        : '百炼 / DashScope API Key';
    }
    if (els.voiceKeyTip && settings.voice) {
      els.voiceKeyTip.textContent = settings.voice.hasKey
        ? '已保存 Key。语音会先转文字再回复。'
        : '不填则不会转写；DeepSeek 的 Key 不能用于语音。';
    }
    if (els.fVoiceBase) els.fVoiceBase.value = (settings.voice && settings.voice.baseUrl) || '';
    if (els.fVoiceModel) els.fVoiceModel.value = (settings.voice && settings.voice.model) || '';
    els.fVisionKey.value = '';
    els.fVisionKey.placeholder =
      settings.vision && settings.vision.hasKey
        ? `已保存：${settings.vision.keyMasked}（留空不修改）`
        : '智谱 API Key，用于识别微信里的图片';
    els.visionKeyTip.textContent =
      settings.vision && settings.vision.hasKey ? '已配置看图。' : '不填也能聊，只是看不了图片。';
    els.bridgeToken.textContent = settings.bridgeToken || 'change-me-wechat';
    if (els.fDbDir) els.fDbDir.value = (settings.wechat && settings.wechat.dbDir) || '';
    els.testResult.textContent = '';
    els.testResult.className = 'result';
    renderBridge(settings);
  }

  function renderBridge(settings = S.settings) {
    const gateway = (S.status && S.status.gateway) || {};
    els.bridgeDot.classList.toggle('on', Boolean(gateway.online));
    els.bridgeState.textContent = gateway.online
      ? `已连接${gateway.info && gateway.info.account ? ` · ${gateway.info.account}` : ''}`
      : '未连接（桥接脚本没在跑）';
    if (els.bridgeHint) {
      els.bridgeHint.textContent = gateway.online
        ? '桥接已连上微信。它会自动收消息并回复；别关微信主程序，离开时最小化到任务栏就行。'
        : '网页是测试台；想真的在微信里聊，双击「启动微信桥接.bat」，等这里变成「已连接」。';
    }
    if (settings) {
      els.fBridge.checked = Boolean(settings.bridgeEnabled);
      els.fCare.checked = Boolean(settings.careEnabled);
      els.bridgeToken.textContent = settings.bridgeToken || 'change-me-wechat';
    if (els.fDbDir) els.fDbDir.value = (settings.wechat && settings.wechat.dbDir) || '';
    }
  }

  let ffmpegPoll = 0;

  function renderTools(tools) {
    const t = (tools && tools.ffmpeg) || (S.status && S.status.tools && S.status.tools.ffmpeg) || {};
    if (!els.ffmpegState) return;
    const btn = els.btnInstallFfmpeg;
    if (t.available) {
      els.ffmpegState.textContent = '已安装。重启桥接后用于图片/表情转码。';
      if (btn) {
        btn.hidden = true;
        btn.disabled = false;
      }
      return;
    }
    if (t.installing) {
      const pct = t.total ? Math.max(1, Math.round((t.progress / t.total) * 100)) : 0;
      els.ffmpegState.textContent = `正在下载${pct ? ` ${pct}%` : ''}，约 110MB…`;
      if (btn) {
        btn.hidden = false;
        btn.disabled = true;
        btn.textContent = '安装中…';
      }
      scheduleFfmpegPoll();
      return;
    }
    els.ffmpegState.textContent = t.error ? `安装失败：${t.error}` : '未安装（微信图片和表情会看不了）。';
    if (btn) {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = '安装';
    }
  }

  function scheduleFfmpegPoll() {
    clearTimeout(ffmpegPoll);
    ffmpegPoll = setTimeout(async () => {
      try {
        const data = await api('/api/tools');
        renderTools(data);
      } catch (_) {
        /* 下轮再试 */
      }
    }, 2000);
  }

  async function installFfmpeg() {
    if (!els.btnInstallFfmpeg) return;
    els.btnInstallFfmpeg.disabled = true;
    els.btnInstallFfmpeg.textContent = '准备中…';
    try {
      const data = await api('/api/tools/ffmpeg', { method: 'POST', body: {} });
      renderTools(data);
      toast('开始下载 ffmpeg，装好后重启桥接');
    } catch (err) {
      toast(err.message || '下载启动失败');
      renderTools(null);
    }
  }

  function renderPersonaPicker() {
    els.personaList.replaceChildren();
    const activeId = S.persona && (S.persona.presetId || S.persona.id);
    const ordered = [...S.personas].sort((a, b) => (b.id === activeId ? 1 : 0) - (a.id === activeId ? 1 : 0));
    for (const p of ordered) {
      const active = p.id === activeId;
      const btn = el('button', 'persona' + (active ? ' active' : ''));
      btn.type = 'button';
      const avatar = el('span', 'p-avatar', p.avatar || (p.name || '人').slice(0, 1));
      if (p.color) {
        avatar.style.background = p.color;
        avatar.style.color = '#fff';
      }
      const text = el('span', 'p-text');
      text.append(el('strong', null, p.name || '未命名'));
      text.append(el('span', null, p.tagline || ''));
      btn.append(avatar, text, el('span', 'p-check', '✓'));
      btn.addEventListener('click', () => applyPersona(p.id, p.name));
      els.personaList.append(btn);
    }
  }

  async function applyPersona(id, name) {
    if (
      S.persona &&
      S.persona.presetId === id &&
      !confirm(`当前已经是「${name || S.persona.name}」。要用预设覆盖掉你改过的内容吗？`)
    ) {
      return;
    }
    try {
      const data = await api('/api/persona/preset', { method: 'POST', body: { id } });
      S.persona = data.persona;
      S.personas = data.presets || S.personas;
      renderPersonaPicker();
      renderChrome();
      if (!S.session || !S.session.messages.length) renderMessages();
      toast(`已切换成${S.persona.name}`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function openDrawer(anchor) {
    drawerOpen = true;
    els.drawer.hidden = false;
    els.drawer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      els.drawer.classList.add('open');
      syncScrim();
    });
    closeSide();
    try {
      const [settings, personas, status] = await Promise.all([
        api('/api/settings'),
        api('/api/personas'),
        api('/api/status'),
      ]);
      S.personas = personas.presets || [];
      applyStatus(status);
      fillSettingsForm(settings);
      renderPersonaPicker();
      await renderNotes();
      if (anchor) {
        const sec = els.drawerBody.querySelector(`[data-sec="${anchor}"]`);
        if (sec) sec.scrollIntoView({ block: 'start' });
      }
    } catch (err) {
      toast(err.message);
    }
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    syncScrim();
    setTimeout(() => {
      if (!drawerOpen) els.drawer.hidden = true;
    }, 280);
  }

  function openSide() {
    overlaySide = true;
    els.side.classList.add('open');
    syncScrim();
  }

  function closeSide() {
    overlaySide = false;
    els.side.classList.remove('open');
    syncScrim();
  }

  function syncScrim() {
    els.scrim.classList.toggle('open', overlaySide || drawerOpen);
  }

  async function saveSettings({ quiet = false } = {}) {
    const body = {
      provider: els.fProvider.value,
      baseUrl: els.fBase.value.trim(),
      model: els.fModel.value.trim(),
      temperature: Number(els.fTemp.value),
      userName: els.fUserName.value.trim(),
      careEnabled: els.fCare.checked,
      bridgeEnabled: els.fBridge.checked,
    };
    if (els.fRequireAt) body.groupRequireAt = els.fRequireAt.checked;
    if (els.fFreeChat) body.groupFreeChat = els.fFreeChat.checked;
    if (els.fChance) body.groupFreeChatChance = Number(els.fChance.value) || 0;
    if (els.fCooldown) body.groupCooldownSec = Number(els.fCooldown.value) || 0;
    if (els.fEngaged) body.groupEngagedMinutes = Number(els.fEngaged.value) || 0;
    if (els.fSilent) body.groupSilentMinutes = Number(els.fSilent.value) || 0;
    if (els.fMute) body.groupMuteDefaultMinutes = Number(els.fMute.value) || 0;
    if (els.fMuted) {
      body.mutedGroups = els.fMuted.value
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50);
    }
    if (els.fLinks) body.linksEnabled = els.fLinks.checked;
    if (els.fShare) body.shareEnabled = els.fShare.checked;
    if (els.fEmoji) body.emojiLevel = els.fEmoji.value;
    if (els.fStickerShot) body.visionStickerShot = els.fStickerShot.checked;
    if (els.fImagegen) body.imagegenEnabled = els.fImagegen.checked;
    if (els.fImagegenKey && els.fImagegenKey.value.trim()) body.imagegenKey = els.fImagegenKey.value.trim();
    if (els.fImagegenBase) body.imagegenBaseUrl = els.fImagegenBase.value.trim();
    if (els.fImagegenModel) body.imagegenModel = els.fImagegenModel.value.trim();
    if (els.fVoice) body.voiceEnabled = els.fVoice.checked;
    if (els.fVoiceKey && els.fVoiceKey.value.trim()) body.voiceApiKey = els.fVoiceKey.value.trim();
    if (els.fVoiceBase) body.voiceBaseUrl = els.fVoiceBase.value.trim();
    if (els.fVoiceModel) body.voiceModel = els.fVoiceModel.value.trim();
    if (els.fKey.value.trim()) body.apiKey = els.fKey.value.trim();
    if (els.fVisionKey.value.trim()) body.visionApiKey = els.fVisionKey.value.trim();
    if (els.fDbDir) body.wechatDbDir = els.fDbDir.value.trim();
    if (!quiet) {
      els.btnSave.disabled = true;
      els.btnSave.textContent = '保存中…';
    }
    try {
      const settings = await api('/api/settings', { method: 'POST', body });
      const customPrompt = els.fCustom.value.trim();
      if (customPrompt !== ((S.persona && S.persona.customPrompt) || '')) {
        const saved = await api('/api/persona', { method: 'POST', body: { customPrompt } });
        S.persona = saved.persona;
      }
      fillSettingsForm(settings);
      const status = await api('/api/status');
      applyStatus(status);
      if (!quiet) toast('设置已保存');
      return settings;
    } finally {
      if (!quiet) {
        els.btnSave.disabled = false;
        els.btnSave.textContent = '保存';
      }
    }
  }

  async function testConnection() {
    els.btnTest.disabled = true;
    els.btnTest.textContent = '测试中…';
    els.testResult.textContent = '';
    els.testResult.className = 'result';
    try {
      await saveSettings({ quiet: true });
      const res = await fetch('/api/settings/test', { method: 'POST' });
      const data = await res.json();
      const result = (data && data.result) || {};
      if (result.ok) {
        const bits = ['连接正常'];
        if (result.model) bits.push(result.model);
        if (result.ms) bits.push(`${result.ms}ms`);
        els.testResult.textContent = bits.join(' · ');
        els.testResult.className = 'result ok';
      } else {
        els.testResult.textContent = result.message || '连接失败，检查 Key 和网络。';
        els.testResult.className = 'result err';
      }
    } catch (err) {
      els.testResult.textContent = err.message;
      els.testResult.className = 'result err';
    } finally {
      els.btnTest.disabled = false;
      els.btnTest.textContent = '测试连接';
    }
  }

  async function clearApiKey() {
    if (!window.confirm('清除这个服务商保存的 API Key？')) return;
    try {
      const settings = await api('/api/settings', {
        method: 'POST',
        body: { provider: els.fProvider.value, clearApiKey: true },
      });
      fillSettingsForm(settings);
      const status = await api('/api/status');
      applyStatus(status);
      toast('已清除 Key');
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- 记忆 ----------
  async function renderNotes() {
    els.noteList.replaceChildren();
    if (!S.currentId) {
      els.noteList.append(el('div', 'notes-empty', '先开始一段对话，才能单独记事情。'));
      return;
    }
    try {
      const data = await api(`/api/memory?sessionId=${encodeURIComponent(S.currentId)}`);
      S.notes = data.notes || [];
    } catch {
      S.notes = [];
    }
    if (!S.notes.length) {
      els.noteList.append(el('div', 'notes-empty', '还没有记忆。聊到重要的事，它会自己记；也可以手动加。'));
      return;
    }
    for (const note of S.notes) {
      const row = el('div', 'note');
      const text = el('span', 'n-text', note.text);
      const src = el('span', 'n-src', note.source === 'user' ? '手动' : '自动');
      const del = el('button', null);
      del.type = 'button';
      del.setAttribute('aria-label', '删除这条记忆');
      del.append(icon('i-close'));
      del.addEventListener('click', async () => {
        try {
          await api(
            `/api/memory/${encodeURIComponent(note.id)}?sessionId=${encodeURIComponent(S.currentId)}`,
            { method: 'DELETE' }
          );
          await renderNotes();
        } catch (err) {
          toast(err.message);
        }
      });
      row.append(text, src, del);
      els.noteList.append(row);
    }
  }

  async function addNote() {
    const text = els.fNote.value.trim();
    if (!text) return;
    if (!S.currentId) {
      toast('先开一段对话再记');
      return;
    }
    try {
      await api('/api/memory', { method: 'POST', body: { sessionId: S.currentId, text } });
      els.fNote.value = '';
      await renderNotes();
      toast('记下了');
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- 状态 ----------
  function applyStatus(status) {
    S.status = status;
    if (status && status.persona) {
      const prev = S.persona;
      S.persona = status.persona;
      if (!prev || prev.id !== status.persona.id) S.personas = S.personas.length ? S.personas : [];
    }
    renderChrome();
    renderBridge();
    renderTools(status && status.tools);
  }

  // ---------- 事件绑定 ----------
  function bind() {
    els.btnNew.addEventListener('click', newSession);
    els.btnSide.addEventListener('click', openSide);
    els.btnSettings.addEventListener('click', () => openDrawer());
    els.btnSettings2.addEventListener('click', () => openDrawer());
    if (els.btnEditPersona) {
      els.btnEditPersona.addEventListener('click', () => {
        window.location.href = '/persona';
      });
    }
    els.btnMemory.addEventListener('click', () => openDrawer('memory'));
    els.btnClear.addEventListener('click', async () => {
      if (!S.session || !S.session.messages.length) return;
      if (!window.confirm('清空当前对话的记录？记忆会保留。')) return;
      try {
        const data = await api(`/api/sessions/${encodeURIComponent(S.session.id)}/clear`, { method: 'POST' });
        S.session = data.session;
        renderMessages();
        await refreshSessions();
        toast('清空了');
      } catch (err) {
        toast(err.message);
      }
    });

    els.btnCloseDrawer.addEventListener('click', closeDrawer);
    els.scrim.addEventListener('click', () => {
      if (drawerOpen) closeDrawer();
      if (overlaySide) closeSide();
    });

    els.input.addEventListener('input', () => {
      autoGrow();
      updateSendState();
    });
    els.input.addEventListener('compositionstart', () => {
      S.composing = true;
    });
    els.input.addEventListener('compositionend', () => {
      S.composing = false;
    });
    els.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !S.composing) {
        ev.preventDefault();
        send();
      }
    });
    els.btnSend.addEventListener('click', () => send());

    els.bannerBtn.addEventListener('click', () => openDrawer('model'));
    els.fProvider.addEventListener('change', () => applyProviderDefaults(els.fProvider.value));
    els.fTemp.addEventListener('input', () => {
      els.tempVal.textContent = Number(els.fTemp.value).toFixed(2).replace(/0$/, '');
    });
    els.btnSave.addEventListener('click', () => {
      saveSettings().catch((err) => toast(err.message));
    });
    els.btnTest.addEventListener('click', testConnection);
    els.btnClearKey.addEventListener('click', clearApiKey);
    els.btnAddNote.addEventListener('click', addNote);
    els.fNote.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addNote();
      }
    });
    els.btnCopyToken.addEventListener('click', async () => {      const token = els.bridgeToken.textContent || '';
      try {
        await navigator.clipboard.writeText(token);
        toast('令牌已复制');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(els.bridgeToken);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('已选中，按 Ctrl+C 复制');
      }
    });
    if (els.btnInstallFfmpeg) {
      els.btnInstallFfmpeg.addEventListener('click', installFfmpeg);
    }
    els.fBridge.addEventListener('change', async () => {
      try {
        const settings = await api('/api/settings', {
          method: 'POST',
          body: { bridgeEnabled: els.fBridge.checked },
        });
        S.settings = settings;
        const status = await api('/api/status');
        applyStatus(status);
        toast(els.fBridge.checked ? '网关已启用' : '网关已关闭');
      } catch (err) {
        toast(err.message);
      }
    });
    els.fCare.addEventListener('change', async () => {
      try {
        const settings = await api('/api/settings', {
          method: 'POST',
          body: { careEnabled: els.fCare.checked },
        });
        S.settings = settings;
        toast(els.fCare.checked ? '会主动找你了' : '已关掉主动搭话');
      } catch (err) {
        toast(err.message);
      }
    });
    els.btnWipe.addEventListener('click', async () => {
      if (!window.confirm('清空全部对话？所有聊天记录和记忆都会被删除，无法恢复。')) return;
      try {
        await api('/api/sessions', { method: 'DELETE' });
        S.sessions = [];
        S.session = null;
        S.currentId = null;
        renderSessions();
        renderMessages();
        renderChrome();
        toast('全部清空了');
      } catch (err) {
        toast(err.message);
      }
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (drawerOpen) closeDrawer();
      else if (overlaySide) closeSide();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 820) closeSide();
    });
  }

  // ---------- 启动 ----------
  async function boot() {
    bind();
    updateSendState();
    try {
      const [status, personas, sessions] = await Promise.all([
        api('/api/status'),
        api('/api/personas'),
        api('/api/sessions'),
      ]);
      S.personas = personas.presets || [];
      applyStatus(status);
      S.sessions = sessions.sessions || [];
      renderSessions();
      if (S.sessions.length) {
        await openSession(S.sessions[0].id);
      } else {
        renderMessages();
      }
    } catch (err) {
      toast('服务没连上，刷新页面试试', 4000);
      els.peerStatus.textContent = '连接失败';
      els.thread.classList.add('center');
      const wrap = el('div', 'welcome');
      wrap.append(el('h2', null, '连不上服务'));
      wrap.append(el('p', 'tagline', '确认终端里的 node server.js 还在运行，然后刷新页面。'));
      els.thread.append(wrap);
    }
    els.input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

