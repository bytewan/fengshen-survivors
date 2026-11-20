// 魔化哪吒（回响化身）的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件和 Player.wheels / Player.dash。
// - 黑焰轮：和第一章首领满场滚的风火轮同一套精灵（暗赭铜轮、殷红轮毂、八条卷曲的黑焰；约 23 像素，轮身 12），贴地滚、按滚过的路转，
//   身后拖一串往上飘散的黑焰（紫棠、乌、殷红芯）；仙品掉头时轮子一顿、溅几粒火星；散掉时不是一下没了，原地淡下去、冒一缕烟。
//   器灵「红莲」：最远处炸开一朵红莲业火——八片花瓣状的火舌贴地翻开再落下（只是几片瓣和火星，不画圆圈，不超过判定半径）。
// - 神通「火尖枪突进」：蓄力时地上从脚下往前「烧」出一道暗红的线（一粒粒余烬沿线亮起来，推到尽头正好冲出去），人物端枪；
//   冲的时候身后拖几道殷红的残影；冲过的那条线留着一道焦痕、上面冒着小小的黑焰，慢慢熄掉。
// - 被动「业火」：气血越低，身上越常冒出一缕缕往上飘的黑焰（不成圈、不罩住人）。
// 用户口径：不要光圈；效果不超过判定；出现和消失都有过程。声音先借现有的（docs/audio.md 的借用规则；有了自己的素材就换名字）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { DEMON_WHEEL } from '../../art/sprites/demon-nezha.ts';
import { grid, type Grid } from '../../art/pixel.ts';
import { heroFrames, HERO_VIEWS } from '../hero-views.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, Pixels, rnd } from '../fx.ts';
import { yehuoBonus } from '../../sim/heroes/passives.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 黑焰的颜色（焰梢玄黑、焰身紫棠、焰心殷红 / 朱砂）。 */
const BLACK_FLAME = [C.d, C.P, C.P, C.R, C.g];
const EMBERS = [C.R, C.r, C.e];
/** 轮子的中心离地多高（轮身半径约 6 像素，贴着地滚）。 */
const LIFT = 6;
/** 残影：冲出去那个姿势（人物帧 throw）的剪影，整个人压成一色朱红（不是给精灵染色：染出来是浑浊的褐色）。 */
const ghostOf = (g: Grid): Grid => grid(g.rows.map((r) => r.replace(/[^.]/g, 'R')));

interface WheelView {
  s: Sprite;
  owner: number;
  id: number;
  roll: number; // 累计滚过的路（换帧用）
  fade: number; // > 0：轮子已经没了，原地淡下去（剩多少秒）
  trail: number; // 距下一粒黑焰
  x: number;
  y: number;
}
interface Line {
  owner: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  windup: number; // 蓄力多久（线从脚下往前烧过去的时间）
  dash: number; // 冲出去之后过了多久（-1 = 还在蓄力）
  life: number; // 焦痕烧多久
  ghosts: number; // 还要留几道残影
}
interface Ghost {
  s: Sprite;
  t: number;
}

export interface HeiyanFxOpts {
  /** 第 i 个人物的精灵（残影照着它的这一帧画）。 */
  sprite: (owner: number) => Sprite | undefined;
}

