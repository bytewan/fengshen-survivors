// 检查音效名字表：docs/audio.md 里的每个名字有没有素材、缺素材时用哪个合成后备；顺带核对文件与 assets.gen.ts 是否一致。
// 用法：node tools/audio/check.ts [--md] [--measure]
//   --md       输出 Markdown 表格
//   --measure  把 public/audio 下的成品逐个解码（afconvert），复量时长、响度、峰值，和 assets.gen.ts 对照；
//              音乐另外按播放器的接法（循环终点前 50ms 交叉到循环起点）拼出接缝，和顺着放下来的样子对照，量包络偏离、咔哒声、频谱像不像。
//              （没法试听，接缝好不好只能这样量。）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { ASSETS } from '../../src/audio/assets.gen.ts';
import { BANK, MUSIC } from '../../src/audio/bank.ts';
import { dbToGain, loudness, SR, toDb } from './dsp.ts';
import { readWav } from './wav.ts';

const md = process.argv.includes('--md');
const measure = process.argv.includes('--measure');
const doc = readFileSync('docs/audio.md', 'utf8');
const from = doc.indexOf('## 名字表');
const table = doc.slice(from, doc.indexOf('\n## ', from + 1)); // 只看「名字表」这一节
const rows = table.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.includes('| 分组 |'));
const named: { group: string; name: string }[] = [];
for (const r of rows) {
  const [, group, names] = r.split('|').map((s) => s.trim());
  for (const m of names.matchAll(/`([^`]+)`/g)) named.push({ group, name: m[1] });
}

let bad = 0;
const fileOk = (dir: string, f: string) => existsSync(`public/audio/${dir}/${f}.m4a`) && !!ASSETS[`${dir}/${f}`];
const out: string[][] = [];
for (const { group, name } of named) {
  if (group === '音乐') {
    const def = MUSIC[name as keyof typeof MUSIC];
    const ok = def && fileOk('music', def.file);
    if (!ok) bad++;
    const a = def && ASSETS[`music/${def.file}`];
    out.push([group, name, ok ? `music/${def.file}.m4a（${a!.dur.toFixed(0)} 秒，循环 ${a!.loopStart?.toFixed(1)}–${a!.loopEnd?.toFixed(1)} 秒）` : '—', '—', ok ? '素材' : '缺素材']);
    continue;
  }
  const def = BANK[name];
  if (!def) {
    out.push([group, name, '—', '—', '不出声']);
    continue;
  }
  if (def.off) {
    out.push([group, name, '—', '—', '不出声（off）']);
    continue;
  }
  const have = def.files.filter((f) => fileOk('sfx', f));
  const missing = def.files.filter((f) => !fileOk('sfx', f));
  if (missing.length) bad++;
  const status = have.length === def.files.length ? '素材' : have.length ? `部分素材（缺 ${missing.join(' ')}）` : def.synth ? '合成后备' : '不出声';
  // 播放时的增益 = 目标响度 db − 素材自己的响度，封顶 2.5 倍（+8dB，player.ts）：顶到了就是素材太轻，播出来不到 db
  const capped = have.filter((f) => def.db - (ASSETS[`sfx/${f}`]?.lufs ?? -14) > 7.9);
  if (capped.length) {
    console.log(`响度不够：${name} 的 ${capped.join(' ')} 比目标轻 8dB 以上（增益封顶）`);
    bad++;
  }
  out.push([group, name, have.length ? `${have.length} 个 · ${def.db}dB` : '—', def.synth ?? '—', status]);
}
// 名字表之外、只在 bank.ts 里的名字（现有方法内部用）
const inDoc = new Set(named.map((n) => n.name));
for (const name of Object.keys(BANK).filter((n) => !inDoc.has(n))) {
  const def = BANK[name];
  if (def.off) {
    out.push(['（表外）', name, '—', '—', '不出声（off）']);
    continue;
  }
  const have = def.files.filter((f) => fileOk('sfx', f));
  out.push(['（表外）', name, `${have.length} 个`, def.synth ?? '—', have.length === def.files.length ? '素材' : '缺素材']);
  if (have.length !== def.files.length) bad++;
}

if (md) {
  console.log('| 分组 | 名字 | 素材 | 合成后备 | 现状 |');
  console.log('|---|---|---|---|---|');
  for (const r of out) console.log(`| ${r[0]} | \`${r[1]}\` | ${r[2]} | ${r[3]} | ${r[4]} |`);
} else for (const r of out) console.log(r.map((c, i) => (i < 2 ? c.padEnd(i ? 18 : 8) : c)).join('  '));

