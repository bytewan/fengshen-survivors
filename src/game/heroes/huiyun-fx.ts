// 回响云霄（回响化身）的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件和 Player.scrolls / formation。
// - 乾坤图：一卷月白的绢从她身前朝那个方向铺开（0.15 秒铺到头，前头是靛色的轴），绢上一道道黛色的卦纹；卷在图上的敌人身上缠一道绢；
//   仙品「镇山」裹够了，一座小小的山影（麒麟崖）从上面压下来，尘土一震；器灵「麒麟崖」压下来的是一座大一些的山影，压在整卷图的当中。
//   绢只画到判定的六成宽（效果不超过判定）；出现、收起都有过程。
// - 黄河阵 · 削顶：地上一圈九道浑黄的水纹（九曲），慢慢转；阵里的敌人头顶飘起三点淡淡的花影、散掉（削去顶上三花），不画圆圈。
// - 被动「截教」：身边定住的越多，袖口越常飘起一点天青的剑气碎光。
// 用户口径：不要光圈；效果不超过判定；出现和消失都有过程。声音先借现有的（docs/audio.md 的借用规则）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, outline } from '../../art/pixel.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, Pixels, rnd } from '../fx.ts';
import { jiejiao } from '../../sim/heroes/passives.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const DUST = [0x4f5652, 0x6d756c, 0x8f9787, 0x3e4855];
/** 麒麟崖的山影（小的 11×8；大的 17×11）：黛、乌的山石，受光一侧苍色，山脚一缕天青的雾。 */
const CRAG = outline(grid(['....hg.....', '...hggg....', '..hgggdg...', '.hggdgddg..', 'hggddgdddg.', 'ggdddddddgg', '.cCcddddcc.', '..cc.cc....']), 'k');
const CRAG_BIG = outline(
  grid([
    '.......hg........',
    '......hggg.......',
    '.....hgggdg..hg..',
    '....hggdgddghggg.',
    '...hggddgdddggdg.',
    '..hggdddddddgddgg',
    '.hggdddddddddddgg',
    'hggddddddddddddddg',
    'ggdddddddddddddgg',
    '.cCcdddddddddcCc.',
    '..ccc.ccc.ccc....',
  ].map((r) => r.slice(0, 17))),
  'k',
);
const RIVER = [0xb06a28, 0xa48e6d, 0xb39e7d, 0xf2e8d5];

interface ScrollView {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hw: number;
  ids: number[];
  t: number;
  wrap: number;
  out: number; // > 0：收起（剩多少秒）
}
interface Press {
  s: Sprite;
  x: number;
  y: number;
  t: number;
}
interface FormationView {
  owner: number;
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  seen: Set<number>;
}

