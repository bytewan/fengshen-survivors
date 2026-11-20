// 第二章首领「落魂阵主 · 姚天君」：截教十天君之一，落魂阵的阵主。高高的玄色道冠（一点金饰），苍白的脸、天青的眼光（榜上的魂），
// 一缕长长的白须；灰紫的大袖道袍、里衬殷红、朱色腰带，袍角散成魂雾；手里一只摄魂铃（藤黄铜铃、朱红铃穗）。
// 比哪吒高一个道冠（约 20×32），不放大成大像素块。朝右绘制，朝左时整体镜像。
// 另有两件召出来的东西：落魂幡（插在地上的一面窄幡，比落魂幡手手里的大一号，幡头一团魂火）和草人（稻草扎的小人，胸口贴符）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from '../sprites/foe-kit.ts';

export const YAO_W = 32;
export const YAO_H = 37;
export const YAO_ANCHOR = { x: 15, y: 35 };

const SELOUT: Record<string, string> = { j: 'h', i: 'h', w: 'h', h: 'g', g: 'k', R: 'k', r: 'R', y: 'B', Y: 'b', b: 'B', P: 'k', p: 'P', d: 'k', C: 'c' };

// 道冠：玄色，中间一道金饰，冠顶两片往后翘的冠翅
const HAT = grid(['...kk....', '..kddk.k.', '.kddddkd.', '.kdyydk..', 'kddyyddky', 'kddddddkY', '.kkkkkk..']);
// 脸：苍白，天青的眼（朝右），白须从下巴垂下
const HEAD = grid(['.jjjjj', 'jjjhjh', 'ijjCjC', 'ijjjjw', '.iwwww', '..wwwj']);
/** 道袍（不含袖子）：肩宽 9、往下放宽到 13；受光的左沿银鼠、背光的右沿黛；前襟露一道殷红里衬；腰间朱色腰带、金扣。 */
function robe(hemPhase: number, kneel: boolean): Grid {
  const s = sketch(YAO_W, YAO_H);
  const top = 15;
  const bottom = kneel ? 29 : 33;
  for (let y = top; y <= bottom; y++) {
    const k = (y - top) / (bottom - top);
    const half = 4.5 + k * 2.4;
    const sway = y > bottom - 4 ? Math.round(Math.sin(hemPhase * Math.PI * 2 + y) * 0.6) : 0;
    const x0 = Math.round(15 - half) + sway;
    const x1 = Math.round(15 + half) + sway;
    for (let x = x0; x <= x1; x++) {
      let c = 'h';
      if (x === x0) c = 'i';
      else if (x >= x1 - 1) c = 'g';
      else if (x === 16 || (x === 17 && y > top + 3)) c = 'R'; // 前襟露出的殷红里衬
      else if ((x + y) % 7 === 0 && y > top + 6) c = 'g'; // 衣褶
      if (y === 22) c = x === 16 ? 'y' : x === x0 ? 'R' : 'r'; // 腰带、金扣
      if (y === bottom) c = (x + Math.round(hemPhase * 4)) % 3 === 0 ? 'P' : 'g'; // 袍角压暗
      s.set(x, y, c);
    }
  }
  // 交领：领口一道缟色的斜线（右衽）
  for (let i = 0; i < 4; i++) {
    s.set(13 + i, top + i, 'j');
    s.set(18 - Math.min(i, 1), top + i, i < 2 ? 'j' : s.rows[top + i][18 - Math.min(i, 1)]);
  }
  // 白须垂在胸前（长须，末梢分两缕）
  for (let y = top; y < top + 6; y++) s.set(17, y, y < top + 5 ? 'w' : 'j');
  s.set(18, top, 'w');
  s.set(16, top + 1, 'w');
  s.set(18, top + 5, 'j');
  return s.grid();
}

/** 摄魂铃：藤黄铜铃，下面垂一缕朱红铃穗。tilt：-1 / 0 / 1 摇的方向。 */
function bell(tilt: number): Grid {
  if (tilt < 0) return grid(['y..', 'yY.', 'yYy', '.by', '.r.', 'r..']);
  if (tilt > 0) return grid(['..y', '.Yy', 'yYy', 'yb.', '.r.', '..r']);
  return grid(['.y.', 'yYy', 'yYy', 'byb', '.r.', '.r.']);
}

