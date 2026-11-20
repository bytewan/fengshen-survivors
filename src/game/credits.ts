// 致谢（DOM，卷轴面板）：字体、音乐、音效、引擎的作者与许可。
// - 字体：许可原文随游戏发布（public/fonts/LICENSE-*.txt），见 docs/fonts.md。
// - 音乐与音效：读随游戏发布的 audio/CREDITS.txt（音频工具 `node tools/audio/build.ts --credits --write` 生成，
//   来源表在 docs/audio.md），换了素材这里自动跟着变。配乐（九首）都是 Kevin MacLeod 的作品（CC-BY 4.0），**必须署名**：
//   署名按作者要求的原文格式逐行显示；读文件失败时用下面内置的同一段署名顶上，保证署名一定在。
//   音效全是 CC0（公有领域，不要求署名），列出来致谢。
import { assetUrl } from '../site.ts';
import type { Sfx } from '../audio/sfx.ts';
import { FONT_THEMES } from './fonts.ts';
import { C, centerIn, inkButton, injectCss, navKeys, pushKeys, scrollPanel, type Layer, type UiFit } from './front-ui.ts';

export interface CreditItem {
  name: string;
  by: string;
  license?: string;
  url?: string;
}

/** 字体与引擎（固定的几项）。三个字体各自用在哪儿见 docs/fonts.md。 */
export const FONT_CREDITS: CreditItem[] = [
  { name: '马善政楷书 Ma Shan Zheng（标题、按钮）', by: 'The Ma Shan Zheng Project Authors', license: 'SIL OFL 1.1', url: 'github.com/googlefonts/mashanzheng' },
  { name: '霞鹜文楷 LXGW WenKai（正文）', by: 'LXGW，基于 Klee One（The Klee Project Authors）', license: 'SIL OFL 1.1', url: 'github.com/lxgw/LxgwWenKai' },
  { name: '缝合像素字体 Fusion Pixel Font（画面里的像素字）', by: 'TakWolf', license: 'SIL OFL 1.1', url: 'github.com/TakWolf/fusion-pixel-font' },
];
export const ENGINE_CREDITS: CreditItem[] = [
  { name: 'PixiJS', by: 'PixiJS 团队', license: 'MIT', url: 'pixijs.com' },
  // 像素特效库：一部分特效来自它（按游戏的风格改过）；许可原文随游戏发布在 licenses/pixelfx-LICENSE.txt
  { name: 'pixelfx（像素特效）', by: 'Patch、Hugo Duprez', license: 'MIT', url: 'github.com/patch-gg/pixelfx' },
];

/** 配乐的署名（CC-BY 4.0，作者要求的原文格式）。CREDITS.txt 读不到时用它。 */
export const MUSIC_ATTRIBUTION_FALLBACK = [
  '"Big Mojo" Kevin MacLeod (incompetech.com)',
  '"Guzheng City" Kevin MacLeod (incompetech.com)',
  '"Black Vortex" Kevin MacLeod (incompetech.com)',
  '"Himalayan Atmosphere" Kevin MacLeod (incompetech.com)',
  '"Volatile Reaction" Kevin MacLeod (incompetech.com)',
  '"Hitman" Kevin MacLeod (incompetech.com)',
  '"Nu Flute" Kevin MacLeod (incompetech.com)',
  '"Ripples" Kevin MacLeod (incompetech.com)',
  'Licensed under Creative Commons: By Attribution 4.0 License',
  'http://creativecommons.org/licenses/by/4.0/',
];

export interface AudioCredits {
  /** 需要署名的那一段：标题（如「需要署名（CC-BY 4.0，已截取、循环处理）」）与逐行原文。 */
  attribution: { title: string; lines: string[] };
  /** 公有领域素材（致谢）。 */
  thanks: { title: string; items: CreditItem[] };
}

