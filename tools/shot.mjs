// 自查截图：电脑（1920×1080）和手机横屏（844×390，DPR 3）两种尺寸，顺带收集控制台报错。
// 用法：node tools/shot.mjs [url] [outDir]
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5180/';
const only = process.env.ONLY ?? '';
const out = process.argv[3] ?? 'scratch/shots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const run = async (name, ctxOpts, script) => {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__trial !== undefined, null, { timeout: 15000 });
  await script(page, async (tag) => page.screenshot({ path: `${out}/${name}-${tag}.png` }));
  await ctx.close();
};

const hold = async (page, key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

if (!only || only === 'desktop') await run('desktop', { viewport: { width: 1920, height: 1080 } }, async (page, shot) => {
  await page.waitForTimeout(1500);
  await shot('idle');
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await shot('move');
  await page.screenshot({ path: `${out}/desktop-move-closeup.png`, clip: { x: 960 - 200, y: 540 - 130, width: 400, height: 225 } });
  await page.keyboard.up('d');
  await hold(page, 's', 500);
  await page.waitForTimeout(900);
  await shot('later');
  await hold(page, 's', 3600);
  await hold(page, 'a', 1500);
  await page.waitForTimeout(400);
  await shot('edge');
});

if (!only || only === 'phone') await run('phone', { ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }, async (page, shot) => {
  await page.waitForTimeout(1500);
  await shot('idle');
  await hold(page, 'a', 800);
  await shot('move');
});

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
