// 量音效的「尖锐度」（没法试听，就量）：用户 2026-11-12「所有尖锐的声音都不应该存在」。
// 用法：node tools/audio/sharp.ts [--legacy] [--dir 成品目录] [--usage 计数.json] [--synth 目录] [--save 结果.json] [--before 改前.json] [--top 30] [--md]
//   默认量 bank.ts 里每个名字用到的成品（public/audio/sfx/*.m4a，先用 afconvert 解成 WAV），按播放时往上最多变调多少换算；
//   --synth 目录：再量合成后备（目录里是 tools/audio/synth-render.mjs 在浏览器里渲出来的 synth.<名>.wav）；
//   --usage：一局里每个名字响了几次（tools/audio/usage.mjs 量的），用来加权排序；
//   --before：和改前存下的结果对照，同一张表里列出改前 / 改后。
//   --legacy：按改前的变调规则（对称的 ±pitch、拾灵石往上爬两个八度）量；--dir：成品不在 public/audio/sfx 时（例如从 git 取出的改前版本）。
//
// 每个声音量这几样（取它几个变体里最刺的那个）：
// - 尖锐度 S（acum，近似 Zwicker / DIN 45692）：能量加权的平均频谱按 A 计权、分 24 个临界频带，特定响度 ∝ 能量^0.23，
//   S = 0.11·Σ N'(z)·g(z)·z / Σ N'(z)，g(z) 在 15.8 Bark（约 3 kHz 往上）之后指数加重。频率先乘上播放时往上最大的变速。
// - 重心：能量加权平均频谱的频谱重心（Hz）；
// - 8k+：8 kHz 以上能量占比；2–5k：2–5 kHz（耳朵最敏感、最「扎」的一段）能量占比（都按 A 计权之后的能量算）；
// - 起音：包络从峰值的 10% 升到 90% 用了多少毫秒；峰值因子：峰值 / 最响 50ms 的有效值（dB）。
// 刺耳分 = S × (1 + 2·2–5k + 4·8k+) × 起音系数（起音 < 3ms 乘 1.15）：只用来排序，门槛另外按 S 与两个占比定（见 docs/audio.md）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { BANK, UP_MAX } from '../../src/audio/bank.ts';
import { SR } from './dsp.ts';
import { readWav } from './wav.ts';

const args = process.argv.slice(2);
const LEGACY = args.includes('--legacy');
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'public/audio/sfx';
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
/** 「温和」档的门槛（docs/audio.md「尖锐度」）：三样都在门槛以内。 */
export const SOFT = { S: 1.8, hf8: 0.02, mid: 0.35 };
/** 有一样超过这个就算「刺」，夹在中间是「偏亮」。 */
export const SHARP = { S: 2.3, hf8: 0.06, mid: 0.6 };
export const tier = (m: { S: number; hf8: number; mid: number }) =>
  m.S <= SOFT.S && m.hf8 <= SOFT.hf8 && m.mid <= SOFT.mid ? '温和' : m.S > SHARP.S || m.hf8 > SHARP.hf8 || m.mid > SHARP.mid ? '刺' : '偏亮';

const TMP = 'scratch/work/sharp';
mkdirSync(TMP, { recursive: true });

export interface Metric {
  S: number; // acum（已按往上的最大变调换算）
  S0: number; // 原调
  centroid: number;
  hf8: number;
  mid: number; // 2–5 kHz
  attack: number; // ms
  crest: number; // dB
  up: number; // 播放时往上最多几个半音
  score: number;
}

// ---------- 频谱 ----------
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const N = 2048;
/** 能量加权的平均功率谱（每帧功率直接相加，响的帧自然占得多）。 */
function spectrum(x: Float32Array): Float64Array {
  const P = new Float64Array(N / 2);
  const w = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let s = 0; s < Math.max(1, x.length - N / 2); s += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[s + i] ?? 0) * w[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  return P;
}

/** A 计权（功率，线性）。 */
function aw(f: number) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return (ra * 1.2589) ** 2;
}
const bark = (f: number) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
const gz = (z: number) => (z < 15.8 ? 1 : 0.85 + 0.15 * Math.exp(0.42 * (z - 15.8)));

