// 「点不动」体检：把万宝阁的每一步（进化 / 功法 / 升级 / 商店）走一遍，量每个能点的东西有没有被别的元素盖住，再真点几下看有没有反应。
// 背景（用户 2026-11-10）：「很多时候都会出现选择奖励点不动的情况，锁也点不了，部分能点部分点不了」——
// 原因是透明的对白层叠在万宝阁上面还在接点击。以后再加叠在上面的界面层，跑一遍这个。
//
//   node tools/click-probe.mjs [--port 5180] [--size 1440x810] [--touch] [--query wave=2] [--no-resize] [--shots]
//
// 做法：
// - 每个带 data-act 的按钮里均匀取 5×3 个点，用 elementFromPoint 看最上面的元素是不是它自己；不是就报出挡它的元素。
// - 默认先把窗口大小改一下再改回来：对白层、战斗界面这些是在 resize（或第一次用到）时才铺开的，不改一下量不出来。
// - 商店那一步真点一次「锁」再点回来、真点一次「刷新」，对照模拟里的状态变没变。
// 有任何按钮被挡、或者真点没反应，退出码是 1。
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const port = flag('port', '5180');
const [W, H] = flag('size', '1440x810').split('x').map(Number);
const touch = args.includes('--touch');
const query = flag('query', 'wave=2');
const doResize = !args.includes('--no-resize');
const shots = args.includes('--shots');

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 1 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:${port}/?${query}`);
await p.waitForFunction(() => window.__feel !== undefined, null, { timeout: 60000 });
await p.waitForFunction(() => document.querySelector('#inter.on [data-act]'), null, { timeout: 60000 });
if (doResize) {
  await p.setViewportSize({ width: W - 40, height: H - 20 });
  await p.waitForTimeout(250);
  await p.setViewportSize({ width: W, height: H });
}
await p.waitForTimeout(1700); // 等卡片入场动画放完

const survey = () =>
  p.evaluate(() => {
    const who = (h) => (h ? `${h.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${h.className && typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/).join('.') : ''}` : '（空）');
    const out = [];
    for (const el of document.querySelectorAll('#inter [data-act]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // 没显示的（别的页签）
      let good = 0;
      let n = 0;
      let blocker = '';
      for (let iy = 0; iy < 3; iy++)
        for (let ix = 0; ix < 5; ix++) {
          const hit = document.elementFromPoint(r.left + ((ix + 0.5) / 5) * r.width, r.top + ((iy + 0.5) / 3) * r.height);
          n++;
          if (hit && (el === hit || el.contains(hit))) good++;
          else if (!blocker) blocker = hit ? `${who(hit)}（在 ${who(hit.closest('[id]'))} 里）` : '（空）';
        }
      const d = el.dataset;
      const name = `${d.act}${d.i !== undefined ? '#' + d.i : ''}${d.tab ? ':' + d.tab : ''}${d.b ? ':' + d.b : ''}`;
      out.push({ name, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), good, n, blocker });
    }
    const steps = [...document.querySelectorAll('#inter .steps span')].map((s) => (s.classList.contains('cur') ? `[${s.textContent}]` : s.textContent)).join(' ');
    return { out, steps };
  });
const tap = (x, y) => (touch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
const me = (f) => p.evaluate(f);

let total = 0;
let blocked = 0;
let dead = 0;
if (shots) mkdirSync('scratch/clickprobe', { recursive: true });
console.log(`窗口 ${W}×${H}${touch ? '（触屏）' : ''}  ${doResize ? '窗口大小改过一次' : '没改过窗口大小'}  ?${query}`);
for (let step = 0; step < 8; step++) {
  const s = await survey();
  const bad = s.out.filter((o) => o.good < o.n);
  total += s.out.length;
  blocked += bad.length;
  console.log(`-- ${s.steps}：能点的 ${s.out.length} 个，被挡 ${bad.length} 个`);
  for (const o of bad) console.log(`   ${o.good === 0 ? '✗' : '◐'} ${o.name.padEnd(13)} (${o.x},${o.y}) ${o.w}×${o.h}  点得到 ${o.good}/${o.n}  ← 挡它的：${o.blocker}`);
  if (shots) await p.screenshot({ path: `scratch/clickprobe/step-${W}x${H}${touch ? '-touch' : ''}-${step}.png` });

  // 这一步真点一下：进化 / 功法 / 升级点第一个选项（应该进到下一步或下一组）；商店点「锁」和「刷新」
  const first = s.out.find((o) => /^(evolve|learn|pick)/.test(o.name));
  if (first) {
    const before = await me(() => JSON.stringify([window.__feel.world.players[0].petOffer, window.__feel.world.players[0].techOffer, window.__feel.world.players[0].pendingLevels, window.__feel.world.players[0].techs.length]));
    await tap(first.x, first.y);
    await p.waitForTimeout(1500);
    const after = await me(() => JSON.stringify([window.__feel.world.players[0].petOffer, window.__feel.world.players[0].techOffer, window.__feel.world.players[0].pendingLevels, window.__feel.world.players[0].techs.length]));
    const okc = before !== after;
    if (!okc) dead++;
    console.log(`   真点「${first.name}」(${first.x},${first.y})：${okc ? '有反应' : '没反应'}`);
    if (!okc) break;
    continue;
  }
  const lock = s.out.find((o) => o.name.startsWith('lock'));
  if (lock) {
    const i = Number(lock.name.split('#')[1]);
    const v0 = await p.evaluate((k) => window.__feel.world.players[0].locked[k], i);
    await tap(lock.x, lock.y);
    await p.waitForTimeout(350);
    const v1 = await p.evaluate((k) => window.__feel.world.players[0].locked[k], i);
    await tap(lock.x, lock.y);
    await p.waitForTimeout(350);
    const v2 = await p.evaluate((k) => window.__feel.world.players[0].locked[k], i);
    const okc = v0 !== v1 && v2 === v0;
    if (!okc) dead++;
    console.log(`   真点「${lock.name}」两次：锁定 ${v0} → ${v1} → ${v2}  ${okc ? '有反应' : '没反应'}`);
  }
  const reroll = s.out.find((o) => o.name === 'reroll');
  if (reroll) {
    const r0 = await me(() => window.__feel.world.players[0].rerolls);
    await tap(reroll.x, reroll.y);
    await p.waitForTimeout(500);
    const r1 = await me(() => window.__feel.world.players[0].rerolls);
    const okc = r1 === r0 + 1;
    if (!okc) dead++;
    console.log(`   真点「刷新」：刷新次数 ${r0} → ${r1}  ${okc ? '有反应' : '没反应'}`);
  }
  break; // 商店是最后一步
}
const fail = blocked > 0 || dead > 0 || errs.length > 0;
console.log(`${fail ? '有问题' : '通过'}：${total} 个能点的东西里 ${blocked} 个被挡，真点没反应 ${dead} 次${errs.length ? `，页面报错 ${JSON.stringify(errs)}` : ''}`);
await b.close();
process.exit(fail ? 1 : 0);
