// 第三章首领「诛仙剑灵」的画面：本体（半透明的剑光身躯：精灵本身稍透，叠一层很淡的天青同形光；受击闪白、头顶血条）、身后悬着的四把剑
// （平时在背后排成扇面，环斩时绕着他转、一把把斩出去，突进时拖在身后）、入场时剑光往他身上聚拢、换阶段剑光迸开；
// 每一招的地面预警（淡红光，形状就是 ch3/zhuxian.ts 里每个危险物的判定）和招式本体：
//   四剑环斩——扇面（以他为圆心、半径 rad + 人物半径，起始边宽出人物半径 − 1），出手时一道剑光扫过；
//   剑雨——方格（半边长 cell / 2，按人物脚下算），落下前一柄剑从上面坠下，落地迸开、插在地上淡掉；
//   一剑化四——三个半透明的剑影（本体头上一点暗金的标记），剑气直线（长条，两侧各 hw + 人物半径）和飞过去的刃光；
//   四剑归阵——两道过场心的剑气墙（长条，两侧各 hw + 人物半径），墙本身是一线冷银的剑光，跟着转；
//   诛仙——剑阵：一圈插在地上的剑光（椭圆），圈外压一层冷灰的暗影，下一步要收进来的那一圈先亮淡红光；
//   连续突进——直线（两侧各 hw + 人物半径），冲的时候身后拖残影。
// 倒下：剑光身躯碎成一片片碎光，四把剑坠地插在他身边；对白里旁白那一句（dissolve）之后跪着的身子散去。
// 只读模拟状态（w.boss 是 ZhuxianFight 时）和事件，不回写模拟。接口和 ch2/yao-fx.ts 一样（feel.ts 都建，按 boss.kind 各管各的）。
// 用户口径：克制、不要光圈；剑不要画得过大；出现和消失都有过程。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { HitStop, Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { flashTextureFromGrid, once, textureFromGrid } from '../../render/textures.ts';
import { ZX_ANCHOR, ZX_FRAMES, ZX_H, ZX_W, type ZxArtPose } from '../../art/ch3/zhuxian.ts';
import { BOSS_SWORD_FRAMES, BOSS_SWORD_S, SWORD_DIRS, swordDir } from '../../art/ch3/decor.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { ZHUXIAN } from '../../sim/ch3/config.ts';
import { CLOSE_RATIO, closeR, zhuxianOf, zhuxianPose } from '../../sim/ch3/zhuxian.ts';
import { rayToOuter } from '../../sim/ch3/terrain.ts';
import type { ZhuxianFight, ZxHazard } from '../../sim/ch3/types.ts';
import { bossEnemy } from '../../sim/boss.ts';
import { Leaving, guestAsBoss } from '../guest-fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { BoxWarn, LaneWarn, SweepWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';

const C = { k: 0x1a1520, N: 0x1d2b4a, n: 0x2f5373, c: 0x3f8a9e, CC: 0x7cc4c4, T: 0x8d9aa6, Z: 0xc3ccd2, W: 0xffffff, U: 0x8a6a31, y: 0xe0a83a, Y: 0xf7dc7a, e: 0xd9452b, J: 0x6f8192, K: 0x2b323d };
const LIGHT = [C.Z, C.W, C.CC];
const SHARDS = [C.Z, C.T, C.CC, C.W];
const GOLD = [C.y, C.Y, C.U];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k * k * (3 - 2 * k);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const CX = 480;
const CY = 270;

/** 每个姿势的帧率（慢：剑灵的动作沉稳）。 */
const FPS: Record<ZxArtPose, number> = { idle: 2, walk: 5, raise: 3, slash: 6, point: 3, dash: 8, roar: 4, kneel: 1 };

type PoseTex = Record<ZxArtPose, Texture[]>;
let texCache: { body: PoseTex; flash: PoseTex; swords: Texture[][] } | null = null;
function textures() {
  if (texCache) return texCache;
  const mk = (f: typeof textureFromGrid) => Object.fromEntries(Object.entries(ZX_FRAMES).map(([k, v]) => [k, v.map(f)])) as PoseTex;
  texCache = { body: mk(textureFromGrid), flash: mk(flashTextureFromGrid), swords: BOSS_SWORD_FRAMES.map((ds) => ds.map(textureFromGrid)) };
  return texCache;
}

/** 本体头上的标记（一剑化四时分得清哪个是本体）：一枚小小的暗金菱形印。 */
function markTex(): Texture {
  return once('ch3:zx-mark', () => textureFromGrid({ w: 5, h: 5, rows: ['..y..', '.yYy.', 'yYWYy', '.yYy.', '..y..'] }));
}

interface HazView {
  h: ZxHazard;
  lane: LaneWarn | null;
  lane2: LaneWarn | null; // 剑气墙的另一半（墙过转轴往两头伸）
  fan: SweepWarn | null;
  box: BoxWarn | null;
  sword: Sprite | null; // 剑雨：坠下来的那一柄
  t: number;
  gone: number;
  landed: boolean;
}

interface Stuck {
  s: Sprite;
  t: number;
  life: number;
}

interface Corpse {
  s: Sprite;
  x: number;
  y: number;
  t: number;
  fade: number;
  facing: number;
  swords: { s: Sprite; x: number; y: number; t: number }[];
}

