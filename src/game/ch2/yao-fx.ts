// 第二章首领「落魂阵主 · 姚天君」的画面：本体（姿势、受击闪白、袍角的魂雾、头顶血条）、入场从魂雾里显形、换阶段魂光爆开、
// 每一招的地面预警（淡红光）与招式本体（落魂幡的魂线、摄魂铃的魂波、显形时炸开的魂波）、草人头顶的倒计时与拜魂、化雾游走、倒下后散进阵眼。
// 只读模拟状态（w.boss 是 YaoFight 时、首领本体、幡和草人）和事件，不回写模拟。接口和 boss-fx.ts 的 BossFx 一样（feel.ts 两个都建，按 boss.kind 各管各的）。
// 预警是地上的淡红光（用户 2026-11-10 定，画法同 warn-fx.ts）：形状就是 ch2/yao.ts 里每个危险物的判定范围，按人物脚下算——
//   魂线：幡脚到他脚下的线段两侧各 YAO.banners.r + 人物半径，两头圆（updateHazards 的 line：segDist ≤ r + 人物半径）；
//   魂波：圆心在他摇铃时的位置、半径随时间往外扩的一圈带子，带宽两侧各 YAO.bell.hw + 人物半径；缺口里身子整个在缺口内才安全，
//     所以红光的缺口比真正的缺口两边各窄「人物半径 / 半径」那么一点角度；
//   显形炸开：以他显形的位置为圆心、YAO.mist.r 的圆（量到人物脚下）。
// 魂线、魂波本身是天青带一点胭脂紫的细光（加法混合），一明一暗地流动，不是框；人物、武器身上不画光圈。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { PixelGraphics } from '../../render/pixel-graphics.ts';
import type { Stage } from '../../render/stage.ts';
import type { HitStop, Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { flashTextureFromGrid, once, textureFromBitmap, textureFromGrid } from '../../render/textures.ts';
import { digitGlyph } from '../../art/sprites/font.ts';
import { SOULFLAG_TIP, YAO_ANCHOR, YAO_FRAMES, YAO_H, YAO_W, type YaoArtPose } from '../../art/ch2/yao.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { YAO } from '../../sim/ch2/config.ts';
import { yaoOf, yaoPose } from '../../sim/ch2/yao.ts';
import type { YaoFight, YaoHazard } from '../../sim/ch2/types.ts';
import { bossEnemy } from '../../sim/boss.ts';
import { Leaving, guestAsBoss } from '../guest-fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { DiskWarn, LaneWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';

const C = { k: 0x1a1520, d: 0x2e2433, g: 0x4a3b4a, h: 0x6b5a62, i: 0x9a8a86, j: 0xc9bcae, w: 0xf2e8d5, P: 0x4b2a4f, p: 0x8a4a7a, m: 0xd47aa0, R: 0x5c1a1b, r: 0x9c2a22, e: 0xd9452b, o: 0xf2814a, Y: 0xf7dc7a, c: 0x3f8a9e, CC: 0x7cc4c4, W: 0xffffff };
const SOUL = [C.CC, C.CC, C.j, C.p];
const SMOKE = [C.g, C.h, C.P, C.i];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k * k * (3 - 2 * k);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/** 每个姿势的帧率（慢：施法的人动作沉）。 */
const FPS: Record<YaoArtPose, number> = { idle: 2, walk: 6, cast: 3, bell: 8, raise: 3, roar: 4, kneel: 1 };

type PoseTex = Record<YaoArtPose, Texture[]>;
let texCache: { body: PoseTex; flash: PoseTex } | null = null;
function textures() {
  if (texCache) return texCache;
  const mk = (f: typeof textureFromGrid) => Object.fromEntries(Object.entries(YAO_FRAMES).map(([k, v]) => [k, v.map(f)])) as PoseTex;
  texCache = { body: mk(textureFromGrid), flash: mk(flashTextureFromGrid) };
  return texCache;
}
/** 魂雾的一团：软边的圆（中间浓、往外平滑地淡没，不是硬边、不是光圈），白底，着色用。 */
function puffTex(r: number): Texture {
  return once(`ch2:puff:${r}`, () => {
    const S = r * 2 + 1;
    const data = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - r, (y - r) * 1.2) / r;
        if (d >= 1) continue;
        data.set([255, 255, 255, Math.round(255 * (1 - d) ** 1.6)], (y * S + x) * 4);
      }
    return textureFromBitmap({ w: S, h: S, data });
  });
}
const PUFFS = 11;

