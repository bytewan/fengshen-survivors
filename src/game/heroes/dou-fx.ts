// 云霄 · 混元金斗的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟：Player.dou（一斗的全过程）、dou 事件、
// 敌人身上的「削去三花」（sanhuaUntil）。被吸进斗里、喷出来的敌人由 enemy-views.ts 照 dou-pose.ts 画（这里画斗和斗口的东西）。
// 金斗平时悬在云霄身前肩旁，慢慢起伏；出手时飞到敌群上空（一道淡金的尾迹），斗口一倾：几道天青的吸流从地上那一片卷进斗口、
// 尘土被拽起来；吸进去以后斗口朝上、在空中摇，斗口冒出几缕白气（仙品起：每只被吸进去的，斗口飘出三朵小花慢慢散掉——削去顶上三花）；
// 再一倾，斗口喷出一股水，把它们抛出去；落地溅起水花和尘土，然后金斗飞回身边。
// 用户口径：法宝不能画得过大（金斗 12×9，最大 13×10；吸流、水花只在吸的那一片和落点上）；不要光圈；出现和消失都有过程。
// 被削去三花的敌人：头顶三点暗了的小花（∴），一直留到效果结束，最后慢慢淡掉。
import { Container, Sprite } from 'pixi.js';
import type { Grid } from '../../art/pixel.ts';
import { DOU_MOUTH, DOU_SEL, jindouGrid } from '../../art/sprites/yunxiao.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { DOU, FLAT } from '../../sim/heroes/yunxiao.ts';
import type { DouCast, Enemy, Player, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { applyRot, C, clamp01, easeOut, headOf, Pixels, rnd, rotTex } from '../fx.ts';
import { DOU_HOVER, renderTime } from './dou-pose.ts';

const TAU = Math.PI * 2;
/** 平时悬在哪：人物脚下往前 SIDE、往上 LIFT（斗口的位置）。 */
const SIDE = 14;
const LIFT = 18; // 胸口高度（不挡脸；云霄 32 像素高，胸口离地约 18）
/** 飞回身边的快慢（弹簧的角频率）。 */
const RETURN_W = 9;
/** 每个品阶、器灵的金斗网格（转好的纹理由 rotTex 按它缓存）。 */
const GRIDS = new Map<string, Grid>();

interface Dou {
  s: Sprite;
  x: number; // 斗口现在在哪（画面坐标）
  y: number;
  vx: number;
  vy: number;
  ang: number; // 斗转了多少（0 斗口朝上；正的是朝右倾）
  launchX: number; // 这一斗起飞的地方
  launchY: number;
  t0: number; // 这一斗的出手时刻（认得出是不是新的一斗）
  key: string; // 现在用的哪一套图（品阶、器灵）
  trailCd: number;
  wispCd: number;
  petalT0: number; // 哪一斗已经飘过三花了（按出手时刻认；不往模拟的状态上写东西）
}

/** 一朵飘散的小花（削去三花）：从斗口飘起，慢慢淡掉。 */
interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  col: number;
}

