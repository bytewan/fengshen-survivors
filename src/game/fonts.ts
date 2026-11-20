// 字体。用户口径的变化：
// - 2026-11-09：不要规整的系统字体，先全部换成像素体。
// - 2026-11-10（试玩后）：「第一章那个字体（书法标题）就不错，尝试下类似的字体而不是像素」。
//   所以界面（DOM）的字改成楷书一路：标题、横幅、按钮用书法体，正文、说明、数字用文楷；像素体只留给画布里的像素字。
//
// 三套字体（都是 SIL OFL 1.1，文件在 public/fonts/，许可见同目录 LICENSE-*.txt 与 docs/fonts.md）：
// - 书法体 FS Brush：马善政楷书。大标题、章节名、首领名、横幅、主要按钮。
// - 正文体 FS Text：霞鹜文楷 Medium。正文、说明、数字、标签——和书法体同是楷书一路，小字也清楚。
// - 像素体 FS Pixel：缝合像素 12px。只给画布里的像素字（src/render/pixel-text.ts：相生飘字、掉落奖励等），
//   必须按 12px 原尺寸画再整数倍放大。
// 三套都是按源码里会显示出来的字裁的子集（2026-11-12 瘦身：书法体只收名字、标题、按钮这些用书法体的字，正文体、像素体收字符串里的字，
// 详见 tools/fonts/subset.py）：改了界面文字后跑 `.venv/bin/python -I tools/fonts/subset.py`。书法体缺的字落到文楷（字体栈），不是方块。
// 每套又分两份（docs/deploy.md「包体积」）：标题页那几行字的「首屏」子集（几十 KB，打开页面先只下它）和完整子集（几百 KB，标题页出来之后再下）；
// 两份的 unicode-range 互不重叠（src/game/fonts.gen.ts，subset.py 生成），浏览器按字挑用哪一份。
//
// 界面代码一律用 CSS 变量：正文 var(--font-text)，标题 var(--font-title)。不要直接写字体名，也不要再用系统字体。
// 「字体主题」可以在设置里切换（方便用户对比）：kai = 标题书法 + 正文文楷（默认）；brush = 全部书法体。

import { assetUrl } from '../site.ts';
import { FULL_PROBE, REST_RANGE, TITLE_RANGE } from './fonts.gen.ts';

export const PIXEL_FONT = 'FS Pixel';
export const BRUSH_FONT = 'FS Brush';
export const TEXT_FONT = 'FS Text';
/** 书法体的全套字（字体主题「书法」时正文也用书法体才要；平时的书法体只收了名字、标题、按钮这些字，见 tools/fonts/subset.py）。 */
export const BRUSH_FULL_FONT = 'FS Brush Full';

/** CSS font-family：正文（跟随字体主题）。 */
export const FONT_TEXT = 'var(--font-text)';
/** CSS font-family：标题、横幅、主要按钮（书法体）。 */
export const FONT_TITLE = 'var(--font-title)';
/** CSS font-family：书法体（同 FONT_TITLE，旧名字保留）。 */
export const FONT_BRUSH = `"${BRUSH_FONT}", "${TEXT_FONT}", serif`;
/** CSS font-family：像素体。只给画布里的像素字用；界面（DOM）不要再用它。 */
export const FONT_PIXEL = `"${PIXEL_FONT}", monospace`;
/** 像素体的原生字号（像素）。 */
export const PIXEL_FONT_PX = 12;

export type FontTheme = 'kai' | 'brush';
export const FONT_THEMES: Record<FontTheme, { name: string; text: string }> = {
  kai: { name: '文楷', text: `"${TEXT_FONT}", "${BRUSH_FONT}", serif` },
  brush: { name: '书法', text: `"${BRUSH_FULL_FONT}", "${BRUSH_FONT}", "${TEXT_FONT}", serif` },
};

