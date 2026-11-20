// 雷震子神通「风雷翅」和被动「生翅」的画面（和别的特效模块同一个接口：onEvent / update / clear）。
// 另外告诉 HeroFx（再由它告诉 feel.ts）两件事：这一帧人物换哪一组帧（pose：fly / dive / slam）、离地多高（lift，人物往上画、影子留在地上）。
// 只读模拟的事件（skill / dive / wingSlam）和 Player.wing（这一趟飞到哪一段）。
// - 腾空：脚下一圈尘土往外卷开、几片翎羽飘起；双翅一展，一下下扇着往上升到约 16 像素高。
// - 俯冲：双翅往后收成两把刀，人从高处扑下来，身后拖三道淡淡的风痕（扑完就散）。
// - 砸下：天上劈下一道金白的雷落在棍头砸着的地方（雷公鞭那一套闪电，换成金色），双翅一下子张开；落点一圈风浪往外掀开——
//   断开的几截淡白风弧贴着地往外推、尘土往四周卷，不画整圈、不画光圈；砸完弹起接下一下。最后一下砸完，双翅收拢落地。
// - 双翅展开的时候翅尖、前缘时不时窜一点白金电光（一两个像素，一闪就灭）。
// - 生翅：踩在红水阵、红沙这些减速的地上时，脚下离地一点点滑过去，脚边带起两缕风尘。
// 用户口径：不要光圈；特效出现和消失都有过程；尺寸收着（展开的双翅单只约 23 像素，比人矮）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { FLAP, FLARE, makeWingFrames, SWEPT, WINGS_H, WINGS_ROOT, WINGS_W, type WingShape } from '../../art/sprites/leizhenzi-wings.ts';
import { LEIZHENZI_ANCHOR, WING_ROOT } from '../../art/sprites/leizhenzi.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { Bits, Bolt, C, clamp01, easeOut, Pixels, rnd, type Ctx, type Effect } from '../fx.ts';
import type { HeroPose } from '../hero-views.ts';
import { sandSpeedMul } from '../../sim/enemies.ts';
import { terrainSpeedMul } from '../../sim/chapters.ts';
import { groundFree } from '../../sim/heroes/passives.ts';
import type { Player, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const DUST = [0x6b5749, 0x776672, 0x9a8a86, 0xb3b8a6];
const FEATHER = [C.l, C.L, C.v];
/** 腾空升到多高、砸完弹起多高（像素）。 */
const RISE = 16;
const BOUNCE = 11;
/** 每组帧里翅根相对脚底锚点的位置（上身前倾、下沉多少照 leizhenzi.ts 的 fly / dive / slam）。 */
const ROOT: Record<'fly' | 'dive' | 'slam', [number, number]> = {
  fly: [WING_ROOT.x + 1 - LEIZHENZI_ANCHOR.x, WING_ROOT.y - LEIZHENZI_ANCHOR.y],
  dive: [WING_ROOT.x + 2 - LEIZHENZI_ANCHOR.x, WING_ROOT.y - LEIZHENZI_ANCHOR.y],
  slam: [WING_ROOT.x + 1 - LEIZHENZI_ANCHOR.x, WING_ROOT.y + 2 - LEIZHENZI_ANCHOR.y],
};

interface Flight {
  pose: HeroPose | null;
  lift: number;
  wing: Sprite;
  shape: WingShape | null; // 这一帧翅膀的样子（翅尖窜电光用）
  flap: number; // 扇翅的计时
  slam: number; // 上一下砸下之后过了多久（砸下那一下张开双翅）
  fold: number; // 落地之后收翅（淡掉）还剩多久
  on: boolean; // 这一帧还在飞
}
interface Trail {
  owner: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  t: number;
  dur: number;
}
interface Gust {
  x: number;
  y: number;
  r: number;
  t: number;
  arcs: [number, number][]; // 每一截风弧的起止角度
}

export class WingFx {
  private flights = new Map<number, Flight>();
  private trails: Trail[] = [];
  private gusts: Gust[] = [];
  private effects: Effect[] = [];
  private glide = new Map<number, number>(); // 生翅：滑着的那一点高度（平滑进出）
  private tex: { flap: Texture[]; swept: Texture; flare: Texture } | null = null;
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private floor = new Container();
  private bits: Bits;
  private ctx: Ctx;
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.floor);
    this.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.bits = new Bits(this.layer, stage.entities);
    this.layer.addChild(this.top.g);
    const self = this;
    this.ctx = {
      bits: this.bits,
      top: this.top,
      under: this.under,
      sparks,
      glows,
      stage,
      layer: this.layer,
      floor: this.floor,
      shake,
      sound: (name, vol = 1) => self.play(name, 'leigong.strike', vol),
      enemyPos: () => null,
      enemy: () => undefined,
      get time() {
        return self.time;
      },
    };
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  private textures() {
    if (!this.tex) {
      const f = makeWingFrames();
      this.tex = { flap: f.flap.map(textureFromGrid), swept: textureFromGrid(f.swept), flare: textureFromGrid(f.flare) };
    }
    return this.tex;
  }

  /** 人物这一帧要换的姿势（飞着的时候；没在飞 = null）。 */
  pose(owner: number): HeroPose | null {
    return this.flights.get(owner)?.pose ?? null;
  }

  /** 人物离地多高（像素；神通腾空、被动生翅滑着）。 */
  lift(owner: number): number {
    return (this.flights.get(owner)?.lift ?? 0) + (this.glide.get(owner) ?? 0);
  }

  /** 正飞在半空（神通给的无敌：人物不闪）。 */
  airborne(owner: number): boolean {
    return !!this.flights.get(owner)?.on;
  }

  clear() {
    for (const f of this.flights.values()) f.wing.destroy();
    this.flights.clear();
    this.trails = [];
    this.gusts = [];
    for (const e of this.effects) e.destroy();
    this.effects = [];
    this.bits.clear();
    this.glide.clear();
    this.top.flush();
    this.under.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'skill': {
        if (e.kind !== 'fenglei') break;
        // 腾空：脚下一圈尘土贴地往外卷开，几片翎羽飘起来
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + rnd(-0.15, 0.15);
          this.sparks.emit(e.x + Math.cos(a) * 4, e.y + Math.sin(a) * 2.5, 1, DUST, [50, 90], [0.35, 0.6], { dir: a, spread: 0.3, drag: 4 });
        }
        this.sparks.emit(e.x - 3, e.y - 16, 6, FEATHER, [15, 40], [0.6, 1.1], { up: 20, g: 30, drag: 2 });
        this.play('fenglei.rise', 'dingfeng.gust', 0.9);
        break;
      }
      case 'dive': {
        const z0 = e.seq === 1 ? RISE : BOUNCE;
        this.trails.push({ owner: e.owner, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, z0, t: 0, dur: e.t2 });
        this.play('fenglei.dive', 'wind.dash', 0.8);
        break;
      }
      case 'wingSlam': {
        const f = this.flights.get(e.owner);
        if (f) f.slam = 0;
        // 天上劈下一道金白的雷，落在棍头砸着的地方
        this.effects.push(new Bolt(this.ctx, [[e.x + 4 * (w.players[e.owner]?.facing ?? 1), e.y]], 'gold', { trunk: 3, branches: 2, skyEach: false, whip: false, skyOnly: true }));
        // 一圈风浪：断开的几截风弧贴着地往外推（不画整圈）
        const arcs: [number, number][] = [];
        let a = rnd(0, 0.6);
        while (a < Math.PI * 2 - 0.3) {
          const len = rnd(0.35, 0.6);
          arcs.push([a, a + len]);
          a += len + rnd(0.25, 0.45);
        }
        this.gusts.push({ x: e.x, y: e.y, r: e.r, t: 0, arcs });
        for (let i = 0; i < 20; i++) {
          const b = (i / 20) * Math.PI * 2 + rnd(-0.1, 0.1);
          this.sparks.emit(e.x + Math.cos(b) * 6, e.y + Math.sin(b) * 4, 1, DUST, [e.r * 2, e.r * 3.4], [0.3, 0.55], { dir: b, spread: 0.25, drag: 4.5 });
        }
        this.sparks.emit(e.x, e.y - 2, 5, [0x4f5652, 0x6d756c, 0x6b5749], [30, 70], [0.35, 0.6], { up: 60, g: 260, drag: 1.5 });
        this.sparks.emit(e.x, e.y - 18, 3, FEATHER, [10, 30], [0.6, 1], { up: 10, g: 30, drag: 2 });
        this.shake.add(e.seq >= 3 ? 0.7 : 0.45);
        this.play('fenglei.slam', 'fantian.land', 1);
        this.play('huangjin.thunder', 'leigong.strike', 0.9);
        break;
      }
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const T = this.textures();
    for (const p of w.players) this.track(p, w, dt, alpha, T);
    for (const [owner, f] of this.flights)
      if (!w.players[owner]) {
        f.wing.destroy();
        this.flights.delete(owner);
      }
    this.drawTrails(dt, w, alpha);
    this.drawGusts(dt);
    for (let i = this.effects.length - 1; i >= 0; i--)
      if (!this.effects[i].update(dt, this.ctx, w, alpha)) {
        this.effects[i].destroy();
        this.effects.splice(i, 1);
      }
    this.bits.update(dt);
    this.top.flush();
    this.under.flush();
  }

  /** 这个人这一帧飞到哪一段：姿势、离地多高、翅膀画哪一张、摆在哪。 */
  private track(p: Player, w: World, dt: number, alpha: number, T: { flap: Texture[]; swept: Texture; flare: Texture }) {
    this.glideTick(p, w, dt, alpha);
    const g = p.wing;
    let f = this.flights.get(p.id);
    if (!g && !f) return;
    if (!f) {
      const s = new Sprite(T.flap[0]);
      s.anchor.set(WINGS_ROOT.x / WINGS_W, WINGS_ROOT.y / WINGS_H);
      this.stage.entities.addChild(s);
      f = { pose: null, lift: 0, wing: s, shape: null, flap: 0, slam: 9, fold: 0, on: false };
      this.flights.set(p.id, f);
    }
    f.flap += dt;
    f.slam += dt;
    let wing: Texture | null = null;
    let frame: 'fly' | 'dive' | 'slam' = 'fly';
    if (g) {
      f.on = true;
      f.fold = 0.18;
      const k = clamp01((w.time - g.t) / g.dur);
      const flapT = T.flap[Math.floor(f.flap * 12) % T.flap.length];
      const flapS = FLAP[Math.floor(f.flap * 12) % FLAP.length];
      if (g.phase === 'rise') {
        f.lift = RISE * easeOut(k);
        f.pose = 'fly';
        wing = flapT;
        f.shape = flapS;
      } else if (g.phase === 'dive') {
        const z0 = g.n === 1 ? RISE : BOUNCE;
        f.lift = z0 * (1 - k) ** 1.5;
        f.pose = frame = 'dive';
        wing = T.swept;
        f.shape = SWEPT;
      } else if (g.phase === 'up') {
        f.lift = BOUNCE * Math.sin((k * Math.PI) / 2);
        const flare = f.slam < 0.12;
        f.pose = frame = flare ? 'slam' : 'fly';
        wing = flare ? T.flare : flapT;
        f.shape = flare ? FLARE : flapS;
      } else {
        f.lift = 0;
        f.pose = frame = 'slam';
        wing = T.flare;
        f.shape = FLARE;
      }
    } else {
      // 落地之后：双翅收拢（淡掉），人物换回平常的帧（收拢的翅膀画在帧里）
      f.on = false;
      f.pose = null;
      f.lift = 0;
      f.fold -= dt;
      f.shape = null;
      if (f.fold <= 0) {
        f.wing.destroy();
        this.flights.delete(p.id);
        this.sparks.emit(p.x - p.facing * 4, p.y - 18, 4, FEATHER, [8, 20], [0.7, 1.1], { up: 6, g: 25, drag: 2 });
        return;
      }
      wing = T.flare;
      frame = 'slam';
    }
    const hx = Math.round(p.px + (p.x - p.px) * alpha);
    const hy = Math.round(p.py + (p.y - p.py) * alpha);
    const [dx, dy] = ROOT[frame];
    const s = f.wing;
    if (wing) s.texture = wing;
    s.scale.x = p.facing;
    s.position.set(hx + p.facing * dx, hy - Math.round(f.lift) + dy);
    s.zIndex = hy - 0.5;
    s.alpha = g ? 1 : clamp01(f.fold / 0.18);
    s.visible = p.alive || !!g;
    // 翅尖、前缘时不时窜一点白金电光
    if (f.shape && Math.random() < dt * 14) {
      const sh = f.shape;
      const t = rnd(0.55, 1);
      const ex = Math.cos(sh.a) * sh.len * t;
      const ey = Math.sin(sh.a) * sh.len * t;
      const x = s.x + p.facing * ex;
      const y = s.y + ey;
      this.top.dot(x, y, Math.random() < 0.5 ? C.W : C.f, 0.95);
      this.top.dot(x + p.facing * rnd(-1, 1), y + 1, C.Y, 0.6);
    }
  }

  /** 生翅：站在减速的地上（红水阵、红沙）时脚下离地一点点滑着走，脚边带起两缕风尘。 */
  private glideTick(p: Player, w: World, dt: number, alpha: number) {
    const on = p.alive && !p.wing && groundFree(p) && ((w.terrain ? terrainSpeedMul(w, p) < 1 : false) || (w.patches.length ? sandSpeedMul(w, p) < 1 : false));
    const cur = this.glide.get(p.id) ?? 0;
    const want = on ? 2 : 0;
    const next = cur + Math.max(-dt * 12, Math.min(dt * 12, want - cur));
    if (next <= 0.01) this.glide.delete(p.id);
    else this.glide.set(p.id, next);
    if (on && p.moving && Math.random() < dt * 9) {
      const hx = p.px + (p.x - p.px) * alpha;
      const hy = p.py + (p.y - p.py) * alpha;
      this.sparks.emit(hx - p.facing * 3, hy, 1, DUST, [10, 22], [0.25, 0.45], { dir: p.facing > 0 ? Math.PI : 0, spread: 0.8, drag: 4 });
    }
  }

  /** 俯冲时身后的三道风痕：跟着人扑下来的那一段（按离地高度往上抬），扑完慢慢散掉。 */
  private drawTrails(dt: number, w: World, alpha: number) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dt;
      const life = tr.dur + 0.28;
      if (tr.t > life) {
        this.trails.splice(i, 1);
        continue;
      }
      const head = clamp01(tr.t / tr.dur);
      const tail = clamp01((tr.t - 0.06) / tr.dur);
      const fadeOut = tr.t > tr.dur ? 1 - (tr.t - tr.dur) / 0.28 : 1;
      const p = w.players[tr.owner];
      const dx = tr.x1 - tr.x0;
      const dy = tr.y1 - tr.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const at = (k: number) => {
        const z = tr.z0 * (1 - k) ** 1.5;
        return [tr.x0 + dx * k, tr.y0 + dy * k - z - 14] as const;
      };
      for (const [off, col, a] of [
        [-4, C.j, 0.35],
        [0, C.w, 0.55],
        [4, C.j, 0.35],
      ] as const) {
        const steps = Math.max(2, Math.round(len / 3));
        for (let s = 0; s <= steps; s++) {
          const k = tail * 0.4 + (head - tail * 0.4) * (s / steps);
          const [x, y] = at(k);
          const fade = (s / steps) * fadeOut;
          this.top.dot(x + nx * off, y + ny * off * 0.6, col, a * fade);
        }
      }
      if (!p) continue;
    }
  }

  /** 一圈风浪：几截断开的淡白风弧贴着地往外推，越推越淡（上下压扁成 0.62，和画面里贴地的圈一样）。 */
  private drawGusts(dt: number) {
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      g.t += dt;
      const life = 0.42;
      if (g.t > life) {
        this.gusts.splice(i, 1);
        continue;
      }
      const k = g.t / life;
      const r = 6 + (g.r - 6) * easeOut(k);
      const a = (1 - k) ** 1.5;
      for (const [a0, a1] of g.arcs) {
        const n = Math.max(3, Math.round(((a1 - a0) * r) / 1.5));
        for (let j = 0; j <= n; j++) {
          const th = a0 + ((a1 - a0) * j) / n;
          const edge = Math.min(j, n - j) / (n / 2); // 两头淡、中间实
          this.under.dot(g.x + Math.cos(th) * r, g.y + Math.sin(th) * r * 0.62, j % 3 ? C.w : C.j, a * (0.35 + 0.5 * edge));
          if (k < 0.6) this.under.dot(g.x + Math.cos(th) * (r - 2), g.y + Math.sin(th) * (r - 2) * 0.62, C.j, a * 0.3 * edge);
        }
      }
    }
  }
}
