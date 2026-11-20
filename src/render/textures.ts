// 把手写的像素网格和程序生成的位图变成 Pixi 纹理。一律最近邻采样。
//
// 纹理直接用 RGBA 缓冲建（BufferImageSource），不经过 canvas、也不走 Texture.from：
// Texture.from(canvas) 会把每张画布登记进 Pixi 的全局 Cache，纹理不销毁就永远留着，开一局涨几百张（约 30 MB 画布）。
// 这里建的纹理没有任何全局登记，没人用了就能回收。
// 同一张网格（同一个对象）再要纹理时给回同一张，所以写成模块常量的精灵整个会话只建一次；
// 程序生成的大图（地面、魔气……）用 once() 按 key 记住。
import { BufferImageSource, Rectangle, Texture } from 'pixi.js';
import type { Grid } from '../art/pixel.ts';
import type { Bitmap } from '../art/ground.ts';
import { PAL32 } from './pixel-raster.ts';

export { PAL32 } from './pixel-raster.ts';

const WHITE32 = 0xffffffff;

/**
 * 预乘透明度，返回一份新的缓冲（不动传进来的）。取整方式和浏览器的 canvas 一样（四舍五入），
 * 所以和原来「先画进 canvas 再上传」得到的纹理逐字节相同。
 */
export function premultiply(data: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    if (a === 255) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = 255;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const p = data[i + c] * a + 128;
      out[i + c] = (p + (p >> 8)) >> 8;
    }
    out[i + 3] = a;
  }
  return out;
}

/** 用一块已经预乘好的 RGBA 缓冲建纹理（缓冲归纹理所有，之后不要再改它）。 */
export function textureFromRgba(w: number, h: number, rgba: Uint8Array): Texture {
  return new Texture({ source: new BufferImageSource({ resource: rgba, width: w, height: h, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'nearest' }) });
}

export function textureFromBitmap(b: Bitmap): Texture {
  return textureFromRgba(b.w, b.h, premultiply(b.data));
}

/** 网格 → RGBA 缓冲（调色板颜色都不透明，预乘与否一样）。flash：有色的像素全换成白（受击闪白的剪影）。 */
function gridRgba(g: Grid, flash: boolean): Uint8Array {
  const out = new Uint32Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    const row = g.rows[y];
    for (let x = 0; x < g.w; x++) {
      const code = row.charCodeAt(x);
      if (code === 46 || code === 32) continue; // '.'、空格：透明
      const v = code < 128 ? PAL32[code] : 0;
      if (!v) throw new Error(`unknown palette char '${row[x]}' at ${x},${y}`);
      out[y * g.w + x] = flash ? WHITE32 : v;
    }
  }
  return new Uint8Array(out.buffer);
}

const gridTex = new WeakMap<Grid, Texture>();
const flashTex = new WeakMap<Grid, Texture>();

/** 网格 → 纹理。同一个网格对象只建一次（纹理被销毁了就重建）。 */
export function textureFromGrid(g: Grid): Texture {
  let t = gridTex.get(g);
  if (!t || t.destroyed) {
    t = textureFromRgba(g.w, g.h, gridRgba(g, false));
    gridTex.set(g, t);
  }
  return t;
}

/** 纯白剪影，用于受击闪白。 */
export function flashTextureFromGrid(g: Grid): Texture {
  let t = flashTex.get(g);
  if (!t || t.destroyed) {
    t = textureFromRgba(g.w, g.h, gridRgba(g, true));
    flashTex.set(g, t);
  }
  return t;
}

/**
 * 几张网格排进同一张纹理（一张底图，横着排，中间空一列），各给一张子纹理。
 * 给 ParticleContainer 用：一层粒子只能用同一张底图，换帧只是换子纹理（docs/perf.md）。同一个 key 整个会话只建一次。
 */
export function atlasFromGrids(key: string, gs: Grid[]): Texture[] {
  return once(`atlas:${key}`, () => {
    const W = gs.reduce((a, g) => a + g.w + 1, -1);
    const H = Math.max(...gs.map((g) => g.h));
    const out = new Uint32Array(W * H);
    const frames: Rectangle[] = [];
    let x0 = 0;
    for (const g of gs) {
      const px = new Uint32Array(gridRgba(g, false).buffer);
      for (let y = 0; y < g.h; y++) out.set(px.subarray(y * g.w, (y + 1) * g.w), y * W + x0);
      frames.push(new Rectangle(x0, 0, g.w, g.h));
      x0 += g.w + 1;
    }
    const source = new BufferImageSource({ resource: new Uint8Array(out.buffer), width: W, height: H, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', scaleMode: 'nearest' });
    return frames.map((frame) => new Texture({ source, frame }));
  });
}

const session = new Map<string, unknown>();
/**
 * 整个会话只算一次的东西（确定性的纹理、帧表……）：按 key 记住，下一局直接拿。
 * key 里要带上所有会影响结果的参数；拿到的纹理是共用的，不要销毁。
 */
export function once<T>(key: string, make: () => T): T {
  if (!session.has(key)) session.set(key, make());
  return session.get(key) as T;
}

/**
 * 分档的径向光斑（不是平滑渐变）：光的边缘一圈一圈地退，和像素画的硬边一致。
 * 返回白色光斑，颜色由 sprite.tint 决定。同样的参数给同一张。
 */
export function steppedLightTexture(radius: number, steps = 4): Texture {
  return once(`light:${radius}:${steps}`, () => {
    const size = radius * 2;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - radius, y + 0.5 - radius) / radius;
        if (d >= 1) continue;
        const band = Math.ceil((1 - d) * steps) / steps; // 1/steps … 1
        const a = Math.round(255 * band * band);
        data.set([255, 255, 255, a], (y * size + x) * 4);
      }
    return textureFromBitmap({ w: size, h: size, data });
  });
}

/**
 * 暗角底图：只压四个角，平滑过渡、不分档。
 * 分档的暗角是以屏幕中心为圆心的一圈圈等高线，而镜头跟着人物走，看上去就成了「人物身上的光圈」，
 * 用户明确不要（2026-11-09）。
 */
export function vignetteTexture(w: number, h: number, center: [number, number, number], edge: [number, number, number]): Texture {
  return once(`vignette:${w}x${h}:${center}:${edge}`, () => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2);
        const dy = (y - h / 2) / (h / 2);
        const d = Math.hypot(dx, dy) / Math.SQRT2; // 0 中心 … 1 四角
        const t = Math.max(0, (d - 0.62) / 0.38) ** 2;
        const c = center.map((v, i) => Math.round(v + (edge[i] - v) * t));
        data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
      }
    return textureFromBitmap({ w, h, data });
  });
}
