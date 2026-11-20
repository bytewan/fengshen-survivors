// 回响赵公明（回响化身）的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件和 Player.ropes / nails / grudge。
// - 缚龙索：一根暗金的索从他手里甩出去（索头先飞到那一群），然后从拽到的那一点牵出几股，各缠一只，往一处收；索身一节一节的绞纹（缃、藤黄、琥珀），
//   梢上一点魂火的天青。拽到一起：尘土一震；仙品「锁龙」锁住的那一会儿，索在那一团身上绕几道、闪一下；器灵「千钧」在那一点砸下一记（尘浪、碎石）。
// - 钉头七箭：被钉上的敌人头顶浮起一张小小的草人符（黄纸、朱砂的钉痕），慢慢晃；快落箭时抖起来；落箭时七道细细的箭影从上往下扎下来，符碎成纸屑。
// - 被动「怨力」：怨攒得越满，身上越常冒出一缕墨色的怨气（不成圈）；攒满震出去的那一圈是几段断开的墨色弧往外推，尘土往四周卷开。
// 用户口径：不要光圈；效果不超过判定；出现和消失都有过程。声音先借现有的（docs/audio.md 的借用规则）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid } from '../../art/pixel.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, Pixels, rnd } from '../fx.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const ROPE = [C.Y, C.y, C.b];
const DUST = [0x6b5749, 0x776672, 0x4f5652, 0xb3b8a6];
const INK = [C.k, C.d, C.g];
/** 草人符：黄纸剪成的小人（5×8），身上三道朱砂的钉痕。 */
const STRAW = grid(['.YyY.', 'YyyyY', '.yry.', 'Yyyyy', 'yrryy', '.yyy.', '.y.y.', '.b.b.']);

interface Tag {
  s: Sprite;
  id: number;
  t: number;
  t2: number; // 多久后落箭
  out: number; // > 0：落完箭 / 敌人没了，纸屑散开（剩多少秒）
}
interface Bolt {
  x: number;
  y: number;
  t: number;
  delay: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  t: number;
}
interface Lock {
  x: number;
  y: number;
  t: number;
  life: number;
}

