// 自作配乐的乐器（在 Score 上加事件）：筝（VCSL 的越南筝采样）、琵琶（KS 拨弦）、二胡（合成拉弦）、弦乐群、低音、太鼓与锣（VCSL）。
// 音高、力度、滑音这些都在这里落成具体的声音；曲子本身（piece-*.ts）只写音符和鼓谱。
import { bass, bow, hz, midi, play, pluck, rng, sample, strings, thump, type PlayOpts } from './synth.ts';
import { biquad } from '../dsp.ts';
import type { Score, Tok } from './score.ts';

const V = 'vcsl/';
const D = V + 'Membranophones/Struck Membranophones/';
const I = V + 'Idiophones/Struck Idiophones/';
const ZH = V + 'Chordophones/Zithers/Dan Tranh/';

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 揉弦、滑音合成的「半音偏移」曲线（t 秒）。 */
function bendOf(flags: string, dur: number, upOnly: boolean): (t: number) => number {
  const slide = flags.includes('S') ? -3 : flags.includes('s') ? -2 : 0;
  const vib = flags.includes('v');
  const fall = flags.includes('d');
  return (t) => {
    let b = 0;
    if (slide) b += slide * (1 - smooth((t - 0.03) / 0.14));
    if (vib && t > 0.16) {
      const k = smooth((t - 0.16) / 0.3);
      const w = Math.sin(2 * Math.PI * 5.4 * (t - 0.16));
      b += upOnly ? 0.32 * k * (0.5 - 0.5 * Math.cos(2 * Math.PI * 5.4 * (t - 0.16))) : 0.28 * k * w;
    }
    if (fall && t > dur * 0.55) b -= 2 * smooth((t - dur * 0.55) / 0.18);
    return b;
  };
}

const velOf = (flags: string, v: number) => v * (flags.includes('a') ? 1.25 : 1) * (flags.includes('p') ? 0.6 : 1);

// ---------------- 筝（越南筝采样；VCSL 的音名比实际低一个八度：G#3_mf 实际是 G#4）----------------
// 录音本身的音准（scratch 里用自相关量的，起音后 0.5 秒，音分）：C#3_mf 高了约 38 音分、F#3_mf 低了 13，按这个校正，和合成的乐器才对得上
const ZH_CENTS: Record<string, number> = { 'F#2_f': 7, 'C#3_mf': 38, 'D#3_mf': 5, 'F#3_mf': -13, 'G#3_mf': -2, 'B3_mf': 5, 'C#4_mf': -6, 'D#4_mf': 5, 'F#4_mf': 2, 'G#4_mf': 3, B4_mf: 0 };
// 录好的轮指（只有三个音；音准同样量过）
const ZH_TREM = [
  ['G#2', 10],
  ['C#3', 0],
  ['F#3', 10],
].map(([n, c]) => ({ file: `${ZH}Tremolo/${n}_Trem_1.wav`, m: midi(n as string) + 12 + (c as number) / 100 }));
const ZH_NOTES = Object.keys(ZH_CENTS).map((n) => ({ file: `${ZH}Normal/${n}_1.wav`, m: midi(n.split('_')[0]) + 12 + ZH_CENTS[n] / 100 }));

function zhengVoice(m: number, len: number, bend: (t: number) => number, gain: number, lowpass = 8000): Float32Array[] {
  // 选最近的、优先往下变（往上读快了音色发尖）
  let best = ZH_NOTES[0];
  for (const z of ZH_NOTES) if (Math.abs(z.m - m + 0.4) < Math.abs(best.m - m + 0.4)) best = z;
  const base = Math.pow(2, (m - best.m) / 12);
  return play(sample(best.file), { rate: (t) => base * Math.pow(2, bend(t) / 12), len, release: 0.22, gain, lowpass });
}

export interface ZhengOpts {
  bus?: string;
  pan?: number;
  gain?: number;
  send?: number;
  /** 余音多留几秒（筝的弦会一直响）。 */
  ring?: number;
  oct?: number;
  vel?: number;
}

