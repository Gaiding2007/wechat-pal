'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersonaStore } = require('../src/personaStore');
const { loadPersonas } = require('../src/persona');

const logger = { info() {}, warn() {} };

function makeStore(presets) {
  const base = path.join(__dirname, '..', 'data', 'tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'wechat-pal-persona-'));
  const config = {
    paths: {
      dataDir: dir,
      personaFile: path.join(dir, 'persona.json'),
      settingsFile: path.join(dir, 'settings.json'),
    },
    llm: { provider: 'deepseek' },
  };
  return { store: new PersonaStore({ config, presets, logger }), dir, config };
}

test('PersonaStore 默认用鲸鱼娘，修改会落盘', () => {
  const { store, config } = makeStore(loadPersonas(path.join(__dirname, '..', 'personas')));
  assert.equal(store.get().name, '鲸鱼娘');
  store.save({ tagline: '自检用的标签' });
  const reopened = new PersonaStore({ config, presets: [], logger });
  assert.equal(reopened.get().tagline, '自检用的标签');
  assert.equal(reopened.get().name, '鲸鱼娘');
});

test('PersonaStore 切换预设不会覆盖预设文件', () => {
  const { store } = makeStore(loadPersonas(path.join(__dirname, '..', 'personas')));
  store.applyPreset('tieba');
  assert.equal(store.get().name, '贴吧吧友');
  assert.equal(store.get().presetId, 'tieba');
  store.reset('whale');
  assert.equal(store.get().name, '鲸鱼娘');
  assert.equal(store.get().presetId, 'whale');
});

test('预设里鲸鱼娘的人格关键词齐全', () => {
  const list = loadPersonas(path.join(__dirname, '..', 'personas'));
  const whale = list.find((item) => item.id === 'whale');
  assert.ok(whale, '应该有 whale 预设');
  assert.ok(whale.aliases.includes('小鲸鱼'));
  assert.ok(whale.aliases.includes('哦鲸鲸'));
  assert.match(whale.personality.join(' '), /傲娇/);
  assert.match(whale.interests.join(' '), /白米饭/);
  const whaleText = [...whale.personality, ...whale.speakingStyle, ...(whale.extraRules || []), whale.systemPrompt].join(' ');
  assert.match(whaleText, /探索未至之境/);
  assert.equal(whale.emojiLevel, 1);
});

test('贴吧预设保留老吧友的直给和边界', () => {
  const list = loadPersonas(path.join(__dirname, '..', 'personas'));
  const tieba = list.find((item) => item.id === 'tieba');
  assert.ok(tieba, '应该有 tieba 预设');
  assert.equal(tieba.stylePreset, 'tieba');
  assert.match(tieba.identity, /老吧友/);
  assert.ok(tieba.boundaries.some((item) => /脏字|脏话/.test(item)));
});
