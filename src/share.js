'use strict';

/**
 * 主动分享：从 B 站挑一个视频，配一句「我刷到这个」的短话。
 * 桥接那边会把它发到微信里；没配 Key/被风控就当没有，不影响聊天。
 */
const fs = require('node:fs');
const path = require('node:path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const KEYWORDS = {
  whale: ['鲸鱼娘', '鲸娘', '鲸鱼少女', '蓝色大肥鱼', '鲸鱼拟人'],
  tieba: ['贴吧', '搞笑视频', '整活'],
  default: ['搞笑', '生活', '治愈'],
};

async function getJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Accept: 'application/json' },
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function toVideo(v) {
  return {
    bvid: v.bvid,
    title: stripTags(v.title),
    desc: stripTags(v.description || v.desc || '').slice(0, 200),
    url: `https://www.bilibili.com/video/${v.bvid}`,
    owner: (v.author || (v.owner && v.owner.name) || '').trim(),
    view: Number(v.play || (v.stat && v.stat.view)) || 0,
  };
}

async function searchVideos(keyword) {
  const data = await getJson(
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword=' +
      encodeURIComponent(keyword)
  );
  const list = data && data.data && Array.isArray(data.data.result) ? data.data.result : [];
  return list.map(toVideo).filter((v) => v.bvid && v.title);
}

async function fetchPopular() {
  const data = await getJson('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1');
  const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
  return list.map(toVideo);
}

async function fetchComments(bvid, limit = 3) {
  try {
    const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    const aid = view && view.data && view.data.aid;
    if (!aid) return [];
    const rep = await getJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=${limit}&pn=1`);
    const list = rep && rep.data && Array.isArray(rep.data.replies) ? rep.data.replies : [];
    return list.map((r) => String((r.content && r.content.message) || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function logFile(config) {
  return path.join((config.paths && config.paths.dataDir) || path.join(process.cwd(), 'data'), 'share-log.json');
}

function loadShared(config) {
  try {
    const raw = JSON.parse(fs.readFileSync(logFile(config), 'utf8'));
    return new Set(Array.isArray(raw.shared) ? raw.shared : []);
  } catch {
    return new Set();
  }
}

function saveShared(config, set) {
  try {
    fs.mkdirSync(path.dirname(logFile(config)), { recursive: true });
    fs.writeFileSync(logFile(config), JSON.stringify({ shared: [...set].slice(-200) }, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

async function pickVideo(config, persona) {
  const shared = loadShared(config);
  const keywords = KEYWORDS[persona.id] || KEYWORDS.default;
  const pool = [];
  for (const keyword of keywords) {
    try {
      const list = await searchVideos(keyword);
      for (const video of list) {
        if (!shared.has(video.bvid)) pool.push(video);
      }
    } catch {
      /* 风控就换下一个词 */
    }
    if (pool.length >= 12) break;
  }
  if (!pool.length) {
    try {
      for (const video of await fetchPopular()) {
        if (!shared.has(video.bvid)) pool.push(video);
      }
    } catch {
      /* ignore */
    }
  }
  if (!pool.length) return null;
  const video = pool[Math.floor(Math.random() * pool.length)];
  shared.add(video.bvid);
  saveShared(config, shared);
  return video;
}

async function shareVideo({ config, persona, llm, topic = '' }) {
  if (!config.share || !config.share.enabled) return { ok: true, enabled: false, video: null, comment: '' };
  const video = await pickVideo(config, persona);
  if (!video) return { ok: true, enabled: true, video: null, comment: '' };

  let comment = '';
  if (llm && !llm.isMock) {
    try {
      const comments = await fetchComments(video.bvid, 3);
      const raw = await llm.complete({
        system: [
          `你是「${persona.name}」，正在微信上给朋友分享一个 B 站视频。`,
          '用一句话说为什么发这个，像随口一提，不超过 40 字，不要 Markdown，不要链接。',
          topic ? `你们刚聊到：${topic}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        turns: [
          {
            role: 'user',
            content: `视频标题：${video.title}\n简介：${video.desc}\n评论：${comments.join(' / ')}`,
          },
        ],
        maxTokens: 120,
      });
      comment = String(raw || '').trim().slice(0, 80);
    } catch {
      comment = '';
    }
  }
  if (!comment) comment = topic ? `刚刷到这个，想起你刚说的「${topic}」。` : '刚刷到一个视频，感觉你会喜欢。';
  return { ok: true, enabled: true, video, topic, comment };
}

module.exports = { shareVideo, searchVideos, pickVideo };
