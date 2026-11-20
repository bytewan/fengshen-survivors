// 「逐像素画」的一层，接口照 Pixi Graphics 里最常用的那一小截：clear()、rect(x, y, w, h).fill({ color, alpha })。
//
// 为什么（docs/perf.md）：好几处特效（第三章的剑气、傀儡之间的剑气线，第二章姚天君的魂线、魂波、草人的拜魂线）每帧把几十到几百个
// 1×1 的像素各建成一个 Graphics 矩形——Pixi 8 要为每个矩形建路径、样式对象、三角化、进批处理，每秒新分配几十 MB（垃圾回收一来就顿一下），
// 光是这一项在手机上每帧就好几毫秒。这里只把矩形记下来（几个数），上屏前才一次性画进一块画面大小的像素缓冲、只上传动过的行
// （pixel-surface.ts，法宝的逐像素笔刷早就是这么画的）。
//
// 画出来的一样：矩形按记下的先后叠上去，透明度和 Pixi 一样截断成 0–255（alpha × 255 取整）；混合方式看这一层（或往上第一个设了的父容器）的 blendMode：
// 'add' 逐通道加、'max' 取最大、其余按普通混合一个个盖上去，和 Pixi 用同样的混合方式把这些矩形一个个画上去是一个结果（差别不超过取整的一两级）。
// 限制：只认整数像素的矩形（rect 的坐标会按 Pixi 的整像素对齐取整）；这一层和它的父容器一路往上只能有平移（世界层、辉光层都是）；
// 自己的 alpha、tint 不要设（要淡出就把每个矩形的透明度乘上去）。
import { Container } from 'pixi.js';
import { PixelSurface } from './pixel-surface.ts';
import type { PixelBuffer } from './pixel-raster.ts';

type FillStyle = number | { color?: number; alpha?: number };

export class PixelGraphics extends Container {
  private surface = new PixelSurface();
  /** 记下的矩形：每个 6 个数（x, y, w, h, 颜色, 透明度 0–255）。 */
  private data = new Int32Array(6 * 256);
  private n = 0;
  /** rect() 之后还没 fill 的那一个。 */
  private px = 0;
  private py = 0;
  private pw = 0;
  private ph = 0;
  private pending = false;
  /** 连着几帧什么都没画（连着两帧空了才把精灵藏起来：每帧先 clear 再画，不能每帧都藏一下又露出来——那样场景树每帧都算结构变了）。 */
  private empty = 0;
  private shown = false;
  private readonly paint = (buf: PixelBuffer) => {
    const d = this.data;
    const mode = blendOf(this);
    for (let i = 0, o = 0; i < this.n; i++, o += 6) buf.rect(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], mode);
  };

  constructor() {
    super();
    this.addChild(this.surface.sprite);
  }

  /** 擦掉这一层（下一帧要重画的都先 clear）。 */
  clear(): this {
    this.empty = this.n > 0 ? 0 : this.empty + 1;
    this.n = 0;
    this.pending = false;
    if (this.shown && this.empty >= 2) {
      this.surface.set(null); // 好一会儿没画了：藏起来，不占渲染
      this.shown = false;
    } else if (this.shown) this.surface.set(this.paint); // 上一帧画过：这一帧照样上屏前重画（画得空空的也要擦掉上一帧的）
    return this;
  }

  /** 记一个矩形（等 fill 给颜色）。坐标照 Pixi 的整像素对齐：x 四舍五入，y 恰好半像素时往上取（场景贴图的那一点微调，见 stage.ts）。 */
  rect(x: number, y: number, w: number, h: number): this {
    const x0 = Math.floor(x + 0.5);
    const y0 = Math.floor(y + 0.5 - 1 / 1024);
    this.px = x0;
    this.py = y0;
    this.pw = Math.floor(x + w + 0.5) - x0;
    this.ph = Math.floor(y + h + 0.5 - 1 / 1024) - y0;
    this.pending = true;
    return this;
  }

  /** 给刚才的矩形上色。color 是 0xRRGGBB，alpha 0..1（和 Graphics.fill 的样式一样）。 */
  fill(style: FillStyle = 0xffffff): this {
    if (!this.pending) return this;
    this.pending = false;
    const color = typeof style === 'number' ? style : (style.color ?? 0xffffff);
    const alpha = typeof style === 'number' ? 1 : (style.alpha ?? 1);
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
    if (a <= 0 || this.pw <= 0 || this.ph <= 0) return this;
    if ((this.n + 1) * 6 > this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const o = this.n * 6;
    const d = this.data;
    d[o] = this.px;
    d[o + 1] = this.py;
    d[o + 2] = this.pw;
    d[o + 3] = this.ph;
    d[o + 4] = color & 0xffffff;
    d[o + 5] = a;
    if (this.n++ === 0 && !this.shown) {
      this.surface.set(this.paint); // 藏着的时候来了第一笔：露出来，上屏前画进缓冲
      this.shown = true;
    }
    return this;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    // 缓冲的贴图是这一层自己的
    this.surface.sprite.destroy({ texture: true, textureSource: true });
    super.destroy(options);
  }
}

/** 这一层实际的混合方式：自己的，或往上第一个不是 inherit 的父容器的。 */
function blendOf(c: Container): 0 | 1 | 2 {
  for (let p: Container | null = c; p; p = p.parent) {
    const m = p.blendMode;
    if (m && m !== 'inherit') return m === 'add' ? 1 : m === 'max' ? 2 : 0;
  }
  return 0;
}
