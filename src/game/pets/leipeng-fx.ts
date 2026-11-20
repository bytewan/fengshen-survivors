// 宠物（雷震子 · 雷鹏）的画面：在主人身后高处盘着的雷鹏（扇翅，间或平展着滑一下），地上一个小影子（越高越淡）；
// 出手时先拔高，再一道闪电似的俯冲——收翅成一支箭，沿之字折线贴地掠过敌群，身后拖一截白金的电光（几帧就散）；
// 麻到的敌人：那一下从鹏身上劈下一小道电弧、迸几粒电火；之后头顶浮一枚小小的金色雷符（闪电形，一明一暗），
// 身上时不时窜一两粒电光；每一颤（twitch 事件）迸一小撮电火，霹雳把电传给身边一只时两只之间连一道细电弧。
// 只作用在表现层：读模拟状态（Pet 的 x / y / z / path、Enemy.numbUntil）和事件（stoop、zap、twitch、evolve）；模拟见 src/sim/pets/leipeng.ts。
// 用户口径：宠物只上减益、减益要看得见；宠物比人物小；不要光圈；出现消失有过程（雷符淡入淡出，电弧几帧里散掉）。
import { Container, Sprite } from 'pixi.js';
import { leipengFrames, PENG_PIVOT, type PengPose } from '../../art/sprites/leipeng.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { applyRot, C, clamp01, headOf, jag, Pixels, rnd, rotTex } from '../fx.ts';
import { petKindOf } from '../../sim/pet.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const SPARK = [C.W, C.f, C.Y];
const SPARK_CLAP = [C.W, C.L, C.f];

interface Bird {
  s: Sprite;
  sh: Sprite;
  t: number;
  face: 1 | -1;
  pitch: number;
  mode: string;
  stooping: boolean;
  trail: [number, number][];
}
/** 一道电弧（从 a 到 b 的锯齿折线），life 秒里闪几下散掉。 */
interface Arc {
  pts: [number, number][];
  t: number;
  life: number;
  clap: boolean;
}

export class LeipengFx {
  private birds = new Map<number, Bird>();
  private arcs: Arc[] = [];
  private marks = new Pixels();
  private seen = new Map<number, number>(); // 敌人 id → 第一次看到它麻着的时刻（雷符淡入用）
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

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 清空（重开一局、一波开始或结束时）。鸟本身留着，下一帧接着飞。 */
  clear() {
    this.arcs = [];
    this.seen.clear();
    this.marks.flush();
  }

  onEvent(e: SimEvent, w: World) {
    if (e.t === 'evolve') {
      const p = w.players[e.owner];
      if (!p || petKindOf(p) !== 'leipeng') return;
      this.play('leipeng.evolve', 'pet.evolve');
      // 进化：鹏身上一圈电光往外迸（不画圈）
      this.sparks.emit(p.pet.x, p.pet.y - (p.pet.z ?? 0), 16, e.branch === 'clap' ? SPARK_CLAP : SPARK, [15, 45], [0.4, 0.8], { drag: 2.5 });
      return;
    }
    if (e.t === 'stoop') {
      const p = w.players[e.owner];
      if (!p) return;
      this.play('leipeng.stoop', 'qingluan.dive', 0.7);
      return;
    }
    if (e.t === 'zap') {
      const p = w.players[e.owner];
      if (!p) return;
      const clap = e.branch === 'clap';
      // 从鹏身上劈下一小道电弧到每一只麻到的身上，迸几粒电火
      const bx = p.pet.x;
      const by = p.pet.y - (p.pet.z ?? 0);
      for (const id of e.ids) {
        const en = w.enemies.find((x) => x.id === id);
        if (!en) continue;
        const ey = en.y - headOf(en.kind) * 0.5;
        this.arcs.push({ pts: jag(bx, by, en.x, ey, 3, 3), t: 0, life: 0.22, clap });
        this.sparks.emit(en.x, ey, 5, clap ? SPARK_CLAP : SPARK, [20, 55], [0.2, 0.4], { drag: 3 });
      }
      this.play('leipeng.zap', 'react.conduct', 0.6);
      return;
    }
    if (e.t === 'twitch') {
      const en = w.enemies.find((x) => x.id === e.id);
      const hd = en ? headOf(en.kind) : 8;
      const clap = e.to !== undefined;
      this.sparks.emit(e.x + rnd(-2, 2), e.y - hd * 0.5, 3, clap ? SPARK_CLAP : SPARK, [10, 30], [0.15, 0.3], { drag: 3 });
      if (e.to !== undefined && e.tx !== undefined && e.ty !== undefined) {
        const t = w.enemies.find((x) => x.id === e.to);
        const th = t ? headOf(t.kind) : 8;
        this.arcs.push({ pts: jag(e.x, e.y - hd * 0.5, e.tx, e.ty - th * 0.5, 3, 3), t: 0, life: 0.25, clap: true });
      }
      this.play('leipeng.twitch', 'leigong.mark', 0.35);
    }
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    for (const p of w.players) {
      if (petKindOf(p) !== 'leipeng' || p.left) {
        const b = this.birds.get(p.id);
        if (b) b.s.visible = b.sh.visible = false;
        continue;
      }
      this.updateBird(p.id, w, dt, alpha);
    }
    this.drawArcs(dt);
    this.drawMarks(dt, w, alpha);
    this.marks.flush();
  }

