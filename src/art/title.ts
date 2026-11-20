// 标题页的背景画（纯函数 + 一个小场景，不依赖 DOM）：云海之上，封神榜在风里展开、裂开一道口子，
// 灵光从裂口漏下，一缕缕魂光坠入云海。对应开场过场的第 2、3 镜（docs/story/ch1.md）。
//
// 用户的美术口径（docs/design.md「美术口径」）：
//  - 背景不要黑、底色落在中间调以上：天顶是黛（不是黑），往下苍 → 银鼠 → 缟 → 月白；
//  - 不要一像素的细裂缝线条（试过的「榜裂」被否）：所以裂口是榜身被撕开、两半错开的一道有宽度的豁口，
//    豁口里透出白光，边上是被灵光照亮的纸茬和一点余烬；
//  - 不要俗气的光圈 / 光晕：灵光用从裂口往下散开的光束和像素粒子表现，没有任何圆形的光斑；
//  - 不要大面积随机像素：天空是分档渐变（交界处有序抖动），云是一团一团有形状的积云；
//  - 动画都慢：云几秒挪一像素，光束十秒一呼吸，魂光十来秒才落进云里，出现和消失都有淡入淡出。
//
// 画法：所有图层都是调色板颜色的位图（Bitmap），每帧按 Painter 的两个方法画出来——浏览器里由 title.ts 用 Canvas2D 实现，
// Node 里由预览工具用软件混合实现，两边画出来一样。
import { PALETTE, hexToRgba } from './palette.ts';
import { mulberry32, type Bitmap } from './ground.ts';

/** 画图的最小接口：位图（可裁一块）与色块，坐标都是整数像素；add = 加法混合。 */
export interface Painter {
  image(b: Bitmap, x: number, y: number, alpha?: number, add?: boolean, src?: { x: number; y: number; w: number; h: number }): void;
  rect(x: number, y: number, w: number, h: number, color: string, alpha?: number, add?: boolean): void;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const RGB: Record<string, [number, number, number, number]> = {};
const rgba = (ch: string) => (RGB[ch] ??= hexToRgba(PALETTE[ch]));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function blank(w: number, h: number): Bitmap {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}
function put(b: Bitmap, x: number, y: number, ch: string, a = 255) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const c = rgba(ch);
  const i = (y * b.w + x) * 4;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = a;
}

// ---------- 天空 ----------

/**
 * 天空：从天顶的黛往下到地平线的月白，分档；两档之间只有约 6 像素的有序抖动（不铺满颗粒），
 * 中间略亮，档线带一点弧度（像穹顶），不画任何光斑。
 */
export function makeSky(W: number, H: number, horizon: number): Bitmap {
  const b = blank(W, H);
  // [档线在地平线以上的比例位置, 这一档往下的颜色]
  const stops: [number, string][] = [
    [0, 'g'],
    [0.15, 'h'],
    [0.42, 'i'],
    [0.7, 'j'],
    [0.93, 'w'],
  ];
  const SEAM = 3;
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const lift = 0.11 * (1 - dx * dx) * horizon; // 中间的档线往上抬：中间亮，档线成了穹顶那样的弧，不是横贯全屏的直线
    const lines = stops.map(([f]) => f * horizon - lift);
    for (let y = 0; y < H; y++) {
      let i = 0;
      while (i + 1 < stops.length && y >= lines[i + 1] + SEAM) i++;
      let ch = stops[i][1];
      if (i + 1 < stops.length && y >= lines[i + 1] - SEAM) {
        const t = (y - (lines[i + 1] - SEAM)) / (SEAM * 2);
        ch = t > bayer(x, y) ? stops[i + 1][1] : stops[i][1];
      }
      put(b, x, y, ch);
    }
  }
  return b;
}

// ---------- 云海（侧视的积云堤，横向可平铺） ----------

export interface CloudSpec {
  /** 按「离云顶多深」分的色阶：第一个是云顶镶边，往下依次变暗。 */
  tones: string[];
  /** 每一档到多深为止（像素），比 tones 少一个；最后一档一直到底。 */
  bands: number[];
  /** 云包的半径范围。 */
  size: [number, number];
  /** 云包竖直方向压扁（远处更扁）。 */
  flat: number;
  /** 叠几排、排与排相隔多少像素、第一排的云顶高度、每往前一排云包变大多少。 */
  rows: number;
  rowGap: number;
  top: number;
  grow: number;
  /** 云顶高度的随机起伏（像素）。 */
  jitter: number;
}

/**
 * 一道云堤（从高处望出去的云海的一段）：几排云包，后排在上、前排在下压住后排。
 * 每排的轮廓是一串圆弧（云包）连成的天际线；颜色按「离这一排云顶多深」分档平涂——云顶一像素亮边、
 * 往下是受光的云身、再往下是被前一排压住的暗缝。云包之间的谷自然形成 V 形的暗褶，读成一团一团；
 * 光从左上来，云包右侧暗得早一点。宽 TW 可无缝横向平铺。
 */