export class HeiyanFx {
  private wheels = new Map<number, WheelView>();
  private lines: Line[] = [];
  private ghosts: Ghost[] = [];
  private floor = new Pixels();
  private layer = new Container();
  private tex: Texture[];
  private ghostTex: Texture[] | null = null;
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private opts: HeiyanFxOpts;
  private wisp = new Map<number, number>();
  private time = 0;

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx, opts: HeiyanFxOpts) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    this.opts = opts;
    this.tex = DEMON_WHEEL.map(textureFromGrid);
    stage.floor.addChild(this.floor.g);
    stage.entities.addChild(this.layer);
    this.layer.sortableChildren = false;
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    for (const v of this.wheels.values()) v.s.destroy();
    this.wheels.clear();
    this.lines = [];
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
    this.floor.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'wheel': {
        if (!this.wheels.has(e.id)) this.wheels.set(e.id, this.make(e.owner, e.id, e.x, e.y));
        // 一次几只一起滚出去：只响一声
        if (e.id === Math.min(...(w.players[e.owner]?.wheels ?? []).map((x) => x.id), e.id)) this.play('heiyan.roll', 'boss.wheel', 0.45);
        this.sparks.emit(e.x, e.y - 2, 2, EMBERS, [10, 30], [0.2, 0.4], { dir: Math.atan2(e.uy, e.ux), spread: 0.8, up: 8, drag: 3 });
        break;
      }
      case 'wheelTurn':
        // 掉头：一顿，溅几粒火星
        this.sparks.emit(e.x, e.y - LIFT, 4, EMBERS, [15, 40], [0.2, 0.45], { up: 12, drag: 3 });
        break;
      case 'wheelBurst':
        this.lotus(e.x, e.y, e.r);
        this.play('heiyan.lotus', 'jiulong.burst', 0.55);
        break;
      case 'skill': {
        if (e.kind !== 'tujin') break;
        const d = w.players[e.owner]?.dash;
        if (!d) break;
        this.lines = this.lines.filter((l) => l.owner !== e.owner);
        this.lines.push({ owner: e.owner, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, t: 0, windup: e.dur ?? d.windup, dash: -1, life: 2.4, ghosts: 0 });
        this.play('tujin.charge', 'boss.dash.charge', 0.7);
        break;
      }
      case 'tujin': {
        let l = this.lines.find((v) => v.owner === e.owner);
        if (!l) {
          // 没看到蓄力的那一下（联机晚到）：直接从冲出去画
          l = { owner: e.owner, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, t: 0, windup: 0, dash: -1, life: e.life, ghosts: 0 };
          this.lines.push(l);
        }
        l.dash = 0;
        l.life = e.life;
        l.ghosts = 3;
        this.play('tujin.dash', 'boss.dash', 0.8);
        this.shake.add(0.3);
        break;
      }
    }
  }

  private make(owner: number, id: number, x: number, y: number): WheelView {
    const s = new Sprite(this.tex[0]);
    s.anchor.set(0.5);
    s.position.set(Math.round(x), Math.round(y - LIFT));
    s.alpha = 0;
    this.layer.addChild(s);
    return { s, owner, id, roll: 0, fade: 0, trail: 0, x, y };
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.updateWheels(dt, w, alpha);
    this.updateLines(dt, w);
    this.updateGhosts(dt);
    this.updateWisps(dt, w);
  }

  // ---------- 黑焰轮 ----------

  private updateWheels(dt: number, w: World, alpha: number) {
    const live = new Set<number>();
    for (const p of w.players) {
      if (!p.wheels) continue;
      for (const wh of p.wheels) {
        live.add(wh.id);
        let v = this.wheels.get(wh.id);
        if (!v) {
          v = this.make(p.id, wh.id, wh.x, wh.y);
          this.wheels.set(wh.id, v);
        }
        const x = wh.px + (wh.x - wh.px) * alpha;
        const y = wh.py + (wh.y - wh.py) * alpha;
        const moved = Math.hypot(x - v.x, y - v.y);
        // 往右滚顺时针、往左滚逆时针（四帧转过 45°）
        v.roll += moved * (x >= v.x ? 1 : -1);
        v.x = x;
        v.y = y;
        const f = ((Math.floor(v.roll / 2.2) % 4) + 4) % 4;
        v.s.texture = this.tex[f];
        v.s.position.set(Math.round(x), Math.round(y - LIFT));
        v.s.zIndex = Math.round(y);
        v.s.alpha = Math.min(1, v.s.alpha + dt / 0.12); // 从脚下滚出来时不是一下冒出来
        v.fade = 0;
        // 身后拖一串黑焰
        v.trail -= dt;
        while (v.trail <= 0) {
          v.trail += 0.035;
          this.sparks.emit(x + rnd(-2, 2), y - rnd(1, 4), 1, BLACK_FLAME, [3, 10], [0.25, 0.5], { up: 18, drag: 2.5 });
        }
      }
    }
    for (const [id, v] of this.wheels) {
      if (live.has(id)) continue;
      // 没了：原地淡下去，冒一缕烟
      if (v.fade <= 0) {
        v.fade = 0.22;
        this.sparks.emit(v.x, v.y - LIFT, 4, [C.d, C.g, C.P], [4, 14], [0.3, 0.55], { up: 16, drag: 2 });
      }
      v.fade -= dt;
      v.s.alpha = clamp01(v.fade / 0.22);
      if (v.fade <= 0) {
        v.s.destroy();
        this.wheels.delete(id);
      }
    }
  }

  /** 器灵「红莲」：八片火舌像花瓣一样贴地翻开、再落下，外头几粒火星；不画圆圈，不超出半径。 */
  private lotus(x: number, y: number, r: number) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rnd(-0.1, 0.1);
      // 一片瓣：从中心往外一串火粒，越往外越暗
      for (let i = 0; i < 5; i++) {
        const d = r * (0.2 + i * 0.16);
        this.sparks.emit(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.62, 1, i < 2 ? [C.e, C.o] : i < 4 ? [C.r, C.R] : [C.P, C.d], [2, 8], [0.35 + i * 0.06, 0.6 + i * 0.06], { up: 6 + i * 3, drag: 3 });
      }
    }
    this.sparks.emit(x, y - 4, 10, BLACK_FLAME, [8, 22], [0.4, 0.8], { up: 24, drag: 2.2 });
    this.shake.add(0.12);
  }

  // ---------- 火尖枪突进 ----------

  private updateLines(dt: number, w: World) {
    const F = this.floor;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t += dt;
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1;
      const ux = (l.x1 - l.x0) / len;
      const uy = (l.y1 - l.y0) / len;
      const nx = -uy;
      const ny = ux;
      if (l.dash < 0) {
        // 蓄力：线从脚下往前烧过去（一道暗红的余烬线亮起来，最前头一粒朱砂），推到尽头正好冲出去
        const k = clamp01(l.t / Math.max(0.05, l.windup));
        const reach = len * k;
        for (let s = 0; s <= reach; s += 1) {
          const flick = 0.75 + 0.25 * Math.sin(this.time * 20 + s * 0.6);
          const a = (0.3 + 0.35 * k) * flick * (0.55 + 0.45 * (s / Math.max(1, reach)));
          F.dot(l.x0 + ux * s, l.y0 + uy * s, C.R, a);
          F.dot(l.x0 + ux * s + nx, l.y0 + uy * s + ny, C.R, a * 0.55);
          F.dot(l.x0 + ux * s - nx, l.y0 + uy * s - ny, C.r, a * 0.4);
        }
        F.dot(l.x0 + ux * reach, l.y0 + uy * reach, C.e, 0.9);
        F.dot(l.x0 + ux * (reach - 1), l.y0 + uy * (reach - 1), C.r, 0.8);
        if (Math.random() < 0.7) {
          const s = reach * (0.6 + Math.random() * 0.4);
          this.sparks.emit(l.x0 + ux * s, l.y0 + uy * s, 1, EMBERS, [2, 6], [0.2, 0.4], { up: 10, drag: 3 });
        }
        if (l.t > l.windup + 0.6) this.lines.splice(i, 1); // 没等到冲出去（被打断、换波）
        continue;
      }
      l.dash += dt;
      // 冲的时候：身后每隔一段留一道殷红的残影（照着人物这一帧的剪影，很快淡掉）
      if (l.ghosts > 0 && l.dash < 0.45) {
        const src = this.opts.sprite(l.owner);
        const at = src ? Math.hypot(src.x - l.x0, src.y - l.y0) : 0;
        if (src && at >= (4 - l.ghosts) * (len / 4)) {
          l.ghosts--;
          this.ghostTex ??= heroFrames('mozha').throw.map((g) => textureFromGrid(ghostOf(g)));
          const v = HERO_VIEWS.mozha;
          const g = new Sprite(this.ghostTex[l.ghosts % this.ghostTex.length]);
          g.anchor.set(v.anchor.x / v.w, v.anchor.y / v.h);
          g.scale.copyFrom(src.scale);
          g.position.copyFrom(src.position);
          g.zIndex = src.zIndex - 1;
          g.alpha = 0.5;
          this.stage.entities.addChild(g);
          this.ghosts.push({ s: g, t: 0 });
        }
      }
      // 冲过的那条线：一道焦痕，上面冒着小小的黑焰，慢慢熄掉
      const k = clamp01(l.dash / l.life);
      const fade = 1 - k * k;
      for (let s = 0; s <= len; s += 1) {
        const flick = 0.6 + 0.4 * Math.sin(this.time * 9 + s * 0.45);
        F.dot(l.x0 + ux * s, l.y0 + uy * s, C.k, 0.42 * fade);
        F.dot(l.x0 + ux * s + nx, l.y0 + uy * s + ny, C.R, 0.34 * fade * flick);
        F.dot(l.x0 + ux * s - nx, l.y0 + uy * s - ny, C.d, 0.3 * fade);
      }
      for (let j = 0; j < 2; j++)
        if (Math.random() < 0.8 * fade) {
          const s = Math.random() * len;
          this.sparks.emit(l.x0 + ux * s, l.y0 + uy * s - 1, 1, j ? EMBERS : BLACK_FLAME, [2, 6], [0.3, 0.6], { up: 14, drag: 2.5 });
        }
      if (l.dash >= l.life) this.lines.splice(i, 1);
    }
    F.flush();
    void w;
  }

  private updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / 0.28;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = 0.5 * (1 - k) * (1 - k);
    }
  }

  // ---------- 被动「业火」 ----------

  /** 气血越低，身上越常冒出一缕往上飘的黑焰（从衣摆、肩头冒，不成圈）。 */
  private updateWisps(dt: number, w: World) {
    for (const p of w.players) {
      if (p.hero !== 'mozha' || !p.alive) continue;
      const b = yehuoBonus(p);
      if (b <= 0.02) continue;
      let t = (this.wisp.get(p.id) ?? 0) - dt;
      if (t <= 0) {
        t = 0.32 - 0.24 * (b / 0.45);
        const side = Math.random() < 0.5 ? -1 : 1;
        this.sparks.emit(p.x + side * rnd(3, 6), p.y - rnd(6, 18), 1, BLACK_FLAME, [2, 6], [0.4, 0.7], { up: 16, drag: 2 });
      }
      this.wisp.set(p.id, t);
    }
  }
}