  private updateBird(id: number, w: World, dt: number, alpha: number) {
    const p = w.players[id];
    const pet = p.pet;
    let b = this.birds.get(id);
    if (!b) {
      const s = new Sprite();
      const sh = new Sprite(this.stage.tex.smallShadow);
      sh.anchor.set(0.5);
      this.stage.entities.addChild(s);
      this.stage.floor.addChild(sh);
      b = { s, sh, t: Math.random() * 3, face: p.facing, pitch: 0, mode: pet.mode, stooping: false, trail: [] };
      this.birds.set(id, b);
    }
    const gx = pet.px + (pet.x - pet.px) * alpha;
    const gy = pet.py + (pet.y - pet.py) * alpha;
    const z = pet.z ?? 0;
    const x = gx;
    const y = gy - z;
    b.t += dt;
    const stoop = pet.mode === 'sweep' && !!pet.path;
    const rising = pet.mode === 'sweep' && !pet.path;
    if (Math.abs(pet.vx) > 6) b.face = pet.vx > 0 ? 1 : -1;
    else if (!stoop && pet.mode === 'follow') b.face = p.facing;
    // 俯仰：俯冲时按往下扑的快慢把头压下去（最多约 35°），拉起来时抬头；平时轻轻起伏
    const dz = stoop ? (b.trail.length ? y - b.trail[b.trail.length - 1][1] : 0) : 0;
    const want = stoop ? Math.max(-0.4, Math.min(0.6, dz * 0.12)) : rising ? -0.25 : 0;
    b.pitch += (want - b.pitch) * Math.min(1, dt * 10);
    const set = leipengFrames(pet.branch, Math.min(3, pet.stage));
    let pose: PengPose = 'fly';
    let fi: number;
    if (stoop) {
      pose = 'stoop';
      fi = Math.floor(b.t * 12) % 2;
    } else if (rising) fi = Math.floor(b.t * 16) % 4;
    else {
      // 盘着：慢慢扇，隔一会儿平展着滑一下
      const cyc = (b.t * 0.6) % 1;
      if (pet.mode === 'follow' && cyc > 0.62) pose = 'glide';
      fi = Math.floor(b.t * (pet.mode === 'return' ? 12 : 8)) % 4;
    }
    const g = set[pose][fi % set[pose].length];
    const key = `peng${pet.branch ?? '-'}${Math.min(3, pet.stage)}${pose}${fi}`;
    const ang = b.face > 0 ? b.pitch : Math.PI - b.pitch;
    applyRot(b.s, rotTex(key, g, ang, PENG_PIVOT.x, PENG_PIVOT.y, 48, undefined, true));
    b.s.position.set(Math.round(x), Math.round(y));
    b.s.zIndex = Math.round(gy); // 按正下方的地面排前后
    b.s.visible = b.sh.visible = true;
    b.sh.position.set(Math.round(gx), Math.round(gy));
    b.sh.alpha = 0.3 * (1 - Math.min(0.7, z / 50));
    b.s.tint = p.miasma > 0 ? 0xe0c8e8 : 0xffffff;
    // 俯冲：身后拖一截白金的电光（最近几帧的位置连成锯齿，几帧就散）
    if (stoop) {
      b.trail.push([x, y]);
      if (b.trail.length > 7) b.trail.shift();
      const clap = pet.branch === 'clap' && pet.stage >= 1;
      for (let i = 1; i < b.trail.length; i++) {
        const [x0, y0] = b.trail[i - 1];
        const [x1, y1] = b.trail[i];
        const a = (i / b.trail.length) * 0.8;
        const mx = (x0 + x1) / 2 + rnd(-1.5, 1.5);
        const my = (y0 + y1) / 2 + rnd(-1.5, 1.5);
        this.marks.line(x0, y0, mx, my, i > b.trail.length - 3 ? C.W : clap ? C.L : C.Y, a);
        this.marks.line(mx, my, x1, y1, i > b.trail.length - 3 ? C.W : C.f, a);
      }
    } else if (b.trail.length) b.trail = [];
    if (stoop && !b.stooping) this.sparks.emit(x, y, 4, SPARK, [10, 30], [0.2, 0.35], { drag: 3 });
    b.stooping = stoop;
    b.mode = pet.mode;
  }

