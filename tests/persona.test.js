'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePersona,
  buildSystem,
  cleanReply,
  splitBubbles,
  mentionsName,
  shouldReply,
} = require('../src/persona');

const persona = normalizePersona({
  id: 'warm',
  name: '小满',
  aliases: ['小满'],
  tagline: '一个不着急的朋友',
  greeting: '在呢。',
});

test('normalizePersona 补上默认头像和颜色', () => {
  assert.equal(persona.avatar, '小');
  assert.match(persona.color, /^#[0-9a-fA-F]{6}$/);
  assert.equal(persona.name, '小满');
});

test('cleanReply 去掉 Markdown、角色前缀和整段引号', () => {
  assert.equal(cleanReply('**在的。**'), '在的。');
  assert.equal(cleanReply('我：在呢。'), '在呢。');
  assert.equal(cleanReply('小满：在呢。', { name: '小满' }), '在呢。');
  assert.equal(cleanReply('「今天怎么样？」'), '今天怎么样？');
  assert.equal(cleanReply('```\n在呢。\n```'), '在呢。');
});

test('splitBubbles 按行拆成多条', () => {
  assert.deepEqual(splitBubbles('听着就累。\n先别管别的，坐一会儿。'), [
    '听着就累。',
    '先别管别的，坐一会儿。',
  ]);
});

test('splitBubbles 保留换行分条，并限制最多三条', () => {
  assert.deepEqual(splitBubbles('嗯。\n我在。'), ['嗯。', '我在。']);
  const bubbles = splitBubbles('第一句话。\n第二句话。\n第三句话。\n第四句话。\n第五句话。', {
    maxBubbles: 3,
  });
  assert.equal(bubbles.length, 3);
  assert.match(bubbles[2], /第三句话。/);
  assert.match(bubbles[2], /第五句话。/);
});

test('shouldReply：私聊必回，群里只在被叫到时回', () => {
  assert.equal(shouldReply({ text: '在吗', isGroup: false }).reply, true);
  assert.equal(shouldReply({ text: '今天好热', isGroup: true, persona }).reply, false);
  assert.equal(shouldReply({ text: '随便聊聊', isGroup: true, persona, atMe: true }).reason, 'at');
  assert.equal(shouldReply({ text: '小满你怎么看', isGroup: true, persona }).reason, 'name');
  assert.equal(
    shouldReply({
      text: '有人吗',
      isGroup: true,
      persona,
      config: { chat: { groupFreeChatChance: 50 } },
      rng: () => 0.1,
    }).reason,
    'chance'
  );
});

test('mentionsName 认得别名', () => {
  const p = { ...persona, aliases: ['满满', '小满'] };
  assert.equal(mentionsName('满满在吗', p), true);
  assert.equal(mentionsName('今天下雨', p), false);
});

test('buildSystem 包含人设、边界，且没有旧项目的毒舌设定', () => {
  const system = buildSystem({
    persona,
    config: { chat: { privateMaxChars: 120, maxBubbles: 3 } },
    runtime: {},
    userName: '小林',
    now: new Date('2026-10-25T21:30:00+08:00'),
  });
  assert.match(system, /小满/);
  assert.match(system, /小林/);
  assert.match(system, /不主动提.*AI/);
  assert.match(system, /边界/);
  assert.doesNotMatch(system, /贴吧/);
  assert.doesNotMatch(system, /主人最高指令/);
  assert.doesNotMatch(system, /你爹|傻逼/);
});
