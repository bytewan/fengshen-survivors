// 找音乐的循环点：在 [sa, sb] 里找 S、在 [ea, eb] 里找 E，使 E 之前一段的声音和 S 之前一段最像，
// 这样从 E 跳回 S 时节拍与和声都接得上。
// 用法：node tools/audio/loopfind.ts <音频> <sa> <sb> <ea> <eb> [窗口秒数=8]
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readWav } from './wav.ts';

const SR = 22050;
const [path, a, b, c, d, w] = process.argv.slice(2);
const [sa, sb, ea, eb] = [a, b, c, d].map(Number);
const WIN = Number(w ?? 8);
mkdirSync('scratch/work/ana', { recursive: true }); // 解码出的临时 WAV 放 scratch（不进 git）
const wav = `scratch/work/ana/l-${createHash('sha1').update(path).digest('hex').slice(0, 12)}.wav`;
if (!existsSync(wav)) execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, '-c', '1', path, wav]);
const x = readWav(readFileSync(wav)).channels[0];

const N = 1024;
const HOP = 256; // 11.6ms
const B = 32;
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
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(ang * k);
        const ci = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
  }
}
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const nf = Math.floor((x.length - N) / HOP);
// 对数频带能量（60Hz..10kHz，32 段）
const edges = Array.from({ length: B + 1 }, (_, i) => Math.round(((60 * Math.pow(10000 / 60, i / B)) * N) / SR));
const feat: Float32Array[] = [];
for (let f = 0; f < nf; f++) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[f * HOP + i] * win[i];
  fft(re, im);
  const v = new Float32Array(B);
  for (let k = 0; k < B; k++) {
    let s = 0;
    for (let j = edges[k]; j < Math.max(edges[k] + 1, edges[k + 1]); j++) s += re[j] * re[j] + im[j] * im[j];
    v[k] = Math.log(1e-6 + s);
  }
  feat.push(v);
}
// 起音强度：频带对数能量正向差分之和
const on = new Float32Array(nf);
for (let f = 1; f < nf; f++) {
  let s = 0;
  for (let k = 0; k < B; k++) s += Math.max(0, feat[f][k] - feat[f - 1][k]);
  on[f] = s;
}
const fps = SR / HOP;
const W = Math.round(WIN * fps);
// 只在起音峰上找候选点（拍点附近）
function peaks(t0: number, t1: number) {
  const out: number[] = [];
  for (let f = Math.max(W + 2, Math.round(t0 * fps)); f < Math.min(nf - 2, Math.round(t1 * fps)); f++) {
    let m = true;
    for (let k = -4; k <= 4; k++) if (on[f + k] > on[f]) m = false;
    if (m && on[f] > 0) out.push(f);
  }
  return out;
}
function sim(s: number, e: number) {
  // 两段（各取结尾前 W 帧）的频带能量序列做相关，外加起音序列相关
  let dot = 0;
  let ns = 0;
  let ne = 0;
  let od = 0;
  let os = 0;
  let oe = 0;
  for (let i = 1; i <= W; i++) {
    const A = feat[s - i];
    const C = feat[e - i];
    for (let k = 0; k < B; k++) {
      dot += A[k] * C[k];
      ns += A[k] * A[k];
      ne += C[k] * C[k];
    }
    od += on[s - i] * on[e - i];
    os += on[s - i] ** 2;
    oe += on[e - i] ** 2;
  }
  return 0.5 * (dot / Math.sqrt(ns * ne)) + 0.5 * (od / Math.sqrt(os * oe + 1e-9));
}
const S = peaks(sa, sb);
const E = peaks(ea, eb);
const res: [number, number, number][] = [];
for (const e of E) for (const s of S) res.push([sim(s, e), s, e]);
res.sort((p, q) => q[0] - p[0]);
console.log(`候选 S=${S.length} E=${E.length}`);
for (const [v, s, e] of res.slice(0, 8)) console.log(`score=${v.toFixed(4)}  S=${(s / fps).toFixed(3)}s  E=${(e / fps).toFixed(3)}s  长度=${((e - s) / fps).toFixed(3)}s`);
