'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');

const root = path.join(__dirname, '..');
const cfg = loadConfig({ root });
const key = (cfg.imagegen && cfg.imagegen.apiKey) || (cfg.settings && cfg.settings.keys && cfg.settings.keys.image);
if (!key) {
  console.error('missing imagegen key');
  process.exit(1);
}
const img = path.join(root, 'assets', 'persona', 'whale-girl.png');
const b64 = fs.readFileSync(img).toString('base64');
const prompt = [
  'same character as the reference image, exact same face, blue gradient long hair, blue eyes, whale-fin hair ornaments, dark navy and white maid outfit with blue whale apron, starry blue whale tail',
  'smartphone selfie, taken by herself, arm extended toward camera, close-up head and shoulders, looking at the camera with a soft smile, slightly high angle',
  'background is her cozy room at night, desk with a small blue lamp, soft fairy lights, a mug, blurred',
  'natural phone photo, realistic lighting, vertical 3:4, no text, no watermark',
  'keep the character design identical to the reference; do not change hair color, eye color, outfit, or tail',
].join(', ');

(async () => {
  const res = await fetch('https://maas.qianwenaiapi.com/compatible-mode/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'qwen-image-3.0',
      prompt,
      image: 'data:image/jpeg;base64,' + b64,
      size: '1024x1536',
      n: 1,
      prompt_extend: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(res.status, text.slice(0, 500));
    process.exit(2);
  }
  const data = JSON.parse(text);
  const url = data.data && data.data[0] && data.data[0].url;
  if (!url) {
    console.error('no url', text.slice(0, 500));
    process.exit(3);
  }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const out = path.join(root, 'assets', 'persona', 'whale-girl-selfie.png');
  fs.writeFileSync(out, buf);
  console.log('saved', out, buf.length);
})();