/** 解析 audio/CREDITS.txt：空行分段，段首一行是标题（以「：」结尾），下面缩进的每行一条。 */
export function parseAudioCredits(text: string): AudioCredits | null {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  let attribution: AudioCredits['attribution'] | null = null;
  let thanks: AudioCredits['thanks'] | null = null;
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim());
    if (lines.length < 2 || !/[：:]\s*$/.test(lines[0])) continue;
    const title = lines[0].trim().replace(/[：:]\s*$/, '');
    const body = lines.slice(1).map((l) => l.trim());
    if (/CC-BY|署名/.test(title) && !/无需署名/.test(title)) attribution = { title, lines: body };
    else if (/CC0|公有领域/.test(title))
      thanks = {
        title,
        items: body.map((l) => {
          const [name, by, url] = l.split(/\s+—\s+/);
          return { name: name ?? l, by: by ?? '', url: url?.replace(/^https?:\/\//, '') };
        }),
      };
  }
  return attribution ? { attribution, thanks: thanks ?? { title: '公有领域', items: [] } } : null;
}

let cached: Promise<AudioCredits> | null = null;
function loadAudioCredits(): Promise<AudioCredits> {
  return (cached ??= fetch(assetUrl('audio/CREDITS.txt'))
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((t) => parseAudioCredits(t) ?? Promise.reject(new Error('格式不对')))
    .catch((e) => {
      console.warn('[credits] 读 audio/CREDITS.txt 失败，用内置的署名', e);
      cached = null;
      return { attribution: { title: '需要署名（CC-BY 4.0，已截取、循环处理）', lines: MUSIC_ATTRIBUTION_FALLBACK }, thanks: { title: '音效：公有领域（CC0）素材', items: [] } };
    }));
}

/** 署名原文、作者名、网址：不跟字体主题走，固定用文楷（书法体的拉丁字母是连笔的，人名和网址不好认，署名要让人看得清）。 */
const PLAIN = FONT_THEMES.kai.text;

