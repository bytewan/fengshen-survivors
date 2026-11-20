// 第一章新敌人的预警与出手画面：长矛兵的刺击、骑兵的冲锋、自爆鬼的引信与炸开、分魂鬼的分裂、盾兵挡格。
// 读模拟事件（FoeEvent）+ 世界状态（敌人还在不在、动作走到哪了），接口仿照 fx.ts：onEvent / update / clear。
// 预警是地上的淡红光（用户 2026-11-10 定，画法见 warn-fx.ts）：形状就是判定范围，按人物脚下算——
//   长矛兵：刺击线两侧各 FOES.spearman.width + 人物半径 = 9 像素、两头圆（enemies.ts 的 stab）；
//   骑兵：冲锋线两侧各 骑兵半径 + 人物半径 + 2 = 15 像素（enemies.ts 的 cavalry 撞人判定）；
//   自爆鬼：以它为圆心、FOES.bomber.radius = 32 像素的圆（量到人物脚下）。
// 亮红随蓄力从脚下推到线的尽头（圆从中心往外），推满就出手；出手时整块闪一下，冲锋时骑兵冲过的地方拖一截慢慢淡掉。
// 进度直接读模拟里的蓄力计时（e.actT / e.actLen），命中停顿时画面冻住也不会和真正出手的时刻错开。
// 音效只调 sfx.play（名字见 docs/audio.md）。
// 接进 feel.ts：const enemyFx = new EnemyFx(stage, particles, glowParticles, shake, sfx)；onEvents 里 enemyFx.onEvent(e, world)；
// 每帧 enemyFx.update(vdt, world, alpha)；reset / waveStart / waveEnd 时 enemyFx.clear()。
import { Container, Graphics } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { DT, ENEMIES, FOES, PLAYER } from '../sim/config.ts';
import type { Enemy, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { DiskWarn, LaneWarn, warmWarnTextures, warnLayer, type WarnLayer } from './warn-fx.ts';

/** 调色板里的颜色（十六进制），线条和粒子用。 */
const C = { k: 0x1a1520, d: 0x2e2433, g: 0x4a3b4a, h: 0x6b5a62, i: 0x9a8a86, j: 0xc9bcae, w: 0xf2e8d5, R: 0x5c1a1b, r: 0x9c2a22, e: 0xd9452b, o: 0xf2814a, y: 0xe0a83a, Y: 0xf7dc7a, f: 0xffe9a8, W: 0xffffff, c: 0x3f8a9e, CC: 0x7cc4c4, P: 0x4b2a4f, p: 0x8a4a7a };
const FIRE = [C.e, C.o, C.Y, C.f];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 判定半径（按人物脚下算），和 enemies.ts 里的判定一一对应。 */
const REACH = {
  spearman: FOES.spearman.width + PLAYER.radius, // stab：segDist(人物, 刺击线) ≤ width + 人物半径
  cavalry: ENEMIES.cavalry.radius + PLAYER.radius + 2, // cavalry：segDist(人物, 这一帧冲过的一小段) ≤ 骑兵半径 + 人物半径 + 2
  bomber: FOES.bomber.radius, // bomber：离爆符鬼脚下 ≤ radius
};

/** 一像素宽的像素线（整数坐标）。只加形状，调用方自己 fill。 */
function pixLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

interface LineView {
  id: number;
  kind: 'spearman' | 'cavalry';
  warn: LaneWarn;
  struck: number; // 出手后过了多久（-1 = 还没出手）
  head: number; // 冲锋时骑兵沿线冲到了哪（被打断就停在那里淡掉）
  gleam: Graphics | null; // 长矛刺出的枪芒
}

interface FuseView {
  id: number;
  warn: DiskWarn;
  emberT: number;
}

interface Flash {
  g: Graphics;
  t: number;
  life: number;
}

/** 爆炸的放射线：每条线从里往外窜，越往后越长、越淡。 */
interface Rays {
  g: Graphics;
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  rays: { a: number; l: number; c: number }[];
}

export class EnemyFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private warns: WarnLayer;
  private floor = new Container();
  private air = new Container();
  private lines = new Map<number, LineView>();
  private fuses = new Map<number, FuseView>();
  private flashes: Flash[] = [];
  private rays: Rays[] = [];
  private guardSfx = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.warns = warnLayer(stage); // 先建预警层：它在地面层里排在这里的枪芒之下
    warmWarnTextures({ lanes: [REACH.spearman, REACH.cavalry], disks: [REACH.bomber], chevrons: [[2, false], [3, false]] });
    stage.floor.addChild(this.floor);
    stage.fx.addChild(this.air);
  }

  /** 清空（重开一局、一波开始或结束）。 */
  clear() {
    for (const v of this.lines.values()) this.dropLine(v);
    this.lines.clear();
    for (const f of this.fuses.values()) f.warn.destroy();
    this.fuses.clear();
    for (const f of this.flashes) f.g.destroy();
    this.flashes = [];
    for (const r of this.rays) r.g.destroy();
    this.rays = [];
  }

  private dropLine(v: LineView) {
    v.warn.destroy();
    v.gleam?.destroy();
  }

  onEvent(e: SimEvent, w: World) {
    void w;
    switch (e.t) {
      case 'foeWindup': {
        const old = this.lines.get(e.id);
        if (old) this.dropLine(old);
        const spear = e.kind === 'spearman';
        // 骑兵冲到线的尽头才停，最后一帧的撞人判定还会往前多扫 0～1 帧的路（速度 × DT）：终点按半帧往前挪，误差前后各半帧
        let { x1, y1 } = e;
        if (!spear) {
          const len = Math.hypot(x1 - e.x0, y1 - e.y0) || 1;
          const over = (FOES.cavalry.speed * DT) / 2;
          x1 += ((x1 - e.x0) / len) * over;
          y1 += ((y1 - e.y0) / len) * over;
        }
        // 长矛兵：线短，箭头小、隔 12 像素一个；骑兵：车道长，隔 16 像素一个
        const warn = new LaneWarn(this.warns, e.x0, e.y0, x1, y1, REACH[e.kind], spear ? 0 : FOES.cavalry.speed, spear ? { every: 12, start: 12, size: 2 } : { every: 16, start: 14, size: 3 });
        this.lines.set(e.id, { id: e.id, kind: e.kind, warn, struck: -1, head: 0, gleam: null });
        this.sfx.play(spear ? 'enemy.spear.warn' : 'enemy.charge.warn');
        break;
      }
      case 'foeStrike': {
        const v = this.lines.get(e.id);
        if (v) {
          v.struck = 0;
          v.warn.strike();
        }
        if (e.kind === 'spearman') {
          // 一矛刺出：矛尖迸出几点白光，一道枪芒沿线一闪
          this.sparks.emit(e.x1, e.y1 - 12, 5, [C.W, C.f, C.j], [30, 70], [0.12, 0.25], { dir: Math.atan2(e.y1 - e.y0, e.x1 - e.x0), spread: 1.2, drag: 5 });
          if (v) {
            v.gleam = new Graphics();
            this.floor.addChild(v.gleam);
          }
          this.sfx.play('enemy.spear');
        } else {
          // 冲锋起步：蹄下扬起一团魂雾
          this.glows.emit(e.x0, e.y0 - 2, 10, [C.CC, C.c], [20, 50], [0.3, 0.6], { up: 8, drag: 3 });
          this.sparks.emit(e.x0, e.y0, 6, [C.h, C.i], [20, 45], [0.3, 0.5], { up: 10, drag: 3 });
          this.shake.add(0.06);
          this.sfx.play('enemy.charge');
        }
        break;
      }
      case 'foeFuse': {
        this.fuses.get(e.id)?.warn.destroy();
        this.fuses.set(e.id, { id: e.id, warn: new DiskWarn(this.warns, e.x, e.y, REACH.bomber), emberT: 0 });
        this.sfx.play('enemy.fuse');
        break;
      }
      case 'foeBlast': {
        const f = this.fuses.get(e.id);
        if (f) {
          // 炸开：红光整块闪一下（在炸开的那一点），然后慢慢褪掉
          f.warn.move(e.x, e.y);
          f.warn.strike();
          f.warn.end(0.35);
        }
        this.blast(e.x, e.y, e.r);
        break;
      }
      case 'foeSplit':
        this.split(e.x, e.y);
        break;
      case 'foeGuard': {
        // 盾面挡下：几点金光从盾面往外迸，夹两粒天青（符文亮起在 enemy-views 里）
        this.sparks.emit(e.x, e.y, 4, [C.Y, C.f, C.W], [25, 60], [0.12, 0.25], { dir: e.a, spread: 1.4, drag: 5 });
        this.glows.emit(e.x, e.y, 2, [C.CC, C.W], [10, 30], [0.15, 0.3], { dir: e.a, spread: 1.2, drag: 4 });
        if (this.guardSfx <= 0) {
          this.guardSfx = 0.09;
          this.sfx.play('enemy.guard');
        }
        break;
      }
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.guardSfx -= dt;
    const byId = new Map<number, Enemy>();
    for (const e of w.enemies) if (e.hp > 0) byId.set(e.id, e);
    // 画面比模拟慢 (1 − alpha) 步（位置按 alpha 插值），计时也按这个对齐
    const lag = (1 - alpha) * DT;
    for (const [id, v] of this.lines) {
      const e = byId.get(id);
      const warn = v.warn;
      if (v.struck >= 0) v.struck += dt;
      if (!warn.struck) {
        // 蓄力中：进度读模拟的蓄力计时；敌人没了，或者这一下被打断了（没出手就回到了平常） → 慢慢褪掉
        if (!e || e.act !== 'windup') warn.end(0.25);
        const k = e && e.act === 'windup' && e.actLen ? 1 - (e.actT! + lag) / e.actLen : 1;
        warn.draw(dt, clamp01(k));
      } else if (v.kind === 'spearman') {
        // 刺出去的那一下（FOES.spearman.strike 秒）整条都还会伤人，之后淡出
        if (!e || e.act !== 'strike') warn.end(0.3);
        warn.draw(dt, 1, { from: 0, to: warn.len });
        this.drawGleam(v);
      } else {
        // 冲锋：骑兵前面的还危险，冲过的地方拖一截慢慢淡掉；冲完（或被打断）就整体淡出
        if (e && e.act === 'strike') v.head = Math.max(v.head, Math.min(warn.len, warn.along(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha)));
        else warn.end(0.35);
        warn.draw(dt, 1, { from: v.head, to: warn.len, head: v.head });
      }
      if (warn.done && (!v.gleam || v.struck > 0.4)) {
        this.dropLine(v);
        this.lines.delete(id);
      }
    }
    // 引信：地上的红圈从中心往外推亮（圆心跟着被撞开的爆符鬼走）；鬼身上迸出的火星往四周落，越到后面越密
    for (const [id, f] of this.fuses) {
      const e = byId.get(id);
      const lit = !!e && e.act === 'fuse';
      if (!lit && !f.warn.struck) f.warn.end(0.25); // 没炸就没了（一波结束、被清场）
      let k = 1;
      if (lit) {
        const x = e.px + (e.x - e.px) * alpha;
        const y = e.py + (e.y - e.py) * alpha;
        f.warn.move(x, y);
        k = e.actLen ? clamp01(1 - (e.actT! + lag) / e.actLen) : 1;
        f.emberT -= dt;
        if (f.emberT <= 0) {
          f.emberT = 0.11 - 0.06 * k;
          const a = Math.random() * Math.PI * 2;
          this.sparks.emit(x, y - 8, 1, [C.o, C.e, C.Y], [55, 85 + f.warn.R], [0.3, 0.45], { dir: a, spread: 0.3, drag: 3, g: 60, scale: k > 0.6 && Math.random() < 0.3 ? 2 : 1 });
        }
      }
      f.warn.draw(dt, k);
      if (f.warn.done) {
        f.warn.destroy();
        this.fuses.delete(id);
      }
    }
    for (let i = this.rays.length - 1; i >= 0; i--) {
      const b = this.rays[i];
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.g.destroy();
        this.rays.splice(i, 1);
        continue;
      }
      // 放射线：内端从 0.15r 退到 0.75r，外端从 0.4r 窜到 1.05r（按每条的长短），由实到淡
      const ease = 1 - (1 - k) ** 3;
      b.g.clear();
      for (const ray of b.rays) {
        const r0 = b.r * (0.15 + 0.6 * ease) * ray.l;
        const r1 = b.r * (0.4 + 0.65 * ease) * ray.l;
        const ca = Math.cos(ray.a);
        const sa = Math.sin(ray.a) * 0.7; // 俯视：上下压扁一点
        pixLine(b.g, b.x + ca * r0, b.y + sa * r0, b.x + ca * r1, b.y + sa * r1);
        b.g.fill({ color: ray.c, alpha: (1 - k) ** 1.5 });
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.g.destroy();
        this.flashes.splice(i, 1);
        continue;
      }
      f.g.alpha = (1 - k) * (1 - k);
    }
  }

  /** 刺出：一道枪芒沿刺击线一闪（白芯、金边，在胸口高度），0.3 秒里褪掉。 */
  private drawGleam(v: LineView) {
    const g = v.gleam;
    if (!g) return;
    g.clear();
    const s = clamp01(v.struck / 0.06);
    const fade = 1 - clamp01((v.struck - 0.06) / 0.3);
    if (fade <= 0) return;
    const L = v.warn.len;
    const [x0, y0] = v.warn.at(6);
    const [x1, y1] = v.warn.at(12);
    const [xe, ye] = v.warn.at(L * s);
    pixLine(g, x0, y0 - 12, xe, ye - 12);
    g.fill({ color: C.Y, alpha: 0.9 * fade });
    if (L * s > 12) {
      pixLine(g, x1, y1 - 12, xe, ye - 12);
      g.fill({ color: C.W, alpha: fade });
    }
  }

  /**
   * 爆符炸开：一圈往外窜、慢慢褪掉的像素放射线（白芯、金线，长短不一，不是圆），一团往外迸的火星（大致到炸开的半径，
   * 芯里几粒两像素的大火星），几缕往上卷、散得慢的黑烟，飘落的符纸碎片；震屏。
   */
  private blast(x: number, y: number, r: number) {
    const g = new Graphics();
    this.air.addChild(g);
    const rays = Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, l: 0.7 + Math.random() * 0.45, c: i % 3 === 0 ? C.W : i % 3 === 1 ? C.Y : C.f }));
    this.rays.push({ g, x, y: y - 8, r, t: 0, life: 0.42, rays });
    const sp = r * 3; // 带阻尼 3.5 的粒子大约飞出 速度 / 阻尼 那么远
    this.sparks.emit(x, y - 8, 30, FIRE, [sp * 0.45, sp * 1.05], [0.25, 0.55], { drag: 3.5 });
    this.sparks.emit(x, y - 8, 8, [C.Y, C.f, C.o], [sp * 0.2, sp * 0.6], [0.3, 0.5], { drag: 4, scale: 2 });
    this.glows.emit(x, y - 8, 12, [C.W, C.f, C.Y], [20, sp * 0.7], [0.2, 0.4], { drag: 4 });
    for (let i = 0; i < 12; i++) this.sparks.emit(x + (Math.random() - 0.5) * 16, y - 4 - Math.random() * 10, 1, [C.g, C.h, C.d, C.P], [6, 26], [0.8, 1.4], { up: 14, drag: 1.6, scale: i % 2 === 0 ? 2 : 1 });
    this.sparks.emit(x, y - 10, 9, [C.Y, C.y, C.j], [30, 80], [0.7, 1.2], { g: 45, drag: 2, up: 34 });
    this.shake.add(0.24);
    this.sfx.play('enemy.explode');
  }

  /** 分魂鬼分裂：接缝那一道魂光裂开（一列亮点往两边散开），一团靛青、紫棠的魂雾。 */
  private split(x: number, y: number) {
    const g = new Graphics();
    for (let k = 2; k <= 17; k++) g.rect(Math.round(x + (k % 3 === 0 ? 1 : 0)), Math.round(y - k), 1, 1);
    g.fill({ color: C.W });
    this.air.addChild(g);
    this.flashes.push({ g, t: 0, life: 0.3 });
    for (let k = 2; k <= 17; k += 2) {
      this.glows.emit(x, y - k, 1, [C.CC, C.W], [12, 30], [0.25, 0.45], { dir: Math.PI, spread: 0.5, drag: 3 });
      this.glows.emit(x, y - k, 1, [C.CC, C.W], [12, 30], [0.25, 0.45], { dir: 0, spread: 0.5, drag: 3 });
    }
    this.sparks.emit(x, y - 9, 12, [0x2f5373, 0x1d2b4a, C.P, C.p], [15, 45], [0.35, 0.6], { up: 10, drag: 3 });
    this.sfx.play('enemy.split');
  }
}
