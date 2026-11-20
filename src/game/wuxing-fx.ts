// 五行三件档的画面（表现层；机制在 sim/wuxing.ts）：金「斩杀」迸出的金气、木「生生不息」的藤蔓、土「不动如山」的震地。
// 读事件（wx）和敌人身上的状态（Enemy.tangleUntil：藤蔓缠到什么时候），只作用在表现层；接口仿照 relic-fx.ts：onEvent / update / clear，
// 自己认得「换了一局」（world 换了）就清空。联机时镜像世界里同样有 tangleUntil，藤蔓照样画得出来。
// 用户口径：小、克制，不画发光圆圈 / 光圈 / 光晕，人物身上什么都不加；出现和消失都有过程，不要一闪而过。
//   金气：一道金色月牙从被斩的那只飞向下一只（0.26 秒，身后拖两道残影），一路落几粒金屑，落点留一道斜斩痕慢慢淡掉；
//   藤蔓：两股青藤绕着被缠的敌人的腿往上盘（前亮后暗、隔段一片叶、顶上卷须，四帧长出来、叶子摆），缠多久留多久，
//         到时枯成赭色、往下缩、掉两片枯叶淡掉；倒下的地方迸几片叶子；
//   震地：以人物为心，一圈土块、尘沫贴着地往外推（像土浪，不是一道圆线），蹦一下落回地面；
//         浪头推到的地方鼓起几团石色的尘，推过的地上裂开几道短缝、慢慢淡掉。
//   （2026-11-12 fxpolish：用户「这些特效都不能廉价」，加了残影、盘绕的藤、尘团和地裂。）
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, outline, type Grid } from '../art/pixel.ts';
import { puffSet } from './fx.ts';
import { textureFromGrid } from '../render/textures.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { BANK } from '../audio/bank.ts';
import type { Enemy, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const TAU = Math.PI * 2;
const GOLD = [0xf7dc7a, 0xe0a83a, 0xffe9a8];

function pad(g: Grid): Grid {
  const blank = '.'.repeat(g.w + 2);
  return { w: g.w + 2, h: g.h + 2, rows: [blank, ...g.rows.map((r) => `.${r}.`), blank] };
}
const tex = (rows: string[], edge: string) => textureFromGrid(outline(pad(grid(rows)), edge));

// ---------------------------------------------------------------- 像素图

/** 金气：一弯月牙（月白的刃口、灵光、缃与琥珀的身，背上一线藤黄），飞的方向朝右；描赭色（地面是浅色的玉台，纯金色的会化在地上看不见）。11×9。 */
const BLADE = ['..byY......', '....byYY...', '......bYYf.', '.......yYWW', '.......yfWW', '.......yYWW', '......bYYf.', '....byYY...', '..byY......'];
/** 斩痕：一道斜的细痕（两帧：亮、暗），8×8。 */
const SCAR = [
  ['.......W', '......fY', '.....fY.', '....fY..', '...fY...', '..fY....', '.yY.....', 'yy......'],
  ['.......Y', '......yb', '.....yb.', '....yb..', '...yb...', '..yb....', '.bb.....', 'b.......'],
];
/**
 * 藤蔓（2026-11-12 fxpolish 重画：原来是脚边左右各一株 6×9 的小苗，像插在地上的两根草）：
 * 两股青藤绕着腿往上盘（螺旋，转到前面的一段亮、绕到后面的一段压暗），隔一段长一片叶子，顶上一个卷须。
 * grow 0..1 长到哪；sway 0/1 叶子摆的两帧；dry = 枯了（松绿 → 赭、琥珀）。13×12，脚在底边中间。
 */
function vineGrid(grow: number, sway: number, dry: boolean): Grid {
  const W = 13;
  const H = 12;
  const rows: string[][] = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x: number, y: number, ch: string, over = false) => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= W || Y >= H) return;
    if (over || rows[Y][X] === '.') rows[Y][X] = ch;
  };
  const C = dry ? { front: 'b', back: 'B', leaf: 'y', leaf2: 'b', tip: 'Y' } : { front: 'l', back: 'v', leaf: 'L', leaf2: 'l', tip: 'L' };
  for (const ph of [0, Math.PI]) {
    let n = 0;
    for (let u = 0; u <= grow; u += 0.015) {
      const ang = ph + u * Math.PI * 2.6;
      const r = 4.6 - u * 1.4;
      const x = 6 + Math.sin(ang) * r;
      const y = H - 1 - u * (H - 2);
      const front = Math.cos(ang) > 0;
      if (!front && Math.round(u * 66) % 2) continue; // 绕到后面的一段隔点画（藏在腿后、只露一点）
      put(x, y, front ? C.front : C.back, front);
      // 叶子：隔一段，长在前面那一侧，朝外
      if (front && ++n % 9 === 4) {
        const out = Math.sin(ang) > 0 ? 1 : -1;
        put(x + out, y - 1 + sway, C.leaf, true);
        put(x + out * 2, y - 1, C.leaf2, true);
      }
    }
    // 顶上的卷须
    if (grow > 0.9) {
      const ang = ph + grow * Math.PI * 2.6;
      const x = 6 + Math.sin(ang) * 3.4;
      put(x, 1, C.tip, true);
      put(x + (Math.sin(ang) > 0 ? 1 : -1), 0, C.tip, true);
    }
  }
  return { w: W, h: H, rows: rows.map((r) => r.join('')) };
}
const VINE_STEPS = [0.25, 0.5, 0.75, 1];
/** 叶片、土块、尘沫：小尘（芯 + 同色系深边，浅色地面上也看得清）。 */
const MOTES: Record<string, [string[], string]> = {
  leaf: [['lL'], 'v'],
  leaf2: [['l'], 'G'],
  gold: [['Y'], 'b'],
  clod: [['AaE', 'DAa', '.D.'], 'B'],
  mound: [['..aE...', '.AaaE..', 'AAaaaE.', 'DDAAAAD'], 'B'], // 土浪的浪头：一小堆往外推的土
  clod2: [['E'], 'D'],
  dust: [['E'], 'A'],
};

