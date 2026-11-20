// 自作配乐的乐器与效果（docs/audio.md「自作配乐」）：全部在 Node 里逐样本算，同样的输入每次算出的结果完全一样（随机数用固定种子）。
// - 采样乐器：VCSL（CC0）的单音采样，按音高重采样（三次插值），可以随时间变调（按音、滑音、揉弦）；
// - 拨弦（琵琶 / 古筝的味道）：Karplus-Strong 物理建模，延迟线长度随时间变（滑音），可以在弦还在响时再拨（轮指）；
// - 拉弦（二胡的味道）：带限锯齿 + 三个共振峰 + 弓噪，揉弦、滑音由调用方给的音高曲线来；
// - 弦乐群：每个音五把失谐的锯齿、低通随包络开合；低音：正弦为主加一点二次谐波，过软饱和；
// - 效果：Freeverb 混响、总线压缩、前瞻限幅。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWav } from '../wav.ts';
import { biquad } from '../dsp.ts';

export const SR = 44100;

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名 → MIDI 号：'G#3' = 56，'Bb2'、'F##3'（重升）也认。 */
export function midi(name: string): number {
  const m = /^([A-G])(##|#|bb|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`音名不对：${name}`);
  const acc = { '': 0, '#': 1, '##': 2, b: -1, bb: -2 }[m[2] ?? ''] ?? 0;
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + acc;
}
export const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 固定种子的伪随机（0..1）。 */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// ---------------- 采样 ----------------
const DL = 'scratch/downloads';
const TMP = 'scratch/work/compose';
const samples = new Map<string, Float32Array[]>();

/** 读一个采样（相对下载目录），解码成 44.1k 浮点，去掉开头的静音，峰值拉到 1。 */
export function sample(src: string): Float32Array[] {
  let s = samples.get(src);
  if (s) return s;
  const path = join(DL, src);
  if (!existsSync(path)) throw new Error(`缺素材：${path}（见 tools/audio/compose/README 的说明：从 VCSL 下载）`);
  mkdirSync(TMP, { recursive: true });
  const wav = `${TMP}/${createHash('sha1').update(path).digest('hex').slice(0, 16)}.wav`;
  if (!existsSync(wav)) execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, path, wav], { stdio: 'pipe' });
  const pcm = readWav(readFileSync(wav));
  let pk = 0;
  for (const c of pcm.channels) for (const v of c) pk = Math.max(pk, Math.abs(v));
  const thr = pk * 0.01;
  let a = 0;
  while (a < pcm.channels[0].length - 1 && !pcm.channels.some((c) => Math.abs(c[a]) > thr)) a++;
  a = Math.max(0, a - 32);
  s = pcm.channels.map((c) => {
    const x = c.slice(a);
    for (let i = 0; i < x.length; i++) x[i] /= pk || 1;
    for (let i = 0; i < Math.min(32, x.length); i++) x[i] *= i / 32;
    return x;
  });
  samples.set(src, s);
  return s;
}

export interface PlayOpts {
  /** 变速（同时变调）：常数，或「第几秒 → 变速」的曲线（滑音、揉弦）。 */
  rate?: number | ((t: number) => number);
  gain?: number;
  /** 最长放几秒，之后 release 秒淡出。 */
  len?: number;
  release?: number;
  lowpass?: number;
  highpass?: number;
}