/** 频谱 P（按 SR、N 的频点）在变速 rate 之后的各项指标。 */
function specMetrics(P: Float64Array, rate: number) {
  const bands = new Float64Array(25);
  let tot = 0;
  let hf8 = 0;
  let mid = 0;
  let cen = 0;
  for (let k = 1; k < P.length; k++) {
    const f = ((k * SR) / N) * rate;
    if (f > 20000) break;
    const e = P[k] * aw(f);
    tot += e;
    cen += e * f;
    if (f >= 8000) hf8 += e;
    if (f >= 2000 && f <= 5000) mid += e;
    bands[Math.min(24, Math.floor(bark(f)))] += e;
  }
  const max = Math.max(...bands);
  let num = 0;
  let den = 0;
  for (let z = 0; z < 25; z++) {
    // 特定响度：假定最响的频带高出听阈 60dB，N' = (E / 听阈)^0.23 − 1（低于听阈的不算）——
    // 比最响的低三四十 dB 的频带（编码噪声、尾巴里的一点亮）只占很小的份量，不然 0.23 次方会把它们抬得太高
    const n = Math.max(0, Math.pow(bands[z] / (max * 1e-6), 0.23) - 1);
    if (!n) continue;
    num += n * gz(z + 0.5) * (z + 0.5);
    den += n;
  }
  return { S: den ? (0.11 * num) / den : 0, centroid: tot ? cen / tot : 0, hf8: tot ? hf8 / tot : 0, mid: tot ? mid / tot : 0 };
}

function timeMetrics(x: Float32Array) {
  let pk = 0;
  let at = 0;
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) > pk) {
      pk = Math.abs(x[i]);
      at = i;
    }
  // 包络：1ms 的峰值保持
  const H = Math.round(0.001 * SR);
  const env = (i: number) => {
    let m = 0;
    for (let j = Math.max(0, i - H); j <= i; j++) m = Math.max(m, Math.abs(x[j]));
    return m;
  };
  let i90 = at;
  while (i90 > 0 && env(i90 - 1) >= 0.9 * pk) i90--;
  let i10 = i90;
  while (i10 > 0 && env(i10 - 1) >= 0.1 * pk) i10--;
  const W = Math.round(0.05 * SR);
  let best = 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] * x[i];
    if (i >= W) s -= x[i - W] * x[i - W];
    best = Math.max(best, s);
  }
  const rms = Math.sqrt(best / Math.min(W, x.length));
  return { attack: ((i90 - i10) / SR) * 1000, crest: 20 * Math.log10(pk / (rms || 1e-9)) };
}

function load(path: string): Float32Array {
  let wav = path;
  if (!path.endsWith('.wav')) {
    wav = `${TMP}/${path.split('/').pop()!.replace(/\.m4a$/, '')}.wav`;
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, path, wav], { stdio: 'pipe' });
  }
  const pcm = readWav(readFileSync(wav));
  if (pcm.sampleRate !== SR) throw new Error(`${wav}: 采样率 ${pcm.sampleRate}`);
  const c = pcm.channels;
  if (c.length === 1) return c[0];
  const m = new Float32Array(c[0].length);
  for (const ch of c) for (let i = 0; i < m.length; i++) m[i] += ch[i] / c.length;
  return m;
}

/** 一段单声道信号在往上变调 up 个半音之后的各项指标。 */
export function measureSignal(x: Float32Array, up: number): Metric {
  return metricOf({ P: spectrum(x), ...timeMetrics(x) }, up);
}

function metricOf(m: { P: Float64Array; attack: number; crest: number }, up: number): Metric {
  const s = specMetrics(m.P, Math.pow(2, up / 12));
  const s0 = specMetrics(m.P, 1);
  const score = s.S * (1 + 2 * s.mid + 4 * s.hf8) * (m.attack < 3 ? 1.15 : 1);
  return { S: s.S, S0: s0.S, centroid: s.centroid, hf8: s.hf8, mid: s.mid, attack: m.attack, crest: m.crest, up, score };
}

const cache = new Map<string, { P: Float64Array; attack: number; crest: number }>();
export function measureFile(path: string, up: number): Metric {
  let m = cache.get(path);
  if (!m) {
    const x = load(path);
    m = { P: spectrum(x), ...timeMetrics(x) };
    cache.set(path, m);
  }
  return metricOf(m, up);
}

/** 播放时往上最多偏几个半音（player.ts 的规则：shift + 往上的随机偏移，往上的不超过 UP_MAX）。 */
export function upOf(name: string): number {
  const d = BANK[name];
  const pitch = Math.abs(d.pitch ?? 0.6);
  // 改前（没有 UP_MAX 时）是对称的 ±pitch：--legacy 按改前的规则量
  return (d.shift ?? 0) + (LEGACY ? pitch : Math.min(pitch, UP_MAX));
}

