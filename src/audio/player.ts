// 素材播放：第一次 unlock() 之后懒加载 public/audio/ 下的 .m4a。
// - SampleBank：按名字播放音效（随机音高与音量、同名节流、限声部），素材的响度差由 assets.gen.ts 的测量值抹平。
// - MusicPlayer：背景音乐循环（两段之间短交叉，接缝无咔哒）、切换时交叉淡入淡出、记住各曲停在哪里；
//   pause / resume：暂停时很快淡出、停在原处，继续时从那里接着放。
// 合成音效在 sfx.ts，素材缺失或还没加载好时由它顶上。
import { assetUrl } from '../site.ts';
import { ASSETS } from './assets.gen.ts';
import { BANK, MUSIC, UP_MAX, type MusicTrack, type SfxDef } from './bank.ts';

const BASE = assetUrl('audio/');
const dbToGain = (db: number) => Math.pow(10, db / 20);

function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // 回调写法兼容旧版 Safari
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('decodeAudioData 失败')));
  });
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/**
 * 解码后第一个高于 -50dBFS 的样本比构建时晚了多少秒（浏览器没去掉 AAC 编码延迟时约 0.05 秒，HE-AAC 的配乐约 0.07–0.1 秒），
 * 播放时从这里起，音效才能一触即发、音乐的循环点才对得上。
 */
function measureShift(buf: AudioBuffer, onset: number): number {
  const thr = dbToGain(-50);
  const n = Math.min(buf.length, Math.round(buf.sampleRate * (onset + 0.2)));
  let first = n;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < first; i++)
      if (Math.abs(d[i]) > thr) {
        first = i;
        break;
      }
  }
  return Math.max(0, Math.min(0.18, first / buf.sampleRate - onset));
}

interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
  end: number;
}

export interface PlayOpts {
  volume?: number;
  rate?: number; // 额外的变速（在随机音高之外）
  index?: number; // 指定用 files 里的第几个（古筝按连斩选音）
  delay?: number; // 延后多少秒
}

export class SampleBank {
  private buffers = new Map<string, { buf: AudioBuffer; start: number }>();
  private failed = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  private last = new Map<string, number>();
  private lastFile = new Map<string, number>();
  private voices = new Map<string, Voice[]>();
  private ctx: AudioContext;
  private out: AudioNode;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  private load(file: string): Promise<void> {
    let p = this.loading.get(file);
    if (!p) {
      p = fetchBytes(`${BASE}sfx/${file}.m4a`)
        .then((b) => decode(this.ctx, b))
        .then((buf) => {
          this.buffers.set(file, { buf, start: measureShift(buf, ASSETS[`sfx/${file}`]?.onset ?? 0) });
        })
        .catch((e) => {
          this.failed.add(file);
          console.warn('[audio] 音效加载失败', file, e);
        });
      this.loading.set(file, p);
    }
    return p;
  }

