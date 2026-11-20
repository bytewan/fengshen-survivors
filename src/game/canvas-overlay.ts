// 叠在画布上的界面层（战斗界面、对白）共用的一件事：跟着画布在页面上的矩形走，并按 ui-scale.ts 的口径定基准字号。
//
// 画布按 16:9 尽量铺满窗口，不一定是 480×270 的整数倍，所以这里只认画布的 CSS 矩形：
// - 这一层的 left / top / width / height 就是画布矩形；font-size 是 uiBaseFontPx(矩形高度)，里面的尺寸一律用 em；
// - 另给三个 CSS 变量：--w / --h 画布矩形的宽高（px），--u 一个游戏像素是几个 CSS 像素（可以不是整数，像素图用）。
// 只在画布大小或窗口变了的时候重新摆（ResizeObserver + resize），不在每帧里量。
import { hudAboveEm, uiBaseFontPx } from './ui-scale.ts';
import { VIEW_W } from '../render/stage.ts';
import { safeInsets } from '../render/safe-area.ts';

export interface OverlayFit {
  /** 画布矩形（CSS 像素）。 */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 基准字号（CSS 像素）。 */
  base: number;
  /** 一个游戏像素是几个 CSS 像素。 */
  unit: number;
}

export interface CanvasFollower {
  /** 现在的矩形与字号（上一次摆的结果）。 */
  readonly fit: OverlayFit;
  /** 立刻重新量一次、摆一次（矩形没变就什么都不写）。 */
  refit(): OverlayFit;
  dispose(): void;
}

/**
 * 画布上面空出了一大块（手机、平板竖着拿）：战斗界面顶上那一排（气血 / 真气 / 等级、波次、斩敌 / 灵石、首领血条）挪到画布上面的空处，
 * 不压在战场上（竖屏的画面只有横屏的一半多高，那一排压上去要占掉三成）。判据：画布上沿到安全区上沿之间放得下那一排再留点边（ui-scale.ts 的 hudAboveEm）。
 * 正好 16:9 的窗口（电脑 1280×720、1920×1080）和手机横屏都不会这样摆。
 */
export const hudAbove = (f: OverlayFit) => f.width > 0 && hudAboveEm(f.top, f.width, f.base, safeInsets().top) > 0;

/** 画布下面空出了一大块（竖屏）：对白框放到画布下面，不压画面。判据：放得下对白框（约 7.5 行字高）再留点边。 */
export const dialogueBelow = (f: OverlayFit) => f.width > 0 && innerHeight - (f.top + f.height) - safeInsets().bottom >= f.base * 9;

const stageCanvas = () => (document.querySelector('#stage canvas') ?? document.querySelector('canvas')) as HTMLCanvasElement | null;

/**
 * 让 el 跟着画布矩形走。onFit 在矩形或字号变了之后调用（挂上时先调一次）。
 * el 被移出页面时（一局拆掉时 feel.ts 直接按 id 移除这些层）自己把监听摘掉，并调 onGone 让这一层摘掉它自己的监听——
 * 不靠调用方记得 dispose，回到标题再开一局也不会留下上一局的监听。
 */
export function followCanvas(el: HTMLElement, onFit?: (f: OverlayFit) => void, onGone?: () => void): CanvasFollower {
  let fit: OverlayFit = { left: 0, top: 0, width: 0, height: 0, base: 0, unit: 1 };
  let raf = 0;
  let gone = false;
  const refit = (): OverlayFit => {
    if (gone) return fit;
    const c = stageCanvas();
    const r = c ? c.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
    if (r.width <= 0 || r.height <= 0) return fit;
    const base = uiBaseFontPx(r.height);
    if (r.left === fit.left && r.top === fit.top && r.width === fit.width && r.height === fit.height && base === fit.base) return fit;
    fit = { left: r.left, top: r.top, width: r.width, height: r.height, base, unit: r.width / VIEW_W };
    const s = el.style;
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
    s.fontSize = `${base}px`;
    s.setProperty('--w', `${r.width}px`);
    s.setProperty('--h', `${r.height}px`);
    s.setProperty('--u', `${fit.unit}px`);
    onFit?.(fit);
    return fit;
  };
  const onResize = () => {
    refit();
    // 画布自己也是在 resize 里重新定大小的；万一它排在后面（或者推到下一帧才做），下一帧再量一次
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(refit);
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refit());
  const c = stageCanvas();
  if (c) ro?.observe(c);
  // 这一层被移出页面：摘掉全部监听（只看父节点的直接子节点增减，平时不会触发）
  const mo = new MutationObserver(() => {
    if (!el.isConnected) dispose();
  });
  if (el.parentNode) mo.observe(el.parentNode, { childList: true });
  addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  function dispose() {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    ro?.disconnect();
    mo.disconnect();
    removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    onGone?.();
  }
  refit();
  return {
    get fit() {
      return fit;
    },
    refit,
    dispose,
  };
}
