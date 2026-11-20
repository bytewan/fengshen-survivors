// 雷震子 · 黄金棍的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件（staff / land / warn）和 w.pending
// （kind 'staff'：落点跟着瞄的那只走，画面每帧照它飞）。另外告诉 HeroFx：棍子在外面的时候人物空着手（busy）。
// - 飞出去：从手里掷出（凡 26 像素长，灵 30、仙 32、神 34，碎岳 42），一路翻着跟头低低地掠过敌群（离地不过十几像素），
//   身后拖一小截金色的残影；快到落点时棍子竖起来、往上一提，再一棍砸下去。
// - 砸下：天上劈下一道金白的雷落在棍头（雷公鞭那一套闪电，换成金色；碎岳更粗），落点尘土往四周卷开、几截淡白的风弧贴地往外推，
//   不画整圈、不画光圈。灵品起砸完弹起，飞向下一群再砸；最后一砸之后棍子翻着飞回手里。
// - 仙品「雷纹」：落处地上留一圈雷纹（八个小小的回纹形雷符，藤黄描缃，上下压扁），越到要炸的时候闪得越急；炸的时候一道小雷劈下、雷符崩散。
// 用户口径：不要光圈；出现和消失都有过程；尺寸收着（法宝本体凡 / 灵不过约 34、仙 / 神不过约 44）。
import { Container, Sprite } from 'pixi.js';
import { flyingStaffGrid } from '../../art/sprites/leizhenzi.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { applyRot, Bits, Bolt, C, clamp01, easeOut, Pixels, rnd, rotTex, shadowTex, type Ctx, type Effect } from '../fx.ts';
import type { Grid } from '../../art/pixel.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const DUST = [0x6b5749, 0x776672, 0x9a8a86, 0xb3b8a6];
const SEL: Record<string, string> = { y: 'B', Y: 'B', b: 'B', f: 'B', w: 'B' };
/** 手离地多高（掷出、飞回来时棍子在这个高度）。 */
const HAND_Z = 15;
/** 掷出前举棍那一下（人物的举棍姿势，见 heroes/index.ts 的 posesFor）：棍子先不飞。 */
const WINDUP = 0.07;

const lenOf = (tier: number, spirit: string | null) => (spirit === 'suiyue' ? 42 : [0, 26, 30, 32, 34][tier] ?? 26);

interface Flying {
  id: number;
  owner: number;
  tier: number;
  spirit: string | null;
  seq: number;
  x0: number;
  y0: number;
  z0: number;
  tx: number;
  ty: number;
  t: number;
  t2: number;
  delay: number;
  ang: number;
  s: Sprite;
  sh: Sprite;
  grid: Grid;
  key: string;
  /** 砸下了：等一小会儿看有没有下一砸接着（弹起再砸），没有就飞回手里。 */
  landed: number;
  /** 飞回手里：已经飞了多久（-1 = 还没开始）。 */
  ret: number;
  rx: number;
  ry: number;
  trail: [number, number][];
}
interface Sigil {
  id: number;
  x: number;
  y: number;
  r: number;
  t: number;
  t2: number;
  boom: number; // 炸开之后过了多久（-1 = 还没炸）
}
interface Gust {
  x: number;
  y: number;
  r: number;
  t: number;
  arcs: [number, number][];
}

export class StaffFx {
  private flying: Flying[] = [];
  private sigils = new Map<number, Sigil>();
  private gusts: Gust[] = [];
  private effects: Effect[] = [];
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

  /** 棍子在外面（飞着、砸着、飞回来的路上）：人物这时空着手。 */
  busy(owner: number): boolean {
    return this.flying.some((f) => f.owner === owner);
  }

