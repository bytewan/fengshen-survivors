// 法宝特效用的像素精灵：火苗、尘团、碎石、冰棱、霜花、裂纹、金莲与花瓣、五行印记、雷纹、闪电……
// 全部是字符网格（调色板见 ../palette.ts），纯函数、不依赖 DOM，游戏里转成纹理，Node 工具里也能直接出 PNG 自查。
// 前半是画法工具（逐像素画布、Scale2x、RotSprite 旋转、确定性噪声），后半是各种特效精灵。
import { compose, grid, outline, type Grid } from '../pixel.ts';

// ---------------------------------------------------------------- 画法工具

/** 确定性的伪随机（同样的输入永远给同样的值），画精灵用，保证每次生成的图一样。 */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 可以逐像素画的字符画布。坐标四舍五入到整数，越界的像素直接丢掉。 */
export class Px {
  readonly w: number;
  readonly h: number;
  private c: string[];
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.c = new Array(w * h).fill('.');
  }
  get(x: number, y: number): string {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : '.';
  }
  set(x: number, y: number, ch: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = ch;
  }
  /** 只画在空处。 */
  under(x: number, y: number, ch: string) {
    if (this.get(x, y) === '.') this.set(x, y, ch);
  }
  /** Bresenham 直线。 */
  line(x0: number, y0: number, x1: number, y1: number, ch: string, onlyEmpty = false) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (onlyEmpty) this.under(x0, y0, ch);
      else this.set(x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** 把一张网格贴上来（'.' 透明）。 */
  stamp(g: Grid, x: number, y: number) {
    for (let r = 0; r < g.h; r++) for (let q = 0; q < g.w; q++) if (g.rows[r][q] !== '.') this.set(x + q, y + r, g.rows[r][q]);
  }
  grid(): Grid {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) rows.push(this.c.slice(y * this.w, (y + 1) * this.w).join(''));
    return { w: this.w, h: this.h, rows };
  }
}

/** 加一圈描边（四周先留出一像素）。sel 是同色系描边表。 */
export function lined(g: Grid, ch = 'k', sel: Record<string, string> = {}): Grid {
  return outline(compose(g.w + 2, g.h + 2, [{ g, x: 1, y: 1 }]), ch, sel);
}

/** 字符替换（换色）。 */
export function recolor(g: Grid, map: Record<string, string>): Grid {
  return { w: g.w, h: g.h, rows: g.rows.map((r) => [...r].map((c) => map[c] ?? c).join('')) };
}

/** 裁掉四周的透明边，返回新网格和裁掉的左上偏移。 */
export function crop(g: Grid): { g: Grid; dx: number; dy: number } {
  let x0 = g.w;
  let y0 = g.h;
  let x1 = -1;
  let y1 = -1;
  g.rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c === '.') return;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }),
  );
  if (x1 < 0) return { g: grid(['.']), dx: 0, dy: 0 };
  return { g: { w: x1 - x0 + 1, h: y1 - y0 + 1, rows: g.rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1)) }, dx: x0, dy: y0 };
}

/** Scale2x（EPX）：按颜色相等关系放大两倍，斜边会被修圆，不会糊。RotSprite 旋转前先放大三次。 */
export function scale2x(g: Grid): Grid {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < g.w && y < g.h ? g.rows[y][x] : '.');
  const out: string[][] = Array.from({ length: g.h * 2 }, () => new Array(g.w * 2).fill('.'));
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const P = at(x, y);
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      out[y * 2][x * 2] = C === A && C !== D && A !== B ? A : P;
      out[y * 2][x * 2 + 1] = A === B && A !== C && B !== D ? B : P;
      out[y * 2 + 1][x * 2] = D === C && D !== B && C !== A ? C : P;
      out[y * 2 + 1][x * 2 + 1] = B === D && B !== A && D !== C ? D : P;
    }
  return { w: g.w * 2, h: g.h * 2, rows: out.map((r) => r.join('')) };
}

const big8 = new WeakMap<Grid, Grid>();
/**
 * RotSprite：先用 Scale2x 放大 8 倍，再按最近邻转到目标角度、按原尺寸取样。转出来的线条是连贯的阶梯，不会断、不会糊。
 * (px, py) 是旋转中心（源图的像素坐标，可以是小数，像素中心是 x+0.5）。返回转好的网格，以及旋转中心在新网格里的位置。
 */