/** 震地的地裂：几种短的折线裂纹（赭黑的缝、黄土翻起的唇），从中心往外摆；描边不要。 */
const CRACKS = [
  ['D......', 'aDD....', '..aDD..', '....aDD', '......a'],
  ['DD.....', '.aD....', '..aDDD.', '.....aD'],
  ['D.....', '.D....', '.aDD..', '...aD.', '....aD'],
];

// ---------------------------------------------------------------- 状态

interface Bit {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // 离地高度（土块蹦起来）
  vz: number;
  g: number;
  drag: number;
  t: number;
  life: number;
  fadeIn: number;
}
interface Blade {
  s: Sprite;
  t: number;
  dur: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  trail: number;
  echo: Sprite[]; // 身后两道残影
}
/** 一个放完就收的小动画（地裂、尘团）：帧、延迟、寿命、淡出。 */
interface Anim {
  s: Sprite;
  frames: Texture[] | null;
  t: number;
  delay: number;
  life: number;
  fadeIn: number;
  fadeOut: number;
  peak: number;
}
interface Scar {
  s: Sprite;
  t: number;
  life: number;
}
interface Vine {
  s: Sprite;
  t: number; // 长出来以后多久
  wither: number; // 开始枯了多久（-1 = 还没）
}

export class WuxingFx {
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private layer = new Container();
  private bits: Bit[] = [];
  private blades: Blade[] = [];
  private scars: Scar[] = [];
  private anims: Anim[] = [];
  private floor = new Container();
  private vines = new Map<number, Vine>();
  private world: World | null = null;
  private alpha = 1;
  private moteTex: Record<string, Texture> = {};
  private bladeTex: Texture;
  private scarTex: Texture[];
  private vineTex: Texture[]; // 长的四帧（最后一帧之后两帧摆动）
  private vineSway: Texture[];
  private vineDry: Texture[];
  private crackTex: Texture[];
  /** 调试：每种 wx 事件收到过几次（截图脚本看接没接上）。 */
  readonly seen: Record<string, number> = {};

  constructor(stage: Stage, sparks: Particles, shake: Shake, sfx: Sfx) {
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    for (const [k, [rows, edge]] of Object.entries(MOTES)) this.moteTex[k] = tex(rows, edge);
    this.bladeTex = tex(BLADE, 'B');
    this.scarTex = SCAR.map((r) => tex(r, 'B'));
    const vt = (g: Grid, _edge: string) => textureFromGrid(pad(g)); // 不描边：一像素的藤、描了边就成了一团
    this.vineTex = VINE_STEPS.map((k) => vt(vineGrid(k, 0, false), 'G'));
    this.vineSway = [0, 1].map((sw) => vt(vineGrid(1, sw, false), 'G'));
    this.vineDry = [1, 0.6, 0.3].map((k) => vt(vineGrid(k, 0, true), 'B'));
    this.crackTex = CRACKS.map((r) => tex(r, '.'));
    stage.fx.addChild(this.layer);
    stage.floor.addChild(this.floor);
    (globalThis as unknown as { __wuxingFx?: WuxingFx }).__wuxingFx = this;
  }

