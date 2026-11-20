// 各章精英的招式画面（模拟在 sim/elites/）：东海夜叉潜水、水下游走、冒出水面、拍浪；金光力士的金光；截教剑侍绕身的三柄剑与射出去的剑。
// 词缀的画面（身上的点缀、血条左边的字、反震、召唤、分魂）在同目录的 affix-fx.ts。
// 读模拟事件（EliteEvent）+ 世界状态（敌人身上的 act / hidden / aegis / blades / spin、w.orbs 里 kind 'blade' 的剑），接口同 enemy-fx.ts：
// onEvent / update / clear。预警一律是地上的淡红光（warn-fx.ts，形状就是判定范围）；不画光圈，出现、消失都有过程。
// 音效先借现有的（名字表 docs/audio.md「精英」那一行；有素材了就自动用新名字）。
// 接进 feel.ts：const eliteFx = new EliteFx(stage, particles, glowParticles, shake, sfx)；onEvents 里 eliteFx.onEvent(e, world)；
// 每帧 eliteFx.update(vdt, world, alpha)；重开 / 一波开始或结束时 eliteFx.clear()。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { grid, outline } from '../../art/pixel.ts';
import { BLADE_FRAMES, accentize, bladeDir, type AccentKey } from '../../art/elites/sprites.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { ELITES } from '../../sim/elites/config.ts';
import { bladeSpot, nextBlade } from '../../sim/elites/jianshi.ts';
import { aegisLeft } from '../../sim/elites/lishi.ts';
import type { Enemy, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { DiskWarn, LaneWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';
import { ELITE_BODY, accentOf, eliteLook } from './looks.ts';
import { foeLooks, type FoeViewKind } from '../enemy-views.ts';

/** 调色板里的颜色（十六进制）。 */
const C = { k: 0x1a1520, N: 0x1d2b4a, n: 0x2f5373, c: 0x3f8a9e, CC: 0x7cc4c4, w: 0xf2e8d5, W: 0xffffff, j: 0xc9bcae, i: 0x9a8a86, y: 0xe0a83a, Y: 0xf7dc7a, f: 0xffe9a8, b: 0xb06a28, B: 0x6b3d1e, T: 0x8d9aa6, Z: 0xc3ccd2, J: 0x6f8192 };
const WATER = [C.CC, C.c, C.w, C.n];
const GOLD = [C.Y, C.f, C.y];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const Y = ELITES.yecha;
const J = ELITES.jianshi;

/** 金光符：一枚空心的小菱（和金光阵旗上的方胜一样），缃金、描一道赭边。 */
const AEGIS = outline(grid(['..Y..', '.Y.Y.', 'Y...Y', '.Y.Y.', '..Y..']), 'B');
const AEGIS_LIT = outline(grid(['..f..', '.fYf.', 'fY.Yf', '.fYf.', '..f..']), 'b');
/** 夜叉在水下的背鳍（朝右；朝左镜像）：一片往后弯的鳍，脊上一线天青，鳍根两边翻着白浪。 */
const FIN = outline(grid(['...n...', '..nc...', '.ncC...', '.nccC..', 'nccccC.', 'wwCwwCw']), 'N', { w: 'c', C: 'n', c: 'N', n: 'N' });

/** 一像素宽的像素线（整数坐标），调用方自己 fill。 */
function pixLine(g: Graphics, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    g.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

interface LaneView {
  warn: LaneWarn;
  kind: 'slap' | 'blade';
  struck: number; // 出手后过了多久（-1 = 还没出手）
  head: number; // 浪头 / 剑沿线到了哪
  orb?: number; // 射出去的那一柄剑（w.orbs 的 id）
  ux: number;
  uy: number;
}

interface Thread {
  g: Graphics;
  x0: number;
  y0: number;
  id: number;
  t: number;
}

interface Mark {
  s: Sprite;
  t: number;
  out: number; // 开始淡出的时刻（-1 = 还在）
}

export class EliteFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private warns: WarnLayer;
  private floor = new Container();
  private air = new Container();
  private lanes = new Map<number, LaneView>(); // 按精英 id：拍浪那一条 / 剑侍这一剑的那一条
  private disks = new Map<number, DiskWarn>(); // 按夜叉 id：要冒出来的那一片
  private fins = new Map<number, { s: Sprite; sh: Sprite; wake: number; t: number }>();
  private ripples = new Graphics();
  private crest = new Graphics();
  private threads: Thread[] = [];
  private marks = new Map<number, Mark>();
  private blades = new Map<number, Sprite[]>(); // 按剑侍 id：绕身的三柄
  private flying = new Map<number, { s: Sprite; trail: Sprite[]; px: number; py: number; t: number }>(); // 按 orb id
  private bladeTex = new Map<AccentKey, Texture[]>();
  private aegisTex: Texture;
  private aegisLit: Texture;
  private finTex: Texture;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.warns = warnLayer(stage);
    warmWarnTextures({ lanes: [Y.slap.width + PLAYER.radius, J.shot.r + PLAYER.radius], disks: [Y.dive.r], chevrons: [[2, false], [3, false]] });
    stage.floor.addChild(this.floor);
    this.floor.addChild(this.ripples);
    stage.fx.addChild(this.air);
    this.air.addChild(this.crest);
    this.aegisTex = textureFromGrid(AEGIS);
    this.aegisLit = textureFromGrid(AEGIS_LIT);
    this.finTex = textureFromGrid(FIN);
  }

  /** 名字表（docs/audio.md）里有素材就放它，没有就放 fallback（现有的相近的声音）。 */
  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  private bladeTextures(k: AccentKey): Texture[] {
    let t = this.bladeTex.get(k);
    if (!t) {
      t = BLADE_FRAMES.map((g) => textureFromGrid(accentize(g, k)));
      this.bladeTex.set(k, t);
    }
    return t;
  }

  clear() {
    for (const v of this.lanes.values()) v.warn.destroy();
    this.lanes.clear();
    for (const d of this.disks.values()) d.destroy();
    this.disks.clear();
    for (const f of this.fins.values()) {
      f.s.destroy();
      f.sh.destroy();
    }
    this.fins.clear();
    for (const t of this.threads) t.g.destroy();
    this.threads = [];
    for (const m of this.marks.values()) m.s.destroy();
    this.marks.clear();
    for (const bs of this.blades.values()) for (const s of bs) s.destroy();
    this.blades.clear();
    for (const f of this.flying.values()) {
      f.s.destroy();
      for (const t of f.trail) t.destroy();
    }
    this.flying.clear();
    this.ripples.clear();
    this.crest.clear();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'yechaDive':
        // 沉进水里：脚下一圈水花往外溅、几粒水珠往上蹦
        this.glows.emit(e.x, e.y - 2, 10, WATER, [20, 55], [0.3, 0.55], { up: 10, drag: 3 });
        this.sparks.emit(e.x, e.y - 3, 8, [C.CC, C.w, C.c], [25, 60], [0.35, 0.6], { up: 30, g: 120, drag: 1 });
        this.play('elite.yecha.dive', 'xuanyuan.pool', 0.6);
        break;
      case 'yechaRise': {
        this.disks.get(e.id)?.destroy();
        this.disks.set(e.id, new DiskWarn(this.warns, e.x, e.y, e.r));
        this.play('elite.yecha.rise', 'xuanyuan.vortex', 0.5);
        break;
      }
      case 'yechaBurst': {
        const d = this.disks.get(e.id);
        if (d) {
          d.strike();
          d.end(0.4);
        }
        this.burst(e.x, e.y, e.r);
        break;
      }
      case 'yechaSlapWarn': {
        this.lanes.get(e.id)?.warn.destroy();
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0) || 1;
        const warn = new LaneWarn(this.warns, e.x0, e.y0, e.x1, e.y1, e.r, Y.slap.speed, { every: 12, start: 12, size: 2 });
        this.lanes.set(e.id, { warn, kind: 'slap', struck: -1, head: 0, ux: (e.x1 - e.x0) / len, uy: (e.y1 - e.y0) / len });
        this.play('elite.yecha.slap.warn', 'enemy.spear.warn', 0.7);
        break;
      }
      case 'yechaSlap': {
        const v = this.lanes.get(e.id);
        if (v) {
          v.struck = 0;
          v.warn.strike();
        }
        // 叉头砸地：一蓬水花
        this.glows.emit(e.x0 + (v?.ux ?? 0) * 12, e.y0 + (v?.uy ?? 0) * 12 - 2, 8, WATER, [25, 60], [0.25, 0.5], { up: 12, drag: 3 });
        this.shake.add(0.08);
        this.play('elite.yecha.slap', 'dingfeng.gust', 0.6);
        break;
      }
      case 'aegisRaise':
        this.play('elite.lishi.raise', 'cast', 0.6);
        break;
      case 'aegisCast': {
        // 旗面上的方胜一亮，一缕缕金线从旗上牵到每一只被套上金光的敌人（0.5 秒里由近及远亮起、再淡掉）
        const src = w.enemies.find((o) => o.id === e.id);
        const fx = e.x + (src && src.x < (w.players[0]?.x ?? 0) ? 5 : -5);
        const fy = e.y - 34;
        for (const id of e.ids) {
          if (id === e.id) continue;
          const g = new Graphics();
          this.air.addChild(g);
          this.threads.push({ g, x0: fx, y0: fy, id, t: 0 });
        }
        this.glows.emit(fx, fy, 10, GOLD, [15, 40], [0.35, 0.6], { drag: 3 });
        this.play('elite.lishi.aegis', 'xinghuang.up', 0.6);
        break;
      }
      case 'aegisBlock': {
        // 金光挡下：胸口那枚小菱碎开，金屑往外迸
        const m = this.marks.get(e.id);
        const o = w.enemies.find((x) => x.id === e.id);
        const top = o ? this.chest(o) : [e.x, e.y - 16];
        this.sparks.emit(top[0], top[1], 7, [C.Y, C.y, C.f, C.b], [30, 70], [0.25, 0.45], { drag: 4, g: 40 });
        this.glows.emit(top[0], top[1], 3, [C.f, C.W], [10, 30], [0.15, 0.3], { drag: 4 });
        if (m) this.sparks.emit(m.s.x, m.s.y, 5, [C.Y, C.f], [15, 35], [0.2, 0.35], { drag: 3 }); // 头顶那枚小菱碎掉
        if (m && m.out < 0) m.out = m.t;
        this.play('elite.lishi.block', 'enemy.guard', 0.7);
        break;
      }
      case 'bladeAim': {
        this.lanes.get(e.id)?.warn.destroy();
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0) || 1;
        const warn = new LaneWarn(this.warns, e.x0, e.y0, e.x1, e.y1, e.r, J.shot.speed, { every: 16, start: 14, size: 3 });
        this.lanes.set(e.id, { warn, kind: 'blade', struck: -1, head: 0, ux: (e.x1 - e.x0) / len, uy: (e.y1 - e.y0) / len });
        // 指向人物的那一柄微微一颤：剑尖迸一点霜白
        this.glows.emit(e.x0, e.y0 - J.orbit.h, 3, [C.Z, C.W], [8, 20], [0.15, 0.3], { drag: 3 });
        this.play('elite.jianshi.aim', 'enemy.spear.warn', 0.5);
        break;
      }
      case 'bladeShot': {
        const v = this.lanes.get(e.id);
        if (v) {
          v.struck = 0;
          v.orb = e.orb;
          v.warn.strike();
        }
        this.play('elite.jianshi.shot', 'zhanxian.fly', 0.6);
        break;
      }
      case 'bladeReform':
        // 三柄剑重新聚齐：一圈霜白、冷银的碎光往身边收
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          this.glows.emit(e.x + Math.cos(a) * 20, e.y - J.orbit.h + Math.sin(a) * 10, 1, [C.Z, C.T], [20, 30], [0.25, 0.35], { dir: a + Math.PI, spread: 0.2, drag: 1 });
        }
        this.play('elite.jianshi.reform', 'zhanxian.hit', 0.4);
        break;
    }
  }

  /** 冒出水面：一圈水墙往上窜、往外落（到判定半径那么远），中间一柱白浪；震屏。 */
  private burst(x: number, y: number, r: number) {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const px = x + Math.cos(a) * r * 0.55;
      const py = y + Math.sin(a) * r * 0.4;
      this.sparks.emit(px, py - 2, 1, [C.CC, C.w, C.c], [r * 0.9, r * 1.6], [0.35, 0.55], { dir: a, spread: 0.3, up: 40, g: 160, drag: 1.5 });
    }
    this.sparks.emit(x, y - 6, 14, [C.w, C.CC, C.W], [30, 80], [0.4, 0.7], { up: 70, g: 160, drag: 1, spread: 0.8, dir: -Math.PI / 2 });
    this.glows.emit(x, y - 4, 12, WATER, [20, r * 2], [0.3, 0.6], { drag: 3 });
    this.shake.add(0.22);
    this.play('elite.yecha.burst', 'xuanyuan.pool', 0.9);
  }

  /** 胸口（金线牵到的地方、挡下时金屑迸开的地方）的屏幕位置。 */
  private chest(e: Enemy, alpha = 1): [number, number] {
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    if (e.kind === 'elite') {
      const b = ELITE_BODY[e.elite ?? 'xiaowei'];
      return [x + b.chest[0], y + b.chest[1]];
    }
    // 别的敌人：头顶往下一半多一点（按画法的 top）
    const top = foeLooks()[e.kind as FoeViewKind]?.top ?? 22;
    return [x, y - Math.round(top * 0.55)];
  }

  /** 金光符浮在哪：头顶上方（精英在血条上方），一起一伏。 */
  private crown(e: Enemy, alpha: number, t: number): [number, number] {
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    const top = e.kind === 'elite' ? (eliteLook(e).bar ?? 40) + 5 : (foeLooks()[e.kind as FoeViewKind]?.top ?? 22) + 4;
    return [x, y - top + Math.round(Math.sin(t * 2.2 + e.id) * 1)];
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const byId = new Map<number, Enemy>();
    for (const e of w.enemies) if (e.hp > 0) byId.set(e.id, e);
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const lag = (1 - alpha) * DT;
    this.updateLanes(dt, w, byId, lag);
    this.updateDisks(dt, byId, lag);
    this.updateUnder(dt, w, lerp);
    this.updateThreads(dt, byId, alpha);
    this.updateMarks(dt, w, alpha);
    this.updateBlades(dt, w, alpha);
  }

  /** 拍浪那一条、剑侍这一剑的那一条：预警时推亮，出手后浪头 / 剑沿线走，走过的拖一截淡掉。 */
  private updateLanes(dt: number, w: World, byId: Map<number, Enemy>, lag: number) {
    this.crest.clear();
    for (const [id, v] of this.lanes) {
      const e = byId.get(id);
      const warn = v.warn;
      if (v.struck >= 0) v.struck += dt;
      if (!warn.struck) {
        if (!e || e.act !== 'windup') warn.end(0.25); // 被打断、没了
        const k = e && e.act === 'windup' && e.actLen ? 1 - (e.actT! + lag) / e.actLen : 1;
        warn.draw(dt, clamp01(k));
      } else if (v.kind === 'slap') {
        // 浪头：按模拟的出手计时沿线推过去（推完就淡掉）
        const going = !!e && e.act === 'strike' && !!e.actLen;
        if (going) v.head = Math.min(warn.len, warn.len * clamp01(1 - (e!.actT! + lag) / e!.actLen!));
        else warn.end(0.35);
        warn.draw(dt, 1, { from: v.head, to: warn.len, head: v.head });
        if (going || v.struck < 0.15) this.drawCrest(warn, v);
      } else {
        // 剑：跟着射出去的那一柄（w.orbs 里），它没了（打中、飞完）就淡掉
        const o = w.orbs.find((x) => x.id === v.orb);
        if (o) v.head = Math.min(warn.len, Math.max(v.head, warn.along(o.x, o.y + 8)));
        else warn.end(0.3);
        warn.draw(dt, 1, { from: v.head, to: warn.len, head: v.head });
      }
      if (warn.done) {
        warn.destroy();
        this.lanes.delete(id);
      }
    }
  }

  /**
   * 浪头：一堵和浪推的方向垂直的矮水墙（中间高、两头低，两头往后弯成一弯）：浪尖一线月白，往下天青、石青、越往下越淡；
   * 身后拖一截很淡的水，浪尖上甩出几粒水珠。高度画在屏幕的上方（俯视 3/4：水墙立在地上）。
   */
  private drawCrest(warn: LaneWarn, v: LaneView) {
    const g = this.crest;
    const [hx, hy] = warn.at(v.head);
    const nx = -v.uy;
    const ny = v.ux;
    const half = Math.max(3, warn.R - 3);
    for (let si = -half; si <= half; si++) {
      const q = Math.abs(si) / half;
      const curve = q * q * 4; // 两头往后弯
      const px = Math.round(hx + nx * si - v.ux * curve);
      const py = Math.round(hy + ny * si - v.uy * curve);
      const h = Math.round(7 * (1 - 0.55 * q * q));
      for (let k = 0; k <= h; k++) {
        const top = k === h;
        const col = top ? C.w : k >= h - 2 ? C.CC : k >= h - 4 ? C.c : C.n;
        const a = top ? 0.95 : 0.35 + 0.5 * (k / h);
        g.rect(px, py - k, 1, 1).fill({ color: col, alpha: a });
        // 浪身厚一点：身后再一排、浅一档
        if (k < h) g.rect(Math.round(px - v.ux * 1.5), Math.round(py - v.uy * 1.5) - k, 1, 1).fill({ color: k >= h - 3 ? C.c : C.n, alpha: a * 0.6 });
      }
      // 身后那一截淡淡的水（贴地）
      for (let b = 2; b <= 6; b += 2) g.rect(Math.round(px - v.ux * b), Math.round(py - v.uy * b), 1, 1).fill({ color: C.CC, alpha: 0.35 * (1 - b / 8) });
    }
    if (Math.random() < 0.8) {
      const sx = (Math.random() - 0.5) * 2 * half;
      this.sparks.emit(hx + nx * sx, hy + ny * sx - 7, 1, [C.w, C.CC], [20, 50], [0.25, 0.4], { dir: Math.atan2(v.uy, v.ux), spread: 0.8, up: 30, g: 140, drag: 1 });
    }
  }

  /** 要冒出来的那一片：亮红从中心往外推（进度读模拟的计时），冒出来时整块亮一下再淡掉。 */
  private updateDisks(dt: number, byId: Map<number, Enemy>, lag: number) {
    for (const [id, d] of this.disks) {
      const e = byId.get(id);
      const rising = !!e && e.act === 'rise';
      if (!rising && !d.struck) d.end(0.25);
      const k = rising && e!.actLen ? clamp01(1 - (e!.actT! + lag) / e!.actLen) : 1;
      d.draw(dt, k);
      if (d.done) {
        d.destroy();
        this.disks.delete(id);
      }
    }
  }

  /**
   * 潜在水里的夜叉：一片背鳍贴着地面划过去（朝它游的方向），身后拖两道很淡的水纹、偶尔翻起一粒水花；
   * 停住等着冒出来时（rise）背鳍不动、地上一圈圈细碎的水纹往里收（不是光圈：是断开的几小段，越收越亮）。
   */
  private updateUnder(dt: number, w: World, lerp: (a: number, b: number) => number) {
    const g = this.ripples;
    g.clear();
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.kind !== 'elite' || e.elite !== 'yecha' || !e.hidden || (e.act !== 'under' && e.act !== 'rise')) continue;
      seen.add(e.id);
      let f = this.fins.get(e.id);
      if (!f) {
        const s = new Sprite(this.finTex);
        s.anchor.set(0.5, 1);
        this.stage.entities.addChild(s);
        // 水下的身子：一团压得很扁的暗影（比夜叉的影子大一圈），背鳍在它前头
        const sh = new Sprite(this.stage.tex.shadow);
        sh.anchor.set(0.5);
        sh.tint = C.N;
        sh.scale.set(1.6, 1.4);
        this.floor.addChild(sh);
        f = { s, sh, wake: 0, t: 0 };
        this.fins.set(e.id, f);
      }
      f.t += dt;
      const x = Math.round(lerp(e.px, e.x));
      const y = Math.round(lerp(e.py, e.y));
      const vx = e.x - e.px;
      const dir = vx < -0.01 ? -1 : vx > 0.01 ? 1 : f.s.scale.x < 0 ? -1 : 1;
      const fade = Math.min(1, f.t / 0.2);
      f.s.scale.x = dir;
      f.s.position.set(x + dir * 3, y + (e.act === 'rise' ? Math.round(Math.sin(f.t * 18) * 0.6) : 0));
      f.s.zIndex = y;
      f.s.alpha = fade;
      f.sh.position.set(x - dir * 2, y + 1);
      f.sh.alpha = 0.32 * fade;
      if (e.act === 'under') {
        // 身后的水纹：两道斜着往后张开的线（越往后越淡、越开），一闪一闪地往后流
        for (const side of [-1, 1]) {
          for (let k = 2; k <= 14; k += 1) {
            const a = (1 - k / 15) * (0.6 + 0.4 * Math.sin(this.time * 14 - k * 0.9));
            g.rect(Math.round(x - dir * k), Math.round(y + side * (1 + k * 0.5)), 1, 1).fill({ color: k < 6 ? C.w : C.CC, alpha: 0.75 * a });
          }
        }
        f.wake -= dt;
        if (f.wake <= 0) {
          f.wake = 0.09;
          this.glows.emit(x - dir * 3, y - 1, 1, [C.CC, C.w], [6, 16], [0.25, 0.45], { up: 8, drag: 3 });
        }
      } else {
        // rise：几圈断开的水纹往里收
        const k = e.actLen ? clamp01(1 - (e.actT ?? 0) / e.actLen) : 0;
        for (let ring = 0; ring < 3; ring++) {
          const ph = (this.time * 1.4 + ring / 3) % 1;
          const R = Y.dive.r * (1 - ph) * 0.9 + 3;
          const a = (0.25 + 0.5 * k) * Math.sin(ph * Math.PI);
          for (let s = 0; s < 10; s++) {
            if (s % 3 === 2) continue; // 断开
            const ang = (s / 10) * Math.PI * 2 + ring;
            g.rect(Math.round(x + Math.cos(ang) * R), Math.round(y + Math.sin(ang) * R * 0.55), 1, 1).fill({ color: C.CC, alpha: a });
          }
        }
        if (Math.random() < 0.3 + 0.5 * k) this.glows.emit(x + (Math.random() - 0.5) * 10, y - 1, 1, [C.CC, C.w], [8, 24], [0.2, 0.4], { up: 18, drag: 2 });
      }
    }
    for (const [id, f] of this.fins) {
      if (seen.has(id)) continue;
      f.s.destroy();
      f.sh.destroy();
      this.fins.delete(id);
    }
  }

  /** 金线：从旗上牵到被套上金光的那一只，0.15 秒里由近及远亮起，停一下，0.35 秒淡掉（中间断开几段，像一缕光不像一根绳）。 */
  private updateThreads(dt: number, byId: Map<number, Enemy>, alpha: number) {
    for (let i = this.threads.length - 1; i >= 0; i--) {
      const th = this.threads[i];
      th.t += dt;
      const o = byId.get(th.id);
      const life = 0.6;
      if (th.t >= life || !o) {
        th.g.destroy();
        this.threads.splice(i, 1);
        continue;
      }
      const [tx, ty] = this.chest(o, alpha);
      const grow = clamp01(th.t / 0.15);
      const fade = th.t < 0.25 ? 1 : 1 - (th.t - 0.25) / (life - 0.25);
      const g = th.g;
      g.clear();
      const n = Math.max(1, Math.round(Math.hypot(tx - th.x0, ty - th.y0)));
      const lift = Math.min(10, n * 0.15); // 微微往上拱一点
      for (let k = 0; k <= n * grow; k++) {
        const t = k / n;
        if (Math.floor(k / 3) % 3 === 2) continue;
        const x = th.x0 + (tx - th.x0) * t;
        const y = th.y0 + (ty - th.y0) * t - Math.sin(t * Math.PI) * lift;
        g.rect(Math.round(x), Math.round(y), 1, 1);
      }
      g.fill({ color: C.Y, alpha: 0.75 * fade });
    }
  }

  /** 金光符：被套上金光的敌人头顶浮一枚小菱（身上泛淡金，在 enemy-views 里），慢慢明灭；金光散了（到时、被挡掉）就淡掉。 */
  private updateMarks(dt: number, w: World, alpha: number) {
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || !aegisLeft(w, e) || e.hidden) continue;
      seen.add(e.id);
      let m = this.marks.get(e.id);
      if (!m || m.out >= 0) {
        if (m) m.s.destroy();
        const s = new Sprite(this.aegisTex);
        s.anchor.set(0.5);
        s.alpha = 0;
        this.stage.fx.addChild(s);
        m = { s, t: 0, out: -1 };
        this.marks.set(e.id, m);
      }
      m.t += dt;
      const [x, y] = this.crown(e, alpha, m.t);
      m.s.position.set(Math.round(x), Math.round(y));
      // 明灭：大部分时候是缃金的小菱，隔一会儿亮成灵光
      const pulse = Math.sin(m.t * 3.2 + e.id) > 0.82;
      m.s.texture = pulse ? this.aegisLit : this.aegisTex;
      // 快散的时候闪
      const left = (e.aegisT ?? 0) - w.time;
      const blink = left < 1.5 ? (Math.sin(m.t * 18) > 0 ? 1 : 0.35) : 1;
      m.s.alpha = Math.min(1, m.t / 0.25) * 0.95 * blink;
    }
    for (const [id, m] of this.marks) {
      if (seen.has(id) && m.out < 0) continue;
      if (m.out < 0) m.out = m.t;
      m.t += dt;
      const k = 1 - (m.t - m.out) / 0.3;
      if (k <= 0) {
        m.s.destroy();
        this.marks.delete(id);
      } else m.s.alpha = Math.min(m.s.alpha, k);
    }
  }

  /**
   * 剑侍绕身的三柄剑（按模拟的 spin 插值、按地上的投影排前后：转到身后的被身子挡住）；指向人物的那一柄停在模拟定下的那一点、剑尖朝人物；
   * 射出去的剑（w.orbs 里 kind 'blade'）：剑尖朝飞的方向，身后两道很淡的残影；没了（打中、飞完）就迸几粒冷银的碎光。
   */
  private updateBlades(dt: number, w: World, alpha: number) {
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (e.kind !== 'elite' || e.elite !== 'jianshi' || e.hp <= 0) continue;
      seen.add(e.id);
      const tex = this.bladeTextures(accentOf(e));
      let bs = this.blades.get(e.id);
      if (!bs) {
        bs = [0, 1, 2].map(() => {
          const s = new Sprite(tex[0]);
          s.anchor.set(0.5);
          this.stage.entities.addChild(s);
          return s;
        });
        this.blades.set(e.id, bs);
      }
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;
      const spin = (e.spin ?? 0) + (e.stun > 0 ? 0 : J.orbit.spin * DT * (alpha - 1));
      const first = nextBlade(e);
      const aiming = e.act === 'windup';
      for (let k = 0; k < 3; k++) {
        const s = bs[k];
        const inOrbit = k >= first;
        if (!inOrbit) {
          s.visible = false;
          continue;
        }
        s.visible = true;
        let gx: number;
        let gy: number;
        let a: number;
        if (aiming && k === first && e.ox !== undefined && e.aimX !== undefined) {
          // 停下指向人物：停在模拟定下的那一点，剑尖朝人物，预警快完时微微发颤
          gx = e.ox + (x - e.x);
          gy = e.oy! + (y - e.y);
          a = Math.atan2(e.aimY!, e.aimX);
          const k2 = e.actLen ? 1 - (e.actT ?? 0) / e.actLen : 0;
          if (k2 > 0.6) gx += Math.round(Math.sin(this.time * 60) * 0.6);
        } else {
          const p = bladeSpot({ ...e, x, y } as Enemy, k, spin);
          gx = p[0];
          gy = p[1];
          // 剑尖顺着转的方向（切线），微微朝下
          const ang = spin + (k * Math.PI * 2) / 3;
          a = Math.atan2(Math.cos(ang) * J.orbit.ry, -Math.sin(ang) * J.orbit.r) + 0.25;
        }
        s.texture = tex[bladeDir(a)];
        s.position.set(Math.round(gx), Math.round(gy - J.orbit.h));
        s.zIndex = gy; // 转到身后（地上的投影在它脚后面）就被身子挡住
        s.alpha = e.stun > 0 && e.frozen > 0 ? 0.75 : 1;
      }
    }
    for (const [id, bs] of this.blades) {
      if (seen.has(id)) continue;
      // 剑侍倒下：绕身的剑当啷落地，散成冷银的碎光
      for (const s of bs) {
        if (s.visible) this.sparks.emit(s.x, s.y, 3, [C.Z, C.T, C.J], [15, 40], [0.3, 0.5], { g: 120, drag: 2 });
        s.destroy();
      }
      this.blades.delete(id);
    }
    // 射出去的剑
    const oseen = new Set<number>();
    for (const o of w.orbs) {
      if (o.kind !== 'blade') continue;
      oseen.add(o.id);
      let f = this.flying.get(o.id);
      const a = Math.atan2(o.vy, o.vx);
      if (!f) {
        const owner = this.ownerAccent(w, o.id);
        const tex = this.bladeTextures(owner)[bladeDir(a)];
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        this.stage.entities.addChild(s);
        const trail = [0, 1].map(() => {
          const t = new Sprite(tex);
          t.anchor.set(0.5);
          t.alpha = 0;
          this.stage.fx.addChild(t);
          return t;
        });
        f = { s, trail, px: o.x, py: o.y, t: 0 };
        this.flying.set(o.id, f);
      }
      f.t += dt;
      const x = Math.round(o.px + (o.x - o.px) * alpha);
      const y = Math.round(o.py + (o.y - o.py) * alpha);
      f.s.position.set(x, y);
      f.s.zIndex = y + 8;
      f.trail.forEach((t, i) => {
        const back = (i + 1) * 5;
        t.position.set(Math.round(x - Math.cos(a) * back), Math.round(y - Math.sin(a) * back));
        t.alpha = Math.min(1, f!.t / 0.08) * (i === 0 ? 0.35 : 0.15);
        t.tint = C.Z;
      });
      f.px = x;
      f.py = y;
    }
    for (const [id, f] of this.flying) {
      if (oseen.has(id)) continue;
      this.sparks.emit(f.px, f.py, 4, [C.Z, C.T, C.W], [15, 40], [0.2, 0.35], { drag: 3 });
      f.s.destroy();
      for (const t of f.trail) t.destroy();
      this.flying.delete(id);
    }
  }

  /** 这一柄剑是谁射的（按 bladeShot 记下的 orb id；找不到就当不带词缀）。 */
  private ownerAccent(w: World, orb: number): AccentKey {
    for (const [id, v] of this.lanes) {
      if (v.orb !== orb) continue;
      const e = w.enemies.find((x) => x.id === id);
      return e ? accentOf(e) : 'none';
    }
    return 'none';
  }
}
