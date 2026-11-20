// 宠物（赵公明 · 黑虎）的画面：贴地跑的黑虎（待机、小跑、扑、吼）、扑出去时脚下扬起的尘土、
// 吼的那一下：口前一道道断开的声浪往外推、地上的尘土往四周卷开（啸风那条路再加几道天青的风纹），
// 被震慑的敌人头上一直浮着的一枚小小的「王」字虎纹（吓得直抖，最后淡掉）、逃跑时脚下带起的尘。
// 只作用在表现层：读模拟状态（Pet、Enemy.fearUntil / broke）和事件（roar、broke、evolve）；模拟见 src/sim/pets/heihu.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小；不要光圈（声浪是断开的几截、贴地，不是一圈亮环）；出现消失有过程。
// 进化之后跟着变：啸风——肩胯上的青光泛石青、眼睛天青（三阶时背上整片泛黛蓝、王字天青）；破财——眼睛、额上的王字纹换成亮金。
import { Container, Sprite, type Texture } from 'pixi.js';
import { steady, steadyBand, steadyFace, type Steady } from './steady.ts';
import { grid, type Grid } from '../../art/pixel.ts';
import { TIGER_ANCHOR, TIGER_FRAMES, TIGER_H, TIGER_W, type TigerPose } from '../../art/sprites/heihu.ts';
import { textureFromGrid } from '../../render/textures.ts';
import { TIGER_TONE, tone } from '../../art/sprites/echo-tone.ts';
import { HERO_VIEWS } from '../hero-views.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { C, clamp01, GOLD_SPARKS, headOf, Pixels, rnd } from '../fx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { Enemy, PetBranch, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 进化之后的换色（按分支和阶段）：背上的受光、眼睛、王字纹。 */
function palette(branch: PetBranch | null, stage: number): Record<string, string> {
  // 黑虎的字母见 art/sprites/heihu.ts：n 肩胯上的青光、g 受光的毛、y 金眼、b / B 额上的王字
  if (branch === 'gale' && stage >= 1) return stage >= 3 ? { n: 'C', g: 'n', y: 'C', b: 'c', B: 'n' } : { n: 'c', y: 'C' };
  if (branch === 'broke' && stage >= 1) return stage >= 3 ? { y: 'Y', b: 'Y', B: 'y' } : { y: 'Y', b: 'y' };
  return {};
}
const recolor = (g: Grid, map: Record<string, string>): Grid => (Object.keys(map).length ? grid(g.rows.map((r) => [...r].map((c) => map[c] ?? c).join(''))) : g);

/** 「王」字虎纹（5×5）：被震慑的敌人头上浮着的那一枚。 */
const WANG = ['bbbbb', '..b..', '.bbb.', '..b..', 'bbbbb'];

interface Tiger {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  st: Steady; // 朝向、姿势的防抖（steady.ts）
  roar: number; // 吼的那一下还剩多久（> 0 时用吼的帧）
  idleT: number;
  dustCd: number;
  mode: string;
}
/** 一声吼的画面：声浪（几截断开的弧，从口前往外推）、地上卷开的尘（粒子，发出去就不管了）。 */
interface Roar {
  x: number;
  y: number;
  r: number;
  dir: number; // 黑虎朝哪边（声浪往前推得更远一点）
  t: number;
  gale: boolean;
  seed: number;
}

const ROAR_T = 0.32;
const ROAR_LIFE = 0.6;

export class HeihuFx {
  private tigers = new Map<number, Tiger>();
  private roars: Roar[] = [];
  private tex = new Map<string, Record<TigerPose, Texture[]>>();
  /** 被震慑的敌人头上的王字纹、声浪：每帧重画的像素层。 */
  private marks = new Pixels();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它被震慑的时刻（王字纹淡入用）
  private dust = new Map<number, number>(); // 敌人 id → 逃跑时下一粒尘还要多久
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

  /** dark：回响赵公明的魂虎（同一只虎换成回响色，art/sprites/echo-tone.ts；进化的配色换完再换一遍）。 */
  private textures(branch: PetBranch | null, stage: number, dark = false) {
    const key = `${branch ?? '-'}${stage}${dark ? 'd' : ''}`;
    let t = this.tex.get(key);
    if (!t) {
      const map = palette(branch, stage);
      const look = (g: Grid) => (dark ? tone(recolor(g, map), TIGER_TONE) : recolor(g, map));
      const conv = (f: (g: Grid) => Texture) => Object.fromEntries(Object.entries(TIGER_FRAMES).map(([k, v]) => [k, v.map((g) => f(look(g)))])) as Record<TigerPose, Texture[]>;
      t = conv(textureFromGrid);
      this.tex.set(key, t);
    }
    return t;
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。虎本身留着，下一帧接着跑。 */
  clear() {
    this.roars = [];
    this.seen.clear();
    this.dust.clear();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'heihu') return;
      this.play('heihu.evolve', 'pet.evolve');
      // 进化：虎身上升起几粒金光（破财）/ 天青的风屑（啸风），不画圈
      const cols = e.branch === 'gale' ? [C.Cc, C.w, C.c] : [C.Y, C.f, C.W];
      this.sparks.emit(p.pet.x, p.pet.y - 8, 14, cols, [10, 40], [0.5, 0.9], { up: 26, drag: 2 });
      return;
    }
    if (e.t === 'broke') {
      // 破财：被吓死的敌人身上蹦出一颗灵石 —— 先迸一小撮金屑
      this.sparks.emit(e.x, e.y - 8, 7, GOLD_SPARKS, [20, 55], [0.25, 0.5], { up: 30, g: 120, drag: 2 });
      this.play('heihu.broke', 'pickup.hi', 0.5);
      return;
    }
    if (e.t !== 'roar') return;
    const t = this.tigers.get(e.owner);
    if (t) t.roar = ROAR_T;
    const pet = w.players[e.owner]?.pet;
    const dir = pet && Math.abs(pet.vx) > 1 ? Math.sign(pet.vx) : (t?.face ?? 1);
    const gale = e.branch === 'gale';
    this.roars.push({ x: e.x + dir * 8, y: e.y - 7, r: e.r, dir, t: 0, gale, seed: Math.random() * 100 }); // 声浪从口前出来（虎的口鼻在锚点前 8、离地 7）
    this.play('heihu.roar', 'boss.roar', 0.35);
    // 地上的尘往四周卷开（贴地、往外跑，吼声越大卷得越远）
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd(-0.2, 0.2);
      const d = rnd(0.25, 0.55) * e.r;
      this.sparks.emit(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.8, 1, [0x6b5749, 0x776672, 0xb3b8a6], [e.r * 0.9, e.r * 1.5], [0.35, 0.6], { dir: a, spread: 0.3, drag: 4 });
    }
    if (gale) this.sparks.emit(e.x, e.y - 4, 8, [C.Cc, C.w], [40, 80], [0.3, 0.5], { drag: 3 });
    // 被吓住的那一下：头上崩出两三粒冷汗似的白屑
    for (const id of e.ids) {
      const en = w.enemies.find((x) => x.id === id);
      if (!en) continue;
      const hd = headOf(en.kind);
      this.sparks.emit(en.x, en.y - hd, 2, [C.W, C.Cc], [15, 35], [0.2, 0.35], { up: 20, g: 120, drag: 2 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (const p of w.players) {
      if (petKindOf(p) !== 'heihu' || p.left) {
        const t = this.tigers.get(p.id);
        if (t) t.s.visible = t.sh.visible = false;
        continue;
      }
      this.updateTiger(p.id, w, dt, alpha);
    }
    this.drawMarks(dt, w, alpha);
  }

  private updateTiger(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let t = this.tigers.get(id);
    if (!t) {
      const s = new Sprite();
      s.anchor.set(TIGER_ANCHOR.x / TIGER_W, TIGER_ANCHOR.y / TIGER_H);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.38;
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      t = { s, sh, t: Math.random() * 3, face: p.facing, st: steady(p.facing), roar: 0, idleT: 0, dustCd: 0, mode: pet.mode };
      this.tigers.set(id, t);
    }
    const x = pet.px + (pet.x - pet.px) * alpha;
    const y = pet.py + (pet.y - pet.py) * alpha;
    const sp = Math.hypot(pet.vx, pet.vy);
    t.t += dt;
    t.roar = Math.max(0, t.roar - dt);
    t.face = steadyFace(t.st, pet.vx, sp, p.facing, dt) as 1 | -1; // 横向速度够大才转身、两次转身隔一会儿；停稳了才转去和主人朝同一边
    const band = steadyBand(t.st, sp, 16, 130, pet.mode === 'sweep', dt);
    const T = this.textures(pet.branch, Math.min(3, pet.stage), HERO_VIEWS[p.hero].petTint === 'dark');
    let pose: TigerPose;
    let fi: number;
    if (t.roar > 0) {
      pose = 'roar';
      fi = t.roar > ROAR_T * 0.45 ? 0 : 1;
    } else if (band === 2) {
      pose = 'run';
      fi = Math.floor(t.t * Math.max(10, sp / 16)) % 4;
    } else if (band >= 1) {
      pose = 'trot';
      fi = Math.floor(t.t * (6 + sp / 20)) % 4;
    } else {
      pose = 'idle';
      t.idleT += dt;
      // 卧着不动：尾巴慢慢甩；隔一会儿喘一口气、抬一下头
      const c = t.idleT % 3.6;
      fi = c > 2.6 && c < 3.1 ? 2 : c > 3.15 ? 3 : Math.floor(t.t * 2.4) % 2;
    }
    if (pose !== 'idle') t.idleT = 0;
    const tex = T[pose];
    t.s.texture = tex[fi % tex.length];
    t.s.scale.x = t.face;
    t.s.position.set(Math.round(x), Math.round(y));
    t.s.zIndex = Math.round(y);
    t.s.visible = t.sh.visible = true;
    t.sh.position.set(Math.round(x), Math.round(y));
    t.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    // 扑：脚下扬起尘土（不拖残影：虎扑得沉，不飘）
    if (pet.mode === 'sweep' && sp > 110) {
      t.dustCd -= dt;
      if (t.dustCd <= 0) {
        t.dustCd = 0.05;
        this.sparks.emit(x - t.face * 8, y, 2, [0x6b5749, 0x776672, 0xb3b8a6], [10, 26], [0.3, 0.5], { up: 9, drag: 3 });
      }
    }
    if (pet.mode === 'sweep' && t.mode !== 'sweep') this.play('heihu.dash', 'pet.fly', 0.7);
    t.mode = pet.mode;
  }

  /**
   * 每帧重画：吼声的声浪（三道从口前往外推的断弧，前面推得远、背后淡），
   * 被震慑的敌人头上的「王」字虎纹（淡入、直抖、最后 0.35 秒淡掉；破财那条路是亮金的，偶尔往下掉一粒金屑），逃跑时脚下的尘。
   */
  private drawMarks(dt: number, w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    // 声浪
    for (let i = this.roars.length - 1; i >= 0; i--) {
      const r = this.roars[i];
      r.t += dt;
      if (r.t >= ROAR_LIFE) {
        this.roars.splice(i, 1);
        continue;
      }
      for (let j = 0; j < 3; j++) {
        const k = clamp01((r.t - j * 0.09) / (ROAR_LIFE - 0.2));
        if (k <= 0 || k >= 1) continue;
        const rad = 4 + (r.r - 4) * (1 - (1 - k) ** 2);
        const a = (1 - k * k) * (j === 0 ? 0.85 : 0.6);
        const n = Math.max(16, Math.round(rad * Math.PI * 2)); // 一像素一点：断开的是几截弧，不是稀疏的点
        for (let s = 0; s < n; s++) {
          const ang = (s / n) * Math.PI * 2;
          const front = Math.cos(ang) * r.dir; // 1 = 正前方
          // 断开：每圈几截缺口（按种子错开），背后的一半更淡、更短
          const gap = Math.sin(ang * 5 + r.seed + j * 1.7) > 0.35;
          if (gap || front < -0.55) continue;
          const aa = a * (0.45 + 0.55 * clamp01((front + 0.55) / 1.2));
          // 墨色的声浪（浅色的仙台、黄土地上都压得住），每三点一粒亮的；啸风那条路是天青的风
          const col = r.gale ? (s % 3 ? C.c : C.Cc) : s % 3 ? C.g : C.h;
          const x = r.x + Math.cos(ang) * rad;
          const y = r.y + Math.sin(ang) * rad * 0.62;
          px.dot(x, y, col, aa);
          // 里面再淡一圈（声浪有一点厚度，不是一道细线）
          px.dot(r.x + Math.cos(ang) * (rad - 1.5), r.y + Math.sin(ang) * (rad - 1.5) * 0.62, r.gale ? C.w : C.i, aa * 0.45);
        }
      }
    }
    // 王字纹
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.fearUntil === undefined || now >= e.fearUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      this.wang(e, this.time - t0, e.fearUntil - now, alpha);
      // 逃跑时脚下带起一点尘
      if (e.stun <= 0) {
        const cd = (this.dust.get(e.id) ?? rnd(0, 0.12)) - dt;
        if (cd <= 0) {
          this.dust.set(e.id, 0.14);
          this.sparks.emit(e.x - (e.fearDx ?? 0) * 3, e.y, 1, [0x776672, 0xb3b8a6], [6, 14], [0.25, 0.4], { up: 6, drag: 3 });
        } else this.dust.set(e.id, cd);
      }
      if (e.broke && Math.random() < dt * 1.3) this.sparks.emit(e.x + rnd(-3, 3), e.y - headOf(e.kind) * 0.5, 1, [C.Y, C.y], [4, 10], [0.4, 0.6], { g: 140, drag: 1 });
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    for (const id of this.dust.keys()) if (!live.has(id)) this.dust.delete(id);
    px.flush();
  }

  /**
   * 一只敌人头上的王字纹：5×5，琥珀（破财是藤黄 / 缃），下面垫一像素玄色的影子，深色、浅色的敌人头上都看得出。
   * age 被震慑多久了（0.12 秒淡入、从上面落下来一点），left 还剩多久（最后 0.35 秒淡掉）；吓得左右直抖（一像素）。
   */
  private wang(e: Enemy, age: number, left: number, alpha: number) {
    const px = this.marks;
    const x0 = Math.round(e.px + (e.x - e.px) * alpha) - 2 + (Math.floor(this.time * 14 + e.id) % 2 ? 1 : 0);
    const y0 = Math.round(e.py + (e.y - e.py) * alpha - headOf(e.kind) - 8 + 2 * (1 - clamp01(age / 0.12)));
    const a = clamp01(age / 0.12) * clamp01(left / 0.35);
    const hi = e.broke ? C.Y : C.y;
    const mid = e.broke ? C.y : C.b;
    WANG.forEach((row, yy) =>
      [...row].forEach((c, xx) => {
        if (c === '.') return;
        px.dot(x0 + xx, y0 + yy + 1, C.k, a * 0.6);
        px.dot(x0 + xx, y0 + yy, yy === 0 ? hi : mid, a);
      }),
    );
  }
}
