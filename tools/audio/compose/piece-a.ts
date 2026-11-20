// 自作配乐 A「破阵」（项目自作配乐，2026-11-12）：太鼓 + 古筝领奏，偏凶。
// G# 羽调式（G# B C# D# F#，和游戏里击杀的古筝、拾取的手钟同一组五声音），150 拍/分，4/4。
// 和声只用空五度（不放三度，不往大调的明亮那边走）；B 段借清角 E 和和声小调的 F##（写作 G）、属和弦 D#（D# G A#）添紧张。
// 结构：前奏 4 小节（太鼓、锣、低音先进）→ A 16（主题，3+3+2 的重音）→ B 16（换和声、鼓加密、轮指）→ 过门 4（全体齐奏的重击、刮奏）
// → A' 16（主题加低八度，鼓按 B 段的密度）→ 绕回 A。循环段 52 小节、83.2 秒，前奏 6.4 秒只放一次。
import { Score } from './score.ts';
import { bassLine, hit, pipa, strs, zheng, zhengGliss } from './kit.ts';
import type { Piece } from './render.ts';

const BASS: Record<string, string> = { 'G#': 'G#1', 'A#': 'A#1', B: 'B1', 'C#': 'C#2', 'D#': 'D#2', E: 'E2', 'F#': 'F#2' };
const up = (n: string) => n.replace(/(\d)$/, (d) => String(Number(d) + 1));
type Roots = (string | [string, string])[];

/** 低音：每小节 8 个八分音符，3+3+2 的重音（第 1、4、7 个），第 7 个跳高八度。 */
function bassBars(roots: Roots, sparse = false) {
  return roots
    .map((r) => {
      const [a, b] = Array.isArray(r) ? r : [r, r];
      const n = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => BASS[i < 4 ? a : b]);
      if (sparse) return `${n[0]}/1.5a ${n[3]}/1.5a ${up(n[6])}/1a`;
      return n.map((x, i) => (i === 6 ? `${up(x)}/.5a` : i === 0 || i === 3 ? `${x}/.5a` : `${x}/.5p`)).join(' ');
    })
    .join(' | ');
}

/** 低音弦乐的空五度（root 在小字组）。 */
function padBars(roots: Roots) {
  const P: Record<string, string> = { 'G#': 'G#2+D#3+G#3', 'C#': 'C#3+G#3+C#4', E: 'E2+B2+E3', 'F#': 'F#2+C#3+F#3', D: 'D#2+A#2+D#3', 'D#': 'D#3+G3+A#3', B: 'B2+F#3+B3' };
  return roots.map((r) => (Array.isArray(r) ? `${P[r[0]]}/2 ${P[r[1]]}/2` : `${P[r]}/4`)).join(' | ');
}

const A_ROOTS: Roots = ['G#', 'C#', 'G#', ['E', 'F#'], 'G#', 'C#', ['E', 'F#'], 'D#', 'G#', 'C#', 'G#', ['E', 'F#'], 'E', 'F#', ['C#', 'D#'], 'G#'];
const B_ROOTS: Roots = ['E', 'E', 'F#', 'F#', 'C#', 'C#', 'D#', 'D#', 'E', 'E', 'F#', 'F#', 'E', 'F#', 'D#', 'D#'];
const BR_ROOTS: Roots = ['G#', 'E', 'F#', 'D#'];

