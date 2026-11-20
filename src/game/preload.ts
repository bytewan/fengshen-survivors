// 后台预载（2026-11-12，docs/deploy.md「首次载入与后台预载」）：标题页一画出来就按顺序在后台下后面要用的东西，
// 进度画在标题页角落（一行小字 + 一道金线，全部好了淡掉）和「回响」按钮上（点了还没到时）。
//
// 顺序（STEPS，和 tools/vite-load-plan.ts 的 LOAD_GROUPS 一一对应）：
//   ① 选角、选劫两页（点「回响」就要用，几十 KB）→ ② 完整的界面字体（书法体、正文体，约 1.4 MB）→
//   ③ 战斗那一包（连带 PixiJS 和特效）与像素体 → ④ 联机大厅、修为、图鉴（成就页也在图鉴那一包里）。
// 一组下完才开始下一组：带宽集中给最先要用的；玩家点了别的（联机、修为……）就地 import()，不用排队。
//
// 下载和执行分开：生产构建里先用 <link rel="modulepreload"> 只下载（浏览器顺手在后台解析），不执行；
// 执行（import()，PixiJS 那一包要占主线程几十毫秒）放到开场动画放完之后的空闲时刻，别让开场动画卡；玩家先点了就立即执行。
// 开发服务器上模块不打包、没有清单：直接 import()（下载连带执行），③④ 一样等开场动画放完。
//
// 进度是真的：生产构建按载入清单（window.__FS_LOAD）里各文件的字节，浏览器每下完一个（Resource Timing）就记上；
// 开发服务器上没有清单，按组算（一组好了才算这一组的份量）。
import { loadFonts, loadPixelFont } from './fonts.ts';

interface LoadPlan {
  groups: string[];
  files: Record<string, [number, number]>;
}

type StepKey = 'select' | 'ui-font' | 'battle' | 'lobby' | 'more';

interface Step {
  key: StepKey;
  /** 执行（开发服务器上连带下载）；返回的 Promise 好了这一组就齐了。 */
  run: () => Promise<unknown>;
  /** 开场动画放完、主线程空闲时再执行（下载照样一开始就排上）。 */
  late?: boolean;
  /** 没有清单时（开发服务器）这一组算多少份量。 */
  weight: number;
}

const STEPS: Step[] = [
  { key: 'select', run: () => Promise.all([import('./select.ts'), import('./jie-pick.ts')]), weight: 1 },
  { key: 'ui-font', run: () => loadFonts(), weight: 3 },
  { key: 'battle', run: () => Promise.all([import('./feel.ts'), loadPixelFont()]), late: true, weight: 4 },
  { key: 'lobby', run: () => import('./lobby.ts'), late: true, weight: 1 },
  { key: 'more', run: () => Promise.all([import('./xiuwei.ts'), import('./codex.ts')]), late: true, weight: 1 },
];

const plan: LoadPlan | null = (window as { __FS_LOAD?: LoadPlan | null }).__FS_LOAD ?? null;
const groupOf = (k: StepKey) => (plan ? plan.groups.indexOf(k) : -1);