export function rotSprite(g: Grid, angle: number, px: number, py: number): { g: Grid; ax: number; ay: number } {
  let big = big8.get(g);
  if (!big) {
    big = scale2x(scale2x(scale2x(g)));
    big8.set(g, big);
  }
  const S = 8;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [0, 0],
    [g.w, 0],
    [0, g.h],
    [g.w, g.h],
  ].map(([x, y]) => [(x - px) * cos - (y - py) * sin, (x - px) * sin + (y - py) * cos]);
  const minX = Math.floor(Math.min(...corners.map((c) => c[0])));
  const maxX = Math.ceil(Math.max(...corners.map((c) => c[0])));
  const minY = Math.floor(Math.min(...corners.map((c) => c[1])));
  const maxY = Math.ceil(Math.max(...corners.map((c) => c[1])));
  const W = maxX - minX;
  const H = maxY - minY;
  const p = new Px(W, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const cx = minX + i + 0.5;
      const cy = minY + j + 0.5;
      const sx = cx * cos + cy * sin + px;
      const sy = -cx * sin + cy * cos + py;
      const bx = Math.floor(sx * S);
      const by = Math.floor(sy * S);
      if (bx < 0 || by < 0 || bx >= big.w || by >= big.h) continue;
      const ch = big.rows[by][bx];
      if (ch !== '.') p.set(i, j, ch);
    }
  const c = crop(p.grid());
  return { g: c.g, ax: -minX - c.dx, ay: -minY - c.dy };
}

// ---------------------------------------------------------------- 火

/**
 * 一簇火苗的循环动画（底部居中是根）。外沿朱砂、身子橘、芯子缃黄，根部一点灵光白；火舌随相位左右摆、顶上会断出小火星。
 * 不描黑边，只在外沿用暗一档的朱（r），浅色地面上也压得住。
 */
export function flameFrames(w: number, h: number, n = 8, seed = 1): Grid[] {
  const out: Grid[] = [];
  const TAU = Math.PI * 2;
  // 火舌：主舌在正中，宽的火再加左右两条矮一些的副舌，各自按不同的相位起落
  const tongues: { bx: number; rb: number; ht: number; amp: number; ph: number; sp: number }[] = [{ bx: 0, rb: 0.5, ht: 0.97, amp: 0.2, ph: 0, sp: 1 }];
  if (w >= 7)
    tongues.push({ bx: -0.24, rb: 0.3, ht: 0.62, amp: 0.16, ph: 2.1, sp: 2 }, { bx: 0.24, rb: 0.3, ht: 0.55, amp: 0.16, ph: 4.2, sp: 2 });
  for (let f = 0; f < n; f++) {
    const ph = (f / n) * TAU;
    const p = new Px(w, h);
    const base = h - 1 - (h >= 8 ? Math.round(h * 0.1) : 0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = -1;
        let bt = 0;
        for (const tg of tongues) {
          const ht = h * tg.ht * (1 + 0.09 * Math.sin(ph * tg.sp + tg.ph + seed));
          const t = (base + 0.5 - (y + 0.5)) / ht; // 0 根 … 1 尖；根下面一点是圆底
          if (t > 1 || t < -0.22) continue;
          const sway = Math.sin(ph * tg.sp + tg.ph + seed + t * 2.6) * w * tg.amp * Math.max(0, t) ** 1.4;
          const cx = (w - 1) / 2 + tg.bx * w + sway;
          // 圆底、在三成高处最宽、往上内凹收成尖
          const prof = t < 0 ? Math.sqrt(Math.max(0, 1 - (t / 0.22) ** 2)) * 0.92 : t < 0.28 ? 0.92 + (t / 0.28) * 0.08 : (1 - (t - 0.28) / 0.72) ** 1.25;
          const hw = w * tg.rb * prof;
          const v = 1 - Math.abs(x - cx) / Math.max(0.01, hw + 0.25);
          if (v > best) {
            best = v;
            bt = t;
          }
        }
        if (best < 0) continue;
        let ch: string;
        if (best > 0.62 && bt < 0.4 && bt > -0.1) ch = bt < 0.14 && best > 0.78 && h >= 10 ? 'f' : 'Y';
        else if (best > 0.3 && bt < 0.74 && bt > -0.16) ch = 'o';
        else if (best > 0.14 && bt < 0.9) ch = 'e';
        else ch = 'r';
        p.set(x, y, ch);
      }
    // 顶上断开的小火舌：每隔几帧一次，往上飘走
    if (h >= 8) {
      const k = (f + seed * 3) % n;
      if (k < 3) {
        const tx = Math.round((w - 1) / 2 + Math.sin(ph + seed) * w * 0.25);
        const ty = Math.max(0, Math.round(h * 0.12) - k);
        if (p.get(tx, ty + 1) === '.' || k > 0) {
          p.set(tx, ty, k === 2 ? 'r' : 'e');
          if (w >= 9 && k === 0) p.set(tx, ty + 1, 'r');
        }
      }
    }
    out.push(p.grid());
  }
  return out;
}

