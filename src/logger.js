'use strict';

/**
 * 极简日志：控制台 + data/app.log。
 * 只保留最近约 2MB，避免长期运行把磁盘写满。
 */
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BYTES = 2 * 1024 * 1024;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function createLogger({ file, level = 'info', console: toConsole = true } = {}) {
  const min = LEVELS[String(level).toLowerCase()] || LEVELS.info;
  let stream = null;
  let written = 0;
  let broken = false;

  function open() {
    if (!file || stuck()) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      stream = fs.createWriteStream(file, { flags: 'a' });
      stream.on('error', () => { broken = true; });
      try { written = fs.statSync(file).size; } catch { written = 0; }
    } catch {
      broken = true;
    }
  }

  function stuck() {
    return broken || !file;
  }

  function rotateIfNeeded() {
    if (written < MAX_BYTES || !file) return;
    try {
      stream && stream.end();
      fs.renameSync(file, file + '.1');
    } catch { /* 忽略：日志不值得让程序出错 */ }
    stream = null;
    written = 0;
    open();
  }

  function write(lv, args) {
    if ((LEVELS[lv] || 0) < min) return;
    const line = `[${stamp()}] ${lv.toUpperCase().padEnd(5)} ${args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
      .join(' ')}`;
    if (toConsole) {
      const sink = lv === 'error' ? console.error : lv === 'warn' ? console.warn : console.log;
      sink(line);
    }
    if (stuck()) return;
    if (!stream) open();
    if (!stream) return;
    try {
      stream.write(line + '\n');
      written += Buffer.byteLength(line) + 1;
      rotateIfNeeded();
    } catch { /* 忽略 */ }
  }

  open();
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    close() { try { stream && stream.end(); } catch { /* ignore */ } },
  };
}

module.exports = { createLogger };
