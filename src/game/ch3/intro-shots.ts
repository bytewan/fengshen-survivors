// 第三章 · 界牌关 · 诛仙阵 的开场过场镜头（播放器 cutscene.ts，登记在 cutscene-shots.ts 的 SHOTS；台词在 story.ts 的 CUTSCENES 'ch3-intro'）：
//   jiepai-pass   —— 夜里的界牌关：两边黑色的山崖、崖顶一线月光，谷口远远横着一道关墙、一座关楼的剪影（窗里一点魂火）；
//                    路边立着一块老界碑；那一角残页（第二章收尾被风卷来的）从西边飘进山谷，越飘越低，没进谷底的暗处。
//   jiepai-swords —— 关前的山谷里，四角四座剑台（远的两座小、近的两座大），台上悬着四把剑，剑尖朝下、慢慢浮着；
//                    旁白念到哪一把（诛仙、戮仙、陷仙、绝仙），那一把的剑身上就走过一线寒光。
//   jiepai-heart  —— 阵心：对角剑台之间暗刻的阵线一截截亮起冷银、往阵心收；阵心的圆石上面隐约一道竖的门缝（还关着，只透一线暗金，
//                    第三章结尾它会裂开，ch3/ending-shots.ts）；本机玩家的角色站在近处望着。
// 场景、剑台、剑的画法照战场（render/scene-jiepai.ts、art/ch3/）：青黑石、冷银、暗金；最暗处也是青黑，不是黑。
// 只从 cutscene-shots.ts 拿类型（运行时不互相引用）。
import { Container, Graphics, Sprite } from 'pixi.js';
import { blank, put, sky, valueNoise, mulberry32, type Bitmap } from '../../art/cutscene/common.ts';
import { outline, type Grid } from '../../art/pixel.ts';
import { BOSS_SWORD_FRAMES, BOSS_SWORD_S, SWORD_DOWN } from '../../art/ch3/decor.ts';
import { Motes, PAGE_FLY, castShadow, clamp, daisBitmap, ease, heroActor, hex, type DaisTones } from '../cutscene-parts.ts';
import { cliffs, floor } from './ending-shots.ts';
import type { Shot, ShotKit } from '../cutscene-shots.ts';

/** 夜空：天顶靛，往下玄岩、青黑，近山处青石（同第三章结尾）。 */
const NIGHT: [number, string][] = [
  [0, 'N'],
  [0.35, 'K'],
  [0.66, 'O'],
  [0.9, 'V'],
];

/** 剑台的石头：青黑石，左上受月光的沿是冷银，台面嵌一圈暗金（同战场上的剑台，art/ch3/ground.ts）。 */
const JIEPAI_STONE: DaisTones = { top: 'X', rim: 'T', shade: 'V', wall: 'V', wallLit: 'X', wallDark: 'O', seam: 'K', lip: 'T', foot: 'K', inlay: 'U', hole: 'K' };

/** 星：零星几点（冷银、霜白），慢慢明灭。 */
function stars(k: ShotKit, parent: Container, n: number, y1: number, seed: number) {
  const g = new Graphics();
  parent.addChild(g);
  const rnd = mulberry32(seed);
  const pts = Array.from({ length: n }, () => ({ x: Math.round(rnd() * k.W), y: Math.round(rnd() * rnd() * y1), ph: rnd() * 6, b: rnd() }));
  return (t: number) => {
    g.clear();
    for (const p of pts) g.rect(p.x, p.y, 1, 1).fill({ color: hex(p.b < 0.3 ? 'Z' : 'T'), alpha: 0.35 + 0.35 * Math.sin(t * 1.3 + p.ph) * (0.5 + p.b * 0.5) });
  };
}

/**
 * 谷底的青黑石（从 y0 往下铺满）：三档成片的青石（近处的斑块大、远处压扁），远处压暗成青黑；零星的旧剑痕（中间宽两头尖的斩痕，槽暗一档、下唇一线冷银；近大远小）。
 * path：正中一条往近处变宽的旧路（石面亮一档），通向关口。
 */