/** 各组：总字节、已到字节（生产构建）；执行好了没有。 */
const state = new Map<StepKey, { total: number; got: number; ready: boolean; promise: Promise<unknown> | null; fetched: Promise<void> | null }>();
for (const s of STEPS) state.set(s.key, { total: 0, got: 0, ready: false, promise: null, fetched: null });
const fileOf = new Map<string, { bytes: number; key: StepKey }>();
if (plan) {
  for (const [url, [bytes, g]] of Object.entries(plan.files)) {
    const key = plan.groups[g] as StepKey;
    const st = state.get(key);
    if (!st) continue;
    st.total += bytes;
    fileOf.set(url, { bytes, key });
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

// 浏览器每下完一个文件记一次（缓存里拿到的也算：那样一下就满了）
const seen = new Set<string>();
const take = (list: PerformanceEntryList) => {
  let changed = false;
  for (const e of list) {
    let path: string;
    try {
      path = new URL(e.name).pathname;
    } catch {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    const f = fileOf.get(path);
    if (!f) continue;
    state.get(f.key)!.got += f.bytes;
    changed = true;
  }
  if (changed) emit();
};
let observer: PerformanceObserver | null = null;
if (plan) {
  try {
    observer = new PerformanceObserver((l) => take(l.getEntries()));
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    // 太老的浏览器：只按「一组好了」算
  }
}

/** 几组合起来的进度（0..1）。不给就是全部。 */
export function progress(keys: StepKey[] = STEPS.map((s) => s.key)): number {
  let num = 0;
  let den = 0;
  for (const k of keys) {
    const st = state.get(k)!;
    const w = plan && st.total > 0 ? st.total : STEPS.find((s) => s.key === k)!.weight;
    den += w;
    num += st.ready ? w : plan && st.total > 0 ? Math.min(st.got, st.total) : 0;
  }
  return den ? Math.min(1, num / den) : 1;
}

export const isReady = (k: StepKey) => state.get(k)!.ready;

/** 等这一组好了（不催它：后台预载按自己的顺序走）。 */
export function whenReady(k: StepKey): Promise<void> {
  if (isReady(k)) return Promise.resolve();
  return new Promise((r) => {
    const off = onProgress(() => {
      if (!isReady(k)) return;
      off();
      r();
    });
  });
}

/** 进度变了就叫一声；返回取消的函数。 */
export function onProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 只下载、不执行（生产构建：给这一组的每个脚本挂一个 modulepreload）。字体、开发服务器上没有这一步。 */
function fetchOnly(k: StepKey, low: boolean): Promise<void> {
  const st = state.get(k)!;
  if (st.fetched) return st.fetched;
  const g = groupOf(k);
  if (!plan || g < 0) return (st.fetched = Promise.resolve());
  const head = document.head;
  const waits: Promise<void>[] = [];
  for (const [url, [, gi]] of Object.entries(plan.files)) {
    if (gi !== g || !/\.js$/.test(url)) continue;
    if (document.querySelector(`link[href="${url}"]`)) continue; // Vite 的预载小工具挂过了
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.crossOrigin = '';
    if (low) link.setAttribute('fetchpriority', 'low');
    link.setAttribute('href', url);
    waits.push(new Promise((r) => ((link.onload = () => r()), (link.onerror = () => r()))));
    head.appendChild(link);
  }
  return (st.fetched = Promise.all(waits).then(() => undefined));
}

/** 执行这一组（玩家点了就直接调：没下完的就地下）。好了 resolve；失败照样 reject，由调用方报错。 */
export function ensure(k: StepKey): Promise<unknown> {
  const st = state.get(k)!;
  if (st.promise) return st.promise;
  const step = STEPS.find((s) => s.key === k)!;
  st.promise = step.run().then((v) => {
    st.ready = true;
    emit();
    return v;
  });
  st.promise.catch(() => (st.promise = null)); // 失败了下次再要
  return st.promise;
}

const idle = () =>
  new Promise<void>((r) => {
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => r(), { timeout: 1500 });
    else setTimeout(r, 60);
  });

let started = false;
/**
 * 标题页画出来之后调一次：按 STEPS 的顺序在后台下。introDone：开场动画放完（③④ 等它再执行）。
 * 失败了不要紧：用到时会再要一次，那时再报错。
 */
export function startPreload(introDone: Promise<void>, online = false): void {
  if (started) return;
  started = true;
  void (async () => {
    const order = online ? ['lobby', 'ui-font', 'battle', 'select', 'more'] : STEPS.map(s => s.key);
    for (const key of order) {
      const s = STEPS.find(s => s.key === key)!;
      try {
        if (online && s.key === 'lobby') { await ensure('lobby'); continue; }
        if (s.late) {
          await fetchOnly(s.key, true);
          if (!plan) await introDone; // 开发服务器：下载连带执行，一起往后放
          // 执行放到开场动画之后的空闲时刻；下一组的下载不等它
          void introDone
            .then(idle)
            .then(() => ensure(s.key))
            .catch(() => {});
          if (plan) continue;
          await ensure(s.key);
        } else {
          await fetchOnly(s.key, false);
          await ensure(s.key);
        }
      } catch {
        // 这一组没下成：接着下后面的
      }
    }
  })();
}

/** 后台预载全部好了（标题页角落的进度据此淡掉）。 */
export const allReady = () => STEPS.every((s) => state.get(s.key)!.ready);

/** 生产构建里有没有载入清单（开发服务器上没有）。 */
export const hasPlan = () => !!plan;

/** 取消对资源下载的监听（全部好了之后）。 */
export function stopWatching() {
  observer?.disconnect();
  observer = null;
}