export class HuiyunFx {
  private scrolls: ScrollView[] = [];
  private presses: Press[] = [];
  private forms: FormationView[] = [];
  private floor = new Pixels();
  private top = new Pixels();
  private layer = new Container();
  private cragTex: Texture;
  private cragBigTex: Texture;
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;
  private glint = new Map<number, number>();

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.floor.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
    this.cragTex = textureFromGrid(CRAG);
    this.cragBigTex = textureFromGrid(CRAG_BIG);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  clear() {
    this.scrolls = [];
    for (const p of this.presses) p.s.destroy();
    this.presses = [];
    this.forms = [];
    this.floor.flush();
    this.top.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'scroll':
        this.scrolls.push({ id: e.id, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, hw: e.hw, ids: e.ids, t: 0, wrap: e.wrap, out: 0 });
        this.play('qiankuntu.unroll', 'yinyang.beam', 0.5);
        break;
      case 'scrollPress': {
        const sv = this.scrolls.find((s) => s.id === e.id);
        if (e.big && sv) {
          const s = new Sprite(this.cragBigTex);
          s.anchor.set(0.5, 1);
          this.layer.addChild(s);
          this.presses.push({ s, x: (sv.x0 + sv.x1) / 2, y: (sv.y0 + sv.y1) / 2 + 4, t: 0 });
        } else
          for (const id of e.ids) {
            const en = w.enemies.find((x) => x.id === id);
            if (!en) continue;
            const s = new Sprite(this.cragTex);
            s.anchor.set(0.5, 1);
            this.layer.addChild(s);
            this.presses.push({ s, x: en.x, y: en.y + 2, t: 0 });
          }
        if (sv) sv.out = 0.45;
        this.shake.add(e.big ? 0.35 : 0.15);
        this.play('qiankuntu.press', 'fantian.land', e.big ? 0.8 : 0.5);
        break;
      }
      case 'formation':
        this.forms = this.forms.filter((f) => f.owner !== e.owner);
        this.forms.push({ owner: e.owner, x: e.x, y: e.y, r: e.r, t: 0, dur: e.dur, seen: new Set() });
        this.play('xueding.cast', 'xuanyuan.vortex', 0.6);
        break;
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const F = this.floor;
    const T = this.top;
    // ---- 乾坤图 ----
    for (let i = this.scrolls.length - 1; i >= 0; i--) {
      const s = this.scrolls[i];
      s.t += dt;
      if (s.out <= 0 && s.t >= s.wrap) s.out = 0.45; // 不到仙品：裹够了就收起
      if (s.out > 0) s.out -= dt;
      if (s.out < 0 || (s.out <= 0 && s.t > s.wrap + 0.5)) {
        this.scrolls.splice(i, 1);
        continue;
      }
      const a = s.out > 0 ? clamp01(s.out / 0.45) : Math.min(1, s.t / 0.1);
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
      const ux = (s.x1 - s.x0) / len;
      const uy = (s.y1 - s.y0) / len;
      const nx = -uy;
      const ny = ux;
      const head = len * Math.min(1, s.t / 0.15);
      const half = Math.max(2, s.hw * 0.6);
      for (let d = 0; d <= head; d += 1) {
        const cx = s.x0 + ux * d;
        const cy = s.y0 + uy * d;
        for (let o = -half; o <= half; o += 1) {
          const edge = Math.abs(o) > half - 1.2;
          // 卦纹：每 12 像素三道短横
          const ink = d % 12 < 6 && Math.abs(o) < half * 0.55 && (d % 12) % 2 === 0;
          F.dot(cx + nx * o, cy + ny * o, ink ? C.g : edge ? C.j : C.w, a * (edge ? 0.55 : 0.7));
        }
      }
      // 前头的轴：靛色的一截
      for (let o = -half - 1; o <= half + 1; o += 1) T.dot(s.x0 + ux * head + nx * o, s.y0 + uy * head + ny * o, o % 2 ? C.N : C.n, a);
      // 裹住的敌人：身上缠一道绢
      if (s.out <= 0)
        for (const id of s.ids) {
          const en = w.enemies.find((x) => x.id === id && x.hp > 0);
          if (!en) continue;
          const ex = Math.round(en.px + (en.x - en.px) * alpha);
          const ey = Math.round(en.py + (en.y - en.py) * alpha) - 7;
          for (let u = -4; u <= 4; u++) {
            T.dot(ex + u, ey + Math.round(u * 0.25), u % 3 ? C.w : C.j, 0.9 * a);
            T.dot(ex + u, ey + 3 + Math.round(-u * 0.2), u % 3 ? C.j : C.g, 0.75 * a);
          }
        }
    }
    // 镇山：山影从上面压下来（0.12 秒），尘土一震，停一会儿淡掉
    for (let i = this.presses.length - 1; i >= 0; i--) {
      const p = this.presses[i];
      p.t += dt;
      const k = p.t / 0.12;
      const y = p.y - 28 * (1 - Math.min(1, k));
      p.s.position.set(Math.round(p.x), Math.round(y));
      p.s.alpha = p.t < 0.06 ? p.t / 0.06 : 1 - clamp01((p.t - 0.45) / 0.35);
      if (k >= 1 && k - dt / 0.12 < 1) {
        for (let n = 0; n < 8; n++) {
          const a = (n / 8) * Math.PI * 2;
          this.sparks.emit(p.x + Math.cos(a) * 3, p.y + Math.sin(a) * 2, 1, DUST, [22, 40], [0.3, 0.5], { dir: a, spread: 0.4, drag: 5 });
        }
      }
      if (p.t >= 0.8) {
        p.s.destroy();
        this.presses.splice(i, 1);
      }
    }
    // ---- 黄河阵 · 削顶 ----
    for (let i = this.forms.length - 1; i >= 0; i--) {
      const f = this.forms[i];
      f.t += dt;
      if (f.t >= f.dur) {
        this.forms.splice(i, 1);
        continue;
      }
      const a = Math.min(1, f.t / 0.3) * Math.min(1, (f.dur - f.t) / 0.4);
      // 九道浑黄的水纹，沿着阵边慢慢转（断开的弧，不成圈）
      const rot = this.time * 0.35;
      for (let k = 0; k < 9; k++) {
        const a0 = rot + (k / 9) * Math.PI * 2;
        for (let u = 0; u < 0.42; u += 0.03) {
          const ang = a0 + u;
          const rr = f.r * (0.94 + 0.05 * Math.sin(u * 15 + k));
          const c = RIVER[(k + Math.floor(u * 10)) % 3];
          F.dot(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr * 0.62, c, a * 0.85);
          F.dot(f.x + Math.cos(ang) * (rr - 1), f.y + Math.sin(ang) * (rr - 1) * 0.62, c, a * 0.6);
          if (u > 0.3) F.dot(f.x + Math.cos(ang) * (rr - 3), f.y + Math.sin(ang) * (rr - 3) * 0.62, RIVER[3], a * 0.6); // 浪头一点月白
        }
      }
      // 阵里三道往中心卷的浅水纹（九曲黄河，慢慢转）
      for (let arm = 0; arm < 3; arm++)
        for (let u = 0.15; u < 0.85; u += 0.02) {
          const ang = rot * 1.6 + arm * ((Math.PI * 2) / 3) + u * 2.6;
          const rr = f.r * (1 - u) * 0.85;
          F.dot(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr * 0.62, RIVER[1], a * 0.35 * (1 - u));
        }
      // 阵里的敌人：头顶三点花影飘起、散掉（每只只飘一次）
      for (const en of w.enemies) {
        if (en.hp <= 0 || f.seen.has(en.id) || (en.x - f.x) ** 2 + ((en.y - f.y) / 0.62) ** 2 > f.r * f.r) continue;
        f.seen.add(en.id);
        const head = en.kind === 'boss' ? 34 : en.kind === 'elite' ? 30 : 22;
        for (let k = 0; k < 3; k++) this.sparks.emit(en.x + (k - 1) * 3, en.y - head, 1, [C.m, C.Y, C.w], [3, 6], [0.6, 0.9], { up: 10, drag: 2 });
      }
    }
    // ---- 被动「截教」：袖口飘起一点天青的剑气碎光 ----
    for (const p of w.players) {
      if (p.hero !== 'huiyun' || !p.alive) continue;
      const b = jiejiao(w, p);
      if (b <= 0) continue;
      let t = (this.glint.get(p.id) ?? 0) - dt;
      if (t <= 0) {
        t = 0.5 - b;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.sparks.emit(p.x + side * rnd(4, 7), p.y - rnd(10, 16), 1, [C.Cc, C.w], [4, 10], [0.3, 0.5], { up: 12, drag: 2.5 });
      }
      this.glint.set(p.id, t);
    }
    F.flush();
    T.flush();
  }
}