export class DouFx {
  private dous = new Map<number, Dou>();
  private petals: Petal[] = [];
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它被削去三花的时刻（淡入用）
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    this.petals = [];
    this.seen.clear();
    this.top.flush();
    this.under.flush();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t !== 'dou') return;
    const d = this.dous.get(e.owner);
    switch (e.act) {
      case 'cast':
        if (d) {
          d.launchX = d.x;
          d.launchY = d.y;
        }
        this.play('jindou.fly', 'zhanxian.fly', 0.7);
        break;
      case 'suck':
        if (e.ids.length) this.play('jindou.suck', 'dingfeng.whirl', 0.8);
        // 地上那一片的尘土被拽起来
        for (let i = 0; i < 10; i++) {
          const a = rnd(0, TAU);
          const r = rnd(0.3, 1) * e.r;
          this.sparks.emit(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * FLAT, 1, [0x8f9787, 0xb3b8a6, C.j], [8, 20], [0.3, 0.5], { up: 30, drag: 2 });
        }
        break;
      case 'spit': {
        if (e.pour !== undefined && e.pour >= 0) {
          this.play('jindou.pour', 'xuanyuan.pool', 0.6);
          break;
        }
        this.play('jindou.spit', 'xuanyuan.pool', 0.7);
        const p = w.players[e.owner];
        const land = p?.dou?.land ?? [];
        // 斗口喷出一股水：朝着每个落点各甩出一串水珠
        for (const [lx, ly] of land) {
          const a = Math.atan2(ly - (e.y - DOU_HOVER), lx - e.x);
          for (let k = 0; k < 4; k++) this.sparks.emit(e.x, e.y - DOU_HOVER + 2, 1, [C.W, C.Cc, C.w], [50, 90], [0.3, 0.5], { dir: a + rnd(-0.25, 0.25), spread: 0, g: 200, drag: 1.5 });
        }
        break;
      }
      case 'land': {
        if (e.pour !== undefined && e.pour >= 0) {
          // 浇下去：那一只身上炸开一团水花（往四周溅、落下来）
          const t = w.enemies.find((x) => x.id === e.pour);
          const hx = t ? t.x : e.x;
          const hy = t ? t.y - headOf(t.kind) * 0.7 : e.y - 14;
          for (let k = 0; k < 12; k++) this.sparks.emit(hx + rnd(-3, 3), hy, 1, [C.W, C.Cc, C.w, C.c], [30, 75], [0.3, 0.55], { dir: -Math.PI / 2 + rnd(-1.3, 1.3), spread: 0, g: 240, drag: 1.4 });
          this.shake.add(0.05);
          this.play('jindou.land', 'fantian.land', 0.4);
          break;
        }
        if (e.ids.length) this.play('jindou.land', 'fantian.land', 0.6);
        // 落地：水花、尘土（落点在敌人身上：模拟这一帧已经摆好了位置）
        for (const id of e.ids) {
          const en = w.enemies.find((x) => x.id === id);
          if (!en) continue;
          for (let k = 0; k < 6; k++) this.sparks.emit(en.x + rnd(-3, 3), en.y, 1, [C.W, C.Cc, C.c], [25, 60], [0.3, 0.55], { up: 40, g: 220, drag: 1.5 });
          this.sparks.emit(en.x, en.y, 4, [0x8f9787, 0xb3b8a6], [10, 30], [0.35, 0.6], { up: 8, drag: 3 });
        }
        if (e.ids.length) this.shake.add(e.ids.length >= 4 ? 0.1 : 0.06);
        if (e.spirit === 'dao') this.shake.add(0.06);
        break;
      }
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.world = w;
    const now = renderTime(w, alpha);
    for (const p of w.players) {
      const wpn = p.weapons.find((x) => x.kind === 'jindou');
      if ((!wpn && !p.dou) || p.left) {
        const d = this.dous.get(p.id);
        if (d) {
          d.s.destroy();
          this.dous.delete(p.id);
        }
        continue;
      }
      this.updateDou(p, wpn?.tier ?? p.dou?.tier ?? 1, wpn?.spirit ?? p.dou?.spirit ?? null, now, dt, alpha);
    }
    for (const [id, d] of this.dous)
      if (!w.players[id]) {
        d.s.destroy();
        this.dous.delete(id);
      }
    this.drawPetals(dt);
    this.drawSanhua(w, alpha);
    this.top.flush();
    this.under.flush();
  }

  private dou(p: Player, hx: number, hy: number): Dou {
    let d = this.dous.get(p.id);
    if (!d) {
      const s = new Sprite();
      this.stage.entities.addChild(s);
      const x = hx + p.facing * SIDE;
      const y = hy - LIFT;
      d = { s, x, y, vx: 0, vy: 0, ang: 0, launchX: x, launchY: y, t0: -1, key: '', trailCd: 0, wispCd: 0, petalT0: -1 };
      this.dous.set(p.id, d);
    }
    return d;
  }

  /** 金斗这一帧在哪、转多少：有一斗在走就按它的时刻摆，没有就弹回身边悬着。 */
  private updateDou(p: Player, tier: number, spirit: string | null, now: number, dt: number, alpha: number) {
    const hx = p.px + (p.x - p.px) * alpha;
    const hy = p.py + (p.y - p.py) * alpha;
    const d = this.dou(p, hx, hy);
    const c = p.dou;
    let ang = 0;
    let shake = 0;
    if (c && c.t0 !== d.t0) {
      d.t0 = c.t0;
      d.launchX = d.x;
      d.launchY = d.y;
    }
    const restX = hx + p.facing * SIDE;
    const restY = hy - LIFT + Math.round(Math.sin(this.time * 2.2 + p.id) * 1.2);
    if (c && now < c.tLand + 0.02) {
      // 浇的时候悬在那一只头顶上方（首领、精英比斗口的高度高）
      const big = c.pour >= 0 ? this.target(c.pour) : null;
      const lift = big ? Math.max(DOU_HOVER, headOf(big.kind) + 9) : DOU_HOVER;
      const mx = c.x;
      const my = c.y - lift;
      const side = mx >= hx ? 1 : -1;
      if (now < c.tSuck) {
        // 飞过去：一道往上拱的弧，快到时斗口开始往敌群那边倾
        const k = easeOut((now - c.t0) / DOU.fly);
        d.x = d.launchX + (mx - d.launchX) * k;
        d.y = d.launchY + (my - d.launchY) * k - 10 * Math.sin(Math.PI * k);
        ang = side * 0.75 * k * k;
        this.trail(d, dt, tier);
      } else if (c.pour >= 0) {
        // 浇：斗口朝下倾过去，一股水从斗口浇到它头上
        const k = clamp01((now - c.tSuck) / 0.1);
        d.x = mx;
        d.y = my;
        ang = side * 1.6 * easeOut(k);
        shake = 0.04;
        if (big) this.stream(d, big, now - c.tSuck, alpha);
      } else if (now < c.tSuck + DOU.suck) {
        // 斗口一倾，吸：倾到快倒扣，斗身微微抖
        const k = clamp01((now - c.tSuck) / 0.08);
        d.x = mx;
        d.y = my;
        ang = side * (0.75 + 0.5 * k); // 斗口朝着那一片歪过去（不倒扣：倒扣过来斗口就成了一条缝，看不出是在吸）
        shake = 0.05;
        if (c.held.length) this.suction(c, now, tier);
      } else if (now < c.tSpit) {
        // 在斗里：斗口转回朝上，在空中摇
        const k = clamp01((now - c.tSuck - DOU.suck) / 0.12);
        d.x = mx;
        d.y = my - 2 * k;
        ang = side * 1.25 * (1 - easeOut(k));
        shake = 0.16 * k;
        this.wisps(d, c, dt, tier);
      } else {
        // 喷：朝落点那边倾过去
        const k = clamp01((now - c.tSpit) / 0.08);
        d.x = mx;
        d.y = my - 2 + 2 * k;
        const lx = c.land.reduce((s, q) => s + q[0], 0) / Math.max(1, c.land.length);
        ang = (lx >= mx ? 1 : -1) * 1.2 * easeOut(k);
      }
      d.vx = d.vy = 0;
    } else {
      // 悬在身边（喷完了就飞回来）：弹簧拉向身前肩旁那一点
      const ax = RETURN_W * RETURN_W * (restX - d.x) - 2 * RETURN_W * d.vx;
      const ay = RETURN_W * RETURN_W * (restY - d.y) - 2 * RETURN_W * d.vy;
      d.vx += ax * dt;
      d.vy += ay * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      ang = clamp01(Math.hypot(d.vx, d.vy) / 300) * Math.sign(d.vx) * 0.5;
      if (Math.hypot(d.vx, d.vy) > 60) this.trail(d, dt, tier);
    }
    d.ang += (ang + Math.sin(this.time * 32) * shake - d.ang) * Math.min(1, dt * 18);
    const key = `${tier}${spirit ?? ''}`;
    let g = GRIDS.get(key);
    if (!g) GRIDS.set(key, (g = jindouGrid(tier, spirit)));
    applyRot(d.s, rotTex(`jindou${key}`, g, d.ang, DOU_MOUTH.x + 0.5, DOU_MOUTH.y + 0.5, 32, DOU_SEL));
    d.key = key;
    d.s.position.set(Math.round(d.x), Math.round(d.y));
    // 前后：悬在身边时在人物前面一点（朝着看的那一侧）；飞到敌群上空时按斗口下方的地面排
    d.s.zIndex = c && now < c.tLand ? Math.round(c.y) + 1 : Math.round(hy) + 1;
    d.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
  }

  private world: World | null = null;
  private target(id: number) {
    return this.world?.enemies.find((e) => e.id === id) ?? null;
  }

  /**
   * 浇下去的那一股水：从斗口（倾过去的那一侧）落到那一只头顶，一像素到两像素宽的一道天青水柱，月白的水头一节一节往下走，
   * 落点溅起水珠。只在浇的那一小会儿画（约 0.3 秒），开头、结尾有过程。
   */
  private stream(d: Dou, e: Enemy, t: number, alpha: number) {
    const px = this.top;
    const x0 = d.x + Math.sin(d.ang) * 4;
    const y0 = d.y + 2;
    const x1 = Math.round(e.px + (e.x - e.px) * alpha);
    const y1 = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) * 0.8);
    const reach = clamp01(t / 0.08); // 水头先落下去
    const fadeA = clamp01((DOU.pour.t - t) / 0.08);
    const n = Math.max(4, Math.round(Math.abs(y1 - y0)));
    for (let i = 0; i <= n * reach; i++) {
      const u = i / n;
      const x = x0 + (x1 - x0) * u + Math.sin(u * 9 - this.time * 30) * 0.6;
      const y = y0 + (y1 - y0) * u;
      const head = (i + Math.floor(this.time * 40)) % 5 === 0;
      px.dot(x, y, head ? C.W : C.Cc, fadeA);
      if (i % 2 === 0) px.dot(x + 1, y, C.c, fadeA * 0.7);
    }
    if (reach >= 1 && Math.random() < 0.6) this.sparks.emit(x1 + rnd(-2, 2), y1, 1, [C.W, C.Cc], [20, 45], [0.2, 0.35], { dir: -Math.PI / 2 + rnd(-1.2, 1.2), spread: 0, g: 220, drag: 1.5 });
  }

  /** 飞的时候身后一道淡金的尾迹（几粒很快淡掉的金屑）。 */
  private trail(d: Dou, dt: number, tier: number) {
    d.trailCd -= dt;
    if (d.trailCd > 0) return;
    d.trailCd = 0.03;
    this.sparks.emit(d.x + rnd(-2, 2), d.y + 3 + rnd(-1, 1), 1, tier >= 3 ? [C.Y, C.f, C.W] : [C.Y, C.y, C.f], [3, 10], [0.2, 0.35], { drag: 3 });
  }

  /**
   * 吸流：从地上那一片（椭圆）的边上，几道天青的细流打着旋卷进斗口（每道是一串由淡到浓的点，往斗口收拢、越收越细）。
   * 只在吸的那一小会儿画；不画成一个圈。
   */
  private suction(c: DouCast, now: number, tier: number) {
    const k = clamp01((now - c.tSuck) / DOU.suck);
    const mx = c.x;
    const my = c.y - DOU_HOVER + 3;
    const arms = 4;
    const fadeA = Math.min(1, k / 0.15) * Math.min(1, (1 - k) / 0.25);
    for (let a = 0; a < arms; a++) {
      const base = (a / arms) * TAU + now * 5;
      for (let i = 0; i <= 22; i++) {
        const u = i / 22; // 0 地上 … 1 斗口
        const ph = base + u * 2.2;
        const rr = c.r * (1 - u) * (0.85 + 0.15 * Math.sin(now * 9 + a));
        const x = mx + Math.cos(ph) * rr;
        const y = c.y + Math.sin(ph) * rr * FLAT + (my - c.y) * u * u;
        const al = fadeA * (0.25 + 0.6 * u) * (0.6 + 0.4 * Math.sin(i * 0.9 - now * 18));
        this.top.dot(x, y, u > 0.75 ? C.W : i % 3 === 0 ? C.w : tier >= 3 ? C.Cc : C.Cc, al);
      }
    }
  }

  /** 在斗里的时候：斗口冒出几缕白气；仙品起每只被吸进去的飘出三朵小花（削去顶上三花），慢慢散掉。 */
  private wisps(d: Dou, c: DouCast, dt: number, tier: number) {
    d.wispCd -= dt;
    if (d.wispCd <= 0) {
      d.wispCd = 0.09;
      this.glows.emit(d.x + rnd(-3, 3), d.y + 1, 1, [C.W, C.Cc], [4, 10], [0.4, 0.7], { up: 18, drag: 1 });
    }
    if (tier >= 3 && d.petalT0 !== c.t0) {
      d.petalT0 = c.t0;
      c.held.forEach((_, i) => {
        for (let j = 0; j < 3; j++) {
          const a = -Math.PI / 2 + (j - 1) * 0.55 + (i - (c.held.length - 1) / 2) * 0.18;
          const sp = rnd(12, 20);
          this.petals.push({ x: d.x + rnd(-2, 2), y: d.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: -0.08 * i - 0.05 * j, life: rnd(0.7, 0.95), col: [C.m, C.w, C.Y][j] });
        }
      });
    }
  }

  /** 飘散的小花：一像素的花心、四瓣（十字），飘着往上、慢慢淡掉。 */
  private drawPetals(dt: number) {
    const px = this.top;
    for (let i = this.petals.length - 1; i >= 0; i--) {
      const q = this.petals[i];
      q.t += dt;
      if (q.t < 0) continue;
      if (q.t > q.life) {
        this.petals.splice(i, 1);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 1 - dt * 2;
      q.vy = q.vy * (1 - dt * 2) - 4 * dt;
      const k = q.t / q.life;
      const a = Math.min(1, q.t / 0.12) * (1 - k * k);
      px.dot(q.x, q.y, C.f, a);
      px.dot(q.x - 1, q.y, q.col, a * 0.8);
      px.dot(q.x + 1, q.y, q.col, a * 0.8);
      px.dot(q.x, q.y - 1, q.col, a * 0.8);
      if (k < 0.6) px.dot(q.x, q.y + 1, q.col, a * 0.8);
    }
  }

  /**
   * 被削去三花的敌人：头顶三点暗了的小花（∴，胭脂紫的芯、黛色的边），一直留到效果结束；
   * 刚削去时从亮到暗（0.3 秒），最后 0.6 秒慢慢淡掉，平时轻轻上下浮。
   */
  private drawSanhua(w: World, alpha: number) {
    const px = this.top;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.sanhuaUntil === undefined || w.time >= e.sanhuaUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      const age = this.time - t0;
      const left = e.sanhuaUntil - w.time;
      const a = clamp01(left / 0.6) * Math.min(1, age / 0.2);
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) - 4 + Math.sin(this.time * 2 + e.id) * 0.8);
      const dim = clamp01(age / 0.3); // 刚削去时还亮着，转暗
      const core = dim > 0.5 ? C.p : C.m;
      for (const [ox, oy] of [
        [0, -2],
        [-2, 1],
        [2, 1],
      ] as const) {
        px.dot(x + ox, y + oy, core, a);
        px.dot(x + ox, y + oy + 1, C.g, a * 0.7);
      }
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
  }
}