/**
 * 一只大袖：从肩 (sx, sy) 到手 (hx, hy)，越往袖口越宽（道袍的大袖，袖口一圈殷红的里子），受光的一边银鼠、背光的一边黛；手苍白。
 * 袖子横着垂（手比肩低）时往下宽，举起来时往两边宽。
 */
function sleeve(s: ReturnType<typeof sketch>, sx: number, sy: number, hx: number, hy: number) {
  const n = Math.max(1, Math.round(Math.hypot(hx - sx, hy - sy)));
  const ux = (hx - sx) / n;
  const uy = (hy - sy) / n;
  // 袖子的「宽」朝着和走向垂直、偏下的那一边（大袖垂着）
  let nx = -uy;
  let ny = ux;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = sx + (hx - sx) * t;
    const y = sy + (hy - sy) * t;
    const w = 1 + Math.round(t * 2.6); // 越往袖口越宽
    for (let d = -1; d <= w; d++) {
      const c = i >= n - 1 ? 'R' : d === -1 ? 'i' : d >= w ? 'g' : 'h';
      s.set(x + nx * d, y + ny * d, c, true);
    }
  }
  s.set(hx + ux, hy + uy, 'j');
}

export type YaoArtPose = 'idle' | 'walk' | 'cast' | 'bell' | 'raise' | 'roar' | 'kneel';

interface Spec {
  bob: number;
  hem: number;
  front: [number, number]; // 前手（朝右那一侧）的位置
  back: [number, number] | null; // 后手（露出来的话）
  bell: number | null; // 铃的摇向（null = 不拿铃）
  bellAt?: [number, number];
  kneel?: boolean;
  tilt?: number; // 头往后仰（怒）
}

function frame(sp: Spec): Grid {
  const sink = sp.kneel ? 4 : 0;
  const b = sp.bob + sink;
  const s = sketch(YAO_W, YAO_H);
  // 后手的袖子在身后
  const back = sketch(YAO_W, YAO_H);
  if (sp.back) sleeve(back, 12, 16 + b, sp.back[0], sp.back[1] + b);
  const layers: Layer[] = [{ g: back.grid(), x: 0, y: 0 }, { g: robe(sp.hem, !!sp.kneel), x: 0, y: sp.bob }];
  layers.push({ g: HEAD, x: 12 + (sp.tilt ?? 0), y: 9 + b }, { g: HAT, x: 11 + (sp.tilt ?? 0), y: 2 + b });
  sleeve(s, 18, 16 + b, sp.front[0], sp.front[1] + b);
  layers.push({ g: s.grid(), x: 0, y: 0 });
  if (sp.bell !== null) {
    const [bx, by] = sp.bellAt ?? [sp.front[0] - 1, sp.front[1] + 1];
    layers.push({ g: bell(sp.bell), x: bx, y: by + b });
  }
  const base = outline(compose(YAO_W, YAO_H, layers), 'k', SELOUT);
  // 袍角散成魂雾
  const mist = sp.kneel ? [] : [{ g: grid([sp.hem < 0.5 ? '.c..C.c..c.' : 'c..c..C.c..', sp.hem < 0.5 ? 'C.c....c..C' : '.C...c...c.']), x: 9, y: 34 }];
  return compose(YAO_W, YAO_H, [{ g: base, x: 0, y: 0 }, ...mist]);
}

export const YAO_FRAMES: Record<YaoArtPose, Grid[]> = {
  // 站着：前手垂在身前拿着铃，袍角轻轻摆
  idle: [0, 0.5].map((h) => frame({ bob: 0, hem: h, front: [20, 23], back: null, bell: 0 })),
  // 走：一步一顿，袍角左右摆
  walk: [0, 0.25, 0.5, 0.75].map((h, i) => frame({ bob: i % 2, hem: h, front: [20, 23], back: null, bell: i % 2 ? -1 : 1 })),
  // 插幡：前手往前下方一指（剑指），后手抬起
  cast: [0, 0.5].map((h, i) => frame({ bob: 0, hem: h, front: [24, 20 + i], back: [8, 13], bell: null })),
  // 摇铃：前手把铃举到头边，铃左右摇
  bell: [-1, 1].map((t, i) => frame({ bob: 0, hem: i * 0.5, front: [22, 12], back: null, bell: t, bellAt: [21, 7] })),
  // 抬手（入场、草人、十阵）：双手往上抬
  raise: [0, 0.5].map((h, i) => frame({ bob: -i, hem: h, front: [23, 11], back: [7, 11], bell: null })),
  // 换阶段：双手张开、头往后仰
  roar: [0, 0.5].map((h) => frame({ bob: 0, hem: h, front: [26, 15], back: [4, 15], bell: null, tilt: -1 })),
  // 倒下：跪着，铃掉在身前
  kneel: [frame({ bob: 0, hem: 0, front: [19, 27], back: null, bell: 0, bellAt: [21, 29], kneel: true })],
};

