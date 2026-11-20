// 首领「魔化哪吒」的画面：本体（姿势、受击闪白、身上往上飘的黑焰粒子、头顶血条）、三头六臂的残影、
// 每一招的地面预警和招式本体（黑焰乾坤圈、突进的残影与火焰拖尾、混天绫红绸、燃烧的风火轮）、入场的黑焰、换阶段爆黑焰、
// 倒下时黑焰散成灰。只读模拟状态（world.boss、首领本体）和事件，不回写模拟。
// 预警是地上的淡红光（用户 2026-11-10 定，画法见 warn-fx.ts）：形状就是 boss.ts 里每个危险物的判定范围，按人物脚下算——
//   火尖枪突进（本体和残影）：突进线两侧各 hw + 1 = 15 像素、两头圆（updateHazards 的 dash：segDist < h.r + 1）；
//   黑焰乾坤圈：圈在胸口高度飞，判定量的是人物胸口（脚下往上 8 像素）离路线 < h.r + 人物半径 = 17，
//     所以地上的光带是路线往下挪 8 像素、两侧各 17 像素；
//   风火轮：车道两侧各 火轮半径 + 人物半径 = 14 像素；
//   混天绫横扫：半径 h.r + 人物半径 = 215 的半圆，起始边那一侧多出 人物半径 − 1 = 4 像素（红绫和身子有重叠就算打中）。
// 亮红随预警推进（直线从起点推到终点，横扫沿扫的方向），推满就出手；出手时整块闪一下，之后突进的人、滚过的火轮、
// 扫过的红绫身后那一截慢慢淡掉，前面还危险的保持亮着；乾坤圈飞出去时整条都亮着（还要飞回来），折返后飞过的那头淡掉。
// 魔焰焚城往里推之前的提示是魔气前沿翻涌（stage.setMiasmaAgitation），不是地面预警，不在这里画。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { HitStop, Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { flashTextureFromGrid, textureFromGrid } from '../render/textures.ts';
import { DEMON_ANCHOR, DEMON_FRAMES, DEMON_H, DEMON_RING, DEMON_W, DEMON_WHEEL, type DemonPose } from '../art/sprites/demon-nezha.ts';
import { BOSS, DT, PLAYER } from '../sim/config.ts';
import { bossEnemy, bossPose, nezhaOf, type BossFight, type Hazard } from '../sim/boss.ts';
import { fightOf } from '../sim/bosspool.ts';
import { Leaving, guestAsBoss } from './guest-fx.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { LaneWarn, SweepWarn, warmWarnTextures, warnLayer, type WarnLayer } from './warn-fx.ts';

/** 调色板里的颜色（十六进制数），粒子和线条用。 */
const C = { k: 0x1a1520, d: 0x2e2433, g: 0x4a3b4a, P: 0x4b2a4f, p: 0x8a4a7a, R: 0x5c1a1b, r: 0x9c2a22, e: 0xd9452b, o: 0xf2814a, Y: 0xf7dc7a, h: 0x6b5a62, i: 0x9a8a86, j: 0xc9bcae, w: 0xf2e8d5 };
const BLACK_FLAME = [C.k, C.d, C.P, C.P, C.d];
const EMBER = [C.R, C.r, C.P, C.d];
const ASH = [C.h, C.i, C.j, C.g];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k * k * (3 - 2 * k);
/** 乾坤圈的判定量在人物胸口（脚下往上这么多，boss.ts 的 ring：p.y − 8）；地上的光带按脚下画，比路线低这么多。 */
const RING_CHEST = 8;

// ---------- 像素线 ----------
/** 一像素宽的像素线（整数坐标）。只加形状，调用方自己 fill。 */
function pixLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

// ---------- 纹理 ----------
type PoseTex = Record<DemonPose, Texture[]>;
let texCache: { body: PoseTex; flash: PoseTex; ring: Texture[]; wheel: Texture[] } | null = null;
function textures() {
  if (texCache) return texCache;
  const mk = (f: typeof textureFromGrid) => Object.fromEntries(Object.entries(DEMON_FRAMES).map(([k, v]) => [k, v.map(f)])) as PoseTex;
  texCache = { body: mk(textureFromGrid), flash: mk(flashTextureFromGrid), ring: DEMON_RING.map(textureFromGrid), wheel: DEMON_WHEEL.map(textureFromGrid) };
  return texCache;
}
/** 每个姿势的帧率。 */
const FPS: Record<DemonPose, number> = { idle: 5, walk: 10, bare: 5, raise: 6, throw: 1, charge: 8, dash: 12, recover: 4, cast: 6, sweepUp: 6, sweep: 1, roar: 8, kneel: 1 };

