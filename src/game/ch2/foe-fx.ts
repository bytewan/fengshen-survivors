// 第二章三种新敌人的画面效果：风吼妖的冲刺预警（地上的淡红光）与冲刺、把人吹开；落魂幡手的魂光（连到被增益的敌人）；
// 红沙傀儡留下的红沙、碎开时散出的一片。只读模拟状态（敌人身上的 act / links、World.patches）和事件（Ch2FoeEvent）。
// 预警口径同 enemy-fx.ts：形状就是判定——风吼妖的冲刺线两侧各 FOES2.windfiend.width + 人物半径（enemies.ts 的 windfiend）。
// 用户口径：克制、不要光圈；魂光是一缕细细的、一明一暗的光，不是框。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { once, textureFromBitmap } from '../../render/textures.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { FOES2 } from '../../sim/ch2/config.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { LaneWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';
import { BANNER_TOP } from './foe-looks.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const SOUL = [0x7cc4c4, 0xb89ac4, 0xffffff];

/** 红沙：一片暗红的细沙（中间密、往外稀，边缘是散开的沙粒，不是硬边）；半径按 r 取整各一张。 */
function sandTex(r: number): Texture {
  const R = Math.max(3, Math.round(r));
  return once(`ch2:sand:${R}`, () => {
    const S = R * 2 + 3;
    const C = R + 1;
    const data = new Uint8ClampedArray(S * S * 4);
    let seed = R * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cols = [
      [156, 42, 34],
      [176, 106, 40],
      [107, 61, 30],
      [92, 26, 27],
    ];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - C, (y - C) * 1.4) / R;
        if (d > 1) continue;
        // 越往外越稀（沙粒散开）
        if (rnd() > 1.05 - d * d * 0.9) continue;
        const c = cols[rnd() < 0.55 ? 0 : rnd() < 0.5 ? 1 : rnd() < 0.6 ? 2 : 3];
        data.set([...c, Math.round(255 * (0.75 + 0.25 * (1 - d)))], (y * S + x) * 4);
      }
    return textureFromBitmap({ w: S, h: S, data });
  });
}

interface DashView {
  id: number;
  warn: LaneWarn;
  struck: boolean;
  head: number;
}

