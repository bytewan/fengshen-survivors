// 外围界面（标题、选角、暂停、设置、致谢）的公共部分。
//
// 排版口径（2026-11-10 起，见 ui-scale.ts）：
//  - 画布按 16:9 尽量铺满窗口，不再是整数倍。界面叠在整个窗口上排版，字号按那块 16:9 的画面矩形（frame）的高度取
//    （uiBaseFontPx）：.fs-ui 的 font-size 就是这个基准字号，里面的尺寸一律写 em——字是矢量的楷书（标题书法体、
//    正文文楷，跟着设置里的字体主题变），不再受「像素字 12px 的整数倍」限制，也不再用 CSS zoom。
//  - 像素件（按钮底下的墨痕、卷轴的轴、朱印、滑块的玉牌）仍是像素画：一格 = --p 个 CSS 像素，取最接近「基准字号的
//    十分之一」的整数个物理像素（所以大约 10 格 = 1em，任何 dpr 下每一格都是整数个物理像素，不糊）。
//    带字的像素件（墨痕、卷轴）先按 em 定大小，再取整到格子上、按格数现画一张；窗口变了由所在的层重新量一遍（fittable）。
//  - 成组的按钮（用户：「开局的选项等都得对齐」）：同一组给同一个宽度（inkWidth），字摆在按钮正中；
//    焦点只换颜色（墨 → 朱砂），不改大小和位置。
//
// 按键：所有外围界面共用一个按键栈（捕获阶段挂在 window 上，比游戏自己的监听先拿到），栈顶的处理函数说了算：
// 返回 'consume' 表示这个键归界面（拦下、不给游戏），'pass' 表示放行（比如往文本框里打字）。暂停时
// 栈顶是暂停面板，空格、J 之类的键不会漏给游戏去放神通；松开按键（keyup）从不拦，免得游戏里的方向键卡住。
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';
import { uiBaseFontPx } from './ui-scale.ts';
import { safeBox, safeInsets } from '../render/safe-area.ts';
import type { Bitmap } from '../art/ground.ts';
import { makeInkStroke, makeRoller } from '../art/title.ts';
import { Sfx } from '../audio/sfx.ts';

// ---------- 颜色（与 src/art/palette.ts 一致） ----------

export const C = {
  xuan: '#1a1520',
  wu: '#2e2433',
  dai: '#4a3b4a',
  cang: '#6b5a62',
  yinshu: '#9a8a86',
  gao: '#c9bcae',
  yuebai: '#f2e8d5',
  yin: '#5c1a1b',
  zhu: '#9c2a22',
  zhusha: '#d9452b',
  ju: '#f2814a',
  zhe: '#6b3d1e',
  hupo: '#b06a28',
  teng: '#e0a83a',
  xiang: '#f7dc7a',
  shiqing: '#3f8a9e',
  tianqing: '#7cc4c4',
  zitang: '#4b2a4f',
  lingguang: '#ffe9a8',
};

// ---------- 版面 ----------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface UiFit {
  /** 窗口（CSS 像素）。 */
  w: number;
  h: number;
  /** 那块 16:9 的画面矩形：局内就是画布在页面上的位置，没有画布时（标题页）按窗口算。 */
  frame: Rect;
  /** 基准字号（CSS 像素）= uiBaseFontPx(frame.height)；.fs-ui 里的 1em。 */
  base: number;
  /** 像素件的一格是几个 CSS 像素（整数个物理像素，约等于 base / 10）。 */
  p: number;
  dpr: number;
  /** 触屏（按钮要更大）。 */
  coarse: boolean;
  /** 按钮的高度（CSS 像素，已取整到格子上）：约 2.3em，触屏上不小于 40。 */
  tap: number;
  /** 安全区（刘海、圆角、底部横条占掉的边，CSS 像素）。 */
  safe: { top: number; right: number; bottom: number; left: number };
}

/**
 * 16:9 的画面矩形。局内取画布在页面上的位置（和战斗界面、万宝阁同一个口径）；没有画布时按窗口算：
 * 在扣掉安全区的那一块里居中、尽量大的 16:9——和画布铺满之后的位置一致（stage.ts 的 fitCanvas）。
 */
