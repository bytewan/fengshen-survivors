// 功法的画面（表现层）：风火轮的火痕、五雷正法的聚云与天雷、莲花化身重生时开的莲、金刚不坏的反弹、寒冰诀的碎冰、
// 天眼通的竖目、三昧真火的传火、吐纳术的回气、混元一气放大的神通余波、法天象地的法相（人物画大一圈）。
// 读模拟状态（Player.tech、Enemy.eyeUntil）和事件（tech、skill），只作用在表现层。接口仿照 fx.ts：onEvent / update / clear。
// 用户口径：人物、武器身上不画发光圆圈 / 光圈 / 光晕，用线条、像素粒子、小精灵、形状；出现和消失都要有过程，动画不要太快。
// 这里的像素图都是程序生成的字符网格（调色板字符见 art/palette.ts），纹理在构造时建好。
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { grid, outline, type Grid } from '../art/pixel.ts';
import { PALETTE } from '../art/palette.ts';
import { C } from '../art/sprites/pet.ts';
import type { NezhaPose } from '../art/sprites/nezha.ts';
import { flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { BANK } from '../audio/bank.ts';
import { TECH, has } from '../sim/techniques.ts';
import type { Enemy, Player, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { PixelLayer } from './pet-fx.ts';
import { PixelFxLayer, prebake } from '../render/pixelfx.ts';
import { XFX } from '../render/pixelfx-xianxia.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import { foeLooks, type FoeViewKind } from './enemy-views.ts';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 位置的哈希（0..1）：同一处的火苗每帧都长在同一个地方，只是高低在变。 */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const FIRE = [0xd9452b, 0xf2814a, 0xf7dc7a];
const GOLD = [0xf7dc7a, 0xe0a83a, 0xffe9a8];
const ICE = [0x7cc4c4, 0xffffff, 0x3f8a9e];
/** 风火轮的余火烘几份（种子不同：火舌高低、炭的长短、火星的走向各不一样），轮着放。 */
const EMBER_SEEDS = 3;
/** 贴地的功法画面（火痕）放进 entities 时的 zIndex：在所有角色（zIndex 是脚下的 y）之下。 */
const GROUND_Z = -1e6;
/** 精灵脚下本来就踩着风火轮的人物：不再另画一对。 */
const OWN_WHEELS = new Set<string>(['nezha', 'mozha']);

// ---------------------------------------------------------------- 像素图（程序生成）

/** 网格的字符画布。 */
function canvas(w: number, h: number) {
  const rows: string[][] = Array.from({ length: h }, () => Array(w).fill('.'));
  const put = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) rows[y][x] = ch;
  };
  const done = (): Grid => ({ w, h, rows: rows.map((r) => r.join('')) });
  return { put, done, rows };
}

/**
 * 莲花（3/4 俯视，开在地上）：bloom 0..1 从花苞到盛开。外圈八瓣、内圈五瓣，瓣根胭脂、瓣身桃红、瓣尖月白，
 * 中间缃色莲蓬；背后的瓣先画、前面的后画，最后描一圈紫棠的边（比纯黑柔）。
 */
export function lotusGrid(bloom: number): Grid {
  const W = 39;
  const H = 21;
  const cx = 19;
  const cy = 14;
  const g = canvas(W, H);
  type Petal = { a: number; len: number; wid: number; lift: number };
  const outer: Petal[] = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + Math.PI / 8, len: 5 + 13 * bloom, wid: 3.2, lift: 1.5 + 5 * (1 - bloom) }));
  const inner: Petal[] = Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * Math.PI * 2 - Math.PI / 2, len: 4 + 6 * bloom, wid: 2.5, lift: 4 + 3.5 * (1 - bloom) }));
  const draw = (q: Petal, deep: boolean) => {
    const nx0 = -Math.sin(q.a);
    const ny0 = Math.cos(q.a) * 0.45;
    const nl = Math.hypot(nx0, ny0) || 1;
    for (let t = 0; t <= 1.0001; t += 0.03) {
      const r = t * q.len;
      const bx = cx + Math.cos(q.a) * r;
      const by = cy + Math.sin(q.a) * r * 0.45 - q.lift * t * t;
      const hw = q.wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.6);
      for (let o = -hw; o <= hw + 1e-6; o += 0.5) {
        const edge = Math.abs(o) > hw * 0.55;
        const ch = t > 0.8 ? 'w' : t < 0.22 ? 'p' : edge ? (deep ? 'p' : 'm') : 'm';
        g.put(bx + (nx0 / nl) * o, by + (ny0 / nl) * o, ch);
      }
    }
  };
  const back = (q: Petal) => Math.sin(q.a) < 0;
  for (const q of outer.filter(back)) draw(q, true);
  for (const q of inner.filter(back)) draw(q, false);
  // 莲蓬
  for (const [dx, dy, ch] of [
    [-1, -2, 'y'],
    [0, -2, 'Y'],
    [1, -2, 'y'],
    [-1, -1, 'b'],
    [0, -1, 'y'],
    [1, -1, 'b'],
  ] as const)
    g.put(cx + dx, cy + dy - 2 * (1 - bloom), ch);
  for (const q of inner.filter((q) => !back(q))) draw(q, false);
  for (const q of outer.filter((q) => !back(q))) draw(q, true);
  return outline(g.done(), 'P');
}

/**
 * 雷云（两帧：第二帧云肚子里闪一下金光）：几团叠在一起的云头，顶上受光（苍）、肚子发暗（黛 → 紫棠），
 * 底边一圈玄色，压在敌人头顶上要看得出是「天雷将至」，不能像一缕烟。宽 27、高 11（加描边 29 × 13）。
 */
export function cloudGrid(lit: boolean): Grid {
  const W = 27;
  const H = 11;
  const g = canvas(W, H);
  // 云头：上面一排大的，底下错落几团小的（底边起伏，不是平底）
  const puffs: [number, number, number][] = [
    [5, 6, 3.8],
    [9.5, 4.2, 4.4],
    [15, 3.6, 5],
    [20.5, 5, 4.4],
    [24, 7, 2.8],
    [8, 8, 2.6],
    [13, 7.6, 3.4],
    [18.5, 7.8, 3],
  ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let best = -1;
      let top = 0;
      for (const [px, py, r] of puffs) {
        const d = Math.hypot((x - px) / r, ((y - py) / r) * 1.25);
        if (d < 1 && 1 - d > best) {
          best = 1 - d;
          top = (py - y) / r; // 这团云里偏上还是偏下
        }
      }
      if (best < 0) continue;
      g.put(x, y, top > 0.35 ? 'h' : top > -0.15 ? 'g' : top > -0.55 ? 'P' : 'd');
    }
  if (lit)
    for (const [x, y, ch] of [
      [12, 6, 'y'],
      [13, 6, 'Y'],
      [14, 7, 'f'],
      [13, 7, 'Y'],
      [15, 7, 'y'],
      [19, 6, 'y'],
    ] as const)
      g.put(x, y, ch);
  return outline(g.done(), 'k');
}

/** 一道天雷：从 (x0, y0) 折几折劈到 (x1, y1)，月白的芯、缃色的边，中段分出一小叉。返回网格和它的左上角（世界坐标）。 */
export function boltGrid(x0: number, y0: number, x1: number, y1: number): { g: Grid; ox: number; oy: number } {
  const n = 6;
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const k = i / n;
    pts.push([x0 + (x1 - x0) * k + rnd(-5, 5), y0 + (y1 - y0) * k + rnd(-2, 2)]);
  }
  pts.push([x1, y1]);
  const fork: [number, number][] = [];
  const fi = 2 + Math.floor(Math.random() * 2);
  const side = Math.random() < 0.5 ? -1 : 1;
  fork.push(pts[fi], [pts[fi][0] + side * rnd(6, 10), pts[fi][1] + rnd(6, 9)], [pts[fi][0] + side * rnd(9, 15), pts[fi][1] + rnd(12, 17)]);
  const xs = [...pts, ...fork].map((p) => p[0]);
  const ys = [...pts, ...fork].map((p) => p[1]);
  const ox = Math.floor(Math.min(...xs)) - 2;
  const oy = Math.floor(Math.min(...ys)) - 2;
  const g = canvas(Math.ceil(Math.max(...xs)) - ox + 3, Math.ceil(Math.max(...ys)) - oy + 3);
  const line = (a: [number, number], b: [number, number], core: string, rim: string, thick = false) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps - ox;
      const y = a[1] + ((b[1] - a[1]) * s) / steps - oy;
      g.put(x - 1, y, rim);
      g.put(x + (thick ? 2 : 1), y, rim);
    }
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps - ox;
      const y = a[1] + ((b[1] - a[1]) * s) / steps - oy;
      g.put(x, y, core);
      if (thick) g.put(x + 1, y, core);
    }
  };
  for (let i = 0; i < fork.length - 1; i++) line(fork[i], fork[i + 1], 'Y', 'y');
  for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1], 'W', 'Y', true); // 主雷两像素的白芯
  // 描一圈靛色的边：玉台的地面是浅色，白金的雷不描边就看不清（网格四周已经留了两像素的空，描边放得下）
  return { g: outline(g.done(), 'N'), ox, oy };
}

