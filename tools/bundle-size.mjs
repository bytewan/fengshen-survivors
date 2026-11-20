// 包体积：量 dist/（先 npm run build）里各类文件多大，以及打开页面时实际下载了哪些文件。
//
//   node tools/bundle-size.mjs                 只量 dist/：按类别（脚本 / 样式 / 页面 / 字体 / 音频 / 图片 / 其他）合计原始、gzip、brotli 的大小
//   node tools/bundle-size.mjs --port 5242     再用 Playwright 打开预览服务器（先开着 npx vite preview --port 5242 --strictPort），量：
//                                              ① 首屏：打开 /，标题页的按钮出来之前下了哪些文件；①′ 标题页出来之后在后台预载的；
//                                              ② 进一局（另开一个没有缓存的页面打开 ?bot，等 __feel 有了再过几秒）下了哪些——减去 ①①′ 就是进局时还要现下的
//   --list                                     把每个文件列出来（默认只列合计和最大的几个）
//   --json                                     输出 JSON（给别的脚本比较用）
//
// 「传输大小」按服务器开了 gzip 估（docs/deploy.md 里的 nginx / Caddy 样例都开着）：脚本、样式、页面、JSON、SVG、文本按 gzip -6 算；
// 字体（woff2）、音频（m4a）、PNG / WebP 本来就是压缩过的，按原始大小算。brotli 只在 dist/ 合计里列出来参考。
// 音频要等玩家第一次点击（解锁声音）之后才开始下（src/audio/player.ts），所以 ①② 里都没有，看 dist/ 合计里的「音频」。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = arg('--port', null);
const JSON_OUT = args.includes('--json');
const LIST = args.includes('--list');
const DIST = path.resolve(arg('--dist', 'dist'));

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`没有 ${DIST}/index.html：先跑 npm run build`);
  process.exit(1);
}

const KIND = { js: '脚本', mjs: '脚本', css: '样式', html: '页面', woff2: '字体', woff: '字体', ttf: '字体', m4a: '音频', mp3: '音频', ogg: '音频', png: '图片', webp: '图片', svg: '图片', jpg: '图片', json: '其他', txt: '其他', webmanifest: '其他', ico: '图片' };
const PRECOMPRESSED = new Set(['woff2', 'woff', 'm4a', 'mp3', 'ogg', 'png', 'webp', 'jpg', 'ico']);
const kindOf = (f) => KIND[path.extname(f).slice(1).toLowerCase()] ?? '其他';

const cache = new Map();
/** 一个 dist 里的文件：原始、gzip、brotli 字节数，以及「按服务器开 gzip 估的传输大小」。 */
function sizes(rel) {
  let s = cache.get(rel);
  if (s) return s;
  const buf = fs.readFileSync(path.join(DIST, rel));
  const ext = path.extname(rel).slice(1).toLowerCase();
  const pre = PRECOMPRESSED.has(ext);
  const gz = pre ? buf.length : zlib.gzipSync(buf, { level: 6 }).length;
  const br = pre ? buf.length : zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  s = { file: rel, kind: kindOf(rel), raw: buf.length, gz, br, wire: gz };
  cache.set(rel, s);
  return s;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(DIST, p).split(path.sep).join('/'));
  }
  return out;
}

const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0).padStart(7) + ' KB';
function sum(list) {
  const t = { n: list.length, raw: 0, gz: 0, br: 0, wire: 0 };
  for (const s of list) {
    t.raw += s.raw;
    t.gz += s.gz;
    t.br += s.br;
    t.wire += s.wire;
  }
  return t;
}
function byKind(list) {
  const groups = {};
  for (const s of list) (groups[s.kind] ??= []).push(s);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, sum(v)]));
}
function printTable(title, list, { top = 6 } = {}) {
  console.log(`\n${title}`);
  const kinds = byKind(list);
  console.log('  类别        个数        原始        gzip      brotli');
  for (const [k, t] of Object.entries(kinds).sort((a, b) => b[1].raw - a[1].raw)) console.log(`  ${k.padEnd(6, '　')}${String(t.n).padStart(6)} ${kb(t.raw)} ${kb(t.gz)} ${kb(t.br)}`);
  const all = sum(list);
  console.log(`  合计　　　${String(all.n).padStart(6)} ${kb(all.raw)} ${kb(all.gz)} ${kb(all.br)}`);
  const sorted = [...list].sort((a, b) => b.raw - a.raw);
  const shown = LIST ? sorted : sorted.slice(0, top);
  if (shown.length) console.log(LIST ? '  文件：' : `  最大的 ${shown.length} 个：`);
  for (const s of shown) console.log(`   ${kb(s.raw)}（gzip ${kb(s.gz).trim()}）  ${s.file}`);
}

