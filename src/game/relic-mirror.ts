// 照妖镜碎片的画面（表现层，relic-fx.ts 调用；机制在 sim/relics.ts：每隔一会儿照一只血最厚的，被照的一段时间里受伤加深）。
// 用户 2026-11-12：「照妖镜等特效都太廉价了」。原来是一条一像素的白线 + 头顶一片小镜子。现在分三段：
//   起势：几点天青的灵光往人物肩侧收拢，一面青铜古镜在那里浮现（赭色镜缘、天青镜面、朱红的穗子），一道流光从镜面左上扫到右下；
//   主体：镜面一亮，一束清冷的镜光照过去 —— 镜口窄、到妖物身上散开一点，中间一道月白的光芯，光里几点碎光顺着往前走，
//         地上贴着一道很淡的余光（镜光的投影）。照到的那一刻，一道光从妖物头顶扫到脚下，它身上浮出一层淡淡的原形（狐首的剪影），
//         胸口裂开一道破绽（天青的裂纹，被照的这几秒一直留着，慢慢明灭，偶尔落下一点碎光）；
//   余韵：镜光从镜口往妖物那头收掉，原形慢慢上浮散去，古镜淡下去、往上升一点，掉下两三点碎光。
// 口径：人物身上不画光圈、光晕；镜子在人物身侧（不挡脸）；整个过程约 1.7 秒，出现和消失都有过程。
import { Container, Sprite, type Texture } from 'pixi.js';
import { PixelSurface } from '../render/pixel-surface.ts';
import { packXY, packable } from '../render/pixel-raster.ts';
import { outline, type Grid } from '../art/pixel.ts';
import { textureFromGrid } from '../render/textures.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// 调色板里的几种色（src/art/palette.ts）
const W = 0xffffff; // 闪光
const w = 0xf2e8d5; // 月白
const C = 0x7cc4c4; // 天青
const c = 0x3f8a9e; // 石青
const n = 0x2f5373; // 黛蓝

// ---------------------------------------------------------------- 像素图

/**
 * 古镜：椭圆的镜身（侧过来一点，朝着照的方向），琥珀、藤黄的镜缘（受光的右上亮、背光的左下压成赭），
 * 镜面上亮下暗（月白 → 天青 → 石青），描赭边；下面系一条朱红的穗子。sweep 是流光扫到哪（−1 = 没有），bright = 照出去那一下镜面发白。
 */
function mirrorGrid(sweep: number, bright: boolean): Grid {
  const MW = 7;
  const MH = 9;
  const rows: string[][] = Array.from({ length: MH + 3 }, () => Array(MW).fill('.'));
  const cx = 3;
  const cy = 4;
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const dx = (x - cx) / 3.5;
      const dy = (y - cy) / 4.5;
      const d = dx * dx + dy * dy;
      if (d > 1.02) continue;
      if (d > 0.5) {
        // 镜缘
        const lit = x - cx - (y - cy) * 0.8;
        rows[y][x] = lit > 1.2 ? 'y' : lit < -1.5 ? 'B' : 'b';
        continue;
      }
      // 镜面
      const k = (y - cy) * 0.8 - (x - cx) * 0.5; // 右上亮、左下暗
      let ch = k < -1.4 ? 'w' : k < 0.6 ? 'C' : 'c';
      if (bright) ch = k < 0 ? 'W' : 'w';
      else if (sweep >= 0 && Math.abs(x + y - sweep) < 0.6) ch = 'W';
      else if (sweep >= 0 && Math.abs(x + y - sweep + 1) < 0.6) ch = 'w';
      rows[y][x] = ch;
    }
  // 穗子：镜纽下一粒结、垂两缕
  rows[MH][3] = 'e';
  rows[MH + 1][3] = 'r';
  rows[MH + 1][2] = 'r';
  rows[MH + 2][2] = 'r';
  rows[MH + 2][4] = 'R';
  rows[MH + 1][4] = 'e';
  const g: Grid = { w: MW, h: MH + 3, rows: rows.map((r) => r.join('')) };
  return outline(pad(g), 'B', { e: 'R', r: 'R', R: 'R' });
}

