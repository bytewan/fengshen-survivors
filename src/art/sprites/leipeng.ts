// 雷震子的宠物雷鹏（暂拟，待评审确认；2026-11-11 照猎隼重画，原来像鸭子）：朝右的一只小雷鹏——精悍的猛禽：小头、金钩喙、藤黄的眼眶、
// 眼下一道墨色的「髭纹」、颊和喉一小块月白（胸前几道缟色的细横斑），身子收紧成梭形，背和翅是墨绿、松绿两档，翅窄长而尖、前缘描金、飞羽尖一排琥珀，
// 窄长的尾（尾梢一点金）。俯冲时翅膀往后贴成一把箭。和青鸾（天青月白、长长的鸾尾、冠羽）一眼分得开。
// 宠物约人的一半高（尺子：人 32，宠物 14–16）：身子从喙尖到尾梢约 17 像素，翅膀举起时约 15 像素高。游戏里左右镜像、小角度俯仰。
// 帧：fly 四帧扇翅（举起 → 平展 → 下压 → 平展）、glide 一帧平展着滑翔（盘旋的时候）、stoop 两帧收翅俯冲（翅膀往后贴成两把刀，身子拉直）。
// 进化之后换羽色：掣电——翅缘、尾梢换成亮金，飞羽尖一排白金（像拖着电光）；霹雳——羽色压深一档，翅上一道葱黄的电纹。
// 另有：沾在敌人身上的麻痹电光（几个像素的小折线，两三帧轮着闪），画在 game/pets/leipeng-fx.ts。
import { outline, type Grid } from '../pixel.ts';
import { Px } from './fx.ts';
import type { PetBranch } from '../../sim/types.ts';

/** 一套羽色：背（亮、暗）、腹、头、翅（前缘、亮、身、暗、羽尖）、远翅（亮、暗）、尾（根、梢）、描边。 */
interface Plume {
  back: [string, string];
  belly: string;
  bar: string;
  head: string;
  wing: [string, string, string, string, string];
  far: [string, string];
  tail: [string, string];
  line: string;
  vein?: string; // 霹雳：翅上的一道电纹
}
const PLUMES: Record<'base' | 'flash' | 'clap', Plume> = {
  base: { back: ['h', 'g'], belly: 'j', bar: 'i', head: 'd', wing: ['y', 'l', 'v', 'G', 'b'], far: ['v', 'G'], tail: ['g', 'y'], line: 'k' },
  flash: { back: ['h', 'g'], belly: 'j', bar: 'i', head: 'd', wing: ['Y', 'L', 'l', 'v', 'f'], far: ['l', 'v'], tail: ['g', 'Y'], line: 'k' },
  clap: { back: ['g', 'd'], belly: 'i', bar: 'h', head: 'd', wing: ['y', 'v', 'G', 'd', 'b'], far: ['G', 'd'], tail: ['d', 'y'], line: 'k', vein: 'L' },
};

export type PengPose = 'fly' | 'glide' | 'stoop';
export const PENG_W = 30;
export const PENG_H = 24;
/** 画布里整只鸟往右下挪多少（翅膀举起来时不出画布）。 */
const OX = 2;
const OY = 6;
/** 转动中心（身子中间），也是画面里雷鹏的位置（模拟里正下方的地面往上 z）。 */
export const PENG_PIVOT = { x: 13 + OX, y: 9 + OY };

/** 实心椭圆（可转角度）：color(u, v) 里 u 沿长轴、v 沿短轴（正 = 下），都在 −1..1。 */
function ellipse(p: Px, cx: number, cy: number, rx: number, ry: number, rot: number, color: (u: number, v: number) => string | null) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * c + dy * s) / rx;
      const v = (-dx * s + dy * c) / ry;
      if (u * u + v * v > 1) continue;
      const ch = color(u, v);
      if (ch) p.set(x, y, ch);
    }
}

/**
 * 一只翅膀：从翅根 (bx, by) 沿方向 a 伸出去 L 长（前缘一道略拱的弧），翅面往「后」（远离前进方向的一侧）宽 Wd，
 * 越往翅尖越窄、尖；后缘是一根根飞羽的锯齿。cols：前缘、亮、身、暗、羽尖。
 */
function wing(p: Px, bx: number, by: number, a: number, L: number, Wd: number, cols: string[], vein?: string) {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // 翅面在前缘的哪一侧：朝身子后面（x 负的那边）；举起、下压时都一样
  let nx = Math.sin(a);
  let ny = -Math.cos(a);
  if (nx > 0.2 || (Math.abs(nx) <= 0.2 && ny < 0)) {
    nx = -nx;
    ny = -ny;
  }
  for (let y = 0; y < PENG_H; y++)
    for (let x = 0; x < PENG_W; x++) {
      const dx = x + 0.5 - bx;
      const dy = y + 0.5 - by;
      const s = (dx * ux + dy * uy) / L;
      const q = (dx * nx + dy * ny) / Wd;
      if (s < 0 || s > 1) continue;
      const front = -0.18 * Math.sin(Math.PI * s);
      // 后缘：靠翅根宽（次级飞羽），往翅尖收成尖；一根根飞羽的齿
      const tooth = 0.18 * Math.abs(Math.sin(s * Math.PI * 4.5));
      const back = (1 - s ** 1.3) * 0.95 + 0.12 - tooth * (s > 0.3 ? 1 : 0.3);
      if (q < front || q > back) continue;
      const c = (q - front) / Math.max(0.05, back - front);
      let ch = c < 0.2 ? cols[0] : c < 0.45 ? cols[1] : c < 0.8 ? cols[2] : c < 0.92 ? cols[3] : cols[4];
      if (s > 0.85 && c >= 0.2) ch = cols[4];
      if (vein && Math.abs(c - 0.55 - 0.15 * Math.sin(s * 9)) < 0.08 && s > 0.15 && s < 0.85) ch = vein;
      p.set(x, y, ch);
    }
}

