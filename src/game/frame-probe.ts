// 每帧各段花了多少毫秒（docs/perf.md）：模拟（含事件）、表现层各模块、场景的环境、界面、渲染；还有这一帧推了几步模拟、出了多少事件。
// 平时关着（每段只多一次布尔判断）；网址带 ?perf 时打开，并在画面左上角显示帧率和各段耗时（手机上也看得到）；
// 自查脚本用 __feel.perf 读（tools/perf-probe.mjs）。
//
// 一帧的边界：Pixi 时钟里先跑 feel.ts 的 tick（普通优先级），再跑 Application 的渲染（低优先级）。
// begin() 在 tick 开头；lap(段) 在 tick 里各段结尾；beforeRender / afterRender 挂在渲染的前后（优先级比渲染高一点、低一点）。

/** sim：模拟（含事件）；fx：表现层各模块；scene：镜头、场景的环境（含光照图）；ui：战斗界面（DOM）；render：Pixi 渲染。 */
const SECTIONS = ['sim', 'fx', 'scene', 'ui', 'render'] as const;
export type Section = (typeof SECTIONS)[number];
const N = 600; // 记最近这么多帧

export class FrameProbe {
  on = false;
  private t = 0;
  private start = 0;
  private cur = new Float64Array(SECTIONS.length);
  /** 每帧一行：总、各段、步数、事件数。 */
  private rows = new Float64Array(N * (SECTIONS.length + 3));
  private n = 0;
  private head = 0;
  steps = 0;
  events = 0;
  /** 各模块（feel.ts 的 guarded 包的那些）：累计毫秒、调用次数。 */
  private mods = new Map<string, { ms: number; calls: number; max: number }>();
  private hud: HTMLElement | null = null;
  private hudT = 0;

  begin() {
    if (!this.on) return;
    this.start = this.t = performance.now();
    this.cur.fill(0);
    this.steps = this.events = 0;
  }
  lap(s: Section) {
    if (!this.on) return;
    const now = performance.now();
    this.cur[SECTIONS.indexOf(s)] += now - this.t;
    this.t = now;
  }
  /** 模块的一次 onEvent / update 花了多久（feel.ts 的 guarded 里调）。 */
  mod(name: string, ms: number) {
    let m = this.mods.get(name);
    if (!m) this.mods.set(name, (m = { ms: 0, calls: 0, max: 0 }));
    m.ms += ms;
    m.calls++;
    if (ms > m.max) m.max = ms;
  }
  readonly beforeRender = () => {
    if (!this.on) return;
    this.t = performance.now(); // tick 之后、渲染之前别的时钟回调的时间不算进任何一段
  };
  readonly afterRender = () => {
    if (!this.on || !this.start) return;
    this.lap('render');
    const W = SECTIONS.length + 3;
    const o = this.head * W;
    const rows = this.rows;
    rows[o] = this.t - this.start;
    for (let i = 0; i < SECTIONS.length; i++) rows[o + 1 + i] = this.cur[i];
    rows[o + 1 + SECTIONS.length] = this.steps;
    rows[o + 2 + SECTIONS.length] = this.events;
    this.head = (this.head + 1) % N;
    this.n = Math.min(N, this.n + 1);
    this.start = 0;
    this.stamps[this.si] = this.t;
    this.si = (this.si + 1) % this.stamps.length;
    if (this.hud && this.t - this.hudT > 500) {
      this.hudT = this.t;
      const s = this.stats();
      this.hud.textContent = `fps ${s.fps} | ${s.mean.toFixed(1)}ms p95 ${s.p95.toFixed(1)} | sim ${s.sections.sim.toFixed(1)} fx ${s.sections.fx.toFixed(1)} scn ${s.sections.scene.toFixed(1)} ui ${s.sections.ui.toFixed(1)} draw ${s.sections.render.toFixed(1)}${this.note ? ' | ' + this.note() : ''}`;
    }
  };
  /** 画面角上那一行最后再加的字（画质档……）。 */
  note: (() => string) | null = null;

  /** 最近 N 帧的汇总：整帧的中位 / p95、各段平均、最慢的几帧各段的明细、各模块的平均。 */
  stats(spikes = 0) {
    const W = SECTIONS.length + 3;
    const frames: number[][] = [];
    for (let i = 0; i < this.n; i++) {
      const o = ((this.head - this.n + i + N) % N) * W;
      frames.push(Array.from(this.rows.subarray(o, o + W)));
    }
    const tot = frames.map((f) => f[0]).sort((a, b) => a - b);
    const q = (k: number) => tot[Math.min(tot.length - 1, Math.floor(tot.length * k))] ?? 0;
    const mean = tot.reduce((a, b) => a + b, 0) / Math.max(1, tot.length);
    const sections = Object.fromEntries(SECTIONS.map((s, i) => [s, frames.reduce((a, f) => a + f[1 + i], 0) / Math.max(1, frames.length)])) as Record<Section, number>;
    const row = (f: number[]) => ({ total: +f[0].toFixed(2), ...Object.fromEntries(SECTIONS.map((s, i) => [s, +f[1 + i].toFixed(2)])), steps: f[1 + SECTIONS.length], events: f[2 + SECTIONS.length] });
    const slow = spikes > 0 ? [...frames].sort((a, b) => b[0] - a[0]).slice(0, spikes).map(row) : [];
    const mods = [...this.mods.entries()].map(([k, v]) => ({ k, ms: +(v.ms / Math.max(1, frames.length)).toFixed(3), max: +v.max.toFixed(2) })).sort((a, b) => b.ms - a.ms);
    // 帧率：最近一秒里画了几帧（按每帧的耗时倒推不准，直接数时间戳）
    return { frames: frames.length, mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), fps: Math.round(this.fpsNow()), sections, slow, mods };
  }
  /** 最近几帧结束的时刻（数一秒里画了几帧）。 */
  private stamps = new Float64Array(256);
  private si = 0;
  private fpsNow() {
    const now = performance.now();
    let n = 0;
    for (const t of this.stamps) if (now - t <= 1000) n++;
    return n;
  }
  /** 清空（量一段新的之前）。 */
  reset() {
    this.n = this.head = 0;
    this.mods.clear();
  }
  /** 在画面左上角显示一行（?perf）。 */
  showHud() {
    if (this.hud || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'perf-hud';
    el.style.cssText = 'position:fixed;left:4px;top:4px;z-index:50;pointer-events:none;font:11px/1.3 ui-monospace,Menlo,monospace;color:#f2e8d5;background:rgba(20,15,25,.55);padding:2px 6px;border-radius:3px;white-space:nowrap';
    document.body.appendChild(el);
    this.hud = el;
  }
  hideHud() {
    this.hud?.remove();
    this.hud = null;
  }
}

/** 整个页面共用一个（一局一局之间接着用）。 */
export const frameProbe = new FrameProbe();