  /** 电弧：锯齿折线，前几帧亮白、之后金色闪着散掉。 */
  private drawArcs(dt: number) {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt;
      if (a.t > a.life) {
        this.arcs.splice(i, 1);
        continue;
      }
      const k = a.t / a.life;
      const flick = Math.floor(a.t * 40) % 3 === 0 ? 0.5 : 1;
      const col = k < 0.3 ? C.W : a.clap ? C.L : C.Y;
      for (let j = 1; j < a.pts.length; j++) this.marks.line(a.pts[j - 1][0], a.pts[j - 1][1], a.pts[j][0], a.pts[j][1], col, (1 - k) * flick);
    }
  }

  /**
   * 麻痹：麻着的敌人头顶浮一枚小小的金色雷符（四像素高的闪电形，一明一暗；霹雳是葱黄的），刚麻上时淡入、最后半秒慢慢淡掉；
   * 身上时不时窜一两粒电光。首领也画（它只是走得慢一点，但身上照样带电）。
   */
  private drawMarks(dt: number, w: World, alpha: number) {
    const px = this.marks;
    const now = w.time;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.numbUntil === undefined || now >= e.numbUntil) continue;
      live.add(e.id);
      let t0 = this.seen.get(e.id);
      if (t0 === undefined) {
        t0 = this.time;
        this.seen.set(e.id, t0);
      }
      const ex = Math.round(e.px + (e.x - e.px) * alpha);
      const ey = Math.round(e.py + (e.y - e.py) * alpha);
      const hd = headOf(e.kind);
      const fadeIn = clamp01((this.time - t0) / 0.15);
      const fadeOut = clamp01((e.numbUntil - now) / 0.5);
      const clap = e.clapUntil !== undefined && now < e.clapUntil;
      const blink = 0.6 + 0.4 * Math.sin(this.time * 9 + e.id);
      const a = fadeIn * fadeOut * blink;
      // 雷符：一道小闪电（2 宽 4 高），浮在头顶上两像素
      const sx = ex + 1;
      const sy = ey - hd - 6 + Math.round(Math.sin(this.time * 3 + e.id) * 0.6);
      const hi = clap ? C.L : C.Y;
      px.dot(sx + 1, sy, hi, a);
      px.dot(sx, sy + 1, hi, a);
      px.dot(sx + 1, sy + 1, C.f, a);
      px.dot(sx, sy + 2, C.W, a);
      px.dot(sx - 1, sy + 3, hi, a);
      // 身上的电光：一两粒，一闪就灭
      if (Math.random() < dt * 7) {
        const rx = ex + rnd(-hd * 0.4, hd * 0.4);
        const ry = ey - rnd(1, hd * 0.9);
        px.dot(rx, ry, Math.random() < 0.5 ? C.W : C.f, 0.9 * fadeOut);
        px.dot(rx + (Math.random() < 0.5 ? 1 : -1), ry + 1, clap ? C.L : C.Y, 0.6 * fadeOut);
      }
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
  }
}