export function frameRect(): Rect {
  const c = document.querySelector('#stage canvas');
  if (c) {
    const r = c.getBoundingClientRect();
    if (r.width > 8 && r.height > 8) return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const box = safeBox();
  const width = Math.min(box.width, (box.height * 16) / 9);
  const height = (width * 9) / 16;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** 外围界面要这么多个字宽（卷轴面板、两栏的页）：竖着拿的窄手机（不到 27 个字宽）把字号收一点，最小 12 像素。 */
const MIN_UI_EM = 27;

export function uiFit(): UiFit {
  const dpr = window.devicePixelRatio || 1;
  const frame = frameRect();
  const safe = safeInsets();
  const base = Math.min(uiBaseFontPx(frame.height), Math.max(12, Math.floor((innerWidth - safe.left - safe.right) / MIN_UI_EM)));
  const p = Math.max(1, Math.round((base * dpr) / 10)) / dpr;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // 按钮高：约 2.3 个字；触屏上不小于 40 个 CSS 像素（2026-11-11 起，原来 36：手指点得准）
  const tap = Math.ceil(Math.max(coarse ? 40 : 0, base * 2.3) / p - 1e-6) * p;
  return { w: innerWidth, h: innerHeight, frame, base, p, dpr, coarse, tap, safe };
}

/** 版面紧（手机横屏）：窗口只有不到 30 行字高，说明文字要并行、间距要收。 */
export const isCompact = (f: UiFit) => f.h / f.base < 30;

/**
 * 竖着的版面（手机、平板竖着拿；电脑上又高又窄的窗口）：扣掉安全区以后高比宽大。
 * 左右两栏的页（选角、选劫）这时改成上下叠；别的页本来就按窗口居中，照常。
 */
export const isTall = (f: UiFit) => f.h - f.safe.top - f.safe.bottom > f.w - f.safe.left - f.safe.right;

/** 把一个长度取整到物理像素上（面板、像素画的位置都用它，免得落在半个像素上发虚）。 */
export const snapPx = (v: number, f: UiFit) => Math.round(v * f.dpr) / f.dpr;

function applyFit(ui: HTMLElement, f: UiFit) {
  ui.style.fontSize = `${f.base}px`;
  ui.style.setProperty('--p', `${f.p}px`);
  ui.style.setProperty('--tap', `${f.tap}px`);
  ui.classList.toggle('coarse', f.coarse);
  ui.classList.toggle('compact', isCompact(f));
  ui.classList.toggle('tall', isTall(f));
}

/**
 * 像素件的宽度（格数）：按 em 取整到格子上；一格是奇数个物理像素时再凑成偶数格——宽度是偶数个物理像素，
 * 居中摆放时两边才都落在整像素上（不然像素画会被挪半个像素、发虚），成组的东西的中轴也才能严丝合缝。
 */
export function cellsEven(em: number, f: UiFit): number {
  let n = Math.round((em * f.base) / f.p);
  if (Math.round(f.p * f.dpr) % 2 && n % 2) n++;
  return n;
}

/** 要跟着窗口重新量的部件（墨痕按钮、卷轴）：元素 → 重新量的函数。所在的层 refit 时逐个调用。 */
const fitters = new WeakMap<HTMLElement, (f: UiFit) => void>();
function fittable(el: HTMLElement, fn: (f: UiFit) => void) {
  el.dataset.fit = '';
  fitters.set(el, fn);
  fn(uiFit());
}

/**
 * 把 root 里面的部件按给定的口径重新量一遍。设置面板在矮窗口里把各行压矮时用：传进来的 f.tap 是压过的行高，
 * 墨痕按钮就按它重新取笔高（整格），不会比行还高。
 */
export function refitWithin(root: HTMLElement, f: UiFit) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-fit]')) fitters.get(el)?.(f);
}

export interface Layer {
  root: HTMLElement;
  ui: HTMLElement;
  fit: UiFit;
  /** 窗口变了（或调了 refit）：部件重新量过之后调它，各个界面在这里重新摆位置。 */
  onFit: ((f: UiFit) => void) | null;
  /** 重新量一遍、重新摆（窗口变了自动调；换了字体主题、换了内容之后也可以手动调）。 */
  refit(): void;
  dispose(): void;
}