/** 预先按尺寸分档的火苗：[宽, 高]。粒子从小到大、再从大到小换档，就是「窜起、烧旺、收成余烬」。 */
export const FLAME_SIZES: [number, number][] = [
  [3, 4],
  [3, 6],
  [5, 8],
  [5, 10],
  [7, 12],
  [7, 15],
  [9, 18],
  [11, 22],
];

/** 余烬：一像素到两像素的火星，三帧明灭。 */
export const EMBER: Grid[] = [grid(['Y']), grid(['o']), grid(['e']), grid(['f'])];

// ---------------------------------------------------------------- 尘、烟、雪团

type PuffTone = 'stone' | 'snow' | 'smoke' | 'gold';
const PUFF_TONES: Record<PuffTone, [string, string, string, string]> = {
  // 高光、身子、暗面、底边
  stone: ['w', 'j', 'i', 'h'],
  snow: ['W', 'w', 'C', 'c'],
  smoke: ['i', 'h', 'g', 'd'],
  gold: ['f', 'Y', 'y', 'b'],
};

/**
 * 一团尘（或雪、烟）从小团鼓起、变大、再从里往外散开的几帧。几个圆叠出来的团，上亮下暗，最后几帧挖空散掉。
 * 不是满屏乱点：轮廓始终是一团有形状的云。
 */
export function puffFrames(r: number, n = 6, tone: PuffTone = 'stone', seed = 1): Grid[] {
  const [hi, body, shade, rim] = PUFF_TONES[tone];
  const blobs = [
    { x: 0, y: 0, r: 1 },
    { x: -0.55, y: 0.2, r: 0.7 },
    { x: 0.55, y: 0.15, r: 0.72 },
    { x: (hash(seed, 1) - 0.5) * 0.6, y: -0.45, r: 0.62 },
  ];
  const S = Math.ceil(r * 2.4) + 2;
  const out: Grid[] = [];
  for (let k = 0; k < n; k++) {
    const p = k / Math.max(1, n - 1);
    const R = r * (0.45 + 0.55 * (1 - (1 - p) ** 2));
    const g = new Px(S, S);
    const c = (S - 1) / 2;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let best = -1;
        let by = 0;
        for (const b of blobs) {
          const d = Math.hypot(x - (c + b.x * R), (y - (c + b.y * R)) * 1.15) / (b.r * R);
          if (1 - d > best) {
            best = 1 - d;
            by = (y - (c + b.y * R)) / (b.r * R);
          }
        }
        if (best < 0) continue;
        // 散开：后几帧从里往外挖空（按确定性噪声），边上先散
        if (p > 0.45 && hash(x + seed * 31, y, k) < (p - 0.45) * 1.9 * (1.1 - best)) continue;
        if (p > 0.8 && hash(x, y + seed * 17, 7) < (p - 0.8) * 3) continue;
        const ch = best < 0.16 ? (by > 0.2 ? rim : shade) : by < -0.35 ? hi : by > 0.35 ? shade : body;
        g.set(x, y, ch);
      }
    out.push(g.grid());
  }
  return out;
}

// ---------------------------------------------------------------- 碎石、火星、血

/** 碎石：几种小石块（带暗边），落地会弹一下。 */
export const ROCKS: Grid[] = [
  lined(grid(['ji', 'ih']), 'd'),
  lined(grid(['.j.', 'jih', '.h.']), 'd'),
  lined(grid(['zj', 'ih', 'h.']), 'd'),
  lined(grid(['wj']), 'd'),
  lined(grid(['j', 'h']), 'd'),
];

/** 血珠：下落的一滴（两像素）和落地后的小血点。 */
export const BLOOD_DROP: Grid = lined(grid(['o', 'e']), 'R');
export const BLOOD_DROP_BIG: Grid = lined(grid(['.o.', 'eer', '.r.']), 'R');
export const BLOOD_SPLAT: Grid[] = [grid(['.r.', 'rRr']), grid(['r.r.', 'RrRr', '.R..']), grid(['.rr.', 'rRRr', '.r..'])];
/** 流血的伤口：身上一道斜斜的血口子（两帧：渗血 / 涌出）。 */
export const WOUND: Grid[] = [lined(grid(['..e', '.e.', 'r..']), 'R'), lined(grid(['..o', '.ee', 'rr.']), 'R')];