export function zheng(s: Score, toks: Tok[], o: ZhengOpts = {}) {
  const r = rng(11);
  for (const k of toks) {
    if (!k.m.length) continue;
    const vel = velOf(k.flags, o.vel ?? 0.8);
    for (const m0 of k.m) {
      const m = m0 + 12 * (o.oct ?? 0);
      const tr = ZH_TREM.find((z) => Math.abs(z.m - m) <= 2.5);
      if (k.flags.includes('t') && tr) {
        // 轮指：附近有 VCSL 录的真轮指（G#4、C#4、F#4 一带）就用它，比同一个采样反复重打自然
        const base = Math.pow(2, (m - tr.m) / 12);
        const bend = bendOf(k.flags.replace('v', ''), k.dur, true);
        s.add({ t: k.t, bus: o.bus ?? 'lead', pan: o.pan ?? 0, gain: o.gain ?? 1, send: o.send ?? 0.25, make: () => play(sample(tr.file), { rate: (t) => base * Math.pow(2, bend(t) / 12), len: k.dur + 0.05, release: 0.3, gain: vel * 1.1, lowpass: 8000 }) });
        continue;
      }
      if (k.flags.includes('t')) {
        // 轮指：每秒约 14 下，力度一轻一重，越到后面越轻一点；最后一下让它响
        const step = 1 / 14;
        const n = Math.max(2, Math.floor(k.dur / step));
        for (let i = 0; i < n; i++) {
          const last = i === n - 1;
          const v = vel * (i % 2 ? 0.62 : 0.8) * (0.85 + 0.15 * r()) * (1 - 0.2 * (i / n));
          const tt = k.t + i * step + (r() - 0.5) * 0.006;
          const bend = bendOf(i === 0 ? k.flags.replace('v', '') : '', step, true);
          s.add({ t: tt, bus: o.bus ?? 'lead', pan: o.pan ?? 0, gain: o.gain ?? 1, send: o.send ?? 0.25, make: () => zhengVoice(m, last ? step + (o.ring ?? 0.4) : step + 0.01, bend, v) });
        }
        continue;
      }
      const bend = bendOf(k.flags, k.dur, true);
      const tt = k.t + (r() - 0.5) * 0.008;
      s.add({ t: tt, bus: o.bus ?? 'lead', pan: o.pan ?? 0, gain: o.gain ?? 1, send: o.send ?? 0.25, make: () => zhengVoice(m, k.dur + (o.ring ?? 0.35), bend, vel * (0.92 + 0.08 * r())) });
    }
  }
}

/** 筝的刮奏（VCSL 录好的上、下刮）：段落的起落。 */
export function zhengGliss(s: Score, t: number, up: boolean, o: { gain?: number; rate?: number; len?: number; pan?: number } = {}) {
  const f = up ? 'Gliss_Up_Med_mf_1' : 'Gliss_Dwn_Med_ff_1';
  s.add({ t, bus: 'lead', pan: o.pan ?? 0, gain: o.gain ?? 0.7, send: 0.35, make: () => play(sample(`${ZH}Gliss/${f}.wav`), { rate: o.rate ?? 1, len: o.len ?? 2.2, release: 0.6, lowpass: 6000 }) });
}

// ---------------- 琵琶（KS 拨弦）----------------
export interface PipaOpts {
  bus?: string;
  pan?: number;
  gain?: number;
  send?: number;
  vel?: number;
  oct?: number;
  /** 轮指每秒几下。 */
  trem?: number;
}

function pipaVoice(f: (t: number) => number, dur: number, vel: number, seed: number, retrig?: { t: number; vel: number }[]) {
  const y = pluck({ f, dur, vel, t60: 1.4, damp: 0.07, bright: 0.62, pos: 0.13, retrig, seed });
  // 琴身：低中频鼓一点，2.5 kHz 往上收（不扎耳）
  biquad(y, 'peaking', 380, 1.0, 3);
  biquad(y, 'peaking', 1100, 1.2, 1.5);
  biquad(y, 'highshelf', 2500, 0.7, -6);
  biquad(y, 'lowpass', 5200);
  biquad(y, 'highpass', 90);
  return [y];
}

export function pipa(s: Score, toks: Tok[], o: PipaOpts = {}) {
  const r = rng(23);
  for (const k of toks) {
    if (!k.m.length) continue;
    const vel = velOf(k.flags, o.vel ?? 0.75);
    const ms = k.m.map((m) => m + 12 * (o.oct ?? 0));
    const strum = k.flags.includes('x') || k.flags.includes('u');
    const order = k.flags.includes('u') ? [...ms].reverse() : ms;
    order.forEach((m, j) => {
      const bend = bendOf(k.flags, k.dur, false);
      const f = (t: number) => hz(m) * Math.pow(2, bend(t) / 12);
      const dt = strum ? j * 0.014 : 0;
      let retrig: { t: number; vel: number }[] | undefined;
      if (k.flags.includes('t')) {
        const step = 1 / (o.trem ?? 15);
        retrig = [];
        for (let x = step; x < k.dur - 0.02; x += step) retrig.push({ t: x, vel: vel * (retrig.length % 2 ? 0.55 : 0.4) * (0.85 + 0.3 * r()) });
      }
      const seed = 1 + Math.floor(r() * 1e6);
      const v = vel * (strum ? 0.75 : 1) * (0.9 + 0.1 * r());
      const pan = (o.pan ?? 0) + (strum ? (j / Math.max(1, ms.length - 1) - 0.5) * 0.3 : 0);
      s.add({ t: k.t + dt + (r() - 0.5) * 0.006, bus: o.bus ?? 'lead', pan, gain: o.gain ?? 1, send: o.send ?? 0.22, make: () => pipaVoice(f, Math.max(0.08, k.dur - dt), v, seed, retrig) });
    });
  }
}

