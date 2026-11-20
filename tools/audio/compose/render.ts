// 把自作配乐（piece-a.ts、piece-b.ts）离线渲成 44.1k 立体声 WAV，交给 tools/audio/build.ts 做成品（docs/audio.md「自作配乐」）。
// 用法：node tools/audio/compose/render.ts [compose-a|compose-b ...]（不写就两首都渲）[--out scratch/downloads/compose]
//
// 无缝循环的做法：循环段（前奏之后的全部）按「环」渲：音符的尾巴、混响超出循环终点的部分绕回循环起点叠上，
// 混响、压缩这些有状态的效果把循环段连着处理两遍、取第二遍（状态已经是「从上一遍的结尾接过来」的样子）。
// 前奏单独渲，它的最后 XF 秒交叉过渡到循环段最后 XF 秒的声音——这样循环起点之前那一刻和循环终点之前那一刻是同一段声音，
// 第一次从前奏进来和每次从结尾绕回来，听到的循环起点完全一样。所以循环段最后一小节和前奏最后一小节写成同一个鼓的过门。
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeWav16 } from '../wav.ts';
import { biquad, dbToGain, loudness } from '../dsp.ts';
import { SR, compress, freeverb, limit } from './synth.ts';
import type { Score } from './score.ts';
import { pieceA } from './piece-a.ts';
import { pieceB } from './piece-b.ts';
import { MUSIC } from '../recipes.ts';

export interface BusMix {
  gain: number;
  lowpass?: number;
  highpass?: number;
  /** 高架：[起点 Hz, dB]。 */
  shelf?: [number, number];
  /** 削一段：[中心 Hz, dB, Q]。 */
  dip?: [number, number, number];
}
export interface Piece {
  name: string;
  build(): Score;
  buses: Record<string, BusMix>;
  reverb: { room: number; damp: number; wet: number };
  comp: { thr: number; ratio: number };
}

const PIECES: Record<string, Piece> = { 'compose-a': pieceA, 'compose-b': pieceB };
const XF = 0.5; // 前奏结尾过渡到循环段结尾的秒数
const TAIL = 6; // 前奏单独渲时留的尾巴

type St = { L: Float32Array; R: Float32Array };
const st = (n: number): St => ({ L: new Float32Array(n), R: new Float32Array(n) });

/** 把事件混进各总线（干声）和混响送量；wrap 时按环（下标对 n 取模）。 */
function place(p: Piece, evs: Score['events'], t0: number, n: number, wrap: boolean) {
  const buses: Record<string, St> = {};
  const send = st(n);
  for (const ev of evs) {
    const b = (buses[ev.bus] ??= st(n));
    if (!p.buses[ev.bus]) throw new Error(`${p.name}：总线 ${ev.bus} 没有配置`);
    const ch = ev.make();
    const at = Math.round((ev.t - t0) * SR);
    const pan = Math.max(-1, Math.min(1, ev.pan));
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const l = ch[0];
    const r = ch[1] ?? ch[0];
    for (let i = 0; i < l.length; i++) {
      let k = at + i;
      if (wrap) k = ((k % n) + n) % n;
      else if (k < 0 || k >= n) continue;
      const a = l[i] * ev.gain * gl;
      const c = r[i] * ev.gain * gr;
      b.L[k] += a;
      b.R[k] += c;
      send.L[k] += a * ev.send;
      send.R[k] += c * ev.send;
    }
  }
  return { buses, send };
}

/** 最近一次渲的循环段里各总线（EQ、增益之后、混响之前）的声音：量各声部的响度用。 */
export let lastStems: Record<string, Float32Array[]> = {};

/** 总线 EQ、混响、母带 EQ、压缩。twice：输入是循环段，连着处理两遍取第二遍。 */
function master(p: Piece, x: ReturnType<typeof place>, twice: boolean): St {
  const dup = (a: Float32Array) => {
    if (!twice) return a.slice();
    const y = new Float32Array(a.length * 2);
    y.set(a);
    y.set(a, a.length);
    return y;
  };
  const n = x.send.L.length * (twice ? 2 : 1);
  const out = st(n);
  const stems: Record<string, Float32Array[]> = {};
  for (const [name, b] of Object.entries(x.buses)) {
    const m = p.buses[name];
    for (const [src, dst] of [
      [b.L, out.L],
      [b.R, out.R],
    ] as const) {
      const y = dup(src);
      if (m.highpass) biquad(y, 'highpass', m.highpass);
      if (m.lowpass) biquad(y, 'lowpass', m.lowpass);
      if (m.shelf) biquad(y, 'highshelf', m.shelf[0], 0.707, m.shelf[1]);
      if (m.dip) biquad(y, 'peaking', m.dip[0], m.dip[2], m.dip[1]);
      for (let i = 0; i < n; i++) dst[i] += y[i] * m.gain;
      (stems[name] ??= []).push(y.map((v) => v * m.gain));
    }
  }
  if (twice) lastStems = stems;
  const sl = dup(x.send.L);
  const sr = dup(x.send.R);
  for (const y of [sl, sr]) {
    biquad(y, 'highpass', 220);
    biquad(y, 'lowpass', 4500);
  }
  const [wl, wr] = freeverb(sl, sr, p.reverb.room, p.reverb.damp);
  for (let i = 0; i < n; i++) {
    out.L[i] += wl[i] * p.reverb.wet;
    out.R[i] += wr[i] * p.reverb.wet;
  }
  for (const y of [out.L, out.R]) {
    biquad(y, 'highpass', 28);
    biquad(y, 'highshelf', 4500, 0.707, -2.5);
    biquad(y, 'lowpass', 12000);
  }
  compress(out.L, out.R, { thr: p.comp.thr, ratio: p.comp.ratio, attack: 0.015, release: 0.18 });
  if (!twice) return out;
  const h = n / 2;
  return { L: out.L.slice(h), R: out.R.slice(h) };
}

