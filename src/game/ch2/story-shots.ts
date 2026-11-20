// 第二章 · 西岐城外 · 十绝阵 的过场镜头（播放器 cutscene.ts，登记在 cutscene-shots.ts 的 SHOTS；台词在 story.ts 的 CUTSCENES）。
//  开场 ch2-intro：
//   xiqi-rise —— 黄昏的旷野，远处是西岐城的剪影（落日就沉在它后面）；十座阵台从黄土里一座座拱起来（由远到近），阵旗随即猎猎地扯开。
//   tianjun   —— 近一点的三座阵台，台上各站着一个天君的魂影（石青、半透明），一遍又一遍地重演：站着 → 倒下 → 散成魂光 → 又站起来。
//   yao-bell  —— 天色暗下来，落魂阵的阵台上，姚天君背着落日的余光（剪影）举铃摇着，旷野上的魂光被铃声一缕缕勾过去；
//                本机玩家的角色（ShotKit.hero）站在近处望着他。
//  收尾 ch2-end：见文件后半。
// 画法同别的镜头：静的部分是调色板颜色的位图，动的部分每帧摆；位置取整；不画发光的圆圈（阵亮起来只是地上刻的阵纹亮一档）。
// 只从 cutscene-shots.ts 拿类型（运行时不互相引用）。
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { bands, bayer, blank, put, recolor, valueNoise, mulberry32, type Bitmap } from '../../art/cutscene/common.ts';
import { flipX, toRgba, type Grid } from '../../art/pixel.ts';
import { DAIS_AX, DAIS_AY, daisArt, type DaisArt } from '../../art/ch2/formations.ts';
import type { SiteKind } from '../../sim/ch2/types.ts';
import { SOULFLAG_ANCHOR, SOULFLAG_FRAMES, SOULFLAG_H, SOULFLAG_W, YAO_ANCHOR, YAO_FRAMES, YAO_H, YAO_W } from '../../art/ch2/yao.ts';
import { Motes, PAGE_FLY, castShadow, clamp, daisBitmap, ease, easeOut, flagGrid, ghostly, heroActor, hex, ringPixels, silhouette, streakClouds } from '../cutscene-parts.ts';
import { makeMiasmaVeil } from '../../art/cutscene/scenery.ts';
import type { Shot, ShotKit } from '../cutscene-shots.ts';

// ---------------------------------------------------------------- 天、地、城

/** 字符格子（生成静的位图时先按调色板字符画，最后转成 RGBA；能按字符读回来做「暗一档」）。 */
class Chars {
  readonly px: string[];
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Array<string>(w * h).fill('.');
  }
  set(x: number, y: number, ch: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = ch;
  }
  get(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : '.';
  }
  bitmap(alpha?: (x: number, y: number) => number): Bitmap {
    const b = blank(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const ch = this.px[y * this.w + x];
        if (ch === '.') continue;
        const a = alpha ? alpha(x, y) : 255;
        if (a > 0) put(b, x, y, ch, a);
      }
    return b;
  }
}

/** 黄土「暗一档」：刻槽、蹭痕、影子。 */
const DARKER: Record<string, string> = { E: 'a', a: 'A', A: 'D', D: 'g', Q: 'g', h: 'g', F: 'H', H: 'D' };
/** 天黑下来的黄土：整体暗一档（再在上面压一层很淡的紫棠，见 nightVeil）。 */
const NIGHT_EARTH: Record<string, string> = { E: 'a', a: 'A', A: 'D' };

/** 入夜：地上（连同地上的阵台）压一层很淡的紫棠；天边的余光、剪影、人物不压。 */
function nightVeil(k: ShotKit, parent: Container, y: number, alpha = 0.26) {
  const s = new Sprite(Texture.WHITE);
  s.tint = hex('P');
  s.position.set(0, y);
  s.width = k.W;
  s.height = k.H - y;
  s.alpha = alpha;
  parent.addChild(s);
  return s;
}

/**
 * 黄昏的天：从天顶往下分档（stops 是 [离天顶的比例, 颜色]），落日那一边（glowX）的档线往上抬得高、离得越远越平——
 * 余光只在西边那一片天上，不是一道横贯全屏的直线。
 */
function duskSky(W: number, H: number, horizon: number, glowX: number, stops: [number, string][]): Bitmap {
  const b = blank(W, H);
  const lift = (x: number) => {
    const d = (x - glowX) / (W * 0.5);
    return horizon * (0.15 * Math.exp(-d * d) - 0.02);
  };
  bands(
    b,
    stops.map(([f, ch]) => [f * horizon, ch] as [number, string]),
    3,
    lift,
  );
  return b;
}

/** 刚落日的天：天顶乌、往下紫棠、胭脂紫，近地平线一段绛、一线浅肉色（克制：不用大片的橘黄）。 */
const DUSK: [number, string][] = [
  [0, 'd'],
  [0.2, 'P'],
  [0.46, 'p'],
  [0.72, 's'],
  [0.93, 't'],
];
/** 天黑下来：余光收到地平线上一线。 */
const NIGHTFALL: [number, string][] = [
  [0, 'd'],
  [0.4, 'P'],
  [0.7, 'p'],
  [0.9, 's'],
];

/**
 * 远处的西岐城（透明底）：一道带垛口的城墙，正中一座两层城楼、两边各一座角楼，檐角起翘；背着落日，墙是一片黛（不是黑的），
 * 垛口、檐口的上沿亮一线苍，城楼窗里几点暖光。墙脚往下淡没在地平线的暮霭里。宽 w，城墙垛口的上沿在 crest。
 */
function skyline(w: number, h: number, crest: number, towers: { x: number; big: boolean }[], seed: number): Bitmap {
  const c = new Chars(w, h);
  const rnd = mulberry32(seed);
  const top = crest + 2;
  // 墙身：两头往下塌一截（不是一条横贯的直线），垛口每 5 像素一个
  const edge = valueNoise(seed + 3, 6, w, 4);
  for (let x = 0; x < w; x++) {
    const end = Math.min(x, w - 1 - x);
    const sag = end < 26 ? Math.round((1 - end / 26) ** 1.6 * 9 + edge(x, 1) * 2) : 0;
    for (let y = top + sag; y < h; y++) c.set(x, y, y === top + sag ? 'h' : 'g');
    if (!sag && x % 5 < 3) for (let y = crest; y < top; y++) c.set(x, y, y === crest ? 'h' : 'g');
  }
  const roof = (cx: number, cy: number, half: number, rise: number) => {
    for (let x = -half - 3; x <= half + 3; x++) {
      const k = Math.min(1, Math.abs(x) / (half + 3));
      const t = cy - Math.round(rise * (1 - k * k) + (Math.abs(x) > half ? (Math.abs(x) - half) * 0.7 : 0));
      const bt = cy + 1 - (Math.abs(x) > half ? Math.round((Math.abs(x) - half) * 0.5) : 0);
      for (let y = t; y <= Math.max(t, bt); y++) c.set(cx + x, y, y === t ? 'h' : 'd');
    }
  };
  for (const t of towers) {
    const bw = t.big ? 26 : 14;
    const bh = t.big ? 8 : 6;
    const x0 = Math.round(t.x - bw / 2);
    const y0 = crest - bh;
    for (let y = y0; y <= crest; y++) for (let x = x0; x <= x0 + bw; x++) c.set(x, y, 'g');
    for (let i = 0; i < (t.big ? 3 : 1); i++) {
      const wx = Math.round(x0 + bw * (t.big ? 0.25 + i * 0.25 : 0.5));
      c.set(wx, y0 + 3, rnd() < 0.5 ? 'o' : 'y');
    }
    roof(t.x, y0, Math.round(bw / 2) + 1, t.big ? 3 : 2);
    if (t.big) {
      const uw = 14;
      for (let y = y0 - 8; y <= y0 - 3; y++) for (let x = t.x - uw / 2; x <= t.x + uw / 2; x++) c.set(x, y, 'g');
      c.set(t.x, y0 - 5, 'o');
      roof(t.x, y0 - 8, uw / 2 + 1, 3);
    }
  }
  // 墙脚往下淡没在暮霭里，两头也淡掉
  return c.bitmap((x, y) => Math.round(255 * clamp(1 - (y - top - 3) / (h - top - 3)) * clamp(Math.min(x, w - 1 - x) / 14)));
}