export class Ch2FoeFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private warns: WarnLayer;
  private floor = new Container();
  private links = new Graphics();
  private dashes = new Map<number, DashView>();
  private sand = new Map<number, Sprite>();
  private time = 0;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.warns = warnLayer(stage);
    warmWarnTextures({ lanes: [FOES2.windfiend.width + PLAYER.radius], chevrons: [[2, false]] });
    stage.floor.addChildAt(this.floor, 0); // 红沙压在影子、预警下面
    this.links.blendMode = 'add';
    stage.glow.addChild(this.links);
  }

  clear() {
    for (const d of this.dashes.values()) d.warn.destroy();
    this.dashes.clear();
    for (const s of this.sand.values()) s.destroy();
    this.sand.clear();
    this.links.clear();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'windWarn': {
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        const warn = new LaneWarn(this.warns, e.x0, e.y0, e.x1, e.y1, e.r, FOES2.windfiend.speed, { every: 14, start: 10, size: 2 });
        this.dashes.set(e.id, { id: e.id, warn, struck: false, head: 0 });
        this.sfx.play('wind.warn');
        void len;
        break;
      }
      case 'windDash': {
        const d = this.dashes.get(e.id);
        if (d) {
          d.struck = true;
          d.warn.strike();
        }
        this.sfx.play('wind.dash');
        break;
      }
      case 'blown': {
        // 被吹开：脚下一蓬尘、几缕风顺着吹的方向
        const a = Math.atan2(e.vy, e.vx);
        this.sparks.emit(e.x, e.y - 1, 8, [0xa48e6d, 0xbba684, 0x958064], [20, 60], [0.25, 0.5], { dir: a, spread: 1.2, drag: 3 });
        this.glows.emit(e.x, e.y - 8, 6, [0xf2e8d5, 0xc9bcae], [40, 90], [0.15, 0.3], { dir: a, spread: 0.5, drag: 4 });
        this.shake.add(0.12);
        break;
      }
      case 'sandBurst': {
        this.sparks.emit(e.x, e.y - 8, 26, [0x9c2a22, 0xb06a28, 0x6b3d1e, 0xa48e6d], [30, 90], [0.4, 0.8], { up: 20, g: 90, drag: 2 });
        this.sfx.play('sand.burst');
        break;
      }
    }
    void w;
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    // 风吼妖的冲刺线：预警时亮红推满，冲刺时冲过的地方拖一截淡掉；它被打断 / 冲完 / 没了就淡出
    for (const [id, d] of this.dashes) {
      const e = w.enemies.find((x) => x.id === id);
      const acting = e && (e.act === 'windup' || e.act === 'strike');
      if (!acting) d.warn.end(d.struck ? 0.3 : 0.2);
      const k = e && e.act === 'windup' ? clamp01(1 - ((e.actT ?? 0) - (1 - alpha) * DT) / Math.max(0.01, e.actLen ?? 1)) : 1;
      if (e && e.act === 'strike') d.head = Math.max(d.head, Math.min(d.warn.len, d.warn.along(lerp(e.px, e.x), lerp(e.py, e.y))));
      d.warn.draw(dt, k, d.struck ? { from: d.head, to: d.warn.len, head: d.head } : undefined);
      if (d.warn.done) {
        d.warn.destroy();
        this.dashes.delete(id);
      }
    }
    // 落魂幡手的魂光：从幡头连到被增益的每一只，一缕细光（中段往下垂一点、一明一暗地流动）
    const g = this.links;
    g.clear();
    for (const b of w.enemies) {
      if (b.kind !== 'bannerman' || !b.links?.length || b.hp <= 0) continue;
      const hx = w.players[0]?.x ?? b.x;
      const dir = hx >= b.x ? 1 : -1;
      const bx = lerp(b.px, b.x) + dir * BANNER_TOP.x;
      const by = lerp(b.py, b.y) + BANNER_TOP.y + 2;
      for (const id of b.links) {
        const o = w.enemies.find((x) => x.id === id);
        if (!o || o.hp <= 0) continue;
        const ox = lerp(o.px, o.x);
        const oy = lerp(o.py, o.y) - 10;
        const n = Math.max(6, Math.round(Math.hypot(ox - bx, oy - by) / 3));
        for (let i = 1; i < n; i++) {
          const u = i / n;
          const sag = Math.sin(u * Math.PI) * 6; // 中段往下垂
          const flow = 0.5 + 0.5 * Math.sin(u * 9 - this.time * 6 + id);
          if (flow < 0.35) continue; // 一段一段的光在流
          const x = Math.round(bx + (ox - bx) * u);
          const y = Math.round(by + (oy - by) * u + sag);
          g.rect(x, y, 1, 1).fill({ color: flow > 0.85 ? 0xffffff : 0x7cc4c4, alpha: 0.55 * flow * Math.sin(u * Math.PI) ** 0.5 });
        }
        // 被增益的身上偶尔冒一缕魂光（护体）
        if (Math.random() < 0.06) this.glows.emit(ox + (Math.random() - 0.5) * 8, oy + 4, 1, SOUL, [4, 10], [0.3, 0.5], { up: 12 });
      }
    }
    // 人物踩在红沙上走：脚下扬起一点红沙
    if (w.patches.length) for (const p of w.players) if (p.alive && p.moving && Math.random() < 0.25 && w.patches.some((s) => (p.x - s.x) ** 2 + ((p.y - s.y) * 1.4) ** 2 <= s.r * s.r)) this.sparks.emit(p.x + (Math.random() - 0.5) * 6, p.y - 1, 2, [0x9c2a22, 0xb06a28, 0x6b3d1e], [8, 22], [0.25, 0.45], { up: 10, g: 60, drag: 2 });
    // 红沙：每片一张沙的贴图，最后一秒慢慢淡掉
    const seen = new Set<number>();
    for (const p of w.patches) {
      seen.add(p.id);
      let s = this.sand.get(p.id);
      if (!s) {
        s = new Sprite(sandTex(p.r));
        s.anchor.set(0.5);
        s.position.set(Math.round(p.x), Math.round(p.y));
        this.floor.addChild(s);
        this.sand.set(p.id, s);
      }
      s.alpha = clamp01(p.t / 0.25) * clamp01((p.life - p.t) / 1) * 0.85;
    }
    for (const [id, s] of this.sand) {
      if (seen.has(id)) continue;
      s.destroy();
      this.sand.delete(id);
    }
  }
}
