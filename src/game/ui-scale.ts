// 界面缩放的统一口径（战斗界面、万宝阁、标题 / 选角 / 暂停等都按它来，保证各处字一样大）。
// 界面（DOM）叠在画布的矩形上排版。画布按 16:9 尽量铺满屏幕（不再限定整数倍），所以矩形的大小可以是任意值：
// 手机横屏约 640×360，1080p 全屏是 1920×1080。字号按矩形高度取，不跟「游戏像素」挂钩——字体已经是矢量的楷书，不需要整数倍。

/** 界面的基准字号（CSS 像素）：正文用它，其余按它的倍数（em）取。手机上不小于 14，大屏不超过 28。 */
export const uiBaseFontPx = (canvasCssHeight: number) => Math.max(14, Math.min(28, Math.round(canvasCssHeight / 45 + 5)));

/**
 * 竖屏（画布上面空出一大块）时，战斗界面顶上那一排挪到画布上面的空处（hud.ts 的 .above；窄的、不到 30 个字宽的分两行，.narrow）。
 * 返回挪上去以后那一排占多高（字高的倍数，含它和画布之间的空隙）；上面放不下、不挪时返回 0。
 * 暂停的小牌（pause.ts）也按它判断会不会压到那一排。
 */
export function hudAboveEm(canvasTop: number, canvasW: number, base: number, safeTop: number): number {
  const em = canvasW / base < 30 ? 7.9 : 4.6;
  return canvasTop - safeTop >= (em + 0.8) * base ? em : 0;
}

/** 画布在页面上的矩形（没有画布时退回整个窗口）。 */
export function canvasRect(): DOMRect {
  const c = document.querySelector('#stage canvas') ?? document.querySelector('canvas');
  return c ? c.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
}
