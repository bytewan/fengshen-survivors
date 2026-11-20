// 音效与音乐。优先用 public/audio/ 下的免费公开素材（名字表见 docs/audio.md，名字到文件的对应见 bank.ts，
// 素材的来源与许可见 docs/audio.md 的「来源与许可」）；素材缺失或还没加载好时，用 WebAudio 现场合成的旧音效顶上。
// 分几条总线：音效（素材 + 合成音效 + 魔气的嗡鸣）、音乐（配乐 + 合成的鼓点层，鼓点只在没有配乐时响），都汇到总线。
// 三个音量各管一级：setVolumes({ master, sfx, music })，值是滑块的位置 0..1，平方后换成增益（设置里的三条滑块）。
// 暂停时配乐停在原处（pauseMusic / resumeMusic），页面切到后台时整个音频停下（suspend / resume）。
// 素材每次随机偏一点音高和音量，同名有最短间隔、限声部，一帧打死几十只时只出一两声，不糊成噪音。
// 参考 docs/references/gamedev-skills/audio-design.md。
import { BANK, MUSIC, PENTA, pickupNote, type MusicTrack, type SynthName } from './bank.ts';
import { MusicPlayer, SampleBank, type PlayOpts } from './player.ts';

const semis = (n: number) => Math.pow(2, n / 12);

/** 解锁后先加载的音效：战斗里最常响的那些。 */
const FIRST = ['qiankun.hit', 'qiankun.throw', 'kill', 'pickup', 'hurt', 'drum', 'wave.start', 'wave.end', 'levelup', 'hit.crit', 'ui.click', 'ui.buy'];

/**
 * 音效总线自己的电平（音效音量开到头时的增益）。2026-11-12 从 0.9 降到 0.5（−5dB），配乐同时整体抬 3.5dB（bank.ts 的 MUSIC）：
 * 用户「武器打击的音效不应该盖过背景音乐」，密集战斗时音效的短时响度要比配乐低约 4–6 LU（docs/audio.md「混音」）。
 */
const SFX_LEVEL = 0.5;
/** 越密越轻（Sfx.updateDensity）：一秒里几声以内不压、超过之后每多一声压几 dB、最多压几 dB。 */
const DENSE_FREE = 3;
const DENSE_DB = 0.6;
const DENSE_MAX = 6;
/** 音效总线软限幅自带的补偿增益（dB，scratch 里离线量的：门限 -16、拐点 12、4:1），tameBus 抵掉它。 */
const LIM_MAKEUP_DB = 4.6;
/** 音量滑块的位置（0..1）→ 增益：平方，低音量那一段调起来才细。 */
const gainOf = (v: number) => v * v;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 三个音量：滑块的位置 0..1。 */
export interface Volumes {
  /** 主音量：所有声音。 */
  master: number;
  /** 音效。 */
  sfx: number;
  /** 音乐：配乐和（没有配乐时的）合成鼓点。 */
  music: number;
}

export class Sfx {
  protected ctx: AudioContext | null = null;
  protected master!: GainNode;
  protected sfx!: GainNode;
  /** 音效总线的兜底（tameBus）最后一级：接主音量之前的那个节点（tools/audio/usage.mjs 在这里量音效的响度）。 */
  protected sfxOut!: AudioNode;
  /** 合成后备单独过的一道低通（synBus）：振荡器、噪声、拨弦的高频压下去，再进音效总线。 */
  protected syn!: AudioNode;
  /** 越密越轻（docs/audio.md「混音」）：这一级的增益跟着最近一秒里出了几声走。 */
  protected dense!: GainNode;
  private density = 0;
  private densityAt = 0;
  /** 音乐音量这一级：配乐（MusicPlayer 自己的那级负责淡入淡出和让位）和合成鼓点都接在它下面。 */
  protected musicBus!: GainNode;
  protected drums!: GainNode;
  protected noise!: AudioBuffer;
  protected samples: SampleBank | null = null;
  protected tracks: MusicPlayer | null = null;
  private wantMusic: MusicTrack | null = null;
  private plucks = new Map<number, AudioBuffer>();
  private last = new Map<string, number>();
  private intensity = 0;
  private nextBeat = 0;
  private beat = 0;
  private timer: number | null = null;
  private vol: Volumes = { master: 0.8, sfx: 1, music: 1 };
  private musicHeld = false;
  private suspended = false;