/** 放一个采样：返回每声道一条（原采样是几声道就几声道）。 */
export function play(src: Float32Array[], o: PlayOpts = {}): Float32Array[] {
  const rate = o.rate ?? 1;
  const n0 = src[0].length;
  const rel = Math.round((o.release ?? 0.08) * SR);
  const maxN = o.len !== undefined ? Math.round(o.len * SR) + rel : Infinity;
  // 先按变速曲线算出每个输出样本的读取位置
  const pos: number[] = [];
  let p = 0;
  let r = typeof rate === 'number' ? rate : rate(0);
  for (let i = 0; p < n0 - 2 && i < maxN; i++) {
    if (typeof rate !== 'number' && (i & 15) === 0) r = rate(i / SR);
    pos.push(p);
    p += r;
  }
  const n = pos.length;
  const g = o.gain ?? 1;
  const out = src.map((c) => {
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const q = pos[i];
      const j = Math.floor(q);
      const t = q - j;
      const x0 = c[j - 1] ?? c[j];
      const x1 = c[j];
      const x2 = c[j + 1] ?? 0;
      const x3 = c[j + 2] ?? 0;
      // 三次 Hermite 插值
      const a0 = -0.5 * x0 + 1.5 * x1 - 1.5 * x2 + 0.5 * x3;
      const a1 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
      const a2 = -0.5 * x0 + 0.5 * x2;
      y[i] = (((a0 * t + a1) * t + a2) * t + x1) * g;
    }
    if (o.len !== undefined) {
      const s = Math.round(o.len * SR);
      for (let i = s; i < n; i++) y[i] *= Math.pow(1 - (i - s) / rel, 2);
    }
    // 升调时先防混叠（粗略：读得越快、越该压高频）
    const maxRate = typeof rate === 'number' ? rate : 1.3;
    if (maxRate > 1.05) biquad(y, 'lowpass', Math.min(18000, 20000 / maxRate));
    if (o.highpass) biquad(y, 'highpass', o.highpass);
    if (o.lowpass) biquad(y, 'lowpass', o.lowpass);
    return y;
  });
  return out;
}

// ---------------- 滤波 ----------------
/** 拓扑保持的状态变量滤波器（可以逐样本改截止频率）。 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  set(fc: number, q: number) {
    this.g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  /** 返回 [低通, 带通]。 */
  tick(x: number): [number, number] {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return [v2, v1];
  }
}

const blep = (t: number, dt: number) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};

// ---------------- Karplus-Strong 拨弦 ----------------
export interface PluckOpts {
  /** 音高（Hz）：常数或随时间的曲线（按音、滑音）。 */
  f: number | ((t: number) => number);
  /** 按住多久（秒），之后止音。 */
  dur: number;
  vel?: number;
  /** 余音衰减到 -60dB 的秒数（低音弦更长）。 */
  t60?: number;
  /** 止音后多快消失（秒）。 */
  damp?: number;
  /** 0..1：越大越亮（拨弦的激励越尖、回路的低通越开）。 */
  bright?: number;
  /** 拨弦位置（弦长的比例），越靠近琴马越「脆」。 */
  pos?: number;
  /** 在这些时刻（秒）再拨一次（轮指 / 扫弦里的同一根弦）。 */
  retrig?: { t: number; vel: number }[];
  seed?: number;
}

export function pluck(o: PluckOpts): Float32Array {
  const f = o.f;
  const fAt = typeof f === 'number' ? () => f : f;
  const f0 = fAt(0);
  const bright = o.bright ?? 0.5;
  const t60 = o.t60 ?? 2.5;
  const damp = o.damp ?? 0.12;
  const n = Math.round((o.dur + damp * 3 + 0.02) * SR);
  const L = Math.ceil(SR / 30) + 8;
  const line = new Float32Array(L);
  const out = new Float32Array(n);
  const rnd = rng(o.seed ?? 1);
  // 激励：一段长约一个周期的噪声，按亮度低通，再按拨弦位置做梳状（拨在弦的哪里，那个位置的谐波就没有）
  const exc = (vel: number) => {
    const N = Math.max(4, Math.round(SR / f0));
    const e = new Float32Array(N);
    let lp = 0;
    const a = 0.15 + 0.8 * bright * Math.min(1, vel + 0.2);
    for (let i = 0; i < N; i++) {
      lp += a * (rnd() * 2 - 1 - lp);
      e[i] = lp;
    }
    const P = Math.max(1, Math.round(N * (o.pos ?? 0.18)));
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) c[i] = (e[i] - (i >= P ? e[i - P] : 0)) * vel;
    return c;
  };
  const events = [{ t: 0, vel: o.vel ?? 0.8 }, ...(o.retrig ?? [])].map((r) => ({ at: Math.round(r.t * SR), e: exc(r.vel) }));
  // 回路里的一阶低通：a 越大越亮；它带来的相位延迟约 (1-a)/a 个样本，从延迟线长度里扣掉，音才准
  const a = 0.35 + 0.6 * bright;
  const lpDelay = (1 - a) / a;
  let lp = 0;
  let w = 0;
  let fc = f0;
  const offAt = Math.round(o.dur * SR);
  let dc = 0;
  let dcy = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) fc = fAt(i / SR);
    const D = Math.max(2, SR / fc - lpDelay);
    const rp = w - D;
    const j = Math.floor(rp);
    const t = rp - j;
    const r0 = line[((j % L) + L) % L];
    const r1 = line[(((j + 1) % L) + L) % L];
    const rd = r0 * (1 - t) + r1 * t;
    const T = i < offAt ? t60 : damp;
    const g = Math.pow(10, -3 / (fc * T));
    lp += a * (rd - lp);
    let x = lp * g;
    for (const ev of events) {
      const k = i - ev.at;
      if (k >= 0 && k < ev.e.length) x += ev.e[k];
    }
    line[w % L] = x;
    w++;
    // 去直流
    dcy = x - dc + 0.995 * dcy;
    dc = x;
    out[i] = dcy;
  }
  return out;
}