// ---------------------------------------------------------------- 花瓣、金莲

/** 金莲花瓣：一片尖瓣转四个角度（RotSprite），描赭边。乱转着飞出去就是「花瓣绽开」。 */
const PETAL_BASE = grid(['.f.', 'fYf', 'YYy', 'yYy', '.y.']);
export const GOLD_PETAL: Grid[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => lined(rotSprite(PETAL_BASE, (i / 8) * Math.PI, 1.5, 2.5).g, 'B'));
/** 梨花瓣（梨花枪）：白瓣、桃红花心，四个角度；再加两朵整朵的五瓣梨花（翻转着飘）。 */
const PEAR_BASE = grid(['.W.', 'WwW', 'wwm', '.w.']);
export const PEAR_PETAL: Grid[] = [0, 1, 2, 3].map((i) => lined(rotSprite(PEAR_BASE, (i / 4) * Math.PI, 1.5, 2).g, 'j', { m: 'p' }));
export const PEAR_BLOSSOM: Grid[] = [
  lined(grid(['.W.W.', 'WwmwW', '.mYm.', 'WwmwW', '.w.w.']), 'j', { m: 'p', Y: 'b' }),
  lined(grid(['..W..', 'WwWwW', '.mYm.', '.wmw.', 'W...W']), 'j', { m: 'p', Y: 'b' }),
  lined(grid(['.WWW.', 'w.m.w', '.mYm.', '.wmw.']), 'j', { m: 'p', Y: 'b' }),
];

/** 一朵金莲（3/4 俯视）：手画。中间一瓣立起，两侧瓣向外摊开，前排瓣尖朝下。 */
const LOTUS_BASE = [
  '............k............',
  '......k....kYk....k......',
  '.....kYk..kYfYk..kYk.....',
  '....kYfYkkyYfYykkYfYk....',
  '.kk.kyYybyyYfYyybyYyk.kk.',
  'kYYkbyyybbyyfyybbyyybkYYk',
  '.kYYyybbyyyyYyyyybbyyYYk.',
  '..kbYYyyyyyyyyyyyyyYYbk..',
  '...kbyYfYbyyfyybYfYybk...',
  '....kbyYbkbyYybkbYybk....',
  '.....kbbk.kbyyk.kbbk.....',
  '......kk...kbk...kk......',
];
// 瓣尖的位置（行, 列）：动画时轮流点亮
const LOTUS_TIPS: [number, number][] = [
  [1, 12],
  [2, 6],
  [2, 18],
  [5, 2],
  [5, 22],
  [8, 7],
  [8, 17],
  [9, 12],
];

/**
 * 脚下的一朵金莲：花形清楚，不是一圈光。几帧里瓣尖的灵光轮流亮起（像有光在花瓣上流转）。
 * big 是神品「金莲护体」的重瓣大莲：后面再垫一层暗金的瓣，两侧多出两片。
 */
export function lotusFrames(n = 8, big = false): Grid[] {
  const base = grid(LOTUS_BASE);
  const out: Grid[] = [];
  for (let f = 0; f < n; f++) {
    const rows = base.rows.map((r) => [...r]);
    const [ty, tx] = LOTUS_TIPS[f % LOTUS_TIPS.length];
    rows[ty][tx] = 'W';
    const [ty2, tx2] = LOTUS_TIPS[(f + 4) % LOTUS_TIPS.length];
    if (rows[ty2][tx2] !== 'k') rows[ty2][tx2] = 'f';
    const g = grid(rows.map((r) => r.join('')));
    if (!big) {
      out.push(g);
      continue;
    }
    // 重瓣：后层是同一朵花往上提、往两边撑开的暗金瓣
    const back = recolor(g, { Y: 'y', f: 'Y', y: 'b', b: 'B', W: 'Y' });
    out.push(
      compose(g.w + 8, g.h + 3, [
        { g: back, x: 0, y: 0 },
        { g: back, x: 8, y: 0 },
        { g, x: 4, y: 3 },
      ]),
    );
  }
  return out;
}

// ---------------------------------------------------------------- 五行印记、雷印

