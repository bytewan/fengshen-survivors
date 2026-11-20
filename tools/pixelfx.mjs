// pixelfx 的游戏侧入口（在仓库根目录跑）：按修仙配色渲染、检查、搜索特效。
// 库自己的工具在 vendor/pixelfx/tools/（只用 Node 自带模块），这里只是转一道手，把 XFX 预设的选项带上。
//
//   node tools/pixelfx.mjs list <词>…                     搜特效（id、名字、标签、描述）
//   node tools/pixelfx.mjs render <预设名|id>… [--raw]     连拍图 → scratch/pfx/records/<预设名或 id>/…/contact.png
//                                                          预设名用 XFX 里的修仙配色；--raw 用库的原配色；其它参数原样交给 render.mjs
//                                                          （--opts '<json>' 覆盖选项、--all 每一帧、--gif 动图）
//   node tools/pixelfx.mjs check [id…]                    检查画出界、没收干净、循环接缝、随机没用种子、单帧太慢（默认查 xianxia 整个分类）
//   node tools/pixelfx.mjs presets                        列出修仙版预设
//   node tools/pixelfx.mjs stats [预设名…]                每个预设预烘焙成图集有多大（帧数、几张大图、占多少显存、画一次多久），
//                                                          用来决定哪些预烘焙、哪些现场画
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { XFX } from '../src/render/pixelfx-xianxia.ts';
import { bakeAtlas } from '../src/render/pixelfx-pack.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR = join(ROOT, 'vendor/pixelfx');
const [cmd, ...rest] = process.argv.slice(2);

const tool = (name, args) => spawnSync(process.execPath, [join(VENDOR, 'tools', name), ...args], { cwd: VENDOR, stdio: 'inherit' }).status ?? 1;

// render.mjs 的参数：这几个不带值，其余 --x 都带一个值
const BOOL = new Set(['gif', 'mp4', 'sheet', 'all', 'no-actor', 'raw']);
function parse(args) {
  const names = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) names.push(a);
    else if (BOOL.has(a.slice(2))) flags[a.slice(2)] = true;
    else flags[a.slice(2)] = args[++i];
  }
  return { names, flags };
}

if (cmd === 'list') process.exit(tool('list.mjs', rest));
if (cmd === 'check') process.exit(tool('check.mjs', rest.length ? rest : ['xianxia']));
if (cmd === 'presets') {
  for (const [k, v] of Object.entries(XFX)) console.log(`${k.padEnd(14)} ${v.id.padEnd(28)} ${v.note}`);
  process.exit(0);
}
if (cmd === 'stats') {
  const names = rest.length ? rest : Object.keys(XFX);
  let total = 0;
  console.log('预设'.padEnd(14), '画布'.padEnd(9), '帧'.padStart(4), '大图'.padStart(4), '图集'.padStart(9), '不裁'.padStart(9), '画一次'.padStart(8), ' 循环');
  for (const n of names) {
    const p = XFX[n];
    if (!p) {
      console.error(`没有这个预设：${n}`);
      process.exitCode = 1;
      continue;
    }
    const mod = await import(pathToFileURL(join(VENDOR, 'src/fx', `${p.id}.js`)).href);
    const t0 = performance.now();
    const a = bakeAtlas(mod, p.opts);
    const ms = performance.now() - t0;
    total += a.pixels * 4;
    const mb = (v) => `${(v / 1048576).toFixed(2)} MB`;
    console.log(n.padEnd(16), `${a.w}×${a.h}`.padEnd(11), String(a.frames.length).padStart(4), String(a.pages.length).padStart(5), mb(a.pixels * 4).padStart(11), mb(a.frames.length * a.w * a.h * 4).padStart(11), `${ms.toFixed(0)} 毫秒`.padStart(10), a.loop ? '  是' : '  否');
  }
  console.log(`合计 ${(total / 1048576).toFixed(2)} MB（按 Node 里的耗时，浏览器里差不多；在开局载入时预先画）`);
  process.exit();
}
if (cmd === 'render') {
  const { names, flags } = parse(rest);
  if (!names.length) {
    console.error('用法：node tools/pixelfx.mjs render <预设名|id>… [--raw] [--opts <json>] [--all] [--gif]');
    process.exit(1);
  }
  let failed = 0;
  for (const n of names) {
    const p = XFX[n];
    const id = p ? p.id : n;
    const opts = flags.opts ? JSON.parse(flags.opts) : p && !flags.raw ? p.opts : undefined;
    const out = flags.out ? resolve(flags.out) : join(ROOT, 'scratch/pfx/records', flags.raw ? 'raw' : '', p ? n : '');
    const args = [id, '--out', out];
    for (const [k, v] of Object.entries(flags)) {
      if (k === 'raw' || k === 'opts' || k === 'out') continue;
      args.push(`--${k}`);
      if (v !== true) args.push(v);
    }
    if (opts) args.push('--opts', JSON.stringify(opts));
    failed += tool('render.mjs', args) ? 1 : 0;
  }
  process.exit(failed ? 1 : 0);
}
console.error('用法：node tools/pixelfx.mjs list|render|check|presets|stats …（见文件头）');
process.exit(1);
