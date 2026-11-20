// 逐像素笔刷的底子（不依赖 Pixi 和 DOM，Node 里可以直接测）：
// - 像素坐标打包成一个数；
// - PixelBuffer：一块窗口大小的预乘 RGBA 缓冲，把一组组同色同透明度的像素叠上去；
// - StrokeTable：一笔粗线里「同一像素只留优先级最高的颜色」用的定长表。
// 画面这一头（建纹理、上传、贴到场景里）在 pixel-surface.ts。

import { PALETTE, hexToRgba } from '../art/palette.ts';

/** 调色板字符编码 → 打包好的不透明 RGBA（小端：0xAABBGGRR）。网格转纹理、逐像素现画的图（闪电、焦痕）都往缓冲里写这个。 */
export const PAL32 = (() => {
  const t = new Uint32Array(128);
  for (const [k, v] of Object.entries(PALETTE)) {
    const [r, g, b] = hexToRgba(v);
    t[k.charCodeAt(0)] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return t;
})();

/** 打包的范围：x、y 是整数，-4096 ≤ x, y < 4096（场地加上魔气带远小于这个范围）。 */
const BIAS = 4096;
const SPAN = 8192;
/** 像素坐标打包成一个数（小于 2^26）。出了范围的坐标打包前要先用 packable 挡掉，否则会串到别的像素上。 */
export const packXY = (x: number, y: number) => (x + BIAS) * SPAN + (y + BIAS);
export const packable = (x: number, y: number) => x >= -BIAS && x < BIAS && y >= -BIAS && y < BIAS;
export const unpackX = (k: number) => (k >> 13) - BIAS;
export const unpackY = (k: number) => (k & (SPAN - 1)) - BIAS;

/** a * b / 255，四舍五入（a、b 都是 0..255）。 */
const mul255 = (a: number, b: number) => {
  const p = a * b + 128;
  return (p + (p >> 8)) >> 8;
};

/**
 * 一块像素缓冲：盖住世界里 (ox, oy) 起、w × h 大的一块（画面那么大）。存的是预乘透明度的 RGBA（小端：0xAABBGGRR）。
 * 每帧：begin（挪窗口、擦掉上次画的行）→ fill 若干次 → 读 dirtyFrom / dirtyTo 上传动过的行。
 */
export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;
  /** 缓冲左上角对应的世界坐标。 */
  ox = 0;
  oy = 0;
  /** 这一次画到的行（y0 > y1 表示什么都没画）。 */
  y0: number;
  y1 = -1;
  /** 这次要上传的行：这次画的 ∪ 上次画过、这次擦掉的（from > to 表示不用传）。 */
  dirtyFrom: number;
  dirtyTo = -1;
  constructor(w: number, h: number, bytes?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.px = bytes ? new Uint32Array(bytes.buffer, bytes.byteOffset, w * h) : new Uint32Array(w * h);
    this.y0 = h;
    this.dirtyFrom = h;
  }
  /** 开始画新的一帧：窗口挪到 (ox, oy)，把上一次画过的行擦干净。 */
  begin(ox: number, oy: number) {
    this.ox = ox;
    this.oy = oy;
    if (this.y1 >= this.y0) this.px.fill(0, this.y0 * this.w, (this.y1 + 1) * this.w);
    this.dirtyFrom = this.y0;
    this.dirtyTo = this.y1;
    this.y0 = this.h;
    this.y1 = -1;
  }
  /**
   * 叠上一组同色、同透明度的像素。keys 里每个像素一个数（packXY 打包的世界坐标，同一个像素可以出现多次），
   * rgb 是 0xRRGGBB，alpha255 是 0..255 的透明度。不透明的直接盖上去；半透明的按「新的盖在旧的上面」混合，
   * 和一层层往画面上画是一个结果。落在窗口外面的像素丢掉。
   */
  fill(keys: ArrayLike<number>, n: number, rgb: number, alpha255: number) {
    const a = alpha255 | 0;
    if (a <= 0) return;
    const { px, w, h } = this;
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    const ox = this.ox + BIAS;
    const oy = this.oy + BIAS;
    let y0 = this.y0;
    let y1 = this.y1;
    if (a >= 255) {
      const word = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      for (let i = 0; i < n; i++) {
        const k = keys[i];
        const x = (k >> 13) - ox;
        const y = (k & (SPAN - 1)) - oy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        px[y * w + x] = word;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    } else {
      const sr = mul255(r, a);
      const sg = mul255(g, a);
      const sb = mul255(b, a);
      const word = ((a << 24) | (sb << 16) | (sg << 8) | sr) >>> 0;
      const ia = 255 - a;
      for (let i = 0; i < n; i++) {
        const k = keys[i];
        const x = (k >> 13) - ox;
        const y = (k & (SPAN - 1)) - oy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const j = y * w + x;
        const d = px[j];
        px[j] = d === 0 ? word : (((a + mul255(d >>> 24, ia)) << 24) | ((sb + mul255((d >> 16) & 255, ia)) << 16) | ((sg + mul255((d >> 8) & 255, ia)) << 8) | (sr + mul255(d & 255, ia))) >>> 0;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    this.y0 = y0;
    this.y1 = y1;
    if (y0 < this.dirtyFrom) this.dirtyFrom = y0;
    if (y1 > this.dirtyTo) this.dirtyTo = y1;
  }
  /** 这一次有没有画上东西。 */
  get empty() {
    return this.y1 < this.y0;
  }
  /**
   * 叠上一个实心矩形（世界坐标的整数像素，左上角 x, y，宽 w、高 h）。mode：0 普通（新的盖在旧的上面，同 fill）、
   * 1 加法（预乘后的颜色逐通道加上去，满了就是满）、2 取最大（逐通道取大的）——和 Pixi 用 'normal' / 'add' / 'max' 混合把这些矩形
   * 一个个画上去是一个结果（加法、取最大跟先后无关）。落在窗口外面的部分丢掉。
   */
  rect(x: number, y: number, rw: number, rh: number, rgb: number, alpha255: number, mode: 0 | 1 | 2) {
    const a = alpha255 | 0;
    if (a <= 0 || rw <= 0 || rh <= 0) return;
    const { px, w, h } = this;
    const x0 = Math.max(0, x - this.ox);
    const y0 = Math.max(0, y - this.oy);
    const x1 = Math.min(w, x - this.ox + rw);
    const y1 = Math.min(h, y - this.oy + rh);
    if (x0 >= x1 || y0 >= y1) return;
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    const sa = Math.min(255, a);
    const sr = mul255(r, sa);
    const sg = mul255(g, sa);
    const sb = mul255(b, sa);
    const word = ((sa << 24) | (sb << 16) | (sg << 8) | sr) >>> 0;
    const ia = 255 - sa;
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * w;
      for (let xx = x0; xx < x1; xx++) {
        const j = row + xx;
        const d = px[j];
        if (d === 0 || (mode === 0 && sa === 255)) {
          px[j] = word;
          continue;
        }
        const dr = d & 255;
        const dg = (d >> 8) & 255;
        const db = (d >> 16) & 255;
        const da = d >>> 24;
        if (mode === 1) px[j] = ((Math.min(255, da + sa) << 24) | (Math.min(255, db + sb) << 16) | (Math.min(255, dg + sg) << 8) | Math.min(255, dr + sr)) >>> 0;
        else if (mode === 2) px[j] = ((Math.max(da, sa) << 24) | (Math.max(db, sb) << 16) | (Math.max(dg, sg) << 8) | Math.max(dr, sr)) >>> 0;
        else px[j] = (((sa + mul255(da, ia)) << 24) | ((sb + mul255(db, ia)) << 16) | ((sg + mul255(dg, ia)) << 8) | (sr + mul255(dr, ia))) >>> 0;
      }
    }
    if (y0 < this.y0) this.y0 = y0;
    if (y1 - 1 > this.y1) this.y1 = y1 - 1;
    if (y0 < this.dirtyFrom) this.dirtyFrom = y0;
    if (y1 - 1 > this.dirtyTo) this.dirtyTo = y1 - 1;
  }
}

/** 收像素的一方（fx.ts 的 Pixels）：key 是 packXY 打包的坐标，color 是 0xRRGGBB，alpha 是 0..1。 */
export interface PixelSink {
  putKey(key: number, color: number, alpha: number): void;
}

/** 一张表最多放多少个像素（槽位是它的两倍，装到一半就算满）。一笔粗线通常几百到三四千个像素。 */
export const STROKE_TABLE_SIZE = 8192;

/**
 * 「同一像素只留优先级最高的颜色」用的表：开放寻址，按第一次碰到的先后记着顺序。
 * 定长、不扩容——放满了 put 返回 false，由调用方另想办法（fx.ts 的 Stroke 把多出来的放进一个 Map）。
 */
export class StrokeTable {
  private keys = new Int32Array(STROKE_TABLE_SIZE * 2).fill(-1);
  private color = new Uint32Array(STROKE_TABLE_SIZE * 2);
  private alpha = new Float64Array(STROKE_TABLE_SIZE * 2);
  private prio = new Int8Array(STROKE_TABLE_SIZE * 2);
  private order = new Uint16Array(STROKE_TABLE_SIZE);
  /** 表里现在有多少个像素。 */
  n = 0;
  /**
   * 记一个像素（key 是 packXY 打包的坐标）。这个像素已经在表里：优先级更高、或同级但更不透明的才换上去。
   * 返回 false 表示这个像素不在表里、而表已经满了。
   */
  put(key: number, color: number, alpha: number, prio: number): boolean {
    const keys = this.keys;
    const mask = STROKE_TABLE_SIZE * 2 - 1;
    let h = (Math.imul(key, 0x9e3779b1) >>> 17) & mask;
    for (;;) {
      const q = keys[h];
      if (q === key) {
        const p = this.prio[h];
        if (p < prio || (p === prio && this.alpha[h] < alpha)) {
          this.color[h] = color;
          this.alpha[h] = alpha;
          this.prio[h] = prio;
        }
        return true;
      }
      if (q === -1) break;
      h = (h + 1) & mask;
    }
    if (this.n >= STROKE_TABLE_SIZE) return false;
    keys[h] = key;
    this.color[h] = color;
    this.alpha[h] = alpha;
    this.prio[h] = prio;
    this.order[this.n++] = h;
    return true;
  }
  /** 按第一次碰到的先后把表里的像素逐个交给 sink，然后清空。 */
  drain(sink: PixelSink) {
    const { keys, color, alpha, order } = this;
    for (let i = 0; i < this.n; i++) {
      const h = order[i];
      sink.putKey(keys[h], color[h], alpha[h]);
      keys[h] = -1;
    }
    this.n = 0;
  }
}

const spare: StrokeTable[] = [];
/** 借一张空表。笔画都是「点完就交」，同一时刻几乎只有一笔在用，所以表是大家轮着用的，不是每笔一张。 */
export function borrowStrokeTable(): StrokeTable {
  return spare.pop() ?? new StrokeTable();
}
/** 还表（必须已经 drain 过，是空的）。 */
export function returnStrokeTable(t: StrokeTable) {
  if (t.n === 0 && spare.length < 8) spare.push(t);
}