  private play(name: string, vol = 1) {
    if (BANK[name]) this.sfx.play(name, vol);
  }

  clear() {
    for (const b of this.bits) b.s.destroy();
    this.bits = [];
    for (const b of this.blades) {
      b.s.destroy();
      for (const g of b.echo) g.destroy();
    }
    this.blades = [];
    for (const s of this.scars) s.s.destroy();
    this.scars = [];
    for (const a of this.anims) a.s.destroy();
    this.anims = [];
    for (const v of this.vines.values()) v.s.destroy();
    this.vines.clear();
  }

  private sprite(t: Texture, x: number, y: number, ax = 0.5, ay = 0.5) {
    const s = new Sprite(t);
    s.anchor.set(ax, ay);
    s.position.set(Math.round(x), Math.round(y));
    this.layer.addChild(s);
    return s;
  }

  private bit(kind: string, x: number, y: number, vx: number, vy: number, life: number, o: { vz?: number; g?: number; drag?: number; fadeIn?: number } = {}) {
    const s = this.sprite(this.moteTex[kind], x, y);
    s.alpha = 0;
    this.bits.push({ s, x, y, vx, vy, z: 0, vz: o.vz ?? 0, g: o.g ?? 0, drag: o.drag ?? 3, t: 0, life, fadeIn: o.fadeIn ?? 0.05 });
  }