export class ZhuxianFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private hitStop: HitStop;
  private sfx: Sfx;
  private warns: WarnLayer;
  private light = new Graphics(); // 剑光（加法混合）：斩出去的刃光、剑气墙、剑阵
  private veil = new Graphics(); // 剑阵外的暗影（普通混合，压在角色下面）
  private ringWarn = new Graphics(); // 剑阵下一步要收进来的那一圈淡红光（预警层里）
  private views = new Map<number, HazView>();
  private body: Sprite | null = null;
  private aura: Sprite | null = null; // 本体叠的那层淡淡的天青同形光
  private shadow: Sprite | null = null;
  private mark: Sprite | null = null;
  private bar = new Graphics();
  private swords: Sprite[] = [];
  private ghosts: Sprite[] = []; // 一剑化四的剑影
  private trail: { s: Sprite; t: number }[] = [];
  private stuck: Stuck[] = []; // 剑雨落下插在地上的剑
  private bossId = -1;
  private animT = 0;
  private flash = 0;
  private born = 0;
  private lastPose: ZxArtPose = 'idle';
  private hurtSfxT = 0;
  /** 来遭遇战（首领池，sim/bosspool.ts）时：退走的身子慢慢淡出去；打倒了的不等对白，跪一会儿自己散（guestGone > 0 是还剩多久）。 */
  private leaving: Leaving;
  private guestGone = 0;
  private corpse: Corpse | null = null;
  private ringR = -1; // 剑阵现在画到多大（模拟里的半径，倒下后慢慢放大淡掉）
  private ringFade = 0;
  private veilR = -1; // 圈外暗影上一次按多大的圈画的（圈没变就不重画）
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
    warmWarnTextures({
      lanes: [ZHUXIAN.split.hw + PLAYER.radius, ZHUXIAN.walls.hw + PLAYER.radius, ZHUXIAN.rush.hw + PLAYER.radius],
      sweeps: [[ZHUXIAN.ring.rad + PLAYER.radius, PLAYER.radius - 1, ZHUXIAN.ring.arc]],
      boxes: [ZHUXIAN.rain.cell / 2],
      chevrons: [[3, false]],
    });
    this.light.blendMode = 'add';
    stage.glow.addChild(this.light);
    stage.floor.addChild(this.veil);
    this.ringWarn.blendMode = 'max';
    stage.fx.addChild(this.bar);
  }

  /** 倒下的首领还在不在场上（表现层用来定镜头、等它散去）。 */
  get focus(): { x: number; y: number } | null {
    return this.corpse && !this.guestGone && this.corpse.fade < 1 ? { x: this.corpse.x, y: this.corpse.y } : null;
  }

  clear() {
    for (const v of this.views.values()) this.dropView(v);
    this.views.clear();
    this.dropBody();
    if (this.corpse) {
      this.corpse.s.destroy();
      for (const sw of this.corpse.swords) sw.s.destroy();
    }
    this.corpse = null;
    this.leaving.clear();
    this.guestGone = 0;
    for (const s of this.stuck) s.s.destroy();
    this.stuck = [];
    for (const t of this.trail) t.s.destroy();
    this.trail = [];
    this.light.clear();
    this.veil.clear();
    this.ringWarn.clear();
    this.showRingWarn(false);
    this.bar.clear();
    this.bossId = -1;
    this.ringR = -1;
  }

  /** 对白里旁白那一句（剑灵碎裂、四剑坠地）：跪着的身子散去。 */
  dissolve() {
    if (this.corpse && this.corpse.fade <= 0) this.corpse.fade = 0.0001;
  }

  private dropBody() {
    for (const s of [this.body, this.aura, this.shadow, this.mark, ...this.swords, ...this.ghosts]) s?.destroy();
    this.body = this.aura = this.shadow = this.mark = null;
    this.swords = [];
    this.ghosts = [];
  }

  private dropView(v: HazView) {
    v.lane?.destroy();
    v.lane2?.destroy();
    v.fan?.destroy();
    v.box?.destroy();
    v.sword?.destroy();
  }

  private showRingWarn(on: boolean) {
    const root = this.warns.root;
    if (on && this.ringWarn.parent !== root) this.warns.add(this.ringWarn);
    else if (!on && this.ringWarn.parent === root) {
      root.removeChild(this.ringWarn);
      root.visible = root.children.length > 0;
    }
  }

  onEvent(e0: SimEvent, w: World, now: number) {
    const f = zhuxianOf(w);
    const e = guestAsBoss(e0, 'zhuxian'); // 来遭遇战（首领池）：现身、换阶段、倒下的画面和当首领时同一套（guest-fx.ts）
    switch (e.t) {
      case 'echoLeave':
        // 这一波结束还没打倒：收起招式，身子和身后的四剑留在原地慢慢淡成一片剑光
        if (e.kind !== 'zhuxian') break;
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        this.leaving.add([this.body, this.aura, this.shadow, this.mark, ...this.swords, ...this.ghosts], e.x, e.y, LIGHT);
        this.body = this.aura = this.shadow = this.mark = null;
        this.swords = [];
        this.ghosts = [];
        this.bar.clear();
        break;
      case 'bossIntro':
        if (!f) return;
        this.clear();
        this.bossId = e.id;
        this.born = 0;
        this.shake.add(0.35);
        // 入场：四面的剑光往一点聚拢，人从剑光里显出来
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * TAU;
          const r = rnd(40, 90);
          this.glows.emit(e.x + Math.cos(a) * r, e.y - 14 + Math.sin(a) * r * 0.6, 1, LIGHT, [r * 0.9, r * 1.2], [0.6, 0.9], { dir: a + Math.PI, spread: 0.05, drag: 1.2 });
        }
        this.sfx.play('zx.intro');
        break;
      case 'bossMove':
        if (!f) return;
        // 招式的声音（名字见 docs/audio.md「第三章」）
        if (e.move === 'ring') this.sfx.play('zx.ring.warn');
        if (e.move === 'rain') this.sfx.play('zx.rain.warn');
        if (e.move === 'split') this.sfx.play('zx.split');
        if (e.move === 'walls') this.sfx.play('zx.walls');
        if (e.move === 'rush') this.sfx.play('zx.rush.warn');
        break;
      case 'zxCast': {
        const h = f?.hazards.find((x) => x.id === e.hazard);
        if (h) this.addView(h);
        if (e.kind === 'dash') this.sfx.play('zx.dash.warn');
        break;
      }
      case 'zxStrike': {
        const v = this.views.get(e.hazard);
        if (v) {
          v.lane?.strike();
          v.lane2?.strike();
          v.fan?.strike();
          if (v.box) {
            v.box.strike();
            v.box.end(0.3);
          }
        }
        if (e.kind === 'arc') this.sfx.play('zx.arc');
        if (e.kind === 'lane') this.sfx.play('zx.lane');
        if (e.kind === 'dash') {
          this.sfx.play('zx.dash');
          this.shake.add(0.2);
        }
        if (e.kind === 'wall') {
          this.sfx.play('zx.wall');
          this.shake.add(0.3);
        }
        if (e.kind === 'cell' && v) this.cellImpact(v);
        break;
      }
      case 'zxSplit':
        for (let i = 0; i < 30; i++) this.glows.emit(e.x + rnd(-6, 6), e.y - rnd(4, 28), 1, LIGHT, [20, 60], [0.3, 0.6], { drag: 2 });
        break;
      case 'zxMerge':
        for (const g of this.ghosts) this.glows.emit(g.x, g.y - 14, 12, LIGHT, [10, 40], [0.3, 0.5], { drag: 2 });
        break;
      case 'zxCloseWarn':
        this.sfx.play('zx.close.warn');
        break;
      case 'zxClose':
        this.shake.add(0.25);
        this.sfx.play('zx.close');
        break;
      case 'zxDrain':
        break;
      case 'bossPhase':
        if (!f) return;
        this.shake.add(0.55);
        this.hitStop.trigger(now, 0.08);
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * TAU;
          this.glows.emit(e.x + Math.cos(a) * 4, e.y - 16 + Math.sin(a) * 6, 1, LIGHT, [40, 120], [0.4, 0.8], { dir: a, spread: 0.3, drag: 2.2 });
        }
        this.sfx.play('zx.phase'); // 大锣、剑鸣、一口钟（不用第一章的兽吼）
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
        this.hitStop.trigger(now, 0.2);
        this.shake.add(0.8);
        for (const v of this.views.values()) if (v.gone < 0) v.gone = 0;
        const tx = textures();
        const s = new Sprite(tx.flash.kneel[0]);
        s.anchor.set(ZX_ANCHOR.x / ZX_W, ZX_ANCHOR.y / ZX_H);
        s.position.set(Math.round(e.x), Math.round(e.y));
        s.scale.x = e.facing;
        s.zIndex = e.y;
        this.stage.entities.addChild(s);
        // 四剑坠地：从他身后飞起，落在身边四处，斜插在地上
        const swords = [0, 1, 2, 3].map((k) => {
          const a = (k / 4) * TAU + Math.PI / 4;
          const sp = new Sprite(tx.swords[k][swordDir(Math.PI / 2 + (k % 2 ? 0.35 : -0.35))]);
          sp.anchor.set(0.5);
          this.stage.entities.addChild(sp);
          return { s: sp, x: e.x + Math.cos(a) * 22, y: e.y + Math.sin(a) * 13, t: -k * 0.12 };
        });
        this.corpse = { s, x: e.x, y: e.y, t: 0, fade: 0, facing: e.facing, swords };
        this.dropBody();
        this.bar.clear();
        // 剑光身躯碎成一片片碎光
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * TAU;
          this.glows.emit(e.x + Math.cos(a) * 5, e.y - 16 + Math.sin(a) * 9, 1, SHARDS, [40, 140], [0.5, 1], { dir: a, spread: 0.3, drag: 2.5, up: 8 });
        }
        this.sfx.play('boss.death');
        this.guestGone = e0.t === 'echoDefeat' ? 1.3 : 0; // 遭遇战：没有战后对白，跪一会儿自己散
        break;
      }
    }
  }

  private addView(h: ZxHazard) {
    if (this.views.has(h.id)) return;
    const v: HazView = { h, lane: null, lane2: null, fan: null, box: null, sword: null, t: 0, gone: -1, landed: false };
    switch (h.kind) {
      case 'arc':
        v.fan = new SweepWarn(this.warns, h.x0, h.y0, h.rad + PLAYER.radius, h.a0, h.dir, PLAYER.radius - 1, h.arc);
        break;
      case 'cell':
        v.box = new BoxWarn(this.warns, h.x0, h.y0, h.r);
        break;
      case 'lane':
      case 'dash': {
        const speed = h.kind === 'dash' ? ZHUXIAN.rush.speed : ZHUXIAN.split.speed;
        v.lane = new LaneWarn(this.warns, h.x0, h.y0, h.x1, h.y1, h.r + PLAYER.radius, speed, { every: 18, start: 16, size: 3 });
        break;
      }
      case 'wall': {
        // 过转轴往两头各一段（伸到场外），转的时候整段跟着转（不放箭头：箭头的纹理不跟着转）
        const R = h.r + PLAYER.radius;
        const L1 = rayToOuter(h.x0, h.y0, Math.cos(h.a0), Math.sin(h.a0)) + 60;
        const L2 = rayToOuter(h.x0, h.y0, -Math.cos(h.a0), -Math.sin(h.a0)) + 60;
        const L = Math.max(L1, L2, 700);
        v.lane = new LaneWarn(this.warns, h.x0, h.y0, h.x0 + Math.cos(h.a0) * L, h.y0 + Math.sin(h.a0) * L, R, 0);
        v.lane2 = new LaneWarn(this.warns, h.x0, h.y0, h.x0 - Math.cos(h.a0) * L, h.y0 - Math.sin(h.a0) * L, R, 0);
        break;
      }
    }
    this.views.set(h.id, v);
  }

  /** 剑雨的一格落地：迸开一点碎石和剑光，那一柄剑插在地上淡掉。 */
  private cellImpact(v: HazView) {
    const h = v.h;
    this.sparks.emit(h.x0, h.y0 - 1, 5, [0x8d9aa6, 0x5a6675, 0x4c5766], [20, 50], [0.25, 0.45], { up: 10, g: 80, drag: 2 });
    this.glows.emit(h.x0, h.y0 - 4, 4, LIGHT, [20, 50], [0.15, 0.3], { drag: 3 });
    if (v.sword) {
      v.sword.position.set(Math.round(h.x0), Math.round(h.y0 - 6));
      this.stuck.push({ s: v.sword, t: 0, life: 0.9 });
      v.sword = null;
    }
    v.landed = true;
    if (Math.random() < 0.3) this.sfx.play('zx.cell'); // 一拨落几十柄：只响一部分（bank.ts 里还有最短间隔）
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.animT += dt;
    this.flash = Math.max(0, this.flash - dt);
    const f = zhuxianOf(w);
    const live = new Set<number>();
    if (f) for (const h of f.hazards) live.add(h.id);
    this.light.clear();
    for (const [id, v] of this.views) {
      v.t += dt;
      if (v.gone < 0 && !live.has(id)) v.gone = 0;
      if (v.gone >= 0) v.gone += dt;
      if (this.drawView(v, dt, alpha, w)) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.t += dt;
      s.s.alpha = 1 - ease(clamp01((s.t - 0.4) / (s.life - 0.4)));
      if (s.t >= s.life) {
        s.s.destroy();
        this.stuck.splice(i, 1);
      }
    }
    this.updateRing(dt, w, f, alpha);
    this.updateBody(dt, w, f, alpha);
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
    const head = struck ? h.prev + (h.head - h.prev) * alpha : 0;
    const g = this.light;
    switch (h.kind) {
      case 'arc': {
        const fan = v.fan!;
        if (v.gone >= 0) fan.end(0.3);
        fan.draw(dt, k, head);
        if (struck && v.gone < 0) {
          // 剑光扫过：从他身边伸到扇面的边——一道连着的刃光（霜白），紧跟着两道淡一些的（冷银、天青），像刃过留下的影
          for (let j = 0; j < 3; j++) {
            const ang = h.a0 + h.dir * Math.max(0, head - j * 0.05);
            const a = [0.95, 0.55, 0.3][j];
            for (let d = 10; d <= h.rad; d += 1) {
              const fade = d > h.rad - 14 ? (h.rad - d) / 14 : 1;
              g.rect(Math.round(h.x0 + Math.cos(ang) * d), Math.round(h.y0 + Math.sin(ang) * d - 6), 1, 1).fill({ color: [C.W, C.Z, C.CC][j], alpha: a * fade });
            }
          }
          if (Math.random() < 0.7) {
            const ang = h.a0 + h.dir * head;
            this.glows.emit(h.x0 + Math.cos(ang) * h.rad * 0.9, h.y0 + Math.sin(ang) * h.rad * 0.9 - 6, 1, LIGHT, [10, 30], [0.15, 0.3], { drag: 3 });
          }
        }
        return fan.done;
      }
      case 'cell': {
        const box = v.box!;
        if (v.gone >= 0 && !struck) box.end(0.2);
        box.draw(dt, k);
        // 落下之前 0.18 秒：一柄剑从上面坠下来（剑尖朝下），落地那一刻正好出手
        const fall = h.warn - h.t;
        if (!v.landed && fall < 0.18 && fall > -0.05 && v.gone < 0) {
          if (!v.sword) {
            const tx = textures();
            v.sword = new Sprite(tx.swords[(h.id >> 1) % 4][swordDir(Math.PI / 2)]);
            v.sword.anchor.set(0.5);
            this.stage.entities.addChild(v.sword);
          }
          const kk = clamp01(1 - fall / 0.18);
          v.sword.position.set(Math.round(h.x0), Math.round(h.y0 - 6 - (1 - kk * kk) * 70));
          v.sword.zIndex = h.y0;
          v.sword.alpha = 0.4 + 0.6 * kk;
        }
        if (v.gone >= 0 && v.sword) {
          v.sword.destroy();
          v.sword = null;
        }
        return box.done && !v.sword;
      }
      case 'lane':
      case 'dash': {
        const lane = v.lane!;
        if (v.gone >= 0) lane.end(0.3);
        lane.draw(dt, k, struck ? { from: Math.max(0, head - 4), to: lane.len, head } : undefined);
        if (struck && v.gone < 0 && h.kind === 'lane') {
          // 剑气飞过去：头上一弯刃光，身后一截渐淡的剑光
          const L = lane.len;
          const ux = (h.x1 - h.x0) / L;
          const uy = (h.y1 - h.y0) / L;
          const hx = h.x0 + ux * head;
          const hy = h.y0 + uy * head;
          for (let d = 0; d < 46 && head - d > 0; d += 1) {
            const a = (1 - d / 46) ** 1.5;
            g.rect(Math.round(hx - ux * d), Math.round(hy - uy * d - 6), 1, 1).fill({ color: d < 5 ? C.W : C.Z, alpha: 0.85 * a });
          }
          const R = h.r + 1;
          for (let o = -R; o <= R; o += 0.5) {
            const bend = (1 - (o / R) ** 2) * 3;
            g.rect(Math.round(hx - uy * o + ux * bend), Math.round(hy + ux * o + uy * bend - 6), 1, 1).fill({ color: Math.abs(o) < R * 0.5 ? C.W : C.CC, alpha: 0.9 });
          }
          if (Math.random() < 0.6) this.glows.emit(hx, hy - 6, 1, LIGHT, [10, 30], [0.15, 0.3], { drag: 3 });
        }
        return lane.done;
      }
      case 'wall': {
        const lane = v.lane!;
        const lane2 = v.lane2!;
        if (v.gone >= 0) {
          lane.end(0.4);
          lane2.end(0.4);
        }
        // 跟着模拟里的角度转（转轴不动）
        const a = h.a0;
        lane.c.rotation = a;
        lane2.c.rotation = a + Math.PI;
        lane.draw(dt, k, struck ? { from: 0, to: lane.len } : undefined);
        lane2.draw(dt, k, struck ? { from: 0, to: lane2.len } : undefined);
        // 墙本身：一段段顺着墙流过去的剑光（霜白的刃、天青的影；一明一暗、断断续续，不是一条从头画到尾的直线），
        // 预警时淡、起来以后亮，上面零星闪几点寒光；只画镜头附近的那一段
        const out = v.gone >= 0 ? 1 - clamp01(v.gone / 0.4) : 1;
        const lit = (struck ? 0.9 : 0.35 * ease(k)) * out;
        if (lit > 0.01) {
          const ux = Math.cos(a);
          const uy = Math.sin(a);
          const L = Math.max(lane.len, lane2.len);
          const cam = this.stage.cam;
          const flow = this.time * (struck ? 90 : 30) * h.dir;
          for (let d = -L; d < L; d += 9) {
            const x = h.x0 + ux * d;
            const y = h.y0 + uy * d;
            if (x < cam.x - 20 || x > cam.x + 500 || y < cam.y - 20 || y > cam.y + 290) continue;
            const pulse = 0.5 + 0.5 * Math.sin((d + flow) * 0.045);
            const len = 3 + Math.round(4 * pulse);
            const al = lit * (0.35 + 0.65 * pulse);
            g.moveTo(x, y - 2).lineTo(x + ux * len, y + uy * len - 2).stroke({ width: 1, color: pulse > 0.85 ? C.W : C.Z, alpha: al });
            g.moveTo(x - uy, y + ux - 2).lineTo(x - uy + ux * len, y + ux + uy * len - 2).stroke({ width: 1, color: C.CC, alpha: al * 0.4 });
          }
          if (struck) {
            const cam = this.stage.cam;
            for (let j = 0; j < 3; j++) {
              const d = rnd(-L, L);
              const x = h.x0 + ux * d;
              const y = h.y0 + uy * d;
              if (x < cam.x - 10 || x > cam.x + 490 || y < cam.y - 10 || y > cam.y + 280) continue;
              this.glows.emit(x, y - 2, 1, LIGHT, [4, 14], [0.2, 0.4], { up: 6, drag: 2 });
            }
          }
        }
        return lane.done && lane2.done;
      }
    }
  }

  /**
   * 诛仙的剑阵：一圈插在地上的剑光（每隔十来像素一柄：一线霜白的刃、底下一点暗金），一明一暗地闪；
   * 圈外压一层冷灰的暗影（越往外越浓，边上几档渐变，不是一条硬边）；下一步要收进来的那一圈（预警中）亮淡红光。
   * 倒下后剑阵慢慢往外放大、淡掉。
   */
  private updateRing(dt: number, w: World, f: ZhuxianFight | null, alpha: number) {
    const K = f?.close;
    const on = !!K && K.on && f!.state !== 'dead';
    if (on) {
      const rx = K!.t >= 0 ? K!.from + (K!.to - K!.from) * ease(clamp01((K!.t + alpha * DT) / ZHUXIAN.close.move)) : K!.rx;
      this.ringR = rx;
      this.ringFade = Math.min(1, this.ringFade + dt / 0.8);
    } else if (this.ringR > 0) {
      this.ringR += dt * 160;
      this.ringFade = Math.max(0, this.ringFade - dt / 1.2);
      if (this.ringFade <= 0) this.ringR = -1;
    }
    const veil = this.veil;
    this.ringWarn.clear();
    if (this.ringR <= 0) {
      if (this.veilR >= 0) veil.clear();
      this.veilR = -1;
      this.showRingWarn(false);
      return;
    }
    const rx = this.ringR;
    const ry = rx * CLOSE_RATIO;
    const fade = this.ringFade;
    // 圈外的暗影：一大块减去椭圆，边上再叠几圈越来越淡的（渐变的边）；圈没变就只改透明度，不重画
    if (Math.abs(rx - this.veilR) >= 0.5) {
      this.veilR = rx;
      veil.clear();
      const big = 2600;
      veil.rect(CX - big, CY - big, big * 2, big * 2).fill({ color: C.K, alpha: 0.26 });
      veil.ellipse(CX, CY, rx + 14, ry + 14 * CLOSE_RATIO).cut();
      for (let j = 0; j < 4; j++) {
        const o = 2 + j * 4;
        veil.ellipse(CX, CY, rx + o, ry + o * CLOSE_RATIO).stroke({ width: 4, color: C.K, alpha: 0.26 * ((j + 1) / 5) });
      }
    }
    veil.alpha = fade;
    // 剑阵：一圈剑光（只画镜头附近的）
    const g = this.light;
    const cam = this.stage.cam;
    const per = Math.max(60, Math.round((TAU * Math.sqrt((rx * rx + ry * ry) / 2)) / 11));
    for (let i = 0; i < per; i++) {
      const a = (i / per) * TAU + this.time * 0.02;
      const x = Math.round(CX + Math.cos(a) * rx);
      const y = Math.round(CY + Math.sin(a) * ry);
      if (x < cam.x - 8 || x > cam.x + 488 || y < cam.y - 12 || y > cam.y + 282) continue;
      // 每一柄剑光高矮不一、明暗不一（按编号定，不是一排齐整的栅栏）；一道亮光顺着圈慢慢走过去
      const hsh = ((i * 2654435761) >>> 0) / 4294967296;
      const tall = 3 + Math.round(hsh * 5);
      const wave = Math.max(0, Math.cos(a * 3 - this.time * 1.4)) ** 6;
      const flick = (0.45 + 0.4 * Math.sin(this.time * 2.3 + i * 1.7) + 0.5 * wave) * fade;
      const lean = hsh > 0.7 ? 1 : hsh < 0.25 ? -1 : 0; // 有的微微斜着插
      g.moveTo(x, y - 1).lineTo(x + lean, y - 1 - tall).stroke({ width: 1, color: hsh > 0.8 ? C.CC : C.Z, alpha: Math.min(1, 0.65 * flick) });
      g.rect(x + lean, y - 2 - tall, 1, 1).fill({ color: C.W, alpha: Math.min(1, 0.85 * flick) });
      g.rect(x - 1, y - 1, 3, 1).fill({ color: C.U, alpha: 0.55 * fade });
      if (Math.random() < 0.004 + wave * 0.02) this.glows.emit(x, y - 4, 1, LIGHT, [4, 12], [0.3, 0.5], { up: 8 });
    }
    // 下一步要收进来的那一圈：淡红光（判定：出了下一步的圈就挨剑气），随预警推亮
    if (on && K!.warned && K!.t < 0 && K!.step < ZHUXIAN.close.steps) {
      const to = closeR(K!.step + 1);
      const kk = clamp01(1 - K!.next / ZHUXIAN.close.warn);
      const band = rx - to;
      const mid = (rx + to) / 2;
      const a = 0.2 + 0.22 * ease(kk);
      for (let j = 0; j < Math.max(1, Math.round(band / 3)); j++) {
        const r = to + 1.5 + j * 3;
        if (r > rx) break;
        this.ringWarn.ellipse(CX, CY, r, r * CLOSE_RATIO).stroke({ width: 3, color: C.e, alpha: r < mid ? a : a * 0.85 });
      }
      this.ringWarn.ellipse(CX, CY, to, to * CLOSE_RATIO).stroke({ width: 1, color: C.e, alpha: a * 0.5 });
      this.showRingWarn(true);
    } else this.showRingWarn(false);
  }

  private updateBody(dt: number, w: World, f: ZhuxianFight | null, alpha: number) {
    const b = f && f.state !== 'dead' ? bossEnemy(w) : null;
    if (!b || !f) {
      if (this.body && !this.corpse) {
        this.dropBody();
        this.bar.clear();
      }
      for (let i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].s.destroy();
        this.trail.splice(i, 1);
      }
      return;
    }
    const tx = textures();
    if (!this.body) {
      this.body = new Sprite(tx.body.idle[0]);
      this.body.anchor.set(ZX_ANCHOR.x / ZX_W, ZX_ANCHOR.y / ZX_H);
      this.stage.entities.addChild(this.body);
      this.aura = new Sprite(tx.flash.idle[0]);
      this.aura.anchor.copyFrom(this.body.anchor);
      this.aura.blendMode = 'add';
      this.aura.tint = C.CC;
      this.stage.glow.addChild(this.aura);
      this.shadow = new Sprite(this.stage.tex.shadow);
      this.shadow.anchor.set(0.5);
      this.shadow.alpha = 0.35;
      this.stage.floor.addChild(this.shadow);
      this.mark = new Sprite(markTex());
      this.mark.anchor.set(0.5);
      this.stage.fx.addChild(this.mark);
      for (let k = 0; k < 4; k++) {
        const s = new Sprite(tx.swords[k][swordDir(-Math.PI / 2)]);
        s.anchor.set(0.5);
        this.stage.entities.addChild(s);
        this.swords.push(s);
      }
      this.bossId = b.id;
    }
    this.born += dt;
    const x = Math.round(b.px + (b.x - b.px) * alpha);
    const y = Math.round(b.py + (b.y - b.py) * alpha);
    const pose = zhuxianPose(f);
    if (pose !== this.lastPose) this.animT = this.animT % 10;
    this.lastPose = pose;
    const fr = (this.flash > 0 ? tx.flash : tx.body)[pose];
    const fi = Math.floor(this.animT * FPS[pose]) % fr.length;
    this.body.texture = fr[fi];
    this.body.scale.x = f.facing;
    this.body.position.set(x, y);
    this.body.zIndex = y;
    // 入场：从剑光里慢慢显出来；平时稍透，剑光身躯一明一暗
    const intro = f.state === 'intro' ? clamp01((this.born - 0.4) / 1.2) : 1;
    const breathe = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    this.body.alpha = (0.82 + 0.06 * breathe) * (0.15 + 0.85 * intro);
    this.body.tint = this.flash > 0 ? 0xffffff : f.state === 'phase' ? (Math.sin(this.animT * 18) > 0 ? 0xffffff : 0xdfe8f0) : 0xf2f6fa;
    this.aura!.texture = tx.flash[pose][fi];
    this.aura!.scale.x = f.facing;
    this.aura!.position.set(x, y);
    this.aura!.alpha = (0.1 + 0.08 * breathe) * intro;
    this.shadow!.position.set(x, y);
    this.shadow!.alpha = 0.35 * Math.max(0.3, intro);
    // 剑光身躯：身上零星往上飘几粒碎光
    if (Math.random() < 0.3) this.glows.emit(x + rnd(-6, 6), y - rnd(2, 30), 1, LIGHT, [3, 10], [0.3, 0.6], { up: 8, drag: 1 });
    // 本体的标记：一剑化四时头上一枚暗金的印（一明一暗）
    const split = f.shadows.length > 0;
    this.mark!.visible = split;
    if (split) {
      this.mark!.position.set(x, y - 42 + Math.round(Math.sin(this.time * 4)));
      this.mark!.alpha = 0.7 + 0.3 * Math.sin(this.time * 7);
    }
    this.updateSwords(f, x, y, alpha);
    this.updateGhosts(f, alpha, fr[fi]);
    // 突进：身后拖残影
    const dashing = f.hazards.some((h) => h.kind === 'dash' && h.t >= h.warn);
    if (dashing && Math.floor(this.time / 0.03) !== Math.floor((this.time - dt) / 0.03)) {
      const s = new Sprite(tx.flash[pose][fi]);
      s.anchor.copyFrom(this.body.anchor);
      s.scale.x = f.facing;
      s.position.set(x, y);
      s.tint = C.CC;
      s.alpha = 0.4;
      s.blendMode = 'add';
      this.stage.glow.addChild(s);
      this.trail.push({ s, t: 0 });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const t = this.trail[i];
      t.t += dt;
      t.s.alpha = Math.max(0, 0.4 - t.t * 1.6);
      if (t.s.alpha <= 0) {
        t.s.destroy();
        this.trail.splice(i, 1);
      }
    }
    // 头顶的血条：24 像素，60% 与 30% 处两道刻度
    const bw = 24;
    const frac = Math.max(0, b.hp / b.maxHp);
    const bx = x - bw / 2;
    const by = y - 47;
    this.bar.clear().rect(bx - 1, by - 1, bw + 2, 4).fill({ color: C.k, alpha: 0.85 });
    this.bar.rect(bx, by, Math.round(bw * frac), 2).fill({ color: f.phase >= 3 ? C.Z : C.CC });
    for (const t of ZHUXIAN.phases) this.bar.rect(Math.round(bx + bw * t), by - 1, 1, 4).fill({ color: C.Y, alpha: 0.85 });
    this.bar.alpha = f.state === 'intro' ? intro : 1;
  }

  /**
   * 身后的四把剑：平时在背后排成一面扇（剑尖朝上，慢慢浮）；四剑环斩时绕着他转，斩到哪一把，哪一把顺着那一斩的方向飞出去再回来；
   * 剑雨、四剑归阵时举在头顶；突进时拖在身后排成一列；一剑化四时剑影各拿一把（本体只留一把）。
   */
  private updateSwords(f: ZhuxianFight, x: number, y: number, alpha: number) {
    const tx = textures();
    const arcs = f.hazards.filter((h) => h.kind === 'arc');
    const dashing = f.hazards.find((h) => h.kind === 'dash' && h.t >= h.warn);
    const raise = f.state === 'cast' && (f.move === 'rain' || f.move === 'walls');
    const ringing = f.state === 'cast' && f.move === 'ring';
    for (let k = 0; k < 4; k++) {
      const s = this.swords[k];
      let sx = x + [-9, -4, 4, 9][k];
      let sy = y - [27, 31, 31, 27][k] + Math.round(Math.sin(this.time * 1.6 + k) * 1);
      let dir = -Math.PI / 2 + [-0.35, -0.12, 0.12, 0.35][k];
      s.visible = true;
      if (ringing) {
        // 绕着他转；正在斩的那一把顺着那一斩的方向飞出去
        const base = this.time * 2.2 * f.spin + (k / 4) * TAU;
        const h = arcs.find((a) => a.src === k);
        if (h && h.t >= h.warn) {
          const prog = h.prev + (h.head - h.prev) * alpha;
          const ang = h.a0 + h.dir * prog;
          const out = Math.sin(clamp01((h.t - h.warn) / Math.max(0.01, h.live)) * Math.PI) * (h.rad * 0.7) + 16;
          sx = x + Math.cos(ang) * out;
          sy = y - 12 + Math.sin(ang) * out;
          dir = ang;
        } else {
          sx = x + Math.cos(base) * 16;
          sy = y - 14 + Math.sin(base) * 8;
          dir = base + (Math.PI / 2) * f.spin;
        }
      } else if (raise) {
        sx = x + [-7, -2, 2, 7][k];
        sy = y - 46 - (k === 1 || k === 2 ? 4 : 0) + Math.round(Math.sin(this.time * 3 + k) * 1);
        dir = Math.PI / 2;
      } else if (dashing) {
        const L = Math.hypot(dashing.x1 - dashing.x0, dashing.y1 - dashing.y0) || 1;
        const ux = (dashing.x1 - dashing.x0) / L;
        const uy = (dashing.y1 - dashing.y0) / L;
        sx = x - ux * (12 + k * 8);
        sy = y - 14 - uy * (12 + k * 8);
        dir = Math.atan2(uy, ux);
      } else if (f.shadows.length && k > 0) {
        s.visible = false; // 剑影各拿着一把（updateGhosts 画）
      }
      s.texture = tx.swords[k][swordDir(dir) % SWORD_DIRS];
      s.position.set(Math.round(sx), Math.round(sy));
      s.zIndex = ringing || dashing ? y + (Math.sin(this.time + k) > 0 ? 1 : -1) : y - 1;
      s.alpha = this.body!.alpha;
    }
    void BOSS_SWORD_S;
  }

  /** 一剑化四的剑影：半透明的天青身影（和本体同一帧），各拿一把剑举在头顶。 */
  private updateGhosts(f: ZhuxianFight, alpha: number, tex: Texture) {
    const tx = textures();
    while (this.ghosts.length < f.shadows.length * 2) {
      const s = new Sprite(tex);
      s.anchor.set(ZX_ANCHOR.x / ZX_W, ZX_ANCHOR.y / ZX_H);
      this.stage.entities.addChild(s);
      const sw = new Sprite(tx.swords[0][0]);
      sw.anchor.set(0.5);
      this.stage.entities.addChild(sw);
      this.ghosts.push(s, sw);
    }
    while (this.ghosts.length > f.shadows.length * 2) this.ghosts.pop()!.destroy();
    f.shadows.forEach((c, i) => {
      const s = this.ghosts[i * 2];
      const sw = this.ghosts[i * 2 + 1];
      const x = Math.round(c.px + (c.x - c.px) * alpha);
      const y = Math.round(c.py + (c.y - c.py) * alpha);
      s.texture = tex;
      s.scale.x = c.facing;
      s.position.set(x, y);
      s.zIndex = y;
      s.tint = C.CC;
      s.alpha = 0.42 + 0.08 * Math.sin(this.time * 5 + i);
      sw.texture = tx.swords[c.src % 4][swordDir(-Math.PI / 2)];
      sw.position.set(x, y - 31 + Math.round(Math.sin(this.time * 2 + i)));
      sw.zIndex = y - 1;
      sw.alpha = s.alpha + 0.2;
      if (Math.random() < 0.2) this.glows.emit(x + rnd(-5, 5), y - rnd(4, 28), 1, LIGHT, [3, 10], [0.2, 0.4], { up: 6 });
    });
  }

  /** 倒下：先闪白，跪着的剑光身躯慢慢暗下去，碎光一缕缕往上飘；四把剑落下插在他身边；对白那一句之后整个散去。 */
  private updateCorpse(dt: number) {
    const c = this.corpse;
    if (!c) return;
    c.t += dt;
    const tx = textures();
    c.s.texture = c.t < 0.2 ? tx.flash.kneel[0] : tx.body.kneel[0];
    const dim = ease(clamp01((c.t - 0.2) / 2));
    c.s.alpha = (0.85 - 0.35 * dim) * (1 - ease(clamp01(c.fade)));
    for (const sw of c.swords) {
      sw.t += dt;
      // 先从他身后飞起（往上一扬），再斜着坠下，插进地里
      const k = clamp01(sw.t / 0.55);
      const up = Math.sin(k * Math.PI) * 26;
      const px = c.x + (sw.x - c.x) * k;
      const py = c.y - 26 + (sw.y - 8 - (c.y - 26)) * k - up;
      sw.s.visible = sw.t > 0;
      sw.s.position.set(Math.round(px), Math.round(py));
      sw.s.zIndex = sw.y;
      if (k >= 1 && sw.t - dt < 0.55) {
        this.sparks.emit(sw.x, sw.y, 6, [0x8d9aa6, 0x5a6675], [20, 50], [0.25, 0.45], { up: 10, g: 80, drag: 2 });
        this.shake.add(0.08);
      }
      sw.s.alpha = 1 - ease(clamp01(c.fade));
    }
    if (c.fade > 0) {
      c.fade += dt / 1.6;
      if (Math.random() < 0.9) this.glows.emit(c.x + rnd(-8, 8), c.y - rnd(0, 26), 2, SHARDS, [6, 20], [0.6, 1.1], { up: 14, drag: 1 });
      if (c.fade >= 1) {
        c.s.destroy();
        for (const sw of c.swords) sw.s.destroy();
        this.corpse = null;
      }
      return;
    }
    if (Math.random() < 0.4) this.glows.emit(c.x + rnd(-7, 7), c.y - 4 - rnd(0, 20), 1, LIGHT, [2, 6], [0.6, 1.1], { up: 6, drag: 1 });
  }
}
