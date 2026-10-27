// 用 Edge DevTools 协议给 v3 控制台截图（仅开发用）。
const fs = require('fs');
const path = require('path');

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      waiting.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const outDir = path.resolve('docs/v3');
  fs.mkdirSync(outDir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'));
    console.log('shot', name);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
  await sleep(2200);

  const views = [
    ['chat', '01-chat.png'],
    ['wechat', '02-wechat.png'],
    ['moments', '03-moments.png'],
    ['stickers', '04-stickers.png'],
    ['life', '05-life.png'],
  ];
  for (const [view, file] of views) {
    await send('Runtime.evaluate', {
      expression: `document.querySelector('#appNav [data-view="${view}"]').click()`,
      awaitPromise: false,
    });
    await sleep(1400);
    if (view === 'wechat') {
      await send('Runtime.evaluate', {
        expression: `(() => {
          const items = [...document.querySelectorAll('.wx-item')];
          const hit = items.find((n) => (n.textContent || '').includes('相亲相爱')) || items[0];
          if (hit) hit.click();
        })()`,
        awaitPromise: false,
      });
      await sleep(1600);
    }
    await shot(file);
  }

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Runtime.evaluate', { expression: `document.querySelector('#appNav [data-view="life"]').click()` });
  await sleep(900);
  await shot('06-mobile-life-dark.png');

  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
