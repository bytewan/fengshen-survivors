// 自作配乐 B「列阵」（项目自作配乐，2026-11-12）：低音弦乐的顿弓 + 琵琶扫弦与轮指 + 二胡长音，偏史诗。
// C# 商调式（C# D# F# G# B，和 A 版、游戏里击杀的古筝同一组五声音），140 拍/分，4/4；过门是四小节 7/8（2+2+3 的抢拍）。
// 和声是小调的史诗走法：C#m – B – A – B、C#m – E 这类（i、♭VII、♭VI），句尾落属和弦 G#（带 B#，和声小调的导音）添紧张。
// 结构：前奏 4（定音鼓、低音弦乐顿弓的 3+3+2）→ A 16（二胡唱主题，琵琶扫弦）→ B 16（琵琶轮指唱旋律，后八小节二胡对位、琵琶高八度）
// → 过门 4×7/8（全体齐奏的重击）→ A' 16（二胡主题 + 琵琶高八度轮指，弦乐铺满）→ 绕回 A。
import { Score } from './score.ts';
import { bassLine, erhu, hit, pipa, strs } from './kit.ts';
import type { Piece } from './render.ts';

type Roots = string[];
const BASS: Record<string, string> = { Cm: 'C#2', B: 'B1', E: 'E2', A: 'A1', G: 'G#1', G5: 'G#1' };
const PAD: Record<string, string> = { Cm: 'C#3+E3+G#3', B: 'B2+D#3+F#3', E: 'E3+G#3+B3', A: 'A2+C#3+E3', G: 'G#2+B#2+D#3', G5: 'G#2+D#3+G#3' };
const STRUM: Record<string, string> = { Cm: 'C#3+G#3+C#4+E4', B: 'B2+F#3+B3+D#4', E: 'E3+B3+E4+G#4', A: 'A2+E3+A3+C#4', G: 'G#2+D#3+G#3+B#3', G5: 'G#2+D#3+G#3+D#4' };
const OST: Record<string, string> = { Cm: 'C#2+C#3', B: 'B1+B2', E: 'E2+E3', A: 'A1+A2', G: 'G#1+G#2', G5: 'G#1+G#2' };