// ---------- 召出来的东西 ----------

/** 落魂幡：画布 12×30，锚点 (5, 29)。赭色木杆、一道横杆，下垂一面窄窄的幡（玄色底、胭脂紫的边、缟色的符文），幡头一团天青魂火。两帧（幡面摆）。 */
export const SOULFLAG_W = 12;
export const SOULFLAG_H = 30;
export const SOULFLAG_ANCHOR = { x: 5, y: 29 };
/** 魂线连在幡的哪里（相对锚点）。 */
export const SOULFLAG_TIP = { x: 0, y: -26 };

function soulflag(sway: number): Grid {
  const s = sketch(SOULFLAG_W, SOULFLAG_H);
  const px = 5;
  s.line(px, 4, px, 29, (i) => (i % 6 === 3 ? 'b' : 'B'));
  s.line(px - 1, 4, px + 5, 4, 'B');
  // 魂火
  s.set(px, 1, 'C');
  s.set(px, 2, 'c');
  s.set(px - 1, 2, 'C');
  s.set(px, 3, 'c');
  // 幡面：横杆下 5 像素宽、12 像素长
  for (let y = 0; y < 12; y++) {
    const off = Math.round(sway * (y / 11) * 1.6);
    for (let x = 0; x < 5; x++) {
      if (y === 11 && x % 2 === 0) continue; // 幡尾的齿
      const edge = x === 0 || x === 4 || y === 0;
      const glyph = !edge && ((x === 2 && y >= 2 && y <= 9) || (y === 4 && x >= 1 && x <= 3) || (y === 7 && x !== 2));
      s.set(px + 1 + x + off, 5 + y, edge ? 'p' : glyph ? 'j' : 'P');
    }
  }
  // 插在地上：杆脚一点土
  s.set(px - 1, 29, 'D');
  s.set(px + 1, 29, 'D');
  return outline(s.grid(), 'k', { B: 'D', b: 'B', P: 'k', p: 'P', j: 'h', C: 'c', D: 'k' });
}
export const SOULFLAG_FRAMES = [soulflag(0), soulflag(1)];

/** 草人：画布 14×20，锚点 (7, 19)。稻草扎的小人（枯草色），插在一根木桩上，胸口贴一道黄符（朱砂符文），头上扎一缕红绳。两帧（稻草微微抖）。 */
export const STRAW_W = 14;
export const STRAW_H = 20;
export const STRAW_ANCHOR = { x: 7, y: 19 };

function strawman(i: number): Grid {
  const rows = [
    '.....rr.......',
    '....FFFF......',
    '...FHFFHF.....',
    '...FFFFFF.....',
    '....FFFF......',
    '..F.FFFF.F....',
    '.FHFFYYFFHF...',
    'F..FFYrFF..F..',
    '...FFYrFF.....',
    '...FFYYFF.....',
    '...FHFFHF.....',
    '....FFFF......',
    '....F..F......',
    '......B.......',
    '......B.......',
    '......B.......',
    '......b.......',
    '......B.......',
    '.....DBD......',
  ];
  const g = grid(rows.map((r, y) => (i && y >= 5 && y <= 7 ? (y === 5 ? '.' + r.slice(0, -1) : r.slice(1) + '.') : r)));
  return outline(compose(STRAW_W, STRAW_H, [{ g, x: 0, y: 1 }]), 'k', { F: 'H', H: 'B', Y: 'b', r: 'R', B: 'D', b: 'B', D: 'k' });
}
export const STRAW_FRAMES = [strawman(0), strawman(1)];