  /** 主音量（0..1）。旧接口，等同 setVolumes({ master })。 */
  get volume() {
    return this.vol.master;
  }
  set volume(v: number) {
    this.setVolumes({ master: v });
  }

  /** 现在的三个音量（滑块位置）。 */
  get volumes(): Readonly<Volumes> {
    return this.vol;
  }

  /**
   * 设三个音量（滑块的位置 0..1，平方后换成增益；只传要改的）。立即生效；还没解锁音频时先记下，解锁时按它建总线。
   * 主音量管所有声音，音效、音乐各自再乘一级。
   */
  setVolumes(v: Partial<Volumes>) {
    for (const k of ['master', 'sfx', 'music'] as const) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this.vol[k] = clamp01(x);
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(gainOf(this.vol.master), t, 0.03);
    this.sfx.gain.setTargetAtTime(SFX_LEVEL * gainOf(this.vol.sfx), t, 0.03);
    this.musicBus.gain.setTargetAtTime(gainOf(this.vol.music), t, 0.03);
  }

  /** 必须在用户的第一次按键或点击里调用（iOS / 微信要求）。之后才开始懒加载素材。 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && !this.suspended) void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = gainOf(this.vol.master);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_LEVEL * gainOf(this.vol.sfx);
    this.dense = ctx.createGain();
    this.sfx.connect(this.dense);
    this.sfxOut = this.tameBus(this.dense);
    this.sfxOut.connect(this.master);
    this.syn = this.synBus();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = gainOf(this.vol.music);
    this.musicBus.connect(this.master);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.5;
    this.drums.connect(this.musicBus);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextBeat = ctx.currentTime + 0.1;
    // 素材：音效进音效总线，音乐单独一条（比音效低，见 bank.ts 的 MUSIC）
    this.samples = new SampleBank(ctx, this.sfx);
    this.tracks = new MusicPlayer(ctx, this.musicBus);
    if (this.musicHeld) this.tracks.pause();
    if (this.wantMusic) this.tracks.play(this.wantMusic);
    void this.samples.preload(FIRST).then(() => {
      // 音效都到了，再把第一章的三首曲子的文件预先下下来（不解码），切换时就快；别的章的曲子在放到前一首时才下（见 music()）
      for (const t of ['battle', 'shop', 'boss'] as const) void this.tracks?.prefetch(t);
    });
    this.timer = window.setInterval(() => {
      this.scheduleDrums();
      this.tracks?.tick();
      this.updateDensity(0);
    }, 50);
    // 调试：控制台里可以 __sfx.play('boss.roar')、__sfx.music('boss') 试听，__sfx.stats() 看加载情况
    (window as unknown as { __sfx?: Sfx }).__sfx = this;
    if (this.suspended) void ctx.suspend();
  }

  /** 调试用：素材加载与音乐播放的概况。 */
  stats() {
    const gains = this.ctx ? { master: this.master.gain.value, sfx: this.sfx.gain.value, music: this.musicBus.gain.value } : null;
    return { ctx: this.ctx?.state ?? 'locked', ...this.samples?.stats(), volumes: { ...this.vol }, gains, musicHeld: this.musicHeld, suspended: this.suspended, music: this.tracks?.stats() ?? null };
  }

  // ---------- 对外：暂停与后台 ----------

  /**
   * 暂停配乐（暂停面板打开时）：很快淡出、停在原处，合成的鼓点层也停；界面音效照常能响。
   * 暂停期间 music() 换曲子只记下，resumeMusic() 时再放。
   */
  pauseMusic() {
    this.musicHeld = true;
    // 页面正切到后台：音频马上要整个停下，淡出的尾巴会留到回来时才响——直接收掉
    const hidden = this.suspended || (typeof document !== 'undefined' && document.hidden);
    this.tracks?.pause(hidden ? 0.02 : undefined);
  }

