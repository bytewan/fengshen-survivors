// 宠物（杨戬 · 哮天犬）的画面：贴地跑的细犬（待机、小跑、冲刺、咬）、冲刺时身后淡淡的残影和扬起的尘土、
// 咬上那一下嘴边一合、被咬的敌人身上一直留着的「破甲」爪痕（三道斜的裂痕，偶尔掉一粒甲屑）。
// 只作用在表现层：读模拟状态（Pet、Enemy.sunderUntil / fang）和事件（bite、evolve）；模拟见 src/sim/pets/xiaotian.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小；不要光圈；出现消失有过程。
// 进化之后毛色、项圈跟着变（狗是乌黑的细犬，见 art/sprites/xiaotian.ts）：天狗——项圈换成靛青、背脊的光泛雾蓝（三阶时泛天青、头顶一点月白，
// 像带着月色）；金牙——项圈换成金的，三阶时背脊的光也泛暗金、头顶一点缃。
import { Container, Sprite, type Texture } from 'pixi.js';
import { steady, steadyBand, steadyFace, type Steady } from './steady.ts';
import { grid, type Grid } from '../../art/pixel.ts';
import { HOUND_ANCHOR, HOUND_FRAMES, HOUND_H, HOUND_W, type HoundPose } from '../../art/sprites/xiaotian.ts';
import { flashTextureFromGrid, textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, headOf, Pixels, rnd } from '../fx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { Enemy, PetBranch, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 进化之后的换色（按分支和阶段）：项圈（r e）、金铃和眼（y）、背脊和头顶的光（X、T）。 */
function palette(branch: PetBranch | null, stage: number): Record<string, string> {
  if (branch === 'pounce' && stage >= 1) return stage >= 3 ? { r: 'N', e: 'n', X: 'C', T: 'w' } : { r: 'N', e: 'n', X: 'J' };
  if (branch === 'fang' && stage >= 1) return stage >= 3 ? { r: 'b', e: 'y', y: 'Y', X: 'U', T: 'Y' } : { r: 'b', e: 'y', y: 'Y' };
  return {};
}
const recolor = (g: Grid, map: Record<string, string>): Grid => (Object.keys(map).length ? grid(g.rows.map((r) => [...r].map((c) => map[c] ?? c).join(''))) : g);

interface Hound {
  s: Sprite;
  sh: Sprite;
  t: number; // 动画计时
  face: 1 | -1;
  st: Steady; // 朝向、姿势的防抖（steady.ts）
  bite: number; // 咬的那一下还剩多久（> 0 时用咬的帧）
  idleT: number; // 站着不动多久了（隔一会儿嗅一下、动一下耳朵）
  ghostCd: number;
  dustCd: number;
  mode: string;
  look: string; // 现在用的是哪一套换色（branch + stage）
}
interface Ghost {
  s: Sprite;
  t: number;
}
/** 咬上那一下：嘴边上下两道白牙一合（像素线），几粒白屑。 */
interface Snap {
  x: number;
  y: number;
  dir: number;
  t: number;
}

const BITE_T = 0.16;
const GHOST_LIFE = 0.2;

