// 宠物（孙悟空 · 毫毛猴）的画面：主人脚边的小金毛猴（蹲着甩尾巴、挠头，跟着主人蹦蹦跳跳），吹毫毛的那一下（拈一根毫毛凑到嘴边、鼓腮一吹，
// 几根金毫毛往前飞散），吹出来的小猴分身（亮一档的金色，一团金烟里蹦出来、贴地窜过敌群、身后落几粒金屑，窜完一团金烟、化回一根毫毛慢慢飘落），
// 被戏弄的敌人头上浮着的一个小小的金色问号（左右晃，最后淡掉；瞌睡虫那条路换成一只松绿的小虫绕着头飞）。敌人自己的东张西望、身子乱晃在 enemy-views.ts。
// 只作用在表现层：读模拟状态（Pet、Pet.imps、Enemy.teaseUntil）和事件（hair、tease、impEnd、evolve）；模拟见 src/sim/pets/maohou.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小得多；不要光圈；出现消失有过程（分身从金烟里出来、化回毫毛飘落；问号淡入淡出）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { steady, steadyBand, steadyFace, type Steady } from './steady.ts';
import { grid, type Grid } from '../../art/pixel.ts';
import { CLONE_COLORS, MONKEY_ANCHOR, MONKEY_FRAMES, MONKEY_H, MONKEY_W, type MonkeyPose } from '../../art/sprites/maohou.ts';
import { recolor } from '../../art/sprites/fx.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { Bits, C, clamp01, headOf, Pixels, puffSet, rnd, T } from '../fx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { Enemy, Imp, PetBranch, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

/** 进化之后的换色：定身法——头顶的毫毛换成朱红（念「定」的那道符的颜色）；瞌睡虫——毫毛换成松绿（瞌睡虫的颜色）。第 3 阶毛色再亮一档。 */
function palette(branch: PetBranch | null, stage: number): Record<string, string> {
  const m: Record<string, string> = {};
  if (branch === 'hold' && stage >= 1) m.y = 'e';
  if (branch === 'drowse' && stage >= 1) m.y = 'l';
  if (stage >= 3) Object.assign(m, { B: 'b', b: 'y' });
  return m;
}

/** 被戏弄的敌人头上的小问号（3×5）。 */
const QMARK = ['yy.', '..y', '.y.', '...', '.y.'];
/** 瞌睡虫（3×2，松绿，两只翅膀一扇一扇）。 */
const BUG = [
  ['l.l', '.v.'],
  ['...', 'lvl'],
];
/** 化回去的那根毫毛（1×4，藤黄，下端淡一点）。 */
const HAIR = grid(['Y', 'y', 'y', 'b']);

interface Monkey {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  st: Steady; // 朝向、姿势的防抖（steady.ts）
  sitT: number;
  mode: string;
  blowT: number; // 吹毫毛这一下过了多久（-1 = 没在吹）
}
interface ImpView {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  trailT: number;
}

export class MaohouFx {
  private monkeys = new Map<number, Monkey>();
  private imps = new Map<number, ImpView>();
  private tex = new Map<string, Record<MonkeyPose, Texture[]>>();
  private cloneTex: Record<MonkeyPose, Texture[]>;
  private marks = new Pixels();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它被戏弄的时刻（问号淡入用）
  private layer = new Container();
  private bits: Bits;
  private stage: Stage;
  private sparks: Particles;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.sfx = sfx;
    this.bits = new Bits(stage.fx, stage.entities);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.marks.g);
    this.cloneTex = conv(CLONE_COLORS);
  }

  private textures(branch: PetBranch | null, stage: number) {
    const key = `${branch ?? '-'}${stage}`;
    let t = this.tex.get(key);
    if (!t) {
      t = conv(palette(branch, stage));
      this.tex.set(key, t);
    }
    return t;
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。猴本身留着，下一帧接着跟。 */
  clear() {
    for (const v of this.imps.values()) {
      v.s.destroy();
      v.sh.destroy();
    }
    this.imps.clear();
    this.seen.clear();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'maohou') return;
      this.play('maohou.evolve', 'pet.evolve');
      // 进化：猴身上冒几粒金屑（定身法带两粒朱红、瞌睡虫带两粒松绿），不画圈
      const extra = e.branch === 'hold' ? [C.e] : e.branch === 'drowse' ? [C.l] : [];
      this.sparks.emit(p.pet.x, p.pet.y - 5, 12, [C.Y, C.f, C.W, ...extra], [10, 34], [0.5, 0.9], { up: 24, drag: 2 });
      return;
    }
    if (e.t === 'hair') {
      const m = this.monkeys.get(e.owner);
      if (m) m.blowT = 0;
      this.play('maohou.blow', 'dingfeng.gust', 0.45);
      // 吹出去的那一下：几根金毫毛从嘴边往前飞散；每只分身出来的地方冒一团金烟
      const dir = m?.face ?? 1;
      this.sparks.emit(e.x + dir * 3, e.y - 6, 6, [C.Y, C.y, C.f], [20, 50], [0.25, 0.45], { dir: dir > 0 ? 0 : Math.PI, spread: 0.7, drag: 3 });
      for (let k = 0; k < e.imps.length; k++)
        this.bits.spawn(e.x + rnd(-3, 3), e.y - 3, { frames: puffSet(3, 'gold', 1 + (k % 3)), life: rnd(0.35, 0.5), vx: rnd(-12, 12), vy: -rnd(4, 12), drag: 3, fadeIn: 0.03, fadeOut: 0.25, z: true, zOff: 1 });
      return;
    }
    if (e.t === 'tease') {
      this.play('maohou.tease', 'pet.wrap', 0.3);
      for (const id of e.ids) {
        const en = w.enemies.find((x) => x.id === id);
        if (!en) continue;
        // 被拍了一下：头上迸两三粒金屑（瞌睡虫那条路是松绿的）
        const cols = e.branch === 'drowse' ? [C.l, C.L, C.Y] : [C.Y, C.f, C.W];
        this.sparks.emit(en.x, en.y - headOf(en.kind), 3, cols, [15, 35], [0.2, 0.35], { up: 18, g: 100, drag: 2 });
      }
      return;
    }
    if (e.t === 'impEnd') {
      // 窜完了：一团金烟，化回一根毫毛，慢慢飘落、淡掉
      this.bits.spawn(e.x, e.y - 4, { frames: puffSet(3, 'gold', 1 + (e.imp % 3)), life: 0.45, vx: 0, vy: -6, drag: 3, fadeIn: 0.02, fadeOut: 0.3, z: true, zOff: 1 });
      this.bits.spawn(e.x, e.y - 8, { frames: [T('maohou.hair', () => HAIR)], life: 0.9, vx: rnd(-6, 6), vy: 8, drag: 1.5, fadeIn: 0.05, fadeOut: 0.5, z: true, zOff: 2 });
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const live = new Set<number>();
    for (const p of w.players) {
      if (petKindOf(p) !== 'maohou' || p.left) {
        const m = this.monkeys.get(p.id);
        if (m) m.s.visible = m.sh.visible = false;
        continue;
      }
      this.updateMonkey(p.id, w, dt, alpha);
      for (const imp of p.pet.imps ?? []) {
        live.add(imp.id);
        this.updateImp(imp, dt, alpha);
      }
    }
    for (const [id, v] of this.imps)
      if (!live.has(id)) {
        v.s.destroy();
        v.sh.destroy();
        this.imps.delete(id);
      }
    this.drawMarks(w, alpha);
    this.bits.update(dt);
  }

  private updateMonkey(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let m = this.monkeys.get(id);
    if (!m) {
      const s = new Sprite();
      s.anchor.set(MONKEY_ANCHOR.x / MONKEY_W, MONKEY_ANCHOR.y / MONKEY_H);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.alpha = 0.32;
      sh.scale.set(0.7);
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      m = { s, sh, t: Math.random() * 3, face: p.facing, st: steady(p.facing), sitT: 0, mode: pet.mode, blowT: -1 };
      this.monkeys.set(id, m);
    }
    const x = pet.px + (pet.x - pet.px) * alpha;
    const y = pet.py + (pet.y - pet.py) * alpha;
    const sp = Math.hypot(pet.vx, pet.vy);
    m.t += dt;
    m.face = steadyFace(m.st, pet.vx, sp, p.facing, dt) as 1 | -1; // 横向速度够大才转身、两次转身隔一会儿；停稳了才转去和主人朝同一边
    const band = steadyBand(m.st, sp, 18, Infinity, false, dt); // 毫毛猴只有蹲 / 蹦两档
    const T = this.textures(pet.branch, Math.min(3, pet.stage));
    let pose: MonkeyPose;
    let fi: number;
    let lift = 0;
    if (pet.mode === 'sweep') {
      // 站定吹毫毛：先拈毛凑到嘴边，吹的那一下（hair 事件）换鼓腮的那一帧
      pose = 'blow';
      fi = m.blowT >= 0 ? 1 : 0;
    } else if (m.blowT >= 0 && m.blowT < 0.25) {
      pose = 'blow';
      fi = 1;
    } else if (band >= 1) {
      // 蹦蹦跳跳地跟上：一蹦一落，腾空那一帧离地两三个像素
      pose = 'hop';
      const ph = (m.t * (5 + sp / 30)) % 1;
      fi = Math.floor(ph * 4) % 4;
      lift = Math.round(Math.sin(Math.PI * ph) * 3);
    } else {
      // 蹲着：尾巴慢慢甩；隔一会儿挠一下头
      pose = 'sit';
      m.sitT += dt;
      const c = m.sitT % 4.2;
      fi = c > 3.3 && c < 3.9 ? 3 : Math.floor(m.t * 1.6) % 2;
    }
    if (pose !== 'sit') m.sitT = 0;
    if (m.blowT >= 0) m.blowT += dt;
    if (m.blowT > 0.4) m.blowT = -1;
    const tex = T[pose];
    m.s.texture = tex[fi % tex.length];
    m.s.scale.x = m.face;
    m.s.position.set(Math.round(x), Math.round(y) - lift);
    m.s.zIndex = Math.round(y);
    m.s.visible = m.sh.visible = true;
    m.sh.position.set(Math.round(x), Math.round(y));
    m.sh.alpha = 0.32 - lift * 0.05;
    m.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    if (pet.mode === 'sweep' && m.mode !== 'sweep') m.blowT = -1;
    m.mode = pet.mode;
  }

  /** 一只分身：贴地窜，一蹦一蹦的（跑得快、帧换得快），身后落几粒金屑；从金烟里出来的那 0.1 秒由淡变实。 */
  private updateImp(imp: Imp, dt: number, alpha: number) {
    let v = this.imps.get(imp.id);
    if (!v) {
      const s = new Sprite();
      s.anchor.set(MONKEY_ANCHOR.x / MONKEY_W, MONKEY_ANCHOR.y / MONKEY_H);
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      sh.scale.set(0.6);
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      v = { s, sh, t: 0, face: imp.vx >= 0 ? 1 : -1, trailT: 0 };
      this.imps.set(imp.id, v);
    }
    v.t += dt;
    const x = imp.px + (imp.x - imp.px) * alpha;
    const y = imp.py + (imp.y - imp.py) * alpha;
    if (Math.abs(imp.vx) > 10) v.face = imp.vx > 0 ? 1 : -1;
    const ph = (v.t * 9) % 1;
    const lift = Math.round(Math.sin(Math.PI * ph) * 2);
    v.s.texture = this.cloneTex.hop[Math.floor(ph * 4) % 4];
    v.s.scale.x = v.face;
    v.s.position.set(Math.round(x), Math.round(y) - lift);
    v.s.zIndex = Math.round(y);
    v.s.alpha = clamp01(v.t / 0.1) * 0.92;
    v.sh.position.set(Math.round(x), Math.round(y));
    v.sh.alpha = 0.25 * clamp01(v.t / 0.1);
    v.trailT -= dt;
    if (v.trailT <= 0) {
      v.trailT = 0.06;
      this.sparks.emit(x - v.face * 3, y - 2, 1, [C.Y, C.y, C.f], [3, 10], [0.25, 0.4], { up: 4, drag: 3 });
    }
  }

  /**
   * 被戏弄的敌人头上的小问号：藤黄（下面垫一像素玄色的影子，深色、浅色的敌人头上都看得出），左右晃，0.15 秒淡入、最后 0.35 秒淡掉；
   * 瞌睡虫那条路换成一只松绿的小虫，绕着头慢慢飞（翅膀一扇一扇）。
   */
  private drawMarks(w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    const live = new Set<number>();
    const drowsy = w.players.some((p) => petKindOf(p) === 'maohou' && p.pet.branch === 'drowse' && p.pet.stage >= 1);
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.teaseUntil === undefined || now >= e.teaseUntil || e.kind === 'boss') continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      const age = this.time - t0;
      const a = clamp01(age / 0.15) * clamp01((e.teaseUntil - now) / 0.35);
      const ex = e.px + (e.x - e.px) * alpha;
      const ey = e.py + (e.y - e.py) * alpha - headOf(e.kind) - 8;
      if (drowsy) this.bug(ex, ey, e, a);
      else this.qmark(ex, ey, e, a);
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    px.flush();
  }

  private qmark(x: number, y: number, e: Enemy, a: number) {
    const px = this.marks;
    const x0 = Math.round(x - 1 + Math.sin(this.time * 6 + e.id) * 1.2);
    const y0 = Math.round(y);
    QMARK.forEach((row, yy) =>
      [...row].forEach((c, xx) => {
        if (c === '.') return;
        px.dot(x0 + xx, y0 + yy + 1, C.k, a * 0.6);
        px.dot(x0 + xx, y0 + yy, yy === 0 ? C.Y : C.y, a);
      }),
    );
  }

  private bug(x: number, y: number, e: Enemy, a: number) {
    const px = this.marks;
    const ang = this.time * 3 + e.id;
    const x0 = Math.round(x + Math.cos(ang) * 4 - 1);
    const y0 = Math.round(y + 3 + Math.sin(ang) * 1.5);
    const f = BUG[Math.floor(this.time * 10 + e.id) % 2];
    f.forEach((row, yy) =>
      [...row].forEach((c, xx) => {
        if (c === '.') return;
        px.dot(x0 + xx, y0 + yy, c === 'l' ? C.l : C.v, a);
      }),
    );
  }
}

/** 一套猴子的纹理（按换色表）。 */
function conv(map: Record<string, string>): Record<MonkeyPose, Texture[]> {
  return Object.fromEntries(Object.entries(MONKEY_FRAMES).map(([k, v]) => [k, v.map((g: Grid) => textureFromGrid(Object.keys(map).length ? recolor(g, map) : g))])) as Record<MonkeyPose, Texture[]>;
}
