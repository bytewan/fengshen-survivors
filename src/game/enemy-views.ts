// 第一章 8 种敌人的画面：建精灵（锚点、影子、残魂的天青眼光）、每帧换哪张纹理、朝哪边、额外的着色与粒子、死亡。
// 两层接口，合并进 feel.ts 时二选一：
//   1) 查表：foeLooks()[kind] 给出每种敌人的 anchor / shadow / eyes / frame / facing / decorate / dead，
//      feel.ts 的 syncViews 里把现在按 elite / caster / soldier 三分支的写法换成查表（原有三种的画法原样搬进表里了）；
//   2) 整块：new EnemyViews(stage, particles, glowParticles)，onEvent / update / clear 三个方法，
//      包下 syncViews 里画敌人的那一整段（建精灵、换帧、状态着色、眼光、精英血条、死亡闪白缩小），enemy-lab.ts 就是这么用的。
// 首领不在表里（魔化哪吒由 boss-fx 画）。只读模拟状态，不回写。用户口径：不画光圈、动画不要太快。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { SHADOW, SMALL_SHADOW, type Stage } from '../render/stage.ts';
import { camCull, FlatLayer, type Flat } from '../render/flat-layer.ts';
import type { Particles } from '../render/juice.ts';
import { atlasFromGrids, flashTextureFromGrid, steppedLightTexture, textureFromGrid } from '../render/textures.ts';
import type { Grid } from '../art/pixel.ts';
import { SOLDIER_ANCHOR, SOLDIER_FRAMES, SOLDIER_H, SOLDIER_W } from '../art/sprites/soldier.ts';
import { ELITE_ANCHOR, ELITE_FRAMES, ELITE_H, ELITE_W } from '../art/sprites/elite.ts';
import { CASTER_ANCHOR, CASTER_FRAMES, CASTER_H, CASTER_W } from '../art/sprites/caster.ts';
import { SPEARMAN_ANCHOR, SPEARMAN_FRAMES, SPEARMAN_H, SPEARMAN_W } from '../art/sprites/spearman.ts';
import { SHIELD_ANCHOR, SHIELD_FRAMES, SHIELD_H, SHIELD_W } from '../art/sprites/shieldbearer.ts';
import { CAVALRY_ANCHOR, CAVALRY_FRAMES, CAVALRY_H, CAVALRY_W } from '../art/sprites/cavalry.ts';
import { BOMBER_ANCHOR, BOMBER_FRAMES, BOMBER_H, BOMBER_W } from '../art/sprites/bomber.ts';
import { SPLITLING_ANCHOR, SPLITLING_FRAMES, SPLITLING_H, SPLITLING_W, SPLITTER_ANCHOR, SPLITTER_FRAMES, SPLITTER_H, SPLITTER_W } from '../art/sprites/splitter.ts';
import type { Enemy, EnemyKindName, SimEvent } from '../sim/types.ts';
import { ch2Looks } from './ch2/foe-looks.ts';
import { ch3Looks } from './ch3/foe-looks.ts';
import { eliteLook } from './elites/looks.ts';
import { aegisLeft } from '../sim/elites/lishi.ts';
import type { World } from '../sim/world.ts';
import { heldEnemies, heldPose, renderTime } from './heroes/dou-pose.ts';

export type FoeViewKind = Exclude<EnemyKindName, 'boss'>;

/** 一只敌人在表现层的计时（feel.ts 的 EnemyView 里已有 t / flash / castT；guard 是新加的：盾兵挡格亮符的剩余时间）。 */
export interface FoeClock {
  t: number; // 走路动画的计时（被减速时走得慢）
  flash: number; // 受击闪白剩余时间
  guard: number; // 盾兵挡格：符文亮起的剩余时间
  fuseT: number; // 自爆鬼：引信点燃后过了多久（表现层计时，闪烁越来越快）
  trail: number; // 骑兵冲锋：距下一个残影
  puff: number; // 骑兵喘息：距下一口气
}

/** decorate 用到的表现层工具。 */
export interface FoeDecorCtx {
  sparks: Particles; // 普通混合的粒子（火星、尘土）
  glows: Particles; // 加法混合的粒子（魂光）
  /** 在角色层放一个残影（骑兵冲锋拖影用），life 秒淡出。 */
  ghost(tex: Texture, x: number, y: number, dir: 1 | -1, anchor: [number, number], tint: number, alpha: number, life: number): void;
  dt: number;
}