function stoneFloor(W: number, H: number, y0: number, seed: number, path = false): Bitmap {
  const b = blank(W, H);
  const n1 = valueNoise(seed, 30, W, 240);
  const n2 = valueNoise(seed + 1, 7, W, 240);
  const cx = W / 2;
  for (let y = Math.max(0, y0); y < H; y++) {
    const d = y - y0;
    const s = 1 + d * 0.07;
    const v1 = Math.sqrt(d + 1) * 5;
    for (let x = 0; x < W; x++) {
      const v = n1(x / s, v1) * 0.78 + n2(x / s, v1 * 1.7) * 0.22;
      let ch = v < 0.36 ? 'O' : v > 0.7 ? 'X' : 'V';
      if (path && Math.abs(x - cx) < 6 + d * 0.9 && v > 0.3) ch = v > 0.62 ? 'X' : 'V';
      if (d < 3) ch = d === 0 ? 'X' : 'O'; // 远处那一溜贴着山脚，压暗（山脚一线受月光）
      put(b, x, y, ch);
    }
  }
  const rnd = mulberry32(seed + 3);
  const area = W * Math.max(0, H - y0);
  for (let k = 0; k < area / 2600; k++) {
    const y = Math.round(y0 + 8 + rnd() * (H - y0 - 8));
    const x = Math.round(rnd() * W);
    const near = (y - y0) / Math.max(1, H - y0);
    const L = Math.round(2 + near * 9 + rnd() * 3);
    const slope = (rnd() - 0.5) * 0.4;
    for (let i = -L; i <= L; i++) {
      const u = i / L;
      const yy = Math.round(y + slope * i);
      put(b, x + i, yy, 'K');
      if (Math.abs(u) < 0.5 && near > 0.5) put(b, x + i, yy + 1, 'X');
    }
  }
  return b;
}

/**
 * 关墙和关楼（透明底）：一道横在谷口的关墙（垛口、正中一个拱门，门洞里是暗的），墙上一座两层的关楼，檐角起翘；
 * 墙和楼是青黑一路，上沿受月光亮一线冷银；关楼的窗里一点魂火（回响里还有人守着）。宽 w、高 h，墙脚在 h - 1。
 */
function passGate(w: number, h: number): { b: Bitmap; win: [number, number][] } {
  const b = blank(w, h);
  const cx = Math.floor(w / 2);
  const wallTop = h - 22;
  for (let x = 0; x < w; x++) {
    // 墙身：两头往下塌（贴着山崖的地方看不清）
    const end = Math.min(x, w - 1 - x);
    const sag = end < 14 ? Math.round((1 - end / 14) * 10) : 0;
    for (let y = wallTop + sag; y < h; y++) put(b, x, y, y === wallTop + sag ? 'T' : y === wallTop + sag + 1 ? 'X' : (x * 7 + y * 3) % 31 === 0 ? 'K' : 'O');
    if (!sag && x % 6 < 3) for (let y = wallTop - 3; y < wallTop; y++) put(b, x, y, y === wallTop - 3 ? 'T' : 'O');
  }
  // 拱门
  for (let y = h - 16; y < h; y++)
    for (let x = -6; x <= 6; x++) {
      const top = h - 16 + Math.round(6 - Math.sqrt(Math.max(0, 36 - x * x)));
      if (y >= top) put(b, cx + x, y, Math.abs(x) === 6 || y === top ? 'V' : 'K');
    }
  // 关楼：楼身 + 两重曲檐
  const roof = (rcx: number, ry: number, half: number, rise: number) => {
    for (let x = -half - 4; x <= half + 4; x++) {
      const k = Math.min(1, Math.abs(x) / (half + 4));
      const t = ry - Math.round(rise * (1 - k * k) + (Math.abs(x) > half ? (Math.abs(x) - half) * 0.8 : 0));
      const bt = ry + 1 - (Math.abs(x) > half ? Math.round((Math.abs(x) - half) * 0.6) : 0);
      for (let y = t; y <= Math.max(t, bt); y++) put(b, rcx + x, y, y === t ? 'J' : 'K');
    }
  };
  const win: [number, number][] = [];
  const bw = 30;
  const y1 = wallTop - 3;
  const y0 = y1 - 11;
  for (let y = y0; y <= y1; y++) for (let x = cx - bw / 2; x <= cx + bw / 2; x++) put(b, x, y, x === cx - bw / 2 ? 'X' : 'O');
  for (let c = 1; c < 5; c++) for (let y = y0 + 2; y <= y1; y++) put(b, cx - bw / 2 + Math.round((bw * c) / 5), y, 'K');
  win.push([cx - 6, y0 + 5], [cx + 7, y0 + 5]);
  roof(cx, y0, bw / 2 + 1, 4);
  const uw = 18;
  for (let y = y0 - 12; y <= y0 - 4; y++) for (let x = cx - uw / 2; x <= cx + uw / 2; x++) put(b, x, y, x === cx - uw / 2 ? 'X' : 'O');
  win.push([cx, y0 - 8]);
  roof(cx, y0 - 12, uw / 2 + 1, 4);
  return { b, win };
}