interface Ring {
  x: number;
  y: number;
  rx: number;
  ry: number;
  seed: number;
}

/**
 * 旷野（从地平线往下铺满）：黄土三档成片（近处的斑块大、远处压扁），地平线那一溜压进暮色的灰紫；被践踏处一道道短蹭痕，
 * 零星小簇枯草（近大远小）；rings：地上刻的阵纹（暗一档的断续刻槽，扁的椭圆）。
 */
function plain(W: number, H: number, horizon: number, seed: number, rings: Ring[] = [], night = false): Bitmap {
  const c = new Chars(W, H);
  // 远处一溜低缓的土岗（地平线不是一条直线）：灰紫，上沿亮一线
  const mound = valueNoise(seed + 9, 46, W, 4);
  const mound2 = valueNoise(seed + 10, 13, W, 4);
  for (let x = 0; x < W; x++) {
    const hgt = Math.round(Math.max(0, (mound(x, 1) - 0.52) * 16 + (mound2(x, 2) - 0.5) * 3));
    for (let y = horizon - hgt; y < horizon; y++) c.set(x, y, y === horizon - hgt ? 'h' : 'Q');
  }
  const n1 = valueNoise(seed, 34, W, 240);
  const n2 = valueNoise(seed + 1, 8, W, 240);
  for (let y = Math.max(0, horizon); y < H; y++) {
    const d = y - horizon;
    const s = 1 + d * 0.07; // 近处的斑块更大
    const v1 = Math.sqrt(d + 1) * 5;
    for (let x = 0; x < W; x++) {
      const v = n1(x / s, v1) * 0.78 + n2(x / s, v1 * 1.7) * 0.22;
      let ch = v < 0.37 ? 'A' : v > 0.67 ? 'E' : 'a';
      if (night) ch = NIGHT_EARTH[ch]; // 天黑下来：黄土褪成灰紫、褐
      const haze = clamp(1 - d / (night ? 22 : 16)); // 远处压进暮色
      if (haze > bayer(x, y)) ch = d < 2 ? 'h' : 'Q';
      c.set(x, y, ch);
    }
  }
  const rnd = mulberry32(seed + 5);
  const area = W * Math.max(0, H - horizon);
  // 蹭痕：两三像素的短横（暗一档），近处长一点
  for (let k = 0; k < area / 140; k++) {
    const y = Math.round(horizon + 18 + rnd() * (H - horizon - 18));
    const x = Math.round(rnd() * W);
    const n = 2 + Math.round(((y - horizon) / (H - horizon)) * 3 * rnd());
    for (let i = 0; i < n; i++) c.set(x + i, y, DARKER[c.get(x + i, y)] ?? c.get(x + i, y));
  }
  // 枯草：一簇两三根（近处高、远处只是一点）
  for (let k = 0; k < area / 700; k++) {
    const y = Math.round(horizon + 14 + rnd() * (H - horizon - 14));
    const x = Math.round(rnd() * W);
    const near = (y - horizon) / Math.max(1, H - horizon);
    const tall = Math.max(1, Math.round(1 + near * 4 * (0.6 + rnd() * 0.6)));
    const blades = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < blades; i++) {
      const bx = x + i * 2 - blades;
      const lean = rnd() < 0.5 ? 0 : 1; // 顺风往右倒
      const lit = night ? 'H' : 'F';
      for (let j = 0; j < tall; j++) c.set(bx + (j === tall - 1 ? lean : 0), y - j, j === tall - 1 ? lit : j === 0 ? 'H' : rnd() < 0.5 ? lit : 'H');
    }
  }
  // 阵纹
  for (const r of rings)
    for (const [dx, dy] of ringPixels(r.rx, r.ry, r.seed)) {
      const ch = c.get(r.x + dx, r.y + dy);
      if (ch !== '.') c.set(r.x + dx, r.y + dy, DARKER[ch] ?? ch);
    }
  return c.bitmap();
}

/** 顺风滚过的草屑（两三像素，几帧翻滚）。 */
const STRAW: Grid[] = [
  { w: 2, h: 2, rows: ['F.', '.H'] },
  { w: 2, h: 2, rows: ['.F', 'H.'] },
  { w: 2, h: 1, rows: ['FH'] },
];

// ---------------------------------------------------------------- 阵台

/** 阵台的几档大小（近大远小）：台面半径、扁度、上层石壁高；旗杆高、旗面长。 */
const DAIS = {
  far: { rx: 10, ry: 2, side: 2, pole: 11, flag: 4 },
  mid: { rx: 16, ry: 4, side: 4, pole: 16, flag: 6 },
  near: { rx: 25, ry: 6, side: 6, pole: 22, flag: 8 },
  big: { rx: 38, ry: 9, side: 8, pole: 24, flag: 9 },
  huge: { rx: 84, ry: 18, side: 12, pole: 24, flag: 9 },
} as const;
type DaisSize = keyof typeof DAIS;

/**
 * 十座阵的旗：褪了色的缟色旗面，旗边、旗上的几道纹各带一点这一阵的颜色（天绝、地烈、风吼、寒冰、金光、化血、烈焰、落魂、红水、红砂），
 * 一眼分得出是十座不同的阵，又不花哨。
 */
const TEN_CLOTH: [string, string][] = [
  ['j', 'p'],
  ['j', 'S'],
  ['j', 'i'],
  ['j', 'C'],
  ['j', 'y'],
  ['j', 'r'],
  ['j', 'o'],
  ['j', 'P'],
  ['j', 'e'],
  ['j', 'b'],
];

interface DaisView {
  c: Container;
  flag: Sprite;
  /** 新阵台（十绝阵各自的样子，art/ch2/formations.ts）里幡类（风幡、落魂幡、血幡）自己会飘：台子的精灵和它的帧；其余是 null。 */
  body: Sprite | null;
  banner: FlagFrames | null;
  shadow: Sprite;
  /** 台面正中（插旗的孔）在画面里的位置：容器的原点。 */
  top: { x: number; y: number };
  foot: number;
  size: DaisSize;
  /** 阵纹的光（拱起来、摇铃的时候亮一下）。 */
  glow: Graphics;
  frames: FlagFrames;
  x: number;
  y: number;
}

interface FlagFrames {
  idle: Texture[];
  flutter: Texture[];
}

/** 旗的帧：平时、猎猎各四帧。 */
function flagFrames(k: ShotKit, size: DaisSize, cloth: [string, string]): FlagFrames {
  const d = DAIS[size];
  const mk = (wind: number) => [0, 0.25, 0.5, 0.75].map((p) => k.grid(flagGrid(d.pole, d.flag, p, wind, cloth)));
  return { idle: mk(0), flutter: mk(1) };
}

/** 一座阵台的阵纹（地上刻的那一圈，plain 的 rings；阵纹的光用同一份像素）：圆心在阵台脚下正中。 */
const daisRing = (x: number, y: number, size: DaisSize, seed: number): Ring => {
  const d = DAIS[size];
  return { x: Math.round(x), y: Math.round(y) - d.ry - 1, rx: Math.round(d.rx * 2.2), ry: Math.max(2, Math.round(d.ry * 2.4)), seed };
};

/**
 * 一座阵台（站在地上：脚底在 (x, y)）连同它的旗、投在地上的影子、阵纹的光；
 * rise = true 时外面套一层遮罩（只露出地面以上那一截，每一列到它最后站定时的脚底：拱起来时像从一个圆洞里冒出来）。
 * 光从左边来（西边的落日），影子往右拖。
 */