/** 风火轮（没有自带风火轮的人物脚下那一对）：5×5 金轮、两个转动相位（同哪吒精灵里的轮子）；后轮暗一档。 */
const WHEEL = [grid(['.byb.', 'bk.kb', 'y.k.y', 'bk.kb', '.byb.']), grid(['.bYb.', 'b.k.b', 'ykkky', 'b.k.b', '.bYb.'])];
const darker = (g: Grid): Grid => ({ ...g, rows: g.rows.map((r) => r.replace(/b/g, 'B').replace(/y/g, 'b').replace(/Y/g, 'y')) });
/** 轮后舔着的火（朝右画，游戏按朝向翻）：走着三帧、站着三帧（缩成一点）。锚点在底边正中。 */
const WHEEL_FLAME = [grid(['..o.', '.oe.', 'reo.', '.re.']), grid(['.o..', '.eo.', 'reo.', '.re.']), grid(['....', '..o.', 'reo.', 'rre.'])];
const WHEEL_FLAME_LOW = [grid(['.o.', 're.']), grid(['...', 'reo']), grid(['.e.', 'ro.'])];
/** 落雷处地上的一块焦痕（扁的，贴地；会慢慢淡去）。 */
const SCORCH = grid(['...BB.BB...', '.BBRRBRRBB.', 'BRRkkkkkRRB', '.BRRkkkRRB.', '...BBRBB...']);

/** 雷云的底边离敌人脚底多高。 */
const CLOUD_Y = 38;

/** 天雷落地那一下的星芒（一闪就淡）。 */
const IMPACT = outline(grid(['...W...', '...Y...', '.Y.W.Y.', 'WYWWWYW', '.Y.W.Y.', '...Y...', '...W...']), 'N');

/** 碎冰的冰碴（四种，描黛蓝边：浅色地面上也看得清）。 */
const SHARDS = [grid(['.W', 'WC', 'Cc', 'c.']), grid(['WC.', '.Cc']), grid(['.C', 'CW', 'c.']), grid(['W', 'C', 'c'])].map((g) => outline({ w: g.w + 2, h: g.h + 2, rows: ['.'.repeat(g.w + 2), ...g.rows.map((r) => `.${r}.`), '.'.repeat(g.w + 2)] }, 'n'));

/** 天眼：竖着的一只眼（闭 → 半睁 → 睁开），金色眼睑、月白眼白、朱砂瞳，描玄色边，浮在敌人头侧。 */
const EYE = [
  ['.....', '.....', '..y..', '..Y..', '..y..', '.....', '.....'],
  ['.....', '..y..', '.yWy.', '.yey.', '.yWy.', '..y..', '.....'],
  ['..y..', '.yWy.', 'yWeWy', 'yeReY', 'yWeWy', '.yWy.', '..y..'],
].map((r) => outline(grid(r), 'k'));

/** 莲瓣（飞散的花瓣，两种）。 */
const PETALS = [grid(['mw', 'pm']), grid(['.w', 'mm', 'p.'])];

// ---- 2026-11-12 再加的功法用的小图 ----
/** 六丁六甲：一道小黄符（缃纸、朱砂符文，琥珀描边）；烧起来的两帧（从下往上烧掉）。 */
const SLIP = outline(grid(['yYy', 'YrY', 'YYY', 'YrY', 'YrY', 'yyy']), 'B');
const SLIP_BURN = [outline(grid(['yYy', 'YrY', 'YYY', 'YrY', 'oeo', '.e.']), 'B'), outline(grid(['yYy', 'YrY', 'oeo', '.e.', '...', '...']), 'R')];
/** 撒豆成兵：一粒金豆；豆兵（金盔金甲、执一杆戟，朝右）站着、扑击两帧。 */
const BEAN = outline(grid(['bY', 'Bb']), 'B');
const SOLDIER = [
  outline(grid(['..y...W', '.yYy..i', '.ytty.i', '.bYYb.i', 'yYbYyti', '.YYY..i', '.b.b..i', '.B.B...']), 'k'),
  outline(grid(['...y.....', '..yYy....', '..ytty...', '.bYYbiiiW', 'yYbYyt...', '.YYY.....', 'b...b....', 'B....B...']), 'k'),
];
/** 呼风唤雨：一团压低的雨云（银鼠的云身、苍色的云底、缟色的云顶，黛色描边）。 */
const RAIN_CLOUD = outline(
  grid([
    '.........jjj.............',
    '....jjj.jjiiij..jjjj.....',
    '...jiiijiiiiiiijiiiij....',
    '..jiiiiiiiiiiiiiiiiiij...',
    '.jiiiiihiiiiiiihiiiiiijj.',
    'jiiiihhhiiiiihhhiiiiiiiij',
    '.hiihhhhhhiihhhhhhiihhhh.',
    '..hhhgghhhhhhhgghhhhhhh..',
    '....ggg..gggg...ggggg....',
  ]),
  'g',
);
/** 九转玄功、五色神光用的五行色（金木水火土）。 */
const WX_COLORS = [0xe0a83a, 0x6fa35a, 0x3f8a9e, 0xd9452b, 0xb06a28];
const EARTH = [0xa48e6d, 0xb39e7d, 0x958064, 0x6b5749];
const RAIN = [0x7cc4c4, 0xf2e8d5, 0x3f8a9e];
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 土遁出土时崩起又落下的碎土块（黄土色，赭色描边）。 */
const PEBBLES = [grid(['Ea', 'aA']), grid(['aE.', 'AaA']), grid(['E', 'A'])].map((g) => outline({ w: g.w + 2, h: g.h + 2, rows: ['.'.repeat(g.w + 2), ...g.rows.map((r) => `.${r}.`), '.'.repeat(g.w + 2)] }, 'D'));

/** 掌心雷：从掌心折几折劈到 (x1, y1) 的一道细雷（天青的边、月白的芯、黛蓝描边）。返回网格和它的左上角（世界坐标）。 */
export function arcGrid(x0: number, y0: number, x1: number, y1: number): { g: Grid; ox: number; oy: number } {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const n = Math.max(3, Math.round(len / 9));
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const j = rnd(-3.5, 3.5) * Math.sin(k * Math.PI);
    pts.push([x0 + (x1 - x0) * k + nx * j, y0 + (y1 - y0) * k + ny * j]);
  }
  pts.push([x1, y1]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const ox = Math.floor(Math.min(...xs)) - 2;
  const oy = Math.floor(Math.min(...ys)) - 2;
  const g = canvas(Math.ceil(Math.max(...xs)) - ox + 3, Math.ceil(Math.max(...ys)) - oy + 3);
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let k = 0; k <= steps; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / steps - ox;
      const y = a[1] + ((b[1] - a[1]) * k) / steps - oy;
      g.put(x, y + 1, 'C');
      g.put(x, y, i === 0 || i === pts.length - 2 ? 'C' : 'w');
    }
  }
  return { g: outline(g.done(), 'n'), ox, oy };
}

// ---------------------------------------------------------------- 法天象地：人物画大一圈

/** Scale2x（EPX）：放大一倍，斜边按邻居补齐，不出新颜色。 */
function scale2x(g: Grid): Grid {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? '.' : g.rows[y][x]);
  const rows: string[][] = Array.from({ length: g.h * 2 }, () => Array(g.w * 2).fill('.'));
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const P = at(x, y);
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const L = at(x - 1, y);
      const D = at(x, y + 1);
      rows[y * 2][x * 2] = L === A && L !== D && A !== B ? A : P;
      rows[y * 2][x * 2 + 1] = A === B && A !== L && B !== D ? B : P;
      rows[y * 2 + 1][x * 2] = D === L && D !== B && L !== A ? L : P;
      rows[y * 2 + 1][x * 2 + 1] = B === D && B !== A && D !== L ? D : P;
    }
  return { w: g.w * 2, h: g.h * 2, rows: rows.map((r) => r.join('')) };
}
/** 法相：先 Scale2x 放大一倍、再按最近邻缩到 1.25 倍 —— 每个点仍是整像素、颜色不变，斜边比直接放大顺。 */
export function bigFrame(g: Grid, k = 1.25): Grid {
  const s = scale2x(g);
  const f = k / 2;
  const w = Math.round(g.w * k);
  const h = Math.round(g.h * k);
  const rows = Array.from({ length: h }, (_, Y) =>
    Array.from({ length: w }, (_, X) => {
      const sx = Math.floor((X + 0.5) / f);
      const sy = Math.floor((Y + 0.5) / f);
      return sx < s.w && sy < s.h ? s.rows[sy][sx] : '.';
    }).join(''),
  );
  return { w, h, rows };
}

/**
 * 金身：把一帧人物按明暗换成金色（暗处赭、中间琥珀 / 藤黄、亮处缃 / 灵光，玄色的描边不动）——
 * 金刚不坏反弹的那一下，人物通身变成一尊金像，一闪就退回本色。
 */
export function goldFrame(g: Grid): Grid {
  const lum = (ch: string) => {
    const hex = PALETTE[ch];
    if (!hex) return 0;
    const n = parseInt(hex.slice(1), 16);
    return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
  };
  return { w: g.w, h: g.h, rows: g.rows.map((r) => [...r].map((ch) => (ch === '.' || ch === 'k' ? ch : ((l) => (l < 0.22 ? 'B' : l < 0.4 ? 'b' : l < 0.6 ? 'y' : l < 0.82 ? 'Y' : 'f'))(lum(ch)))).join('')) };
}

/** feel.ts 交给这里的人物：精灵、帧（网格）和 feel 自己建的纹理（法天象地把它们换成大一圈的同一帧）。 */
export interface HeroHook {
  /** 第 id 个人物（w.players 的下标）的精灵；联机时每人一个（单人只有 0）。 */
  sprite: (id: number) => Sprite | undefined;
  frames: Record<NezhaPose, Grid[]>;
  tex: Record<NezhaPose, Texture[]>;
  flash: Record<NezhaPose, Texture[]>;
  anchor: { x: number; y: number; w: number; h: number };
}

