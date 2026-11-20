// 过场的镜头（画面）：每个镜头是一组 Pixi 图层，按镜头开始后的时间 t 动起来；播放器（cutscene.ts）负责排镜头、淡入淡出、字。
// 画法都是像素画：静的图层是调色板颜色的位图（src/art/cutscene/、src/art/title.ts、src/art/plaza.ts 的画法），
// 动的部分（展开 / 撕开的榜、混天绫、化灰）每帧在 CPU 上画进一块像素缓冲再上传。位置一律取整，镜头推移是分层视差、整像素地挪。
//
// 版面：画布 W×H 画面像素（≥ 480×270，按窗口铺满），正中 480×270 是安全框（左上角 fx, fy），主体都摆在安全框里，
// 多出来的只是天、云、墙、雾。每个镜头告诉播放器竖排旁白摆在哪（narrAt：安全框里的比例位置），免得压住主体。
import { BufferImageSource, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Sfx } from '../audio/sfx.ts';
import type { Bitmap } from '../art/ground.ts';
import { toRgba, type Grid } from '../art/pixel.ts';
import { PALETTE, hexToRgba } from '../art/palette.ts';
import { makeCloudBank, makeRay, makeScroll, type CloudSpec } from '../art/title.ts';
import { mulberry32, recolor, sky } from '../art/cutscene/common.ts';
import { drawScroll, makeGrandScroll } from '../art/cutscene/scroll.ts';
import { makeAltar, makeTerraceEdge } from '../art/cutscene/altar.ts';
import { JADE_LANTERN, PILLAR } from '../art/sprites/decor.ts';
import { DEMON_ANCHOR, DEMON_FRAMES, DEMON_W } from '../art/sprites/demon-nezha.ts';
import { flipX } from '../art/pixel.ts';
import { makeMiasmaVeil, makeSeaBands, makeSpires, surfFrames } from '../art/cutscene/scenery.ts';
import { makeCity, makeGateWall, makeStreet } from '../art/cutscene/city.ts';
import { SOLDIER_ANCHOR, SOLDIER_FRAMES, SOLDIER_H, SOLDIER_W } from '../art/sprites/soldier.ts';
import { SPEARMAN_ANCHOR, SPEARMAN_FRAMES } from '../art/sprites/spearman.ts';
import { SHIELD_ANCHOR, SHIELD_FRAMES } from '../art/sprites/shieldbearer.ts';
import { ALPHA, ClothBody, Pix, drawPetCloth, ribbonStyle, type ClothEnv, type RibbonStyle } from '../art/sprites/pet.ts';
import { NEZHA_ANCHOR, NEZHA_FRAMES, NEZHA_H, NEZHA_W } from '../art/sprites/nezha.ts';
import { shotGate } from './ch3/ending-shots.ts';
import { shotJiepaiHeart, shotJiepaiPass, shotJiepaiSwords } from './ch3/intro-shots.ts';
import { shotPage, shotPagesEast, shotTianjun, shotXiqiRise, shotYaoBell, shotYaoFade } from './ch2/story-shots.ts';
import { shotWukongRift } from './wukong-shots.ts';
import type { HeroId } from '../sim/types.ts';

export const SAFE_W = 480;
export const SAFE_H = 270;

export interface Shot {
  root: Container;
  /** 推进 dt 秒；t 是镜头开始后的秒数。 */
  update(dt: number, t: number): void;
  /** 竖排旁白的位置：x 是几列字的中心、y 是上沿、h 是最多占多高（都是安全框宽 / 高的比例；放不下就整体缩小字）。 */
  narrAt?: { x: number; y: number; h?: number };
  /** 进这一镜的方式：默认和上一镜交叉淡入；'dip' 先压暗再亮起（章节名）。 */
  enter?: 'dip';
  /** 画面里的动作要这么久才做完（秒）：字出完、停够了也要等到这时才进下一镜（点一下照样能提前走）。 */
  minT?: number;
  /** 对白字幕放在哪：默认画面下方；'top' 放到上方（画面下半截有主体的镜头）。 */
  sub?: 'top';
}

export type ShotFactory = (k: ShotKit) => Shot;

/** 榜不随风按列错位（错位会把边框切成台阶、把字切成两截、裂口的光对不上）。 */
const flat = () => 0;

// ---------- 纹理工具 ----------

/** 非预乘的 RGBA → 预乘（上传给 Pixi 的缓冲纹理都按预乘算）。 */
function premul(src: Uint8ClampedArray, dst: Uint8Array) {
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a === 255) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
    } else if (a === 0) {
      dst[i] = dst[i + 1] = dst[i + 2] = dst[i + 3] = 0;
    } else {
      dst[i] = (src[i] * a + 127) / 255;
      dst[i + 1] = (src[i + 1] * a + 127) / 255;
      dst[i + 2] = (src[i + 2] * a + 127) / 255;
      dst[i + 3] = a;
    }
  }
}

/** 一块每帧重画的像素图（RGBA 位图 → 缓冲纹理）。画完调 upload()。 */
export class Canvas {
  readonly b: Bitmap;
  readonly sprite: Sprite;
  private bytes: Uint8Array;
  private src: BufferImageSource;
  private texture: Texture;
  constructor(w: number, h: number) {
    this.b = { w, h, data: new Uint8ClampedArray(w * h * 4) };
    this.bytes = new Uint8Array(w * h * 4);
    this.src = new BufferImageSource({ resource: this.bytes, width: w, height: h, format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'premultiplied-alpha' });
    this.texture = new Texture({ source: this.src });
    this.sprite = new Sprite(this.texture);
  }
  clear() {
    this.b.data.fill(0);
  }
  upload() {
    premul(this.b.data, this.bytes);
    this.src.update();
  }
  destroy(graveyard?: Texture[]) {
    if (!this.sprite.destroyed) this.sprite.destroy();
    if (graveyard) graveyard.push(this.texture);
    else this.texture.destroy(true);
  }
}

// ---------- 镜头的工具箱 ----------

/** 一个镜头建图层用的工具：做纹理（并记下来，镜头拆掉时一起销毁）、排音效。 */
export class ShotKit {
  readonly W: number;
  readonly H: number;
  /** 安全框的左上角、中心（画面像素）。 */
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
  /** 带种子的随机数：窗口变了重建镜头时，静的画面（云、城、台……）和原来一模一样（飘着的粒子不必）。 */
  readonly rnd: () => number;
  /** 玩家操控的角色（播放器按 CutsceneOptions.hero 设）：只有要画「玩家」的镜头读它（第三章结尾的门缝镜头），讲哪吒旧事的镜头照旧画哪吒。 */
  hero: HeroId = 'nezha';
  private texs: Texture[] = [];
  private canvases: Canvas[] = [];
  private cues: { t: number; name: string; vol: number; done: boolean }[] = [];
  constructor(W: number, H: number, fx: number, fy: number, seed = 20261110) {
    this.W = W;
    this.H = H;
    this.fx = fx;
    this.fy = fy;
    this.cx = fx + (SAFE_W >> 1);
    this.cy = fy + (SAFE_H >> 1);
    this.rnd = mulberry32(seed);
  }
  /** 位图 → 纹理。 */
  tex(b: Bitmap): Texture {
    const bytes = new Uint8Array(b.w * b.h * 4);
    premul(b.data, bytes);
    const t = new Texture({ source: new BufferImageSource({ resource: bytes, width: b.w, height: b.h, format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'premultiplied-alpha' }) });
    this.texs.push(t);
    return t;
  }
  /** 手写的像素网格 → 纹理。 */
  grid(g: Grid): Texture {
    return this.tex({ w: g.w, h: g.h, data: toRgba(g) });
  }
  /** 一张精灵（位置取整）。 */
  sprite(t: Texture, x = 0, y = 0, parent?: Container): Sprite {
    const s = new Sprite(t);
    s.position.set(Math.round(x), Math.round(y));
    parent?.addChild(s);
    return s;
  }
  /** 横向平铺的一条（云堤、魔气）：宽 w（画面像素），贴图横向无缝。 */
  tiling(t: Texture, w: number, parent?: Container): TilingSprite {
    const s = new TilingSprite({ texture: t, width: w, height: t.height });
    parent?.addChild(s);
    return s;
  }
  /** 一块每帧重画的像素图。 */
  canvas(w: number, h: number, parent?: Container): Canvas {
    const c = new Canvas(w, h);
    this.canvases.push(c);
    parent?.addChild(c.sprite);
    return c;
  }
  /** 镜头开始后 t 秒放一个音效（有 sfx 才放）。 */
  cue(t: number, name: string, vol = 1) {
    this.cues.push({ t, name, vol, done: false });
  }
  /** 播放器每帧调：到点的音效放出来。 */
  sfxTick(t: number, sfx?: Sfx) {
    for (const c of this.cues)
      if (!c.done && t >= c.t) {
        c.done = true;
        sfx?.play(c.name, c.vol);
      }
  }
  /**
   * 拆掉这个镜头的纹理。graveyard 给了就只是把纹理交给它（播放器每帧销毁几张，免得一帧里销毁几十张卡一下），
   * 不给就当场全部销毁（播完收场时）。精灵本身随镜头的根容器一起销毁。
   */
  destroy(graveyard?: Texture[]) {
    for (const c of this.canvases) c.destroy(graveyard);
    if (graveyard) graveyard.push(...this.texs);
    else for (const t of this.texs) t.destroy(true);
    this.canvases = [];
    this.texs = [];
  }
}

// ---------- 小件 ----------

const hex = (ch: string) => parseInt(PALETTE[ch].slice(1), 16);
export const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const easeOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) ** 3);

/** 一粒一粒的像素粒子（灵光、金箔、余烬、魂光的拖尾）：每粒一像素，按时间淡入淡出。 */
export class Motes {
  private list: { s: Sprite; x: number; y: number; vx: number; vy: number; t: number; life: number; tw: number; sway: number; ph: number }[] = [];
  readonly c = new Container();
  private rnd: () => number;
  constructor(parent: Container, add = true, rnd: () => number = Math.random) {
    if (add) this.c.blendMode = 'add';
    this.rnd = rnd;
    parent.addChild(this.c);
  }
  emit(x: number, y: number, vx: number, vy: number, life: number, color: string, sway = 1.5) {
    const s = new Sprite(Texture.WHITE);
    s.width = s.height = 1;
    s.tint = hex(color);
    this.c.addChild(s);
    this.list.push({ s, x, y, vx, vy, t: 0, life, tw: 2 + this.rnd() * 2, sway, ph: this.rnd() * 6 });
  }
  get count() {
    return this.list.length;
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.t += dt;
      m.x += (m.vx + Math.sin(m.t * 0.9 + m.ph) * m.sway) * dt;
      m.y += m.vy * dt;
      if (m.t >= m.life) {
        m.s.destroy();
        this.list.splice(i, 1);
        continue;
      }
      const a = Math.sin((m.t / m.life) * Math.PI) * (0.6 + 0.4 * Math.sin(m.t * m.tw + m.ph));
      m.s.alpha = Math.max(0, a);
      m.s.position.set(Math.round(m.x), Math.round(m.y));
    }
  }
}

