// 第三章地形「四剑轮斩」的画面：四座剑台上悬着的四把剑（暗金的剑身，隔一阵一线寒光从剑身上走过）、出鞘（剑升起、剑尖转向要斩的方向、微微发颤）、
// 剑气的路径（地上的淡红光：直线是一条长条，扇形是一道扇面，形状就是判定）、斩出去的剑气（直线：一弯刃光沿线飞过去，身后拖一截渐淡的剑光；
// 扇形：一道从剑台伸出去的剑光扫过扇面）、斩到敌人时迸出的碎光、斩完剑回到台上。四剑归阵时四把剑一起升起、剑尖指向阵心。
// 只读模拟状态（w.terrain，见 sim/ch3/terrain.ts）和事件（SwordEvent；首领的 zxAltars），不回写模拟。
// 预警口径同 warn-fx：直线两侧各 SWORDS.line.hw + 人物半径（terrain.ts 的 strike：segDist ≤ r + 人物半径）；
// 扇形是以剑台为圆心、半径 rad + 人物半径的扇面，起始边往外宽出 人物半径 − 1（inSweep 的 m）。
// 用户口径：剑不要画得过大（台上的剑 17 像素长）；不要光圈；出现和消失都有过程。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { PixelGraphics } from '../../render/pixel-graphics.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { once, textureFromGrid } from '../../render/textures.ts';
import { SWORD_DIRS, SWORD_DOWN, SWORD_FRAMES, swordDir } from '../../art/ch3/decor.ts';
import { DT, PLAYER } from '../../sim/config.ts';
import { SWORDS, ZHUXIAN } from '../../sim/ch3/config.ts';
import { swordsOf } from '../../sim/ch3/terrain.ts';
import type { SwordCut } from '../../sim/ch3/types.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';
import { LaneWarn, SweepWarn, warmWarnTextures, warnLayer, type WarnLayer } from '../warn-fx.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (k: number) => k * k * (3 - 2 * k);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const SILVER = [0xc3ccd2, 0xffffff, 0x8d9aa6];
const GOLD = [0xe0a83a, 0xf7dc7a, 0x8a6a31];
/** 剑悬在剑台上多高（剑的中点离台面）；出鞘时升到多高。 */
const HOVER = 13;
const RISE = 19;

/** 四把剑的纹理：TEX[剑][方向][帧]（帧 0 平时，1..5 寒光走过）。 */
function swordTex(): Texture[][][] {
  return once('ch3:swords', () => SWORD_FRAMES.map((dirs) => dirs.map((fs) => fs.map(textureFromGrid))));
}

interface SwordView {
  s: Sprite;
  sh: Sprite;
  mode: 'rest' | 'drawn' | 'cut' | 'home';
  t: number; // 进入这个状态多久了
  dir: number; // 剑尖朝哪（弧度）
  cut: number; // 正在斩的那一道的 id（-1 = 没有）
  glint: number; // 距下一次寒光
  glintT: number; // 寒光走了多久（-1 = 没在走）
  bob: number;
  hold: number; // 四剑归阵：升起指向阵心还要多久
}

interface CutView {
  c: SwordCut; // 模拟里的那个对象（斩完被移除之后留着最后的状态）
  lane: LaneWarn | null;
  fan: SweepWarn | null;
  gone: number; // -1 = 还在；否则是斩完了多久
  sparkCd: number;
}