export interface FoeLook {
  anchor: [number, number]; // 归一化锚点（脚底）
  shadow: 'small' | 'big';
  /** 残魂的眼光：相对脚底的位置（朝右时；朝左镜像）、颜色、亮度。可以有两只（骑将和鬼马各一）。 */
  eyes: { x: number; y: number; color: number; alpha: number }[];
  bar?: number; // 头顶血条离脚底多高（精英）
  top: number; // 头顶离脚底多高（伤害跳字从这里冒出来；feel.ts 现在是普通 22、精英 40）
  big?: boolean; // 个头大：现身、死亡时的魂散用大一号（精英、骑兵、盾兵）
  /** 这一帧用哪张纹理。 */
  frame(e: Enemy, c: FoeClock): Texture;
  /** 眼光这一帧的上下起伏（和走路的颠簸对齐）。 */
  bob(e: Enemy, c: FoeClock): number;
  /** 朝向：1 朝右、-1 朝左。hx：最近那个人物的 x。 */
  facing(e: Enemy, hx: number): 1 | -1;
  /** 死亡闪白那一帧（按死前那一帧的姿势）。 */
  dead(e: Enemy, c: FoeClock): Texture;
  /** 每帧额外的效果（状态着色之后调）：引信闪烁冒火星、冲锋拖残影、喘息呼气…… x / y 是脚底的屏幕位置。 */
  decorate?(s: Sprite, e: Enemy, c: FoeClock, x: number, y: number, dir: 1 | -1, ctx: FoeDecorCtx): void;
}

const tex = (gs: Grid[]) => ({ n: gs.map(textureFromGrid), f: gs.map(flashTextureFromGrid) });
const anchorOf = (a: { x: number; y: number }, w: number, h: number): [number, number] => [a.x / w, a.y / h];
const towardHero = (e: Enemy, hx: number): 1 | -1 => (hx >= e.x ? 1 : -1);
const prog = (e: Enemy) => (e.actLen ? 1 - Math.max(0, e.actT ?? 0) / e.actLen : 0);
const moved = (e: Enemy) => Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
const CYAN = 0x7cc4c4;

let cache: Record<FoeViewKind, FoeLook> | null = null;

