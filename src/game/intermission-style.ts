// 波间界面「万宝阁」的样式。
//
// 版面（2026-11-10 起）：界面横着排在画布矩形的宽里、竖着用整个窗口的高（.ui），不再用「和画布同一个整数倍的 CSS zoom」。
// #inter 的 font-size 是基准字号（ui-scale.ts 的 uiBaseFontPx，按画布矩形的高度取），下面的尺寸一律用 em，
// 所以整套版面跟着基准字号走，和画布的放大倍数无关。
// 字是楷书一路：匾额、章节、卡片上的名字、主要按钮用书法体 var(--font-title)，说明、数字、标签用 var(--font-text)；
// 行高都写明（不用 normal），所以切换「文楷 / 书法」字体主题时每一行的高度不变、不会错位。
// 折行（和外围界面一致，见 docs/fonts.md）：折到行首的开括号收掉左边的半格空（trim-start），说明的最后一行不单剩一两个字（pretty）；
// 详情里只在标点处折（keep-all，放不下才任意处折）。卡片很窄（手机上一行七八个字），照常逐字折，不然一句挪到下一行会空出半行。
//
// 三个由 intermission.ts 按设备像素取整后写进来的长度（都是整数个设备像素，所以线和像素图在任何倍数下都清楚）：
//   --ln  一条细线的粗细；
//   --us  小像素图（名册里的图标、回纹、牙子、框角）的一个美术像素；
//   --ug  灵石图标的一个美术像素（比 --us 大一档，和数字差不多高）；
//   --u   龛里那件宝物的一个美术像素（按卡片的高度取：龛大约占卡片的四分之一）。
// 像素图一律 1 倍原图 + image-rendering: pixelated，按 --us / --u 的整数倍显示。
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';

export interface StyleUrls {
  corners: Record<string, [string, string, string, string]>; // 框色字符 → 四个角
  bracket: [string, string];
  fret: string;
  stand: string;
  gem: string;
  diamond: string; // 分隔线中间的菱形
  dot: string; // 横梁上步骤之间的菱形（月白）
  hero: Record<string, { url: string; w: number; h: number; n: number }>; // 角色 id → 小立绘的待机帧（一条并排的帧）
}

// 调色板（与 src/art/palette.ts 一致）
const C = {
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
  tianqing: '#7cc4c4',
  shiqing: '#3f8a9e',
  tao: '#d47aa0',
};
/** 品阶色：凡 缟、灵 天青、仙 桃红、神 缃（与 catalog 的 TIER_COLOR 一致）；0 = 不分品阶，用琥珀。 */
export const TIER_HEX = [C.hupo, C.gao, C.tianqing, C.tao, C.xiang];
/** 框角用的调色板字符（与 TIER_HEX 一一对应）。 */
export const TIER_CHARS = ['b', 'j', 'C', 'm', 'Y'];
/** 五行印章：底色、边色、字色。 */
const EL_SEAL: Record<string, [string, string, string]> = {
  metal: [C.teng, C.zhe, C.xuan],
  wood: ['#6fa35a', '#1f3b2c', C.xuan],
  water: [C.shiqing, '#1d2b4a', C.yuebai],
  fire: [C.zhusha, C.yin, C.yuebai],
  earth: [C.hupo, C.zhe, C.yuebai],
};

const url = (u: string) => `url("${u}")`;
const svg = (body: string, w: number, h: number) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}")`;

/**
 * 墙上的暗纹：斜格窗棂。按格子大小和线粗（CSS 像素，线粗是整数个设备像素）现画成矢量图，
 * 所以不管基准字号是多少，线都是细而匀的一条，不靠整数倍放大。
 */
export function latticeUrl(tile: number, line: number): string {
  const t = tile;
  return svg(`<path d="M${-t} ${-t}L${2 * t} ${2 * t}M${2 * t} ${-t}L${-t} ${2 * t}" stroke="#3a2e40" stroke-width="${line}" fill="none"/>`, t, t);
}

/** 「二选一」两张器灵卡之间的菱形牌（矢量，随字号缩放）。 */
const OR_TOKEN = svg(`<path d="M12 1.2L22.8 12L12 22.8L1.2 12Z" fill="${C.xuan}" stroke="${C.teng}" stroke-width="1.4"/><path d="M12 4.4L19.6 12L12 19.6L4.4 12Z" fill="none" stroke="${C.zhe}" stroke-width="1"/>`, 24, 24);