export function makeCloudBank(TW: number, H: number, seed: number, s: CloudSpec): Bitmap {
  const rnd = mulberry32(seed);
  const b = blank(TW, H);
  const wrap = (v: number) => ((v % TW) + TW) % TW;
  for (let k = 0; k < s.rows; k++) {
    const g = 1 + k * s.grow;
    const [r0, r1] = s.size;
    const base = s.top + k * s.rowGap + (k ? (rnd() - 0.5) * s.rowGap * 0.5 : 0);
    // 这一排的云包（横向首尾相接，保证没有缺口）
    const bumps: { x: number; y: number; r: number }[] = [];
    let x = rnd() * r1;
    const startX = x;
    while (x < startX + TW) {
      const tower = rnd() < 0.12; // 偶尔一朵高耸的
      const r = (r0 + (r1 - r0) * Math.pow(rnd(), 0.9)) * g * (tower ? 1.45 : 1);
      const y = base + r * s.flat * 0.55 + (rnd() - 0.5) * s.jitter * 2 - (tower ? r * s.flat * 0.35 : 0);
      bumps.push({ x, y, r });
      // 云包顶上再长一两个小云包：云顶疙疙瘩瘩，像菜花，而不是一排光滑的沙丘
      const subs = rnd() < 0.7 ? 1 + Math.floor(rnd() * 2) : 0;
      for (let q = 0; q < subs; q++) {
        const sr = r * (0.38 + rnd() * 0.22);
        const ox = (rnd() - 0.5) * r * 1.1;
        bumps.push({ x: x + ox, y: y - r * s.flat * (0.55 + rnd() * 0.3) + sr * s.flat * 0.4, r: sr });
      }
      x += r * (0.85 + rnd() * 0.55);
    }
    // 天际线：每一列取最高的那段圆弧
    const sky = new Float32Array(TW).fill(H + 99);
    for (const p of bumps)
      for (let dx = -Math.floor(p.r); dx <= Math.ceil(p.r); dx++) {
        const h = p.r * p.r - dx * dx;
        if (h < 0) continue;
        const X = wrap(Math.round(p.x + dx));
        sky[X] = Math.min(sky[X], p.y - Math.sqrt(h) * s.flat);
      }
    for (let X = 0; X < TW; X++) {
      const top = sky[X];
      const slope = sky[wrap(X + 1)] - sky[wrap(X - 1)]; // > 0：往右下降（云包右侧，背光）
      for (let y = Math.max(0, Math.ceil(top)); y < H; y++) {
        let d = y - top;
        if (slope > 0.8) d += Math.min(4, slope * 1.5);
        else if (slope < -1.2) d -= 1;
        let lv = 0;
        while (lv < s.bands.length && d >= s.bands[lv]) lv++;
        // 档线处一像素的抖动
        if (lv < s.bands.length && lv > 0 && d > s.bands[lv] - 1 && bayer(X, y) < 0.5) lv++;
        // 亮边只镶在朝上、朝左（迎光）的那段云边上，不是每排一圈白线
        if (lv === 0 && slope > 0.35) lv = 1;
        put(b, X, y, s.tones[Math.min(lv, s.tones.length - 1)]);
      }
    }
  }
  return b;
}

// ---------- 封神榜 ----------

export interface ScrollArt {
  /** 榜（含两头的轴）。透明处：裂口。 */
  paper: Bitmap;
  /** 同一张榜的受光版与背光版（随风起伏时，迎风的那几列换成亮的、背风的换成暗的）。 */
  lit: Bitmap;
  shade: Bitmap;
  /** 裂口后面的光（只在裂口里露出来）。 */
  light: Bitmap;
  /** 裂口在榜上的横坐标（位图坐标）。 */
  riftX: number;
  /** 纸面在位图里的上沿、高度。 */
  paperY: number;
  paperH: number;
  /** 轴的宽度。 */
  rodW: number;
}

/** 榜上的小字：3×3 的笔画团（只读成「一列列的字」，不必认得出来）。 */
const GLYPHS = [
  ['b.b', '.b.', 'b.b'],
  ['.b.', 'bbb', 'b.b'],
  ['bbb', 'b.b', 'bbb'],
  ['b..', 'bb.', 'b.b'],
  ['bb.', '.bb', 'b..'],
  ['.bb', 'bb.', '.b.'],
  ['b.b', 'bbb', '.b.'],
  ['bbb', '.b.', 'bb.'],
];
/** 榜头「封神榜」：朱色、5 像素见方的三个大字团。 */
const HEAD_GLYPHS = [
  ['r.r.r', 'rrr.r', 'r.rrr', 'rrr.r', 'r.r.r'],
  ['.r.rr', 'rrr.r', '.r.rr', 'rr.r.', '.r.rr'],
  ['r.rrr', 'rrr.r', 'r.rrr', 'rr.r.', 'r.r.r'],
];