/** 8 种敌人（加分魂鬼的小鬼）的画法。第一次调用时生成纹理（要在 Pixi 起来之后）。 */
export function foeLooks(): Record<FoeViewKind, FoeLook> {
  if (cache) return cache;
  const soldier = tex(SOLDIER_FRAMES.walk);
  const elite = tex(ELITE_FRAMES.walk);
  const caster = { float: tex(CASTER_FRAMES.float), cast: tex(CASTER_FRAMES.cast) };
  const spear = { walk: tex(SPEARMAN_FRAMES.walk), windup: tex(SPEARMAN_FRAMES.windup), strike: tex(SPEARMAN_FRAMES.strike), rest: tex(SPEARMAN_FRAMES.rest) };
  const shield = { walk: tex(SHIELD_FRAMES.walk), guard: tex(SHIELD_FRAMES.guard) };
  const horse = { walk: tex(CAVALRY_FRAMES.walk), warn: tex(CAVALRY_FRAMES.warn), charge: tex(CAVALRY_FRAMES.charge), rest: tex(CAVALRY_FRAMES.rest) };
  const bomb = { float: tex(BOMBER_FRAMES.float), fuse: tex(BOMBER_FRAMES.fuse), hot: tex(BOMBER_FRAMES.hot) };
  const split = tex(SPLITTER_FRAMES.float);
  const lings = SPLITLING_FRAMES.float.map(tex);
  const fi4 = (c: FoeClock, fps = 6) => Math.floor(c.t * fps) % 4;

  // 长矛兵：蓄力两帧（先收矛、再亮矛尖），刺出两帧（前刺、回收），收枪一帧；站定时停在第一帧
  const spearPose = (e: Enemy, c: FoeClock): [keyof typeof spear, number] => {
    if (e.act === 'windup') return ['windup', prog(e) < 0.45 ? 0 : 1];
    if (e.act === 'strike') return ['strike', prog(e) < 0.6 ? 0 : 1];
    if (e.act === 'rest') return ['rest', 0];
    return ['walk', moved(e) ? fi4(c) : 0];
  };
  // 骑兵：奔跑 4 帧、预警刨蹄 2 帧、冲锋 2 帧、喘息 2 帧
  const horsePose = (e: Enemy, c: FoeClock): [keyof typeof horse, number] => {
    if (e.act === 'windup') return ['warn', Math.floor(c.t * 5) % 2];
    if (e.act === 'strike') return ['charge', Math.floor(c.t * 12) % 2];
    if (e.act === 'rest') return ['rest', Math.floor(c.t * 2.5) % 2];
    return ['walk', moved(e) ? Math.floor(c.t * 9) % 4 : 1];
  };
  // 自爆鬼：引信三档鼓胀（按引信进度），并在 fuse / hot 之间越闪越快
  const bombPose = (e: Enemy, c: FoeClock): [keyof typeof bomb, number] => {
    if (e.act !== 'fuse') return ['float', fi4(c)];
    const k = prog(e);
    const stage = k < 0.34 ? 0 : k < 0.68 ? 1 : 2;
    const hz = 4 + 14 * k; // 每秒闪几下
    return [Math.floor(c.fuseT * hz * 2) % 2 ? 'hot' : 'fuse', stage];
  };

  cache = {
    soldier: {
      top: 22,
      anchor: anchorOf(SOLDIER_ANCHOR, SOLDIER_W, SOLDIER_H),
      shadow: 'small',
      eyes: [{ x: 1, y: -15, color: CYAN, alpha: 0.6 }],
      frame: (_e, c) => (c.flash > 0 ? soldier.f : soldier.n)[fi4(c)],
      bob: (_e, c) => fi4(c) % 2,
      facing: towardHero,
      dead: () => soldier.f[0],
    },
    elite: {
      top: 40,
      big: true,
      anchor: anchorOf(ELITE_ANCHOR, ELITE_W, ELITE_H),
      shadow: 'big',
      eyes: [{ x: 0, y: -25, color: 0xd9452b, alpha: 0.7 }],
      bar: 40,
      frame: (_e, c) => (c.flash > 0 ? elite.f : elite.n)[fi4(c)],
      bob: (_e, c) => fi4(c) % 2,
      facing: towardHero,
      dead: () => elite.f[0],
    },
    caster: {
      top: 22,
      anchor: anchorOf(CASTER_ANCHOR, CASTER_W, CASTER_H),
      shadow: 'small',
      // 眼光放在杖头的鬼火上（淡淡的）
      eyes: [{ x: 6, y: -21, color: CYAN, alpha: 0.25 }],
      frame: (e, c) => (e.cast > 0 ? caster.cast.n[fi4(c) % 2] : (c.flash > 0 ? caster.float.f : caster.float.n)[fi4(c)]),
      bob: () => 0,
      facing: towardHero,
      dead: () => caster.float.f[0],
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 蓄力预警：天青碎光往杖头聚拢（不用光圈），配合杖头鬼火变大
        if (e.cast <= 0 || Math.random() >= 0.6) return;
        const fx0 = x + dir * 6;
        const fy0 = y - 21;
        const a = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * 6;
        ctx.glows.emit(fx0 + Math.cos(a) * r, fy0 + Math.sin(a) * r, 1, [CYAN, 0xffffff], [45, 60], [0.18, 0.24], { dir: a + Math.PI, spread: 0.2, drag: 0 });
      },
    },
    spearman: {
      top: 24,
      anchor: anchorOf(SPEARMAN_ANCHOR, SPEARMAN_W, SPEARMAN_H),
      shadow: 'small',
      eyes: [{ x: 1, y: -17, color: CYAN, alpha: 0.6 }],
      frame(e, c) {
        const [pose, i] = spearPose(e, c);
        return (c.flash > 0 ? spear[pose].f : spear[pose].n)[i];
      },
      bob: (e, c) => {
        const [pose, i] = spearPose(e, c);
        return pose === 'walk' ? i % 2 : pose === 'windup' || (pose === 'strike' && i === 0) ? 1 : 0;
      },
      facing: (e, hx) => (e.act && e.aimX !== undefined ? (e.aimX >= 0 ? 1 : -1) : towardHero(e, hx)),
      dead(e, c) {
        const [pose, i] = spearPose(e, c);
        return spear[pose].f[i];
      },
      decorate(_s, e, _c, x, y, dir, ctx) {
        // 蓄力满时矛尖一点灵光（几粒，往上飘）
        if (e.act === 'windup' && prog(e) > 0.5 && Math.random() < 0.35) ctx.glows.emit(x + dir * 17, y - 12, 1, [0xffe9a8, 0xffffff], [6, 16], [0.15, 0.3], { up: 8 });
      },
    },
    shieldbearer: {
      top: 25,
      big: true,
      anchor: anchorOf(SHIELD_ANCHOR, SHIELD_W, SHIELD_H),
      shadow: 'big',
      eyes: [{ x: -1, y: -17, color: CYAN, alpha: 0.55 }],
      frame(_e, c) {
        if (c.guard > 0) return shield.guard.n[c.guard > 0.12 ? 0 : 1];
        return (c.flash > 0 ? shield.walk.f : shield.walk.n)[fi4(c, 4)];
      },
      bob: (_e, c) => (c.guard > 0 ? 0 : fi4(c, 4) % 2),
      // 盾朝哪边，人就朝哪边（绕到背后时看得出它背对着你）
      facing: (e, hx) => (e.face !== undefined ? (Math.cos(e.face) >= 0 ? 1 : -1) : towardHero(e, hx)),
      dead: (_e, c) => shield.walk.f[fi4(c, 4)],
    },
    cavalry: {
      top: 30,
      big: true,
      anchor: anchorOf(CAVALRY_ANCHOR, CAVALRY_W, CAVALRY_H),
      shadow: 'big',
      eyes: [
        { x: -2, y: -22, color: CYAN, alpha: 0.55 }, // 骑将
        { x: 11, y: -21, color: CYAN, alpha: 0.4 }, // 鬼马
      ],
      frame(e, c) {
        const [pose, i] = horsePose(e, c);
        return (c.flash > 0 ? horse[pose].f : horse[pose].n)[i];
      },
      bob(e, c) {
        const [pose, i] = horsePose(e, c);
        return pose === 'walk' ? [0, 1, 0, -1][i] : pose === 'charge' ? i : 0;
      },
      facing: (e, hx) => (e.act && e.aimX !== undefined ? (e.aimX >= 0 ? 1 : -1) : towardHero(e, hx)),
      dead(e, c) {
        const [pose, i] = horsePose(e, c);
        return horse[pose].f[i];
      },
      decorate(s, e, c, x, y, dir, ctx) {
        if (e.act === 'strike') {
          // 冲锋：身后拖一串淡青的残影，蹄下扬起魂雾
          c.trail -= ctx.dt;
          if (c.trail <= 0) {
            c.trail = 0.045;
            ctx.ghost(s.texture, x, y, dir, [s.anchor.x, s.anchor.y], CYAN, 0.4, 0.3);
          }
          ctx.glows.emit(x - dir * 6 + (Math.random() - 0.5) * 14, y - 1, 1, [CYAN, 0x3f8a9e], [6, 20], [0.3, 0.6], { up: 6, drag: 3 });
        } else if (e.act === 'rest') {
          // 喘息：鬼马鼻孔里呼出两小团白气
          c.puff -= ctx.dt;
          if (c.puff <= 0) {
            c.puff = 0.55;
            ctx.sparks.emit(x + dir * 13, y - 19, 3, [0xc9bcae, 0xf2e8d5], [6, 14], [0.4, 0.7], { dir: dir > 0 ? 0.6 : Math.PI - 0.6, spread: 0.6, drag: 2, up: 4 });
          }
        } else if (e.act === 'windup' && Math.random() < 0.3) {
          // 预警：前蹄刨起的魂雾
          ctx.glows.emit(x + dir * 7, y - 1, 1, [CYAN, 0x3f8a9e], [10, 25], [0.25, 0.45], { up: 10, drag: 3 });
        }
      },
    },
    bomber: {
      top: 18,
      anchor: anchorOf(BOMBER_ANCHOR, BOMBER_W, BOMBER_H),
      shadow: 'small',
      eyes: [{ x: 2, y: -14, color: CYAN, alpha: 0.5 }],
      frame(e, c) {
        const [pose, i] = bombPose(e, c);
        return pose === 'float' && c.flash > 0 ? bomb.float.f[i] : bomb[pose].n[i];
      },
      bob: (e, c) => (e.act === 'fuse' ? -bombPose(e, c)[1] : [0, 1, 1, 0][fi4(c)]),
      facing: towardHero,
      dead: (e, c) => bomb[bombPose(e, c)[0]].f[bombPose(e, c)[1]],
      decorate(_s, e, c, x, y, dir, ctx) {
        if (e.act !== 'fuse') return;
        // 爆符从顶上烧起来：火星往上迸，越烧越密（不画光圈）
        const k = prog(e);
        const stage = k < 0.34 ? 0 : k < 0.68 ? 1 : 2;
        const tipX = x + dir * (2 + stage);
        const tipY = y - 11 + stage;
        if (Math.random() < 0.5 + k * 0.5) ctx.sparks.emit(tipX, tipY, 1 + Math.round(k * 2), [0xf7dc7a, 0xf2814a, 0xffe9a8, 0xd9452b], [20, 55], [0.15, 0.35], { dir: -Math.PI / 2, spread: 1.6, g: 120, drag: 1 });
        void c;
      },
    },
    splitter: {
      top: 22,
      anchor: anchorOf(SPLITTER_ANCHOR, SPLITTER_W, SPLITTER_H),
      shadow: 'small',
      eyes: [
        { x: -1, y: -14, color: CYAN, alpha: 0.45 },
        { x: 4, y: -14, color: CYAN, alpha: 0.45 },
      ],
      frame: (_e, c) => (c.flash > 0 ? split.f : split.n)[fi4(c, 5)],
      bob: (_e, c) => [0, 1, 1, 0][fi4(c, 5)],
      facing: towardHero,
      dead: (_e, c) => split.f[fi4(c, 5)],
      decorate(_s, _e, _c, x, y, dir, ctx) {
        // 接缝里偶尔漏出一粒魂光
        if (Math.random() < 0.06) ctx.glows.emit(x + dir * 1, y - 8 - Math.random() * 8, 1, [CYAN, 0xffffff], [4, 12], [0.3, 0.5], { up: 10 });
      },
    },
    splitling: {
      top: 13,
      anchor: anchorOf(SPLITLING_ANCHOR, SPLITLING_W, SPLITLING_H),
      shadow: 'small',
      eyes: [{ x: 2, y: -8, color: CYAN, alpha: 0.4 }],
      frame: (e, c) => (c.flash > 0 ? lings[e.id % 2].f : lings[e.id % 2].n)[fi4(c, 7)],
      bob: (_e, c) => [0, 1, 1, 0][fi4(c, 7)],
      facing: towardHero,
      dead: (e, c) => lings[e.id % 2].f[fi4(c, 7)],
    },
    // 第二章的三种（落魂幡手、红沙傀儡、风吼妖）和首领召出来的东西：画法在 ch2/foe-looks.ts
    ...ch2Looks(),
    // 第三章的三种（飞剑灵、截教门徒、阵图傀儡）：画法在 ch3/foe-looks.ts
    ...ch3Looks(),
  };
  return cache;
}