/** 路边的老界碑：一块高高的青石碑，碑首圆，正面刻着几道看不清的字（暗一档），受月光的一边亮一线；碑脚埋在土里。 */
const STELE: Grid = {
  w: 11,
  h: 27,
  rows: [
    '...OOOOO...',
    '..OXXVVVO..',
    '.OXTXVVVVO.',
    '.OXVVVVVVO.',
    'OXTVVVVVVVO',
    'OXVVKVKVVVO',
    'OXVVKVKVVVO',
    'OXTVKVKVVOO',
    'OXVVVVVVVVO',
    'OXVVKVKVVOO',
    'OXTVKVVVVVO',
    'OXVVKVKVVVO',
    'OXVVVVKVVOO',
    'OXTVKVKVVVO',
    'OXVVKVVVVVO',
    'OXVVKVKVVOO',
    'OXTVVVKVVVO',
    'OXVVVVVVVVO',
    'OXVVVVVVVOO',
    'OXTVVVVVVVO',
    'OXVVVVVVVVO',
    'OXVVVVVVVOO',
    'OXVVVVVVVVO',
    'OXVVVVVVOOO',
    'KOOOOOOOOOK',
    '.KKOOOOOKK.',
    '...KKKKK...',
  ],
};

export function shotJiepaiPass(k: ShotKit): Shot {
  const { W, H, cx, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 180;
  k.sprite(k.tex(sky(W, H, horizon, NIGHT)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 8), horizon - 70, 341);
  k.sprite(k.tex(cliffs(W, H, fy, cx, 343)), 0, 0, root);
  k.sprite(k.tex(stoneFloor(W, H, horizon, 345, true)), 0, 0, root);
  // 谷口的关：远远地横在两边山崖的脚下
  const gate = passGate(150, 56);
  k.sprite(k.tex(gate.b), cx - 75, horizon + 2 - 56, root);
  const win = new Graphics();
  win.blendMode = 'add';
  root.addChild(win);
  // 路边的老界碑（右下近处）和它的影子（月在东北：影子往左后拖）
  const sh = castShadow(5, 2, 16, 1, 'K', 120);
  k.sprite(k.tex(sh.b), fx + 404 - sh.ox, fy + 258 - sh.oy, root);
  k.sprite(k.grid(STELE), fx + 404 - 5, fy + 260 - STELE.h, root);
  // 残页：从西边（左上）飘进来，翻着往谷底落，越飘越低、越暗，没进谷底的暗处
  const flyT = PAGE_FLY.map((g) => k.grid(g));
  const page = new Sprite(flyT[0]);
  page.anchor.set(0.5);
  root.addChild(page);
  const trail = new Motes(root, true);
  const mist = new Motes(root, true);
  k.cue(0.4, 'sword.altars', 0.15);
  return {
    root,
    narrAt: { x: 0.86, y: 0.12, h: 0.42 },
    minT: 5,
    update(dt, t) {
      starAt(t);
      win.clear();
      for (const [i, [wx, wy]] of gate.win.entries()) win.rect(cx - 75 + wx, horizon + 2 - 56 + wy, 2, 1).fill({ color: hex('C'), alpha: 0.35 + 0.25 * Math.sin(t * (1.1 + i * 0.4) + i) });
      // 残页的路：0.6 秒起，3.6 秒里从左上飘到谷口前、往下落进暗处
      const u = clamp((t - 0.6) / 3.6);
      const px = fx - 10 + (cx + 30 - (fx - 10)) * ease(u) + Math.sin(u * 8) * 8 * (1 - u);
      const py = fy + 36 + (horizon + 4 - (fy + 36)) * u * u + Math.sin(u * 11) * 4 * (1 - u);
      page.visible = t > 0.6 && u < 1;
      page.position.set(Math.round(px), Math.round(py));
      page.texture = flyT[Math.floor(t * 6) % flyT.length];
      page.alpha = 1 - ease((u - 0.75) / 0.25);
      if (page.visible && Math.random() < dt * 18) trail.emit(px, py, -4 - Math.random() * 4, -2 - Math.random() * 3, 0.8 + Math.random() * 0.6, Math.random() < 0.6 ? 'Y' : 'f');
      trail.update(dt);
      // 谷底往上飘的剑气碎光（冷银、天青，很淡）
      if (Math.random() < dt * 8) mist.emit(fx + Math.random() * 480, horizon + Math.random() * (H - horizon), (Math.random() - 0.5) * 3, -3 - Math.random() * 5, 3 + Math.random() * 3, Math.random() < 0.55 ? 'Z' : 'C', { a: 0.5 });
      mist.update(dt);
    },
  };
}

// ---------------------------------------------------------------- 四剑

/**
 * 过场里近看的一把剑（剑尖朝下）：画法同战场上的四剑（art/ch3/decor.ts），只是长一倍多——剑身暗金三像素宽、背光一侧古金，
 * 剑尖收成一点琥珀；护手一道暗金、正中一粒藤黄；剑柄古金缠着赭；柄头垂一缕剑穗（四把剑的剑穗颜色不同）。
 * glint：一线寒光走到哪（0 剑尖 … 1 护手，< 0 没有）。画布宽 11、高 blade + 10，剑的中线在 x = 5，剑尖在最后一行往上一格。
 */
function swordArt(blade: number, glint: number, tassel: string): Grid {
  const W = 11;
  const H = blade + 10;
  const rows = Array.from({ length: H }, () => Array<string>(W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < W && y < H) rows[y][x] = c;
  };
  const c = 5;
  set(c - 1, 1, 'M');
  set(c, 1, 'U');
  set(c + 1, 1, 'M');
  for (let y = 2; y <= 6; y++) set(c, y, y % 2 ? 'B' : 'M');
  for (let x = -3; x <= 3; x++) set(c + x, 7, Math.abs(x) === 3 ? 'M' : x === 0 ? 'y' : 'U');
  for (let i = 0; i < blade; i++) {
    const y = 8 + i;
    const fromTip = blade - 1 - i;
    const f = fromTip / (blade - 1); // 0 剑尖 … 1 护手
    const g = glint >= 0 && Math.abs(f - glint) < 0.075;
    if (fromTip === 0) {
      set(c, y, g ? 'W' : 'b');
      continue;
    }
    if (fromTip <= 2) {
      set(c, y, g ? 'W' : 'U');
      set(c - 1, y, g ? 'Z' : 'M');
      continue;
    }
    set(c - 1, y, g ? 'Z' : 'M');
    set(c, y, g ? 'W' : 'U');
    set(c + 1, y, g ? 'Z' : 'U');
  }
  // 剑穗：从柄头往下垂（顺着剑柄的一侧）
  for (let j = 0; j < 6; j++) set(c + 2 + (j > 3 ? 1 : 0), 1 + j, tassel);
  return outline({ w: W, h: H, rows: rows.map((r) => r.join('')) }, 'K', { b: 'M', U: 'K', M: 'K', W: 'M', Z: 'M', y: 'M', B: 'K', j: 'i', e: 'r', p: 'P', c: 'n' });
}
/** 四把剑的剑穗颜色（同 art/ch3/decor.ts：0 西北绝仙白、1 东北诛仙朱、2 东南戮仙紫、3 西南陷仙青）。 */
const TASSEL = ['j', 'e', 'p', 'c'];
/** 一把剑的几帧：平时，和寒光从剑尖走到护手的几帧。 */
const swordFrames = (k: ShotKit, sword: number, blade: number) => [-1, 0.04, 0.18, 0.32, 0.46, 0.6, 0.74, 0.88, 1].map((g) => k.grid(swordArt(blade, g, TASSEL[sword])));

/** 四座剑台：哪个角、第几把剑（art/ch3/decor.ts 的剑穗：0 西北绝仙、1 东北诛仙、2 东南戮仙、3 西南陷仙）、远近。 */
const ALTARS = [
  { sword: 0, dx: -136, y: 146, near: false }, // 西北 · 绝仙（左后）
  { sword: 1, dx: 136, y: 146, near: false }, // 东北 · 诛仙（右后）
  { sword: 2, dx: 178, y: 236, near: true }, // 东南 · 戮仙（右前）
  { sword: 3, dx: -178, y: 236, near: true }, // 西南 · 陷仙（左前）
];
/** 旁白念的顺序：诛仙、戮仙、陷仙、绝仙（剑的编号）。 */
const NAME_ORDER = [1, 2, 3, 0];

export function shotJiepaiSwords(k: ShotKit): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const horizon = fy + 112;
  k.sprite(k.tex(sky(W, H, horizon, NIGHT)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 9), horizon - 30, 351);
  k.sprite(k.tex(cliffs(W, H, fy - 12, cx, 353)), 0, 0, root);
  const ground = stoneFloor(W, H, horizon, 355);
  // 阵心的刻槽（两圈扁椭圆、中间一块圆石）和对角的阵线（只剩剑台脚下、阵心外圈的两截），刻在地上
  const sealY = fy + 186;
  for (const [rx, ry] of [
    [64, 11],
    [52, 8],
  ]) {
    const N = Math.ceil(2 * Math.PI * rx);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      put(ground, cx + Math.cos(a) * rx, sealY + Math.sin(a) * ry, 'K');
      if (Math.sin(a) > 0) put(ground, cx + Math.cos(a) * rx, sealY + Math.sin(a) * ry + 1, 'T');
    }
  }
  for (let y = -3; y <= 3; y++)
    for (let x = -13; x <= 13; x++) {
      const d = (x / 13) ** 2 + (y / 3) ** 2;
      if (d <= 1) put(ground, cx + x, sealY + y, d > 0.75 ? 'U' : y < 0 ? 'X' : 'V');
    }
  for (const a of ALTARS) {
    const ax = cx + a.dx;
    const ay = fy + a.y - (a.near ? 8 : 4);
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const near = u < 0.28 || u > 0.72;
      if (!near || (i % 4 === 3 && u > 0.5)) continue;
      put(ground, ax + (cx - ax) * u, ay + (sealY - ay) * u, u > 0.5 ? 'M' : 'K');
    }
  }
  k.sprite(k.tex(ground), 0, 0, root);
  // 剑台、悬着的剑
  const swords = ALTARS.map((a) => {
    const d = a.near ? { rx: 24, ry: 6, side: 6 } : { rx: 13, ry: 3, side: 3 };
    const art = daisBitmap(d.rx, d.ry, d.side, 1, JIEPAI_STONE);
    const x = cx + a.dx;
    const sh = castShadow(d.rx + 4, d.ry + 1, Math.round(d.rx * 1.2), 1, 'K', 110);
    k.sprite(k.tex(sh.b), x - sh.ox, fy + a.y - d.ry - 1 - sh.oy, root);
    const topY = fy + a.y - (art.foot - art.cy);
    k.sprite(k.tex(art.b), x - art.cx, topY - art.cy, root);
    const blade = a.near ? 25 : 14;
    const frames = swordFrames(k, a.sword, blade);
    const s = new Sprite(frames[0]);
    s.anchor.set(5 / 11, (blade + 8) / (blade + 10)); // 锚点在剑尖
    root.addChild(s);
    return { a, s, frames, x, top: topY, glintAt: -1 };
  });
  const mist = new Motes(root, true);
  // 念到哪一把，那一把走过一线寒光（和旁白一个字一个字出来的节奏对上：每列两个字）
  NAME_ORDER.forEach((sw, j) => {
    const v = swords.find((s) => s.a.sword === sw)!;
    v.glintAt = 0.95 + j * 0.27;
    k.cue(v.glintAt, 'sword.warn', 0.12);
  });
  return {
    root,
    narrAt: { x: 0.5, y: 0.1, h: 0.3 },
    minT: 4.6,
    update(dt, t) {
      starAt(t);
      for (const v of swords) {
        // 剑尖朝下悬在台上，慢慢上下浮
        const bob = Math.round(Math.sin(t * 1.4 + v.a.sword * 1.3) * 1.2);
        const hover = v.a.near ? 7 : 4;
        v.s.position.set(v.x, v.top - hover + bob);
        // 寒光：念到它的那一下从剑尖走到护手，之后隔几秒再走一遍
        const tt = t >= v.glintAt ? (t - v.glintAt) % 3.6 : -1;
        const g = tt >= 0 && tt < 0.55 ? tt / 0.55 : -1;
        v.s.texture = v.frames[g < 0 ? 0 : 1 + Math.min(v.frames.length - 2, Math.floor(g * (v.frames.length - 1)))];
      }
      if (Math.random() < dt * 9) mist.emit(Math.random() * W, horizon + Math.random() * (H - horizon), (Math.random() - 0.5) * 3, -3 - Math.random() * 5, 3 + Math.random() * 3, Math.random() < 0.55 ? 'Z' : 'C', { a: 0.45 });
      mist.update(dt);
    },
  };
}

