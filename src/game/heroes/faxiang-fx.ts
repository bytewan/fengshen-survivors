// 孙悟空神通「法天象地」的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件（skill kind 'faxiang'、stomp）和 Player.faxiang。
// 放的那一下：脚下卷起一股金色的尘、往上升几粒金屑，人物在约 0.35 秒里一档一档长到 1.5 倍（每一档都是 Scale2x 放大后再取样的一整套帧，
// 像素不糊、不出锯齿）；长足的那一下脚下一震：一圈尘土贴着地往外掀到震开的半径、地上崩开几道细缝、碎石崩起。
// 大身形期间：走起来脚下一步一团土（身子沉），肩头偶尔飘起一粒金屑；到点在 0.45 秒里缩回原样，缩的时候身上散出一小团金烟。
// 用户口径：不要光圈（震开的是一圈掀起来的尘土，不是亮环）；出现和消失都有过程（长大、缩回都是一档一档地变）。
import type { Sprite, Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { flashTextureFromGrid, textureFromGrid } from '../../render/textures.ts';
import { ROCKS } from '../../art/sprites/fx.ts';
import { FAXIANG } from '../../sim/heroes/wukong.ts';
import type { HeroId, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { heroFrames, HERO_POSES, HERO_VIEWS, type HeroPose } from '../hero-views.ts';
import { bigFrame } from '../technique-fx.ts';
import { Bits, C, puffSet, rnd, Ts } from '../fx.ts';

const TAU = Math.PI * 2;
const DUST = [0x6b5749, 0x776672, 0x4f5652, 0xb3b8a6];
/** 长大时一档一档换的倍数（最后一档就是 FAXIANG.scale）。 */
const STEPS = [1.125, 1.25, 1.375, FAXIANG.scale];

/** feel.ts 交给这里的东西：第 i 个人物的精灵、这个角色的人物纹理（换成放大的那一张时按纹理查）。 */
export interface FaxiangHook {
  sprite: (owner: number) => Sprite | undefined;
  tex?: (hero: HeroId) => { tex: Record<HeroPose, Texture[]>; flash: Record<HeroPose, Texture[]> };
}

interface Look {
  k: number; // 0 原样 … 1 长足（画面上的进度）
  on: boolean; // 上一帧是不是大身形
  step: number; // 现在用的是第几档（-1 = 原样）
  stepT: number; // 下一团脚下的土
  sprite: Sprite | null;
}

export class FaxiangFx {
  private big = new Map<Texture, Texture[]>();
  private anchors: [number, number][] = [];
  private built = new Set<HeroId>();
  private looks = new Map<number, Look>();
  private bits: Bits;
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hook: FaxiangHook;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, hook: FaxiangHook) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.hook = hook;
    this.bits = new Bits(stage.fx, stage.entities);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    // 一局重开、一波开始或结束：已经缩回去的不管；还大着的下一帧按模拟的状态慢慢缩回去
  }

  /** 这个角色每一帧的几档放大版（只建一次）。 */
  private build(hero: HeroId) {
    if (this.built.has(hero)) return;
    const T = this.hook.tex?.(hero);
    if (!T) return;
    this.built.add(hero);
    const frames = heroFrames(hero);
    for (const pose of HERO_POSES)
      frames[pose].forEach((g, i) => {
        const bigs = STEPS.map((k) => bigFrame(g, k));
        if (T.tex[pose]?.[i]) this.big.set(T.tex[pose][i], bigs.map(textureFromGrid));
        if (T.flash[pose]?.[i]) this.big.set(T.flash[pose][i], bigs.map(flashTextureFromGrid));
      });
    const v = HERO_VIEWS[hero];
    const g0 = frames.idle[0];
    this.anchors = STEPS.map((k) => {
      const b = bigFrame(g0, k);
      return [Math.round(v.anchor.x * k) / b.w, Math.round(v.anchor.y * k + 0.5) / b.h];
    });
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'skill' && e.kind === 'faxiang') {
      const p = w.players[e.owner];
      if (!p) return;
      this.build(p.hero);
      this.play('faxiang.grow', 'jinbian.raise', 0.9);
      // 脚下卷起一股金色的尘、往上升几粒金屑
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        this.bits.spawn(e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 4, { frames: puffSet(3, 'gold', 1 + (k % 3)), life: rnd(0.4, 0.6), vx: -Math.sin(a) * 16, vy: Math.cos(a) * 6 - 10, drag: 2.5, fadeIn: 0.05, fadeOut: 0.3, z: true, zOff: 1 });
      }
      this.glows.emit(e.x, e.y - 6, 10, [C.Y, C.f, C.y], [10, 30], [0.5, 0.9], { up: 34, drag: 2 });
      return;
    }
    if (e.t === 'stomp') {
      this.play('faxiang.stomp', 'fantian.land', 1);
      this.shake.add(0.35);
      // 一圈尘土贴着地往外掀到震开的半径（尘土本身就是那一圈，不画亮环）；碎石崩起
      const n = Math.max(14, Math.round(e.r / 3));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rnd(-0.1, 0.1);
        const d0 = 10;
        const sp = (e.r - d0) / 0.42;
        this.bits.spawn(e.x + Math.cos(a) * d0, e.y + Math.sin(a) * d0 * 0.62, { frames: puffSet(pickR(k), 'stone', 1 + (k % 3)), life: rnd(0.5, 0.65), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.62 - 3, drag: 1.6, fadeIn: 0.03, fadeOut: 0.3, z: true, zOff: 2 });
        if (k % 3 === 0) this.bits.spawn(e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 4, { frames: [Ts('rocks', () => ROCKS)[k % ROCKS.length]], life: 0.7, vx: Math.cos(a) * rnd(30, 60), vy: -rnd(60, 100), g: 340, ground: e.y + Math.sin(a) * rnd(6, 14), bounce: 0.3, fadeOut: 0.25 });
      }
      this.sparks.emit(e.x, e.y - 2, 10, DUST, [30, 80], [0.3, 0.6], { up: 30, g: 200, drag: 1.5 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    for (const p of w.players) {
      if (p.hero !== 'wukong') continue;
      this.build(p.hero);
      let L = this.looks.get(p.id);
      const s = this.hook.sprite(p.id) ?? null;
      if (!L || L.sprite !== s) {
        L = { k: 0, on: false, step: -1, stepT: 0, sprite: s };
        this.looks.set(p.id, L);
      }
      if (!s) continue;
      const f = p.faxiang;
      const on = !!f && f.wave === w.wave && w.time < f.until && w.phase === 'wave' && p.alive;
      // 长大 FAXIANG.grow 秒、缩回 FAXIANG.shrink 秒，一档一档地变
      L.k = on ? Math.min(1, L.k + dt / FAXIANG.grow) : Math.max(0, L.k - dt / FAXIANG.shrink);
      if (L.on && !on) {
        this.play('faxiang.end', 'tech.breath', 0.7);
        const x = p.px + (p.x - p.px) * alpha;
        const y = p.py + (p.y - p.py) * alpha;
        for (let k = 0; k < 8; k++) this.bits.spawn(x + rnd(-8, 8), y - rnd(4, 26), { frames: puffSet(3, 'gold', 1 + (k % 3)), life: rnd(0.4, 0.6), vx: rnd(-10, 10), vy: -rnd(4, 14), drag: 2, fadeIn: 0.04, fadeOut: 0.3 });
      }
      L.on = on;
      const step = L.k <= 0 ? -1 : Math.min(STEPS.length - 1, Math.floor(L.k * STEPS.length - 1e-6));
      const bigs = step >= 0 ? this.big.get(s.texture) : undefined;
      if (bigs && step >= 0) {
        s.texture = bigs[step];
        s.anchor.set(this.anchors[step][0], this.anchors[step][1]);
      } else if (L.step >= 0) {
        const v = HERO_VIEWS[p.hero];
        s.anchor.set(v.anchor.x / v.w, v.anchor.y / v.h);
      }
      L.step = bigs ? step : -1;
      if (!on) continue;
      // 大身形：走起来脚下一步一团土，肩头偶尔飘起一粒金屑
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      L.stepT -= dt;
      if (p.moving && L.stepT <= 0) {
        L.stepT = 0.28;
        this.bits.spawn(x + rnd(-4, 4), y + 1, { frames: puffSet(3, 'stone', 1 + Math.floor(Math.random() * 3)), life: rnd(0.35, 0.5), vx: rnd(-8, 8), vy: -3, drag: 3, fadeIn: 0.03, fadeOut: 0.25, z: true, zOff: -1 });
      }
      if (Math.random() < dt * 3) this.glows.emit(x + rnd(-7, 7), y - rnd(24, 34), 1, [C.Y, C.f], [4, 10], [0.5, 0.8], { up: 10, drag: 2 });
    }
    this.bits.update(dt);
  }
}

const pickR = (k: number) => (k % 4 === 0 ? 4 : 3);
