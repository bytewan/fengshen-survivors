// 云霄的宠物青鸾（暂拟，待评审确认）：朝右的飞鸟，四帧扇翅（翅膀高举 → 平展 → 下压 → 平展）+ 一帧收翅掠过。
// 天青的身子、月白的胸腹、石青的翅背，头后两缕冠羽，一点玄色的眼、金喙；身后两三道长长的尾羽，越往后越淡、末梢月白。
// 宠物比人小（身子连尾巴约 17 像素长、展翅约 10 像素高；人约 16×24）。游戏里左右镜像、小角度俯仰，不整圈转。
// 进化之后换羽色：冰魄——通身转成月白、翅缘天青，冠羽和尾梢结着冰；沧溟——转深成黛蓝、胸腹天青，尾羽拖得更长。
// 另有：飘落的冰羽（三像素长的小羽毛，两帧翻转）、沾在敌人身上的寒羽（一根斜插的小冰羽）。
import { outline, type Grid } from '../pixel.ts';
import { Px } from './fx.ts';
import type { PetBranch } from '../../sim/types.ts';

const TAU = Math.PI * 2;

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

/** 一笔由粗到细的线（沿折线 pts，宽度 w0 → w1），颜色按沿线的位置 t（0..1）挑。 */
function taper(p: Px, pts: [number, number][], w0: number, w1: number, color: (t: number) => string | null) {
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(l);
    total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const l = segs[i] || 1e-6;
    const steps = Math.max(1, Math.ceil(l * 3));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const t = (acc + l * f) / (total || 1);
      const w = w0 + (w1 - w0) * t;
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f;
      const R = Math.ceil(w / 2) + 1;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          if (Math.hypot(dx, dy) / Math.max(0.35, w / 2) > 1) continue;
          const ch = color(t);
          if (ch) p.set(Math.round(x + dx), Math.round(y + dy), ch);
        }
    }
    acc += l;
  }
}

/** 一套羽色：身子（背、腹、暗面）、翅（亮、身、暗）、尾（根、中、梢）、冠羽、描边。 */
interface Plume {
  back: string;
  belly: string;
  dark: string;
  wing: [string, string, string];
  far: [string, string];
  tail: [string, string, string];
  crest: [string, string];
  line: string;
}
const PLUMES: Record<'base' | 'rime' | 'deep', Plume> = {
  base: { back: 'C', belly: 'w', dark: 'c', wing: ['w', 'C', 'c'], far: ['c', 'n'], tail: ['C', 'c', 'w'], crest: ['C', 'w'], line: 'n' },
  rime: { back: 'w', belly: 'W', dark: 'j', wing: ['W', 'w', 'C'], far: ['C', 'c'], tail: ['w', 'C', 'W'], crest: ['W', 'C'], line: 'c' },
  deep: { back: 'c', belly: 'C', dark: 'n', wing: ['C', 'c', 'n'], far: ['n', 'N'], tail: ['c', 'n', 'C'], crest: ['C', 'w'], line: 'N' },
};

export type BirdPose = 'fly' | 'dive';
export const BIRD_W = 28;
export const BIRD_H = 19;
/** 转动中心（身子中间），也是模拟里青鸾的位置。 */
export const BIRD_PIVOT = { x: 16, y: 9.5 };
/**
 * 放大多少（2026-11-11 人物放大到 32 像素后跟着放大约 1.3 倍，见 docs/design.md「人物与宠物的尺子」）：下面的形状按原来 22×15 画布上的坐标写，
 * 绕原来的中心 (12.5, 7.5) 乘 K 放进新画布。
 */
const K = 1.3;
const X = (x: number) => BIRD_PIVOT.x + (x - 12.5) * K;
const Y = (y: number) => BIRD_PIVOT.y + (y - 7.5) * K;

/**
 * 一帧青鸾。f：扇翅的第几帧（0..3），dive：收着翅掠过（翅膀往后贴着身子），tail：尾羽摆动的相位（0..1），
 * long：尾羽多长一截（三阶进化）。
 */