// ---------------- 拉弦（二胡的味道）----------------
export interface BowOpts {
  f: (t: number) => number;
  dur: number;
  vel?: number;
  attack?: number;
  release?: number;
  seed?: number;
}

export function bow(o: BowOpts): Float32Array {
  const rel = o.release ?? 0.12;
  const n = Math.round((o.dur + rel + 0.02) * SR);
  const out = new Float32Array(n);
  const rnd = rng(o.seed ?? 7);
  const att = o.attack ?? 0.09;
  const vel = o.vel ?? 0.8;
  // 三个共振峰（二胡的琴筒是蟒皮，鼻音重：0.75k、1.3k 一带最突出），高处收着
  const F = [
    { f: 720, q: 3.2, g: 1.0 },
    { f: 1250, q: 4.5, g: 0.75 },
    { f: 2500, q: 6, g: 0.22 },
  ].map((x) => {
    const s = new Svf();
    s.set(x.f, x.q);
    return { s, g: x.g };
  });
  const body = new Svf();
  body.set(3200, 0.6);
  const noiseF = new Svf();
  noiseF.set(1600, 0.8);
  let ph = rnd();
  let f = o.f(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 7) === 0) f = o.f(t);
    const dt = f / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1 - blep(ph, dt);
    // 弓的压力：起弓有一点涨、中间轻微起伏（弓速不匀），止弓收得快
    let env = t < att ? Math.pow(t / att, 1.5) : 1;
    env *= 0.92 + 0.08 * Math.sin(2 * Math.PI * 0.7 * t);
    if (t > o.dur) env *= Math.max(0, 1 - (t - o.dur) / rel);
    const nz = noiseF.tick(rnd() * 2 - 1)[1] * (0.05 + 0.25 * Math.max(0, 1 - t / (att * 2)));
    const src = saw + nz;
    let y = 0;
    for (const x of F) y += x.s.tick(src)[1] * x.g;
    y = body.tick(y * 0.9 + saw * 0.08)[0];
    out[i] = y * env * vel;
  }
  return out;
}

// ---------------- 弦乐群 ----------------
export interface StringOpts {
  notes: number[]; // MIDI
  dur: number;
  vel?: number;
  attack?: number;
  release?: number;
  /** 低通从多少开到多少（Hz）。 */
  cut?: [number, number];
  seed?: number;
  /** 每个音几把（失谐的锯齿）。 */
  voices?: number;
}

