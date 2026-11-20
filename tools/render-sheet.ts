// 把精灵帧拼成对照图，输出 PNG 供自查：
//   上半：每帧放大 8 倍，深色地面底；下半：同一组帧按游戏里的 4 倍放大并排，看真实观感。
// 用法：node tools/render-sheet.ts <name> [out.png]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { toRgba, type Grid } from '../src/art/pixel.ts';
import { hexToRgba, PALETTE } from '../src/art/palette.ts';
import { SHEETS } from '../src/art/sprites/index.ts';
import { Canvas, encodePng } from './png.ts';

const name = process.argv[2] ?? 'nezha';
const out = process.argv[3] ?? `scratch/sheet-${name}.png`;
const sheet = SHEETS[name];
if (!sheet) {
  console.error(`unknown sheet '${name}', have: ${Object.keys(SHEETS).join(', ')}`);
  process.exit(2);
}
const frames: { label: string; g: Grid }[] = sheet.frames;
const bg = hexToRgba(PALETTE[sheet.bg ?? 'g']).slice(0, 3) as [number, number, number];
const BIG = sheet.big ?? 8;
const PAD = 2;
const fw = Math.max(...frames.map((f) => f.g.w));
const fh = Math.max(...frames.map((f) => f.g.h));
const cols = Math.min(frames.length, sheet.cols ?? 6);
const rows = Math.ceil(frames.length / cols);

// 先在 1 倍画布上排版，最后统一放大
const cw = cols * (fw + PAD) + PAD;
const ch = rows * (fh + PAD) + PAD;
const big = new Canvas(cw, ch, bg);
frames.forEach((f, i) => {
  const x = PAD + (i % cols) * (fw + PAD);
  const y = PAD + Math.floor(i / cols) * (fh + PAD);
  big.blit(toRgba(f.g), f.g.w, f.g.h, x, y);
});
const B = big.scaled(BIG);

// 游戏里的观感：4 倍，紧挨着排成一行
const strip = new Canvas(frames.length * (fw + 4) + 4, fh + 8, bg);
frames.forEach((f, i) => strip.blit(toRgba(f.g), f.g.w, f.g.h, 4 + i * (fw + 4), 4));
const S = strip.scaled(4);

const W = Math.max(B.w, S.w);
const final = new Canvas(W, B.h + S.h + 8, [16, 12, 18]);
final.blit(B.data, B.w, B.h, 0, 0);
final.blit(S.data, S.w, S.h, 0, B.h + 8);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, encodePng(final.w, final.h, final.data));
console.log(`wrote ${out} (${final.w}×${final.h}) frames=${frames.map((f) => f.label).join(',')}`);