export function render(p: Piece) {
  const s = p.build();
  const S = s.loopStart;
  const body = s.length - S;
  const nI = Math.round(S * SR);
  const nB = Math.round(body * SR);
  const intro = s.events.filter((e) => e.t < S - 1e-6);
  const loop = s.events.filter((e) => e.t >= S - 1e-6);
  const C = master(p, place(p, loop, S, nB, true), true);
  const I = master(p, place(p, intro, 0, nI + TAIL * SR, false), false);
  // 响度：按循环段定增益（-14 LUFS，build.ts 再归一到 -17），前奏用同一个增益
  const g = dbToGain(-14 - loudness([C.L, C.R], true));
  for (const y of [C.L, C.R, I.L, I.R]) for (let i = 0; i < y.length; i++) y[i] *= g;
  // 限幅：循环段同样连着两遍取第二遍，接缝处的限幅状态也是接着的
  const LL = new Float32Array(nB * 2);
  const RR = new Float32Array(nB * 2);
  LL.set(C.L);
  LL.set(C.L, nB);
  RR.set(C.R);
  RR.set(C.R, nB);
  limit(LL, RR, dbToGain(-1));
  C.L = LL.slice(nB);
  C.R = RR.slice(nB);
  limit(I.L, I.R, dbToGain(-1));
  // 拼：前奏 →（最后 XF 秒过渡到循环段最后 XF 秒）→ 循环段
  const x = Math.round(XF * SR);
  const L = new Float32Array(nI + nB);
  const R = new Float32Array(nI + nB);
  for (let i = 0; i < nI; i++) {
    const j = i - (nI - x);
    const u = j < 0 ? 0 : Math.sin(((j + 0.5) / x) * (Math.PI / 2)) ** 2;
    L[i] = I.L[i] * (1 - u) + (j >= 0 ? C.L[nB - x + j] * u : 0);
    R[i] = I.R[i] * (1 - u) + (j >= 0 ? C.R[nB - x + j] * u : 0);
  }
  L.set(C.L, nI);
  R.set(C.R, nI);
  return { L, R, loopStart: nI / SR, loopEnd: (nI + nB) / SR, score: s };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scratch/downloads/compose';
  const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  mkdirSync(outDir, { recursive: true });
  for (const name of names.length ? names : Object.keys(PIECES)) {
    const p = PIECES[name];
    if (!p) throw new Error(`没有这首：${name}（有 ${Object.keys(PIECES).join('、')}）`);
    const t0 = Date.now();
    const r = render(p);
    writeFileSync(`${outDir}/${name}.wav`, writeWav16({ sampleRate: SR, channels: [r.L, r.R] }));
    const info = { loopStart: r.loopStart, loopEnd: r.loopEnd, bpm: r.score.bpm, sections: r.score.marks.map((m) => ({ ...m, t: r.score.barStart[m.bar] })) };
    const rec = MUSIC.find((m) => m.out === `music/${name}.m4a`)?.loop;
    if (!rec || Math.abs(rec.start - r.loopStart) > 1 / SR || Math.abs(rec.end - r.loopEnd) > 1 / SR)
      console.warn(`  ！tools/audio/recipes.ts 里 music/${name}.m4a 的循环点要改成 start ${r.loopStart}、end ${r.loopEnd}`);
    writeFileSync(`${outDir}/${name}.json`, JSON.stringify(info, null, 1));
    console.log(`  各声部的响度（混响之前，LUFS，只看彼此差多少）：${Object.entries(lastStems).map(([k, v]) => `${k} ${loudness(v, true).toFixed(1)}`).join('，')}`);
    console.log(`${name}：${(r.L.length / SR).toFixed(2)} 秒，循环 ${r.loopStart.toFixed(4)}–${r.loopEnd.toFixed(4)}，${r.score.events.length} 个事件，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  }
}