/** 光束：从 (x, y) 往下散开的一道，淡入、慢慢呼吸、淡出，再换个角度出来（同标题页）。spreadX > 0 时起点沿一条横线散开。 */
class Rays {
  private list: { s: Sprite; t: number; life: number; peak: number; period: number; phase: number; dx: number; ox: number; xs: number }[] = [];
  readonly c = new Container();
  private k: ShotKit;
  private len: number;
  private spread: number;
  private width: [number, number];
  strength = 1;
  constructor(k: ShotKit, parent: Container, n: number, len: number, spread = 1.1, width: [number, number] = [5, 17]) {
    this.k = k;
    this.len = len;
    this.spread = spread;
    this.width = width;
    this.c.blendMode = 'add';
    parent.addChild(this.c);
    for (let i = 0; i < n; i++) {
      const r = this.make();
      r.t = k.rnd() * r.life;
      this.list.push(r);
    }
  }
  private make() {
    const k = this.k;
    const angle = (k.rnd() - 0.5) * this.spread;
    const w0 = 1 + Math.floor(k.rnd() * 2);
    const w1 = this.width[0] + Math.floor(k.rnd() * (this.width[1] - this.width[0]));
    const art = makeRay(this.len * (0.72 + k.rnd() * 0.32), angle, w0, w1, Math.floor(k.rnd() * 1e9));
    const s = new Sprite(k.tex(art.b));
    this.c.addChild(s);
    return { s, t: 0, life: 12 + k.rnd() * 10, peak: 0.5 + k.rnd() * 0.5, period: 5 + k.rnd() * 6, phase: k.rnd() * 6, dx: Math.round((k.rnd() - 0.5) * 4), ox: art.ox, xs: k.rnd() * 2 - 1 };
  }
  update(dt: number, x: number, y: number, spreadX = 0) {
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      r.t += dt;
      if (r.t >= r.life) {
        r.s.destroy();
        this.list[i] = this.make();
        continue;
      }
      const f = Math.min(1, r.t / 3, (r.life - r.t) / 3);
      const breathe = 0.65 + 0.35 * Math.sin((r.t / r.period) * Math.PI * 2 + r.phase);
      r.s.alpha = Math.max(0, f) * r.peak * breathe * this.strength;
      r.s.position.set(Math.round(x + r.dx + r.ox + r.xs * spreadX), Math.round(y));
    }
  }
}

// 云堤（侧视、横向平铺）的几种：远、中、近（同标题页的配方）
export const CLOUD_FAR: CloudSpec = { tones: ['w', 'w', 'j'], bands: [1, 4], size: [4, 8], flat: 0.5, rows: 3, rowGap: 6, top: 6, grow: 0.2, jitter: 1.5 };
export const CLOUD_MID: CloudSpec = { tones: ['W', 'w', 'j', 'i'], bands: [1, 5, 10], size: [6, 11], flat: 0.72, rows: 4, rowGap: 11, top: 6, grow: 0.22, jitter: 2.5 };
export const cloudNear = (h: number): CloudSpec => ({ tones: ['W', 'w', 'j', 'i', 'h'], bands: [1, 7, 15, 22], size: [10, 17], flat: 0.82, rows: Math.ceil(h / 19) + 1, rowGap: 19, top: 6, grow: 0.22, jitter: 4 });

// ---------- 第 1 镜：云海之上的封神台，金榜在风里展开 ----------

/** 仙鹤（远远飞过的两三只）：朝右飞，丹顶、白身、黑翼尖，四帧扇翅（上、平、下、平）。 */
const CRANE: Grid[] = [
  { w: 11, h: 5, rows: ['....kk.....', '....ww.....', 'kkwwwwwwwwe', '...........', '...........'] },
  { w: 11, h: 5, rows: ['...........', '...kwwk....', 'kkwwwwwwwwe', '...........', '...........'] },
  { w: 11, h: 5, rows: ['...........', '...........', 'kkwwwwwwwwe', '....ww.....', '....kk.....'] },
];

/** 莲花灯的火苗：两帧，跳着换。 */
const LAMP_FLAME: Grid[] = [
  { w: 3, h: 4, rows: ['.f.', '.Y.', 'fYf', '.o.'] },
  { w: 3, h: 4, rows: ['f..', '.f.', 'YYf', '.o.'] },
  { w: 3, h: 4, rows: ['..f', '.Y.', 'fYY', '.o.'] },
];

function shotAltar(k: ShotKit): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const PAN = 26; // 镜头从低处慢慢抬起来
  const horizon = fy + 176;
  const skyT = k.tex(sky(W, H + PAN, horizon + PAN, [[0, 'g'], [0.15, 'h'], [0.42, 'i'], [0.7, 'j'], [0.93, 'w']]));
  const skyS = k.sprite(skyT, 0, 0, root);
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 31, CLOUD_FAR)), W, root);
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 32, CLOUD_MID)), W, root);
  // 远处飞过的几只仙鹤（在云的后面一层，慢慢地往右）
  const craneT = CRANE.map((g) => k.grid(g));
  const cranes = [
    { x: cx - 250, y: fy + 66, ph: 0, sp: 9 },
    { x: cx - 272, y: fy + 74, ph: 1.3, sp: 9 },
    { x: cx - 231, y: fy + 79, ph: 2.1, sp: 9 },
  ].map((c) => ({ ...c, s: k.sprite(craneT[1], 0, 0, root) }));
  const altar = makeAltar();
  // 金榜展开后，金光一缕缕从榜上洒下来，落在台上
  const rays = new Rays(k, root, 7, 120, 0.35, [4, 12]);
  const altarS = k.sprite(k.tex(altar.b), 0, 0, root);
  const flameT = LAMP_FLAME.map((g) => k.grid(g));
  const flames = altar.lamps.map(() => k.sprite(flameT[0], 0, 0, root));
  const sc = makeGrandScroll(300, 30, 41, false);
  const scrollC = k.canvas(sc.W + 8, sc.H + 16, root);
  const motes = new Motes(root, true, k.rnd);
  const nearH = Math.max(90, H - horizon + PAN + 20);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH, 33, cloudNear(nearH))), W, root);
  let moteCd = 0;
  for (let i = 0; i < 26; i++) motes.emit(k.rnd() * W, fy + k.rnd() * 200, (k.rnd() - 0.5) * 3, -1.5 - k.rnd() * 3, 4 + k.rnd() * 6, k.rnd() < 0.6 ? 'f' : 'Y');
  k.cue(0.7, 'pet.fly', 0.4);
  return {
    root,
    narrAt: { x: 0.85, y: 0.3 },
    minT: 5,
    update(dt, t) {
      const cam = PAN * (1 - ease(t / 9)); // 镜头抬起：画面整体往下走
      const y = (base: number, f: number) => Math.round(base - cam * f);
      skyS.y = y(0, 0.35) - Math.round(PAN * 0.65);
      far.y = y(horizon - 6, 0.6);
      mid.y = y(horizon + 8, 0.8);
      far.tilePosition.x = -Math.floor(t * 1.1);
      mid.tilePosition.x = -Math.floor(t * 2.4);
      for (const c of cranes) {
        const f = Math.floor(t * 3.2 + c.ph) % 4;
        c.s.texture = craneT[f === 3 ? 1 : f];
        c.s.position.set(Math.round(c.x + t * c.sp), y(c.y + Math.round(Math.sin(t * 0.8 + c.ph) * 2), 0.45));
      }
      altarS.position.set(cx - (altar.b.w >> 1), y(horizon - 64, 1));
      near.y = y(horizon + 36, 1.25);
      near.tilePosition.x = -Math.floor(t * 4.6);
      altar.lamps.forEach((l, i) => {
        flames[i].texture = flameT[(Math.floor(t * 5 + i * 1.7) % 3 + 3) % 3];
        flames[i].position.set(altarS.x + l.x - 1, altarS.y + l.y - 3);
      });
      // 金榜：先卷着悬在台上，再从中间往两头展开
      const open = 0.05 + 0.95 * easeOut((t - 0.6) / 3.8);
      const sx = cx - (sc.W >> 1);
      const sy = altarS.y + altar.top.y - 58 - sc.H;
      scrollC.clear();
      drawScroll(scrollC.b, sc, { x: 4, y: 8, open, wave: flat });
      scrollC.upload();
      scrollC.sprite.position.set(sx - 4, sy - 8);
      rays.strength = 0.75 * ease((open - 0.3) / 0.6);
      rays.update(dt, cx, sy + sc.H - 2, (sc.W / 2 - 20) * open);
      // 灵光：一粒粒往上飘
      moteCd -= dt;
      if (moteCd <= 0 && motes.count < 40) {
        moteCd = 0.12;
        const nearScroll = k.rnd() < 0.4;
        motes.emit(nearScroll ? cx + (k.rnd() - 0.5) * sc.W * open : k.rnd() * W, nearScroll ? sy + sc.H + k.rnd() * 40 : fy + 30 + k.rnd() * 190, (k.rnd() - 0.5) * 3, -1.5 - k.rnd() * 3, 4 + k.rnd() * 5, k.rnd() < 0.6 ? 'f' : k.rnd() < 0.5 ? 'Y' : 'W');
      }
      motes.update(dt);
    },
  };
}

// ---------- 第 2 镜：那一夜，榜面无声裂开一道缝，灵光从缝里漏下 ----------

// 夜里的云：同样的积云，颜色压暗两档（月下的云顶是银鼠，往下苍、黛）
const NIGHT_FAR: CloudSpec = { ...CLOUD_FAR, tones: ['i', 'h', 'h'] };
const NIGHT_MID: CloudSpec = { ...CLOUD_MID, tones: ['j', 'i', 'h', 'g'] };
const nightNear = (h: number): CloudSpec => ({ ...cloudNear(h), tones: ['j', 'i', 'h', 'h', 'g'] });
/** 夜空：天顶乌、往下黛、苍，地平线附近缟（月光照着云海）。 */
const NIGHT_SKY: [number, string][] = [
  [0, 'd'],
  [0.2, 'g'],
  [0.55, 'h'],
  [0.86, 'i'],
];

