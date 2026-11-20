// 第二、三章过场镜头共用的小件（ch2/story-shots.ts、ch3/intro-shots.ts 用）：一粒粒的像素粒子、本机玩家的角色、
// 把精灵画成逆光的剪影 / 魂影、横着的晚霞云、能任意大小的阵台和阵旗。
// 只从 cutscene-shots.ts 拿类型（运行时不互相引用：cutscene-shots.ts 登记这些镜头）。
// 口径同别的镜头：颜色只用调色板里的；位置一律取整；不画发光的圆圈。
import { Container, Sprite, Texture } from 'pixi.js';
import { PALETTE } from '../art/palette.ts';
import type { Grid } from '../art/pixel.ts';
import { blank, put, valueNoise, mulberry32, type Bitmap } from '../art/cutscene/common.ts';
import { HERO_VIEWS, heroFrames } from './hero-views.ts';
import type { ShotKit } from './cutscene-shots.ts';

export const hex = (ch: string) => parseInt(PALETTE[ch].slice(1), 16);
export const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

/** 一粒一像素的粒子（尘、魂光、金屑）：按时间淡入淡出，横向带一点摆。add = 叠加（亮的光点）；不给就是普通混合（尘土）。 */
export class Motes {
  private list: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number; tw: number; sway: number; ph: number; drag: number; a: number }[] = [];
  readonly c = new Container();
  constructor(parent: Container, add = true) {
    if (add) this.c.blendMode = 'add';
    parent.addChild(this.c);
  }
  emit(x: number, y: number, vx: number, vy: number, life: number, color: string, o: { sway?: number; drag?: number; a?: number } = {}) {
    const s = new Sprite(Texture.WHITE);
    s.width = s.height = 1;
    s.tint = hex(color);
    this.c.addChild(s);
    this.list.push({ s, x, y, vx, vy, t: 0, life, tw: 2 + Math.random() * 2, sway: o.sway ?? 1.5, ph: Math.random() * 6, drag: o.drag ?? 0, a: o.a ?? 1 });
  }
  get count() {
    return this.list.length;
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.t += dt;
      if (m.drag) {
        const k = Math.exp(-dt * m.drag);
        m.vx *= k;
        m.vy *= k;
      }
      m.x += (m.vx + Math.sin(m.t * 0.9 + m.ph) * m.sway) * dt;
      m.y += m.vy * dt;
      if (m.t >= m.life) {
        m.s.destroy();
        this.list.splice(i, 1);
        continue;
      }
      const a = Math.sin((m.t / m.life) * Math.PI) * (0.6 + 0.4 * Math.sin(m.t * m.tw + m.ph));
      m.s.alpha = Math.max(0, a) * m.a;
      m.s.position.set(Math.round(m.x), Math.round(m.y));
    }
  }
}

/**
 * 本机玩家的角色（k.hero：哪吒、杨戬、赵公明……按角色表取帧，不写死是谁）：游戏里原尺寸的待机、跑的帧，锚点在脚底。
 * face：1 朝右（帧本来就朝右画）、-1 朝左（整体镜像，锚点在整像素上，镜像不走样）。
 */
export function heroActor(k: ShotKit, parent: Container, x: number, y: number, face: 1 | -1 = 1) {
  const view = HERO_VIEWS[k.hero];
  const f = heroFrames(k.hero);
  const idle = f.idle.map((g) => k.grid(g));
  const move = f.move.map((g) => k.grid(g));
  const s = new Sprite(idle[0]);
  s.anchor.set(view.anchor.x / view.w, view.anchor.y / view.h);
  s.scale.x = face;
  s.position.set(Math.round(x), Math.round(y));
  parent.addChild(s);
  return {
    s,
    /** 这一刻的帧：moving 跑、否则待机（待机 5 帧 / 秒、跑 10 帧 / 秒，同游戏）。 */
    pose(t: number, moving = false) {
      const fs = moving ? move : idle;
      s.texture = fs[Math.floor(t * (moving ? 10 : 5)) % fs.length];
    },
    at(px: number, py: number) {
      s.position.set(Math.round(px), Math.round(py));
    },
  };
}

