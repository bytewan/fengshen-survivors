// 宠物（回响敖丙 · 避水兽）的画面：贴地跑的青鳞水兽（待机、小跑、奔）、冲过敌群时身子两边掀开的浪（两道往外推的水沿、白沫）、
// 被打湿的敌人身上一直留着的「湿透」：头顶两三粒往下滴的水珠、脚下一小滩水（几粒天青的点，慢慢明灭），到时慢慢干掉。
// 只作用在表现层：读模拟状态（Pet、Enemy.soakUntil）和事件（splash、evolve）；模拟见 src/sim/pets/bishui.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小；不要光圈；出现消失有过程。
// 进化之后：怒涛——鬃和尾巴的水更亮（月白换成闪光）；霜髓——鳞上结一层霜（高光换成霜白）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { steady, steadyBand, steadyFace, type Steady } from './steady.ts';
import { grid, type Grid } from '../../art/pixel.ts';
import { BISHUI_ANCHOR, BISHUI_FRAMES, BISHUI_H, BISHUI_W, type BishuiPose } from '../../art/sprites/bishui.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, headOf, Pixels, rnd } from '../fx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { PetBranch, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

function palette(branch: PetBranch | null, stage: number): Record<string, string> {
  if (branch === 'surge' && stage >= 1) return { w: 'W' };
  if (branch === 'marrow' && stage >= 1) return stage >= 3 ? { C: 'Z', w: 'Z' } : { C: 'Z' };
  return {};
}
const recolor = (g: Grid, map: Record<string, string>): Grid => (Object.keys(map).length ? grid(g.rows.map((r) => [...r].map((c) => map[c] ?? c).join(''))) : g);

interface Beast {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  st: Steady; // 朝向、姿势的防抖（steady.ts）
  wakeCd: number;
  mode: string;
}
/** 冲过去掀开的一道浪：从 (x, y) 沿冲的方向的两侧往外推。 */
interface Wake {
  x: number;
  y: number;
  ux: number;
  uy: number;
  t: number;
  big: boolean;
}

const WATER = [C.Cc, C.c, C.w, C.W];

export class BishuiFx {
  private beasts = new Map<number, Beast>();
  private wakes: Wake[] = [];
  private tex = new Map<string, Record<BishuiPose, Texture[]>>();
  private floor = new Pixels();
  private marks = new Pixels();
  private seen = new Map<number, number>();
  private layer = new Container();
  private stage: Stage;
  private sparks: Particles;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.sfx = sfx;
    stage.floor.addChild(this.floor.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.marks.g);
  }

  private textures(branch: PetBranch | null, stage: number) {
    const key = `${branch ?? '-'}${stage}`;
    let t = this.tex.get(key);
    if (!t) {
      const map = palette(branch, stage);
      t = Object.fromEntries(Object.entries(BISHUI_FRAMES).map(([k, v]) => [k, v.map((g) => textureFromGrid(recolor(g, map)))])) as Record<BishuiPose, Texture[]>;
      this.tex.set(key, t);
    }
    return t;
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。兽本身留着，下一帧接着跑。 */
  clear() {
    this.wakes = [];
    this.seen.clear();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'bishui') return;
      this.play('bishui.evolve', 'pet.evolve');
      this.sparks.emit(p.pet.x, p.pet.y - 7, 14, WATER, [10, 40], [0.5, 0.9], { up: 26, drag: 2 });
      return;
    }
    if (e.t !== 'splash') return;
    this.wakes.push({ x: e.x, y: e.y, ux: e.ux, uy: e.uy, t: 0, big: e.branch === 'surge' });
    this.play('bishui.splash', 'elite.yecha.slap', 0.5);
    for (const id of e.ids) {
      const en = w.enemies.find((x) => x.id === id);
      if (!en) continue;
      // 打湿的那一下：身上溅起几粒水
      this.sparks.emit(en.x, en.y - headOf(en.kind) * 0.5, 5, WATER, [18, 50], [0.25, 0.45], { up: 20, g: 150, drag: 2 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (const p of w.players) {
      if (petKindOf(p) !== 'bishui' || p.left) {
        const b = this.beasts.get(p.id);
        if (b) b.s.visible = b.sh.visible = false;
        continue;
      }
      this.updateBeast(p.id, w, dt, alpha);
    }
    this.drawWakes(dt);
    this.drawSoak(dt, w, alpha);
  }

  private updateBeast(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let b = this.beasts.get(id);
    if (!b) {
      const s = new Sprite();
      s.anchor.set(BISHUI_ANCHOR.x / BISHUI_W, BISHUI_ANCHOR.y / BISHUI_H);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.35;
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      b = { s, sh, t: Math.random() * 3, face: p.facing, st: steady(p.facing), wakeCd: 0, mode: pet.mode };
      this.beasts.set(id, b);
    }
    const x = pet.px + (pet.x - pet.px) * alpha;
    const y = pet.py + (pet.y - pet.py) * alpha;
    const sp = Math.hypot(pet.vx, pet.vy);
    b.t += dt;
    b.face = steadyFace(b.st, pet.vx, sp, p.facing, dt) as 1 | -1; // 横向速度够大才转身、两次转身隔一会儿；停稳了才转去和主人朝同一边
    const band = steadyBand(b.st, sp, 16, 130, pet.mode === 'sweep', dt);
    const T = this.textures(pet.branch, Math.min(3, pet.stage));
    const pose: BishuiPose = band === 2 ? 'run' : band === 1 ? 'trot' : 'idle';
    const fr = T[pose];
    b.s.texture = fr[Math.floor(b.t * (pose === 'run' ? Math.max(10, sp / 16) : pose === 'trot' ? 7 + sp / 20 : 2.5)) % fr.length];
    b.s.scale.x = b.face;
    b.s.position.set(Math.round(x), Math.round(y));
    b.s.zIndex = Math.round(y);
    b.s.visible = b.sh.visible = true;
    b.sh.position.set(Math.round(x), Math.round(y));
    b.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    // 奔的时候蹄下溅水
    if (pet.mode === 'sweep' && sp > 110) {
      b.wakeCd -= dt;
      if (b.wakeCd <= 0) {
        b.wakeCd = 0.05;
        this.sparks.emit(x - b.face * 5, y, 1, WATER, [8, 24], [0.25, 0.45], { up: 14, g: 90, drag: 2 });
      }
    }
    if (pet.mode === 'sweep' && b.mode !== 'sweep') this.play('bishui.dash', 'pet.fly', 0.8);
    b.mode = pet.mode;
  }

  /** 掀开的浪：两道水沿从它冲过的那一点往两侧推出去（各一段弧形的沿：前沿白沫、后面两档水色），约 0.5 秒推到头、淡掉。 */
  private drawWakes(dt: number) {
    const F = this.floor;
    for (let i = this.wakes.length - 1; i >= 0; i--) {
      const k0 = this.wakes[i];
      k0.t += dt;
      const k = k0.t / 0.5;
      if (k >= 1) {
        this.wakes.splice(i, 1);
        continue;
      }
      const out = (k0.big ? 26 : 18) * (1 - (1 - k) * (1 - k));
      const a = 1 - k * k;
      for (const side of [-1, 1]) {
        const nx = -k0.uy * side;
        const ny = k0.ux * side;
        for (let s = -9; s <= 9; s++) {
          const bow = (1 - (s * s) / 81) * 4; // 中间鼓出去
          const x = k0.x + k0.ux * s + nx * (out + bow);
          const y = k0.y + k0.uy * s + ny * (out + bow) * 0.8;
          F.dot(x, y, s % 3 === 0 ? C.W : C.w, a);
          F.dot(x - nx, y - ny, C.Cc, a * 0.9);
          F.dot(x - nx * 2, y - ny * 2, C.c, a * 0.6);
        }
      }
    }
    F.flush();
  }

  /** 湿透：头顶两三粒往下滴的水珠、脚下一小滩水；打湿时 0.2 秒显出来，最后 0.6 秒干掉。 */
  private drawSoak(dt: number, w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.soakUntil === undefined || now >= e.soakUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      const a = clamp01((this.time - t0) / 0.2) * clamp01((e.soakUntil - now) / 0.6);
      const x = Math.round(e.px + (e.x - e.px) * alpha);
      const y = Math.round(e.py + (e.y - e.py) * alpha);
      const hd = headOf(e.kind);
      // 水珠：三粒，各自从头顶滴到胸口（相位错开）
      for (let j = 0; j < 3; j++) {
        const ph = (this.time * 1.4 + j * 0.37 + e.id * 0.13) % 1;
        const dx = (j - 1) * 3;
        px.dot(x + dx, y - hd + 1 + ph * hd * 0.55, ph < 0.15 ? C.W : C.Cc, a * (1 - ph * 0.5));
      }
      // 脚下一小滩：几粒贴地的水色
      for (let j = -3; j <= 3; j++) if ((j + e.id) % 2 === 0 || Math.abs(j) < 2) px.dot(x + j, y + 1, j % 2 ? C.c : C.Cc, a * (0.45 + 0.2 * Math.sin(this.time * 3 + j + e.id)));
      if (Math.random() < dt * 1.2) this.sparks.emit(x + rnd(-3, 3), y - hd * 0.6, 1, [C.Cc, C.w], [2, 8], [0.4, 0.6], { g: 120, drag: 1 });
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    px.flush();
  }
}
