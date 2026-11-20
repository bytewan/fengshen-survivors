// 赵公明 · 定海珠的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读模拟的事件（bead / warn / land）和人物的位置。
// 珠子平时绕身慢转（椭圆的一圈，胸口高度；转到身后的被人物挡住，转到身前的压在人物上面），出手时离得最近的那一颗飞出去：
// 一道低低的弧线（离地不过二十来像素，影子跟着在地上走），砸在落点上 —— 尘土贴地往四周卷开、几粒碎石崩起、地上裂开一个小小的星形裂口，
// 珠子弹起一点，再飞回身边接着转。
// 品阶看得出变化：凡 三颗小珠；灵 五颗、珠子大一圈、一次飞两颗；仙 珠心一点金，砸地处留下一圈刻着纹的石纹，
// 片刻后石纹一亮、再震一次（第二次的尘土从石纹那一圈往外卷）；神「二十四珠」身边八颗，出手时二十四颗从身边依次飞出、
// 在身边绕成一圈一颗颗砸下，整圈石纹最后一起再震；「镇海」一颗巨珠悬在身后头顶，砸下去压住那一片（压着的这一会儿稍稍往下沉、四周的地裂开），
// 压完再升回去。
// 用户口径：法宝不画得过大（珠子 4–5 像素、巨珠 11 像素，绕身的一圈连珠子约 29 像素宽）；效果不超过判定（尘土、石纹都在震开的半径里）；
// 不要光圈（石纹是贴地刻出来的一圈纹路，不发光，只在再震之前泛一点金）；出现和消失都有过程。
import { Container, Sprite, type Texture } from 'pixi.js';
import { compose, grid, outline, type Grid } from '../../art/pixel.ts';
import { textureFromGrid } from '../../render/textures.ts';
import type { Stage } from '../../render/stage.ts';
import type { Particles, Shake } from '../../render/juice.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { BANK } from '../../audio/bank.ts';
import { Bits, C, clamp01, Pixels, pick, puffSet, rnd, Ts } from '../fx.ts';
import { ROCKS } from '../../art/sprites/fx.ts';
import { DINGHAI } from '../../sim/heroes/zhao.ts';
import type { OwnedWeapon, SimEvent } from '../../sim/types.ts';
import type { World } from '../../sim/world.ts';

const TAU = Math.PI * 2;
/** 贴地的圈按透视压扁（上下 0.62，和番天印的尘浪、裂缝一样）。 */
const FLAT = 0.62;
/** 青灰石的几档（贴地的裂口、石纹；第二章的黄土地上一样看得出）。 */
const STONE = { q: 0x4f5652, u: 0x6d756c, x: 0x8f9787, z: 0xb3b8a6 };
/** 砸起的尘土：褐、灰紫、苍石（浅色的仙台、黄土地上都看得出），夹一点石白。 */
const DUST = [0x6b5749, 0x776672, STONE.q, STONE.z];

/**
 * 一颗珠子：直径 d 的圆，左上受光（月白，一像素闪白）、珠身缟色、右下银鼠、最下沿一像素苍色；大珠（镇海）的阴面泛一道天青（海水的光）。
 * core 是珠心的一点（凡 / 灵没有；仙品起一点金）。外圈描一像素苍色（不描玄：珠子小，描黑就成了黑圈），浅色的地上、深色的袍子前都看得出。
 */
