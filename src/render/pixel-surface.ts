// 一层每帧重画的像素（世界坐标）：法宝特效的逐像素笔刷（枪芒、火罩的骨、圈尾、金线……）都画在这种层上。
//
// 原来的做法是每帧把几千个像素各建成一个 1×1 的矩形交给 Pixi 的 Graphics：Pixi 要逐个三角化、逐个进批处理，
// 火行构筑下光这一项每帧就三四毫秒（手机上十几毫秒）。现在是一块画面大小的 RGBA 缓冲，像素直接写进缓冲、
// 只上传动过的行；整层是一张精灵，Pixi 不再为它重建几何。画出来的结果不变：还是一组组同色同透明度的像素按先后叠上去。
//
// 缓冲只有画面那么大，贴在镜头上：真正往缓冲里画，是在这一帧上屏之前（精灵的 onRender），那时镜头已经摆好了。
import { BufferImageSource, Sprite, Texture } from 'pixi.js';
import { PixelBuffer } from './pixel-raster.ts';
import { VIEW_H, VIEW_W } from './view-fit.ts';

/** 往缓冲里画这一帧的内容（调 buf.fill）。 */
export type PixelPainter = (buf: PixelBuffer) => void;

export class PixelSurface {
  /** 画出来的那张图：放进跟着镜头走的图层里（它所在的图层一路往上只能有平移，不能有缩放和旋转）。 */
  readonly sprite = new Sprite(Texture.EMPTY);
  private buf: PixelBuffer | null = null; // 第一次要画时才分配（没用到的层不占内存）
  private src: BufferImageSource | null = null;
  private painter: PixelPainter | null = null;
  private dirty = false;

  constructor() {
    this.sprite.visible = false;
    // Pixi 每次渲染这棵树之前会调一次
    this.sprite.onRender = () => this.sync();
  }

  /** 内容换了：下次上屏前按 painter 重画。传 null 表示这一帧什么都没有（藏起来，不占渲染）。 */
  set(painter: PixelPainter | null) {
    this.painter = painter;
    this.dirty = true;
    this.sprite.visible = painter !== null;
  }

  private sync() {
    const paint = this.painter;
    if (!paint) return;
    // 这张图所在的图层的原点在画面上的哪里（把一路的平移加起来）：取反就是画面左上角在图层里的坐标
    let gx = 0;
    let gy = 0;
    for (let c = this.sprite.parent; c; c = c.parent) {
      gx += c.x;
      gy += c.y;
    }
    const ox = Math.round(-gx);
    const oy = Math.round(-gy);
    let buf = this.buf;
    if (!buf) {
      const bytes = new Uint8Array(VIEW_W * VIEW_H * 4);
      buf = this.buf = new PixelBuffer(VIEW_W, VIEW_H, bytes);
      this.src = new BufferImageSource({ resource: bytes, width: VIEW_W, height: VIEW_H, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'nearest' });
      this.sprite.texture = new Texture({ source: this.src });
    } else if (!this.dirty && ox === buf.ox && oy === buf.oy) return; // 内容没换、镜头也没动（暂停、命中停顿）：缓冲里的还能用
    this.dirty = false;
    buf.begin(ox, oy);
    paint(buf);
    if (buf.dirtyTo >= buf.dirtyFrom) this.src!.update(buf.dirtyFrom * buf.w, (buf.dirtyTo + 1) * buf.w);
    this.sprite.position.set(ox, oy);
  }
}
