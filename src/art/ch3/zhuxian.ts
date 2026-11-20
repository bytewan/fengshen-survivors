// 第三章首领「诛仙剑灵」：诛仙四剑合一的剑灵。人形、半透明的剑光身躯——霜白、冷银的身子，背光处雾蓝，衣襟一线天青；
// 头上一顶三刃的暗金剑冠，一张白面、一线寒光是眼；长发像一道剑光往后飘；两肩各一片刃形的暗金肩甲；
// 腰下的袍分成三片，每一片都收成剑尖往下垂（剑光身躯，没有脚）。身后悬着的四把剑是活的（game/ch3/zhuxian-fx.ts 画），不在这张图里。
// 比哪吒高一截（约 20×34），不放大成大像素块。朝右绘制，朝左时整体镜像。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { sketch } from '../sprites/foe-kit.ts';

export const ZX_W = 30;
export const ZX_H = 40;
export const ZX_ANCHOR = { x: 14, y: 38 };

const SELOUT: Record<string, string> = { Z: 'T', W: 'T', T: 'J', J: 'n', C: 'c', c: 'n', n: 'N', N: 'k', U: 'M', y: 'U', b: 'M', M: 'K', K: 'k' };

/** 头（朝右）：三刃的暗金剑冠，白面（后脑一层冷银的发），一线寒光是眼，下颌收尖。 */
const HEAD = grid(['....y...', '..U.U.U.', '..UUbUU.', '.TZZZZZ.', 'TTZZZWW.', 'TTZZZZC.', '.TTZZZ..', '..TZZ...', '...ZZ...']);

/** 长发：从后脑往后（朝右时往左）垂下来的几缕剑光，一缕比一缕长，发梢一点天青；phase 让发梢起伏，wild 时往后飞起来。 */
function hair(s: ReturnType<typeof sketch>, x: number, y: number, phase: number, wild: boolean) {
  // 三缕，往后斜着飘（不是直直垂到腰的一条，免得看成一只胳膊）；雾蓝、冷银，发梢一点天青
  for (let k = 0; k < 3; k++) {
    const len = 6 + k * 2 + (wild ? 3 : 0);
    for (let i = 0; i <= len; i++) {
      const u = i / len;
      const px = x - 1 - i * (wild ? 1.0 : 0.75);
      const py = y + k * 1.2 + i * (wild ? 0.25 : 0.6) + Math.sin(phase * Math.PI * 2 + u * 3.5 + k) * u * 1.2;
      s.set(px, py, u > 0.8 ? 'C' : k === 1 ? 'T' : 'J', true);
    }
  }
}

/** 身子：肩宽 9 的上身（交领、衣襟一线天青、暗金腰带），两肩各一片往外下垂的刃形肩甲。lean：前倾。 */
function torso(lean: number): Grid {
  const s = sketch(ZX_W, ZX_H);
  const top = 15;
  for (let y = top; y <= 22; y++) {
    const k = (y - top) / 7;
    const half = 4.2 + k * 1;
    const off = Math.round(lean * k);
    const x0 = Math.round(14 - half) + off;
    const x1 = Math.round(14 + half) + off;
    for (let x = x0; x <= x1; x++) {
      let c = 'Z';
      if (x >= x1 - 1) c = 'J';
      else if (x >= x1 - 3) c = 'T';
      else if (x === 15 + off) c = 'C'; // 衣襟
      if (y === 21) c = x === 15 + off ? 'y' : 'U'; // 腰带、扣
      s.set(x, y, c);
    }
  }
  // 交领（右衽）
  for (let i = 0; i < 4; i++) s.set(12 + i + Math.round(lean * (i / 7)), top + i, 'W');
  // 肩甲：两片刃（暗金，刃口一线琥珀），从肩头往外下方伸出去
  s.line(10, 16, 7, 19, (i) => (i === 3 ? 'b' : 'U'));
  s.line(10, 17, 8, 19, 'M', true);
  s.line(18 + Math.round(lean * 0.2), 16, 21 + Math.round(lean * 0.2), 19, (i) => (i === 3 ? 'b' : 'U'));
  return s.grid();
}

/**
 * 腰下的袍：三片，每一片收成剑尖往下垂（中间那片最长），片与片之间下半截透空（看得出是三片）；
 * 受光的一边霜白、背光的一边雾蓝，剑尖一点天青。phase 让三片轻轻错开地飘；lean：往后拖。
 */
function skirt(phase: number, lean: number, kneel: boolean): Grid {
  const s = sketch(ZX_W, ZX_H);
  const panels = [
    { x0: 9, x1: 11, end: kneel ? 29 : 32 },
    { x0: 12, x1: 15, end: kneel ? 30 : 35 },
    { x0: 16, x1: 18, end: kneel ? 29 : 31 },
  ];
  panels.forEach((pn, j) => {
    const sway = Math.sin(phase * Math.PI * 2 + j * 1.7) * 0.7;
    for (let y = 22; y <= pn.end; y++) {
      const k = (y - 22) / (pn.end - 22);
      const drift = Math.round(sway * k - lean * k * 1.5);
      // 越往下越窄，最后收成一个尖
      const w = pn.x1 - pn.x0;
      const shrink = k > 0.55 ? ((k - 0.55) / 0.45) * (w / 2 + 0.5) : 0;
      const a = Math.round(pn.x0 + shrink) + drift;
      const b = Math.round(pn.x1 - shrink) + drift;
      for (let x = a; x <= b; x++) {
        let c = x === a ? 'Z' : x === b ? 'J' : 'T';
        if (y >= pn.end - 1) c = y === pn.end ? 'c' : 'C';
        s.set(x, y, c);
      }
    }
  });
  return s.grid();
}

