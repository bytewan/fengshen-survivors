// 第三章三种新敌人的画面效果：飞剑灵的瞄准（地上的淡红光）与射出；截教门徒掷出的剑气（w.orbs 里 kind 'qi' 的弹道：一弯月牙形的刃光，
// 拖一截淡淡的残影）；阵图傀儡之间的剑气线（胸口阵盘之间一缕冷银的细光，一明一暗地流；脚下一条很淡的红光——碰到就伤人），线断时迸开。
// 只读模拟状态（敌人身上的 act / mate、w.orbs）和事件（Ch3FoeEvent），不回写模拟。
// 预警口径同 enemy-fx.ts：形状就是判定——飞剑灵射来的线两侧各 FOES3.flysword.width + 人物半径（ch3/foes.ts 的 flysword）；
// 傀儡的剑气线两侧各 FOES3.puppet.r + 人物半径。用户口径：克制、不要光圈；剑气是一弯刃光、一缕细光，不是框。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { PixelGraphics } from '../../render/pixel-graphics.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { QI_FRAMES, qiDir } from '../../art/ch3/foes.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { FOES3 } from '../../sim/ch3/config.ts';
import { tetherPairs } from '../../sim/ch3/foes.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { LaneWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';
import { PUPPET_CORE } from './foe-looks.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const SILVER = [0xc3ccd2, 0x8d9aa6, 0xffffff];
const QI = [0x7cc4c4, 0xc3ccd2, 0xffffff];
/** 预警的朱砂（和 warn-fx 同一个颜色）。 */
const RED = 0xd9452b;

interface ShotView {
  id: number;
  warn: LaneWarn;
  struck: boolean;
  head: number;
}

interface QiView {
  s: Sprite;
  trail: { s: Sprite; t: number }[];
  trailCd: number;
  x: number;
  y: number;
}

let qiTex: Texture[] | null = null;