/** 一层铺满窗口的界面（固定定位），里面的 .fs-ui 字号是基准字号、尺寸都写 em。 */
export function mountLayer(id: string, zIndex: number, opaque = false): Layer {
  injectBaseCss();
  const root = document.createElement('div');
  root.id = id;
  root.className = 'fs-layer';
  root.style.zIndex = String(zIndex);
  if (opaque) root.style.background = C.xuan;
  const ui = document.createElement('div');
  ui.className = 'fs-ui';
  root.appendChild(ui);
  document.body.appendChild(root);
  let later = 0;
  const layer: Layer = {
    root,
    ui,
    fit: uiFit(),
    onFit: null,
    refit() {
      layer.fit = uiFit();
      applyFit(ui, layer.fit);
      for (const el of ui.querySelectorAll<HTMLElement>('[data-fit]')) fitters.get(el)?.(layer.fit);
      layer.onFit?.(layer.fit);
    },
    dispose() {
      removeEventListener('resize', onResize);
      clearTimeout(later);
      root.remove();
    },
  };
  // 窗口变了：马上摆一次；画布是另一个监听在改大小，先后说不准，所以稍后再量一次
  const onResize = () => {
    layer.refit();
    clearTimeout(later);
    later = window.setTimeout(() => layer.refit(), 80);
  };
  applyFit(ui, layer.fit);
  addEventListener('resize', onResize);
  return layer;
}

// ---------- 像素图 → 图片地址 ----------

const urlCache = new WeakMap<object, string>();

export function bitmapUrl(b: Bitmap): string {
  let u = urlCache.get(b);
  if (!u) {
    const c = document.createElement('canvas');
    c.width = b.w;
    c.height = b.h;
    c.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
    u = c.toDataURL('image/png');
    urlCache.set(b, u);
  }
  return u;
}

// ---------- 声音 ----------

let shared: Sfx | null = null;
/**
 * 全游戏共用的音效对象（标题、选角、暂停、设置、局内都用这一个，只开一个 AudioContext，设置里调的音量直接作用到局内）。
 * 页面切到后台（切标签页、切应用、锁屏）时整个音频停下，配乐停在原处；回来再接着放——桌面浏览器的后台标签页不会自己停。
 */
export function uiSfx(): Sfx {
  if (!shared) {
    const s = (shared = new Sfx());
    document.addEventListener('visibilitychange', () => (document.hidden ? s.suspend() : s.resume()));
    // 每一次按键 / 点击都叫一下音频：第一次是解锁（iOS、微信要求在用户手势里建 AudioContext），
    // 之后是把被系统停掉的音频叫起来（手机上从后台回来，音频要等下一次手势才肯继续）
    const wake = () => s.unlock();
    // pointerup / click 也挂：有的手机浏览器只把「抬起」算作用户手势，按下那一刻建的 AudioContext 还是停着的
    for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown']) addEventListener(ev, wake, true);
  }
  return shared;
}