function makeDais(k: ShotKit, parent: Container, x: number, y: number, size: DaisSize, cloth: [string, string], ringSeed: number, rise: boolean, kind?: SiteKind): DaisView {
  const d = DAIS[size];
  x = Math.round(x);
  y = Math.round(y);
  // kind：用战场上那一座阵台的样子（十绝阵各自的样子，art/ch2/formations.ts），近处按整数倍放大；不给就是原来的灰紫石台
  const neo = kind ? daisArt(kind) : null;
  const S = size === 'near' ? 2 : 1;
  const art = neo ? neoBitmap(neo, S) : daisBitmap(d.rx, d.ry, d.side, -1);
  const fdx = neo && neo.flag ? neo.flagAt[0] * S : 0;
  const sh = castShadow(d.rx + 3, d.ry + 1, Math.round(d.rx * 1.7), -1, 'D', 120);
  const shadow = k.sprite(k.tex(sh.b), x - sh.ox, y - d.ry - 1 - sh.oy, parent);
  const glow = new Graphics();
  glow.blendMode = 'add';
  const ring = daisRing(x, y, size, ringSeed);
  for (const [dx, dy] of ringPixels(ring.rx, ring.ry, ringSeed)) glow.rect(ring.x + dx, ring.y + dy, 1, 1).fill({ color: hex('F') });
  glow.alpha = 0;
  parent.addChild(glow);
  const c = new Container();
  const body = k.sprite(k.tex(art.b), -art.cx, -art.cy, c);
  const frames = flagFrames(k, size, cloth);
  const topY = y - (art.foot - art.cy);
  const fx = x + fdx;
  c.position.set(fx, topY);
  // 旗插在台面上的孔里：阵台拱起来之后，旗杆再从孔里升出来（遮罩到孔那一行为止）
  const flag = new Sprite(frames.idle[0]);
  flag.anchor.set(1 / flag.texture.width, (d.pole - 1) / d.pole);
  flag.position.set(fx, topY);
  if (neo) parent.addChild(flag, c); // 新阵台：旗插在台子后头
  else parent.addChild(c, flag);
  let banner: FlagFrames | null = null;
  if (neo && !neo.flag) {
    flag.visible = false;
    flag.renderable = false;
    banner = { idle: neo.idle.map((g) => k.tex(neoBitmap({ ...neo, idle: [g] }, S).b)), flutter: neo.flutter.map((g) => k.tex(neoBitmap({ ...neo, idle: [g] }, S).b)) };
  }
  if (rise) {
    const fm = new Graphics().rect(fx - 2, topY - d.pole - 6, d.flag + 8, d.pole + 7).fill({ color: 0xffffff });
    parent.addChild(fm);
    flag.mask = fm;
    const mask = new Graphics();
    const b = art.b;
    for (let bx = 0; bx < b.w; bx++) {
      let bottom = -1;
      for (let by = b.h - 1; by >= 0; by--)
        if (b.data[(by * b.w + bx) * 4 + 3]) {
          bottom = by;
          break;
        }
      if (bottom < 0) continue;
      mask.rect(fx - art.cx + bx, topY - art.cy + bottom - 90, 1, 91).fill({ color: 0xffffff });
    }
    parent.addChild(mask);
    c.mask = mask;
  }
  return { c, flag, body: banner ? body : null, banner, shadow, top: { x: fx, y: topY }, foot: y, size, glow, frames, x, y };
}

/** 新阵台的位图（按 S 倍放大）：cx, cy 是旗插的孔（幡类是阵眼正中），foot 是最下一行。 */
function neoBitmap(a: DaisArt, S: number): { b: Bitmap; cx: number; cy: number; foot: number } {
  const g = a.idle[0];
  const src = toRgba(g);
  const w = g.w * S;
  const h = g.h * S;
  const data = new Uint8ClampedArray(w * h * 4);
  let foot = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / S) * g.w + Math.floor(x / S)) * 4;
      if (!src[si + 3]) continue;
      data.set(src.subarray(si, si + 4), (y * w + x) * 4);
      foot = Math.max(foot, y);
    }
  const hx = DAIS_AX + (a.flag ? a.flagAt[0] : 0);
  const hy = DAIS_AY + (a.flag ? a.flagAt[1] : 0);
  return { b: { w, h, data }, cx: hx * S, cy: hy * S, foot };
}

/** 开场第 1 镜、收尾第 3 镜里十座阵台是哪十阵（RISE 的第几座 = 哪一阵；TEN_CLOTH 同一个顺序）。 */
const RISE_KINDS: SiteKind[] = ['thunder', 'quake', 'wind', 'ice', 'gold', 'blood', 'fire', 'soul', 'water', 'sand'];

// ---------------------------------------------------------------- 风里的尘

/** 顺风（往右）飘的尘和草屑：尘是一粒一像素（缃、浅黄土），草屑两三像素翻滚着滚过去。 */
class Wind {
  private dust: Motes;
  private straws: { s: Sprite; x: number; y: number; vx: number; t: number }[] = [];
  private tex: Texture[];
  private k: ShotKit;
  private parent: Container;
  private y0: number;
  private y1: number;
  private speed: number;
  constructor(k: ShotKit, parent: Container, y0: number, y1: number, speed = 1) {
    this.k = k;
    this.parent = parent;
    this.y0 = y0;
    this.y1 = y1;
    this.speed = speed;
    this.dust = new Motes(parent, false);
    this.tex = STRAW.map((g) => k.grid(g));
    for (let i = 0; i < 40; i++) this.puff(Math.random() * k.W);
  }
  private puff(x = -4) {
    const y = this.y0 + Math.random() * (this.y1 - this.y0);
    this.dust.emit(x, y, (14 + Math.random() * 18) * this.speed, -1 - Math.random() * 2, 4 + Math.random() * 5, Math.random() < 0.5 ? 'E' : Math.random() < 0.6 ? 'j' : 'F', { sway: 2, a: 0.55 });
  }
  update(dt: number) {
    if (Math.random() < dt * 9) this.puff(Math.random() < 0.6 ? -4 : Math.random() * this.k.W);
    if (this.straws.length < 3 && Math.random() < dt * 0.5) {
      const s = new Sprite(this.tex[0]);
      this.parent.addChild(s);
      this.straws.push({ s, x: -6, y: this.y0 + Math.random() * (this.y1 - this.y0), vx: (34 + Math.random() * 26) * this.speed, t: Math.random() * 3 });
    }
    for (let i = this.straws.length - 1; i >= 0; i--) {
      const st = this.straws[i];
      st.t += dt;
      st.x += st.vx * dt;
      if (st.x > this.k.W + 8) {
        st.s.destroy();
        this.straws.splice(i, 1);
        continue;
      }
      st.s.texture = this.tex[Math.floor(st.t * 9) % this.tex.length];
      st.s.position.set(Math.round(st.x), Math.round(st.y + Math.sin(st.t * 5.3) * 3));
    }
    this.dust.update(dt);
  }
}

// ---------------------------------------------------------------- 开场第 1 镜：黄昏的旷野，十座阵台一座座立起来

/** 地平线上的暮霭（透明底，可平铺）：一溜暖灰的烟，盖住地和天交界的那条线，上沿一团团的。 */
const horizonHaze = (k: ShotKit, seed: number, tones: [string, string, string] = ['s', 'Q', 'h']) => k.tex(makeMiasmaVeil(320, 30, seed, 12, 8, 16, tones, true, 13));

/** 十座阵台在画面里的位置（安全框里的坐标、脚底）和大小：由远到近一座座拱起来（第几座 = 哪一阵的旗，TEN_CLOTH）。 */
const RISE: { x: number; y: number; size: DaisSize; at: number }[] = [
  { x: 232, y: 121, size: 'far', at: 1.3 },
  { x: 308, y: 120, size: 'far', at: 1.55 },
  { x: 384, y: 122, size: 'far', at: 1.8 },
  { x: 450, y: 125, size: 'far', at: 2.05 },
  { x: 62, y: 146, size: 'mid', at: 2.4 },
  { x: 192, y: 152, size: 'mid', at: 2.7 },
  { x: 334, y: 158, size: 'mid', at: 3.0 },
  { x: 112, y: 216, size: 'near', at: 3.4 },
  { x: 420, y: 206, size: 'near', at: 3.75 },
  { x: 268, y: 246, size: 'near', at: 4.1 },
];
const RISE_T = 0.75; // 拱起来要多久