function pearl(d: number, core: string | null): Grid {
  const rows: string[] = [];
  const c = d / 2;
  for (let y = 0; y < d; y++) {
    let row = '';
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy) / c;
      if (r > 1.02) {
        row += '.';
        continue;
      }
      const lit = -(dx + dy) / (d * 0.7);
      let ch = lit > 0.32 ? 'w' : lit > -0.18 ? 'j' : 'i';
      if (d >= 9 && lit < -0.12 && r > 0.5 && r < 0.86) ch = 'C';
      if (r > 0.82 && lit < -0.3) ch = 'h';
      row += ch;
    }
    rows.push(row);
  }
  const g = grid(rows);
  const set = (x: number, y: number, ch: string) => {
    const r = [...g.rows[y]];
    r[x] = ch;
    g.rows[y] = r.join('');
  };
  // 一像素闪白（左上），大珠两像素
  const hx = Math.max(0, Math.round(c - c * 0.55) - (d >= 9 ? 1 : 0));
  set(hx, hx, 'W');
  if (d >= 9) set(hx + 1, hx, 'W');
  if (core && d >= 5) set(Math.floor(d / 2), Math.floor(d / 2), core);
  return outline(compose(d + 2, d + 2, [{ g, x: 1, y: 1 }]), 'h');
}

/** 一个人的珠子：几颗小的（凡 3、灵 / 仙 5、二十四珠 8、镇海 4）+ 镇海的巨珠。 */
interface Orbit {
  beads: Sprite[];
  out: number[]; // 每颗飞出去的还剩多久回来（0 = 在身边）
  big: Sprite | null; // 镇海的巨珠
  bigOut: boolean;
  look: string; // 现在的珠子样子（品阶 + 器灵）
  phase: number;
  alpha: number; // 换波、刚装上时淡入
}
/** 一颗飞出去的珠子：从 (x0, y0, z0) 沿一道弧飞到落点，落地后弹一下、飞回去（巨珠压一会儿再升回去）。 */
interface Flight {
  id: number;
  owner: number;
  s: Sprite;
  sh: Sprite;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  delay: number; // 二十四珠：等多久才出发（依次飞出）
  dur: number;
  t: number;
  r: number;
  tier: number;
  spirit?: string;
  phase: 'fly' | 'press' | 'back';
  pt: number; // 落地之后过了多久
  press: number; // 巨珠压多久
  slot: number; // 是身边的第几颗（飞回去时回到这一格；-1 = 二十四珠飞出来的、回去就散了；-2 = 巨珠）
}
/** 贴地的星形裂口（珠子砸出来的），慢慢淡掉。 */
interface Crack {
  x: number;
  y: number;
  arms: [number, number][][];
  t: number;
  life: number;
}
/** 仙品起的石纹（一圈刻纹）：落地后出现，t2 秒后再震；rosary 是二十四珠的那一整圈。 */
interface Ring {
  id: number;
  owner: number;
  pts: [number, number][]; // 二十四珠：已经砸下的那几颗的落点（石纹一颗颗刻出来）
  x: number;
  y: number;
  r: number;
  t: number;
  t2: number;
  quakeT: number; // 再震之后过了多久（-1 = 还没震）
  seed: number;
  rosary: boolean;
}

const ORBIT_RX = 11; // 绕身的一圈：左右各 11、上下各 4.5（连珠子不超过约 29 像素宽：法宝本身凡 / 灵不过约 30）
const ORBIT_RY = 4.5;
const ORBIT_Y = 14; // 绕在胸口高度（离地；赵公明 32 像素高，胸口离地约 14）
const BACK_T = 0.38; // 弹起之后飞回身边要多久

export class DinghaiFx {
  private orbits = new Map<number, Orbit>();
  private flights: Flight[] = [];
  private cracks: Crack[] = [];
  private rings: Ring[] = [];
  private flashes: { x: number; y: number; t: number; big: boolean }[] = [];
  private info = new Map<number, { spirit?: string; tier: number; owner: number; rosary?: boolean }>(); // Pending id → 它的样子（land 的时候 Pending 已经没了）
  private top = new Pixels();
  private under = new Pixels();
  private layer = new Container();
  private bits: Bits;
  private tex = new Map<string, Texture>();
  private stage: Stage;
  private sparks: Particles;
  private shake: Shake;
  private sfx: Sfx;
  private time = 0;

