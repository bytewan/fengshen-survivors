// 一层「扁平」的小图：几百上千个用同一张底图的小精灵（灵石、灵石的光、敌人的影子和眼光），整层画在一个 Pixi 的 ParticleContainer 里。
//
// 为什么（docs/perf.md）：Pixi 8 里每个精灵都是场景树上的一个节点，场景的结构一变（加一个、删一个、换个前后）整组都要重建绘制指令，
// 满场时灵石和它的光就有五千个节点，光是每帧重建就要好几毫秒；放进 ParticleContainer 以后它们不是节点，只是往一块缓冲里写几个数，
// 增删也不算结构变化。画出来的一样：同样的贴图、锚点、着色、透明度（透明度和 Pixi 的精灵一样截断成 0–255）、同样按整像素取整，
// 层内的前后次序就是加进来的次序（和原来按建出来的先后叠放一样）。
//
// 每次上屏之前（ParticleContainer 的 onRender）才整理：挪走拿掉的；给了 cull 就只交出落在镜头里的那些（满场几千颗灵石，镜头里的只有四分之一）；
// 交出去的和上一帧一样、也没改过颜色时，不变的那几样（锚点和大小、颜色、贴图坐标里标成不变的）不重传。
//
// 限制：一层里的贴图必须出自同一张底图（几帧排成一张图集，见 textures.ts 的 atlasFromGrids）；不能旋转、不能单独设混合方式（跟着父容器）。
import { ParticleContainer, type Container, type IParticle, type Texture } from 'pixi.js';
import { VIEW_H, VIEW_W } from './view-fit.ts';

/**
 * 按镜头裁：cam 是舞台的镜头（stage.cam，画面左上角的世界坐标，上屏之前已经摆好），四周多留 m 像素
 * （震屏最多挪 6 像素，再加上小图自己的大小）。
 */
export function camCull(cam: { x: number; y: number }, m = 24): () => readonly [number, number, number, number] {
  const r: [number, number, number, number] = [0, 0, 0, 0];
  return () => {
    r[0] = cam.x - m;
    r[1] = cam.y - m;
    r[2] = cam.x + VIEW_W + m;
    r[3] = cam.y + VIEW_H + m;
    return r;
  };
}