  onEvent(e: SimEvent, w: World) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    if (e.t !== 'wx') return;
    this.seen[e.kind] = (this.seen[e.kind] ?? 0) + 1;
    if (e.kind === 'jinqi') {
      for (const [x1, y1] of e.pts ?? []) {
        const rot = Math.atan2(y1 - e.y, x1 - e.x);
        const echo = [0.45, 0.2].map(() => {
          const g = this.sprite(this.bladeTex, e.x, e.y - 9);
          g.rotation = rot;
          g.alpha = 0;
          return g;
        });
        const s = this.sprite(this.bladeTex, e.x, e.y - 9);
        s.rotation = rot;
        s.alpha = 0;
        this.blades.push({ s, t: 0, dur: 0.26, x0: e.x, y0: e.y - 9, x1, y1: y1 - 9, trail: 0, echo });
      }
      this.sparks.emit(e.x, e.y - 9, 4, GOLD, [20, 45], [0.25, 0.4], { drag: 3 });
      this.play('jinjiao.snip', 0.55);
    } else if (e.kind === 'vine') {
      // 倒下的地方迸几片叶子，朝着被缠的那几只飘过去一点
      for (const [x1, y1] of e.pts ?? []) {
        const a = Math.atan2(y1 - e.y, x1 - e.x);
        for (let k = 0; k < 2; k++) this.bit(k ? 'leaf2' : 'leaf', e.x, e.y - 4, Math.cos(a + rnd(-0.4, 0.4)) * rnd(30, 55), Math.sin(a + rnd(-0.4, 0.4)) * rnd(20, 40), rnd(0.45, 0.65), { vz: rnd(20, 40), g: 120 });
      }
      this.play('qinglian.thorn', 0.45);
    } else if (e.kind === 'quake') {
      // 土浪：一圈土块和尘沫贴着地往外推，蹦一下落回地面；外圈稀、里圈密，角度和快慢错开（不连成一道圆线）
      const r = e.r ?? 56;
      // 浪头：一圈小土堆往外推，推到快到半径时沉下去
      const m = e.tier >= 4 ? 14 : 11;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * TAU + rnd(-0.1, 0.1);
        const r0 = r * 0.28;
        const sp = r * rnd(1.8, 2.1);
        this.bit('mound', e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0 * 0.6, Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rnd(0.5, 0.6), { drag: 2.6, fadeIn: 0.04 });
      }
      const n = e.tier >= 4 ? 26 : 20;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.12, 0.12);
        const r0 = r * rnd(0.18, 0.3);
        const sp = (r - r0) * rnd(1.6, 2.1); // 约 0.45 秒推到半径
        const kind = i % 3 === 0 ? 'clod' : i % 3 === 1 ? 'clod2' : 'dust';
        this.bit(kind, e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0 * 0.6, Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rnd(0.55, 0.75), { vz: rnd(35, 60), g: 260, drag: 2.2 });
      }
      for (let i = 0; i < 8; i++) {
        const a = rnd(0, TAU);
        this.bit('dust', e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 4, Math.cos(a) * rnd(10, 25), Math.sin(a) * rnd(6, 15), rnd(0.5, 0.7), { vz: rnd(10, 25), g: 80, drag: 2 });
      }
      // 地裂：土浪推过去的地方裂开几道缝（贴在地上，跟着浪头的远近晚一点出现），慢慢淡掉
      const nc = e.tier >= 4 ? 9 : 7;
      for (let i = 0; i < nc; i++) {
        const a = (i / nc) * TAU + rnd(-0.2, 0.2);
        const d = r * rnd(0.22, 0.5);
        const c = new Sprite(this.crackTex[i % this.crackTex.length]);
        c.anchor.set(0, 0);
        c.scale.set(Math.cos(a) < 0 ? -1 : 1, Math.sin(a) < 0 ? -1 : 1);
        c.position.set(Math.round(e.x + Math.cos(a) * d * 0.6), Math.round(e.y + Math.sin(a) * d * 0.36));
        c.alpha = 0;
        this.floor.addChild(c);
        this.anims.push({ s: c, frames: null, t: 0, delay: d / (r * 2), life: 1.1, fadeIn: 0.05, fadeOut: 0.6, peak: 0.9 });
      }
      // 浪头扬起的尘团：几团石色的尘（半透明），在浪头推到的地方鼓起来再散
      const np = e.tier >= 4 ? 8 : 6;
      for (let i = 0; i < np; i++) {
        const a = (i / np) * TAU + rnd(-0.3, 0.3);
        const d = r * rnd(0.55, 0.75);
        const frames = puffSet(5, 'stone', 1 + (i % 3));
        const p = this.sprite(frames[0], e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.6 - 2);
        p.alpha = 0;
        this.anims.push({ s: p, frames, t: 0, delay: 0.16 + rnd(0, 0.06), life: 0.6, fadeIn: 0.05, fadeOut: 0.3, peak: 0.75 });
      }
      this.shake.add(e.tier >= 4 ? 0.22 : 0.16);
      this.play('dinghai.quake', 0.5);
    }
  }

  update(dt: number, w: World, alpha: number) {
    if (w !== this.world) {
      this.clear();
      this.world = w;
    }
    this.alpha = alpha;
    // 金气：飞过去（落点跟着那只走不了——事件里只有当时的位置，0.2 秒里敌人挪不了几个像素），一路落金屑；到了留一道斩痕
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const b = this.blades[i];
      b.t += dt;
      const k = clamp01(b.t / b.dur);
      const ease = 1 - (1 - k) * (1 - k);
      b.s.position.set(Math.round(b.x0 + (b.x1 - b.x0) * ease), Math.round(b.y0 + (b.y1 - b.y0) * ease));
      b.s.alpha = Math.min(1, b.t / 0.05);
      b.echo.forEach((g, j) => {
        const q = clamp01(b.t / b.dur - (j + 1) * 0.12);
        const eq = 1 - (1 - q) * (1 - q);
        g.position.set(Math.round(b.x0 + (b.x1 - b.x0) * eq), Math.round(b.y0 + (b.y1 - b.y0) * eq));
        g.alpha = q > 0 ? (j ? 0.2 : 0.45) * b.s.alpha : 0;
      });
      b.trail -= dt;
      if (b.trail <= 0) {
        b.trail = 0.025;
        this.bit('gold', b.s.x, b.s.y, rnd(-6, 6), rnd(-4, 4), rnd(0.3, 0.45), { drag: 4 });
      }
      if (k >= 1) {
        const s = this.sprite(this.scarTex[0], b.x1, b.y1);
        s.alpha = 0;
        this.scars.push({ s, t: 0, life: 0.8 });
        this.sparks.emit(b.x1, b.y1, 3, GOLD, [15, 35], [0.2, 0.35], { drag: 3 });
        b.s.destroy();
        for (const g of b.echo) g.destroy();
        this.blades.splice(i, 1);
      }
    }
    for (let i = this.scars.length - 1; i >= 0; i--) {
      const s = this.scars[i];
      s.t += dt;
      s.s.texture = this.scarTex[s.t < 0.18 ? 0 : 1];
      s.s.alpha = s.t < 0.06 ? s.t / 0.06 : Math.max(0, 1 - (s.t - 0.2) / (s.life - 0.2));
      if (s.t >= s.life) {
        s.s.destroy();
        this.scars.splice(i, 1);
      }
    }
    // 小尘：有速度、阻力、往上蹦再落回地面（z），最后一段慢慢淡掉
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.t += dt;
      const f = Math.exp(-b.drag * dt);
      b.vx *= f;
      b.vy *= f;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.vz || b.z > 0) {
        b.vz -= b.g * dt;
        b.z = Math.max(0, b.z + b.vz * dt);
        if (b.z === 0) b.vz = 0;
      }
      b.s.position.set(Math.round(b.x), Math.round(b.y - b.z));
      const left = b.life - b.t;
      b.s.alpha = b.t < b.fadeIn ? b.t / b.fadeIn : clamp01(left / Math.min(0.25, b.life * 0.5));
      if (b.t >= b.life) {
        b.s.destroy();
        this.bits.splice(i, 1);
      }
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const t = a.t - a.delay;
      if (t < 0) continue;
      if (a.frames) a.s.texture = a.frames[Math.min(a.frames.length - 1, Math.floor((t / a.life) * a.frames.length))];
      a.s.alpha = a.peak * Math.min(t < a.fadeIn ? t / a.fadeIn : 1, clamp01((a.life - t) / a.fadeOut));
      if (t >= a.life) {
        a.s.destroy();
        this.anims.splice(i, 1);
      }
    }
    this.updateVines(w, dt);
  }

  /** 藤蔓：敌人身上 tangleUntil 还没到就在腿上盘两股青藤，长出来（0.3 秒）、叶子摆、跟着走；到时（或死了）枯成赭色、往下缩、淡掉，掉两片枯叶。 */
  private updateVines(w: World, dt: number) {
    const now = w.time;
    const live = new Set<number>();
    for (const e of w.enemies) {
      if (e.hp <= 0 || e.tangleUntil === undefined || e.tangleUntil <= now) continue;
      live.add(e.id);
      let v = this.vines.get(e.id);
      if (!v || v.wither >= 0) {
        v?.s.destroy();
        v = { s: this.sprite(this.vineTex[0], 0, 0, 0.5, 1), t: 0, wither: -1 };
        v.s.alpha = 0;
        if (e.id % 2) v.s.scale.x = -1;
        this.vines.set(e.id, v);
      }
      v.t += dt;
      this.placeVine(v, e);
      const g = Math.floor(v.t / 0.075);
      v.s.texture = g < 4 ? this.vineTex[g] : this.vineSway[Math.floor((v.t + e.id * 0.3) * 2.5) % 2];
      v.s.alpha = Math.min(1, v.t / 0.08);
    }
    for (const [id, v] of this.vines) {
      if (live.has(id)) continue;
      if (v.wither < 0) {
        v.wither = 0;
        for (let k = 0; k < 2; k++) this.bit('leaf2', v.s.x + rnd(-4, 4), v.s.y - rnd(4, 9), rnd(-10, 10), rnd(-2, 4), rnd(0.5, 0.7), { vz: rnd(4, 10), g: 40, drag: 2 });
      }
      v.wither += dt;
      const e = w.enemies.find((x) => x.id === id);
      if (e) this.placeVine(v, e);
      // 枯：先变成赭色，再一档一档往下缩、淡掉（0.5 秒）
      v.s.texture = this.vineDry[Math.min(2, Math.floor(v.wither / 0.17))];
      v.s.alpha = Math.max(0, 1 - Math.max(0, v.wither - 0.15) / 0.35);
      if (v.wither >= 0.5) {
        v.s.destroy();
        this.vines.delete(id);
      }
    }
  }

  private placeVine(v: Vine, e: Enemy) {
    const x = e.px + (e.x - e.px) * this.alpha;
    const y = e.py + (e.y - e.py) * this.alpha;
    v.s.position.set(Math.round(x), Math.round(y + 2));
  }
}
