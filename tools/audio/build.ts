// 音频素材流水线：按 tools/audio/recipes.ts 把下载的公开素材裁剪、混合、转码成 public/audio/ 下的 .m4a，
// 并生成 src/audio/assets.gen.ts（每个文件的时长、音乐的循环点）。
// 用法：node tools/audio/build.ts [下载目录，默认 scratch/downloads] [--only 前缀[,前缀...]] [--credits]
// 下载的素材一律当数据：只交给 afconvert 解码成 WAV，再由这里做裁剪、淡入淡出、滤波、混合、响度归一，最后用 afconvert 编码成 AAC。
// 机器上没有 ffmpeg / sox，只有 macOS 自带的 afconvert，所以剪辑在这里用 JS 做。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readWav, writeWav16, type Pcm } from './wav.ts';
import { slimM4a } from './m4a.ts';
import { SR, biquad, dbToGain, loudness, toDb } from './dsp.ts';
import { MUSIC, SFX, SOURCES, type Layer, type Recipe, type Source } from './recipes.ts';
import { measureSignal, upOf, type Metric } from './sharp.ts';
import { BANK } from '../../src/audio/bank.ts';

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  if (i < 0) return null;
  const v = args[i + 1] ?? '';
  args.splice(i, 2);
  return v;
};
const only = opt('--only')?.split(',').filter(Boolean) ?? null; // 只重做这些前缀的文件（逗号分隔）
const credits = args.includes('--credits');
const DL = args.find((a) => !a.startsWith('--')) ?? 'scratch/downloads';
const TMP = 'scratch/work/build';
mkdirSync(TMP, { recursive: true });

export function sourceOf(src: string): Source | undefined {
  const [a, b] = src.split('/');
  return SOURCES[`${a}/${b}`] ?? SOURCES[a];
}

