'use strict';

/**
 * 主动搭话的节奏控制。
 *
 * 判断逻辑放在服务端（而不是桥接脚本里），这样以后网页、别的平台也能复用：
 * 时间窗 + 间隔 + 每日上限，三个条件都满足才「该说话了」。
 */

function parseWindow(text) {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (start >= end) return null;
  return [start, end];
}

function inWindow(windows, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ranges = (windows || []).map(parseWindow).filter(Boolean);
  if (!ranges.length) return true;
  return ranges.some(([start, end]) => minutes >= start && minutes < end);
}

/** 同一天内稳定的小抖动，避免每天的搭话时间完全一样。 */
function dailyJitter(now, maxJitter) {
  if (maxJitter <= 0) return 0;
  const seed = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  let hash = 7;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return hash % (maxJitter + 1);
}

function careDue({ config, now = new Date(), lastMs = 0, sentToday = 0 }) {
  const care = (config && config.care) || {};
  if (!care.enabled) return { due: false, reason: 'disabled' };
  if (!inWindow(care.windows, now)) return { due: false, reason: 'outside-window' };
  if (Number(sentToday) >= (Number(care.maxPerDay) || 3)) return { due: false, reason: 'daily-limit' };
  const everyMinutes = Math.max(30, Number(care.everyMinutes) || 180);
  const jitter = dailyJitter(now, Math.max(0, Number(care.jitterMinutes) || 0));
  const gapMinutes = everyMinutes + jitter;
  const elapsed = lastMs ? (now.getTime() - Number(lastMs)) / 60000 : Infinity;
  if (elapsed < gapMinutes) {
    return { due: false, reason: 'too-soon', nextInMinutes: Math.ceil(gapMinutes - elapsed) };
  }
  return { due: true, reason: 'ok', gapMinutes };
}

/** 桥接脚本用的「多久算正在聊」：最近 N 分钟有消息就先别打扰。 */
function quietMinutes(config) {
  return Math.max(0, Number((config.care || {}).quietAfterMinutes) || 0);
}

module.exports = { careDue, inWindow, parseWindow, dailyJitter, quietMinutes };