export function shotXiqiRise(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 112;
  const glowX = fx + 150;
  const PAN = 14; // 镜头慢慢往右移
  k.sprite(k.tex(duskSky(W, H, horizon + 6, glowX, DUSK)), 0, 0, root);
  const clouds = k.tiling(k.tex(streakClouds(320, 44, 211, 4, ['t', 's', 'p'])), W, root);
  clouds.alpha = 0.5;
  const city = k.sprite(k.tex(skyline(200, 40, 24, [{ x: 100, big: true }, { x: 38, big: false }, { x: 164, big: false }], 212)), 0, 0, root);
  const world = new Container();
  root.addChild(world);
  const ox = fx - PAN; // 地面位图比画面宽出 PAN，往右推的时候不露边
  const rings = RISE.map((r, i) => daisRing(ox + r.x + PAN, fy + r.y, r.size, 300 + i));
  k.sprite(k.tex(plain(W + PAN * 2, H, horizon, 213, rings)), 0, 0, world);
  const haze = k.tiling(horizonHaze(k, 214), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.55;
  const daises = RISE.map((r, i) => makeDais(k, world, ox + r.x + PAN, fy + r.y, r.size, TEN_CLOTH[i], 300 + i, true, RISE_KINDS[i]));
  // 地平线的暮霭盖在远处几座阵台的脚上（它们像是从雾里冒出来）
  root.setChildIndex(haze, root.children.length - 1);
  const dust = new Motes(world, false);
  const wind = new Wind(k, root, horizon - 30, H, 1);
  const flagCue = RISE.map(() => false);
  for (const [i, r] of RISE.entries()) if (i % 3 === 0) k.cue(r.at, 'ten.warn', 0.25);
  k.cue(1.0, 'yao.formations', 0.22);
  return {
    root,
    narrAt: { x: 0.86, y: 0.12, h: 0.34 },
    minT: 6.2,
    update(dt, t) {
      const cam = Math.round(PAN * ease(t / 8));
      world.x = -cam;
      city.position.set(Math.round(fx + 50 - cam * 0.3), horizon - 31);
      clouds.y = fy + 22;
      clouds.tilePosition.x = Math.floor(t * 1.6 - cam * 0.15);
      haze.tilePosition.x = Math.floor(t * 3 - cam * 0.6);
      RISE.forEach((r, i) => {
        const v = daises[i];
        const sz = DAIS[r.size];
        const u = clamp((t - r.at) / RISE_T);
        const depth = sz.side * 2 + sz.ry * 3 + sz.pole + 4; // 拱起来之前整个藏在地下
        // 先快后慢地顶出地面、轻轻落定；顶的时候抖一点
        const lift = Math.round(depth * (1 - easeOut(u)));
        const shake = u > 0 && u < 1 ? Math.round(Math.sin(t * 60 + i) * 0.6) : 0;
        v.c.position.set(v.top.x + shake, v.top.y + lift);
        v.c.visible = u > 0;
        v.shadow.alpha = u;
        // 土：拱出地面的那一阵往两边崩一些土粒
        if (u > 0 && u < 0.9 && Math.random() < dt * (r.size === 'far' ? 30 : 80)) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const k2 = r.size === 'far' ? 0.4 : r.size === 'mid' ? 0.7 : 1;
          dust.emit(v.x + side * (sz.rx + 2 + Math.random() * 4), v.foot - Math.random() * 3, side * (6 + Math.random() * 16) * k2, -4 - Math.random() * 10 * k2, 0.6 + Math.random() * 0.7, Math.random() < 0.5 ? 'E' : Math.random() < 0.5 ? 'a' : 'D', { drag: 2.5, sway: 0 });
        }
        // 阵纹亮一下：拱起来的那一阵亮一档，再慢慢淡回去（只是地上刻的槽亮一下，不是一圈光）
        v.glow.alpha = 0.3 * Math.sin(Math.PI * clamp((t - r.at) / 1.8));
        // 旗：阵台落定之后旗杆从孔里升出来（垂着），升到头被风扯开、猎猎地抖
        const fu = clamp((t - r.at - RISE_T + 0.1) / 0.4);
        v.flag.visible = fu > 0;
        v.flag.position.set(v.top.x, v.top.y + Math.round(sz.pole * (1 - easeOut(fu))));
        const flutter = fu >= 1 && t > r.at + RISE_T + 0.45;
        const fr = flutter ? v.frames.flutter : v.frames.idle;
        v.flag.texture = fr[Math.floor(t * (flutter ? 10 : 3) + i * 1.7) % 4];
        if (v.body && v.banner) v.body.texture = (flutter ? v.banner.flutter : v.banner.idle)[Math.floor(t * (flutter ? 10 : 3) + i * 1.7) % 4]; // 幡类：幡自己飘
        if (fu > 0 && fu < 0.2 && i % 2 === 0 && !flagCue[i]) {
          flagCue[i] = true;
          k.cue(t, 'yao.flag', 0.5);
        }
      });
      dust.update(dt);
      wind.update(dt);
    },
  };
}

// ---------------------------------------------------------------- 开场第 2 镜：台上的天君魂影，一遍遍重演

/** 天君的魂影：姚天君的几种姿势换成石青一路（十天君同是截教的道人，魂影只剩一个轮廓），倒下用他跪着的那一帧。 */
const GHOST_POSES = { idle: YAO_FRAMES.idle[0], raise: YAO_FRAMES.raise[0], cast: YAO_FRAMES.cast[0], kneel: YAO_FRAMES.kneel[0] };
const GHOST_CYCLE = 3.4;