// ---------- 整块：包下 feel.ts syncViews 里画敌人的那一段 ----------

interface View {
  s: Sprite;
  /** 影子、眼光：各画在一层 ParticleContainer 里（flat-layer.ts；满场时几百个，做成场景节点每帧重建绘制指令太贵）。 */
  sh: Flat;
  eyes: Flat[];
  bar?: Graphics;
  kind: FoeViewKind;
  born: number;
  c: FoeClock;
  dead: Texture; // 死前那一帧姿势的闪白（死了就用它）
}

/**
 * 敌人的精灵：建、每帧换帧着色、眼光、精英血条、死亡（先闪白，再缩小消散）。和 feel.ts 现在的写法一致，只是按种类查表。
 * 接进 feel.ts：
 *   const enemies = new EnemyViews(stage, particles, glowParticles);
 *   onEvents 里每个事件先 enemies.onEvent(e)（hit 闪白、cast 举杖、foeGuard 亮符…）；
 *   syncViews 里画敌人的那一段换成 enemies.update(vdt, world, alpha, p.x)（被减速时动画也慢，已经算在里面）；
 *   reset / waveStart 时 enemies.clear()。击杀的魂散、精英现身的横幅还留在 feel.ts。
 */
/** 联机：敌人朝着离它最近的那个活着的人（模拟里它就是追他）；没有活着的就朝 hx。 */
function nearestX(w: World, e: Enemy, hx: number): number {
  let bd = Infinity;
  let bx = hx;
  for (const p of w.players) {
    if (!p.alive) continue;
    const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d < bd) {
      bd = d;
      bx = p.x;
    }
  }
  return bx;
}