/** 第一次按键 / 点击时解锁音频（iOS、微信要求在用户手势里）。全游戏共用的那个（uiSfx）自己已经挂了，不用再调。 */
export function unlockOnGesture(sfx: Sfx) {
  if (sfx === shared) return;
  const go = () => {
    sfx.unlock();
    removeEventListener('pointerdown', go, true);
    removeEventListener('keydown', go, true);
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}

// ---------- 按键栈 ----------

export type KeyVerdict = 'consume' | 'pass' | void;
type KeyHandler = (e: KeyboardEvent) => KeyVerdict;
const keyStack: KeyHandler[] = [];

/** 压入一层按键处理（打开面板时）；返回弹出的函数。 */
export function pushKeys(h: KeyHandler): () => void {
  keyStack.push(h);
  return () => {
    const i = keyStack.lastIndexOf(h);
    if (i >= 0) keyStack.splice(i, 1);
  };
}

let keysHooked = false;
function hookKeys() {
  if (keysHooked) return;
  keysHooked = true;
  addEventListener(
    'keydown',
    (e) => {
      const h = keyStack[keyStack.length - 1];
      if (!h) return;
      const v = h(e);
      if (v === 'consume') {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (v === 'pass') e.stopImmediatePropagation();
    },
    true,
  );
}

export const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'range');

const NEXT = new Set(['arrowdown', 's']);
const PREV = new Set(['arrowup', 'w']);
const RIGHT = new Set(['arrowright', 'd']);
const LEFT = new Set(['arrowleft', 'a']);

/**
 * 在一组按钮之间用方向键（和 WASD）移动焦点，回车 / 空格按下当前的按钮。axis 'v' 上下、'h' 左右、'both' 都行。
 * 返回这个键是否被用掉了。（aria-disabled 的按钮照样能走到、能按：按下去由它自己给「不行」的反馈。）
 */
export function navKeys(e: KeyboardEvent, items: HTMLElement[], axis: 'v' | 'h' | 'both' = 'v'): boolean {
  const k = e.key.toLowerCase();
  const live = items.filter((b) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled);
  if (!live.length) return false;
  const cur = live.indexOf(document.activeElement as HTMLElement);
  const prev = (axis !== 'h' && PREV.has(k)) || (axis !== 'v' && LEFT.has(k));
  const next = (axis !== 'h' && NEXT.has(k)) || (axis !== 'v' && RIGHT.has(k));
  if (prev || next) {
    const n = cur < 0 ? (next ? 0 : live.length - 1) : (cur + (next ? 1 : -1) + live.length) % live.length;
    live[n].focus({ preventScroll: true });
    return true;
  }
  if (k === 'enter' || k === ' ' || k === 'j') {
    if (cur >= 0) live[cur].click();
    else live[0].focus({ preventScroll: true });
    return true;
  }
  return false;
}

// ---------- 样式 ----------

const css = new Set<string>();
export function injectCss(id: string, text: string) {
  if (css.has(id)) return;
  css.add(id);
  const s = document.createElement('style');
  s.dataset.fs = id;
  s.textContent = text;
  document.head.appendChild(s);
}

/** CSS 里的「几格」：calc(var(--p) * n)。 */
export const P = (n: number) => `calc(var(--p) * ${n})`;

interface Stroke {
  ink: string;
  cin: string;
  /** 墨的重心比整笔的正中偏右多少格（负数是偏左）。 */
  lean: number;
}
/**
 * 墨痕的种子不跟着字走：同样大小的按钮是同一笔，成组的按钮（同宽）轮廓一模一样，两头、上下沿都齐；
 * 墨和朱砂也是同一笔，焦点换过去只换颜色，轮廓不变（不会从朱砂边上露出一截墨）。
 */
const STROKE_SEED = 7;
const strokeCache = new Map<string, Stroke>();
/** 按钮底的墨痕（按格数缓存）：墨、朱砂两张图和墨的重心。 */
function stroke(w: number, h: number): Stroke {
  const key = `${w}x${h}`;
  let s = strokeCache.get(key);
  if (!s) {
    const ink = makeInkStroke(w, h, STROKE_SEED + w, 'ink');
    let n = 0;
    let sx = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (ink.data[(y * w + x) * 4 + 3]) {
          n++;
          sx += x + 0.5;
        }
    s = { ink: bitmapUrl(ink), cin: bitmapUrl(makeInkStroke(w, h, STROKE_SEED + w, 'cinnabar')), lean: n ? sx / n - w / 2 : 0 };
    strokeCache.set(key, s);
  }
  return s;
}

const rollerCache = new Map<number, string>();
function rollerUrl(w: number): string {
  let u = rollerCache.get(w);
  if (!u) {
    u = bitmapUrl(makeRoller(w));
    rollerCache.set(w, u);
  }
  return u;
}

let based = false;
function injectBaseCss() {
  if (based) return;
  based = true;
  hookKeys();
  injectCss(
    'fs-base',
    `
.fs-layer { position: fixed; inset: 0; overflow: hidden; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
/* 折行：只在标点、空格处折（keep-all：一个词不会被拆在两行；一句里实在没有标点、放不下时才在任意处折），
   最后一行不留孤零零的一两个字（pretty）；折到行首的开括号收掉左边那半格空（trim-start），各行的左边线才齐 */
.fs-ui { position: absolute; inset: 0; overflow: hidden; font-family: ${FONT_TEXT}; line-height: 1.5; font-weight: normal; font-synthesis: none; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: ${C.wu}; word-break: keep-all; overflow-wrap: break-word; text-wrap: pretty; text-spacing-trim: trim-start; }
.fs-ui * { box-sizing: border-box; }
.fs-ui b, .fs-ui em, .fs-ui i, .fs-ui strong { font-weight: normal; font-style: normal; }
.fs-ui .px, .fs-ui canvas { image-rendering: pixelated; image-rendering: crisp-edges; display: block; }
.fs-ui .brush { font-family: ${FONT_TITLE}; font-weight: normal; }
.fs-ui button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; white-space: nowrap; touch-action: manipulation; }
.fs-ui button:focus { outline: none; }
.fs-ui button:disabled, .fs-ui button[aria-disabled="true"] { cursor: default; }

/* 墨痕按钮：字（书法体）摆在一笔墨（--ink）的正中；得到焦点时那笔墨从左往右「刷」成朱砂（--cin，同一笔、只换颜色）。
   宽 --bw、笔高 --bh 是取整到格子上的 CSS 像素（inkButton 里按 em 算好），焦点不改任何尺寸。
   --bx：整笔往右挪多少，让墨的重心落在按钮正中（飞白那头墨淡，不挪的话字看着偏右）；同宽的按钮挪得一样多。
   只认焦点、不认悬停：鼠标移上去就把焦点给它（inkButton 里），这样任何时候只有一个按钮是亮的 */
.fs-ui .ink { position: relative; isolation: isolate; display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--bw); height: var(--tap); color: ${C.yuebai}; }
.fs-ui .ink::before, .fs-ui .ink::after { content: ''; position: absolute; left: var(--bx, 0px); top: calc((var(--tap) - var(--bh)) / 2); width: var(--bw); height: var(--bh); background: var(--ink) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; z-index: -1; }
.fs-ui .ink::before { transition: opacity .2s; }
.fs-ui .ink::after { background-image: var(--cin); clip-path: inset(0 100% 0 0); transition: clip-path .32s cubic-bezier(.3,.6,.2,1); }
.fs-ui .ink:focus::after { clip-path: inset(0 0 0 0); }
/* 字距加在每个字后面，最后一个字后面那一截用负的外边距收掉，字才真的在正中。字比墨的实心部分矮一截，上下留白 */
.fs-ui .ink .lb { font-family: ${FONT_TITLE}; font-size: 1.2em; line-height: 1; letter-spacing: .18em; margin-right: -.18em; padding-bottom: .04em; transition: color .2s; }
.fs-ui .ink:focus .lb { color: #fff3d6; }
/* 不能按的：整笔变淡、字变灰，大小位置不变。aria-disabled 的照样能得到焦点、能按（按下去由它自己给「不行」的反馈） */
.fs-ui .ink:disabled .lb, .fs-ui .ink[aria-disabled="true"] .lb { color: ${C.gao}; }
.fs-ui .ink:disabled::before, .fs-ui .ink[aria-disabled="true"]::before { opacity: .5; }
.fs-ui .ink:disabled::after { display: none; }
.fs-ui .ink[aria-disabled="true"]::after { opacity: .3; }

/* 卷轴面板：上下两根轴（像素画），中间是装裱的纸（缟色的绫边、月白的画心），展开时纸从上往下放下来 */
.fs-ui .scroll { position: absolute; display: flex; flex-direction: column; align-items: stretch; filter: drop-shadow(0 ${P(2)} 0 rgba(26,21,32,.35)); }
.fs-ui .scroll .rod { height: ${P(7)}; margin: 0 ${P(-6)}; background: var(--rod) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; position: relative; z-index: 2; flex: none; }
.fs-ui .scroll .paper { position: relative; flex: 1; min-height: 0; margin: ${P(-2)} 0; padding: 1.15em 1.6em 1.25em; background: ${C.yuebai}; box-shadow: inset 0 0 0 ${P(4)} ${C.gao}, inset 0 0 0 ${P(5)} ${C.yinshu}, ${P(-1)} 0 0 0 ${C.cang}, var(--p) 0 0 0 ${C.cang}; display: flex; flex-direction: column; overflow: hidden auto; overscroll-behavior: contain; scrollbar-width: none; }
.fs-ui .scroll .paper::-webkit-scrollbar { display: none; }
.fs-ui .scroll h2 { margin: 0 0 .3em; font-family: ${FONT_TITLE}; font-weight: normal; font-size: 1.9em; line-height: 1.3; letter-spacing: .3em; text-indent: .3em; text-align: center; white-space: nowrap; color: ${C.xuan}; }
.fs-ui .scroll .sub { color: ${C.cang}; }
.fs-ui .scroll .hint { color: ${C.cang}; text-align: center; }
.fs-ui .scroll .err { color: ${C.zhu}; text-align: center; min-height: 1.5em; }
.fs-ui .scroll .ok { color: ${C.shiqing}; text-align: center; min-height: 1.5em; }
.fs-ui .scroll .bar { display: flex; justify-content: center; gap: ${P(10)}; flex-wrap: wrap; margin-top: .4em; flex: none; }
.fs-ui .scroll .rule { height: var(--p); margin: .45em .2em; background: ${C.gao}; flex: none; }
.fs-ui .veil { position: absolute; inset: 0; background: rgba(26,21,32,.5); }
.fs-ui.compact .scroll .paper { padding: .8em 1.4em .9em; }
.fs-ui.compact .scroll h2 { font-size: 1.7em; margin-bottom: .15em; }
@media (prefers-reduced-motion: reduce) { .fs-ui .ink::after { transition: none; } }
`,
  );
}

/**
 * 一组墨痕按钮的公共宽度（em）：按最长的那个标签取。整组都传这个值，就同宽、同一条中轴，字离墨痕两头一样远。
 */
export const inkWidth = (...labels: string[]) => Math.max(...labels.map((l) => [...l].length)) * 1.56 + 3.2;

export interface InkOptions {
  /** 语义上的主按钮（打开面板时先把焦点给它）；样子和别的一样，朱砂只表示「当前的焦点」。 */
  primary?: boolean;
  /** 宽度（em）。成组的按钮传同一个 inkWidth(...)；不传就按自己的字数取。 */
  w?: number;
  onClick?: () => void;
}

/** 墨痕按钮的笔高（格数）：约 1.9em，不超过按钮高；和按钮高相差偶数格，上下留一样多，整笔落在整格上。 */
export function inkStrokeCells(f: UiFit): number {
  const th = Math.round(f.tap / f.p);
  let sh = Math.min(th, Math.round((1.9 * f.base) / f.p));
  if ((th - sh) % 2) sh--;
  return sh;
}

/** 一个墨痕按钮。朱砂只表示「当前的焦点」（回车按下的就是它）。 */
export function inkButton(label: string, opts: InkOptions = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `ink${opts.primary ? ' primary' : ''}`;
  b.type = 'button';
  b.innerHTML = `<span class="lb">${label}</span>`;
  const w = opts.w ?? inkWidth(label);
  fittable(b, (f) => {
    const sw = cellsEven(w, f);
    const sh = inkStrokeCells(f);
    const s = stroke(sw, sh);
    b.style.setProperty('--bw', `${sw * f.p}px`);
    b.style.setProperty('--bh', `${sh * f.p}px`);
    b.style.setProperty('--bx', `${snapPx(-s.lean * f.p, f)}px`);
    b.style.setProperty('--ink', `url("${s.ink}")`);
    b.style.setProperty('--cin', `url("${s.cin}")`);
  });
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  // 鼠标移上去就把焦点给它：键盘和鼠标看到的是同一个「当前按钮」
  b.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && !b.disabled) b.focus({ preventScroll: true });
  });
  return b;
}