export class Ch3FoeFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private warns: WarnLayer;
  private air = new Container();
  private threads = new PixelGraphics(); // 傀儡之间的剑气线（加法混合的细光）。逐像素画（PixelGraphics，docs/perf.md）
  private bands = new Graphics(); // 剑气线脚下的淡红光（画在预警层里，取最大值叠）
  private shots = new Map<number, ShotView>();
  private qi = new Map<number, QiView>();
  private lastPairs = new Map<string, [number, number, number, number]>(); // 上一帧每一组傀儡的位置（线断时在那里迸开）
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.warns = warnLayer(stage);
    warmWarnTextures({ lanes: [FOES3.flysword.width + PLAYER.radius], chevrons: [[2, false]] });
    qiTex ??= QI_FRAMES.map(textureFromGrid);
    stage.fx.addChild(this.air);
    this.threads.blendMode = 'add';
    stage.glow.addChild(this.threads);
    this.bands.blendMode = 'max';
  }

  /** 剑气线脚下的淡红光放在预警层里；场上没有傀儡时拿出来（预警层没东西时整层不画，省一次离屏）。 */
  private showBands(on: boolean) {
    const root = this.warns.root;
    if (on && this.bands.parent !== root) this.warns.add(this.bands);
    else if (!on && this.bands.parent === root) {
      root.removeChild(this.bands);
      root.visible = root.children.length > 0;
    }
  }

  clear() {
    for (const d of this.shots.values()) d.warn.destroy();
    this.shots.clear();
    for (const q of this.qi.values()) this.dropQi(q);
    this.qi.clear();
    this.threads.clear();
    this.bands.clear();
    this.lastPairs.clear();
  }

  private dropQi(q: QiView) {
    q.s.destroy();
    for (const t of q.trail) t.s.destroy();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'flyAim': {
        const warn = new LaneWarn(this.warns, e.x0, e.y0, e.x1, e.y1, e.r, FOES3.flysword.speed, { every: 12, start: 10, size: 2 });
        this.shots.get(e.id)?.warn.destroy();
        this.shots.set(e.id, { id: e.id, warn, struck: false, head: 0 });
        this.sfx.play('fly.aim');
        break;
      }
      case 'flyShot': {
        const d = this.shots.get(e.id);
        if (d) {
          d.struck = true;
          d.warn.strike();
        }
        this.sfx.play('fly.shot');
        this.glows.emit(e.x0, e.y0 - 10, 6, SILVER, [20, 60], [0.15, 0.3], { dir: Math.atan2(e.y1 - e.y0, e.x1 - e.x0), spread: 0.4, drag: 3 });
        break;
      }
      case 'qiCast':
        this.sfx.play('qi.cast');
        break;
      case 'qiThrow':
        this.glows.emit(e.x, e.y, 8, QI, [20, 60], [0.15, 0.3], { drag: 3 });
        this.sfx.play('qi.throw');
        break;
      case 'tetherOn': {
        // 两只之间一闪：剑气线连上
        const a = w.enemies.find((x) => x.id === e.a);
        const b = w.enemies.find((x) => x.id === e.b);
        if (a && b) for (let i = 0; i <= 10; i++) this.glows.emit(a.x + (b.x - a.x) * (i / 10), a.y + PUPPET_CORE.y + (b.y - a.y) * (i / 10), 1, SILVER, [4, 14], [0.2, 0.4], { drag: 2 });
        this.sfx.play('tether.on');
        break;
      }
      case 'tetherCut': {
        // 线断：沿着最后的位置迸开一串冷银的碎光
        const last = this.lastPairs.get(`${e.a}:${e.b}`);
        const [x0, y0, x1, y1] = last ?? [e.x0, e.y0, e.x1, e.y1];
        for (let i = 0; i <= 14; i++) {
          const u = i / 14;
          this.glows.emit(x0 + (x1 - x0) * u, y0 + PUPPET_CORE.y + (y1 - y0) * u, 1, SILVER, [20, 60], [0.25, 0.5], { drag: 3 });
        }
        this.sfx.play('tether.cut');
        break;
      }
      case 'hurt':
        if (e.by === 'qi' || e.by === 'flysword' || e.by === 'tether') this.glows.emit(e.x, e.y - 10, 8, e.by === 'qi' ? QI : SILVER, [30, 80], [0.15, 0.3], { drag: 3 });
        break;
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    // 飞剑灵射来的线：预警时亮红推满，射出去时射过的地方拖一截淡掉；它被打断 / 射完 / 没了就淡出
    for (const [id, d] of this.shots) {
      const e = w.enemies.find((x) => x.id === id);
      const acting = e && (e.act === 'windup' || e.act === 'strike');
      if (!acting) d.warn.end(d.struck ? 0.3 : 0.2);
      const k = e && e.act === 'windup' ? clamp01(1 - ((e.actT ?? 0) - (1 - alpha) * DT) / Math.max(0.01, e.actLen ?? 1)) : 1;
      if (e && e.act === 'strike') d.head = Math.max(d.head, Math.min(d.warn.len, d.warn.along(lerp(e.px, e.x), lerp(e.py, e.y))));
      d.warn.draw(dt, k, d.struck ? { from: d.head, to: d.warn.len, head: d.head } : undefined);
      if (d.warn.done) {
        d.warn.destroy();
        this.shots.delete(id);
      }
    }
    // 截教门徒的剑气：一弯月牙形的刃光（朝着飞的方向），身后拖两三个越来越淡的残影
    const seen = new Set<number>();
    const tx = qiTex!;
    for (const o of w.orbs) {
      if (o.kind !== 'qi') continue;
      seen.add(o.id);
      let q = this.qi.get(o.id);
      const x = Math.round(lerp(o.px, o.x));
      const y = Math.round(lerp(o.py, o.y));
      if (!q) {
        const s = new Sprite(tx[0]);
        s.anchor.set(0.5);
        s.blendMode = 'add';
        this.air.addChild(s);
        q = { s, trail: [], trailCd: 0, x, y };
        this.qi.set(o.id, q);
      }
      const dir = qiDir(Math.atan2(o.vy, o.vx));
      q.s.texture = tx[dir];
      q.s.position.set(x, y);
      q.s.alpha = 0.9 + 0.1 * Math.sin(this.time * 18 + o.id);
      q.trailCd -= dt;
      if (q.trailCd <= 0) {
        q.trailCd = 0.05;
        const t = new Sprite(tx[dir]);
        t.anchor.set(0.5);
        t.blendMode = 'add';
        t.tint = 0x7cc4c4;
        t.position.set(x, y);
        this.air.addChild(t);
        q.trail.push({ s: t, t: 0 });
      }
      if (Math.random() < 0.3) this.glows.emit(x, y, 1, QI, [2, 8], [0.2, 0.35], { drag: 2 });
      q.x = x;
      q.y = y;
    }
    for (const [id, q] of this.qi) {
      for (let i = q.trail.length - 1; i >= 0; i--) {
        const t = q.trail[i];
        t.t += dt;
        t.s.alpha = Math.max(0, 0.35 - t.t * 1.4);
        if (t.s.alpha <= 0) {
          t.s.destroy();
          q.trail.splice(i, 1);
        }
      }
      if (seen.has(id)) continue;
      // 打中了、飞到头了：散成几点碎光
      if (q.s.visible) {
        this.glows.emit(q.x, q.y, 5, QI, [10, 40], [0.15, 0.3], { drag: 3 });
        q.s.visible = false;
      }
      if (!q.trail.length) {
        this.dropQi(q);
        this.qi.delete(id);
      }
    }
    // 阵图傀儡的剑气线：胸口阵盘之间一缕冷银的细光（中段微微起伏、一明一暗地流），脚下一条很淡的红光（判定的范围）
    const g = this.threads;
    const band = this.bands;
    g.clear();
    band.clear();
    const R = FOES3.puppet.r + PLAYER.radius;
    const nowPairs = new Map<string, [number, number, number, number]>();
    for (const [a, b] of tetherPairs(w)) {
      const ax = lerp(a.px, a.x);
      const ay = lerp(a.py, a.y);
      const bx = lerp(b.px, b.x);
      const by = lerp(b.py, b.y);
      nowPairs.set(`${a.id}:${b.id}`, [ax, ay, bx, by]);
      // 脚下的淡红光：和 warn-fx 的柔边一个口径（中间一层、两边各两档变淡）
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / L;
      const ny = (bx - ax) / L;
      const line = (o: number, wdt: number, al: number) => band.moveTo(ax + nx * o, ay + ny * o).lineTo(bx + nx * o, by + ny * o).stroke({ width: wdt, color: RED, alpha: al, cap: 'butt' });
      line(0, Math.max(1, 2 * R - 2), 0.16);
      for (const s of [-1, 1]) {
        line(s * (R - 0.5), 1, 0.16 * 0.66);
        line(s * (R + 0.5), 1, 0.16 * 0.33);
      }
      // 剑气的细光（胸口高度）
      const cy0 = ay + PUPPET_CORE.y;
      const cy1 = by + PUPPET_CORE.y;
      const n = Math.max(8, Math.round(Math.max(Math.abs(bx - ax), Math.abs(cy1 - cy0))));
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        // 一条连着的细光（不断开，不是虚线），亮的地方顺着线流过去
        const flow = 0.5 + 0.5 * Math.sin(u * 9 - this.time * 8 + a.id);
        const x = Math.round(ax + (bx - ax) * u);
        const y = Math.round(cy0 + (cy1 - cy0) * u);
        g.rect(x, y, 1, 1).fill({ color: flow > 0.92 ? 0xffffff : u < 0.12 || u > 0.88 ? 0x7cc4c4 : 0xc3ccd2, alpha: 0.5 + 0.35 * flow });
      }
      if (Math.random() < 0.2) {
        const u = Math.random();
        this.glows.emit(ax + (bx - ax) * u, cy0 + (cy1 - cy0) * u, 1, SILVER, [3, 10], [0.2, 0.35], { drag: 2 });
      }
    }
    this.lastPairs = nowPairs;
    this.showBands(nowPairs.size > 0);
    void this.shake;
  }
}