/** 星星：一粒一像素，慢慢明灭（只在天上半截）。 */
class Stars {
  private list: { s: Sprite; ph: number; sp: number; base: number }[] = [];
  constructor(k: ShotKit, parent: Container, n: number, x0: number, y0: number, w: number, h: number) {
    for (let i = 0; i < n; i++) {
      const s = new Sprite(Texture.WHITE);
      s.width = s.height = 1;
      s.tint = hex(k.rnd() < 0.7 ? 'j' : 'w');
      s.position.set(Math.round(x0 + k.rnd() * w), Math.round(y0 + k.rnd() * k.rnd() * h));
      parent.addChild(s);
      this.list.push({ s, ph: k.rnd() * 6, sp: 0.6 + k.rnd() * 1.4, base: 0.35 + k.rnd() * 0.5 });
    }
  }
  update(t: number, dy = 0) {
    for (const st of this.list) {
      st.s.alpha = st.base * (0.55 + 0.45 * Math.sin(t * st.sp + st.ph));
      if (dy) st.s.y += dy;
    }
  }
}

function shotTear(k: ShotKit): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const horizon = fy + 236;
  const skyS = k.sprite(k.tex(sky(W, H + 20, horizon, NIGHT_SKY, 0.08)), 0, 0, root);
  const stars = new Stars(k, root, Math.round(W / 9), 0, 0, W, horizon - 40);
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 51, NIGHT_FAR)), W, root);
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 52, NIGHT_MID)), W, root);
  const rays = new Rays(k, root, 9, 230, 1.15, [6, 20]);
  const sc = makeGrandScroll(Math.max(760, W + 140), 52, 53, true);
  const pad = 30;
  const scrollC = k.canvas(W, sc.H + pad * 2, root);
  const flecks = new Motes(root, false, k.rnd);
  const glowMotes = new Motes(root, true, k.rnd);
  const souls = new Souls(k, root);
  const nearH = Math.max(70, H - horizon + 30);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH, 54, nightNear(nearH))), W, root);
  // 裂口对准画面中间偏右一点
  const ox = Math.round(cx + 14 - sc.riftX);
  let fleckCd = 0.5;
  let emberCd = 0;
  k.cue(0.9, 'boss.miasma', 0.35);
  return {
    root,
    narrAt: { x: 0.15, y: 0.4 },
    minT: 5.6,
    update(dt, t) {
      const drift = Math.round(ease(t / 8) * 10); // 镜头慢慢往下沉：榜往上走
      skyS.y = -Math.round(drift * 0.3);
      stars.update(t);
      far.y = horizon - 6 - Math.round(drift * 0.5);
      mid.y = horizon + 8 - Math.round(drift * 0.6);
      near.y = horizon + 40 - Math.round(drift * 0.8);
      far.tilePosition.x = -Math.floor(t * 1.1);
      mid.tilePosition.x = -Math.floor(t * 2.2);
      near.tilePosition.x = -Math.floor(t * 4);
      const tear = easeOut((t - 0.7) / 2.4);
      const sy = fy + 34 - drift;
      scrollC.clear();
      drawScroll(scrollC.b, sc, {
        x: ox,
        y: pad,
        open: 1,
        wave: flat,
        tear,
        sepL: 3,
        sepR: 4,
        glow: 0.8 + 0.2 * Math.sin(t * 1.3),
        phase: Math.floor(t * 4),
      });
      scrollC.upload();
      scrollC.sprite.position.set(0, sy - pad);
      const rx = ox + sc.riftX;
      const ry = sy + sc.py1 - 2;
      // 撕开的那一下光最亮，然后慢慢稳住
      rays.strength = ease(tear * 1.6) * (1 + 0.35 * Math.max(0, 1 - Math.abs(t - 1.8) / 0.9));
      rays.update(dt, rx, ry);
      // 裂口边上剥落的金箔、往上飘的余烬
      if (tear > 0.15) {
        fleckCd -= dt;
        if (fleckCd <= 0) {
          fleckCd = 0.35 + k.rnd() * 0.6;
          flecks.emit(rx + (k.rnd() - 0.5) * 10, sy + sc.py0 + k.rnd() * sc.H * 0.8, (k.rnd() - 0.5) * 8, 6 + k.rnd() * 5, 5 + k.rnd() * 3, k.rnd() < 0.5 ? 'Y' : 'y', 5);
        }
        emberCd -= dt;
        if (emberCd <= 0) {
          emberCd = 0.08;
          glowMotes.emit(rx + (k.rnd() - 0.5) * 14 * tear, sy + sc.py0 + k.rnd() * sc.H, (k.rnd() - 0.5) * 4, -3 - k.rnd() * 5, 1.5 + k.rnd() * 2, k.rnd() < 0.5 ? 'f' : k.rnd() < 0.5 ? 'W' : 'o', 2);
          // 灵光从豁口下沿一滴滴漏下去
          if (k.rnd() < 0.6) glowMotes.emit(rx + (k.rnd() - 0.5) * 18 * tear, ry + 2, (k.rnd() - 0.5) * 6, 8 + k.rnd() * 14, 2.2 + k.rnd() * 2, k.rnd() < 0.6 ? 'f' : 'W', 3);
        }
      }
      // 最后几缕魂光从裂口里溜出来（下一镜的伏笔）
      if (t > 3.4) souls.maybeSpawn(dt, rx, ry - 6, 1.6, 0.5);
      souls.update(dt, horizon + 10);
      flecks.update(dt);
      glowMotes.update(dt);
    },
  };
}

// ---------- 魂光（第 2、3 镜） ----------

const SOUL_BIG_G: Grid = { w: 3, h: 3, rows: ['.C.', 'CWC', '.C.'] };
const SOUL_SMALL_G: Grid = { w: 2, h: 2, rows: ['CW', 'WC'] };

/** 从裂口里坠下来的魂光：十字形的一粒，拖着白 → 天青 → 石青的尾巴，落进云里消散（同标题页的画法，数量多、往四面八方落）。 */
class Souls {
  private list: { s: Sprite; trail: Sprite[]; hist: [number, number][]; x: number; y: number; vx: number; vy: number; t: number; sink: number; fade: number; trailT: number; ph: number; big: boolean }[] = [];
  private k: ShotKit;
  private tex: Texture[];
  readonly c = new Container();
  private cd = 0;
  /** 每一粒魂光落进云里时调一次（落点）：画面在那里闪一下。 */
  onSink: ((x: number, y: number) => void) | null = null;
  constructor(k: ShotKit, parent: Container) {
    this.k = k;
    this.tex = [k.grid(SOUL_SMALL_G), k.grid(SOUL_BIG_G)];
    parent.addChild(this.c);
  }
  /** rate：每秒大约几粒；speed：横向散开的快慢倍数。 */
  maybeSpawn(dt: number, x: number, y: number, rate: number, speed = 1) {
    this.cd -= dt * rate;
    if (this.cd > 0) return;
    this.cd = 0.6 + this.k.rnd() * 0.8;
    this.spawn(x, y, speed);
  }
  spawn(x: number, y: number, speed = 1) {
    const k = this.k;
    const big = k.rnd() < 0.35;
    const dir = k.rnd() < 0.5 ? -1 : 1;
    const s = new Sprite(this.tex[big ? 1 : 0]);
    const trail = Array.from({ length: big ? 16 : 11 }, () => {
      const p = new Sprite(Texture.WHITE);
      p.width = p.height = 1;
      p.blendMode = 'add';
      p.visible = false;
      this.c.addChild(p);
      return p;
    });
    this.c.addChild(s);
    this.list.push({ s, trail, hist: [], x: x + (k.rnd() - 0.5) * 4, y, vx: dir * (6 + k.rnd() * (big ? 26 : 40)) * speed, vy: 4 + k.rnd() * 6, t: 0, sink: 2 + k.rnd() * 40, fade: 0, trailT: 0, ph: k.rnd() * 10, big });
  }
  get count() {
    return this.list.length;
  }
  update(dt: number, sinkY: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      o.vx *= Math.pow(0.82, dt);
      o.vy = Math.min(26, o.vy + 2.2 * dt);
      o.x += (o.vx + Math.sin(o.t * 1.3 + o.ph) * 2.2) * dt;
      o.y += o.vy * dt;
      o.trailT -= dt;
      if (o.trailT <= 0) {
        o.trailT = 0.045;
        o.hist.unshift([o.x, o.y]);
        if (o.hist.length > o.trail.length) o.hist.pop();
      }
      const deep = o.y - (sinkY + o.sink);
      o.fade = deep > 0 ? Math.max(0, 1 - deep / 10) : Math.min(1, o.t / 0.6);
      if (deep > 0 && o.fade <= 0) {
        this.onSink?.(o.x, sinkY + o.sink);
        o.s.destroy();
        for (const p of o.trail) p.destroy();
        this.list.splice(i, 1);
        continue;
      }
      const tw = 0.8 + 0.2 * Math.sin(o.t * 5 + o.ph);
      o.s.alpha = o.fade * tw;
      o.s.position.set(Math.round(o.x) - (o.big ? 1 : 1), Math.round(o.y) - (o.big ? 1 : 1));
      o.trail.forEach((p, n) => {
        const h = o.hist[n];
        p.visible = !!h;
        if (!h) return;
        p.position.set(Math.round(h[0]), Math.round(h[1]));
        p.tint = hex(n < 3 ? 'W' : n < 8 ? 'C' : 'c');
        p.alpha = o.fade * (1 - (n + 1) / (o.trail.length + 1)) * 0.95;
      });
    }
  }
}

// ---------- 第 3 镜：一缕缕魂光坠入云海，落向四方 ----------

/** 远处的榜（标题页那张有裂口的榜）：整张画，裂口里透出光（不按列错位：错位会把边框切成台阶、把字切成两截）。 */
function drawTornScroll(dst: Bitmap, sc: ReturnType<typeof makeScroll>, x: number, y: number, t: number) {
  const w = sc.paper.w;
  const glow = 0.75 + 0.25 * Math.sin(t * 0.9);
  const a = Math.round(255 * glow);
  for (let bx = 0; bx < w; bx++) {
    const X = x + bx;
    if (X < 0 || X >= dst.w) continue;
    for (let by = 0; by < sc.paper.h; by++) {
      const Y = y + by;
      if (Y < 0 || Y >= dst.h) continue;
      const i = (by * w + bx) * 4;
      const o = (Y * dst.w + X) * 4;
      if (sc.paper.data[i + 3]) {
        dst.data.set([sc.paper.data[i], sc.paper.data[i + 1], sc.paper.data[i + 2], 255], o);
      } else if (sc.light.data[i + 3]) {
        // 裂口后面的光：白里透黄，随呼吸
        dst.data.set([sc.light.data[i], sc.light.data[i + 1], sc.light.data[i + 2], a], o);
      }
    }
  }
}

