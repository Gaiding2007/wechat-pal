'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WeChatGateway } = require('../src/gateway');

function makeGateway(token = 'test-token', overrides = {}) {
  const config = {
    gateway: { wechat: { enabled: true, inboundToken: token } },
    chat: { groupFreeChatChance: 0, ...(overrides.chat || {}) },
  };
  const companion = {
    persona: { name: '小满', aliases: ['小满'] },
    llm: { isMock: true },
    handle: async () => ({
      action: 'reply',
      text: '在的。',
      bubbles: ['在的。'],
      reason: 'demo',
      sessionId: 's1',
    }),
  };
  return new WeChatGateway({ config, companion, logger: { info() {}, warn() {}, error() {} } });
}

const req = (token) => ({ headers: token ? { 'x-bot-token': token } : {}, url: '/webhook/wechat' });

test('verify：令牌对不上就拒绝', () => {
  const gw = makeGateway();
  assert.equal(gw.verify(req('nope'), {}).status, 401);
  assert.equal(gw.verify(req(''), {}).status, 401);
  assert.equal(gw.verify(req('test-token'), {}).ok, true);
});

test('verify：网关关掉直接 403', () => {
  const gw = makeGateway();
  gw.config.gateway.wechat.enabled = false;
  assert.equal(gw.verify(req('test-token'), {}).status, 403);
});

test('normalize：兼容桥接字段，群里没 @ 时不算 atMe', () => {
  const gw = makeGateway();
  const p = gw.normalize({
    chat_id: 'c1',
    chat_type: 'group',
    sender_name: '小林',
    text: '今天好热',
    chat_title: '测试群',
    mentioned_names: [],
  });
  assert.equal(p.chatType, 'group');
  assert.equal(p.senderName, '小林');
  assert.equal(p.atMe, false);
  assert.equal(p.title, '测试群');
});

test('handle：群里没被叫到也交给 companion 判断上下文', async () => {
  const gw = makeGateway();
  let seen = null;
  gw.companion.handle = async (payload) => {
    seen = payload;
    return { action: 'ignore', reason: 'group-silent', sessionId: 's1' };
  };
  const result = await gw.handle({ chat_id: 'c1', chat_type: 'group', text: '今天好热' });
  assert.equal(seen.atMe, false);
  assert.equal(result.json.action, 'ignore');
  assert.equal(result.json.reason, 'group-silent');
});

test('handle：私聊返回微信桥接要的 reply 字段', async () => {
  const gw = makeGateway();
  const result = await gw.handle({ chat_id: 'u1', chat_type: 'private', text: '在吗' });
  assert.equal(result.status, 200);
  assert.equal(result.json.action, 'reply');
  assert.equal(result.json.reply, '在的。');
  assert.equal(result.json.bubbles.length, 1);
  assert.equal(gw.counters.replied, 1);
});

test('heartbeat 之后状态为在线', () => {
  const gw = makeGateway();
  gw.heartbeat({ platform: 'wechat', uia: true });
  const status = gw.status();
  assert.equal(status.online, true);
  assert.equal(status.enabled, true);
  assert.equal(status.info.platform, 'wechat');
});
