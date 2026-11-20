// 实际 Java 中继下验证自动直连、断开后的自动回退，以及连接失败不阻塞开局。
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const c = await browser.newContext();
  const base = 'https://bytewan.github.io/fengshen-survivors/';
  await c.grantPermissions(['local-network-access'], { origin: 'https://bytewan.github.io' });
  await c.route(base + '**', async r => {
    const file = path.resolve('dist', decodeURIComponent(new URL(r.request().url()).pathname.slice('/fengshen-survivors/'.length)) || 'index.html');
    if (!file.startsWith(path.resolve('dist') + path.sep)) return r.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };
    await r.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  await c.addInitScript(() => {
    window.__pcs = []; window.__blockDirect = new URLSearchParams(location.search).has('blockrtc');
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, { construct(Target, args) { const pc = new Target(...args); window.__pcs.push(pc); return pc; } });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(text) {
      if (window.__blockDirect && typeof text === 'string' && text.startsWith('>')) {
        try { const bar = text.indexOf('|'), m = JSON.parse(text.slice(bar + 1)); if (m.t === 'rtc') {
          if (m.type === 'ice') return;
          if (m.sdp) m.sdp = m.sdp.split('\r\n').filter(s => !s.startsWith('a=candidate:') && s !== 'a=end-of-candidates').join('\r\n');
          text = text.slice(0, bar + 1) + JSON.stringify(m);
        } } catch {}
      }
      return send.call(this, text);
    };
  });
  const h = await c.newPage(), g = await c.newPage(), errors = [];
  for (const p of [h, g]) p.on('pageerror', e => errors.push(e.message));
  async function start(blocked) {
    for (const p of [h, g]) await p.evaluate(blocked => { window.__blockDirect = blocked; }, blocked);
    await h.goto(base + '?online&bot&wave=2' + (blocked ? '&blockrtc=1' : ''));
    if (blocked) await h.evaluate(() => { window.__blockDirect = true; });
    await h.locator('button.ink', { hasText: '建房', exact: true }).click();
    await h.locator('.code-big').waitFor(); const room = await h.locator('.code-big').textContent();
    await g.goto(base + '?room=' + room + '&bot' + (blocked ? '&blockrtc=1' : ''));
    if (blocked) await g.evaluate(() => { window.__blockDirect = true; });
    await g.locator('button.ink', { hasText: '准备', exact: true }).click();
    await h.waitForFunction(() => [...document.querySelectorAll('button.ink')].some(b => b.textContent.trim() === '开始' && b.getAttribute('aria-disabled') === 'false'));
    await h.locator('button.ink', { hasText: '开始', exact: true }).click();
    await g.waitForFunction(() => window.__feel?.net()?.ready);
  }
  await start(false);
  await g.waitForFunction(() => window.__feel.net().transport === 'rtc');
  await g.waitForFunction(() => window.__feel.world.phase === 'wave', null, { timeout: 30000 });
  console.log('PASS 默认公网连接在后台建立直连');
  for (const p of [h, g]) await p.evaluate(() => { window.__blockDirect = true; });
  await g.evaluate(() => { for (const pc of window.__pcs) pc.close(); });
  await g.waitForFunction(() => window.__feel.net().transport === 'relay');
  await g.waitForTimeout(2500);
  const before = await g.evaluate(() => window.__feel.world.tick);
  await g.waitForTimeout(2000);
  const after = await g.evaluate(() => ({ tick: window.__feel.world.tick, net: window.__feel.net() }));
  assert.ok(after.tick > before + 70, '自动回退后世界持续推进');
  assert.equal(after.net.transport, 'relay'); assert.ok(after.net.predErr < 32);
  console.log('PASS 直连断开且无法重建时自动回退中继，游戏持续运行', after.net);
  // 新房间的全部候选地址都阻断，仍应可以准备和开始。
  await start(true);
  assert.equal(await g.evaluate(() => window.__feel.net().transport), 'relay');
  assert.deepEqual(errors, []);
  console.log('PASS 自动直连失败不阻塞开局');
} finally { await browser.close(); }