// ---------- 每个危险物的画面 ----------
interface HazView {
  h: Hazard; // 模拟里的那个对象（移除之后留着最后的状态）
  warn: LaneWarn | SweepWarn; // 地上的淡红光
  silk: Graphics | null; // 混天绫（横扫）：每帧重画的红绸
  spr: Sprite | null; // 圈或火轮本体
  ghosts: Sprite[];
  hist: [number, number][];
  sh: Graphics | null; // 火轮的影子
  t: number;
  gone: number; // -1 = 还在；否则是消失了多久
  turned: boolean; // 乾坤圈已经折返
  head: number; // 突进的人、滚着的火轮、乾坤圈沿线走到哪了（像素）
}

interface Clone {
  s: Sprite;
  src: number;
  t: number;
  gone: number;
  x: number;
  y: number;
}

interface Ghost {
  s: Sprite;
  t: number;
  life: number;
  a0: number;
}

export class BossFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private hitStop: HitStop;
  private sfx: Sfx;
  private warns: WarnLayer;
  private floorLayer = new Container();
  private airLayer = new Container();
  private views = new Map<number, HazView>();
  private clones = new Map<number, Clone>();
  private ghosts: Ghost[] = [];
  private body: Sprite | null = null;
  private shadow: Sprite | null = null;
  private bar = new Graphics();
  private bossId = -1;
  private animT = 0;
  private flash = 0;
  private born = 0; // 入场过了多久
  private emberT = 0;
  private trailT = 0;
  private hurtSfxT = 0;
  private phaseT = -1; // 换阶段爆黑焰的计时
  private corpse: { s: Sprite; x: number; y: number; t: number; fade: number; facing: number } | null = null;
  /** 来遭遇战（首领池，sim/bosspool.ts）时：退走的身子慢慢淡出去；打倒了的不等对白，跪一会儿自己散（guestGone > 0 是还剩多久）。 */
  private leaving: Leaving;
  private guestGone = 0;
  private lastPose: DemonPose = 'idle';

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, hitStop: HitStop, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.hitStop = hitStop;
    this.sfx = sfx;
    this.leaving = new Leaving(sparks);
    textures();
    this.warns = warnLayer(stage); // 先建预警层：它在地面层里排在红绫、火轮影子之下
    warmWarnTextures({
      lanes: [BOSS.dash.hw + 1, BOSS.ring.r + PLAYER.radius, BOSS.wheels.r + PLAYER.radius],
      sweeps: [[BOSS.sweep.r + PLAYER.radius, PLAYER.radius - 1]],
      chevrons: [[2, false], [3, true]],
    });
    stage.floor.addChild(this.floorLayer);
    stage.fx.addChild(this.airLayer, this.bar);
  }

  /** 倒下的首领还在不在场上（表现层用来定镜头、等它散去）。 */
  get focus(): { x: number; y: number } | null {
    return this.corpse && !this.guestGone && this.corpse.fade < 1 ? { x: this.corpse.x, y: this.corpse.y } : null;
  }

  /** 清空（重开一局、新的一波开始）。 */
  clear() {
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    for (const c of this.clones.values()) c.s.destroy();
    this.clones.clear();
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
    this.body?.destroy();
    this.shadow?.destroy();
    this.body = this.shadow = null;
    this.corpse?.s.destroy();
    this.corpse = null;
    this.leaving.clear();
    this.guestGone = 0;
    this.bar.clear();
    this.bossId = -1;
    this.phaseT = -1;
  }

  /** 对白结束：跪着的魔化哪吒化灰散去。 */
  dissolve() {
    if (this.corpse && this.corpse.fade <= 0) this.corpse.fade = 0.0001;
  }

  private dropView(v: HazView) {
    v.warn.destroy();
    v.silk?.destroy();
    v.spr?.destroy();
    v.sh?.destroy();
    for (const g of v.ghosts) g.destroy();
  }

  onEvent(e0: SimEvent, w: World, now: number) {
    const ft = fightOf(w);
    if (ft && ft.kind !== 'nezha') return; // 别的首领（姚天君、诛仙剑灵、回响那一族）由它们自己的画面管
    const e = guestAsBoss(e0, 'nezha'); // 来遭遇战：现身、换阶段、倒下的画面和当首领时同一套（guest-fx.ts）
    switch (e.t) {
      case 'echoLeave':
        // 这一波结束还没打倒：收起招式，身子留在原地慢慢淡成一缕黑烟
        if (e.kind !== 'nezha') break;
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        for (const c of this.clones.values()) if (c.gone < 0) c.gone = 0;
        this.leaving.add([this.body, this.shadow], e.x, e.y, BLACK_FLAME);
        this.body = this.shadow = null;
        this.bar.clear();
        break;
      case 'bossIntro':
        this.clear();
        this.bossId = e.id;
        this.born = 0;
        this.shake.add(0.35);
        // 入场：一柱黑焰从地上卷起来，人从黑焰里慢慢显出来
        for (let i = 0; i < 26; i++) this.sparks.emit(e.x + (Math.random() - 0.5) * 14, e.y - Math.random() * 6, 1, BLACK_FLAME, [8, 30], [0.6, 1.2], { up: 34, drag: 1.5, dir: -Math.PI / 2, spread: 1.2, scale: Math.random() < 0.3 ? 2 : 1 });
        this.sfx.play('boss.intro');
        break;
      case 'bossMove':
        if (e.move === 'clones') this.sfx.play('boss.clone');
        break;
      case 'bossCast': {
        const h = nezhaOf(w)?.hazards.find((x) => x.id === e.hazard);
        if (h) this.addView(h);
        this.sfx.play(e.kind === 'ring' ? 'boss.ring.warn' : e.kind === 'dash' ? 'boss.dash.charge' : e.kind === 'sweep' ? 'boss.sweep.warn' : 'boss.wheel.warn');
        break;
      }
      case 'bossStrike': {
        this.sfx.play(e.kind === 'ring' ? 'boss.ring.throw' : e.kind === 'dash' ? 'boss.dash' : e.kind === 'sweep' ? 'boss.sweep' : 'boss.wheel');
        if (e.kind === 'dash') this.shake.add(0.08);
        if (e.kind === 'sweep') this.shake.add(0.12);
        const v = this.views.get(e.hazard);
        if (v && e.kind === 'ring') {
          // 圈出手：手边迸出一点黑红火星
          this.sparks.emit(e.x, e.y, 6, EMBER, [20, 60], [0.2, 0.4], { drag: 4 });
        }
        break;
      }
      case 'bossPhase': {
        this.phaseT = 0;
        this.shake.add(0.55);
        this.hitStop.trigger(now, 0.08);
        // 身上爆出黑焰：往上卷、往四周散，夹着殷红的火星
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2;
          this.sparks.emit(e.x + Math.cos(a) * 4, e.y - 12 + Math.sin(a) * 6, 1, i % 5 === 0 ? EMBER : BLACK_FLAME, [30, 110], [0.5, 1.1], { dir: a, spread: 0.4, up: 20, drag: 2.2, scale: i % 4 === 0 ? 2 : 1 });
        }
        // 地上一圈往外散的黑烟（粒子，不是光圈）
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          this.sparks.emit(e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 6, 1, [C.d, C.P, C.k], [60, 90], [0.45, 0.7], { dir: a, spread: 0.1, drag: 3 });
        }
        this.sfx.play('boss.phase');
        this.sfx.play('boss.roar');
        break;
      }
      case 'bossMiasmaWarn':
        break;
      case 'bossMiasma':
        this.shake.add(0.18);
        this.sfx.play('boss.miasma');
        break;
      case 'hit':
        if (e.id === this.bossId && e.by !== 'burn') {
          this.flash = 0.06;
          this.hurtSfxT -= 1;
          if (this.hurtSfxT <= 0) {
            this.hurtSfxT = 6;
            this.sfx.play('boss.hurt', 0.6);
          }
        }
        break;
      case 'bossDeath': {
        this.hitStop.trigger(now, 0.18);
        this.shake.add(0.75);
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        for (const c of this.clones.values()) if (c.gone < 0) c.gone = 0;
        // 跪倒的魔化哪吒留在原地，黑焰从身上剥落、化成灰往上飘
        const s = new Sprite(textures().flash.kneel[0]);
        s.anchor.set(DEMON_ANCHOR.x / DEMON_W, DEMON_ANCHOR.y / DEMON_H);
        s.position.set(Math.round(e.x), Math.round(e.y));
        s.scale.x = e.facing;
        s.zIndex = e.y;
        this.stage.entities.addChild(s);
        this.corpse = { s, x: e.x, y: e.y, t: 0, fade: 0, facing: e.facing };
        this.body?.destroy();
        this.body = null;
        this.bar.clear();
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2;
          this.sparks.emit(e.x + Math.cos(a) * 5, e.y - 12 + Math.sin(a) * 8, 1, i % 3 ? BLACK_FLAME : EMBER, [40, 140], [0.5, 1.0], { dir: a, spread: 0.3, drag: 2.5, up: 12, scale: i % 5 === 0 ? 2 : 1 });
        }
        this.glows.emit(e.x, e.y - 14, 18, [C.w, C.j], [30, 90], [0.2, 0.45], { drag: 3 });
        this.sfx.play('boss.death');
        this.guestGone = e0.t === 'echoDefeat' ? 1.3 : 0; // 遭遇战：没有战后对白，跪一会儿自己散
        break;
      }
    }
  }

  private addView(h: Hazard) {
    if (this.views.has(h.id)) return;
    let warn: LaneWarn | SweepWarn;
    let silk: Graphics | null = null;
    switch (h.kind) {
      case 'dash':
        // 地上一道光带，中间一排箭头随蓄力一节一节亮起来
        warn = new LaneWarn(this.warns, h.x0, h.y0, h.x1, h.y1, h.r + 1, BOSS.dash.speed, { every: 14, start: 10, size: 3, thick: true });
        break;
      case 'ring':
        // 往返路线的地上投影（按脚下算，比胸口高度的路线低 RING_CHEST），双箭头「»」
        warn = new LaneWarn(this.warns, h.x0, h.y0 + RING_CHEST, h.x1, h.y1 + RING_CHEST, h.r + PLAYER.radius, BOSS.ring.speed, { every: 18, start: 16, end: 6, size: 2, double: true });
        break;
      case 'sweep':
        warn = new SweepWarn(this.warns, h.x0, h.y0, h.r + PLAYER.radius, h.a0, h.dir, PLAYER.radius - 1);
        silk = new Graphics();
        this.floorLayer.addChild(silk);
        break;
      case 'wheel':
        // 车道：中间顺着滚的方向一排箭头（车道很长，只显示镜头附近的）
        warn = new LaneWarn(this.warns, h.x0, h.y0, h.x1, h.y1, h.r + PLAYER.radius, BOSS.wheels.speed, { every: 20, start: 12, size: 3, thick: true });
        break;
    }
    const v: HazView = { h, warn, silk, spr: null, ghosts: [], hist: [], sh: null, t: 0, gone: -1, turned: false, head: 0 };
    if (h.kind === 'ring') {
      const tx = textures();
      v.spr = new Sprite(tx.ring[0]);
      v.spr.anchor.set(0.5);
      v.spr.visible = false;
      v.ghosts = [0.32, 0.16].map((a) => {
        const g = new Sprite(tx.ring[0]);
        g.anchor.set(0.5);
        g.alpha = a;
        g.tint = C.p;
        g.visible = false;
        this.airLayer.addChild(g);
        return g;
      });
      this.airLayer.addChild(v.spr);
    } else if (h.kind === 'wheel') {
      const tx = textures();
      v.spr = new Sprite(tx.wheel[0]);
      v.spr.anchor.set(0.5, 0.5);
      v.spr.visible = false;
      this.stage.entities.addChild(v.spr);
      v.sh = new Graphics().ellipse(0, 0, 7, 2).fill({ color: C.k, alpha: 0.28 });
      v.sh.visible = false;
      this.stage.floor.addChild(v.sh);
    }
    this.views.set(h.id, v);
  }

  update(dt: number, w: World, alpha: number) {
    const f = nezhaOf(w);
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt);
    const live = new Set<number>();
    if (f) for (const h of f.hazards) live.add(h.id);
    for (const [id, v] of this.views) {
      v.t += dt;
      if (v.gone < 0 && !live.has(id)) v.gone = 0;
      if (v.gone >= 0) v.gone += dt;
      const done = this.drawView(v, alpha, dt);
      if (done) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
    this.updateBody(dt, w, f, alpha);
    this.updateClones(dt, w, f, alpha);
    this.updateGhosts(dt);
    this.updateCorpse(dt);
    this.leaving.update(dt);
    if (this.guestGone > 0 && this.corpse && this.corpse.fade <= 0 && (this.guestGone -= dt) <= 0.3) this.dissolve();
  }

  /** 画一个危险物；返回 true 表示画完了可以丢掉。 */
  private drawView(v: HazView, alpha: number, dt: number): boolean {
    const h = v.h;
    // 画面比模拟慢 (1 − alpha) 步（位置按 alpha 插值），预警进度也按这个对齐；进度读模拟的计时，命中停顿时不会错开
    const lag = (1 - alpha) * DT;
    const k = clamp01((h.t - lag) / h.warn);
    const tl = h.t - h.warn; // 生效了多久
    const struck = tl >= 0;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const warn = v.warn;
    if (struck) warn.strike();
    // 没出手就没了（换阶段取消）淡得快一点；出过手的，等最后那一下也淡完
    if (v.gone >= 0) warn.end(!struck ? 0.25 : h.kind === 'ring' ? 0.3 : 0.35);
    const out = v.gone >= 0 ? 1 - clamp01(v.gone / 0.2) : 1; // 圈、火轮本体的淡出
    switch (h.kind) {
      case 'dash': {
        // 突进的人前面的还危险，冲过的地方拖一截淡掉
        const lane = warn as LaneWarn;
        if (struck) v.head = Math.max(v.head, Math.min(lane.len, lane.along(lerp(h.px, h.x), lerp(h.py, h.y))));
        lane.draw(dt, k, { from: v.head, to: lane.len, head: v.head });
        break;
      }
      case 'ring': {
        const lane = warn as LaneWarn;
        const len = lane.len;
        const x = lerp(h.px, h.x);
        const y = lerp(h.py, h.y);
        if (struck && Math.hypot(h.x - h.x0, h.y - h.y0) < len - 0.5 && tl > len / BOSS.ring.speed) v.turned = true;
        // 飞出去时整条都亮着（还要飞回来）；折返以后，圈飞过的那头拖一截淡掉，双箭头朝回指
        const s = Math.max(0, Math.min(len, lane.along(x, y + RING_CHEST)));
        lane.draw(dt, k, v.turned ? { from: 0, to: s, head: s, back: true, flip: true } : { from: 0, to: len });
        // 圈本体
        const spr = v.spr!;
        if (struck && v.gone < 0) {
          const tx = textures().ring;
          const fi = Math.floor(this.animT * 14) % 4;
          spr.visible = true;
          spr.texture = tx[fi];
          spr.position.set(Math.round(x), Math.round(y));
          v.hist.unshift([x, y]);
          if (v.hist.length > 8) v.hist.pop();
          v.ghosts.forEach((gs, i) => {
            const p = v.hist[Math.min(v.hist.length - 1, (i + 1) * 3)];
            gs.visible = true;
            gs.texture = tx[(fi + 3 - i) % 4];
            gs.position.set(Math.round(p[0]), Math.round(p[1]));
          });
          // 拖着黑红火星
          if (Math.random() < 0.8) this.sparks.emit(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, 1, EMBER, [4, 16], [0.25, 0.5], { drag: 3 });
        } else if (v.gone >= 0) {
          spr.alpha = out;
          for (const gs of v.ghosts) gs.visible = false;
        }
        break;
      }
      case 'sweep': {
        const { x0: cx, y0: cy, r, a0, dir } = h;
        const am = lerp(h.pa, h.a);
        (warn as SweepWarn).draw(dt, k, struck ? Math.max(0, Math.min(Math.PI, dir * (am - a0))) : 0);
        // 红绫：预警时在起始边一侧收着、慢慢抖开；出手时整条扫过去，后面拖两道残影
        const g = v.silk!;
        g.clear();
        if (v.gone < 0) {
          if (!struck) this.silk(g, cx, cy, a0 - dir * 0.08, dir, r * (0.18 + 0.22 * ease(k)), 0.85 * clamp01(v.t / 0.2), 1);
          else {
            this.silk(g, cx, cy, am - dir * 0.3, dir, r, 0.18, 1);
            this.silk(g, cx, cy, am - dir * 0.15, dir, r, 0.35, 1);
            this.silk(g, cx, cy, am, dir, r, 1, 1);
            // 绫梢扫过时落下的火星
            const tipx = cx + Math.cos(am - dir * 0.2) * r;
            const tipy = cy + Math.sin(am - dir * 0.2) * r;
            this.sparks.emit(tipx, tipy, 2, [C.e, C.r, C.R], [10, 40], [0.3, 0.6], { drag: 3 });
          }
        }
        break;
      }
      case 'wheel': {
        // 火轮前面的还危险，滚过的地方拖一截淡掉；车道很长，箭头只显示镜头附近的
        const lane = warn as LaneWarn;
        const x = lerp(h.px, h.x);
        const y = lerp(h.py, h.y);
        if (struck) v.head = Math.max(v.head, Math.min(lane.len, lane.along(x, y)));
        lane.draw(dt, k, { from: v.head, to: lane.len, head: v.head }, this.stage.cam);
        const spr = v.spr!;
        const sh = v.sh!;
        if (struck) {
          const dx = (h.x1 - h.x0) / (Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1);
          spr.visible = sh.visible = true;
          spr.texture = textures().wheel[Math.floor(this.animT * 14) % 4];
          spr.scale.x = dx >= 0 ? 1 : -1; // 朝哪边滚就朝哪边转
          spr.position.set(Math.round(x), Math.round(y - h.r - 1));
          spr.zIndex = y;
          spr.alpha = clamp01(tl / 0.15) * out;
          sh.position.set(Math.round(x), Math.round(y));
          sh.alpha = spr.alpha;
          if (v.gone < 0 && Math.random() < 0.9) this.sparks.emit(x - dx * 6, y - 4, 1, [C.e, C.r, C.P, C.d], [6, 24], [0.3, 0.6], { up: 14, drag: 2 });
        }
        break;
      }
    }
    return warn.done;
  }

  /**
   * 一条混天绫：从首领手边伸到半径 r，外段落在内段后面（挥出去的绸子梢会拖着），边缘微微起伏。
   * 主色朱、前沿朱砂、后沿殷红；amount 0..1 是伸出去的长度比例（预警时收着）。
   */
  private silk(g: Graphics, cx: number, cy: number, a: number, dir: number, r: number, alpha: number, amount: number) {
    const N = 22;
    const lead: [number, number][] = [];
    const trail: [number, number][] = [];
    const t0 = this.animT;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const rho = 8 + (r - 8) * u * amount;
      const lag = dir * 0.22 * Math.pow(u, 1.5);
      const wv = (5 + 2.5 * Math.sin(u * 9 + t0 * 18)) * (1 - 0.45 * u);
      const ang = a - lag;
      const half = wv / Math.max(rho, 10);
      lead.push([cx + Math.cos(ang + dir * half * 0.3) * rho, cy + Math.sin(ang + dir * half * 0.3) * rho]);
      trail.push([cx + Math.cos(ang - dir * half) * rho, cy + Math.sin(ang - dir * half) * rho]);
    }
    const poly = [...lead, ...[...trail].reverse()].flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
    g.poly(poly).fill({ color: C.r, alpha });
    // 前沿提亮、后沿压暗（像素线）
    for (let i = 0; i < N; i++) pixLine(g, lead[i][0], lead[i][1], lead[i + 1][0], lead[i + 1][1]);
    g.fill({ color: C.e, alpha });
    for (let i = 0; i < N; i++) pixLine(g, trail[i][0], trail[i][1], trail[i + 1][0], trail[i + 1][1]);
    g.fill({ color: C.R, alpha });
  }

  private updateBody(dt: number, w: World, f: BossFight | null, alpha: number) {
    const b = f && f.state !== 'dead' ? bossEnemy(w) : null;
    if (!b || !f) {
      if (this.body && !this.corpse) {
        this.body.destroy();
        this.shadow?.destroy();
        this.body = this.shadow = null;
        this.bar.clear();
      }
      return;
    }
    const tx = textures();
    if (!this.body) {
      this.body = new Sprite(tx.body.idle[0]);
      this.body.anchor.set(DEMON_ANCHOR.x / DEMON_W, DEMON_ANCHOR.y / DEMON_H);
      this.stage.entities.addChild(this.body);
      this.shadow = new Sprite(this.stage.tex.shadow);
      this.shadow.anchor.set(0.5);
      this.shadow.alpha = 0.4;
      this.stage.floor.addChild(this.shadow);
      this.bossId = b.id;
    }
    this.born += dt;
    const x = Math.round(b.px + (b.x - b.px) * alpha);
    const y = Math.round(b.py + (b.y - b.py) * alpha);
    const pose = bossPose(f) as DemonPose;
    if (pose !== this.lastPose) this.animT = this.animT % 10;
    this.lastPose = pose;
    const fr = (this.flash > 0 ? tx.flash : tx.body)[pose];
    this.body.texture = fr[Math.floor(this.animT * FPS[pose]) % fr.length];
    this.body.scale.x = f.facing;
    this.body.position.set(x, y);
    this.body.zIndex = y;
    // 入场：从黑焰里慢慢显出来（先是一团暗影，再有颜色）
    const intro = f.state === 'intro' ? clamp01((this.born - 0.35) / 1.1) : 1;
    this.body.alpha = 0.15 + 0.85 * intro;
    const dark = Math.round(90 + 165 * intro);
    // 换阶段无敌时身上暗暗地一明一暗
    const pulse = f.state === 'phase' ? 0.82 + 0.18 * Math.sin(this.animT * 18) : 1;
    const c = Math.round(dark * pulse);
    this.body.tint = this.flash > 0 ? 0xffffff : (c << 16) | (Math.round(c * 0.92) << 8) | c;
    this.shadow!.position.set(x, y);
    this.shadow!.alpha = 0.4 * intro;
    // 身上往上飘的黑焰粒子（少量，不要光圈）
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = f.state === 'phase' ? 0.02 : 0.07;
      const big = Math.random() < 0.25;
      this.sparks.emit(x + (Math.random() - 0.5) * 12, y - 4 - Math.random() * 20, 1, Math.random() < 0.12 ? EMBER : BLACK_FLAME, [3, 10], [0.5, 1.0], { up: 16 + Math.random() * 10, drag: 1.2, scale: big ? 2 : 1 });
    }
    if (f.state === 'intro' && this.born < 1.4 && Math.random() < 0.7) this.sparks.emit(x + (Math.random() - 0.5) * 16, y - Math.random() * 4, 1, BLACK_FLAME, [6, 18], [0.6, 1.1], { up: 30, drag: 1.2, scale: Math.random() < 0.4 ? 2 : 1 });
    // 突进：身后的残影与火焰拖尾
    const dashing = pose === 'dash';
    if (dashing) this.trailAfter(this.body, x, y, f.facing);
    // 头顶的血条：24 像素，60% 与 30% 处两道刻度
    const bw = 24;
    const frac = Math.max(0, b.hp / b.maxHp);
    const bx = x - bw / 2;
    const by = y - 33;
    this.bar.clear().rect(bx - 1, by - 1, bw + 2, 4).fill({ color: C.k, alpha: 0.85 });
    this.bar.rect(bx, by, Math.round(bw * frac), 2).fill({ color: f.phase >= 3 ? C.e : C.r });
    for (const t of BOSS.phases) this.bar.rect(Math.round(bx + bw * t), by - 1, 1, 4).fill({ color: C.Y, alpha: 0.85 });
    this.bar.alpha = intro;
    if (this.phaseT >= 0) {
      this.phaseT += dt;
      if (this.phaseT > BOSS.phaseTime) this.phaseT = -1;
    }
  }

  /** 突进时在身后留下残影（暗紫、半透明、慢慢淡去）和一路黑焰。 */
  private trailAfter(src: Sprite, x: number, y: number, facing: number) {
    this.trailT -= 1 / 60;
    if (this.trailT <= 0) {
      this.trailT = 0.035;
      const s = new Sprite(src.texture);
      s.anchor.copyFrom(src.anchor);
      s.scale.x = facing;
      s.position.set(x, y);
      s.zIndex = y - 1;
      s.tint = C.p;
      this.stage.entities.addChild(s);
      this.ghosts.push({ s, t: 0, life: 0.28, a0: 0.45 });
    }
    this.sparks.emit(x - facing * 6, y - 6 - Math.random() * 10, 2, [C.d, C.P, C.R, C.e], [10, 30], [0.25, 0.5], { up: 10, drag: 3 });
  }

  private updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = g.a0 * (1 - k);
    }
  }

  /** 三头六臂的残影：半透明的暗色魔化哪吒，从本体里分出来滑到两侧，突进完就散成黑烟。 */
  private updateClones(dt: number, w: World, f: BossFight | null, alpha: number) {
    const tx = textures();
    const seen = new Set<number>();
    for (const c of f?.clones ?? []) {
      seen.add(c.src);
      let v = this.clones.get(c.src);
      if (!v) {
        const s = new Sprite(tx.body.cast[0]);
        s.anchor.set(DEMON_ANCHOR.x / DEMON_W, DEMON_ANCHOR.y / DEMON_H);
        s.tint = 0x5e4a70;
        s.alpha = 0;
        this.stage.entities.addChild(s);
        v = { s, src: c.src, t: 0, gone: -1, x: c.x, y: c.y };
        this.clones.set(c.src, v);
        this.sparks.emit(c.x, c.y - 12, 14, BLACK_FLAME, [20, 60], [0.4, 0.8], { up: 14, drag: 2.5 });
      }
      v.t += dt;
      const x = Math.round(c.px + (c.x - c.px) * alpha);
      const y = Math.round(c.py + (c.y - c.py) * alpha);
      const h = f!.hazards.find((q) => q.src === c.src);
      const pose: DemonPose = h ? (h.t < h.warn ? 'charge' : 'dash') : f!.t < BOSS.clones.slide ? 'walk' : 'charge';
      const fr = tx.body[pose];
      v.s.texture = fr[Math.floor(this.animT * FPS[pose]) % fr.length];
      v.s.scale.x = c.facing;
      v.s.position.set(x, y);
      v.s.zIndex = y;
      v.s.alpha = clamp01(v.t / 0.3) * (0.62 + 0.06 * Math.sin(this.animT * 9 + c.src));
      v.x = x;
      v.y = y;
      if (pose === 'dash') this.trailAfter(v.s, x, y, c.facing);
      if (Math.random() < 0.25) this.sparks.emit(x + (Math.random() - 0.5) * 10, y - 6 - Math.random() * 16, 1, BLACK_FLAME, [3, 8], [0.4, 0.8], { up: 14, drag: 1.2 });
    }
    for (const [src, v] of this.clones) {
      if (seen.has(src)) continue;
      if (v.gone < 0) {
        v.gone = 0;
        this.sparks.emit(v.x, v.y - 12, 20, BLACK_FLAME, [15, 50], [0.5, 0.9], { up: 18, drag: 2 });
      }
      v.gone += dt;
      v.s.alpha = 0.62 * (1 - clamp01(v.gone / 0.45));
      v.s.y -= dt * 8;
      if (v.gone >= 0.45) {
        v.s.destroy();
        this.clones.delete(src);
      }
    }
  }

  /** 倒下：先闪白，再跪着慢慢褪成灰色、身上的黑焰化灰往上飘；对白结束（dissolve）后整个人散掉。 */
  private updateCorpse(dt: number) {
    const c = this.corpse;
    if (!c) return;
    c.t += dt;
    const tx = textures();
    c.s.texture = c.t < 0.18 ? tx.flash.kneel[0] : tx.body.kneel[0];
    const ashK = ease(clamp01((c.t - 0.2) / 2.2));
    const mix = (a: number, b: number) => Math.round(a + (b - a) * ashK);
    c.s.tint = (mix(255, 168) << 16) | (mix(255, 160) << 8) | mix(255, 170);
    if (c.fade > 0) {
      c.fade += dt / 1.4;
      c.s.alpha = Math.max(0, 1 - ease(clamp01(c.fade)));
      // 化作灰烬，被风吹向天上：灰往上、往一侧飘
      if (Math.random() < 0.9) this.sparks.emit(c.x + (Math.random() - 0.5) * 16, c.y - Math.random() * 26, 2, ASH, [10, 26], [1.0, 1.8], { dir: -Math.PI / 2 + 0.45, spread: 0.7, up: 10, drag: 0.6 });
      if (c.fade >= 1) {
        c.s.destroy();
        this.corpse = null;
      }
      return;
    }
    // 黑焰剥落化灰：起初还有黑焰，越往后越多灰
    if (Math.random() < 0.55) {
      const ash = Math.random() < ashK;
      this.sparks.emit(c.x + (Math.random() - 0.5) * 14, c.y - 4 - Math.random() * 18, 1, ash ? ASH : BLACK_FLAME, [3, 10], [0.7, 1.3], { up: 14, drag: 1 });
    }
  }
}
