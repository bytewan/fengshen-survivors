// 过场里的封神榜（近景用的大榜）：一卷黄绢长榜，上下镶暗金边，两头漆黑金首的轴；榜面从右往左一列列写着神名（暗金字），
// 右起第一列是朱色的榜头「封神榜」。比标题页的榜大：近景里纸面有四五十像素高，字是 5×5 的笔画团。
// 两个动作：展开（两根轴从中间往两头分开，纸从中间往外露出来）和撕裂（中间偏右撕开一道上窄下宽的豁口，里面透出白光）。
// 用户口径：不要一像素的细裂缝（试过的「榜裂」被否），所以撕开的是有宽度、两边锯齿、被白光照亮的豁口。
import { blank, clamp01, mulberry32, put, rgbaOf, type Bitmap } from './common.ts';

export interface GrandScroll {
  /** 整张榜（含两头的轴），没有裂口。 */
  paper: Bitmap;
  /** 迎风（受光）、背风（背光）的两张：随风起伏时按每一列的斜率换着用。 */
  lit: Bitmap;
  shade: Bitmap;
  W: number;
  H: number;
  rodW: number;
  /** 纸面在位图里的范围（含）。 */
  px0: number;
  px1: number;
  py0: number;
  py1: number;
  /** 撕开的位置（位图横坐标）。 */
  riftX: number;
  /** 裂口两边每一行的锯齿（相对中线、在完全撕开时的像素偏移；负 = 往左）。 */
  left: Float32Array;
  right: Float32Array;
  /** 横跨在豁口上、还没扯断的几缕绢丝（行，豁口张到多少时断）。 */
  fibers: { y: number; snap: number }[];
}

/** 小号的神名字团（3×3），同标题页。 */
const SMALL = [
  ['b.b', '.b.', 'b.b'],
  ['.b.', 'bbb', 'b.b'],
  ['bbb', 'b.b', 'bbb'],
  ['b..', 'bb.', 'b.b'],
  ['bb.', '.bb', 'b..'],
  ['.bb', 'bb.', '.b.'],
  ['b.b', 'bbb', '.b.'],
  ['bbb', '.b.', 'bb.'],
];

/** 5×5 的「字」：由几笔（横、竖、撇、点、口）随机拼出来，读成一个个方块字，不必认得。 */
function glyph5(rnd: () => number): string[] {
  const g = Array.from({ length: 5 }, () => Array(5).fill('.'));
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < 5 && y < 5) g[y][x] = 'B';
  };
  const strokes = 3 + Math.floor(rnd() * 3);
  for (let s = 0; s < strokes; s++) {
    const r = rnd();
    if (r < 0.26) {
      // 横：一整横或半横
      const y = [0, 1, 2, 2, 3, 4][Math.floor(rnd() * 6)];
      const a = rnd() < 0.7 ? 0 : 1 + Math.floor(rnd() * 2);
      const b = rnd() < 0.7 ? 4 : 2 + Math.floor(rnd() * 2);
      for (let x = a; x <= b; x++) set(x, y);
    } else if (r < 0.5) {
      // 竖
      const x = [0, 1, 2, 2, 3, 4][Math.floor(rnd() * 6)];
      const a = rnd() < 0.6 ? 0 : 1;
      const b = rnd() < 0.6 ? 4 : 3;
      for (let y = a; y <= b; y++) set(x, y);
    } else if (r < 0.64) {
      // 撇 / 捺
      const dir = rnd() < 0.5 ? 1 : -1;
      const x0 = dir > 0 ? Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 2);
      const y0 = Math.floor(rnd() * 2);
      for (let k = 0; k < 3 + Math.floor(rnd() * 2); k++) set(x0 + dir * k, y0 + k);
    } else if (r < 0.78) {
      // 口
      const x0 = Math.floor(rnd() * 2);
      const y0 = Math.floor(rnd() * 2) + 1;
      for (let x = x0; x <= x0 + 2; x++) {
        set(x, y0);
        set(x, y0 + 2);
      }
      set(x0, y0 + 1);
      set(x0 + 2, y0 + 1);
    } else {
      // 点
      set(Math.floor(rnd() * 5), Math.floor(rnd() * 5));
      set(Math.floor(rnd() * 5), Math.floor(rnd() * 5));
    }
  }
  return g.map((r) => r.join(''));
}