const A1 = `G#3/.5 G#3/.5 B3/.5 G#3/.5 C#4/1s D#4/1 | F#4/.75 D#4/.75 C#4/.5 D#4/2v | G#3/.5 G#3/.5 B3/.5 C#4/.5 D#4/.5 F#4/.5 D#4/1 | C#4/.75 B3/.75 G#3/.5 G#3/2t |`;
const A2 = `G#4/1s F#4/.5 D#4/.5 F#4/1 D#4/.5 C#4/.5 | D#4/.75 C#4/.75 B3/.5 C#4/2v | B3/.5 C#4/.5 D#4/.5 F#4/.5 G#4/.5 F#4/.5 D#4/.5 C#4/.5 | C#4/.5 B3/.5 D#4/3v |`;
const A3 = `G#3/.5 G#3/.5 B3/.5 G#3/.5 C#4/1s D#4/1 | F#4/.75 D#4/.75 C#4/.5 D#4/2v | G#3/.5 G#3/.5 B3/.5 C#4/.5 D#4/.5 F#4/.5 D#4/1 | C#4/.75 D#4/.75 F#4/.5 G#4/2s |`;
const A4 = `B4/1s G#4/.5 F#4/.5 G#4/1 F#4/.5 D#4/.5 | F#4/.75 D#4/.75 C#4/.5 D#4/2v | C#4/.5 D#4/.5 C#4/.5 B3/.5 G#3/.5 B3/.5 C#4/.5 D#4/.5 |`;
const B1 = `E4/.75 D#4/.75 B3/.5 E4/.75 D#4/.75 B3/.5 | G#3/.5 B3/.5 D#4/1v -/.5 B3/.5 D#4/.5 E4/.5 | F#4/.75 C#4/.75 B3/.5 F#4/.75 C#4/.75 B3/.5 | G#3/.5 B3/.5 C#4/1v -/.5 C#4/.5 D#4/.5 F#4/.5 |`;
const B2 = `G#4/.75 F#4/.75 E4/.5 G#4/.75 F#4/.75 E4/.5 | C#4/.5 E4/.5 G#4/1v -/.5 F#4/.5 E4/.5 D#4/.5 | D#4/.75 G4/.75 A#4/.5 G4/.75 D#4/.75 C#4/.5 | D#4/2t E4/.5 D#4/.5 C#4/.5 B3/.5 |`;
const B3 = `B4/2t G#4/1 E4/1 | F#4/2t C#4/1 D#4/1 | D#4/.5 E4/.5 G4/.5 A#4/.5 G4/.5 E4/.5 D#4/.5 C#4/.5 | D#4/3v -/1 |`;

// 鼓谱（16 格一小节）
const GROOVE_A = { taiko: 'X.....x.....X...', chu: '....X.......X..o', shime: 'o.o.x.o.o.o.x.o.', log: '..o...o...o..o..' };
const GROOVE_B = { taiko: 'X..x..x.X..x..x.', chu: '....X..o....X.oo', shime: 'xoxoxoxoxoxoxoxo', frame: '..x...x...x...x.' };
const FILL_PHRASE = { taiko: 'X.....x.X...X...', chu: '....X...XoXoXXXX', shime: 'xoxoxoxo........' };
// 循环段最后一小节和前奏最后一小节同一个过门（render.ts 的接法要求两边的结尾一样）
const FILL_END = { taiko: 'X.....X...X.X.X.', chu: 'X...X...XxXxXXXX', shime: 'xoxoxoxoxoxoxoxo' };

type Groove = Record<string, string>;
function drums(s: Score, bar: number, g: Groove) {
  for (const [name, pat] of Object.entries(g)) s.grid(bar, pat, (t, v) => hit(s, name, t, v));
}