/**
 * 封神榜：一卷展开的金色长榜（黄绢），上下镶暗金边，两头是漆黑金首的轴；榜面从右往左一列列写着神名（暗金小字），
 * 右起第一列是朱色的榜头。裂口在中间偏右：上窄下宽，左右两道边各自锯齿，被里面的白光照得发亮，零星余烬。
 */
export function makeScroll(len: number, paperH: number, seed: number): ScrollArt {
  const rnd = mulberry32(seed);
  const rodW = 6;
  const W = len + rodW * 2;
  const top = 4;
  const H = paperH + top * 2;
  const paper = blank(W, H);
  const x0 = rodW;
  const x1 = rodW + len - 1;
  const y0 = top;
  const y1 = top + paperH - 1;
  // 纸面的竖向剖面：暗边、两道镶边、黄绢
  const profile = (y: number) => {
    const d = Math.min(y - y0, y1 - y);
    return d === 0 ? 'B' : d <= 2 ? (y < (y0 + y1) / 2 && d === 1 ? 'Y' : 'y') : d === 3 ? 'b' : 'Y';
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(paper, x, y, x === x0 || x === x1 ? 'B' : profile(y));
  // 裂口：左右两道边各自随机游走，上窄下宽
  const riftX = x0 + Math.round(len * 0.57);
  const left: number[] = [];
  const right: number[] = [];
  let a = 0;
  let c = 0;
  for (let y = 0; y < H; y++) {
    const t = clamp01((y - y0) / paperH);
    a = Math.max(-2, Math.min(2, a + (rnd() < 0.4 ? -1 : rnd() < 0.6 ? 1 : 0)));
    c = Math.max(-2, Math.min(2, c + (rnd() < 0.4 ? 1 : rnd() < 0.6 ? -1 : 0)));
    const half = 0.6 + 4.6 * t * t + 1.2 * t;
    left[y] = riftX - half + a;
    right[y] = riftX + half + c;
  }
  const gapDist = (x: number, y: number) => (y < y0 || y > y1 ? 99 : x < left[y] ? left[y] - x : x > right[y] ? x - right[y] : -1);
  // 神名：一列一列，从右往左（裂口边上的字烧掉了）
  const fieldTop = y0 + 4;
  const fieldBot = y1 - 4;
  let x = x1 - 9;
  for (let col = 0; x >= x0 + 6; col++) {
    if (col === 0) {
      HEAD_GLYPHS.forEach((g, k) => g.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && put(paper, x - 1 + i, fieldTop + 1 + k * 6 - 2 + j, ch))));
      x -= 9;
      continue;
    }
    const near = Math.min(gapDist(x - 1, fieldTop), gapDist(x + 3, fieldBot), gapDist(x + 1, (fieldTop + fieldBot) >> 1));
    if (near < 4 || rnd() < 0.1) {
      x -= 4;
      continue;
    }
    const n = 2 + Math.floor(rnd() * 3);
    let gy = fieldTop + 1;
    if (rnd() < 0.18) {
      put(paper, x + 1, gy, 'e'); // 品阶的朱点
      gy += 2;
    }
    for (let g = 0; g < n && gy + 2 <= fieldBot; g++, gy += 4) {
      const G = GLYPHS[Math.floor(rnd() * GLYPHS.length)];
      G.forEach((row, j) => [...row].forEach((ch, i) => ch !== '.' && put(paper, x + i, gy + j, ch)));
    }
    x -= 5;
  }
  // 两头的轴：漆黑轴身、金首（比纸面上下各长出 4 像素）
  const rod = (rx: number) => {
    for (let y = 0; y < H; y++) {
      const cap = y < 4 || y >= H - 4;
      for (let i = 0; i < rodW; i++) {
        const X = rx + i;
        const edge = i === 0 || i === rodW - 1;
        if (cap) {
          const r = y < 4 ? y : H - 1 - y;
          if (r === 0) {
            if (!edge) put(paper, X, y, 'B');
          } else put(paper, X, y, edge ? 'B' : r === 1 ? 'Y' : i <= 2 ? 'y' : 'b');
        } else put(paper, X, y, edge ? 'k' : i === 1 ? 'g' : 'd');
      }
    }
  };
  rod(0);
  rod(W - rodW);
  // 撕开：裂口里挖空；边上一像素被照得发白、再一像素灵光黄，零星余烬
  for (let y = y0; y <= y1; y++)
    for (let X = x0; X <= x1; X++) {
      const d = gapDist(X, y);
      if (d < 0) {
        paper.data[(y * W + X) * 4 + 3] = 0;
        continue;
      }
      if (d < 1) put(paper, X, y, rnd() < 0.15 ? 'o' : 'W');
      else if (d < 2) put(paper, X, y, rnd() < 0.18 ? 'e' : 'f');
      else if (d < 3.2 && rnd() < 0.55) put(paper, X, y, 'Y');
    }
  // 受光版 / 背光版：纸面整体亮一档、暗一档（裂口边与轴不变）
  const swap = (m: Record<string, string>) => {
    const out = blank(W, H);
    out.data.set(paper.data);
    const from = Object.keys(m).map((k) => [rgba(k), m[k]] as const);
    for (let y = y0; y <= y1; y++)
      for (let X = x0 + 1; X < x1; X++) {
        const i = (y * W + X) * 4;
        if (!paper.data[i + 3] || gapDist(X, y) < 3.2) continue;
        const hit = from.find(([c]) => c[0] === paper.data[i] && c[1] === paper.data[i + 1] && c[2] === paper.data[i + 2]);
        if (hit) put(out, X, y, hit[1]);
      }
    return out;
  };
  const lit = swap({ y: 'Y', b: 'y' });
  const shade = swap({ Y: 'y', y: 'b' });
  // 裂口后面的光：中间白、两侧灵光黄，比裂口略宽（只透过裂口看得见）；上沿漏出一点
  const light = blank(W, H);
  for (let y = y0 - 2; y <= y1 + 1; y++) {
    const yy = Math.max(y0, Math.min(y1, y));
    for (let X = Math.floor(left[yy]) - 2; X <= Math.ceil(right[yy]) + 2; X++) {
      const d = gapDist(X, yy);
      if (y < y0 && d > 0) continue;
      put(light, X, y, d < 0 ? 'W' : 'f');
    }
  }
  return { paper, lit, shade, light, riftX, paperY: y0, paperH, rodW };
}

