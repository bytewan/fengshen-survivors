// 魔化哪吒（首领）：玩家哪吒的「另一个自己」。和哪吒一样大（镜像对决），用哪吒的同一套部件重新配色、加新姿势。
// 配色（用户定）：玄黑、紫棠、殷红的衣服，苍白的皮肤，赤红的眼睛；风火轮烧的是黑焰（黑紫带红芯），混天绫是黑红色。
// 新姿势：黑色火尖枪（殷红枪缨、火焰形枪头）的蓄力与突进、收枪、抬手分身、挥绫、怒吼、跪倒。
// 画布比哪吒宽、高一些，只是为了放得下前刺的枪和举起的手；人物本身一样大，不放大成大像素块。朝右绘制，朝左时整体镜像。
// 另有两件「招式」精灵：飞出去的黑焰乾坤圈（约 22 像素、四帧旋转）和满场滚的风火轮（约 18 像素、四帧旋转）。
import { compose, grid, outline, type Grid, type Layer } from '../pixel.ts';
import { DEFAULT_HAIR, NEZHA_PARTS as N, type HairStyle } from './nezha.ts';

export const DEMON_W = 44;
export const DEMON_H = 37;
const OX = 6; // 哪吒的部件放到这张画布上的偏移
const OY = 4;
export const DEMON_ANCHOR = { x: 16 + OX, y: 32 + OY }; // 哪吒的身子加长两行之后跟着往下两行

const map = (g: Grid, m: Record<string, string>): Grid => ({ ...g, rows: g.rows.map((r) => [...r].map((c) => m[c] ?? c).join('')) });

// ---------- 配色 ----------
/** 头：苍白的脸，发髻（同哪吒，后双髻）的高光压成紫棠，扎髻的红绳换成黑红色。 */
const HEAD: Record<string, string> = { t: 'j', s: 'i', S: 'h', h: 'P', e: 'R', r: 'k' };
/** 衣：紫棠为主、玄黑压暗面，交领与衣上那道亮色换成殷红；腰带是暗赭。 */
const JACKET: Record<string, string> = { r: 'P', R: 'd', e: 'R', d: 'r', y: 'B', Y: 'b', t: 'j', s: 'i' };
const LEGS: Record<string, string> = {};
/** 手臂：苍白，腕环殷红。 */
const ARM: Record<string, string> = { s: 'i', t: 'j', y: 'R' };
/** 混天绫：黑红——殷红为主，下沿压成玄黑，末梢一点朱。 */
const SASH: Record<string, string> = { e: 'R', o: 'r', r: 'k' };
/** 风火轮：失了光的暗赭铜轮（哪吒的是金轮），好让黑焰从轮子上分得出来。 */
const WHEEL: Record<string, string> = { b: 'B', y: 'b', Y: 'y', B: 'k' };
/** 黑焰：焰尖玄黑、焰身紫棠、焰心朱砂（黑紫带红芯）。 */
const FLAME: Record<string, string> = { o: 'd', e: 'P', Y: 'e' };
/** 手里的黑焰乾坤圈：黛色的圈，一点朱砂的亮。 */
const RINGC: Record<string, string> = { y: 'g', Y: 'e', b: 'd', B: 'k' };
/** 同色系描边（同哪吒的做法，换成魔化后的颜色）。 */
const SELOUT: Record<string, string> = { j: 'h', i: 'h', R: 'k', r: 'R', P: 'k', p: 'P', B: 'k', b: 'B', g: 'k', h: 'g' };

function demonBody(hair: HairStyle): Grid {
  const rows = [...N.HAIR[hair].rows, ...N.BODY_LOWER];
  const out = rows.map((r, y) => [...r].map((c) => (y <= 12 ? HEAD : y <= 20 ? JACKET : LEGS)[c] ?? c));
  // 赤红的眼睛：细长的近眼，眼尾一点朱砂
  const eye = 5 + 3;
  out[eye][10] = 'R';
  out[eye][11] = 'e';
  return grid(out.map((r) => r.join('')));
}