/** 调色板颜色的亮度（0..1）。 */
const lum = (ch: string) => {
  const n = hex(ch);
  return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
};

/**
 * 逆光的剪影：整个人压成一片暗色（body），背光那一侧的轮廓亮一线（rim，光从 side 那边来：-1 左、1 右），
 * keep 里的颜色照原样留下（铜铃、金簪这种反光的小东西；眼里的魂光）。
 */
export function silhouette(g: Grid, side: -1 | 1, body: string, rim: string, keep: Record<string, string> = {}): Grid {
  const rows = g.rows.map((r) => [...r]);
  const out = rows.map((r) => r.map((c) => (c === '.' ? '.' : (keep[c] ?? body))));
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (rows[y][x] === '.' || keep[rows[y][x]]) continue;
      // 朝光的那一侧是空的：这一像素是轮廓，亮一线
      const nx = x + side;
      if (nx < 0 || nx >= g.w || rows[y][nx] === '.') out[y][x] = rim;
    }
  }
  return { w: g.w, h: g.h, rows: out.map((r) => r.join('')) };
}

/** 魂影（回响里重演的人）：按原来的明暗换成石青一路（暗 → 黛蓝，中 → 石青，亮 → 天青），表现层再压一点透明度。 */
export function ghostly(g: Grid): Grid {
  return {
    w: g.w,
    h: g.h,
    rows: g.rows.map((r) =>
      [...r]
        .map((c) => {
          if (c === '.') return '.';
          const v = lum(c);
          return v < 0.22 ? 'N' : v < 0.42 ? 'n' : v < 0.66 ? 'c' : 'C';
        })
        .join(''),
    ),
  };
}

/**
 * 横着的晚霞云（透明底，可平铺）：几条拉长的云带，下沿受光（落日在地平线下面，从下面照上来），上面压暗。
 * tones：[受光的下沿, 云身, 云顶 / 背光]；n 条；高 h。
 */
export function streakClouds(w: number, h: number, seed: number, n: number, tones: [string, string, string]): Bitmap {
  const b = blank(w, h);
  const rnd = mulberry32(seed);
  const edge = valueNoise(seed + 7, 9, w, 8, w);
  for (let i = 0; i < n; i++) {
    const cy = Math.round(3 + rnd() * (h - 8));
    const len = Math.round(w * (0.18 + rnd() * 0.26));
    const x0 = Math.round(rnd() * w);
    const th = 2 + rnd() * 3.2;
    for (let j = -len / 2; j <= len / 2; j++) {
      const u = (j / (len / 2)) ** 2; // 0 中间 … 1 两头
      const half = th * Math.sqrt(Math.max(0, 1 - u)) * (0.75 + 0.5 * edge(x0 + j, i));
      if (half < 0.6) continue;
      const top = Math.round(cy - half * 0.7);
      const bot = Math.round(cy + half * 0.5);
      const x = (((x0 + Math.round(j)) % w) + w) % w;
      for (let y = top; y <= bot; y++) put(b, x, y, y === bot ? tones[0] : y <= top + (half > 2 ? 1 : 0) ? tones[2] : tones[1]);
    }
  }
  return b;
}

/** 阵台（石台）的配色：台面、台面远沿受天光的一线、台面背光处、石壁（平时 / 受光 / 背光）、石缝、石壁前沿的一线、脚、台面嵌的一圈（没有就是刻槽）、正中的孔。 */
export interface DaisTones {
  top: string;
  rim: string;
  shade: string;
  wall: string;
  wallLit: string;
  wallDark: string;
  seam: string;
  lip: string;
  foot: string;
  inlay?: string;
  hole: string;
}
/** 第二章的阵台：灰紫石（同战场上的阵台，art/ch2/ground.ts）。 */
export const XIQI_STONE: DaisTones = { top: 'Q', rim: 'i', shade: 'h', wall: 'h', wallLit: 'Q', wallDark: 'g', seam: 'g', lip: 'i', foot: 'D', hole: 'd' };