/** 返回立体声 [左, 右]：每把琴随机落在左右。 */
export function strings(o: StringOpts): [Float32Array, Float32Array] {
  const rel = o.release ?? 0.35;
  const att = o.attack ?? 0.25;
  const n = Math.round((o.dur + rel + 0.05) * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = rng(o.seed ?? 3);
  const V = o.voices ?? 5;
  const vel = o.vel ?? 0.7;
  const [c0, c1] = o.cut ?? [600, 1800];
  for (const m of o.notes) {
    const base = hz(m);
    const flt = [new Svf(), new Svf()];
    const bufL = new Float32Array(n);
    const bufR = new Float32Array(n);
    for (let v = 0; v < V; v++) {
      const det = ((v / Math.max(1, V - 1)) * 2 - 1) * 9 + (rnd() - 0.5) * 3; // ±9 音分
      const vibR = 4.6 + rnd() * 1.2;
      const vibP = rnd() * 6.28;
      const pan = (v / Math.max(1, V - 1)) * 2 - 1;
      const gl = Math.cos(((pan + 1) * Math.PI) / 4);
      const gr = Math.sin(((pan + 1) * Math.PI) / 4);
      let ph = rnd();
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const f = base * Math.pow(2, (det + 6 * Math.min(1, t / 0.6) * Math.sin(2 * Math.PI * vibR * t + vibP)) / 1200);
        const dt = f / SR;
        ph += dt;
        if (ph >= 1) ph -= 1;
        const s = (2 * ph - 1 - blep(ph, dt)) / V;
        bufL[i] += s * gl;
        bufR[i] += s * gr;
      }
    }
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env = t < att ? Math.sin(((t / att) * Math.PI) / 2) : 1;
      if (t > o.dur) env *= Math.max(0, 1 - (t - o.dur) / rel);
      if ((i & 15) === 0) {
        const fc = c0 + (c1 - c0) * Math.min(1, t / Math.max(0.05, att * 1.5)) * (t > o.dur ? Math.max(0, 1 - (t - o.dur) / rel) : 1);
        flt[0].set(fc, 0.6);
        flt[1].set(fc, 0.6);
      }
      L[i] += flt[0].tick(bufL[i])[0] * env * vel;
      R[i] += flt[1].tick(bufR[i])[0] * env * vel;
    }
  }
  return [L, R];
}

// ---------------- 低音 ----------------
export interface BassOpts {
  m: number;
  dur: number;
  vel?: number;
  /** 起音时音高从高几个半音落下来（打击感）。 */
  punch?: number;
  release?: number;
  /** 衰减到多少（0..1）。 */
  sustain?: number;
  drive?: number;
  lowpass?: number;
}

export function bass(o: BassOpts): Float32Array {
  const rel = o.release ?? 0.05;
  const n = Math.round((o.dur + rel + 0.01) * SR);
  const y = new Float32Array(n);
  const f = hz(o.m);
  const punch = o.punch ?? 4;
  const sus = o.sustain ?? 0.55;
  const drive = o.drive ?? 2.4;
  const vel = o.vel ?? 0.8;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fi = f * Math.pow(2, (punch * Math.exp(-t / 0.012)) / 12);
    ph += fi / SR;
    // 二、三次谐波多给一点：手机的小喇叭放不出 60 Hz，靠谐波让人「听出」低音
    const s = Math.sin(2 * Math.PI * ph) + 0.45 * Math.sin(4 * Math.PI * ph) + 0.2 * Math.sin(6 * Math.PI * ph);
    let env = Math.min(1, t / 0.004) * (sus + (1 - sus) * Math.exp(-t / 0.18));
    if (t > o.dur) env *= Math.max(0, 1 - (t - o.dur) / rel);
    y[i] = Math.tanh(drive * s * env) / Math.tanh(drive) * vel;
  }
  biquad(y, 'lowpass', o.lowpass ?? 900);
  return y;
}

/** 大鼓下面垫的一声低频（正弦，音高往下掉），让太鼓的「咚」更沉。 */
export function thump(o: { f0?: number; f1?: number; decay?: number; vel?: number }): Float32Array {
  const decay = o.decay ?? 0.32;
  const n = Math.round(decay * 5 * SR);
  const y = new Float32Array(n);
  const f0 = o.f0 ?? 95;
  const f1 = o.f1 ?? 48;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.04);
    ph += f / SR;
    y[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / decay) * Math.min(1, t / 0.002) * (o.vel ?? 0.8);
  }
  return y;
}