// ---------- 新部件 ----------
// 手臂（相对哪吒的 32×31 画布，只画有色像素）
const ARM_UP: Layer = { g: grid(['..t', '..y', '.s.', 's..']), x: 21, y: 12 }; // 斜举到脸前（分身、施法）
const ARM_HOLD: Layer = { g: grid(['s.', 'sy', '.t']), x: 20, y: 17 }; // 端枪：手在腰侧
const ARM_THRUST: Layer = { g: grid(['sssyt']), x: 20, y: 18 }; // 前刺：整条胳膊伸直
const ARM_HANG: Layer = { g: grid(['s', 's', 'y', 't']), x: 20, y: 17 }; // 垂手
/** 黑色火尖枪（朝右）：一像素的玄黑枪身、殷红枪缨、火焰形枪头（暗红身、朱砂刃、橘色锋尖）。 */
const SPEAR = grid([
  '..............kR..',
  'gddddddddddRrkRreo',
  '..........rRRkRk..',
  '..........Rr......',
]);
const SPEAR_LONG = grid([
  '...............kRR...',
  'dddgddddddddddRrkRreo',
  '.............rRRkRRk.',
  '.............Rr......',
]);
/** 枪尖向下斜指地面（收枪）。 */
const SPEAR_DOWN = grid(['d.....', '.d....', '..d...', '...dR.', '...rRk', '....kR', '.....r']);

interface Spec {
  bob: number;
  lean: number;
  sashPhase: number;
  moving: boolean;
  wheel: number;
  flame: number;
  ring: 'hand' | 'behind' | 'released' | 'none';
  arm: 'idle' | 'throw' | 'follow' | 'up' | 'hold' | 'thrust' | 'hang' | 'none';
  spear?: 'hold' | 'thrust' | 'down';
  kneel?: boolean;
  flames?: 'long' | 'short' | 'out';
}

const ARMS: Record<Exclude<Spec['arm'], 'none'>, Layer> = {
  idle: N.ARM_IDLE,
  throw: N.ARM_THROW,
  follow: N.ARM_FOLLOW,
  up: ARM_UP,
  hold: ARM_HOLD,
  thrust: ARM_THRUST,
  hang: ARM_HANG,
};

function frame(s: Spec, hair: HairStyle): Grid {
  const sh = (l: Layer, dx = 0, dy = 0): Layer => ({ ...l, x: l.x + OX + s.lean + dx, y: l.y + OY + s.bob + dy });
  const sink = s.kneel ? 5 : 0;
  const under: Layer[] = [{ g: map(N.sash(s.sashPhase, s.moving, N.HAIR[hair].ribbon), SASH), x: OX + s.lean, y: OY + s.bob + sink }];
  if (s.ring === 'behind') under.push(sh({ g: map(N.RING_SPIN, RINGC), x: 6, y: 12 }, 0, sink));
  if (s.spear === 'hold') under.push(sh({ g: SPEAR, x: 8, y: 18 }));
  if (s.spear === 'down') under.push(sh({ g: SPEAR_DOWN, x: 21, y: 19 }));
  const body = demonBody(hair);
  const layers: Layer[] = [...under];
  if (!s.kneel) {
    layers.push({ g: map(N.WHEEL_BACK[s.wheel], WHEEL), x: 10 + OX, y: 27 + OY }, { g: map(N.WHEEL[(s.wheel + 1) % 2], WHEEL), x: 16 + OX, y: 27 + OY });
    layers.push({ g: body, x: N.BODY_X + OX + s.lean, y: N.BODY_Y + OY + s.bob });
  } else {
    // 跪倒：上身沉下去，双膝着地，风火轮倒在身后
    const top = grid(body.rows.slice(0, 21));
    layers.push({ g: map(N.WHEEL_BACK[0], WHEEL), x: 7 + OX, y: 28 + OY }, { g: map(N.WHEEL[1], WHEEL), x: 12 + OX, y: 28 + OY });
    layers.push({ g: top, x: N.BODY_X + OX + s.lean, y: N.BODY_Y + OY + sink });
    layers.push({ g: grid(['..kddddddddk', '.kddkkkddddk', '.kkkk..kkkk.']), x: N.BODY_X + OX + s.lean + 1, y: N.BODY_Y + OY + sink + 21 });
  }
  if (s.arm !== 'none') layers.push(sh({ ...ARMS[s.arm], g: map(ARMS[s.arm].g, ARM) }, 0, sink));
  if (s.spear === 'thrust') layers.push(sh({ g: SPEAR_LONG, x: 10, y: 17 }));
  const base = outline(compose(DEMON_W, DEMON_H, layers), 'k', SELOUT);

  const extra: Layer[] = [];
  if (s.flames !== 'out' && !s.kneel) {
    const long = s.flames === 'long' || s.moving;
    const fl = (long ? N.FLAME_LONG : N.FLAME).map((g) => map(g, FLAME));
    const fw = long ? 6 : 4;
    extra.push({ g: fl[s.flame % 3], x: 10 - fw + 1 + OX, y: 26 + OY }, { g: fl[(s.flame + 1) % 3], x: 16 - fw + 2 + OX, y: 27 + OY });
  }
  if (s.ring === 'hand') extra.push(sh({ g: map(N.RING, RINGC), x: 21, y: 19 }, 0, sink));
  if (s.ring === 'released') extra.push(sh({ g: map(N.RING_SPIN, RINGC), x: 25, y: 15 }));
  return compose(DEMON_W, DEMON_H, [{ g: base, x: 0, y: 0 }, ...extra]);
}

