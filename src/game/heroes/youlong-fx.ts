// 回响敖丙的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件和 Player.loongs / Player.hualong。
// - 专属法宝「游龙戟」：一条冰龙从戟尖游出去（身子沿它走过的路画：会拐弯，一节一节的鳞、背鳍、地上的影子；龙头是按方向转好的小图），
//   咬一口：那只敌人身上迸开一片冰碴；游完：仙品起尽头炸开一片冰（冰碴往四周迸、地上一片冰面慢慢化掉），没有就散成一缕冰屑。
// - 神通「化龙」：人化成一团水雾、一条白龙从雾里游出来（这几秒人物本身不画，龙头跟着人物走，身子沿走过的路摆）；
//   变回来：龙散成水雾、人显出来，落地掀一圈浪（一圈往外推的水沿，断开的、不是光圈）。
// - 被动「龙鳞」：鳞甲完好（加成吃满）时肩甲、胸前隔一会儿闪一粒冷光；掉到不加了就不闪。
// 龙的画法和首领的敖丙共用（game/dragon-draw.ts）。用户口径：不要光圈；出现和消失都有过程；尺寸收着。
import { Container, Sprite } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { iceBody } from '../../art/sprites/aobing-fx.ts';
import { longlinBonus } from '../../sim/heroes/passives.ts';
import { LONGLIN } from '../../sim/catalog.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { C, clamp01, headOf, Pixels, rnd } from '../fx.ts';
import { DRAGON, DragonTrail, dragonHeads, drawDragonBody, headIndex } from '../dragon-draw.ts';

const FROST = [0xc3ccd2, C.Cc, C.w, C.W];
const WATER = [C.Cc, C.c, C.w, C.n];

interface LoongView {
  trail: DragonTrail;
  head: Sprite;
  seen: boolean;
}
interface BigView {
  trail: DragonTrail;
  head: Sprite;
  a: number; // 龙显出来多少（0..1）
  on: boolean;
}
interface IcePatch {
  body: Sprite;
  t: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  t: number;
}

export interface YoulongHook {
  /** 第 i 个人物的精灵（化龙时把它藏起来）。 */
  sprite: (owner: number) => Sprite | undefined;
}

