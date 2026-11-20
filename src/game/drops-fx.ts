// 战场掉落的画面（乾坤宝匣、蟠桃、聚灵符）：地上的精灵与待机动画、快消失时闪烁、从敌人身上弹出来的弧线、
// 波末收灵时飞向人物的拖尾、拾取时的效果（宝匣开盖放光、蟠桃化作回血光点、聚灵符烧成灰烬）。
// 读 world.drops 和 drop / loot 事件，只作用在表现层。用户口径：不画光圈，用线条、像素粒子、形状；出现和消失都要有过程。
import { Container, Sprite, type Texture } from 'pixi.js';
import { CHEST, CHEST_OPENING, PEACH, TALISMAN, talismanBurn, TWINKLE } from '../art/sprites/drops.ts';
import { C } from '../art/sprites/pet.ts';
import { textureFromGrid } from '../render/textures.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import type { Drop, DropKind, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { PixelLayer } from './pet-fx.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';

interface View {
  id: number;
  kind: DropKind;
  s: Sprite;
  sh: Sprite;
  t: number; // 出现了多久（表现层自己的时钟，驱动待机动画）
  seed: number;
  arc: { t: number; dur: number; x0: number; y0: number; h: number } | null; // 刚掉出来：从敌人身上弹出的弧线
  x: number; // 上一帧画的位置
  y: number;
  vx: number;
  vy: number;
  fly: number; // 0..1：被吸过去时的「飞行感」（离地、拖尾）
  ghosts: Sprite[]; // 飞行拖尾的残影
  hist: [number, number][];
  twinkle: number; // 距下次闪一下
  tw: { s: Sprite; t: number } | null;
  mote: number;
  flut: number; // 符纸飘动的进度（按飞行快慢累加，换速时不跳帧）
  looted: boolean;
}

/** 拾取 / 消失时的一段效果。 */
interface Burst {
  kind: DropKind | 'vanish';
  x: number;
  y: number;
  t: number;
  s: Sprite | null;
  rays: { a: number; len: number; delay: number }[];
  text: Container | null;
  life: number;
  seed: number;
  ash: number;
  /** 光线和粒子归这里放（false：别处接管了，xfx.ts 的修仙版拾取效果；精灵、开盖、奖励字照旧）。 */
  own: boolean;
}

const ARC_DUR = 0.5;
const FLY_GHOSTS = 3;

export class DropsFx {
  private views = new Map<number, View>();
  private bursts: Burst[] = [];
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private sfx: Sfx;
  private layer = new Container();
  private rays = new PixelLayer(160, 120);
  private tex: Record<DropKind, Texture[]>;
  private open: Texture[];
  private burn: Texture[][];
  private twinkle: Texture[];
  private pending = new Map<number, { x: number; y: number }>(); // drop 事件先到、掉落物还没进 world.drops 时记下来
  /** 拾取的那一下交给别处画光（xfx.ts）：返回 true 就不放这里的光线和粒子。x / y 是掉落物最后画的位置（脚下），owner 是捡的人。 */
  onLoot: ((kind: DropKind, x: number, y: number, owner: number) => boolean) | null = null;

  constructor(stage: Stage, sparks: Particles, glows: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.sfx = sfx;
    this.tex = { chest: CHEST.map(textureFromGrid), peach: PEACH.map(textureFromGrid), magnet: TALISMAN.map(textureFromGrid) };
    this.open = CHEST_OPENING.map(textureFromGrid);
    this.burn = [0, 1, 2].map((f) => Array.from({ length: 9 }, (_, i) => textureFromGrid(talismanBurn((i + 1) / 10, f))));
    this.twinkle = TWINKLE.map(textureFromGrid);
    stage.fx.addChild(this.rays.sprite, this.layer);
    this.rays.sprite.visible = false;
  }

