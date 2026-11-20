// 第二章地形「十阵轮转」的画面：十座阵台上的阵旗、十种阵亮起来的样子、阵里出的招（预警是地上的淡红光）、金光阵边冒兵、红水 / 化血掉血的跳字。
// 只读模拟状态（w.terrain，见 sim/ch2/terrain.ts）和事件（TerrainEvent），不回写模拟。
// 十种阵一眼分得清（颜色、地上的样子、招的样子都不同；颜色相近的红水 / 化血 / 烈焰 / 红沙 / 地烈靠形状分开）：
//   天绝「雷纹」淡紫的雷光、电弧，紫白的天雷；      地烈「岩火」赭橙的地纹，阵心往外裂开的地缝喷岩火；
//   风吼「青风」淡青的风纹绕着转，风刃扫过扇面；      寒冰「寒霜」冰蓝的霜，地下冒出的冰锥；
//   金光「金色符光」金色呼吸、往上飘的光点和小符；    化血「血雾」暗红发紫的雾，一团团地翻；
//   烈焰「火」橙红的热气，窜起的火柱和烧地的火苗；    落魂「魂火」惨绿的阴雾，从阵边飘出来追人的鬼火；
//   红水「红水波」暗红的水，一圈圈涟漪；              红沙「沙暴」赭红的沙一圈圈往阵心旋，阵心的沙眼。
// 预警（阵要亮了，约 2 秒）：阵旗猎猎、染上这一阵的颜色，地纹由暗到亮。阵纹的外圈（阵的边界）只淡淡地亮，不画发光的圆圈。
// 招的预警都是 warn-fx 的淡红光（形状就是判定）：圆（天雷、冰锥、火柱、魂火、沙眼）、长条（地缝）、扇面（风刃）。
// 用户口径：克制、不要光圈、不要硬直线的框、出现消失都有过程。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { DamageNumbers, Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { once, textureFromBitmap, textureFromGrid } from '../../render/textures.ts';
import { FLAG, FLAG_ANCHOR, FLAG_H, FLAG_W } from '../../art/ch2/decor.ts';
import { siteGlyph } from '../../art/ch2/ground.ts';
import { DAIS_AX, DAIS_AY, DAIS_H, DAIS_W, daisArt, flamePillar, flameTongue, iceSpike, soulWisp } from '../../art/ch2/formations.ts';
import { recolor } from '../../art/sprites/foe-kit.ts';
import { grid } from '../../art/pixel.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { TEN } from '../../sim/ch2/config.ts';
import { inSite, tenOf } from '../../sim/ch2/terrain.ts';
import type { SiteKind, Strike, StrikeKind } from '../../sim/ch2/types.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { boltGrid } from '../technique-fx.ts';
import { PixelFxLayer, prebake, type FxHandle } from '../../render/pixelfx.ts';
import { XFX } from '../../render/pixelfx-xianxia.ts';
import { DiskWarn, LaneWarn, SweepWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k * k * (3 - 2 * k);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

interface Look {
  glyph: number; // 阵纹亮起来的颜色
  flag: number; // 阵旗染的色
  motes: number[]; // 粒子
  add: boolean; // 阵纹用叠加（亮光）还是普通混合（暗色的阵：红水、化血、红沙）
  on: string; // 亮起来时的声音
}
/** 每种阵的颜色、声音。十种颜色放在黄昏的黄土地上都看得清、彼此分得开。 */
export const LOOK: Record<SiteKind, Look> = {
  thunder: { glyph: 0xc8a8f0, flag: 0xd8c8ff, motes: [0xffffff, 0xd47aa0, 0xc8a8f0], add: true, on: 'ten.thunder.on' },
  quake: { glyph: 0xe8873a, flag: 0xf0b070, motes: [0xf2814a, 0xe0a83a, 0xd9452b], add: true, on: 'dinghai.quake' },
  wind: { glyph: 0xa8e8dc, flag: 0xd8f6f0, motes: [0xe8fff8, 0xa8e8dc, 0x7cc4c4], add: true, on: 'dingfeng.whirl' },
  ice: { glyph: 0xa8d4f4, flag: 0xe4f2ff, motes: [0xffffff, 0xc3ccd2, 0x9cc8e8], add: true, on: 'hanbing.frost' },
  gold: { glyph: 0xf7dc7a, flag: 0xfff0b0, motes: [0xf7dc7a, 0xffe9a8, 0xe0a83a], add: true, on: 'ten.gold' },
  blood: { glyph: 0x8c2238, flag: 0xd86a7c, motes: [0x9c2a22, 0x5c1a1b, 0x8a4a7a], add: false, on: 'huaxue.mist' },
  fire: { glyph: 0xf2702a, flag: 0xffb878, motes: [0xf2814a, 0xf7dc7a, 0xd9452b], add: true, on: 'wuhuo.scorch' },
  soul: { glyph: 0x9ee8a8, flag: 0xd8f8d0, motes: [0xb8d67a, 0x6fa35a, 0xe8ffe0], add: true, on: 'yao.vanish' },
  water: { glyph: 0xd9452b, flag: 0xf0a090, motes: [0xd9452b, 0x9c2a22, 0xf2814a], add: false, on: 'ten.water' },
  sand: { glyph: 0x9a4a30, flag: 0xf0b890, motes: [0xd08a64, 0xb06a28, 0x8a4f3c], add: false, on: 'xuanyuan.vortex' },
};
/** 阵旗平时的颜色：褪了色的暖灰。 */
const FLAG_IDLE = 0xd2c4bc;
/** 十阵用到的 pixelfx 预设：[烘焙的 key, XFX 里的名字, 改的选项]。 */
const PFX: [string, string, Record<string, unknown>][] = [
  ['ten:zap', 'zapHitViolet', {}],
  ['ten:slam', 'sealSlam', { reach: 16 }],
];
/** 阵台平时压暗一点（安静、暗），亮起来回到原色。 */
const DAIS_IDLE = 0xb4aaa8;

interface DaisTex { idle: Texture[]; flutter: Texture[]; litIdle: Texture[]; litFlutter: Texture[]; flagAt: [number, number] | null }
/** 一座阵台的纹理（按阵的种类，模块级缓存）。 */
function daisTex(kind: SiteKind): DaisTex {
  return once(`ch2:dais:${kind}`, () => {
    const a = daisArt(kind);
    return { idle: a.idle.map(textureFromGrid), flutter: a.flutter.map(textureFromGrid), litIdle: a.litIdle.map(textureFromGrid), litFlutter: a.litFlutter.map(textureFromGrid), flagAt: a.flag ? a.flagAt : null };
  });
}

// ---------- 纹理 ----------

/** 第 i 座阵的阵纹（白色，按需着色）：glyph 里面的爻纹、内圈、辐条；rim 外圈。纹理中心就是阵台中心。 */
function glyphTex(i: number): { glyph: Texture; rim: Texture; c: number } {
  return once(`ch2:glyph:${i}:${TEN.r}`, () => {
    const c = TEN.r + 2;
    const S = c * 2 + 1;
    const mk = (part: 'rim' | 'glyph') => {
      const data = new Uint8ClampedArray(S * S * 4);
      for (const q of siteGlyph(i, TEN.r, TEN.dais)) if (q.part === part) data.set([255, 255, 255, 255], ((q.y + c) * S + q.x + c) * 4);
      return textureFromBitmap({ w: S, h: S, data });
    };
    return { glyph: mk('glyph'), rim: mk('rim'), c };
  });
}

/** 0..1 的平滑值噪声（表现层用，确定性：同样的坐标每次一样）。 */
function noise(x: number, y: number, seed: number) {
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
  const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
  return a + (b - a) * sy;
}

type Rgb = [number, number, number];
const mix3 = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/**
 * 一片铺在阵里的「雾 / 霜 / 热气」（三帧，浓淡慢慢挪）：半径约 TEN.r，中间浓、往外平滑地淡没（最外 8 像素），边不是正圆；
 * 浓淡是几层低频噪声（一团一团的，不是匀匀的一块圆）。dark → lite 是颜色从浓处到淡处；alpha 是最浓处的不透明度。
 */
function cloudTex(key: string, dark: Rgb, lite: Rgb, alpha: number, scale: number, seed: number, hole = 0): Texture[] {
  return once(`ch2:cloud:${key}:${TEN.r}`, () => {
    const R = TEN.r;
    const S = (R + 3) * 2 + 1;
    const C = R + 3;
    return [0, 1, 2].map((f) => {
      const data = new Uint8ClampedArray(S * S * 4);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = x - C;
          const dy = y - C;
          const a = Math.atan2(dy, dx);
          const edge = R + 1.5 * Math.sin(a * 3 + f * 0.6 + seed) + Math.sin(a * 5 + 1.3 - f * 0.4);
          const d = Math.hypot(dx, dy);
          if (d > edge) continue;
          const fade = ease(clamp01((edge - d) / 8)) * (hole ? ease(clamp01((d - hole) / 6)) : 1);
          const n = noise(x / scale + f * 0.35, y / scale - f * 0.2, seed) * 0.65 + noise(x / (scale * 0.45) - f * 0.5, y / (scale * 0.45), seed + 3) * 0.35;
          const dens = clamp01(0.3 + (n - 0.5) * 1.3) * (0.55 + 0.45 * (1 - d / edge)); // 浓淡起伏平缓、中间浓一点（不是一块块的斑）
          if (dens <= 0.02) continue;
          const c = mix3(lite, dark, dens);
          data.set([Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(255 * alpha * fade * (0.35 + 0.65 * dens))], (y * S + x) * 4);
        }
      return textureFromBitmap({ w: S, h: S, data });
    });
  });
}

