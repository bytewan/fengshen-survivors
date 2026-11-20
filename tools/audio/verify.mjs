// 音频的浏览器验证（开发服务器开着时跑）：听不见，就看加载和播放的状态。
// 用法：node tools/audio/verify.mjs [--port 5180] [--chapters] [--pages]
//   默认：打开页面、点一下解锁，等全部音效加载完：每个名字（bank.ts 的 BANK）的素材都在、没有 404 / 解码失败 / 控制台报错，
//         每个名字各放一遍不抛错；九首配乐逐首切过去，都能解码、开始放（__sfx.stats().music.playing）。
//   --chapters：?wave=N&bot 开局，等机器人进到第 N 波，看配乐是不是这一章的战斗曲 / 首领曲（第 5、6、7、12、13、18 波；软件渲染慢，约两分钟）。
//   --pages：标题页 → 修为 → 回来 → 致谢 → 回来 → 联机大厅 → 返回，每一步的配乐。
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5180';
const url = (q = '') => `http://localhost:${port}/${q}`;
const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
const b = await chromium.launch(LAUNCH);
let fail = 0;

// ---------- 加载与播放 ----------
{
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  const bad = [];
  let reqs = 0;
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /\[audio\]/.test(m.text()))) && errs.push(m.text()));
  p.on('response', (r) => {
    if (!/\/audio\/(sfx|music)\//.test(r.url())) return;
    reqs++;
    if (r.status() >= 400) bad.push(`${r.status()} ${decodeURIComponent(r.url().split('/audio/')[1])}`);
  });
  p.on('requestfailed', (r) => bad.push('failed ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));
  await p.goto(url('?bot'));
  await p.waitForFunction(() => window.__feel !== undefined, null, { timeout: 120000 });
  await p.mouse.click(640, 360); // 真实的点击：算用户手势，解锁音频
  await p.waitForFunction(() => window.__sfx && window.__sfx.stats().loaded > 0 && window.__sfx.stats().pending === 0, null, { timeout: 180000 });
  const st = await p.evaluate(() => window.__sfx.stats());
  const res = await p.evaluate(async () => {
    const { BANK, MUSIC } = await import('/src/audio/bank.ts');
    const s = window.__sfx;
    const names = Object.keys(BANK).filter((n) => !BANK[n].off); // 标了 off 的不出声、没有成品
    const files = [...new Set(names.flatMap((n) => BANK[n].files))];
    const threw = [];
    for (const n of names) {
      try {
        s.play(n, 0.3);
      } catch (e) {
        threw.push(n + ': ' + e.message);
      }
      await new Promise((r) => setTimeout(r, 12));
    }
    return { names: names.length, files: files.length, notReady: names.filter((n) => !s.samples.ready(n)), missingFiles: files.filter((f) => !s.samples.buffers.has(f)), threw, tracks: Object.keys(MUSIC) };
  });
  console.log(`音效：${res.names} 个名字、${res.files} 个文件，加载 ${st.loaded}，失败 ${JSON.stringify(st.failed)}；没就绪 ${JSON.stringify(res.notReady)}，缺文件 ${JSON.stringify(res.missingFiles)}，放的时候抛错 ${JSON.stringify(res.threw)}`);
  for (const t of res.tracks) {
    await p.evaluate((t) => window.__sfx.music(t), t);
    const ok = await p
      .waitForFunction((t) => window.__sfx.stats().music?.playing === t, t, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    const m = await p.evaluate(() => window.__sfx.stats().music);
    console.log(`配乐 ${t.padEnd(10)} ${ok ? '在放' : '没放起来'}（解码 ${m.sampleRate} Hz，开头偏移 ${(m.shift ?? 0).toFixed(4)} 秒）`);
    if (!ok) fail++;
  }
  await p.evaluate(() => window.__sfx.music(null));
  console.log(`音频请求 ${reqs} 个；坏的 ${JSON.stringify(bad)}；报错 ${JSON.stringify(errs)}`);
  if (res.notReady.length || res.missingFiles.length || res.threw.length || bad.length || errs.length || st.failed.length) fail++;
  await p.close();
}

// ---------- 换章换曲 ----------
if (args.includes('--chapters')) {
  const { chapterMusic } = await import('../../src/audio/bank.ts');
  for (const wave of [5, 6, 7, 12, 13, 18]) {
    const want = chapterMusic(Math.ceil(wave / 6), wave % 6 === 0);
    const p = await b.newPage({ viewport: { width: 960, height: 540 } });
    await p.goto(url(`?wave=${wave}&bot`));
    await p.waitForFunction(() => window.__feel !== undefined, null, { timeout: 120000 });
    await p.mouse.click(480, 270);
    const ok = await p
      .waitForFunction((w) => window.__feel.world.phase === 'wave' && window.__feel.world.wave === w, wave, { timeout: 90000 })
      .then(() => true)
      .catch(() => false);
    await p.waitForTimeout(800);
    const got = await p.evaluate(() => window.__sfx?.stats().music?.want ?? null);
    const pass = ok && got === want;
    if (!pass) fail++;
    console.log(`第 ${String(wave).padStart(2)} 波：配乐 ${got}（应为 ${want}）${pass ? '' : ' ← 不对'}`);
    await p.close();
  }
}

// ---------- 标题页各页 ----------
if (args.includes('--pages')) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url());
  await p.waitForTimeout(2500);
  await p.mouse.click(30, 30); // 点在空处解锁音频
  await p.waitForTimeout(2500);
  const want = () => p.evaluate(() => window.__sfx?.stats().music?.want ?? null);
  const steps = [['标题页', null, 'shop'], ['修为', '修为', 'calm'], ['关上修为页', 'Escape', 'shop'], ['致谢', '致谢', 'ending'], ['关上致谢页', 'Escape', 'shop'], ['联机大厅', '联机', 'calm'], ['离开大厅', 'Escape', 'shop']];
  for (const [label, act, exp] of steps) {
    if (act === 'Escape') await p.keyboard.press('Escape');
    else if (act) {
      await p.getByText(act, { exact: true }).first().click();
      await p.waitForTimeout(1800); // 等面板打开（打开的动画放完才收按键）
    }
    // 关上的动画放完才换回标题页的曲子：最多等 5 秒
    await p.waitForFunction((exp) => (window.__sfx?.stats().music?.want ?? null) === exp, exp, { timeout: 5000 }).catch(() => {});
    const got = await want();
    if (got !== exp) fail++;
    console.log(`${label}：配乐 ${got}（应为 ${exp}）${got === exp ? '' : ' ← 不对'}`);
  }
  if (errs.length) {
    fail++;
    console.log('报错', JSON.stringify(errs));
  }
  await p.close();
}

await b.close();
console.log(fail ? `有 ${fail} 处问题` : '全部通过');
process.exit(fail ? 1 : 0);