const up = (n: string) => n.replace(/(\d)$/, (d) => String(Number(d) + 1));
const bars = (roots: Roots, f: (r: string) => string) => roots.map(f).join(' | ');
/** 低音弦乐顿弓：八分音符，3+3+2 重音。 */
const ost = (r: string) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${OST[r]}/.5${i === 0 || i === 3 || i === 6 ? 'a' : 'p'}`).join(' ');
/** 琵琶扫弦：full 是 3+3+2 三下，否则只扫前两下。 */
const strum = (full: boolean) => (r: string) => (full ? `${STRUM[r]}/1.5x ${STRUM[r]}/1.5u ${STRUM[r]}/1xa` : `${STRUM[r]}/1.5x ${STRUM[r]}/2.5u`);

const A_ROOTS: Roots = ['Cm', 'B', 'E', 'Cm', 'Cm', 'E', 'B', 'G', 'Cm', 'B', 'E', 'E', 'A', 'B', 'G5', 'Cm'];
const B_ROOTS: Roots = ['A', 'B', 'Cm', 'Cm', 'A', 'B', 'G', 'G', 'A', 'B', 'Cm', 'Cm', 'A', 'B', 'G', 'G'];

const THEME =
  'C#4/1.5s D#4/.5 F#4/2v | G#4/1.5 F#4/.5 D#4/1 F#4/1 | G#4/1s B4/1 G#4/.5 F#4/.5 D#4/1 | C#4/4v | ' +
  'C#4/1.5s D#4/.5 F#4/1 G#4/1 | B4/1.5s C#5/.5 B4/1 G#4/1 | F#4/.5 G#4/.5 F#4/.5 D#4/.5 C#4/1 B3/1 | G#3/4v | ' +
  'C#4/1.5s D#4/.5 F#4/2v | G#4/1.5 F#4/.5 D#4/1 F#4/1 | G#4/1s B4/1 G#4/.5 F#4/.5 D#4/1 | B4/2v G#4/2 | ' +
  'C#5/1.5s B4/.5 G#4/1 B4/1 | G#4/1.5 F#4/.5 D#4/2v | F#4/1 D#4/.5 C#4/.5 B3/1 D#4/1 |';
const B_MEL = 'E4/2t C#4/2t | D#4/2t F#4/2t | G#4/3t E4/1 | C#4/4t | E4/2t A4/2t | F#4/2t B4/2t | G#4/2t F#4/1 D#4/1 | G#4/4t |';
const B_ERHU = 'C#4/4v | D#4/2v F#4/2 | E4/3v D#4/1 | C#4/4v | E4/2 A4/2v | F#4/2 D#4/2v | D#4/4v | G#3/2v -/2 |';

const GROOVE_A = { taiko: 'X.......X.....x.', chu: '....X.......X...', frame: '..x...x...x...x.', shime: 'x.o.x.o.x.o.x.o.' };
const GROOVE_B = { taiko: 'X..x....X..x..x.', chu: '....X..o....X.oo', shime: 'oxoxoxoxoxoxoxox', frame: '..x...x...x...x.' };
// 循环段最后一小节和前奏最后一小节同一个过门（render.ts 的接法）
const FILL_END = { taiko: 'X.......X...X.X.', chu: 'X...X...XxXxXXXX', timp: 'X.......X.......' };

function drums(s: Score, bar: number, g: Record<string, string>) {
  for (const [name, pat] of Object.entries(g)) s.grid(bar, pat, (t, v) => hit(s, name, t, v));
}

function build(): Score {
  const s = new Score(140);
  const intro = s.section('前奏', 4);
  const A = s.section('A', 16);
  const B = s.section('B', 16);
  const br = s.section('过门', 4, 3.5);
  const A2 = s.section("A'", 16);
  s.loopBar = A;
  const OSTO = { gain: 1.7, attack: 0.006, release: 0.1, gate: 0.5, cut: [1100, 2200] as [number, number], send: 0.18 };

  // ---- 前奏：定音鼓、一声锣，顿弓进来 ----
  hit(s, 'bigGong', s.t(intro), 0.85);
  hit(s, 'timp', s.t(intro), 1);
  hit(s, 'taiko', s.t(intro), 0.9);
  s.grid(intro + 1, 'X.......X.......', (t, v) => hit(s, 'timp', t, v * 0.8));
  strs(s, s.parse(intro + 1, bars(['Cm', 'Cm', 'Cm'], ost)), OSTO);
  bassLine(s, s.parse(intro + 2, 'C#2/4 | C#2/2.5 -/1.5'), { sustain: 0.8, gate: 1 });
  drums(s, intro + 2, GROOVE_A);
  drums(s, intro + 3, FILL_END);
  hit(s, 'swell', s.t(intro + 3, 1.8), 0.8);

  // ---- A：二胡唱主题，琵琶扫弦，弦乐顿弓 ----
  erhu(s, s.parse(A, THEME + ' C#4/3v -/1'), { pan: -0.1, gain: 0.85 });
  pipa(s, s.parse(A, bars(A_ROOTS.slice(0, 8), strum(false)) + ' | ' + bars(A_ROOTS.slice(8), strum(true))), { pan: 0.35, gain: 0.55, vel: 0.75 });
  strs(s, s.parse(A, bars(A_ROOTS, ost)), OSTO);
  strs(s, s.parse(A + 8, bars(A_ROOTS.slice(8), (r) => `${PAD[r]}/4`)), { gain: 0.3, attack: 0.6, cut: [400, 1200] });
  bassLine(s, s.parse(A, bars(A_ROOTS, (r) => `${BASS[r]}/1.5a ${BASS[r]}/1.5 ${up(BASS[r])}/1`)), { sustain: 0.75 });
  hit(s, 'gong', s.t(A), 0.85);
  hit(s, 'crash', s.t(A), 0.6);
  for (let i = 0; i < 16; i++) {
    const b = A + i;
    if (i % 2 === 0) hit(s, 'timp', s.t(b), 0.7);
    drums(s, b, i === 7 ? { ...GROOVE_A, chu: '....X...XoXoXXXX' } : i === 15 ? { ...GROOVE_A, chu: 'X...X...XXXXXXXX', taiko: 'X.......X.X.X.X.' } : GROOVE_A);
  }
  hit(s, 'swell', s.t(A + 15, 1.8), 0.8);

  // ---- B：琵琶轮指唱旋律；后八小节琵琶高八度、二胡对位，鼓加密 ----
  pipa(s, s.parse(B, B_MEL), { pan: 0.2, gain: 1.4, vel: 0.8 });
  pipa(s, s.parse(B + 8, B_MEL), { pan: 0.25, gain: 0.7, vel: 0.75, oct: 1 });
  erhu(s, s.parse(B + 8, B_ERHU), { pan: -0.2, gain: 0.75 });
  strs(s, s.parse(B, bars(B_ROOTS, ost)), OSTO);
  strs(s, s.parse(B, bars(B_ROOTS, (r) => `${PAD[r]}/4`)), { gain: 0.32, attack: 0.5, cut: [450, 1300] });
  bassLine(s, s.parse(B, bars(B_ROOTS, (r) => `${BASS[r]}/1.5a ${BASS[r]}/1.5 ${up(BASS[r])}/1`)), { sustain: 0.75 });
  hit(s, 'gong', s.t(B), 0.85);
  hit(s, 'crash', s.t(B), 0.7);
  for (let i = 0; i < 16; i++) {
    const b = B + i;
    if (i % 2 === 0) hit(s, 'timp', s.t(b), 0.75);
    drums(s, b, i === 7 ? { ...GROOVE_B, chu: '....X...XoXoXXXX' } : i === 15 ? { ...GROOVE_B, chu: 'X...X...XXXXXXXX', taiko: 'X..x....X.X.X.X.' } : GROOVE_B);
  }
  hit(s, 'roll', s.t(B + 14), 0.6, { len: 3.4 });

  // ---- 过门：四小节 7/8，2+2+3 的抢拍，全体齐奏 ----
  hit(s, 'bigGong', s.t(br), 1);
  const brRoots = ['Cm', 'Cm', 'A', 'G'];
  const pats = ['X...X...X.....', 'X...X...X.....', 'X...X...X.....', 'X...X...X.X.XX'];
  brRoots.forEach((r, i) => {
    s.grid(br + i, pats[i], (t, v) => {
      hit(s, 'taiko', t, v);
      hit(s, 'timp', t, v * 0.7);
      hit(s, 'chu', t, v * 0.8);
    });
    s.grid(br + i, '..o...o...o.o.', (t, v) => hit(s, 'shime', t, v));
    strs(s, s.parse(br + i, `${OST[r]}+${PAD[r]}/1a ${OST[r]}+${PAD[r]}/1a ${OST[r]}+${PAD[r]}/1.5a`), { gain: 0.5, attack: 0.01, release: 0.25, gate: 0.45, cut: [900, 1700] });
    pipa(s, s.parse(br + i, `${STRUM[r]}/1x ${STRUM[r]}/1u ${STRUM[r]}/1.5xa`), { pan: 0.35, gain: 0.5 });
    bassLine(s, s.parse(br + i, `${BASS[r]}/1a ${BASS[r]}/1a ${BASS[r]}/1.5a`), { gate: 0.5, sustain: 0.8 });
  });
  erhu(s, s.parse(br, 'G#4/3.5v | B4/3.5v | A4/3.5v | B#4/3.5v'), { pan: -0.1, gain: 0.7 });
  hit(s, 'swell', s.t(br + 3, 1.3), 0.9);

  // ---- A'：二胡主题 + 琵琶高八度轮指，弦乐铺满 ----
  erhu(s, s.parse(A2, THEME + ' C#4/2.5v -/1.5'), { pan: -0.1, gain: 0.85 });
  pipa(s, s.parse(A2 + 8, 'C#5/1.5t D#5/.5t F#5/2t | G#5/1.5t F#5/.5t D#5/1t F#5/1t | G#5/1t B5/1t G#5/.5t F#5/.5t D#5/1t | B5/2t G#5/2t | C#6/1.5t B5/.5t G#5/1t B5/1t | G#5/1.5t F#5/.5t D#5/2t | F#5/1t D#5/.5t C#5/.5t B4/1t D#5/1t | -/4'), { pan: 0.3, gain: 0.4, vel: 0.65 });
  pipa(s, s.parse(A2, bars(A_ROOTS.slice(0, 8), strum(true))), { pan: 0.35, gain: 0.45, vel: 0.7 });
  strs(s, s.parse(A2, bars(A_ROOTS, ost)), OSTO);
  strs(s, s.parse(A2, bars(A_ROOTS.slice(0, 15), (r) => `${PAD[r]}/4`) + ' | C#3+E3+G#3/2 -/2'), { gain: 0.36, attack: 0.5, cut: [450, 1400] });
  bassLine(s, s.parse(A2, bars(A_ROOTS.slice(0, 14), (r) => `${BASS[r]}/1.5a ${BASS[r]}/1.5 ${up(BASS[r])}/1`) + ' | C#2/4 | C#2/2.5 -/1.5'), { sustain: 0.75 });
  hit(s, 'gong', s.t(A2), 0.9);
  hit(s, 'crash', s.t(A2), 0.75);
  for (let i = 0; i < 15; i++) {
    if (i % 2 === 0) hit(s, 'timp', s.t(A2 + i), 0.75);
    drums(s, A2 + i, i === 7 ? { ...GROOVE_B, chu: '....X...XoXoXXXX' } : GROOVE_B);
  }
  drums(s, A2 + 15, FILL_END);
  hit(s, 'swell', s.t(A2 + 15, 1.8), 0.8);
  return s;
}

export const pieceB: Piece = {
  name: 'compose-b',
  build,
  buses: {
    drums: { gain: 1.0, highpass: 40, shelf: [3000, -3] },
    lead: { gain: 0.6, highpass: 110, dip: [2800, -2, 1.0] },
    bass: { gain: 0.32, highpass: 40 },
    pad: { gain: 1.25, highpass: 50 },
  },
  reverb: { room: 0.86, damp: 0.4, wet: 1.1 },
  comp: { thr: -16, ratio: 2.2 },
};