/**
 * 红水（三帧，水面的波光挪一挪）：半径约 TEN.r 的一片暗红的水，中间深（殷）、往外渐浅（朱），边缘不是正圆、微微起伏，
 * 最外 6 像素平滑地淡出（不描边、不抖动成纱窗）；水面零星几道亮的波光（橘、朱砂的短横）。
 */
function waterTex(): Texture[] {
  return once(`ch2:water:${TEN.r}`, () => {
    const R = TEN.r;
    const S = (R + 3) * 2 + 1;
    const C = R + 3;
    return [0, 1, 2].map((f) => {
      const data = new Uint8ClampedArray(S * S * 4);
      const deep = [92, 26, 27];
      const mid = [156, 42, 34];
      const lite = [190, 58, 38];
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = x - C;
          const dy = y - C;
          const a = Math.atan2(dy, dx);
          const edge = R + 1.2 * Math.sin(a * 3 + f * 0.7) + 0.8 * Math.sin(a * 5 + 1.3 - f * 0.5);
          const d = Math.hypot(dx, dy);
          if (d > edge) continue;
          const fade = ease(clamp01((edge - d) / 6));
          const k = clamp01(d / edge);
          const c = k < 0.6 ? deep.map((v, n) => v + (mid[n] - v) * (k / 0.6)) : mid.map((v, n) => v + (lite[n] - v) * ((k - 0.6) / 0.4));
          data.set([...c.map(Math.round), Math.round(255 * fade)], (y * S + x) * 4);
        }
      // 波光：几道短横，每一帧挪一点
      const glints = 14;
      for (let g = 0; g < glints; g++) {
        const ang = g * 2.39996 + f * 0.31;
        const rr = (R - 8) * Math.sqrt(((g * 0.618 + f * 0.13) % 1) * 0.85 + 0.1);
        const gx = Math.round(C + Math.cos(ang) * rr);
        const gy = Math.round(C + Math.sin(ang) * rr * 0.9);
        const len = 2 + ((g + f) % 2);
        for (let i = 0; i < len; i++) {
          const idx = (gy * S + gx + i) * 4;
          if (data[idx + 3] < 200) continue;
          data.set(i === 0 && g % 3 === 0 ? [242, 129, 74, 255] : [217, 69, 43, 255], idx);
        }
      }
      return textureFromBitmap({ w: S, h: S, data });
    });
  });
}

/** 金光阵地上一层极淡的金色：中间稍亮、往外平滑地淡没，带一点云絮似的浓淡（不是匀匀的一块圆）；叠加混合，只让黄土泛一点金。 */
function goldTex(): Texture {
  return once(`ch2:goldlight:${TEN.r}`, () => {
    const R = TEN.r;
    const S = R * 2 + 1;
    const data = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - R, y - R) / R;
        if (d > 1) continue;
        const cloud = 0.75 + 0.25 * Math.sin(x * 0.31 + Math.sin(y * 0.23) * 2) * Math.cos(y * 0.27 - x * 0.11);
        const a = (1 - d) ** 1.4 * cloud;
        data.set([255, 214, 128, Math.round(255 * clamp01(a))], (y * S + x) * 4);
      }
    return textureFromBitmap({ w: S, h: S, data });
  });
}

/**
 * 旋涡（白色，按需着色）：arms 条旋臂从外往里绕（螺旋 r = R·e^(−θ·tight)），每条臂是一串断断续续的短弧、越往里越细越淡；
 * 风吼阵（往外吹，两层反着转）和红沙阵（沙往阵心旋）、沙眼共用。纹理中心是旋涡中心。
 */
function swirlTex(R: number, arms: number, tight: number, seed: number): Texture {
  return once(`ch2:swirl:${R}:${arms}:${tight}:${seed}`, () => {
    const S = R * 2 + 3;
    const C = R + 1;
    const data = new Uint8ClampedArray(S * S * 4);
    for (let arm = 0; arm < arms; arm++) {
      const a0 = (arm / arms) * TAU + seed;
      for (let th = 0; th < 9; th += 0.012) {
        const r = R * Math.exp(-th * tight);
        if (r < 3) break;
        // 断断续续：按角度分段，一段亮一段空
        if (noise(th * 2.2 + arm * 7, arm, seed) < 0.42) continue;
        const a = a0 + th;
        const x = Math.round(C + Math.cos(a) * r);
        const y = Math.round(C + Math.sin(a) * r * 0.86);
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const fadeOut = ease(clamp01((R - r) / 6)); // 最外一截淡入
        const al = Math.round(255 * fadeOut * (0.35 + 0.65 * (r / R)));
        const idx = (y * S + x) * 4;
        if (data[idx + 3] < al) data.set([255, 255, 255, al], idx);
      }
    }
    return textureFromBitmap({ w: S, h: S, data });
  });
}

/** 天雷落地的焦痕（扁的、贴地）和星芒；火柱烧过的焦痕；冰锥退下去留的一片霜。 */
const SCORCH = grid(['...PP.PP...', '.PPggPggPP.', 'PggkkkkkggP', '.PggkkkggP.', '...PPgPP...']);
const IMPACT = grid(['...W...', '...m...', '.m.W.m.', 'WmWWWmW', '.m.W.m.', '...m...', '...W...']);
const BURNT = grid(['..DD.DDD...', '.DgggDggDD.', 'DggkkggkgD.', '.DgkkkkggDD', '..DDgggDD..']);
const FROST = grid(['..Z.ZZ..Z..', '.ZJZZJZZJZ.', 'ZJZZwZZJZZZ', '.ZZJZZJZZJ.', '...Z.ZZ.Z..']);
/** 金光阵里往上飘的小符（两帧）。 */
const TALIS = [grid(['YY', 'Yr', 'YY']), grid(['Yf', 'rY', 'YY'])];

