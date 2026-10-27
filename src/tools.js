'use strict';

/**
 * 本机依赖的下载/安装。目前只有 ffmpeg：
 * 微信 4.x 的图片、表情多是 wxgf/HEVC 容器，没有 ffmpeg 就转不成 jpg。
 * 这里从官方 static build 下载，装到 runtime/ffmpeg/bin，桥接下次启动会自己找到。
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { execFile } = require('node:child_process');

const DEFAULT_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
// gyan.dev 在国内经常只有十几 KB/s；npm 上的预编译包快得多，做成第一优先。
const DEFAULT_SOURCES = [
  { kind: 'tar', url: 'https://registry.npmjs.org/@ffmpeg-installer/win32-x64/-/win32-x64-4.1.0.tgz' },
  { kind: 'tar', url: 'https://registry.npmmirror.com/@ffmpeg-installer/win32-x64/-/win32-x64-4.1.0.tgz' },
  { kind: 'zip', url: DEFAULT_URL },
];

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {
    /* 文件被占用就下次再说 */
  }
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('下载跳转太多次'));
      return;
    }
    const lib = url.startsWith('http://') ? http : https;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'wechat-pal/3.0 (+local companion)',
          Accept: '*/*',
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          resolve(download(next, dest, onProgress, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载失败：HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          got += chunk.length;
          onProgress(got, total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve({ size: got, total })));
        out.on('error', reject);
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

function findFile(dir, name) {
  let found = '';
  const walk = (d, depth) => {
    if (found || depth > 6) return;
    let items;
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p, depth + 1);
      else if (it.name.toLowerCase() === name) {
        found = p;
        return;
      }
    }
  };
  walk(dir, 0);
  return found;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || stdout || err.message || '解压失败').trim().slice(0, 400)));
          return;
        }
        resolve(stdout || '');
      }
    );
  });
}

class Tools {
  constructor({ config, logger, root }) {
    this.config = config || {};
    this.logger = logger;
    this.root = root;
    this.binDir = path.join(root, 'runtime', 'ffmpeg', 'bin');
    this.exe = path.join(this.binDir, 'ffmpeg.exe');
    this.tmpZip = path.join(root, 'data', 'ffmpeg-download.zip');
    this.tmpDir = path.join(root, 'data', 'ffmpeg-tmp');
    this.state = { installing: false, progress: 0, total: 0, error: '', note: '' };
  }

  status() {
    const available = fs.existsSync(this.exe);
    return {
      ffmpeg: {
        available,
        path: available ? this.exe : '',
        installing: this.state.installing,
        progress: this.state.progress,
        total: this.state.total,
        error: this.state.error,
        note: this.state.note || (available ? '' : '微信图片/表情是 wxgf/HEVC，需要 ffmpeg 才能看图。'),
      },
    };
  }

  installFfmpeg() {
    if (this.state.installing) return Promise.resolve({ started: false, reason: 'installing' });
    if (fs.existsSync(this.exe)) return Promise.resolve({ started: false, reason: 'already' });
    const custom = (this.config.tools && this.config.tools.ffmpegUrl) || process.env.FFMPEG_URL || '';
    const sources = custom
      ? [{ kind: custom.toLowerCase().endsWith('.tgz') ? 'tar' : 'zip', url: custom }]
      : DEFAULT_SOURCES;
    this.state = { installing: true, progress: 0, total: 0, error: '', note: '正在下载 ffmpeg…' };
    this._run(sources).catch((err) => {
      this.state.installing = false;
      this.state.error = err.message || String(err);
      this.logger.warn('ffmpeg 安装失败：' + this.state.error);
    });
    return Promise.resolve({ started: true, url: sources[0].url });
  }

  async _run(sources) {
    fs.mkdirSync(path.join(this.root, 'data'), { recursive: true });
    fs.mkdirSync(this.binDir, { recursive: true });
    let lastErr = null;
    for (const src of sources) {
      try {
        rmrf(this.tmpZip);
        rmrf(this.tmpDir);
        this.state.progress = 0;
        this.state.total = 0;
        this.state.note = '正在下载 ffmpeg…';
        await download(src.url, this.tmpZip, (got, total) => {
          this.state.progress = got;
          this.state.total = total;
        });
        this.state.note = '下载完成，正在解压…';
        fs.mkdirSync(this.tmpDir, { recursive: true });

        const zip = this.tmpZip.replace(/'/g, "''");
        const out = this.tmpDir.replace(/'/g, "''");
        if (src.kind === 'tar') {
          await new Promise((resolve, reject) => {
            execFile('tar', ['-xzf', this.tmpZip, '-C', this.tmpDir], { windowsHide: true, timeout: 120000 }, (err, _o, stderr) => {
              if (err) reject(new Error((stderr || err.message || '解压 tgz 失败').trim().slice(0, 300)));
              else resolve();
            });
          });
        } else {
          await runPowerShell(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`);
        }

        const found = findFile(this.tmpDir, 'ffmpeg.exe');
        if (!found) throw new Error('安装包里没有找到 ffmpeg.exe');
        fs.copyFileSync(found, this.exe);
        const probe = findFile(this.tmpDir, 'ffprobe.exe');
        if (probe) {
          try {
            fs.copyFileSync(probe, path.join(this.binDir, 'ffprobe.exe'));
          } catch (_) {
            /* ffprobe 不是必须的 */
          }
        }
        rmrf(this.tmpZip);
        rmrf(this.tmpDir);
        this.state.installing = false;
        this.state.progress = fs.statSync(this.exe).size;
        this.state.total = this.state.progress;
        this.state.note = 'ffmpeg 已装好，下次启动桥接后生效。';
        this.logger.info('ffmpeg 安装完成：' + this.exe);
        return;
      } catch (err) {
        lastErr = err;
        this.logger.warn('ffmpeg 源失败，换下一个：' + (err.message || err));
      }
    }
    throw lastErr || new Error('没有可用的 ffmpeg 下载源');
  }
}

module.exports = { Tools, DEFAULT_URL };
