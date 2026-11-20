// 量一局里的音效：每个名字响了几次、每秒几声，音效与配乐的响度差（开发服务器开着时跑）。
// 用法：node tools/audio/usage.mjs [--port 5180] [--wave 10] [--secs 20] [--out 计数.json] [--runs 1]
//   ?wave=N&bot 开局，等机器人进到战斗，从这一刻起量 secs 秒（模拟的时间，软件渲染慢，墙钟会更久）：
//   - 每个名字真正出了声的次数（素材或合成后备；被同名间隔挡掉的不算），写进 --out（tools/audio/sharp.ts --usage 读它）；
//   - 音效总线和音乐总线（音量滑块之前）各接一个 K 加权的分析器，每 100ms 量一次 400ms 的瞬时响度，
//     报两条总线各自的中位数、90 分位，和「同一时刻音效减配乐」的中位数；另按 3 秒的短时响度再比一次（docs/audio.md「混音」）。
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = opt('--port', '5180');
const wave = Number(opt('--wave', '10'));
const secs = Number(opt('--secs', '20'));
const runs = Number(opt('--runs', '1'));
const out = opt('--out', null);

const counts = {};
const all = { sfx: [], music: [], diff: [], perSec: [], stDiff: [], stSfx: [], stMusic: [] };
for (let run = 0; run < runs; run++) {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/?wave=${wave}&bot`);
  await p.waitForFunction(() => window.__feel !== undefined, null, { timeout: 180000 });
  await p.mouse.click(640, 360);
  await p.waitForFunction(() => window.__sfx && window.__sfx.stats().pending === 0 && window.__sfx.stats().loaded > 0, null, { timeout: 180000 });
  // 等机器人买完东西、进到战斗
  await p.waitForFunction(() => window.__feel.stats().phase === 'wave' && window.__feel.stats().enemies > 3, null, { timeout: 240000, polling: 500 });
  await p.evaluate(() => {
    const s = window.__sfx;
    const ctx = s.ctx;
    const rec = (window.__aud = { counts: {}, sfx: [], music: [], plays: [] });
    const t0 = window.__feel.world.time;
    const orig = s.samples.play.bind(s.samples);
    s.samples.play = (name, def, o) => {
      const r = orig(name, def, o);
      if (r === 'played') {
        rec.counts[name] = (rec.counts[name] ?? 0) + 1;
        rec.plays.push(window.__feel.world.time - t0);
      }
      return r;
    };
    const syn = s.synth.bind(s);
    s.synth = (n) => {
      rec.counts['synth.' + n] = (rec.counts['synth.' + n] ?? 0) + 1;
      rec.plays.push(window.__feel.world.time - t0);
      return syn(n);
    };
    const tap = (node) => {
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf';
      hs.frequency.value = 1500;
      hs.gain.value = 4;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 38;
      const an = ctx.createAnalyser();
      an.fftSize = 32768;
      node.connect(hs).connect(hp).connect(an);
      return an;
    };
    const aS = tap(s.sfxOut ?? s.sfx); // 音效总线兜底之后（有的话）、主音量之前
    const aM = tap(s.musicBus);
    const n = Math.round(ctx.sampleRate * 0.4);
    const buf = new Float32Array(32768);
    const lk = (an) => {
      an.getFloatTimeDomainData(buf);
      let ms = 0;
      for (let i = buf.length - n; i < buf.length; i++) ms += buf[i] * buf[i];
      return -0.691 + 10 * Math.log10(Math.max(1e-12, ms / n));
    };
    rec.timer = setInterval(() => {
      rec.sfx.push(lk(aS));
      rec.music.push(lk(aM));
    }, 100);
    rec.t0 = t0;
  });
  await p.waitForFunction((secs) => window.__feel.world.time - window.__aud.t0 >= secs, secs, { timeout: 900000, polling: 500 });
  const r = await p.evaluate(() => {
    clearInterval(window.__aud.timer);
    const { timer, ...rest } = window.__aud;
    return { ...rest, music: rest.music, state: window.__sfx.stats().music?.playing };
  });
  await b.close();
  for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v;
  all.sfx.push(...r.sfx);
  all.music.push(...r.music);
  r.sfx.forEach((v, i) => v > -60 && r.music[i] > -60 && all.diff.push(v - r.music[i]));
  // 短时响度（3 秒）：每 100ms 一个 400ms 的瞬时值，往前 30 个按能量平均
  const st = (a) => a.map((_, i) => (i < 29 ? NaN : 10 * Math.log10(a.slice(i - 29, i + 1).reduce((x, v) => x + Math.pow(10, v / 10), 0) / 30)));
  const sS = st(r.sfx);
  const sM = st(r.music);
  sS.forEach((v, i) => {
    if (!Number.isFinite(v) || !(sM[i] > -60)) return;
    all.stSfx.push(v);
    all.stMusic.push(sM[i]);
    all.stDiff.push(v - sM[i]);
  });
  const sec = new Array(secs).fill(0);
  for (const t of r.plays) if (t >= 0 && t < secs) sec[Math.floor(t)]++;
  all.perSec.push(...sec);
  if (errs.length) console.log('页面报错：', errs.slice(0, 5));
  console.log(`第 ${run + 1} 局：配乐 ${r.state}，共 ${r.plays.length} 声`);
}
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`\n${runs} 局 × ${secs} 秒（第 ${wave} 波，机器人）：共 ${total} 声，平均每秒 ${(total / runs / secs).toFixed(1)} 声，最密的一秒 ${Math.max(...all.perSec)} 声`);
console.log(`音效总线瞬时响度：中位 ${q(all.sfx, 0.5).toFixed(1)}，90 分位 ${q(all.sfx, 0.9).toFixed(1)}；配乐：中位 ${q(all.music, 0.5).toFixed(1)}，90 分位 ${q(all.music, 0.9).toFixed(1)}`);
console.log(`同一时刻音效 − 配乐（瞬时 400ms）：中位 ${q(all.diff, 0.5).toFixed(1)} LU，90 分位 ${q(all.diff, 0.9).toFixed(1)} LU`);
console.log(`短时响度（3 秒）：音效中位 ${q(all.stSfx, 0.5).toFixed(1)}、配乐中位 ${q(all.stMusic, 0.5).toFixed(1)}；音效 − 配乐：中位 ${q(all.stDiff, 0.5).toFixed(1)} LU，90 分位 ${q(all.stDiff, 0.9).toFixed(1)} LU`);
console.log('\n响得最多的：');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${k.padEnd(22)} ${v}`);
if (out) writeFileSync(out, JSON.stringify(counts, null, 1));