export function shotTianjun(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 100;
  const glowX = fx + 110;
  k.sprite(k.tex(duskSky(W, H, horizon + 6, glowX, DUSK)), 0, 0, root);
  const clouds = k.tiling(k.tex(streakClouds(320, 50, 221, 5, ['t', 's', 'p'])), W, root);
  clouds.alpha = 0.5;
  const city = k.sprite(k.tex(skyline(170, 34, 20, [{ x: 86, big: true }, { x: 26, big: false }, { x: 144, big: false }], 222)), fx + 26, horizon - 26, root);
  city.alpha = 0.9;
  // 远处还有几座小阵台（旗在风里）；近处三座，台上各站一个魂影
  const far = [
    { x: 262, y: 108, size: 'far' as DaisSize, cloth: 0 },
    { x: 330, y: 106, size: 'far' as DaisSize, cloth: 2 },
    { x: 448, y: 110, size: 'far' as DaisSize, cloth: 6 },
  ];
  const stage = [
    { x: 104, y: 218, size: 'near' as DaisSize, pose: 'idle' as const, flip: false, ph: 0, cloth: 4 },
    { x: 250, y: 168, size: 'mid' as DaisSize, pose: 'raise' as const, flip: true, ph: 1.15, cloth: 8 },
    { x: 394, y: 236, size: 'near' as DaisSize, pose: 'cast' as const, flip: true, ph: 0.5, cloth: 3 },
  ];
  const rings = [...far.map((d, i) => daisRing(fx + d.x, fy + d.y, d.size, 400 + i)), ...stage.map((d, i) => daisRing(fx + d.x, fy + d.y, d.size, 410 + i))];
  k.sprite(k.tex(plain(W, H, horizon, 223, rings)), 0, 0, root);
  const haze = k.tiling(horizonHaze(k, 224), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.5;
  const farV = far.map((d, i) => makeDais(k, root, fx + d.x, fy + d.y, d.size, TEN_CLOTH[d.cloth], 400 + i, false));
  const stageV = stage.map((d, i) => makeDais(k, root, fx + d.x, fy + d.y, d.size, TEN_CLOTH[d.cloth], 410 + i, false));
  // 魂影：站在台面上、旗子旁边
  // 魂影每帧重画：按行左右摆一两像素（像隔着一层热气看过去），下摆淡进魂雾
  const ghosts = stage.map((d, i) => {
    const v = stageV[i];
    const ax = d.flip ? YAO_W - 1 - YAO_ANCHOR.x : YAO_ANCHOR.x;
    const cv = k.canvas(YAO_W + 2, YAO_H, root);
    const gx = v.top.x + (d.flip ? -5 : 5);
    const gy = v.top.y + 1;
    cv.sprite.position.set(gx - ax - 1, gy - YAO_ANCHOR.y);
    const pose = (g: Grid) => ghostly(d.flip ? flipX(g) : g);
    return { cv, v, stand: pose(GHOST_POSES[d.pose]), kneel: pose(GHOST_POSES.kneel), x: gx, y: gy, ph: d.ph, was: 'gone' };
  });
  const drawGhost = (cv: (typeof ghosts)[number]['cv'], g: Grid, t: number, ph: number) => {
    const b = cv.b;
    b.data.fill(0);
    for (let y = 0; y < g.h; y++) {
      const off = Math.round(Math.sin(t * 2.6 + y * 0.42 + ph * 3) * (y > g.h * 0.45 ? 1 : 0.6));
      const fade = Math.max(0.12, clamp((g.h - 3 - y) / 8));
      for (let x = 0; x < g.w; x++) {
        const ch = g.rows[y][x];
        if (ch === '.') continue;
        const X = x + off + 1;
        if (X < 0 || X >= b.w) continue;
        const c = rgb(ch);
        const o = (y * b.w + X) * 4;
        b.data[o] = c[0];
        b.data[o + 1] = c[1];
        b.data[o + 2] = c[2];
        b.data[o + 3] = Math.round(255 * fade);
      }
    }
    cv.upload();
  };
  const souls = new Motes(root, true);
  const wind = new Wind(k, root, horizon - 20, H, 0.8);
  return {
    root,
    narrAt: { x: 0.86, y: 0.12, h: 0.4 },
    minT: 5.6,
    update(dt, t) {
      clouds.y = fy + 12;
      clouds.tilePosition.x = Math.floor(t * 1.8);
      haze.tilePosition.x = Math.floor(t * 3);
      for (const v of [...farV, ...stageV]) v.flag.texture = v.frames.flutter[Math.floor(t * 10 + v.x * 0.07) % 4];
      // 每个魂影一圈 3.4 秒：淡出来站着 → 倒下（跪）→ 散成魂光往上飘 → 空一会儿 → 又淡出来；倒下的那一下，脚下的阵纹亮一下
      for (const g of ghosts) {
        const c = (t + GHOST_CYCLE - g.ph) % GHOST_CYCLE;
        let a = 0;
        let state = 'gone';
        if (c < 0.5) {
          a = ease(c / 0.5);
          state = 'stand';
        } else if (c < 1.7) {
          a = 1;
          state = 'stand';
        } else if (c < 2.0) {
          a = 1;
          state = 'kneel';
        } else if (c < 2.7) {
          a = 1 - ease((c - 2.0) / 0.7);
          state = 'kneel';
        }
        g.cv.sprite.visible = a > 0.01;
        g.cv.sprite.alpha = a * 0.78;
        if (a > 0.01) drawGhost(g.cv, state === 'kneel' ? g.kneel : g.stand, t, g.ph);
        g.v.glow.alpha = c >= 1.7 && c < 3.2 ? 0.22 * Math.sin(Math.PI * ((c - 1.7) / 1.5)) : 0;
        if (state === 'kneel' && a > 0.1 && Math.random() < dt * 40) souls.emit(g.x - 7 + Math.random() * 14, g.y - 4 - Math.random() * 20, (Math.random() - 0.5) * 6, -10 - Math.random() * 12, 0.8 + Math.random() * 0.8, Math.random() < 0.6 ? 'C' : 'c');
        if (state !== g.was && state === 'kneel') k.cue(t, 'yao.vanish', 0.08);
        g.was = state;
      }
      souls.update(dt);
      wind.update(dt);
    },
  };
}

// ---------------------------------------------------------------- 开场第 3 镜：落魂阵台上，姚天君背着余光摇铃

export function shotYaoBell(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 150;
  const glowX = fx + 160;
  k.sprite(k.tex(duskSky(W, H, horizon + 4, glowX, NIGHTFALL)), 0, 0, root);
  const clouds = k.tiling(k.tex(streakClouds(320, 60, 231, 5, ['s', 'p', 'P'])), W, root);
  clouds.alpha = 0.55;
  const city = k.sprite(k.tex(skyline(160, 30, 18, [{ x: 80, big: true }, { x: 24, big: false }], 232)), fx + 286, horizon - 22, root);
  city.alpha = 0.75;
  // 落魂阵的阵台（大）在左边、背着余光；远处两三座小阵台
  const far = [
    { x: 36, y: 158, size: 'far' as DaisSize, cloth: 1 },
    { x: 452, y: 160, size: 'far' as DaisSize, cloth: 9 },
    { x: 404, y: 174, size: 'mid' as DaisSize, cloth: 5 },
  ];
  const yx = fx + 168;
  const yy = fy + 216;
  const rings = [...far.map((d, i) => daisRing(fx + d.x, fy + d.y, d.size, 500 + i)), daisRing(yx, yy, 'big', 510)];
  k.sprite(k.tex(plain(W, H, horizon, 233, rings, true)), 0, 0, root);
  const haze = k.tiling(horizonHaze(k, 234, ['p', 'Q', 'h']), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.45;
  const farV = far.map((d, i) => makeDais(k, root, fx + d.x, fy + d.y, d.size, TEN_CLOTH[d.cloth], 500 + i, false));
  const big = makeDais(k, root, yx, yy, 'big', TEN_CLOTH[7], 510, false);
  big.flag.visible = false; // 落魂阵插的是落魂幡（下面单画）
  nightVeil(k, root, horizon, 0.24);
  // 落魂幡：插在台面的左后方，也是剪影（幡头的魂火照旧是天青）
  const flagT = SOULFLAG_FRAMES.map((g) => k.grid(silhouette(g, -1, 'd', 'Q', { C: 'C', c: 'c' })));
  const banner = new Sprite(flagT[0]);
  banner.anchor.set(SOULFLAG_ANCHOR.x / SOULFLAG_W, SOULFLAG_ANCHOR.y / SOULFLAG_H);
  banner.position.set(big.top.x - 24, big.top.y + 1);
  root.addChild(banner);
  // 姚天君：剪影，脸朝右（朝着来人），光从左后方（西边的余光）照过来，左沿亮一线绛；铜铃、金簪、眼里的魂光照原色
  const keep = { y: 'y', Y: 'Y', b: 'b', C: 'C' };
  const bellT = YAO_FRAMES.bell.map((g) => k.grid(silhouette(g, -1, 'd', 's', keep)));
  const yao = new Sprite(bellT[0]);
  yao.anchor.set(YAO_ANCHOR.x / YAO_W, YAO_ANCHOR.y / YAO_H);
  yao.position.set(big.top.x + 2, big.top.y + 1);
  root.addChild(yao);
  // 来的人：本机玩家的角色，站在右下的近处，望着阵台（朝左）
  const hero = heroActor(k, root, fx + 384, fy + 252, -1);
  const souls = new Motes(root, true);
  const wind = new Wind(k, root, horizon - 10, H, 0.6);
  const RING = 0.9; // 摇一下铃的间隔
  for (let i = 0; i < 6; i++) k.cue(0.6 + i * RING, 'yao.bell', i === 0 ? 0.32 : 0.16);
  return {
    root,
    narrAt: { x: 0.84, y: 0.12, h: 0.38 },
    minT: 5,
    update(dt, t) {
      clouds.y = fy + 16;
      clouds.tilePosition.x = Math.floor(t * 1.2);
      haze.tilePosition.x = Math.floor(t * 2.4);
      for (const v of farV) v.flag.texture = v.frames.flutter[Math.floor(t * 9 + v.x * 0.07) % 4];
      banner.texture = flagT[Math.floor(t * 2.2) % 2];
      // 摇铃：铃在头边左右摇（两帧），每摇一下，脚下的阵纹亮一档又淡下去
      const ph = Math.max(0, t - 0.6) / RING;
      yao.texture = bellT[t < 0.6 ? 0 : Math.floor(ph * 2) % 2];
      big.glow.alpha = t < 0.6 ? 0 : 0.2 * Math.exp(-(ph % 1) * 3.2);
      hero.pose(t);
      // 旷野上的魂光：从地上冒出来，被铃声勾着、一缕缕往铃那边飘
      if (Math.random() < dt * 26) {
        const sx = fx + 30 + Math.random() * 440;
        const sy = horizon + 8 + Math.random() * (H - horizon - 16);
        const bx = yao.x + 6;
        const by = yao.y - 26;
        const d = Math.hypot(bx - sx, by - sy) || 1;
        const v = 18 + Math.random() * 12;
        souls.emit(sx, sy, ((bx - sx) / d) * v, ((by - sy) / d) * v, Math.min(5, d / v) * (0.6 + Math.random() * 0.3), Math.random() < 0.65 ? 'C' : 'c', { sway: 3 });
      }
      souls.update(dt);
      wind.update(dt);
    },
  };
}

// ================================================================ 收尾 ch2-end
//   yao-fade   —— 天黑下来，落魂阵的阵台上，跪着的姚天君从头往下散成灰烟，一缕缕旋着沉进脚下的阵眼；落魂幡跟着倒下，幡头的魂火灭了；
//                 本机玩家的角色站在台边看着。阵眼里透出一点暗金。
//   page       —— 近一点：阵眼里慢慢顶出一角焦黄的残页（暗金，边上烧焦，有几行看不清的字），几粒金屑往上飘；角色站在旁边，说他自己的那一句
//                 （story.ts 的 heroSay：取他的战后对白）。
//   pages-east —— 远远的整片旷野：十座阵眼一座接一座透出暗金（十角残页）；起风了，那一角残页被卷起来，翻着往东（右）飞去，
//                 飞向东边地平线上一线冷青的山影（界牌关的方向）。

/** 一像素一像素散开、旋着沉进阵眼的灰烟（同第一章收尾的化灰，只是往下沉、颜色是灰烟和几点魂光）。 */
class SinkSmoke {
  private px: { x: number; y: number; c: string; th: number }[] = [];
  private live: { x: number; y: number; vx: number; vy: number; t: number; life: number; soul: boolean; ph: number; c: string }[] = [];
  private gone = 0;
  readonly body: import('../cutscene-shots.ts').Canvas;
  readonly dust: import('../cutscene-shots.ts').Canvas;
  private w: number;
  private dx: number;
  private dy: number;
  constructor(k: ShotKit, parent: Container, g: Grid, area: { x: number; y: number; w: number; h: number }) {
    this.dx = Math.round(area.x);
    this.dy = Math.round(area.y);
    this.w = g.w;
    const n = (x: number, y: number) => {
      const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    g.rows.forEach((r, y) =>
      [...r].forEach((c, x) => {
        if (c === '.') return;
        this.px.push({ x, y, c, th: (y / g.h) * 0.72 + n(x, y) * 0.28 }); // 从头往下散，噪声打乱成一块块的缺口
      }),
    );
    this.px.sort((a, b) => a.th - b.th);
    this.body = k.canvas(g.w, g.h, parent);
    this.dust = k.canvas(Math.max(1, Math.round(area.w)), Math.max(1, Math.round(area.h)), parent);
  }
  /** p：散了多少（0..1）；(x, y)：精灵左上角；ash：身上还没散的部分褪成灰的程度（0..1）；(tx, ty)：阵眼。 */
  update(dt: number, p: number, x: number, y: number, ash: number, tx: number, ty: number) {
    while (this.gone < this.px.length && this.px[this.gone].th < p) {
      const q = this.px[this.gone++];
      const soul = Math.random() < 0.05;
      this.live.push({ x: x + q.x, y: y + q.y, vx: (Math.random() - 0.5) * 6, vy: -2 - Math.random() * 4, t: 0, life: 2.4 + Math.random() * 1.6, soul, ph: Math.random() * 6, c: q.c });
    }
    // 身子：还没散的像素，慢慢褪成灰；快散到的那一圈先变成浅灰
    const B = this.body.b;
    B.data.fill(0);
    const gray = (c: string) => (ash < 0.35 ? c : ash < 0.7 ? GRAYISH[c] ?? 'h' : 'h');
    for (let i = this.gone; i < this.px.length; i++) {
      const q = this.px[i];
      const ch = q.th - p < 0.02 ? 'i' : gray(q.c);
      const c = rgb(ch);
      const o = (q.y * this.w + q.x) * 4;
      B.data[o] = c[0];
      B.data[o + 1] = c[1];
      B.data[o + 2] = c[2];
      B.data[o + 3] = 255;
    }
    this.body.upload();
    this.body.sprite.position.set(x, y);
    const D = this.dust.b;
    D.data.fill(0);
    const plot = (X: number, Y: number, ch: string, a: number) => {
      X = Math.round(X) - this.dx;
      Y = Math.round(Y) - this.dy;
      if (X < 0 || Y < 0 || X >= D.w || Y >= D.h) return;
      const o = (Y * D.w + X) * 4;
      if (D.data[o + 3] >= a) return;
      const c = rgb(ch);
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
      if (a.t >= a.life || d < 2.5) {
        this.live.splice(i, 1);
        continue;
      }
      // 先往上散一点，再被阵眼吸过去，越近越急；横着带一点打旋
      const pull = Math.min(1, a.t / 0.45);
      const sp = (8 + a.t * 26) * pull;
      const nx = ddx / d;
      const ny = ddy / d;
      const swirl = Math.sin(a.t * 3 + a.ph) * 10 * Math.min(1, d / 20);
      const k2 = 1 - Math.exp(-dt * 2.4);
      a.vx += (nx * sp - ny * swirl - a.vx) * k2;
      a.vy += (ny * sp + nx * swirl - a.vy) * k2;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      const u = a.t / a.life;
      const ch = a.soul ? (u < 0.5 ? 'C' : 'c') : u < 0.1 ? GRAYISH[a.c] ?? 'h' : u < 0.4 ? 'h' : u < 0.7 ? 'i' : 'j';
      const al = Math.round(255 * Math.min(1, (1 - u) * 2.5) * Math.min(1, d / 8));
      if (al <= 8) continue;
      const v = Math.hypot(a.vx, a.vy) || 1;
      const tl = Math.min(3, 1 + v / 16);
      for (let q = 0; q <= tl; q++) plot(a.x - (a.vx / v) * q, a.y - (a.vy / v) * q, ch, Math.round(al * (1 - q / (tl + 1))));
    }
    this.dust.upload();
    this.dust.sprite.position.set(this.dx, this.dy);
  }
}
/** 魂火灭了的落魂幡：幡头的天青、石青换成灰。 */
const OUT_FIRE: Record<string, string> = { C: 'i', c: 'h' };
/** 褪成灰的时候每种颜色往哪个灰去（亮的偏缟、暗的偏苍）。 */
const GRAYISH: Record<string, string> = { k: 'g', d: 'g', g: 'h', P: 'h', p: 'i', R: 'h', r: 'i', h: 'h', i: 'i', j: 'j', w: 'j', y: 'i', Y: 'j', b: 'i', C: 'i', c: 'h', B: 'h' };
const RGB_CACHE: Record<string, [number, number, number]> = {};
const rgb = (ch: string) => (RGB_CACHE[ch] ??= ((n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number])(hex(ch)));

/**
 * 把一张精灵绕锚点 (ax, ay) 转 a 弧度（最近邻取样，转出来的格子够大装得下）：倒下的幡。返回转好的格子和锚点在里面的位置。
 */
function rotateGrid(g: Grid, ax: number, ay: number, a: number): { g: Grid; ax: number; ay: number } {
  const R = Math.ceil(Math.hypot(Math.max(ax, g.w - ax), Math.max(ay, g.h - ay))) + 1;
  const S = R * 2 + 1;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rows: string[] = [];
  for (let y = 0; y < S; y++) {
    let r = '';
    for (let x = 0; x < S; x++) {
      // 反过来转回原图取样
      const dx = x - R;
      const dy = y - R;
      const sx = Math.round(ax + dx * ca + dy * sa);
      const sy = Math.round(ay - dx * sa + dy * ca);
      r += sx >= 0 && sy >= 0 && sx < g.w && sy < g.h ? g.rows[sy][sx] : '.';
    }
    rows.push(r);
  }
  return { g: { w: S, h: S, rows }, ax: R, ay: R };
}

/** 收尾的夜：天顶乌、紫棠，余光只剩地平线上一线胭脂紫。 */
const LATE: [number, string][] = [
  [0, 'd'],
  [0.5, 'P'],
  [0.82, 'p'],
  [0.96, 'Q'],
];

/** 星星：一粒一像素，慢慢明灭（只在天上半截）。 */
function stars(k: ShotKit, parent: Container, n: number, y1: number) {
  const g = new Graphics();
  parent.addChild(g);
  const pts = Array.from({ length: n }, () => ({ x: Math.round(Math.random() * k.W), y: Math.round(Math.random() * Math.random() * y1), ph: Math.random() * 6, b: 0.3 + Math.random() * 0.5 }));
  return (t: number, show = 1) => {
    g.clear();
    for (const p of pts) g.rect(p.x, p.y, 1, 1).fill({ color: hex(p.b > 0.65 ? 'w' : 'j'), alpha: show * p.b * (0.55 + 0.45 * Math.sin(t * 1.2 + p.ph)) });
  };
}

export function shotYaoFade(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 150;
  k.sprite(k.tex(duskSky(W, H, horizon + 4, fx + 120, NIGHTFALL)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 16), horizon - 60);
  const clouds = k.tiling(k.tex(streakClouds(320, 60, 241, 4, ['p', 'P', 'd'])), W, root);
  clouds.alpha = 0.5;
  const far = [
    { x: 40, y: 160, size: 'far' as DaisSize, cloth: 0 },
    { x: 440, y: 158, size: 'far' as DaisSize, cloth: 4 },
    { x: 398, y: 176, size: 'mid' as DaisSize, cloth: 8 },
  ];
  const yx = fx + 196;
  const yy = fy + 224;
  const rings = [...far.map((d, i) => daisRing(fx + d.x, fy + d.y, d.size, 600 + i)), daisRing(yx, yy, 'big', 610)];
  k.sprite(k.tex(plain(W, H, horizon, 243, rings, true)), 0, 0, root);
  const haze = k.tiling(horizonHaze(k, 244, ['p', 'Q', 'h']), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.45;
  const farV = far.map((d, i) => makeDais(k, root, fx + d.x, fy + d.y, d.size, TEN_CLOTH[d.cloth], 600 + i, false));
  const big = makeDais(k, root, yx, yy, 'big', TEN_CLOTH[7], 610, false);
  big.flag.visible = false;
  nightVeil(k, root, horizon, 0.24);
  // 落魂幡：插在台面左后方，倒下的时候往左倒（几张转好的帧），幡头的魂火灭掉
  const BANNER_FALL = [0, 0.16, 0.38, 0.66, 0.98, 1.3, 1.5];
  const bannerFrames = BANNER_FALL.map((a, i) => {
    const src = i < 3 ? SOULFLAG_FRAMES[0] : recolor(SOULFLAG_FRAMES[0], OUT_FIRE); // 倒下去的那一半，幡头的魂火灭了
    return k.grid(rotateGrid(src, SOULFLAG_ANCHOR.x, SOULFLAG_ANCHOR.y, -a).g); // 几帧一样大、锚点都在正中
  });
  const banner = new Sprite(bannerFrames[0]);
  const rot0 = rotateGrid(SOULFLAG_FRAMES[0], SOULFLAG_ANCHOR.x, SOULFLAG_ANCHOR.y, 0);
  banner.anchor.set(rot0.ax / rot0.g.w, rot0.ay / rot0.g.h);
  banner.position.set(big.top.x - 26, big.top.y + 2);
  root.addChild(banner);
  // 跪着的姚天君（朝右），一开始已经褪成灰（同战场上倒下之后）
  const kneel = YAO_FRAMES.kneel[0];
  const yaoX = big.top.x - YAO_ANCHOR.x + 4;
  const yaoY = big.top.y + 1 - YAO_ANCHOR.y;
  const eye = { x: big.top.x, y: big.top.y };
  const smoke = new SinkSmoke(k, root, kneel, { x: yaoX - 30, y: yaoY - 24, w: YAO_W + 60, h: YAO_H + 40 });
  // 阵眼里透出来的一点暗金（残页）：几像素，慢慢亮起来、明灭
  const gold = new Graphics();
  gold.blendMode = 'add';
  root.addChild(gold);
  const motes = new Motes(root, true);
  const hero = heroActor(k, root, fx + 318, fy + 244, -1);
  k.cue(0.5, 'yao.vanish', 0.3);
  k.cue(3.3, 'yao.banners', 0.25);
  return {
    root,
    narrAt: { x: 0.84, y: 0.12, h: 0.42 },
    minT: 5.6,
    update(dt, t) {
      starAt(t, 0.8);
      clouds.y = fy + 16;
      clouds.tilePosition.x = Math.floor(t * 1.2);
      haze.tilePosition.x = Math.floor(t * 2.4);
      for (const v of farV) v.flag.texture = v.frames.flutter[Math.floor(t * 8 + v.x * 0.07) % 4];
      // 化烟：0.5 秒起从头往下散，约 3 秒散完
      const p = clamp((t - 0.5) / 3.0, 0, 1.05);
      smoke.update(dt, p, yaoX, yaoY, clamp(t / 0.8), eye.x, eye.y);
      // 幡：烟散到一半，幡晃两下往左倒，落在台沿上
      const fu = clamp((t - 2.8) / 0.75);
      const wob = t < 2.8 && t > 2.2 ? Math.sin((t - 2.2) * 18) * 0.5 : 0;
      const fi = Math.min(BANNER_FALL.length - 1, Math.floor(fu * fu * (BANNER_FALL.length - 1) + (wob > 0.2 ? 1 : 0)));
      banner.texture = bannerFrames[fi];
      if (fu >= 1 && t < 3.7) for (let n = 0; n < 2; n++) motes.emit(big.top.x - 40 + Math.random() * 16, big.top.y + 2, (Math.random() - 0.5) * 20, -3 - Math.random() * 6, 0.7, Math.random() < 0.5 ? 'h' : 'i', { drag: 2, sway: 0 });
      // 阵眼里的暗金：烟沉完之后慢慢透出来
      const g = clamp((t - 3.2) / 1.4);
      gold.clear();
      if (g > 0) {
        const fl = 0.75 + 0.25 * Math.sin(t * 3.1);
        gold.rect(eye.x - 1, eye.y, 3, 1).fill({ color: hex('y'), alpha: 0.7 * g * fl });
        gold.rect(eye.x, eye.y - 1, 1, 1).fill({ color: hex('Y'), alpha: 0.6 * g * fl });
        if (Math.random() < dt * 4 * g) motes.emit(eye.x + (Math.random() - 0.5) * 4, eye.y - 1, (Math.random() - 0.5) * 3, -6 - Math.random() * 6, 1.2 + Math.random(), Math.random() < 0.6 ? 'Y' : 'f');
      }
      hero.pose(t);
      motes.update(dt);
    },
  };
}

/**
 * 残页：封神榜撕下来的一角（左上是榜原来的边：一线暗金的边框；右下是撕开、烧焦的毛边），焦黄的纸上几列看不清的名字、一方朱印。宽 22、高 16。
 */
const PAGE: Grid = ((rows: string[]) => ({ w: 22, h: rows.length, rows: rows.map((r) => r.padEnd(22, '.')) }))([
  'UUUUUUUUUUUUUUUUUUU',
  'UyyyyyyyyyyyyyyyyybB',
  'UyreyyByyyByyyByyybbB',
  'UyrryyByyyByyyyyyybbB',
  'UyyyyyyyyyByyyByybbbbB',
  'UyyyyyByyyyyyyByybbbB',
  'UyyyyyByyyByyyyybbbBB',
  'UyyyyyyyyyByyyBybbbB',
  'UyyyyyByyyyyyyBbbbB',
  'UyyyyyByyyByybbbbB',
  'UyyyyyyyyyBybbbBB',
  'UyyyyyByyybbbbB',
  'UyyyyyBybbbbBB',
  'UyyyyybbbbB',
  'UybbbbbBB',
  'UBBBBBB',
]);

export function shotPage(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 120;
  k.sprite(k.tex(duskSky(W, H, horizon + 4, fx + 100, LATE)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 12), horizon - 40);
  k.sprite(k.tex(plain(W, H, horizon, 253, [], true)), 0, 0, root);
  const haze = k.tiling(horizonHaze(k, 254, ['p', 'Q', 'h']), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.4;
  // 落魂阵的阵台（近景，很大）：台面铺满画面下半，阵眼在正中
  const ex = fx + 240;
  const ey = fy + 248;
  const big = makeDais(k, root, ex, ey, 'huge', TEN_CLOTH[7], 620, false);
  big.flag.visible = false;
  nightVeil(k, root, horizon, 0.22);
  // 倒在台沿上的落魂幡（剪影、灭了魂火）
  const fallen = rotateGrid(recolor(SOULFLAG_FRAMES[1], OUT_FIRE), SOULFLAG_ANCHOR.x, SOULFLAG_ANCHOR.y, -1.5);
  const fallenS = new Sprite(k.grid(fallen.g));
  fallenS.anchor.set(fallen.ax / fallen.g.w, fallen.ay / fallen.g.h);
  fallenS.position.set(big.top.x + 40, big.top.y + 2);
  root.addChild(fallenS);
  // 残页：从阵眼里慢慢顶出来（遮罩到阵眼那一行），边上的金一闪一闪地走
  const pageC = new Container();
  root.addChild(pageC);
  const pageS = k.sprite(k.grid(PAGE), 0, 0, pageC);
  const pm = new Graphics().rect(big.top.x - 16, big.top.y - 40, 32, 41).fill({ color: 0xffffff });
  root.addChild(pm);
  pageC.mask = pm;
  const shine = new Graphics();
  shine.blendMode = 'add';
  pageC.addChild(shine);
  const motes = new Motes(root, true);
  // 本机玩家的角色：站在阵眼左边，低头看着（朝右）
  const hero = heroActor(k, root, big.top.x - 40, big.top.y + 7, 1);
  k.cue(0.6, 'ten.gold', 0.3);
  return {
    root,
    sub: 'top',
    minT: 4,
    update(dt, t) {
      starAt(t, 0.9);
      haze.tilePosition.x = Math.floor(t * 2);
      // 顶出来：约 1.6 秒，从阵眼里升上来 13 像素
      const u = easeOut(clamp((t - 0.3) / 1.6));
      pageC.position.set(big.top.x - 10, Math.round(big.top.y + 1 - u * 13));
      pageS.position.set(0, 0);
      // 一道亮从页面上斜着扫过去（只是字形里面亮一档，不是光晕）
      shine.clear();
      const sx = ((t * 9) % 26) - 6;
      for (let y = 0; y < PAGE.h; y++)
        for (let x = 0; x < PAGE.w; x++) {
          const c = PAGE.rows[y][x];
          if (c !== 'y') continue;
          const d = Math.abs(x + y * 0.6 - sx * 1.3);
          if (d < 1.5) shine.rect(x, y, 1, 1).fill({ color: hex('Y'), alpha: 0.5 * (1 - d / 1.5) * u });
        }
      if (u > 0.2 && Math.random() < dt * 10) motes.emit(big.top.x - 8 + Math.random() * 18, big.top.y - 2 - u * 12, (Math.random() - 0.5) * 3, -5 - Math.random() * 7, 1.4 + Math.random() * 1.2, Math.random() < 0.6 ? 'Y' : 'f');
      hero.pose(t);
      motes.update(dt);
    },
  };
}

/** 东边地平线上的山影（透明底）：一线冷青的山，往下淡没——界牌关的方向（第三章的山崖、同一套冷色）。 */
function eastRange(w: number, h: number, seed: number): Bitmap {
  const c = new Chars(w, h);
  const n1 = valueNoise(seed, 30, w, 4);
  const n2 = valueNoise(seed + 1, 8, w, 4);
  for (let x = 0; x < w; x++) {
    const rise = clamp((x - w * 0.25) / (w * 0.75)); // 往东（右）越来越高
    const top = Math.round(h - 4 - rise ** 1.4 * (h - 10) * (0.55 + 0.45 * n1(x, 1)) - (n2(x, 2) - 0.5) * 4);
    for (let y = top; y < h; y++) c.set(x, y, y === top ? 'J' : y === top + 1 ? 'X' : 'O');
  }
  return c.bitmap((x, y) => Math.round(255 * clamp(1 - (y - h + 10) / 10) * clamp(x / 30)));
}

export function shotPagesEast(k: ShotKit): Shot {
  const { W, H, fx, fy } = k;
  const root = new Container();
  const horizon = fy + 112;
  k.sprite(k.tex(duskSky(W, H, horizon + 6, fx + 120, LATE)), 0, 0, root);
  const starAt = stars(k, root, Math.round(W / 9), horizon - 30);
  // 东边（右）地平线上一线冷青的山影
  const range = k.sprite(k.tex(eastRange(260, 34, 261)), fx + 230, horizon - 30, root);
  range.alpha = 0.85;
  const rings = RISE.map((r, i) => daisRing(fx + r.x, fy + r.y, r.size, 700 + i));
  k.sprite(k.tex(plain(W, H, horizon, 263, rings, true)), 0, 0, root);
  const haze = k.tiling(horizonHaze(k, 264, ['p', 'Q', 'h']), W, root);
  haze.y = horizon - 20;
  haze.alpha = 0.45;
  const daises = RISE.map((r, i) => makeDais(k, root, fx + r.x, fy + r.y, r.size, TEN_CLOTH[i], 700 + i, false, RISE_KINDS[i]));
  // 十座阵：旗都垂下来了（阵破了）
  for (const v of daises) v.flag.texture = v.frames.idle[0];
  nightVeil(k, root, horizon, 0.26);
  // 十座阵眼一座接一座透出暗金（由近到远）
  const order = RISE.map((_, i) => i).sort((a, b) => RISE[b].y - RISE[a].y);
  const gold = new Graphics();
  gold.blendMode = 'add';
  root.addChild(gold);
  // 残页：从最近的那座阵眼被风卷起来，翻着往东（右上）飞
  const near = daises[9];
  const flyT = PAGE_FLY.map((g) => k.grid(g));
  const page = new Sprite(flyT[0]);
  page.anchor.set(0.5);
  root.addChild(page);
  const trail = new Motes(root, true);
  const wind = new Wind(k, root, horizon - 40, H, 1.4);
  const T0 = 2.3; // 起风、残页飞起来的时刻（飞出画面时这一镜、整段过场收场）
  order.forEach((_, j) => k.cue(0.4 + j * 0.16, 'ten.gold', j === 0 ? 0.25 : 0.06));
  k.cue(T0, 'wind.dash', 0.3);
  return {
    root,
    narrAt: { x: 0.16, y: 0.12, h: 0.42 },
    minT: 6,
    update(dt, t) {
      starAt(t, 1);
      haze.tilePosition.x = Math.floor(t * 4);
      gold.clear();
      for (const [j, i] of order.entries()) {
        const v = daises[i];
        const g = clamp((t - 0.4 - j * 0.16) / 0.6);
        // 旗：起风之后被吹得抖起来
        if (t > T0) v.flag.texture = v.frames.flutter[Math.floor(t * 10 + i * 1.3) % 4];
        if (t > T0 && v.body && v.banner) v.body.texture = v.banner.flutter[Math.floor(t * 10 + i * 1.3) % 4];
        if (g <= 0) continue;
        const fl = 0.7 + 0.3 * Math.sin(t * 2.6 + i);
        const far = v.size === 'far';
        const near = v.size === 'near';
        // 阵眼里透出的暗金：一道扁扁的亮（近的宽一点），上面一粒亮的，偶尔飘起一粒金屑
        gold.rect(v.top.x - (far ? 1 : near ? 3 : 2), v.top.y, far ? 3 : near ? 7 : 5, 1).fill({ color: hex('U'), alpha: 0.9 * g * fl });
        gold.rect(v.top.x - (far ? 0 : 1), v.top.y, far ? 1 : 3, 1).fill({ color: hex('y'), alpha: 0.8 * g * fl });
        gold.rect(v.top.x, v.top.y - 1, 1, 1).fill({ color: hex('Y'), alpha: 0.7 * g * fl });
        if (Math.random() < dt * (far ? 1.5 : 3) * g) trail.emit(v.top.x + (Math.random() - 0.5) * 3, v.top.y - 1, (Math.random() - 0.5) * 2, -4 - Math.random() * 5, 1 + Math.random(), Math.random() < 0.6 ? 'Y' : 'f');
      }
      // 残页的路：从阵眼升起，顺风往右上飘，一路上下翻、越飞越远（到画面外）
      const u = clamp((t - T0) / 3.6);
      const x0 = near.top.x;
      const y0 = near.top.y - 2;
      const px = x0 + (fx + 520 - x0) * ease(u) + Math.sin(u * 9) * 6 * u;
      const py = y0 + (fy + 40 - y0) * easeOut(u) + Math.sin(u * 13 + 1) * 5 * u;
      page.visible = t > T0;
      page.position.set(Math.round(px), Math.round(py));
      page.texture = flyT[Math.floor(t * 7) % flyT.length];
      if (t > T0 && u < 1 && Math.random() < dt * 22) trail.emit(px + (Math.random() - 0.5) * 2, py + (Math.random() - 0.5) * 2, -6 - Math.random() * 6, (Math.random() - 0.5) * 4, 0.8 + Math.random() * 0.8, Math.random() < 0.6 ? 'Y' : 'f');
      trail.update(dt);
      wind.update(dt);
    },
  };
}