/** 魂光落进云里的那一下：云顶上一小截横着的光，亮一下、慢慢散开淡掉（不是圆圈）。 */
class Sparks {
  private list: { s: Sprite[]; t: number; x: number; y: number }[] = [];
  readonly c = new Container();
  constructor(parent: Container) {
    this.c.blendMode = 'add';
    parent.addChild(this.c);
  }
  add(x: number, y: number) {
    const s = [0, 1, 2, 3, 4].map((i) => {
      const p = new Sprite(Texture.WHITE);
      p.width = p.height = 1;
      p.tint = hex(i === 2 ? 'W' : 'C');
      this.c.addChild(p);
      return p;
    });
    this.list.push({ s, t: 0, x: Math.round(x), y: Math.round(y) });
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const u = f.t / 1.1;
      if (u >= 1) {
        for (const p of f.s) p.destroy();
        this.list.splice(i, 1);
        continue;
      }
      const spread = Math.round(1 + u * 4);
      f.s.forEach((p, n) => {
        p.position.set(f.x + (n - 2) * spread, f.y + (n === 2 ? 0 : Math.round(u)));
        p.alpha = (1 - u) * (n === 2 ? 1 : 0.7) * (u < 0.15 ? u / 0.15 : 1);
      });
    }
  }
}

function shotSouls(k: ShotKit): Shot {
  const { W, H, cx, fy } = k;
  const root = new Container();
  const PAN = 22; // 镜头慢慢往下看：跟着魂光落进云海
  const horizon = fy + 132;
  const skyS = k.sprite(k.tex(sky(W, H + PAN, horizon, NIGHT_SKY, 0.1)), 0, 0, root);
  const starC = new Container();
  root.addChild(starC);
  const stars = new Stars(k, starC, Math.round(W / 8), 0, 0, W, horizon);
  const scrollLayer = new Container();
  root.addChild(scrollLayer);
  const sc = makeScroll(232, 22, 61);
  const scC = k.canvas(sc.paper.w, sc.paper.h + 20, scrollLayer);
  const rays = new Rays(k, scrollLayer, 6, horizon - fy, 1.25, [5, 16]);
  const spiresFar = k.sprite(
    k.tex(
      makeSpires(W + 40, 60, [
        [W * 0.08, 34, 12],
        [W * 0.15, 52, 15],
        [W * 0.2, 26, 10],
        [W * 0.78, 44, 14],
        [W * 0.84, 58, 16],
        [W * 0.93, 30, 11],
      ], ['i', 'h', 'h', 'j'], 62),
    ),
    0,
    0,
    root,
  );
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 63, NIGHT_FAR)), W, root);
  const spiresNear = k.sprite(
    k.tex(
      makeSpires(W + 40, 110, [
        [W * 0.03, 96, 26],
        [W * 0.12, 70, 20],
        [W * 0.95, 104, 28],
        [W * 1.02, 76, 22],
      ], ['h', 'g', 'd', 'i'], 64),
    ),
    0,
    0,
    root,
  );
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 65, NIGHT_MID)), W, root);
  const world = new Container(); // 魂光和落点的光：跟着镜头走（和中云一起）
  root.addChild(world);
  const souls = new Souls(k, world);
  const sparks = new Sparks(world);
  souls.onSink = (x, y) => sparks.add(x, y);
  const nearH = Math.max(110, H - horizon + PAN);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH, 66, nightNear(nearH))), W, root);
  const scX = cx - (sc.paper.w >> 1);
  const scY = fy + 8;
  // 一开场就已经在落了：先放出去一批
  for (let i = 0; i < 14; i++) {
    souls.spawn(scX + sc.riftX, scY + sc.paperY + sc.paperH + 6, 1.4);
    souls.update(0.35 + k.rnd() * 0.2, horizon + 10);
  }
  k.cue(0.2, 'pet.fly', 0.25);
  return {
    root,
    narrAt: { x: 0.86, y: 0.2 },
    minT: 5.5,
    update(dt, t) {
      const cam = PAN * ease(t / 9);
      skyS.y = -Math.round(cam * 0.35);
      starC.y = -Math.round(cam * 0.35);
      stars.update(t);
      scrollLayer.y = -Math.round(cam * 0.55);
      spiresFar.position.set(-20, horizon - 56 - Math.round(cam * 0.8));
      far.y = horizon - 6 - Math.round(cam * 0.85);
      spiresNear.position.set(-20, horizon - 76 - Math.round(cam * 0.95));
      mid.y = horizon + 10 - Math.round(cam);
      world.y = -Math.round(cam);
      near.y = horizon + 56 - Math.round(cam * 1.3);
      far.tilePosition.x = -Math.floor(t * 1.2);
      mid.tilePosition.x = -Math.floor(t * 2.6);
      near.tilePosition.x = -Math.floor(t * 5);
      scC.clear();
      drawTornScroll(scC.b, sc, 0, 4, t + 20);
      scC.upload();
      scC.sprite.position.set(scX, scY - 4);
      const rx = scX + sc.riftX;
      const ry = scY + sc.paperY + sc.paperH + 8;
      rays.update(dt, rx, ry - 2);
      // 魂光：从裂口里一缕缕地出来，越落越远（魂光在世界坐标里：镜头往下看时它们照常往下落）
      souls.maybeSpawn(dt, rx, ry - 4 + Math.round(cam * 0.45), 5, 1.5);
      souls.update(dt, horizon + 12);
      sparks.update(dt);
    },
  };
}

// ---------- 第 4 镜：东海之滨的关城，被紫黑魔气吞没，海面翻着暗光 ----------

/** 魔气里的天：天顶乌，往下紫棠、黛，地平线上一线胭脂紫的暗光（光从魔气后面透出来）。 */
const MIASMA_SKY: [number, string][] = [
  [0, 'd'],
  [0.2, 'P'],
  [0.5, 'g'],
  [0.82, 'h'],
];

function shotCity(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const PAN = 40; // 镜头沿着海岸往右移到关城
  const horizon = fy + 170;
  k.sprite(k.tex(sky(W, H, horizon, MIASMA_SKY, 0.05)), 0, 0, root);
  // 远处天上那张榜：小小的一道亮口子，一缕光落向关城（同一个夜里）
  const sc = makeScroll(112, 12, 71);
  const scC = k.canvas(sc.paper.w, sc.paper.h + 20, root);
  scC.sprite.alpha = 0.85;
  const rays = new Rays(k, root, 3, 120, 0.45, [3, 8]);
  rays.strength = 0.4;
  // 关城：推完镜头时城门在安全框里偏右；位图一直铺到画面右边外
  const gateX = fx + 352; // 推完镜头时城门在画面上的 x
  const city = makeCity(W - (gateX - 250) + PAN + 10);
  const baseX = gateX - city.gate.x; // 推完镜头时城的位图左上角
  const cityY = horizon + 24 - city.b.h; // 崖脚泡在近处的海里
  // 城后的魔气：在城的上空堆得最高，往海那边（左）低下去；两层，慢慢地各自往右漂
  const veilW = W + PAN + 80;
  const veilH = horizon + 12;
  const topAt = (x: number) => {
    const sx = x - 40 - PAN + 0; // 推完镜头时这一列在画面上的 x
    const u = Math.max(0, Math.min(1, (sx - (fx + 170)) / 250));
    return horizon - 8 - (u * u * (3 - 2 * u)) * 136;
  };
  const veilBack = k.sprite(k.tex(makeMiasmaVeil(veilW, veilH, 81, (x) => topAt(x) - 16 + Math.max(0, 40 - (x - 40 - PAN - fx - 200)) * 0.6, 46, 90, ['P', 'd', 'k'], false)), 0, 0, root);
  veilBack.alpha = 0.55;
  const veil = k.sprite(k.tex(makeMiasmaVeil(veilW, veilH, 82, topAt, 34, 64, ['P', 'd', 'k'], false)), 0, 0, root);
  const sea = makeSeaBands(320, Math.max(40, H - horizon + 2), 83, ['h', 'g', 'P', 'N']);
  const seaS = k.tiling(k.tex(sea.b), W + PAN + 40, root);
  const glintC = new Container();
  glintC.blendMode = 'add';
  root.addChild(glintC);
  const glints = sea.glints.map((g) => {
    const s = new Sprite(Texture.WHITE);
    s.width = g.len;
    s.height = 1;
    s.tint = hex(g.y < 6 ? 'p' : k.rnd() < 0.6 ? 'c' : 'p');
    glintC.addChild(s);
    return { s, g };
  });
  const cityC = new Container();
  root.addChild(cityC);
  k.sprite(k.tex(city.b), 0, 0, cityC);
  // 窗里的魂火：一块块单独的精灵，各自明灭
  const lightT = k.tex(gridBitmapOf('C'));
  const lights = city.lights.map((l) => {
    const s = k.sprite(lightT, l.x, l.y, cityC);
    s.width = l.w;
    s.height = l.h;
    s.blendMode = 'add';
    return { s, ph: k.rnd() * 6, sp: 0.8 + k.rnd() * 1.6 };
  });
  // 城下的倒影：海面上一列天青的碎光（窗里的魂火映在海里）
  const reflC = new Container();
  reflC.blendMode = 'add';
  root.addChild(reflC);
  const refl = Array.from({ length: 26 }, () => {
    const s = new Sprite(Texture.WHITE);
    s.height = 1;
    s.tint = hex(k.rnd() < 0.6 ? 'c' : 'C');
    reflC.addChild(s);
    return { s, dx: Math.round((k.rnd() - 0.5) * 60), dy: 26 + Math.floor(k.rnd() * 60), w: 1 + Math.floor(k.rnd() * 4), ph: k.rnd() * 6 };
  });
  // 崖脚的浪花
  let surfX = 0;
  for (let x = 0; x < city.b.w; x++)
    if (city.b.data[((city.b.h - 1) * city.b.w + x) * 4 + 3]) {
      surfX = x;
      break;
    }
  const surf = surfFrames(70, 74).map((b) => k.tex(b));
  const surfS = k.sprite(surf[0], 0, 0, cityC);
  // 漫过崖脚、铺到海面上的一层低魔气
  const lowW = W + PAN + 80;
  const low = k.sprite(k.tex(makeMiasmaVeil(lowW, 40, 84, (x) => 12 + Math.max(0, gateX - 140 - (x - 40 - PAN)) * 0.06, 8, 12, ['P', 'd', 'k'], false, 16)), 0, 0, root);
  low.alpha = 0.9;
  const world = new Container();
  root.addChild(world);
  const souls = new Souls(k, world);
  const motes = new Motes(root, true, k.rnd);
  k.cue(0.3, 'boss.miasma', 0.3);
  return {
    root,
    narrAt: { x: 0.12, y: 0.2 },
    minT: 6,
    update(dt, t) {
      const cam = PAN * (1 - ease(t / 6.5)); // 从左边一点的地方推过来：cam 从 PAN 收到 0
      const X = (base: number, f: number) => Math.round(base + cam * f);
      scC.clear();
      drawTornScroll(scC.b, sc, 0, 4, t + 40);
      scC.upload();
      scC.sprite.position.set(X(fx + 150, 0.2), fy + 2);
      rays.update(dt, scC.sprite.x + sc.riftX, fy + 8 + sc.paperY + sc.paperH + 8);
      // 魔气幕：自己也慢慢往右漂（比镜头慢）
      const drift = Math.floor(t * 2.2);
      veilBack.position.set(X(-40 - PAN, 0.55) + Math.floor(t * 1.2), 0);
      veil.position.set(X(-40 - PAN, 0.7) + drift, 0);
      cityC.position.set(X(baseX, 1), cityY);
      for (const l of lights) l.s.alpha = 0.55 + 0.45 * Math.sin(t * l.sp + l.ph);
      seaS.position.set(X(-40 - PAN, 1), horizon);
      seaS.tilePosition.x = -Math.floor(t * 1.5);
      for (const { s, g } of glints) {
        const xx = (((g.x - t * (2 + g.y * 0.06)) % 320) + 320) % 320;
        s.position.set(Math.round(seaS.x + xx + (xx < 160 ? 320 : 0) * 0), horizon + g.y);
        s.alpha = Math.max(0, Math.sin(t * 0.8 + g.ph)) * (g.y < 6 ? 0.45 : 0.8);
      }
      const gx = cityC.x + city.gate.x;
      for (const r of refl) {
        r.s.width = r.w;
        r.s.position.set(Math.round(gx + r.dx + Math.sin(t * 1.3 + r.ph) * 2), cityY + city.b.h - 24 + r.dy - 26 + 26);
        r.s.alpha = 0.25 + 0.35 * Math.max(0, Math.sin(t * 1.1 + r.ph));
      }
      surfS.texture = surf[Math.floor(t * 2.5) % surf.length];
      surfS.position.set(surfX - 40, city.b.h - 4);
      low.position.set(X(-40 - PAN, 1.1) + Math.floor(t * 4), cityY + city.b.h - 26);
      // 魂光：从天上落进城里（被魔气吞掉）
      world.x = X(0, 1);
      if (k.rnd() < dt * 1.8) souls.spawn(gateX - 140 + k.rnd() * 300, fy - 10, 0.35);
      souls.update(dt, horizon - 70 + Math.round(k.rnd() * 0));
      if (k.rnd() < dt * 7) motes.emit(fx + 120 + k.rnd() * 400, horizon - 10 - k.rnd() * 90, (k.rnd() - 0.5) * 2, -2 - k.rnd() * 3, 3 + k.rnd() * 3, k.rnd() < 0.6 ? 'p' : 'e');
      motes.update(dt);
    },
  };
}

