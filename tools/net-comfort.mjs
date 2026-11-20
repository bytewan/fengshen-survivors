// 联机回归：真实浏览器点击功法/天赋、跨普通波进商店、两次再战后键盘移动。
// 先开 Vite 5180 和中继 5300。node tools/net-comfort.mjs
// --cloud：从本地 dist 加载新版 Pages 产物，连接测试中继；不会上传或修改线上文件。
// 构建：GAME_BASE_PATH=/fengshen-survivors/ VITE_RELAY_URL=wss://dev.bigmodel.cn/api/v1/agents/fengshen/relay npm run build
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const cloud = process.argv.includes('--cloud');
const base = process.env.GAME_TEST_URL ?? (cloud ? 'https://bytewan.github.io/fengshen-survivors' : 'http://localhost:5180');
const direct = process.env.GAME_TEST_TRANSPORT === 'rtc';
const connection = (process.env.GAME_TEST_RELAY ? `&network=lan&relay=${encodeURIComponent(process.env.GAME_TEST_RELAY)}` : '') + (direct ? '&network=lan&transport=rtc' : process.env.GAME_TEST_TRANSPORT === 'relay' ? '&transport=relay' : '');
const out = 'scratch/net/comfort' + (cloud ? '-cloud' : '-local');
await mkdir('scratch/net', { recursive: true });
const browser = await chromium.launch({ ...(cloud && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  if (cloud) {
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
    // 使用正确浏览器 Origin 验证生产产物和后端来源白名单。
    const context = await browser.newContext();
    await context.route('https://bytewan.github.io/fengshen-survivors/**', async route => {
      const suffix = decodeURIComponent(new URL(route.request().url()).pathname.slice('/fengshen-survivors/'.length)) || 'index.html';
      const file = path.resolve('dist', suffix);
      if (!file.startsWith(path.resolve('dist') + path.sep)) return route.abort();
      try { await route.fulfill({ body: await readFile(file), contentType: mime[path.extname(file)] ?? 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'missing build file' }); }
    });
  } else await browser.newContext();
  const context = browser.contexts()[0];
  // 测试域名解析为私网 IP 时，模拟用户允许浏览器访问本地网络。
  if (process.env.GAME_TEST_ALLOW_LOCAL_NETWORK === '1') {
    await context.grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  }
  const h = await context.newPage(), g = await context.newPage();
  for (const [tag, p] of [['host', h], ['guest', g]]) {
    await p.setViewportSize({ width: 960, height: 540 });
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await p.addInitScript(() => { window.__wire = { sync: 0, input: 0, signals: 0, relayedGame: 0 }; const send = WebSocket.prototype.send; WebSocket.prototype.send = function(text) { if (typeof text === 'string' && text.startsWith('>')) { try { const m = JSON.parse(text.slice(text.indexOf('|') + 1)); if (m.t === 'sync') window.__wire.sync++; if (m.t === 'in') window.__wire.input++; if (m.t === 'rtc') window.__wire.signals++; else window.__wire.relayedGame++; } catch {} } return send.call(this, text); }; });
  }
  await h.goto(base + '/?online&bot&wave=2' + connection);
  await h.locator('button.ink', { hasText: '建房' }).click();
  await h.locator('.code-big').waitFor();
  const code = (await h.locator('.code-big').textContent()).trim(); console.log('room', code);
  await g.goto(base + '/?room=' + code + connection);
  await g.locator('.code-big').waitFor(); await g.locator('button.ink', { hasText: '准备' }).click();
  await h.waitForFunction(() => document.querySelector('.lob .st.ok'));
  await h.waitForFunction(() => [...document.querySelectorAll('button.ink')].some(b => b.textContent.trim() === '开始' && b.getAttribute('aria-disabled') === 'false'));
  await h.locator('button.ink', { hasText: '开始' }).click();
  await g.waitForFunction(() => window.__feel?.net()?.ready);
  const keepAlive = setInterval(() => h.evaluate(() => { for (const p of window.__feel.world.players) { p.hp = p.stats.maxHp; p.invuln = 2; } }).catch(() => {}), 300);
  try {
    async function shop() {
      await g.waitForFunction(() => window.__feel.world.phase === 'shop' && document.querySelector('#inter.on'), null, { timeout: 20000 });
      let actions = 0;
      while ((await g.evaluate(() => window.__feel.world.phase)) === 'shop') {
        const act = await g.evaluate(() => ['evolve', 'learn', 'pick', 'ready'].find(a => document.querySelector('#inter.on [data-act="' + a + '"]')));
        if (!act) { await g.waitForTimeout(100); continue; }
        await g.waitForTimeout(400); // 新步骤防双击保护为 350 ms。
        const before = await g.evaluate(() => { const p = window.__feel.world.players[window.__feel.net().me]; return JSON.stringify([p.techOffer, p.petOffer, p.pendingLevels, p.ready, window.__feel.world.phase]); });
        await g.locator('#inter.on [data-act="' + act + '"]').first().click();
        await g.waitForFunction(before => { const p = window.__feel.world.players[window.__feel.net().me]; return JSON.stringify([p.techOffer, p.petOffer, p.pendingLevels, p.ready, window.__feel.world.phase]) !== before; }, before, { timeout: 6000 });
        actions++; if (act === 'ready') break;
        assert.ok(actions < 16, '商店操作应有进展');
      }
      await g.waitForFunction(() => window.__feel.world.phase === 'wave', null, { timeout: 15000 });
      console.log('shop passed', actions, await g.evaluate(() => window.__feel.net()));
    }
    await shop();
    // 将普通波的计时推进到末尾，仍通过实际模拟的 collect→shop 流程。
    for (let i = 0; i < 2; i++) {
      await h.evaluate(() => { window.__feel.world.waveT = window.__feel.world.waveLen - 0.05; });
      await shop();
    }
    for (let run = 0; run < 2; run++) {
      await h.evaluate(() => { const w = window.__feel.world; w.phase = 'over'; window.__feel.emit({ t: 'over' }); });
      await g.waitForFunction(() => window.__feel.world.phase === 'over', null, { timeout: 6000 });
      await h.waitForTimeout(1600); await h.locator('button.again').click();
      await g.waitForFunction(() => window.__feel.world.phase === 'shop', null, { timeout: 10000 });
      await shop();
      await g.bringToFront();
      const x0 = await g.evaluate(() => window.__feel.world.players[window.__feel.net().me].x);
      await g.keyboard.down('d'); await g.waitForTimeout(2000); await g.keyboard.up('d');
      const result = await g.evaluate(() => ({ x: window.__feel.world.players[window.__feel.net().me].x, n: window.__feel.net(), faults: window.__feel.stats().faults, wire: window.__wire }));
      assert.ok(result.x > x0 + 60, `再战后移动应持续前进：${x0}→${result.x}`);
      assert.ok(result.n.predErr < 32, '不应持续出现大幅回弹');
      console.log('restart passed', run + 1, result);
    }
    await Promise.all([h.screenshot({ path: out + '-host.png' }), g.screenshot({ path: out + '-guest.png' })]);
    if (direct) {
      for (const p of [h, g]) {
        const wire = await p.evaluate(() => window.__wire);
        assert.ok(wire.signals > 0, '已通过中继交换直连信息');
        assert.equal(wire.relayedGame, 0, '局域网游戏消息不应走服务端中继');
      }
    }
    assert.deepEqual(errors, []); console.log('PASS', direct ? 'browser direct data channel' : cloud ? 'production build + public test relay' : 'local');
  } finally { clearInterval(keepAlive); }
} catch (e) {
  for (const p of browser.contexts()[0]?.pages() ?? []) console.log('页面状态', await p.locator('.lob').innerText().catch(() => ''), await p.evaluate(() => window.__feel?.net?.()).catch(() => null));
  console.log('脚本异常', errors);
  throw e;
} finally { await browser.close(); }