// ---------- 画面对象 ----------

interface SiteView {
  i: number;
  kind: SiteKind;
  c: Container;
  glyph: Sprite;
  rim: Sprite;
  fill: Sprite | null; // 红水 / 金光 / 化血 / 落魂 / 寒冰 / 烈焰 / 地烈的底
  swirl: Sprite[]; // 风吼、红沙的旋涡（一两层，各转各的）
  arcs: Graphics | null; // 天绝阵的电弧、红水的涟漪
  t: number; // 出现了多久
  gone: number; // -1 = 还在；否则是熄了多久
  fx: number; // 距下一次电弧 / 涟漪 / 小符
  ripples: { x: number; y: number; t: number; life: number }[];
  sparks: { pts: [number, number][]; t: number; life: number }[];
}

/** 一招的画面：预警（淡红光）+ 落下之后的样子。 */
interface StrikeView {
  id: number;
  kind: StrikeKind;
  site: number;
  warn: DiskWarn | LaneWarn | SweepWarn;
  t: number;
  t2: number;
  live: number;
  struck: boolean;
  gone: boolean; // 状态里已经没有了（在淡出）
  // 落下之后
  x: number;
  y: number;
  x1: number;
  y1: number;
  r: number;
  a0: number;
  arc: number;
  dir: 1 | -1;
  st: number; // 落下之后多久
  g: Graphics | null; // 地缝、风刃
  s: Sprite | null; // 火柱、魂火、沙眼
  bits: { s: Sprite; ph: number; dx: number; dy: number }[]; // 烧地的小火苗
  crack: [number, number][]; // 地缝的折线
}

interface Fading {
  s: Sprite;
  t: number;
  life: number;
  a0: number;
  vy?: number;
  grow?: number; // 冰锥：前 grow 秒从地里拱出来（scale.y 0 → 1）
  own?: boolean; // 纹理是这一个精灵自己的（每道天雷的形状都不一样）：淡完连纹理一起销毁，不留在显存里
}