  clear() {
    for (const f of this.flying) {
      f.s.destroy();
      f.sh.destroy();
    }
    this.flying = [];
    this.sigils.clear();
    this.gusts = [];
    for (const e of this.effects) e.destroy();
    this.effects = [];
    this.bits.clear();
    this.top.flush();
    this.under.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'staff': {
        // 弹起再砸：接着上一砸那一根（不飞回手里），从落点弹起来
        const prev = e.seq > 1 ? this.flying.find((f) => f.owner === e.owner && f.landed >= 0 && f.ret < 0) : undefined;
        const spirit = e.spirit ?? null;
        const len = lenOf(e.tier, spirit);
        const grid = flyingStaffGrid(len, e.tier, spirit);
        const key = `huangjin${e.tier}${spirit ?? ''}`;
        let f = prev;
        const p = w.players[e.owner];
        const face = p?.facing ?? 1;
        if (f) {
          f.id = e.id;
          f.seq = e.seq;
          f.x0 = e.x0;
          f.y0 = e.y0;
          f.z0 = 2;
          f.t = 0;
          f.t2 = e.t2;
          f.delay = 0;
          f.landed = -1;
          f.trail = [];
        } else {
          const s = new Sprite();
          const sh = new Sprite(shadowTex(5));
          sh.anchor.set(0.5);
          sh.alpha = 0;
          this.stage.entities.addChild(s);
          this.floor.addChild(sh);
          f = { id: e.id, owner: e.owner, tier: e.tier, spirit, seq: e.seq, x0: e.x0 + face * 6, y0: e.y0, z0: HAND_Z, tx: e.x, ty: e.y, t: 0, t2: e.t2, delay: e.seq === 1 ? WINDUP : 0, ang: face > 0 ? -1.2 : Math.PI + 1.2, s, sh, grid, key, landed: -1, ret: -1, rx: 0, ry: 0, trail: [] };
          this.flying.push(f);
        }
        f.tx = e.x;
        f.ty = e.y;
        this.play('huangjin.throw', 'zhanxian.fly', e.seq === 1 ? 0.8 : 0.6);
        break;
      }
      case 'land': {
        if (e.kind !== 'staff') break;
        const f = this.flying.find((v) => v.id === e.id);
        if (e.quake) {
          // 雷纹炸开：一道小雷劈下，雷符崩散
          const sg = this.sigils.get(e.id);
          if (sg) sg.boom = 0;
          this.effects.push(new Bolt(this.ctx, [[e.x, e.y]], 'gold', { trunk: 2, branches: 1, skyEach: false, whip: false, skyOnly: true }));
          this.sparks.emit(e.x, e.y, 10, [C.W, C.f, C.Y, C.y], [40, 90], [0.25, 0.5], { drag: 3.5 });
          this.play('huangjin.sigil', 'dingfeng.thunder', 0.8);
          break;
        }
        if (!f) break; // 半路的掠过（Pending seq 0）：伤害的跳字就够了
        f.landed = 0;
        f.tx = e.x;
        f.ty = e.y;
        this.slam(e.x, e.y, e.r, f.spirit === 'suiyue', e.tier ?? f.tier);
        break;
      }
      case 'warn': {
        if (e.kind !== 'staff') break;
        this.sigils.set(e.id, { id: e.id, x: e.x, y: e.y, r: e.r, t: 0, t2: e.t2, boom: -1 });
        break;
      }
    }
  }

  /** 砸下的那一下：金白的雷劈在棍头、尘土卷开、几截风弧往外推。 */
  private slam(x: number, y: number, r: number, big: boolean, tier: number) {
    this.effects.push(new Bolt(this.ctx, [[x, y]], 'gold', { trunk: big ? 3 : 2, branches: big ? 3 : 1 + Math.min(2, tier - 1), skyEach: false, whip: false, skyOnly: true }));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd(-0.12, 0.12);
      this.sparks.emit(x + Math.cos(a) * 4, y + Math.sin(a) * 2.5, 1, DUST, [r * 2, r * 3.2], [0.28, 0.5], { dir: a, spread: 0.25, drag: 4.5 });
    }
    this.sparks.emit(x, y - 2, big ? 6 : 3, [0x4f5652, 0x6d756c, 0x6b5749], [30, 70], [0.35, 0.6], { up: 60, g: 260, drag: 1.5 });
    const arcs: [number, number][] = [];
    let a = rnd(0, 0.8);
    while (a < Math.PI * 2 - 0.3) {
      const len = rnd(0.35, 0.65);
      arcs.push([a, a + len]);
      a += len + rnd(0.3, 0.55);
    }
    this.gusts.push({ x, y, r, t: 0, arcs });
    this.shake.add(big ? 0.5 : 0.22);
    this.play('huangjin.slam', 'fantian.land', big ? 1 : 0.7);
    this.play('huangjin.thunder', 'leigong.strike', big ? 0.9 : 0.6);
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (let i = this.flying.length - 1; i >= 0; i--) if (!this.fly(this.flying[i], dt, w, alpha)) this.flying.splice(i, 1);
    this.drawSigils(dt);
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

  /** 推进一根：飞过去（翻着跟头、低低地掠过，最后竖起来砸下）、砸着、飞回手里。返回 false = 回到手里了。 */
  private fly(f: Flying, dt: number, w: World, alpha: number): boolean {
    const p = w.players[f.owner];
    const done = () => {
      f.s.destroy();
      f.sh.destroy();
      return false;
    };
    if (!p) return done();
    const face = p.facing;
    let gx: number;
    let gy: number;
    let z: number;
    let ang: number;
    if (f.ret >= 0) {
      // 飞回手里：翻着跟头，越近越快，到手边淡掉
      f.ret += dt;
      const k = clamp01(f.ret / 0.3);
      const hx = p.px + (p.x - p.px) * alpha + face * 6;
      const hy = p.py + (p.y - p.py) * alpha;
      const e = k * k;
      gx = f.rx + (hx - f.rx) * e;
      gy = f.ry + (hy - f.ry) * e;
      z = HAND_Z * e + 10 * Math.sin(Math.PI * k);
      f.ang += dt * 22 * face;
      ang = f.ang;
      f.s.alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      if (k >= 1) return done();
    } else if (f.landed >= 0) {
      // 砸着：竖在地上，等一下看还有没有下一砸；没有就飞回去
      f.landed += dt;
      gx = f.tx;
      gy = f.ty;
      z = 0;
      ang = -Math.PI / 2;
      if (f.landed > 0.08) {
        f.ret = 0;
        f.rx = f.tx;
        f.ry = f.ty;
        f.ang = ang;
      }
    } else {
      f.t += dt;
      const q = w.pending.find((v) => v.id === f.id);
      if (q) {
        f.tx = q.x;
        f.ty = q.y;
      }
      const span = Math.max(0.05, f.t2 - f.delay);
      const k = clamp01((f.t - f.delay) / span);
      if (f.t < f.delay) {
        // 举棍那一下：棍子还在手里（人物的举棍帧画着它），先不画
        f.s.visible = false;
        f.sh.visible = false;
        return true;
      }
      gx = f.x0 + (f.tx - f.x0) * k;
      gy = f.y0 + (f.ty - f.y0) * k;
      // 前七成低低地掠过（离地 6–12），后三成往上一提、竖起来砸下
      if (k < 0.7) {
        const m = k / 0.7;
        z = f.z0 + (8 - f.z0) * m + 5 * Math.sin(Math.PI * m);
        f.ang += dt * 20 * face;
        ang = f.ang;
      } else {
        const m = (k - 0.7) / 0.3;
        z = 8 + 14 * Math.sin(Math.PI * m) * (1 - m * 0.5) - 8 * m * m;
        z = Math.max(0, z);
        // 转到竖着（棍头朝下砸）
        const want = Math.PI / 2;
        const cur = ((f.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let d = want - cur;
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        f.ang = cur + d * easeOut(m);
        ang = f.ang;
      }
      // 残影：最近几帧的位置
      f.trail.push([gx, gy - z]);
      if (f.trail.length > 4) f.trail.shift();
    }
    f.s.visible = true;
    f.sh.visible = true;
    const len = f.grid.w;
    applyRot(f.s, rotTex(f.key, f.grid, ang, len / 2, f.grid.h / 2, 32, SEL));
    f.s.position.set(Math.round(gx), Math.round(gy - z));
    f.s.zIndex = Math.round(gy);
    f.sh.position.set(Math.round(gx), Math.round(gy));
    f.sh.alpha = 0.3 * (1 - Math.min(1, z / 30));
    f.sh.scale.set(0.8 + len / 60);
    // 金色的残影：棍子中段最近几帧的位置连成一小截渐淡的线（只在飞的时候；不画成一根长棍）
    if (f.landed < 0 && f.ret < 0)
      for (let i = 1; i < f.trail.length; i++) {
        const [x0, y0] = f.trail[i - 1];
        const [x1, y1] = f.trail[i];
        this.top.line(x0, y0, x1, y1, i === f.trail.length - 1 ? C.Y : C.y, (i / f.trail.length) * 0.3);
      }
    return true;
  }

  /** 雷纹：落点一圈八个小雷符（回纹形的一笔），越到要炸的时候闪得越急；炸了就崩散淡掉。 */
  private drawSigils(dt: number) {
    for (const [id, sg] of this.sigils) {
      sg.t += dt;
      if (sg.boom >= 0) sg.boom += dt;
      if (sg.boom > 0.3 || sg.t > sg.t2 + 0.6) {
        this.sigils.delete(id);
        continue;
      }
      const k = clamp01(sg.t / sg.t2);
      const appear = clamp01(sg.t / 0.15);
      const rate = 4 + 18 * k * k;
      const pulse = 0.55 + 0.45 * Math.sin(sg.t * rate * Math.PI);
      const a = sg.boom >= 0 ? 1 - sg.boom / 0.3 : appear * (0.45 + 0.4 * pulse);
      const R = sg.r * 0.82 + (sg.boom >= 0 ? sg.boom * 30 : 0);
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * Math.PI * 2 + 0.2;
        const cx = sg.x + Math.cos(th) * R;
        const cy = sg.y + Math.sin(th) * R * 0.62;
        // 一枚雷符：「己」字形的回纹，四五个像素
        const pts: [number, number][] = [
          [-1, -1],
          [0, -1],
          [1, -1],
          [1, 0],
          [0, 0],
          [-1, 1],
          [0, 1],
        ];
        for (const [dx, dy] of pts) this.under.dot(cx + dx, cy + dy, (dx + dy) % 2 ? C.y : C.Y, a);
        if (pulse > 0.85 && sg.boom < 0) this.under.dot(cx, cy, C.f, a);
      }
    }
  }

  /** 砸下时的风弧：几截断开的淡白弧贴着地往外推（上下压扁成 0.62）。 */
  private drawGusts(dt: number) {
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      g.t += dt;
      const life = 0.36;
      if (g.t > life) {
        this.gusts.splice(i, 1);
        continue;
      }
      const k = g.t / life;
      const r = 4 + (g.r - 4) * easeOut(k);
      const a = (1 - k) ** 1.5;
      for (const [a0, a1] of g.arcs) {
        const n = Math.max(3, Math.round(((a1 - a0) * r) / 1.5));
        for (let j = 0; j <= n; j++) {
          const th = a0 + ((a1 - a0) * j) / n;
          const edge = Math.min(j, n - j) / (n / 2);
          this.under.dot(g.x + Math.cos(th) * r, g.y + Math.sin(th) * r * 0.62, j % 3 ? C.w : C.j, a * (0.3 + 0.5 * edge));
        }
      }
    }
  }
}
