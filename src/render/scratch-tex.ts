// 临时的小贴图：闪电、焦痕这类「出一次手现画一张、过一会儿就不要了」的图。
// 原来每张都现建一个纹理（建对象 + 在 GPU 上开一张新贴图），雷公鞭一次出手一二十张，出手那一帧明显多花时间。
// 这里备着几档固定大小的贴图轮着用：借一张（已经清空）→ 往它的像素缓冲里画 → commit 上传 → 用完还回来。
// 跑起来之后不再新建贴图，只有上传像素的开销。贴图比图大，图画在左上角，其余是透明的。
import { BufferImageSource, Texture } from 'pixi.js';

export interface Scratch {
  readonly tex: Texture;
  /** 像素缓冲（0xAABBGGRR；半透明的要写预乘过的颜色）。每行 stride 个像素。 */
  readonly px: Uint32Array;
  readonly stride: number;
  /** 这张贴图有多大（不小于借的时候要的大小）。 */
  readonly w: number;
  readonly h: number;
}
interface Slot extends Scratch {
  src: BufferImageSource;
  size: number; // 第几档；-1 是放不进任何一档、单独建的
  used: number; // 像素缓冲里画过多少行（下次借出去前擦掉）
  onGpu: number; // GPU 上那张贴图里还留着多少行旧内容（下次上传时要一并盖掉）
}

/** 几档大小：小电弧、鞭梢 → 连跳的一段 → 从天上劈下来的一道。 */
const SIZES: [number, number][] = [
  [32, 32],
  [64, 64],
  [128, 128],
  [128, 192],
  [256, 256],
];
const spare: Slot[][] = SIZES.map(() => []);
/**
 * 每档最多留几张闲着的（多的直接销毁）。小的多留：雷公鞭一道闪电的每一段、每个落点的电弧都各占几张，
 * 几道叠在一起时同时借出去五六十张小的，留少了就会一边还一边销毁、一边借一边新建（每张新建都要在 GPU 上开一张贴图）。
 * 全留满也就九兆左右。
 */
const KEEP = [96, 64, 32, 24, 12];

function make(w: number, h: number, size: number): Slot {
  const bytes = new Uint8Array(w * h * 4);
  const src = new BufferImageSource({ resource: bytes, width: w, height: h, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'nearest' });
  return { tex: new Texture({ source: src }), px: new Uint32Array(bytes.buffer), stride: w, w, h, src, size, used: 0, onGpu: 0 };
}

/** 借一张至少 w × h 的贴图，像素缓冲是清空的。画完调 commitScratch，不用了调 returnScratch。 */
export function borrowScratch(w: number, h: number): Scratch {
  const size = SIZES.findIndex(([sw, sh]) => w <= sw && h <= sh);
  if (size < 0) return make(w, h, -1); // 比最大的一档还大（很少见）：单独建一张，还的时候销毁
  const s = spare[size].pop() ?? make(SIZES[size][0], SIZES[size][1], size);
  if (s.used > 0) s.px.fill(0, 0, s.used * s.stride);
  s.used = 0;
  return s;
}

/** 画完了：把画过的前 rows 行传上去（默认整张）。上一位留在 GPU 上的旧内容比这多的话，多出来的那几行也一并传（是清空了的）。 */
export function commitScratch(scratch: Scratch, rows = scratch.h) {
  const s = scratch as Slot;
  s.used = Math.max(s.used, Math.min(s.h, rows));
  s.src.update(0, Math.max(s.used, s.onGpu) * s.stride);
  s.onGpu = s.used;
}

/** 用完了：还回来（用它的精灵要先销毁或换掉贴图）。 */
export function returnScratch(scratch: Scratch) {
  const s = scratch as Slot;
  if (s.size >= 0 && spare[s.size].length < KEEP[s.size]) spare[s.size].push(s);
  else s.tex.destroy(true);
}