if (process.argv[1]?.endsWith('sharp.ts')) {
  const usage: Record<string, number> = opt('--usage') ? JSON.parse(readFileSync(opt('--usage')!, 'utf8')) : {};
  const rows: (Metric & { name: string; files: number; use: number; synth?: boolean })[] = [];
  for (const [name, def] of Object.entries(BANK)) {
    if (def.off && !LEGACY) continue; // 不出声的不量（--legacy 量改前的，那时它们还响）
    const files = def.files.filter((f) => existsSync(`${DIR}/${f}.m4a`));
    if (!files.length) continue;
    // 拾灵石（pickup）还在按连拾往上变速（最多约 1.9 倍）：它现在不出声，但量的时候照它最高的一档算
    const extra = name === 'pickup' && LEGACY ? 12 * Math.log2(1.9) : 0;
    const ms = files.map((f) => measureFile(`${DIR}/${f}.m4a`, upOf(name) + extra));
    const worst = ms.reduce((a, b) => (b.score > a.score ? b : a));
    rows.push({ name, files: files.length, use: usage[name] ?? 0, ...worst });
  }
  const sd = opt('--synth');
  if (sd && existsSync(sd))
    for (const f of readdirSync(sd).filter((f) => f.startsWith('synth.') && f.endsWith('.wav'))) {
      const name = f.replace(/\.wav$/, '');
      rows.push({ name, files: 1, use: 0, synth: true, ...measureFile(`${sd}/${f}`, 0) });
    }
  // 一局里的权重：响得越多越要紧；没量到的按 1 次算（偶尔响的大事件也要看）
  const totalUse = Object.values(usage).reduce((a, b) => a + b, 0);
  const weight = (r: (typeof rows)[number]) => r.score * (1 + Math.log2(1 + (r.use || (r.synth ? 0 : 1))));
  rows.sort((a, b) => weight(b) - weight(a));
  const before: Record<string, Metric> | null = opt('--before') && existsSync(opt('--before')!) ? JSON.parse(readFileSync(opt('--before')!, 'utf8')) : null;
  if (opt('--save')) writeFileSync(opt('--save')!, JSON.stringify(Object.fromEntries(rows.map((r) => [r.name, r])), null, 1));
  const top = Number(opt('--top') ?? 40);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const md = args.includes('--md');
  if (md) {
    console.log(`| # | 名字 | 一局次数 | 尖锐度 S（acum） | 重心 Hz | 8k+ | 2–5k | 起音 ms | 往上半音 | 档 |${before ? ' 改前 S | 改前重心 | 改前 8k+ | 改前 2–5k | 改前往上 | 改前档 |' : ''}`);
    console.log(`|---|---|---|---|---|---|---|---|---|---|${before ? '---|---|---|---|---|---|' : ''}`);
  }
  const list = before ? rows.filter((r) => before[r.name]).sort((a, b) => weight(before[b.name] as never) - weight(before[a.name] as never)) : rows;
  // 改前改后对照时按改前的排名列（看原来最刺的那些现在怎样）
  if (before) for (const r of list) Object.assign(before[r.name], { use: (before[r.name] as never as { use: number }).use ?? r.use });
  list.slice(0, top).forEach((r, i) => {
    const b = before?.[r.name];
    const cols = [String(i + 1), r.name, String(r.use || '—'), r.S.toFixed(2), r.centroid.toFixed(0), pct(r.hf8), pct(r.mid), r.attack.toFixed(1), r.up.toFixed(1), tier(r)];
    if (b) cols.push(b.S.toFixed(2), b.centroid.toFixed(0), pct(b.hf8), pct(b.mid), b.up.toFixed(1), tier(b));
    console.log(md ? `| ${cols.join(' | ')} |` : cols.map((c, j) => (j === 1 ? c.padEnd(20) : c.padStart(7))).join(' '));
  });
  const count = (f: (m: Metric) => boolean) => rows.filter((r) => !r.synth && f(r)).length;
  console.log(`\n共 ${rows.length} 个（素材 ${count(() => true)}）；温和 ${count((m) => tier(m) === '温和')}，偏亮 ${count((m) => tier(m) === '偏亮')}，刺 ${count((m) => tier(m) === '刺')}；一局里共 ${totalUse} 声`);
}