/** 原形：一只狐首的剪影（尖耳、吊梢的眼、窄吻），天青的面、黛蓝的边；半透明地从妖物头上浮出来。13×11。 */
const GHOST = [
  '.n.........n.',
  'nCn.......nCn',
  'nCCn.....nCCn',
  'nCwCnnnnnCwCn',
  '.nCCCCCCCCCn.',
  'nCCWnCCCnWCCn',
  'nCCCCCCCCCCCn',
  '.nCCCCwCCCCn.',
  '..nnCCCCCnn..',
  '....nnCnn....',
  '......n......',
];
/** 破绽：胸口一道折的裂纹（两帧：刚裂开的白、冷下来的天青），5×7。 */
const CRACK = [
  ['...W.', '..Ww.', '.Wc..', '..WC.', '...Cw', '..Cc.', '.c...'],
  ['...C.', '..Cw.', '.Cc..', '..CC.', '...cC', '..cn.', '.n...'],
];
/** 碎光：一像素的芯 + 一圈石青（浅色的地上也看得见）。 */
const GLINT = ['W'];

function pad(g: Grid): Grid {
  const blank = '.'.repeat(g.w + 2);
  return { w: g.w + 2, h: g.h + 2, rows: [blank, ...g.rows.map((r) => `.${r}.`), blank] };
}

/**
 * 镜光、灵光、扫光这些逐像素画的东西：攒成「同色同透明度的一组像素」，上屏前一次写进 PixelSurface 的缓冲
 * （原来每像素一个 Graphics 矩形，一道镜光七八百个，CPU 降速时一帧要好几毫秒）。接口仿 Graphics：rect(...).fill({ color, alpha })。
 */
class Dots {
  readonly ops = new Map<number, number[]>();
  private x = 0;
  private y = 0;
  private w = 1;
  private h = 1;
  clear() {
    for (const a of this.ops.values()) a.length = 0;
  }
  rect(x: number, y: number, w: number, h: number) {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.w = w;
    this.h = h;
    return this;
  }
  fill(o: { color: number; alpha?: number }) {
    const a = Math.round(Math.max(0, Math.min(1, o.alpha ?? 1)) * 255);
    if (a <= 0) return;
    const key = o.color * 256 + a;
    let arr = this.ops.get(key);
    if (!arr) this.ops.set(key, (arr = []));
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) if (packable(this.x + i, this.y + j)) arr.push(packXY(this.x + i, this.y + j));
  }
  get empty() {
    for (const a of this.ops.values()) if (a.length) return false;
    return true;
  }
}

// ---------------------------------------------------------------- 时间表（秒）

const T_GATHER = 0.28; // 灵光收拢、古镜浮现
const T_SWEEP0 = 0.18; // 流光扫过镜面
const T_SWEEP1 = 0.46;
const T_FIRE = 0.48; // 镜光照出去
const T_ARRIVE = 0.6; // 照到妖物
const T_HOLD = 1.0; // 镜光开始收
const T_GONE = 1.3; // 镜光收完
const T_MFADE0 = 1.12; // 古镜开始淡去
const LIFE = 1.75;

export interface MirrorTarget {
  /** 人物脚下（插值后）；人物不在了返回 null。 */
  hero(): [number, number] | null;
  /** 被照的那只的脚下和身高；死了返回 null（镜光照到它最后的位置）。 */
  foe(): [number, number, number] | null;
}

interface Cast {
  t: number;
  side: number;
  tgt: MirrorTarget;
  hx: number;
  hy: number;
  fx: number;
  fy: number;
  ftop: number;
  mirror: Sprite;
  ghost: Sprite;
  burst: boolean;
  drip: number; // 古镜淡去时上一次掉碎光的时刻
  motes: { u: number; v: number }[];
  /** 起势时往镜子收拢的灵光（相对镜心的起点） */
  gather: { x: number; y: number; d: number }[];
}

interface Speck {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  g: number;
}

/** 被照的这几秒，身上留着的破绽。 */
interface Mark {
  s: Sprite;
  age: number;
  cd: number;
}

export class MirrorFx {
  private layer: Container;
  private casts: Cast[] = [];
  private specks: Speck[] = [];
  private marks = new Map<number, Mark>();
  private mirrorTex: Texture[]; // 0 平常，1..5 流光扫过，6 发白
  private ghostTex: Texture;
  private crackTex: Texture[];
  private glintTex: Texture;
  private clock = 0;
  private dots = new Dots();
  private surface = new PixelSurface();

