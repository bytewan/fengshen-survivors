// 实验页截图：node tools/pixelfx-shot.mjs <预设名或 id> [--raw] [--dark] [--baked] [--port 5180] [--at 0.3,0.8,1.2] [--n 6] [--gap 260]
//             node tools/pixelfx-shot.mjs <预设名或 id> --compare [--at …]   核对「预烘焙」和「现场画」的画面是不是一模一样
// 打开开发服务器上的 tools/pixelfx-lab.html：
// - 给了 --at：把特效定在这几个时刻各截一张（确定的，推荐），存到 scratch/pfx/<名>[-raw][-dark][-baked]-t<秒>.png；
// - 没给：播一次，每隔 gap 毫秒截一张（软件渲染慢，时间点只是大概），存到 scratch/pfx/<名>[-raw][-dark][-baked]-<k>.png。
// - --baked：用预烘焙的图集播（playBaked）。--compare：两种播法在同一时刻各取一次画面，逐像素比（时刻取 1/30 秒的整数倍，不给就自动取 8 个）。
//   一次性的特效应该逐像素一致。循环的特效从第二圈起会差十来个像素：现场画的时间是「一直累加再取余」，尾数和第一圈不完全一样，
//   个别抖动像素会翻；这算正常（「抖动级」）。差得多（超过 64 个像素）才是真有问题：帧对错了、位置偏了。
// 要逐帧看用 node tools/pixelfx.mjs render <名> --all。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i < 0 ? d : args[i + 1];
};
const name = args.find((a, i) => !a.startsWith('--') && !['--port', '--n', '--gap', '--at'].includes(args[i - 1]));
if (!name) {
  console.error('用法：node tools/pixelfx-shot.mjs <预设名或 id> [--raw] [--dark] [--baked] [--compare] [--port 5180] [--at 0.3,0.8,1.2] [--n 6] [--gap 260]');
  process.exit(1);
}
const raw = args.includes('--raw');
const dark = args.includes('--dark');
const bakedMode = args.includes('--baked');
const compare = args.includes('--compare');
const port = flag('port', '5180');
const n = +flag('n', 6);
const gap = +flag('gap', 260);
const at = flag('at', '') ? flag('at', '').split(',').map(Number) : null;

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1460, height: 830 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`http://localhost:${port}/tools/pixelfx-lab.html?manual&fx=${encodeURIComponent(name)}${raw ? '&raw' : ''}${dark ? '&dark' : ''}${bakedMode ? '&baked' : ''}`);
await p.waitForFunction(() => window.__lab);
mkdirSync('scratch/pfx', { recursive: true });
const base = `scratch/pfx/${name.replace('/', '_')}${raw ? '-raw' : ''}${dark ? '-dark' : ''}${bakedMode ? '-baked' : ''}`;
if (compare) {
  // 两种播法在同一时刻的画面逐像素比。预烘焙按 1/30 秒一帧，所以时刻取 1/30 秒的整数倍
  const times = (at ?? [0, 0.1, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0]).map((t) => Math.round(t * 30) / 30);
  let bad = 0;
  let dither = 0;
  for (const t of times) {
    const r = await p.evaluate(async ([nm, tt]) => {
      const L = window.__lab;
      await L.seek(nm, tt, false, true);
      const live = L.snap();
      await L.seek(nm, tt, true, true);
      const baked = L.snap();
      await L.seek(nm, 0, false, true);
      const blank = L.snap(); // t=0 的画面当参照，看这一刻到底画了多少东西
      return { ...L.diff(live, baked), drawn: L.diff(live, blank).pixels };
    }, [name, t]);
    const verdict = r.pixels === 0 ? '一致' : r.pixels <= 64 ? '抖动级' : '不一致';
    if (r.pixels > 64) bad++;
    else if (r.pixels) dither++;
    console.log(`t=${t.toFixed(3)}  ${verdict}：不一样的像素 ${r.pixels}（最大色差 ${r.maxDelta}）  这一刻和开头相比变了 ${r.drawn} 个像素`);
  }
  const st = await p.evaluate(() => window.__lab.bakedStats());
  const sum = bad ? `有 ${bad} 个时刻不一致` : dither ? `预烘焙和现场画一致（${dither} 个时刻有抖动级的差别）` : '预烘焙和现场画逐像素一致';
  console.log(sum, `· 图集 ${(st.bytes / 1048576).toFixed(2)} MB`, errs.length ? `错误：${JSON.stringify(errs)}` : '无报错');
  await b.close();
  process.exit(bad || errs.length ? 1 : 0);
}
if (at) {
  for (const t of at) {
    await p.evaluate(([nm, tt]) => window.__lab.seek(nm, tt), [name, t]);
    writeFileSync(`${base}-t${t.toFixed(2)}.png`, await p.locator('canvas').screenshot());
  }
  console.log(`${base}-t{${at.map((t) => t.toFixed(2)).join(',')}}.png`, errs.length ? `错误：${JSON.stringify(errs)}` : '无报错');
} else {
  await p.evaluate(() => window.__lab.next());
  for (let k = 0; k < n; k++) {
    await p.waitForTimeout(gap);
    writeFileSync(`${base}-${k}.png`, await p.locator('canvas').screenshot());
  }
  console.log(`${base}-0..${n - 1}.png`, errs.length ? `错误：${JSON.stringify(errs)}` : '无报错');
}
await b.close();