/** 一像素见方的纯色位图（窗里的光拉伸着用）。 */
function gridBitmapOf(ch: string): Bitmap {
  const c = hexToRgba(PALETTE[ch]);
  return { w: 1, h: 1, data: new Uint8ClampedArray(c) };
}

// ---------- 混天绫 ----------

/** 调色板字符编码 → RGB（Pix 缓冲里存的是字符编码）。 */
const CODE_RGB: ([number, number, number] | undefined)[] = [];
for (const [ch, v] of Object.entries(PALETTE)) {
  const c = hexToRgba(v);
  CODE_RGB[ch.charCodeAt(0)] = [c[0], c[1], c[2]];
}

/**
 * 混天绫：和游戏里的同一条布（ClothBody 的布料动力学 + drawPetCloth 的画法：扁平的两面、翻面、燕尾、布头的剪口），
 * 只是过场里是近景，更长更宽。布头钉在哪吒身后，布身被风和下落扯着飘。每帧画进 Pix 字符缓冲，再转成 RGBA 上传。
 */
class Sash {
  readonly body: ClothBody;
  private pix: Pix;
  private cv: Canvas;
  private st: RibbonStyle;
  private wmul: number;
  private t = 0;
  private len: number;
  private env: ClothEnv = { wx: 0, wy: 0, sway: 1, flutter: 0 };
  constructor(k: ShotKit, parent: Container, len: number, buf = 260) {
    this.len = len;
    this.body = new ClothBody([len]);
    this.pix = new Pix(buf, buf);
    this.cv = k.canvas(buf, buf, parent);
    this.wmul = 0;
    this.st = ribbonStyle(null);
  }
  get sprite() {
    return this.cv.sprite;
  }
  /**
   * wind：风往哪个方向吹（弧度）；relax：风有多大（旧接口的「顺风舒展」，6–9）；sway：布身大起伏（0..1）；
   * len：这一刻布有多长（落定后越展越长）；wmul：比游戏里（第 2 阶）宽多少。
   */
  update(dt: number, hx: number, hy: number, wind: number, relax: number, sway: number, len: number, wmul = 1.35) {
    this.t += dt;
    if (wmul !== this.wmul) {
      const base = ribbonStyle(null);
      this.st = { ...base, width: base.width.map((w) => w * wmul) };
      this.wmul = wmul;
    }
    if (Math.abs(len - this.len) >= 1) {
      this.len = len;
      this.body.resize([Math.round(len)]);
    }
    const sp = relax * 9; // 风速（像素 / 秒）
    this.env.wx = Math.cos(wind) * sp;
    this.env.wy = Math.sin(wind) * sp;
    this.env.sway = sway;
    this.env.flutter = Math.min(1, Math.max(0, (9 - relax) / 3)) * 0.6;
    this.body.step(dt, hx, hy, this.env);
    const B = this.pix.w;
    this.pix.reset(Math.round(hx) - (B >> 1), Math.round(hy) - (B >> 1));
    drawPetCloth(this.pix, this.body, this.st, { t: this.t, stage: 2, flutter: this.env.flutter });
    const { c, a } = this.pix;
    const d = this.cv.b.data;
    d.fill(0);
    for (let i = 0; i < c.length; i++) {
      const code = c[i];
      if (!code) continue;
      const rgb = CODE_RGB[code];
      if (!rgb) continue;
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = Math.round(ALPHA[a[i]] * 255);
    }
    this.cv.upload();
    this.cv.sprite.position.set(this.pix.ox, this.pix.oy);
  }
}

// ---------- 第 5 镜：哪吒踏风火轮落在关前，混天绫在身后飘开 ----------