export class EnemyViews {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private views = new Map<number, View>();
  private dying: { s: Sprite; t: number }[] = [];
  private ghosts: { s: Sprite; t: number; life: number; a0: number }[] = [];
  private eyeTex: Texture;
  private layer: Container;
  /** 影子（大、小两张排在一张图集里）一层，在贴地层里；眼光一层，在辉光层里（加法混合，前后次序不影响画出来的样子）。 */
  private shadowTex: Texture[];
  private shadows: FlatLayer;
  private eyeLayer: FlatLayer;
  private ctx: FoeDecorCtx;
  /**
   * 一只敌人的精灵要撤掉的那一刻（死了、自爆、被收走）：给别的模块接管死亡的画面（xfx.ts 的魂散），
   * 返回 true 就不放这里的闪白压扁。x / y 是最后画的脚底位置，dir 是最后的朝向。
   */
  onDeath: ((id: number, kind: FoeViewKind, x: number, y: number, dir: 1 | -1) => boolean) | null = null;

  constructor(stage: Stage, sparks: Particles, glows: Particles) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.eyeTex = steppedLightTexture(3, 2);
    this.layer = stage.fx; // 血条画在特效层
    // 影子这一层现在就放进贴地层：排在已经建好的预警层（boss-fx 建的）、法宝的地面效果之上，和原来每个影子后建、叠在它们上面一样。
    // 影子都是同一种玄色，彼此谁压谁画出来都一样
    this.shadowTex = atlasFromGrids('shadow', [SHADOW, SMALL_SHADOW]);
    // 两层都只画镜头里的（满场时有一半在画面外）
    this.shadows = new FlatLayer(stage.floor, this.shadowTex[0], { cull: camCull(stage.cam) });
    this.eyeLayer = new FlatLayer(stage.glow, this.eyeTex, { cull: camCull(stage.cam) });
    this.ctx = {
      sparks,
      glows,
      dt: 0,
      ghost: (t, x, y, dir, anchor, tint, alpha, life) => {
        const s = new Sprite(t);
        s.anchor.set(anchor[0], anchor[1]);
        s.scale.x = dir;
        s.position.set(Math.round(x), Math.round(y));
        s.zIndex = y - 1;
        s.tint = tint;
        s.alpha = alpha;
        stage.entities.addChild(s);
        this.ghosts.push({ s, t: 0, life, a0: alpha });
      },
    };
    foeLooks();
  }

  /** 这只敌人的表现层计时（enemy-fx 等也可以读，比如引信闪烁的节拍）。 */
  clock(id: number): FoeClock | undefined {
    return this.views.get(id)?.c;
  }

  onEvent(e: SimEvent) {
    switch (e.t) {
      case 'hit': {
        const v = this.views.get(e.id);
        const dot = e.by === 'burn' || e.by === 'bleed' || e.by === 'zone'; // 持续伤害不闪白
        if (v && !dot) v.c.flash = 0.07;
        break;
      }
      case 'foeGuard': {
        const v = this.views.get(e.id);
        if (v) v.c.guard = 0.22;
        break;
      }
      case 'foeFuse': {
        const v = this.views.get(e.id);
        if (v) v.c.fuseT = 0;
        break;
      }
    }
  }

  clear() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
    this.shadows.flush();
    this.eyeLayer.flush();
    for (const d of this.dying) d.s.destroy();
    this.dying = [];
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
  }

  private drop(v: View) {
    v.s.destroy();
    this.shadows.remove(v.sh);
    for (const e of v.eyes) this.eyeLayer.remove(e);
    v.bar?.destroy();
  }

  /** 每帧：dt 表现层时间（命中停顿时是 0），alpha 插值，hx 人物的 x（敌人朝向用）。 */
  update(dt: number, w: World, alpha: number, hx: number) {
    const looks = foeLooks();
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.ctx.dt = dt;
    const seen = new Set<number>();
    for (const e of w.enemies) {
      // 精英按 Enemy.elite 分种类、按词缀换身上的颜色（elites/looks.ts）；首领由 boss-fx 画
      const look = e.kind === 'elite' ? eliteLook(e) : looks[e.kind as FoeViewKind];
      if (!look) continue;
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        const c: FoeClock = { t: Math.random() * 4, flash: 0, guard: 0, fuseT: 0, trail: 0, puff: 0.2 };
        const s = new Sprite(look.frame(e, c));
        s.anchor.set(look.anchor[0], look.anchor[1]);
        this.stage.entities.addChild(s);
        const sh = this.shadows.add(this.shadowTex[look.shadow === 'big' ? 0 : 1], 0.5, 0.5);
        sh.tint(0xffffff, 0.3);
        const eyes = look.eyes.map((o) => {
          const g = this.eyeLayer.add(this.eyeTex, 0.5, 0.5);
          g.tint(o.color, o.alpha);
          return g;
        });
        let bar: Graphics | undefined;
        if (look.bar) {
          bar = new Graphics();
          this.layer.addChild(bar);
        }
        v = { s, sh, eyes, bar, kind: e.kind as FoeViewKind, born: 0, c, dead: look.dead(e, c) };
        this.views.set(e.id, v);
        this.glows.emit(e.x, e.y - 6, look.big ? 14 : 4, [0x3f8a9e, CYAN], [10, 30], [0.3, 0.5], { up: 10 });
      }
      // 计时：被减速的敌人，走路动画也慢下来
      v.c.t += dt * (e.slowT > 0 ? 1 - e.slow * 0.85 : 1);
      v.born += dt;
      v.c.flash = Math.max(0, v.c.flash - dt);
      v.c.guard = Math.max(0, v.c.guard - dt);
      if (e.act === 'fuse') v.c.fuseT += dt;
      const x = Math.round(lerp(e.px, e.x));
      const y = Math.round(lerp(e.py, e.y));
      // 被黑虎震慑的：转过身背着人物逃（sim/pets/heihu.ts；吓一跳那一顿时还朝着原来的方向）
      const fled = e.fearUntil !== undefined && w.time < e.fearUntil && e.stun <= 0 && e.fearDx !== undefined && e.kind !== 'boss';
      // 被毫毛猴戏弄的（sim/pets/maohou.ts）：东张西望——时不时扭头看身后（找那只猴），身子左右晃（下面 rotation）
      const teased = e.teaseUntil !== undefined && w.time < e.teaseUntil && e.stun <= 0 && e.kind !== 'boss';
      const face = fled ? (e.fearDx! >= 0 ? 1 : -1) : look.facing(e, w.players.length > 1 ? nearestX(w, e, hx) : hx);
      const dir: 1 | -1 = teased && Math.floor(v.c.t * 1.6 + e.id * 0.37) % 3 === 0 ? (face > 0 ? -1 : 1) : face;
      v.s.texture = look.frame(e, v.c);
      v.dead = look.dead(e, v.c);
      v.s.scale.set(dir, 1);
      v.s.alpha = Math.min(1, v.born / 0.3) * (0.88 + 0.08 * Math.sin(v.c.t * 7));
      // 状态着色：冻住泛冰蓝、烧着泛橘并冒火星；套着金光力士的金光（elites/）的一身泛着淡金，慢慢明灭
      if (e.frozen > 0) v.s.tint = 0x9fd8ff;
      else if (e.burnT > 0) {
        v.s.tint = Math.sin(v.c.t * 20) > 0 ? 0xffc090 : 0xffe0c0;
        if (Math.random() < 0.08) this.sparks.emit(x + (Math.random() - 0.5) * 8, y - 10 - Math.random() * 8, 1, [0xf2814a, 0xd9452b], [5, 15], [0.2, 0.4], { up: 18 });
      } else if (e.aegis && aegisLeft(w, e)) v.s.tint = Math.sin(v.c.t * 3.4) > 0.2 ? 0xffe8b0 : 0xfff3d4;
      else v.s.tint = 0xffffff;
      v.s.position.set(x, y);
      v.s.zIndex = y;
      if (!v.s.visible || v.s.rotation) {
        // 从云霄的金斗里喷出来、落回场上的（下面那一段藏过、转过、缩过）：摆回原样
        v.s.visible = v.sh.visible = true;
        v.sh.alpha = 0.3;
        for (const g of v.eyes) g.visible = true;
      }
      v.s.rotation = teased ? Math.sin(v.c.t * 9 + e.id) * 0.14 : 0;
      v.sh.x = x;
      v.sh.y = y;
      const bob = look.bob(e, v.c);
      for (let k = 0; k < look.eyes.length; k++) {
        const o = look.eyes[k];
        const g = v.eyes[k];
        g.x = x + dir * o.x;
        g.y = y + o.y + bob;
      }
      look.decorate?.(v.s, e, v.c, x, y, dir, this.ctx);
      // 潜在水里的东海夜叉（elites/）：身子、眼光、影子、血条都藏起来（沉下去的那一下 dive 还画着，水下的涟漪在 elites/fx.ts）
      const under = !!e.hidden;
      v.s.visible = !under || e.act === 'dive';
      v.sh.visible = !under;
      for (const g of v.eyes) g.visible = !under;
      if (v.bar) v.bar.visible = !under;
      if (v.bar && look.bar && !under) {
        const bw = 22;
        v.bar
          .clear()
          .rect(x - bw / 2 - 1, y - look.bar, bw + 2, 3)
          .fill({ color: 0x1a1520 })
          .rect(x - bw / 2, y - look.bar + 1, Math.max(0, (bw * e.hp) / e.maxHp), 1)
          .fill({ color: 0xd9452b });
      }
    }
    // 云霄的混元金斗里的（暂时不在 w.enemies 里，不算死）：被吸进去的那一段边转边缩、落进斗口，在斗里藏着，喷出来那一段翻着跟头抛出去
    const now = renderTime(w, alpha);
    for (const [e, d, i] of heldEnemies(w)) {
      const v = this.views.get(e.id);
      const look = looks[e.kind as FoeViewKind];
      if (!v || !look) continue;
      seen.add(e.id);
      const hp = heldPose(d, i, now);
      for (const g of v.eyes) g.visible = !hp ? false : hp.s > 0.7;
      if (v.bar) v.bar.clear();
      if (!hp) {
        v.s.visible = v.sh.visible = false;
        continue;
      }
      v.c.t += dt * 2;
      v.c.flash = Math.max(0, v.c.flash - dt);
      v.s.visible = v.sh.visible = true;
      v.s.texture = look.frame(e, v.c);
      const dir = v.s.scale.x < 0 ? -1 : 1;
      v.s.scale.set(dir * hp.s, hp.s);
      v.s.rotation = hp.spin;
      v.s.alpha = hp.a;
      v.s.position.set(Math.round(hp.x), Math.round(hp.y - hp.z));
      v.s.zIndex = Math.round(hp.y);
      v.sh.x = Math.round(hp.x);
      v.sh.y = Math.round(hp.y);
      v.sh.alpha = 0.3 * Math.max(0.2, 1 - hp.z / 30);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      // 死亡（或自爆）：先闪白一下（死前那一帧的姿势），再缩小消散；被打死的由 onDeath 接管（魂散）
      if (this.onDeath?.(id, v.kind, v.s.x, v.s.y, v.s.scale.x < 0 ? -1 : 1)) v.s.destroy();
      else {
        v.s.texture = v.dead;
        this.dying.push({ s: v.s, t: 0 });
      }
      this.shadows.remove(v.sh);
      for (const g of v.eyes) this.eyeLayer.remove(g);
      v.bar?.destroy();
      this.views.delete(id);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      const k = 1 - d.t / 0.14;
      if (k <= 0) {
        d.s.destroy();
        this.dying.splice(i, 1);
        continue;
      }
      d.s.scale.y = k;
      d.s.alpha = k;
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = g.a0 * (1 - k) * (1 - k);
    }
    this.shadows.flush();
    this.eyeLayer.flush();
  }
}