// ---------------- 二胡（合成拉弦）----------------
export function erhu(s: Score, toks: Tok[], o: { bus?: string; pan?: number; gain?: number; send?: number; vel?: number; oct?: number } = {}) {
  let prev: { m: number; end: number } | null = null;
  for (const k of toks) {
    if (!k.m.length) {
      prev = null;
      continue;
    }
    const m = k.m[0] + 12 * (o.oct ?? 0);
    const legato = prev && Math.abs(prev.end - k.t) < 0.02 ? prev.m : null;
    const bend = bendOf(k.flags.replace('v', ''), k.dur, false);
    const deep = k.flags.includes('v');
    const f = (t: number) => {
      let b = bend(t);
      // 连着拉的两个音之间滑过去（二胡的换音带一点滑）
      if (legato !== null) b += (legato - m) * (1 - smooth(t / 0.07));
      // 揉弦：长音才揉，起音之后慢慢加深
      if (k.dur > 0.3 && t > 0.12) b += (deep ? 0.42 : 0.22) * smooth((t - 0.12) / 0.35) * Math.sin(2 * Math.PI * 5.8 * (t - 0.12));
      return hz(m) * Math.pow(2, b / 12);
    };
    const vel = velOf(k.flags, o.vel ?? 0.7);
    s.add({ t: k.t, bus: o.bus ?? 'lead', pan: o.pan ?? 0, gain: o.gain ?? 1, send: o.send ?? 0.3, make: () => [bow({ f, dur: k.dur, vel, attack: legato !== null ? 0.03 : 0.1, release: 0.1, seed: Math.round(k.t * 1000) })] });
    prev = { m, end: k.t + k.dur };
  }
}

// ---------------- 弦乐群、低音 ----------------
export function strs(s: Score, toks: Tok[], o: { gain?: number; send?: number; attack?: number; release?: number; cut?: [number, number]; oct?: number; vel?: number; gate?: number; pan?: number } = {}) {
  for (const k of toks) {
    if (!k.m.length) continue;
    const notes = k.m.map((m) => m + 12 * (o.oct ?? 0));
    const vel = velOf(k.flags, o.vel ?? 0.6);
    s.add({ t: k.t, bus: 'pad', pan: o.pan ?? 0, gain: o.gain ?? 1, send: o.send ?? 0.35, make: () => strings({ notes, dur: k.dur * (o.gate ?? 1), vel, attack: o.attack ?? 0.3, release: o.release ?? 0.4, cut: o.cut, seed: Math.round(k.t * 997) }) });
  }
}

export function bassLine(s: Score, toks: Tok[], o: { gain?: number; oct?: number; sustain?: number; punch?: number; gate?: number } = {}) {
  for (const k of toks) {
    if (!k.m.length) continue;
    const m = k.m[0] + 12 * (o.oct ?? 0);
    const vel = velOf(k.flags, 0.8);
    s.add({ t: k.t, bus: 'bass', pan: 0, gain: o.gain ?? 1, send: 0.02, make: () => [bass({ m, dur: k.dur * (o.gate ?? 0.85), vel, sustain: o.sustain, punch: o.punch })] });
  }
}

// ---------------- 打击乐（VCSL）----------------
// 有音高的鼓和锣都按量到的主频（scratch 里量的）调到 G# 或 D#（两首的调里都有的音），不和旋律打架：
// 中太鼓、手鼓、汤鼓、木鼓 → G#2，小手鼓 → G#3，高木鼓 → D#3，定音鼓 → G#2，两面锣 → G#3 一带
interface DrumDef {
  src: string;
  rate?: number;
  len: number;
  lowpass?: number;
  highpass?: number;
  gain: number;
  pan?: number;
  send?: number;
  /** 大鼓下面垫的低频。 */
  thump?: { f0: number; f1: number; decay: number; gain: number };
}