export class XiaotianFx {
  private hounds = new Map<number, Hound>();
  private ghosts: Ghost[] = [];
  private snaps: Snap[] = [];
  private tex = new Map<string, { n: Record<HoundPose, Texture[]>; f: Record<HoundPose, Texture[]> }>();
  /** 敌人身上的破甲爪痕、嘴边的一合：每帧重画的像素层。 */
  private marks = new Pixels();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它破甲的时刻（爪痕淡入用）
  private layer = new Container();
  private stage: Stage;
  private sparks: Particles;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.sfx = sfx;
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.marks.g);
  }

  private textures(branch: PetBranch | null, stage: number) {
    const key = `${branch ?? '-'}${stage}`;
    let t = this.tex.get(key);
    if (!t) {
      const map = palette(branch, stage);
      const conv = (f: (g: Grid) => Texture) => Object.fromEntries(Object.entries(HOUND_FRAMES).map(([k, v]) => [k, v.map((g) => f(recolor(g, map)))])) as Record<HoundPose, Texture[]>;
      t = { n: conv(textureFromGrid), f: conv(flashTextureFromGrid) };
      this.tex.set(key, t);
    }
    return t;
  }

  private play(name: string, fallback: string, vol = 1) {
    const n = BANK[name] ? name : fallback;
    this.sfx.play(n, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。狗本身留着，下一帧接着跑。 */
  clear() {
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
    this.snaps = [];
    this.seen.clear();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'xiaotian') return;
      this.play('xiaotian.evolve', 'pet.evolve');
      // 进化：狗身上升起几粒金光（不画圈）
      this.sparks.emit(p.pet.x, p.pet.y - 8, 14, [C.Y, C.f, C.W], [10, 40], [0.5, 0.9], { up: 26, drag: 2 });
      return;
    }
    if (e.t !== 'bite') return;
    const h = this.hounds.get(e.owner);
    if (h) h.bite = BITE_T;
    const pet = w.players[e.owner]?.pet;
    const dir = pet && Math.abs(pet.vx) > 1 ? Math.sign(pet.vx) : (h?.face ?? 1);
    this.snaps.push({ x: e.x, y: e.y - 5, dir, t: 0 });
    this.play('xiaotian.bite', 'pet.wrap', 1);
    for (const id of e.ids) {
      const en = w.enemies.find((x) => x.id === id);
      if (!en) continue;
      // 咬中的那一下：身上崩出几粒甲屑（银灰），天狗按住时脚下一圈尘
      const hd = headOf(en.kind);
      this.sparks.emit(en.x, en.y - hd * 0.5, 4, [C.W, C.j, C.i], [20, 55], [0.2, 0.4], { g: 160, drag: 2 });
      if (e.branch === 'pounce') this.sparks.emit(en.x, en.y, 5, [0x8f9787, 0xb3b8a6, C.j], [10, 30], [0.3, 0.5], { up: 6, drag: 3 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (const p of w.players) {
      if (petKindOf(p) !== 'xiaotian' || p.left) {
        const h = this.hounds.get(p.id);
        if (h) {
          h.s.visible = h.sh.visible = false;
        }
        continue;
      }
      this.updateHound(p.id, w, dt, alpha);
    }
    this.updateGhosts(dt);
    this.drawMarks(dt, w, alpha);
  }

  private updateHound(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let h = this.hounds.get(id);
    if (!h) {
      const s = new Sprite();
      s.anchor.set(HOUND_ANCHOR.x / HOUND_W, HOUND_ANCHOR.y / HOUND_H);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.35;
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      h = { s, sh, t: Math.random() * 3, face: p.facing, st: steady(p.facing), bite: 0, idleT: 0, ghostCd: 0, dustCd: 0, mode: pet.mode, look: '' };
      this.hounds.set(id, h);
    }
    const x = pet.px + (pet.x - pet.px) * alpha;
    const y = pet.py + (pet.y - pet.py) * alpha;
    const sp = Math.hypot(pet.vx, pet.vy);
    h.t += dt;
    h.bite = Math.max(0, h.bite - dt);
    h.face = steadyFace(h.st, pet.vx, sp, p.facing, dt) as 1 | -1; // 横向速度够大才转身、两次转身隔一会儿；停稳了才转去和主人朝同一边
    const band = steadyBand(h.st, sp, 16, 135, pet.mode === 'sweep', dt);
    const T = this.textures(pet.branch, Math.min(3, pet.stage));
    let pose: HoundPose;
    let fi: number;
    if (h.bite > 0) {
      pose = 'bite';
      fi = h.bite > BITE_T * 0.5 ? 0 : 1;
    } else if (band === 2) {
      pose = 'run';
      fi = Math.floor(h.t * Math.max(10, sp / 15)) % 4;
    } else if (band >= 1) {
      pose = 'trot';
      fi = Math.floor(h.t * (7 + sp / 18)) % 4;
    } else {
      pose = 'idle';
      h.idleT += dt;
      // 站着：尾巴慢慢摇；每隔三秒多嗅一下（低头）、动一下耳朵
      const c = h.idleT % 3.2;
      fi = c > 2.4 && c < 2.9 ? 2 : c > 2.95 ? 3 : Math.floor(h.t * 3) % 2;
    }
    if (pose !== 'idle') h.idleT = 0;
    const tex = T.n[pose];
    h.s.texture = tex[fi % tex.length];
    h.s.scale.x = h.face;
    h.s.position.set(Math.round(x), Math.round(y));
    h.s.zIndex = Math.round(y);
    h.s.visible = h.sh.visible = true;
    h.sh.position.set(Math.round(x), Math.round(y));
    // 和主人一样：在魔气里身上发暗一点
    h.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    // 冲刺：身后淡淡的残影（白色剪影着一点银灰，很快淡掉）、脚下扬起的尘土
    if (pet.mode === 'sweep' && sp > 120) {
      h.ghostCd -= dt;
      if (h.ghostCd <= 0) {
        h.ghostCd = 0.045;
        const g = new Sprite(T.f.run[fi % 4]);
        g.anchor.copyFrom(h.s.anchor);
        g.scale.x = h.face;
        g.position.copyFrom(h.s.position);
        g.zIndex = h.s.zIndex - 1;
        g.tint = pet.branch === 'fang' ? 0xf7dc7a : pet.branch === 'pounce' ? 0x9fd4d4 : 0x8d9aa6; // 冷银：乌黑的狗拖一道青灰的影
        g.alpha = 0.32;
        this.stage.entities.addChild(g);
        this.ghosts.push({ s: g, t: 0 });
      }
      h.dustCd -= dt;
      if (h.dustCd <= 0) {
        h.dustCd = 0.06;
        this.sparks.emit(x - h.face * 6, y, 1, [0x8f9787, 0xb3b8a6], [8, 22], [0.25, 0.45], { up: 8, drag: 3 });
      }
    }
    if (pet.mode === 'sweep' && h.mode !== 'sweep') this.play('xiaotian.dash', 'pet.fly', 0.8);
    h.mode = pet.mode;
  }

  private updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / GHOST_LIFE;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = 0.32 * (1 - k) * (1 - k);
    }
  }

  /**
   * 破甲的爪痕：被咬的敌人身上（胸口偏上）三道斜着的裂痕，亮的一道是月白、暗的是银鼠（金牙那条路是金的），
   * 一直留到破甲结束：咬上时 0.15 秒划开，最后 0.6 秒慢慢淡掉；偶尔从裂痕上掉一粒甲屑。嘴边一合也在这一层画。
   */
  private drawMarks(dt: number, w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.sunderUntil === undefined || now >= e.sunderUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      this.claw(e, this.time - t0, e.sunderUntil - now, alpha);
      if (Math.random() < dt * 1.6) {
        const hd = headOf(e.kind);
        this.sparks.emit(e.x + rnd(-2, 2), e.y - hd * 0.55, 1, e.fang ? [C.Y, C.y] : [C.j, C.i], [4, 12], [0.4, 0.7], { g: 90, drag: 1 });
      }
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    // 嘴边一合：上下两道白牙从张开到合上
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i];
      s.t += dt;
      const k = s.t / 0.22;
      if (k >= 1) {
        this.snaps.splice(i, 1);
        continue;
      }
      const open = 3 * (1 - clamp01(k / 0.5));
      const a = 1 - clamp01((k - 0.5) / 0.5);
      for (let j = 0; j < 4; j++) {
        const x = s.x + s.dir * (j - 1);
        px.dot(x, s.y - 1 - open + j * 0.3, C.W, a);
        px.dot(x, s.y + 1 + open - j * 0.3, C.W, a);
      }
    }
    px.flush();
  }

  /**
   * 一只敌人身上的三道爪痕（胸口上斜着往右下划的三道裂口，每道 6 像素长）：亮的月白（金牙那条路是缃金）、两头收成银鼠，
   * 裂口下沿一像素暗边，浅色的甲上、深色的衣服上都看得出。age 破甲多久了（0.15 秒划开），left 还剩多久（最后 0.6 秒淡掉）。
   */
  private claw(e: Enemy, age: number, left: number, alpha: number) {
    const px = this.marks;
    const x = Math.round(e.px + (e.x - e.px) * alpha);
    const y = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) * 0.55);
    const open = clamp01(age / 0.15);
    const a = clamp01(left / 0.6) * (0.88 + 0.12 * Math.sin(this.time * 6 + e.id));
    const hi = e.fang ? C.Y : C.W;
    const mid = e.fang ? C.y : C.w;
    const lo = e.fang ? C.b : C.i;
    for (let k = -1; k <= 1; k++) {
      const n = Math.max(1, Math.round(6 * open));
      const ox = x - 3 + k * 3;
      const oy = y - 3 + (k === 0 ? -1 : 0);
      for (let j = 0; j < n; j++) {
        const end = j === 0 || j === 5;
        px.dot(ox + j, oy + j, end ? lo : j % 2 ? hi : mid, a);
        px.dot(ox + j, oy + j + 1, C.k, a * 0.55);
      }
    }
  }
}
