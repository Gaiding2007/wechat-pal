'use strict';

/**
 * 微信桥接网关。
 *
 * 桥接脚本（bridge/wechat_bridge.py）跑在登录了微信的 Windows 上，把消息
 * POST 到 /webhook/wechat，再把返回的 reply 发回微信。这里做鉴权、字段归一化和回复。
 */
const crypto = require('node:crypto');
const { mentionsName } = require('./persona');

const HEARTBEAT_ONLINE_MS = 90 * 1000;

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

class WeChatGateway {
  constructor({ config, companion, logger }) {
    this.config = config;
    this.companion = companion;
    this.logger = logger;
    this.lastHeartbeat = null;
    this.heartbeatInfo = null;
    this.counters = { inbound: 0, replied: 0, ignored: 0, rejected: 0 };
  }

  get settings() {
    return (this.config.gateway && this.config.gateway.wechat) || {};
  }

  get enabled() {
    return Boolean(this.settings.enabled);
  }

  token() {
    return String(this.settings.inboundToken || '');
  }

  verify(req, body) {
    if (!this.enabled) return { ok: false, status: 403, error: 'gateway disabled' };
    const header = req.headers['x-bot-token'];
    const query = new URL(req.url, 'http://localhost').searchParams.get('token');
    const supplied = header || (body && body.token) || query || '';
    if (!this.token() || !supplied || !safeEqual(supplied, this.token())) {
      return { ok: false, status: 401, error: 'bad token' };
    }
    return { ok: true };
  }

  normalize(body = {}) {
    const persona = this.companion.persona;
    const mentioned = Array.isArray(body.mentioned_names)
      ? body.mentioned_names.map((n) => String(n || '').trim()).filter(Boolean)
      : [];
    const chatType = body.chat_type === 'group' || body.is_group ? 'group' : 'private';
    const text = String(body.text || '').trim();
    const atMe =
      Boolean(body.at_me) ||
      mentioned.some((name) => name === persona.name || (persona.aliases || []).includes(name)) ||
      (chatType === 'group' && mentionsName(text, persona));
    return {
      channel: 'wechat',
      chatId: String(body.chat_id || body.room_id || body.user_id || 'unknown'),
      chatType,
      senderId: String(body.senderId || body.sender_id || body.user_id || '').trim(),
      senderName: String(body.senderName || body.sender_name || body.nickname || '').trim(),
      text,
      atMe,
      title: String(body.chat_title || body.room_name || '').trim(),
      messageId: String(body.msg_id || ''),
    };
  }

  isMuted(chatId) {
    const muted = (this.config.group && this.config.group.mutedGroups) || [];
    const id = String(chatId || '');
    return muted.some((item) => String(item && (item.chatId || item.id || item)).trim() === id);
  }

  async handle(body = {}) {
    const payload = this.normalize(body);
    this.counters.inbound += 1;
    if (!payload.text) {
      this.counters.ignored += 1;
      return { status: 200, json: { action: 'ignore', reason: 'empty' } };
    }
    if (this.isMuted(payload.chatId)) {
      this.counters.ignored += 1;
      return { status: 200, json: { action: 'ignore', reason: 'muted' } };
    }
    const result = await this.companion.handle(payload);
    if (result.action !== 'reply') {
      this.counters.ignored += 1;
      return {
        status: 200,
        json: {
          action: 'ignore',
          reason: result.reason || 'no-reply',
          ...(result.error ? { error: result.error } : {}),
        },
      };
    }
    this.counters.replied += 1;
    return {
      status: 200,
      json: {
        action: 'reply',
        reply: result.text,
        bubbles: result.bubbles,
        images: Array.isArray(result.images) ? result.images : [],
        mock: this.companion.llm.isMock,
        reason: result.reason,
        sessionId: result.sessionId,
      },
    };
  }

  heartbeat(body = {}) {
    this.lastHeartbeat = Date.now();
    this.heartbeatInfo = {
      platform: String(body.platform || 'wechat'),
      uia: body.uia !== false,
      rest: Boolean(body.rest),
      listener: Boolean(body.listener),
      account: String(body.account || ''),
      at: new Date().toISOString(),
    };
    return { ok: true, online: true, gateway: this.enabled };
  }

  status() {
    const online = Boolean(this.lastHeartbeat && Date.now() - this.lastHeartbeat < HEARTBEAT_ONLINE_MS);
    return {
      enabled: this.enabled,
      online,
      lastHeartbeat: this.lastHeartbeat ? new Date(this.lastHeartbeat).toISOString() : null,
      info: this.heartbeatInfo,
      tokenSet: Boolean(this.token()),
      tokenDefault: this.token() === 'change-me-wechat',
      counters: this.counters,
    };
  }
}

module.exports = { WeChatGateway, HEARTBEAT_ONLINE_MS };
