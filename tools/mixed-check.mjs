// 四浏览器：两名队友直连，一名队友中继；验证重复快照去重和四人商店。
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const c = await b.newContext(), base = 'https://bytewan.github.io/fengshen-survivors/';
  await c.grantPermissions(['local-network-access'], { origin: 'https://bytewan.github.io' });
  await c.route(base + '**', async r => {
    const f = path.resolve('dist', decodeURIComponent(new URL(r.request().url()).pathname.slice('/fengshen-survivors/'.length)) || 'index.html');
    if (!f.startsWith(path.resolve('dist') + path.sep)) return r.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };
    await r.fulfill({ body: await readFile(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
  await c.addInitScript(() => {
    const Native = WebSocket, property = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage');
    window.WebSocket = new Proxy(Native, { construct(Target, args) {
      const ws = new Target(...args);
      Object.defineProperty(ws, 'onmessage', { set(fn) { property.set.call(ws, e => {
        if (new URLSearchParams(location.search).has('nortc')) {
          try { if (JSON.parse(String(e.data).slice(String(e.data).indexOf('|') + 1)).t === 'rtc') return; } catch {}
        }
        fn.call(ws, e);
      }); }, get() { return property.get.call(ws); } }); return ws;
    } });
  });
  const h = await c.newPage(), guests = [await c.newPage(), await c.newPage(), await c.newPage()], errors = [];
  for (const p of [h, ...guests]) p.on('pageerror', e => errors.push(e.message));
  await h.goto(base + '?online&bot'); await h.locator('button.ink', { hasText: '建房', exact: true }).click();
  await h.locator('.code-big').waitFor(); const room = await h.locator('.code-big').textContent();
  for (const [i, p] of guests.entries()) {
    await p.goto(base + '?room=' + room + '&bot' + (i === 2 ? '&nortc=1' : ''));
    await p.locator('button.ink', { hasText: '准备', exact: true }).click();
  }
  await h.waitForFunction(() => [...document.querySelectorAll('button.ink')].some(b => b.textContent.trim() === '开始' && b.getAttribute('aria-disabled') === 'false'));
  await h.locator('button.ink', { hasText: '开始', exact: true }).click();
  for (const p of guests) await p.waitForFunction(() => window.__feel?.net()?.ready && window.__feel.world.players.length === 4);
  await guests[0].waitForFunction(() => window.__feel.net().transport === 'rtc');
  await guests[1].waitForFunction(() => window.__feel.net().transport === 'rtc');
  assert.equal(await guests[2].evaluate(() => window.__feel.net().transport), 'relay');
  assert.equal(await h.evaluate(() => window.__feel.net().transport), 'mixed');
  const initial = await guests[2].evaluate(() => window.__feel.world.tick);
  await guests[2].waitForTimeout(2500);
  assert.ok(await guests[2].evaluate(t => window.__feel.world.tick > t + 90, initial));
  console.log('PASS 四人混合连接，直连与中继队友持续推进');
  await h.evaluate(() => { const w = window.__feel.world; w.waveT = w.waveLen - 0.05; for (const p of w.players) { p.hp = p.stats.maxHp; p.invuln = 10; } });
  for (const p of guests) await p.waitForFunction(() => window.__feel.world.phase === 'shop' && document.querySelector('#inter.on'), null, { timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log('PASS 四人均进入普通波商店，无脚本异常');
} finally { await b.close(); }