  /** 先加载 first 里的名字，再加载其余全部；同时最多 4 个请求，不和游戏抢带宽。 */
  async preload(first: string[]) {
    const names = [...new Set([...first, ...Object.keys(BANK)])].filter((n) => !BANK[n]?.off);
    const files = [...new Set(names.flatMap((n) => BANK[n]?.files ?? []))];
    let i = 0;
    const worker = async () => {
      while (i < files.length) await this.load(files[i++]);
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  stats() {
    const starts = [...this.buffers.values()].map((b) => b.start);
    return { loaded: this.buffers.size, failed: [...this.failed], pending: this.loading.size - this.buffers.size - this.failed.size, maxStart: Math.max(0, ...starts) };
  }

  /** 这个名字是否有任何一个素材已经可以播放。 */
  ready(name: string): boolean {
    if (BANK[name]?.off) return false;
    return (BANK[name]?.files ?? []).some((f) => this.buffers.has(f));
  }

  /**
   * 按名字播放。返回 'played'、'throttled'（同名间隔太短，故意不响）或 'missing'（素材缺失或还没加载好，调用方用合成音效顶上）。
   */
  play(name: string, def: SfxDef, o: PlayOpts = {}): 'played' | 'throttled' | 'missing' {
    if (def.off) return 'throttled'; // 故意不出声（bank.ts 的 off），也不用合成顶上
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < (def.gap ?? 50)) return 'throttled';
    let k: number;
    if (o.index !== undefined) k = ((o.index % def.files.length) + def.files.length) % def.files.length;
    else {
      // 随机挑一个变体，不连续两次用同一个
      const prev = this.lastFile.get(name) ?? -1;
      k = Math.floor(Math.random() * def.files.length);
      if (def.files.length > 1 && k === prev) k = (k + 1 + Math.floor(Math.random() * (def.files.length - 1))) % def.files.length;
    }
    let file = def.files[k];
    let b = this.buffers.get(file);
    if (!b && o.index === undefined) {
      // 挑中的还没到，有别的变体就先用别的
      const alt = def.files.findIndex((f) => this.buffers.has(f));
      if (alt >= 0) {
        k = alt;
        file = def.files[k];
        b = this.buffers.get(file);
      }
    }
    if (!b) {
      if (!this.failed.has(file)) void this.load(file);
      return 'missing';
    }
    this.last.set(name, now);
    this.lastFile.set(name, k);
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.delay ?? 0);
    // 限声部：超出时让最早的一声 20ms 内淡出
    const list = (this.voices.get(name) ?? []).filter((x) => x.end > ctx.currentTime);
    while (list.length >= (def.voices ?? 4)) {
      const old = list.shift()!;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setTargetAtTime(0, t, 0.006);
      try {
        old.src.stop(t + 0.04);
      } catch {
        /* 已经停了 */
      }
    }
    const meta = ASSETS[`sfx/${file}`];
    const jitter = def.jitter ?? 1.5;
    const pitch = Math.abs(def.pitch ?? 0.6);
    const gain = Math.min(2.5, dbToGain(def.db - (meta?.lufs ?? -14) + (Math.random() * 2 - 1) * jitter) * (o.volume ?? 1));
    // 随机变调：往下最多 pitch，往上最多 UP_MAX（往上偏的那一下最刺）；调用方给的额外变速也不让它往上超过 UP_MAX
    const dev = Math.min((Math.random() * 2 - 1) * pitch, UP_MAX);
    const rate = Math.min(Math.pow(2, ((def.shift ?? 0) + dev) / 12) * (o.rate ?? 1), Math.pow(2, ((def.shift ?? 0) + UP_MAX) / 12));
    const src = ctx.createBufferSource();
    src.buffer = b.buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start(t, b.start);
    const end = t + (b.buf.duration - b.start) / rate;
    src.onended = () => g.disconnect();
    list.push({ src, g, end });
    this.voices.set(name, list);
    return 'played';
  }
}

// ---------- 背景音乐 ----------

const FADE_IN = 1.2;
const FADE_OUT = 1.5;
const HOLD_OUT = 0.25; // 暂停时配乐淡出多快
const HOLD_IN = 0.4; // 继续时淡入多快
const XF = 0.05; // 循环接缝的短交叉（构建时已把结尾混回循环起点之前的那段，这里只为盖住编码在文件末尾的误差）
const LEAD = 3; // 提前多少秒排下一段（后台标签页的定时器会变慢）

interface Segment {
  src: AudioBufferSourceNode;
  g: GainNode;
  t: number; // 开始的音频时钟时间
  off: number; // 从曲子的第几秒（内容时间）开始
  end: number; // 结束的音频时钟时间
}

interface Deck {
  track: MusicTrack;
  buf: AudioBuffer;
  shift: number;
  g: GainNode;
  segs: Segment[];
  nextT: number; // 下一段开始的时钟时间
  loopStart: number;
  loopEnd: number;
  stopping: boolean;
}