  clear() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
    for (const b of this.bursts) this.endBurst(b);
    this.bursts = [];
    this.pending.clear();
    this.rays.sprite.visible = false;
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'drop') {
      this.sfx.play('drop.spawn');
      const d = w.drops.find((x) => x.id === e.id);
      if (d) this.spawnArc(this.view(d), e.x, e.y);
      else this.pending.set(e.id, { x: e.x, y: e.y });
      return;
    }
    if (e.t !== 'loot') return;
    // 按掉落物的 id 找；万一找不到（比如刚掉出来就被捡走），再找同种、离事件位置最近的那一个
    let best: View | null = this.views.get(e.id) ?? null;
    if (best?.looted) best = null;
    let bd = best ? -1 : 60 * 60;
    for (const v of best ? [] : this.views.values()) {
      if (v.kind !== e.kind || v.looted) continue;
      const d2 = (v.x - e.x) ** 2 + (v.y - e.y) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = v;
      }
    }
    const x = best ? best.x : e.x;
    const y = best ? best.y : e.y;
    if (best) {
      best.looted = true;
      best.s.visible = false;
      best.sh.visible = false;
      for (const g of best.ghosts) g.visible = false;
      if (best.tw) best.tw.s.visible = false;
    }
    this.sfx.play(e.kind === 'chest' ? 'drop.chest' : e.kind === 'peach' ? 'drop.peach' : 'drop.magnet');
    this.burstAt(e.kind, x, y, e.reward, e.owner);
  }

  update(dt: number, w: World, alpha: number) {
    const seen = new Set<number>();
    for (const d of w.drops) {
      seen.add(d.id);
      const v = this.view(d);
      if (v.looted) continue;
      this.drawView(v, d, dt, alpha, w);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      // 没被捡就消失了（时间到）：化作几粒灵光散去
      if (!v.looted) this.burstAt('vanish', v.x, v.y, '');
      this.drop(v);
      this.views.delete(id);
    }
    this.updateBursts(dt);
  }

  // ---------- 地上的掉落物 ----------

  private view(d: Drop): View {
    let v = this.views.get(d.id);
    if (v) return v;
    const s = new Sprite(this.tex[d.kind][0]);
    s.anchor.set(0.5, 1);
    const sh = new Sprite(this.stage.tex.smallShadow);
    sh.anchor.set(0.5);
    sh.alpha = 0.28;
    this.stage.entities.addChild(s);
    this.stage.floor.addChild(sh);
    v = {
      id: d.id,
      kind: d.kind,
      s,
      sh,
      t: 0,
      seed: Math.random() * 10,
      arc: null,
      x: d.x,
      y: d.y,
      vx: 0,
      vy: 0,
      fly: 0,
      ghosts: [],
      hist: [],
      twinkle: 0.6 + Math.random() * 1.2,
      tw: null,
      mote: 0,
      flut: 0,
      looted: false,
    };
    this.views.set(d.id, v);
    const p = this.pending.get(d.id);
    if (p) {
      this.pending.delete(d.id);
      this.spawnArc(v, p.x, p.y);
    }
    return v;
  }

  /** 从敌人身上弹出来：起点在身上（偏一点），划一道弧线落到掉落点，落地再轻轻弹一下。 */
  private spawnArc(v: View, x: number, y: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    v.arc = { t: 0, dur: ARC_DUR, x0: x - side * (4 + Math.random() * 4), y0: y - 11, h: 16 + Math.random() * 6 };
    v.t = 0;
  }

  private drawView(v: View, d: Drop, dt: number, alpha: number, w: World) {
    v.t += dt;
    const px = d.px ?? d.x;
    const py = d.py ?? d.y;
    let x = px + (d.x - px) * alpha;
    let y = py + (d.y - py) * alpha;
    // 被吸过去（收灵或聚灵符）：速度大就离地飞起、拖出残影
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 12);
      v.vx += ((x - v.x) / dt - v.vx) * k;
      v.vy += ((y - v.y) / dt - v.vy) * k;
    }
    const sp = Math.hypot(v.vx, v.vy);
    const flying = sp > 30 || w.phase === 'collect';
    v.fly = Math.max(0, Math.min(1, v.fly + (flying && sp > 12 ? dt * 4 : -dt * 3)));
    v.x = x;
    v.y = y;
    let lift = 0;
    let shadowK = 1;
    if (v.arc) {
      const a = v.arc;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      // 横向匀减速，纵向抛物线；落地后弹一下（小）
      const e = 1 - (1 - k) * (1 - k);
      x = a.x0 + (x - a.x0) * e;
      y = a.y0 + (y - a.y0) * e;
      lift = a.h * 4 * k * (1 - k);
      if (a.t > a.dur) {
        const b = (a.t - a.dur) / 0.22;
        lift = b < 1 ? Math.sin(b * Math.PI) * 2.5 : 0;
        if (b >= 1) {
          v.arc = null;
          // 落地：扬起一点灵光碎屑
          this.glows.emit(x, y - 2, 4, [0xffe9a8, 0xf7dc7a], [10, 25], [0.25, 0.45], { up: 6, drag: 3 });
        }
      }
      shadowK = 1 - Math.min(0.6, lift / 30);
    }
    // 待机：上下浮动（符纸飘得高一些、慢一些）
    const bobH = v.kind === 'magnet' ? 2 : 1;
    const hover = v.kind === 'magnet' ? 5 : 0;
    const bob = v.arc ? 0 : Math.round((Math.sin(v.t * (v.kind === 'magnet' ? 1.8 : 2.6) + v.seed) * 0.5 + 0.5) * bobH);
    lift += hover + bob + v.fly * 7;
    const X = Math.round(x);
    const Y = Math.round(y - lift);
    // 帧：宝匣的八卦隔一阵亮一下，蟠桃的高光慢慢挪，符纸三帧飘
    const T = this.tex[v.kind];
    v.flut += dt * (3 + v.fly * 6);
    if (v.kind === 'magnet') v.s.texture = T[Math.floor(v.flut + v.seed) % 3];
    else if (v.kind === 'chest') v.s.texture = T[(v.t + v.seed) % 2.6 < 0.3 ? 1 : 0];
    else v.s.texture = T[(v.t + v.seed) % 3 < 1.5 ? 0 : 1];
    v.s.position.set(X, Y);
    v.s.zIndex = Math.round(y) + 1;
    v.sh.position.set(Math.round(x), Math.round(y) + 1);
    v.sh.alpha = 0.28 * shadowK * (1 - v.fly * 0.6);
    // 快消失时闪烁：越到最后闪得越快（不是一下子消失）
    const left = d.life - d.t;
    let a = 1;
    if (Number.isFinite(left) && left < 3 && !flying) {
      const f = left < 1 ? 9 : left < 2 ? 6 : 4;
      a = Math.sin(v.t * f * Math.PI) > 0 ? 1 : 0.35;
    }
    // 刚掉出来淡入
    a *= Math.min(1, v.t / 0.12);
    v.s.alpha = a;
    // 偶尔闪一下星光（不成圈）
    v.twinkle -= dt;
    if (v.twinkle <= 0 && !v.arc) {
      v.twinkle = 1.6 + Math.random() * 1.8;
      const tw = v.tw?.s ?? new Sprite(this.twinkle[0]);
      tw.anchor.set(0.5);
      if (!tw.parent) this.layer.addChild(tw);
      tw.visible = true;
      const off = TWINKLE_SPOTS[v.kind][Math.floor(Math.random() * TWINKLE_SPOTS[v.kind].length)];
      tw.position.set(X + off[0], Y + off[1]);
      v.tw = { s: tw, t: 0 };
    }
    if (v.tw) {
      v.tw.t += dt;
      const i = Math.floor(v.tw.t / 0.07);
      if (i >= this.twinkle.length) {
        v.tw.s.visible = false;
        v.tw = null;
      } else v.tw.s.texture = this.twinkle[i];
    }
    // 聚灵符：周围的灵气一缕缕往符上聚（天青小点从外往里走）
    if (v.kind === 'magnet' && !v.arc) {
      v.mote -= dt;
      if (v.mote <= 0) {
        v.mote = 0.18 + Math.random() * 0.15;
        const ang = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 6;
        this.glows.emit(X + Math.cos(ang) * r, Y - 8 + Math.sin(ang) * r * 0.6, 1, [0x7cc4c4, 0xffffff], [r * 1.4, r * 1.6], [0.5, 0.6], { dir: ang + Math.PI, spread: 0.15, drag: 1.5 });
      }
    }
    // 飞行拖尾：三个渐淡的残影 + 一路落下的金色碎光
    v.hist.unshift([X, Y]);
    if (v.hist.length > 12) v.hist.pop();
    for (let k = 0; k < FLY_GHOSTS; k++) {
      let g = v.ghosts[k];
      if (!g) {
        g = new Sprite(v.s.texture);
        g.anchor.set(0.5, 1);
        this.stage.entities.addChild(g);
        v.ghosts[k] = g;
      }
      const h = v.hist[Math.min(v.hist.length - 1, (k + 1) * 3)];
      g.visible = v.fly > 0.05;
      g.texture = v.s.texture;
      g.position.set(h[0], h[1]);
      g.zIndex = v.s.zIndex - 0.1 - k * 0.01;
      g.alpha = v.fly * [0.45, 0.25, 0.12][k] * a;
      g.tint = v.kind === 'magnet' ? 0xfff0b0 : v.kind === 'peach' ? 0xffd0e0 : 0xffe0a0;
    }
    if (v.fly > 0.3 && Math.random() < v.fly * 0.8) {
      const colors = v.kind === 'peach' ? [0xd47aa0, 0xffe9a8] : v.kind === 'magnet' ? [0xf7dc7a, 0x7cc4c4] : [0xf7dc7a, 0xffe9a8];
      this.sparks.emit(X + (Math.random() - 0.5) * 6, Y - 4 - Math.random() * 6, 1, colors, [2, 8], [0.25, 0.45], { drag: 4 });
    }
  }

  private drop(v: View) {
    v.s.destroy();
    v.sh.destroy();
    for (const g of v.ghosts) g.destroy();
    v.tw?.s.destroy();
  }

  // ---------- 拾取 ----------

  private burstAt(kind: Burst['kind'], x: number, y: number, reward: string, owner = -1) {
    const b: Burst = { kind, x: Math.round(x), y: Math.round(y), t: 0, s: null, rays: [], text: null, life: 1, seed: Math.random() * 10, ash: 0, own: true };
    if (kind !== 'vanish' && this.onLoot?.(kind, b.x, b.y, owner)) b.own = false;
    if (kind === 'chest') {
      // 宝匣：开盖，从匣口往上射出几道光（线条，不是光圈），奖励的字从匣上飘起
      b.s = new Sprite(this.tex.chest[0]);
      b.s.anchor.set(0.5, 1);
      b.s.position.set(b.x, b.y);
      b.s.zIndex = b.y + 1;
      this.stage.entities.addChild(b.s);
      const n = 7;
      for (let i = 0; b.own && i < n; i++) {
        const a = -Math.PI / 2 + ((i - (n - 1) / 2) / ((n - 1) / 2)) * 0.95 + (Math.random() - 0.5) * 0.12;
        b.rays.push({ a, len: (i % 2 ? 14 : 22) + Math.random() * 6 - Math.abs(i - (n - 1) / 2) * 1.5, delay: 0.12 + Math.abs(i - (n - 1) / 2) * 0.03 });
      }
      if (reward) {
        b.text = rewardLabel(reward);
        b.text.alpha = 0;
        this.layer.addChild(b.text);
      }
      b.life = 2.1;
    } else if (kind === 'peach') {
      // 蟠桃：轻轻往上一浮、化开，冒出一串往上飘的回血光点
      b.s = new Sprite(this.tex.peach[0]);
      b.s.anchor.set(0.5, 1);
      b.s.position.set(b.x, b.y);
      b.s.zIndex = b.y + 1;
      this.stage.entities.addChild(b.s);
      b.life = 1.4;
    } else if (kind === 'magnet') {
      // 聚灵符：从下往上烧成灰烬，火星和纸灰往上飘
      b.s = new Sprite(this.tex.magnet[1]);
      b.s.anchor.set(0.5, 1);
      b.s.position.set(b.x, b.y - 5);
      b.s.zIndex = b.y + 1;
      this.stage.entities.addChild(b.s);
      b.life = 1.5;
    } else {
      b.life = 0.6;
      this.glows.emit(b.x, b.y - 5, 7, [0xffe9a8, 0x7cc4c4, 0xf7dc7a], [8, 22], [0.4, 0.7], { up: 14, drag: 2.5 });
    }
    this.bursts.push(b);
  }

  private endBurst(b: Burst) {
    b.s?.destroy();
    b.text?.destroy();
  }

  private updateBursts(dt: number) {
    const R = this.rays;
    let anyRays = false;
    const chests = this.bursts.filter((b) => b.kind === 'chest' && b.t < 1.4);
    if (chests.length) {
      const c0 = chests[chests.length - 1];
      R.begin(c0.x - 80, c0.y - 100);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const t = b.t;
      if (b.kind === 'chest' && b.s) {
        // 0–0.1 合着抖一下，0.1–0.2 半开，之后全开；1.1 秒后慢慢淡掉
        b.s.texture = t < 0.1 ? this.tex.chest[1] : t < 0.2 ? this.open[0] : this.open[1];
        b.s.position.set(b.x + (t < 0.1 ? Math.round(Math.sin(t * 90)) : 0), b.y);
        b.s.alpha = t < 1.1 ? 1 : Math.max(0, 1 - (t - 1.1) / 0.5);
        if (b.own && t >= 0.18 && t - dt < 0.18) {
          this.glows.emit(b.x, b.y - 9, 14, [0xffe9a8, 0xf7dc7a, 0xffffff], [20, 60], [0.35, 0.7], { up: 20, drag: 3 });
          this.sparks.emit(b.x, b.y - 9, 8, [0xf7dc7a, 0xe0a83a], [30, 70], [0.25, 0.5], { up: 30, drag: 3, g: 60 });
        }
        if (chests.includes(b)) anyRays = this.drawRays(b) || anyRays;
        if (b.text) {
          // 字：0.25 秒后浮现，往上飘、慢下来，最后半秒淡出
          const k = Math.max(0, t - 0.25);
          b.text.position.set(b.x, Math.round(b.y - 22 - 14 * (1 - Math.exp(-k * 2.2))));
          b.text.alpha = k <= 0 ? 0 : Math.min(1, k / 0.18) * Math.min(1, (b.life - t) / 0.5);
        }
      } else if (b.kind === 'peach' && b.s) {
        const k = Math.min(1, t / 0.45);
        b.s.position.set(b.x, b.y - Math.round(4 * (1 - (1 - k) * (1 - k))));
        b.s.alpha = 1 - k;
        // 回血光点：桃粉、葱黄、灵光，一粒粒往上飘（普通混合，浅色地面上也看得出颜色），夹几粒发光的
        if (b.own && t < 0.7 && Math.random() < 0.9) {
          const ox = (Math.random() - 0.5) * 11;
          this.sparks.emit(b.x + ox, b.y - 3 - Math.random() * 7, 1, [0xd47aa0, 0xd47aa0, 0x6fa35a, 0xb8d67a], [2, 6], [0.8, 1.3], { up: 20 + Math.random() * 12, drag: 1.1 });
          if (Math.random() < 0.35) this.glows.emit(b.x + ox, b.y - 6, 1, [0xffe9a8, 0xf7dc7a], [2, 5], [0.6, 1], { up: 26, drag: 1.1 });
        }
        if (b.own && t < dt * 1.5) this.sparks.emit(b.x, b.y - 6, 8, [0xd47aa0, 0xb8d67a, 0xffe9a8], [10, 26], [0.45, 0.8], { up: 16, drag: 2.5 });
      } else if (b.kind === 'magnet' && b.s) {
        // 0–0.12 先亮一下（符被点着），0.12–0.75 从下往上烧完；纸灰与火星往上飘
        if (t < 0.12) b.s.tint = 0xfff4d0;
        else {
          b.s.tint = 0xffffff;
          const k = Math.min(1, (t - 0.12) / 0.63);
          const fi = Math.min(8, Math.floor(k * 9));
          b.s.texture = this.burn[Math.floor(t * 14) % 3][fi];
          b.s.alpha = k >= 1 ? Math.max(0, 1 - (t - 0.75) / 0.2) : 1;
          b.ash -= dt;
          if (b.own && b.ash <= 0 && k < 1) {
            b.ash = 0.03;
            const h = 18 * (1 - k);
            this.sparks.emit(b.x + (Math.random() - 0.5) * 7, b.y - 6 - h, 1, [0xf2814a, 0xf7dc7a, 0xd9452b], [4, 12], [0.3, 0.55], { up: 20, drag: 2 });
            this.sparks.emit(b.x + (Math.random() - 0.5) * 8, b.y - 6 - h, 1, [0x6b5a62, 0x9a8a86, 0x4a3b4a, 0x2e2433], [2, 7], [0.7, 1.2], { up: 9, drag: 1.5 });
          }
        }
      }
      if (t >= b.life) {
        this.endBurst(b);
        this.bursts.splice(i, 1);
      }
    }
    if (chests.length) {
      R.end();
      R.sprite.visible = anyRays;
    } else R.sprite.visible = false;
  }

  /** 宝匣射出的光：几道一像素的光线从匣口往上射出（由短到长），停一会儿，再从根部往外收掉。 */
  private drawRays(b: Burst) {
    const P = this.rays.pix;
    const ox = b.x;
    const oy = b.y - 10;
    let any = false;
    for (const r of b.rays) {
      const k = b.t - r.delay;
      if (k <= 0) continue;
      const grow = Math.min(1, k / 0.16);
      const fade = Math.max(0, (k - 0.55) / 0.55); // 0 → 1：从根部往外收
      if (fade >= 1) continue;
      const L = r.len * (1 - (1 - grow) * (1 - grow));
      const s0 = 3 + L * fade;
      const dx = Math.cos(r.a);
      const dy = Math.sin(r.a);
      for (let s = s0; s <= L + 3; s += 0.5) {
        const u = (s - 3) / Math.max(1, r.len);
        const col = u < 0.35 ? C('W') : u < 0.62 ? C('f') : u < 0.86 ? C('Y') : C('y');
        P.set(Math.round(ox + dx * s), Math.round(oy + dy * s), col);
        any = true;
      }
    }
    return any;
  }
}

/**
 * 奖励文字：像素体 12px（用户：所有的字都要是像素体）。用四份错开一像素的深色字叠出一圈硬描边，
 * 不用画布的描边（会糊）；最近邻采样、整数对齐。以后换成共用的像素字。
 */
function rewardLabel(s: string): Container {
  // 共用的像素字（src/render/pixel-text.ts）：缃黄字、乌色描边，底边居中对齐
  const c = new Container();
  const t = new Sprite(pixelTextTexture(s, { color: 'Y', outline: 'd', outline8: false }));
  c.addChild(t);
  c.pivot.set(Math.round(t.width / 2), Math.round(t.height));
  return c;
}

/** 星光闪在掉落物的哪些位置（相对锚点）。 */
const TWINKLE_SPOTS: Record<DropKind, [number, number][]> = {
  chest: [
    [-6, -13],
    [6, -10],
    [0, -6],
  ],
  peach: [
    [-3, -10],
    [2, -13],
  ],
  magnet: [
    [-3, -16],
    [3, -8],
  ],
};
