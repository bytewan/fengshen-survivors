// 掉线与迁移的实测：房主 + 两个其他人（都开 ?bot）。
// 1) 打一会儿后关掉一个其他人的页面 → 房主那边他变成托管（机器人替他打）；
// 2) 用同一个名号重新点链接进来 → 拿回原来的人物；
// 3) 关掉房主的页面 → 中继按进房顺序把房主交给下一个人 → 新房主从这一波开始时的存档重开这一波，剩下的人接着打。
// 用法：node tools/net-migrate.mjs [开发服务器端口，默认 5180]（要先开着开发服务器和中继）。截图在 scratch/net/mig-*。
import { chromium } from 'playwright';
const port = process.argv.find((a) => /^\d+$/.test(a)) ?? '5180';
const base = `http://localhost:${port}`;
const out = 'scratch/net/mig';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const mk = async (tag, name) => {
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
  if (name) await ctx.addInitScript((n) => localStorage.setItem('fs.v1.netName', n), name);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/GL Driver/.test(m.text()) && errs.push(`${tag}: ${m.text().slice(0, 200)}`));
  return p;
};
const net = (p) => p.evaluate(() => ({ ...window.__feel?.net?.(), wave: window.__feel?.world.wave, phase: window.__feel?.world.phase, away: window.__feel?.world.players.map((x) => !!x.away), names: null }));
const H = await mk('H', '房主甲');
await H.goto(`${base}/?online&bot`);
await H.locator('button.ink', { hasText: '建房' }).click({ timeout: 15000 });
await H.locator('.code-big').waitFor();
const code = (await H.locator('.code-big').textContent()).trim();
const G1 = await mk('G1', '乙');
await G1.goto(`${base}/?room=${code}&bot`);
await G1.locator('button.ink', { hasText: '准备' }).click({ timeout: 15000 });
let G2 = await mk('G2', '丙');
await G2.goto(`${base}/?room=${code}&bot`);
await G2.locator('button.ink', { hasText: '准备' }).click({ timeout: 15000 });
await H.waitForFunction(() => document.querySelectorAll('.fs-ui .lob .st.ok').length >= 2, null, { timeout: 8000 });
await H.locator('button.ink', { hasText: '开始' }).click();
for (const p of [H, G1, G2]) await p.waitForFunction(() => window.__feel?.net?.()?.ready, null, { timeout: 30000 });
console.log('开局', JSON.stringify(await net(H)));
await H.waitForTimeout(8000);
// 1) 关掉丙的页面
await G2.context().close();
await H.waitForTimeout(2500);
console.log('丙关页面之后 房主看到', JSON.stringify(await net(H)));
await H.screenshot({ path: `${out}-1-away-H.png` });
// 2) 丙用同一个名号重新进来
G2 = await mk('G2b', '丙');
await G2.goto(`${base}/?room=${code}&bot`);
await G2.waitForFunction(() => window.__feel?.net?.()?.ready, null, { timeout: 30000 });
await H.waitForTimeout(1500);
console.log('丙回来之后 房主', JSON.stringify(await net(H)));
console.log('丙回来之后 丙', JSON.stringify(await net(G2)));
await G2.screenshot({ path: `${out}-2-back-G2.png` });
await H.waitForTimeout(3000);
// 3) 关掉房主的页面
const before = await net(G1);
await H.context().close();
await G1.waitForFunction(() => window.__feel?.net?.()?.role === 'host', null, { timeout: 15000 });
await G1.waitForTimeout(2500);
const a1 = await net(G1);
const a2 = await net(G2);
console.log('房主关页面之前 乙', JSON.stringify(before));
console.log('迁移之后 乙', JSON.stringify(a1));
console.log('迁移之后 丙', JSON.stringify(a2));
await Promise.all([G1.screenshot({ path: `${out}-3-migrated-G1.png` }), G2.screenshot({ path: `${out}-3-migrated-G2.png` })]);
await G1.waitForTimeout(6000);
console.log('再过 6 秒 乙', JSON.stringify(await net(G1)));
console.log('再过 6 秒 丙', JSON.stringify(await net(G2)));
await Promise.all([G1.screenshot({ path: `${out}-4-later-G1.png` }), G2.screenshot({ path: `${out}-4-later-G2.png` })]);
console.log('errors', JSON.stringify(errs).slice(0, 3000));
await b.close();
