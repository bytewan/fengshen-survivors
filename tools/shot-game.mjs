// M1 骨架自查：机器人打几波，截战斗、商店、后期战斗；记录状态与控制台报错。
// 用法：node tools/shot-game.mjs [url] [outDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const url = process.argv[2] ?? 'http://localhost:5180/?bot';
const out = process.argv[3] ?? 'scratch/game';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__feel !== undefined, null, { timeout: 15000 });
const st = () => page.evaluate(() => window.__feel.stats());
const until = (fn, arg, ms = 240000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const log = [];
await until(() => window.__feel.world.waveT > 12);
await page.screenshot({ path: `${out}/wave1.png` });
log.push(await st());
await until(() => window.__feel.world.phase === 'shop');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/shop1.png` });
log.push(await st());
// 等到第 4 波战斗中
await until(() => window.__feel.world.wave >= 4 && window.__feel.world.phase === 'wave' && window.__feel.world.waveT > 15);
await page.screenshot({ path: `${out}/wave4.png` });
log.push(await st());
await until(() => window.__feel.world.wave >= 5 && window.__feel.world.phase === 'shop');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/shop5.png` });
log.push(await st());
await until(() => window.__feel.world.wave >= 6 && window.__feel.world.phase === 'wave' && window.__feel.world.waveT > 18).catch(() => {});
await page.screenshot({ path: `${out}/wave6.png` });
log.push(await st());
console.log(JSON.stringify({ log, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
