// 联机实测：一个房主 + 若干其他人（同一台机器上的几个页面），都开 ?bot 自动打，跑一段时间。
// 每秒记一次联机统计（延迟、流量、缓冲、预测校正），阶段变了（进商店、开下一波、首领）两边各截一张图；最后打出汇总。
// 用法：node tools/net-run.mjs [--port 5180] [--secs 40] [--guests 1] [--host "&wave=3"] [--guest "&bot"] [--out scratch/net/run]
// 要先开着开发服务器（默认 5180 端口）和中继（npm run relay，5300）。截图在 --out 指定的前缀下（默认 scratch/net/run-*）。
import { chromium } from 'playwright';
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const port = arg('port', '5180');
const secs = Number(arg('secs', 40));
const nGuests = Number(arg('guests', 1));
const hostExtra = arg('host', '');
const guestExtra = arg('guest', '&bot');
const out = arg('out', 'scratch/net/run');
const base = `http://localhost:${port}`;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = {};
const mk = async (tag) => {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  errs[tag] = [];
  p.on('pageerror', (e) => errs[tag].push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/GL Driver/.test(m.text()) && errs[tag].push(m.text().slice(0, 300)));
  return p;
};
const H = await mk('H');
await H.goto(`${base}/?online&bot${hostExtra}`);
await H.locator('button.ink', { hasText: '建房' }).click({ timeout: 15000 });
await H.locator('.code-big').waitFor({ timeout: 10000 });
const code = (await H.locator('.code-big').textContent()).trim();
console.log('room', code);
const G = [];
for (let i = 0; i < nGuests; i++) {
  const g = await mk(`G${i + 1}`);
  await g.goto(`${base}/?room=${code}${guestExtra}`);
  await g.locator('.code-big').waitFor({ timeout: 15000 });
  await g.locator('button.ink', { hasText: '准备' }).click();
  G.push(g);
}
await H.waitForFunction((n) => document.querySelectorAll('.fs-ui .lob .st.ok').length >= n, nGuests, { timeout: 8000 });
await H.locator('button.ink', { hasText: '开始' }).click();
const pages = [H, ...G];
const tags = ['H', ...G.map((_, i) => `G${i + 1}`)];
await Promise.all(pages.map((p) => p.waitForFunction(() => window.__feel?.net?.()?.ready, null, { timeout: 30000 })));
console.log('all in game');
const lastPhase = {};
const wire = [];
const samples = [];
let shot = 0;
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await H.waitForTimeout(1000);
  const st = await Promise.all(pages.map((p) => p.evaluate(() => ({ n: window.__feel?.net?.(), s: window.__feel?.stats?.() })).catch(() => null)));
  samples.push(st);
  const key = st.map((x) => x?.s?.phase + (x?.s?.wave ?? '')).join(',');
  const hp = st[0]?.s;
  if (hp && lastPhase.k !== `${hp.phase}${hp.wave}`) {
    lastPhase.k = `${hp.phase}${hp.wave}`;
    if (shot < 8) {
      shot++;
      await H.waitForTimeout(1500); // 等其他人的画面也跟上
      await Promise.all(pages.map((p, i) => p.screenshot({ path: `${out}-${shot}-${hp.phase}${hp.wave}-${tags[i]}.png` })));
      console.log('shot', shot, key);
    }
  }
  const rs = await fetch('http://127.0.0.1:5300/stats').then((r) => r.json()).catch(() => null);
  const room = rs?.rooms?.find((r) => r.room === code);
  if (room) wire.push(room);
  console.log(room ? `[中继实测 进 ${room.inKBs} KB/s 出 ${room.outKBs} KB/s]` : '', st.map((x, i) => `${tags[i]} ${x?.s?.phase}${x?.s?.wave} t${x?.n?.tick} e${x?.s?.enemies} up${x?.n?.up} dn${x?.n?.down} rtt${x?.n?.rtt} lag${x?.n?.lag} q${x?.n?.queued} corr${x?.n?.predErr} fps${x?.s?.fps} hp${Math.round(x?.s?.hp ?? 0)}`).join(' | '));
}
await Promise.all(pages.map((p, i) => p.screenshot({ path: `${out}-end-${tags[i]}.png` })));
// 汇总
const col = (i, f) => samples.map((s) => s[i]?.n?.[f]).filter((v) => typeof v === 'number');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? sum(a) / a.length : 0);
console.log('---- 汇总 ----');
console.log(`房主上行：平均 ${(avg(col(0, 'up')) / 1024).toFixed(1)} KB/s，最大 ${(Math.max(...col(0, 'up')) / 1024).toFixed(1)} KB/s`);
for (let i = 1; i < pages.length; i++) {
  const r = col(i, 'rtt').filter((v) => v > 0);
  console.log(`${tags[i]}：下行平均 ${(avg(col(i, 'down')) / 1024).toFixed(1)} KB/s、最大 ${(Math.max(...col(i, 'down')) / 1024).toFixed(1)}；往返延迟平均 ${avg(r).toFixed(0)} ms、最大 ${Math.max(...r)}；画面落后 ${avg(col(i, 'lag')).toFixed(1)} 帧；预测校正平均 ${avg(col(i, 'predErr')).toFixed(1)} 像素`);
}
if (wire.length) {
  const ins = wire.map((r) => r.inKBs);
  const outs = wire.map((r) => r.outKBs);
  console.log(`中继实测（压缩后、含帧头）：进 平均 ${avg(ins).toFixed(1)} KB/s 最大 ${Math.max(...ins)}；出 平均 ${avg(outs).toFixed(1)} KB/s 最大 ${Math.max(...outs)}（出 = 发给所有其他人的总和）`);
}
console.log('faults', JSON.stringify(samples.at(-1)?.map((x) => x?.s?.faults)));
console.log('errors', JSON.stringify(errs).slice(0, 4000));
await b.close();