export type DemonPose = 'idle' | 'walk' | 'raise' | 'throw' | 'bare' | 'charge' | 'dash' | 'recover' | 'cast' | 'sweepUp' | 'sweep' | 'roar' | 'kneel';

export function makeDemonFrames(hair: HairStyle = DEFAULT_HAIR): Record<DemonPose, Grid[]> {
  const f = (s: Spec) => frame(s, hair);
  const four = (s: (i: number) => Spec) => [0, 1, 2, 3].map((i) => f(s(i)));
  const still = (i: number) => (i === 1 || i === 2 ? 1 : 0);
  return {
    idle: four((i) => ({ bob: still(i), lean: 0, sashPhase: i / 4, moving: false, wheel: 0, flame: i % 3, ring: 'hand', arm: 'idle' })),
    walk: four((i) => ({ bob: i % 2, lean: 1, sashPhase: i / 4, moving: true, wheel: i % 2, flame: i % 3, ring: 'hand', arm: 'idle' })),
    bare: four((i) => ({ bob: still(i), lean: 0, sashPhase: i / 4, moving: false, wheel: 0, flame: i % 3, ring: 'none', arm: 'idle' })),
    raise: [0, 1].map((i) => f({ bob: 1, lean: -1, sashPhase: 0.1 + i * 0.1, moving: false, wheel: 0, flame: i, ring: 'behind', arm: 'none' })),
    throw: [f({ bob: 0, lean: 1, sashPhase: 0.35, moving: false, wheel: 1, flame: 1, ring: 'released', arm: 'throw' })],
    charge: [0, 1].map((i) => f({ bob: 1, lean: -1, sashPhase: 0.15 + i * 0.12, moving: false, wheel: i, flame: i, ring: 'none', arm: 'hold', spear: 'hold', flames: 'long' })),
    dash: [0, 1].map((i) => f({ bob: 0, lean: 2, sashPhase: 0.5 + i * 0.25, moving: true, wheel: i, flame: i, ring: 'none', arm: 'thrust', spear: 'thrust', flames: 'long' })),
    recover: [0, 1].map((i) => f({ bob: 1, lean: 0, sashPhase: 0.7 + i * 0.1, moving: false, wheel: 0, flame: i, ring: 'none', arm: 'hang', spear: 'down' })),
    cast: [0, 1].map((i) => f({ bob: i, lean: 0, sashPhase: 0.2 + i * 0.25, moving: false, wheel: 0, flame: i, ring: 'none', arm: 'up', flames: 'long' })),
    sweepUp: [0, 1].map((i) => f({ bob: 1, lean: -1, sashPhase: 0.05 + i * 0.1, moving: false, wheel: 0, flame: i, ring: 'none', arm: 'up' })),
    sweep: [f({ bob: 0, lean: 2, sashPhase: 0.6, moving: true, wheel: 1, flame: 2, ring: 'none', arm: 'throw', flames: 'long' })],
    roar: [0, 1].map((i) => f({ bob: i, lean: -1, sashPhase: 0.3 + i * 0.3, moving: true, wheel: i, flame: i + 1, ring: 'none', arm: 'up', flames: 'long' })),
    kneel: [f({ bob: 0, lean: 1, sashPhase: 0.85, moving: false, wheel: 0, flame: 0, ring: 'none', arm: 'hang', kneel: true, flames: 'out' })],
  };
}

export const DEMON_FRAMES = makeDemonFrames();

/**
 * 可玩的魔化哪吒（回响化身）的人物帧：和首领同一套美术（本来就和哪吒一样大，不用另缩），按人物的几组姿势挑出来。
 * 他的专属法宝是脚下滚出去的黑焰轮，手里不拿乾坤圈：待机、跑都是空手（ring 'none'）。
 * 神通「火尖枪突进」三段：windup 端枪蓄力（首领的 charge）、throw 冲出去（dash）、follow 收枪（recover）；down 跪倒（kneel）。
 * 没画受击（hurt 用待机的帧，靠闪色）。键和 game/hero-views.ts 的 HeroPose 一一对应。
 */