export class TerrainFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private numbers: DamageNumbers | null;
  private warns: WarnLayer;
  private ground = new Container(); // 阵亮起来的样子（地面层的最底下，压在影子、预警之下）
  private air = new Container();
  /** 十座阵台：台子（平时暗、亮起来提亮）、叠加的光、旁边插的小阵旗（幡类没有）。 */
  private daises: { base: Sprite; lit: Sprite; flag: Sprite | null; tex: DaisTex; ph: number; tint: number }[] = [];
  private views = new Map<number, SiteView>();
  private strikes = new Map<number, StrikeView>();
  private fading: Fading[] = [];
  private flagTex = { idle: FLAG.idle.map(textureFromGrid), flutter: FLAG.flutter.map(textureFromGrid) };
  private scorchTex = textureFromGrid(SCORCH);
  private impactTex = textureFromGrid(IMPACT);
  private burntTex = textureFromGrid(BURNT);
  private frostTex = textureFromGrid(FROST);
  private talisTex = TALIS.map(textureFromGrid);
  private spikeTex = [0, 1, 2].map((s) => textureFromGrid(iceSpike(15, 16, s)));
  private pillarTex = [0, 1, 2, 3].map((f) => textureFromGrid(flamePillar(f)));
  private tongueTex = [0, 1, 2].map((f) => textureFromGrid(flameTongue(f)));
  private wispTex = [0, 1, 2].map((f) => textureFromGrid(soulWisp(f)));
  private time = 0;
  /** 修仙版 pixelfx（开局在后台预烘焙；没烘好、或同屏太多就不放，只留原来的画法）：天雷落点的紫电、地裂阵心崩开的砸地。 */
  private pfxTop: PixelFxLayer;
  private pfxLow: PixelFxLayer;
  private pfxLive: FxHandle[] = [];
  private pfxReady = new Set<string>();
  private lastQuake = -9;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, numbers?: DamageNumbers) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.numbers = numbers ?? null;
    this.warns = warnLayer(stage);
    const pr = PLAYER.radius;
    warmWarnTextures({
      disks: [TEN.thunder.r + pr, TEN.ice.r + pr, TEN.fire.r + pr, TEN.soul.r + pr, TEN.sand.eye + pr],
      lanes: [TEN.quake.hw + pr],
      sweeps: [[TEN.r + pr, pr - 1, TEN.wind.arc]],
    });
    stage.floor.addChildAt(this.ground, 0);
    stage.fx.addChild(this.air);
    for (let i = 0; i < TEN.sites.length; i++) glyphTex(i);
    for (const k of TEN.kinds) this.fillOf(k);
    this.pfxTop = new PixelFxLayer(stage.fx);
    this.pfxLow = new PixelFxLayer(stage.floor);
    void (async () => {
      for (const [key, name, extra] of PFX) {
        try {
          await prebake(key, XFX[name].id, { ...XFX[name].opts, ...extra });
          this.pfxReady.add(key);
        } catch (e) {
          console.warn('十阵 pixelfx 预烘焙失败', key, e);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
  }

  /** 放一个预烘焙的修仙版特效（同屏最多 6 个）。 */
  private pfx(low: boolean, key: string, name: string, x: number, y: number) {
    if (!this.pfxReady.has(key)) return;
    this.pfxLive = this.pfxLive.filter((h) => !h.done);
    if (this.pfxLive.length >= 6) return;
    const extra = PFX.find((q) => q[0] === key)![2];
    this.pfxLive.push((low ? this.pfxLow : this.pfxTop).playBaked(key, XFX[name].id, { ...XFX[name].opts, ...extra }, { x, y, flip: Math.random() < 0.5 }));
  }

  /** 清掉亮着的阵和招的画面（重开一局）。阵旗跟着地形走，地形没了才拿掉。 */
  clear() {
    this.pfxTop.clear();
    this.pfxLow.clear();
    this.pfxLive = [];
    for (const v of this.views.values()) v.c.destroy({ children: true });
    this.views.clear();
    for (const s of this.strikes.values()) this.dropStrike(s);
    this.strikes.clear();
    for (const f of this.fading) f.s.destroy(f.own ? { texture: true, textureSource: true } : undefined);
    this.fading = [];
  }

  private dropFlags() {
    for (const d of this.daises) {
      d.base.destroy();
      d.lit.destroy();
      d.flag?.destroy();
    }
    this.daises = [];
  }

  private dropStrike(v: StrikeView) {
    v.warn.destroy();
    v.g?.destroy();
    v.s?.destroy();
    for (const b of v.bits) b.s.destroy();
  }

  /** 这一阵铺在地上的那一片（没有就是 null）：纹理（几帧）、混合、最浓时的透明度。 */
  private fillOf(k: SiteKind): { tex: Texture[]; add: boolean; alpha: number } | null {
    switch (k) {
      case 'water':
        return { tex: waterTex(), add: false, alpha: 0.62 };
      case 'gold':
        return { tex: [goldTex()], add: true, alpha: 0.22 };
      case 'blood': // 暗红发紫的雾，一团一团（比红水暗、偏紫，和红水的亮朱砂分得开）
        return { tex: cloudTex('blood', [86, 22, 36], [140, 50, 74], 0.7, 24, 1), add: false, alpha: 1 };
      case 'soul': // 惨绿的阴雾（叠加，只让地泛一层冷绿）
        return { tex: cloudTex('soul', [150, 230, 160], [80, 150, 100], 0.5, 26, 2), add: true, alpha: 0.5 };
      case 'ice': // 地上结的霜：霜白到冰蓝，一片一片
        return { tex: cloudTex('ice', [226, 238, 246], [150, 190, 220], 0.62, 14, 3), add: false, alpha: 0.7 };
      case 'fire': // 热气：橘红，叠加，浓淡一团团地挪
        return { tex: cloudTex('fire', [255, 150, 70], [210, 70, 40], 0.5, 24, 4), add: true, alpha: 0.34 };
      case 'quake': // 赭色的尘、往外泛一点岩火的红（地缝自己画）
        return { tex: cloudTex('quake', [120, 70, 34], [176, 106, 40], 0.42, 18, 5, 8), add: false, alpha: 0.75 };
      case 'sand': // 红沙：赭红的沙雾（上面再叠旋涡）
        return { tex: cloudTex('sand', [138, 79, 60], [208, 138, 100], 0.55, 20, 6), add: false, alpha: 0.8 };
      default:
        return null;
    }
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'siteWarn': {
        this.view(e.site, e.kind);
        this.sfx.play('ten.warn'); // 阵旗猎猎、低鼓滚起来（十种阵同一声；亮起来时各有各的）
        break;
      }
      case 'siteOn': {
        const v = this.view(e.site, e.kind);
        v.t = Math.max(v.t, TEN.warn);
        const [x, y] = TEN.sites[e.site];
        this.glows.emit(x, y - 4, 12, LOOK[e.kind].motes, [20, 50], [0.5, 0.9], { up: 14, drag: 2 });
        this.sfx.play(LOOK[e.kind].on);
        break;
      }
      case 'siteOff': {
        const v = this.views.get(e.site);
        if (v && v.gone < 0) v.gone = 0;
        break;
      }
      case 'tenWarn': {
        const s = tenOf(w)?.strikes.find((q) => q.id === e.id);
        if (s) this.strikeView(s);
        if (e.kind === 'bolt') this.sfx.play('ten.bolt.warn');
        break;
      }
      case 'tenStrike': {
        const v = this.strikes.get(e.id);
        if (v && !v.struck) {
          v.struck = true;
          v.warn.strike();
          // 一下就完的招：红光跟着淡掉；持续的（烧地、沙眼、风刃、魂火）在 update 里按状态收
          if (e.kind === 'bolt' || e.kind === 'fissure' || e.kind === 'spike') v.warn.end(0.35);
        }
        this.land(e.kind, e.x, e.y, e.x1, e.y1, e.r, v ?? null);
        break;
      }
      case 'tenFade': {
        const v = this.strikes.get(e.id);
        if (v && !v.gone) this.fadeStrike(v);
        break;
      }
      case 'siteSpawn': {
        // 回响兵从金光阵边的地里冒出来：一蓬黄土、几粒金光
        this.sparks.emit(e.x, e.y - 1, 10, [0xa48e6d, 0x958064, 0xbba684], [20, 50], [0.3, 0.6], { up: 18, g: 60, drag: 2 });
        this.glows.emit(e.x, e.y - 6, 6, LOOK.gold.motes, [10, 30], [0.4, 0.7], { up: 16 });
        this.sfx.play('ten.spawn');
        break;
      }
      case 'drain': {
        if (e.dmg >= 0.5) {
          this.numbers?.spawn(e.x + rnd(-4, 4), e.y - 30, Math.max(1, Math.round(e.dmg)), 'corrode');
          this.sparks.emit(e.x, e.y - 4, 3, e.kind === 'blood' ? LOOK.blood.motes : LOOK.water.motes, [10, 25], [0.3, 0.5], { up: 10, drag: 2 });
        }
        break;
      }
    }
  }

  /** 一招开始预警：地上的淡红光（形状就是判定）。 */
  private strikeView(s: Strike) {
    if (this.strikes.has(s.id)) return;
    const pr = PLAYER.radius;
    const warn =
      s.kind === 'fissure'
        ? new LaneWarn(this.warns, s.x, s.y, s.x1, s.y1, s.r + pr, 0)
        : s.kind === 'gust'
          ? new SweepWarn(this.warns, s.x, s.y, s.r + pr, s.a0, s.dir, pr - 1, s.arc)
          : new DiskWarn(this.warns, s.x, s.y, s.r + pr);
    const v: StrikeView = {
      id: s.id, kind: s.kind, site: s.site, warn, t: s.t, t2: s.warn, live: s.live, struck: false, gone: false,
      x: s.x, y: s.y, x1: s.x1, y1: s.y1, r: s.r, a0: s.a0, arc: s.arc, dir: s.dir, st: 0, g: null, s: null, bits: [], crack: [],
    };
    // 魂火：预警的时候就从阵边的地里慢慢冒出来（还小、还淡）
    if (s.kind === 'wisp') {
      v.s = new Sprite(this.wispTex[0]);
      v.s.anchor.set(0.5, 1);
      v.s.alpha = 0;
      v.s.blendMode = 'add';
      this.air.addChild(v.s);
    }
    this.strikes.set(s.id, v);
  }

  private fadeStrike(v: StrikeView) {
    v.gone = true;
    v.warn.end(0.3);
    if (v.kind === 'wisp' && v.s) this.glows.emit(v.s.x, v.s.y - 5, 8, LOOK.soul.motes, [10, 35], [0.35, 0.7], { up: 14, drag: 2 });
  }

  /** 招落下的那一下。 */
  private land(kind: StrikeKind, x: number, y: number, x1: number, y1: number, r: number, v: StrikeView | null) {
    switch (kind) {
      case 'bolt':
        return this.bolt(x, y);
      case 'fissure': {
        // 地缝：从阵心往外一道锯齿的裂口，缝里的岩火由亮转暗；沿缝喷起火星和尘
        if (!v) return;
        const len = Math.hypot(x1 - x, y1 - y);
        const ux = (x1 - x) / (len || 1);
        const uy = (y1 - y) / (len || 1);
        const pts: [number, number][] = [];
        for (let d = 0; d <= len; d += 3) {
          const j = d === 0 || d + 3 > len ? 0 : rnd(-1.6, 1.6) * Math.min(1, d / 10);
          pts.push([x + ux * d - uy * j, y + uy * d + ux * j]);
        }
        v.crack = pts;
        v.g = new Graphics();
        this.stage.floor.addChild(v.g);
        for (let k = 0; k < 7; k++) {
          const d = rnd(0, len);
          this.sparks.emit(x + ux * d, y + uy * d - 1, 3, LOOK.quake.motes, [30, 80], [0.3, 0.6], { up: 40, g: 140, drag: 1.5 });
        }
        this.sparks.emit((x + x1) / 2, (y + y1) / 2, 6, [0x958064, 0x6b5749, 0xa48e6d], [20, 50], [0.4, 0.7], { up: 20, g: 80, drag: 2 });
        // 阵心崩开（一轮几道地缝只放一次）：修仙版砸地，收小到阵心那一块
        if (this.time - this.lastQuake > 0.5) {
          this.lastQuake = this.time;
          const [qx, qy] = TEN.sites[v.site];
          this.pfx(true, 'ten:slam', 'sealSlam', qx, qy + 2);
        }
        this.shake.add(0.08);
        this.sfx.play('zone.crack');
        break;
      }
      case 'gust': {
        if (!v) return;
        v.g = new Graphics();
        v.g.blendMode = 'add';
        this.air.addChild(v.g);
        this.sfx.play('dingfeng.gust');
        break;
      }
      case 'spike': {
        // 冰锥从地里拱出来（0.12 秒），立一会儿，碎成冰屑；地上留一片霜慢慢化
        const s = new Sprite(this.spikeTex[Math.floor(Math.random() * 3)]);
        s.anchor.set(0.5, 1);
        s.position.set(Math.round(x), Math.round(y + 3));
        s.scale.y = 0;
        this.stage.entities.addChild(s);
        s.zIndex = y + 3;
        this.fading.push({ s, t: 0, life: 0.95, a0: 1, grow: 0.12 });
        const fr = new Sprite(this.frostTex);
        fr.anchor.set(5 / 11, 2 / 5);
        fr.position.set(Math.round(x), Math.round(y + 1));
        this.stage.floor.addChild(fr);
        this.fading.push({ s: fr, t: 0, life: 1.6, a0: 0.55 });
        this.sparks.emit(x, y - 2, 5, LOOK.ice.motes, [20, 60], [0.3, 0.55], { up: 26, g: 120, drag: 2 });
        this.sfx.play('hanbing.spike');
        break;
      }
      case 'pillar': {
        // 火柱：一股三昧真火窜起来（约 0.6 秒，先猛后收），落下的地方焦一块、烧着几簇小火苗（烧地的时长由状态管）
        if (!v) return;
        v.s = new Sprite(this.pillarTex[0]);
        v.s.anchor.set(0.5, 1);
        v.s.position.set(Math.round(x), Math.round(y + 2));
        v.s.zIndex = y + 2;
        this.stage.entities.addChild(v.s);
        const sc = new Sprite(this.burntTex);
        sc.anchor.set(5 / 11, 2 / 5);
        sc.position.set(Math.round(x), Math.round(y));
        this.stage.floor.addChild(sc);
        this.fading.push({ s: sc, t: 0, life: TEN.fire.burn + 1.2, a0: 0.6 });
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + rnd(-0.4, 0.4);
          const rr = rnd(3, r - 3);
          const b = new Sprite(this.tongueTex[k % 3]);
          b.anchor.set(0.5, 1);
          b.alpha = 0;
          b.position.set(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.8));
          b.zIndex = b.y;
          this.stage.entities.addChild(b);
          v.bits.push({ s: b, ph: rnd(0, 3), dx: Math.cos(a) * rr, dy: Math.sin(a) * rr * 0.8 });
        }
        this.sparks.emit(x, y - 6, 10, LOOK.fire.motes, [30, 80], [0.3, 0.6], { up: 50, g: 60, drag: 2 });
        this.shake.add(0.06);
        this.sfx.play('zone.fire');
        break;
      }
      case 'wisp':
        this.sfx.play('yao.flag');
        break;
      case 'eye': {
        if (!v) return;
        v.s = new Sprite(swirlTex(TEN.sand.eye + 3, 3, 0.32, 1));
        v.s.anchor.set(0.5);
        v.s.tint = 0x8a4f3c;
        v.s.alpha = 0;
        v.s.position.set(Math.round(x), Math.round(y));
        this.ground.addChild(v.s);
        break;
      }
    }
  }

  /** 一道天雷：紫白的雷从天上劈到落点，落点星芒一闪、地上一块焦痕慢慢淡去，迸出碎光，微微震屏。 */
  private bolt(x: number, y: number) {
    const { g, ox, oy } = boltGrid(x + rnd(-4, 4), y - 74, x, y - 3);
    const bolt = new Sprite(textureFromGrid(recolor(g, { Y: 'm', y: 'p', N: 'P' })));
    bolt.position.set(ox, oy);
    this.air.addChild(bolt);
    this.fading.push({ s: bolt, t: 0, life: 0.24, a0: 1, own: true });
    const sc = new Sprite(this.scorchTex);
    sc.anchor.set(5 / 11, 2 / 5);
    sc.position.set(Math.round(x), Math.round(y));
    this.stage.floor.addChild(sc);
    this.fading.push({ s: sc, t: 0, life: 1.4, a0: 0.7 });
    const im = new Sprite(this.impactTex);
    im.anchor.set(3 / 7, 3 / 7);
    im.position.set(Math.round(x), Math.round(y - 4));
    this.air.addChild(im);
    this.fading.push({ s: im, t: 0, life: 0.28, a0: 1 });
    this.sparks.emit(x, y - 3, 12, [0xffffff, 0xd47aa0, 0xc8a8f0], [40, 110], [0.18, 0.4], { up: 18, drag: 3 });
    this.glows.emit(x, y - 5, 6, [0xffffff, 0xc8a8f0], [20, 50], [0.25, 0.45], { up: 10 });
    this.pfx(false, 'ten:zap', 'zapHitViolet', x, y - 3); // 落点一团紫白的雷火（修仙版 zap-hit 的紫版）
    this.shake.add(0.12);
    this.sfx.play('ten.bolt');
  }

  /** 这座阵的画面（没有就建）。 */
  private view(i: number, kind: SiteKind): SiteView {
    let v = this.views.get(i);
    if (v && v.kind === kind && v.gone < 0) return v;
    if (v) v.c.destroy({ children: true });
    const [x, y] = TEN.sites[i];
    const tx = glyphTex(i);
    const c = new Container();
    c.position.set(x, y);
    let fill: Sprite | null = null;
    const fo = this.fillOf(kind);
    if (fo) {
      fill = new Sprite(fo.tex[0]);
      fill.anchor.set(0.5);
      fill.alpha = 0;
      if (fo.add) fill.blendMode = 'add';
      c.addChild(fill);
    }
    const swirl: Sprite[] = [];
    if (kind === 'wind' || kind === 'sand') {
      // 风吼：两层淡青的风纹反着转；红沙：一层赭红的沙旋往阵心绕
      const layers = kind === 'wind' ? [swirlTex(TEN.r - 2, 5, 0.55, 0), swirlTex(TEN.r - 12, 4, 0.7, 2)] : [swirlTex(TEN.r - 2, 6, 0.42, 3)];
      for (const t of layers) {
        const s = new Sprite(t);
        s.anchor.set(0.5);
        s.alpha = 0;
        s.tint = kind === 'wind' ? 0xd8f6f0 : 0x9a4a30;
        if (kind === 'wind') s.blendMode = 'add';
        c.addChild(s);
        swirl.push(s);
      }
    }
    const look = LOOK[kind];
    const glyph = new Sprite(tx.glyph);
    glyph.anchor.set(0.5);
    glyph.tint = look.glyph;
    glyph.blendMode = look.add ? 'add' : 'normal';
    glyph.alpha = 0;
    const rim = new Sprite(tx.rim);
    rim.anchor.set(0.5);
    rim.tint = look.glyph;
    rim.blendMode = glyph.blendMode;
    rim.alpha = 0;
    c.addChild(glyph, rim);
    const arcs = kind === 'thunder' || kind === 'water' ? new Graphics() : null;
    if (arcs) c.addChild(arcs);
    this.ground.addChild(c);
    v = { i, kind, c, glyph, rim, fill, swirl, arcs, t: 0, gone: -1, fx: 0.2, ripples: [], sparks: [] };
    this.views.set(i, v);
    return v;
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.pfxTop.update(dt);
    this.pfxLow.update(dt);
    const t = tenOf(w);
    // 阵旗：跟着地形走（换到别的章就拿掉）
    if (!t) {
      if (this.daises.length) this.dropFlags();
      if (this.views.size || this.strikes.size) this.clear();
      this.updateFading(dt);
      return;
    }
    if (!this.daises.length) {
      this.daises = TEN.sites.map(([x, y], i) => {
        const tex = daisTex(TEN.kinds[i]);
        const base = new Sprite(tex.idle[0]);
        base.anchor.set(DAIS_AX / DAIS_W, DAIS_AY / DAIS_H);
        base.position.set(x, y);
        base.zIndex = y + 1;
        base.tint = DAIS_IDLE;
        const lit = new Sprite(tex.litIdle[0]);
        lit.anchor.set(DAIS_AX / DAIS_W, DAIS_AY / DAIS_H);
        lit.position.set(x, y);
        lit.zIndex = y + 1.01;
        lit.blendMode = 'add';
        lit.alpha = 0;
        let flag: Sprite | null = null;
        if (tex.flagAt) {
          flag = new Sprite(this.flagTex.idle[0]);
          flag.anchor.set(FLAG_ANCHOR.x / FLAG_W, FLAG_ANCHOR.y / FLAG_H);
          flag.position.set(x + tex.flagAt[0], y + tex.flagAt[1]);
          flag.zIndex = y + tex.flagAt[1]; // 插在台子后头
          flag.tint = FLAG_IDLE;
          this.stage.entities.addChild(flag);
        }
        this.stage.entities.addChild(base, lit);
        return { base, lit, flag, tex, ph: i * 0.37, tint: FLAG_IDLE };
      });
    }
    t.sites.forEach((s, i) => {
      const d = this.daises[i];
      // 状态里亮着、画面还没有的（错过了事件：联机中途进来、调试改了状态）也补上
      if (s.state !== 'off' && s.kind && !this.views.has(i)) this.view(i, s.kind).t = s.state === 'on' ? TEN.warn : s.t;
      const v = this.views.get(i);
      // 平时慢慢摆；预警时猎猎作响（越到后面抖得越快）；亮着的时候还在抖，慢一点
      const warn = s.state === 'warn';
      const on = s.state === 'on';
      const fps = warn ? 7 + 6 * clamp01(s.t / s.dur) : on ? 6 : 2.2;
      d.ph += dt * fps;
      const fl = warn || on;
      const fr = Math.floor(d.ph);
      const kind = TEN.kinds[i];
      d.base.texture = (fl ? d.tex.flutter : d.tex.idle)[fr % d.tex.idle.length];
      d.lit.texture = (fl ? d.tex.litFlutter : d.tex.litIdle)[(kind === 'fire' || kind === 'water' ? Math.floor(this.time * (kind === 'fire' ? 10 : 3)) : fr) % d.tex.litIdle.length];
      if (d.flag) d.flag.texture = (fl ? this.flagTex.flutter : this.flagTex.idle)[fr % 4];
      // 亮度：平时暗（压一档灰），预警时渐亮，熄了慢慢暗回去；叠加的光同理
      const k = warn ? clamp01(s.t / s.dur) : on ? 1 : v && v.gone >= 0 ? 1 - clamp01(v.gone / TEN.fade) : 0;
      d.base.tint = mixColor(DAIS_IDLE, 0xffffff, ease(k));
      d.lit.alpha = ease(k) * (on ? 0.8 + 0.2 * Math.sin(this.time * 3 + i) : 0.85);
      // 阵旗的颜色：预警时从褪色的暖灰染成这一阵的颜色，熄了慢慢褪回去
      const want = LOOK[kind].flag;
      d.tint = mixColor(FLAG_IDLE, want, ease(k));
      if (d.flag) d.flag.tint = d.tint;
      // 预警时台上冒几粒这一阵的光
      if (warn && Math.random() < 0.3 * k) this.glows.emit(TEN.sites[i][0] + rnd(-6, 6), TEN.sites[i][1] - rnd(4, 14), 1, LOOK[kind].motes, [6, 16], [0.3, 0.6], { up: 16 });
    });
    // 状态里有、画面还没有的招（错过了事件）也补上
    for (const s of t.strikes) if (!this.strikes.has(s.id)) this.strikeView(s);
    // 每座亮着的阵
    for (const [i, v] of this.views) {
      v.t += dt;
      if (v.gone >= 0) v.gone += dt;
      const s = t.sites[i];
      if (v.gone < 0 && s.state === 'off') v.gone = 0;
      const warnK = s.state === 'warn' ? clamp01(s.t / s.dur) : 1; // 预警进度（亮着就是 1）
      const out = v.gone >= 0 ? 1 - clamp01(v.gone / TEN.fade) : 1;
      if (out <= 0) {
        v.c.destroy({ children: true });
        this.views.delete(i);
        continue;
      }
      this.drawSite(v, s.state === 'on' && v.gone < 0, warnK, out, dt);
    }
    // 站在阵里的人：红水里走动时脚下溅起暗红的水花，金光阵里脚下往上飘几粒金光（加持着；不是光圈，是零星的光点）……
    for (const p of w.players) {
      if (!p.alive) continue;
      for (let i = 0; i < t.sites.length; i++) {
        const st = t.sites[i];
        if (st.state !== 'on' || !inSite(p.x, p.y, i)) continue;
        if (st.kind === 'water' && p.moving && Math.random() < 0.35) this.sparks.emit(p.x + rnd(-3, 3), p.y - 1, 2, LOOK.water.motes, [12, 30], [0.2, 0.4], { up: 22, g: 120, drag: 2 });
        if (st.kind === 'gold' && Math.random() < 0.18) this.glows.emit(p.x + rnd(-5, 5), p.y - rnd(0, 3), 1, LOOK.gold.motes, [4, 10], [0.5, 0.9], { up: 18, drag: 1 });
        if (st.kind === 'soul' && Math.random() < 0.2) this.glows.emit(p.x + rnd(-4, 4), p.y - rnd(8, 16), 1, LOOK.soul.motes, [4, 10], [0.5, 0.9], { up: -6, drag: 1 }); // 真气流走：一缕缕往下沉
        if (st.kind === 'sand' && p.moving && Math.random() < 0.3) this.sparks.emit(p.x + rnd(-3, 3), p.y - 1, 2, LOOK.sand.motes, [10, 25], [0.25, 0.45], { up: 10, g: 60, drag: 2 });
      }
    }
    // 招：预警的淡红光随进度推亮，推满落下；持续的招跟着状态
    const live = new Map<number, Strike>();
    for (const s of t.strikes) live.set(s.id, s);
    for (const [id, v] of this.strikes) {
      const s = live.get(id);
      if (s) {
        v.t = s.t - (1 - alpha) * DT;
        v.x = s.x;
        v.y = s.y;
      } else if (!v.gone) {
        if (!v.struck) v.warn.end(0.25); // 没落就没了（波末收掉）：淡得快一点
        this.fadeStrike(v);
      }
      if (v.struck) v.st += dt;
      this.drawStrike(v, dt);
      if (v.warn.done && (v.gone || v.kind === 'bolt' || v.kind === 'spike') && this.strikeDone(v)) {
        this.dropStrike(v);
        this.strikes.delete(id);
      }
    }
    this.updateFading(dt);
  }

  /** 这一招的画面都淡完了没有（预警淡完之后，地缝、火柱、魂火还要收个尾）。 */
  private strikeDone(v: StrikeView) {
    switch (v.kind) {
      case 'fissure':
        return v.st > 1.6;
      case 'pillar':
      case 'wisp':
      case 'eye':
      case 'gust':
        return v.gone;
      default:
        return true;
    }
  }

  private drawStrike(v: StrikeView, dt: number) {
    const k = clamp01(v.t / v.t2);
    if (v.warn instanceof SweepWarn) {
      const prog = v.struck ? clamp01((v.t - v.t2) / Math.max(0.01, v.live)) * v.arc : 0;
      v.warn.draw(dt, k, prog);
    } else if (v.warn instanceof DiskWarn) {
      if (v.kind === 'wisp') v.warn.move(v.x, v.y);
      v.warn.draw(dt, k);
    } else v.warn.draw(dt, k);
    switch (v.kind) {
      case 'fissure': {
        // 地缝：前 0.25 秒从阵心往外裂开，缝里的岩火由缃、橘冷成朱、殷，1.6 秒淡完
        const g = v.g;
        if (!g) break;
        g.clear();
        const open = clamp01(v.st / 0.25);
        const n = Math.max(1, Math.round(v.crack.length * open));
        const cool = clamp01((v.st - 0.3) / 1.0);
        const fade = 1 - clamp01((v.st - 1.0) / 0.6);
        // 裂口的下唇（暗）、缝里的岩火（两像素宽：缃 → 橘 → 朱 → 殷，越冷越暗），缝口上方再叠一层很淡的热光
        for (let m = 0; m < n - 1; m++) pixLine(g, v.crack[m][0], v.crack[m][1] + 1, v.crack[m + 1][0], v.crack[m + 1][1] + 1);
        g.fill({ color: 0x2e1c14, alpha: 0.8 * fade });
        for (let m = 0; m < n - 1; m++) {
          pixLine(g, v.crack[m][0], v.crack[m][1], v.crack[m + 1][0], v.crack[m + 1][1]);
          pixLine(g, v.crack[m][0], v.crack[m][1] - 1, v.crack[m + 1][0], v.crack[m + 1][1] - 1);
        }
        g.fill({ color: cool < 0.25 ? 0xf7dc7a : cool < 0.55 ? 0xf2814a : cool < 0.85 ? 0xd9452b : 0x5c1a1b, alpha: (1 - 0.35 * cool) * fade });
        if (cool < 0.5) {
          for (let m = 0; m < n - 1; m += 2) g.rect(Math.round(v.crack[m][0]), Math.round(v.crack[m][1]) - 2, 1, 1);
          g.fill({ color: 0xf2814a, alpha: 0.45 * (1 - cool * 2) * fade });
        }
        // 喷口：沿缝几处往上窜一小股岩火（前半秒）
        if (v.st < 0.6 && Math.random() < 0.9) {
          const p = v.crack[Math.floor(Math.random() * n)];
          this.glows.emit(p[0], p[1] - 2, 2, [0xf2814a, 0xf7dc7a, 0xd9452b], [10, 30], [0.3, 0.55], { up: 40, drag: 1 });
        }
        break;
      }
      case 'gust': {
        // 风刃：一弯淡青的风从阵心扫到阵边（像一片弯月刃），后面拖两道更淡的残影；扫过的地方卷起尘
        const g = v.g;
        if (!g) break;
        g.clear();
        if (!v.struck || v.gone) break;
        const q = clamp01((v.t - v.t2) / Math.max(0.01, v.live));
        const out = 1 - clamp01((v.t - v.t2 - v.live) / 0.25);
        for (let tr = 0; tr < 3; tr++) {
          const a = v.a0 + v.dir * (v.arc * q - tr * 0.13);
          if (v.dir * (a - v.a0) < -0.05) continue;
          for (let r = 10; r <= v.r - 2; r += 1) {
            const bend = v.dir * (r / v.r) * 0.32; // 外沿往前弯
            const aa = a + bend;
            g.rect(Math.round(v.x + Math.cos(aa) * r), Math.round(v.y + Math.sin(aa) * r * 0.9), 1, r > v.r * 0.45 && tr === 0 ? 2 : 1);
          }
          g.fill({ color: tr === 0 ? 0xe8fff8 : 0xa8e8dc, alpha: (tr === 0 ? 0.75 : 0.32 / tr) * out });
        }
        if (q < 1 && Math.random() < 0.7) {
          const a = v.a0 + v.dir * v.arc * q;
          const r = rnd(16, v.r - 4);
          this.sparks.emit(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, 1, [0xa48e6d, 0xc8b07a], [30, 60], [0.3, 0.5], { dir: a + (v.dir * Math.PI) / 2, spread: 0.6, drag: 2 });
        }
        break;
      }
      case 'pillar': {
        if (!v.s) break;
        // 火柱：前 0.12 秒窜到顶，烧到 0.55 秒开始往下收，0.8 秒收成地上的小火苗
        const up = ease(clamp01(v.st / 0.12));
        const down = clamp01((v.st - 0.55) / 0.3);
        v.s.texture = this.pillarTex[Math.floor(this.time * 12) % 4];
        v.s.scale.y = up * (1 - 0.85 * down);
        v.s.scale.x = 1 - 0.3 * down;
        v.s.alpha = v.gone ? Math.max(0, v.s.alpha - dt * 3) : 1 - 0.4 * down;
        const burnA = v.gone ? Math.max(0, (v.bits[0]?.s.alpha ?? 0) - dt * 2.5) : ease(clamp01((v.st - 0.35) / 0.3));
        for (const b of v.bits) {
          b.ph += dt * (7 + b.dx * 0.1);
          b.s.texture = this.tongueTex[Math.floor(b.ph) % 3];
          b.s.alpha = burnA;
        }
        if (!v.gone && v.st > 0.4 && Math.random() < 0.2) this.sparks.emit(v.x + rnd(-v.r * 0.6, v.r * 0.6), v.y - 3, 1, LOOK.fire.motes, [6, 16], [0.4, 0.7], { up: 26, drag: 1 });
        if (v.gone && v.s.alpha <= 0 && burnA <= 0) v.st = Math.max(v.st, 99);
        break;
      }
      case 'wisp': {
        if (!v.s) break;
        // 魂火：预警时从地里慢慢冒出来（缩着、淡），落下（冒出来）后飘着追人，上下轻轻浮
        const emerge = v.struck ? 1 : ease(k);
        v.s.texture = this.wispTex[Math.floor(this.time * 8 + v.id) % 3];
        v.s.position.set(Math.round(v.x), Math.round(v.y - 3 - emerge * 3 + Math.sin(this.time * 4 + v.id) * 1));
        v.s.scale.set(0.5 + 0.5 * emerge);
        v.s.alpha = v.gone ? Math.max(0, v.s.alpha - dt * 4) : 0.25 + 0.65 * emerge;
        if (!v.gone && Math.random() < 0.35) this.glows.emit(v.x + rnd(-2, 2), v.y - 6, 1, LOOK.soul.motes, [3, 8], [0.4, 0.7], { up: 10, drag: 1 });
        break;
      }
      case 'eye': {
        if (!v.s) break;
        // 沙眼：阵心一个往里旋的沙涡（顺着红沙阵的旋涡转得更快），沙粒往里卷
        v.s.rotation += dt * 2.4;
        v.s.alpha = v.gone ? Math.max(0, v.s.alpha - dt * 2) : Math.min(0.85, v.s.alpha + dt * 2);
        if (!v.gone && Math.random() < 0.5) {
          const a = Math.random() * TAU;
          const r = v.r + rnd(2, 8);
          this.sparks.emit(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r * 0.86, 1, LOOK.sand.motes, [12, 22], [0.35, 0.55], { dir: a + Math.PI * 0.62, spread: 0.2, drag: 1 });
        }
        break;
      }
    }
  }

  private drawSite(v: SiteView, on: boolean, warnK: number, out: number, dt: number) {
    const look = LOOK[v.kind];
    const breathe = 0.5 + 0.5 * Math.sin(this.time * 2.2 + v.i);
    // 地纹：预警时由暗到亮（ease），亮着时随阵呼吸；外圈只淡淡地亮
    const lit = ease(warnK) * out;
    const [cx, cy] = TEN.sites[v.i];
    const R = TEN.r;
    const fo = this.fillOf(v.kind);
    // 铺在地上的那一片：预警的后半程从阵心涨开，亮起时铺满
    const rise = ease(clamp01((warnK - 0.45) / 0.55));
    if (v.fill && fo) {
      v.fill.alpha = fo.alpha * rise * out * (v.kind === 'gold' ? lit * (0.8 + 0.2 * breathe) : 0.88 + 0.12 * breathe);
      v.fill.scale.set(0.55 + 0.45 * rise);
      if (fo.tex.length > 1) v.fill.texture = fo.tex[Math.floor(this.time * (v.kind === 'water' ? 2.5 : 1.2) + v.i) % fo.tex.length];
    }
    for (let k = 0; k < v.swirl.length; k++) {
      const s = v.swirl[k];
      s.alpha = (v.kind === 'wind' ? 0.26 : 0.4) * rise * out;
      s.rotation += dt * (v.kind === 'wind' ? (k ? -1.1 : 0.7) : -0.9); // 红沙往里旋（逆着旋臂转 = 往里走）
    }
    v.glyph.alpha = lit * (look.add ? 0.55 + 0.2 * breathe : 0.4 + 0.15 * breathe) * (v.fill && !look.add ? 1 - 0.45 * rise : 1);
    v.rim.alpha = lit * 0.14;
    switch (v.kind) {
      case 'thunder': {
        const flick = on && Math.random() < 0.08 ? 0.35 : 0;
        v.glyph.alpha = lit * (0.55 + 0.2 * breathe + flick);
        // 电弧：阵里不时窜过一道细小的电弧（亮着的时候），一闪就散
        if (on) {
          v.fx -= dt;
          if (v.fx <= 0) {
            v.fx = rnd(0.14, 0.35);
            const a = Math.random() * TAU;
            const r0 = rnd(10, R - 6);
            const pts: [number, number][] = [[Math.cos(a) * r0, Math.sin(a) * r0]];
            const da = rnd(0.2, 0.45) * (Math.random() < 0.5 ? -1 : 1);
            for (let k = 1; k <= 5; k++) {
              const r = r0 + rnd(-4, 4);
              pts.push([Math.cos(a + (da * k) / 5) * r + rnd(-1, 1), Math.sin(a + (da * k) / 5) * r + rnd(-1, 1)]);
            }
            v.sparks.push({ pts, t: 0, life: 0.16 });
          }
        }
        const g = v.arcs!;
        g.clear();
        for (let k = v.sparks.length - 1; k >= 0; k--) {
          const sp = v.sparks[k];
          sp.t += dt;
          if (sp.t >= sp.life) {
            v.sparks.splice(k, 1);
            continue;
          }
          for (let m = 0; m < sp.pts.length - 1; m++) pixLine(g, sp.pts[m][0], sp.pts[m][1], sp.pts[m + 1][0], sp.pts[m + 1][1]);
          g.fill({ color: sp.t < sp.life * 0.5 ? 0xffffff : 0xc8a8f0, alpha: (1 - sp.t / sp.life) * out });
        }
        g.blendMode = 'add';
        break;
      }
      case 'water': {
        v.glyph.alpha = lit * (0.35 + 0.15 * breathe) * (1 - 0.5 * rise);
        if (on) {
          v.fx -= dt;
          if (v.fx <= 0) {
            v.fx = rnd(0.18, 0.4);
            const a = Math.random() * TAU;
            const r = Math.sqrt(Math.random()) * (R - 12);
            v.ripples.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, t: 0, life: rnd(0.9, 1.4) });
          }
        }
        const g = v.arcs!;
        g.clear();
        for (let k = v.ripples.length - 1; k >= 0; k--) {
          const rp = v.ripples[k];
          rp.t += dt;
          const q = rp.t / rp.life;
          if (q >= 1) {
            v.ripples.splice(k, 1);
            continue;
          }
          const rr = 2 + 9 * Math.sqrt(q);
          pixEllipse(g, rp.x, rp.y, rr, rr * 0.55);
          g.fill({ color: q < 0.4 ? 0xf2814a : 0xd9452b, alpha: 0.55 * (1 - q) * out });
        }
        break;
      }
      case 'gold': {
        v.glyph.alpha = lit * (0.5 + 0.25 * breathe);
        if (on) {
          // 金色的光点、小符往上飘
          if (Math.random() < 0.6) {
            const a = Math.random() * TAU;
            const r = Math.sqrt(Math.random()) * (R - 4);
            this.glows.emit(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1, look.motes, [4, 10], [0.6, 1.1], { up: 14, drag: 1 });
          }
          v.fx -= dt;
          if (v.fx <= 0) {
            v.fx = rnd(0.35, 0.7);
            const a = Math.random() * TAU;
            const r = Math.sqrt(Math.random()) * (R - 8);
            const s = new Sprite(this.talisTex[Math.random() < 0.5 ? 0 : 1]);
            s.anchor.set(0.5, 1);
            s.position.set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
            s.blendMode = 'add';
            this.air.addChild(s);
            this.fading.push({ s, t: 0, life: 1.3, a0: 0.75, vy: -12 });
          }
        }
        break;
      }
      default: {
        // 其余几阵亮着时各自的氛围粒子：热浪、寒雾、血雾里翻的血珠、阴火、风卷的尘、往阵心卷的沙
        if (!on) break;
        const p = Math.random();
        const a = Math.random() * TAU;
        const r = Math.sqrt(Math.random()) * (R - 6);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (v.kind === 'fire' && p < 0.45) this.glows.emit(x, y, 1, look.motes, [4, 12], [0.5, 0.9], { up: 22, drag: 1 });
        else if (v.kind === 'quake' && p < 0.3) this.glows.emit(x, y, 1, [0xf2814a, 0xe0a83a], [4, 10], [0.4, 0.7], { up: 16, drag: 1 });
        else if (v.kind === 'ice' && p < 0.35) this.glows.emit(x, y - 2, 1, look.motes, [3, 8], [0.7, 1.2], { up: 5, drag: 1 });
        else if (v.kind === 'blood' && p < 0.4) this.sparks.emit(x, y, 1, look.motes, [4, 10], [0.6, 1.0], { up: 8, drag: 1 });
        else if (v.kind === 'soul' && p < 0.35) this.glows.emit(x, y, 1, look.motes, [3, 8], [0.7, 1.2], { up: 12, drag: 1 });
        else if (v.kind === 'wind' && p < 0.5) this.sparks.emit(x, y, 1, [0xa48e6d, 0xc8b07a, 0xe8fff8], [25, 45], [0.35, 0.6], { dir: a + 1.2, spread: 0.3, drag: 1 });
        else if (v.kind === 'sand' && p < 0.6) this.sparks.emit(x, y, 1, look.motes, [18, 30], [0.4, 0.7], { dir: a + Math.PI * 0.7, spread: 0.2, drag: 1 });
        break;
      }
    }
  }

  private updateFading(dt: number) {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.s.destroy(f.own ? { texture: true, textureSource: true } : undefined);
        this.fading.splice(i, 1);
        continue;
      }
      if (f.grow) {
        // 冰锥：从地里拱出来，立着，最后 0.3 秒淡掉（碎了）
        f.s.scale.y = ease(clamp01(f.t / f.grow));
        f.s.alpha = f.a0 * (1 - clamp01((f.t - (f.life - 0.3)) / 0.3));
        if (f.t > f.life - 0.3 && f.t - dt <= f.life - 0.3) this.sparks.emit(f.s.x, f.s.y - 6, 6, LOOK.ice.motes, [20, 50], [0.25, 0.45], { up: 10, g: 140, drag: 2 });
        continue;
      }
      // 小符：先淡入再淡出，往上飘
      f.s.alpha = f.vy ? f.a0 * Math.sin(k * Math.PI) : f.a0 * (1 - k) * (k < 0.15 ? 1 : 1 - (k - 0.15) * 0.4);
      if (f.vy) f.s.y += f.vy * dt;
    }
  }
}

/** 两个颜色按 k 混合。 */
function mixColor(a: number, b: number, k: number) {
  const m = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** 一像素宽的像素线（只加形状，调用方自己 fill）。 */
function pixLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

/** 一像素宽的像素椭圆（涟漪）。 */
function pixEllipse(g: Graphics, cx: number, cy: number, rx: number, ry: number) {
  const n = Math.max(8, Math.ceil(2 * Math.PI * Math.max(rx, ry)));
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    const k = (y + 256) * 512 + x + 256;
    if (seen.has(k)) continue;
    seen.add(k);
    g.rect(x, y, 1, 1);
  }
}