/** 五行印记：头顶一个很小的五行色标记（金：一点剑芒、木：芽、水：水滴、火：火苗、土：山形）。克制，不是光圈。 */
export const ELEMENT_MARK: Record<'metal' | 'wood' | 'water' | 'fire' | 'earth', Grid> = {
  metal: lined(grid(['.W.', 'YfY', '.Y.', '.y.']), 'B'),
  wood: lined(grid(['L.L', 'LlL', '.l.', '.v.']), 'G'),
  water: lined(grid(['.C.', 'CWC', 'CCc', '.c.']), 'N'),
  fire: lined(grid(['.o.', 'oY.', 'eYe', '.e.']), 'R'),
  earth: lined(grid(['.y.', 'yYy', 'ybb']), 'B'),
};

/** 雷印（雷公鞭仙品）：被打中的敌人头顶一枚小小的折线雷纹，快落雷时闪得更急。两帧：常亮 / 亮闪。 */
export const THUNDER_MARK: Grid[] = [
  lined(grid(['..CW', '.CW.', 'CCCW', '..CW', '.CW.', '.C..']), 'N'),
  lined(grid(['..WW', '.WW.', 'WWWW', '..WW', '.WW.', '.W..']), 'N', { W: 'n' }),
];

// ---------------------------------------------------------------- 闪光（不是圆）

/** 四角星芒：一闪一闪地放大缩小（枪尖、金光、冰晶的高光）。三档大小。 */
export const STAR: Grid[] = [grid(['W']), grid(['.W.', 'WWW', '.W.']), grid(['..W..', '..W..', 'WWfWW', '..W..', '..W..']), grid(['...W...', '...W...', '..fWf..', 'WWWWWWW', '..fWf..', '...W...', '...W...'])];

/** 雪花：六个瓣的小冰晶。 */
export const SNOWFLAKE: Grid[] = [lined(grid(['C.C', '.W.', 'C.C']), 'n'), lined(grid(['..C..', 'C.W.C', '.WWW.', 'C.W.C', '..C..']), 'n')];

// ---------------------------------------------------------------- 冰

/** 一根冰棱：尖顶、左亮右暗、左棱一道月白高光，描黛蓝边。lean 往左右斜。 */
function iceShard(p: Px, bx: number, by: number, w: number, h: number, lean: number) {
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1); // 0 底 … 1 尖
    const hw = (w / 2) * (1 - t) ** 0.85;
    const cx = bx + lean * t * h * 0.35;
    for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw + 1); x++) {
      const d = x + 0.5 - cx;
      if (Math.abs(d) > hw + 0.3) continue;
      const ch = t > 0.9 ? 'W' : d < -hw * 0.45 ? 'C' : d < 0 ? (Math.abs(d + hw * 0.45) < 0.6 ? 'W' : 'C') : d < hw * 0.5 ? 'c' : 'n';
      p.set(x, by - y, ch);
    }
  }
}

/**
 * 一簇从地面冒出来的冰棱：中间最高、两边矮一些向外斜。返回「升起」的几帧（尖先冒出地面，再整根顶上来），
 * 最后一帧是长全了的样子。big 是灵品以上的冰棱（多一根、高一点）。
 * 连描边 15×16（凡）/ 17×19（灵起）：宽不超过冰棱的判定直径（半径 9），也比人矮（原来 19×21 / 25×28，灵品的冰棱和人一样高；
 * 用户 2026-11-10：法宝、特效都不能画得过大）。
 */
export function iceClusterFrames(seed: number, big = false, n = 5): Grid[] {
  const H = big ? 17 : 14;
  const W = big ? 15 : 13;
  const p = new Px(W, H);
  const mid = (W - 1) / 2;
  const count = big ? 5 : 4;
  const shards: { x: number; w: number; h: number; lean: number }[] = [];
  for (let i = 0; i < count; i++) {
    const side = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
    const hh = H * (side === 0 ? 0.98 : 0.78 - Math.abs(side) * 0.16) * (0.9 + hash(seed, i) * 0.12);
    shards.push({ x: mid + side * (big ? 2.9 : 2.6) + (hash(seed, i, 3) - 0.5) * 1, w: big ? 6 - Math.abs(side) : 5 - Math.abs(side), h: Math.round(hh), lean: side * 0.8 + (hash(seed, i, 5) - 0.5) * 0.4 });
  }
  // 矮的先画（在后面），高的后画
  shards.sort((a, b) => a.h - b.h);
  for (const s of shards) iceShard(p, s.x, H - 1, s.w, s.h, s.lean);
  const full = lined(p.grid(), 'N', { W: 'n', C: 'n', c: 'N', n: 'N' });
  const out: Grid[] = [];
  for (let k = 1; k <= n; k++) {
    const vis = Math.round((full.h * k) / n);
    const rows = Array.from({ length: full.h }, (_, y) => (y < full.h - vis ? '.'.repeat(full.w) : full.rows[y - (full.h - vis)]));
    out.push({ w: full.w, h: full.h, rows });
  }
  return out;
}