  /** 继续配乐：从停下的地方接着放。 */
  resumeMusic() {
    this.musicHeld = false;
    this.tracks?.resume();
  }

  /** 页面切到后台：整个音频停下（声音、配乐的进度都冻住，不耗电）。 */
  suspend() {
    this.suspended = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** 页面回到前台：音频接着走（配乐从停下的地方继续；暂停面板还开着的话，配乐等点了「继续」再放）。 */
  resume() {
    this.suspended = false;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  /**
   * 音效总线的兜底（docs/audio.md「尖锐度」）：素材在构建时已经逐个去过尖锐，这里再给所有音效（素材、合成后备、魔气）一道温和的处理，
   * 叠在一起时也不刺：4.5 kHz 起高架衰减 4dB、3 kHz 一带削 2dB、10 kHz 低通，最后一道软限幅（拐点宽、比率不高，只压住叠起来的尖峰）。
   * 返回最后一级（接主音量）。
   */
  protected tameBus(input: AudioNode): AudioNode {
    const ctx = this.ctx!;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 4500;
    shelf.gain.value = -4;
    const dip = ctx.createBiquadFilter();
    dip.type = 'peaking';
    dip.frequency.value = 3000;
    dip.Q.value = 0.9;
    dip.gain.value = -2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 10000;
    lp.Q.value = 0.5;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -16;
    lim.knee.value = 12;
    lim.ratio.value = 4;
    lim.attack.value = 0.004;
    lim.release.value = 0.2;
    // DynamicsCompressor 自带补偿增益（按规范，这组参数在 Chromium 离线量出来是 +4.6dB：-50dBFS 的正弦出来是 -45.4），
    // 这里抵掉它：门限以下的声音原样通过，只有叠起来的尖峰被压
    const makeup = ctx.createGain();
    makeup.gain.value = Math.pow(10, -LIM_MAKEUP_DB / 20);
    input.connect(shelf).connect(dip).connect(lp).connect(lim).connect(makeup);
    return makeup;
  }

  /** 合成后备的那道低通（2.4 kHz）与 2 kHz 起的高架衰减：现场合成的振荡器、噪声、拨弦都过它，再进音效总线。 */
  protected synBus(): AudioNode {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 2000;
    shelf.gain.value = -5;
    lp.connect(shelf).connect(this.sfx);
    return lp;
  }

  protected ok(name: string, gapMs: number) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < gapMs) return false;
    this.last.set(name, now);
    return true;
  }

  // ---------- 对外：按名字播放 ----------

  /**
   * 按名字播放一个音效（名字表见 docs/audio.md）：用素材，素材缺失或还没加载好时用对应的合成音效，都没有就不出声。
   * volume 是在名字自己的响度之上再乘的倍数。新特效要出声，优先调这个，不要在各处另写合成代码。
   */
  play(name: string, volume = 1) {
    this.sample(name, { volume });
  }

  /**
   * 切换背景音乐（名字见 bank.ts 的 MusicTrack；按章的战斗曲、首领曲用 chapterMusic 取），null 是停。
   * 循环播放，切换时交叉淡入淡出；还没解锁时记下，解锁后再放。这一首的文件下完之后，顺带把接下来多半要切过去的几首（MUSIC[track].next）也下下来。
   */
  music(track: MusicTrack | null) {
    this.wantMusic = track;
    const t = this.tracks;
    if (!t) return;
    t.play(track);
    const next = track ? (MUSIC[track].next ?? []) : [];
    if (next.length) void t.prefetch(track!).then(() => next.forEach((n) => void t.prefetch(n)));
  }

  /** 播放素材，素材不在时退回合成；返回是否出了声。 */
  protected sample(name: string, o: PlayOpts = {}): boolean {
    const def = BANK[name];
    if (!def || !this.samples || !this.ctx || this.ctx.state !== 'running') return false;
    const r = this.samples.play(name, def, o);
    if (r === 'throttled') return false;
    if (r === 'missing') {
      if (!def.synth) return false;
      this.synth(def.synth);
    }
    if (def.duck) this.duck(def.duck, 0.3 + def.duck);
    this.updateDensity(1);
    return true;
  }

