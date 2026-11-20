// 最小 PNG 编码器（RGBA8，无滤波），只给 Node 工具用。
import { deflateSync, crc32 } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePng(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 简单的 RGBA 画布：铺底色、贴图（alpha 0/255）、最近邻放大。 */
export class Canvas {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: [number, number, number] = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set([bg[0], bg[1], bg[2], 255], i * 4);
  }
  rect(x: number, y: number, w: number, h: number, c: [number, number, number]) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.data.set([c[0], c[1], c[2], 255], (j * this.w + i) * 4);
  }
  blit(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number) {
    for (let j = 0; j < sh; j++)
      for (let i = 0; i < sw; i++) {
        const a = src[(j * sw + i) * 4 + 3];
        if (!a) continue;
        const X = x + i;
        const Y = y + j;
        if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
        this.data.set(src.subarray((j * sw + i) * 4, (j * sw + i) * 4 + 4), (Y * this.w + X) * 4);
      }
  }
  scaled(s: number): { w: number; h: number; data: Uint8ClampedArray } {
    const w = this.w * s;
    const h = this.h * s;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const si = (((y / s) | 0) * this.w + ((x / s) | 0)) * 4;
        out.set(this.data.subarray(si, si + 4), (y * w + x) * 4);
      }
    return { w, h, data: out };
  }
}
