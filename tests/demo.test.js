'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { demoReply, demoCare } = require('../src/demo');

const persona = { name: '小满' };

test('演示回复接得住「累」这类情绪', () => {
  const reply = demoReply('今天有点累', { persona });
  assert.match(reply.text, /累/);
  assert.ok(reply.bubbles.length >= 1);
  assert.equal(reply.mock, true);
});

test('演示回复认得问候', () => {
  assert.match(demoReply('在吗', { persona }).text, /在的|我在|来啦/);
});

test('演示回复总比空好，不会返回空字符串', () => {
  for (const text of ['', '随便说点什么', '123', '今天天气不错']) {
    const reply = demoReply(text, { persona });
    assert.ok(reply.text.length > 0);
  }
});

test('主动问候是一句完整的话', () => {
  const bubbles = demoCare();
  assert.ok(Array.isArray(bubbles));
  assert.ok(bubbles.length > 0);
  const text = bubbles.join('\n');
  assert.ok(text.length > 0);
  assert.doesNotMatch(text, /\{/);
});