export function interCss(u: StyleUrls): string {
  const s5 = 'calc(var(--us) * 5)';
  const corner = (ch: string) => {
    const [tl, tr, bl, br] = u.corners[ch];
    return `background: ${url(tl)} left top / ${s5} ${s5} no-repeat, ${url(tr)} right top / ${s5} ${s5} no-repeat, ${url(bl)} left bottom / ${s5} ${s5} no-repeat, ${url(br)} right bottom / ${s5} ${s5} no-repeat;`;
  };
  const tiers = TIER_HEX.map((hex, t) => `#inter .card.t${t} { --tc: ${hex}; } #inter .card.t${t}::after { ${corner(TIER_CHARS[t])} }`).join('\n');
  const tierText = TIER_HEX.map((hex, t) => `#inter .tc${t} { color: ${hex}; } #inter .seal.tier.t${t} { color: ${hex}; border-color: ${hex}; }`).join('\n');
  const els = Object.entries(EL_SEAL)
    .map(([e, [bg, bd, fg]]) => `#inter .seal.el-${e} { background: ${bg}; color: ${fg}; border-color: ${bd}; } #inter .pp.el-${e} .on { background: ${bg}; }`)
    .join('\n');
  // 小立绘：每个角色一组规则（class 是角色 id，见 intermission-view.ts 的 heroHtml）
  const heroCss = Object.entries(u.hero)
    .map(
      ([id, { url: hu, w: hw, h: hh, n: hn }]) =>
        `#inter .pt.${id} { grid-row: 1 / 3; width: calc(var(--us) * ${hw}); height: calc(var(--us) * ${hh}); background: ${url(hu)} 0 0 / calc(var(--us) * ${hw * hn}) calc(var(--us) * ${hh}) no-repeat; image-rendering: pixelated; animation: pt-${id} .8s steps(${hn}) infinite; }\n` +
        `@keyframes pt-${id} { to { background-position: calc(var(--us) * ${-hw * hn}) 0; } }`,
    )
    .join('\n');
  return `
/* ---------- 根：整个窗口一面不透明的墙；内容排在画布的矩形里（.ui）。
   层次：在对白层（#dlg，6）之上——对白从不在万宝阁开着时出现，而它收起之后留下的看不见的框会挡住点击；在暂停层（8）之下 ---------- */
#inter { position: fixed; inset: 0; z-index: 7; display: none; overflow: hidden; background: ${C.wu}; color: ${C.yuebai};
  font-family: ${FONT_TEXT}; font-size: 16px; line-height: 1.36; font-weight: normal; font-style: normal; font-synthesis: none; letter-spacing: 0;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%; text-spacing-trim: trim-start; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  --em: 16px; --ln: 1px; --us: 1px; --ug: 2px; --u: 3px; --tap: 30px; --rl: 0px; --minfs: 14px;
  --hb: calc(var(--em) * 2.75); --m: calc(var(--em) * .7); --g: calc(var(--em) * .7); --gc: calc(var(--em) * .55); --side: clamp(21.8em, 36.5%, 24.6em);
  --fs-s: max(var(--minfs), .88em); --fs-k: max(min(12px, var(--minfs)), .72em); }
#inter.tabs-on { --side: clamp(11.8em, 25.5%, 14.6em); } /* 法宝位一格要放得下五个字的名字（青莲宝色旗） */
#inter.compact { --hb: calc(var(--em) * 2.4); --m: calc(var(--em) * .45); --g: calc(var(--em) * .4); --gc: calc(var(--em) * .36); }
#inter.on { display: block; }
#inter.closing { pointer-events: none; animation: interout .42s ease-in forwards; }
@keyframes interout { to { opacity: 0; } }
#inter::before { content: ''; position: absolute; inset: 0; background: var(--lattice, none) var(--rl) 0 repeat; }
#inter * { box-sizing: border-box; }
#inter b, #inter em, #inter strong, #inter i { font-weight: normal; font-style: normal; }
#inter img { display: block; flex: none; image-rendering: pixelated; }
#inter button { font: inherit; letter-spacing: inherit; color: inherit; background: none; border: 0; border-radius: 0; margin: 0; padding: 0; cursor: pointer; display: flex; align-items: center; white-space: nowrap; -webkit-appearance: none; appearance: none; touch-action: manipulation; }
#inter button:focus { outline: none; }
#inter button:focus-visible { outline: calc(var(--ln) * 2) solid ${C.xiang}; outline-offset: var(--ln); }
#inter .dim { color: ${C.cang}; }
#inter .xg { color: ${C.xiang}; }
#inter .demon { color: ${C.zhusha}; }
#inter .nw { display: inline-block; max-width: 100%; vertical-align: top; }
#inter .gem { display: inline-block; flex: none; width: calc(var(--ug) * 5); height: calc(var(--ug) * 7); background: ${url(u.gem)} 0 0 / 100% 100% no-repeat; image-rendering: pixelated; vertical-align: -.08em; }
#inter .i16 { width: calc(var(--us) * 16); height: calc(var(--us) * 16); }
${tierText}

/* ---- 印章：五行（白文：实底）、品阶（朱文：描边）。字用书法体，印的大小跟着所在那一行的字号 ---- */
#inter .seal { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 1.34em; height: 1.34em; border: var(--ln) solid transparent; border-radius: .1em; font-family: ${FONT_TITLE}; line-height: 1; white-space: nowrap; }
#inter .seal.tier { background: ${C.xuan}; }
#inter .seal.off { background: transparent !important; color: ${C.cang} !important; border-color: ${C.dai} !important; }
#inter .seal.in { vertical-align: -.22em; margin-right: .3em; }
${els}

/* ---- 横梁：朱漆梁、回纹带、匾额、章节、步骤、灵石。贴着窗口上沿，梁的底色铺满整个窗口宽（.beamx），内容在画布的宽里（.beam） ---- */
#inter .beamx { position: absolute; left: 0; right: 0; top: 0; z-index: 1; height: calc(var(--hb) + var(--st, 0px)); image-rendering: pixelated;
  background: linear-gradient(${C.teng}, ${C.teng}) 0 100% / 100% var(--ln) no-repeat, linear-gradient(${C.zhe}, ${C.zhe}) 0 calc(100% - var(--ln)) / 100% calc(var(--ln) * 2) no-repeat,
    ${url(u.fret)} var(--rl) calc(100% - var(--ln) * 3 - var(--us)) / calc(var(--us) * 8) calc(var(--us) * 5) repeat-x, ${C.yin};
  box-shadow: 0 var(--ln) 0 ${C.xuan}, inset 0 var(--ln) 0 ${C.zhu}; }
#inter .ui { position: absolute; z-index: 2; overflow: hidden; }
#inter .beam { position: absolute; left: 0; right: 0; top: var(--st, 0px); z-index: 2; height: var(--hb); display: flex; align-items: center; justify-content: center; padding: 0 var(--m) calc(var(--us) * 7 + var(--ln) * 3); }
#inter .beam-in { flex: 1; min-width: 0; max-width: 82em; height: 100%; display: flex; align-items: center; gap: .9em; }
#inter .plaque { flex: none; align-self: flex-start; margin-top: calc(var(--em) * .2); height: calc(var(--hb) + var(--em) * .12); padding: 0 .36em 0 .43em; display: flex; align-items: center; background: ${C.xuan};
  box-shadow: 0 0 0 var(--ln) ${C.teng}, 0 0 0 calc(var(--ln) * 2) ${C.zhe}, inset 0 0 0 calc(var(--ln) * 2) ${C.xuan}, inset 0 0 0 calc(var(--ln) * 3) ${C.zhe};
  font-family: ${FONT_TITLE}; font-size: 1.72em; line-height: 1; letter-spacing: .12em; color: ${C.xiang}; white-space: nowrap; }
#inter.compact .plaque { font-size: 1.5em; }
#inter .title { flex: 0 1 auto; min-width: 0; font-family: ${FONT_TITLE}; font-size: 1.3em; line-height: 1.25; letter-spacing: .06em; color: ${C.yuebai}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inter.compact .title { font-size: 1.18em; line-height: 1.2; }
#inter .steps { flex: none; margin-left: auto; display: flex; align-items: center; gap: .5em; font-family: ${FONT_TITLE}; font-size: 1.12em; line-height: 1.25; color: rgba(242, 232, 213, .42); white-space: nowrap; }
#inter .steps .cur { color: ${C.xiang}; }
#inter .steps .done { color: rgba(242, 232, 213, .72); }
#inter .steps i { flex: none; width: calc(var(--us) * 5); height: calc(var(--us) * 3); background: ${url(u.dot)} 0 0 / 100% 100% no-repeat; image-rendering: pixelated; opacity: .5; }
#inter .ls { position: relative; flex: none; margin-left: var(--pz, 0px); height: 1.72em; padding: 0 .6em 0 .55em; display: flex; align-items: center; gap: .38em; color: ${C.gao}; white-space: nowrap; background: ${C.xuan}; border: var(--ln) solid ${C.zhe}; }
#inter.compact .ls { height: 1.45em; }
#inter.compact .steps { line-height: 1.2; }
#inter .ls span { font-size: var(--fs-s); }
#inter .ls b { color: ${C.tianqing}; font-size: 1.12em; line-height: 1; font-variant-numeric: tabular-nums; }
#inter .ls b.flash { animation: lsflash .9s steps(6) both; }
@keyframes lsflash { 0%, 50% { color: ${C.xiang}; } }
#inter .ls .delta { position: absolute; right: .4em; top: 100%; color: ${C.zhusha}; animation: delta 1.2s ease-out both; pointer-events: none; }
#inter .ls .delta.up { color: ${C.xiang}; }
@keyframes delta { from { transform: translateY(-.3em); opacity: 0; } 20% { opacity: 1; } to { transform: translateY(.45em); opacity: 0; } }

/* ---- 梁下：左名册、右多宝格。画布特别大时（2K 以上）整块居中，不跟着拉得很空 ---- */
#inter .body { position: absolute; left: 0; right: 0; top: calc(var(--hb) + var(--st, 0px)); bottom: var(--sb, 0px); padding: calc(var(--m) + .34em) var(--m) var(--m); display: flex; }
#inter .frame { flex: 1; min-width: 0; min-height: 0; max-width: 82em; height: 100%; max-height: 44em; margin: auto; display: flex; gap: var(--g); }
/* 竖屏（.tall，手机竖着拿）：上下排——名册在上（铺满宽，页签和角色名并成一行，高度约占三成五），多宝格在下排成两列 / 三列（--tcols） */
#inter.tall .plaque { font-size: 1.42em; }
#inter.tall .title { display: none; } /* 竖屏的横梁放不下章节名（各步的说明在底栏里） */
#inter.tall .steps { font-size: 1em; gap: .4em; }
#inter.tall .frame { flex-direction: column; max-height: none; }
#inter.tall .side { width: auto; flex: 0 0 clamp(10.5em, 33%, 16em); display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); column-gap: .8em; row-gap: .4em; }
#inter.tall .hero { grid-column: 1; grid-row: 1; }
#inter.tall .tabs { grid-column: 2; grid-row: 1; align-self: center; }
#inter.tall .page { grid-column: 1 / -1; grid-row: 2; }
#inter.tall .slots { grid-template-columns: repeat(4, minmax(0, 1fr)); }
#inter.tall .cards { grid-template-columns: repeat(var(--tcols, 2), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }

/* ---- 左侧：角色名册 ---- */
#inter .side { position: relative; flex: none; width: var(--side); min-height: 0; padding: .5em .55em; display: flex; flex-direction: column; gap: .4em; background: ${C.xuan}; border: var(--ln) solid ${C.zhe}; }
#inter.compact .side { padding: .32em .36em; gap: .3em; }
#inter .side::after { content: ''; position: absolute; inset: calc(var(--ln) * -1); pointer-events: none; image-rendering: pixelated; ${corner('y')} }
#inter.cols .side { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); column-gap: .8em; row-gap: .45em; }
#inter.cols .hero { grid-column: 1 / 3; }
#inter.cols .tabs, #inter.cols .pc, #inter.cols .ptk { display: none; }
#inter.cols .pa { grid-column: 1; grid-row: 2; }
#inter.cols .pb { grid-column: 2; grid-row: 2; }
#inter.tabs-on .page { display: none; }
#inter.tabs-on.tab-a .pa, #inter.tabs-on.tab-b .pb, #inter.tabs-on.tab-c .pc, #inter.tabs-on.tab-d .ptk { display: flex; }
#inter.tabs-on .pbx, #inter.tabs-on .pax { display: none; }
#inter .hero { flex: none; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto; column-gap: .5em; align-items: center; align-content: center; }
${heroCss}
#inter .who { display: flex; align-items: center; gap: .4em; min-width: 0; white-space: nowrap; }
#inter .who b { font-family: ${FONT_TITLE}; font-size: 1.32em; line-height: 1.15; color: ${C.yuebai}; margin-right: .1em; }
#inter .who .dim { font-size: var(--fs-s); }
#inter.compact .who .dim { display: none; }
#inter .lv { display: flex; align-items: center; gap: .5em; min-width: 0; color: ${C.gao}; font-size: var(--fs-s); line-height: 1.25; white-space: nowrap; }
#inter .xp { position: relative; flex: 1; max-width: 6.5em; height: .34em; background: ${C.wu}; border: var(--ln) solid ${C.dai}; }
#inter .xp i { position: absolute; left: 0; top: 0; bottom: 0; background: ${C.tianqing}; }
#inter .tabs { flex: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .16em; }
#inter .tabs button { height: var(--tap); justify-content: center; font-size: var(--fs-s); color: ${C.cang}; background: ${C.wu}; }
#inter .tabs button.on { color: ${C.xiang}; background: ${C.xuan}; box-shadow: inset 0 0 0 var(--ln) ${C.zhe}, inset 0 calc(var(--ln) * 2) 0 ${C.teng}; }
#inter .page { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: .3em; overflow: hidden; }
#inter .dv { flex: none; position: relative; height: calc(var(--us) * 3); margin: .12em 0; }
#inter .dv::before { content: ''; position: absolute; left: 0; right: 0; top: var(--us); height: var(--ln); background: ${C.dai}; }
#inter .dv::after { content: ''; position: absolute; left: calc(50% - var(--us) * 2.5); top: 0; width: calc(var(--us) * 5); height: calc(var(--us) * 3); background: ${url(u.diamond)} 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }

/* 法宝位：2×2 四格。点一格看详情（说明、下一阶、器灵），卖出的按钮在详情里 */
#inter .slots { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .2em; }
#inter .tile { position: relative; min-width: 0; min-height: var(--tileh, 0px); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: .25em; align-items: center; align-content: center; padding: .18em .2em .1em; text-align: left; background: ${C.wu}; border-bottom: var(--ln) solid ${C.dai}; }
#inter .tile .i16 { grid-column: 1; grid-row: 1; }
#inter .tile .mid { grid-column: 2; grid-row: 1; display: flex; align-items: center; justify-content: flex-end; gap: .25em; min-width: 0; overflow: hidden; }
#inter .tile .tag { font-size: var(--fs-k); line-height: 1.2; color: ${C.cang}; white-space: nowrap; }
#inter .tile .seal { grid-column: 3; grid-row: 1; font-size: var(--fs-s); }
#inter .tile .nm { grid-column: 1 / 4; grid-row: 2; font-size: var(--fs-s); line-height: 1.34; color: ${C.yuebai}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inter .tile.open { background: ${C.dai}; border-bottom-color: ${C.teng}; }
#inter .tile.empty { background: transparent; border: var(--ln) solid ${C.wu}; }
#inter .tile.empty .hole { grid-column: 1; grid-row: 1; width: calc(var(--us) * 16); height: calc(var(--us) * 16); border: var(--ln) solid ${C.dai}; }
#inter .tile.empty .nm { color: ${C.cang}; }
#inter .pips { display: inline-flex; flex: none; gap: .14em; }
#inter .pips i { width: .3em; height: .3em; background: ${C.dai}; }
#inter .pips i.on { background: ${C.xiang}; }
#inter .pips i.add { background: ${C.tianqing}; }

/* 五行相生链：木 → 火 → 土 → 金 → 水 →（回到）木 */
#inter .wx { flex: none; display: flex; flex-direction: column; gap: .3em; min-width: 0; }
#inter .chain { position: relative; display: flex; align-items: flex-start; padding-bottom: .5em; }
#inter .nd { flex: none; display: flex; flex-direction: column; align-items: center; gap: .16em; }
#inter .pp { display: flex; gap: var(--ln); }
#inter .pp i { width: .32em; height: .14em; min-height: var(--ln); background: ${C.dai}; }
#inter .pp i.pet { width: .2em; margin-left: var(--ln); } /* 宠物算的那一件：窄一点、隔开一点（颜色同这一行） */
#inter .qj { color: ${C.xiang}; letter-spacing: .06em; } /* 五行俱全 */
#inter .chain.all .seal { box-shadow: 0 0 0 var(--ln) ${C.xiang}; } /* 五行俱全：五个印都描一道金边（印章是方的，不是光圈） */
#inter .lk { position: relative; flex: 1; min-width: .4em; height: 1.34em; }
#inter .lk::before { content: ''; position: absolute; left: .1em; right: .28em; top: calc(50% - var(--ln) / 2); height: var(--ln); background: currentColor; }
#inter .lk::after { content: ''; position: absolute; right: .08em; top: calc(50% - .2em); width: .28em; height: .4em; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); }
#inter .lk.on, #inter .ret.on { color: ${C.xiang}; }
#inter .lk.near, #inter .ret.near { color: ${C.yinshu}; }
#inter .lk.off, #inter .ret.off { color: ${C.dai}; }
#inter .ret { position: absolute; left: .67em; right: .67em; bottom: .06em; height: .3em; border: var(--ln) solid currentColor; border-top: 0; }
#inter .ret::after { content: ''; position: absolute; left: calc(-.17em - var(--ln) / 2); top: -.16em; width: .34em; height: .24em; background: currentColor; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
#inter .wls { display: flex; flex-direction: column; gap: .1em; font-size: var(--fs-s); }
#inter .wl { display: flex; flex-wrap: wrap; align-items: center; column-gap: .42em; min-width: 0; line-height: 1.42; color: ${C.gao}; }
#inter .wl .lb { flex: none; color: ${C.yinshu}; }
#inter .rx { display: inline-flex; align-items: center; gap: .24em; white-space: nowrap; }
#inter .rx span + span { margin-left: .16em; }

/* 属性、行囊、宠物 */
#inter .stats { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: .9em; font-size: var(--fs-s); }
#inter .sc { display: flex; justify-content: space-between; gap: .3em; min-width: 0; line-height: 1.34; color: ${C.yinshu}; white-space: nowrap; }
#inter.compact .sc { line-height: 1.26; }
#inter .sc em { color: ${C.yuebai}; font-variant-numeric: tabular-nums; }
#inter .sc.wide { grid-column: 1 / 3; }
#inter .sc.aff { align-items: flex-start; white-space: normal; }
#inter .sc.aff em { display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: .6em; min-width: 0; }
#inter .sc.aff em span { white-space: nowrap; }
#inter .pet { display: flex; flex-direction: column; gap: .1em; min-height: 0; overflow: hidden; font-size: var(--fs-s); }
#inter .ph { flex: none; display: flex; align-items: center; gap: .4em; white-space: nowrap; }
#inter .ph b { font-family: ${FONT_TITLE}; font-size: 1.28em; line-height: 1.2; color: ${C.yuebai}; }
#inter .pd { flex: none; color: ${C.gao}; line-height: 1.36; }
#inter .pd.br { color: ${C.ju}; }
#inter .pd.clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
#inter .bag { flex: none; display: flex; flex-direction: column; gap: .22em; font-size: var(--fs-s); }
#inter .bg { display: flex; align-items: flex-start; gap: .5em; }
#inter .bg .lb { flex: none; color: ${C.yinshu}; line-height: calc(var(--us) * 16); }
#inter .its { display: flex; flex-wrap: wrap; align-items: center; gap: .22em; min-width: 0; min-height: calc(var(--us) * 16); line-height: calc(var(--us) * 16); }
#inter .it { position: relative; width: calc(var(--us) * 16); height: calc(var(--us) * 16); }
#inter .it.off { display: none; }
/* 行囊放不下时收起来的那几样：一枚「+N」，和图标一样大（悬停 / 点一下列出收起的那些） */
#inter .it.mo { display: flex; align-items: center; justify-content: center; font-size: var(--fs-k); line-height: 1; color: ${C.gao}; border: var(--ln) solid ${C.dai}; border-radius: .2em; font-variant-numeric: tabular-nums; }
#inter .it em { position: absolute; right: -.12em; bottom: -.22em; font-size: var(--fs-k); line-height: 1; color: ${C.xiang}; text-shadow: var(--ln) 0 0 ${C.xuan}, calc(var(--ln) * -1) 0 0 ${C.xuan}, 0 var(--ln) 0 ${C.xuan}, 0 calc(var(--ln) * -1) 0 ${C.xuan}; }

/* 功法：一行一门（图标、名字；没悟的写第几级悟） */
#inter .techs { flex: none; display: flex; flex-direction: column; gap: .16em; font-size: var(--fs-s); }
#inter .tk { display: flex; align-items: center; gap: .4em; min-width: 0; min-height: calc(var(--us) * 16 + .16em); padding: 0 .28em; white-space: nowrap; color: ${C.yuebai}; background: ${C.wu}; border-bottom: var(--ln) solid ${C.dai}; }
#inter .tk .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#inter .tk .at { flex: none; font-size: var(--fs-k); color: ${C.cang}; }
#inter .tk.empty { background: transparent; border: var(--ln) solid ${C.wu}; }
#inter .tk.empty .hole { flex: none; width: calc(var(--us) * 16); height: calc(var(--us) * 16); border: var(--ln) solid ${C.dai}; }
#inter .tk.empty .nm { color: ${C.cang}; }
#inter .tknotes { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; gap: .34em; overflow: hidden; font-size: var(--fs-s); }
#inter .tknotes .te { flex: none; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .4em; align-items: start; }
#inter .tknotes .tn { color: ${C.gao}; line-height: 1.34; }
#inter .tknotes .tn b { color: ${C.yuebai}; margin-right: .4em; }
#inter .tknotes .tn.clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
#inter .tknotes .tn.dim { color: ${C.cang}; }

/* ---- 右侧：多宝格、底栏 ---- */
#inter .main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: var(--g); }
/* 每格的宽按 --cols 格分（平常 4；修为「广货」「慧根」让货架、升级多出第 5 格时按 5 格分，不挤出去） */
#inter .cards { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(var(--n, 4), calc((100% - var(--gc) * (var(--cols, 4) - 1)) / var(--cols, 4))); justify-content: center; gap: var(--gc); }

/* 一格多宝格：上面是龛（朱漆的龛里摆着宝物），下面是签（名字、说明），最底下一行按钮。各卡同宽同高，名字、说明、按钮各在同一条线上 */
#inter .card { --tc: ${C.hupo}; position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: ${C.xuan}; border: var(--ln) solid var(--tc); }
#inter .card::after { content: ''; position: absolute; inset: calc(var(--ln) * -1); pointer-events: none; z-index: 3; image-rendering: pixelated; }
${tiers}
#inter .card.locked { --tc: ${C.zhusha}; }
#inter .card.locked::after { ${corner('e')} }
#inter .card.sold { --tc: ${C.dai}; }
#inter .card.sold::after { ${corner('g')} }
#inter .niche { --np: .62em; --nb: calc(var(--ln) * 2 + .1em); position: relative; flex: none; height: calc(var(--u) * 20 + var(--np) + var(--nb)); background: ${C.yin}; border-bottom: var(--ln) solid ${C.zhe}; box-shadow: inset 0 var(--ln) 0 ${C.xuan}, inset 0 calc(var(--ln) * -1) 0 ${C.hupo}; overflow: hidden; }
#inter.compact .niche { --np: .34em; }
#inter .card.k-pet .niche, #inter .card.k-stat .niche, #inter .card.k-tech .niche { background: ${C.wu} var(--lattice, none) 0 0 repeat; box-shadow: inset 0 calc(var(--ln) * -1) 0 ${C.hupo}; }
#inter .card.sold .niche { background: ${C.wu}; }
#inter .niche::before, #inter .niche::after { content: ''; position: absolute; top: 0; width: calc(var(--us) * 9); height: calc(var(--us) * 6); background-size: 100% 100%; image-rendering: pixelated; z-index: 1; }
#inter .niche::before { left: 0; background-image: ${url(u.bracket[0])}; }
#inter .niche::after { right: 0; background-image: ${url(u.bracket[1])}; }
#inter .niche .ico { position: absolute; left: 50%; bottom: calc(var(--u) * 4 + var(--nb)); width: calc(var(--u) * 16); height: calc(var(--u) * 16); margin-left: calc(var(--u) * -8); transition: transform .35s ease-out; z-index: 1; }
#inter .niche .stand { position: absolute; left: 50%; bottom: var(--nb); width: calc(var(--u) * 20); height: calc(var(--u) * 4); margin-left: calc(var(--u) * -10); background: ${url(u.stand)} 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
#inter .glints { position: absolute; left: 50%; bottom: calc(var(--u) * 4 + var(--nb)); width: calc(var(--u) * 16); height: calc(var(--u) * 16); margin-left: calc(var(--u) * -8); pointer-events: none; z-index: 2; }
#inter .glints i { position: absolute; width: var(--us); height: var(--us); background: ${C.yuebai}; box-shadow: var(--us) 0 0 var(--tc), calc(var(--us) * -1) 0 0 var(--tc), 0 var(--us) 0 var(--tc), 0 calc(var(--us) * -1) 0 var(--tc); opacity: 0; animation: glint 3.6s ease-in-out infinite; }
#inter .glints i:nth-child(1) { left: calc(var(--u) * -3); top: calc(var(--u) * 3); }
#inter .glints i:nth-child(2) { left: calc(var(--u) * 18); top: calc(var(--u) * 8); animation-delay: 1.2s; }
#inter .glints i:nth-child(3) { left: calc(var(--u) * 13); top: calc(var(--u) * -2); animation-delay: 2.4s; }
@keyframes glint { 0%, 62%, 100% { opacity: 0; } 74%, 86% { opacity: 1; } }
#inter .niche .seal { position: absolute; top: .32em; z-index: 2; }
#inter.compact .niche .seal { top: .22em; }
#inter .niche .seal[class*="el-"] { left: .32em; }
#inter .niche .seal.tier { right: .32em; }
#inter.compact .niche .seal[class*="el-"] { left: .22em; }
#inter.compact .niche .seal.tier { right: .22em; }
/* 锁：盖在龛上的一方朱砂印（稍微歪一点，像手盖的） */
#inter .stamp { position: absolute; right: .34em; bottom: .42em; z-index: 2; width: 1.72em; height: 1.72em; display: flex; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: 1.16em; line-height: 1; color: ${C.yuebai}; background: ${C.zhusha}; border-radius: .1em;
  box-shadow: inset 0 0 0 var(--ln) ${C.yin}, inset 0 0 0 calc(var(--ln) * 2) ${C.zhusha}, inset 0 0 0 calc(var(--ln) * 3) ${C.ju}; opacity: 0; transform: rotate(-7deg) scale(1.8); transition: opacity .25s ease-in, transform .25s ease-in; pointer-events: none; }
#inter .card.locked .stamp { opacity: 1; transform: rotate(-7deg); transition: opacity .18s ease-out, transform .32s cubic-bezier(.3, 1.4, .5, 1); }
/* 器灵二选一：两张卡挨着时，中间夹一枚「或」（各自的签上还写着「与某某二选一」） */
#inter .card.duo-l::before { content: '或'; position: absolute; z-index: 5; left: calc(100% + var(--ln) + var(--gc) / 2 - .9em); top: calc(var(--u) * 8 - .4em); width: 1.8em; height: 1.8em; display: flex; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: 1em; line-height: 1; color: ${C.xiang}; background: ${OR_TOKEN} center / 100% 100% no-repeat; pointer-events: none; }
/* 按键提示（有键盘的设备上）：龛角的数字 */
#inter .kc { display: none; }
#inter.keys .kc { display: block; position: absolute; left: .3em; bottom: calc(var(--nb) + .12em); z-index: 2; min-width: 1.5em; padding: 0 .3em; font-size: var(--fs-k); line-height: 1.4; text-align: center; color: rgba(242, 232, 213, .62); border: var(--ln) solid rgba(242, 232, 213, .3); border-radius: .22em; }
#inter.keys .card.sold .kc { display: none; }
/* 五格（修为多出来的一格）时卡片窄，台座两头离边近：按键提示挪到台座上面，不压着台座 */
#inter.keys .cards.c5 .kc { bottom: calc(var(--nb) + var(--u) * 4 + .15em); }

#inter .info { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: .36em .5em 0; overflow: hidden; }
#inter.compact .info { padding: .2em .38em 0; }
#inter .info .nm { flex: none; font-family: ${FONT_TITLE}; font-size: 1.24em; line-height: 1.3; color: ${C.yuebai}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inter.compact .info .nm { font-size: 1.16em; line-height: 1.24; }
#inter .info .sub { flex: none; font-size: var(--fs-s); line-height: 1.32; color: ${C.yinshu}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: .22em; }
#inter.compact .info .sub { margin-bottom: .08em; line-height: 1.26; }
#inter .info .ds { flex: none; font-size: var(--fs-s); line-height: 1.38; text-wrap: pretty; color: ${C.gao}; } /* pretty：最后一行不单剩一两个字 */
#inter.compact .info .ds { line-height: 1.3; }
#inter .info .ds.clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
#inter .info .ds.gone { display: none; }
#inter .info .nts { flex: none; margin-top: auto; padding-top: .2em; display: flex; flex-direction: column; font-size: var(--fs-s); line-height: 1.38; color: ${C.gao}; }
#inter.compact .info .nts { line-height: 1.3; padding-top: .1em; }
#inter .info .nt { display: block; }
#inter .info .nt.off { display: none; }
#inter .nt .pips { vertical-align: .16em; margin-right: .4em; }
#inter .info .big { flex: none; font-size: 1.9em; line-height: 1.16; margin: .02em 0 .08em; font-variant-numeric: tabular-nums; }
#inter.compact .info .big { font-size: 1.6em; }
#inter .soldw { margin: .3em auto 0; font-family: ${FONT_TITLE}; font-size: 1.24em; letter-spacing: .5em; text-indent: .5em; color: ${C.cang}; }
#inter .act { flex: none; display: flex; gap: .3em; padding: .38em .45em .45em; border-top: var(--ln) solid ${C.wu}; }
#inter.compact .act { gap: .22em; padding: .26em .3em .3em; }
#inter .buy, #inter .pick { flex: 1; min-width: 0; height: var(--tap); padding: 0 .42em; justify-content: space-between; gap: .26em; color: ${C.xiang}; background: ${C.wu}; border: var(--ln) solid ${C.hupo}; box-shadow: inset 0 calc(var(--ln) * -1) 0 ${C.zhe}; }
#inter.compact .buy, #inter.compact .pick { padding: 0 .3em; }
#inter .buy .bl, #inter .pick span { font-family: ${FONT_TITLE}; font-size: 1.14em; line-height: 1; }
#inter .buy .bl.why { font-family: ${FONT_TEXT}; font-size: var(--fs-s); }
#inter .buy .pv { display: flex; align-items: center; gap: .2em; }
#inter .buy .pr { color: ${C.tianqing}; font-variant-numeric: tabular-nums; line-height: 1; }
#inter .cards.tight .b1 { display: none; }
#inter .pick { justify-content: center; }
#inter .buy[aria-disabled="true"] { color: ${C.cang}; background: ${C.xuan}; border-color: ${C.dai}; box-shadow: none; cursor: default; }
#inter .card.poor .buy .pr { color: ${C.zhusha}; }
#inter .card.blocked .buy { justify-content: center; }
#inter .lock { flex: none; width: var(--lockw, var(--tap)); height: var(--tap); justify-content: center; font-family: ${FONT_TITLE}; font-size: 1.14em; line-height: 1; color: ${C.zhusha}; background: ${C.xuan}; border: var(--ln) solid ${C.zhu}; }
#inter .lock[aria-pressed="true"] { color: ${C.yuebai}; background: ${C.zhusha}; border-color: ${C.yin}; box-shadow: inset 0 var(--ln) 0 ${C.ju}; }
#inter .card.sold .act { visibility: hidden; }
#inter .niche .ico.gone { animation: gone .8s ease-in forwards; }
@keyframes gone { 30% { opacity: 1; } to { transform: translateY(-.7em); opacity: 0; } }

/* 底栏：左边一句提示（和按键说明），右边「刷新」「出战」。高度固定（各步一样高，多宝格也就一样高；龛的大小按它量） */
#inter .bar { --lh1: 1.24; --lh2: 1.5; flex: none; height: max(var(--tap), calc(var(--fs-s) * var(--lh1) + var(--fs-k) * var(--lh2))); display: flex; align-items: center; gap: .5em; }
#inter.compact .bar { --lh1: 1.2; --lh2: 1.3; }
/* 按键说明那一行里的键帽：连边框正好一行高，不把这一行撑高 */
#inter .bar .nk .k { line-height: calc(var(--fs-k) * var(--lh2) - var(--ln) * 2); vertical-align: top; }
#inter .bar .note { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
#inter .bar .nh { font-size: var(--fs-s); line-height: var(--lh1); color: ${C.gao}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inter .bar .nh.dim { color: ${C.yinshu}; }
#inter .bar .nk, #inter .bar .nt2 { display: none; font-size: var(--fs-k); line-height: var(--lh2); color: ${C.yinshu}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inter.keys .bar .nk { display: block; }
#inter.coarse .bar .nt2 { display: block; }
#inter .k { display: inline-block; min-width: 1.5em; margin: 0 .24em 0 .1em; padding: 0 .28em; line-height: 1.34; text-align: center; color: ${C.yinshu}; border: var(--ln) solid ${C.dai}; border-radius: .22em; }
#inter .nk .kg { margin-right: 1.1em; }
#inter .bar button { flex: none; height: var(--tap); }
#inter .bar button .k { display: none; margin: 0 0 0 .5em; font-family: ${FONT_TEXT}; font-size: var(--fs-k); letter-spacing: 0; }
#inter.keys .bar button .k { display: inline-block; }
#inter .reroll { padding: 0 .7em; gap: .36em; color: ${C.yuebai}; background: ${C.xuan}; border: var(--ln) solid ${C.hupo}; }
#inter .reroll .bl { font-family: ${FONT_TITLE}; font-size: 1.14em; line-height: 1; }
#inter .reroll .pr { color: ${C.tianqing}; font-variant-numeric: tabular-nums; line-height: 1; }
#inter .reroll[aria-disabled="true"] { color: ${C.cang}; border-color: ${C.dai}; cursor: default; }
#inter .reroll[aria-disabled="true"] .pr { color: ${C.zhusha}; }
#inter .ready { padding: 0 1em 0 1.1em; color: ${C.xiang}; background: ${C.zhu}; border: var(--ln) solid ${C.teng}; box-shadow: inset 0 0 0 var(--ln) ${C.zhu}, inset 0 calc(var(--ln) * 2) 0 ${C.zhusha}; }
#inter .ready .bl { font-family: ${FONT_TITLE}; font-size: 1.3em; line-height: 1; letter-spacing: .32em; margin-right: -.32em; padding-right: .32em; }
#inter .ready .k { color: ${C.xiang}; border-color: rgba(247, 220, 122, .5); }

/* 悬停（只在有鼠标的设备上）、键盘选中 */
@media (hover: hover) {
  #inter .card:not(.sold):hover .ico { transform: translateY(calc(var(--u) * -1)); }
  #inter .buy:not([aria-disabled="true"]):hover, #inter .pick:hover { color: ${C.xuan}; background: ${C.teng}; border-color: ${C.xiang}; box-shadow: inset 0 calc(var(--ln) * -1) 0 ${C.hupo}; }
  #inter .buy:not([aria-disabled="true"]):hover .pr { color: ${C.xuan}; }
  #inter .lock:hover { border-color: ${C.zhusha}; }
  #inter .lock[aria-pressed="true"]:hover { background: ${C.ju}; }
  #inter .reroll:not([aria-disabled="true"]):hover { background: ${C.zhe}; }
  #inter .ready:hover { background: ${C.zhusha}; color: ${C.yuebai}; }
  #inter button.tile:hover { background: ${C.dai}; }
  #inter .tabs button:not(.on):hover { color: ${C.gao}; }
  #inter .tk:not(.empty):hover { background: ${C.dai}; }
  #inter .sell:hover { background: ${C.zhusha}; color: ${C.yuebai}; }
}
#inter .card:has(.act button:focus-visible) { outline: calc(var(--ln) * 2) solid ${C.xiang}; outline-offset: calc(var(--ln) * 2); z-index: 4; }
#inter .card:has(.act button:focus-visible) .ico { transform: translateY(calc(var(--u) * -1)); }
#inter .act button:focus-visible { outline: none; }
#inter .buy:not([aria-disabled="true"]):focus-visible, #inter .pick:focus-visible { color: ${C.xuan}; background: ${C.teng}; border-color: ${C.xiang}; }
#inter .buy:not([aria-disabled="true"]):focus-visible .pr { color: ${C.xuan}; }
#inter .buy[aria-disabled="true"]:focus-visible { border-color: ${C.yinshu}; }
#inter .lock:focus-visible { box-shadow: 0 0 0 var(--ln) ${C.xiang}; }
#inter button:active { transform: translateY(var(--ln)); }

/* 提示框 / 详情：悬停或点一下出来；钉住的（.pin）能点里面的按钮，点别处收起 */
#inter .pop { position: absolute; z-index: 20; display: none; max-width: min(18.5em, 64%); padding: .5em .7em .58em; font-size: var(--fs-s); line-height: 1.42; word-break: keep-all; overflow-wrap: break-word; text-wrap: pretty; color: ${C.gao}; background: ${C.xuan}; border: var(--ln) solid ${C.teng}; box-shadow: 0 0 0 var(--ln) ${C.xuan}, 0 calc(var(--ln) * 3) 0 rgba(26, 21, 32, .45); pointer-events: none; }
#inter .pop.on { display: block; }
#inter .pop.pin { pointer-events: auto; }
#inter .pop.wide { width: min(19em, 64%); }
#inter.compact .pop { max-width: min(25em, 72%); }
#inter.compact .pop.wide { width: min(25em, 72%); }
#inter .pop .pn { display: flex; align-items: center; gap: .4em; font-family: ${FONT_TITLE}; font-size: 1.36em; line-height: 1.2; color: ${C.yuebai}; white-space: nowrap; }
#inter .pop .pn .seal { font-size: .72em; }
#inter .pop .ps { display: block; color: ${C.yinshu}; margin-bottom: .24em; }
#inter .pop .pt { display: block; color: ${C.gao}; }
#inter .pop .lad { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .5em; row-gap: .18em; margin-top: .4em; padding-top: .4em; border-top: var(--ln) solid ${C.wu}; align-items: start; }
#inter .pop .lad .seal { margin-top: .04em; }
#inter .pop .lad .seal { opacity: .7; }
#inter .pop .lad .seal.got, #inter .pop .lad .seal.cur { opacity: 1; }
#inter .pop .lad .lt { color: ${C.yinshu}; }
#inter .pop .lad .lt.got { color: ${C.yuebai}; }
#inter .pop .lad .lt.cur { color: ${C.xiang}; }
#inter .pop .lad .lt b { color: ${C.gao}; }
#inter .pop .lad .lt.got b, #inter .pop .lad .lt.cur b { color: inherit; }
#inter .pop .lad .lt .sp { display: block; }
#inter .pop .pnts { display: flex; flex-direction: column; margin-top: .4em; padding-top: .36em; border-top: var(--ln) solid ${C.wu}; }
#inter .pop .nt { display: block; }
#inter .pop .nt .dim, #inter .pop .lt .dim { color: ${C.yinshu}; }
#inter .pop .sell { width: 100%; height: var(--tap); margin-top: .55em; justify-content: center; gap: .36em; color: ${C.zhusha}; background: ${C.xuan}; border: var(--ln) solid ${C.zhu}; }
#inter .pop .sell .bl { font-family: ${FONT_TITLE}; font-size: 1.2em; line-height: 1; }
#inter .pop .sell .pr { color: ${C.tianqing}; font-variant-numeric: tabular-nums; }
#inter .pop .sell.armed { color: ${C.yuebai}; background: ${C.zhu}; border-color: ${C.zhusha}; }
#inter .pop .sell.armed .pr { color: ${C.xiang}; }
#inter .pop .keep { display: block; margin-top: .4em; color: ${C.cang}; }

/* 入场：整屏淡入，梁先落、名册随后、多宝格一格一格亮起（用户：出现和消失都不要太快） */
#inter.open { animation: uiin .45s ease-out both; }
@keyframes uiin { from { opacity: 0; } }
#inter.open .beamx, #inter.open .beam { animation: beamin .5s ease-out both; }
@keyframes beamin { from { transform: translateY(-.45em); } }
#inter.open .side { animation: sidein .6s .1s ease-out both; }
@keyframes sidein { from { opacity: 0; transform: translateX(-.45em); } }
#inter .card.in { animation: cardin .55s var(--d, 0ms) ease-out both; }
@keyframes cardin { from { opacity: 0; transform: translateY(.45em); } }
#inter .card.in .ico, #inter .card.swap .ico { animation: icoin .6s calc(var(--d, 0ms) + 120ms) ease-out both; }
@keyframes icoin { from { opacity: 0; transform: translateY(-.45em); } }
#inter .card.swap .info, #inter .card.swap .niche .seal { animation: infoin .5s var(--d, 0ms) ease-out both; }
@keyframes infoin { from { opacity: 0; } }
#inter .card.sold .soldw { animation: infoin .6s .35s ease-out both; }

@media (prefers-reduced-motion: reduce) {
  #inter, #inter *, #inter *::before, #inter *::after { animation: none !important; transition: none !important; }
}
`;
}
