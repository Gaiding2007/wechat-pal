'use strict';

/**
 * 对方发链接时，抓一下标题和简介塞进上下文。
 * 只在人设打开 links 时启用；失败就算了，绝不阻塞回复。
 */
const http = require('node:http');
const https = require('node:https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const URL_RE = /https?:\/\/[^\s<>"'）)】]+/gi;
const MAX_BYTES = 512 * 1024;
const cache = new Map();

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return decodeEntities(match[1]);
  }
  return '';
}

function extract(html, finalUrl) {
  const head = String(html || '').slice(0, 400000);
  let title = pick(head, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  title = title.replace(/\s*[-_|｜].{0,20}$/, '').slice(0, 80);
  const description = pick(head, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ]).slice(0, 160);
  return { url: finalUrl, title: title || finalUrl, description };
}

function fetchOne(url, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('bad url'));
      return;
    }
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
      reject(new Error('unsupported url'));
      return;
    }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(
      parsed,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && res.headers.location.startsWith('http')) {
          res.resume();
          fetchOne(res.headers.location, { timeoutMs }).then(resolve, reject);
          return;
        }
        const chunks = [];
        let size = 0;
        const type = String(res.headers['content-type'] || '');
        if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
          res.resume();
          resolve(null);
          return;
        }
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          resolve(extract(html, url));
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function extractUrls(textValue, limit = 2) {
  const urls = [];
  const seen = new Set();
  for (const raw of String(textValue || '').match(URL_RE) || []) {
    const url = raw.replace(/[.,，。！？!?]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

/** 返回可以直接塞进提示词的短句。抓不到就返回空数组。 */
async function linkNotes(textValue, { maxLinks = 2 } = {}) {
  const urls = extractUrls(textValue, Math.max(1, Math.min(3, Number(maxLinks) || 2)));
  if (!urls.length) return [];
  const notes = [];
  await Promise.all(
    urls.map(async (url) => {
      const cached = cache.get(url);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
        if (cached.note) notes.push(cached.note);
        return;
      }
      try {
        const video = await biliNote(url);
        if (video) {
          cache.set(url, { at: Date.now(), note: video });
          notes.push(video);
          return;
        }
        const page = await fetchOne(url);
        if (!page) {
          cache.set(url, { at: Date.now(), note: '' });
          return;
        }
        const note = page.description
          ? `${page.title}（${page.url}）：${page.description}`
          : `${page.title}（${page.url}）`;
        cache.set(url, { at: Date.now(), note });
        notes.push(note);
      } catch {
        cache.set(url, { at: Date.now(), note: '' });
      }
    })
  );
  return notes.slice(0, 3);
}

function getJson(url, { timeoutMs = 7000, referer = 'https://www.bilibili.com/' } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (isPrivateHost(parsed.hostname)) {
      reject(new Error('unsupported host'));
      return;
    }
    const req = https.get(
      parsed,
      {
        headers: {
          'User-Agent': UA,
          Referer: referer,
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** B 站视频：取标题、UP 主、简介和字幕，让模型至少「看过」内容。 */
async function biliNote(url) {
  const match = String(url).match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/);
  if (!match) return '';
  const bvid = match[1];
  try {
    const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
    const data = view && view.data;
    if (!data) return '';
    const title = String(data.title || '').trim();
    const owner = String((data.owner && data.owner.name) || '').trim();
    const desc = String(data.desc || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const duration = Number(data.duration) || 0;
    const cid = data.cid || (Array.isArray(data.pages) && data.pages[0] && data.pages[0].cid);
    let subtitle = '';
    if (cid) {
      try {
        const player = await getJson(
          `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`,
          { referer: `https://www.bilibili.com/video/${bvid}` }
        );
        const subs = (player && player.data && player.data.subtitle && player.data.subtitle.subtitles) || [];
        const first = subs.find((s) => s && s.subtitle_url) || null;
        if (first) {
          const sub = await getJson(
            first.subtitle_url.startsWith('//') ? `https:${first.subtitle_url}` : first.subtitle_url,
            { referer: `https://www.bilibili.com/video/${bvid}` }
          );
          const items = (sub && sub.body) || [];
          subtitle = items
            .map((x) => String(x.content || '').trim())
            .filter(Boolean)
            .join(' ')
            .slice(0, 1200);
        }
      } catch {
        // 没字幕就算了，标题和简介也够用
      }
    }
    const parts = [`B站视频《${title}》`, owner ? `UP 主：${owner}` : '', duration ? `时长 ${Math.round(duration / 60)} 分钟` : ''];
    if (desc) parts.push(`简介：${desc}`);
    if (subtitle) parts.push(`字幕节选：${subtitle}`);
    parts.push(`链接：https://www.bilibili.com/video/${bvid}`);
    return parts.filter(Boolean).join('；');
  } catch {
    return '';
  }
}

module.exports = { linkNotes, extractUrls, isPrivateHost };
