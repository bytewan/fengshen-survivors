// 量配乐（没法试听，只能量）：响度、峰值、动态、各频段能量、频谱重心、尖锐度（sharp.ts 同一套）、每秒起音、立体声宽度，
// 外加每 8 秒一格的响度 / 起音密度曲线和一张频谱图（PNG，看段落和配器的分布）。
// 用法：node tools/audio/compose/measure.ts [--png 目录] [--md] 文件...（.wav 或 .m4a；名字取文件名）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readWav } from '../wav.ts';
import { loudness, toDb } from '../dsp.ts';
import { measureSignal } from '../sharp.ts';
import { encodePng } from '../../png.ts';
import { SR } from './synth.ts';

const TMP = 'scratch/work/compose-measure';
mkdirSync(TMP, { recursive: true });

function load(path: string): Float32Array[] {
  let wav = path;
  if (!path.endsWith('.wav')) {
    wav = `${TMP}/${createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 16)}.wav`;
    if (!existsSync(wav)) execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, path, wav], { stdio: 'pipe' });
  }
  const p = readWav(readFileSync(wav));
  if (p.sampleRate !== SR) throw new Error(`${path} 不是 44.1k`);
  return p.channels.length === 1 ? [p.channels[0], p.channels[0]] : p.channels;
}

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
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
        const xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
  }
}

const N = 2048;
const HOP = 512;
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));

/** 逐帧的功率谱（单声道）。 */
function frames(x: Float32Array): Float64Array[] {
  const out: Float64Array[] = [];
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += HOP) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const P = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
    out.push(P);
  }
  return out;
}

/** 起音：对数幅度谱的正向差分（谱通量），减去局部中位数后找峰，两个起音至少隔 60ms。 */
function onsets(F: Float64Array[]): number[] {
  const flux: number[] = [0];
  for (let f = 1; f < F.length; f++) {
    let s = 0;
    for (let k = 2; k < N / 2; k++) {
      const d = Math.log(1 + 1e3 * F[f][k]) - Math.log(1 + 1e3 * F[f - 1][k]);
      if (d > 0) s += d;
    }
    flux.push(s);
  }
  const W = 12;
  const out: number[] = [];
  const sorted = [...flux].sort((a, b) => a - b);
  const global = sorted[Math.floor(sorted.length * 0.5)];
  let last = -1e9;
  for (let f = 1; f < flux.length - 1; f++) {
    const loc = flux.slice(Math.max(0, f - W), f + W + 1).sort((a, b) => a - b);
    const thr = loc[Math.floor(loc.length / 2)] * 1.3 + global * 0.3;
    if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1]) {
      const t = (f * HOP) / SR;
      if (t - last >= 0.06) {
        out.push(t);
        last = t;
      }
    }
  }
  return out;
}

const BANDS: [string, number, number][] = [
  ['<60', 20, 60],
  ['60–250', 60, 250],
  ['250–1k', 250, 1000],
  ['1–4k', 1000, 4000],
  ['4k+', 4000, 22050],
];

export function measure(path: string, png?: string) {
  const [L, R] = load(path);
  const n = L.length;
  const M = new Float32Array(n);
  let side = 0;
  let mid = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    M[i] = (L[i] + R[i]) / 2;
    mid += M[i] * M[i];
    side += ((L[i] - R[i]) / 2) ** 2;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const lufs = loudness([L, R], true);
  // 3 秒一格的短时响度：取 10%、95% 分位之差作动态（近似 LRA）
  const st: number[] = [];
  for (let s = 0; s + 3 * SR <= n; s += SR) st.push(loudness([L.subarray(s, s + 3 * SR), R.subarray(s, s + 3 * SR)], true));
  st.sort((a, b) => a - b);
  const lra = st.length ? st[Math.floor(st.length * 0.95)] - st[Math.floor(st.length * 0.1)] : 0;
  const F = frames(M);
  const avg = new Float64Array(N / 2);
  for (const P of F) for (let k = 0; k < N / 2; k++) avg[k] += P[k];
  let tot = 0;
  let cen = 0;
  for (let k = 1; k < N / 2; k++) {
    tot += avg[k];
    cen += (avg[k] * k * SR) / N;
  }
  const bands = BANDS.map(([, a, b]) => {
    let e = 0;
    for (let k = Math.ceil((a * N) / SR); k < Math.min(N / 2, (b * N) / SR); k++) e += avg[k];
    return e / tot;
  });
  const on = onsets(F);
  const dur = n / SR;
  // 每 8 秒一格：响度、起音密度
  const curve: { t: number; lufs: number; ops: number }[] = [];
  for (let s = 0; s + 8 * SR <= n; s += 8 * SR) {
    const t = s / SR;
    curve.push({ t, lufs: loudness([L.subarray(s, s + 8 * SR), R.subarray(s, s + 8 * SR)], true), ops: on.filter((x) => x >= t && x < t + 8).length / 8 });
  }
  const sharp = measureSignal(M, 0);
  if (png) spectrogram(F, png);
  return { name: basename(path).replace(/\.(wav|m4a)$/, ''), dur, lufs, peak: toDb(peak), crest: toDb(peak) - lufs, lra, bands, centroid: cen / tot, S: sharp.S, hf8: sharp.hf8, mid25: sharp.mid, ops: on.length / dur, width: side / (mid + 1e-12), curve };
}