// ---------------------------------------------------------------- 状态

interface Bolt {
  owner: number;
  t: number;
  warn: number;
  cloud: Sprite;
  lit: boolean;
  struck: number; // 落下之后过了多久（-1 = 还在聚云）
  bolt: Sprite | null;
  boltTex: Texture | null;
  x: number;
  y: number;
}
interface Fade {
  s: Sprite | Graphics;
  t: number;
  life: number;
  fadeIn: number;
  fadeOut: number;
  vy?: number;
  frames?: Texture[];
  fps?: number;
  peak?: number;
}
interface Bit {
  s: Sprite;
  x: number; // 精确位置（画的时候取整，像素对齐）
  y: number;
  vx: number;
  vy: number;
  g: number;
  t: number;
  life: number;
  ground: number;
}
interface EyeView {
  s: Sprite;
  open: number; // 0..1
  blink: number;
  closing: boolean;
}

export class TechniqueFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hero: HeroHook | null;
  private layer = new Container();
  private pfx: PixelFxLayer; // 地上的 pixelfx（风火轮的余火……）
  private trailAt = new Map<number, { t: number; n: number }>(); // 风火轮：每人放到了哪个火点
  private scorch = new Map<number, PixelLayer>(); // 风火轮：地上那一道断续的火痕（每人一块）
  private wheels = new Map<number, { parts: Sprite[]; spin: number; heat: number }>(); // 风火轮：脚下的一对小轮
  private wheelTex: Texture[][]; // [前轮, 后轮] × 两个转动相位
  private wheelFlame: Texture[][]; // [站着, 走着] × 三帧
  private bolts: Bolt[] = [];
  private fades: Fade[] = [];
  private bits: Bit[] = [];
  private eyes = new Map<number, EyeView>();
  private motes: { owner: number; t: number; life: number; colors: number[]; rate: number }[] = [];
  private clock = 0;
  private cloudTex: Texture[];
  private lotusTex: Texture[];
  private scorchTex: Texture;
  private impactTex: Texture;
  private shardTex: Texture[];
  private eyeTex: Texture[];
  private petalTex: Texture[];
  private big = new Map<Texture, Texture>();
  private golden = new Map<Texture, Texture>(); // 每一帧（原大和法天象地放大的）对应的金身
  private bigAnchor: [number, number] = [0.5, 1];
  // 下面三样按人物分（联机时每人一份；键是 w.players 的下标）
  private bigOn = new Map<number, boolean>();
  private heroSprite = new Map<number, Sprite>();
  private gold = new Map<number, number>(); // 金刚不坏反弹时，人物通身泛金的剩余时间
  private tops: Partial<Record<FoeViewKind, number>> = {};
  // ---- 2026-11-12 再加的功法 ----
  private slipTex: Texture;
  private slipBurnTex: Texture[];
  private beanTex: Texture;
  private soldierTex: Texture[];
  private rainCloudTex: Texture;
  private pebbleTex: Texture[];
  private slips = new Map<number, { s: Sprite[]; shown: number[] }>(); // 六丁六甲：每人身后浮着的几道符（shown：各道的显隐 0..1）
  private arcs: { s: Sprite; tex: Texture; t: number; delay: number; tx: number; ty: number; hit: boolean }[] = []; // 掌心雷
  private beans: { owner: number; s: Sprite; x0: number; y0: number; x1: number; y1: number; t: number; fly: number; id: number; soldier: Sprite | null; done: number }[] = []; // 撒豆成兵
  private storms: { owner: number; x: number; y: number; r: number; t: number; dur: number; layer: PixelLayer; clouds: Sprite[]; seed: number }[] = []; // 呼风唤雨（两团云并排，盖住落雨的那一片）

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, hero?: HeroHook) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.hero = hero ?? null;
    this.cloudTex = [cloudGrid(false), cloudGrid(true)].map(textureFromGrid);
    this.lotusTex = [0, 0.35, 0.7, 1].map((k) => textureFromGrid(lotusGrid(k)));
    this.scorchTex = textureFromGrid(SCORCH);
    this.impactTex = textureFromGrid(IMPACT);
    this.shardTex = SHARDS.map(textureFromGrid);
    this.eyeTex = EYE.map(textureFromGrid);
    this.petalTex = PETALS.map(textureFromGrid);
    this.slipTex = textureFromGrid(SLIP);
    this.slipBurnTex = SLIP_BURN.map(textureFromGrid);
    this.beanTex = textureFromGrid(BEAN);
    this.soldierTex = SOLDIER.map(textureFromGrid);
    this.rainCloudTex = textureFromGrid(RAIN_CLOUD);
    this.pebbleTex = PEBBLES.map(textureFromGrid);
    stage.fx.addChild(this.layer);
    this.pfx = new PixelFxLayer(stage.entities, { flat: true });
    this.wheelTex = [WHEEL, WHEEL.map(darker)].map((fs) => fs.map(textureFromGrid));
    this.wheelFlame = [WHEEL_FLAME_LOW, WHEEL_FLAME].map((fs) => fs.map(textureFromGrid));
    for (const [k, x] of [['zap', XFX.zapHit], ['wuqi', XFX.wuqiBurst], ['ziqi', XFX.ziqi]] as const) void prebake(`tech:${k}`, x.id, x.opts).catch((e) => console.warn(e));
    void prebake('tech:slam', XFX.sealSlam.id, { ...XFX.sealSlam.opts, reach: 22 }).catch((e) => console.warn(e));
    for (let v = 0; v < EMBER_SEEDS; v++) void prebake(`tech:ember${v}`, XFX.wheelEmber.id, { ...XFX.wheelEmber.opts, seed: v + 1 }).catch((e) => console.warn(e));
    for (const [k, v] of Object.entries(foeLooks())) this.tops[k as FoeViewKind] = v.top;
    // 调试：控制台里 __techFx 看功法画面的状态（火痕图层、天雷、竖目）
    (globalThis as unknown as { __techFx?: TechniqueFx }).__techFx = this;
    if (hero) {
      // 法天象地：每一帧的大一圈版本（受击闪白的那套也要）
      for (const pose of Object.keys(hero.frames) as NezhaPose[])
        hero.frames[pose].forEach((g, i) => {
          const b = bigFrame(g);
          const bt = textureFromGrid(b);
          const bf = flashTextureFromGrid(b);
          this.big.set(hero.tex[pose][i], bt);
          this.big.set(hero.flash[pose][i], bf);
          // 金身：原大与放大各一张；受击闪白的那张也换成金身（反弹总在挨打的那一下）
          const gold = textureFromGrid(goldFrame(g));
          const goldBig = textureFromGrid(goldFrame(b));
          this.golden.set(hero.tex[pose][i], gold);
          this.golden.set(hero.flash[pose][i], gold);
          this.golden.set(bt, goldBig);
          this.golden.set(bf, goldBig);
        });
      const g0 = bigFrame(hero.frames.idle[0]);
      this.bigAnchor = [Math.round(hero.anchor.x * 1.25) / g0.w, Math.round(hero.anchor.y * 1.25 + 0.5) / g0.h];
    }
  }

  /** 名字表（docs/audio.md）里有素材就放它，没有就放 fallback（现有的相近的声音）。 */
  private play(name: string, fallback?: string, vol = 1) {
    const n = BANK[name] ? name : fallback;
    if (n) this.sfx.play(n, vol);
  }

  /** 清空（重开一局或一波开始时）。 */
  clear() {
    for (const b of this.bolts) {
      b.cloud.destroy();
      b.bolt?.destroy();
      b.boltTex?.destroy(true);
    }
    this.bolts = [];
    for (const f of this.fades) f.s.destroy();
    this.fades = [];
    for (const b of this.bits) b.s.destroy();
    this.bits = [];
    for (const v of this.eyes.values()) v.s.destroy();
    this.eyes.clear();
    this.motes = [];
    for (const a of this.arcs) {
      a.s.destroy();
      a.tex.destroy(true);
    }
    this.arcs = [];
    for (const b of this.beans) {
      b.s.destroy();
      b.soldier?.destroy();
    }
    this.beans = [];
    for (const st of this.storms) {
      st.layer.sprite.destroy();
      for (const c of st.clouds) c.destroy();
    }
    this.storms = [];
    for (const v of this.slips.values()) v.shown.fill(0);
    this.pfx.clear();
    for (const st of this.trailAt.values()) st.t = -Infinity;
    for (const l of this.scorch.values()) l.sprite.visible = false;
    for (const v of this.wheels.values()) for (const s of v.parts) s.visible = false;
  }

  private fade(s: Sprite | Graphics, life: number, fadeIn: number, fadeOut: number, more: Partial<Fade> = {}) {
    s.alpha = fadeIn > 0 ? 0 : (more.peak ?? 1);
    this.fades.push({ s, t: 0, life, fadeIn, fadeOut, ...more });
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'skill') {
      // 混元一气：神通的冲击波外面再推开一圈混元之气（粒子，不画圈），够得着的范围看得出变大了
      const p = w.players[e.owner];
      if (has(p, 'hunyuan')) {
        const n = 44;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r0 = e.radius * 0.55;
          this.glows.emit(e.x + Math.cos(a) * r0, e.y - 8 + Math.sin(a) * r0 * 0.72, 1, [0x7cc4c4, 0xffffff, 0xf7dc7a], [e.radius * 0.9, e.radius * 1.1], [0.45, 0.6], { dir: a, spread: 0.08, drag: 2.2 });
        }
      }
      return;
    }
    if (e.t !== 'tech') return;
    switch (e.kind) {
      case 'wulei':
        if (e.act === 'warn') this.warnBolt(e.owner, e.x, e.y, e.t2 ?? TECH.wulei.warn);
        else this.strikeBolt(e.owner, e.x, e.y, e.r ?? TECH.wulei.r);
        break;
      case 'lianhua':
        this.lotus(e.owner, e.x, e.y, e.r ?? TECH.lianhua.r);
        break;
      case 'jingang':
        this.reflect(e.owner, e.x, e.y, e.pts ?? [], (e.r ?? 0) <= 0);
        break;
      case 'hanjue':
        this.shatter(e.x, e.y);
        break;
      case 'sanmei':
        this.spread(e.x, e.y, e.pts ?? []);
        break;
      case 'tuna':
        this.motes.push({ owner: e.owner, t: 0, life: 1.1, colors: [0xb8d67a, 0x6fa35a, 0xf2e8d5], rate: 26 });
        this.play('tech.breath');
        break;
      case 'tianyan':
        // 竖目在 update 里按 Enemy.eyeUntil 画；这里只在睁眼的地方迸两粒金光
        this.glows.emit(e.x, e.y - 18, 2, GOLD, [10, 25], [0.2, 0.35]);
        break;
      case 'zhangxin':
        this.palmThunder(w, e.owner, e.x, e.y, e.pts ?? []);
        break;
      case 'liuding':
        this.burnSlip(w, e.owner, e.x, e.y);
        break;
      case 'ziqi':
        this.purpleQi(e.owner, e.x, e.y, e.v ?? 0);
        break;
      case 'tudun':
        this.earthEscape(e.x, e.y, e.pts?.[0] ?? [e.x, e.y]);
        break;
      case 'jiuzhuan':
        this.turn(e.owner, e.x, e.y, e.v ?? 1);
        break;
      case 'wuqi':
        this.fiveQi(e.x, e.y, e.r ?? TECH.wuqi.r);
        break;
      case 'sadou':
        if (e.act === 'sow') this.sow(e.owner, e.x, e.y, e.pts ?? [], e.ids ?? [], e.t2 ?? TECH.sadou.fly);
        else this.beanStrike(e.x, e.y, e.id ?? -1, e.pts?.[0]);
        break;
      case 'hufeng':
        this.rain(e.owner, e.x, e.y, e.r ?? TECH.hufeng.r, e.t2 ?? TECH.hufeng.t);
        break;
    }
  }

  // ---------- 五雷正法 ----------

  private warnBolt(owner: number, x: number, y: number, warn: number) {
    const cloud = new Sprite(this.cloudTex[0]);
    cloud.anchor.set(14 / 29, 1); // 锚点落在整像素上（奇数宽的图取正中那一列）
    cloud.alpha = 0;
    cloud.position.set(Math.round(x), Math.round(y - CLOUD_Y));
    this.layer.addChild(cloud);
    this.bolts.push({ owner, t: 0, warn, cloud, lit: false, struck: -1, bolt: null, boltTex: null, x, y });
    this.play('tech.thunder.warn');
  }

  private strikeBolt(owner: number, x: number, y: number, r: number) {
    let b = this.bolts.find((q) => q.owner === owner && q.struck < 0);
    if (!b) {
      this.warnBolt(owner, x, y, 0.01);
      b = this.bolts[this.bolts.length - 1];
    }
    b.struck = 0;
    b.x = x;
    b.y = y;
    const top = b.cloud.y - 4;
    const { g, ox, oy } = boltGrid(b.cloud.x + rnd(-2, 2), top, x, y - 5);
    b.boltTex = textureFromGrid(g);
    b.bolt = new Sprite(b.boltTex);
    b.bolt.position.set(ox, oy);
    this.layer.addChild(b.bolt);
    // 落地：焦痕（地上，慢慢淡去）、碎光、一点震屏
    const sc = new Sprite(this.scorchTex);
    sc.anchor.set(5 / 11, 2 / 5);
    sc.position.set(Math.round(x), Math.round(y));
    this.stage.floor.addChild(sc);
    this.fade(sc, 1.6, 0, 0.9, { peak: 0.85 });
    const im = new Sprite(this.impactTex);
    im.anchor.set(3 / 7, 3 / 7);
    im.position.set(Math.round(x), Math.round(y - 5));
    this.layer.addChild(im);
    this.fade(im, 0.32, 0, 0.24);
    this.sparks.emit(x, y - 4, 16, [0xffffff, 0xf7dc7a, 0x7cc4c4], [40, 120], [0.2, 0.45], { up: 20, drag: 3 });
    this.glows.emit(x, y - 6, 8, [0xffffff, 0xf7dc7a], [20, 60], [0.3, 0.5], { up: 12 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.sparks.emit(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.3, 1, [0xf7dc7a, 0xe0a83a], [20, 40], [0.25, 0.4], { dir: a, spread: 0.3, drag: 3 });
    }
    this.shake.add(0.14);
    this.play('tech.thunder', 'leigong.strike');
  }

  private updateBolts(dt: number, w: World) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.struck < 0) {
        // 聚云：跟着目标走（模拟里雷跟着目标），慢慢浓起来，云肚子里偶尔闪一下
        const st = w.players[b.owner]?.tech;
        if (st && st.boltAt >= 0) {
          b.x = st.boltX;
          b.y = st.boltY;
        }
        const k = clamp01(b.t / Math.max(0.05, b.warn));
        b.cloud.alpha = 0.95 * Math.min(1, k * 1.4);
        b.cloud.position.set(Math.round(b.x), Math.round(b.y - CLOUD_Y + 3 * (1 - k)));
        const lit = Math.sin(b.t * 30) > 0.6 && k > 0.4;
        if (lit !== b.lit) {
          b.lit = lit;
          b.cloud.texture = this.cloudTex[lit ? 1 : 0];
        }
        if (Math.random() < 0.25 * k) this.glows.emit(b.x + rnd(-7, 7), b.cloud.y - rnd(0, 3), 1, [0xf7dc7a, 0xffffff], [4, 10], [0.12, 0.2]);
        if (b.t > b.warn + 1) b.struck = 0; // 保险：没收到落雷事件也收掉
        continue;
      }
      b.struck += dt;
      // 天雷：亮一下、暗一下、再亮一下，然后在三分之一秒里淡掉；雷云散开往上飘
      const s = b.struck;
      if (b.bolt) b.bolt.alpha = s < 0.07 ? 1 : s < 0.11 ? 0.35 : s < 0.16 ? 1 : Math.max(0, 1 - (s - 0.16) / 0.32);
      b.cloud.alpha = Math.max(0, 0.95 * (1 - s / 0.8));
      b.cloud.y = Math.round(b.y - CLOUD_Y - s * 6);
      if (s > 0.8) {
        b.cloud.destroy();
        b.bolt?.destroy();
        b.boltTex?.destroy(true);
        this.bolts.splice(i, 1);
      }
    }
  }

  // ---------- 莲花化身 ----------

  private lotus(owner: number, x: number, y: number, r: number) {
    const s = new Sprite(this.lotusTex[0]);
    s.anchor.set(19 / 39, 14 / 21); // 莲心落在脚下（整像素）
    s.position.set(Math.round(x), Math.round(y + 1));
    this.stage.floor.addChild(s);
    // 先开（四帧，0.5 秒），停一会儿，再用一秒多慢慢淡去
    this.fade(s, 2.4, 0.08, 1.2, { frames: this.lotusTex, fps: 7 });
    // 震开的那一下：一圈花瓣往外飞（不画圈），再往上飘一会儿
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd(-0.1, 0.1);
      const p = new Sprite(this.petalTex[i % 2]);
      const px = x + Math.cos(a) * 6;
      const py = y - 4 + Math.sin(a) * 4;
      p.position.set(Math.round(px), Math.round(py));
      this.layer.addChild(p);
      const sp = rnd(0.7, 1) * r * 1.1;
      this.bits.push({ s: p, x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 20, g: -10, t: 0, life: rnd(1.1, 1.6), ground: 1e9 });
    }
    this.motes.push({ owner, t: 0, life: TECH.lianhua.iframes, colors: [0xf7dc7a, 0xffe9a8, 0xd47aa0, 0xf2e8d5], rate: 22 });
    // 飘字「莲花化身」（同相生飘字的像素体，月白到桃红，紫棠描边）：从头顶浮起，停一会儿再淡去
    const label = new Sprite(pixelTextTexture('莲花化身', { color: ['w', 'm'], outline: 'P' }));
    label.anchor.set(0.5, 1);
    label.position.set(Math.round(x), Math.round(y - 34));
    this.layer.addChild(label);
    this.fade(label, 1.6, 0.12, 0.5, { vy: -6 });
    this.glows.emit(x, y - 10, 18, [0xf7dc7a, 0xd47aa0, 0xffffff], [20, 70], [0.5, 0.9], { up: 30, drag: 2 });
    this.shake.add(0.3);
    this.play('tech.lotus', 'pet.evolve');
  }

  // ---------- 金刚不坏 ----------

  private reflect(owner: number, x: number, y: number, pts: [number, number][], far: boolean) {
    const g = new Graphics();
    for (const [ex, ey] of pts) {
      const x0 = x;
      const y0 = y - 12;
      const x1 = ex;
      const y1 = ey - 8;
      // 金光：一根主线加一根错开一像素的暗金线，像一道被弹回去的金芒
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1, color: 0xf7dc7a });
      g.moveTo(x0 + 1, y0 + 1).lineTo(x1 + 1, y1 + 1).stroke({ width: 1, color: 0xb06a28, alpha: 0.8 });
      this.sparks.emit(x1, y1, 5, GOLD, [30, 80], [0.15, 0.3], { drag: 4 });
      if (far) for (let k = 0; k < 6; k++) this.glows.emit(x0 + (x1 - x0) * (k / 6), y0 + (y1 - y0) * (k / 6), 1, GOLD, [3, 10], [0.25, 0.45]);
    }
    this.layer.addChild(g);
    this.fade(g, 0.4, 0, 0.3);
    // 金身一震：人物通身泛一下金（是身子本身，不是外面的光圈），迸出几粒金屑往四面飞散
    this.gold.set(owner, 0.43);
    this.sparks.emit(x, y - 12, 12, GOLD, [50, 110], [0.18, 0.35], { drag: 4 });
    this.play('tech.reflect', 'xinghuang.block');
  }

  // ---------- 寒冰诀 ----------

  private shatter(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rnd(-0.2, 0.2);
      const s = new Sprite(this.shardTex[i % 4]);
      s.position.set(Math.round(x), Math.round(y - 8));
      this.layer.addChild(s);
      const sp = rnd(45, 95);
      this.bits.push({ s, x, y: y - 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 50, g: 260, t: 0, life: rnd(0.45, 0.7), ground: y + rnd(-2, 4) });
    }
    this.glows.emit(x, y - 8, 8, ICE, [15, 45], [0.3, 0.55], { up: 8 });
    this.play('tech.shatter', 'hanbing.spike');
  }

  // ---------- 三昧真火 ----------

  private spread(x: number, y: number, pts: [number, number][]) {
    for (const [tx, ty] of pts) {
      const a = Math.atan2(ty - y, tx - x);
      const d = Math.hypot(tx - x, ty - y);
      // 一串火苗从死去的那只身上窜到身边的敌人身上（粒子飞过去的时间约 0.3 秒）
      this.sparks.emit(x, y - 8, 7, FIRE, [d / 0.36, d / 0.28], [0.28, 0.34], { dir: a, spread: 0.25, drag: 0, up: 14 });
      this.glows.emit(tx, ty - 8, 3, FIRE, [8, 22], [0.35, 0.6], { up: 18 });
    }
    this.glows.emit(x, y - 8, 6, FIRE, [10, 30], [0.4, 0.7], { up: 22 });
    this.play('tech.spread', 'react.ignite', 0.5);
  }

  // ---------- 掌心雷 ----------

  /**
   * 掌心雷：起势——掌心先聚几粒天青的电光（0.1 秒）；主体——一道道细雷从掌心折几折劈到各个敌人身上，亮、暗、再亮，
   * 落点各炸一朵雷法击中（pixelfx 预设 zapHit）；余韵——雷光在三分之一秒里淡掉，掌心剩几粒电光往上散。
   */
  private palmThunder(w: World, owner: number, x: number, y: number, pts: [number, number][]) {
    const p = w.players[owner];
    const f = p?.facing ?? 1;
    const hx = x + 6 * f;
    const hy = y - 12;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.glows.emit(hx + Math.cos(a) * 9, hy + Math.sin(a) * 6, 1, [0x7cc4c4, 0xf2e8d5], [40, 55], [0.14, 0.18], { dir: a + Math.PI, spread: 0.1, drag: 1 });
    }
    pts.forEach(([tx, ty], i) => {
      const { g, ox, oy } = arcGrid(hx, hy, tx, ty - 8);
      const tex = textureFromGrid(g);
      const s = new Sprite(tex);
      s.position.set(ox, oy);
      s.alpha = 0;
      this.layer.addChild(s);
      this.arcs.push({ s, tex, t: 0, delay: 0.1 + i * 0.03, tx, ty, hit: false });
    });
    this.play('leigong.strike', 'tech.thunder', 0.7);
  }

  private updateArcs(dt: number) {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt;
      const s = a.t - a.delay;
      if (s >= 0 && !a.hit) {
        a.hit = true; // 雷落到身上：落点炸一朵雷法击中
        this.pfx.playBaked('tech:zap', XFX.zapHit.id, XFX.zapHit.opts, { x: Math.round(a.tx), y: Math.round(a.ty - 8), z: a.ty + 1 });
        this.sparks.emit(a.tx, a.ty - 8, 5, [0xffffff, 0x7cc4c4, 0x3f8a9e], [30, 70], [0.2, 0.35], { drag: 3 });
      }
      a.s.alpha = s < 0 ? 0 : s < 0.06 ? 1 : s < 0.1 ? 0.3 : s < 0.15 ? 1 : Math.max(0, 1 - (s - 0.15) / 0.35);
      if (s > 0.5) {
        a.s.destroy();
        a.tex.destroy(true);
        this.arcs.splice(i, 1);
      }
    }
  }

  // ---------- 六丁六甲 ----------

  /**
   * 六丁六甲：还剩几道护身甲，人物身后就浮着几道小黄符（错落在肩背后，不压在身上），一上一下慢慢地浮；
   * 补回一道时那道符从淡到实、往上浮起来（0.4 秒）。抵掉一下的事件由 burnSlip 画。
   */
  private drawSlips(p: Player, w: World, dt: number, alpha: number) {
    const on = has(p, 'liuding') && p.alive && (w.phase === 'wave' || w.phase === 'collect');
    let v = this.slips.get(p.id);
    if (!on && !v) return;
    if (!v) {
      const s = [0, 1, 2].map(() => {
        const sp = new Sprite(this.slipTex);
        sp.anchor.set(0.5, 1);
        sp.alpha = 0;
        this.layer.addChild(sp);
        return sp;
      });
      this.slips.set(p.id, (v = { s, shown: [0, 0, 0] }));
    }
    const n = on ? (p.tech?.jia ?? 0) : 0;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    const f = p.facing;
    const SPOT = [
      [-13, -9],
      [-16, -16],
      [-12, -22],
    ]; // 错落在背后一侧，离身子三四像素
    v.s.forEach((sp, i) => {
      const want = i < n ? 1 : 0;
      v!.shown[i] = want ? Math.min(1, v!.shown[i] + dt / 0.4) : 0; // 消失的那道由烧掉的画面接手，这里直接收
      const k = v!.shown[i];
      sp.visible = k > 0;
      if (!sp.visible) return;
      const bob = Math.sin(this.clock * 1.6 + i * 2.1) * 1.2;
      sp.position.set(Math.round(x + SPOT[i][0] * f), Math.round(y + SPOT[i][1] + bob + (1 - k) * 4));
      sp.alpha = 0.92 * k;
    });
  }

  /** 六丁六甲抵掉一下：一道符闪到身前、金光一迸，从下往上烧成灰（0.55 秒），几粒火星和纸灰往下落。 */
  private burnSlip(w: World, owner: number, x: number, y: number) {
    const p = w.players[owner];
    const f = p?.facing ?? 1;
    const s = new Sprite(this.slipBurnTex[0]);
    s.anchor.set(0.5, 1);
    s.position.set(Math.round(x + 7 * f), Math.round(y - 9));
    this.layer.addChild(s);
    this.fade(s, 0.55, 0, 0.25, { frames: [this.slipTex, ...this.slipBurnTex], fps: 6, vy: -5 });
    this.glows.emit(x + 7 * f, y - 12, 4, GOLD, [12, 30], [0.25, 0.45], { drag: 3 }); // 金光一迸（粒子，不画十字星芒）
    this.sparks.emit(x + 7 * f, y - 13, 7, GOLD, [30, 70], [0.2, 0.35], { drag: 4 });
    this.sparks.emit(x + 7 * f, y - 10, 5, [0x9a8a86, 0x6b5a62, 0xd9452b], [8, 20], [0.6, 0.9], { g: 30, drag: 1.5 }); // 纸灰与火星往下落
    this.play('xinghuang.block', 'tech.reflect', 0.8);
  }

  // ---------- 紫气东来 ----------

  /** 紫气东来：一缕紫气自东边（画面右上方）飘来、收进人物腰间（pixelfx 预设 ziqi）；头顶浮起「+N」。 */
  private purpleQi(owner: number, x: number, y: number, v: number) {
    void owner;
    this.pfx.playBaked('tech:ziqi', XFX.ziqi.id, XFX.ziqi.opts, { x: Math.round(x), y: Math.round(y), z: y + 0.5 }); // 东边总是画面右侧，不跟着朝向翻
    if (v > 0) {
      const label = new Sprite(pixelTextTexture(`+${v}`, { color: ['Y', 'y'], outline: 'P' }));
      label.anchor.set(0.5, 1);
      label.position.set(Math.round(x), Math.round(y - 30));
      this.layer.addChild(label);
      this.fade(label, 1.4, 0.15, 0.5, { vy: -6 });
    }
    this.play('relic.pouch', 'drop.magnet', 0.7);
  }

  // ---------- 土遁 ----------

  /** 土遁：遁走处土石迸起（地裂、尘、碎石，pixelfx 预设 sealSlam 的小号），出土处一股黄土往上冒、碎石落回地上。 */
  private earthEscape(x: number, y: number, to: [number, number]) {
    this.pfx.playBaked('tech:slam', XFX.sealSlam.id, { ...XFX.sealSlam.opts, reach: 22 }, { x: Math.round(x), y: Math.round(y), z: GROUND_Z + 2 });
    this.sparks.emit(x, y - 3, 10, EARTH, [40, 90], [0.35, 0.6], { up: 60, g: 260, drag: 1.5 });
    const [tx, ty] = to;
    this.sparks.emit(tx, ty - 2, 12, EARTH, [10, 26], [0.5, 0.8], { up: 26, drag: 2 });
    this.sparks.emit(tx, ty - 2, 8, EARTH, [30, 60], [0.3, 0.5], { up: 70, g: 300, drag: 1 });
    for (let i = 0; i < 6; i++) {
      const s = new Sprite(this.pebbleTex[i % this.pebbleTex.length]);
      s.position.set(Math.round(tx), Math.round(ty - 3));
      this.layer.addChild(s);
      const a = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
      const sp = rnd(30, 60);
      this.bits.push({ s, x: tx, y: ty - 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 260, t: 0, life: rnd(0.5, 0.8), ground: ty + rnd(-1, 3) });
    }
    this.shake.add(0.12);
    this.play('relic.dundi', 'fantian.land', 0.8);
  }

  // ---------- 九转玄功 ----------

  /** 九转玄功进了一转：一缕金气绕身旋上去，头顶浮起「X转」（像素体，缃到藤黄，紫棠描边）。 */
  private turn(owner: number, x: number, y: number, v: number) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.sparks.emit(x + Math.cos(a) * 8, y - 4 - i * 1.8 + Math.sin(a) * 3, 1, [0xe0a83a, 0xb06a28, 0xf7dc7a], [6, 12], [0.5, 0.8], { up: 26, drag: 1, dir: a + Math.PI / 2 });
    }
    const label = new Sprite(pixelTextTexture(`${CN_NUM[v] ?? v}转`, { color: ['Y', 'y'], outline: 'P' }));
    label.anchor.set(0.5, 1);
    label.position.set(Math.round(x), Math.round(y - 32));
        this.layer.addChild(label);
    this.fade(label, 1.2, 0.15, 0.5, { vy: -7, peak: 0.9 });
    if (v === TECH.jiuzhuan.max) this.motes.push({ owner, t: 0, life: 1.2, colors: [0xf7dc7a, 0xe0a83a, 0xffe9a8], rate: 20 });
    this.play('tech.breath', undefined, 0.5);
  }

  // ---------- 五色神光 ----------

  /** 五色神光：五色之气（金木水火土）从那只敌人身上朝五个方向打着旋迸开、走到头化成光点（pixelfx 预设 wuqiBurst）。 */
  private fiveQi(x: number, y: number, r: number) {
    void r; // 画面按默认的半径烘好一份；判定的半径随范围加成变，画面不跟着画大（尺寸收着）
    this.pfx.playBaked('tech:wuqi', XFX.wuqiBurst.id, XFX.wuqiBurst.opts, { x: Math.round(x), y: Math.round(y), z: y + 1 });
    this.shake.add(0.06);
    this.play('qinglian.bloom', 'react.conduct', 0.6);
  }

  // ---------- 撒豆成兵 ----------

  /** 撒豆：一把金豆从手里抛出，各沿一道弧落到身前；落地化为豆兵（updateBeans）。 */
  private sow(owner: number, x: number, y: number, pts: [number, number][], ids: number[], fly: number) {
    pts.forEach(([tx, ty], i) => {
      const s = new Sprite(this.beanTex);
      s.anchor.set(0.5, 1);
      s.position.set(Math.round(x), Math.round(y - 12));
      this.layer.addChild(s);
      this.beans.push({ owner, s, x0: x, y0: y - 12, x1: tx, y1: ty, t: 0, fly, id: ids[i] ?? -1, soldier: null, done: -1 });
    });
    this.play('wuguang.throw', 'qiankun.throw', 0.6);
  }

  /**
   * 豆子在飞：抛物线，落地一小股尘；落地化为豆兵——从豆里长出来（0.15 秒），朝目标扑过去（最后四成换成扑击的那一帧、戟平端），
   * 斩下（beanStrike）之后在 0.4 秒里淡掉，散成几粒金屑、落下一粒空豆壳。
   */
  private updateBeans(dt: number, w: World, alpha: number) {
    const S = TECH.sadou;
    for (let i = this.beans.length - 1; i >= 0; i--) {
      const b = this.beans[i];
      b.t += dt;
      if (b.t < b.fly) {
        const u = b.t / b.fly;
        b.s.position.set(Math.round(b.x0 + (b.x1 - b.x0) * u), Math.round(b.y0 + (b.y1 - b.y0) * u - Math.sin(u * Math.PI) * 10 + 12 * u));
        continue;
      }
      if (!b.soldier) {
        b.s.visible = false;
        const s = new Sprite(this.soldierTex[0]);
        s.anchor.set(0.5, 1);
        s.position.set(Math.round(b.x1), Math.round(b.y1));
        s.zIndex = b.y1;
        this.stage.entities.addChild(s);
        b.soldier = s;
        this.sparks.emit(b.x1, b.y1 - 1, 5, EARTH, [15, 35], [0.25, 0.4], { up: 20, g: 120, drag: 2 });
        this.sparks.emit(b.x1, b.y1 - 4, 3, GOLD, [6, 14], [0.3, 0.5], { up: 14 });
      }
      const s = b.soldier;
      const a = b.t - b.fly;
      if (b.done < 0) {
        const e = w.enemies.find((o) => o.id === b.id && o.hp > 0);
        const grow = Math.min(1, a / 0.15);
        s.scale.y = 0.4 + 0.6 * grow;
        const u = Math.min(1, Math.max(0, (a - 0.12) / Math.max(0.05, S.dash - 0.12)));
        if (e) {
          const ex = e.px + (e.x - e.px) * alpha;
          const ey = e.py + (e.y - e.py) * alpha;
          const d = Math.hypot(ex - b.x1, ey - b.y1) || 1;
          const reach = Math.max(0, d - 7) / d;
          s.position.set(Math.round(b.x1 + (ex - b.x1) * reach * u * u), Math.round(b.y1 + (ey - b.y1) * reach * u * u));
          s.scale.x = ex < b.x1 ? -1 : 1;
        }
        s.texture = this.soldierTex[u > 0.6 ? 1 : 0];
        s.zIndex = s.y;
        if (a > S.dash + 0.5) b.done = b.t; // 保险：没收到斩下的事件也收掉
        continue;
      }
      const k = (b.t - b.done) / 0.4;
      s.alpha = Math.max(0, 1 - k);
      s.texture = this.soldierTex[0];
      if (k >= 1) {
        this.sparks.emit(s.x, s.y - 5, 4, GOLD, [6, 16], [0.4, 0.7], { up: 18 });
        const husk = new Sprite(this.beanTex);
        husk.position.set(s.x, s.y - 2);
        husk.tint = 0x9a8a86;
        this.layer.addChild(husk);
        this.bits.push({ s: husk, x: s.x, y: s.y - 2, vx: rnd(-10, 10), vy: -20, g: 200, t: 0, life: 0.7, ground: s.y });
        s.destroy();
        b.s.destroy();
        this.beans.splice(i, 1);
      }
    }
  }

  /** 豆兵斩下：一道金色的斩痕（短、斜，0.25 秒淡掉）、几粒金屑；没斩到（目标先死了）就只散掉。 */
  private beanStrike(x: number, y: number, id: number, from?: [number, number]) {
    const b = from ? this.beans.find((q) => q.done < 0 && Math.abs(q.x1 - from[0]) < 0.5 && Math.abs(q.y1 - from[1]) < 0.5) : undefined;
    if (b) b.done = b.t;
    if (id < 0) return;
    const g = new Graphics();
    const dir = b && b.soldier && b.soldier.scale.x < 0 ? -1 : 1;
    g.moveTo(Math.round(x - 4 * dir), Math.round(y - 14)).lineTo(Math.round(x + 3 * dir), Math.round(y - 4)).stroke({ width: 1, color: 0xffe9a8 });
    g.moveTo(Math.round(x - 3 * dir), Math.round(y - 14)).lineTo(Math.round(x + 4 * dir), Math.round(y - 4)).stroke({ width: 1, color: 0xb06a28, alpha: 0.8 });
    this.layer.addChild(g);
    this.fade(g, 0.3, 0, 0.22);
    this.sparks.emit(x, y - 9, 6, GOLD, [30, 70], [0.15, 0.3], { drag: 4 });
    this.play('zhanxian.hit', 'qiankun.hit', 0.45);
  }

  // ---------- 呼风唤雨 ----------

  /** 呼风唤雨：敌群上空压下一团雨云，云里落雨（updateStorms 每帧画），下完云再慢慢散。 */
  private rain(owner: number, x: number, y: number, r: number, dur: number) {
    const layer = new PixelLayer(160, 120);
    this.layer.addChild(layer.sprite);
    const clouds = [0, 1].map((i) => {
      const c = new Sprite(this.rainCloudTex);
      c.anchor.set(0.5, 1);
      c.alpha = 0;
      if (i) c.scale.x = -1;
      this.layer.addChild(c);
      return c;
    });
    this.storms.push({ owner, x, y, r, t: 0, dur, layer, clouds, seed: Math.random() * 100 });
    this.play('sihai.pour', 'xuanyuan.pool', 0.55);
  }

  /**
   * 雨：起势——云从淡到浓、往下沉一点（0.5 秒），雨由疏到密；主体——斜斜的雨丝（两三像素，天青的身、月白的头）从云底落到地上，
   * 落地溅起一两点水花、地上留一点很淡的水色；余韵——雨停之后云在 0.9 秒里散淡、往上飘。雨丝落在云底下的一片，不画边。
   */
  private updateStorms(dt: number) {
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const st = this.storms[i];
      st.t += dt;
      const t = st.t;
      const end = st.dur + 0.9;
      if (t >= end) {
        st.layer.sprite.destroy();
        for (const c of st.clouds) c.destroy();
        this.storms.splice(i, 1);
        continue;
      }
      const cy = st.y - 30;
      const cloudK = t < 0.5 ? t / 0.5 : t > st.dur ? 1 - (t - st.dur) / 0.9 : 1;
      st.clouds.forEach((c, j) => {
        c.alpha = 0.9 * cloudK;
        const side = j ? 1 : -1;
        c.position.set(Math.round(st.x + side * st.r * 0.42 + Math.sin(t * 0.8 + j * 2) * 1.5), Math.round(cy + 3 - j * 2 + (1 - Math.min(1, t / 0.5)) * -4 - Math.max(0, t - st.dur) * 6));
      });
      const rainK = t < 0.3 ? 0 : t < 0.9 ? (t - 0.3) / 0.6 : t > st.dur - 0.5 ? Math.max(0, (st.dur - t) / 0.5) : 1;
      const L = st.layer;
      L.begin(st.x - 80, st.y - 70);
      const P = L.pix;
      const put = (x: number, y: number, ch: string, lv: number) => {
        P.set(x, y, C(ch));
        const xi = x - P.ox;
        const yi = y - P.oy;
        if (xi >= 0 && yi >= 0 && xi < P.w && yi < P.h) P.a[yi * P.w + xi] = lv;
      };
      const N = 46;
      for (let k = 0; k < N; k++) {
        const h1 = hash(st.seed + k * 1.71);
        if (h1 > rainK) continue;
        const per = 0.32 + hash(st.seed + k * 2.3) * 0.18;
        const ph = (t / per + hash(st.seed + k * 3.1)) % 1;
        const cycle = Math.floor(t / per + hash(st.seed + k * 3.1));
        // 落点：云底下一片扁的椭圆里（每一轮换个地方）
        const a = hash(k * 5.3 + cycle * 1.9 + st.seed) * Math.PI * 2;
        const rr = Math.sqrt(hash(k * 7.7 + cycle * 2.7 + st.seed)) * st.r * 0.85;
        const gx = st.x + Math.cos(a) * rr;
        const gy = st.y + Math.sin(a) * rr * 0.55;
        const top = cy + 2;
        if (ph < 0.85) {
          const u = ph / 0.85;
          const yy = top + (gy - top) * u;
          const xx = gx - (1 - u) * 5; // 斜着落（风从左边来）
          // 浅色的地面上雨丝要深一点才看得见：石青的头、天青的身、黛蓝的尾（越往上越透）
          put(Math.round(xx), Math.round(yy), 'c', 0);
          put(Math.round(xx - 1), Math.round(yy - 1), 'C', 1);
          put(Math.round(xx - 1), Math.round(yy - 2), 'n', 2);
          put(Math.round(xx - 2), Math.round(yy - 3), 'n', 3);
        } else {
          // 溅起的水花：两点往两边一跳
          const u = (ph - 0.85) / 0.15;
          put(Math.round(gx - 1 - u), Math.round(gy - 1 - u * 1.5), 'c', 1);
          put(Math.round(gx + 1 + u), Math.round(gy - 1 - u), 'C', 1);
          put(Math.round(gx), Math.round(gy), 'n', 2); // 地上一点湿
        }
      }
      L.end();
    }
  }

  // ---------- 每帧 ----------

  update(dt: number, w: World, alpha: number) {
    this.clock += dt;
    this.updateBolts(dt, w);
    this.pfx.update(dt);
    this.updateArcs(dt);
    this.updateBeans(dt, w, alpha);
    this.updateStorms(dt);
    for (const p of w.players) this.drawSlips(p, w, dt, alpha);
    for (const p of w.players) {
      this.drawTrail(p, w, alpha);
      this.drawWheels(p, w, dt, alpha);
    }
    this.updateEyes(dt, w, alpha);
    // 淡入淡出的精灵与线（莲花、焦痕、金芒）
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.t += dt;
      const peak = f.peak ?? 1;
      const a = f.t < f.fadeIn ? f.t / f.fadeIn : f.t > f.life - f.fadeOut ? (f.life - f.t) / f.fadeOut : 1;
      f.s.alpha = Math.max(0, a) * peak;
      if (f.frames && f.s instanceof Sprite) f.s.texture = f.frames[Math.min(f.frames.length - 1, Math.floor(f.t * (f.fps ?? 8)))];
      if (f.vy) f.s.y += f.vy * dt;
      if (f.t >= f.life) {
        f.s.destroy();
        this.fades.splice(i, 1);
      }
    }
    // 碎冰、莲瓣
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.t += dt;
      b.vy += b.g * dt;
      b.vx *= Math.exp(-dt * 1.5);
      b.x += b.vx * dt;
      b.y = Math.min(b.ground, b.y + b.vy * dt);
      if (b.y >= b.ground) {
        b.vy = 0;
        b.vx *= 0.5;
      }
      const left = b.life - b.t;
      b.s.alpha = clamp01(left / 0.3);
      b.s.position.set(Math.round(b.x), Math.round(b.y));
      if (left <= 0) {
        b.s.destroy();
        this.bits.splice(i, 1);
      }
    }
    // 跟着人物走的灵光（重生、回气）：一粒一粒往上飘
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      const p = w.players[m.owner];
      if (p) {
        const x = p.px + (p.x - p.px) * alpha;
        const y = p.py + (p.y - p.py) * alpha;
        const n = m.rate * dt * (1 - m.t / m.life);
        for (let k = 0; k < Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); k++) {
          const a = rnd(0, Math.PI * 2);
          this.glows.emit(x + Math.cos(a) * rnd(5, 12), y - rnd(2, 22), 1, m.colors, [3, 9], [0.5, 0.9], { up: 22, drag: 1 });
        }
      }
      if (m.t >= m.life) this.motes.splice(i, 1);
    }
    for (const [id, g] of this.gold) this.gold.set(id, Math.max(0, g - dt));
    for (const p of w.players) this.dressHero(w, p.id);
  }

  /**
   * 风火轮的火痕（2026-11-12 重做；用户：「风火轮特效太丑了」「这些特效都不能廉价」）：
   * 不再画两道连着的火辙，改成地上一处一处的「余火」（pixelfx 预设 wheelEmber，预烘焙）断续地连成一道：
   * 模拟每走 gap 像素记一个火点，这里每两个火点放一处、偶尔空一处，位置沿前进方向的法线错开一两个像素；
   * 每处从这个火点留下的那一刻开始播（t0 = 它的年纪），所以和模拟里的火痕同生同灭。风朝身后吹：往左走时镜像。
   * 判定（半宽 TECH.fenghuo.w）比画出来的宽，不画判定范围。
   */
  private drawTrail(p: Player, w: World, alpha: number) {
    const tr = has(p, 'fenghuo') ? p.tech?.trail : undefined;
    let st = this.trailAt.get(p.id);
    if (!st) this.trailAt.set(p.id, (st = { t: -Infinity, n: 0 }));
    if (!tr || !tr.length || (w.phase !== 'wave' && w.phase !== 'collect')) {
      st.t = -Infinity;
      const l = this.scorch.get(p.id);
      if (l) l.sprite.visible = false;
      return;
    }
    this.drawScorch(p, w, tr, alpha);
    const last = tr[tr.length - 1];
    if (last.t < st.t) st.t = -Infinity; // 新的一波（火痕清空过）
    for (let i = 0; i < tr.length; i++) {
      const q = tr[i];
      if (q.t <= st.t) continue;
      st.t = q.t;
      const n = st.n++;
      if (hash(n * 3.17 + p.id) < 0.3) continue; // 偶尔空一处：断续
      const prev = tr[i - 1] ?? q;
      const dx = q.x - prev.x;
      const dy = q.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const side = (hash(n * 1.91 + 5) - 0.5) * 3; // 沿法线错开一两个像素
      const x = q.x + (-dy / len) * side;
      const y = q.y + (dx / len) * side * 0.6;
      const flip = Math.abs(dx) > 0.5 ? dx < 0 : p.facing < 0;
      const age = Math.max(0, w.time - q.t);
      if (age >= TECH.fenghuo.life - 0.05) continue;
      const v = n % EMBER_SEEDS;
      this.pfx.playBaked(`tech:ember${v}`, XFX.wheelEmber.id, { ...XFX.wheelEmber.opts, seed: v + 1 }, { x: Math.round(x), y: Math.round(y), flip, t0: age, z: GROUND_Z + 1 });
    }
  }

  /**
   * 风火轮的火痕底下那一道贴地的炭线：一像素宽、顺着走过的路微微摆动（不是直线），断成一截一截（四五像素一截、空两三像素）；
   * 新的一段是朱砂里夹几粒橘（刚碾过的地方旁边再烫一像素），往后转朱、转殷，最后半透明地退掉。
   */
  private drawScorch(p: Player, w: World, tr: { x: number; y: number; t: number }[], alpha: number) {
    let layer = this.scorch.get(p.id);
    if (!layer) {
      layer = new PixelLayer(480, 320);
      this.scorch.set(p.id, layer);
      layer.sprite.zIndex = GROUND_Z; // 和角色同一层（entities），排在所有角色之下、地面的阵台之上
      this.stage.entities.addChild(layer.sprite);
    }
    const F = TECH.fenghuo;
    const hx = p.px + (p.x - p.px) * alpha;
    const hy = p.py + (p.y - p.py) * alpha;
    const pts = p.moving && p.alive ? [...tr, { x: hx, y: hy, t: w.time }] : tr;
    let x0 = Infinity;
    let y0 = Infinity;
    for (const q of pts) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
    }
    layer.begin(x0 - 6, y0 - 6);
    const P = layer.pix;
    const put = (x: number, y: number, ch: string, lv: number) => {
      P.set(x, y, C(ch));
      const i = (y - P.oy) * P.w + (x - P.ox);
      if (i >= 0 && i < P.a.length && x - P.ox >= 0 && x - P.ox < P.w) P.a[i] = lv;
    };
    // 弧长从火痕的头（最老的一点）算起：断开的位置钉在地上，不跟着人走
    let s = Math.round(tr[0] ? hash(tr[0].t) * 7 : 0);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const steps = Math.max(1, Math.round(len));
      for (let j = 0; j < steps; j++, s++) {
        const u = j / steps;
        const age = Math.max(0, w.time - (a.t + (b.t - a.t) * u));
        const k = 1 - age / F.life; // 1 刚碾过，0 灭了
        if (k <= 0) continue;
        const dash = Math.floor(s / 7);
        const inDash = s % 7;
        if (inDash >= 4 + Math.floor(hash(dash * 1.3) * 2)) continue; // 一截四五像素，空两三像素
        if (k < 0.25 && hash(s * 0.77) > k * 4) continue; // 快灭的那一段一粒粒退掉
        const wob = Math.sin(s * 0.33 + dash) * 0.7;
        const x = Math.round(a.x + (b.x - a.x) * u + nx * wob);
        const y = Math.round(a.y + (b.y - a.y) * u + ny * wob * 0.6);
        const h = hash(s * 1.37 + 0.5);
        const ch = k > 0.8 ? (h > 0.78 ? 'o' : 'e') : k > 0.55 ? (h > 0.85 ? 'e' : 'r') : 'R';
        const lv = k > 0.4 ? 0 : k > 0.25 ? 1 : k > 0.12 ? 2 : 3;
        put(x, y, ch, lv);
        if (k > 0.65 && h > 0.6) put(Math.round(x + nx), Math.round(y + ny * 0.6), k > 0.85 ? 'r' : 'R', 1); // 刚碾过的旁边再烫一像素
      }
    }
    layer.end();
  }

  /**
   * 风火轮：没有自带风火轮的人物（哪吒、魔化哪吒的精灵脚下本来就踩着）脚下画一对小轮：金轮转着，轮后舔着一小簇火；
   * 走起来转得快、火舌长，站住时慢下来、火舌缩成一点。放进 entities：后轮在人物身后、前轮在身前（脚踩在轮上）。
   */
  private drawWheels(p: Player, w: World, dt: number, alpha: number) {
    let v = this.wheels.get(p.id);
    const on = has(p, 'fenghuo') && p.alive && !OWN_WHEELS.has(p.hero) && (w.phase === 'wave' || w.phase === 'collect');
    if (!on) {
      if (v) for (const s of v.parts) s.visible = false;
      return;
    }
    if (!v) {
      const parts = [0, 1, 2, 3].map(() => {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5, 1);
        this.stage.entities.addChild(s);
        return s;
      });
      this.wheels.set(p.id, (v = { parts, spin: 0, heat: 0 }));
    }
    v.heat += ((p.moving ? 1 : 0) - v.heat) * Math.min(1, dt * 5);
    v.spin += dt * (2 + 12 * v.heat);
    const x = Math.round(p.px + (p.x - p.px) * alpha);
    const y = Math.round(p.py + (p.y - p.py) * alpha);
    const f = p.facing;
    const [back, front, fb, ff] = v.parts;
    const fr = Math.floor(v.spin) % 2;
    back.texture = this.wheelTex[1][fr];
    front.texture = this.wheelTex[0][(fr + 1) % 2];
    back.position.set(x - 2 * f, y + 1);
    front.position.set(x + 2 * f, y + 2); // 轮子的下半露在脚下
    const fl = Math.floor(this.clock * 9 + p.id) % 3;
    const big = v.heat > 0.4;
    for (const [s, at] of [
      [fb, back],
      [ff, front],
    ] as const) {
      s.texture = this.wheelFlame[big ? 1 : 0][(fl + (s === ff ? 1 : 0)) % 3];
      s.scale.x = -f; // 火舌往身后舔
      s.position.set(at.x - 3 * f, at.y - 1);
      s.alpha = 0.55 + 0.45 * v.heat;
    }
    back.zIndex = fb.zIndex = y - 0.03; // 后轮在人物身后
    front.zIndex = ff.zIndex = y + 0.02; // 前轮在人物身前（同哪吒的精灵）
    for (const s of v.parts) s.visible = true;
    // 走得快时，轮后偶尔甩出一粒火星
    if (v.heat > 0.6 && Math.random() < dt * 5) this.glows.emit(x - 5 * f, y - 2, 1, FIRE, [6, 14], [0.4, 0.7], { up: 14, drag: 2 });
  }

  /** 天眼通：被暴击看破的敌人头顶睁着一只竖目，到时就闭上；偶尔眨一下眼。 */
  private updateEyes(dt: number, w: World, alpha: number) {
    const seen = new Set<number>();
    let n = 0;
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.eyeUntil === undefined || w.time >= e.eyeUntil || n >= 40) continue;
      n++;
      seen.add(e.id);
      let v = this.eyes.get(e.id);
      if (!v) {
        v = { s: new Sprite(this.eyeTex[0]), open: 0, blink: rnd(1.5, 3.5), closing: false };
        v.s.anchor.set(3 / 7, 1);
        this.layer.addChild(v.s);
        this.eyes.set(e.id, v);
      }
      v.closing = e.eyeUntil - w.time < 0.25;
      this.placeEye(v, e, alpha, dt);
    }
    for (const [id, v] of this.eyes) {
      if (seen.has(id)) continue;
      const e = w.enemies.find((x) => x.id === id && x.hp > 0);
      v.closing = true;
      if (e) this.placeEye(v, e, alpha, dt);
      else v.open = Math.max(0, v.open - dt * 6);
      if (v.open <= 0) {
        v.s.destroy();
        this.eyes.delete(id);
      } else if (!e) v.s.texture = this.eyeTex[v.open > 0.5 ? 1 : 0];
    }
  }

  private placeEye(v: EyeView, e: Enemy, alpha: number, dt: number) {
    v.open = clamp01(v.open + (v.closing ? -dt * 6 : dt * 5));
    v.blink -= dt;
    if (v.blink < -0.12) v.blink = rnd(1.8, 3.8);
    const shut = v.blink < 0 ? 1 : 0;
    const f = v.open < 0.34 ? 0 : v.open < 0.8 || shut ? 1 : 2;
    v.s.texture = this.eyeTex[f];
    const top = e.kind === 'boss' ? 36 : (this.tops[e.kind as FoeViewKind] ?? 22);
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    // 浮在头的右上侧（正上方是伤害跳字和五行印记的位置）
    v.s.position.set(Math.round(x) + 7, Math.round(y - top + 6 + Math.sin(this.clock * 2 + e.id) * 0.6));
    v.s.alpha = Math.min(1, v.open * 1.5);
  }

  /** 法天象地：第 id 个人物画大一圈（同一帧换成放大的那张，锚点仍在脚底）。没悟时把锚点还原。 */
  private dressHero(w: World, id: number) {
    const H = this.hero;
    const s = H?.sprite(id);
    if (!H || !s) return;
    if (s !== this.heroSprite.get(id)) {
      this.heroSprite.set(id, s); // 重开一局：feel 建了新的人物精灵（锚点是原来的）
      this.bigOn.set(id, false);
    }
    const on = has(w.players[id], 'fatian');
    if (on) {
      const b = this.big.get(s.texture);
      if (b) s.texture = b;
      if (!this.bigOn.get(id)) s.anchor.set(this.bigAnchor[0], this.bigAnchor[1]);
    } else if (this.bigOn.get(id)) s.anchor.set(H.anchor.x / H.anchor.w, H.anchor.y / H.anchor.h);
    this.bigOn.set(id, on);
    // 金刚不坏：反弹的那一下通身化作金像（前 0.18 秒），之后 0.25 秒里一层金色慢慢退回本色（盖过受伤的红）
    const gold = this.gold.get(id) ?? 0;
    if (gold > 0) {
      const g = this.golden.get(s.texture);
      if (gold > 0.25 && g) s.texture = g;
      const k = Math.min(1, gold / 0.25);
      const mix = (a: number) => Math.round(0xff + (a - 0xff) * k);
      s.tint = (0xff << 16) | (mix(0xe8) << 8) | mix(0x90);
      s.alpha = 1;
    }
  }
}

/** 预览用（在 Node 下把程序生成的图拼成一张自查）：莲花四帧、雷云两帧、焦痕、冰碴、竖目、莲瓣。 */
export const techFxGrids = () => ({ lotus: [0, 0.35, 0.7, 1].map(lotusGrid), cloud: [cloudGrid(false), cloudGrid(true)], scorch: SCORCH, shards: SHARDS, eye: EYE, petals: PETALS });