  constructor(stage: Stage, sparks: Particles, _glows: Particles, shake: Shake, sfx: Sfx) {
    this.stage = stage;
    this.sparks = sparks;
    this.shake = shake;
    this.sfx = sfx;
    stage.floor.addChild(this.under.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
    this.bits = new Bits(stage.fx, stage.entities);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  private beadTex(d: number, core: string | null): Texture {
    const key = `${d}${core ?? '-'}`;
    let t = this.tex.get(key);
    if (!t) {
      t = textureFromGrid(pearl(d, core));
      this.tex.set(key, t);
    }
    return t;
  }

  /** 这件定海珠的珠子画多大、珠心什么颜色。 */
  private look(wpn: OwnedWeapon) {
    const d = wpn.spirit === 'rosary' ? 4 : wpn.tier >= 2 ? 5 : 4;
    const core = wpn.tier >= 3 ? 'y' : 'C';
    const n = wpn.spirit === 'rosary' ? 8 : wpn.spirit === 'anchor' ? 4 : DINGHAI.orbit[wpn.tier];
    return { d, core, n, big: wpn.spirit === 'anchor' };
  }

  clear() {
    for (const f of this.flights) {
      f.s.destroy();
      f.sh.destroy();
    }
    this.flights = [];
    this.cracks = [];
    this.rings = [];
    this.flashes = [];
    this.info.clear();
    for (const o of this.orbits.values()) {
      o.out.fill(0);
      o.bigOut = false;
      o.alpha = 0;
    }
    this.top.flush();
    this.under.flush();
  }

  onEvent(e: SimEvent, w: World) {
    switch (e.t) {
      case 'waveStart':
      case 'waveEnd':
        this.clear();
        break;
      case 'bead': {
        if (e.kind !== 'dinghai') break;
        this.info.set(e.id, { spirit: e.spirit, tier: e.tier, owner: e.owner });
        this.launch(e, w);
        break;
      }
      case 'warn': {
        if (e.kind !== 'bead') break;
        const q = w.pending.find((x) => x.id === e.id);
        const rosary = q?.spirit === 'rosary';
        this.info.set(e.id, { tier: e.tier ?? 3, owner: q?.owner ?? 0, rosary });
        this.rings.push({ id: e.id, owner: q?.owner ?? 0, pts: [], x: e.x, y: e.y, r: rosary ? e.r - DINGHAI.rosary.r : e.r, t: 0, t2: e.t2, quakeT: -1, seed: Math.random() * 100, rosary });
        break;
      }
      case 'land': {
        if (e.kind !== 'bead') break;
        const info = this.info.get(e.id);
        this.info.delete(e.id);
        if (e.quake) this.quake(e.id, e.x, e.y, e.r, !!info?.rosary);
        else {
          this.impact(e.id, e.x, e.y, e.r, info?.spirit);
          // 二十四珠：这一颗砸下的地方刻上一处石纹
          if (info?.spirit === 'rosary') this.rings.find((g) => g.rosary && g.owner === info.owner && g.quakeT < 0)?.pts.push([e.x, e.y]);
        }
        break;
      }
    }
  }

  /** 出手：挑身边离落点方向最近的那颗珠子飞出去（巨珠从头顶飞出；二十四珠从胸口依次飞出）。 */
  private launch(e: Extract<SimEvent, { t: 'bead' }>, w: World) {
    const p = w.players[e.owner];
    if (!p) return;
    const o = this.orbits.get(e.owner);
    const big = e.spirit === 'anchor';
    const ring = e.spirit === 'rosary';
    let x0 = p.x;
    let y0 = p.y;
    let z0 = ORBIT_Y;
    let slot = -1;
    if (big) {
      slot = -2;
      x0 = p.x - p.facing * 7;
      y0 = p.y;
      z0 = 27;
      if (o) o.bigOut = true;
    } else if (!ring && o && o.beads.length) {
      // 离落点方向最近、还在身边的那一颗
      const want = Math.atan2(e.y - p.y, e.x - p.x);
      let best = -1;
      let bd = 1e9;
      o.beads.forEach((_, i) => {
        if (o.out[i] > 0) return;
        const a = o.phase + (i / o.beads.length) * TAU;
        const d = Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) {
        slot = best;
        const a = o.phase + (best / o.beads.length) * TAU;
        x0 = p.x + Math.cos(a) * ORBIT_RX;
        y0 = p.y + Math.sin(a) * ORBIT_RY;
        o.out[best] = 99; // 飞回来时清零
      }
    }
    const wpn = p.weapons.find((x) => x.kind === 'dinghai');
    const lk = wpn ? this.look(wpn) : { d: 4, core: 'C' };
    const s = new Sprite(big ? this.beadTex(11, 'y') : this.beadTex(lk.d, lk.core));
    s.anchor.set(0.5);
    this.stage.entities.addChild(s);
    const sh = new Sprite(this.stage.tex.smallShadow);
    sh.anchor.set(0.5);
    sh.alpha = 0;
    if (big) sh.scale.set(1.6, 1.3);
    this.stage.floor.addChild(sh);
    const fly = ring ? 0.3 : e.t2;
    this.flights.push({ id: e.id, owner: e.owner, s, sh, x0, y0, z0, x1: e.x, y1: e.y, delay: ring ? e.t2 - fly : 0, dur: fly, t: 0, r: e.r, tier: e.tier, spirit: e.spirit, phase: 'fly', pt: 0, press: big ? DINGHAI.anchor.root : 0, slot });
    s.visible = !ring;
    if (!ring || (e.seq ?? 1) % 4 === 1) this.play('dinghai.throw', 'qiankun.throw', ring ? 0.35 : 0.55);
  }

  /** 珠子落地：尘土贴地往四周卷开、碎石崩起、地上裂开一个星形裂口（不超过震开的半径），小震一下。 */
  private impact(id: number, x: number, y: number, r: number, spirit?: string) {
    const f = this.flights.find((v) => v.id === id && v.phase === 'fly');
    if (f) {
      f.phase = f.press > 0 ? 'press' : 'back';
      f.pt = 0;
      f.x1 = x;
      f.y1 = y;
    }
    const big = spirit === 'anchor';
    const ring = spirit === 'rosary';
    // 震开的一圈：尘团从落点四周贴地往外推，外沿停在震开的半径上（地面按 0.6 压扁，和番天印的尘浪一个透视）
    const n = ring ? 2 : Math.round(8 + r / 5 + (big ? 6 : 0));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rnd(-0.15, 0.15);
      const r0 = r * rnd(0.3, 0.4);
      const sp = Math.max(6, r * 0.5) * 2.6 * rnd(0.8, 1);
      this.bits.spawn(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.6, { frames: puffSet(ring ? 3 : pick([3, 4]), 'stone', 1 + (k % 3)), life: rnd(0.45, 0.65), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - 3, drag: 3.2, fadeIn: 0.03, fadeOut: 0.28, z: true, zOff: 2 });
    }
    // 碎石崩起来、落地弹一下
    const rocks = ring ? (Math.random() < 0.3 ? 1 : 0) : big ? 10 : 5;
    for (let k = 0; k < rocks; k++) {
      const a = rnd(0, TAU);
      this.bits.spawn(x + Math.cos(a) * rnd(1, r * 0.3), y + Math.sin(a) * rnd(1, r * 0.2), { frames: [Ts('rocks', () => ROCKS)[k % ROCKS.length]], life: rnd(0.6, 0.9), vx: Math.cos(a) * r * rnd(0.3, 0.7), vy: -rnd(50, 90), g: 340, ground: y + rnd(-3, 3), bounce: 0.35, fadeOut: 0.25 });
    }
    // 珠光一闪：落点上一个小小的十字闪（月白、天青），几粒天青的水珠似的碎光溅开 —— 定海的珠子，和番天印的金光分开
    this.flashes.push({ x, y: y - (big ? 6 : 3), t: 0, big });
    this.sparks.emit(x, y - 3, ring ? 2 : big ? 9 : 5, [C.W, C.Cc, C.w], [15, 45], [0.2, 0.4], { up: 25, g: 120, drag: 2.5 });
    if (!ring) this.cracks.push({ x, y, arms: crackArms(x, y, r * (big ? 0.8 : 0.6), big ? 7 : 5), t: 0, life: big ? DINGHAI.anchor.root + 0.6 : 0.9 });
    this.shake.add(big ? 0.45 : ring ? 0.04 : 0.14);
    this.play('dinghai.land', 'fantian.land', big ? 0.8 : ring ? 0.25 : 0.45);
  }

  /** 石纹再震：那一圈纹路一跳，尘土从那一圈往外卷（二十四珠是整圈一起）。 */
  private quake(id: number, x: number, y: number, r: number, rosary: boolean) {
    const g = this.rings.find((v) => v.id === id);
    if (g) g.quakeT = 0;
    const R = rosary ? r - DINGHAI.rosary.r : r;
    const n = rosary ? 30 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rnd(-0.15, 0.15);
      const cx = x + Math.cos(a) * R * 0.85;
      const cy = y + Math.sin(a) * R * 0.85 * 0.6;
      this.bits.spawn(cx, cy, { frames: puffSet(3, 'stone', 1 + (k % 3)), life: rnd(0.4, 0.6), vx: Math.cos(a) * 14, vy: Math.sin(a) * 8 - 4, drag: 3, fadeIn: 0.03, fadeOut: 0.25, z: true, zOff: 2 });
      if (k % 3 === 0) this.bits.spawn(cx, cy, { frames: [Ts('rocks', () => ROCKS)[k % ROCKS.length]], life: 0.6, vx: Math.cos(a) * 10, vy: -rnd(45, 75), g: 300, ground: cy, bounce: 0.3, fadeOut: 0.2 });
    }
    this.shake.add(rosary ? 0.35 : 0.12);
    this.play('dinghai.quake', 'zone.crack', rosary ? 0.8 : 0.5);
  }

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    this.updateOrbits(dt, w, alpha);
    this.updateFlights(dt, w, alpha);
    this.bits.update(dt);
    this.drawGround(dt);
    this.drawFlashes(dt);
    this.top.flush();
    this.under.flush();
  }

