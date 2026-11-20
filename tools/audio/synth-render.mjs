// 把合成后备（src/audio/sfx.ts 的 synXxx，素材没加载好时现场合成的声音）在浏览器里离线渲成 WAV，交给 tools/audio/sharp.ts --synth 量尖锐度。
// 用法（开发服务器开着时）：node tools/audio/synth-render.mjs [--port 5180] [--dir scratch/work/synth]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { writeWav16 } from './wav.ts';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = opt('--port', '5180');
const dir = opt('--dir', 'scratch/work/synth');
mkdirSync(dir, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`http://localhost:${port}/?fxlab`);
const res = await p.evaluate(async () => {
  const { Sfx } = await import('/src/audio/sfx.ts');
  const names = ['hit', 'kill', 'eliteKill', 'pickup', 'throw', 'hurt', 'skill', 'drumHit', 'cast', 'orb', 'dispel', 'thrust', 'flame', 'thunder', 'slam', 'ice', 'shield', 'block', 'silk', 'levelUp', 'waveEnd', 'coin'];
  const out = {};
  for (const n of names) {
    const SR = 44100;
    const ctx = new OfflineAudioContext(1, SR * 2.8, SR);
    const s = new Sfx();
    s.ctx = ctx;
    s.ok = () => true;
    s.master = ctx.createGain();
    s.master.connect(ctx.destination);
    s.sfx = ctx.createGain();
    s.sfx.connect(ctx.destination);
    if (s.synBus) s.syn = s.synBus(); // 合成后备自己的那道低通（2026-11-12 起）算在合成音效里；音效总线的兜底不算（素材也不算它）
    s.drums = ctx.createGain();
    s.drums.connect(ctx.destination);
    s.noise = ctx.createBuffer(1, SR, SR);
    const d = s.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < SR; i++) d[i] = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    s.synth(n);
    const buf = await ctx.startRendering();
    out[n] = Array.from(buf.getChannelData(0));
  }
  return out;
});
await b.close();
for (const [n, data] of Object.entries(res)) {
  const x = Float32Array.from(data);
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.9 / pk;
  writeFileSync(`${dir}/synth.${n}.wav`, writeWav16({ sampleRate: 44100, channels: [x] }));
}
console.log(`渲了 ${Object.keys(res).length} 个合成音效到 ${dir}/`);