function bird(plume: Plume, f: number, dive: boolean, tail: number, long: number): Grid {
  const p = new Px(BIRD_W, BIRD_H);
  const sh = dive ? 0 : f === 0 ? -0.6 : f === 2 ? 0.5 : 0; // 扇翅时身子跟着起落
  const wingA = dive ? -2.8 : [-2.2, -2.75, 2.4, -2.75][f]; // 近侧翅膀的方向（0 朝右，负数往上）
  const farA = dive ? -2.95 : [-2.45, -2.95, 2.75, -2.95][f];
  const wingL = (dive ? 7 : 7.6) * K;
  /** 一只翅膀：沿方向 a 的弯羽形（前缘一道弧、后缘几道羽尖），按到前缘的远近分档上色。 */
  const wing = (bx: number, by: number, a: number, L: number, Wd: number, cols: string[]) => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let nx = Math.sin(a);
    let ny = -Math.cos(a);
    if (nx > 0.2 || (Math.abs(nx) <= 0.2 && ny < 0)) {
      nx = -nx;
      ny = -ny;
    }
    for (let y = 0; y < BIRD_H; y++)
      for (let x = 0; x < BIRD_W; x++) {
        const dx = x + 0.5 - X(bx);
        const dy = y + 0.5 - Y(by);
        const s = (dx * ux + dy * uy) / L;
        const q = (dx * nx + dy * ny) / (Wd * K);
        if (s < 0 || s > 1) continue;
        const front = -0.16 * Math.sin(Math.PI * s);
        const back = (1 - s ** 1.5) * (0.8 + 0.2 * Math.abs(Math.sin(s * Math.PI * 3))) + 0.1;
        if (q < front || q > back) continue;
        const c = (q - front) / Math.max(0.05, back - front);
        p.set(x, y, cols[Math.min(cols.length - 1, Math.floor(c * cols.length))]);
      }
  };
  wing(12.4, 7 + sh, farA, wingL - 0.8 * K, 2.6, plume.far); // 远侧翅膀
  // 尾羽：三四道长羽从尾根往后飘，末梢一道往上卷、一道往下垂（鸾尾），按相位轻轻起伏；越往后越细、越淡
  const n = 3 + (long > 0 ? 1 : 0);
  for (let j = 0; j < n; j++) {
    const ph = TAU * (tail + j * 0.27);
    const curl = [-1.6, 1.4, -0.4, 0.7][j];
    const len = 9.5 + long * 2.5 + (j === 0 ? 1 : 0) - (j === 2 ? 1.5 : 0);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push([X(9.8 - len * u), Y(8.3 + sh * 0.5 + curl * u * u * u + Math.sin(ph - u * 3) * 0.9 * u + (dive ? -0.4 * u : 0.6 * u))]);
    }
    taper(p, pts, (j === 0 ? 1.7 : 1.3) * K, 0.6, (t) => (t < 0.3 ? plume.tail[0] : t < 0.8 ? plume.tail[1] : plume.tail[2]));
  }
  // 身子、头、冠羽
  ellipse(p, X(12.6), Y(7.9 + sh), 3.6 * K, 2.1 * K, -0.25, (_u, v) => (v > 0.35 ? plume.belly : v > -0.2 ? plume.back : plume.back));
  ellipse(p, X(12.6), Y(8.6 + sh), 2.6 * K, 1 * K, -0.25, (_u, v) => (v > 0 ? plume.dark : null));
  ellipse(p, X(16.4), Y(5.6 + sh), 1.9 * K, 1.7 * K, 0, (u, v) => (v > 0.2 && u > -0.2 ? plume.belly : plume.back));
  const pts = (q: [number, number][]) => q.map(([x, y]) => [X(x), Y(y)] as [number, number]);
  taper(p, pts([[15.6, 4.4 + sh], [14.2, 2.8 + sh], [12.4, 2.1 + sh]]), 1.2 * K, 0.6, (t) => (t < 0.6 ? plume.crest[0] : plume.crest[1]));
  taper(p, pts([[16.2, 4.2 + sh], [15.4, 2.4 + sh], [14.4, 1.2 + sh]]), 1 * K, 0.55, (t) => (t < 0.6 ? plume.crest[0] : plume.crest[1]));
  wing(12, 6.6 + sh, wingA, wingL, 3.2, plume.wing); // 近侧翅膀
  // 喙（两格）、眼
  p.set(X(18.4), Y(5.8 + sh), 'y');
  p.set(X(18.4) + 1, Y(5.8 + sh), 'y');
  p.set(X(16.7), Y(5.1 + sh), 'k');
  return outline(p.grid(), plume.line, { y: 'B' });
}

const SETS = new Map<string, Record<BirdPose, Grid[]>>();
/**
 * 青鸾的帧（按进化的路和阶段换羽色、尾羽长短）：fly 四帧扇翅（尾羽相位跟着走），dive 两帧收翅掠过（尾羽在后面拉直、轻摆）。
 */
export function qingluanFrames(branch: PetBranch | null, stage: number): Record<BirdPose, Grid[]> {
  const look = branch === 'rime' && stage >= 1 ? 'rime' : branch === 'deep' && stage >= 1 ? 'deep' : 'base';
  const long = stage >= 3 ? 1 : 0;
  const key = `${look}${long}`;
  let s = SETS.get(key);
  if (!s) {
    const P = PLUMES[look];
    s = {
      fly: [0, 1, 2, 3].map((f) => bird(P, f, false, f / 4, long)),
      dive: [0, 1].map((f) => bird(P, 1, true, f / 2, long)),
    };
    SETS.set(key, s);
  }
  return s;
}

/** 飘落的冰羽：三四像素长的小羽毛，两帧（正面、翻过去的侧面）。 */
export const FEATHER: Grid[] = [
  outline({ w: 4, h: 3, rows: ['..wC', '.wC.', 'C...'] }, 'n'),
  outline({ w: 4, h: 2, rows: ['.wwC', 'CC..'] }, 'n'),
];
/** 冰魄、沧溟的羽毛换色。 */
export const FEATHER_RIME: Grid[] = [outline({ w: 4, h: 3, rows: ['..WC', '.Ww.', 'C...'] }, 'c'), outline({ w: 4, h: 2, rows: ['.WWC', 'ww..'] }, 'c')];
export const FEATHER_DEEP: Grid[] = [outline({ w: 4, h: 3, rows: ['..Cc', '.Cn.', 'n...'] }, 'N'), outline({ w: 4, h: 2, rows: ['.CCc', 'nn..'] }, 'N')];