  /** 绕身的珠子：椭圆的一圈，三秒多转一圈；转到身后（上半圈）的排在人物后面、身前的压在人物上面。 */
  private updateOrbits(dt: number, w: World, alpha: number) {
    for (const p of w.players) {
      const wpn = p.weapons.find((x) => x.kind === 'dinghai');
      let o = this.orbits.get(p.id);
      const show = !!wpn && !p.left && !(p.out && w.phase !== 'shop');
      if (!show || !wpn) {
        if (o) {
          for (const s of o.beads) s.visible = false;
          if (o.big) o.big.visible = false;
        }
        continue;
      }
      const lk = this.look(wpn);
      const key = `${wpn.tier}${wpn.spirit ?? ''}`;
      if (!o || o.look !== key) {
        if (o) {
          for (const s of o.beads) s.destroy();
          o.big?.destroy();
        }
        const beads = Array.from({ length: lk.n }, () => {
          const s = new Sprite(this.beadTex(lk.d, lk.core));
          s.anchor.set(0.5);
          this.stage.entities.addChild(s);
          return s;
        });
        let big: Sprite | null = null;
        if (lk.big) {
          big = new Sprite(this.beadTex(11, 'y'));
          big.anchor.set(0.5);
          this.stage.entities.addChild(big);
        }
        o = { beads, out: beads.map(() => 0), big, bigOut: false, look: key, phase: o?.phase ?? Math.random() * TAU, alpha: 0 };
        this.orbits.set(p.id, o);
      }
      o.phase += dt * (TAU / 3.4);
      o.alpha = Math.min(1, o.alpha + dt * 3);
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      const down = (p.down ?? 0) > 0 || !p.alive;
      o.beads.forEach((s, i) => {
        if (o!.out[i] > 0 && o!.out[i] < 99) o!.out[i] = Math.max(0, o!.out[i] - dt);
        const a = o!.phase + (i / o!.beads.length) * TAU;
        const bob = Math.sin(this.time * 2.2 + i * 1.3) * 0.8;
        s.position.set(Math.round(x + Math.cos(a) * ORBIT_RX), Math.round(y - (down ? 4 : ORBIT_Y) + Math.sin(a) * ORBIT_RY + bob));
        s.zIndex = Math.round(y) + (Math.sin(a) > 0 ? 1 : -1);
        s.visible = o!.out[i] === 0;
        s.alpha = o!.alpha;
      });
      if (o.big) {
        // 巨珠悬在身后头顶（离地不过约 30 像素），慢慢上下浮
        o.big.position.set(Math.round(x - p.facing * 7), Math.round(y - 27 + Math.sin(this.time * 1.6) * 1.2));
        o.big.zIndex = Math.round(y) - 1;
        o.big.visible = !o.bigOut;
        o.big.alpha = o.alpha;
      }
    }
  }