/** 层里的一个小图。字段名照 Pixi 的 IParticle（ParticleContainer 每帧直接读）。 */
export class Flat implements IParticle {
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  anchorX = 0;
  anchorY = 0;
  readonly rotation = 0;
  /** 颜色和透明度打包在一起：0xAABBGGRR。用 tint() / alpha / visible 设。 */
  color = 0xffffffff;
  texture: Texture;
  /** 已经从层里拿掉（下次整理时挪走）。 */
  gone = false;
  /** 所在的层（改了颜色要告诉它：颜色一般是「不变的」那一类，要重传）。 */
  owner: FlatLayer | null = null;
  private rgb = 0xffffff;
  private a = 1;
  private shown = true;
  constructor(texture: Texture) {
    this.texture = texture;
  }
  /** 着色和透明度（和精灵的 tint / alpha 一样：透明度截断到 0–255）。 */
  tint(rgb: number, alpha = 1) {
    this.rgb = rgb;
    this.a = alpha;
    this.pack();
  }
  get alpha() {
    return this.a;
  }
  set alpha(v: number) {
    if (v === this.a) return;
    this.a = v;
    this.pack();
  }
  /** 藏起来就是透明度画成 0（位置照旧在层里，前后次序不变）。 */
  get visible() {
    return this.shown;
  }
  set visible(v: boolean) {
    if (v === this.shown) return;
    this.shown = v;
    this.pack();
  }
  private pack() {
    const al = this.a;
    const a = !this.shown || al <= 0 ? 0 : al >= 1 ? 255 : (al * 255) | 0;
    const rgb = this.rgb;
    const c = ((a << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
    if (c === this.color) return;
    this.color = c;
    this.owner?.touch();
  }
}

export interface FlatOptions {
  /** 每帧会变的：位置总是；换帧（贴图坐标）、大小、颜色按需要标上。没标的改了要 touch()（Flat 改颜色会自己说）。 */
  dynamic?: { uvs?: boolean; vertex?: boolean; color?: boolean };
  /** 只画落在这个矩形（世界坐标：左、上、右、下）里的；上屏之前问一次，返回 null 就全画。 */
  cull?: () => readonly [number, number, number, number] | null;
}

export class FlatLayer {
  readonly box: ParticleContainer;
  /** 全部（加进来的先后）。 */
  private all: Flat[] = [];
  /** 交给 Pixi 画的（不裁的时候就是 all 本身）。 */
  private out: Flat[];
  /** 加过、拿掉过：要整理，交出去的排位也变了。 */
  private dirty = false;
  /** 改过不重传的那几样（颜色……）。 */
  private touched = false;
  /** 整理过（加了、删了）：全部交出去的时候排位变了。 */
  private reordered = false;
  /** 上一次上屏的时间（performance.now）。 */
  private lastDraw = -1e9;
  private cull: FlatOptions['cull'] | null;
  constructor(parent: Container | null, texture: Texture, opts: FlatOptions = {}) {
    this.cull = opts.cull ?? null;
    this.out = this.cull ? [] : this.all;
    const d = opts.dynamic ?? {};
    this.box = new ParticleContainer({
      texture,
      particles: this.out,
      dynamicProperties: { position: true, uvs: !!d.uvs, vertex: !!d.vertex, color: !!d.color, rotation: false },
    });
    this.box.onRender = () => this.sync();
    parent?.addChild(this.box);
  }
  /** 加一个（画在这一层已有的上面）。 */
  add(texture: Texture, anchorX: number, anchorY: number): Flat {
    const f = new Flat(texture);
    f.anchorX = anchorX;
    f.anchorY = anchorY;
    f.owner = this;
    this.all.push(f);
    this.dirty = true;
    return f;
  }
  /** 拿掉一个（其余的前后次序不变）。 */
  remove(f: Flat) {
    if (f.gone) return;
    f.gone = true;
    f.owner = null;
    this.dirty = true;
  }
  /** 改了不重传的那几样（颜色、大小、贴图坐标里没标成每帧变的）：下次上屏时整份重传。 */
  touch() {
    this.touched = true;
  }
  /** 把拿掉的挪走（不调也行：上屏之前会自己整理；一帧里删得多时早点调，数组不会越攒越长）。 */
  flush() {
    if (!this.dirty) return;
    const a = this.all;
    let w = 0;
    for (let i = 0; i < a.length; i++) if (!a[i].gone) a[w++] = a[i];
    a.length = w;
    this.dirty = false;
    this.reordered = true;
  }
  private sync() {
    this.flush();
    let changed = this.touched;
    if (this.cull) {
      // 只交出镜头里的：交出去的和上一帧一模一样（同样的几个、同样的先后）时不用重传不变的那几样
      const r = this.cull();
      const out = this.out;
      const a = this.all;
      let w = 0;
      for (let i = 0; i < a.length; i++) {
        const f = a[i];
        if (r && (f.x < r[0] || f.x > r[2] || f.y < r[1] || f.y > r[3])) continue;
        if (out[w] !== f) {
          out[w] = f;
          changed = true;
        }
        w++;
      }
      if (w !== out.length) {
        out.length = w;
        changed = true;
      }
    } else if (this.reordered) changed = true; // 交出去的就是 all：加了、删了都要重传
    // 好一阵没画（万宝阁盖着的时候）：Pixi 可能已经把这一层的缓冲回收了，重建出来的缓冲里没有不变的那几样，也要整份重传
    const now = performance.now();
    if (now - this.lastDraw > 500) changed = true;
    this.lastDraw = now;
    if (changed) this.box.update();
    this.touched = this.reordered = false;
  }
  clear() {
    for (const f of this.all) {
      f.gone = true;
      f.owner = null;
    }
    this.all.length = 0;
    if (this.out !== this.all) this.out.length = 0;
    this.dirty = false;
    this.touched = true;
  }
  get count() {
    return this.all.length;
  }
  destroy() {
    this.clear();
    this.box.destroy();
  }
}