/**
 * 阵台 / 剑台（侧面看过去）：两层的圆石台——下层宽一圈、矮一截；上层顶面是扁的椭圆、正面露出 side 像素高的石壁。
 * 石壁按朝向分明暗（光从 light 那边来：-1 左、1 右），一块块石头之间一道竖的石缝；台面的远沿受天光亮一线，台面一圈刻槽（或嵌金），正中一个孔。
 * 返回位图、台面正中（孔）在位图里的位置、脚底的那一行。
 */
export function daisBitmap(rx: number, ry: number, side: number, light: -1 | 1 = -1, tones: DaisTones = XIQI_STONE) {
  const R2 = rx + Math.max(3, Math.round(rx * 0.16));
  const ry2 = ry + 1;
  const side2 = Math.max(1, Math.round(side * 0.55));
  const W = R2 * 2 + 5;
  const H = ry + side + ry2 * 2 + side2 + 6;
  const b = blank(W, H);
  const cx = R2 + 2;
  const cy = ry + 2;
  const wallTone = (x: number, R: number) => {
    const s = (-light * x) / R; // < 0：朝光的那一侧
    return s < -0.55 ? tones.wallLit : s > 0.35 ? tones.wallDark : tones.wall;
  };
  /** 一层：台面中心 (cx, y0)、半径 (R, Ry)、石壁高 h。 */
  const tier = (y0: number, R: number, Ry: number, h: number, lipLine: boolean) => {
    const seams = Math.max(6, Math.round(R / 2.6));
    const seamX = new Set<number>();
    for (let k = 0; k < seams; k++) {
      const a = -Math.PI / 2 + ((k + 0.5) / seams) * Math.PI;
      seamX.add(Math.round(Math.sin(a) * R));
    }
    for (let x = -R; x <= R; x++) {
      const e = Math.sqrt(Math.max(0, 1 - (x / R) ** 2));
      const yTop = Math.round(y0 + Ry * e); // 台面的近沿
      for (let y = yTop + 1; y <= yTop + h; y++) {
        let ch = wallTone(x, R);
        if (y === yTop + h) ch = tones.foot;
        else if (y === yTop + 1 && lipLine && Math.abs(x) < R - 1) ch = tones.lip;
        else if (seamX.has(x) && y > yTop + 1) ch = tones.seam;
        put(b, cx + x, y, ch);
      }
    }
    for (let y = -Ry; y <= Ry; y++)
      for (let x = -R; x <= R; x++) {
        const d = (x / R) ** 2 + (y / Ry) ** 2;
        if (d > 1) continue;
        let ch = tones.top;
        const s = (-light * x) / R;
        if (y < 0 && d > 0.5) ch = tones.rim; // 远沿受天光
        else if (d > 0.6 && s * 0.7 + (y / Ry) * 0.5 > 0.42) ch = tones.shade;
        put(b, cx + x, y0 + y, ch);
      }
  };
  tier(cy + side, R2, ry2, side2, false); // 下层
  tier(cy, rx, ry, side, true); // 上层
  // 台面一圈刻槽 / 嵌金（断断续续）、正中的孔
  if (ry >= 3) {
    const n = Math.ceil(2 * Math.PI * rx);
    for (let i = 0; i < n; i++) {
      if (i % 6 === 5) continue;
      const a = (i / n) * Math.PI * 2;
      put(b, cx + Math.cos(a) * rx * 0.66, cy + Math.sin(a) * ry * 0.62, tones.inlay ?? tones.shade);
    }
  }
  put(b, cx, cy, tones.hole);
  if (rx > 8) put(b, cx + 1, cy, tones.hole);
  return { b, cx, cy, foot: cy + side + ry2 + side2 };
}

/**
 * 阵台投在地上的影子（透明底）：脚下一圈，再往背光的那一边（light 的反方向）拖长——黄昏、月夜的光都是斜的。
 * 返回位图和「阵台脚下正中」在位图里的位置。影子用一个颜色、半透明，尾巴按有序抖动淡掉。
 */
