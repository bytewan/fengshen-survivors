// 精英词缀的画面（模拟在 sim/elites/affixes.ts）：一眼看得出这只精英带了什么——
//   身上那一处词缀色（靠旗、头发、旗面、丝绦）在 looks.ts 里换；这里是身上的小点缀和词缀的动作：
//   迅捷：走动时脚后拖几缕天青、月白的风丝；坚甲：两肩、胸口的甲片隔一会儿闪一点金，挨打时迸几粒金屑；
//   分魂：身后叠着一个淡淡的桃红的影子，慢慢错开又合上（魂要分出来）；反震：身上偶尔窜一粒月白的静电；
//   召唤：肩头浮着一张小黄符。血条左边写一个像素字（迅 / 甲 / 魂 / 震 / 召，按词缀着色；两条就写两个字）。
//   反震蓄力：脚下以它为圆心的淡红光（跟着它走），震开时尘土、碎石往外迸到判定半径（不画圆圈、不画细裂纹）；
//   召唤：身边地上两张黄符亮起、冒墨烟，到时符烧掉、回响兵从烟里冒出来；分魂：墨紫的碎魂往四周散开，离魂从里面飘出来。
// 只读模拟状态与事件，不回写；不画光圈，出现、消失都有过程。音效先借现有的（docs/audio.md「精英」那一行）。
// 接进 feel.ts：new AffixFx(stage, sparks, glows, shake, sfx, enemyViews)；onEvents 里 onEvent(e, world)；每帧 update(dt, world, alpha, hx)；重开时 clear()。
import { Container, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { pixelTextTexture } from '../../render/pixel-text.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { grid, outline } from '../../art/pixel.ts';
import { AFFIX, AFFIXES } from '../../sim/elites/config.ts';
import { AFFIX_INFO } from '../../sim/elites/index.ts';
import type { EliteAffix } from '../../sim/elites/types.ts';
import type { Enemy, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import type { EnemyViews } from '../enemy-views.ts';
import { DiskWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';
import { ELITE_BODY, eliteLook } from './looks.ts';

/** 词缀那个字的颜色（自上而下两档，调色板字符），和身上那一处词缀色同一套（art/elites/sprites.ts 的 ACCENT）。 */
export const MARK_COLOR: Record<EliteAffix, string[]> = { swift: ['C', 'c'], armor: ['Y', 'y'], split: ['m', 'p'], recoil: ['w', 'j'], summon: ['L', 'l'] };
const C = { k: 0x1a1520, d: 0x2e2433, g: 0x4a3b4a, h: 0x6b5a62, i: 0x9a8a86, j: 0xc9bcae, w: 0xf2e8d5, W: 0xffffff, y: 0xe0a83a, Y: 0xf7dc7a, f: 0xffe9a8, o: 0xf2814a, e: 0xd9452b, m: 0xd47aa0, p: 0x8a4a7a, P: 0x4b2a4f, c: 0x3f8a9e, CC: 0x7cc4c4, N: 0x1d2b4a, n: 0x2f5373, l: 0x6fa35a, L: 0xb8d67a };
const FADE_IN = 0.35;
const FADE_OUT = 0.3;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 肩头的小黄符（4×7）、地上的黄符（平放，8×5）：藤黄的符纸、朱砂的符文、赭色描边。 */
const TALISMAN = outline(grid(['YY', 'Yo', 'oY', 'Yo', 'YY']), 'B');
const GROUND_TALISMAN = outline(grid(['YYYYYY', 'YoYooY', 'YYYYYY']), 'B');

interface Marks {
  s: Sprite[];
  t: number;
  out: number;
}
interface Body {
  ghost?: Sprite; // 分魂的影子
  charm?: Sprite; // 召唤的小黄符
  glint: number; // 坚甲：距下一点金光
  zap: number; // 反震：距下一粒静电
  wind: number; // 迅捷：距下一缕风丝
  t: number;
  hitT: number; // 坚甲：上一次迸金屑的时刻（同一只隔一会儿才迸）
}
interface Seal {
  s: Sprite;
  x: number;
  y: number;
  t: number;
  len: number;
  smoke: number;
  done: number; // 烧掉之后过了多久（-1 = 还在）
}

export class AffixFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private views: EnemyViews;
  private warns: WarnLayer;
  private air = new Container();
  private floor = new Container();
  private marks = new Map<number, Marks>();
  private bodies = new Map<number, Body>();
  private recoils = new Map<number, DiskWarn>();
  private seals: Seal[] = [];
  private markTex = new Map<EliteAffix, Texture>();
  private charmTex: Texture;
  private sealTex: Texture;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx, views: EnemyViews) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.views = views;
    this.warns = warnLayer(stage);
    warmWarnTextures({ disks: [AFFIX.recoil.r] });
    stage.floor.addChild(this.floor);
    stage.fx.addChild(this.air);
    this.charmTex = textureFromGrid(TALISMAN);
    this.sealTex = textureFromGrid(GROUND_TALISMAN);
    // 五个词缀字开局就画好：第一次带词缀的精英出来时现画（像素字要量字、画进 canvas 再读回来）会让手机顿一下（docs/perf.md）
    for (const a of AFFIXES) this.mark(a);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  private mark(a: EliteAffix): Texture {
    let t = this.markTex.get(a);
    if (!t) {
      t = pixelTextTexture(AFFIX_INFO[a].mark, { color: MARK_COLOR[a], outline: 'k' });
      this.markTex.set(a, t);
    }
    return t;
  }

  clear() {
    for (const m of this.marks.values()) for (const s of m.s) s.destroy();
    this.marks.clear();
    for (const b of this.bodies.values()) {
      b.ghost?.destroy();
      b.charm?.destroy();
    }
    this.bodies.clear();
    for (const d of this.recoils.values()) d.destroy();
    this.recoils.clear();
    for (const s of this.seals) s.s.destroy();
    this.seals = [];
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'recoilWarn': {
        this.recoils.get(e.id)?.destroy();
        this.recoils.set(e.id, new DiskWarn(this.warns, e.x, e.y, e.r));
        // 蓄力：脚下的土微微隆起、迸几粒碎石
        this.sparks.emit(e.x, e.y - 1, 5, [C.h, C.i, C.g], [10, 25], [0.3, 0.5], { up: 14, g: 80, drag: 2 });
        this.play('affix.recoil.warn', 'enemy.charge.warn', 0.5);
        break;
      }
      case 'recoil': {
        const d = this.recoils.get(e.id);
        if (d) {
          d.move(e.x, e.y);
          d.strike();
          d.end(0.35);
        }
        this.shock(e.x, e.y, e.r);
        break;
      }
      case 'eliteCallWarn':
        for (const [x, y] of e.pts) {
          const s = new Sprite(this.sealTex);
          s.anchor.set(0.5);
          s.position.set(Math.round(x), Math.round(y));
          s.alpha = 0;
          this.floor.addChild(s);
          this.seals.push({ s, x, y, t: 0, len: e.t2, smoke: 0, done: -1 });
        }
        // 肩头的小黄符往上一飘，化成灵光（下面 update 里那张符跟着淡掉）
        this.play('affix.summon.warn', 'cast', 0.55);
        break;
      case 'eliteCall': {
        // 符烧掉，回响兵从墨烟里冒出来
        for (const s of this.seals) {
          if (s.done >= 0) continue;
          s.done = 0;
          this.sparks.emit(s.x, s.y - 2, 8, [C.Y, C.o, C.e, C.f], [15, 40], [0.3, 0.5], { up: 30, drag: 2 });
          this.glows.emit(s.x, s.y - 6, 6, [C.CC, C.c], [10, 30], [0.4, 0.7], { up: 20, drag: 2 });
          this.sparks.emit(s.x, s.y - 4, 10, [C.d, C.g, C.P, C.N], [8, 26], [0.5, 0.9], { up: 22, drag: 2, scale: 2 });
        }
        this.play('affix.summon', 'enemy.split', 0.6);
        void w;
        break;
      }
      case 'affixSplit':
        // 分魂：墨紫的碎魂往四周散开（慢慢落定），中间一点月白的碎光；离魂就从这团里飘出来
        this.sparks.emit(e.x, e.y - 10, 22, [C.P, C.p, C.d], [40, 110], [0.45, 0.9], { up: 16, drag: 3 });
        this.sparks.emit(e.x, e.y - 10, 6, [C.w, C.m], [20, 60], [0.3, 0.55], { drag: 4 });
        this.glows.emit(e.x, e.y - 10, 8, [C.p, C.CC], [15, 45], [0.4, 0.7], { up: 12, drag: 3 });
        this.shake.add(0.2);
        this.play('affix.split', 'jie.split', 0.8); // 劫数那边给「分裂」做的声音（撕开似的鬼声），分魂正好用
        break;
      case 'hit': {
        // 坚甲：挨打的那一下迸几粒金屑（同一只隔 0.25 秒）
        if (e.kind !== 'elite' || e.by === 'burn' || e.by === 'bleed' || e.by === 'zone') break;
        const o = w.enemies.find((x) => x.id === e.id);
        if (!o?.affixes?.includes('armor')) break;
        const b = this.bodies.get(e.id);
        if (b && this.time - b.hitT < 0.25) break;
        if (b) b.hitT = this.time;
        const at = ELITE_BODY[o.elite ?? 'xiaowei'].chest;
        this.sparks.emit(e.x + at[0], e.y + at[1], 3, [C.Y, C.y, C.f], [25, 55], [0.15, 0.3], { drag: 4 });
        break;
      }
    }
  }

  /** 反震震开：一圈尘土、碎石从脚下往外迸到判定半径（带阻尼的粒子大约飞出 速度 / 阻尼 那么远），几粒月白的碎光，震屏。 */
  private shock(x: number, y: number, r: number) {
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      this.sparks.emit(x + Math.cos(a) * 4, y + Math.sin(a) * 3, 1, [C.h, C.i, C.j, C.g], [r * 3, r * 4], [0.3, 0.5], { dir: a, spread: 0.15, drag: 4, up: 8 });
    }
    for (let k = 0; k < 6; k++) this.sparks.emit(x, y - 2, 1, [C.g, C.h], [30, 70], [0.4, 0.6], { up: 40, g: 160, drag: 1, scale: 2 });
    this.glows.emit(x, y - 4, 8, [C.w, C.W, C.j], [20, 60], [0.15, 0.3], { drag: 4 });
    this.shake.add(0.18);
    this.play('affix.recoil', 'fantian.land', 0.6);
  }

  update(dt: number, w: World, alpha: number, hx: number) {
    this.time += dt;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.kind !== 'elite' || e.hp <= 0 || !e.affixes?.length) continue;
      seen.add(e.id);
      const x = Math.round(lerp(e.px, e.x));
      const y = Math.round(lerp(e.py, e.y));
      this.drawMarks(dt, e, x, y);
      this.drawBody(dt, e, x, y, hx);
      // 反震蓄力：淡红光跟着它走
      const d = this.recoils.get(e.id);
      if (d && !d.struck) {
        if (!e.recoilT || e.recoilT <= 0) d.end(0.25);
        d.move(x, y);
        d.draw(dt, clamp01(1 - (e.recoilT ?? 0) / AFFIX.recoil.warn));
      }
    }
    // 没了的（死了、被收走）：字淡掉、身上的点缀撤掉
    for (const [id, m] of this.marks) {
      if (seen.has(id)) continue;
      if (m.out < 0) m.out = m.t;
      m.t += dt;
      const k = 1 - (m.t - m.out) / FADE_OUT;
      if (k <= 0) {
        for (const s of m.s) s.destroy();
        this.marks.delete(id);
      } else for (const s of m.s) s.alpha = Math.min(s.alpha, k);
    }
    for (const [id, b] of this.bodies) {
      if (seen.has(id)) continue;
      b.ghost?.destroy();
      b.charm?.destroy();
      this.bodies.delete(id);
    }
    for (const [id, d] of this.recoils) {
      if (!seen.has(id) && !d.struck) d.end(0.25);
      if (d.struck) d.draw(dt, 1);
      else if (!seen.has(id)) d.draw(dt, 1);
      if (d.done) {
        d.destroy();
        this.recoils.delete(id);
      }
    }
    this.updateSeals(dt);
  }

  /** 血条左边的字（贴着血条、空一个像素；两条词缀就往左再写一个），刷出来时慢慢浮现。 */
  private drawMarks(dt: number, e: Enemy, x: number, y: number) {
    let m = this.marks.get(e.id);
    if (!m) {
      m = { s: e.affixes!.map((a) => {
        const s = new Sprite(this.mark(a));
        s.anchor.set(1, 0.5);
        s.alpha = 0;
        this.stage.fx.addChild(s);
        return s;
      }), t: 0, out: -1 };
      this.marks.set(e.id, m);
    }
    m.t += dt;
    const bar = eliteLook(e).bar ?? 40;
    let right = x - 13;
    for (const s of m.s) {
      s.position.set(right, y - bar + 1);
      s.alpha = Math.min(1, m.t / FADE_IN) * (e.hidden ? 0 : 1);
      right -= s.width + 1;
    }
  }

  /** 身上的小点缀（按它带的每一条词缀）。 */
  private drawBody(dt: number, e: Enemy, x: number, y: number, hx: number) {
    let b = this.bodies.get(e.id);
    if (!b) {
      b = { glint: Math.random() * 0.6, zap: Math.random(), wind: 0, t: 0, hitT: -1 };
      this.bodies.set(e.id, b);
    }
    b.t += dt;
    const look = eliteLook(e);
    const dir = look.facing(e, hx);
    const P = ELITE_BODY[e.elite ?? 'xiaowei'];
    const at = (p: [number, number]): [number, number] => [x + dir * p[0], y + p[1]];
    const hidden = !!e.hidden;
    const has = (a: EliteAffix) => e.affixes!.includes(a);
    // 迅捷：走动时脚后拖风丝
    if (has('swift') && !hidden) {
      const sp = Math.hypot(e.x - e.px, e.y - e.py);
      b.wind -= dt;
      if (sp > 0.15 && b.wind <= 0) {
        b.wind = 0.06;
        const back = Math.atan2(e.py - e.y, e.px - e.x);
        this.glows.emit(x - (e.x - e.px) * 3 + (Math.random() - 0.5) * 6, y - 2 - Math.random() * 6, 1, [C.CC, C.w], [20, 45], [0.2, 0.35], { dir: back, spread: 0.25, drag: 2 });
      }
    }
    // 坚甲：两肩、胸口的甲片隔一会儿闪一点金
    if (has('armor') && !hidden) {
      b.glint -= dt;
      if (b.glint <= 0) {
        b.glint = 0.45 + Math.random() * 0.4;
        const pts = [...P.shoulders, P.chest];
        const [gx, gy] = at(pts[Math.floor(Math.random() * pts.length)]);
        this.glows.emit(gx, gy, 1, [C.Y, C.f], [0, 3], [0.3, 0.45], { drag: 4 });
      }
    }
    // 反震：身上偶尔窜一粒月白的静电
    if (has('recoil') && !hidden) {
      b.zap -= dt;
      if (b.zap <= 0) {
        b.zap = 0.3 + Math.random() * 0.5;
        const [zx, zy] = at([(Math.random() - 0.5) * 12, -6 - Math.random() * 18]);
        this.glows.emit(zx, zy, 2, [C.w, C.W, C.j], [15, 35], [0.08, 0.16], { drag: 5 });
      }
    }
    // 分魂：身后叠一个淡淡的桃红的影子，慢慢错开又合上
    if (has('split')) {
      const clock = this.views.clock(e.id);
      if (!b.ghost && clock) {
        b.ghost = new Sprite(look.frame(e, clock));
        b.ghost.tint = C.m;
        this.stage.entities.addChild(b.ghost);
      }
      if (b.ghost && clock) {
        const g = b.ghost;
        g.texture = look.frame(e, clock);
        g.anchor.set(look.anchor[0], look.anchor[1]);
        g.scale.set(dir, 1);
        const sway = Math.sin(b.t * 1.7 + e.id);
        g.position.set(Math.round(x - dir * (1.5 + sway * 1.5)), Math.round(y - 1 + Math.cos(b.t * 1.3) * 0.6));
        g.zIndex = y - 0.5;
        g.alpha = hidden ? 0 : Math.min(1, b.t / 0.4) * (0.22 + 0.1 * (sway * 0.5 + 0.5));
        g.visible = !hidden;
      }
    }
    // 召唤：肩头浮着一张小黄符；掐诀的时候它往上飘、化成灵光
    if (has('summon')) {
      if (!b.charm) {
        b.charm = new Sprite(this.charmTex);
        b.charm.anchor.set(0.5, 1);
        this.stage.entities.addChild(b.charm);
      }
      const c = b.charm;
      const [sx, sy] = at(P.shoulders[0]);
      const calling = e.call ? 1 - e.call.t / Math.max(0.01, e.call.len) : 0;
      c.position.set(Math.round(sx - dir * 3), Math.round(sy - 4 + Math.sin(b.t * 2.4) * 1.2 - calling * 10));
      c.zIndex = y + 1;
      c.alpha = hidden ? 0 : Math.min(1, b.t / 0.4) * (1 - calling);
      if (calling > 0 && Math.random() < 0.6) this.sparks.emit(c.x, c.y - 4, 1, [C.Y, C.o], [6, 18], [0.2, 0.35], { up: 20, drag: 2 });
    }
  }

  /** 地上的黄符：亮起来、冒墨烟（越到后面越浓），烧掉之后淡掉。 */
  private updateSeals(dt: number) {
    for (let i = this.seals.length - 1; i >= 0; i--) {
      const s = this.seals[i];
      s.t += dt;
      if (s.done >= 0) {
        s.done += dt;
        const k = 1 - s.done / 0.25;
        if (k <= 0) {
          s.s.destroy();
          this.seals.splice(i, 1);
          continue;
        }
        s.s.alpha = k;
        continue;
      }
      // 没烧就过了很久（被打断）：淡掉
      if (s.t > s.len + 0.6) s.done = 0;
      const k = clamp01(s.t / s.len);
      s.s.alpha = Math.min(1, s.t / 0.15);
      s.s.tint = Math.sin(s.t * 14) > 0.3 ? 0xffffff : 0xffe9a8;
      s.smoke -= dt;
      if (s.smoke <= 0) {
        s.smoke = 0.12 - 0.07 * k;
        this.sparks.emit(s.x + (Math.random() - 0.5) * 6, s.y - 1, 1, [C.d, C.g, C.P], [4, 12], [0.5, 0.8], { up: 14, drag: 1, scale: Math.random() < 0.4 ? 2 : 1 });
      }
    }
  }
}