// 完整子集用 swap（2026-11-12）：点「回响」时选角页不再等完整字体（game/preload.ts、title.ts），字没到先用系统的宋体 / 楷体，到了再换成楷书；
// 不用 block——那样没到的字先是空白，最长 3 秒。别处（设置、图鉴、进局……）照旧先等 loadFonts，看不到这一步。
const CSS = `
@font-face { font-family: "${PIXEL_FONT}"; src: url("${assetUrl('fonts/fusion-pixel-12-zh_hans.woff2')}") format("woff2"); font-display: block; }
@font-face { font-family: "${BRUSH_FONT}"; src: url("${assetUrl('fonts/ma-shan-zheng-title.woff2')}") format("woff2"); font-display: block; unicode-range: ${TITLE_RANGE}; }
@font-face { font-family: "${BRUSH_FONT}"; src: url("${assetUrl('fonts/ma-shan-zheng-subset.woff2')}") format("woff2"); font-display: swap; unicode-range: ${REST_RANGE}; }
@font-face { font-family: "${TEXT_FONT}"; src: url("${assetUrl('fonts/lxgw-wenkai-medium-title.woff2')}") format("woff2"); font-display: block; unicode-range: ${TITLE_RANGE}; }
@font-face { font-family: "${TEXT_FONT}"; src: url("${assetUrl('fonts/lxgw-wenkai-medium-subset.woff2')}") format("woff2"); font-display: swap; unicode-range: ${REST_RANGE}; }
@font-face { font-family: "${BRUSH_FULL_FONT}"; src: url("${assetUrl('fonts/ma-shan-zheng-full.woff2')}") format("woff2"); font-display: swap; }
:root { --font-pixel: ${FONT_PIXEL}; --font-brush: ${FONT_BRUSH}; --font-title: ${FONT_BRUSH}; --font-text: ${FONT_THEMES.kai.text}; }
`;

/** 切换字体主题（立即生效；存不存由调用方决定）。 */
export function applyFontTheme(theme: FontTheme) {
  document.documentElement.style.setProperty('--font-text', (FONT_THEMES[theme] ?? FONT_THEMES.kai).text);
  document.documentElement.dataset.fontTheme = theme;
  // 「书法」主题：书法体的全套字（约 600 KB）这时才下；没到之前先用文楷（swap），到了自己换
  if (theme === 'brush') {
    inject();
    void document.fonts.load(`16px "${BRUSH_FULL_FONT}"`, FULL_PROBE).catch(() => {});
  }
}

/** 像素体在 DOM 里的清晰字号：12px 的 k 倍。界面已不用像素体，新代码不要再用它。 */
export const pixelFontSize = (k: number) => `${PIXEL_FONT_PX * Math.max(1, Math.round(k))}px`;

let injected = false;
function inject() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** 等两套界面字体里 text 这些字所在的那几份加载完。 */
const loadUi = (text: string) =>
  Promise.all([document.fonts.load(`32px "${BRUSH_FONT}"`, text), document.fonts.load(`16px "${TEXT_FONT}"`, text)])
    .then(() => undefined)
    .catch((e) => console.warn('字体加载失败，先用后备字体', e));

let titleLoading: Promise<void> | null = null;
/**
 * 注入字体并等标题页要用的那两份（书法体、正文体的首屏子集，合计几十 KB）加载完：标题页出来之前调用。
 * 完整子集和像素体都不在这里等（docs/deploy.md「包体积」）：标题页出来之后 main.ts 在后台下，见 loadFonts、loadPixelFont。
 */
export function loadTitleFonts(): Promise<void> {
  if (titleLoading) return titleLoading;
  inject();
  return (titleLoading = loadUi('封神'));
}

let loading: Promise<void> | null = null;
/** 注入字体并等界面的两套（书法体、正文体）全部加载完：进局、放过场、开实验页之前调用；标题页出来之后 main.ts 就在后台开始下。 */
export function loadFonts(): Promise<void> {
  if (loading) return loading;
  inject();
  return (loading = Promise.all([loadTitleFonts(), loadUi(FULL_PROBE)]).then(() => undefined));
}

let pixelLoading: Promise<void> | null = null;
/** 等像素体加载完（画布里画像素字之前必须先等这个：进局、实验页之前）。标题页出来之后 main.ts 就在后台开始下，进局时多半早就好了。 */
export function loadPixelFont(): Promise<void> {
  if (pixelLoading) return pixelLoading;
  inject();
  pixelLoading = document.fonts
    .load(`12px "${PIXEL_FONT}"`, '封神')
    .then(() => undefined)
    .catch((e) => console.warn('像素体加载失败，先用后备字体', e));
  return pixelLoading;
}
