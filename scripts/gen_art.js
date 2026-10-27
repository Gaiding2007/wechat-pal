// 生成角色图：文本/图生图 → 下载到指定文件
// 用法：node scripts/gen_art.js <promptFile> <outFile> [size] [refImage]
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const img = cfg.imagegen || {};
const key = img.apiKey;
if (!key) {
  console.error('没有生图 Key');
  process.exit(1);
}
const base = (img.baseUrl || 'https://maas.qianwenaiapi.com').replace(/\/+$/, '');
const model = img.model || 'qwen-image-3.0';
const [promptFile, outArg, sizeArg, refArg] = process.argv.slice(2);
const prompt = fs.readFileSync(path.resolve(root, promptFile), 'utf8').trim();
const out = path.resolve(root, outArg);
const size = sizeArg || '';
const body = { model, prompt, n: 1, prompt_extend: true };
if (size) body.size = size;
if (refArg) {
  const ref = fs.readFileSync(path.resolve(root, refArg));
  const mime = refArg.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  body.image = `data:${mime};base64,${ref.toString('base64')}`;
}

(async () => {
  const started = Date.now();
  const res = await fetch(`${base}/compatible-mode/v1/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('HTTP', res.status, text.slice(0, 500));
    process.exit(1);
  }
  const data = JSON.parse(text);
  const item = data && data.data && data.data[0];
  if (!item) {
    console.error('没有结果', text.slice(0, 500));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (item.b64_json) {
    fs.writeFileSync(out, Buffer.from(item.b64_json, 'base64'));
  } else if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error('下载失败 ' + r.status);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  } else {
    throw new Error('结果里没有 url/b64');
  }
  console.log(out, fs.statSync(out).size, 'bytes', ((Date.now() - started) / 1000).toFixed(1) + 's');
})();