// ---------- 光束 ----------

/**
 * 一道从裂口往下的光束：起点 1–2 像素宽，越往下越宽、越淡，读成从缝里漏下来的几缕光，而不是一个光锥。
 * 一道到底不断开、透明度平滑地淡下去（以前分三档、中途断开一两截，几道叠起来像一节节错开的梯子，看着不连贯）。
 * 返回位图和它的左上角相对起点的偏移。
 */
export function makeRay(len: number, angle: number, w0: number, w1: number, _seed: number): { b: Bitmap; ox: number; oy: number } {
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  const pad = Math.ceil(w1 / 2) + 2;
  const minX = Math.floor(Math.min(0, dx * len)) - pad;
  const maxX = Math.ceil(Math.max(0, dx * len)) + pad;
  const W = maxX - minX + 1;
  const H = Math.ceil(dy * len) + 2;
  const b = blank(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const px = x + minX;
      const t = y / (dy * len); // 沿光束的位置（按竖直方向算）
      if (t < 0 || t > 1) continue;
      const cxr = dx * len * t;
      const half = (w0 + (w1 - w0) * t) / 2;
      const d = Math.abs(px - cxr);
      if (d > half) continue;
      const core = d < half * 0.4;
      // 越往下越淡（起头一小段淡入，不是硬切的头），芯比边亮
      const fade = Math.min(1, t / 0.06) * Math.pow(1 - t, 1.3);
      const a = Math.round(255 * fade * (core ? 0.42 : 0.24));
      if (a <= 0) continue;
      const c = rgba(core ? 'f' : 'Y');
      const i = (y * W + x) * 4;
      b.data.set([c[0], c[1], c[2], a], i);
    }
  return { b, ox: minX, oy: 0 };
}

// ---------- 小精灵 ----------

const sprite = (rows: string[]): Bitmap => {
  const w = Math.max(...rows.map((r) => r.length));
  const b = blank(w, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && put(b, x, y, ch)));
  return b;
};
/** 魂光：大的是十字形（同战斗里斩敌后升起的魂光），小的是一粒。 */
export const SOUL_BIG = sprite(['.C.', 'CWC', '.C.']);
export const SOUL_SMALL = sprite(['CW', 'WC']);

// ---------- 场景 ----------

interface Soul {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  big: boolean;
  /** 落到这个深度（地平线往下多少像素）开始消散。 */
  sink: number;
  /** 画在哪一层云的后面（0 远云，1 中云）。 */
  layer: 0 | 1;
  fade: number;
  trail: [number, number][];
  trailT: number;
  phase: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  ch: string;
}

interface Ray {
  art: { b: Bitmap; ox: number; oy: number };
  dx: number; // 起点相对裂口
  t: number;
  life: number;
  peak: number;
  period: number;
  phase: number;
}