/** 冰屑：冰棱碎开飞出去的小块。 */
export const ICE_CHIPS: Grid[] = [lined(grid(['W', 'C']), 'n'), lined(grid(['WC']), 'n'), lined(grid(['.W', 'Cc']), 'n'), lined(grid(['C']), 'n')];

/** 冻住的敌人身上的冰壳：只画冰的棱线和高光，中间透出被冻住的身子。w×h 是敌人身体大小。 */
export function iceCrust(w: number, h: number): Grid {
  const p = new Px(w + 2, h + 2);
  const W = w + 2;
  const H = h + 2;
  // 外轮廓：上窄下宽的多面冰块
  const poly: [number, number][] = [
    [2, H - 1],
    [0, Math.round(H * 0.55)],
    [2, Math.round(H * 0.18)],
    [Math.round(W * 0.45), 0],
    [W - 2, Math.round(H * 0.25)],
    [W - 1, Math.round(H * 0.62)],
    [W - 3, H - 1],
  ];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    p.line(x0, y0, x1, y1, i < 3 ? 'W' : 'C');
  }
  // 两道内棱
  p.line(Math.round(W * 0.45), 1, Math.round(W * 0.38), Math.round(H * 0.7), 'C');
  p.line(Math.round(W * 0.38), Math.round(H * 0.7), 3, H - 2, 'c');
  p.set(Math.round(W * 0.3), Math.round(H * 0.3), 'W');
  return p.grid();
}

/**
 * 地面结霜：从中心向六个方向长出的冰花枝（带分叉），枝头缀几朵小雪花。返回「蔓延」的几帧（按离中心的路程逐步长出来）。
 * 是有结构的枝，不是一片乱点。
 */
export function frostFrames(r: number, seed: number, n = 6): Grid[] {
  const S = Math.ceil(r * 2) + 5;
  const c = (S - 1) / 2;
  const pts: { x: number; y: number; t: number; ch: string }[] = [];
  const arms = 6;
  const a0 = hash(seed, 9) * Math.PI;
  const grow = (x: number, y: number, a: number, len: number, t0: number, depth: number) => {
    let px = x;
    let py = y;
    const steps = Math.max(2, Math.round(len));
    for (let i = 1; i <= steps; i++) {
      const aa = a + (hash(seed, depth * 97 + i, Math.round(x * 13 + y)) - 0.5) * 0.35;
      const nx = px + Math.cos(aa);
      const ny = py + Math.sin(aa) * 0.62; // 俯视压扁
      const t = t0 + i / r;
      pts.push({ x: Math.round(nx), y: Math.round(ny), t, ch: i > steps - 2 ? 'C' : depth === 0 ? 'C' : 'c' });
      if (depth === 0 && i % 5 === 0 && i < steps - 3) {
        for (const s of [-1, 1]) grow(nx, ny, a + s * (0.95 + hash(seed, i, s + 3) * 0.3), len * 0.38 * (1 - i / steps) + 2, t, 1);
      }
      px = nx;
      py = ny;
    }
    if (depth === 0) pts.push({ x: Math.round(px), y: Math.round(py), t: t0 + steps / r + 0.05, ch: '*' });
  };
  for (let i = 0; i < arms; i++) grow(c, c, a0 + (i / arms) * Math.PI * 2, r * (0.78 + hash(seed, i, 1) * 0.22), 0, 0);
  const maxT = Math.max(...pts.map((q) => q.t));
  const out: Grid[] = [];
  for (let k = 1; k <= n; k++) {
    const lim = (maxT * k) / n;
    const p = new Px(S, S);
    for (const q of pts) {
      if (q.t > lim) continue;
      if (q.ch === '*') {
        // 枝头一朵小雪花
        for (const [dx, dy, ch] of [
          [0, 0, 'W'],
          [-1, 0, 'C'],
          [1, 0, 'C'],
          [0, -1, 'C'],
          [0, 1, 'C'],
        ] as [number, number, string][])
          p.set(q.x + dx, q.y + dy, ch);
      } else p.set(q.x, q.y, q.ch);
    }
    // 中心一小片白霜
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      p.set(c + dx, c + dy, 'W');
    out.push(p.grid());
  }
  return out;
}

// ---------------------------------------------------------------- 地裂