function build(): Score {
  const s = new Score(150);
  const intro = s.section('前奏', 4);
  const A = s.section('A', 16);
  const B = s.section('B', 16);
  const br = s.section('过门', 4);
  const A2b = s.section("A'", 16);
  s.loopBar = A;

  // ---- 前奏：一声大锣、太鼓一下一下进来，低音在第二小节起 ----
  hit(s, 'bigGong', s.t(intro), 0.9);
  hit(s, 'taiko', s.t(intro), 1);
  s.grid(intro + 1, 'X.....x.....X...', (t, v) => hit(s, 'taiko', t, v));
  drums(s, intro + 2, { ...GROOVE_A, shime: 'o.o.o.o.x.x.x.x.' });
  drums(s, intro + 3, FILL_END);
  bassLine(s, s.parse(intro + 1, bassBars(['G#'], true)));
  bassLine(s, s.parse(intro + 2, bassBars(['G#', 'G#'])));
  hit(s, 'swell', s.t(intro + 3, 1.6), 0.8);

  // ---- A：主题 ----
  zheng(s, s.parse(A, A1 + A2 + A3 + A4 + 'G#3/3t -/1'), { pan: 0.1 });
  bassLine(s, s.parse(A, bassBars(A_ROOTS)));
  hit(s, 'gong', s.t(A), 0.8);
  hit(s, 'crash', s.t(A), 0.7);
  for (let i = 0; i < 16; i++) {
    const b = A + i;
    if (i === 7) drums(s, b, FILL_PHRASE);
    else if (i === 15) drums(s, b, { ...FILL_PHRASE, taiko: 'X.....x.X.X.XXXX' });
    else drums(s, b, i < 8 ? { ...GROOVE_A, shime: i < 4 ? '................' : GROOVE_A.shime } : GROOVE_A);
  }
  hit(s, 'swell', s.t(A + 15, 1.6), 0.8);

  // ---- B：换和声，鼓加密；后八小节加低八度的筝和低音弦乐 ----
  zheng(s, s.parse(B, B1 + B2 + B1 + B3), { pan: 0.1 });
  // 低八度的那一层用 KS 拨弦（筝的采样最低只到 F#3，往下变太多会闷、拖）
  pipa(s, s.parse(B + 8, B1 + B3), { pan: -0.35, oct: -1, gain: 0.4, vel: 0.65 });
  bassLine(s, s.parse(B, bassBars(B_ROOTS)));
  strs(s, s.parse(B + 8, padBars(B_ROOTS.slice(8))), { gain: 0.5, attack: 0.5, cut: [400, 1300] });
  hit(s, 'gong', s.t(B), 0.85);
  hit(s, 'crash', s.t(B), 0.8);
  for (let i = 0; i < 16; i++) drums(s, B + i, i === 7 ? { ...GROOVE_B, chu: '....X...XoXoXXXX' } : i === 15 ? { ...GROOVE_B, chu: 'X...X...XXXXXXXX', taiko: 'X..x..x.X.X.X.X.' } : GROOVE_B);
  hit(s, 'roll', s.t(B + 14), 0.6, { len: 3.2 });

  // ---- 过门：全体齐奏的重击，筝刮下来；最后一小节鼓滚上去、筝刮上去 ----
  hit(s, 'bigGong', s.t(br), 1);
  zhengGliss(s, s.t(br), false, { gain: 0.6 });
  const hits = ['X.....X.....X...', 'X..X..X.X.......', 'X.....X.....X...'];
  hits.forEach((p, i) => {
    s.grid(br + i, p, (t, v) => {
      hit(s, 'taiko', t, v);
      hit(s, 'chu', t, v * 0.9);
      hit(s, 'timp', t, v * 0.6);
    });
  });
  bassLine(s, s.parse(br, 'G#1/1.5a G#1/1.5a G#2/1a | E2/.75a E2/.75a -/.5 E2/.5a E2/.5 -/1 | F#2/1.5a F#2/1.5a F#2/1a'), { gate: 0.6, sustain: 0.7 });
  strs(s, s.parse(br, padBars(BR_ROOTS.slice(0, 3))), { gain: 0.45, attack: 0.08, release: 0.6, cut: [500, 1500] });
  s.grid(br + 1, '....o.o.....o.o.', (t, v) => hit(s, 'shime', t, v));
  drums(s, br + 3, FILL_END);
  bassLine(s, s.parse(br + 3, bassBars(['D#'])));
  zhengGliss(s, s.t(br + 3, 2), true, { gain: 0.5 });
  hit(s, 'swell', s.t(br + 3, 1.6), 0.9);

  // ---- A'：主题加低八度，鼓按 B 段的密度，低音弦乐垫底 ----
  zheng(s, s.parse(A2b, A1 + A2 + A3 + A4 + 'G#3/2t -/2'), { pan: 0.1 });
  pipa(s, s.parse(A2b, A1 + A2 + A3 + A4 + 'G#3/2 -/2'), { pan: -0.35, oct: -1, gain: 0.4, vel: 0.65 });
  bassLine(s, s.parse(A2b, bassBars(A_ROOTS.slice(0, 15)) + ' | ' + bassBars(['G#'])));
  strs(s, s.parse(A2b, padBars(A_ROOTS.slice(0, 15)) + ' | G#2+D#3+G#3/2 -/2'), { gain: 0.4, attack: 0.6, cut: [350, 1100] });
  hit(s, 'gong', s.t(A2b), 0.9);
  hit(s, 'crash', s.t(A2b), 0.8);
  for (let i = 0; i < 15; i++) drums(s, A2b + i, i === 7 ? { ...GROOVE_B, chu: '....X...XoXoXXXX' } : GROOVE_B);
  drums(s, A2b + 15, FILL_END);
  hit(s, 'swell', s.t(A2b + 15, 1.6), 0.8);
  return s;
}

export const pieceA: Piece = {
  name: 'compose-a',
  build,
  buses: {
    drums: { gain: 1.15, highpass: 40, shelf: [3000, -3] },
    lead: { gain: 1.12, highpass: 120 },
    bass: { gain: 0.36, highpass: 40 },
    pad: { gain: 0.7, highpass: 70 },
  },
  reverb: { room: 0.8, damp: 0.45, wet: 1.3 },
  comp: { thr: -16, ratio: 2.2 },
};