  /**
   * 越密越轻：density ≈ 最近一秒里出了几声（指数衰减，τ = 1 秒）；超过 DENSE_FREE 声以后每多一声压 DENSE_DB，最多压 DENSE_MAX dB。
   * 一帧打死一片、几件法宝一起出手时音效整体退到配乐后面，稀下来再慢慢回来。
   */
  private updateDensity(add: number) {
    const ctx = this.ctx;
    if (!ctx || !this.dense) return;
    const now = performance.now();
    this.density = this.density * Math.exp(-(now - this.densityAt) / 1000) + add;
    this.densityAt = now;
    const db = -Math.min(DENSE_MAX, Math.max(0, this.density - DENSE_FREE) * DENSE_DB);
    this.dense.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, add ? 0.08 : 0.3);
  }

  /** 名字表里的后备：调对应的合成音效（参数取默认）。 */
  protected synth(s: SynthName) {
    switch (s) {
      case 'hit':
        return this.synHit(false);
      case 'kill':
        return this.synKill(0);
      case 'eliteKill':
        return this.synEliteKill();
      case 'pickup':
        return this.synPickup(0);
      case 'throw':
        return this.synThrow();
      case 'hurt':
        return this.synHurt();
      case 'skill':
        return this.synSkill();
      case 'drumHit':
        return this.synDrumHit(true);
      case 'cast':
        return this.synCast();
      case 'orb':
        return this.synOrb();
      case 'dispel':
        return this.synDispel();
      case 'thrust':
        return this.synThrust();
      case 'flame':
        return this.synFlame();
      case 'thunder':
        return this.synThunder();
      case 'slam':
        return this.synSlam();
      case 'ice':
        return this.synIce();
      case 'shield':
        return this.synShield();
      case 'block':
        return this.synBlock();
      case 'silk':
        return this.synSilk();
      case 'levelUp':
        return this.synLevelUp();
      case 'waveEnd':
        return this.synWaveEnd();
      case 'coin':
        return this.synCoin();
    }
  }

  // ---------- 对外：原有的方法（有素材用素材，合成留作后备）----------

  /**
   * 命中（乾坤圈 / 飞刀）：2026-11-12 起命中本身不出声（快而密的法宝，docs/audio.md「武器少出声」），
   * 暴击时偶尔一声柔和的手钟（hit.crit，同名间隔 2.5 秒）。
   */
  hit(crit = false) {
    if (!BANK['qiankun.hit']?.off) this.named('qiankun.hit', () => this.synHit(crit), { volume: crit ? 1.25 : 1 });
    if (crit) this.sample('hit.crit');
  }
  /** 击杀：古筝拨一声，连斩越多音越高（五声音阶往上走，两个八度后回绕）。 */
  kill(combo: number) {
    this.named('kill', () => this.synKill(combo), { index: combo % 10 });
  }
  eliteKill() {
    this.named('kill.elite', () => this.synEliteKill());
  }
  /** 拾取灵石：手钟在一个八度里沿五声音阶打转（现在拾灵石不调它，见 bank.ts 的 pickupNote）。 */
  pickup(streak: number) {
    const n = pickupNote(streak);
    this.named('pickup', () => this.synPickup(streak), { index: n.file, rate: n.rate, volume: streak > 12 ? 0.8 : 1 });
  }
  throw() {
    this.named('qiankun.throw', () => this.synThrow());
  }
  hurt() {
    this.named('hurt', () => this.synHurt());
  }
  /** 神通：大锣 + 战鼓 + 破风，其余声音让位。 */
  skill() {
    this.named('skill', () => this.synSkill());
  }
  /** 精英现身 / 合围：两声战鼓（strong）或一声。 */
  drumHit(strong = true) {
    this.named(strong ? 'wave.start' : 'drum', () => this.synDrumHit(strong));
  }
  /** 鬼火术士蓄力。 */
  cast() {
    this.named('cast', () => this.synCast());
  }
  /** 鬼火放出：一声闷闷的「噗」。 */
  orb() {
    this.named('orb', () => this.synOrb());
  }
  /** 乾坤圈打散鬼火：手钟一声。 */
  dispel() {
    this.named('dispel', () => this.synDispel());
  }
  /** 火尖枪：短促的「嗤」。 */
  thrust() {
    this.named('huojian.thrust', () => this.synThrust());
  }
  /** 九龙神火罩：呼地腾起的火。 */
  flame() {
    this.named('jiulong.burst', () => this.synFlame());
  }
  /** 雷公鞭：噼啪一声。 */
  thunder() {
    this.named('leigong.strike', () => this.synThunder());
  }
  /** 番天印落地 / 护盾破碎：一声闷响。 */
  slam() {
    this.named('fantian.land', () => this.synSlam());
  }
  /** 寒冰幡：冰裂的清脆声。 */
  ice() {
    this.named('hanbing.spike', () => this.synIce());
  }
  /** 杏黄旗护盾升起。 */
  shield() {
    this.named('xinghuang.up', () => this.synShield());
  }
  /** 挡下一次伤害（护盾 / 护心符 / 替身符）。 */
  block() {
    this.named('xinghuang.block', () => this.synBlock());
  }
  /** 混天绫甩出缠绕：丝绸破风。 */
  silk() {
    this.named('pet.wrap', () => this.synSilk());
  }
  /** 升级：古筝一个上行的刮奏。 */
  levelUp() {
    this.named('levelup', () => this.synLevelUp());
  }
  /** 一波开始：战鼓两声；一波结束：一声轻锣。 */
  waveStart() {
    this.drumHit(true);
  }
  waveEnd() {
    this.named('wave.end', () => this.synWaveEnd());
  }
  /** 买东西：铜钱声。 */
  coin() {
    this.named('ui.buy', () => this.synCoin());
  }

  /**
   * 原有方法的共同做法：bank.ts 里标了 off 的不出声；有素材用素材；素材还没到时用合成顶上，
   * 合成也守着这个名字的同名间隔（gap），稀疏的声音不会因为素材没到就密起来。
   */
  private named(name: string, fallback: () => void, o: PlayOpts = {}) {
    const def = BANK[name];
    if (def?.off) return;
    if (this.samples?.ready(name)) this.sample(name, o);
    else if (!def || this.ok(`syn:${name}`, def.gap ?? 50)) fallback();
  }

  /** 战况强度 0..1：没有背景音乐时，合成的战鼓越来越密。 */
  setIntensity(x: number) {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  protected duck(amount: number, seconds: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.drums.gain.cancelScheduledValues(t);
    this.drums.gain.setValueAtTime(0.5 * (1 - amount), t);
    this.drums.gain.linearRampToValueAtTime(0.5, t + seconds);
    this.tracks?.duck(amount * 0.7, seconds + 0.2);
  }

  private drone: { g: GainNode; f: BiquadFilterNode } | null = null;
  /** 魔气：身处魔气时一层低沉的嗡鸣，越深越响、越浑（持续的参数化声音，保留合成）。 */
  setMiasma(depth: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.drone) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 200;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = ctx.createOscillator();
      o.frequency.value = 55;
      const og = ctx.createGain();
      og.gain.value = 0.35;
      o.connect(og).connect(g);
      src.connect(f).connect(g).connect(this.sfx); // 算音效：跟着音效音量走
      src.start();
      o.start();
      this.drone = { g, f };
    }
    const t = ctx.currentTime;
    this.drone.g.gain.setTargetAtTime(depth > 0 ? (0.12 + depth * 0.35) / SFX_LEVEL : 0, t, 0.15);
    this.drone.f.frequency.setTargetAtTime(160 + depth * 220, t, 0.2);
  }

  // ---------- 合成音效（后备）----------

  protected env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  protected noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, out: AudioNode = this.syn, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  protected tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, out: AudioNode = this.syn) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 拨弦（Karplus-Strong），近似古筝。按频率缓存。 */
  protected pluck(freq: number, peak: number, t: number, out: AudioNode = this.syn) {
    const ctx = this.ctx!;
    const key = Math.round(freq);
    let buf = this.plucks.get(key);
    if (!buf) {
      const sr = ctx.sampleRate;
      const n = Math.max(2, Math.round(sr / freq));
      const len = Math.round(sr * 1.1);
      buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(n);
      for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const a = ring[idx];
        const b = ring[(idx + 1) % n];
        ring[idx] = (a + b) * 0.5 * 0.9965;
        d[i] = a * (i < 40 ? i / 40 : 1);
        idx = (idx + 1) % n;
      }
      this.plucks.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    src.connect(g).connect(out);
    src.start(t);
  }

  protected synHit(crit: boolean) {
    if (!this.ok('hit', 30)) return;
    const t = this.ctx!.currentTime;
    const v = semis((Math.random() * 2 - 1) * 1.0);
    this.tone(t, 'sine', 520 * v, 300 * v, 0.07, crit ? 0.32 : 0.22);
    this.tone(t, 'triangle', 150 * v, 70, 0.08, crit ? 0.42 : 0.3);
    this.noiseBurst(t, 0.03, 'lowpass', 900, 0.7, 0.12);
    if (crit) this.tone(t + 0.01, 'sine', 523.25 * v, 523.25 * v, 0.18, 0.1);
  }

  protected synKill(combo: number) {
    if (!this.ok('kill', 34)) return;
    const t = this.ctx!.currentTime;
    const step = combo % 10;
    const n = PENTA[step % 5] + 12 * Math.floor(step / 5);
    this.pluck(293.66 * semis(n), 0.55, t);
    this.noiseBurst(t, 0.08, 'lowpass', 1200, 0.7, 0.12);
  }

  protected synEliteKill() {
    if (!this.ok('elite-kill', 200)) return;
    const t = this.ctx!.currentTime;
    for (const n of [0, 7, 12, 16]) this.pluck(110 * semis(n), 0.35, t + n * 0.004);
    this.tone(t, 'sine', 90, 35, 0.6, 0.9);
    this.noiseBurst(t, 0.35, 'lowpass', 900, 0.8, 0.4);
  }

  protected synPickup(streak: number) {
    if (!this.ok('pickup', 40)) return;
    const t = this.ctx!.currentTime;
    const f = 659.25 * semis(PENTA[streak % 5]);
    this.tone(t, 'sine', f, f, 0.14, 0.16);
    this.tone(t, 'sine', f * 2, f * 2, 0.07, 0.03);
  }

  protected synThrow() {
    if (!this.ok('throw', 60)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.14, 'bandpass', 450, 2.5, 0.12, this.syn, 1200);
  }

  protected synHurt() {
    if (!this.ok('hurt', 120)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 140, 45, 0.25, 0.4);
    this.noiseBurst(t, 0.2, 'lowpass', 700, 1, 0.45);
    this.duck(0.35, 0.25);
  }

  /** 神通：铜锣（FM 合成）+ 低频轰鸣 + 风声，其余声音让位。 */
  protected synSkill() {
    if (!this.ok('skill', 300)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = 130.81;
    mod.frequency.value = 130.81 * 1.41;
    modGain.gain.setValueAtTime(900, t);
    modGain.gain.exponentialRampToValueAtTime(20, t + 2.2);
    mod.connect(modGain).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.55, 0.005, 2.4);
    car.connect(g).connect(this.syn);
    car.start(t);
    mod.start(t);
    car.stop(t + 2.6);
    mod.stop(t + 2.6);
    this.tone(t, 'sine', 70, 28, 0.9, 1.0);
    this.noiseBurst(t, 0.6, 'bandpass', 300, 0.8, 0.5, this.syn, 1600);
    this.duck(0.5, 0.6);
  }

  protected synDrumHit(strong: boolean) {
    if (!this.ok('drumhit', 150)) return;
    const t = this.ctx!.currentTime;
    for (const dt of strong ? [0, 0.18] : [0]) {
      this.tone(t + dt, 'sine', 85, 42, 0.35, 0.9);
      this.noiseBurst(t + dt, 0.06, 'lowpass', 1500, 0.8, 0.3);
    }
  }

  protected synCast() {
    if (!this.ok('cast', 120)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.4, 'bandpass', 260, 3, 0.08, this.syn, 1000);
  }

  protected synOrb() {
    if (!this.ok('orb', 80)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 240, 120, 0.15, 0.18);
    this.noiseBurst(t, 0.12, 'lowpass', 600, 0.8, 0.12);
  }

  protected synDispel() {
    if (!this.ok('dispel', 60)) return;
    const t = this.ctx!.currentTime;
    for (const [n, d] of [
      [0, 0],
      [7, 0.03],
    ])
      this.tone(t + d, 'sine', 783.99 * semis(n), 783.99 * semis(n), 0.22, 0.09);
  }

  protected synThrust() {
    if (!this.ok('thrust', 70)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.09, 'bandpass', 1100, 1.5, 0.12, this.syn, 500);
    this.tone(t, 'triangle', 330, 160, 0.06, 0.12);
  }

  protected synFlame() {
    if (!this.ok('flame', 150)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.35, 'lowpass', 500, 0.8, 0.22, this.syn, 1600);
  }

  protected synThunder() {
    if (!this.ok('thunder', 90)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.14, 'bandpass', 1000, 0.8, 0.2);
    this.tone(t, 'triangle', 120, 50, 0.14, 0.14);
  }

  protected synSlam() {
    if (!this.ok('slam', 120)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 90, 38, 0.4, 0.75);
    this.noiseBurst(t, 0.25, 'lowpass', 600, 0.8, 0.35);
  }

  protected synIce() {
    if (!this.ok('ice', 70)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 1046.5, 784, 0.14, 0.08);
    this.noiseBurst(t, 0.06, 'bandpass', 1800, 1, 0.05);
  }

  protected synShield() {
    if (!this.ok('shield', 300)) return;
    const t = this.ctx!.currentTime;
    for (const [n, d] of [
      [0, 0],
      [7, 0.06],
      [12, 0.12],
    ])
      this.tone(t + d, 'sine', 523.25 * semis(n), 523.25 * semis(n), 0.25, 0.07);
  }

  protected synBlock() {
    if (!this.ok('block', 100)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 440, 330, 0.14, 0.2);
  }

  protected synSilk() {
    if (!this.ok('silk', 200)) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.22, 'bandpass', 700, 4, 0.07, this.syn, 1500);
  }

  protected synLevelUp() {
    if (!this.ok('levelup', 200)) return;
    const t = this.ctx!.currentTime;
    PENTA.forEach((n, i) => this.pluck(293.66 * semis(n), 0.3, t + i * 0.05));
  }

  protected synWaveEnd() {
    if (!this.ok('waveend', 500)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = 196;
    mod.frequency.value = 196 * 1.41;
    mg.gain.setValueAtTime(400, t);
    mg.gain.exponentialRampToValueAtTime(10, t + 1.6);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.3, 0.005, 1.8);
    car.connect(g).connect(this.syn);
    car.start(t);
    mod.start(t);
    car.stop(t + 2);
    mod.stop(t + 2);
  }

  protected synCoin() {
    if (!this.ok('coin', 60)) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 987.77, 987.77, 0.1, 0.1);
    this.tone(t + 0.07, 'sine', 1318.5, 1318.5, 0.14, 0.08);
  }

  /** 合成的鼓点层：只在没有背景音乐时响，战况越激烈越密（96 BPM 的八分音符）。 */
  private scheduleDrums() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.tracks?.active || this.musicHeld) {
      this.nextBeat = Math.max(this.nextBeat, ctx.currentTime + 0.05);
      return;
    }
    const spb = 60 / 96 / 2;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat;
      const b = this.beat % 8;
      const I = this.intensity;
      if (b === 0 || b === 4) this.tone(t, 'sine', 72, 40, 0.3, 0.25 + 0.5 * I, this.drums);
      if (I > 0.35 && (b === 2 || b === 6)) this.tone(t, 'sine', 95, 55, 0.18, 0.25 * I, this.drums);
      if (I > 0.6 && b % 2 === 1) this.noiseBurst(t, 0.03, 'bandpass', 1800, 0.8, 0.05 * I, this.drums);
      if (I > 0.8 && b === 7) this.tone(t, 'sine', 80, 44, 0.2, 0.4 * I, this.drums);
      this.nextBeat += spb;
      this.beat++;
    }
  }
}