let digitCache: { gold: Texture[]; hot: Texture[] } | null = null;
function digits() {
  return (digitCache ??= {
    gold: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'crit'))),
    hot: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'skill'))),
  });
}

// ---------- 魂波的红光：带缺口的一圈带子（画在预警层里，取最大值叠，和别的预警同一套颜色与透明度） ----------
class WaveWarn {
  readonly g = new Graphics();
  private layer: WarnLayer;
  private gone = -1;
  constructor(layer: WarnLayer) {
    this.layer = layer;
    this.g.blendMode = 'max';
    layer.add(this.g);
  }
  get done() {
    return this.gone >= 0.3;
  }
  end() {
    if (this.gone < 0) this.gone = 0;
  }
  destroy() {
    this.layer.remove(this.g);
  }
  /** 圆心 (x, y)、带子中线的半径 rad、半宽 R；缺口在 gapA、半张角 gapW。k：预警进度（< 1 时是淡的底 + 推亮），struck：已经在扩。 */
  draw(dt: number, x: number, y: number, rad: number, R: number, gapA: number, gapW: number, k: number, struck: boolean, appear: number) {
    const g = this.g;
    g.clear();
    if (this.gone >= 0) this.gone += dt;
    const out = this.gone < 0 ? 1 : 1 - clamp01(this.gone / 0.3);
    if (out <= 0 || rad < 1) return;
    // 红光的缺口比真正的缺口两边各窄一个人物半径（身子和缺口的边有重叠就算打中）
    const shrink = PLAYER.radius / Math.max(rad, 8);
    const g0 = gapA + Math.max(0, gapW - shrink);
    const g1 = gapA - Math.max(0, gapW - shrink) + TAU;
    const ring = (r: number, w: number, alpha: number) => {
      if (r <= 0 || alpha <= 0.003) return;
      g.moveTo(x + Math.cos(g0) * r, y + Math.sin(g0) * r).arc(x, y, r, g0, g1).stroke({ width: w, color: C.e, alpha, cap: 'butt' });
    };
    const a = struck ? 0.42 : (0.2 + 0.22 * ease(k)) * appear;
    ring(rad, Math.max(1, 2 * R - 2), a * out);
    ring(rad - R + 0.5, 1, a * 0.66 * out);
    ring(rad + R - 0.5, 1, a * 0.66 * out);
    ring(rad + R + 0.5, 1, a * 0.33 * out);
    ring(rad - R - 0.5, 1, a * 0.33 * out);
  }
}

// ---------- 每个危险物的画面 ----------
interface HazView {
  h: YaoHazard; // 模拟里的那个对象（移除之后留着最后的状态）
  lane: LaneWarn | null;
  disk: DiskWarn | null;
  wave: WaveWarn | null;
  glow: PixelGraphics | null; // 魂线 / 魂波本身的光（所有危险物共用一层 hazGlow）
  t: number;
  gone: number;
  broke: boolean; // 魂线被打断
}

interface Corpse {
  s: Sprite;
  x: number;
  y: number;
  t: number;
  fade: number;
  facing: number;
}