/**
 * 一帧雷鹏（2026-11-11 重画：原来身子圆胖、头圆、白颊一大块、嘴扁，像一只鸭子）。现在照猎隼画：
 * 翅膀窄而长、尖（扇翅时是整只鸟最显眼的形），身子收紧成梭形、往后收成一条较长的窄尾（两片尾羽微微张开、尾梢一道金），
 * 小头：墨色的头顶连到后颈、眼下一道墨色髭纹垂到颊下、颊和喉月白（只一小块），金色的眼眶，钩喙（金、尖往下勾一格赭）。
 * f：扇翅的第几帧（0..3），mode：fly 扇翅 / glide 平展滑翔 / stoop 收翅俯冲（翅膀往后贴成一把箭，身子拉直、头往前顶）。
 */
function peng(P: Plume, f: number, mode: PengPose): Grid {
  const p = new Px(PENG_W, PENG_H);
  const stoop = mode === 'stoop';
  const sh = mode === 'fly' ? [-0.6, 0, 0.6, 0][f] : 0; // 扇翅时身子跟着起落
  const tilt = stoop ? 0.14 : -0.06; // 俯冲时头往下压一点
  const nearA = stoop ? -2.98 - f * 0.04 : mode === 'glide' ? -2.85 : [-1.95, -2.7, 2.4, -2.7][f];
  const farA = stoop ? -3.06 : mode === 'glide' ? -3.02 : [-2.2, -2.9, 2.7, -2.9][f];
  const L = stoop ? 11.5 : 13.5;
  const Wd = stoop ? 2.2 : 5.6;
  const cy = 9.4 + OY + sh;
  wing(p, 14.2 + OX, cy - 0.8, farA, L - 1.2, Wd * 0.85, [P.far[0], P.far[0], P.far[1], P.far[1], P.far[1]]); // 远翅
  // 尾：两片窄长的尾羽从尾根往后，微微张开，尾梢一道金
  for (const [dy, len] of [
    [-0.35, 7.6],
    [0.45, 7],
  ] as const) {
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const x = 10.2 + OX - len * u;
      const y = cy + 0.5 + dy * u * 1.8 + (stoop ? -0.4 * u : 0.3 * u);
      p.set(x, y, u > 0.84 ? P.tail[1] : P.tail[0]);
      if (u < 0.45) p.set(x, y + (dy < 0 ? -0.7 : 0.7), P.tail[0]);
    }
  }
  // 身子：梭形，胸在前、往后收；背深腹浅，胸前几道细横斑
  ellipse(p, 14.0 + OX, cy, 3.9, 1.65, tilt, (u, v) => (v > 0.35 && u > -0.5 ? ((Math.round(u * 6) & 1) && v > 0.55 ? P.bar : P.belly) : v > -0.3 ? P.back[0] : P.back[1]));
  // 头：小，墨色的头顶连到后颈；颊、喉一小块月白，眼下一道髭纹
  const hx = 18.3 + OX + (stoop ? 0.8 : 0);
  const hy = cy - 1.1 + (stoop ? 0.5 : 0);
  ellipse(p, hx, hy, 1.8, 1.45, 0, (u, v) => (v > 0.35 && u > -0.1 ? 'w' : P.head));
  p.set(hx - 1.4, hy + 0.3, P.head); // 后颈连着背
  p.set(hx + 0.1, hy + 0.8, P.head); // 髭纹
  p.set(hx + 0.1, hy + 1.5, P.head);
  // 眼：玄色一点、前面一点藤黄的眼眶
  p.set(hx + 0.4, hy - 0.4, 'k');
  p.set(hx + 1.2, hy - 0.4, 'Y');
  // 钩喙：金、尖往下勾一格赭
  p.set(hx + 1.9, hy - 0.1, 'y');
  p.set(hx + 2.6, hy + 0.3, 'y');
  p.set(hx + 2.6, hy + 1.1, 'B');
  wing(p, 13.6 + OX, cy - 1.1, nearA, L, Wd, P.wing, P.vein); // 近翅
  return outline(p.grid(), P.line, { y: 'B', Y: 'B', b: 'B', v: 'G', l: 'G', L: 'G' });
}

const SETS = new Map<string, Record<PengPose, Grid[]>>();
/** 雷鹏的帧（按进化的路换羽色）：fly 四帧扇翅、glide 一帧、stoop 两帧（第二帧翅膀再贴紧一点）。 */
export function leipengFrames(branch: PetBranch | null, stage: number): Record<PengPose, Grid[]> {
  const look = branch === 'flash' && stage >= 1 ? 'flash' : branch === 'clap' && stage >= 1 ? 'clap' : 'base';
  let s = SETS.get(look);
  if (!s) {
    const P = PLUMES[look];
    s = { fly: [0, 1, 2, 3].map((f) => peng(P, f, 'fly')), glide: [peng(P, 1, 'glide')], stoop: [peng(P, 0, 'stoop'), peng(P, 1, 'stoop')] };
    SETS.set(look, s);
  }
  return s;
}