const CSS = `
.fs-ui .credits { overflow-y: auto; overscroll-behavior: contain; padding-right: .4em; scrollbar-width: thin; scrollbar-color: ${C.yinshu} transparent; outline: none; --fade: 1.6em; }
/* 正文在卷轴里滚动：上下还有内容的那一头渐隐，不在半行字上切出一条硬边 */
.fs-ui .credits.fb { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - var(--fade)), transparent); mask-image: linear-gradient(180deg, #000 calc(100% - var(--fade)), transparent); }
.fs-ui .credits.ft { -webkit-mask-image: linear-gradient(180deg, transparent, #000 var(--fade)); mask-image: linear-gradient(180deg, transparent, #000 var(--fade)); }
.fs-ui .credits.ft.fb { -webkit-mask-image: linear-gradient(180deg, transparent, #000 var(--fade), #000 calc(100% - var(--fade)), transparent); mask-image: linear-gradient(180deg, transparent, #000 var(--fade), #000 calc(100% - var(--fade)), transparent); }
.fs-ui .credits h3 { margin: .9em 0 .35em; font: inherit; color: ${C.zhu}; letter-spacing: .2em; display: flex; align-items: center; gap: .6em; }
.fs-ui .credits h3::after { content: ''; flex: 1; height: var(--p); background: ${C.gao}; }
.fs-ui .credits h3:first-child { margin-top: 0; }
.fs-ui .credits .it { margin: 0 0 .5em; }
.fs-ui .credits .it .n { color: ${C.xuan}; }
.fs-ui .credits .it .m { font-family: ${PLAIN}; color: ${C.cang}; overflow-wrap: anywhere; }
.fs-ui .credits .att { margin: 0 0 .5em; padding: .4em .7em; font-family: ${PLAIN}; color: ${C.xuan}; background: #fbf5e8; box-shadow: inset 0 0 0 var(--p) ${C.gao}; overflow-wrap: anywhere; }
.fs-ui .credits .att div { white-space: normal; }
.fs-ui .credits .sub { color: ${C.cang}; margin-bottom: .35em; }
.fs-ui .credits .thx b { color: ${C.xuan}; }
.fs-ui .credits .thx div { font-family: ${PLAIN}; }
.fs-ui .credits .thx span { color: ${C.cang}; }
.fs-ui .credits .note { color: ${C.cang}; margin-top: .7em; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** 一条：名字一行，作者一行，许可和地址一行（不用圆点串成一长串：折行时行尾会剩一个孤零零的点）。 */
const itemHtml = (i: CreditItem) =>
  `<div class="it"><div class="n">${esc(i.name)}</div><div class="m">${esc(i.by)}</div>${i.license || i.url ? `<div class="m">${esc([i.license, i.url].filter(Boolean).join('　'))}</div>` : ''}</div>`;

export interface CreditsOptions {
  layer: Layer;
  sfx: Sfx;
}

/** 打开致谢面板；关上时 resolve。 */
export async function openCredits(o: CreditsOptions): Promise<void> {
  injectCss('fs-credits', CSS);
  const { layer, sfx } = o;
  const audio = await loadAudioCredits();
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = 'rgba(26,21,32,.32)';
  layer.ui.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  const panel = scrollPanel(30);
  const body = document.createElement('div');
  body.className = 'credits';
  body.tabIndex = -1;
  body.innerHTML = [
    `<h3>音乐</h3><div class="sub">${esc(audio.attribution.title)}</div><div class="att">${audio.attribution.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`,
    `<h3>字体</h3>${FONT_CREDITS.map(itemHtml).join('')}`,
    `<h3>音效</h3><div class="sub">${esc(audio.thanks.title)}</div><div class="thx">${audio.thanks.items.map((i) => `<div><b>${esc(i.name)}</b>${i.by ? `<span> · ${esc(i.by)}</span>` : ''}</div>`).join('')}</div>`,
    `<h3>引擎与特效</h3>${ENGINE_CREDITS.map(itemHtml).join('')}`,
    '<div class="note">字体与素材的许可原文、逐个文件的来源随游戏一起发布（fonts/LICENSE-*.txt、audio/CREDITS.txt、licenses/pixelfx-LICENSE.txt）。</div>',
  ].join('');
  const bar = document.createElement('div');
  bar.className = 'bar';
  let closing = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const close = async () => {
    if (closing) return;
    closing = true;
    sfx.play('ui.click');
    popKeys();
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await panel.close();
    veil.remove();
    layer.onFit = refit;
    finish();
  };
  const back = inkButton('返回', { onClick: () => void close() });
  bar.appendChild(back);
  panel.paper.insertAdjacentHTML('beforeend', '<h2>致谢</h2>');
  panel.paper.append(body, bar);
  layer.ui.appendChild(panel.el);
  // 正文在卷轴里上下滚：卷轴最高到窗口上下各留一点边，标题和「返回」一直看得见
  const edges = () => {
    const more = body.scrollHeight - body.clientHeight;
    body.classList.toggle('ft', more > 1 && body.scrollTop > 1);
    body.classList.toggle('fb', more > 1 && body.scrollTop < more - 1);
  };
  body.addEventListener('scroll', edges, { passive: true });
  const size = (f: UiFit) => {
    body.style.maxHeight = '';
    const chrome = panel.el.offsetHeight - body.offsetHeight; // 轴、纸边、标题、按钮
    body.style.maxHeight = `${Math.max(f.base * 4, f.h - chrome - f.base * (f.h / f.base < 30 ? 1 : 3))}px`;
    centerIn(panel.el, f);
    edges();
  };
  size(layer.fit);
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    size(f);
  };
  const popKeys = pushKeys((e) => {
    if (closing) return 'consume';
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      void close();
      return 'consume';
    }
    // 上下滚动内容，回车 / 空格按「返回」
    if (k === 'arrowdown' || k === 's' || k === 'arrowup' || k === 'w') {
      const step = layer.fit.base * 4.5; // 一次三行
      body.scrollBy({ top: k === 'arrowdown' || k === 's' ? step : -step, behavior: 'smooth' });
      return 'consume';
    }
    navKeys(e, [back]);
    return 'consume';
  });
  await panel.open();
  back.focus({ preventScroll: true });
  await done;
}