export class HuizhaoFx {
  private tags = new Map<number, Tag>();
  private bolts: Bolt[] = [];
  private rings: Ring[] = [];
  private locks: Lock[] = [];
  private throws = new Map<number, { t: number }>(); // 每根索甩出去的那一下（索头飞向那一群）
  private top = new Pixels();
  private layer = new Container();
  private strawTex: Texture;
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;
  private wisp = new Map<number, number>();

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
    this.strawTex = textureFromGrid(STRAW);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    for (const t of this.tags.values()) t.s.destroy();
    this.tags.clear();
    this.bolts = [];
    this.rings = [];
    this.locks = [];
    this.throws.clear();
    this.top.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'lasso':
        this.throws.set(e.id, { t: 0 });
        this.play('fulong.throw', 'kunxian.throw', 0.6);
        break;
      case 'lassoEnd':
        // 拽到一起：尘土一震
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + rnd(-0.2, 0.2);
          this.sparks.emit(e.cx + Math.cos(a) * 4, e.cy + Math.sin(a) * 3, 1, DUST, [30, 60], [0.3, 0.5], { dir: a, spread: 0.3, drag: 5 });
        }
        if (e.lock) this.locks.push({ x: e.cx, y: e.cy, t: 0, life: e.lock });
        if (e.slam) {
          // 千钧：那一点砸下一记
          this.rings.push({ x: e.cx, y: e.cy, r: e.slam, t: 0 });
          this.sparks.emit(e.cx, e.cy - 2, 10, [0x4f5652, 0x6d756c, 0x6b5749], [30, 80], [0.35, 0.6], { up: 60, g: 260, drag: 1.5 });
          this.shake.add(0.3);
          this.play('fulong.slam', 'fantian.land', 0.8);
        } else this.play('fulong.clash', 'kunxian.clash', 0.6);
        this.throws.delete(e.id);
        break;
      case 'nail':
        for (const id of e.ids) {
          let t = this.tags.get(id);
          if (!t) {
            const s = new Sprite(this.strawTex);
            s.anchor.set(0.5, 1);
            s.alpha = 0;
            this.layer.addChild(s);
            t = { s, id, t: 0, t2: e.t2, out: 0 };
            this.tags.set(id, t);
          }
          t.t = 0;
          t.t2 = e.t2;
          t.out = 0;
        }
        this.play('dingtou.nail', 'leigong.mark', 0.6);
        break;
      case 'nailHit': {
        let k = 0;
        for (const id of e.ids) {
          const en = w.enemies.find((x) => x.id === id);
          if (!en) continue;
          // 七道细细的箭影从上往下扎下来（一只身上一道，一道接一道）
          this.bolts.push({ x: en.x, y: en.y - 6, t: 0, delay: k * 0.05 });
          k++;
        }
        for (const t of this.tags.values()) t.out = 0.35;
        this.shake.add(0.3);
        this.play('dingtou.strike', 'leigong.strike', 0.8);
        break;
      }
      case 'grudge':
        this.rings.push({ x: e.x, y: e.y - 6, r: e.r, t: 0 });
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + rnd(-0.2, 0.2);
          this.sparks.emit(e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 4, 1, DUST, [e.r * 1.1, e.r * 1.8], [0.35, 0.55], { dir: a, spread: 0.3, drag: 4 });
        }
        this.sparks.emit(e.x, e.y - 12, 10, INK, [20, 50], [0.4, 0.7], { up: 20, drag: 2 });
        this.shake.add(0.3);
        this.play('yuanli.burst', 'boss.roar', 0.5);
        break;
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const T = this.top;
    // ---- 缚龙索 ----
    for (const p of w.players) {
      if (!p.ropes) continue;
      const hx = p.px + (p.x - p.px) * alpha + p.facing * 6;
      const hy = p.py + (p.y - p.py) * alpha - 14;
      for (const r of p.ropes) {
        const th = this.throws.get(r.id) ?? { t: 1 };
        th.t += dt;
        const fly = clamp01(th.t / 0.14); // 索头先飞到那一群
        const gx = hx + (r.cx - hx) * fly;
        const gy = hy + (r.cy - 6 - hy) * fly;
        rope(T, hx, hy, gx, gy, 6 * (1 - fly) + 2, this.time);
        if (fly < 1) continue;
        // 从拽到的那一点牵出几股，各缠一只
        for (const id of r.ids) {
          const e = w.enemies.find((x) => x.id === id && x.hp > 0);
          if (!e) continue;
          const ex = e.px + (e.x - e.px) * alpha;
          const ey = e.py + (e.y - e.py) * alpha - 6;
          rope(T, r.cx, r.cy - 6, ex, ey, 3, this.time + id);
          // 缠在身上的两道
          T.dot(ex - 2, ey, C.y, 0.9);
          T.dot(ex + 2, ey + 1, C.b, 0.9);
        }
        if (Math.random() < 0.3) this.sparks.emit(r.cx, r.cy - 6, 1, [C.Cc, C.Y], [4, 10], [0.2, 0.35], { drag: 3 });
      }
    }
    // 锁龙：索在那一团身上绕几道、一闪一闪
    for (let i = this.locks.length - 1; i >= 0; i--) {
      const l = this.locks[i];
      l.t += dt;
      if (l.t >= l.life) {
        this.locks.splice(i, 1);
        continue;
      }
      const a = 1 - l.t / l.life;
      for (let k = 0; k < 3; k++) {
        const yy = l.y - 3 - k * 4;
        for (let u = -9; u <= 9; u += 1) {
          if ((u + k * 3 + Math.floor(this.time * 20)) % 6 === 0) continue; // 断开几处，不成一个框
          T.dot(l.x + u, yy + Math.sin(u * 0.5 + k) * 1.2, (u + k) % 3 ? C.y : C.Y, a * 0.8);
        }
      }
    }
    // ---- 钉头七箭：草人符 ----
    for (const [id, t] of this.tags) {
      const e = w.enemies.find((x) => x.id === id && x.hp > 0);
      t.t += dt;
      if (t.out > 0 || !e) {
        if (t.out <= 0) t.out = 0.35;
        t.out -= dt;
        t.s.alpha = clamp01(t.out / 0.35);
        if (t.out > 0.3) this.sparks.emit(t.s.x, t.s.y - 4, 2, [C.Y, C.y, C.r], [15, 35], [0.3, 0.5], { up: 10, g: 80, drag: 2 });
        if (t.out <= 0) {
          t.s.destroy();
          this.tags.delete(id);
        }
        continue;
      }
      const ex = e.px + (e.x - e.px) * alpha;
      const ey = e.py + (e.y - e.py) * alpha;
      const head = e.kind === 'boss' ? 34 : e.kind === 'elite' ? 30 : 22;
      const left = t.t2 - t.t;
      const shakeX = left < 0.6 ? Math.sin(this.time * 50) * 1.2 : 0; // 快落箭时抖起来
      t.s.position.set(Math.round(ex + shakeX), Math.round(ey - head - 2 + Math.sin(this.time * 3 + id) * 1.5));
      t.s.alpha = Math.min(1, t.t / 0.25);
    }
    // 落下的箭影：一道细线从上往下扎，扎到了迸几粒朱砂
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const k = (b.t - b.delay) / 0.16;
      if (k < 0) continue;
      if (k >= 1.6) {
        this.bolts.splice(i, 1);
        continue;
      }
      const head = Math.min(1, k);
      const fade = k > 1 ? 1 - (k - 1) / 0.6 : 1;
      const top = b.y - 40;
      const y1 = top + (b.y - top) * head;
      for (let y = Math.max(top, y1 - 14); y <= y1; y++) T.dot(b.x, y, y > y1 - 3 ? C.w : C.j, fade * 0.85);
      if (k >= 1 && k < 1.05) this.sparks.emit(b.x, b.y, 3, [C.r, C.e, C.Y], [15, 35], [0.2, 0.35], { up: 12, drag: 3 });
    }
    // 怨力的震波、千钧砸下：几段断开的墨色弧往外推
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.45;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const R = r.r * (0.35 + 0.65 * Math.sqrt(k));
      for (let s = 0; s < 8; s++) {
        const a0 = (s / 8) * Math.PI * 2 + 0.2;
        for (let u = 0; u < 0.5; u += 0.05) {
          const a = a0 + u;
          T.dot(r.x + Math.cos(a) * R, r.y + Math.sin(a) * R * 0.62, s % 2 ? C.d : C.g, (1 - k) * 0.75);
        }
      }
    }
    // 怨气：攒得越满，身上越常冒出一缕墨色的烟
    for (const p of w.players) {
      if (p.hero !== 'huizhao' || !p.alive) continue;
      const g = p.grudge ?? 0;
      if (g < 0.3) continue;
      let t = (this.wisp.get(p.id) ?? 0) - dt;
      if (t <= 0) {
        t = 0.45 - 0.35 * g;
        this.sparks.emit(p.x + rnd(-6, 6), p.y - rnd(6, 20), 1, INK, [2, 6], [0.5, 0.8], { up: 14, drag: 2 });
      }
      this.wisp.set(p.id, t);
    }
    T.flush();
  }
}

/** 一段索：从 (x0, y0) 到 (x1, y1)，中间往下坠 sag 像素；一节一节的绞纹（缃、藤黄、琥珀轮着来），随时间慢慢往前走。 */
function rope(T: Pixels, x0: number, y0: number, x1: number, y1: number, sag: number, time: number) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.ceil(len));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = x0 + (x1 - x0) * k;
    const y = y0 + (y1 - y0) * k + Math.sin(Math.PI * k) * sag;
    const c = ROPE[(i + Math.floor(time * 12)) % 3];
    T.dot(x, y, c, 0.95);
  }
}
