// 把手写的像素网格变成 DOM 里能用的图片地址（data URL），按网格内容缓存。
//
// 界面（DOM）不再跟着画布按同一个整数倍放大：画布按 16:9 铺满窗口，放大倍数可以是任意小数。
// 所以像素图在界面里「固定按整数倍显示」：这里只出 1 倍原图，显示尺寸 = 网格大小 × pixelUnit()，
// pixelUnit() 给出的每个美术像素正好是整数个设备像素，再配上 CSS image-rendering: pixelated，
// 每个像素一样大、边缘清楚，和画布当前的倍数无关。
import { compose, toRgba, type Grid } from '../art/pixel.ts';

const cache = new Map<string, string>();

/** 一张网格的 PNG data URL（1 倍原图）。 */
export function gridUrl(g: Grid): string {
  const key = g.rows.join('\n');
  let url = cache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = g.w;
    c.height = g.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(g.w, g.h);
    img.data.set(toRgba(g));
    ctx.putImageData(img, 0, 0);
    url = c.toDataURL('image/png');
    cache.set(key, url);
  }
  return url;
}

/** 几帧并排拼成一条（做 CSS 逐帧动画用）。 */
export function stripUrl(frames: Grid[]): { url: string; w: number; h: number } {
  const w = Math.max(...frames.map((f) => f.w));
  const h = Math.max(...frames.map((f) => f.h));
  const g = compose(
    w * frames.length,
    h,
    frames.map((f, i) => ({ g: f, x: i * w, y: 0 })),
  );
  return { url: gridUrl(g), w, h };
}

/**
 * 一个美术像素在页面上占多少 CSS 像素：最接近 want、并且正好是整数个设备像素的值。
 * 像素图按「网格大小 × 这个值」显示，就是整数倍的最近邻放大（高分屏、浏览器缩放、非整数的设备像素比都成立）。
 */
export function pixelUnit(want: number, dpr = window.devicePixelRatio || 1): number {
  return Math.max(1, Math.round(want * dpr)) / dpr;
}
