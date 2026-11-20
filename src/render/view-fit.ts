// 画面的尺寸，以及它在窗口里怎么摆。不依赖 Pixi 和 DOM（窗口大小可以当参数传进来），方便单独测。

export const VIEW_W = 480;
export const VIEW_H = 270;
/** 画布后备缓冲最多放大几倍（6 倍是 2880×1620，再大只是白占显存）。 */
export const MAX_UPSCALE = 6;
/**
 * 低画质（quality.ts）：后备缓冲只放大到「不超过需要的」整数倍（向下取整，至少 1），剩下的由浏览器放大——
 * 显卡每帧要填的像素少三成多，像素边上略软一点。高画质（默认）是向上取整，和原来一样。
 */
let lowRes = false;
export function setLowRes(v: boolean) {
  lowRes = v;
}

export interface ViewFit {
  /** 画布显示出来的大小（CSS 像素）：按 16:9 尽量铺满窗口，对齐到整数个物理像素。 */
  cssW: number;
  cssH: number;
  /** 画布后备缓冲的放大倍数：canvas.width / height = 480r × 270r。 */
  r: number;
  /** 一个游戏像素最后占几个物理像素（一般不是整数）。等于 r 时画面是 1:1，完全清晰。 */
  scale: number;
}

/**
 * 画面按 16:9 尽量铺满窗口，不限定整数倍（原来按整数倍取，手机上只用了一半到七成屏幕）。
 *
 * 像素画直接按非整数倍拉伸，像素会大小不匀、一动就闪。所以分两步：场景先 1:1 画进 480×270 的贴图，
 * 按整数倍 r（刚好不小于需要的倍数，最少 1、最多 6）最近邻放大到画布的后备缓冲，
 * 剩下那一点缩小交给浏览器平滑地做（画布的 image-rendering 不能是 pixelated）——每个游戏像素一样大。
 * 需要的倍数正好是整数时 r 就等于它，画面 1:1。
 */
export function viewFit(winW: number, winH: number, dpr: number): ViewFit {
  let scale = Math.min(winW / VIEW_W, winH / VIEW_H) * dpr;
  // 只比整数倍多出一点点（不到千分之五）时就取整数倍：四周多空出一两个像素，换来完全清晰
  const n = Math.floor(scale + 1e-6);
  if (n >= 1 && scale - n < n * 0.005) scale = n;
  const r = Math.min(MAX_UPSCALE, Math.max(1, lowRes ? Math.floor(scale + 1e-6) : Math.ceil(scale - 1e-6)));
  const cssW = Math.max(1, Math.floor(VIEW_W * scale + 1e-6)) / dpr;
  const cssH = Math.max(1, Math.floor(VIEW_H * scale + 1e-6)) / dpr;
  return { cssW, cssH, r, scale };
}