interface Fleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
}

export interface TitleLayout {
  W: number;
  H: number;
  /** 地平线（云海顶）。 */
  horizon: number;
  /** 榜在画面上的位置（含轴）。 */
  scroll: { x: number; y: number; w: number; h: number };
  /** 裂口在画面上的横坐标、榜的下沿。 */
  rift: { x: number; y: number };
}

export interface TitleScene {
  layout: TitleLayout;
  update(dt: number): void;
  draw(p: Painter): void;
  /** 标题页时榜和光束都在；选角时慢慢隐去（只留云海、魂光、灵光），免得和选角的界面抢。 */
  setShowScroll(v: boolean): void;
}

const SCROLL_PAPER_H = 24;
const scrollLen = (W: number) => Math.max(240, Math.min(360, Math.round(W * 0.52)));

/** 场景的版面（纯计算，和 createTitleScene 一致）：界面层按它摆字和按钮，不用等场景建好。 */
export function titleLayout(W: number, H: number): Omit<TitleLayout, 'rift'> {
  const sw = scrollLen(W) + 12; // 含两头的轴
  const sh = SCROLL_PAPER_H + 8;
  return { W, H, horizon: Math.round(H * 0.56), scroll: { x: Math.round((W - sw) / 2), y: Math.round(H * 0.045), w: sw, h: sh } };
}

/**
 * 标题页的场景：W×H 是这张像素画自己的像素数（一个像素是整数个物理像素，由 title.ts 按窗口取，画面铺满整个窗口）。
 * 16:9 的窗口里是 480×270 到约 720×405；更宽、更高的窗口多出来的只是天和云海。
 */
