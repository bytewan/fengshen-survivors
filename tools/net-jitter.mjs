// 真实浏览器的网络抖动 / 快照丢失回归。--live 读线上旧版，否则读本地 dist。
// GAME_TEST_LOSS=1：每十份快照丢一份，独立快照必须继续推进。
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const live = process.argv.includes('--live'), loss = process.env.GAME_TEST_LOSS === '1';
const base = 'https://agent-runtime.bigmodel.cn/fengshen-survivors/';
await mkdir('scratch/net', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const context = await browser.newContext();
  await context.grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  if (!live) await context.route(base + '**', async route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice('/fengshen-survivors/'.length)) || 'index.html';
    const file = path.resolve('dist', name);
    if (!file.startsWith(path.resolve('dist') + path.sep)) return route.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };
    await route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  await context.addInitScript(() => { const epoch = 1770000000000; Date.now = () => epoch - epoch % 65536 + 7; });
  const h = await context.newPage(), g = await context.newPage(), errors = [];
  for (const p of [h, g]) p.on('pageerror', e => errors.push(e.message));
  await g.addInitScript(({ loss }) => {
    const Native = window.WebSocket, descriptor = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage');
    window.__rx = { count: 0, discarded: 0, arrivals: [] };
    window.WebSocket = new Proxy(Native, { construct(Target, args) {
      const ws = new Target(...args);
      Object.defineProperty(ws, 'onmessage', { configurable: true, set(fn) {
        descriptor.set.call(ws, function(e) {
          let m; try { m = JSON.parse(String(e.data).slice(String(e.data).indexOf('|') + 1)); } catch {}
          if (m?.t !== 'st') return fn.call(ws, e);
          const n = ++window.__rx.count;
          if (!m.f && loss && n % 10 === 0) { window.__rx.discarded++; return; }
          // 60ms 基础延迟 + 周期性 200ms 空窗，若干快照会集中到达或乱序。
          const delay = 60 + (n % 12 >= 8 ? (12 - n % 12) * 50 : 0);
          const at = Math.max(performance.now() + delay, (ws.__deliveryAt ?? 0) + 0.1);
          ws.__deliveryAt = at; // WebSocket 的突发仍须有序，不能把乱序误当成真实 TCP 表现。
          setTimeout(() => { window.__rx.arrivals.push(performance.now()); fn.call(ws, e); }, Math.max(0, at - performance.now()));
        });
      }, get() { return descriptor.get.call(ws); } });
      return ws;
    } });
  }, { loss });
  await h.goto(base + '?online&bot&wave=15&transport=relay');
  await h.locator('button.ink', { hasText: '建房', exact: true }).click();
  await h.locator('.code-big').waitFor();
  const room = await h.locator('.code-big').textContent();
  await g.goto(base + '?room=' + room + '&bot&transport=relay');
  await g.locator('button.ink', { hasText: '准备', exact: true }).click();
  await h.waitForFunction(() => [...document.querySelectorAll('button.ink')].some(b => b.textContent.trim() === '开始' && b.getAttribute('aria-disabled') === 'false'));
  await h.locator('button.ink', { hasText: '开始', exact: true }).click();
  await g.waitForFunction(() => window.__feel?.net()?.ready && window.__feel.world.phase === 'wave' && window.__feel.world.enemies.length >= 10, null, { timeout: 60000 });
  await h.evaluate(() => { window.__feel.world.waveLen = 120; });
  const keepAlive = setInterval(() => h.evaluate(() => { for (const p of window.__feel.world.players) { p.hp = p.stats.maxHp; p.invuln = 2; } }).catch(() => {}), 300);
  try {
    await g.evaluate(() => {
      window.__samples = []; let before = new Map(), last = performance.now(); const ids = new WeakMap(); let serial = 0;
      const frame = () => {
        if (window.__stop) { window.__feel.stage.app.ticker.remove(frame); return; }
        const now = performance.now(), w = window.__feel.world, net = window.__feel.net(), self = w.players[net.me];
        // 直接测已经更新的精灵位置，旧版和新版使用同一测量方式；排除本机预测角色周围的显示对象。
        const positions = new Map(window.__feel.stage.entities.children.filter(c => c.texture && c.visible && Math.hypot(c.x - self.x, c.y - self.y) > 40).map(c => { if (!ids.has(c)) ids.set(c, ++serial); return [ids.get(c), [c.x, c.y]]; }));
        let moved = 0, common = 0, sum = 0;
        for (const [id, xy] of positions) if (before.has(id)) { const old = before.get(id), d = Math.hypot(xy[0] - old[0], xy[1] - old[1]); common++; if (d > 0.02) moved++; sum += d; }
        window.__samples.push({ frameMs: now - last, frozen: common > 5 && moved === 0, move: common ? sum / common : 0, common, tick: w.tick, ...net });
        before = positions; last = now;
      }; window.__feel.stage.app.ticker.add(frame, undefined, -10);
    });
    await g.waitForTimeout(18000);
    const raw = await g.evaluate(() => { window.__stop = true; return { samples: window.__samples, rx: window.__rx }; });
    const useful = raw.samples.filter(s => s.common > 5), sorted = key => useful.map(s => s[key] ?? 0).sort((a, b) => a - b);
    const pct = (a, p) => a[Math.floor((a.length - 1) * p)] ?? 0;
    const summary = { live, loss, frames: raw.samples.length, measuredFrames: useful.length, frozenPct: useful.filter(s => s.frozen).length * 100 / Math.max(1, useful.length), p95FrameMs: pct(sorted('frameMs'), .95), p95Movement: pct(sorted('move'), .95), p95PredErr: pct(sorted('predErr'), .95), last: raw.samples.at(-1), snapshots: raw.rx.count, dropped: raw.rx.discarded, errors };
    await writeFile(`scratch/net/jitter-${live ? 'live' : 'build'}-${loss ? 'loss' : 'burst'}.json`, JSON.stringify({ summary, ...raw }, null, 2));
    assert.deepEqual(errors, []); assert.ok(useful.length > 100, '确实运行了有敌人的战场');
    assert.ok(raw.samples.at(-1).tick > raw.samples[0].tick + 600, '缺包期间仍持续推进');
    if (!live) assert.ok(summary.frozenPct < 15, `可见停顿帧过多：${summary.frozenPct}%`);
    console.log(JSON.stringify(summary, null, 2));
  } finally { clearInterval(keepAlive); }
} finally { await browser.close(); }