export function makeMozhaFrames(hair: HairStyle = DEFAULT_HAIR): Record<'idle' | 'move' | 'idleBare' | 'moveBare' | 'windup' | 'throw' | 'follow' | 'hurt' | 'down', Grid[]> {
  const d = makeDemonFrames(hair);
  const f = (s: Spec) => frame(s, hair);
  const move = [0, 1, 2, 3].map((i) => f({ bob: i % 2, lean: 1, sashPhase: i / 4, moving: true, wheel: i % 2, flame: i % 3, ring: 'none', arm: 'idle' }));
  return { idle: d.bare, move, idleBare: d.bare, moveBare: move, windup: d.charge, throw: d.dash, follow: d.recover, hurt: d.bare, down: d.kneel };
}

// ---------- 招式精灵 ----------
type Px = string[][];
/** 沿一条曲线画一笔（连续的一像素线，不会断成散点）。color(t) 给出这一点的颜色（t 从 0 到 1），over：盖不盖住已有像素。 */
function stroke(rows: Px, fx: (t: number) => number, fy: (t: number) => number, color: (t: number) => string, over = false) {
  const S = rows.length;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = Math.round(fx(t));
    const y = Math.round(fy(t));
    if (x < 0 || y < 0 || x >= S || y >= S) continue;
    if (over || rows[y][x] === '.') rows[y][x] = color(t);
  }
}
/** 一条卷曲的黑焰：从半径 r0、角 a 处生出，向外伸 len 像素，同时顺着 curl 的方向往后卷；根部两像素粗。 */
function tongue(rows: Px, c: number, a: number, r0: number, len: number, curl: number, palette: string[]) {
  const col = (t: number) => palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
  const fx = (o: number) => (t: number) => c + Math.cos(a - curl * t * t + o * (1 - t)) * (r0 + len * t);
  const fy = (o: number) => (t: number) => c + Math.sin(a - curl * t * t + o * (1 - t)) * (r0 + len * t);
  stroke(rows, fx(0), fy(0), col);
  stroke(rows, fx(-0.16), fy(-0.16), (t) => (t < 0.45 ? col(t) : '.'), false);
}

/** 黑焰乾坤圈：外沿玄黑、圈身乌与黛（左上受光）、内沿殷红（黑焰的红芯，有三段更亮，随帧转动）；圈外卷着三条黑焰。 */
function blackRing(frameIdx: number): Grid {
  const S = 27;
  const c = 13;
  const rows: Px = Array.from({ length: S }, () => Array(S).fill('.'));
  const R1 = 9.6;
  const R0 = 6.9;
  const rot = (frameIdx / 4) * ((Math.PI * 2) / 3);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > R1 + 0.5 || d < R0 - 0.5) continue;
      const a = Math.atan2(y - c, x - c);
      const lit = Math.cos(a + 2.3); // 左上受光
      let ch = d > R1 - 0.55 ? 'k' : d < R0 + 0.45 ? 'R' : lit > 0.5 ? 'g' : 'd';
      if (ch === 'R') {
        const spin = Math.cos((a - rot) * 3);
        if (spin > 0.6) ch = 'r';
        if (spin > 0.93) ch = 'e';
      }
      rows[y][x] = ch;
    }
  for (let k = 0; k < 3; k++) tongue(rows, c, rot + (k * Math.PI * 2) / 3 + 0.5, R1 + 0.3, 3.4, 0.55, ['r', 'R', 'P', 'P', 'd']);
  return grid(rows.map((r) => r.join('')));
}
export const DEMON_RING = [0, 1, 2, 3].map(blackRing);

/** 风火轮（满场滚的火轮）：暗赭铜轮、四根轮辐、殷红轮毂；轮外八条卷曲的黑焰（根部朱砂、焰身紫棠、焰梢玄黑），四帧转过 45°。 */
function fireWheel(frameIdx: number): Grid {
  const S = 23;
  const c = 11;
  const rows: Px = Array.from({ length: S }, () => Array(S).fill('.'));
  const rot = (frameIdx / 4) * (Math.PI / 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 6.0) continue;
      const a = Math.atan2(y - c, x - c);
      let ch = '.';
      if (d > 5.1) ch = 'k';
      else if (d > 4.0) ch = Math.cos(a + 2.3) > 0.35 ? 'b' : 'B';
      else if (d < 1.6) ch = d < 0.6 ? 'e' : 'R';
      else {
        const sp = (((a - rot) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
        if (sp < 0.32 || sp > Math.PI / 2 - 0.32) ch = 'B';
      }
      if (ch !== '.') rows[y][x] = ch;
    }
  for (let k = 0; k < 8; k++) tongue(rows, c, rot + (k * Math.PI) / 4, 6.0, k % 2 ? 3.2 : 4.4, 0.7, ['e', 'R', 'P', 'P', 'd']);
  return grid(rows.map((r) => r.join('')));
}
export const DEMON_WHEEL = [0, 1, 2, 3].map(fireWheel);