/** 一只大袖：从肩 (sx, sy) 到手 (hx, hy)，越往袖口越宽；手是霜白的剑指（point：食中二指伸出）。 */
function sleeve(s: ReturnType<typeof sketch>, sx: number, sy: number, hx: number, hy: number, point: boolean) {
  const n = Math.max(1, Math.round(Math.hypot(hx - sx, hy - sy)));
  const ux = (hx - sx) / n;
  const uy = (hy - sy) / n;
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
    const w = Math.round(t * 2);
    for (let d = 0; d <= w; d++) {
      const c = i >= n - 1 ? 'C' : d === 0 ? 'Z' : d >= w ? 'J' : 'T';
      s.set(x + nx * d, y + ny * d, c, true);
    }
  }
  s.set(hx + ux, hy + uy, 'W');
  if (point) {
    s.set(hx + ux * 2, hy + uy * 2, 'Z');
    s.set(hx + ux * 3, hy + uy * 3, 'W');
  }
}

export type ZxArtPose = 'idle' | 'walk' | 'raise' | 'slash' | 'point' | 'dash' | 'roar' | 'kneel';

interface Spec {
  bob: number;
  hem: number;
  front: [number, number];
  back: [number, number] | null;
  point?: boolean;
  lean?: number; // 突进时身子前倾（袍子往后拖）
  wild?: boolean; // 头发飞起来（怒、突进）
  kneel?: boolean;
  tilt?: number;
}

function frame(sp: Spec): Grid {
  const sink = sp.kneel ? 4 : 0;
  const b = sp.bob + sink;
  const lean = sp.lean ?? 0;
  const s = sketch(ZX_W, ZX_H);
  const back = sketch(ZX_W, ZX_H);
  if (sp.back) sleeve(back, 11, 17 + b, sp.back[0], sp.back[1] + b, false);
  const hs = sketch(ZX_W, ZX_H);
  hair(hs, 12 + (sp.tilt ?? 0) + lean, 11 + b, sp.hem, !!sp.wild);
  const layers: Layer[] = [
    { g: hs.grid(), x: 0, y: 0 },
    { g: back.grid(), x: 0, y: 0 },
    { g: skirt(sp.hem, lean, !!sp.kneel), x: 0, y: b },
    { g: torso(lean), x: 0, y: b },
    { g: HEAD, x: 10 + (sp.tilt ?? 0) + lean, y: 6 + b },
  ];
  sleeve(s, 17 + lean, 17 + b, sp.front[0], sp.front[1] + b, !!sp.point);
  layers.push({ g: s.grid(), x: 0, y: 0 });
  return outline(compose(ZX_W, ZX_H, layers), 'N', SELOUT);
}

export const ZX_FRAMES: Record<ZxArtPose, Grid[]> = {
  // 站着：前手剑指垂在身侧，袍角、发梢轻轻飘
  idle: [0, 0.5].map((h) => frame({ bob: 0, hem: h, front: [19, 24], back: null })),
  // 走：飘着走（没有脚），一起一伏
  walk: [0, 0.25, 0.5, 0.75].map((h, i) => frame({ bob: i % 2 ? -1 : 0, hem: h, front: [19, 23 + (i % 2)], back: null })),
  // 抬手（入场、剑雨、四剑归阵）：双手往上抬，剑指朝天
  raise: [0, 0.5].map((h, i) => frame({ bob: -i, hem: h, front: [21, 9], back: [7, 10], point: true })),
  // 四剑环斩：前手往外一挥（剑指划圈）
  slash: [0, 0.5].map((h, i) => frame({ bob: 0, hem: h, front: i ? [25, 14] : [24, 21], back: [8, 19], point: true })),
  // 指（一剑化四放剑气、突进前瞄准）：剑指直直往前
  point: [0, 0.5].map((h) => frame({ bob: 0, hem: h, front: [25, 18], back: null, point: true })),
  // 突进：身子前倾、头发往后飞起来，剑指在前
  dash: [0, 0.5].map((h) => frame({ bob: 1, hem: h, front: [26, 20], back: [6, 21], point: true, lean: 2, wild: true })),
  // 换阶段：双手张开、头往后仰、头发飞起来
  roar: [0, 0.5].map((h) => frame({ bob: 0, hem: h, front: [26, 13], back: [3, 13], wild: true, tilt: -1 })),
  // 倒下：跪着，剑光身躯一缕缕地散
  kneel: [frame({ bob: 0, hem: 0, front: [19, 28], back: null, kneel: true })],
};