export function createTitleScene(W: number, H: number, seed = 20261109): TitleScene {
  const rnd = mulberry32(seed);
  const horizon = titleLayout(W, H).horizon;
  const sky = makeSky(W, H, horizon);
  const TW = 320;
  const far = makeCloudBank(TW, 40, seed + 2, { tones: ['w', 'w', 'j'], bands: [1, 4], size: [4, 8], flat: 0.5, rows: 3, rowGap: 6, top: 6, grow: 0.2, jitter: 1.5 });
  const mid = makeCloudBank(TW, 100, seed + 3, { tones: ['W', 'w', 'j', 'i'], bands: [1, 5, 10], size: [6, 11], flat: 0.72, rows: 4, rowGap: 11, top: 6, grow: 0.22, jitter: 2.5 });
  const nearTop = horizon + 40;
  const nearH = Math.max(80, H - nearTop + 4);
  const near = makeCloudBank(TW, nearH, seed + 4, { tones: ['W', 'w', 'j', 'i', 'h'], bands: [1, 7, 15, 22], size: [10, 17], flat: 0.82, rows: Math.ceil(nearH / 19) + 1, rowGap: 19, top: 6, grow: 0.22, jitter: 4 });
  const sc = makeScroll(scrollLen(W), SCROLL_PAPER_H, seed + 5);
  const sx = Math.round((W - sc.paper.w) / 2);
  const sy = Math.round(H * 0.045);
  const layout: TitleLayout = {
    W,
    H,
    horizon,
    scroll: { x: sx, y: sy, w: sc.paper.w, h: sc.paper.h },
    rift: { x: sx + sc.riftX, y: sy + sc.paperY + sc.paperH },
  };
  const riftX = layout.rift.x;
  const riftY = layout.rift.y;

  let time = 0;
  const souls: Soul[] = [];
  const motes: Mote[] = [];
  const rays: Ray[] = [];
  const flecks: Fleck[] = [];
  let soulCd = 0;
  let fleckCd = 2;
  let show = 1; // 榜与光束的显隐（0..1，慢慢变）
  let showTo = 1;

  const rayLen = Math.max(80, horizon - riftY + 34); // 一直照到远云、中云的云顶上
  const newRay = (startT = 0): Ray => {
    const angle = (rnd() - 0.5) * 1.1; // 约 ±31°
    const w0 = 1 + Math.floor(rnd() * 2);
    const w1 = 5 + Math.floor(rnd() * 12);
    return {
      art: makeRay(rayLen * (0.75 + rnd() * 0.3), angle, w0, w1, Math.floor(rnd() * 1e9)),
      dx: Math.round((rnd() - 0.5) * 4),
      t: startT,
      life: 14 + rnd() * 12,
      peak: 0.5 + rnd() * 0.5,
      period: 5 + rnd() * 6,
      phase: rnd() * Math.PI * 2,
    };
  };
  for (let i = 0; i < 7; i++) {
    const r = newRay();
    r.t = rnd() * r.life;
    rays.push(r);
  }

  const spawnSoul = () => {
    const big = rnd() < 0.35;
    const dir = rnd() < 0.5 ? -1 : 1;
    souls.push({
      x: riftX + (rnd() - 0.5) * 4,
      y: riftY - 4 - rnd() * 8,
      vx: dir * (3 + rnd() * (big ? 14 : 22)),
      vy: 3 + rnd() * 5,
      t: 0,
      big,
      sink: 4 + rnd() * 30,
      layer: rnd() < 0.45 ? 0 : 1,
      fade: 0,
      trail: [],
      trailT: 0,
      phase: rnd() * 10,
    });
  };
  const spawnMote = () => {
    const nearRift = rnd() < 0.45;
    motes.push({
      x: nearRift ? riftX + (rnd() - 0.5) * 120 : rnd() * W,
      y: nearRift ? riftY + rnd() * (horizon - riftY) : sy + rnd() * (horizon - sy),
      vx: (rnd() - 0.5) * 3,
      vy: -1.5 - rnd() * 3,
      t: 0,
      life: 4 + rnd() * 6,
      ch: rnd() < 0.6 ? 'f' : rnd() < 0.5 ? 'Y' : 'W',
    });
  };

  const scene: TitleScene = {
    layout,
    setShowScroll(v) {
      showTo = v ? 1 : 0;
    },
    update(dt) {
      time += dt;
      show += Math.sign(showTo - show) * Math.min(Math.abs(showTo - show), dt / 0.9);
      // 光束：每道有自己的寿命，淡入、慢慢呼吸、淡出，然后换一个角度再出来
      for (let i = 0; i < rays.length; i++) {
        const r = rays[i];
        r.t += dt;
        if (r.t >= r.life) rays[i] = newRay();
      }
      // 魂光
      soulCd -= dt;
      if (soulCd <= 0) {
        soulCd = 0.55 + rnd() * 0.8;
        spawnSoul();
      }
      for (let i = souls.length - 1; i >= 0; i--) {
        const s = souls[i];
        s.t += dt;
        s.vx *= Math.pow(0.86, dt); // 横向越飘越慢
        s.vy = Math.min(16, s.vy + 1.1 * dt); // 越落越快一点
        s.x += (s.vx + Math.sin(s.t * 1.3 + s.phase) * 2.2) * dt;
        s.y += s.vy * dt;
        s.trailT -= dt;
        if (s.trailT <= 0) {
          s.trailT = 0.1;
          s.trail.unshift([s.x, s.y]);
          if (s.trail.length > (s.big ? 10 : 6)) s.trail.pop();
        }
        const deep = s.y - (horizon + s.sink);
        s.fade = deep > 0 ? Math.max(0, 1 - deep / 10) : Math.min(1, s.t / 0.8);
        if ((deep > 0 && s.fade <= 0) || s.x < -20 || s.x > W + 20) souls.splice(i, 1);
      }
      // 灵光粒子
      if (motes.length < 34 && rnd() < dt * 8) spawnMote();
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.t += dt;
        m.x += (m.vx + Math.sin(m.t * 0.9 + i) * 1.5) * dt;
        m.y += m.vy * dt;
        if (m.t >= m.life) motes.splice(i, 1);
      }
      // 从裂口边上剥落的金箔碎屑：偶尔一片，翻着往下飘
      fleckCd -= dt;
      if (fleckCd <= 0) {
        fleckCd = 2.2 + rnd() * 3;
        flecks.push({ x: riftX + (rnd() - 0.5) * 8, y: riftY - 2, vx: (rnd() - 0.5) * 8, vy: 5 + rnd() * 4, t: 0, life: 7 + rnd() * 4 });
      }
      for (let i = flecks.length - 1; i >= 0; i--) {
        const f = flecks[i];
        f.t += dt;
        f.x += (f.vx + Math.sin(f.t * 2.1) * 5) * dt;
        f.y += f.vy * dt;
        if (f.t >= f.life || f.y > horizon) flecks.splice(i, 1);
      }
    },
    draw(p) {
      const tile = (b: Bitmap, y: number, speed: number) => {
        const off = Math.floor(time * speed) % TW;
        for (let x = -off; x < W; x += TW) p.image(b, x, y);
      };
      const drawSouls = (layer: 0 | 1) => {
        for (const s of souls) {
          if (s.layer !== layer || s.fade <= 0) continue;
          // 拖尾：头上几粒白、往后天青、再往后石青，越来越淡（加法混合，在天上是亮的，没有光晕）
          s.trail.forEach(([tx, ty], k) => {
            const a = s.fade * (1 - (k + 1) / (s.trail.length + 1)) * 0.95;
            p.rect(Math.round(tx), Math.round(ty) - 1, 1, 1, k < 2 ? PALETTE.W : k < 5 ? PALETTE.C : PALETTE.c, a, true);
          });
          const spr = s.big ? SOUL_BIG : SOUL_SMALL;
          const tw = 0.8 + 0.2 * Math.sin(s.t * 5 + s.phase); // 轻轻一闪一闪
          p.image(spr, Math.round(s.x) - (spr.w >> 1), Math.round(s.y) - (spr.h >> 1), s.fade * tw);
          p.image(spr, Math.round(s.x) - (spr.w >> 1), Math.round(s.y) - (spr.h >> 1), s.fade * 0.5 * tw, true);
        }
      };
      // 由远到近：天 → 远云 → 中云 → 光束 → 榜 → 近云。魂光从裂口里出来（画在榜后面，只从裂口里透出来），
      // 落进远云或中云后面；光束画在远云、中云前面，所以照得到云顶。
      p.image(sky, 0, 0);
      drawSouls(0);
      tile(far, horizon - 6, 1.1);
      drawSouls(1);
      tile(mid, horizon + 8, 2.4);
      // 光束：每道淡入淡出各 3 秒，中间慢慢呼吸
      for (const r of rays) {
        const k = Math.min(1, r.t / 3, (r.life - r.t) / 3);
        const breathe = 0.65 + 0.35 * Math.sin((r.t / r.period) * Math.PI * 2 + r.phase);
        const a = Math.max(0, k) * r.peak * breathe * show;
        if (a > 0.02) p.image(r.art.b, riftX + r.dx + r.art.ox, riftY - 3 + r.art.oy, a, true);
      }
      // 榜：整张画（不按列切片、不随风上下错位——错位会把边框切成台阶、把字切成两截，裂口的光束也对不上裂口）；
      // 裂口里的光缓慢明暗
      if (show > 0.01) {
        const glow = 0.75 + 0.25 * Math.sin(time * 0.9);
        p.image(sc.light, sx, sy, glow * show);
        p.image(sc.paper, sx, sy, show);
      }
      // 金箔碎屑
      for (const f of flecks) {
        const a = Math.min(1, f.t / 0.6, (f.life - f.t) / 1.5);
        const flip = Math.floor(f.t * 3) % 2;
        p.rect(Math.round(f.x), Math.round(f.y), flip ? 2 : 1, flip ? 1 : 2, flip ? PALETTE.Y : PALETTE.y, Math.max(0, a) * show);
      }
      // 灵光粒子
      for (const m of motes) {
        const a = Math.sin((m.t / m.life) * Math.PI) * (0.55 + 0.45 * Math.sin(m.t * 3.1));
        if (a > 0.05) p.rect(Math.round(m.x), Math.round(m.y), 1, 1, PALETTE[m.ch], a, true);
      }
      tile(near, nearTop, 4.6);
    },
  };
  // 预热：一打开就是「已经在发生」的样子，不是空的天
  for (let i = 0; i < 360; i++) scene.update(1 / 30);
  return scene;
}