  /** 飞出去的珠子：飞（弧线）→ 落地（弹起 / 巨珠压一会儿）→ 飞回身边。影子跟着在地上走，离地越高越淡。 */
  private updateFlights(dt: number, w: World, alpha: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const p = w.players[f.owner];
      let x = f.x1;
      let y = f.y1;
      let z = 0;
      if (f.phase === 'fly') {
        if (f.delay > 0) {
          f.delay -= dt;
          if (f.delay > 0) continue;
          f.s.visible = true;
          if (p) {
            // 二十四珠：从此刻的胸口飞出去
            f.x0 = p.x;
            f.y0 = p.y;
          }
        }
        f.t += dt;
        const k = clamp01(f.t / f.dur);
        const d = Math.hypot(f.x1 - f.x0, f.y1 - f.y0);
        const peak = Math.min(22, 8 + d * 0.12) + (f.slot === -2 ? 4 : 0);
        x = f.x0 + (f.x1 - f.x0) * k;
        y = f.y0 + (f.y1 - f.y0) * k;
        // 从出手的高度起，抛到 peak，落到地上
        z = f.z0 * (1 - k) + 4 * peak * k * (1 - k);
        if (k >= 1) z = 0;
      } else if (f.phase === 'press') {
        // 镇海：压住，稍稍往下沉一点、左右微微晃
        f.pt += dt;
        x = f.x1 + Math.sin(f.pt * 30) * (f.pt < 0.25 ? 1 : 0);
        z = -1 * clamp01(f.pt / 0.3);
        if (f.pt >= f.press) {
          f.phase = 'back';
          f.pt = 0;
        }
      } else {
        // 弹起一点，飞回身边那一格（二十四珠飞出来的弹起后散成几粒光）
        f.pt += dt;
        const k = clamp01(f.pt / BACK_T);
        if (f.slot === -1) {
          z = 6 * Math.sin(Math.PI * clamp01(f.pt / 0.2));
          if (f.pt >= 0.2) {
            this.sparks.emit(x, y - z - 2, 2, [C.w, C.j], [6, 16], [0.2, 0.35], { up: 10, drag: 3 });
            this.remove(i);
            continue;
          }
        } else if (p) {
          const o = this.orbits.get(f.owner);
          let tx = p.x;
          let ty = p.y;
          let tz = ORBIT_Y;
          if (f.slot === -2) {
            tx = p.x - p.facing * 7;
            tz = 27;
          } else if (o && o.beads.length) {
            const a = o.phase + ((f.slot % o.beads.length) / o.beads.length) * TAU;
            tx = p.x + Math.cos(a) * ORBIT_RX;
            ty = p.y + Math.sin(a) * ORBIT_RY;
          }
          const e = k * k * (3 - 2 * k);
          x = f.x1 + (tx - f.x1) * e;
          y = f.y1 + (ty - f.y1) * e;
          z = tz * e + 14 * Math.sin(Math.PI * k) * (1 - e * 0.5);
          if (k >= 1) {
            if (o) {
              if (f.slot === -2) o.bigOut = false;
              else if (f.slot >= 0 && f.slot < o.out.length) o.out[f.slot] = 0;
            }
            this.remove(i);
            continue;
          }
        } else {
          this.remove(i);
          continue;
        }
      }
      f.s.position.set(Math.round(x), Math.round(y - z));
      f.s.zIndex = Math.round(y) + 1;
      f.sh.position.set(Math.round(x), Math.round(y));
      f.sh.alpha = f.s.visible ? 0.4 * (1 - clamp01(z / 30)) : 0;
    }
  }

  /** 珠光一闪：十字的四道短芒从落点一下伸出去、收回来（月白芯、天青梢），0.16 秒。 */
  private drawFlashes(dt: number) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / 0.16;
      if (k >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      const L = (f.big ? 7 : 4) * Math.sin(Math.PI * k);
      const a = 1 - k * 0.6;
      this.top.dot(f.x, f.y, C.W, a);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        for (let s = 1; s <= L; s++) this.top.dot(f.x + dx * s, f.y + dy * s * 0.7, s > L * 0.6 ? C.Cc : C.w, a * (1 - s / (L + 1)));
    }
  }

  private remove(i: number) {
    const f = this.flights[i];
    f.s.destroy();
    f.sh.destroy();
    this.flights.splice(i, 1);
  }

  /** 贴地的：星形裂口（先裂开、再慢慢淡掉），仙品起的石纹（一圈刻纹：出现、再震之前泛一点金、震完淡掉）。 */
  private drawGround(dt: number) {
    const px = this.under;
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i];
      c.t += dt;
      if (c.t >= c.life) {
        this.cracks.splice(i, 1);
        continue;
      }
      const open = clamp01(c.t / 0.08);
      const a = clamp01((c.life - c.t) / 0.45) * 0.85;
      for (const arm of c.arms) {
        const n = Math.max(1, Math.round(arm.length * open));
        for (let j = 0; j < n; j++) {
          const [x, y] = arm[j];
          px.dot(x, y, j < 2 ? C.k : STONE.q, a);
          if (j % 2 === 0) px.dot(x, y - 1, STONE.z, a * 0.5);
        }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.t += dt;
      if (g.quakeT >= 0) g.quakeT += dt;
      const life = g.quakeT >= 0 ? 1 - g.quakeT / 0.5 : 1;
      if (life <= 0 || g.t > g.t2 + 1.2) {
        this.rings.splice(i, 1);
        continue;
      }
      const born = clamp01(g.t / 0.18);
      const warm = g.quakeT < 0 ? clamp01((g.t - (g.t2 - 0.3)) / 0.3) : 1 - clamp01(g.quakeT / 0.25);
      const jolt = g.quakeT >= 0 && g.quakeT < 0.12 ? 1 : 0;
      this.stoneRing(g, born * life, warm, jolt);
    }
  }

  /**
   * 一圈石纹：不是一整圈的线，是刻在地上的一圈纹 —— 八处（二十四珠是二十四处，正好是每颗珠子砸下的地方）短短的「十」字刻痕
   * （深石色的槽、下沿一像素石白），刻痕之间一串断续的小点连着（像回纹的细线）；画在震开半径的八成五处（不超过判定）。
   * 再震之前，刻痕从一处起顺着一圈依次泛金（warm），震的那一下整圈往外跳一像素（jolt）。
   */
  private stoneRing(g: Ring, a: number, warm: number, jolt: number) {
    const px = this.under;
    if (g.rosary) {
      // 二十四珠：刻在每颗珠子砸下的地方，相邻两处之间一串断续的小点；整圈一起泛金、一起跳
      const pts = g.pts;
      pts.forEach(([x0, y0], m) => {
        const lit = clamp01(warm * 1.4 - (m / 24) * 0.4);
        const groove = lit > 0.5 ? C.y : lit > 0.05 ? C.b : STONE.q;
        const ox = Math.sign(x0 - g.x) * jolt;
        const oy = Math.sign(y0 - g.y) * jolt;
        for (const [dx, dy] of [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          px.dot(x0 + dx + ox, y0 + dy + oy, groove, a * 0.85);
          if (dy === 0) px.dot(x0 + dx + ox, y0 + 1 + oy, STONE.z, a * 0.35);
        }
        const nx = pts[m + 1];
        if (!nx) return;
        const n = Math.max(2, Math.round(Math.hypot(nx[0] - x0, nx[1] - y0) / 3));
        for (let d = 1; d < n; d++) px.dot(x0 + ((nx[0] - x0) * d) / n + ox, y0 + ((nx[1] - y0) * d) / n + oy, lit > 0.6 ? C.b : STONE.q, a * 0.5);
      });
      return;
    }
    const R = g.r * (g.rosary ? 1 : 0.85) + jolt;
    const marks = g.rosary ? 24 : 8;
    const at = (ang: number, rr: number): [number, number] => [g.x + Math.cos(ang) * rr, g.y + Math.sin(ang) * rr * FLAT];
    for (let m = 0; m < marks; m++) {
      const ang = (m / marks) * TAU + g.seed;
      // 依次泛金：第 m 处在 warm 走到 m / marks 时亮起来
      const lit = clamp01(warm * 1.4 - (m / marks) * 0.4);
      const groove = lit > 0.5 ? C.y : lit > 0.05 ? C.b : STONE.q;
      // 径向的一道（3 像素）+ 横的一道（3 像素），十字
      for (let k = -1; k <= 1; k++) {
        const [x, y] = at(ang, R + k * 1.4);
        px.dot(x, y, groove, a * 0.85);
        px.dot(x, y + 1, STONE.z, a * 0.4);
        const [x2, y2] = at(ang + (k * 1.3) / Math.max(8, R), R);
        if (k) {
          px.dot(x2, y2, groove, a * 0.85);
          px.dot(x2, y2 + 1, STONE.z, a * 0.4);
        }
      }
      // 到下一处之间：断续的小点
      const span = TAU / marks;
      const n = Math.max(2, Math.round((span * R) / 3));
      for (let d = 1; d < n; d++) {
        if (d === Math.floor(n / 2) && !g.rosary) continue; // 留一个缺口
        const [x, y] = at(ang + (d / n) * span, R);
        px.dot(x, y, lit > 0.6 ? C.b : STONE.q, a * 0.5);
      }
    }
  }
}

/** 星形裂口：从落点往外几道折线（每道一串像素点），长不过 len。 */
function crackArms(x: number, y: number, len: number, n: number): [number, number][][] {
  const arms: [number, number][][] = [];
  for (let k = 0; k < n; k++) {
    let a = (k / n) * TAU + rnd(-0.3, 0.3);
    const L = len * rnd(0.55, 1);
    const pts: [number, number][] = [];
    let cx = x;
    let cy = y;
    for (let s = 0; s < L; s += 1) {
      a += rnd(-0.25, 0.25);
      cx += Math.cos(a);
      cy += Math.sin(a) * FLAT;
      const pt: [number, number] = [Math.round(cx), Math.round(cy)];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) pts.push(pt);
    }
    arms.push(pts);
  }
  return arms;
}