function decode(src: string): Pcm {
  const path = join(DL, src);
  if (!existsSync(path)) throw new Error(`缺素材：${path}`);
  // 键里带上修改时间：自作配乐（compose/）的 WAV 会重渲，同一路径的内容会变
  const key = createHash('sha1').update(path).update(String(statSync(path).mtimeMs)).digest('hex').slice(0, 16);
  const wav = `${TMP}/${key}.wav`;
  if (!existsSync(wav)) execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEF32@${SR}`, path, wav], { stdio: 'pipe' });
  return readWav(readFileSync(wav));
}

/** 一层素材：取片段 → 去掉这一层自己开头的静音 → 变速（同时变调）→ 反转 → 滤波 → 增益 → 淡入淡出。 */
function renderLayer(l: Layer, channels: number, keepLead: boolean): Float32Array[] {
  const pcm = decode(l.src);
  if (pcm.sampleRate !== SR) throw new Error('采样率不对');
  let chs = pcm.channels;
  if (channels === 1 && chs.length > 1) {
    const m = new Float32Array(chs[0].length);
    for (const c of chs) for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length;
    chs = [m];
  } else if (channels === 2 && chs.length === 1) chs = [chs[0], chs[0].slice()];
  let from = Math.round((l.from ?? 0) * SR);
  const to = Math.min(l.to ? Math.round(l.to * SR) : chs[0].length, chs[0].length);
  if (!keepLead && l.from === undefined) {
    // 每层先对齐到自己的起音，at 才是「这一层的声音从第几秒开始」
    let pk = 0;
    for (const c of chs) for (let i = from; i < to; i++) pk = Math.max(pk, Math.abs(c[i]));
    const thr = Math.max(dbToGain(-60), pk * dbToGain(-45));
    while (from < to - 1 && !chs.some((c) => Math.abs(c[from]) > thr)) from++;
  }
  const pre = chs.map((c) => {
    let x = c.slice(from, to);
    const rate = l.rate ?? 1;
    if (rate !== 1) {
      if (rate > 1) biquad(x, 'lowpass', (SR / 2 / rate) * 0.9); // 变高之前先防混叠
      const n = Math.floor(x.length / rate);
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * rate;
        const j = Math.floor(p);
        const t = p - j;
        y[i] = (x[j] ?? 0) * (1 - t) + (x[j + 1] ?? 0) * t;
      }
      x = y;
    }
    if (l.reverse) x.reverse();
    if (l.highpass) biquad(x, 'highpass', l.highpass);
    if (l.lowpass) biquad(x, 'lowpass', l.lowpass);
    return x;
  });
  // norm：先把这一层（滤波之后）的峰值拉到 norm dBFS，gain 再在这之上加减（各素材录音的电平差得多，叠的时候好估）
  let g = dbToGain(l.gain ?? 0);
  if (l.norm !== undefined) {
    let pk = 0;
    for (const x of pre) for (const v of x) pk = Math.max(pk, Math.abs(v));
    if (pk > 0) g *= dbToGain(l.norm) / pk;
  }
  return pre.map((x) => {
    const fi = Math.round((l.fadeIn ?? 0) * SR);
    const fo = Math.round((l.fadeOut ?? 0) * SR);
    for (let i = 0; i < x.length; i++) {
      let e = g;
      if (fi && i < fi) e *= i / fi;
      if (fo && i > x.length - fo) e *= Math.max(0, (x.length - i) / fo);
      x[i] *= e;
    }
    return x;
  });
}

interface Meta {
  dur: number;
  onset: number; // 成品里第一个高于 -50dBFS 的样本（秒）：运行时据此判断浏览器有没有去掉 AAC 的编码延迟
  loopStart?: number;
  loopEnd?: number;
  lufs: number;
  peak: number;
}

// ---------- 去尖锐（用户 2026-11-12：「所有尖锐的声音都不应该存在。需要降调或者是别的方法。」docs/audio.md「尖锐度」）----------
// 每个音效混好之后过这一道：低通（两级二阶，压掉 8 kHz 往上）、3.5 kHz 起的高架衰减、3 kHz 一带（2–5 kHz，耳朵最敏感、最扎的一段）削一点、整体降调（重采样）。
// 从第 0 档起逐档加重，按「播放时往上最多偏多少」量到「温和」（比 sharp.ts 的门槛再留一点余量）为止；同一个名字的几个变体（x.1 x.2 …）用同一档。
const SOFT_LADDER = [
  { lp: 11000, shelf: -2, dip: -1.5, pitch: 0 },
  { lp: 9000, shelf: -3, dip: -2.5, pitch: -1 },
  { lp: 7500, shelf: -4, dip: -3, pitch: -2 },
  { lp: 6200, shelf: -5, dip: -4, pitch: -3 },
  { lp: 5200, shelf: -6, dip: -4.5, pitch: -4 },
  { lp: 4400, shelf: -7, dip: -5, pitch: -5 },
  { lp: 3700, shelf: -8, dip: -5, pitch: -6 },
  { lp: 3100, shelf: -9, dip: -5, pitch: -7 },
  { lp: 2600, shelf: -10, dip: -5, pitch: -7 },
];
/** 目标：比「温和」的门槛（sharp.ts 的 SOFT）再留一点余量，播放时的随机音量、叠在一起时不至于又冒出来。 */
const SOFT_GOAL = { S: 1.7, hf8: 0.015, mid: 0.32 };
const softOk = (m: Metric) => m.S <= SOFT_GOAL.S && m.hf8 <= SOFT_GOAL.hf8 && m.mid <= SOFT_GOAL.mid;

function soften(chs: Float32Array[], level: number, pitch: boolean): Float32Array[] {
  const L = SOFT_LADDER[level];
  return chs.map((c) => {
    let x = c;
    const semis = pitch ? L.pitch : 0;
    if (semis) {
      const rate = Math.pow(2, semis / 12); // < 1：放慢、变低（不会混叠）
      const n = Math.floor(x.length / rate);
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * rate;
        const j = Math.floor(p);
        const t = p - j;
        y[i] = (x[j] ?? 0) * (1 - t) + (x[j + 1] ?? 0) * t;
      }
      x = y;
    } else x = x.slice();
    biquad(x, 'lowpass', L.lp, 0.707);
    biquad(x, 'lowpass', L.lp, 0.707);
    biquad(x, 'highshelf', 3500, 0.707, L.shelf);
    biquad(x, 'peaking', 3000, 0.9, L.dip);
    return x;
  });
}

/** 成品文件名 → 用到它的名字里往上最多偏几个半音（bank.ts；借用别的名字的文件也算上）。 */
function upOfFile(key: string): number {
  let up = 0;
  for (const [name, d] of Object.entries(BANK)) if (d.files.some((f) => `sfx/${f}` === key)) up = Math.max(up, upOf(name));
  return up;
}
const groupOf = (out: string) => out.replace(/\.m4a$/, '').replace(/\.(\d+|lo|mid|hi)$/, '');
const softLevels = new Map<string, number>(); // 同一组（x.1 x.2 …）定下的档

/**
 * 只做被名字表引用的音效（bank.ts 里没标 off 的名字用到的文件）：标了 off 的（武器少出声）配方留着，成品不做、不进包，
 * 去掉 off 再跑一遍就回来了。
 */
const USED = new Set(Object.values(BANK).filter((d) => !d.off).flatMap((d) => d.files.map((f) => `sfx/${f}.m4a`)));
const BUILT_SFX = SFX.filter((r) => USED.has(r.out));

function mono(chs: Float32Array[]) {
  if (chs.length === 1) return chs[0];
  const m = new Float32Array(chs[0].length);
  for (const c of chs) for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length;
  return m;
}

export const softReport: { out: string; level: number; before: Metric; after: Metric }[] = [];

function mix(r: Recipe): Float32Array[] {
  const channels = r.stereo ? 2 : 1;
  const parts = r.layers.map((l) => ({ at: Math.round((l.at ?? 0) * SR), chs: renderLayer(l, channels, !!r.keepLead) }));
  const len = Math.max(...parts.map((p) => p.at + p.chs[0].length));
  const out = Array.from({ length: channels }, () => new Float32Array(len));
  for (const p of parts)
    for (let c = 0; c < channels; c++) {
      const src = p.chs[c];
      const dst = out[c];
      for (let i = 0; i < src.length; i++) dst[p.at + i] += src[i];
    }
  return out;
}

/** 这个音效自己要到第几档才「温和」（不管同组的别的变体）。 */
function softLevelOf(r: Recipe, out: Float32Array[]): number {
  const up = upOfFile(r.out.replace(/\.m4a$/, ''));
  const pitch = r.soft?.pitch !== false;
  const max = Math.min(SOFT_LADDER.length - 1, r.soft?.max ?? SOFT_LADDER.length - 1);
  let level = r.soft?.min ?? 0;
  const ok = (L: number) => softOk(measureSignal(mono(trimEnds(r, soften(out, L, pitch), pitch ? Math.pow(2, -SOFT_LADDER[L].pitch / 12) : 1)), up));
  while (level < max && !ok(level)) level++;
  return level;
}

/**
 * 去掉开头的静音（游戏音效要一触即发）和结尾的尾巴，再按 maxLen 截短：门限取峰值以下 40dB（音乐 45dB，不低于 -90dBFS）。
 * stretch：去尖锐降了调、整段放慢了多少倍，maxLen 跟着放长（截的还是原来那一段内容，不把铃的余音截掉一半）。
 */
function trimEnds(r: Recipe, out: Float32Array[], stretch = 1): Float32Array[] {
  let peak = 0;
  for (const c of out) for (const v of c) peak = Math.max(peak, Math.abs(v));
  // 尾巴：音效在峰值以下 40dB 就截（2026-11-12 瘦身，原来 45dB；淡出照旧），音乐照旧 45dB。绝对门限放到 -90：滤得很重的音效混出来本身就轻，响度归一在后面
  const thr = Math.max(dbToGain(-90), peak * dbToGain(r.loop ? -45 : -40));
  const loudAt = (i: number) => out.some((c) => Math.abs(c[i]) > thr);
  let s = 0;
  if (!r.keepLead) while (s < out[0].length - 1 && !loudAt(s)) s++;
  let e = out[0].length - 1;
  if (!r.loop) while (e > s && !loudAt(e)) e--;
  if (r.maxLen) e = Math.min(e, s + Math.round(r.maxLen * stretch * SR));
  const res = out.map((c) => c.slice(s, e + 1));
  if (!r.loop) {
    // 结尾淡出（默认 15ms，消掉截断的咔哒声；循环的音乐不淡）。去尖锐时就要算上它：淡掉的尾巴常是低沉的那部分
    const n = res[0].length;
    const fo = Math.min(n, Math.round((r.fadeOut ?? 0.015) * stretch * SR));
    for (const c of res) for (let i = 0; i < fo; i++) c[n - 1 - i] *= Math.pow(i / fo, 1.5);
  }
  return res;
}

function render(r: Recipe): { pcm: Pcm; meta: Meta } {
  let out = mix(r);
  if (!r.loop) {
    // 音效：去尖锐（见上）。档位是同一组（x.1 x.2 …）里要求最高的那个，变体之间听着是同一个东西
    const key = r.out.replace(/\.m4a$/, '');
    const up = upOfFile(key);
    const level = softLevels.get(groupOf(r.out)) ?? softLevelOf(r, out);
    softLevels.set(groupOf(r.out), level);
    out = soften(out, level, r.soft?.pitch !== false);
    softReport.push({ out: r.out, level, before: measureSignal(mono(trimEnds(r, mix(r))), up), after: measureSignal(mono(trimEnds(r, out, Math.pow(2, -(r.soft?.pitch === false ? 0 : SOFT_LADDER[level].pitch) / 12))), up) });
  }
  if (r.loop) {
    // 配乐也去一点尖锐（2026-11-12）：5 kHz 起高架 −3dB、3 kHz 削 1.5dB、12 kHz 低通。比音效轻得多——配乐的亮是乐器本身的，只把镲、铜管顶上那层「嘶」压一压
    out = out.map((c) => {
      const x = c.slice();
      biquad(x, 'highshelf', 5000, 0.707, -3);
      biquad(x, 'peaking', 3000, 0.9, -1.5);
      biquad(x, 'lowpass', 12000, 0.707);
      return x;
    });
  }
  const stretch = r.loop ? 1 : Math.pow(2, -(r.soft?.pitch === false ? 0 : SOFT_LADDER[softLevels.get(groupOf(r.out)) ?? 0].pitch) / 12);
  out = trimEnds(r, out, stretch);
  let peak = 0;
  // 音乐循环：截到 loopEnd，把结尾 xfade 秒和 loopStart 之前的同长片段做交叉，循环点就接得上。
  // 默认等功率交叉；loop.match 时按两段的相关系数 ρ 归一（a² + b² + 2ρab = 1），逐字重复的段落不会在中间鼓起来
  if (r.loop) {
    const S = Math.round(r.loop.start * SR);
    const E = Math.round(r.loop.end * SR);
    const X = Math.round(r.loop.xfade * SR);
    if (S < X || E > out[0].length) throw new Error(`${r.out}: 循环点越界`);
    let rho = 0;
    if (r.loop.match) {
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (const c of out)
        for (let i = 0; i < X; i++) {
          sab += c[E - X + i] * c[S - X + i];
          saa += c[E - X + i] ** 2;
          sbb += c[S - X + i] ** 2;
        }
      rho = Math.max(0, Math.min(1, sab / Math.sqrt(saa * sbb + 1e-12)));
      console.log(`${r.out}: 交叉的两段相关 ρ=${rho.toFixed(3)}`);
    }
    out = out.map((c) => {
      const y = c.slice(0, E);
      for (let i = 0; i < X; i++) {
        const t = (i + 0.5) / X;
        const a = Math.cos((t * Math.PI) / 2);
        const b = Math.sin((t * Math.PI) / 2);
        const k = r.loop!.match ? 1 / Math.sqrt(a * a + b * b + 2 * rho * a * b) : 1;
        y[E - X + i] = (c[E - X + i] * a + c[S - X + i] * b) * k;
      }
      return y;
    });
  }
  // 结尾的淡出在 trimEnds 里；开头的淡入防爆音
  const n = out[0].length;
  if (!r.keepLead) {
    // 音效开头 4ms 的淡入（半余弦）：起音不至于是一道硬边（去尖锐的一部分；原来 2ms 直线淡入只为防爆音）
    const fi = Math.min(n, Math.round((r.loop ? 0.002 : 0.004) * SR));
    for (const c of out) for (let i = 0; i < fi; i++) c[i] *= r.loop ? i / fi : 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
  }
  // 响度归一：音效按最大瞬时响度对齐到 -12，音乐按整体响度对齐到 -17；峰值不超过 -1dBFS
  const L = loudness(out, !!r.loop);
  peak = 0;
  for (const c of out) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const target = r.loud ?? -12;
  const g = Math.min(dbToGain(target - L), dbToGain(-1) / (peak || 1));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= g;
  const on = (() => {
    const t = dbToGain(-50);
    for (let i = 0; i < n; i++) if (out.some((c) => Math.abs(c[i]) > t)) return i / SR;
    return 0;
  })();
  return {
    pcm: { sampleRate: SR, channels: out },
    // 循环点按整样本记下（运行时就用这两个值）
    meta: { dur: n / SR, onset: on, loopStart: r.loop ? Math.round(r.loop.start * SR) / SR : undefined, loopEnd: r.loop ? Math.round(r.loop.end * SR) / SR : undefined, lufs: L + toDb(g), peak: toDb(peak * g) },
  };
}

// afconvert 写的 m4a 头里带时间戳，同样的输入每次编码出的字节也不同；记下上次编码的输入摘要，没变就不重编，免得 git 里平白多出改动
const CACHE = `${TMP}/encoded.json`;
const encoded: Record<string, string> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

function encode(pcm: Pcm, out: string, kbps: number, codec: 'aac' | 'aach' = 'aac') {
  mkdirSync(dirname(out), { recursive: true });
  const bytes = writeWav16(pcm);
  const digest = createHash('sha1').update(bytes).update(String(kbps)).update(codec === 'aac' ? '' : codec).digest('hex');
  if (encoded[out] !== digest || !existsSync(out)) {
    const wav = `${TMP}/out-${createHash('sha1').update(out).digest('hex').slice(0, 12)}.wav`;
    writeFileSync(wav, bytes);
    execFileSync('afconvert', ['-f', 'm4af', '-d', codec, '-b', String(kbps * 1000), '--no-filler', wav, out], { stdio: 'pipe' });
    encoded[out] = digest;
    writeFileSync(CACHE, JSON.stringify(encoded, null, 1));
  }
  // 去掉 afconvert 留的空白和编码器信息（m4a.ts；已经去过的原样不动）
  const raw = readFileSync(out);
  const slim = slimM4a(raw);
  if (slim !== raw) writeFileSync(out, slim);
}

if (credits) {
  // 「来源与许可」：一张来源表（编号、作者、许可、网址），一张逐文件表（每个成品文件用了哪些来源里的哪个原始文件）。
  // 加 --write 时直接替换 docs/audio.md 里两个标记之间的内容。
  const all = [...BUILT_SFX, ...MUSIC];
  const srcs: Source[] = [];
  for (const r of all)
    for (const l of r.layers) {
      const s = sourceOf(l.src);
      if (!s) throw new Error(`recipes.ts 的 SOURCES 里没有 ${l.src}`);
      if (!srcs.includes(s)) srcs.push(s);
    }
  srcs.sort((a, b) => (a.license === b.license ? 0 : a.license === 'CC0' ? 1 : -1));
  const id = (s: Source) => `S${srcs.indexOf(s) + 1}`;
  const lines: string[] = [];
  lines.push('| 编号 | 素材 | 作者 | 许可 | 网址 |', '|---|---|---|---|---|');
  for (const s of srcs) lines.push(`| ${id(s)} | ${s.title}${s.note ? `（${s.note}）` : ''} | ${s.author} | ${s.license} | <${s.url}> |`);
  lines.push('', '| 文件（public/audio/） | 用到的素材（来源编号：原始文件） | 许可 |', '|---|---|---|');
  for (const r of all) {
    const by = new Map<string, string[]>();
    for (const l of r.layers) {
      const k = id(sourceOf(l.src)!);
      const file = l.src.split('/').pop()!.replace(/\.(wav|ogg|flac|mp3)$/, '');
      const list = by.get(k) ?? [];
      if (!list.includes(file)) list.push(file);
      by.set(k, list);
    }
    const lic = [...new Set(r.layers.map((l) => sourceOf(l.src)!.license))].join(' + ');
    lines.push(`| \`${r.out}\` | ${[...by].map(([k, f]) => `${k}：${f.join('、')}`).join('；')} | ${lic} |`);
  }
  const text = lines.join('\n');
  // 随游戏发布的致谢文件（CC-BY 要求注明作者、作品名、许可与链接；CC0 的顺带列出）
  const byLic = (lic: string) => srcs.filter((s) => s.license === lic);
  const credits = [
    '封神幸存者：回响 —— 音效与音乐的来源与许可',
    '',
    '需要署名（CC-BY 4.0，已截取、循环处理）：',
    ...byLic('CC-BY 4.0').map((s) => `  ${s.title} ${s.author}`),
    '  Licensed under Creative Commons: By Attribution 4.0 License',
    '  http://creativecommons.org/licenses/by/4.0/',
    '',
    '公有领域（CC0，无需署名，在此致谢）：',
    ...byLic('CC0').map((s) => `  ${s.title} — ${s.author} — ${s.url}`),
    '',
    '逐个文件的来源见源码仓库的 docs/audio.md。',
    '',
  ].join('\n');
  if (args.includes('--write')) {
    const doc = readFileSync('docs/audio.md', 'utf8');
    const a = '<!-- 下面两张表由 `node tools/audio/build.ts --credits --write` 生成 -->';
    const b = '<!-- 生成的表到此为止 -->';
    if (!doc.includes(a) || !doc.includes(b)) throw new Error('docs/audio.md 里没有生成标记');
    writeFileSync('docs/audio.md', doc.slice(0, doc.indexOf(a) + a.length) + '\n\n' + text + '\n\n' + doc.slice(doc.indexOf(b)));
    writeFileSync('public/audio/CREDITS.txt', credits);
    console.log('已写入 docs/audio.md 与 public/audio/CREDITS.txt');
  } else console.log(text + '\n\n' + credits);
} else {
  let total = 0;
  const metas: Record<string, Meta> = {};
  const metaFile = 'src/audio/assets.gen.ts';
  if (only && existsSync(metaFile)) {
    // 只重做一部分时保留其余文件的元数据
    const m = readFileSync(metaFile, 'utf8').match(/= (\{[\s\S]*\});/);
    if (m) Object.assign(metas, JSON.parse(m[1]));
    // 不再做的（例如标了 off 的名字的文件）从元数据里去掉
    const keep = new Set([...BUILT_SFX, ...MUSIC].map((r) => r.out.replace(/\.m4a$/, '')));
    for (const k of Object.keys(metas)) if (!keep.has(k)) delete metas[k];
  }
  // 去尖锐的档位：先把每一组（x.1 x.2 …）要的最高档定下来（只重做一部分时，同组的也要量，变体之间才一致）
  const groups = new Set(BUILT_SFX.filter((r) => !only || only.some((p) => r.out.startsWith(p))).map((r) => groupOf(r.out)));
  for (const r of BUILT_SFX) {
    const g = groupOf(r.out);
    if (!groups.has(g)) continue;
    softLevels.set(g, Math.max(softLevels.get(g) ?? 0, softLevelOf(r, mix(r))));
  }
  for (const r of [...BUILT_SFX, ...MUSIC]) {
    for (const l of r.layers) if (!sourceOf(l.src)) throw new Error(`${r.out}: 来源 ${l.src} 没在 SOURCES 里登记许可`);
    const key = r.out.replace(/\.m4a$/, '');
    if (only && !only.some((p) => r.out.startsWith(p))) continue;
    const { pcm, meta } = render(r);
    const out = join('public/audio', r.out);
    // 音效默认 48kbps 单声道 AAC-LC（2026-11-12 瘦身，原来 80kbps；音效都去过尖锐、8 kHz 以上本来就没什么，码率低一点听不出来）
    encode(pcm, out, r.kbps ?? 48, r.codec);
    const sz = statSync(out).size;
    total += sz;
    metas[key] = { ...meta, dur: Math.round(meta.dur * 1e6) / 1e6, onset: Math.round(meta.onset * 1e4) / 1e4, lufs: Math.round(meta.lufs * 10) / 10, peak: Math.round(meta.peak * 10) / 10 };
    console.log(`${r.out.padEnd(32)} ${meta.dur.toFixed(2).padStart(7)}s ${(sz / 1024).toFixed(1).padStart(7)} KB  响度 ${meta.lufs.toFixed(1)}  峰值 ${meta.peak.toFixed(1)}`);
  }
  const sorted = Object.fromEntries(Object.entries(metas).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(
    metaFile,
    `// 由 tools/audio/build.ts 生成，不要手改：public/audio/ 下每个文件的时长、首个声音的位置、音乐的循环点、响度。\n` +
      `export interface AssetMeta {\n  dur: number;\n  onset: number;\n  loopStart?: number;\n  loopEnd?: number;\n  lufs: number;\n  peak: number;\n}\n\n` +
      `export const ASSETS: Record<string, AssetMeta> = ${JSON.stringify(sorted, null, 2)};\n`,
  );
  console.log(`本次 ${(total / 1024 / 1024).toFixed(2)} MB`);
  if (softReport.length) {
    const hist = softReport.reduce<Record<number, number>>((m, x) => ((m[x.level] = (m[x.level] ?? 0) + 1), m), {});
    console.log(`去尖锐：各档的个数 ${Object.entries(hist).map(([k, v]) => `第${k}档 ${v}`).join('，')}`);
    const left = softReport.filter((x) => !softOk(x.after));
    if (left.length) console.log(`到了最高档还没到目标的：${left.map((x) => `${x.out}（S ${x.after.S.toFixed(2)}，8k+ ${(x.after.hf8 * 100).toFixed(1)}%，2–5k ${(x.after.mid * 100).toFixed(0)}%）`).join('、')}`);
    writeFileSync(`${TMP}/soften.json`, JSON.stringify(softReport, null, 1));
  }
}
