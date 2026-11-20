// 三个浏览器内核能不能解 HE-AAC（.m4a 里的 aach）：chromium、webkit（代表 Safari / iOS）、firefox。
// 用法（开发服务器开着时）：node tools/audio/codec-probe.mjs [--port 5180] 文件（相对站点根目录）...
// 每个文件在每个内核里用 AudioContext.decodeAudioData 解一遍（也按播放器的做法试 32kHz 的 OfflineAudioContext），
// 报时长、采样率、开头第一个高于 -50dBFS 的样本在第几秒（和构建时记下的比，看编码延迟去没去掉）、有没有报错。
import { chromium, firefox, webkit } from 'playwright';

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5180';
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
const out = {};
for (const [name, type] of [
  ['chromium', chromium],
  ['webkit', webkit],
  ['firefox', firefox],
]) {
  let b;
  try {
    b = await type.launch();
  } catch (e) {
    console.log(`${name}: 启动不了（${e.message.split('\n')[0]}）`);
    continue;
  }
  const p = await b.newPage();
  await p.goto(`http://localhost:${port}/?fxlab`);
  out[name] = await p.evaluate(async (files) => {
    const res = {};
    const dec = (ctx, bytes) => new Promise((ok, bad) => ctx.decodeAudioData(bytes, ok, (e) => bad(e ?? new Error('decodeAudioData 失败'))));
    const onset = (buf) => {
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.00316) return i / buf.sampleRate;
      return -1;
    };
    for (const f of files) {
      const bytes = await (await fetch('/' + f)).arrayBuffer();
      const r = {};
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const buf = await dec(ctx, bytes.slice(0));
        r.main = { dur: +buf.duration.toFixed(4), sr: buf.sampleRate, ch: buf.numberOfChannels, onset: +onset(buf).toFixed(4) };
        await ctx.close();
      } catch (e) {
        r.main = { error: String(e && e.message ? e.message : e) };
      }
      try {
        const buf = await dec(new OfflineAudioContext(2, 32000, 32000), bytes.slice(0));
        r.offline32k = { dur: +buf.duration.toFixed(4), sr: buf.sampleRate, onset: +onset(buf).toFixed(4) };
      } catch (e) {
        r.offline32k = { error: String(e && e.message ? e.message : e) };
      }
      res[f] = r;
    }
    return res;
  }, files);
  await b.close();
}
for (const f of files) {
  console.log(f);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(9)} ${JSON.stringify(v[f])}`);
}