function shotLanding(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const scene = new Container(); // 落地时整体抖一下
  root.addChild(scene);
  const ground = fy + 186;
  const archX = fx + 336;
  const wallTop = fy + 26;
  // 墙顶上面是魔气里的天（高的屏幕露得多）
  k.sprite(k.tex(sky(W + 8, wallTop + 30, wallTop + 26, MIASMA_SKY, 0.04)), -4, -4, scene);
  const veilTop = k.sprite(k.tex(makeMiasmaVeil(W + 140, wallTop + 34, 103, 4, 10, 18, ['P', 'd', 'k'], true)), 0, 0, scene);
  veilTop.alpha = 0.75;
  const wall = makeGateWall(W + 8, H + 8, archX + 4, ground + 4, wallTop + 4);
  k.sprite(k.tex(wall.b), -4, -4, scene);
  // 门两边的白玉石灯，灯里是回响的天青幽火（同战场）
  const lampT = k.grid(JADE_LANTERN);
  const lampFire = k.tex(gridBitmapOf('C'));
  const lamps = [-64, 64].map((dx) => {
    const x = archX + dx - (JADE_LANTERN.w >> 1);
    const y = ground + 8 - JADE_LANTERN.h;
    k.sprite(lampT, x, y, scene);
    const f = k.sprite(lampFire, x + 3, y + 5, scene);
    f.width = 4;
    f.height = 2;
    f.blendMode = 'add';
    return f;
  });
  // 门缝里的魂光：明灭
  const crack = k.sprite(k.tex(gridBitmapOf('C')), archX, wall.arch.top + 40, scene);
  crack.width = 1;
  crack.height = ground - wall.arch.top - 42;
  crack.blendMode = 'add';
  // 墙脚漫着的魔气（在人后面）
  const fogBack = k.sprite(k.tex(makeMiasmaVeil(W + 120, 54, 101, 22, 12, 22, ['P', 'd', 'k'], true, 20)), 0, 0, scene);
  fogBack.alpha = 0.7;
  const souls = new Motes(scene, true, k.rnd);
  const sashL = new Container();
  scene.addChild(sashL);
  const sash = new Sash(k, sashL, 24);
  const heroL = new Container();
  scene.addChild(heroL);
  const idleT = NEZHA_FRAMES.idle.map((g) => k.grid(g));
  const moveT = NEZHA_FRAMES.move.map((g) => k.grid(g));
  const ghosts = [0, 1, 2].map(() => {
    const s = new Sprite(moveT[0]);
    s.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
    s.alpha = 0;
    heroL.addChild(s);
    return s;
  });
  const hero = new Sprite(moveT[0]);
  hero.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
  heroL.addChild(hero);
  const embers = new Motes(scene, true, k.rnd);
  const dust = new Motes(scene, false, k.rnd);
  // 最前面贴着画面底的一层薄雾
  const fogFront = k.sprite(k.tex(makeMiasmaVeil(W + 120, 40, 102, 18, 8, 16, ['P', 'd', 'k'], true, 0)), 0, 0, scene);
  fogFront.alpha = 0.45;
  const hx = fx + 168;
  const hy = fy + 204;
  const T_LAND = 1.55;
  const hist: [number, number][] = [];
  let histT = 0;
  let landed = false;
  let shakeT = 0;
  let emberCd = 0;
  sash.body.place(hx - 6, -60, 0.2, -1);
  k.cue(0.6, 'pet.fly', 0.5);
  k.cue(T_LAND, 'fantian.land', 0.35);
  return {
    root,
    minT: 4.2,
    update(dt, t) {
      // 落下来：从画面上方踏着风火轮落到关前，越落越慢
      const u = Math.max(0, Math.min(1, (t - 0.45) / (T_LAND - 0.45)));
      const y = Math.round(-50 + (hy + 50) * easeOut(u));
      const x = Math.round(hx - 26 * (1 - easeOut(u)));
      hero.position.set(x, y);
      const moving = u < 1;
      hero.texture = moving ? moveT[Math.floor(t * 10) % 4] : idleT[Math.floor(t * 5) % 4];
      hero.visible = t > 0.45;
      // 残影
      histT -= dt;
      if (histT <= 0) {
        histT = 0.045;
        hist.unshift([x, y]);
        if (hist.length > 4) hist.pop();
      }
      ghosts.forEach((g, i) => {
        const p = hist[i + 1];
        g.visible = moving && !!p && t > 0.5;
        if (!p) return;
        g.texture = hero.texture;
        g.position.set(p[0], p[1]);
        g.alpha = 0.32 - i * 0.1;
      });
      if (!landed && u >= 1) {
        landed = true;
        shakeT = 0.32;
        // 落地：脚下的魔气被吹开、往两边滚，几粒火星跳起来（不画光圈）
        for (let n = 0; n < 26; n++) {
          const dir = n % 2 ? 1 : -1;
          dust.emit(hx + dir * (2 + k.rnd() * 6), hy - k.rnd() * 3, dir * (25 + k.rnd() * 55), -2 - k.rnd() * 6, 0.7 + k.rnd() * 0.7, k.rnd() < 0.5 ? 'P' : k.rnd() < 0.5 ? 'g' : 'h', 0);
        }
        for (let n = 0; n < 12; n++) embers.emit(hx + (k.rnd() - 0.5) * 12, hy - 2, (k.rnd() - 0.5) * 30, -18 - k.rnd() * 22, 0.8 + k.rnd() * 0.8, k.rnd() < 0.5 ? 'o' : k.rnd() < 0.5 ? 'e' : 'Y', 2);
      }
      shakeT = Math.max(0, shakeT - dt);
      scene.position.set(shakeT > 0 ? Math.round(Math.sin(t * 70) * 2 * (shakeT / 0.32)) : 0, shakeT > 0 ? Math.round(Math.cos(t * 55) * 1.5 * (shakeT / 0.32)) : 0);
      // 混天绫：落的时候被风往上扯着，落定之后在身后（左边）顺风飘开、越展越长
      const back = { x: hero.x - 7, y: hero.y - 18 };
      const open = easeOut((t - T_LAND + 0.1) / 1.7);
      const wind = moving ? -Math.PI / 2 - 0.35 : Math.atan2(-0.34 + 0.1 * Math.sin(t * 0.7), -1);
      const len = moving ? 30 : 30 + 96 * open;
      sash.update(dt, back.x, back.y, wind, moving ? 6 : 8.5, moving ? 0.35 : 0.78, len, 1.95);
      // 风火轮上一直往上冒的火星
      emberCd -= dt;
      if (emberCd <= 0 && t > 0.5) {
        emberCd = moving ? 0.03 : 0.16;
        embers.emit(hero.x - 4 + k.rnd() * 10, hero.y - 2, (k.rnd() - 0.5) * 8, moving ? -40 - k.rnd() * 30 : -10 - k.rnd() * 12, 0.5 + k.rnd() * 0.6, k.rnd() < 0.5 ? 'o' : k.rnd() < 0.6 ? 'e' : 'Y', 1.5);
      }
      // 门前飘着的几粒魂光
      if (k.rnd() < dt * 3) souls.emit(archX - 60 + k.rnd() * 120, ground - k.rnd() * 60, (k.rnd() - 0.5) * 4, -3 - k.rnd() * 3, 3 + k.rnd() * 3, k.rnd() < 0.6 ? 'C' : 'c', 3);
      crack.alpha = 0.5 + 0.4 * Math.sin(t * 2.3) * Math.sin(t * 0.9);
      lamps.forEach((f, i) => (f.alpha = 0.45 + 0.35 * Math.sin(t * (2.1 + i * 0.7) + i)));
      veilTop.x = -130 + Math.floor(t * 4); // 魔气一直往右漂（贴图比画面宽出一截，十几秒也漂不到头，不用折返）
      fogBack.position.set(-110 + Math.floor(t * 5), ground - 40);
      fogFront.position.set(-110 + Math.floor(t * 8), H - 30);
      souls.update(dt);
      embers.update(dt);
      dust.update(dt);
    },
  };
}

// ---------- 第 6 镜：关内一队回响兵转过头来，眼里是天青的魂火 ----------

/** 网格上改一个像素。 */
function setPx(g: Grid, x: number, y: number, ch: string): Grid {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return g;
  const rows = g.rows.slice();
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  return { ...g, rows };
}

/** 远的几排隐在魔气里：颜色往魔气里沉一档、两档（眼里的魂火不变）。 */
const FOG_MAPS: Record<string, string>[] = [
  {},
  { j: 'h', w: 'i', B: 'd', b: 'g', v: 'g', N: 'd', n: 'g', Y: 'h', y: 'g', r: 'P', e: 'p', i: 'h', h: 'g', R: 'P' },
  { j: 'g', w: 'h', B: 'd', b: 'd', v: 'd', N: 'd', n: 'd', Y: 'g', y: 'd', r: 'P', e: 'P', i: 'g', h: 'd', g: 'd', c: 'n', R: 'd' },
  // 最近的一排：贴着镜头、背着光，几乎是剪影（只有轮廓上一点苍色），眼里的魂火最亮
  { j: 'g', w: 'h', B: 'd', b: 'd', v: 'd', N: 'd', n: 'd', Y: 'g', y: 'g', r: 'R', e: 'R', i: 'g', h: 'g', g: 'd', c: 'n', o: 'R' },
];

/** 列队的三种回响兵：步卒、长矛兵、盾兵（同战斗里的精灵）。eyes：两只眼睛在精灵里的像素位置。 */
const FOES = [
  { frames: [SOLDIER_FRAMES.walk[0], SOLDIER_FRAMES.walk[2]], anchor: SOLDIER_ANCHOR, w: SOLDIER_W, h: SOLDIER_H, eyes: [[7, 8], [10, 8]], weight: 0.5 },
  { frames: [SPEARMAN_FRAMES.walk[0], SPEARMAN_FRAMES.walk[0]], anchor: SPEARMAN_ANCHOR, w: SPEARMAN_FRAMES.walk[0].w, h: SPEARMAN_FRAMES.walk[0].h, eyes: [[10, 8], [13, 8]], weight: 0.3 },
  { frames: [SHIELD_FRAMES.walk[0], SHIELD_FRAMES.walk[0]], anchor: SHIELD_ANCHOR, w: SHIELD_FRAMES.walk[0].w, h: SHIELD_FRAMES.walk[0].h, eyes: [[7, 7], [10, 7]], weight: 0.2 },
];

/**
 * 一种回响兵在某一层雾里的几张图：眼还暗着（转身前）、眼亮着（转身后），以及只有眼里魂火的两帧（加法叠在上面，
 * 让那两点天青真正亮起来——只是两三像素的火苗，不是光圈）。
 */
function foeLooks(k: ShotKit, foe: (typeof FOES)[number], fog: number) {
  const body = foe.frames.map((g) => recolor(g, FOG_MAPS[fog]));
  const eyes = (g: Grid, eye: string) => foe.eyes.reduce((r, [x, y]) => setPx(r, x, y, eye), g);
  const empty = (): Grid => ({ w: foe.w, h: foe.h, rows: Array.from({ length: foe.h }, () => '.'.repeat(foe.w)) });
  const flame = (tall: number, tip: string) =>
    foe.eyes.reduce((r, [x, y]) => {
      let g = setPx(r, x, y, 'C');
      for (let j = 1; j <= tall; j++) g = setPx(g, x, y - j, j === tall ? tip : 'c');
      return g;
    }, empty());
  return {
    dark: body.map((g) => k.grid(eyes(g, fog ? 'd' : 'n'))),
    lit: body.map((g) => k.grid(eyes(g, 'C'))),
    fire: fog === 2 ? [k.grid(flame(0, 'c')), k.grid(flame(1, 'c'))] : fog === 3 ? [k.grid(flame(2, 'C')), k.grid(flame(3, 'c'))] : [k.grid(flame(1, 'C')), k.grid(flame(2, 'c'))],
  };
}

