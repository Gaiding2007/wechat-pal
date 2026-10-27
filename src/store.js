'use strict';

/**
 * 本地存储：一个 JSON 文件装下所有会话、消息和长期记忆。
 *
 * 设计上故意不做数据库：聊天记录量小，JSON 方便备份、迁移、直接用编辑器看。
 * 写入合并成一次（300ms 内的连续改动只落盘一次），并且先写临时文件再 rename，
 * 避免断电/崩溃把 store.json 写坏。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MESSAGES = 300;
const MAX_SESSIONS = 120;

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

class Store {
  constructor({ file, logger, maxMessages = MAX_MESSAGES, maxSessions = MAX_SESSIONS }) {
    this.file = file;
    this.logger = logger;
    this.maxMessages = maxMessages;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.profile = { userName: '' };
    this.timer = null;
    this.load();
  }

  load() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return;
    this.profile = raw.profile && typeof raw.profile === 'object' ? raw.profile : { userName: '' };
    const list = Array.isArray(raw.sessions) ? raw.sessions : Object.values(raw.sessions || {});
    for (const item of list) {
      if (!item || !item.id) continue;
      const session = {
        id: String(item.id),
        channel: item.channel === 'wechat' ? 'wechat' : 'web',
        type: item.type === 'group' ? 'group' : 'private',
        title: String(item.title || '聊天'),
        chatId: item.chatId ? String(item.chatId) : '',
        createdAt: item.createdAt || nowIso(),
        updatedAt: item.updatedAt || item.createdAt || nowIso(),
        messages: Array.isArray(item.messages) ? item.messages.filter((m) => m && m.text) : [],
        notes: Array.isArray(item.notes) ? item.notes.filter((n) => n && n.text) : [],
        meta: item.meta && typeof item.meta === 'object' ? item.meta : {},
      };
      this.sessions.set(session.id, session);
    }
    if (this.logger) this.logger.debug(`已载入 ${this.sessions.size} 个会话`);
  }

  markDirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = {
        version: 1,
        savedAt: nowIso(),
        profile: this.profile,
        sessions: [...this.sessions.values()],
      };
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      if (this.logger) this.logger.error('保存聊天记录失败：' + (err && err.message));
    }
  }

  trim() {
    const list = [...this.sessions.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const session of list.slice(this.maxSessions)) {
      // 微信会话是长期对应的，别因为聊天少就被清掉
      if (session.chatId) continue;
      this.sessions.delete(session.id);
    }
  }

  create({ channel = 'web', type = 'private', title = '', chatId = '' } = {}) {
    const session = {
      id: newId(channel === 'wechat' ? 'wx' : 's'),
      channel,
      type,
      title: title || (channel === 'wechat' ? '微信聊天' : '新对话'),
      chatId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
      notes: [],
      meta: {},
    };
    this.sessions.set(session.id, session);
    this.trim();
    this.markDirty();
    return session;
  }

  ensure({ id, channel = 'web', type = 'private', title = '', chatId = '' } = {}) {
    if (id && this.sessions.has(String(id))) return this.sessions.get(String(id));
    if (chatId) {
      const found = [...this.sessions.values()].find((s) => s.chatId && s.chatId === String(chatId));
      if (found) return found;
    }
    return this.create({ channel, type, title, chatId });
  }

  get(id) {
    return this.sessions.get(String(id || '')) || null;
  }

  getOrCreateWeb(id) {
    const existing = id ? this.get(id) : null;
    if (existing) return existing;
    return this.create({ channel: 'web', type: 'private', title: '新对话' });
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((s) => ({
        id: s.id,
        channel: s.channel,
        type: s.type,
        title: s.title,
        chatId: s.chatId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        count: s.messages.length,
        noteCount: s.notes.length,
        preview: s.messages.length ? s.messages[s.messages.length - 1].text.slice(0, 40) : '',
      }));
  }

  remove(id) {
    const ok = this.sessions.delete(String(id || ''));
    if (ok) this.markDirty();
    return ok;
  }

  clearAll() {
    this.sessions.clear();
    this.markDirty();
  }

  addMessage(id, { role, text, name = '', source = 'web', ts = nowIso(), images = [] }) {
    const session = this.get(id);
    if (!session) return null;
    const clean = String(text || '').trim();
    if (!clean) return null;
    const message = {
      id: newId('m'),
      role: role === 'assistant' ? 'assistant' : 'user',
      text: clean,
      name: String(name || '').slice(0, 40),
      source,
      ts,
      ...(Array.isArray(images) && images.length ? { images } : {}),
    };
    session.messages.push(message);
    if (session.messages.length > this.maxMessages) {
      session.messages.splice(0, session.messages.length - this.maxMessages);
    }
    session.updatedAt = ts;
    if (session.title === '新对话' && message.role === 'user') {
      session.title = clean.replace(/\s+/g, ' ').slice(0, 18);
    }
    this.markDirty();
    return message;
  }

  messages(id) {
    const session = this.get(id);
    return session ? session.messages : [];
  }

  addNote(id, text, source = 'user') {
    const session = this.get(id);
    const clean = String(text || '').trim();
    if (!session || !clean) return null;
    const exists = session.notes.some((n) => n.text === clean);
    if (exists) return null;
    const note = { id: newId('n'), text: clean.slice(0, 200), source, ts: nowIso() };
    session.notes.push(note);
    this.markDirty();
    return note;
  }

  removeNote(id, noteId) {
    const session = this.get(id);
    if (!session) return false;
    const before = session.notes.length;
    session.notes = session.notes.filter((n) => n.id !== noteId);
    if (session.notes.length !== before) {
      this.markDirty();
      return true;
    }
    return false;
  }

  removeNoteByText(id, text) {
    const session = this.get(id);
    if (!session) return null;
    const needle = String(text || '').trim();
    if (!needle) return null;
    const index = session.notes.findIndex((n) => n.text.includes(needle) || needle.includes(n.text));
    if (index < 0) return null;
    const [removed] = session.notes.splice(index, 1);
    this.markDirty();
    return removed;
  }

  notes(id) {
    const session = this.get(id);
    return session ? session.notes : [];
  }

  stats() {
    let messages = 0;
    let notes = 0;
    for (const session of this.sessions.values()) {
      messages += session.messages.length;
      notes += session.notes.length;
    }
    return { sessions: this.sessions.size, messages, notes };
  }
}

module.exports = { Store, MAX_MESSAGES, MAX_SESSIONS };
