// 生产预览：标题可见后，大厅不需要再下载脚本，也不等待完整字体。
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.GAME_TEST_URL ?? 'http://localhost:5182/fengshen-survivors';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/fonts/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 12000));
    await route.continue().catch(() => {});
  });
  await page.goto(base + '/?title', { waitUntil: 'domcontentloaded' });
  await page.locator('button.ink', { hasText: '联机', exact: true }).waitFor();
  // 首屏代码都已到达；此后任何新脚本请求都保持挂起。
  await page.route('**/assets/*.js', () => new Promise(() => {}));
  const start = Date.now();
  await page.locator('button.ink', { hasText: '联机', exact: true }).click();
  await page.locator('button.ink', { hasText: '建房', exact: true }).waitFor({ timeout: 5000 });
  assert.ok(Date.now() - start < 4000, '大厅应直接打开，不等待额外脚本或字体');
  assert.equal(await page.locator('[data-loading-status]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS 首屏就绪后无需额外脚本或完整字体即可打开大厅', Date.now() - start, 'ms');
} finally { await browser.close(); }
