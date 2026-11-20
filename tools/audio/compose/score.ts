// 自作配乐的乐谱：小节时间轴、旋律 / 鼓谱的小记法，和要渲染的事件。
// 记法（一小节之内的拍数之和必须等于这一小节的拍数，不对就报错，免得写错一个时值整段错位）：
//   旋律：`G#3/.5 B3/.5 C#4/1s D#4/1 | ...`：音名/拍数 + 记号；`-/1` 休止；`C#3+G#3+C#4/1x` 和弦。
//   记号：s 从低一个全音滑上来（按音），S 从低小三度滑上来，v 揉弦，t 轮指（快速反复弹），d 尾巴往下滑，x 扫弦（和弦从低到高依次拨），u 反扫（从高到低），a 重音，p 轻。
//   鼓谱：一小节一串，每个字符一格（16 格 = 十六分音符）：X 重、x 中、o 轻（鬼音）、. 空；空格忽略。
import { midi } from './synth.ts';

export interface Ev {
  t: number; // 秒
  bus: string;
  pan: number; // -1..1
  gain: number; // 线性
  send: number; // 混响送量（线性）
  make: () => Float32Array[]; // 单声道或立体声
}

export interface Tok {
  m: number[]; // MIDI；休止是空数组
  beats: number;
  flags: string;
  bar: number;
  beat: number; // 小节内第几拍起
  t: number; // 秒
  dur: number; // 秒
}

export class Score {
  readonly bpm: number;
  readonly barStart: number[] = [];
  readonly barBeats: number[] = [];
  readonly marks: { name: string; bar: number; bars: number }[] = [];
  readonly events: Ev[] = [];
  /** 循环从第几小节起（之前是前奏，只放一次）。 */
  loopBar = 0;
  private end = 0;
  constructor(bpm: number) {
    this.bpm = bpm;
  }
  get beat() {
    return 60 / this.bpm;
  }
  /** 加一段：n 小节，每小节 beats 拍（4/4 是 4，7/8 是 3.5）。返回这一段第一个小节的序号。 */
  section(name: string, n: number, beats: number | number[] = 4): number {
    const first = this.barStart.length;
    for (let i = 0; i < n; i++) {
      const b = Array.isArray(beats) ? beats[i % beats.length] : beats;
      this.barStart.push(this.end);
      this.barBeats.push(b);
      this.end += b * this.beat;
    }
    this.marks.push({ name, bar: first, bars: n });
    return first;
  }
  bar(name: string): number {
    const m = this.marks.find((x) => x.name === name);
    if (!m) throw new Error(`没有段落 ${name}`);
    return m.bar;
  }
  get length() {
    return this.end;
  }
  get loopStart() {
    return this.barStart[this.loopBar];
  }
  t(bar: number, beat = 0) {
    return this.barStart[bar] + beat * this.beat;
  }
  add(ev: Ev) {
    this.events.push(ev);
  }

  /** 解析一行旋律，从第 bar0 小节起。 */
  parse(bar0: number, text: string): Tok[] {
    const out: Tok[] = [];
    const bars = text.split('|').map((s) => s.trim());
    if (bars[bars.length - 1] === '') bars.pop();
    bars.forEach((src, k) => {
      const bar = bar0 + k;
      if (bar >= this.barBeats.length) throw new Error(`旋律超出了乐曲：第 ${bar} 小节（${text.slice(0, 40)}…）`);
      let beat = 0;
      for (const tok of src.split(/\s+/).filter(Boolean)) {
        const m = /^([A-G#b0-9+-]+|-)\/(\d*\.?\d+)([a-zA-Z]*)$/.exec(tok);
        if (!m) throw new Error(`记号不对：${tok}`);
        const beats = Number(m[2]);
        const notes = m[1] === '-' ? [] : m[1].split('+').map(midi);
        out.push({ m: notes, beats, flags: m[3], bar, beat, t: this.t(bar, beat), dur: beats * this.beat });
        beat += beats;
      }
      if (Math.abs(beat - this.barBeats[bar]) > 1e-6) throw new Error(`第 ${bar} 小节是 ${this.barBeats[bar]} 拍，写了 ${beat} 拍：${src}`);
    });
    return out;
  }

  /** 鼓谱：第 bar 小节，pat 一个字符一格。 */
  grid(bar: number, pat: string, fn: (t: number, vel: number, step: number, ch: string) => void) {
    const p = pat.replace(/\s+/g, '');
    const step = (this.barBeats[bar] * this.beat) / p.length;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '.') continue;
      const vel = c === 'X' ? 1 : c === 'x' ? 0.72 : c === 'o' ? 0.45 : 0.8;
      fn(this.barStart[bar] + i * step, vel, i, c);
    }
  }
}