// ---------------------------------------------------------------- 阵心

export function shotJiepaiHeart(k: ShotKit): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const horizon = fy + 168;
  k.sprite(k.tex(sky(W, H, horizon, NIGHT)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 9), horizon - 60, 361);
  k.sprite(k.tex(cliffs(W, H, fy, cx, 41)), 0, 0, root); // 同结尾的那一镜（同一个地方）
  const floorY = fy + 186;
  const sealY = fy + 206;
  k.sprite(k.tex(floor(W, H, floorY, cx, sealY)), 0, 0, root);
  // 对角的阵线：从远处的两座剑台、近处画面外的两座，往阵心收（一截截的刻槽亮起冷银，往里走）
  const ends: [number, number][] = [
    [cx - 210, floorY + 4],
    [cx + 210, floorY + 4],
    [cx + 300, fy + 290],
    [cx - 300, fy + 290],
  ];
  const lines = new Graphics();
  root.addChild(lines);
  for (const [ex, ey] of ends)
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      if (u > 0.82 || i % 5 === 4) continue; // 阵心外圈里面不画（那里是刻好的圈）
      lines.rect(Math.round(ex + (cx - ex) * u), Math.round(ey + (sealY - ey) * u), 1, 1).fill({ color: hex('K') });
    }
  const pulse = new Graphics();
  pulse.blendMode = 'add';
  root.addChild(pulse);
  // 远处的两座剑台、悬着的剑（小）
  for (const [i, [ex, ey]] of ends.slice(0, 2).entries()) {
    const art = daisBitmap(10, 2, 3, 1, JIEPAI_STONE);
    k.sprite(k.tex(art.b), ex - art.cx, ey + 2 - art.foot, root);
    const s = k.sprite(k.grid(BOSS_SWORD_FRAMES[i][SWORD_DOWN]), ex - (BOSS_SWORD_S - 1) / 2, ey + 2 - (art.foot - art.cy) - 14 - (BOSS_SWORD_S - 1) / 2, root);
    s.alpha = 0.9;
  }
  // 门缝：阵心的圆石上面，隐约一道竖的线（关着的门），只透一线暗金
  const seam = new Graphics();
  seam.blendMode = 'add';
  root.addChild(seam);
  const seamTop = fy + 44;
  const seamBot = sealY - 6;
  const hero = heroActor(k, root, cx - 84, fy + 252, 1);
  const motes = new Motes(root, true);
  k.cue(0.5, 'zx.close.warn', 0.12);
  return {
    root,
    narrAt: { x: 0.86, y: 0.12, h: 0.42 },
    minT: 5,
    update(dt, t) {
      starAt(t);
      // 阵线：一截亮的冷银从四个角往阵心走（一圈 2.4 秒），走到阵心外圈就没了
      pulse.clear();
      for (const [j, [ex, ey]] of ends.entries()) {
        const head = ((t * 0.42 + j * 0.25) % 1) * 0.82;
        for (let i = 0; i <= 120; i++) {
          const u = i / 120;
          if (u > 0.82 || i % 5 === 4) continue;
          const d = head - u;
          if (d < 0 || d > 0.18) continue;
          pulse.rect(Math.round(ex + (cx - ex) * u), Math.round(ey + (sealY - ey) * u), 1, 1).fill({ color: hex(d < 0.04 ? 'Z' : 'T'), alpha: 0.55 * (1 - d / 0.18) });
        }
      }
      // 门缝：很淡的一竖暗金，慢慢明灭，偶尔一粒金屑从缝里漏出来
      seam.clear();
      const a = 0.12 + 0.1 * Math.sin(t * 1.6) + (t > 1.2 ? 0.08 * ease((t - 1.2) / 2) : 0);
      for (let y = seamTop; y <= seamBot; y++) {
        const u = (y - seamTop) / (seamBot - seamTop);
        const w = Math.sin(u * Math.PI) ** 0.6;
        seam.rect(cx, y, 1, 1).fill({ color: hex(w > 0.85 ? 'y' : 'U'), alpha: a * w });
      }
      if (Math.random() < dt * 2.5) motes.emit(cx + (Math.random() - 0.5) * 2, seamTop + Math.random() * (seamBot - seamTop), (Math.random() - 0.5) * 6, -3 - Math.random() * 4, 1.6 + Math.random(), Math.random() < 0.6 ? 'Y' : 'f');
      motes.update(dt);
      hero.pose(t);
    },
  };
}