function shotRanks(k: ShotKit): Shot {
  const { W, H, fy } = k;
  const root = new Container();
  const PAN = 30;
  const eave = fy + 46;
  const ground = fy + 126;
  const street = makeStreet(W + PAN + 40, H, eave, ground);
  k.sprite(k.tex(sky(W, eave + 10, eave + 20, MIASMA_SKY, 0.04)), 0, 0, root);
  const veilSky = k.sprite(k.tex(makeMiasmaVeil(W + PAN + 80, eave + 30, 141, 6, 18, 40, ['P', 'd', 'k'], true)), 0, 0, root);
  veilSky.alpha = 0.8;
  const world = new Container();
  root.addChild(world);
  k.sprite(k.tex(street.b), -20, 0, world);
  const lightT = k.tex(gridBitmapOf('c'));
  const lights = street.lights.map((l) => {
    const s = k.sprite(lightT, l.x - 20, l.y, world);
    s.width = l.w;
    s.height = l.h;
    s.blendMode = 'add';
    return { s, ph: k.rnd() * 6, sp: 0.5 + k.rnd() * 1.1 };
  });
  const looks = FOES.map((f) => [0, 1, 2, 3].map((fog) => foeLooks(k, f, fog)));
  // 一排排往近处排：远的隐在雾里，最近的一排贴着画面底边、只露出上半身（像从镜头前走过）
  const ranks: { y: number; fog: number; gap: number }[] = [
    { y: ground + 16, fog: 2, gap: 17 },
    { y: ground + 38, fog: 2, gap: 21 },
    { y: ground + 64, fog: 1, gap: 26 },
    { y: ground + 96, fog: 1, gap: 33 },
    { y: fy + 286, fog: 3, gap: 52 },
  ];
  const fogs = [
    { y: ground - 16, a: 0.72, sp: 3, seed: 142 },
    { y: ground + 2, a: 0.6, sp: 4, seed: 143 },
    { y: ground + 24, a: 0.5, sp: 5, seed: 144 },
    { y: ground + 52, a: 0.42, sp: 6, seed: 145 },
    { y: ground + 92, a: 0.36, sp: 8, seed: 146 },
  ];
  const fireC = new Container();
  const soldiers: { s: Sprite; fire: Sprite; L: ReturnType<typeof foeLooks>; turnAt: number; ph: number; turned: boolean; fog: number }[] = [];
  const fogSprites: { s: Sprite; sp: number }[] = [];
  ranks.forEach((r, ri) => {
    // 先铺雾，再站人：后排的人站在前一层雾的后面
    const f = fogs[ri];
    const fs = k.sprite(k.tex(makeMiasmaVeil(W + PAN + 120, 46, f.seed, 18, 10, 18, ['P', 'd', 'k'], true, 18)), 0, f.y, world);
    fs.alpha = f.a;
    fogSprites.push({ s: fs, sp: f.sp });
    for (let x = -10 + ri * 7 + Math.floor(k.rnd() * 8); x < W + PAN + 20; x += r.gap + Math.floor((k.rnd() - 0.3) * r.gap * 0.45)) {
      const pick = k.rnd();
      const ti = pick < FOES[0].weight ? 0 : pick < FOES[0].weight + FOES[1].weight ? 1 : 2;
      const foe = FOES[ti];
      const L = looks[ti][r.fog];
      const s = new Sprite(L.dark[0]);
      s.anchor.set(foe.anchor.x / foe.w, foe.anchor.y / foe.h);
      s.position.set(Math.round(x), r.y + Math.round((k.rnd() - 0.5) * 4));
      world.addChild(s);
      const fire = new Sprite(L.fire[0]);
      fire.anchor.copyFrom(s.anchor);
      fire.position.copyFrom(s.position);
      fire.visible = false;
      fireC.addChild(fire);
      // 离关门（左边、哪吒那边）近的先转：一阵从左往右、从近往远传过去
      soldiers.push({ s, fire, L, turnAt: 0.9 + x / 170 + (4 - ri) * 0.16 + k.rnd() * 0.25, ph: k.rnd() * 6, turned: false, fog: r.fog });
    }
  });
  fireC.blendMode = 'add';
  world.addChild(fireC);
  const sparks = new Motes(world, true, k.rnd);
  k.cue(0.95, 'boss.ring.warn', 0.25);
  return {
    root,
    minT: 4.6,
    sub: 'top',
    update(dt, t) {
      const cam = PAN * ease(t / 8);
      world.x = -Math.round(cam);
      veilSky.x = -Math.round(cam * 0.6) - 40 + Math.floor(t * 2);
      for (const f of fogSprites) f.s.x = -110 + Math.floor(t * f.sp);
      for (const l of lights) l.s.alpha = 0.22 + 0.25 * Math.sin(t * l.sp + l.ph);
      for (const o of soldiers) {
        const fr = Math.floor(t * 3 + o.ph) % 2;
        if (!o.turned && t >= o.turnAt) {
          o.turned = true;
          // 转过来的那一下：眼里的魂火往上一窜，冒一粒魂光
          sparks.emit(o.s.x, o.s.y - 18, (k.rnd() - 0.5) * 3, -7 - k.rnd() * 4, 1, 'C', 1);
        }
        o.s.scale.x = o.turned ? -1 : 1;
        o.s.texture = o.turned ? o.L.lit[fr] : o.L.dark[fr];
        o.fire.visible = o.turned;
        o.fire.scale.x = o.s.scale.x;
        if (o.turned) {
          const age = t - o.turnAt;
          o.fire.texture = o.L.fire[Math.floor(t * 7 + o.ph) % 2];
          o.fire.alpha = Math.min(1, age / 0.25) * (o.fog === 2 ? 0.8 : 1) * (0.75 + 0.25 * Math.sin(t * 9 + o.ph));
        }
      }
      sparks.update(dt);
    },
  };
}

// ---------- 第 7 镜：章节名（压暗之后，夜里的云海慢慢亮起来，书法大字写在上面） ----------

/**
 * 章节名的底：静下来的夜空和云海（同前几镜的夜，只是没有了榜和魂光），颜色压得很平、对比很小，字压得住；
 * 云慢慢地走，几粒灵光往上飘。dawn：章节结尾用——天亮了，同标题页、第一镜的那片天。
 * 不用纯黑：大字下面是一片有层次的暗（乌、黛、苍），不是一块黑幕。
 */
/**
 * 章节名的底：tone 'night' 夜里的云海（开场），'dawn' 天亮了的那片天（第一章 · 完），'dusk' 黄昏的云海（第二章的开场），
 * 'moon' 月夜冷青的云海（第三章的开场：同第三章的玄青、冷银）。
 */
type CardTone = 'night' | 'dawn' | 'dusk' | 'moon';
const CARD_SKY: Record<CardTone, [number, string][]> = {
  dawn: [
    [0, 'g'],
    [0.15, 'h'],
    [0.42, 'i'],
    [0.7, 'j'],
    [0.93, 'w'],
  ],
  night: [
    [0, 'd'],
    [0.3, 'g'],
    [0.72, 'h'],
    [0.95, 'i'],
  ],
  dusk: [
    [0, 'd'],
    [0.26, 'P'],
    [0.6, 'p'],
    [0.9, 's'],
  ],
  moon: [
    [0, 'N'],
    [0.3, 'K'],
    [0.66, 'O'],
    [0.92, 'X'],
  ],
};
/** 黄昏的云海：云顶镶一线浅肉色、绛，往下灰紫、苍（落日在云海下面）。 */
const DUSK_FAR: CloudSpec = { ...CLOUD_FAR, tones: ['s', 'Q', 'h'] };
const DUSK_MID: CloudSpec = { ...CLOUD_MID, tones: ['t', 's', 'Q', 'h'] };
const duskNear = (h: number): CloudSpec => ({ ...cloudNear(h), tones: ['t', 's', 'Q', 'h', 'g'] });
/** 月夜的云海：云顶一线霜白、冷银，往下浅青石、青石、青黑。 */
const MOON_FAR: CloudSpec = { ...CLOUD_FAR, tones: ['T', 'X', 'V'] };
const MOON_MID: CloudSpec = { ...CLOUD_MID, tones: ['Z', 'T', 'X', 'V'] };
const moonNear = (h: number): CloudSpec => ({ ...cloudNear(h), tones: ['Z', 'T', 'X', 'V', 'O'] });
const CARD_CLOUDS: Record<CardTone, [CloudSpec, CloudSpec, (h: number) => CloudSpec]> = {
  night: [NIGHT_FAR, NIGHT_MID, nightNear],
  dawn: [CLOUD_FAR, CLOUD_MID, cloudNear],
  dusk: [DUSK_FAR, DUSK_MID, duskNear],
  moon: [MOON_FAR, MOON_MID, moonNear],
};

function shotCard(k: ShotKit, tone: CardTone = 'night'): Shot {
  const { W, H, fy } = k;
  const dawn = tone === 'dawn';
  const root = new Container();
  const horizon = fy + 196;
  const skyS = k.sprite(k.tex(sky(W, H + 20, horizon + 10, CARD_SKY[tone], 0.08)), 0, -10, root);
  const starC = new Container();
  root.addChild(starC);
  const stars = tone === 'night' || tone === 'moon' ? new Stars(k, starC, Math.round(W / 10), 0, 0, W, horizon - 30) : tone === 'dusk' ? new Stars(k, starC, Math.round(W / 26), 0, 0, W, horizon - 110) : null;
  const [cFar, cMid, cNear] = CARD_CLOUDS[tone];
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 171, cFar)), W, root);
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 172, cMid)), W, root);
  const nearH = Math.max(60, H - horizon - 20);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH + 10, 173, cNear(nearH + 10))), W, root);
  const motes = new Motes(root, true, k.rnd);
  const moteColor = () => (tone === 'night' ? (k.rnd() < 0.6 ? 'C' : 'f') : tone === 'moon' ? (k.rnd() < 0.6 ? 'Z' : 'C') : k.rnd() < 0.6 ? 'f' : 'Y');
  for (let i = 0; i < 18; i++) motes.emit(k.rnd() * W, fy + 40 + k.rnd() * 200, (k.rnd() - 0.5) * 3, -2 - k.rnd() * 3, 3 + k.rnd() * 5, moteColor(), 2);
  k.cue(0.95, dawn ? 'wave.end' : 'boss.intro', 0.45);
  return {
    root,
    enter: 'dip',
    minT: 4,
    update(dt, t) {
      // 镜头极慢地往上抬：云往下沉一点，整像素地挪
      const drift = Math.round(ease(t / 7) * 6);
      skyS.y = -10 + Math.round(drift * 0.3);
      starC.y = skyS.y + 10;
      stars?.update(t);
      far.y = horizon - 6 + Math.round(drift * 0.6);
      mid.y = horizon + 8 + Math.round(drift * 0.8);
      near.y = horizon + 40 + drift;
      far.tilePosition.x = -Math.floor(t * 1.1);
      mid.tilePosition.x = -Math.floor(t * 2.2);
      near.tilePosition.x = -Math.floor(t * 4);
      if (k.rnd() < dt * 4) motes.emit(k.rnd() * W, horizon - k.rnd() * 140, (k.rnd() - 0.5) * 3, -3 - k.rnd() * 3, 3 + k.rnd() * 4, dawn ? 'f' : moteColor(), 2);
      motes.update(dt);
    },
  };
}

// ---------- 收尾：魔化哪吒化作灰烬，被风吹向天上的裂缝；哪吒握紧乾坤圈 ----------

/**
 * 化灰：一张精灵从上往下一粒粒散开，每一粒顺着风飘向 (tx, ty)（天上的裂缝）：先是原来的颜色，飘着飘着褪成灰、再淡成缟色，
 * 越飘越快、带一点打旋，拖着一像素的尾巴，连起来是一缕缕被风扯走的烟；夹着几粒暗红的余烬。
 */