// ---------------- 混响（Freeverb）----------------
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLS = [556, 441, 341, 225];

/** Freeverb：输入立体声，返回湿声立体声。room 0..1 越大尾巴越长，damp 越大高频衰减越快。 */
export function freeverb(inL: Float32Array, inR: Float32Array, room = 0.82, damp = 0.4, predelay = 0.02): [Float32Array, Float32Array] {
  const n = inL.length;
  const fb = room * 0.28 + 0.7;
  const d = damp * 0.4;
  const pd = Math.round(predelay * SR);
  const run = (x: Float32Array, spread: number) => {
    const out = new Float32Array(n);
    const combs = COMBS.map((len) => ({ buf: new Float32Array(len + spread), i: 0, st: 0 }));
    const alls = ALLS.map((len) => ({ buf: new Float32Array(len + spread), i: 0 }));
    for (let k = 0; k < n; k++) {
      const inp = (k >= pd ? x[k - pd] : 0) * 0.015;
      let s = 0;
      for (const c of combs) {
        const o = c.buf[c.i];
        c.st = o * (1 - d) + c.st * d;
        c.buf[c.i] = inp + c.st * fb;
        if (++c.i >= c.buf.length) c.i = 0;
        s += o;
      }
      for (const a of alls) {
        const b = a.buf[a.i];
        a.buf[a.i] = s + b * 0.5;
        s = b - s;
        if (++a.i >= a.buf.length) a.i = 0;
      }
      out[k] = s * 3;
    }
    return out;
  };
  return [run(inL, 0), run(inR, 23)];
}

// ---------------- 总线压缩、限幅 ----------------
/** 立体声联动的 RMS 压缩（就地）。 */
export function compress(L: Float32Array, R: Float32Array, o: { thr: number; ratio: number; attack?: number; release?: number; makeup?: number }) {
  const at = Math.exp(-1 / ((o.attack ?? 0.012) * SR));
  const rt = Math.exp(-1 / ((o.release ?? 0.15) * SR));
  const rmsT = Math.exp(-1 / (0.01 * SR));
  let ms = 0;
  let gr = 0; // dB
  const mk = Math.pow(10, (o.makeup ?? 0) / 20);
  for (let i = 0; i < L.length; i++) {
    ms = rmsT * ms + (1 - rmsT) * 0.5 * (L[i] * L[i] + R[i] * R[i]);
    const lv = 10 * Math.log10(ms + 1e-12);
    const over = lv - o.thr;
    const want = over > 0 ? over * (1 - 1 / o.ratio) : 0;
    gr = want > gr ? at * gr + (1 - at) * want : rt * gr + (1 - rt) * want;
    const g = Math.pow(10, -gr / 20) * mk;
    L[i] *= g;
    R[i] *= g;
  }
}

/** 前瞻峰值限幅（就地）：峰值不超过 ceil（线性）。 */
export function limit(L: Float32Array, R: Float32Array, ceil: number, look = 0.004, release = 0.08) {
  const n = L.length;
  const la = Math.round(look * SR);
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // 往前看 la 个样本里要的最小增益，再平滑
  const minAhead = new Float32Array(n);
  const dq: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop();
    dq.push(i);
    while (dq[0] > i + la) dq.shift();
    minAhead[i] = need[dq[0]];
  }
  const rt = Math.exp(-1 / (release * SR));
  const atk = Math.exp(-1 / (la / 3 + 1));
  let g = 1;
  for (let i = 0; i < n; i++) {
    const tg = minAhead[i];
    g = tg < g ? atk * g + (1 - atk) * tg : rt * g + (1 - rt) * tg;
    L[i] *= g;
    R[i] *= g;
    // 平滑跟不上的最后兜底
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (p > ceil) {
      L[i] *= ceil / p;
      R[i] *= ceil / p;
    }
  }
}