  constructor(layer: Container) {
    this.layer = layer;
    layer.addChild(this.surface.sprite);
    this.mirrorTex = [mirrorGrid(-1, false), ...[1, 3, 5, 7, 9, 11].map((s) => mirrorGrid(s, false)), mirrorGrid(-1, true)].map(textureFromGrid);
    this.ghostTex = textureFromGrid({ w: 13, h: 11, rows: GHOST });
    this.crackTex = CRACK.map((r) => textureFromGrid({ w: 5, h: 7, rows: r }));
    this.glintTex = textureFromGrid(outline(pad({ w: 1, h: 1, rows: GLINT }), 'c'));
  }

  clear() {
    this.dots.clear();
    this.surface.set(null);
    for (const k of this.casts) this.drop(k);
    this.casts = [];
    for (const s of this.specks) s.s.destroy();
    this.specks = [];
    for (const m of this.marks.values()) m.s.destroy();
    this.marks.clear();
  }

  /** 照一次：tgt 告诉每一帧人物和那只在哪。 */
  cast(tgt: MirrorTarget) {
    const h = tgt.hero();
    const f = tgt.foe();
    if (!h || !f) return;
    const side = f[0] >= h[0] ? 1 : -1;
    const mirror = new Sprite(this.mirrorTex[0]);
    mirror.anchor.set(0.5, 0.36); // 对在镜心（穗子在下面）
    mirror.scale.x = side;
    mirror.alpha = 0;
    const ghost = new Sprite(this.ghostTex);
    ghost.anchor.set(0.5, 0.5);
    ghost.alpha = 0;
    this.layer.addChild(mirror, ghost);
    const gather = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + rnd(-0.3, 0.3);
      const r = rnd(9, 13);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8, d: i * 0.025 };
    });
    this.casts.push({ t: 0, side, tgt, hx: h[0], hy: h[1], fx: f[0], fy: f[1], ftop: f[2], mirror, ghost, burst: false, drip: 0, motes: Array.from({ length: 5 }, (_, i) => ({ u: -i * 0.22, v: rnd(-0.6, 0.6) })), gather });
  }

  private drop(k: Cast) {
    k.mirror.destroy();
    k.ghost.destroy();
  }

  private speck(x: number, y: number, vx: number, vy: number, life: number, g = 0) {
    const s = new Sprite(this.glintTex);
    s.anchor.set(0.5);
    s.alpha = 0;
    this.layer.addChild(s);
    this.specks.push({ s, x, y, vx, vy, t: 0, life, g });
  }

  /**
   * 每帧：marks 是这一帧还在被照着的敌人（id → [脚下 x, y, 身高, 还剩几秒]）；照完、死了的破绽自己收掉。
   */
  update(dt: number, marks: Map<number, [number, number, number, number]>) {
    this.clock += dt;
    this.dots.clear();
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const k = this.casts[i];
      k.t += dt;
      if (!this.step(k)) {
        this.drop(k);
        this.casts.splice(i, 1);
      }
    }
    const ops = this.dots.ops;
    this.surface.set(this.dots.empty ? null : (buf) => {
      for (const [key, arr] of ops) if (arr.length) buf.fill(arr, arr.length, Math.floor(key / 256), key % 256);
    });
    // 碎光：慢慢飘、淡掉
    for (let i = this.specks.length - 1; i >= 0; i--) {
      const p = this.specks[i];
      p.t += dt;
      const d = Math.exp(-2 * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.s.position.set(Math.round(p.x), Math.round(p.y));
      p.s.alpha = Math.min(clamp01(p.t / 0.08), clamp01((p.life - p.t) / (p.life * 0.5)));
      if (p.t >= p.life) {
        p.s.destroy();
        this.specks.splice(i, 1);
      }
    }
    // 破绽：刚裂开白两帧，之后是天青的裂纹，慢慢明灭；偶尔落下一点碎光；快照完了淡掉
    for (const [id, [x, y, top, left]] of marks) {
      let m = this.marks.get(id);
      if (!m) {
        const s = new Sprite(this.crackTex[0]);
        s.anchor.set(0.5);
        this.layer.addChild(s);
        m = { s, age: 0, cd: rnd(0.4, 0.8) };
        this.marks.set(id, m);
      }
      m.age += dt;
      m.s.texture = this.crackTex[m.age < 0.12 ? 0 : 1];
      const cy = y - Math.round(top * 0.5);
      m.s.position.set(Math.round(x + 1), cy);
      const pulse = 0.72 + 0.28 * Math.sin(this.clock * 3.2 + id);
      m.s.alpha = clamp01(m.age / 0.08) * clamp01(left / 0.5) * (m.age < 0.3 ? 1 : pulse);
      m.cd -= dt;
      if (m.cd <= 0 && left > 0.4) {
        m.cd = rnd(0.6, 1.1);
        this.speck(x + rnd(-2, 3), cy + rnd(-2, 2), rnd(-6, 6), rnd(2, 6), rnd(0.5, 0.7), 14);
      }
    }
    for (const [id, m] of this.marks)
      if (!marks.has(id)) {
        m.s.destroy();
        this.marks.delete(id);
      }
  }

  /** 画一次照镜；放完了返回 false。 */
  private step(k: Cast): boolean {
    const t = k.t;
    const h = k.tgt.hero();
    if (h) [k.hx, k.hy] = h;
    const f = k.tgt.foe();
    if (f) [k.fx, k.fy, k.ftop] = f;
    // 古镜：人物肩侧、头那么高
    const mx = Math.round(k.hx + k.side * 15);
    const rise = 3 * (1 - easeOut(seg(t, 0, T_GATHER))) - 2 * easeOut(seg(t, T_MFADE0, LIFE));
    const bob = Math.round(Math.sin(t * 5) * 0.6);
    const my = Math.round(k.hy - 23 + rise + bob);
    k.mirror.position.set(mx, my);
    k.mirror.alpha = seg(t, 0.06, T_GATHER) * (1 - seg(t, T_MFADE0, LIFE - 0.1));
    let frame = 0;
    if (t >= T_SWEEP0 && t < T_SWEEP1) frame = 1 + Math.min(5, Math.floor(seg(t, T_SWEEP0, T_SWEEP1) * 6));
    else if (t >= T_FIRE && t < T_FIRE + 0.07) frame = 6;
    k.mirror.texture = this.mirrorTex[frame];
    // 镜光的两头：镜面（朝着照的方向偏一点）→ 妖物胸口
    const x0 = mx + k.side * 2;
    const y0 = my;
    const x1 = Math.round(k.fx);
    const y1 = Math.round(k.fy - k.ftop * 0.55);
    const g = this.dots;
    // 起势：灵光往镜心收拢（一像素的天青 + 石青的边，越近越亮）
    for (const q of k.gather) {
      const u = seg(t, q.d, q.d + 0.24);
      if (u <= 0 || u >= 1) continue;
      const e = easeOut(u);
      const px = Math.round(mx + q.x * (1 - e));
      const py = Math.round(my + q.y * (1 - e));
      g.rect(px, py + 1, 1, 1).fill({ color: c, alpha: 0.7 });
      g.rect(px, py, 1, 1).fill({ color: u > 0.6 ? W : C, alpha: 0.95 });
    }
    if (t >= T_FIRE && t < T_GONE) {
      const head = easeOut(seg(t, T_FIRE, T_ARRIVE));
      const tail = easeOut(seg(t, T_HOLD, T_GONE));
      const fade = 1 - 0.5 * seg(t, T_HOLD, T_GONE);
      this.drawBeam(g, x0, y0, x1, y1, tail, head, fade, t, k);
    }
    // 照出去的那一下：镜口一颗小星芒（十字，两像素的臂，月白到天青），0.12 秒收掉
    if (t >= T_FIRE && t < T_FIRE + 0.12) {
      const arm = t < T_FIRE + 0.06 ? 3 : 2;
      for (let j = 1; j <= arm; j++) {
        const col = j === 1 ? w : C;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.rect(x0 + ax * j, y0 + ay * j, 1, 1).fill({ color: col, alpha: 0.95 });
      }
      g.rect(x0, y0, 1, 1).fill({ color: W });
    }
    // 照到：镜光碎点迸一下，原形浮出来
    if (t >= T_ARRIVE && !k.burst) {
      k.burst = true;
      for (let i = 0; i < 6; i++) {
        const a = rnd(0, Math.PI * 2);
        const sp = rnd(14, 30);
        this.speck(x1, y1, Math.cos(a) * sp, Math.sin(a) * sp * 0.7 - 6, rnd(0.4, 0.65), 20);
      }
    }
    // 照妖：一道光从头顶扫到脚下（0.22 秒），扫过的地方浮出原形
    if (t >= T_ARRIVE && t < T_ARRIVE + 0.3) {
      const u = seg(t, T_ARRIVE, T_ARRIVE + 0.24);
      const sy = Math.round(k.fy - k.ftop + u * (k.ftop + 1));
      const hw = 6;
      const a = 1 - seg(t, T_ARRIVE + 0.2, T_ARRIVE + 0.3);
      g.rect(x1 - hw, sy, hw * 2 + 1, 1).fill({ color: W, alpha: 0.75 * a });
      g.rect(x1 - hw + 1, sy - 1, hw * 2 - 1, 1).fill({ color: C, alpha: 0.45 * a });
    }
    const gt = t - T_ARRIVE - 0.06;
    k.ghost.position.set(Math.round(k.fx), Math.round(k.fy - k.ftop * 0.78 - easeOut(seg(gt, 0, 1.05)) * 6));
    k.ghost.alpha = gt <= 0 ? 0 : 0.78 * seg(gt, 0, 0.14) * (1 - seg(gt, 0.45, 1.05)) * (gt < 0.3 && Math.floor(gt * 30) % 3 === 0 ? 0.6 : 1);
    // 余韵：古镜淡去时掉下两三点碎光
    if (t >= T_MFADE0 && t - k.drip >= 0.14) {
      k.drip = t;
      if (t < LIFE - 0.25) this.speck(mx + rnd(-3, 3), my + rnd(-2, 4), rnd(-5, 5), rnd(4, 10), rnd(0.45, 0.6), 12);
    }
    return t < LIFE;
  }

  /**
   * 镜光：u0..u1 是画出来的那一段（0 镜口、1 妖物）。镜口宽 3、到妖物身上散到 9；外层是天青的薄光（隔点画，像素画里的半透明），
   * 里面一层实一点，中间一道月白的光芯（下面压一道石青，浅色地上也看得清）；光里几点碎光往前走；地上一道很淡的投影。
   */
  private drawBeam(g: Dots, x0: number, y0: number, x1: number, y1: number, u0: number, u1: number, a: number, t: number, k: Cast) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / L;
    const ny = dx / L;
    const n0 = Math.floor(u0 * L);
    const n1 = Math.ceil(u1 * L);
    const seen = new Set<number>();
    const put = (x: number, y: number, color: number, alpha: number, layer: number) => {
      const key = (x + 2048) * 4096 + (y + 2048);
      if (seen.has(key * 4 + layer)) return;
      seen.add(key * 4 + layer);
      g.rect(x, y, 1, 1).fill({ color, alpha });
    };
    // 地上的余光：从人物脚下到妖物脚下，隔点画（很淡）
    const gx0 = k.hx + k.side * 6;
    const gy0 = k.hy;
    for (let i = n0; i <= n1; i += 2) {
      const u = i / L;
      const gx = Math.round(gx0 + (k.fx - gx0) * u);
      const gy = Math.round(gy0 + (k.fy - gy0) * u);
      put(gx, gy, C, 0.32 * a, 0);
    }
    for (let i = n0; i <= n1; i++) {
      const u = i / L;
      const cx = x0 + dx * u;
      const cy = y0 + dy * u;
      const hw = 1.2 + 3 * u;
      const shimmer = 0.85 + 0.15 * Math.sin(u * 9 - t * 14);
      for (let j = -Math.ceil(hw); j <= Math.ceil(hw); j++) {
        const px = Math.round(cx + nx * j);
        const py = Math.round(cy + ny * j);
        const edge = Math.abs(j) / (hw + 0.5);
        if (edge > 1) continue;
        if (edge > 0.55) {
          if ((px + py) & 1) put(px, py, edge > 0.8 ? c : C, 0.6 * a * shimmer, 1);
        } else put(px, py, C, 0.75 * a * shimmer, 1);
      }
      put(Math.round(cx), Math.round(cy) + 1, c, 0.7 * a * (1 - u * 0.5), 2);
      put(Math.round(cx), Math.round(cy), u < 0.12 ? W : w, 0.92 * a, 3);
    }
    // 光里往前走的碎光
    for (const m of k.motes) {
      const u = (((t - T_FIRE) * 1.6 + m.u) % 1 + 1) % 1;
      if (u < u0 || u > u1) continue;
      const hw = 1.2 + 3 * u;
      const px = Math.round(x0 + dx * u + nx * m.v * hw);
      const py = Math.round(y0 + dy * u + ny * m.v * hw);
      g.rect(px, py, 1, 1).fill({ color: W, alpha: a });
      g.rect(px - Math.sign(dx || 1), py, 1, 1).fill({ color: C, alpha: 0.8 * a });
    }
  }
}