export function castShadow(rx: number, ry: number, len: number, light: -1 | 1 = -1, ch = 'g', alpha = 110) {
  const W = Math.round(rx * 2 + len + 8);
  const H = Math.round(ry * 2 + 8);
  const b = blank(W, H);
  const ox = light < 0 ? rx + 3 : W - rx - 4;
  const oy = Math.round(H / 2);
  const dir = -light;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - ox) * dir; // 往背光那边是正
      const dy = y - oy;
      const foot = (dx / (rx + 2)) ** 2 + (dy / (ry + 1.5)) ** 2 <= 1;
      // 尾巴越往外越窄（不抖动：抖动的过渡像纱窗）
      const u = clamp(dx / (len + rx));
      const half = (ry + 1) * (1 - u * u * 0.85);
      const tail = dx > 0 && dx < len + rx && Math.abs(dy) <= half;
      if (!foot && !tail) continue;
      put(b, x, y, ch, Math.round(alpha * (foot ? 1 : 1 - u * 0.45)));
    }
  return { b, ox, oy };
}

/**
 * 一面阵旗（任意大小，朝右飘）：赭色木杆、顶上一点金色杆头，杆子上端挂一面三角旗，自由边上下摆。
 * pole 杆高、flagW 旗面长、phase 0..1 摆动的相位、wind 0 平时（旗梢垂着轻轻摆）… 1 猎猎（绷直、抖得快）；cloth 旗面的两色 [面, 边]（褪了色的缟、银鼠）。
 * 锚点在杆脚 (1, pole - 1)。
 */
export function flagGrid(pole: number, flagW: number, phase: number, wind: number, cloth: [string, string] = ['j', 'i']): Grid {
  const W = flagW + 4;
  const rows = Array.from({ length: pole }, () => Array<string>(W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < W && y < pole) rows[y][x] = c;
  };
  set(1, 0, 'Y');
  set(1, 1, 'y');
  for (let y = 2; y < pole; y++) set(1, y, y % 4 === 0 ? 'b' : 'B');
  const H = Math.max(3, Math.round(flagW * (wind > 0.5 ? 0.85 : 1.05)));
  for (let r = 0; r < H; r++) {
    const k = r / (H - 1);
    const base = Math.round(flagW * (1 - k * 0.68));
    const amp = wind > 0.5 ? 1 : 0.6;
    const wave = Math.round(Math.sin(phase * Math.PI * 2 + r * (wind > 0.5 ? 1.4 : 0.8)) * amp);
    const len = Math.max(1, base + (r > 0 ? wave : 0));
    const droop = wind > 0.5 ? 0 : Math.round(Math.max(0, k - 0.4) * 1.5);
    for (let i = 0; i < len; i++) {
      const edge = i === len - 1 || r === H - 1;
      set(2 + i, 2 + r + (i === len - 1 ? droop : 0), edge ? cloth[1] : (i + r + Math.round(phase * 4)) % 5 === 0 ? cloth[1] : cloth[0]);
    }
  }
  return { w: W, h: pole, rows: rows.map((r) => r.join('')) };
}

/** 地上刻的一圈阵纹（扁的椭圆，近大远小）：断断续续的像素点，返回相对圆心的位置（地面位图刻槽、阵亮起来时的光用同一份）。 */
export function ringPixels(rx: number, ry: number, seed: number, keep = 0.75): [number, number][] {
  const rnd = mulberry32(seed);
  const out: [number, number][] = [];
  const seen = new Set<number>();
  const n = Math.ceil(2 * Math.PI * rx * 1.2);
  for (let i = 0; i < n; i++) {
    if (rnd() > keep) continue;
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * rx);
    const y = Math.round(Math.sin(a) * ry);
    const key = (y + 512) * 1024 + x + 512;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y]);
  }
  return out;
}

/** 飞在风里的那一角封神榜残页（远了，很小；第二章收尾、第三章开场）：平的、斜的、侧过来的几帧。 */
export const PAGE_FLY: Grid[] = [
  { w: 6, h: 4, rows: ['UUUUb.', 'UyyyyB', 'UyByb.', 'Ubbb..'] },
  { w: 5, h: 5, rows: ['..UUb', '.UyyB', 'UyByb', 'Uybb.', 'bb...'] },
  { w: 6, h: 2, rows: ['UYyyyb', '.bbbb.'] },
  { w: 5, h: 5, rows: ['bUU..', 'ByyU.', 'byByU', '.bbyU', '...bb'] },
];