export class MusicPlayer {
  private ctx: AudioContext;
  readonly bus: GainNode; // 音乐总线：音量与让位都在这一级
  private want: MusicTrack | null = null;
  private cur: Deck | null = null;
  private old: Deck[] = [];
  private bytes = new Map<MusicTrack, Promise<ArrayBuffer | null>>();
  private decoded = new Map<MusicTrack, { buf: AudioBuffer; shift: number; used: number }>();
  private decoding = new Map<MusicTrack, Promise<boolean>>();
  private pos = new Map<MusicTrack, number>();
  private held = false; // 暂停中：want 照记，不出声
  private heldAt: { track: MusicTrack; off: number } | null = null; // 暂停时哪一首放到了哪儿

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.connect(out);
  }

  /** 正在放或正要放音乐（合成的鼓点层据此让开）。 */
  get active() {
    return this.want !== null;
  }

  /** 先把曲子的文件下下来（不解码），切换时就快。 */
  prefetch(track: MusicTrack) {
    if (!this.bytes.has(track))
      this.bytes.set(
        track,
        fetchBytes(`${BASE}music/${MUSIC[track].file}.m4a`).catch((e) => {
          console.warn('[audio] 音乐加载失败', track, e);
          return null;
        }),
      );
    return this.bytes.get(track)!;
  }

  private ensure(track: MusicTrack): Promise<boolean> {
    if (this.decoded.has(track)) return Promise.resolve(true);
    let p = this.decoding.get(track);
    if (!p) {
      p = this.prefetch(track)
        .then(async (bytes) => {
          if (!bytes) return false;
          // 解码成 32kHz（AAC 96kbps 本来就只到 16kHz 左右），省三分之一内存；不支持就按播放采样率解
          let buf: AudioBuffer;
          try {
            buf = await decode(new OfflineAudioContext(2, 32000, 32000), bytes.slice(0));
          } catch {
            buf = await decode(this.ctx, bytes.slice(0));
          }
          const meta = ASSETS[`music/${MUSIC[track].file}`];
          // 最多留两首解码好的（战斗与整理来回切），其余的释放
          const keep = new Set([track, this.cur?.track, ...this.old.map((d) => d.track)]);
          const others = [...this.decoded].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used);
          while (this.decoded.size >= 2 && others.length) this.decoded.delete(others.shift()![0]);
          this.decoded.set(track, { buf, shift: measureShift(buf, meta?.onset ?? 0), used: performance.now() });
          return true;
        })
        .catch((e) => {
          console.warn('[audio] 音乐解码失败', track, e);
          return false;
        })
        .then((ok) => {
          this.decoding.delete(track);
          return ok;
        });
      this.decoding.set(track, p);
    }
    return p;
  }

  play(track: MusicTrack | null) {
    if (track === this.want) return;
    this.want = track;
    this.heldAt = null; // 换了曲子：不再按「暂停前放到哪儿」接着放
    if (this.cur) this.fadeOut(this.cur);
    this.cur = null;
    if (!track || this.held) return; // 暂停中只记下要放哪一首
    this.launch(track);
  }

  private launch(track: MusicTrack) {
    void this.ensure(track).then((ok) => {
      if (ok && this.want === track && !this.cur && !this.held) this.start(track);
    });
  }

  /** 暂停：很快淡出（seconds 秒），记住这一首放到了哪儿；之后 play() 只记下要放哪一首，等 resume()。 */
  pause(seconds = HOLD_OUT) {
    if (this.held) return;
    this.held = true;
    const d = this.cur;
    if (!d) return;
    this.heldAt = { track: d.track, off: this.position(d, this.ctx.currentTime) };
    this.fadeOut(d, seconds);
    this.cur = null;
  }

  /** 继续：还是暂停前那一首就从停下的地方接着放（首领曲也是）；暂停期间换了曲子就按新曲子自己的规则放。 */
  resume() {
    if (!this.held) return;
    this.held = false;
    if (this.want) this.launch(this.want);
    else this.heldAt = null;
  }

  private start(track: MusicTrack) {
    const d = this.decoded.get(track)!;
    d.used = performance.now();
    const def = MUSIC[track];
    const meta = ASSETS[`music/${def.file}`];
    const ctx = this.ctx;
    const g = ctx.createGain();
    const level = Math.min(1.5, dbToGain(def.db - (meta?.lufs ?? -17)));
    const t = ctx.currentTime + 0.05;
    const loopEnd = Math.min(meta?.loopEnd ?? d.buf.duration, d.buf.duration - d.shift);
    const loopStart = meta?.loopStart ?? 0;
    // 从暂停里回来、还是同一首：接着放、淡入快一些；否则按这首曲子的规则（接着上次 / 从头）
    const resumed = this.heldAt?.track === track ? this.heldAt.off : null;
    this.heldAt = null;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + (resumed === null ? FADE_IN : HOLD_IN));
    g.connect(this.bus);
    const deck: Deck = { track, buf: d.buf, shift: d.shift, g, segs: [], nextT: t, loopStart, loopEnd, stopping: false };
    let off = resumed ?? (def.resume ? (this.pos.get(track) ?? 0) : 0);
    if (off > loopEnd - 2) off = loopStart;
    this.segment(deck, t, off, true);
    this.cur = deck;
  }

  /** 从内容时间 off 起放到 loopEnd，并排好下一段从 loopStart 接上的时间。 */
  private segment(deck: Deck, t: number, off: number, first: boolean) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = deck.buf;
    const g = ctx.createGain();
    src.connect(g).connect(deck.g);
    const dur = deck.loopEnd - off;
    const end = t + dur;
    if (!first) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + XF);
    }
    g.gain.setValueAtTime(1, end - XF);
    g.gain.linearRampToValueAtTime(0, end);
    src.start(t, off + deck.shift);
    src.stop(end + 0.02);
    src.onended = () => g.disconnect();
    deck.segs.push({ src, g, t, off, end });
    deck.nextT = end - XF;
  }

  private fadeOut(deck: Deck, seconds = FADE_OUT) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.pos.set(deck.track, this.position(deck, now));
    deck.stopping = true;
    deck.g.gain.cancelScheduledValues(now);
    deck.g.gain.setValueAtTime(deck.g.gain.value, now);
    deck.g.gain.linearRampToValueAtTime(0, now + seconds);
    for (const s of deck.segs)
      try {
        s.src.stop(now + seconds + 0.05);
      } catch {
        /* 已经停了 */
      }
    this.old.push(deck);
    setTimeout(() => {
      deck.g.disconnect();
      this.old = this.old.filter((d) => d !== deck);
    }, (seconds + 0.3) * 1000);
  }

  private position(deck: Deck, now: number) {
    const s = [...deck.segs].reverse().find((x) => x.t <= now) ?? deck.segs[0];
    return s ? Math.max(0, s.off + (now - s.t)) : 0;
  }

  stats() {
    const d = this.cur;
    const now = this.ctx.currentTime;
    return {
      want: this.want,
      held: this.held,
      playing: d?.track ?? null,
      position: d ? Math.round(this.position(d, now) * 100) / 100 : null,
      segments: d?.segs.length ?? 0,
      shift: d?.shift ?? null,
      sampleRate: d?.buf.sampleRate ?? null,
      decoded: [...this.decoded.keys()],
      fading: this.old.length,
    };
  }

  /** 定时调用（约每 50ms）：提前排好下一段循环。 */
  tick() {
    const deck = this.cur;
    if (!deck || deck.stopping) return;
    const now = this.ctx.currentTime;
    if (deck.nextT - now < LEAD) this.segment(deck, Math.max(deck.nextT, now + 0.02), Math.max(0, deck.loopStart - XF), false);
    deck.segs = deck.segs.filter((s) => s.end > now - 1);
  }

  /** 让位：音乐压低 amount，seconds 秒内恢复。 */
  duck(amount: number, seconds: number) {
    const g = this.bus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.min(g.value, 1 - amount), t);
    g.linearRampToValueAtTime(1, t + seconds);
  }
}