export class YaoFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private hitStop: HitStop;
  private sfx: Sfx;
  private warns: WarnLayer;
  private air = new Container();
  private threads = new PixelGraphics(); // 草人到人物之间的拜魂细线。逐像素画（PixelGraphics，docs/perf.md）
  /** 魂线、魂波本身的光：所有危险物画在同一层里（都是加法混合，谁先谁后画出来一样），每帧先擦一次（原来每个危险物各一个 Graphics）。 */
  private hazGlow = new PixelGraphics();
  private views = new Map<number, HazView>();
  private body: Sprite | null = null;
  private shadow: Sprite | null = null;
  private bar = new Graphics();
  private counts = new Map<number, Sprite>(); // 草人头顶的倒计时
  private roots: { owner: number; t: number; dur: number }[] = [];
  private bossId = -1;
  private animT = 0;
  private flash = 0;
  private born = 0;
  private lastPose: YaoArtPose = 'idle';
  private hurtSfxT = 0;
  /** 来遭遇战（首领池，sim/bosspool.ts）时：退走的身子慢慢淡出去；打倒了的不等对白，跪一会儿自己散（guestGone > 0 是还剩多久）。 */
  private leaving: Leaving;
  private guestGone = 0;
  private corpse: Corpse | null = null;
  private mistAt: { x: number; y: number } | null = null;
  private mist: { s: Sprite; a: number; r: number; v: number; ph: number }[] = [];
  private mistK = 0; // 魂雾的浓淡（化雾时慢慢浓起来，显形时慢慢散）
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, hitStop: HitStop, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.hitStop = hitStop;
    this.sfx = sfx;
    this.leaving = new Leaving(sparks);
    textures();
    this.warns = warnLayer(stage);
    warmWarnTextures({ lanes: [YAO.banners.r + PLAYER.radius], disks: [YAO.mist.r] });
    this.threads.blendMode = 'add';
    stage.glow.addChild(this.threads);
    this.hazGlow.blendMode = 'add';
    stage.glow.addChild(this.hazGlow);
    stage.fx.addChild(this.air, this.bar);
    // 魂雾：十来团软边的灰紫烟，绕着他慢慢转（化雾时才显出来）
    for (let i = 0; i < PUFFS; i++) {
      const s = new Sprite(puffTex(i % 3 === 0 ? 11 : i % 3 === 1 ? 8 : 6));
      s.anchor.set(0.5);
      s.tint = [C.h, C.g, C.P, C.i][i % 4];
      s.visible = false;
      stage.entities.addChild(s);
      this.mist.push({ s, a: (i / PUFFS) * TAU, r: 3 + (i % 4) * 3, v: 0.8 + (i % 3) * 0.35, ph: i * 1.7 });
    }
  }

  /** 倒下的首领还在不在场上（表现层用来定镜头、等它散去）。 */
  get focus(): { x: number; y: number } | null {
    return this.corpse && !this.guestGone && this.corpse.fade < 1 ? { x: this.corpse.x, y: this.corpse.y } : null;
  }

  clear() {
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    this.body?.destroy();
    this.shadow?.destroy();
    this.body = this.shadow = null;
    this.corpse?.s.destroy();
    this.corpse = null;
    this.leaving.clear();
    this.guestGone = 0;
    for (const s of this.counts.values()) s.destroy();
    this.counts.clear();
    this.bar.clear();
    this.threads.clear();
    this.hazGlow.clear();
    this.roots = [];
    this.bossId = -1;
    this.mistAt = null;
  }

  /** 对白里旁白那一句（「散成一缕灰烟，落进脚下的阵眼」）：跪着的姚天君散去。 */
  dissolve() {
    if (this.corpse && this.corpse.fade <= 0) this.corpse.fade = 0.0001;
  }

  private dropView(v: HazView) {
    v.lane?.destroy();
    v.disk?.destroy();
    v.wave?.destroy();
    v.glow = null; // 共用的那一层（hazGlow）留着
  }

  onEvent(e0: SimEvent, w: World, now: number) {
    const f = yaoOf(w);
    const e = guestAsBoss(e0, 'yao'); // 来遭遇战（首领池）：现身、换阶段、倒下的画面和当首领时同一套（guest-fx.ts）
    switch (e.t) {
      case 'echoLeave':
        // 这一波结束还没打倒：收起招式，身子留在原地慢慢淡成一缕魂烟
        if (e.kind !== 'yao') break;
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        this.leaving.add([this.body, this.shadow], e.x, e.y, SMOKE);
        this.body = this.shadow = null;
        this.bar.clear();
        break;
      case 'bossIntro':
        if (!f) return;
        this.clear();
        this.bossId = e.id;
        this.born = 0;
        this.shake.add(0.3);
        // 入场：一团魂雾在地上卷起来，人从雾里慢慢显出来
        for (let i = 0; i < 30; i++) this.sparks.emit(e.x + rnd(-10, 10), e.y - rnd(0, 8), 1, SMOKE, [6, 24], [0.7, 1.3], { up: 26, drag: 1.5, scale: Math.random() < 0.3 ? 2 : 1 });
        this.glows.emit(e.x, e.y - 12, 14, SOUL, [10, 40], [0.5, 1], { up: 14, drag: 2 });
        this.sfx.play('yao.intro');
        break;
      case 'bossMove':
        if (!f) return;
        // 招式的声音（名字见 docs/audio.md「第二章」）
        if (e.move === 'bell') this.sfx.play('yao.bell');
        if (e.move === 'banners') this.sfx.play('yao.banners');
        if (e.move === 'straw') this.sfx.play('yao.straw');
        if (e.move === 'formations') this.sfx.play('yao.formations');
        break;
      case 'yaoCast': {
        const h = f?.hazards.find((x) => x.id === e.hazard);
        if (h) this.addView(h);
        if (e.kind === 'burst') this.sfx.play('yao.burst.warn');
        break;
      }
      case 'yaoStrike': {
        const v = this.views.get(e.hazard);
        if (e.kind === 'wave') {
          this.sfx.play('yao.wave');
          this.glows.emit(e.x, e.y - 14, 8, SOUL, [20, 50], [0.3, 0.6], { drag: 2 });
        }
        if (e.kind === 'line') this.sfx.play('yao.line');
        if (e.kind === 'burst') {
          this.shake.add(0.3);
          this.sfx.play('yao.burst');
          for (let i = 0; i < 40; i++) {
            const a = (i / 40) * TAU;
            this.glows.emit(e.x + Math.cos(a) * 6, e.y - 6 + Math.sin(a) * 4, 1, SOUL, [70, 130], [0.35, 0.6], { dir: a, spread: 0.15, drag: 3 });
          }
        }
        if (v) {
          v.lane?.strike();
          v.disk?.strike();
          v.disk?.end(0.35);
        }
        break;
      }
      case 'yaoFlag':
        // 幡从天上插下来：落点迸一点土、幡头的魂火亮一下
        this.sparks.emit(e.x, e.y - 1, 8, [0xa48e6d, 0x958064, 0x6b5749], [20, 50], [0.25, 0.5], { up: 12, g: 80, drag: 2 });
        this.glows.emit(e.x, e.y - 26, 5, SOUL, [10, 30], [0.3, 0.5], { up: 8 });
        this.sfx.play('yao.flag');
        break;
      case 'yaoLineBreak': {
        const v = e.hazard >= 0 ? this.views.get(e.hazard) : [...this.views.values()].find((x) => x.h.flag === e.flag);
        if (v) {
          v.broke = true;
          // 魂线断开：沿着线迸开一串魂光
          const h = v.h;
          for (let i = 0; i < 14; i++) {
            const u = Math.random();
            this.glows.emit(h.x0 + (h.x1 - h.x0) * u, h.y0 + (h.y1 - h.y0) * u - 12, 1, SOUL, [10, 40], [0.25, 0.5], { up: 10, drag: 2 });
          }
        }
        this.glows.emit(e.x, e.y - 24, 10, SOUL, [20, 60], [0.3, 0.6], { up: 10, drag: 2 });
        this.sfx.play('yao.linebreak');
        break;
      }
      case 'yaoStraw':
        for (const id of e.ids) {
          const s = w.enemies.find((x) => x.id === id);
          if (s) this.sparks.emit(s.x, s.y - 4, 10, [0xc8b07a, 0x86703f, 0xa48e6d], [15, 40], [0.3, 0.6], { up: 16, g: 60, drag: 2 });
        }
        break;
      case 'yaoCurse': {
        // 拜魂：每个没打碎的草人化成一缕红紫的魂光扑向人物
        const p = w.players[e.owner];
        for (const id of e.ids) {
          const s = w.enemies.find((x) => x.id === id) ?? null;
          const sx = s?.x ?? e.x;
          const sy = (s?.y ?? e.y) - 12;
          for (let i = 0; i < 8; i++) {
            const u = i / 8;
            this.glows.emit(sx + ((p?.x ?? e.x) - sx) * u, sy + ((p?.y ?? e.y) - 10 - sy) * u, 1, [C.m, C.p, C.W], [10, 30], [0.25, 0.45], { drag: 3 });
          }
          this.sparks.emit(sx, sy + 8, 12, [0xc8b07a, 0xd9452b, 0x6b3d1e], [20, 60], [0.3, 0.6], { up: 20, drag: 2 }); // 草人烧掉
        }
        if (e.dmg > 0) {
          this.shake.add(0.35);
          this.hitStop.trigger(now, 0.05);
        }
        this.sfx.play('yao.curse');
        break;
      }
      case 'yaoRoot':
        this.roots.push({ owner: e.owner, t: 0, dur: e.t2 });
        this.sfx.play('yao.root');
        break;
      case 'yaoMist':
        if (e.act === 'vanish') {
          for (let i = 0; i < 26; i++) this.sparks.emit(e.x + rnd(-8, 8), e.y - rnd(2, 24), 1, SMOKE, [10, 40], [0.5, 1], { up: 10, drag: 2, scale: Math.random() < 0.4 ? 2 : 1 });
          this.sfx.play('yao.vanish');
        } else {
          this.born = 0.6; // 显形：从半透明亮起来
          this.glows.emit(e.x, e.y - 14, 14, SOUL, [20, 60], [0.3, 0.6], { drag: 2 });
          this.sfx.play('yao.appear');
        }
        break;
      case 'bossPhase':
        if (!f) return;
        this.shake.add(0.5);
        this.hitStop.trigger(now, 0.08);
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * TAU;
          this.glows.emit(e.x + Math.cos(a) * 4, e.y - 14 + Math.sin(a) * 6, 1, SOUL, [30, 100], [0.5, 1], { dir: a, spread: 0.4, up: 14, drag: 2.2 });
        }
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * TAU;
          this.sparks.emit(e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 6, 1, SMOKE, [50, 80], [0.45, 0.7], { dir: a, spread: 0.1, drag: 3 });
        }
        this.sfx.play('yao.phase'); // 锣、乱摇的铃、一声长的鬼哭（不用第一章的兽吼）
        break;
      case 'hit':
        if (e.id === this.bossId && e.by !== 'burn') {
          this.flash = 0.06;
          this.hurtSfxT -= 1;
          if (this.hurtSfxT <= 0) {
            this.hurtSfxT = 6;
            this.sfx.play('boss.hurt', 0.5);
          }
        }
        break;
      case 'bossDeath': {
        if (e.id !== this.bossId) return;
        this.hitStop.trigger(now, 0.18);
        this.shake.add(0.7);
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        const s = new Sprite(textures().flash.kneel[0]);
        s.anchor.set(YAO_ANCHOR.x / YAO_W, YAO_ANCHOR.y / YAO_H);
        s.position.set(Math.round(e.x), Math.round(e.y));
        s.scale.x = e.facing;
        s.zIndex = e.y;
        this.stage.entities.addChild(s);
        this.corpse = { s, x: e.x, y: e.y, t: 0, fade: 0, facing: e.facing };
        this.body?.destroy();
        this.shadow?.destroy();
        this.body = this.shadow = null;
        this.bar.clear();
        for (let i = 0; i < 50; i++) {
          const a = Math.random() * TAU;
          this.glows.emit(e.x + Math.cos(a) * 5, e.y - 14 + Math.sin(a) * 8, 1, SOUL, [30, 120], [0.5, 1], { dir: a, spread: 0.3, drag: 2.5, up: 10 });
        }
        this.sfx.play('boss.death');
        this.guestGone = e0.t === 'echoDefeat' ? 1.3 : 0; // 遭遇战：没有战后对白，跪一会儿自己散
        break;
      }
    }
  }

  private addView(h: YaoHazard) {
    if (this.views.has(h.id)) return;
    const v: HazView = { h, lane: null, disk: null, wave: null, glow: null, t: 0, gone: -1, broke: false };
    if (h.kind === 'line') {
      v.lane = new LaneWarn(this.warns, h.x0, h.y0, h.x1, h.y1, h.r + PLAYER.radius, 0);
      v.glow = this.hazGlow;
    } else if (h.kind === 'burst') {
      v.disk = new DiskWarn(this.warns, h.x0, h.y0, h.r);
    } else {
      v.wave = new WaveWarn(this.warns);
      v.glow = this.hazGlow;
    }
    this.views.set(h.id, v);
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt);
    const f = yaoOf(w);
    const live = new Set<number>();
    if (f) for (const h of f.hazards) live.add(h.id);
    this.hazGlow.clear(); // 每个危险物的光都画在这一层：这一帧先擦一次
    for (const [id, v] of this.views) {
      v.t += dt;
      if (v.gone < 0 && !live.has(id)) v.gone = 0;
      if (v.gone >= 0) v.gone += dt;
      if (this.drawView(v, dt, alpha, w)) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
    this.updateBody(dt, w, f, alpha);
    this.updateStraws(dt, w, f, alpha);
    this.updateRoots(dt, w);
    this.updateCorpse(dt);
    this.leaving.update(dt);
    if (this.guestGone > 0 && this.corpse && this.corpse.fade <= 0 && (this.guestGone -= dt) <= 0.3) this.dissolve();
  }

  /** 画一个危险物；返回 true 表示画完了可以丢掉。 */
  private drawView(v: HazView, dt: number, alpha: number, w: World): boolean {
    const h = v.h;
    const lag = (1 - alpha) * DT;
    const k = clamp01((h.t - lag) / Math.max(0.01, h.warn));
    const struck = h.t >= h.warn;
    switch (h.kind) {
      case 'line': {
        const lane = v.lane!;
        if (v.gone >= 0) lane.end(v.broke ? 0.2 : 0.35);
        lane.draw(dt, k, { from: 0, to: lane.len });
        // 魂线本身：幡头的魂火连到他手边，一缕细光（中段往下垂、微微起伏），预警时淡、连上之后一明一暗地流
        const g = v.glow!; // 共用的一层，update 里已经擦过
        const out = v.gone >= 0 ? 1 - clamp01(v.gone / 0.25) : 1;
        if (out > 0) {
          const ax = h.x0 + SOULFLAG_TIP.x;
          const ay = h.y0 + SOULFLAG_TIP.y + 2;
          const f = yaoOf(w);
          const facing = f?.facing ?? 1;
          const bx = h.x1 + facing * 4;
          const by = h.y1 - 20;
          const n = Math.max(8, Math.round(Math.hypot(bx - ax, by - ay) / 2));
          const base = struck ? 0.75 : 0.25 * ease(k);
          for (let i = 1; i < n; i++) {
            const u = i / n;
            const sag = Math.sin(u * Math.PI) * 5 + Math.sin(u * 7 + this.time * 3 + h.id) * 1.2;
            const flow = 0.55 + 0.45 * Math.sin(u * 14 - this.time * 8);
            const x = Math.round(ax + (bx - ax) * u);
            const y = Math.round(ay + (by - ay) * u + sag);
            g.rect(x, y, 1, 1).fill({ color: flow > 0.9 && struck ? C.W : u < 0.5 ? C.CC : C.m, alpha: base * flow * out });
          }
          if (struck && Math.random() < 0.15) {
            const u = Math.random();
            this.glows.emit(ax + (bx - ax) * u, ay + (by - ay) * u + Math.sin(u * Math.PI) * 5, 1, SOUL, [3, 10], [0.25, 0.4], { up: 6 });
          }
        }
        return lane.done && out <= 0;
      }
      case 'burst': {
        const disk = v.disk!;
        if (v.gone >= 0 && !struck) disk.end(0.2);
        disk.draw(dt, k);
        // 预警时魂雾往这里聚
        if (!struck && Math.random() < 0.6) {
          const a = Math.random() * TAU;
          const r = h.r * (0.4 + 0.6 * Math.random()) * (1 - k * 0.6);
          this.sparks.emit(h.x0 + Math.cos(a) * r, h.y0 + Math.sin(a) * r * 0.8 - 4, 1, SMOKE, [10, 26], [0.3, 0.6], { dir: a + Math.PI, spread: 0.3, drag: 1 });
        }
        return disk.done;
      }
      case 'wave': {
        const wave = v.wave!;
        if (v.gone >= 0) wave.end();
        const rad = struck ? h.prad + (h.rad - h.prad) * alpha : YAO.bell.r0;
        const appear = clamp01(v.t / 0.15);
        wave.draw(dt, h.x0, h.y0, rad, h.r + PLAYER.radius, h.gapA, h.gapW, k, struck, appear);
        // 魂波本身：一圈天青的细光（缺口处断开），一明一暗地流，越扩越淡
        const g = v.glow!; // 共用的一层，update 里已经擦过
        const out = (v.gone >= 0 ? 1 - clamp01(v.gone / 0.3) : 1) * (struck ? 1 - clamp01((rad - 200) / 120) * 0.6 : ease(k) * 0.5);
        if (out > 0.01) {
          const n = Math.max(24, Math.round((TAU * rad) / 2)); // 两个像素取一点（一圈几百个点，三圈同时扩也画得动）
          const seen = new Set<number>();
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            let rel = a - h.gapA;
            rel -= TAU * Math.floor((rel + Math.PI) / TAU);
            if (Math.abs(rel) <= h.gapW) continue;
            const wob = Math.sin(a * 9 + this.time * 6) * 0.8;
            const x = Math.round(h.x0 + Math.cos(a) * (rad + wob));
            const y = Math.round(h.y0 + Math.sin(a) * (rad + wob));
            const key = (y + 2048) * 4096 + x + 2048;
            if (seen.has(key)) continue;
            seen.add(key);
            const flow = 0.6 + 0.4 * Math.sin(a * 5 - this.time * 7);
            g.rect(x, y, 1, 1).fill({ color: flow > 0.9 ? C.W : Math.abs(rel) < h.gapW + 0.2 ? C.m : C.CC, alpha: 0.7 * flow * out });
          }
          // 缺口的两头各亮一点（让缺口一眼看得见）
          for (const s of [-1, 1]) {
            const a = h.gapA + s * h.gapW;
            const x = h.x0 + Math.cos(a) * rad;
            const y = h.y0 + Math.sin(a) * rad;
            if (struck && Math.random() < 0.3) this.glows.emit(x, y - 2, 1, [C.W, C.m], [3, 8], [0.2, 0.35], { up: 4 });
          }
        }
        return wave.done || (v.gone >= 0.35 && out <= 0.01);
      }
    }
  }

  private updateBody(dt: number, w: World, f: YaoFight | null, alpha: number) {
    const b = f && f.state !== 'dead' ? bossEnemy(w) : null;
    if (!b || !f) {
      for (const m of this.mist) m.s.visible = false;
      this.mistK = 0;
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
      this.body.anchor.set(YAO_ANCHOR.x / YAO_W, YAO_ANCHOR.y / YAO_H);
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
    const pose = yaoPose(f);
    const hidden = pose === 'hidden';
    const art: YaoArtPose = hidden ? 'idle' : pose;
    if (art !== this.lastPose) this.animT = this.animT % 10;
    this.lastPose = art;
    const fr = (this.flash > 0 ? tx.flash : tx.body)[art];
    this.body.texture = fr[Math.floor(this.animT * FPS[art]) % fr.length];
    this.body.scale.x = f.facing;
    this.body.position.set(x, y);
    this.body.zIndex = y;
    // 入场、显形：从魂雾里慢慢显出来；化雾：人不见了，只剩一团游走的魂雾和地上的一点影子
    const intro = f.state === 'intro' ? clamp01((this.born - 0.3) / 1.1) : clamp01(this.born / 0.6);
    const shown = hidden ? 0 : intro;
    this.body.visible = shown > 0.01;
    this.body.alpha = 0.15 + 0.85 * shown;
    const pulse = f.state === 'phase' ? 0.84 + 0.16 * Math.sin(this.animT * 16) : 1;
    const c = Math.round((150 + 105 * shown) * pulse);
    this.body.tint = this.flash > 0 ? 0xffffff : (c << 16) | (c << 8) | Math.min(255, c + 6);
    this.shadow!.position.set(x, y);
    this.shadow!.alpha = hidden ? 0.18 : 0.4 * Math.max(0.3, shown);
    // 魂雾：一团团软边的灰紫烟绕着他慢慢转，夹着几粒天青的魂光，跟着他游走；化雾时浓起来、显形时散开
    this.mistK = Math.max(0, Math.min(1, this.mistK + (hidden ? dt / 0.4 : -dt / 0.5)));
    for (const m of this.mist) {
      m.s.visible = this.mistK > 0.01;
      if (!m.s.visible) continue;
      const a = m.a + this.time * m.v;
      const r = m.r * (0.7 + 0.5 * this.mistK) + Math.sin(this.time * 1.3 + m.ph) * 2;
      m.s.position.set(Math.round(x + Math.cos(a) * r * 1.3), Math.round(y - 10 + Math.sin(a) * r * 0.7 + Math.sin(this.time * 2 + m.ph) * 2));
      m.s.zIndex = y + 1;
      m.s.alpha = this.mistK * (0.55 + 0.2 * Math.sin(this.time * 2.2 + m.ph));
    }
    if (hidden) {
      if (Math.random() < 0.6) this.sparks.emit(x + rnd(-9, 9), y - rnd(2, 18), 1, SMOKE, [4, 14], [0.5, 1], { up: 8, drag: 1.5 });
      if (Math.random() < 0.5) this.glows.emit(x + rnd(-7, 7), y - rnd(4, 16), 1, SOUL, [3, 10], [0.4, 0.7], { up: 6 });
      this.mistAt = { x, y };
    } else {
      this.mistAt = null;
      // 袍角散出的魂雾（少量）
      if (Math.random() < 0.18) this.glows.emit(x + rnd(-6, 6), y - rnd(0, 3), 1, SOUL, [2, 8], [0.4, 0.8], { up: 8 });
    }
    // 头顶的血条：24 像素，60% 与 30% 处两道刻度；化雾时淡下去（打不到）
    const bw = 24;
    const frac = Math.max(0, b.hp / b.maxHp);
    const bx = x - bw / 2;
    const by = y - 40;
    this.bar.clear().rect(bx - 1, by - 1, bw + 2, 4).fill({ color: C.k, alpha: 0.85 });
    this.bar.rect(bx, by, Math.round(bw * frac), 2).fill({ color: f.phase >= 3 ? C.m : C.p });
    for (const t of YAO.phases) this.bar.rect(Math.round(bx + bw * t), by - 1, 1, 4).fill({ color: C.Y, alpha: 0.85 });
    this.bar.alpha = (hidden ? 0.35 : 1) * (f.state === 'intro' ? intro : 1);
  }

  /** 草人：头顶的倒计时（缃色，最后三秒变橘、抖一抖），和一缕连到最近那个人的红紫细线（越到后面越亮）。 */
  private updateStraws(dt: number, w: World, f: YaoFight | null, alpha: number) {
    const g = this.threads;
    g.clear();
    const ids = new Set(f?.straws ?? []);
    for (const [id, s] of this.counts) {
      if (ids.has(id)) continue;
      s.destroy();
      this.counts.delete(id);
    }
    if (!f) return;
    const dg = digits();
    for (const id of f.straws) {
      const e = w.enemies.find((x) => x.id === id);
      if (!e || e.hp <= 0) continue;
      const left = Math.max(0, e.actT ?? 0);
      const n = Math.min(9, Math.ceil(left));
      let s = this.counts.get(id);
      if (!s) {
        s = new Sprite(dg.gold[n]);
        s.anchor.set(0.5, 1);
        this.stage.fx.addChild(s);
        this.counts.set(id, s);
      }
      const hot = left <= 3;
      s.texture = (hot ? dg.hot : dg.gold)[n];
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha);
      const jig = hot && Math.floor(this.time * 10) % 2 ? 1 : 0;
      s.position.set(x + jig, y - 23);
      // 拜魂的细线：草人胸口 → 最近那个人
      let p = null as (typeof w.players)[number] | null;
      let bd = Infinity;
      for (const q of w.players) {
        if (!q.alive) continue;
        const d = (q.x - e.x) ** 2 + (q.y - e.y) ** 2;
        if (d < bd) {
          bd = d;
          p = q;
        }
      }
      if (!p) continue;
      const k = 1 - left / Math.max(0.1, e.actLen ?? 8);
      const ax = x;
      const ay = y - 11;
      const bx = p.x;
      const by = p.y - 10;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(6, Math.round(len / 3));
      for (let i = 1; i < steps; i++) {
        const u = i / steps;
        const flow = 0.5 + 0.5 * Math.sin(u * 12 + this.time * (4 + k * 10));
        if (flow < 0.4) continue;
        g.rect(Math.round(ax + (bx - ax) * u), Math.round(ay + (by - ay) * u - Math.sin(u * Math.PI) * 6), 1, 1).fill({ color: hot ? C.m : C.p, alpha: (0.12 + 0.4 * k) * flow });
      }
    }
    void dt;
  }

  /** 被魂线定住：脚下缠着几缕往上爬的魂光（不是光圈），定多久缠多久。 */
  private updateRoots(dt: number, w: World) {
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const r = this.roots[i];
      r.t += dt;
      if (r.t >= r.dur) {
        this.roots.splice(i, 1);
        continue;
      }
      const p = w.players[r.owner];
      if (!p) continue;
      if (Math.random() < 0.7) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.glows.emit(p.x + side * rnd(2, 5), p.y - rnd(0, 4), 1, SOUL, [4, 10], [0.25, 0.45], { dir: -Math.PI / 2 + side * 0.4, spread: 0.3, drag: 2 });
      }
    }
  }

  /** 倒下：先闪白，再跪着慢慢褪成灰，身上的魂光一缕缕往下沉；对白里那一句出现（dissolve）后散成灰烟，落进脚下的阵眼。 */
  private updateCorpse(dt: number) {
    const c = this.corpse;
    if (!c) return;
    c.t += dt;
    const tx = textures();
    c.s.texture = c.t < 0.18 ? tx.flash.kneel[0] : tx.body.kneel[0];
    const ashK = ease(clamp01((c.t - 0.2) / 2.2));
    const mix = (a: number, b: number) => Math.round(a + (b - a) * ashK);
    c.s.tint = (mix(255, 160) << 16) | (mix(255, 156) << 8) | mix(255, 170);
    if (c.fade > 0) {
      c.fade += dt / 1.5;
      c.s.alpha = Math.max(0, 1 - ease(clamp01(c.fade)));
      // 散成一缕灰烟，往下沉进地里
      if (Math.random() < 0.9) this.sparks.emit(c.x + rnd(-8, 8), c.y - rnd(0, 24), 2, SMOKE, [4, 14], [0.8, 1.4], { dir: Math.PI / 2, spread: 0.6, drag: 1 });
      if (Math.random() < 0.4) this.glows.emit(c.x + rnd(-6, 6), c.y - rnd(0, 6), 1, SOUL, [3, 8], [0.4, 0.8], { dir: Math.PI / 2, spread: 0.5 });
      if (c.fade >= 1) {
        c.s.destroy();
        this.corpse = null;
      }
      return;
    }
    if (Math.random() < 0.4) this.glows.emit(c.x + rnd(-7, 7), c.y - 4 - rnd(0, 18), 1, SOUL, [2, 6], [0.6, 1.1], { up: 6, drag: 1 });
  }
}