/**
 * 地面裂纹：从中心放射出去的几道折线裂口（两像素宽：暗缝 + 一侧受光的石唇），rich 时再加一圈蛛网状的横裂、缝里透出土黄的灵光。
 * 返回「裂开」的几帧（从中心往外延伸）。不画一像素的细线（用户否过）。
 */
export function crackFrames(r: number, seed: number, rich = false, n = 5): Grid[] {
  const S = Math.ceil(r * 2) + 6;
  const c = (S - 1) / 2;
  const segs: { x0: number; y0: number; x1: number; y1: number; t: number; main: boolean }[] = [];
  const count = rich ? 8 : 6;
  const a0 = hash(seed, 2) * Math.PI * 2;
  const ends: { x: number; y: number; t: number }[][] = [];
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2 + (hash(seed, i, 4) - 0.5) * 0.5;
    const len = r * (0.62 + hash(seed, i, 6) * 0.38);
    let x = c + Math.cos(a) * 2;
    let y = c + Math.sin(a) * 1.2;
    let dist = 0;
    const path: { x: number; y: number; t: number }[] = [];
    while (dist < len) {
      const st = 2.5 + hash(seed, i, Math.round(dist)) * 2.5;
      const aa = a + (hash(seed, i * 7, Math.round(dist * 3)) - 0.5) * 0.9;
      const nx = x + Math.cos(aa) * st;
      const ny = y + Math.sin(aa) * st * 0.62;
      dist += st;
      segs.push({ x0: x, y0: y, x1: nx, y1: ny, t: dist / len, main: dist < len * 0.7 });
      path.push({ x: nx, y: ny, t: dist / len });
      // 分叉
      if (dist > len * 0.4 && hash(seed, i, Math.round(dist * 5)) < 0.16) {
        const ba = aa + (hash(seed, i, 77) < 0.5 ? -1 : 1) * (0.6 + hash(seed, i, 78) * 0.4);
        const bl = 3 + hash(seed, i, 79) * 5;
        segs.push({ x0: nx, y0: ny, x1: nx + Math.cos(ba) * bl, y1: ny + Math.sin(ba) * bl * 0.62, t: dist / len + 0.1, main: false });
      }
      x = nx;
      y = ny;
    }
    ends.push(path);
  }
  // 蛛网：相邻两道主裂之间在半径约一半处连一道横裂
  if (rich)
    for (let i = 0; i < count; i++) {
      const A = ends[i];
      const B = ends[(i + 1) % count];
      const pa = A[Math.min(A.length - 1, Math.floor(A.length * 0.5))];
      const pb = B[Math.min(B.length - 1, Math.floor(B.length * 0.45))];
      if (pa && pb && hash(seed, i, 99) < 0.75) segs.push({ x0: pa.x, y0: pa.y, x1: pb.x, y1: pb.y, t: 0.75, main: false });
    }
  const out: Grid[] = [];
  // 两像素宽的裂口：沿线段的法线方向（横着走的缝往下加一像素、竖着走的往右加一像素）
  const thick = (p: Px, s: { x0: number; y0: number; x1: number; y1: number }, ch: string, dx: number, dy: number, onlyEmpty = false) => p.line(s.x0 + dx, s.y0 + dy, s.x1 + dx, s.y1 + dy, ch, onlyEmpty);
  for (let k = 1; k <= n; k++) {
    const lim = k / n + 0.001;
    const p = new Px(S, S);
    const shown = segs.filter((s) => s.t <= lim + 0.12);
    const off = (s: { x0: number; y0: number; x1: number; y1: number }) => (Math.abs(s.x1 - s.x0) > Math.abs(s.y1 - s.y0) ? [0, 1] : [1, 0]);
    // 1) 缝两边：下沿一道受光的石唇（月白），上沿一道压暗的边（黛）
    for (const s of shown) {
      const [ox, oy] = off(s);
      thick(p, s, 'w', ox * 2, oy * 2, true);
      thick(p, s, 'g', -ox, -oy, true);
    }
    // 2) 暗缝本身：主裂两像素（玄 + 乌），分叉一像素
    for (const s of shown) {
      const [ox, oy] = off(s);
      p.line(s.x0, s.y0, s.x1, s.y1, 'k');
      if (s.main || s.t < 0.85) thick(p, s, 'd', ox, oy);
    }
    // 3) 缝里透出的土黄灵光（仙品的地裂）
    if (rich)
      for (const s of shown)
        if (s.t <= lim && hash(Math.round(s.x0), Math.round(s.y0), seed) < 0.5) p.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, k === n ? 'y' : 'b');
    // 中心：砸出的浅坑（四周一圈翻起的碎石边）
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const d = Math.hypot(dx / 5.2, dy / 3.2);
        if (d > 1) continue;
        p.set(c + dx, c + dy, d > 0.75 ? (dy < 0 ? 'g' : 'w') : d > 0.45 ? 'h' : 'g');
      }
    out.push(p.grid());
  }
  return out;
}

