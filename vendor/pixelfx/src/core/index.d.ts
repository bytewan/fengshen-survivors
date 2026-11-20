// pixelfx 核心的类型声明（给 TypeScript 用）。只写了游戏里用到的部分；库本身是无依赖的 ESM JavaScript。
// 上游：https://github.com/patch-gg/pixelfx（MIT），见 ../../ORIGIN.md。

/** 一帧画布：w × h 像素，左上角在世界坐标 (ox, oy)。color 是不透明 / 抖动 / 半透明的像素，light 是叠加的辉光。 */
export interface FxFrame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  color: Uint32Array;
  light: Uint32Array;
}

/** 特效的元数据（每个特效文件导出的 meta）。size 是画布大小，origin 是原点（通常是脚下）在画布里的位置。 */
export interface FxMeta {
  name: string;
  desc?: string;
  tags?: string[];
  size: [number, number];
  origin: [number, number];
  duration?: number;
  loop?: boolean;
  fps?: number;
  bg?: string;
  options?: Record<string, unknown>;
  actor?: number;
}

/** 一个特效模块（src/fx/<分类>/<名字>.js 的整个导出）。 */
export interface FxModule {
  meta: FxMeta;
  create?: (o: Record<string, unknown>) => unknown;
  draw?: (...args: never[]) => void;
  drawBack?: (...args: never[]) => void;
  act?: unknown;
}

/** 特效的选项：位置、朝向、种子、调色板（暗 → 亮的一串十六进制色）、辉光强度，再加每个特效自己的旋钮（meta.options）。 */
export interface FxOptions {
  x?: number;
  y?: number;
  flip?: boolean;
  angle?: number;
  seed?: number;
  palette?: string[];
  light?: number;
  [k: string]: unknown;
}

/** 一个正在播的特效实例。options 就是创建时合并好的选项对象，改 x / y 可以让它跟着东西走。 */
export interface FxInstance {
  readonly meta: FxMeta;
  readonly options: FxOptions;
  readonly t: number;
  update(dt: number): void;
  draw(frame: FxFrame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}

export function createFrame(w: number, h: number, ox?: number, oy?: number): FxFrame;
export function clearFrame(f: FxFrame): FxFrame;
export function createFx(mod: FxModule, o?: FxOptions): FxInstance;
/** 把 color 和 light 合成成 RGBA 字节（w × h × 4）。bg 为 null 时输出透明底。 */
export function composite<T extends Uint8Array | Uint8ClampedArray>(f: FxFrame, out: T, bg?: number | Uint32Array | null, lightK?: number): T;
/** 库自带的调色板（暗 → 亮）。 */
export const PAL: Record<string, string[]>;
/** 把一串颜色重采样成 n 档。 */
export function fit(ramp: (string | number)[], n: number): number[];
export function toHex(c: number): string;