/** 榜头「封神榜」：朱色、7×7 的三个大字团（近景）/ 5×5（远景，同标题页）。 */
const HEAD5 = [
  ['r.r.r', 'rrr.r', 'r.rrr', 'rrr.r', 'r.r.r'],
  ['.r.rr', 'rrr.r', '.r.rr', 'rr.r.', '.r.rr'],
  ['r.rrr', 'rrr.r', 'r.rrr', 'rr.r.', 'r.r.r'],
];
const HEAD7 = [
  ['.r..r.r', 'rrr.rrr', '.r..r.r', 'rrr.rrr', '.r...r.', 'rrr.rrr', 'r.r..r.'],
  ['..r.rrr', 'rrrrr.r', '..r.rrr', 'rr.rr.r', '.r.rrrr', 'rr.r..r', '..r.rrr'],
  ['r..rrrr', 'rr.r..r', 'r..rrrr', 'rrr.r.r', 'r.rrrrr', 'r.r.r.r', 'r.r.rr.'],
];

/**
 * 做一张大榜。len：纸面长度；paperH：纸面高度；big：近景（5×5 的字、7×7 的榜头）还是远景（3×3、5×5）。
 */
export function makeGrandScroll(len: number, paperH: number, seed: number, big: boolean): GrandScroll {
  const rnd = mulberry32(seed);
  const rodW = big ? 8 : 6;
  const cap = big ? 6 : 4; // 轴比纸面上下各长出多少
  const W = len + rodW * 2;
  const H = paperH + cap * 2;
  const paper = blank(W, H);
  const px0 = rodW;
  const px1 = rodW + len - 1;
  const py0 = cap;
  const py1 = cap + paperH - 1;
  // 纸面的竖向剖面：暗边、镶边（两道暗金线夹一道缃）、黄绢
  const rim = big ? 5 : 3;
  const profile = (y: number) => {
    const d = Math.min(y - py0, py1 - y);
    if (d === 0) return 'B';
    if (big) return d === 1 ? 'b' : d === 2 ? 'y' : d === 3 ? 'Y' : d === 4 ? 'b' : 'Y';
    return d <= 2 ? (y < (py0 + py1) / 2 && d === 1 ? 'Y' : 'y') : d === 3 ? 'b' : 'Y';
  };
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) put(paper, x, y, x === px0 || x === px1 ? 'B' : profile(y));

  // 神名：一列一列，从右往左
  const fieldTop = py0 + rim + (big ? 3 : 1);
  const fieldBot = py1 - rim - (big ? 3 : 1);
  const gw = big ? 5 : 3;
  const step = big ? 9 : 5;
  let x = px1 - (big ? 12 : 9);
  for (let col = 0; x >= px0 + 6; col++) {
    if (col === 0) {
      // 榜头
      const hs = big ? HEAD7 : HEAD5;
      const hsz = hs[0].length;
      const gap = big ? 3 : 1;
      const total = hs.length * hsz + (hs.length - 1) * gap;
      let gy = Math.round((fieldTop + fieldBot) / 2 - total / 2);
      for (const g of hs) {
        g.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && put(paper, x - 1 + i, gy + j, ch)));
        gy += hsz + gap;
      }
      x -= big ? 15 : 9;
      continue;
    }
    if (rnd() < 0.08) {
      x -= big ? 6 : 4;
      continue;
    }
    let gy = fieldTop;
    if (rnd() < 0.2) {
      // 品阶的朱点
      put(paper, x + (gw >> 1), gy, 'e');
      if (big) put(paper, x + (gw >> 1), gy + 1, 'r');
      gy += big ? 4 : 2;
    }
    const n = big ? 2 + Math.floor(rnd() * 4) : 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n && gy + gw <= fieldBot + 1; k++) {
      const G = big ? glyph5(rnd) : SMALL[Math.floor(rnd() * SMALL.length)];
      G.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && put(paper, x + i, gy + j, big && rnd() < 0.12 ? 'b' : ch)));
      gy += gw + (big ? 2 : 1);
    }
    x -= step;
  }
  // 两头的轴：漆黑轴身、金首
  const rod = (rx: number) => {
    for (let y = 0; y < H; y++) {
      const isCap = y < cap || y >= H - cap;
      for (let i = 0; i < rodW; i++) {
        const X = rx + i;
        const edge = i === 0 || i === rodW - 1;
        if (isCap) {
          const r = y < cap ? y : H - 1 - y;
          if (r === 0) {
            if (!edge) put(paper, X, y, 'B');
          } else put(paper, X, y, edge ? 'B' : r === 1 ? 'Y' : i <= rodW / 2 - 1 ? 'y' : 'b');
        } else put(paper, X, y, edge ? 'k' : i === 1 ? 'g' : i === 2 && big ? 'h' : 'd');
      }
    }
  };
  rod(0);
  rod(W - rodW);
  // 受光版 / 背光版：纸面整体亮一档、暗一档
  const swap = (m: Record<string, string>) => {
    const out = blank(W, H);
    out.data.set(paper.data);
    const from = Object.keys(m).map((k) => [rgbaOf(k), m[k]] as const);
    for (let y = py0; y <= py1; y++)
      for (let X = px0 + 1; X < px1; X++) {
        const i = (y * W + X) * 4;
        const hit = from.find(([c]) => c[0] === paper.data[i] && c[1] === paper.data[i + 1] && c[2] === paper.data[i + 2]);
        if (hit) put(out, X, y, hit[1]);
      }
    return out;
  };
  const lit = swap({ y: 'Y', b: 'y', Y: 'f' });
  const shade = swap({ Y: 'y', y: 'b', f: 'Y' });
  // 裂口的锯齿：左右两道边各自随机游走，上窄下宽（完全撕开时）
  const riftX = px0 + Math.round(len * 0.53);
  const left = new Float32Array(H);
  const right = new Float32Array(H);
  let a = 0;
  let c = 0;
  for (let y = 0; y < H; y++) {
    const t = clamp01((y - py0) / paperH);
    a = Math.max(-3, Math.min(3, a + (rnd() < 0.42 ? -1 : rnd() < 0.62 ? 1 : 0)));
    c = Math.max(-3, Math.min(3, c + (rnd() < 0.42 ? 1 : rnd() < 0.62 ? -1 : 0)));
    const half = (big ? 1.4 : 0.6) + (big ? 10 : 4.6) * t * t + (big ? 3 : 1.2) * t;
    // 边上再加一点逐行的毛茬（撕开的绢边是一缕缕的，不是光滑的锯齿）
    const fuzz = big ? (rnd() < 0.3 ? 1 : 0) : 0;
    left[y] = -half + a * (big ? 1 : 0.8) - fuzz;
    right[y] = half + c * (big ? 1 : 0.8) + (big && rnd() < 0.3 ? 1 : 0);
  }
  // 还没扯断的绢丝：几行，豁口张到 snap 时断开
  const fibers = big
    ? Array.from({ length: 4 }, () => ({ y: py0 + rim + 2 + Math.floor(rnd() * (paperH - rim * 2 - 8)), snap: 0.3 + rnd() * 0.45 }))
    : [];
  return { paper, lit, shade, W, H, rodW, px0, px1, py0, py1, riftX, left, right, fibers };
}

