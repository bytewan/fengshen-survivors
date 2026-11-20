// 回响化身遭遇战的画面（和别的特效模块同一个接口：onEvent / update / clear）。只读 World.echo、它的本体（w.enemies 里 kind 'boss' 的那只）和 echo 事件。
// - 本体：本人的人物精灵换成「回响」的冷色（金、赭、檀换成石青、靛、黛：像从封神榜里拘回来的魂），和本人一样大（不放大成首领）；
//   走路、出招时身后拖几道很淡的天青残影，肩头偶尔冒一缕魂火（天青、月白的小火粒，往上飘散，不成圈、不罩住人）。
//   现身：魂火从四周聚过来、人慢慢显出来；换阶段：一震、魂火往外一迸；打倒：跪下（倒下的帧），整个人化成魂火往上散掉；
//   这一波结束还没打倒：原地淡下去、化成一缕墨烟（退走）。
// - 招式的预警全用 warn-fx 的淡红光（形状就是判定范围）；招式本身：
//   赵公明：定海珠（暗了的珠子从他手里画一道弧线飞出去，落地一震、尘土碎石）、金鞭（砸下的一瞬沿线一道石青的鞭影，地上留一道裂缝慢慢合上）、
//   黑虎（回响色的虎影在他身边显形，沿线扑过去，到尽头张口一吼：口前几道断开的墨色声浪往外推）、二十四珠（一圈珠子依次飞落，最后整圈一震）。
// 用户口径：不要光圈；预警用淡红光；出现和消失都有过程；尺寸照本人。声音先借现有的（docs/audio.md 的借用规则）。
import { Container, Sprite, type Texture } from 'pixi.js';
import { grid, type Grid } from '../art/pixel.ts';
import { makeZhaoFrames, ZHAO_ANCHOR, ZHAO_H, ZHAO_W } from '../art/sprites/zhao.ts';
import { TIGER_ANCHOR, TIGER_FRAMES, TIGER_H, TIGER_W } from '../art/sprites/heihu.ts';
import { textureFromGrid } from '../render/textures.ts';
import { ECHO_TONE, LUAN_TONE, TIGER_TONE, YUNXIAO_TONE, tone } from '../art/sprites/echo-tone.ts';
import { jindouGrid, makeYunxiaoFrames, YUNXIAO_ANCHOR, YUNXIAO_H, YUNXIAO_W } from '../art/sprites/yunxiao.ts';
import { riverBody, riverSwirl } from '../art/sprites/huanghe.ts';
import { makeAobingFrames, AOBING_ANCHOR, AOBING_H, AOBING_W } from '../art/sprites/aobing.ts';
import { iceBody, iceGlints } from '../art/sprites/aobing-fx.ts';
import { BIRD_H, BIRD_PIVOT, BIRD_W, qingluanFrames } from '../art/sprites/qingluan.ts';
import { outline } from '../art/pixel.ts';
import type { Stage } from '../render/stage.ts';
import type { Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { BANK } from '../audio/bank.ts';
import { ECHOS, echoEnemy, echoOf, echoPose, type EchoKind, type EchoPose } from '../sim/echo/index.ts';
import type { EchoHazard } from '../sim/echo/types.ts';
import { isEchoFamily } from '../sim/bosspool.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { C, clamp01, Pixels, rnd } from './fx.ts';
import { dragonHeads, drawDragonBody, headIndex } from './dragon-draw.ts';
import { DiskWarn, LaneWarn, warnLayer, type WarnLayer } from './warn-fx.ts';

// 回响色（金、赭、檀换成石青、靛、黛蓝）在 art/sprites/echo-tone.ts，回响化身的人物帧也用它
/** 残影：整个人压成一色天青的剪影（很淡地画）。 */
const ghostOf = (g: Grid): Grid => grid(g.rows.map((r) => r.replace(/[^.]/g, 'C')));

/** 魂火的颜色（天青、月白、石青）。 */
const SOUL = [C.Cc, C.w, C.c, C.Cc];
const DUST = [0x4f5652, 0x6d756c, 0x8f9787, 0x3e4855];
const INK = [C.k, C.d, C.g];

interface Look {
  w: number;
  h: number;
  anchor: { x: number; y: number };
  tex: Record<EchoPose, Texture[]>;
  ghost: Texture[];
  /** 手在哪（珠子从这里飞出去；相对脚底，朝右时）。 */
  hand: [number, number];
}

/** 敖丙的小像（解锁卡、图鉴、对白头像用）：待机第一帧，裁掉右边留给戟刺出去的空白。 */
/** 敖丙的一整套帧只拼一次（拼一次要十几毫秒、手机上好几倍；小像、对白头像、战斗里的帧都从这里拿。docs/perf.md）。 */
let aobingFramesMemo: ReturnType<typeof makeAobingFrames> | null = null;
const aobingFrames = () => (aobingFramesMemo ??= makeAobingFrames());
const aobingPortrait = (): Grid => {
  const g = aobingFrames().idle[0];
  return grid(g.rows.map((r) => r.slice(4, 40)));
};

const looks = new Map<EchoKind, Look>();
function lookOf(kind: EchoKind): Look {
  let l = looks.get(kind);
  if (l) return l;
  if (kind === 'aobing') {
    // 敖丙不是谁的换色：自己的一套帧、自己的颜色（月白、银、天青，本来就是冷色），不再过回响的调色板
    const f = aobingFrames();
    const t = (gs: Grid[]) => gs.map((g) => textureFromGrid(g));
    l = {
      w: AOBING_W,
      h: AOBING_H,
      anchor: AOBING_ANCHOR,
      tex: { idle: t(f.idle), walk: t(f.move), raise: t(f.windup), strike: t([...f.throw, ...f.follow]), roar: t(f.windup), down: t(f.down), dragon: t(f.idleBare) },
      ghost: [...f.move, ...f.throw].map((g) => textureFromGrid(ghostOf(g))),
      hand: [9, -18],
    };
    looks.set(kind, l);
    return l;
  }
  const yun = kind === 'yunxiao';
  const f = yun ? makeYunxiaoFrames() : makeZhaoFrames();
  const m = yun ? YUNXIAO_TONE : ECHO_TONE;
  const t = (gs: Grid[]) => gs.map((g) => textureFromGrid(tone(g, m)));
  l = {
    w: yun ? YUNXIAO_W : ZHAO_W,
    h: yun ? YUNXIAO_H : ZHAO_H,
    anchor: yun ? YUNXIAO_ANCHOR : ZHAO_ANCHOR,
    tex: { idle: t(f.idle), walk: t(f.move), raise: t(f.windup), strike: t([...f.throw, ...f.follow]), roar: t(f.windup), down: t(f.down), dragon: t(f.idle) },
    ghost: [...f.move, ...f.throw].map((g) => textureFromGrid(ghostOf(g))),
    hand: yun ? [6, -16] : [7, -16],
  };
  looks.set(kind, l);
  return l;
}
/** 解锁卡上的小像：回响色的本人，待机第一帧。 */
export function echoPortrait(kind: EchoKind): Grid {
  if (kind === 'aobing') return aobingPortrait();
  return kind === 'yunxiao' ? tone(makeYunxiaoFrames().idle[0], YUNXIAO_TONE) : tone(makeZhaoFrames().idle[0], ECHO_TONE);
}
/** 回响的混元金斗（回响色：斗身石青、斗口靛）。 */
let douTex: Texture | null = null;
const douLook = () => (douTex ??= textureFromGrid(outline(tone(jindouGrid(1, null), ECHO_TONE), 'k', { c: 'N', C: 'n', n: 'N' })));
/** 九曲黄河的水（黄河的水不换色：一眼认得出是九曲黄河）：按半径缓存水底和一组漩涡帧。 */
const riverTex = new Map<number, { body: Texture; swirl: Texture[] }>();
const riverLook = (r: number) => {
  let v = riverTex.get(r);
  if (!v) {
    v = { body: textureFromGrid(riverBody(r, r * 7)), swirl: riverSwirl(r, r * 7, 12).map(textureFromGrid) };
    riverTex.set(r, v);
  }
  return v;
};
/** 敖丙冰龙留下的冰面：按半径缓存冰面和一组碎光帧（和黄河水同一个接口：body + swirl）。 */
const iceTex = new Map<number, { body: Texture; swirl: Texture[] }>();
const iceLook = (r: number) => {
  let v = iceTex.get(r);
  if (!v) {
    v = { body: textureFromGrid(iceBody(r, r * 5)), swirl: iceGlints(r, r * 5, 6).map(textureFromGrid) };
    iceTex.set(r, v);
  }
  return v;
};
/** 冰、水的颜色（霜白、天青、石青、月白）。 */
const FROST = [0xc3ccd2, C.Cc, C.w, C.W];
const WATER = [C.Cc, C.c, C.w, C.n];
let luanTex: Texture[] | null = null;
const luanLook = () => (luanTex ??= qingluanFrames(null, 0).fly.map((g) => textureFromGrid(tone(g, LUAN_TONE))));
let tigerTex: Record<'idle' | 'run' | 'roar', Texture[]> | null = null;
function tigerLook() {
  tigerTex ??= {
    idle: TIGER_FRAMES.idle.map((g) => textureFromGrid(tone(g, TIGER_TONE))),
    run: TIGER_FRAMES.run.map((g) => textureFromGrid(tone(g, TIGER_TONE))),
    roar: TIGER_FRAMES.roar.map((g) => textureFromGrid(tone(g, TIGER_TONE))),
  };
  return tigerTex;
}
/** 回响的定海珠：4×4 的暗珠（黛、靛，一点天青的光）。 */
const BEAD = grid(['.nc.', 'ncCn', 'nccn', '.Nn.']);

interface Body {
  id: number;
  kind: EchoKind;
  s: Sprite;
  sh: Sprite;
  x: number;
  y: number;
  facing: 1 | -1;
  alpha: number;
  ghostCd: number;
  soulCd: number;
  pose: EchoPose;
  frame: number;
  /** 'live' 打着；'dead' 打倒了（跪下、化成魂火散掉）；'leave' 退走（淡下去）。 */
  end: 'live' | 'dead' | 'leave';
  endT: number;
  /** 当首领时倒下：先跪着不散，等战后对白里旁白那一句（dissolve）再化成魂火。 */
  hold: boolean;
  flash: number;
}
interface HazardView {
  h: EchoHazard;
  warn: DiskWarn | LaneWarn;
  struck: boolean;
  bead?: Sprite;
  beadFrom?: [number, number];
  /** 回响云霄：混元金斗（悬着、扣下）。 */
  dou?: Sprite;
  /** 回响云霄：九曲黄河的水（水底、漩涡）；回响敖丙：冰面（冰、碎光）。frames 是上面那一层的循环帧。 */
  river?: { body: Sprite; swirl: Sprite; n: number; frames: Texture[] };
  /** 回响敖丙化龙：这一趟冲完了（白龙散成水雾，只散一次）。 */
  misted?: boolean;
  /** 回响敖丙：冰龙 / 白龙的龙头。 */
  head?: Sprite;
  /** 危险物没了之后，这些东西淡出还剩多久。 */
  fade?: number;
}
interface Flight {
  s: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}
interface Ghost {
  s: Sprite;
  t: number;
}
interface Crack {
  pts: [number, number][];
  t: number;
  life: number;
}
interface Wave {
  x: number;
  y: number;
  r: number;
  t: number;
  dir: number;
}

export class EchoFx {
  private body: Body | null = null;
  private hz = new Map<number, HazardView>();
  private ghosts: Ghost[] = [];
  private cracks: Crack[] = [];
  private roars: Wave[] = [];
  private tiger: { s: Sprite; sh: Sprite; alpha: number; t: number; roar: number } | null = null;
  private birds: Flight[] = [];
  private floor = new Pixels();
  private top = new Pixels();
  private layer = new Container();
  private warns: WarnLayer;
  private beadTex: Texture;
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
    this.warns = warnLayer(stage);
    stage.floor.addChild(this.floor.g);
    stage.fx.addChild(this.layer);
    this.layer.addChild(this.top.g);
    this.beadTex = textureFromGrid(BEAD);
  }

  /**
   * 开局时把这一局会出场的回响化身（首领池抽到的：遭遇战的客人、当首领的）的帧和纹理先拼好——
   * 不然他现身的那一帧现拼，正打着顿一下（4 倍降速量到 100 毫秒，docs/perf.md）。开局那一刻本来就在载入，多十几毫秒看不出来。
   */
  warm(w: World) {
    for (const c of w.cast ?? []) for (const id of [c?.guest, c?.chief]) if (id && isEchoFamily(id)) lookOf(id);
  }

  private play(name: string, fallback: string, vol = 1) {
    this.sfx.play(BANK[name] ? name : fallback, vol);
  }

  /** 场上有没有回响（镜头要不要照顾它）。 */
  get focus(): { x: number; y: number } | null {
    return this.body && this.body.end === 'live' ? { x: this.body.x, y: this.body.y } : null;
  }

  clear() {
    if (this.body) {
      this.body.s.destroy();
      this.body.sh.destroy();
      this.body = null;
    }
    for (const v of this.hz.values()) this.dropView(v);
    this.hz.clear();
    for (const b of this.birds) b.s.destroy();
    this.birds = [];
    for (const g of this.ghosts) g.s.destroy();
    this.ghosts = [];
    this.cracks = [];
    this.roars = [];
    this.dropTiger();
    this.floor.flush();
    this.top.flush();
  }

  private dropTiger() {
    if (!this.tiger) return;
    this.tiger.s.destroy();
    this.tiger.sh.destroy();
    this.tiger = null;
  }

  /** 倒下的首领还在不在场上（当首领时；表现层用来定镜头、等它散去）。 */
  get corpseFocus(): { x: number; y: number } | null {
    const b = this.body;
    return b && b.end === 'dead' && b.hold ? { x: b.x, y: b.y } : null;
  }

  /** 战后对白里旁白那一句、对白放完：跪着的回响化成魂火散去。 */
  dissolve() {
    const b = this.body;
    if (b && b.end === 'dead' && b.hold) {
      b.hold = false;
      b.endT = Math.max(b.endT, 0.5);
    }
  }

  /**
   * 首领池（sim/bosspool.ts）：回响这一族当章节首领时，流程的事件是 bossIntro / bossPhase / bossDeath——换成遭遇战的那三个，
   * 入场、换阶段、倒下的画面同一套（倒下之后先跪着，等对白）。别的首领来遭遇战时发的 echo 流程事件不归这里画（它们有自己的画面模块）。
   */
  private own(e: SimEvent, w: World): SimEvent | null {
    const mine = (k: string): k is EchoKind => Object.hasOwn(ECHOS, k);
    switch (e.t) {
      case 'bossIntro':
        return mine(e.kind) ? { t: 'echoIntro', id: e.id, kind: e.kind, x: e.x, y: e.y } : null;
      case 'bossPhase': {
        const f = echoOf(w);
        return f && f.id === e.id ? { t: 'echoPhase', id: e.id, kind: f.kind, phase: e.phase, x: e.x, y: e.y } : null;
      }
      case 'bossDeath':
        return mine(e.kind) ? { t: 'echoDefeat', id: e.id, kind: e.kind, x: e.x, y: e.y, facing: e.facing, unlock: '' } : null;
      case 'echoIntro':
      case 'echoPhase':
      case 'echoDefeat':
      case 'echoLeave':
        return mine(e.kind) ? e : null;
      default:
        return e;
    }
  }

  onEvent(e0: SimEvent, w: World) {
    const e = this.own(e0, w);
    if (!e) return;
    switch (e.t) {
      case 'waveStart':
        this.clear();
        break;
      case 'echoIntro': {
        this.clear();
        this.ensureBody(w, e.id, e.kind as EchoKind, e.x, e.y);
        // 魂火从四周聚过来
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          const d = rnd(26, 40);
          this.sparks.emit(e.x + Math.cos(a) * d, e.y - 12 + Math.sin(a) * d * 0.6, 1, SOUL, [20, 34], [0.7, 1.1], { dir: a + Math.PI, spread: 0.2, drag: 1.2 });
        }
        this.play('echo.intro', 'boss.intro', 0.8);
        break;
      }
      case 'echoMove':
        if (e.move === 'tiger') this.play('echo.tiger', 'boss.roar', 0.45);
        break;
      case 'echoStrike': {
        const v = this.hz.get(e.hazard);
        if (v) this.strike(v);
        break;
      }
      case 'echoPhase':
        if (this.body) {
          this.body.flash = 0.25;
          for (let k = 0; k < 22; k++) this.sparks.emit(this.body.x, this.body.y - 14, 1, SOUL, [30, 70], [0.5, 0.9], { up: 18, drag: 2 });
        }
        this.shake.add(0.35);
        this.play('echo.phase', 'boss.phase', 0.8);
        break;
      case 'echoDefeat':
        if (this.body) {
          this.body.end = 'dead';
          this.body.endT = 0;
          this.body.hold = e0.t === 'bossDeath'; // 当首领：跪着等战后对白
          this.body.x = e.x;
          this.body.y = e.y;
        }
        this.endHazards();
        this.dropTiger();
        this.shake.add(0.5);
        this.play('echo.defeat', 'boss.death', 0.9);
        break;
      case 'echoLeave':
        if (this.body) {
          this.body.end = 'leave';
          this.body.endT = 0;
          this.body.x = e.x;
          this.body.y = e.y;
        }
        this.endHazards();
        this.dropTiger();
        break;
    }
  }

  private endHazards() {
    for (const v of this.hz.values()) {
      v.warn.end(0.25);
      v.bead?.destroy();
      v.bead = undefined;
    }
  }

  private dropView(v: HazardView) {
    v.warn.destroy();
    v.bead?.destroy();
    v.head?.destroy();
    v.dou?.destroy();
    v.river?.body.destroy();
    v.river?.swirl.destroy();
  }

  private ensureBody(w: World, id: number, kind: EchoKind, x: number, y: number): Body {
    if (this.body && this.body.id === id) return this.body;
    if (this.body) {
      this.body.s.destroy();
      this.body.sh.destroy();
    }
    const L = lookOf(kind);
    const s = new Sprite(L.tex.idle[0]);
    s.anchor.set(L.anchor.x / L.w, L.anchor.y / L.h);
    s.alpha = 0;
    this.stage.entities.addChild(s);
    const sh = new Sprite(this.stage.tex.shadow);
    sh.anchor.set(0.5);
    sh.alpha = 0;
    this.stage.floor.addChild(sh);
    const f = echoOf(w);
    this.body = { id, kind, s, sh, x, y, facing: f?.facing ?? 1, alpha: 0, ghostCd: 0, soulCd: 0.3, pose: 'roar', frame: 0, end: 'live', endT: 0, hold: false, flash: 0 };
    return this.body;
  }

  // ---------- 招式：出手那一下 ----------

  private strike(v: HazardView) {
    v.struck = true;
    const h = v.h;
    if (h.move !== 'tide') v.warn.strike(); // 浪是一整面推过来的：几道一起闪太晃眼，不闪，浪头自己就是出手的那一下
    if (h.move === 'ji') {
      // 画戟刺出：沿线一道寒光（很快淡掉），线上迸几粒冰屑
      const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
      for (let s = 10; s <= len; s += 14) this.sparks.emit(h.x0 + ((h.x1 - h.x0) * s) / len, h.y0 + ((h.y1 - h.y0) * s) / len - 3, 1, FROST, [8, 26], [0.25, 0.45], { drag: 4 });
      this.whipStreak = { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, t: 0 };
      this.shake.add(0.14);
      this.play('echo.ji', 'dashen.lash', 0.6);
    } else if (h.move === 'icelong' && h.kind === 'pounce') {
      this.play('echo.icelong', 'hanbing.spike', 0.7);
    } else if (h.move === 'icelong' && !h.ice) {
      // 冰龙到尽头炸开：冰碴往四周迸（收在判定半径里），地上几道裂
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + rnd(-0.2, 0.2);
        this.sparks.emit(h.x0 + Math.cos(a) * 3, h.y0 + Math.sin(a) * 2, 1, FROST, [h.r * 1.5, h.r * 2.6], [0.3, 0.5], { dir: a, spread: 0.25, drag: 5 });
      }
      this.sparks.emit(h.x0, h.y0 - 3, 6, FROST, [20, 50], [0.35, 0.6], { up: 44, g: 220, drag: 1.5 });
      this.cracks.push({ pts: star(h.x0, h.y0, h.r * 0.75, 6), t: 0, life: 1.1 });
      this.shake.add(0.22);
      this.play('echo.iceburst', 'hanbing.frost', 0.8);
    } else if (h.move === 'icelong') {
      // 冰面结起来（贴图在 updateHazards 里淡入）
    } else if (h.move === 'tide') {
      // 浪头推出来：一阵浪只响一声
      if (this.time - this.tideSfxT > 0.4) {
        this.tideSfxT = this.time;
        this.shake.add(0.16);
        this.play('echo.tide', 'elite.yecha.slap', 0.8);
      }
    } else if (h.move === 'hualong') {
      // 化龙：人化成一团水雾，白龙从雾里冲出去
      for (let k = 0; k < 16; k++) this.sparks.emit(h.x0 + rnd(-6, 6), h.y0 - rnd(2, 22), 1, WATER, [10, 40], [0.35, 0.6], { up: 14, drag: 2.5 });
      this.shake.add(0.2);
      this.play('echo.hualong', 'boss.dash', 0.8);
    } else if (h.kind === 'disk' && (h.move === 'beads' || h.move === 'rosary')) {
      v.bead?.destroy();
      v.bead = undefined;
      const big = !!h.quake;
      // 落地一震：尘土往四周掀开（收在判定半径里），碎石崩起
      const n = big ? 26 : 9;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd(-0.2, 0.2);
        this.sparks.emit(h.x0 + Math.cos(a) * h.r * 0.3, h.y0 + Math.sin(a) * h.r * 0.2, 1, DUST, [h.r * 1.4, h.r * 2.4], [0.3, 0.5], { dir: a, spread: 0.3, drag: 5 });
      }
      this.sparks.emit(h.x0, h.y0 - 2, big ? 8 : 3, [0x4f5652, 0x6d756c], [25, 60], [0.35, 0.6], { up: 50, g: 240, drag: 1.5 });
      if (!big) this.sparks.emit(h.x0, h.y0 - 3, 3, SOUL, [6, 16], [0.3, 0.5], { up: 12, drag: 3 });
      this.cracks.push({ pts: star(h.x0, h.y0, h.r * (big ? 0.9 : 0.7), big ? 9 : 5), t: 0, life: big ? 1.4 : 0.9 });
      this.shake.add(big ? 0.3 : 0.08);
      if (!h.seq || h.seq % 3 === 1 || big) this.play('echo.bead', 'fantian.land', big ? 0.8 : 0.4);
    } else if (h.kind === 'lane' && h.move === 'whip') {
      // 金鞭砸下：沿线一道石青的鞭影（很快淡掉），尘土往两边掀开，地上留一道裂缝
      const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
      const nx = -(h.y1 - h.y0) / len;
      const ny = (h.x1 - h.x0) / len;
      for (let s = 0; s <= len; s += 8)
        for (const side of [-1, 1])
          this.sparks.emit(h.x0 + ((h.x1 - h.x0) * s) / len + nx * side * 3, h.y0 + ((h.y1 - h.y0) * s) / len + ny * side * 3, 1, DUST, [h.r * 2, h.r * 3.2], [0.3, 0.5], { dir: Math.atan2(ny * side, nx * side), spread: 0.5, drag: 4.5 });
      this.cracks.push({ pts: seam(h.x0, h.y0, h.x1, h.y1), t: 0, life: 1.6 });
      this.whipStreak = { x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, t: 0 };
      this.shake.add(0.25);
      this.play('echo.whip', 'dashen.lash', 0.7);
    } else if (h.kind === 'disk' && h.move === 'tiger') {
      // 黑虎到尽头一吼：口前几道断开的墨色声浪往外推
      for (let k = 0; k < 3; k++) this.roars.push({ x: h.x0, y: h.y0 - 4, r: h.r * (0.35 + k * 0.12), t: -k * 0.08, dir: this.tiger ? (this.tiger.s.scale.x >= 0 ? 0 : Math.PI) : 0 });
      if (this.tiger) this.tiger.roar = 0.4;
      this.sparks.emit(h.x0, h.y0, 10, DUST, [h.r * 1.2, h.r * 2], [0.3, 0.5], { drag: 4 });
      this.shake.add(0.2);
      this.play('echo.roar', 'boss.roar', 0.6);
    } else if (h.kind === 'pounce') {
      this.play('echo.pounce', 'enemy.charge', 0.5);
    } else if (h.kind === 'pull') {
      // 混元金斗扣下：斗落到地上，溅起一圈魂色的水
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        this.sparks.emit(h.x0 + Math.cos(a) * 4, h.y0 + Math.sin(a) * 3, 1, [C.Cc, C.c, C.w], [(h.core ?? 20) * 1.6, (h.core ?? 20) * 2.6], [0.3, 0.5], { dir: a, spread: 0.3, drag: 4.5 });
      }
      this.sparks.emit(h.x0, h.y0 - 4, 8, [C.Cc, C.w], [20, 50], [0.3, 0.5], { up: 40, g: 200, drag: 2 });
      this.shake.add(0.3);
      this.play('echo.dou', 'xuanyuan.pool', 0.8);
    } else if (h.kind === 'disk' && h.tick) {
      if (!h.seq || h.seq === 1) this.play('echo.river', 'xuanyuan.vortex', 0.6);
    } else if (h.kind === 'lane' && h.move === 'luan') {
      // 青鸾掠过：回响色的鸾影贴着地沿线飞过去
      const s = new Sprite(luanLook()[0]);
      s.anchor.set(BIRD_PIVOT.x / BIRD_W, BIRD_PIVOT.y / BIRD_H);
      s.scale.x = h.x1 >= h.x0 ? 1 : -1;
      this.layer.addChild(s);
      this.birds.push({ s, x0: h.x0, y0: h.y0 - 8, x1: h.x1, y1: h.y1 - 8, t: 0 });
      this.play('echo.luan', 'pet.fly', 0.7);
    }
  }

  private whipStreak: { x0: number; y0: number; x1: number; y1: number; t: number } | null = null;
  private tideSfxT = -9;

  // ---------- 每帧 ----------

  update(dt: number, w: World, alpha: number) {
    this.time += dt;
    const f = echoOf(w);
    const e = f ? echoEnemy(w) : null;
    if (f && e && (!this.body || this.body.id !== e.id)) this.ensureBody(w, e.id, f.kind, e.x, e.y);
    this.updateBody(dt, w, alpha);
    this.updateHazards(dt, w);
    this.updateTiger(dt, w, alpha);
    this.drawFloor(dt);
    this.updateGhosts(dt);
  }

  private updateBody(dt: number, w: World, alpha: number) {
    const b = this.body;
    if (!b) return;
    const L = lookOf(b.kind);
    const f = echoOf(w);
    const e = f && f.id === b.id ? echoEnemy(w) : null;
    if (b.end === 'live' && f && e) {
      b.x = e.px + (e.x - e.px) * alpha;
      b.y = e.py + (e.y - e.py) * alpha;
      b.facing = f.facing;
      b.pose = echoPose(f);
      // 现身：慢慢显出来
      // 现身：慢慢显出来；化龙：人很快淡成水雾（龙冲完了再慢慢显回来）
      b.alpha = f.state === 'intro' ? clamp01(f.t / f.dur) : b.pose === 'dragon' ? Math.max(0, b.alpha - dt * 9) : Math.min(1, b.alpha + dt * 3);
    } else if (b.end === 'live') {
      // 状态没了（换波、存档恢复）：当退走处理
      b.end = 'leave';
      b.endT = 0;
    }
    if (b.end !== 'live') {
      b.endT += dt;
      if (b.end === 'dead') {
        b.pose = 'down';
        // 跪下停一会儿，再化成魂火往上散掉（当首领时先跪着，等 dissolve）
        if (b.hold) b.endT = Math.min(b.endT, 0.5);
        const k = clamp01((b.endT - 0.5) / 1.1);
        b.alpha = 1 - k;
        if (b.endT > 0.5 && Math.random() < 0.9) this.sparks.emit(b.x + rnd(-6, 6), b.y - rnd(2, 22), 1, SOUL, [4, 12], [0.6, 1], { up: 22, drag: 1.5 });
        else if (b.hold && Math.random() < 0.12) this.sparks.emit(b.x + rnd(-6, 6), b.y - rnd(4, 20), 1, SOUL, [3, 8], [0.6, 1], { up: 14, drag: 1.5 });
      } else {
        b.pose = 'idle';
        // 退走：原地淡下去，化成一缕墨烟
        const k = clamp01(b.endT / 0.9);
        b.alpha = 1 - k;
        if (Math.random() < 0.8) this.sparks.emit(b.x + rnd(-5, 5), b.y - rnd(4, 20), 1, INK, [3, 10], [0.5, 0.9], { up: 16, drag: 1.5 });
      }
      if (b.alpha <= 0) {
        b.s.destroy();
        b.sh.destroy();
        this.body = null;
        return;
      }
    }
    const fr = L.tex[b.pose];
    b.frame += dt * (b.pose === 'walk' ? 8 : 5);
    b.s.texture = fr[Math.floor(b.frame) % fr.length];
    b.s.scale.x = b.facing;
    b.s.position.set(Math.round(b.x), Math.round(b.y));
    b.s.zIndex = Math.round(b.y);
    b.flash = Math.max(0, b.flash - dt);
    b.s.tint = b.flash > 0 ? 0xc8f0f0 : 0xffffff;
    // 回响：比活人淡一点，隐隐地透
    b.s.alpha = b.alpha * (0.86 + 0.06 * Math.sin(this.time * 3.1));
    b.sh.position.set(Math.round(b.x), Math.round(b.y));
    b.sh.alpha = 0.35 * b.alpha;
    if (b.end !== 'live' || b.pose === 'dragon') return;
    // 残影：走路、出招时身后几道很淡的天青剪影
    b.ghostCd -= dt;
    if ((b.pose === 'walk' || b.pose === 'strike') && b.ghostCd <= 0) {
      b.ghostCd = 0.12;
      const g = new Sprite(L.ghost[Math.floor(b.frame) % L.ghost.length]);
      g.anchor.copyFrom(b.s.anchor);
      g.scale.x = b.facing;
      g.position.copyFrom(b.s.position);
      g.zIndex = b.s.zIndex - 1;
      g.alpha = 0.22;
      this.stage.entities.addChild(g);
      this.ghosts.push({ s: g, t: 0 });
    }
    // 魂火：肩头偶尔冒一缕
    b.soulCd -= dt;
    if (b.soulCd <= 0) {
      b.soulCd = rnd(0.12, 0.3);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.sparks.emit(b.x + side * rnd(3, 7), b.y - rnd(16, 22), 1, SOUL, [2, 6], [0.4, 0.75], { up: 14, drag: 2 });
    }
  }

  private updateHazards(dt: number, w: World) {
    const f = echoOf(w);
    const live = new Set<number>();
    if (f && f.state !== 'dead')
      for (const h of f.hazards) {
        live.add(h.id);
        let v = this.hz.get(h.id);
        if (!v) {
          const warn = h.kind === 'disk' || h.kind === 'pull' ? new DiskWarn(this.warns, h.x0, h.y0, Math.round(h.kind === 'pull' ? (h.core ?? h.r) : h.r)) : new LaneWarn(this.warns, h.x0, h.y0, h.x1, h.y1, h.r, h.kind === 'pounce' ? Math.hypot(h.x1 - h.x0, h.y1 - h.y0) / Math.max(0.05, h.live) : 0, { every: 16, start: 12, size: 3 });
          v = { h, warn, struck: false };
          // 混元金斗：悬在那一片的上方；九曲黄河：水铺在地上（出手了才显出来）
          if (h.kind === 'pull') {
            const s = new Sprite(douLook());
            s.anchor.set(0.5);
            s.alpha = 0;
            this.layer.addChild(s);
            v.dou = s;
          }
          if (h.kind === 'disk' && h.tick) {
            const R = h.ice ? iceLook(Math.round(h.r)) : riverLook(Math.round(h.r));
            const body = new Sprite(R.body);
            const swirl = new Sprite(R.swirl[0]);
            for (const s of [body, swirl]) {
              s.anchor.set(0.5);
              s.position.set(Math.round(h.x0), Math.round(h.y0));
              s.alpha = 0;
              this.stage.floor.addChild(s);
            }
            v.river = { body, swirl, n: R.swirl.length, frames: R.swirl };
          }
          // 珠子：从他手里飞出去（飞的这一段就是预警）
          if (h.kind === 'disk' && (h.move === 'beads' || h.move === 'rosary') && !h.quake) {
            const s = new Sprite(this.beadTex);
            s.anchor.set(0.5);
            this.layer.addChild(s);
            v.bead = s;
            v.beadFrom = [h.x1, h.y1];
          }
          this.hz.set(h.id, v);
          if (h.move === 'beads' && h.seq === undefined && this.hz.size === 1) this.play('echo.throw', 'qiankun.throw', 0.4);
        }
        v.h = h;
        const k = clamp01(h.t / Math.max(0.01, h.warn));
        if (v.warn instanceof LaneWarn) {
          const len = v.warn.len;
          if (h.kind === 'pounce' && h.t >= h.warn) {
            const head = Math.hypot(h.x - h.x0, h.y - h.y0);
            v.warn.draw(dt, k, { from: head, to: len, head });
          } else v.warn.draw(dt, k, h.t >= h.warn ? { from: 0, to: len } : undefined);
        } else v.warn.draw(dt, k);
        if (v.dou) {
          // 悬着：慢慢上下浮；四周的东西往斗下收（一缕缕魂色的水往中心流）。扣下：0.1 秒落到地上
          const tl = h.t - h.warn;
          const hover = h.y0 - 30 + Math.sin(this.time * 3) * 1.5;
          const y = tl < 0 ? hover : hover + (h.y0 - 6 - hover) * clamp01(tl / 0.1);
          v.dou.position.set(Math.round(h.x0), Math.round(y));
          v.dou.alpha = Math.min(1, h.t / 0.25);
          if (tl < 0 && Math.random() < 0.8) {
            const a = Math.random() * Math.PI * 2;
            const d = h.r * rnd(0.55, 0.95);
            this.sparks.emit(h.x0 + Math.cos(a) * d, h.y0 + Math.sin(a) * d * 0.62, 1, [C.Cc, C.c, C.w], [d * 1.2, d * 1.6], [0.45, 0.6], { dir: a + Math.PI, spread: 0.15, drag: 1 });
          }
        }
        if (v.river) {
          // 水：出手了才显出来（0.25 秒），最后 0.3 秒淡下去；漩涡一直在转
          const tl = h.t - h.warn;
          const a = tl < 0 ? 0 : Math.min(1, tl / 0.25) * Math.min(1, (h.live - tl) / 0.3);
          v.river.body.alpha = 0.85 * a;
          v.river.swirl.alpha = a;
          v.river.swirl.texture = v.river.frames[Math.floor(this.time * (h.ice ? 6 : 10)) % v.river.n];
        }
        // 回响敖丙：沿线走的东西每帧画（冰龙、浪头、化成的白龙）
        if (h.kind === 'pounce' && (h.move === 'icelong' || h.move === 'tide' || h.move === 'hualong')) this.drawAobing(v);
        if (v.bead && v.beadFrom) {
          // 一道低低的弧线：最高离地 26 像素，落下时最快
          const q = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
          const [fx, fy] = v.beadFrom;
          const x = fx + (h.x0 - fx) * q;
          const y = fy + (h.y0 - fy) * q - Math.sin(Math.PI * q) * 26;
          v.bead.position.set(Math.round(x), Math.round(y));
          v.bead.alpha = clamp01(h.t / 0.12);
          if (Math.random() < 0.5) this.sparks.emit(x, y, 1, SOUL, [2, 5], [0.2, 0.35], { drag: 3 });
        }
      }
    for (const [id, v] of this.hz) {
      if (live.has(id)) continue;
      v.bead?.destroy();
      v.bead = undefined;
      if (!v.misted && v.struck && (v.h.move === 'hualong' || (v.h.move === 'icelong' && v.h.kind === 'pounce'))) {
        // 龙冲到尽头：散成一团水雾 / 冰屑（不是一下没了）
        v.misted = true;
        for (let k = 0; k < (v.h.move === 'hualong' ? 18 : 8); k++) this.sparks.emit(v.h.x1 + rnd(-8, 8), v.h.y1 - rnd(2, 18), 1, v.h.move === 'hualong' ? WATER : FROST, [8, 30], [0.4, 0.7], { up: 12, drag: 2.5 });
      }
      v.warn.end(0.3);
      v.warn.draw(dt, 1);
      // 金斗、水：淡下去
      v.fade = (v.fade ?? 0.3) - dt;
      const a = clamp01((v.fade ?? 0) / 0.3);
      if (v.dou) v.dou.alpha = a;
      if (v.head) v.head.alpha = Math.min(v.head.alpha, a);
      if (v.river) {
        v.river.body.alpha = Math.min(v.river.body.alpha, 0.85 * a);
        v.river.swirl.alpha = Math.min(v.river.swirl.alpha, a);
      }
      if (v.warn.done && (v.fade ?? 0) <= 0) {
        this.dropView(v);
        this.hz.delete(id);
      }
    }
    // 青鸾掠过：0.3 秒飞完，一路落几片羽毛
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.t += dt;
      const k = b.t / 0.3;
      if (k >= 1.2) {
        b.s.destroy();
        this.birds.splice(i, 1);
        continue;
      }
      const q = Math.min(1, k);
      const x = b.x0 + (b.x1 - b.x0) * q;
      const y = b.y0 + (b.y1 - b.y0) * q;
      b.s.position.set(Math.round(x), Math.round(y));
      b.s.texture = luanLook()[Math.floor(b.t * 20) % luanLook().length];
      b.s.alpha = k < 1 ? Math.min(1, b.t / 0.06) : 1 - (k - 1) / 0.2;
      if (Math.random() < 0.6) this.sparks.emit(x, y + 2, 1, [C.Cc, C.c, C.n], [3, 9], [0.4, 0.7], { g: 30, drag: 2 });
    }
  }

  /**
   * 回响敖丙沿线走的那几样（每帧按危险物现在的位置画，像素点，不成圈、不带光晕）：
   *  - 冰龙：一条 30 来像素长的小龙贴着地游过去（霜白的脊、天青的腹、一路掉冰屑）；预警时戟尖上先聚一团寒气。
   *  - 浪头：横在这一道上的一段浪——前沿一线白沫，后面两三档水色往后淡下去；几道并排，连成一面缺了一道的浪墙。
   *  - 白龙（化龙）：比冰龙大一号（长约 52、最粗 5），飞在离地七八像素的地方，身下有影子；龙角、背鳍是天青。
   */
  private drawAobing(v: HazardView) {
    const h = v.h;
    const len = Math.hypot(h.x1 - h.x0, h.y1 - h.y0) || 1;
    const ux = (h.x1 - h.x0) / len;
    const uy = (h.y1 - h.y0) / len;
    const live = h.t >= h.warn;
    if (h.move === 'tide') {
      if (!live) return;
      const F = this.floor;
      const nx = -uy;
      const ny = ux;
      const fadeIn = clamp01((h.t - h.warn) / 0.12);
      const fadeOut = clamp01((len - Math.hypot(h.x - h.x0, h.y - h.y0)) / 18);
      const a = fadeIn * fadeOut;
      for (let o = -h.r; o <= h.r; o++) {
        // 浪沿：左右连得上（按这一道在场上的位置起伏，不按每道自己的中心）
        const along = (h.x0 + nx * o) * nx + (h.y0 + ny * o) * ny;
        const wob = Math.sin(along * 0.21 + this.time * 7) * 2 + Math.sin(along * 0.55 - this.time * 4) * 0.8;
        const bx = h.x + nx * o + ux * wob;
        const by = h.y + ny * o + uy * wob;
        // 前沿一线白沫（断断续续地翻），后面水色一档档暗下去、越往后越稀
        F.dot(bx + ux * 2, by + uy * 2, C.W, a * (Math.sin(along * 0.9 + this.time * 11) > 0.2 ? 1 : 0));
        F.dot(bx + ux, by + uy, C.W, a);
        F.dot(bx, by, C.w, a);
        for (let k = 1; k <= 3; k++) F.dot(bx - ux * k, by - uy * k, C.Cc, a);
        for (let k = 4; k <= 7; k++) F.dot(bx - ux * k, by - uy * k, C.c, a * 0.9);
        for (let k = 8; k <= 11; k++) if (((Math.round(along) + k) & 1) === 0) F.dot(bx - ux * k, by - uy * k, C.n, a * 0.7);
        for (let k = 12; k <= 17; k++) if (((Math.round(along) * 3 + k) & 3) === 0) F.dot(bx - ux * k, by - uy * k, C.n, a * 0.4);
      }
      if (Math.random() < 0.7) this.sparks.emit(h.x + nx * rnd(-h.r, h.r) + ux * 2, h.y + ny * rnd(-h.r, h.r) + uy * 2 - 2, 1, [C.W, C.w, C.Cc], [8, 22], [0.25, 0.45], { up: 22, g: 80, drag: 2 });
      return;
    }
    const big = h.move === 'hualong';
    if (!live) {
      // 预警：起点聚一团寒气 / 水汽（往里收）
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const d = rnd(8, 16);
        this.sparks.emit(h.x0 + Math.cos(a) * d, h.y0 - (big ? 12 : 8) + Math.sin(a) * d * 0.6, 1, big ? WATER : FROST, [d * 1.6, d * 2.2], [0.3, 0.45], { dir: a + Math.PI, spread: 0.2, drag: 1 });
      }
      return;
    }
    const lift = big ? 9 : 5;
    const L = big ? 58 : 34;
    const run = Math.hypot(h.x - h.x0, h.y - h.y0);
    const a = clamp01((h.t - h.warn) / 0.1);
    // 身子沿这条直线排在龙头后面（刚出来时只有游出来的那一截）
    drawDragonBody(this.top, this.floor, big, (s) => (s <= run ? { x: h.x - ux * s, y: h.y - uy * s, ux, uy } : null), a, this.time);
    // 龙头：一张按方向转好的小图（角、须、眼睛）
    const heads = dragonHeads(big);
    if (!v.head) {
      v.head = new Sprite(heads[0].tex);
      this.layer.addChild(v.head);
    }
    const hd = heads[headIndex(ux, uy)];
    v.head.texture = hd.tex;
    v.head.anchor.set(hd.ax, hd.ay);
    v.head.position.set(Math.round(h.x), Math.round(h.y - lift));
    v.head.alpha = a;
    if (Math.random() < (big ? 0.9 : 0.6)) this.sparks.emit(h.x - ux * rnd(6, L * 0.8), h.y - uy * rnd(6, L * 0.8) - lift + rnd(-3, 3), 1, big ? WATER : FROST, [4, 14], [0.3, 0.55], { g: big ? 40 : 20, drag: 2 });
  }

  private updateTiger(dt: number, w: World, alpha: number) {
    const f = echoOf(w);
    const tg = f?.tiger;
    const T = tigerLook();
    if (tg) {
      if (!this.tiger) {
        const s = new Sprite(T.idle[0]);
        s.anchor.set(TIGER_ANCHOR.x / TIGER_W, TIGER_ANCHOR.y / TIGER_H);
        s.alpha = 0;
        this.stage.entities.addChild(s);
        const sh = new Sprite(this.stage.tex.smallShadow);
        sh.anchor.set(0.5);
        this.stage.floor.addChild(sh);
        this.tiger = { s, sh, alpha: 0, t: 0, roar: 0 };
        for (let k = 0; k < 8; k++) this.sparks.emit(tg.x + rnd(-8, 8), tg.y - rnd(2, 10), 1, INK, [4, 12], [0.4, 0.7], { up: 10, drag: 2 });
      }
      const t = this.tiger;
      t.t += dt;
      t.alpha = Math.min(1, t.alpha + dt / 0.3);
      const x = tg.px + (tg.x - tg.px) * alpha;
      const y = tg.py + (tg.y - tg.py) * alpha;
      const running = Math.hypot(tg.x - tg.px, tg.y - tg.py) > 0.5;
      const fr = t.roar > 0 ? T.roar : running ? T.run : T.idle;
      t.s.texture = fr[Math.floor(t.t * (running ? 12 : 5)) % fr.length];
      t.s.scale.x = tg.facing;
      t.s.position.set(Math.round(x), Math.round(y));
      t.s.zIndex = Math.round(y);
      t.s.alpha = t.alpha * 0.9;
      t.sh.position.set(Math.round(x), Math.round(y));
      t.sh.alpha = 0.3 * t.alpha;
      t.roar = Math.max(0, t.roar - dt);
      if (running && Math.random() < 0.6) this.sparks.emit(x - tg.facing * 6, y - 1, 1, DUST, [6, 16], [0.25, 0.4], { up: 6, drag: 4 });
    } else if (this.tiger) {
      // 吼完：散成一缕墨烟
      const t = this.tiger;
      t.alpha -= dt / 0.35;
      t.s.alpha = Math.max(0, t.alpha) * 0.9;
      t.sh.alpha = 0.3 * Math.max(0, t.alpha);
      if (Math.random() < 0.6) this.sparks.emit(t.s.x + rnd(-6, 6), t.s.y - rnd(2, 10), 1, INK, [3, 9], [0.4, 0.6], { up: 12, drag: 2 });
      if (t.alpha <= 0) this.dropTiger();
    }
  }

  /** 地上的裂缝（慢慢合上）、金鞭的鞭影、虎吼的声浪。 */
  private drawFloor(dt: number) {
    const F = this.floor;
    const T = this.top;
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i];
      c.t += dt;
      const k = c.t / c.life;
      if (k >= 1) {
        this.cracks.splice(i, 1);
        continue;
      }
      const a = (1 - k) * 0.8;
      const show = Math.ceil(c.pts.length * Math.min(1, c.t / 0.12)); // 砸下的一瞬从落点往外裂开
      for (let j = 0; j < show; j++) {
        const [x, y] = c.pts[j];
        F.dot(x, y, C.k, a);
        if (j % 3 === 0 && k < 0.5) F.dot(x, y - 1, C.c, a * 0.6 * (1 - k * 2)); // 缝里一线魂火的光，很快暗下去
      }
    }
    if (this.whipStreak) {
      const s = this.whipStreak;
      s.t += dt;
      const k = s.t / 0.35;
      if (k >= 1) this.whipStreak = null;
      else {
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
        for (let d = 0; d <= len; d += 1) {
          const x = s.x0 + ((s.x1 - s.x0) * d) / len;
          const y = s.y0 + ((s.y1 - s.y0) * d) / len - 2;
          const a = (1 - k) * (0.5 + 0.5 * Math.sin(d * 0.9)); // 鞭节一道道
          T.dot(x, y, d % 6 < 3 ? C.Cc : C.c, a);
          T.dot(x, y - 1, C.n, a * 0.6);
        }
      }
    }
    for (let i = this.roars.length - 1; i >= 0; i--) {
      const r = this.roars[i];
      r.t += dt;
      if (r.t < 0) continue;
      const k = r.t / 0.45;
      if (k >= 1) {
        this.roars.splice(i, 1);
        continue;
      }
      // 断开的几段墨色弧（不成整圈），往外推
      const R = r.r * (1 + k * 1.2);
      for (let s = 0; s < 5; s++) {
        const a0 = r.dir - 1.2 + s * 0.6;
        for (let u = 0; u < 0.36; u += 0.06) {
          const a = a0 + u;
          T.dot(r.x + Math.cos(a) * R, r.y + Math.sin(a) * R * 0.62, s % 2 ? C.d : C.g, (1 - k) * 0.7);
        }
      }
    }
    F.flush();
    T.flush();
  }

  private updateGhosts(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      const k = g.t / 0.4;
      if (k >= 1) {
        g.s.destroy();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.s.alpha = 0.22 * (1 - k);
    }
  }
}

/** 从 (x, y) 往外裂开几道（星形的细缝，每道一串贴地的像素点）。 */
function star(x: number, y: number, r: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd(-0.3, 0.3);
    const len = r * rnd(0.6, 1);
    let px = x;
    let py = y;
    for (let s = 1; s <= len; s += 1) {
      const wob = Math.sin(s * 0.8 + k) * 0.35;
      const nx = x + Math.cos(a + wob) * s;
      const ny = y + Math.sin(a + wob) * s * 0.62;
      if (Math.round(nx) !== Math.round(px) || Math.round(ny) !== Math.round(py)) pts.push([Math.round(nx), Math.round(ny)]);
      px = nx;
      py = ny;
    }
  }
  return pts.sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
}

/** 沿一条线的裂缝：一像素宽、左右轻轻摆，从起点往终点排。 */
function seam(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const pts: [number, number][] = [];
  const ph = Math.random() * 6;
  for (let s = 0; s <= len; s += 1) {
    const o = Math.sin(s * 0.35 + ph) * 1.2;
    pts.push([Math.round(x0 + ((x1 - x0) * s) / len + nx * o), Math.round(y0 + ((y1 - y0) * s) / len + ny * o)]);
  }
  return pts;
}
