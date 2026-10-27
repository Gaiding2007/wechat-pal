'use strict';
/* 视频专用截图：1920x1080，隐藏/替换私人会话名，只保留群聊名。 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'dist', 'video', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((x) => x.type === 'page');
  return new WebSocket(page.webSocketDebuggerUrl);
}

(async () => {
  const ws = await connect();
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };
  const evalJs = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await sleep(2500);
  await evalJs(`(() => {
    const th=document.querySelector('#thread');
    if(!th) return;
    const rows=[['user','今天上班被老板骂了，有点烦'],['bot','先别急着往心里去。'],['bot','你想吐槽就吐槽，我听着。'],['user','其实也不是大事，就是觉得委屈'],['bot','嗯，委屈是真的。'],['bot','要不要先吃点东西？饿的时候人更容易难过。']];
    th.innerHTML = '<div class="divider"><span>今天 22:14</span></div>' + rows.map(function(r){
      return '<div class="msg '+r[0]+'"><div class="bubble">'+r[1]+'</div></div>';
    }).join('');
  })()`);
  await sleep(600);
  await shot('01-chat.png');

  await evalJs(`document.querySelector('[data-view="wechat"]').click()`);
  await sleep(1800);
  await evalJs(`(() => {
    const items=[...document.querySelectorAll('.wx-item')];
    const hit=items.find(n=>(n.textContent||'').includes('团建加载中'))||items[0];
    if(hit) hit.click();
  })()`);
  await sleep(2000);
  await evalJs(`(() => {
    const keep=['团建加载中','相亲相爱de一家人','测试','微信ClawBot'];
    document.querySelectorAll('.wx-item').forEach((item)=>{
      const b=item.querySelector('b'); const sub=item.querySelector('.wx-item-sub');
      if(!b) return;
      if(!keep.includes(b.textContent.trim())){ b.textContent='微信好友'; if(sub) sub.textContent='聊天记录已隐藏'; const av=item.querySelector('.mini-avatar'); if(av) av.textContent='友'; }
    });
    document.querySelectorAll('.wx-sender').forEach(e=>{ e.textContent='群友'; });
    document.querySelectorAll('.wx-msg .mini-avatar').forEach(e=>{ if(e.textContent.trim()!=='我') e.textContent='友'; });
    const demoLines = ['@鲸鲸 晚上一起吃啥','火锅！不过我得先问问你们吃不吃辣','都行，你定','那就老地方，七点。别迟到啊','收到'];
    const th=document.querySelector('#wxThread');
    if(th){
      const rows = [['theirs',demoLines[0]],['mine',demoLines[1]],['theirs',demoLines[2]],['mine',demoLines[3]],['theirs',demoLines[4]]];
      const html = ['<div class="divider"><span>18:38</span></div>'].concat(rows.map(function(r){
        var side=r[0], text=r[1];
        return '<div class="wx-msg '+side+'">' +
          (side==='theirs' ? '<span class="mini-avatar sm" style="background:#7d786e">友</span>' : '') +
          '<div class="wx-msg-main">' +
          (side==='theirs' ? '<span class="wx-sender">群友</span>' : '') +
          '<div class="wx-bubble">'+text+'</div></div></div>';
      })).join('');
      th.innerHTML = html;
      th.scrollTop = 0;
    }
    document.querySelectorAll('.wx-item').forEach((item)=>{
      const b=item.querySelector('b');
      const sub2=item.querySelector('.wx-item-sub'); if(sub2) sub2.textContent = (b && b.textContent.trim()==='团建加载中') ? '晚上一起吃啥' : '聊天记录已隐藏';
    });
  })()`);
  await sleep(600);
  await shot('02-wechat.png');

  await evalJs(`document.querySelector('[data-view="moments"]').click()`);
  await sleep(2200);
  await evalJs(`(() => {
    const demo=['周末去看了海，风很大。','今天的晚饭：番茄牛腩。','路过一家很旧的书店。','新买的杯子，颜色很好看。','地铁上听到一首老歌。'];
    document.querySelectorAll('.moment').forEach((m,i)=>{
      const n=m.querySelector('.moment-head strong'); if(n) n.textContent='微信好友';
      const av=m.querySelector('.moment-head .mini-avatar'); if(av) av.textContent='友';
      const t=m.querySelector('.moment-text'); if(t) t.textContent=demo[i%demo.length];
      m.querySelectorAll('.moment-comments,.moment-comment,.moment-comment-form').forEach(x=>x.remove());
      m.querySelectorAll('.moment-head span').forEach(s=>{ if(s.textContent.includes('·')) s.textContent='刚刚'; });
      m.querySelectorAll('.moment-imgs').forEach(x=>x.remove());
      m.querySelectorAll('.moment-likes').forEach(x=>x.remove());
    });
  })()`);
  await sleep(500);
  await shot('03-moments.png');

  await evalJs(`document.querySelector('[data-view="stickers"]').click()`);
  await sleep(1200);
  await shot('04-stickers.png');

  await evalJs(`document.querySelector('[data-view="life"]').click()`);
  await sleep(1200);
  await shot('05-life.png');

  await send('Page.navigate', { url: 'http://127.0.0.1:8787/persona' });
  await sleep(2200);
  await shot('06-persona.png');

  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await sleep(2000);
  await evalJs(`document.querySelector('#btnSettings').click()`);
  await sleep(1600);
  await evalJs(`(() => {
    document.querySelectorAll('.field input').forEach((inp)=>{ if(/sk-|^[a-z0-9]{20,}/i.test(inp.value)) inp.value='sk-****************'; });
    const body=document.querySelector('.drawer-body'); if(body) body.scrollTop=0;
  })()`);
  await sleep(400);
  await shot('07-settings.png');

  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });



