// 安全区：刘海、圆角、底部横条占掉的那几条边（CSS 像素）。画布（stage.ts 的 fitCanvas）、外围界面（front-ui.ts）、
// 战斗界面都按它让开（2026-11-11 用户：iPhone 上不能全屏时要保证画面完整）。
//
// 读的是 index.html 里 :root 上的四个变量 --sat / --sar / --sab / --sal（上右下左），平时就是 env(safe-area-inset-*)；
// 网址带 ?safe=上,右,下,左（比如 ?safe=47,0,21,47）时 index.html 里的小脚本把它们改成给定的像素数——Chromium 里模拟不出安全区，截图自查用。
// CSS 里要让开安全区的地方也写 var(--sat) 这几个变量（不直接写 env()），这样调试参数对它们一样生效。

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLElement | null = null;
/** 量安全区：一个看不见的元素，四边的内边距写成那四个变量，量出来就是像素数。 */
export function safeInsets(): Insets {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--sat,0px) var(--sar,0px) var(--sab,0px) var(--sal,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string) => Math.max(0, parseFloat(v) || 0);
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

/** 窗口里扣掉安全区剩下的矩形（CSS 像素）：画面就在这里面按 16:9 尽量铺满、居中。 */
export function safeBox(): { left: number; top: number; width: number; height: number } {
  const s = safeInsets();
  return { left: s.left, top: s.top, width: Math.max(1, innerWidth - s.left - s.right), height: Math.max(1, innerHeight - s.top - s.bottom) };
}
