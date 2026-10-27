'use strict';

/**
 * 控制台：微信 / 朋友圈 / 表情 / 生活。
 *
 * 和 app.js 的「网页人格聊天」分开：这里操作的是真实微信数据，
 * 所有请求都经过本机 Node 转发到桥接里的能力接口。
 */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s);

  const state = {
    view: 'chat',
    wx: { sessions: [], chat: '', title: '', messages: [], online: false },
    moments: [],
    stickers: [],
    life: null,
  };

  function toast(message, tone = '') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (tone ? ' ' + tone : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.className = 'toast';
    }, 2600);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return res.json();
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const sec = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
    const d = new Date(Number(ts) * 1000);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function clock(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts) * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function hue(text) {
    let h = 0;
    for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  function avatar(title, size = '', color = '') {
    const ch = [...String(title || '微')][0] || '微';
    const bg = color || `hsl(${hue(title)} 32% 42%)`;
    return `<span class="mini-avatar ${size}" style="background:${bg}">${esc(ch)}</span>`;
  }

  function switchView(view) {
    state.view = view;
    document.body.dataset.view = view;
    $$('.view').forEach((el) => {
      el.hidden = el.id !== 'view-' + view;
    });
    $$('#appNav .nav-item').forEach((el) => el.classList.toggle('is-active', el.dataset.view === view));
    $$('#tabbar button').forEach((el) => el.classList.toggle('on', el.dataset.view === view));
    if (view === 'wechat') loadWeChat();
    if (view === 'moments') loadMoments();
    if (view === 'stickers') loadStickers();
    if (view === 'life') loadLife();
  }

  // ---------------- 微信 ----------------
  function renderWxSessions() {
    const list = $('#wxList');
    if (!list) return;
    const q = ($('#wxSearch')?.value || '').trim().toLowerCase();
    const rows = state.wx.sessions.filter((s) => !q || s.title.toLowerCase().includes(q));
    if (!state.wx.online) {
      list.innerHTML = `<div class="wx-tip"><strong>桥接没有连上</strong><span>双击「启动微信桥接.bat」，等它显示已连接，再点刷新。</span></div>`;
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<div class="wx-tip"><strong>没有会话</strong><span>微信里还没有聊天，或者桥接还在读数据库。</span></div>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (s) => `
      <button class="wx-item ${s.username === state.wx.chat ? 'is-active' : ''}" data-chat="${esc(s.username)}" data-title="${esc(s.title)}">
        ${avatar(s.title)}
        <span class="wx-item-main">
          <span class="wx-item-top"><b>${esc(s.title)}</b><em>${clock(s.lastTime)}</em></span>
          <span class="wx-item-sub">${esc(s.lastText || (s.type === 'group' ? '[群聊]' : ''))}</span>
        </span>
      </button>`
      )
      .join('');
    $$('.wx-item', list).forEach((btn) => {
      btn.onclick = () => openWxChat(btn.dataset.chat, btn.dataset.title);
    });
  }

  async function loadWeChat() {
    const statusEl = $('#wxHeadStatus');
    if (statusEl) statusEl.innerHTML = '<span class="dot"></span>正在连接桥接…';
    const health = await api('/api/wechat/health').catch(() => ({ ok: false }));
    state.wx.online = Boolean(health.ok);
    if (statusEl) {
      statusEl.innerHTML = health.ok
        ? `<span class="dot ok"></span>${esc(health.account || '微信')} · 已连接`
        : `<span class="dot"></span>桥接没在运行`;
    }
    if (!health.ok) {
      renderWxSessions();
      return;
    }
    const data = await api('/api/wechat/sessions?limit=300').catch(() => ({ ok: false }));
    state.wx.sessions = data.sessions || [];
    renderWxSessions();
  }

  async function openWxChat(chat, title) {
    state.wx.chat = chat;
    state.wx.title = title || chat;
    renderWxSessions();
    $('#wxEmpty').hidden = true;
    $('#wxThreadWrap').hidden = false;
    $('#wxPeer').textContent = state.wx.title;
    $('#wxPeerSub').textContent = chat.endsWith('@chatroom') ? '群聊 · 真实记录' : '私聊 · 真实记录';
    const thread = $('#wxThread');
    thread.innerHTML = '<div class="wx-tip"><span>正在读聊天记录…</span></div>';
    const data = await api(`/api/wechat/messages?chat=${encodeURIComponent(chat)}&limit=80`).catch(() => ({ ok: false }));
    if (!data.ok) {
      thread.innerHTML = `<div class="wx-tip"><strong>读不到记录</strong><span>${esc(data.error || '桥接没有返回数据')}</span></div>`;
      return;
    }
    state.wx.messages = data.messages || [];
    renderWxMessages();
  }

  function renderWxMessages() {
    const thread = $('#wxThread');
    const rows = state.wx.messages;
    if (!rows.length) {
      thread.innerHTML = '<div class="wx-tip"><span>还没有消息。</span></div>';
      return;
    }
    let lastTs = 0;
    const html = [];
    for (const m of rows) {
      if (m.time && Math.abs(m.time - lastTs) > 600) {
        html.push(`<div class="divider"><span>${clock(m.time)}</span></div>`);
        lastTs = m.time;
      }
      const mine = m.isSelf;
      const body = renderWxBody(m);
      html.push(`
        <div class="wx-msg ${mine ? 'mine' : 'theirs'}">
          ${mine ? '' : avatar(m.senderName || state.wx.title, 'sm')}
          <div class="wx-msg-main">
            ${!mine && m.senderName ? `<span class="wx-sender">${esc(m.senderName)}</span>` : ''}
            <div class="wx-bubble">${body}</div>
          </div>
        </div>`);
    }
    thread.innerHTML = html.join('');
    bindWxMedia(thread);
    thread.scrollTop = thread.scrollHeight;
  }

  function renderWxBody(m) {
    const media = m.media;
    if (!media) return `<span class="wx-text">${esc(m.text)}</span>`;
    if (media.kind === 'link') {
      return `<a class="wx-link" href="${esc(media.url)}" target="_blank" rel="noopener">${esc(m.text || '链接')}</a>`;
    }
    const attrs = `data-chat="${esc(state.wx.chat)}" data-lid="${esc(media.localId)}" data-kind="${esc(media.kind)}"`;
    if (media.kind === 'image' || media.kind === 'sticker') {
      return `<button class="wx-media wx-media-image" ${attrs}><span>点击加载图片</span></button>`;
    }
    if (media.kind === 'voice') {
      return `<button class="wx-media wx-media-voice" ${attrs}>▷ 语音 · 点击加载</button>`;
    }
    if (media.kind === 'video') {
      return `<button class="wx-media" ${attrs}>▶ 视频 · 点击加载</button>`;
    }
    return `<button class="wx-media" ${attrs}>📎 文件 · 点击加载</button>`;
  }

  function bindWxMedia(root) {
    $$('.wx-media', root).forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = async () => {
        const { chat, lid, kind } = btn.dataset;
        btn.disabled = true;
        btn.textContent = '加载中…';
        const data = await api(
          `/api/wechat/media?chat=${encodeURIComponent(chat)}&localId=${encodeURIComponent(lid)}&kind=${encodeURIComponent(kind)}`
        ).catch((err) => ({ ok: false, error: err.message }));
        btn.disabled = false;
        if (!data.ok) {
          btn.textContent = data.error || '加载失败';
          return;
        }
        if (kind === 'voice') {
          btn.replaceWith(Object.assign(document.createElement('audio'), { controls: true, src: data.url, className: 'wx-audio' }));
        } else if (kind === 'video') {
          btn.replaceWith(Object.assign(document.createElement('video'), { controls: true, src: data.url, className: 'wx-video' }));
        } else if (kind === 'file') {
          const a = document.createElement('a');
          a.href = data.url;
          a.download = '';
          a.className = 'wx-file';
          a.textContent = '下载文件';
          btn.replaceWith(a);
        } else {
          const img = document.createElement('img');
          img.src = data.url;
          img.className = 'wx-image';
          img.alt = '图片';
          img.onclick = () => window.open(data.url, '_blank');
          btn.replaceWith(img);
        }
      };
    });
  }

  async function sendWxText() {
    const input = $('#wxInput');
    const text = input.value.trim();
    if (!text || !state.wx.chat) return;
    input.value = '';
    updateWxSend();
    appendWxLocal(text, true);
    const data = await api('/api/wechat/send', {
      method: 'POST',
      body: { chat: state.wx.chat, name: state.wx.title, segments: [{ type: 'text', text }] },
    }).catch((err) => ({ ok: false, error: err.message }));
    if (!data.ok) toast(data.error || '发送失败', 'warn');
    setTimeout(() => openWxChat(state.wx.chat, state.wx.title), 1600);
  }

  function appendWxLocal(text, mine = true) {
    const thread = $('#wxThread');
    thread.insertAdjacentHTML(
      'beforeend',
      `<div class="wx-msg ${mine ? 'mine' : 'theirs'}"><div class="wx-msg-main"><div class="wx-bubble"><span class="wx-text">${esc(text)}</span></div></div></div>`
    );
    thread.scrollTop = thread.scrollHeight;
  }

  function updateWxSend() {
    const btn = $('#wxSend');
    if (btn) btn.disabled = !($('#wxInput')?.value || '').trim();
  }

  async function sendWxSegment(segments) {
    if (!state.wx.chat) {
      toast('先选一个微信会话');
      return;
    }
    const data = await api('/api/wechat/send', {
      method: 'POST',
      body: { chat: state.wx.chat, name: state.wx.title, segments },
    }).catch((err) => ({ ok: false, error: err.message }));
    if (!data.ok) toast(data.error || '发送失败', 'warn');
    else toast('发出去了');
    setTimeout(() => openWxChat(state.wx.chat, state.wx.title), 1800);
  }

  function pickFile(accept, onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) onPick(file);
    };
    input.click();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadAndSend(file, type) {
    const data = await fileToBase64(file);
    const up = await api('/api/wechat/upload', {
      method: 'POST',
      body: { name: file.name, data },
    }).catch((err) => ({ ok: false, error: err.message }));
    if (!up.ok) {
      toast(up.error || '上传失败', 'warn');
      return;
    }
    await sendWxSegment([{ type, path: up.path, name: file.name }]);
  }

  // ---------------- 朋友圈 ----------------
  function renderMoments() {
    const feed = $('#momentsFeed');
    if (!feed) return;
    if (!state.moments.length) {
      feed.innerHTML = `<div class="empty-state"><strong>还没有刷到朋友圈</strong><span>桥接连上后点刷新；朋友圈只读本机数据库里已经同步下来的内容。</span></div>`;
      return;
    }
    feed.innerHTML = state.moments
      .map((m) => {
        const imgs = (m.images || [])
          .map((img, idx) =>
            img.url
              ? `<img src="${esc(img.url)}" alt="" loading="lazy">`
              : `<button class="moment-img-missing" data-md5="${esc(img.md5 || '')}" data-size="${img.size || 0}" data-w="${img.width || 0}" data-h="${img.height || 0}">图片未缓存<br>点击加载</button>`
          )
          .join('');
        const likes = (m.likes || []).map((l) => esc(l.nickname)).filter(Boolean);
        const comments = (m.comments || [])
          .map((c) => `<p><b>${esc(c.nickname)}</b>：${esc(c.content)}</p>`)
          .join('');
        return `
        <article class="moment" data-tid="${esc(m.tid)}" data-username="${esc(m.username || '')}" data-text="${esc(m.text || '')}">
          <div class="moment-head">
            ${avatar(m.nickname, 'sm')}
            <div><strong>${esc(m.nickname)}</strong><span>${timeAgo(m.time)}${m.location ? ' · ' + esc(m.location) : ''}</span></div>
          </div>
          ${m.text ? `<p class="moment-text">${esc(m.text)}</p>` : ''}
          ${imgs ? `<div class="moment-imgs">${imgs}</div>` : ''}
          <div class="moment-actions">
            <button class="moment-like" data-act="like">赞${likes.length ? ' ' + likes.length : ''}</button>
            <button data-act="comment">评论</button>
            ${likes.length ? `<span class="moment-likes">${likes.join('、')} 觉得赞</span>` : ''}
          </div>
          ${comments ? `<div class="moment-comments">${comments}</div>` : ''}
          <form class="moment-comment-form" hidden>
            <input placeholder="写一句评论…" maxlength="200">
            <button type="submit">发送</button>
          </form>
        </article>`;
      })
      .join('');
    $$('.moment', feed).forEach((card) => {
      const tid = card.dataset.tid;
      const username = card.dataset.username || tid;
      const text = card.dataset.text || '';
      $$('.moment-img-missing', card).forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = '加载中…';
          const data = await api(
            `/api/moments/media?md5=${encodeURIComponent(btn.dataset.md5 || '')}` +
              `&size=${encodeURIComponent(btn.dataset.size || 0)}` +
              `&w=${encodeURIComponent(btn.dataset.w || 0)}&h=${encodeURIComponent(btn.dataset.h || 0)}`
          ).catch((err) => ({ ok: false, error: err.message }));
          if (!data.ok) {
            btn.textContent = data.needKey ? '先在微信点开一张图' : '加载失败';
            btn.title = data.error || '加载失败';
            btn.disabled = false;
            return;
          }
          const img = document.createElement('img');
          img.src = data.url;
          img.alt = '';
          btn.replaceWith(img);
        };
      });
      card.querySelector('[data-act="like"]').onclick = async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const data = await api('/api/moments/like', { method: 'POST', body: { username, text } }).catch((err) => ({ ok: false, error: err.message }));
        btn.disabled = false;
        if (data.ok) {
          btn.classList.add('is-liked');
          toast('点了个赞');
        } else {
          toast(wxErrorHint(data.error), 'warn');
        }
      };
      const form = card.querySelector('.moment-comment-form');
      card.querySelector('[data-act="comment"]').onclick = () => {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('input').focus();
      };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const input = form.querySelector('input');
        const content = input.value.trim();
        if (!content) return;
        input.disabled = true;
        const data = await api('/api/moments/comment', {
          method: 'POST',
          body: { username, text, content },
        }).catch((err) => ({ ok: false, error: err.message }));
        input.disabled = false;
        if (data.ok) {
          toast('评论发出去了');
          form.hidden = true;
          input.value = '';
          setTimeout(loadMoments, 1200);
        } else {
          toast(wxErrorHint(data.error), 'warn');
        }
      };
    });
  }

  function wxErrorHint(message) {
    const text = String(message || '');
    if (/主窗口|权限|UIA|完整性|模块|拒绝访问/.test(text)) {
      return '这一步要在已登录微信的桌面上运行桥接；当前环境拿不到微信窗口。';
    }
    return text || '操作没有成功';
  }

  async function loadMoments() {
    const feed = $('#momentsFeed');
    if (feed) feed.innerHTML = '<div class="wx-tip"><span>正在读朋友圈…</span></div>';
    const data = await api('/api/moments?limit=20').catch((err) => ({ ok: false, error: err.message }));
    if (!data.ok) {
      if (feed) feed.innerHTML = `<div class="wx-tip"><strong>读不到朋友圈</strong><span>${esc(data.error || '桥接没有返回数据')}</span></div>`;
      return;
    }
    state.moments = data.moments || [];
    renderMoments();
  }

  function openMomentComposer() {
    const old = $('#momentComposer');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'momentComposer';
    box.className = 'modal-scrim';
    box.innerHTML = `
      <div class="modal" role="dialog" aria-label="发朋友圈">
        <header><h2>发一条朋友圈</h2><button data-close>关闭</button></header>
        <textarea rows="4" placeholder="写点什么…"></textarea>
        <div class="modal-row">
          <button type="button" data-pick>加图片</button>
          <span data-file></span>
        </div>
        <p class="modal-note">微信 4.x 的发布页是自绘界面，自动发布还没做好；这里可以先存草稿/尝试，失败会告诉你原因。</p>
        <footer><button class="primary" data-post>发布（实验）</button></footer>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.querySelector('[data-close]').onclick = close;
    box.onclick = (ev) => {
      if (ev.target === box) close();
    };
    let picked = null;
    box.querySelector('[data-pick]').onclick = () =>
      pickFile('image/*', (file) => {
        picked = file;
        box.querySelector('[data-file]').textContent = file.name;
      });
    box.querySelector('[data-post]').onclick = async () => {
      const text = box.querySelector('textarea').value.trim();
      if (!text && !picked) {
        toast('写点字或者加张图');
        return;
      }
      const images = [];
      if (picked) {
        const data = await fileToBase64(picked);
        const up = await api('/api/wechat/upload', { method: 'POST', body: { name: picked.name, data } });
        if (up.ok) images.push(up.path);
      }
      const data = await api('/api/moments/post', { method: 'POST', body: { text, images } }).catch((err) => ({ ok: false, error: err.message }));
      toast(data.ok ? '发出去了' : data.error || '发布失败', data.ok ? '' : 'warn');
      if (data.ok) close();
    };
  }

  // ---------------- 表情 ----------------
  async function loadStickers() {
    const mine = $('#stickerMine');
    const cache = $('#stickerCache');
    if (cache) cache.innerHTML = '<div class="wx-tip"><span>微信表情缓存在桥接侧，先看「我的表情」。</span></div>';
    const data = await api('/api/stickers').catch(() => ({ ok: false }));
    state.stickers = data.stickers || [];
    if (!mine) return;
    if (!state.stickers.length) {
      mine.innerHTML = '<div class="wx-tip"><span>还没有，点右上角「上传图片」加一张。</span></div>';
      return;
    }
    mine.innerHTML = state.stickers
      .map((s) => `<button class="sticker" data-path="${esc(s.path)}" title="发给当前微信会话"><img src="${esc(s.url)}" alt="${esc(s.name)}"></button>`)
      .join('');
    $$('.sticker', mine).forEach((btn) => {
      btn.onclick = () => {
        if (!state.wx.chat) {
          toast('先去「微信消息」选一个会话');
          return;
        }
        sendWxSegment([{ type: 'image', path: btn.dataset.path }]);
      };
    });
  }

  // ---------------- 生活 ----------------
  function bar(label, value, max = 100) {
    const pct = Math.round((Math.max(0, value) / max) * 100);
    return `<div class="life-bar"><span>${label}</span><div><i style="width:${pct}%"></i></div><b>${Math.round(value)}</b></div>`;
  }

  function renderLife() {
    const wrap = $('#lifeWrap');
    const l = state.life;
    if (!wrap) return;
    if (!l) {
      wrap.innerHTML = '<div class="wx-tip"><span>正在读取她的状态…</span></div>';
      return;
    }
    const act = (l.activity || [])
      .map((a) => `<li><time>${timeAgo(Math.floor(new Date(a.ts).getTime() / 1000))}</time><span>${esc(a.text)}</span></li>`)
      .join('');
    const plan = (l.plan || []).map((p) => `<li>${esc(p)}</li>`).join('');
    wrap.innerHTML = `
      <div class="life-grid">
        <section class="life-card">
          <header><h2>${esc(l.persona ? l.persona.name : '她')} 现在</h2><span>${l.updatedAt ? timeAgo(Math.floor(new Date(l.updatedAt).getTime() / 1000)) : ''}更新</span></header>
          <div class="life-avatar">${avatar(l.persona ? l.persona.name : '鲸', 'lg', l.persona ? l.persona.color : '')}</div>
          ${bar('心情', l.mood)}
          ${bar('精力', l.energy)}
          ${bar('亲近度', l.affinity, 200)}
          <p class="life-note">状态会影响她说话的松紧：精力低时句子更短，心情好时更愿意接话。</p>
        </section>
        <section class="life-card">
          <header><h2>今天想做</h2></header>
          <ul class="life-plan">${plan || '<li>还没排，随缘。</li>'}</ul>
        </section>
        <section class="life-card wide">
          <header><h2>最近活动</h2><button class="text-btn" id="lifeNudge">关心一下</button></header>
          <ul class="life-activity">${act || '<li><span>还没有记录。</span></li>'}</ul>
        </section>
      </div>`;
    const nudge = $('#lifeNudge');
    if (nudge) {
      nudge.onclick = async () => {
        const data = await api('/api/life/nudge', { method: 'POST', body: { text: '被关心了一下，心情好了一点。', mood: 4, affinity: 1 } }).catch(() => null);
        if (data && data.ok) {
          state.life = data;
          renderLife();
          toast('她收到了');
        }
      };
    }
  }

  async function loadLife() {
    const data = await api('/api/life').catch(() => null);
    if (data && data.ok) {
      state.life = data;
      renderLife();
    }
  }

  // ---------------- 绑定 ----------------
  function bind() {
    $$('#appNav .nav-item[data-view]').forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.view);
    });
    $$('#tabbar button[data-view]').forEach((btn) => {
      btn.onclick = () => switchView(btn.dataset.view);
    });
    const refresh = $('#wxRefresh');
    if (refresh) refresh.onclick = () => loadWeChat();
    const wxSettings = $('#wxSettings');
    if (wxSettings) wxSettings.onclick = () => $('#btnSettings2')?.click();
    const search = $('#wxSearch');
    if (search) search.oninput = renderWxSessions;
    const wxInput = $('#wxInput');
    if (wxInput) {
      wxInput.oninput = () => {
        wxInput.style.height = 'auto';
        wxInput.style.height = Math.min(160, wxInput.scrollHeight) + 'px';
        updateWxSend();
      };
      wxInput.onkeydown = (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          sendWxText();
        }
      };
    }
    const wxSend = $('#wxSend');
    if (wxSend) wxSend.onclick = sendWxText;
    const wxImage = $('#wxImage');
    if (wxImage) wxImage.onclick = () => pickFile('image/*', (f) => uploadAndSend(f, 'image'));
    const wxFile = $('#wxFile');
    if (wxFile) wxFile.onclick = () => pickFile('*/*', (f) => uploadAndSend(f, 'file'));
    const wxEmoji = $('#wxEmoji');
    if (wxEmoji) wxEmoji.onclick = () => switchView('stickers');
    const mr = $('#momentsRefresh');
    if (mr) mr.onclick = loadMoments;
    const mc = $('#momentsCompose');
    if (mc) mc.onclick = openMomentComposer;
    const su = $('#stickerUpload');
    if (su)
      su.onclick = () =>
        pickFile('image/*', async (file) => {
          const data = await fileToBase64(file);
          const out = await api('/api/stickers', { method: 'POST', body: { name: file.name, data } }).catch((err) => ({ ok: false, error: err.message }));
          if (out.ok) {
            toast('加进表情库了');
            loadStickers();
          } else toast(out.error || '上传失败', 'warn');
        });
    const sr = $('#stickerRefresh');
    if (sr) sr.onclick = loadStickers;
    const sg = $('#stickerGen');
    if (sg) {
      sg.onclick = async () => {
        const prompt = window.prompt('想让她画什么？（一句话描述）');
        if (!prompt || !prompt.trim()) return;
        toast('正在画，可能要十几秒…');
        const out = await api('/api/image/generate', { method: 'POST', body: { prompt: prompt.trim() } }).catch((err) => ({ ok: false, error: err.message }));
        if (out.ok) {
          toast('画好了，点图片就能发到微信');
          loadStickers();
        } else {
          toast(out.error || '生图失败', 'warn');
        }
      };
    }
    const lr = $('#lifeRefresh');
    if (lr) lr.onclick = loadLife;
  }

  bind();
  switchView('chat');
  // 首页如果桥接已经在线，顺手把微信页的数据暖一下
  setTimeout(() => {
    api('/api/wechat/health').then((h) => {
      if (h.ok && state.view === 'chat') loadWeChat();
    });
  }, 1200);
})();