// ---------- 外围界面用的小件（按钮的墨痕、卷轴的轴、印、菱形饰、暂停钮） ----------

/**
 * 一笔横向的墨痕（按钮的底）：露锋起笔——笔尖从左上轻轻落下、很快铺满，中段微微起伏，往右收锋，末段飞白（裂成几缕、断断续续）。
 * 两头都收细，墨的重心才大致在整笔的正中：按钮上的字摆在正中，看上去就在墨的正中（front-ui.ts 再按量出来的重心微调）。
 * tone：'ink' 墨色（乌底、玄边、黛的飞白），'cinnabar' 朱砂（朱底、朱砂高光、殷边）。笔势略往右上走。
 * 形状只由 w、h、seed 定：同样的三个数、两种颜色是同一笔（轮廓一模一样），所以换焦点（墨 → 朱砂）只换颜色。
 * lead：起笔收细的那一段、tail：末段飞白，各占整笔的比例。
 */
export function makeInkStroke(w: number, h: number, seed: number, tone: 'ink' | 'cinnabar', tail = 0.13, lead = 0.14): Bitmap {
  const rnd = mulberry32(seed);
  const b = blank(w, h);
  const [core, top, edge] = tone === 'ink' ? ['d', 'g', 'k'] : ['r', 'e', 'R'];
  const ph = rnd() * 6;
  const streaks = 4;
  // 飞白：每一缕在末段的哪些地方断开
  const breaks = Array.from({ length: streaks }, () => Array.from({ length: w }, () => rnd()));
  const dry = 1 - tail;
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    const full = h * 0.82 * (0.93 + 0.07 * Math.sin(u * 9 + ph));
    let T = full;
    // 露锋：起笔细（三成多），很快铺满；笔尖从上面落下，所以收细时主要是下沿往上收
    if (u < lead) T *= 0.35 + 0.65 * (1 - (1 - u / lead) ** 2);
    if (u > dry - 0.02) T *= 1 - ((u - (dry - 0.02)) / (tail + 0.02)) * 0.4;
    const yc = (h - 1) / 2 + 0.6 * Math.sin(u * 5 + ph) - (u - 0.5) * 1.4 - (u < lead ? (full - T) * 0.25 : 0);
    const y0 = yc - T / 2;
    for (let y = 0; y < h; y++) {
      if (y < Math.round(y0) || y > Math.round(yc + T / 2)) continue;
      // 末段飞白：按竖直方向分几缕，越往右断得越多
      if (u > dry) {
        const k = Math.max(0, Math.min(streaks - 1, Math.floor(((y - y0) / Math.max(1, T)) * streaks)));
        const dryness = (u - dry) / tail;
        if (breaks[k][x] < dryness * 0.65) continue;
      }
      let ch = core;
      if (y === Math.round(y0)) ch = top;
      else if (y === Math.round(yc + T / 2)) ch = edge;
      put(b, x, y, ch);
    }
  }
  return b;
}