/** 焦痕（落雷、火）：一小片烧黑的地，带几道放射的黑纹。 */
export function scorch(r: number, seed: number): Grid {
  const S = Math.ceil(r * 2) + 3;
  const c = (S - 1) / 2;
  const p = new Px(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - c;
      const dy = (y - c) * 1.8;
      const d = Math.hypot(dx, dy) / r;
      const a = Math.atan2(dy, dx);
      const ray = 0.55 + 0.45 * Math.abs(Math.sin(a * 3 + seed));
      if (d > ray) continue;
      p.set(x, y, d < ray * 0.45 ? 'k' : d < ray * 0.75 ? 'd' : 'g');
    }
  return p.grid();
}

// ---------------------------------------------------------------- 闪电

export interface BoltPath {
  pts: [number, number][];
  /** 1：细枝；2：主干；3：粗主干。 */
  w: 1 | 2 | 3;
}
export type BoltStyle = 'azure' | 'gold' | 'violet';
const BOLT_COLORS: Record<BoltStyle, { core: string; body: string; edge: string; sel: Record<string, string> }> = {
  azure: { core: 'W', body: 'C', edge: 'N', sel: { W: 'n', C: 'N' } },
  gold: { core: 'W', body: 'Y', edge: 'B', sel: { W: 'b', Y: 'B' } },
  violet: { core: 'W', body: 'm', edge: 'P', sel: { W: 'p', m: 'P' } },
};

/**
 * 把一组折线栅格化成一道闪电：白芯、亮色身子、深色描边（浅色地面上也看得见）。
 * 返回网格和它左上角在折线坐标系里的位置（ox, oy），贴图时 sprite.position = (ox, oy)。
 */
export function boltGrid(paths: BoltPath[], style: BoltStyle): { g: Grid; ox: number; oy: number } {
  const all = paths.flatMap((p) => p.pts);
  const minX = Math.floor(Math.min(...all.map((q) => q[0]))) - 4;
  const minY = Math.floor(Math.min(...all.map((q) => q[1]))) - 4;
  const maxX = Math.ceil(Math.max(...all.map((q) => q[0]))) + 4;
  const maxY = Math.ceil(Math.max(...all.map((q) => q[1]))) + 4;
  const p = new Px(maxX - minX + 1, maxY - minY + 1);
  const col = BOLT_COLORS[style];
  // 先画细的、后画粗的（粗的盖在上面）
  const sorted = [...paths].sort((a, b) => a.w - b.w);
  for (const path of sorted) {
    for (let i = 0; i < path.pts.length - 1; i++) {
      const [x0, y0] = path.pts[i];
      const [x1, y1] = path.pts[i + 1];
      const X0 = x0 - minX;
      const Y0 = y0 - minY;
      const X1 = x1 - minX;
      const Y1 = y1 - minY;
      if (path.w >= 2) {
        p.line(X0 - 1, Y0, X1 - 1, Y1, col.body, true);
        p.line(X0 + 1, Y0, X1 + 1, Y1, col.body, true);
        if (path.w === 3) {
          p.line(X0, Y0 - 1, X1, Y1 - 1, col.body, true);
          p.line(X0, Y0 + 1, X1, Y1 + 1, col.body, true);
        }
        p.line(X0, Y0, X1, Y1, col.core);
      } else p.line(X0, Y0, X1, Y1, col.body, true);
    }
  }
  return { g: outline(p.grid(), col.edge, col.sel), ox: minX, oy: minY };
}

// ---------------------------------------------------------------- 斩痕

/** 飞刀命中时的一道斩痕：斜着划过的白光，三帧（划开、最亮、收细）。 */
export const SLASH: Grid[] = [
  lined(grid(['....W', '...W.', '..W..', '.....', '.....']), 'j'),
  lined(grid(['.....W', '....WW', '...Wf.', '..Wf..', '.Wf...', 'W.....']), 'h', { W: 'h', f: 'h' }),
  lined(grid(['.....', '.....', '..j..', '.j...', 'j....']), 'h'),
];