export interface ScrollPanel {
  el: HTMLElement;
  paper: HTMLElement;
  /** 改纸的宽度（em）。 */
  setWidth(em: number): void;
  /** 展开（从上往下放下来）。 */
  open(): Promise<void>;
  /** 卷起来再移除。 */
  close(): Promise<void>;
}

/** 卷轴面板：width 是纸的宽度（em，窗口放不下时自动收窄）。内容放进 paper。 */
export function scrollPanel(width: number): ScrollPanel {
  const el = document.createElement('div');
  el.className = 'scroll';
  const top = document.createElement('div');
  top.className = 'rod';
  const paper = document.createElement('div');
  paper.className = 'paper';
  const bottom = document.createElement('div');
  bottom.className = 'rod';
  el.append(top, paper, bottom);
  let em = width;
  const fit = (f: UiFit) => {
    // 两头的轴各伸出 6 格，窗口两边再各留半个字
    const max = Math.floor((f.w - f.base) / f.p) - 12;
    let wp = Math.max(40, Math.min(max, cellsEven(em, f)));
    if (Math.round(f.p * f.dpr) % 2 && wp % 2) wp--; // 被窗口夹过之后仍凑成偶数
    el.style.width = `${wp * f.p}px`;
    el.style.setProperty('--rod', `url("${rollerUrl(wp + 12)}")`);
    // 不比窗口（扣掉刘海、底部横条）高：特别矮的窗口（小手机横屏）里纸在里面滑，按钮不会掉到窗口外面去
    el.style.maxHeight = `${Math.max(f.base * 8, f.h - f.safe.top - f.safe.bottom - f.p * 6)}px`;
  };
  fittable(el, fit);
  const ease = 'cubic-bezier(.22,.7,.2,1)';
  return {
    el,
    paper,
    setWidth(v) {
      em = v;
      fit(uiFit());
    },
    async open() {
      const h = paper.offsetHeight;
      const ms = 460;
      paper.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms, easing: ease });
      bottom.animate([{ transform: `translateY(${-h}px)` }, { transform: 'translateY(0)' }], { duration: ms, easing: ease });
      const kids = [...paper.children] as HTMLElement[];
      kids.forEach((c) => c.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: ms + 140, easing: 'ease-out' }));
      await new Promise((r) => setTimeout(r, ms));
    },
    async close() {
      const h = paper.offsetHeight;
      const ms = 300;
      const a = paper.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 100% 0)' }], { duration: ms, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
      bottom.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-h}px)` }], { duration: ms, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
      el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: ms + 80, fill: 'forwards' });
      await a.finished.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 80));
      el.remove();
    },
  };
}

/** 把面板放在窗口（扣掉刘海、底部横条）的正中（取整到物理像素上，免得落在半个像素上）；box 可以换成别的矩形。 */
export function centerIn(el: HTMLElement, f: UiFit, box: Rect = { left: f.safe.left, top: f.safe.top, width: f.w - f.safe.left - f.safe.right, height: f.h - f.safe.top - f.safe.bottom }) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${snapPx(box.left + (box.width - w) / 2, f)}px`;
  el.style.top = `${snapPx(box.top + Math.max(f.p * 3, (box.height - h) / 2), f)}px`;
}

