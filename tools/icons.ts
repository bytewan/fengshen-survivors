// 「添加到主屏幕」的图标和网页图标：游戏里哪吒待机的第一帧（src/art/sprites/nezha.ts），按整数倍放大、摆在黛色的底上。
// 用户口径（2026-11-11 任务）：图标用游戏里现成的像素画放大，不另找、不另画。整数倍放大，像素是方的，不糊。
//
// 用法：node tools/icons.ts      → public/icons/*.png（改了哪吒的样子之后重跑一次；manifest 在 public/manifest.webmanifest）
//
// - icon-*.png（purpose any）：画面占边长的约八成，四边留一样的空。
// - maskable-*.png（purpose maskable）：安卓会把图标裁成圆形、圆角方形等，只保证中间直径八成的圆里不被裁——
//   哪吒每个不透明像素的四个角都落在这个圆里（再留一点余量）。
// - apple-touch-icon.png（180）：iPhone / iPad「添加到主屏幕」用，系统自己加圆角，内容别贴边。
// - favicon-32.png：浏览器标签上的小图标，原尺寸一倍（32×31 的帧正好放得下）。
import { mkdir, writeFile } from 'node:fs/promises';
import { toRgba } from '../src/art/pixel.ts';
import { hexToRgba, PALETTE } from '../src/art/palette.ts';
import { NEZHA_FRAMES } from '../src/art/sprites/nezha.ts';
import { encodePng } from './png.ts';

const OUT = 'public/icons';
const BG = hexToRgba(PALETTE.g); // 黛：和美术对照图、人物精灵描边配得上的中间偏暗的紫灰（不是黑底）
const frame = NEZHA_FRAMES.idle[0];
const src = toRgba(frame);

// 不透明像素的外框
let x0 = frame.w;
let y0 = frame.h;
let x1 = -1;
let y1 = -1;
for (let y = 0; y < frame.h; y++)
  for (let x = 0; x < frame.w; x++)
    if (src[(y * frame.w + x) * 4 + 3]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;

/** 放大 k 倍、外框居中时，离图标中心最远的不透明像素角有多远（像素）。 */
function reach(size: number, k: number): number {
  const ox = Math.round((size - cw * k) / 2);
  const oy = Math.round((size - ch * k) / 2);
  let r = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!src[(y * frame.w + x) * 4 + 3]) continue;
      for (const [cx, cy] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ]) {
        const px = ox + (cx - x0) * k - size / 2;
        const py = oy + (cy - y0) * k - size / 2;
        r = Math.max(r, Math.hypot(px, py));
      }
    }
  return r;
}

type Mode = 'any' | 'maskable' | 'apple' | 'tiny';

function render(size: number, mode: Mode): Buffer {
  let k = 1;
  if (mode === 'any') while (Math.max(cw, ch) * (k + 1) <= size * 0.8) k++;
  if (mode === 'apple') while (Math.max(cw, ch) * (k + 1) <= size * 0.82) k++; // 系统的圆角只削掉四个角，可以比 any 稍满一点
  if (mode === 'maskable') while (reach(size, k + 1) <= size * 0.38) k++;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) out.set(BG, i * 4);
  const ox = Math.round((size - cw * k) / 2);
  const oy = Math.round((size - ch * k) / 2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const si = (y * frame.w + x) * 4;
      if (!src[si + 3]) continue;
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          const X = ox + (x - x0) * k + i;
          const Y = oy + (y - y0) * k + j;
          if (X >= 0 && Y >= 0 && X < size && Y < size) out.set(src.subarray(si, si + 4), (Y * size + X) * 4);
        }
    }
  console.log(`  ${String(size).padStart(3)}×${size} ${mode.padEnd(8)} 放大 ${k} 倍，哪吒 ${cw * k}×${ch * k}`);
  return encodePng(size, size, out);
}

await mkdir(OUT, { recursive: true });
const jobs: [string, number, Mode][] = [
  ['icon-192.png', 192, 'any'],
  ['icon-512.png', 512, 'any'],
  ['maskable-192.png', 192, 'maskable'],
  ['maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'apple'],
  ['favicon-32.png', 32, 'tiny'],
];
console.log(`哪吒待机第一帧：外框 ${cw}×${ch}（帧 ${frame.w}×${frame.h}）`);
for (const [name, size, mode] of jobs) await writeFile(`${OUT}/${name}`, render(size, mode));
console.log(`写到 ${OUT}/`);