const report = {};
const distFiles = walk(DIST).map(sizes);
report.dist = { total: sum(distFiles), byKind: byKind(distFiles) };
if (!JSON_OUT) printTable(`dist/ 全部（${DIST}）`, distFiles);

// ---------- 实际打开页面时下载了什么 ----------
/** 打开 url，等 until 返回（那一刻记作「出来了」），再等网络静下来、多等 settle 毫秒。返回每个文件和它是不是在「出来了」之前就开始下的。 */
async function loads(browser, url, until, settle = 1500) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const started = new Map();
  const got = new Map();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => started.has(r.url()) || started.set(r.url(), Date.now()));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.port !== String(PORT) || r.status() >= 400) return;
    let rel = decodeURIComponent(u.pathname).replace(/^\//, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (fs.existsSync(path.join(DIST, rel))) got.set(rel, { ...sizes(rel), at: started.get(r.url()) ?? Date.now() });
  });
  // 只等到开始收页面（commit）：标题页一画出来后台预载就开始了（src/game/preload.ts），等 load 事件会把预载的文件也算进首屏
  await page.goto(url, { waitUntil: 'commit' });
  await until(page);
  const shown = Date.now();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(settle);
  await page.waitForLoadState('networkidle');
  // 页面里有 fs-title 这个标记（src/main.ts：标题页挂上的那一刻）就按它分：在它之前开始下的算首屏。没有就按上面「出来了」的时刻
  const mark = await page.evaluate(() => {
    const m = performance.getEntriesByName('fs-title')[0];
    return m ? { t: m.startTime, res: performance.getEntriesByType('resource').map((e) => [decodeURIComponent(new URL(e.name).pathname).replace(/^\//, ''), e.startTime]) } : null;
  });
  await ctx.close();
  const files = [...got.values()];
  if (mark) {
    const early = new Set(mark.res.filter(([, t]) => t <= mark.t).map(([f]) => f));
    early.add('index.html');
    return { files, before: files.filter((f) => early.has(f.file)), after: files.filter((f) => !early.has(f.file)), errors };
  }
  return { files, before: files.filter((f) => f.at <= shown), after: files.filter((f) => f.at > shown), errors };
}

if (PORT) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const base = `http://localhost:${PORT}`;
  try {
    // 标题页：按钮出来就算「出来了」；之后多等 6 秒，把标题页出来之后后台预载的（字体、选角、战斗、大厅……）也收进来
    const title = await loads(browser, `${base}/`, (p) => p.waitForSelector('#fs-front .title button', { state: 'attached', timeout: 30000 }).catch(() => p.waitForTimeout(4000)), 6000);
    const game = await loads(browser, `${base}/?bot`, async (p) => {
      await p.waitForFunction(() => window.__feel !== undefined, null, { timeout: 60000 });
      await p.waitForTimeout(4000);
    });
    const seen = new Set(title.files.map((s) => s.file));
    const extra = game.files.filter((s) => !seen.has(s.file));
    report.title = { total: sum(title.before), byKind: byKind(title.before), files: title.before.map((s) => s.file), errors: title.errors };
    report.prefetch = { total: sum(title.after), byKind: byKind(title.after), files: title.after.map((s) => s.file) };
    report.game = { total: sum(game.files), extra: sum(extra), extraFiles: extra.map((s) => s.file), errors: game.errors };
    if (!JSON_OUT) {
      printTable('① 首屏：标题页出来之前要下的（没有缓存）', title.before, { top: 8 });
      printTable('①′ 标题页出来之后在后台预载的（玩家看着标题页时下，点进选角、进局时多半已经好了）', title.after, { top: 8 });
      printTable('② 打开 ?bot 直接进一局下载的（没有缓存）', game.files, { top: 0 });
      printTable('  其中 ①、①′ 里都没有的（从标题页进局时还要现下的）', extra, { top: 8 });
      for (const [k, v] of [['标题页', title.errors], ['进局', game.errors]]) if (v.length) console.log(`\n${k}的页面报错：`, v);
    }
  } finally {
    await browser.close();
  }
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 1));