/** 等一会儿（界面动画用）。 */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 屏幕下方一条短提示（纸条），几秒后自己淡出；不挡操作。一行放不下就折行（两头不会伸到窗口外面去），
 * 而且只在句读后面折：每个分句是一块，不会把「标题页」这样的词拆在两行。
 */
export function toast(text: string, ms = 7000) {
  injectCss(
    'fs-toast',
    `#fs-toast { pointer-events: none; }
#fs-toast .note { position: absolute; left: 50%; transform: translateX(-50%); width: max-content; max-width: min(calc(100% - 2em), 30em); padding: .4em 1.1em .45em; text-align: center; text-wrap: balance; color: ${C.wu}; background: ${C.yuebai}; box-shadow: inset 0 0 0 var(--p) ${C.gao}, 0 var(--p) 0 0 ${C.cang}; letter-spacing: .04em; }
#fs-toast .note span { display: inline-block; }`,
  );
  const layer = mountLayer('fs-toast', 8);
  const n = document.createElement('div');
  n.className = 'note';
  for (const clause of text.match(/[^；，。！？：]+[；，。！？：]*/g) ?? [text]) {
    const s = document.createElement('span');
    s.textContent = clause;
    n.appendChild(s);
  }
  layer.ui.appendChild(n);
  // 贴着画面矩形的下沿往上一点（陨落 / 通关面板的下面）；折行之后把纸条收到刚好包住字那么宽
  const place = (f: UiFit) => {
    n.style.bottom = `${snapPx(Math.max(f.h - (f.frame.top + f.frame.height) + f.frame.height * 0.05, f.safe.bottom + f.base * 0.5), f)}px`;
    n.style.width = '';
    const g = document.createRange();
    g.selectNodeContents(n);
    const cs = getComputedStyle(n);
    n.style.width = `${Math.ceil(g.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1}px`;
  };
  layer.onFit = place;
  place(layer.fit);
  n.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(.3em)' }, { opacity: 1, transform: 'translateX(-50%)' }], { duration: 600, easing: 'ease-out' });
  setTimeout(() => {
    n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).finished.then(() => layer.dispose());
  }, ms);
}