/** 卷轴的轴：漆黑轴身、两头金首，高 7 像素。 */
export function makeRoller(w: number): Bitmap {
  const b = blank(w, 7);
  const cap = ['.BBB.', 'BYyyB', 'BYyBB', 'Byybk', 'BYybk', 'BybBk', '.kkk.'];
  for (let x = 4; x < w - 4; x++) ['.', 'k', 'g', 'd', 'd', 'k', '.'].forEach((ch, y) => ch !== '.' && put(b, x, y, ch));
  for (const ox of [0, w - 5])
    cap.forEach((row, y) => [...row].forEach((ch, i) => ch !== '.' && put(b, ox + (ox ? 4 - i : i), y, ch)));
  return b;
}

/** 朱印（白文）：朱砂底，四边略有毛边，零星几粒印泥没吃满的白点。字另放（书法体）。 */
export function makeSeal(w: number, h: number, seed: number): Bitmap {
  const rnd = mulberry32(seed);
  const b = blank(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner) continue;
      if (edge && rnd() < 0.18) continue; // 毛边
      let ch = 'e';
      if (!edge && rnd() < 0.012) ch = 'o';
      if (edge && rnd() < 0.3) ch = 'r';
      put(b, x, y, ch);
    }
  return b;
}

/** 小菱形饰（金、赭边），焦点按钮两侧各一枚。 */
export const DIAMOND = sprite(['..B..', '.BYB.', 'BYyyB', '.Byb.', '..B..']);

/** 暂停钮：一块墨色小牌，两道月白竖笔。 */
export const PAUSE_ICON = sprite([
  '.kkkkkkkkkk.',
  'kddddddddddk',
  'kdgggggggddk',
  'kdgwwggwwgdk',
  'kdgwwggwwgdk',
  'kdgwwggwwgdk',
  'kdgwwggwwgdk',
  'kdgwwggwwgdk',
  'kdgwwggwwgdk',
  'kdgggggggddk',
  'kddddddddddk',
  '.kkkkkkkkkk.',
]);

/** 全屏钮（局里暂停钮旁边，game/pause.ts）：同一块墨色小牌，四角四道向外的折笔。 */
export const FULLSCREEN_ICON = sprite([
  '.kkkkkkkkkk.',
  'kddddddddddk',
  'kdwwwggwwwdk',
  'kdwggggggwdk',
  'kdwggggggwdk',
  'kdggggggggdk',
  'kdggggggggdk',
  'kdwggggggwdk',
  'kdwggggggwdk',
  'kdwwwggwwwdk',
  'kddddddddddk',
  '.kkkkkkkkkk.',
]);

/** 退出全屏：四道折笔朝里收。 */
export const WINDOWED_ICON = sprite([
  '.kkkkkkkkkk.',
  'kddddddddddk',
  'kdgwggggwgdk',
  'kdgwggggwgdk',
  'kdwwggggwwdk',
  'kdggggggggdk',
  'kdggggggggdk',
  'kdwwggggwwdk',
  'kdgwggggwgdk',
  'kdgwggggwgdk',
  'kddddddddddk',
  '.kkkkkkkkkk.',
]);

/** 滑块的钮：一枚小玉牌（焦点时换成金的）。 */
export function makeKnob(on: boolean): Bitmap {
  const rows = ['..kkk..', '.kwwjk.', 'kwwjjik', 'kwjjjik', 'kwjjjik', 'kwjjjik', 'kjjjiik', '.kiiik.', '..kkk..'];
  const m: Record<string, string> = on ? { w: 'f', j: 'Y', i: 'y', k: 'B' } : {};
  return sprite(rows.map((r) => [...r].map((c) => m[c] ?? c).join('')));
}