export class SwordFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private warns: WarnLayer;
  private light = new PixelGraphics(); // 斩出去的剑气（加法混合）。逐像素画：PixelGraphics 只记矩形、上屏前画进像素缓冲（docs/perf.md）
  private swords: SwordView[] = [];
  private cuts = new Map<number, CutView>();
  private time = 0;
  private active = false;

  constructor(stage: Stage, sparks: Particles, glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.shake = shake;
    this.sfx = sfx;
    this.warns = warnLayer(stage);
    warmWarnTextures({ lanes: [SWORDS.line.hw + PLAYER.radius], chevrons: [[3, false]] });
    swordTex();
    this.light.blendMode = 'add';
    stage.glow.addChild(this.light);
  }

  /** 剑台上的四把剑（这一章的地形摆上时才建，地形没了就拿掉）。 */
  private ensureSwords(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    for (const v of this.swords) {
      v.s.destroy();
      v.sh.destroy();
    }
    this.swords = [];
    if (!on) return;
    const tx = swordTex();
    SWORDS.altars.forEach(([x, y], i) => {
      const s = new Sprite(tx[i][SWORD_DOWN][0]);
      s.anchor.set(0.5);
      s.position.set(x, y - HOVER);
      s.zIndex = y + 2;
      this.stage.entities.addChild(s);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.22;
      sh.position.set(x, y + 1);
      this.stage.floor.addChild(sh);
      this.swords.push({ s, sh, mode: 'rest', t: 0, dir: Math.PI / 2, cut: -1, glint: 2 + i * 1.7 + Math.random() * 3, glintT: -1, bob: i * 1.3, hold: 0 });
    });
  }

  /** 清掉剑气、预警（重开一局、换章）。剑台上的剑跟着地形走。 */
  clear() {
    for (const v of this.cuts.values()) this.dropCut(v);
    this.cuts.clear();
    this.light.clear();
    for (const v of this.swords) {
      v.mode = 'rest';
      v.cut = -1;
      v.hold = 0;
    }
  }

  private dropCut(v: CutView) {
    v.lane?.destroy();
    v.fan?.destroy();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'swordWarn': {
        const t = swordsOf(w);
        const c = t?.cuts.find((x) => x.id === e.id);
        if (!c) break;
        this.ensureSwords(true);
        const v: CutView = { c, lane: null, fan: null, gone: -1, sparkCd: 0 };
        if (c.kind === 'line') v.lane = new LaneWarn(this.warns, c.x0, c.y0, c.x1, c.y1, c.r + PLAYER.radius, SWORDS.line.speed, { every: 20, start: 26, size: 3 });
        else {
          // 扇面的纹理按半径缓存（terrain.fanCut 把半径取整到 16 的倍数，用得到的就那么二十来种），第一次用到时才生成
          v.fan = new SweepWarn(this.warns, c.x0, c.y0, c.rad + PLAYER.radius, c.a0, c.dir, PLAYER.radius - 1, c.arc);
        }
        this.cuts.set(c.id, v);
        const sw = this.swords[c.sword];
        if (sw) {
          sw.mode = 'drawn';
          sw.t = 0;
          sw.cut = c.id;
          sw.dir = c.kind === 'line' ? Math.atan2(c.y1 - c.y0, c.x1 - c.x0) : c.a0;
        }
        // 出鞘：剑台上迸几粒暗金的碎光，剑身一声轻鸣
        const [x, y] = SWORDS.altars[c.sword];
        this.glows.emit(x, y - HOVER, 8, GOLD, [10, 30], [0.4, 0.7], { up: 12, drag: 2 });
        this.sfx.play('sword.warn'); // 出鞘、剑身一声轻鸣（名字见 docs/audio.md「第三章」）
        break;
      }
      case 'swordCut': {
        const v = this.cuts.get(e.id);
        if (!v) break;
        v.lane?.strike();
        v.fan?.strike();
        const sw = this.swords[e.sword];
        if (sw) {
          sw.mode = 'cut';
          sw.t = 0;
        }
        this.shake.add(0.18);
        this.sfx.play(e.kind === 'line' ? 'sword.cut' : 'sword.sweep');
        const [x, y] = SWORDS.altars[e.sword];
        this.glows.emit(x, y - RISE, 12, SILVER, [30, 90], [0.2, 0.4], { drag: 3 });
        break;
      }
      case 'swordHome': {
        const v = this.cuts.get(e.id);
        if (v && v.gone < 0) v.gone = 0;
        const sw = this.swords[e.sword];
        if (sw && sw.cut === e.id) {
          sw.mode = 'home';
          sw.t = 0;
          sw.cut = -1;
        }
        break;
      }
      case 'zxAltars':
        // 四剑归阵：四把剑一起升起、剑尖指向阵心，墙起来的这一段一直指着
        this.ensureSwords(true);
        for (const sw of this.swords) {
          sw.hold = e.t2 + ZHUXIAN.walls.live;
          sw.mode = 'drawn';
          sw.t = 0;
        }
        this.sfx.play('sword.altars');
        break;
      case 'hit':
        if (e.by === 'sword') {
          // 斩到敌人：一小簇冷银的碎光、一线白
          this.glows.emit(e.x, e.y - 8, 6, SILVER, [30, 80], [0.15, 0.3], { drag: 3 });
          this.sparks.emit(e.x, e.y - 8, 3, [0xffffff], [40, 90], [0.08, 0.16]);
        }
        break;
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const t = swordsOf(w);
    this.ensureSwords(!!t);
    const live = new Set<number>();
    if (t) for (const c of t.cuts) live.add(c.id);
    const g = this.light;
    g.clear();
    for (const [id, v] of this.cuts) {
      if (v.gone < 0 && !live.has(id)) v.gone = 0;
      if (v.gone >= 0) v.gone += dt;
      if (this.drawCut(v, dt, alpha)) {
        this.dropCut(v);
        this.cuts.delete(id);
      }
    }
    this.updateSwords(dt);
  }

  /** 画一道剑气（预警 + 斩出去的剑光）；返回 true 表示画完了可以丢掉。 */
  private drawCut(v: CutView, dt: number, alpha: number): boolean {
    const c = v.c;
    const lag = (1 - alpha) * DT;
    const k = clamp01((c.t - lag) / Math.max(0.01, c.warn));
    const struck = c.t >= c.warn;
    const head = struck ? c.prev + (c.head - c.prev) * alpha : 0;
    const g = this.light;
    if (c.kind === 'line') {
      const lane = v.lane!;
      if (v.gone >= 0) lane.end(0.3);
      lane.draw(dt, k, struck ? { from: Math.max(0, head - 4), to: lane.len, head } : undefined, this.stage.cam);
      if (struck && v.gone < 0) {
        // 一弯刃光沿线飞：头上一道和线垂直的月牙形刃（霜白的刃口、天青的刃背，中间厚两头尖），
        // 身后拖一截由宽到窄、渐淡的剑光，再往后的路上留一线很淡的斩痕（慢慢淡掉）
        const L = lane.len;
        const ux = (c.x1 - c.x0) / L;
        const uy = (c.y1 - c.y0) / L;
        const hx = c.x0 + ux * head;
        const hy = c.y0 + uy * head;
        const lift = 4;
        const tail = 96;
        for (let d = 0; d < tail && head - d > 0; d += 1) {
          const k = 1 - d / tail;
          const a = k ** 1.4;
          const half = Math.round(2.5 * k);
          for (let o = -half; o <= half; o++) {
            const edge = Math.abs(o) === half && half > 0;
            g.rect(Math.round(hx - ux * d - uy * o), Math.round(hy - uy * d + ux * o - lift), 1, 1).fill({ color: d < 8 && !edge ? 0xffffff : edge ? 0x7cc4c4 : 0xc3ccd2, alpha: (edge ? 0.45 : 0.8) * a });
          }
        }
        // 斩痕：剑光过去之后的路上一线冷银，越远越淡
        for (let d = tail; d < tail + 220 && head - d > 0; d += 1) g.rect(Math.round(hx - ux * d), Math.round(hy - uy * d - lift), 1, 1).fill({ color: 0x8d9aa6, alpha: 0.28 * (1 - (d - tail) / 220) });
        const R = c.r + 2;
        for (let o = -R; o <= R; o += 0.5) {
          const u = o / R;
          const bend = (1 - u * u) * 4; // 刃口往前凸
          const thick = Math.max(1, Math.round((1 - Math.abs(u)) * 3)); // 中间厚、两头尖
          for (let j = 0; j < thick; j++) {
            const x = Math.round(hx - uy * o + ux * (bend - j));
            const y = Math.round(hy + ux * o + uy * (bend - j) - lift);
            g.rect(x, y, 1, 1).fill({ color: j === 0 ? 0xffffff : j === 1 ? 0xc3ccd2 : 0x7cc4c4, alpha: j === 0 ? 0.95 : 0.7 });
          }
        }
        v.sparkCd -= dt;
        if (v.sparkCd <= 0) {
          v.sparkCd = 0.03;
          this.glows.emit(hx, hy - 4, 2, SILVER, [10, 40], [0.15, 0.35], { drag: 3 });
          this.sparks.emit(hx, hy, 1, [0x8d9aa6, 0x5a6675], [10, 30], [0.2, 0.35], { up: 6, drag: 2 }); // 刮起的石屑
        }
      }
      return lane.done;
    }
    const fan = v.fan!;
    if (v.gone >= 0) fan.end(0.35);
    fan.draw(dt, k, head);
    if (struck && v.gone < 0) {
      // 一道从剑台伸出去的剑光扫过扇面：现在的那一道最亮（刃口霜白、外沿天青），身后十来道依次淡掉，像一片扇形的剑影
      const steps = 12;
      for (let j = 0; j < steps; j++) {
        const ang = c.a0 + c.dir * Math.max(0, head - j * 0.03);
        const a = (1 - j / steps) ** 1.6;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const step = j === 0 ? 1 : 2;
        for (let d = 14; d <= c.rad; d += step) {
          const fade = d > c.rad - 24 ? (c.rad - d) / 24 : 1;
          const x = Math.round(c.x0 + ux * d);
          const y = Math.round(c.y0 + uy * d - 4);
          g.rect(x, y, 1, 1).fill({ color: j === 0 ? 0xffffff : j < 3 ? 0xc3ccd2 : 0x7cc4c4, alpha: (j === 0 ? 0.95 : 0.6) * a * fade });
          if (j === 0) g.rect(Math.round(x - uy * c.dir), Math.round(y + ux * c.dir), 1, 1).fill({ color: 0x7cc4c4, alpha: 0.6 * fade });
        }
      }
      v.sparkCd -= dt;
      if (v.sparkCd <= 0) {
        v.sparkCd = 0.025;
        const ang = c.a0 + c.dir * head;
        const d = rnd(30, c.rad);
        this.glows.emit(c.x0 + Math.cos(ang) * d, c.y0 + Math.sin(ang) * d - 4, 1, SILVER, [10, 40], [0.15, 0.3], { drag: 3 });
      }
    }
    return fan.done;
  }

  /** 剑台上的四把剑：平时剑尖朝下悬着、慢慢上下浮，隔一阵一线寒光走过剑身；出鞘时升起、转向、发颤；斩完回到台上。 */
  private updateSwords(dt: number) {
    const tx = swordTex();
    this.swords.forEach((v, i) => {
      const [ax, ay] = SWORDS.altars[i];
      v.t += dt;
      v.bob += dt;
      if (v.hold > 0) {
        v.hold -= dt;
        v.dir = Math.atan2(270 - ay, 480 - ax);
        if (v.hold <= 0) {
          v.mode = 'home';
          v.t = 0;
        }
      }
      let lift = HOVER + Math.sin(v.bob * 2.1) * 1;
      let dirA = Math.PI / 2;
      let shakeX = 0;
      let tint = 0xffffff;
      if (v.mode === 'drawn' || v.mode === 'cut') {
        const k = ease(clamp01(v.t / 0.35));
        lift = HOVER + (RISE - HOVER) * k;
        dirA = v.dir;
        // 预警快完了，剑身微微发颤
        const c = v.cut >= 0 ? this.cuts.get(v.cut)?.c : undefined;
        if (v.mode === 'drawn' && c) shakeX = c.t > c.warn * 0.5 ? (Math.random() < 0.5 ? -1 : 1) * (c.t > c.warn * 0.8 ? 1 : 0.5) : 0;
        if (v.mode === 'cut' && c && c.kind === 'fan') dirA = c.a0 + c.dir * c.head; // 扇形：剑跟着剑光扫过去
        tint = 0xfff6e0;
      } else if (v.mode === 'home') {
        const k = ease(clamp01(v.t / 0.6));
        lift = RISE + (HOVER - RISE) * k;
        dirA = k < 0.5 ? v.dir : Math.PI / 2;
        if (k >= 1) v.mode = 'rest';
      }
      // 寒光：平时隔几秒一次，从剑尖走到护手（五帧）
      v.glint -= dt;
      if (v.glint <= 0 && v.glintT < 0) {
        v.glintT = 0;
        v.glint = 4 + Math.random() * 6;
      }
      let frame = 0;
      if (v.glintT >= 0) {
        v.glintT += dt;
        frame = 1 + Math.floor(v.glintT / 0.08);
        if (frame > 5) {
          frame = 0;
          v.glintT = -1;
        }
      }
      const d = v.mode === 'rest' ? SWORD_DOWN : swordDir(dirA);
      v.s.texture = tx[i][d % SWORD_DIRS][frame];
      v.s.tint = tint;
      v.s.position.set(Math.round(ax + shakeX), Math.round(ay - lift));
      v.sh.alpha = 0.22 - (lift - HOVER) * 0.008;
      // 出鞘、斩的时候剑身边飘几粒碎光（不是光圈）
      if (v.mode !== 'rest' && Math.random() < 0.25) this.glows.emit(ax + rnd(-4, 4), ay - lift + rnd(-6, 6), 1, v.mode === 'cut' ? SILVER : GOLD, [3, 10], [0.25, 0.45], { up: 6, drag: 2 });
    });
  }
}