// 文件与元数据核对：public/audio 下多出来的、元数据里有但文件没了的
const used = new Set([...Object.values(BANK).filter((d) => !d.off).flatMap((d) => d.files.map((f) => `sfx/${f}`)), ...Object.values(MUSIC).map((d) => `music/${d.file}`)]);
let total = 0;
for (const dir of ['sfx', 'music'])
  for (const f of readdirSync(`public/audio/${dir}`)) {
    total += statSync(`public/audio/${dir}/${f}`).size;
    const key = `${dir}/${f.replace(/\.m4a$/, '')}`;
    if (!used.has(key)) console.log(`没被引用的文件：public/audio/${key}.m4a`);
    if (!ASSETS[key]) {
      console.log(`assets.gen.ts 里没有：${key}`);
      bad++;
    }
  }
for (const key of Object.keys(ASSETS))
  if (!existsSync(`public/audio/${key}.m4a`)) {
    console.log(`文件不在了：public/audio/${key}.m4a`);
    bad++;
  }
if (measure) bad += measureAll();
const counts = out.reduce<Record<string, number>>((m, r) => ((m[r[4]] = (m[r[4]] ?? 0) + 1), m), {});
console.log(`\n名字表 ${named.length} 个名字；${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('，')}；public/audio 合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
if (bad) {
  console.log(`有 ${bad} 处问题`);
  process.exit(1);
}

/** 复量成品：返回有几处问题（响度、峰值和生成时记下的差太多，接缝有跳变或咔哒）。 */
function measureAll(): number {
  const TMP = 'scratch/work/check';
  mkdirSync(TMP, { recursive: true });
  let issues = 0;
  const rows: string[] = [];
  for (const key of Object.keys(ASSETS).sort()) {
    const file = `public/audio/${key}.m4a`;
    if (!existsSync(file)) continue;
    const wav = `${TMP}/${key.replace('/', '__')}.wav`;
    execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, file, wav], { stdio: 'pipe' });
    const pcm = readWav(readFileSync(wav));
    const meta = ASSETS[key];
    const music = key.startsWith('music/');
    // 解码出来开头多出的编码延迟（浏览器有的去掉、有的不去，运行时按同样的办法量）
    const thr = dbToGain(-50);
    let first = 0;
    while (first < pcm.channels[0].length && !pcm.channels.some((c) => Math.abs(c[first]) > thr)) first++;
    const shift = Math.max(0, Math.min(0.18, first / SR - meta.onset)); // 和 player.ts 的 measureShift 一样（HE-AAC 的配乐约 0.07–0.1 秒）
    const off = Math.round(shift * SR);
    const chs = pcm.channels.map((c) => c.subarray(off));
    let peak = 0;
    for (const c of chs) for (const v of c) peak = Math.max(peak, Math.abs(v));
    const L = loudness(chs, music);
    const dur = chs[0].length / SR;
    const dL = L - meta.lufs;
    const dP = toDb(peak) - meta.peak;
    const warn: string[] = [];
    if (Math.abs(dL) > 1) warn.push(`响度差 ${dL.toFixed(1)}dB`);
    const note = toDb(peak) > 0 ? `（解码后峰值过 0dBFS：AAC 的过冲，播放时增益多半小于 1，主总线还有压限，不算问题）` : '';
    if (Math.abs(dur - meta.dur) > 0.08) warn.push(`时长差 ${(dur - meta.dur).toFixed(2)}s`);
    let seam = '';
    if (music && meta.loopStart !== undefined && meta.loopEnd !== undefined) {
      const r = seamOf(chs, meta.loopStart, meta.loopEnd);
      seam = `  接缝：包络偏离 ${r.env.toFixed(1)}dB，高频（咔哒）比 ${r.click.toFixed(2)}，接缝前 1 秒的频谱相似 ${r.spec.toFixed(2)}`;
      if (r.env > 3) warn.push('接缝处的响度和顺着放下来差得多');
      if (r.click > 3) warn.push('接缝处有咔哒（高频突增）');
      if (r.spec < 0.8) warn.push('接缝前后不像同一段音乐');
    }
    if (warn.length) issues++;
    rows.push(`${key.padEnd(24)} ${dur.toFixed(2).padStart(7)}s  响度 ${L.toFixed(1).padStart(6)}（记 ${meta.lufs.toFixed(1)}）  峰值 ${toDb(peak).toFixed(1).padStart(5)}（记 ${meta.peak.toFixed(1)}，差 ${dP.toFixed(1)}）${note}${seam}${warn.length ? '  ← ' + warn.join('、') : ''}`);
  }
  console.log('\n---- 复量成品（--measure）----');
  console.log(rows.join('\n'));
  return issues;
}

/**
 * 按播放器的接法拼出接缝（player.ts：一段放到循环终点，最后 50ms 交叉淡入从「循环起点前 50ms」开始的下一段），
 * 和「顺着放过循环起点」（第一次播放时听到的样子）逐段对照：
 * - 包络偏离：接缝附近每 50ms 的响度，拼出来的比顺着放的差多少 dB（取最大，只比够响的格子）；
 * - 高频比：接缝附近每 3ms 的一阶差分能量（咔哒声在这里突增），拼出来的 / 顺着放的（取最大，分母不低于曲内的中位数）；
 * - 频谱相似：循环终点之前 1 秒和循环起点之前 1 秒的频带能量相关（1 = 一样；交叉的那一段两边越像越听不出来）。
 */
function seamOf(chs: Float32Array[], loopStart: number, loopEnd: number) {
  const XF = 0.05;
  const S = Math.round(loopStart * SR);
  const E = Math.min(chs[0].length, Math.round(loopEnd * SR));
  const X = Math.round(XF * SR);
  const pre = Math.min(S, Math.round(1.0 * SR));
  const post = Math.round(1.0 * SR);
  const mono = (i: number) => chs.reduce((a, x) => a + (x[i] ?? 0), 0) / chs.length;
  const y = new Float32Array(pre + post); // 拼出来的：E 之前（最后 X 与「S - X 起」交叉）→ S 之后
  const r = new Float32Array(pre + post); // 顺着放的：S 之前 → S 之后
  for (let i = 0; i < pre; i++) {
    const u = i >= pre - X ? (i - (pre - X)) / X : 0;
    y[i] = mono(E - pre + i) * (1 - u) + (u ? mono(S - X + (i - (pre - X))) * u : 0);
    r[i] = mono(S - pre + i);
  }
  for (let i = 0; i < post; i++) y[pre + i] = r[pre + i] = mono(S + i);
  const rms = (x: Float32Array, a: number, n: number) => {
    let s = 0;
    for (let i = a; i < a + n; i++) s += (x[i] ?? 0) ** 2;
    return s / n;
  };
  const W = Math.round(0.05 * SR); // 50ms 一格：短了会被鼓点前后差几毫秒带偏（打击乐里 20ms 的格子随便就差好几 dB）
  // 只比够响的那几格（比这一段里最响的一格低 20dB 以内）：几乎无声的格子里差几个 dB 听不出来，按 dB 比会虚高
  const wins: number[] = [];
  for (let a = Math.max(0, pre - X - 2 * W); a < pre + 2 * W; a += W) wins.push(a);
  const loudest = Math.max(...wins.map((a) => Math.max(rms(y, a, W), rms(r, a, W))));
  let env = 0;
  for (const a of wins) {
    const p = rms(y, a, W);
    const q = rms(r, a, W);
    if (Math.max(p, q) < loudest / 100 || Math.max(p, q) < 3e-5) continue; // 3e-5 ≈ -45dBFS：乐句间的空隙里差多少都听不出来
    env = Math.max(env, Math.abs(10 * Math.log10((p + 1e-10) / (q + 1e-10))));
  }
  const C = Math.round(0.003 * SR);
  const hf = (x: Float32Array, a: number) => {
    let s = 0;
    for (let i = Math.max(1, a); i < a + C && i < x.length; i++) s += (x[i] - x[i - 1]) ** 2;
    return s;
  };
  const all: number[] = [];
  for (let a = 1; a + C < r.length; a += C) all.push(hf(r, a));
  all.sort((p, q) => p - q);
  const floor = all[Math.floor(all.length / 2)] || 1e-12;
  let click = 0;
  for (let a = Math.max(1, pre - X - 2 * C); a < pre + 2 * C; a += Math.max(1, Math.floor(C / 3))) click = Math.max(click, hf(y, a) / Math.max(floor, hf(r, a)));
  // 频谱相似：E 之前 1 秒 vs S 之前 1 秒（12 段对数频带，一阶滤波器组）
  const band = (start: number) => {
    const n = SR;
    const out: number[] = [];
    let lo = 60;
    for (let k = 0; k < 12; k++) {
      const hi = lo * 1.9;
      const hp = Math.exp((-2 * Math.PI * lo) / SR);
      const lp = Math.exp((-2 * Math.PI * hi) / SR);
      let p = 0;
      let q = 0;
      let e = 0;
      for (let i = 0; i < n; i++) {
        const v = mono(start + i);
        const h = v - p;
        p = v * (1 - hp) + p * hp;
        q = h * (1 - lp) + q * lp;
        e += q * q;
      }
      out.push(Math.log(e + 1e-9));
      lo = hi;
    }
    return out;
  };
  const A = band(E - SR);
  const B = band(Math.max(0, S - SR));
  const ma = A.reduce((a, b) => a + b, 0) / A.length;
  const mb = B.reduce((a, b) => a + b, 0) / B.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let k = 0; k < A.length; k++) {
    num += (A[k] - ma) * (B[k] - mb);
    da += (A[k] - ma) ** 2;
    db += (B[k] - mb) ** 2;
  }
  return { env, click, spec: num / Math.sqrt(da * db + 1e-12) };
}
