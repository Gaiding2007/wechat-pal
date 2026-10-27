'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { careDue, inWindow, parseWindow, dailyJitter } = require('../src/care');

const at = (hour, minute) => new Date(2026, 9, 25, hour, minute, 0);

test('parseWindow 只接受合法的时间段', () => {
  assert.deepEqual(parseWindow('09:00-12:00'), [540, 720]);
  assert.equal(parseWindow('12:00-09:00'), null);
  assert.equal(parseWindow('瞎写'), null);
});

test('inWindow 判断当前时间是否在窗口里', () => {
  const windows = ['09:00-12:00', '14:00-23:00'];
  assert.equal(inWindow(windows, at(10, 30)), true);
  assert.equal(inWindow(windows, at(13, 0)), false);
  assert.equal(inWindow([], at(3, 0)), true);
});

test('careDue 关掉时永远不打扰', () => {
  assert.equal(careDue({ config: { care: { enabled: false } }, now: at(10, 30) }).reason, 'disabled');
});

test('careDue 遵守时间窗和每日上限', () => {
  const config = {
    care: { enabled: true, windows: ['09:00-12:00'], everyMinutes: 60, maxPerDay: 2, jitterMinutes: 0 },
  };
  assert.equal(careDue({ config, now: at(13, 0) }).reason, 'outside-window');
  assert.equal(careDue({ config, now: at(10, 30), sentToday: 2 }).reason, 'daily-limit');
});

test('careDue 没到间隔时不说话，到了才说', () => {
  const config = {
    care: { enabled: true, windows: [], everyMinutes: 60, maxPerDay: 3, jitterMinutes: 0 },
  };
  const now = at(10, 30);
  const recent = now.getTime() - 10 * 60 * 1000;
  const old = now.getTime() - 90 * 60 * 1000;
  assert.equal(careDue({ config, now, lastMs: recent }).reason, 'too-soon');
  const due = careDue({ config, now, lastMs: old });
  assert.equal(due.due, true);
  assert.equal(due.reason, 'ok');
});

test('dailyJitter 同一天稳定、不越界', () => {
  assert.equal(dailyJitter(at(10, 0), 30), dailyJitter(at(22, 0), 30));
  assert.ok(dailyJitter(at(10, 0), 30) <= 30);
  assert.equal(dailyJitter(at(10, 0), 0), 0);
});