class Ashes {
  private px: { x: number; y: number; c: string; th: number }[] = [];
  private live: { x: number; y: number; px: number; py: number; vx: number; vy: number; t: number; life: number; c: string; ember: boolean; ph: number }[] = [];
  private gone = 0;
  readonly body: Canvas;
  readonly dust: Canvas;
  private w: number;
  private dx: number;
  private dy: number;
  /** dust：灰飘过的那一块（画面坐标的左上角和大小），只在这一块里画灰、每帧只上传这一块。 */
  constructor(k: ShotKit, parent: Container, g: Grid, dust: { x: number; y: number; w: number; h: number }) {
    this.dx = Math.round(dust.x);
    this.dy = Math.round(dust.y);
    this.w = g.w;
    const n = (x: number, y: number) => {
      const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    g.rows.forEach((r, y) =>
      [...r].forEach((c, x) => {
        if (c === '.' || c === ' ') return;
        // 从上往下散：头先散、膝盖最后；噪声打乱，散出一块块的缺口而不是一条直线
        this.px.push({ x, y, c, th: (y / g.h) * 0.7 + n(x, y) * 0.3 });
      }),
    );
    this.px.sort((a, b) => a.th - b.th);
    this.body = k.canvas(g.w, g.h, parent);
    this.dust = k.canvas(Math.max(1, Math.round(dust.w)), Math.max(1, Math.round(dust.h)), parent);
  }
  /** p：散了多少（0..1）；(x, y)：精灵左上角；(tx, ty)：灰飘去的地方（裂缝）。 */
  update(dt: number, p: number, x: number, y: number, tx: number, ty: number, rnd: () => number) {
    while (this.gone < this.px.length && this.px[this.gone].th < p) {
      const q = this.px[this.gone++];
      const ember = rnd() < 0.1;
      const X = x + q.x;
      const Y = y + q.y;
      this.live.push({ x: X, y: Y, px: X, py: Y, vx: 4 + rnd() * 6, vy: -3 - rnd() * 5, t: 0, life: 5 + rnd() * 2.5, c: ember ? 'e' : q.c, ember, ph: rnd() * 6 });
    }
    // 身体：还没散的像素；快散到的那一圈先褪成灰
    const B = this.body.b;
    B.data.fill(0);
    for (let i = this.gone; i < this.px.length; i++) {
      const q = this.px[i];
      const ch = q.th - p < 0.015 ? 'i' : q.th - p < 0.04 ? 'h' : q.c;
      const c = hexToRgba(PALETTE[ch]);
      const o = (q.y * this.w + q.x) * 4;
      B.data[o] = c[0];
      B.data[o + 1] = c[1];
      B.data[o + 2] = c[2];
      B.data[o + 3] = 255;
    }
    this.body.upload();
    this.body.sprite.position.set(x, y);
    // 灰
    const D = this.dust.b;
    D.data.fill(0);
    const plot = (X: number, Y: number, ch: string, a: number) => {
      X = Math.round(X) - this.dx;
      Y = Math.round(Y) - this.dy;
      if (X < 0 || Y < 0 || X >= D.w || Y >= D.h) return;
      const o = (Y * D.w + X) * 4;
      if (D.data[o + 3] >= a) return;
      const c = hexToRgba(PALETTE[ch]);
      D.data[o] = c[0];
      D.data[o + 1] = c[1];
      D.data[o + 2] = c[2];
      D.data[o + 3] = a;
    };
    for (let i = this.live.length - 1; i >= 0; i--) {
      const a = this.live[i];
      a.t += dt;
      const ddx = tx - a.x;
      const ddy = ty - a.y;
      const d = Math.hypot(ddx, ddy) || 1;
      if (a.t >= a.life || d < 6) {
        this.live.splice(i, 1);
        continue;
      }
      // 风：朝裂缝吹，越吹越急；横着带一点打旋（垂直于风向的摆）
      const sp = 14 + a.t * 22;
      const nx = ddx / d;
      const ny = ddy / d;
      const swirl = Math.sin(a.t * 2.6 + a.ph) * 9;
      const wx = nx * sp - ny * swirl;
      const wy = ny * sp + nx * swirl;
      const k2 = 1 - Math.exp(-dt * 1.8);
      a.vx += (wx - a.vx) * k2;
      a.vy += (wy - a.vy) * k2;
      a.px = a.x;
      a.py = a.y;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      const u = a.t / a.life;
      const near = Math.min(1, d / 60); // 快到裂缝时淡掉
      const ch = a.ember ? (u < 0.35 ? 'o' : u < 0.65 ? 'e' : 'R') : u < 0.1 ? a.c : u < 0.28 ? 'g' : u < 0.5 ? 'h' : u < 0.75 ? 'i' : 'j';
      const al = Math.round(255 * Math.min(1, (1 - u) * 3) * (0.35 + 0.65 * near));
      if (al <= 8) continue;
      // 一粒灰拖一截尾巴（顺着它的来向，两三像素），连起来是一缕缕被风扯走的烟
      const sp2 = Math.hypot(a.vx, a.vy) || 1;
      const tl = Math.min(3, 1 + sp2 / 18);
      for (let q = 0; q <= tl; q++) plot(a.x - (a.vx / sp2) * q, a.y - (a.vy / sp2) * q, ch, Math.round(al * (1 - q / (tl + 1))));
    }
    this.dust.upload();
    this.dust.sprite.position.set(this.dx, this.dy);
  }
}

function shotAshes(k: ShotKit): Shot {
  const { W, H, cx, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 150;
  k.sprite(k.tex(sky(W, H, horizon, [[0, 'g'], [0.15, 'h'], [0.42, 'i'], [0.7, 'j'], [0.93, 'w']])), 0, 0, root);
  const far = k.tiling(k.tex(makeCloudBank(320, 40, 161, CLOUD_FAR)), W, root);
  const mid = k.tiling(k.tex(makeCloudBank(320, 100, 162, CLOUD_MID)), W, root);
  // 天上那张榜和裂缝：灰要飘进去的地方
  const sc = makeScroll(250, 22, 163);
  const scC = k.canvas(sc.paper.w, sc.paper.h + 20, root);
  const rays = new Rays(k, root, 6, 150, 1.0, [5, 15]);
  const scX = cx - 70 - (sc.paper.w >> 1);
  const scY = fy + 4;
  // 台面（近景）：人站在台面中间，台沿往下收进云里
  const terrace = makeTerraceEdge(W + 20);
  const terraceY = fy + 170;
  k.sprite(k.tex(terrace.b), -10, terraceY, root);
  const nearTop = terraceY + terrace.lip + 16;
  const nearH = Math.max(50, H - nearTop + 10);
  const near = k.tiling(k.tex(makeCloudBank(320, nearH, 164, cloudNear(nearH))), W, root);
  // 台上的朱漆断柱、白玉石灯（同战场）
  k.sprite(k.grid(PILLAR), fx + 452, terraceY + 22 - PILLAR.h, root);
  k.sprite(k.grid(JADE_LANTERN), fx + 66, terraceY + 18 - JADE_LANTERN.h, root);
  const heroL = new Container();
  root.addChild(heroL);
  const idleT = NEZHA_FRAMES.idle.map((g) => k.grid(g));
  const hero = new Sprite(idleT[0]);
  hero.anchor.set(NEZHA_ANCHOR.x / NEZHA_W, NEZHA_ANCHOR.y / NEZHA_H);
  const hx = fx + 168;
  const hy = terraceY + 30;
  hero.position.set(hx, hy);
  heroL.addChild(hero);
  const glint = new Sprite(Texture.WHITE);
  glint.width = glint.height = 1;
  glint.blendMode = 'add';
  glint.alpha = 0;
  heroL.addChild(glint);
  const kneel = flipX(DEMON_FRAMES.kneel[0]);
  const dx = fx + 322; // 魔化哪吒（朝左跪着）的脚底锚点
  // 灰飘过的那一块：从魔化哪吒身上到天上的裂缝（再各让出一截给打旋的灰）
  const riftX = scX + sc.riftX;
  const riftY = scY + sc.paperY + sc.paperH + 8;
  const ax0 = Math.min(riftX, dx - DEMON_W) - 40;
  const ay0 = riftY - 24;
  const ashes = new Ashes(k, root, kneel, { x: ax0, y: ay0, w: Math.max(riftX, dx + DEMON_W) + 50 - ax0, h: hy + 12 - ay0 });
  const motes = new Motes(root, true, k.rnd);
  k.cue(0.3, 'boss.miasma', 0.25);
  k.cue(3.2, 'qiankun.hover', 0.3);
  return {
    root,
    narrAt: { x: 0.85, y: 0.08, h: 0.52 },
    minT: 6,
    update(dt, t) {
      far.y = horizon - 6;
      mid.y = horizon + 8;
      near.y = nearTop;
      far.tilePosition.x = -Math.floor(t * 1.1);
      mid.tilePosition.x = -Math.floor(t * 2.4);
      near.tilePosition.x = -Math.floor(t * 4.6);
      scC.clear();
      drawTornScroll(scC.b, sc, 0, 4, t + 60);
      scC.upload();
      scC.sprite.position.set(scX, scY - 4);
      const rx = scX + sc.riftX;
      const ry = scY + sc.paperY + sc.paperH + 8;
      rays.update(dt, rx, ry - 2);
      hero.texture = idleT[Math.floor(t * 5) % 4];
      // 握紧乾坤圈：圈上闪一下
      const g = Math.max(0, 1 - Math.abs(t - 3.4) / 0.35);
      glint.alpha = g;
      glint.position.set(hx + 7, hy - 9);
      // 化灰：从上往下慢慢散，灰往裂缝里飘
      const p = Math.max(0, Math.min(1.05, (t - 0.6) / 4.2));
      ashes.update(dt, p, dx - (DEMON_W - DEMON_ANCHOR.x), hy - DEMON_ANCHOR.y, rx, ry, k.rnd);
      if (k.rnd() < dt * 6) motes.emit(k.rnd() * W, fy + 40 + k.rnd() * 150, (k.rnd() - 0.5) * 3, -2 - k.rnd() * 3, 4 + k.rnd() * 4, k.rnd() < 0.6 ? 'f' : 'W', 2);
      motes.update(dt);
    },
  };
}

export const SHOTS: Record<string, ShotFactory> = {
  altar: shotAltar,
  tear: shotTear,
  souls: shotSouls,
  city: shotCity,
  landing: shotLanding,
  ranks: shotRanks,
  card: (k) => shotCard(k),
  ashes: shotAshes,
  'card-end': (k) => shotCard(k, 'dawn'),
  // 第二章：西岐城外（ch2/story-shots.ts）；开场的章节名用黄昏的云海
  'xiqi-rise': shotXiqiRise,
  tianjun: shotTianjun,
  'yao-bell': shotYaoBell,
  'card-dusk': (k) => shotCard(k, 'dusk'),
  'card-moon': (k) => shotCard(k, 'moon'),
  'yao-fade': shotYaoFade,
  page: shotPage,
  'pages-east': shotPagesEast,
  // 第三章的开场：界牌关（ch3/intro-shots.ts）
  'jiepai-pass': shotJiepaiPass,
  'jiepai-swords': shotJiepaiSwords,
  'jiepai-heart': shotJiepaiHeart,
  // 第三章（首发版的结局）：阵心的门缝（ch3/ending-shots.ts）；最后的大字用上面的 card
  gate: (k) => shotGate(k, 'open'),
  'gate-look': (k) => shotGate(k, 'look'),
  'gate-hold': (k) => shotGate(k, 'hold'),
  // 隐藏角色孙悟空的解锁过场（标题页天上的金色裂缝；wukong-shots.ts）
  'wk-rift': shotWukongRift,
};
