'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Life } = require('../src/life');

function makeLife() {
  const base = path.join(__dirname, '..', 'data', 'tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'pal-life-'));
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return { life: new Life({ config: { paths: { dataDir: dir } }, logger }), dir };
}

test('生活状态有心情、精力、亲近度和今日计划', () => {
  const { life } = makeLife();
  const snap = life.snapshot();
  assert.ok(snap.mood >= 0 && snap.mood <= 100);
  assert.ok(snap.energy >= 0 && snap.energy <= 100);
  assert.ok(snap.affinity >= 0);
  assert.ok(Array.isArray(snap.plan) && snap.plan.length >= 2);
  assert.ok(Array.isArray(snap.activity) && snap.activity.length >= 1);
  life.timer.unref();
});

test('聊天之后亲近度会涨，活动里会留一条记录', () => {
  const { life } = makeLife();
  const before = life.snapshot();
  life.note('陪你聊了几句，心情不错。', { mood: 1, energy: -1, affinity: 2 });
  const after = life.snapshot();
  assert.equal(after.affinity, before.affinity + 2);
  assert.match(after.activity[0].text, /聊了几句/);
  life.timer.unref();
});

test('状态会落盘，重启后还在', () => {
  const { life, dir } = makeLife();
  life.note('记住今天。', { affinity: 1 });
  const again = new Life({
    config: { paths: { dataDir: dir } },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  assert.ok(again.snapshot().affinity >= life.snapshot().affinity);
  assert.ok(fs.existsSync(path.join(dir, 'life.json')));
  life.timer.unref();
  again.timer.unref();
});