/** 频谱图：横轴每 0.1 秒一列，纵轴 40 Hz–12 kHz 对数，亮度是 dB（-80..0）。 */
function spectrogram(F: Float64Array[], out: string) {
  const colF = Math.max(1, Math.round((0.1 * SR) / HOP));
  const w = Math.floor(F.length / colF);
  const h = 240;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let mx = 0;
  for (const P of F) for (const v of P) mx = Math.max(mx, v);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const f0 = 40 * Math.pow(12000 / 40, (h - 1 - y) / h);
      const f1 = 40 * Math.pow(12000 / 40, (h - y) / h);
      let e = 0;
      let c = 0;
      for (let j = 0; j < colF; j++) {
        const P = F[x * colF + j];
        for (let k = Math.floor((f0 * N) / SR); k <= Math.ceil((f1 * N) / SR); k++) {
          e += P[k] ?? 0;
          c++;
        }
      }
      const db = 10 * Math.log10(e / Math.max(1, c) / mx + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 80) / 80));
      const i = (y * w + x) * 4;
      rgba[i] = 255 * Math.min(1, v * 1.6);
      rgba[i + 1] = 255 * Math.max(0, v * 1.6 - 0.6);
      rgba[i + 2] = 255 * Math.max(0, 0.5 - Math.abs(v - 0.35)) * 1.2;
      rgba[i + 3] = 255;
    }
  }
  writeFileSync(out, encodePng(w, h, rgba));
}

if (process.argv[1]?.endsWith('measure.ts')) {
  const args = process.argv.slice(2);
  const pngDir = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--png');
  if (pngDir) mkdirSync(pngDir, { recursive: true });
  const rows = files.map((f) => measure(f, pngDir ? `${pngDir}/${basename(f).replace(/\.(wav|m4a)$/, '')}.png` : undefined));
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  const head = ['曲子', '时长 s', '响度 LUFS', '峰值 dBFS', '峰值−响度 dB', '动态（短时 10–95%）dB', ...BANDS.map((b) => b[0] + ' Hz'), '重心 Hz', '尖锐度 S', '8k+', '2–5k', '每秒起音', '立体声宽（侧/中）'];
  const body = rows.map((r) => [r.name, r.dur.toFixed(1), r.lufs.toFixed(1), r.peak.toFixed(1), r.crest.toFixed(1), r.lra.toFixed(1), ...r.bands.map(pc), r.centroid.toFixed(0), r.S.toFixed(2), pc(r.hf8), pc(r.mid25), r.ops.toFixed(2), r.width.toFixed(2)]);
  if (args.includes('--md')) {
    console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
    for (const b of body) console.log(`| ${b.join(' | ')} |`);
  } else for (const b of body) console.log(b.map((v, i) => `${head[i]} ${v}`).join('  '));
  if (args.includes('--curve'))
    for (const r of rows) console.log(`${r.name} 每 8 秒（响度/每秒起音）：${r.curve.map((c) => `${c.lufs.toFixed(0)}/${c.ops.toFixed(1)}`).join(' ')}`);
}
