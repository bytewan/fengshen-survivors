// 手感原型自查：用机器人模式（?bot）跑一局，在几个关键时刻截图，记录帧率、敌人数、粒子数和控制台报错。
// 用法：node tools/shot-feel.mjs [url] [outDir] [seconds]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5180/?bot';
const out = process.argv[3] ?? 'scratch/feel';
const total = Number(process.argv[4] ?? 50);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__feel !== undefined, null, { timeout: 15000 });

// 等到某个游戏时间（秒）
const at = async (t) => page.waitForFunction((t) => window.__feel.world.time >= t || !window.__feel.world.players[0].alive, t, { timeout: 120000, polling: 100 });
const shots = [8, 21.5, 30, 45];
const log = [];
for (const t of shots) {
  if (t > total) break;
  await at(t);
  const s = await page.evaluate(() => window.__feel.stats());
  log.push({ at: t, ...s });
  await page.screenshot({ path: `${out}/t${String(t).replace('.', '_')}.png` });
  if (!s.hp || s.hp <= 0) break;
}
// 等神通出手的那一刻截一张
const skillsBefore = (await page.evaluate(() => window.__feel.stats())).skills;
const skillShot = await page
  .waitForFunction((n) => window.__feel.stats().skills > n, skillsBefore, { timeout: 60000, polling: 16 })
  .then(async () => {
    await page.waitForTimeout(60);
    await page.screenshot({ path: `${out}/skill.png` });
    return true;
  })
  .catch(() => false);
console.log(JSON.stringify({ log, skillShot, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