export const DRUMS: Record<string, DrumDef> = {
  // 大太鼓：音乐会大鼓放慢一点、截短，下面垫一声往下掉的正弦
  taiko: { src: `${D}Bass Drum 2/bassdrum_hit_ff.wav`, rate: 0.9, len: 0.75, lowpass: 2200, gain: 1.0, send: 0.2, thump: { f0: 110, f1: 55, decay: 0.16, gain: 0.35 } },
  taikoSoft: { src: `${D}Bass Drum 2/bassdrum_hit_f.wav`, rate: 0.95, len: 0.6, lowpass: 2000, gain: 0.8, send: 0.2, thump: { f0: 100, f1: 56, decay: 0.14, gain: 0.25 } },
  // 中太鼓：BDrumNew 提一点调，干脆
  chu: { src: `${D}Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav`, rate: 1.207, len: 0.45, lowpass: 3800, highpass: 60, gain: 0.8, send: 0.18, pan: -0.3 },
  chuSoft: { src: `${D}Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav`, rate: 1.235, len: 0.35, lowpass: 3500, highpass: 60, gain: 0.55, send: 0.15, pan: -0.3 },
  // 手鼓（大）当中低的皮鼓
  frame: { src: `${D}Frame Drum/HDrumL_Hit_v3_rr1_Sum.wav`, rate: 1.141, len: 0.4, lowpass: 3500, gain: 0.7, send: 0.15, pan: 0.35 },
  // 締太鼓的味道：小手鼓，紧、高一点
  shime: { src: `${D}Frame Drum/HDrumS_Hit_v3_rr1_Sum.wav`, rate: 0.914, len: 0.22, lowpass: 4200, highpass: 120, gain: 0.45, send: 0.12, pan: 0.5 },
  tom: { src: `${D}Tom 1/Mallet/TomH_HitM_v4_rr1_Mid.wav`, rate: 0.952, len: 0.4, lowpass: 3800, gain: 0.6, send: 0.18, pan: -0.3 },
  timp: { src: `${D}Timpani 1/Hit/Timpani1_Hit_v4_rr1_Sum.wav`, rate: 1.104, len: 1.6, lowpass: 2500, gain: 0.85, send: 0.3 },
  log: { src: `${I}Slit Drum/LogDrumLo_MedM_v2_rr1_Sum.wav`, rate: 0.961, len: 0.35, lowpass: 3000, gain: 0.45, send: 0.15, pan: 0.55 },
  logHi: { src: `${I}Slit Drum/LogDrumHi_MedM_v2_rr1_Sum.wav`, rate: 1.0, len: 0.3, lowpass: 3200, gain: 0.35, send: 0.15, pan: -0.55 },
  // 木鱼似的一下：放慢、低通，免得「嗒」得扎耳
  block: { src: `${I}Woodblock/wood_click_mp.wav`, rate: 0.62, len: 0.2, lowpass: 2600, gain: 0.25, send: 0.1, pan: 0.4 },
  gong: { src: `${I}Gong 1/gong_2_f.wav`, rate: 0.663, len: 4.5, lowpass: 3000, gain: 0.55, send: 0.3 },
  bigGong: { src: `${I}Gong 2/hit_full2_loudest_ST.mp3`, rate: 0.647, len: 5.5, lowpass: 2600, gain: 0.75, send: 0.3 },
  crash: { src: `${I}Clash Cymbals 1/cymbal_crash1_mf1.wav`, rate: 0.85, len: 2.2, lowpass: 4200, gain: 0.18, send: 0.25 },
  swell: { src: `${I}Suspended Cymbal 1/susCymb1_cresc_2s.wav`, rate: 1.0, len: 2.2, lowpass: 3800, gain: 0.25, send: 0.3 },
  roll: { src: `${D}Bass Drum 2/bassdrum_roll_ff.wav`, rate: 1.0, len: 3, lowpass: 2000, gain: 0.6, send: 0.2 },
};

/** 打一下：name 是 DRUMS 的键，vel 0..1（力度既改响度也改一点亮度）。 */
export function hit(s: Score, name: string, t: number, vel = 1, o: { len?: number; rate?: number; gain?: number } = {}) {
  const d = DRUMS[name];
  if (!d) throw new Error(`没有这个鼓：${name}`);
  const r = rng(Math.round(t * 1e4) + name.length);
  const jitter = (r() - 0.5) * 0.006;
  const po: PlayOpts = { rate: (o.rate ?? d.rate ?? 1) * (1 + (r() - 0.5) * 0.02), len: o.len ?? d.len, release: Math.min(0.3, (o.len ?? d.len) * 0.4), lowpass: (d.lowpass ?? 8000) * (0.65 + 0.35 * vel), highpass: d.highpass, gain: vel * vel };
  s.add({
    t: t + jitter,
    bus: 'drums',
    pan: d.pan ?? 0,
    gain: d.gain * (o.gain ?? 1),
    send: d.send ?? 0.15,
    make: () => {
      const y = play(sample(d.src), po);
      if (!d.thump) return y;
      const th = thump({ f0: d.thump.f0, f1: d.thump.f1, decay: d.thump.decay, vel: d.thump.gain * vel });
      return y.map((c) => {
        const z = new Float32Array(Math.max(c.length, th.length));
        z.set(c);
        for (let i = 0; i < th.length; i++) z[i] += th[i];
        return z;
      });
    },
  });
}
