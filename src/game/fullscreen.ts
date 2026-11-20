// 全屏（2026-11-11 用户：「横竖屏都需要能玩，而且横屏的时候最好是可以全屏，即使不能也要保证画面都看得到」）。
//
// - 支持网页全屏的浏览器（安卓 Chrome、电脑、iPad 的 Safari）：整页 requestFullscreen({ navigationUI: 'hide' })，失败就算了、不报错。
//   手机、平板上第一次点「回响」「联机」时顺手请求一次（autoFullscreen；这台设备上在设置里关过全屏的就不再自动）；电脑上不自动。
//   设置里有「全屏」开关，暂停面板里也能切。
// - iPhone 的 Safari 不能让网页全屏（只有视频能）：画面让开刘海、圆角和底部横条（safe-area.ts），设置里写一句
//   「想全屏：分享 → 添加到主屏幕」（从主屏幕打开就没有浏览器的栏，manifest 里是 fullscreen）。
// - 从主屏幕打开的（isStandalone）本来就没有浏览器的栏：不请求、设置里也不出这一行。
// - 不锁方向：两种方向都能玩（manifest 的 orientation 也是 any）。
// 进出全屏都会改窗口大小（resize），画布和各层界面自己会重排，这里不用管。

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> | void };

/** 这台设备上关过全屏（设置里点了「关」）：以后不再自动请求。只是这台设备的习惯，不进存档码。 */
const NO_AUTO_KEY = 'fs.v1.noAutoFullscreen';

/** 浏览器支不支持网页全屏（iPhone 的 Safari、微信里多半不支持）。 */
export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** 现在是不是全屏。 */
export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** 从主屏幕打开的（「添加到主屏幕」之后）：本来就没有浏览器的栏。 */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone / iPad（新的 iPad 报的是 Mac 的 UA，但有多点触屏）。 */
export function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 设置里要不要出「全屏」开关：支持网页全屏、又不是从主屏幕打开的。 */
export const showFullscreenToggle = () => fullscreenSupported() && !isStandalone();
/** 设置里要不要写「想全屏：分享 → 添加到主屏幕」：iPhone / iPad 上不支持网页全屏、也不是从主屏幕打开的。 */
export const showHomeScreenHint = () => !fullscreenSupported() && !isStandalone() && isAppleMobile();

/** 进全屏（要在点击、按键的处理里同步调，浏览器才认它是用户手势）。失败就算了：返回 false，不报错。 */
export async function enterFullscreen(): Promise<boolean> {
  if (!fullscreenSupported() || isFullscreen()) return isFullscreen();
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    return false;
  }
  return isFullscreen();
}

/** 退出全屏。 */
export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // 退不出来（浏览器自己的全屏、早已退出）：不要紧
  }
}

/**
 * 玩家自己开 / 关全屏（设置、暂停面板里的开关）。关了就记下来：这台设备上以后不再自动请求；开了再取消这个记号。
 */
export async function setFullscreen(on: boolean): Promise<boolean> {
  try {
    if (on) localStorage.removeItem(NO_AUTO_KEY);
    else localStorage.setItem(NO_AUTO_KEY, '1');
  } catch {
    // 存不了（隐私模式）：不要紧
  }
  if (on) return enterFullscreen();
  await exitFullscreen();
  return false;
}

let autoTried = false;
/**
 * 手机、平板上第一次点「回响」「联机」时顺手请求全屏（打开页面后只试一次；电脑上不自动；这台设备上关过的不自动）。
 * 要在点击的处理里同步调。
 */
export function autoFullscreen(): void {
  if (autoTried) return;
  autoTried = true;
  if (!matchMedia('(pointer: coarse)').matches || !showFullscreenToggle() || isFullscreen()) return;
  try {
    if (localStorage.getItem(NO_AUTO_KEY)) return;
  } catch {
    // 读不了存储：照常请求
  }
  const ua = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
  if (ua && !ua.isActive) return; // 不在用户手势里（比如网址带 ?room= 自动进大厅）：请求了也会被拒
  void enterFullscreen();
}

/** 进出全屏时通知一声（设置、暂停面板里的开关跟着变）。返回取消监听的函数。 */
export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  document.addEventListener('webkitfullscreenchange', h);
  return () => {
    document.removeEventListener('fullscreenchange', h);
    document.removeEventListener('webkitfullscreenchange', h);
  };
}