export interface ScrollPose {
  /** 位图左上角画在哪里（目标位图坐标；完全展开时）。 */
  x: number;
  y: number;
  /** 展开了多少（0 卷着，1 完全展开）。 */
  open: number;
  /** 每一列的上下偏移（风）与斜率（> 0.9 换背光版，< -0.9 换受光版）。参数是位图横坐标。 */
  wave: (bx: number) => number;
  /** 撕开了多少（0..1）；不给就是完整的。 */
  tear?: number;
  /** 撕开后左右两半各往外错开多少像素（完全撕开时）。 */
  sepL?: number;
  sepR?: number;
  /** 裂口里的光的亮度（0..1，呼吸）。 */
  glow?: number;
  /** 裂口边上的余烬每隔一会儿换一个样子：传一个慢慢变的整数（比如 floor(t * 4)）。 */
  phase?: number;
}

/** 整数坐标的小散列（0..1）：裂口边上哪几粒是余烬，跟着 phase 慢慢换，不每帧乱闪。 */
const hash = (x: number, y: number, z: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * 把榜画进目标位图（逐列：每列按风上下错开；迎风换亮版、背风换暗版）。
 * 展开：纸从中间往两头露出来，两根轴在露出来的那一段两头，没展开的纸卷在轴上（轴边多一圈纸卷，越卷越粗）。
 * 撕裂：豁口按 tear 从无到有地张开（上沿先裂、往下裂开），豁口里透出白光，边上一像素白、一像素灵光黄，零星余烬。
 */
export function drawScroll(dst: Bitmap, sc: GrandScroll, p: ScrollPose) {
  const { W, H, rodW, px0, px1, py0, py1 } = sc;
  const len = px1 - px0 + 1;
  const mid = px0 + len / 2;
  const half = (len / 2) * clamp01(p.open);
  const tear = clamp01(p.tear ?? 0);
  const sepL = Math.round((p.sepL ?? 0) * tear);
  const sepR = Math.round((p.sepR ?? 0) * tear);
  const glowA = p.glow ?? 1;
  const ph = p.phase ?? 0;
  // 撕口从上往下裂开：每一行在 tear 到多少时开始张开
  const rowOpen = (y: number) => {
    const t = (y - py0) / (py1 - py0);
    return clamp01((tear * 1.35 - t * 0.35) / 1);
  };
  // 目标列 → 源列（展开时露出的是中间那一段；撕开时左右两半各往外错开）
  const lo = Math.floor(mid - half);
  const hi = Math.ceil(mid + half) - 1;
  const roll = Math.round((1 - clamp01(p.open)) * (rodW >= 8 ? 4 : 3)); // 卷在轴上的纸
  const colOut = (sx: number, tx: number, src: Bitmap, dy: number, kind: 'paper' | 'rod' | 'roll') => {
    const X = Math.round(p.x + tx);
    if (X < 0 || X >= dst.w) return;
    for (let y = 0; y < H; y++) {
      const Y = Math.round(p.y + y + dy);
      if (Y < 0 || Y >= dst.h) continue;
      if (kind === 'roll') {
        // 纸卷：纸的颜色压暗一档，上下比纸面略短
        if (y < py0 || y > py1) continue;
        const d = Math.min(y - py0, py1 - y);
        put(dst, X, Y, d === 0 ? 'B' : d < 2 ? 'b' : 'y');
        continue;
      }
      const i = (y * W + sx) * 4;
      if (!src.data[i + 3]) continue;
      // 撕口
      if (kind === 'paper' && tear > 0 && y >= py0 && y <= py1) {
        const k = rowOpen(y);
        const L = sc.riftX + sc.left[y] * k;
        const R = sc.riftX + sc.right[y] * k;
        const gx = sx; // 源列
        if (k > 0.02 && gx > L - 0.5 && gx < R + 0.5) continue; // 豁口里：光已经先画好了
        const d = Math.min(Math.abs(gx - L), Math.abs(gx - R));
        if (k > 0.02 && d < 1.5) {
          put(dst, X, Y, hash(gx, y, ph) < 0.12 ? 'o' : 'W');
          continue;
        }
        if (k > 0.02 && d < 2.5) {
          put(dst, X, Y, hash(gx, y, ph + 7) < 0.15 ? 'e' : 'f');
          continue;
        }
        if (k > 0.2 && d < 4 && hash(gx, y, 3) < 0.55) {
          put(dst, X, Y, 'Y');
          continue;
        }
      }
      dst.data[(Y * dst.w + X) * 4] = src.data[i];
      dst.data[(Y * dst.w + X) * 4 + 1] = src.data[i + 1];
      dst.data[(Y * dst.w + X) * 4 + 2] = src.data[i + 2];
      dst.data[(Y * dst.w + X) * 4 + 3] = 255;
    }
  };
  const pick = (bx: number) => {
    const s = p.wave(bx + 3) - p.wave(bx - 3);
    return s > 0.9 ? sc.shade : s < -0.9 ? sc.lit : sc.paper;
  };
  // 豁口里的光：先画（左右两半错开后中间空出来的那一截也要填上），纸面画上去时跳过豁口；上沿漏出一两像素
  const gapAt = (y: number) => {
    const k = rowOpen(y);
    return { k, L: sc.riftX + sc.left[y] * k, R: sc.riftX + sc.right[y] * k };
  };
  // 目标列 → 它上下错开多少按哪一列的风算（每一列只用一个偏移，豁口里的光才不会一行行地错出缝来）
  const srcOf = (tx: number) => (tx < sc.riftX - sepL ? tx + sepL : tx > sc.riftX + sepR ? tx - sepR : sc.riftX);
  if (tear > 0) {
    for (let y = py0 - 2; y <= py1; y++) {
      const g = gapAt(Math.max(py0, y));
      if (g.k <= 0.02) continue;
      if (y < py0 && g.R - g.L + sepL + sepR < 4) continue;
      const TL = Math.floor(g.L) - sepL;
      const TR = Math.ceil(g.R) + sepR;
      for (let tx = TL; tx <= TR; tx++) {
        const X = Math.round(p.x + tx);
        const Y = Math.round(p.y + y + p.wave(srcOf(tx)));
        const m = Math.min(tx - TL, TR - tx) / Math.max(1, (TR - TL) / 2);
        put(dst, X, Y, m > 0.28 + (1 - glowA) * 0.5 ? 'W' : 'f');
      }
    }
  }
  // 纸面
  for (let sx = Math.max(px0, lo); sx <= Math.min(px1, hi); sx++) {
    const left = sx < sc.riftX;
    const tx = sx + (tear > 0 ? (left ? -sepL : sepR) : 0);
    colOut(sx, tx, pick(sx), Math.round(p.wave(sx)), 'paper');
  }
  // 还没扯断的几缕绢丝：横跨在豁口上，豁口张到一定宽就一根根断开
  if (tear > 0)
    for (const f of sc.fibers) {
      const g = gapAt(f.y);
      if (g.k <= 0.05 || g.k >= f.snap) continue;
      const TL = Math.floor(g.L) - sepL;
      const TR = Math.ceil(g.R) + sepR;
      for (let tx = TL; tx <= TR; tx++) {
        const u = (tx - TL) / Math.max(1, TR - TL);
        const sag = Math.round(Math.sin(u * Math.PI) * (g.k / f.snap) * 1.6);
        put(dst, Math.round(p.x + tx), Math.round(p.y + f.y + p.wave(srcOf(tx))) + sag, u > 0.4 && u < 0.6 ? 'f' : 'Y');
      }
    }
  // 两头：纸卷 + 轴
  const leftEdge = Math.max(px0, lo) - (tear > 0 ? sepL : 0);
  const rightEdge = Math.min(px1, hi) + (tear > 0 ? sepR : 0);
  const dyL = Math.round(p.wave(Math.max(px0, lo)));
  const dyR = Math.round(p.wave(Math.min(px1, hi)));
  for (let r = 0; r < roll; r++) {
    colOut(px0, leftEdge - 1 - r, sc.paper, dyL, 'roll');
    colOut(px0, rightEdge + 1 + r, sc.paper, dyR, 'roll');
  }
  for (let i = 0; i < rodW; i++) {
    colOut(i, leftEdge - roll - rodW + i, sc.paper, dyL, 'rod');
    colOut(W - rodW + i, rightEdge + roll + 1 + i, sc.paper, dyR, 'rod');
  }
}