export class YoulongFx {
  private loongs = new Map<number, LoongView>();
  private bigs = new Map<number, BigView>();
  private ice: IcePatch[] = [];
  private rings: Ring[] = [];
  private glintT = new Map<number, number>();
  private top = new Pixels();
  private floor = new Pixels();
  private layer = new Container();
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private hook: YoulongHook;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx, hook: YoulongHook) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    this.hook = hook;
    stage.floor.addChild(this.floor.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 化龙的那几秒：人物本身不画（龙替他）。 */
  hidden(owner: number): boolean {
    const b = this.bigs.get(owner);
    return !!b && b.a > 0.5;
  }

  clear() {
    for (const v of this.loongs.values()) v.head.destroy();
    this.loongs.clear();
    for (const v of this.bigs.values()) v.head.destroy();
    this.bigs.clear();
    for (const i of this.ice) i.body.destroy();
    this.ice = [];
    this.rings = [];
    this.top.flush();
    this.floor.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'loong': {
        const p = w.players[e.owner];
        // 戟尖聚一点寒气，龙从这里游出来
        this.sparks.emit(e.x, e.y - 6, 6, FROST, [8, 26], [0.25, 0.45], { drag: 3 });
        this.play('youlong.cast', 'hanbing.spike', 0.5);
        void p;
        break;
      }
      case 'loongBite': {
        const en = w.enemies.find((x) => x.id === e.target);
        const hd = en ? headOf(en.kind) : 16;
        // 咬一口：冰碴迸开
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + rnd(-0.3, 0.3);
          this.sparks.emit(e.x, e.y - hd * 0.45, 1, FROST, [24, 60], [0.2, 0.4], { dir: a, spread: 0.3, drag: 4 });
        }
        this.play('youlong.bite', 'ice', 0.35);
        break;
      }
      case 'loongEnd': {
        const v = this.loongs.get(e.id);
        if (e.burst > 0) {
          // 凝冰：尽头炸开一片冰
          for (let k = 0; k < 18; k++) {
            const a = (k / 18) * Math.PI * 2 + rnd(-0.2, 0.2);
            this.sparks.emit(e.x + Math.cos(a) * 3, e.y + Math.sin(a) * 2, 1, FROST, [e.burst * 1.5, e.burst * 2.6], [0.3, 0.5], { dir: a, spread: 0.25, drag: 5 });
          }
          this.sparks.emit(e.x, e.y - 3, 6, FROST, [20, 50], [0.35, 0.6], { up: 44, g: 220, drag: 1.5 });
          const body = new Sprite(textureFromGrid(iceBody(Math.round(e.burst), Math.round(e.burst) * 5)));
          body.anchor.set(0.5);
          body.position.set(Math.round(e.x), Math.round(e.y));
          body.alpha = 0;
          this.stage.floor.addChild(body);
          this.ice.push({ body, t: 0 });
          this.shake.add(0.12);
          this.play('youlong.burst', 'hanbing.frost', 0.7);
        } else if (v) {
          const h = v.trail.head;
          if (h) for (let k = 0; k < 8; k++) this.sparks.emit(h.x + rnd(-6, 6), h.y - rnd(2, 12), 1, FROST, [6, 22], [0.35, 0.6], { up: 10, drag: 2.5 });
        }
        break;
      }
      case 'skill':
        if (e.kind !== 'hualong') break;
        // 化龙：人化成一团水雾
        for (let k = 0; k < 22; k++) this.sparks.emit(e.x + rnd(-7, 7), e.y - rnd(2, 26), 1, WATER, [10, 44], [0.4, 0.7], { up: 16, drag: 2.5 });
        this.shake.add(0.3);
        this.play('youlong.hualong', 'boss.dash', 0.8);
        break;
      case 'hualongEnd':
        // 变回来：落地掀一圈浪
        this.rings.push({ x: e.x, y: e.y, r: e.r, t: 0 });
        for (let k = 0; k < 20; k++) this.sparks.emit(e.x + rnd(-8, 8), e.y - rnd(2, 24), 1, WATER, [10, 40], [0.4, 0.7], { up: 14, drag: 2.5 });
        this.sparks.emit(e.x, e.y - 4, 10, [C.W, C.w, C.Cc], [30, 70], [0.3, 0.5], { up: 50, g: 220, drag: 2 });
        this.shake.add(0.4);
        this.play('youlong.land', 'xuanyuan.pool', 0.9);
        break;
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const live = new Set<number>();
    for (const p of w.players) {
      // ---- 游龙戟的冰龙 ----
      for (const L of p.loongs ?? []) {
        live.add(L.id);
        let v = this.loongs.get(L.id);
        const x = L.px + (L.x - L.px) * alpha;
        const y = L.py + (L.y - L.py) * alpha;
        if (!v) {
          const head = new Sprite(dragonHeads(false)[0].tex);
          this.layer.addChild(head);
          v = { trail: new DragonTrail(60), head, seen: false };
          v.trail.seed(x, y, L.ux, L.uy, 2);
          this.loongs.set(L.id, v);
        }
        v.trail.push(x, y);
        drawDragonBody(this.top, this.floor, false, v.trail.at, clamp01(L.t / 0.1), this.time);
        const hd = dragonHeads(false)[headIndex(L.ux, L.uy)];
        v.head.texture = hd.tex;
        v.head.anchor.set(hd.ax, hd.ay);
        v.head.position.set(Math.round(x), Math.round(y - DRAGON.small.lift));
        v.head.alpha = clamp01(L.t / 0.1);
        if (Math.random() < 0.5) this.sparks.emit(x - L.ux * rnd(6, 24), y - L.uy * rnd(6, 24) - DRAGON.small.lift + rnd(-2, 2), 1, FROST, [4, 12], [0.3, 0.5], { g: 20, drag: 2 });
      }
      // ---- 化龙 ----
      this.updateBig(p.id, w, dt, alpha);
      // ---- 龙鳞：加成吃满时肩头、胸前隔一会儿闪一粒冷光 ----
      if (p.hero === 'huiao' && p.alive && !p.hualong && longlinBonus(p) >= LONGLIN.max - 1e-6) {
        const t = (this.glintT.get(p.id) ?? rnd(0.5, 1.5)) - dt;
        if (t <= 0) {
          this.glintT.set(p.id, rnd(0.9, 1.8));
          const gx = p.x + p.facing * rnd(-4, 4);
          this.sparks.emit(gx, p.y - rnd(15, 21), 1, [C.W, C.Cc], [0, 3], [0.25, 0.4], { up: 6, drag: 3 });
        } else this.glintT.set(p.id, t);
      }
    }
    for (const [id, v] of this.loongs) {
      if (live.has(id)) continue;
      v.head.destroy();
      this.loongs.delete(id);
    }
    this.drawIce(dt);
    this.drawRings(dt);
    this.top.flush();
    this.floor.flush();
  }

  private updateBig(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const on = !!p.hualong && p.alive;
    let v = this.bigs.get(id);
    if (!on && !v) return;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    if (!v) {
      const head = new Sprite(dragonHeads(true)[0].tex);
      this.layer.addChild(head);
      v = { trail: new DragonTrail(90), head, a: 0, on: false };
      v.trail.seed(x, y, p.facing, 0, 4);
      this.bigs.set(id, v);
    }
    v.a = clamp01(v.a + (on ? dt / 0.18 : -dt / 0.25));
    v.on = on;
    const spr = this.hook.sprite(id);
    if (v.a <= 0 && !on) {
      v.head.destroy();
      this.bigs.delete(id);
      if (spr) spr.visible = true;
      return;
    }
    v.trail.push(x, y);
    // 人物本身：龙显出来就藏起来，龙散了再显回来
    if (spr) spr.visible = v.a < 0.5;
    drawDragonBody(this.top, this.floor, true, v.trail.at, v.a, this.time);
    const h = v.trail.head;
    const ux = h && (h.ux || h.uy) ? h.ux : p.facing;
    const uy = h ? h.uy : 0;
    const hd = dragonHeads(true)[headIndex(ux, uy)];
    v.head.texture = hd.tex;
    v.head.anchor.set(hd.ax, hd.ay);
    v.head.position.set(Math.round(x), Math.round(y - DRAGON.big.lift));
    v.head.alpha = v.a;
    v.head.zIndex = y;
    if (on && Math.random() < 0.9) this.sparks.emit(x - ux * rnd(6, 44) + rnd(-3, 3), y - uy * rnd(6, 44) - DRAGON.big.lift + rnd(-3, 3), 1, WATER, [4, 14], [0.3, 0.55], { g: 40, drag: 2 });
  }

  /** 凝冰留下的冰面：0.15 秒显出来，留 1.2 秒，再 0.6 秒化掉。 */
  private drawIce(dt: number) {
    for (let i = this.ice.length - 1; i >= 0; i--) {
      const c = this.ice[i];
      c.t += dt;
      c.body.alpha = 0.85 * clamp01(c.t / 0.15) * clamp01((1.95 - c.t) / 0.6);
      if (c.t >= 1.95) {
        c.body.destroy();
        this.ice.splice(i, 1);
      }
    }
  }

  /** 化龙落地的那一圈浪：一圈往外推的水沿（断开的几段，前沿白沫、后面两档水色），0.45 秒推到判定半径、淡掉。 */
  private drawRings(dt: number) {
    const F = this.floor;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.45;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const R = r.r * (1 - (1 - k) * (1 - k));
      const a = 1 - k * k;
      const n = Math.max(24, Math.round(R * 2.2));
      for (let j = 0; j < n; j++) {
        const ang = (j / n) * Math.PI * 2;
        if (Math.sin(ang * 7 + r.x) > 0.75) continue; // 断开
        const wob = Math.sin(ang * 5 + this.time * 9) * 1.2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang) * 0.62;
        F.dot(r.x + cx * (R + wob), r.y + sy * (R + wob), j % 3 ? C.w : C.W, a);
        F.dot(r.x + cx * (R + wob - 1.5), r.y + sy * (R + wob - 1.5), C.Cc, a * 0.9);
        F.dot(r.x + cx * (R + wob - 3), r.y + sy * (R + wob - 3), C.c, a * 0.6);
      }
    }
  }
}
