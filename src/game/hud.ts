// 战斗界面（DOM，叠在画布的矩形上）：气血、真气（放神通用）、等级、章节与波次、倒计时、斩敌、灵石、连斩、大字横幅、
// 首领名与血条、手机上的神通按钮、陨落 / 通关面板。
//
// 字（用户 2026-11-10）：界面的字是楷书一路——横幅、首领名、面板标题、按钮用书法体 var(--font-title)，其余用 var(--font-text)；
// 两种字体主题（applyFontTheme）下数字的宽度不一样，所以成组的东西都用网格对齐，不靠量字宽。
// 尺寸：这一层的 font-size 是 uiBaseFontPx(画布矩形高度)，里面一律用 em；画布不一定是 480×270 的整数倍（canvas-overlay.ts）。
// 字压在战场上：浅字加一圈墨色的软描边（--ol），不加底框。
// 每帧的 update 只在内容变了的时候才动 DOM；连斩一帧最多更新一次；跟画布对位只在画布或窗口变了的时候做。
import { CHAPTER_NAME, ELEMENT_COLOR, chapterOf, waveInChapter } from '../sim/catalog.ts';
import { ELEMENTS } from '../sim/types.ts';
import { makeInkStroke } from '../art/title.ts';
import { followCanvas, hudAbove, type OverlayFit } from './canvas-overlay.ts';
import { FONT_TEXT, FONT_TITLE } from './fonts.ts';
import { band, featherCss, hairlinesCss } from './ink-band.ts';
import { JIE_TIERS } from '../sim/jie.ts';

export interface HudHandlers {
  onSkill(): void;
  onRestart(): void;
  /** 陨落 / 通关面板上的「回到标题」。不给就不出这个按钮。 */
  onQuit?(): void;
  /** 转屏提示（index.html 的 #rotate）盖住了画面：这时该暂停，免得人在提示底下挨打。 */
  onObscured?(): void;
}

const INK = '26,21,32';
/** 画布边上淡出的遮罩：外沿（贴着窗口空边的那一侧）不透明，往里淡到透明。deg 是从外往里的方向。 */
const edgeMask = (deg: number) => {
  const g = `linear-gradient(${deg}deg, #000, rgba(0,0,0,.86) 14%, rgba(0,0,0,.55) 38%, rgba(0,0,0,.22) 66%, rgba(0,0,0,0))`;
  return `-webkit-mask-image: ${g}; mask-image: ${g};`;
};
/** 条的形状：两头收尖。t 是尖头的长度。 */
const hex = (t: string) => `polygon(0 50%, ${t} 0, calc(100% - ${t}) 0, 100% 50%, calc(100% - ${t}) 100%, ${t} 100%)`;

const CSS = `
#hud { position: fixed; pointer-events: none; font-family: ${FONT_TEXT}; font-size: 16px; line-height: 1.2; font-weight: normal; font-synthesis: none; color: #f2e8d5; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  --ol: 0 0 .09em rgba(${INK},.95), 0 0 .09em rgba(${INK},.95), 0 0 .2em rgba(${INK},.8), 0 .07em .1em rgba(${INK},.85);
  --bw: clamp(3.9em, calc(var(--w, 960px) * .21 - 45px), 9em);
  --sur: 44,35,52;
  text-shadow: var(--ol); }
#hud * { box-sizing: border-box; }
#hud b, #hud i, #hud em, #hud u, #hud small { font-weight: normal; font-style: normal; text-decoration: none; }

/* 画布没铺到窗口边的那几边：画面边缘往外淡进页面的底里，不留一条硬直线。
   淡出去的不是一个纯色，而是和页面同一张底（index.html 的 --surround，按窗口对齐：--vw / --vh 是窗口大小，--g* 是四边空出来多宽），
   云气正好压到画布边上时也接得上。 */
#hud .edge { position: absolute; display: none; visibility: visible; --fe: clamp(12px, calc(var(--w, 960px) * .034), 40px);
  background-color: rgb(var(--sur)); background-image: var(--surround, none); background-size: var(--vw, 100vw) var(--vh, 100vh); background-repeat: no-repeat; }
#hud.gl .edge.l, #hud.gr .edge.r { display: block; top: 0; bottom: 0; }
#hud.gt .edge.t, #hud.gb .edge.b { display: block; left: 0; right: 0; }
#hud .edge.l { --e: min(var(--fe), calc(var(--gl, 0px) * 3)); width: var(--e); left: -1px; ${edgeMask(90)}
  background-position: calc(1px - var(--gl, 0px)) calc(0px - var(--gt, 0px)); }
#hud .edge.t { --e: min(var(--fe), calc(var(--gt, 0px) * 3)); height: var(--e); top: -1px; ${edgeMask(180)}
  background-position: calc(0px - var(--gl, 0px)) calc(1px - var(--gt, 0px)); }
/* 右、下两条也从左上角定位（底图的位置只写成「x y」：带 right / bottom 关键字的写法遇上多层底图和 var()，Chrome 只给第一层算对） */
#hud .edge.r { --e: min(var(--fe), calc(var(--gr, 0px) * 3)); width: var(--e); left: calc(100% + 1px - var(--e)); ${edgeMask(270)}
  background-position: calc(var(--e) - 1px - var(--gl, 0px) - var(--w, 0px)) calc(0px - var(--gt, 0px)); }
#hud .edge.b { --e: min(var(--fe), calc(var(--gb, 0px) * 3)); height: var(--e); top: calc(100% + 1px - var(--e)); ${edgeMask(0)}
  background-position: calc(0px - var(--gl, 0px)) calc(var(--e) - 1px - var(--gt, 0px) - var(--h, 0px)); }

/* 顶上一排：左（气血 / 真气 / 等级）、中（章节与波次、倒计时，或首领名与血条）、右（斩敌 / 灵石）。
   三列网格 1fr auto 1fr：两边放得下时中间那列正好居中，放不下时往旁边让，不会叠在一起 */
#hud .top { position: absolute; left: 0; right: 0; top: 0; display: grid; grid-template-columns: 1fr auto 1fr; column-gap: .6em; align-items: start;
  padding: calc(.6em + max(0px, var(--sat) - var(--gt, 0px))) calc(.8em + max(0px, var(--sar) - var(--gr, 0px))) 0 calc(.8em + max(0px, var(--sal) - var(--gl, 0px))); }
#hud .lb { color: #d9cdbb; white-space: nowrap; }
#hud .tl { grid-column: 1; grid-row: 1; justify-self: start; display: grid; grid-template-columns: auto var(--bw) auto; column-gap: .45em; row-gap: .2em; align-items: center; }
#hud .tl .v { white-space: nowrap; min-width: 1.8em; }
#hud .bar { position: relative; height: .56em; padding: max(1px, .07em); background: rgba(${INK},.84); clip-path: ${hex('.3em')}; }
#hud .bar .f { position: relative; display: block; height: 100%; overflow: hidden; clip-path: ${hex('.24em')}; }
#hud .bar i, #hud .bar b { position: absolute; inset: 0; transform: translateX(-100%); }
#hud .bar i { transition: transform .12s; }
#hud .hp i { background: linear-gradient(#f0694b, #c9402d 42%, #8f2620); }
#hud .hp b { background: #fff; opacity: 0; }
#hud .hpn.low { color: #f79a6a; }
#hud .sk { height: .42em; }
#hud .sk i { background: linear-gradient(#fbe58e, #e0a83a 45%, #b06a28); }
#hud .sk i::after { content: ''; position: absolute; inset: 0; background: #fff6d0; opacity: 0; }
#hud .sk.full i::after { animation: hudbreath 1s ease-in-out infinite alternate; }
@keyframes hudbreath { from { opacity: 0; } to { opacity: .55; } }
#hud .xp { height: .3em; padding: max(1px, .05em); }
#hud .xp i { background: linear-gradient(#a8e0dc, #5fb1b4); transition: transform .25s; }
/* 不占列宽的附注（真气满了的按键提示、待选的升级）：挂在零宽的格子里往右溢出，免得把左边这组撑宽、把中间挤偏 */
#hud .tl .note { display: inline-block; width: 0; white-space: nowrap; color: #f7dc7a; }
#hud .tl .up { margin-left: .5em; }
#hud .tl .hint { grid-column: 2 / -1; width: 0; white-space: nowrap; color: #f7dc7a; opacity: 0; transition: opacity .3s; }
#hud .tl .hint.on { opacity: 1; }

#hud .tc { grid-column: 2; grid-row: 1; justify-self: center; text-align: center; white-space: nowrap; }
#hud .tc .wv { font-family: ${FONT_TITLE}; font-size: clamp(1em, calc(var(--w, 960px) * .0245), 1.15em); --ls: clamp(0px, calc((var(--w, 960px) - 480px) * .008), .1em); letter-spacing: var(--ls); padding-left: var(--ls); color: #ecdfc9; }
#hud .tc .cd { margin-top: .04em; font-size: 1.5em; line-height: 1.12; letter-spacing: .06em; padding-left: .06em; }
#hud .tc.low .cd { color: #f7dc7a; }
#hud .tc.off { display: none; }
/* 回响化身遭遇战（第 10、16 波）：倒计时下面一条小一些的血条和名字（这一波照常倒计时：打不倒它，这一波结束它就退走）。天青的魂色，和首领的朱红分开 */
#hud .tc .eb { display: none; width: min(12em, calc(var(--w, 960px) * .22)); margin: .3em auto 0; transition: opacity .5s; }
#hud .tc .eb.on { display: block; }
#hud .tc .eb .en { font-family: ${FONT_TITLE}; font-size: 1.02em; line-height: 1.2; letter-spacing: .18em; padding-left: .18em; color: #c7e6e2; text-shadow: var(--ol), 0 0 .3em rgba(29,43,74,.85); }
#hud .tc .eb .ebb { height: .42em; margin-top: .14em; }
#hud .tc .eb .ebb b { background: #e3f2ee; opacity: .55; transition: transform .6s .25s; }
#hud .tc .eb .ebb i { background: linear-gradient(#a8e0dc, #3f8a9e 45%, #1d2b4a); }
#hud .tc .eb .ebb u { position: absolute; top: 0; bottom: 0; width: max(1px, .08em); margin-left: calc(max(1px, .08em) / -2); background: #c7e6e2; opacity: .8; }

#hud .bossbar { grid-column: 2; grid-row: 1; justify-self: center; width: min(calc(var(--w, 960px) * .4), 26em, calc(var(--w, 960px) - 2 * (var(--bw) + 6.4em))); display: none; transition: opacity .6s; }
#hud .bossbar.on { display: block; }
#hud .bossbar .bn { display: flex; justify-content: center; white-space: nowrap; font-family: ${FONT_TITLE}; font-size: 1.55em; line-height: 1.15; letter-spacing: .36em; padding-left: .36em; text-shadow: var(--ol), 0 0 .3em rgba(92,26,27,.85); }
#hud .bossbar .bn.long { font-size: calc(1.05em * var(--fit, 1)); line-height: 1.7; letter-spacing: .06em; padding-left: .06em; }
#hud .bossbar .bb { height: .62em; margin-top: .22em; }
#hud .bossbar .bb b { background: #f2c49b; opacity: .6; transition: transform .6s .25s; }
#hud .bossbar .bb i { background: linear-gradient(#f0694b, #a72d24 42%, #5c1a1b); }
#hud .bossbar .bb u { position: absolute; top: 0; bottom: 0; width: max(1px, .09em); margin-left: calc(max(1px, .09em) / -2); background: #f7dc7a; opacity: .85; }

#hud .trw { grid-column: 3; grid-row: 1; justify-self: end; position: relative; margin-right: var(--pr, 0px); }
#hud .tr { display: grid; grid-template-columns: auto auto; column-gap: .45em; row-gap: .2em; align-items: center; }
/* 五行俱全（sim/wuxing.ts）：右上角多一行五色小方块（不在人物身上画光圈）；没凑齐就不占地方 */
#hud .tr .wx5 { display: none; }
#hud .tr.wx5on .wx5 { display: flex; }
#hud .tr .n.wx5 { gap: .14em; justify-self: end; }
#hud .tr .n.wx5 i { width: .5em; height: .5em; box-shadow: 0 0 0 .07em rgba(${INK},.85); }
#hud .tr .n { text-align: right; min-width: 1.85em; white-space: nowrap; }
#hud .tr .ls { color: #8fd6d2; }
#hud .combo { position: absolute; right: 0; top: calc(100% + .3em); white-space: nowrap; font-family: ${FONT_TITLE}; font-size: 1.75em; line-height: 1.1; letter-spacing: .04em; color: #f7dc7a; text-shadow: 0 .05em 0 #6b3d1e, 0 0 .1em rgba(${INK},.95), 0 0 .2em rgba(${INK},.8); opacity: 0; transform-origin: right center; transition: opacity .2s; }
#hud .combo.on { opacity: 1; }

/* 竖屏（画布上面空出一大块，canvas-overlay.ts 的 hudAbove）：顶上一排挪到画布上面的空处，底边贴着画布的上沿 */
#hud.above .top { top: auto; bottom: 100%; padding-top: 0; padding-bottom: .55em; }
/* 竖屏又窄（不到 30 个字宽，一行排不下三组）：分两行——上面正中是章节与波次、倒计时（或首领名与血条），下面左右是那两组；条也放长一点 */
#hud.above.narrow { --bw: clamp(3.9em, calc(var(--w, 960px) * .3 - 40px), 9em); }
#hud.above.narrow .top { grid-template-columns: 1fr 1fr; row-gap: .35em; }
#hud.above.narrow .tc, #hud.above.narrow .bossbar { grid-column: 1 / -1; grid-row: 1; }
#hud.above.narrow .tl { grid-column: 1; grid-row: 2; }
#hud.above.narrow .trw { grid-column: 2; grid-row: 2; }
#hud.above.narrow .bossbar { width: min(calc(var(--w, 960px) * .8), 26em); }
/* 陨落 / 通关面板在窄画布上：两边的墨底留白收窄，「止步 第几章……」那一行不被裁 */
#hud.above.narrow .death .card { padding-left: 1.4em; padding-right: 1.4em; }

/* 大字横幅：一律不换行；放不下时整体缩小（--fit，banner() 里量）。墨底四边都是软的（ink-band.ts）。
   在画面上方五分之一处；矮的画面上让开顶上那一排（三行，到 4.6em 为止；那一排挪到画布上面时不用让） */
#hud .banner { position: absolute; left: 0; right: 0; top: max(20%, 4.9em); display: flex; justify-content: center; opacity: 0; }
#hud.above .banner { top: 20%; }
#hud .banner > span { position: relative; display: block; flex: none; white-space: nowrap; text-align: center; font-size: calc(1em * var(--fit, 1)); }
#hud .banner b { display: block; font-family: ${FONT_TITLE}; line-height: 1.15; }
#hud .banner small { display: block; margin-top: .3em; font-size: 1.08em; letter-spacing: .26em; padding-left: .26em; color: #d9cdbb; }
#hud .banner.skill b { font-size: 3.5em; letter-spacing: .26em; padding-left: .26em; color: #fff3d6; text-shadow: 0 .045em 0 #9c2a22, 0 0 .07em rgba(${INK},.9), 0 0 .26em rgba(217,69,43,.5); }
#hud .banner.warn > span { padding: .62em 4.2em .68em; background: ${band('92,26,27', 0.86, 24)}; ${featherCss('.42em')} }
#hud .banner.warn b { font-size: 1.55em; letter-spacing: .3em; padding-left: .3em; text-shadow: 0 .05em 0 rgba(${INK},.9), 0 0 .12em rgba(${INK},.6); }
#hud .banner.boss > span { padding: .92em 5em 1.1em; background: ${band(INK, 0.82, 26)}; ${featherCss('.5em')} }
#hud .banner.boss b { font-size: 2.8em; letter-spacing: .42em; padding-left: .42em; text-shadow: 0 .05em 0 #1a1520, 0 0 .2em rgba(92,26,27,.9); }
#hud .banner.boss small { text-shadow: 0 .06em 0 #1a1520; }
#hud .banner.boss > span::before { content: ''; position: absolute; inset: 0; pointer-events: none; ${hairlinesCss('217,69,43', 0.8, '.5em', '10%', 25)} }

/* 手机上的神通按钮：按窗口定位（贴着右下角、让开刘海和底部横条），够大好按；一圈金色是真气 */
#hud .btn { position: fixed; right: max(14px, calc(var(--sar) + 6px)); bottom: max(16px, calc(var(--sab) + 8px)); --bs: clamp(64px, 18.5vmin, 96px); width: var(--bs); height: var(--bs); margin: 0; padding: 0; border: 0; border-radius: 50%; outline: none; pointer-events: auto; touch-action: none; display: none; align-items: center; justify-content: center;
  font-family: ${FONT_TITLE}; font-size: calc(var(--bs) * .3); line-height: 1; letter-spacing: .06em; text-indent: .06em; color: #d9cdbb; text-shadow: 0 .05em 0 rgba(${INK},.9);
  background: radial-gradient(closest-side, rgba(${INK},.74) calc(100% - 7.5px), rgba(${INK},0) calc(100% - 6.5px)); -webkit-appearance: none; appearance: none; }
#hud .btn::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(#f7dc7a var(--p, 0%), rgba(${INK},.66) 0);
  -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 5.5px), #000 calc(100% - 4.5px)); mask: radial-gradient(closest-side, transparent calc(100% - 5.5px), #000 calc(100% - 4.5px)); }
#hud .btn.full { color: #fff3d6; background: radial-gradient(closest-side, rgba(156,42,34,.86) calc(100% - 7.5px), rgba(156,42,34,0) calc(100% - 6.5px)); animation: hudready 1.1s ease-in-out infinite alternate; }
#hud .btn:active { transform: scale(.93); animation: none; transition: transform .08s, opacity .4s; }
@keyframes hudready { from { transform: scale(1); } to { transform: scale(1.06); } }
@media (pointer: coarse) { #hud .btn { display: flex; } #hud .tl .hint { display: none; } }

/* 陨落 / 通关面板：开着的时候顶上一排和神通按钮淡出去（成绩都在面板上；矮的画面上面板会压到顶上一排） */
#hud .top, #hud .btn { transition: opacity .4s; }
#hud.over .top, #hud.over .btn { opacity: 0; pointer-events: none; }
#hud .dim { position: fixed; inset: 0; display: none; background: rgba(${INK},.5); pointer-events: auto; }
#hud .death { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; }
#hud.over .dim { display: block; animation: hudfade .6s ease-out; }
#hud .death.on { display: flex; animation: hudfade .6s ease-out; }
#hud .death .card { pointer-events: auto; }
@keyframes hudfade { from { opacity: 0; } }
#hud .death .card { position: relative; max-width: 100%; padding: 1.3em 6em 1.5em; text-align: center; text-shadow: none; background: ${band(INK, 0.9, 20)}; ${featherCss('.6em')} }
#hud .death .card::before { content: ''; position: absolute; inset: 0; pointer-events: none; ${hairlinesCss('224,168,58', 0.75, '.6em', '8%', 25)} }
#hud .death h1 { margin: 0 0 .12em; font-family: ${FONT_TITLE}; font-size: 3.3em; font-weight: normal; line-height: 1.2; letter-spacing: .4em; padding-left: .4em; white-space: nowrap; color: #d9452b; text-shadow: 0 .05em 0 #1a1520; }
#hud .death.win h1 { color: #f7dc7a; }
#hud .death .s1 { margin: 0 0 .75em; font-size: 1.1em; letter-spacing: .12em; padding-left: .12em; white-space: nowrap; color: #d9cdbb; }
#hud .death .stats { display: grid; grid-template-columns: repeat(3, minmax(4.6em, auto)); justify-content: center; column-gap: 1.6em; margin: 0 0 1em; }
#hud .death .stats span { display: block; white-space: nowrap; color: #a99c93; }
#hud .death .stats b { display: block; margin-top: .1em; font-size: 1.3em; white-space: nowrap; color: #f2e8d5; }
/* 这一局得的道行（修为用，sim/xiuwei.ts）：在成绩和按钮之间一行；通关解锁了下一劫再接一行朱砂字 */
#hud .death .dao { margin: -.25em 0 1em; white-space: nowrap; color: #a99c93; letter-spacing: .06em; }
#hud .death .dao b { margin: 0 .2em 0 .45em; font-size: 1.3em; color: #f7dc7a; letter-spacing: .04em; }
#hud .death .dao i { color: #a99c93; }
#hud .death .dao .un { display: block; margin-top: .3em; color: #e0a83a; letter-spacing: .12em; }
#hud .death .dao[hidden] { display: none; }
#hud .death .acts { display: flex; justify-content: center; gap: 2.6em; }
/* 墨痕按钮（和标题、暂停的是一路）：底是一笔墨，焦点所在的那个换成朱砂、两侧各一枚金菱 */
#hud .ink { position: relative; isolation: isolate; flex: none; width: 6.4em; min-height: max(2.1em, 36px); margin: 0; padding: 0; border: 0; outline: none; background: none; cursor: pointer; white-space: nowrap;
  font-family: ${FONT_TITLE}; font-size: 1.3em; line-height: 1; letter-spacing: .16em; text-indent: .16em; color: #f2e8d5; text-shadow: 0 .05em 0 rgba(${INK},.8); -webkit-appearance: none; appearance: none; }
#hud .ink[hidden] { display: none; }
#hud .ink::before, #hud .ink::after { content: ''; position: absolute; z-index: -1; left: 10%; right: -10%; top: 50%; height: 1.5em; margin-top: -.75em; background: var(--ink) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
#hud .ink::after { background-image: var(--cin); clip-path: inset(0 100% 0 0); transition: clip-path .32s cubic-bezier(.3,.6,.2,1); }
#hud .ink:focus::after { clip-path: inset(0 0 0 0); }
#hud .ink:focus { color: #fff3d6; }
#hud .ink .dia { position: absolute; top: 50%; width: .34em; height: .34em; margin-top: -.17em; background: linear-gradient(135deg, #f7dc7a, #e0a83a 55%, #b06a28); box-shadow: 0 0 0 max(1px, .05em) #6b3d1e; opacity: 0; transition: opacity .25s, transform .25s; }
#hud .ink .dia.l { left: calc(10% - .8em); transform: translateX(-.25em) rotate(45deg); }
#hud .ink .dia.r { right: calc(-10% - .8em); transform: translateX(.25em) rotate(45deg); }
#hud .ink:focus .dia { opacity: 1; transform: rotate(45deg); }
@media (pointer: coarse) { #hud .ink { min-height: max(2.1em, 44px); } }
`;

/** 一张位图 → 图片地址。 */
function bitmapToUrl(b: { w: number; h: number; data: Uint8ClampedArray }): string {
  const c = document.createElement('canvas');
  c.width = b.w;
  c.height = b.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
  return c.toDataURL('image/png');
}

/** 只在值变了的时候才写：文字。 */
const textSetter = (el: HTMLElement) => {
  let last: string | null = null;
  return (v: string) => {
    if (v === last) return;
    last = v;
    el.textContent = v;
  };
};
/** 只在值变了的时候才写：开关一个类名。 */
const classSetter = (el: HTMLElement, name: string) => {
  let last: boolean | null = null;
  return (v: boolean) => {
    if (v === last) return;
    last = v;
    el.classList.toggle(name, v);
  };
};
/** 只在值变了的时候才写：条的填充（0..1，按千分之一取整）。条是往左平移出去的，不是横向压扁——尖头不会变形。 */
const fillSetter = (el: HTMLElement) => {
  let last = -1;
  return (f: number) => {
    const q = Math.round(Math.max(0, Math.min(1, f)) * 1000);
    if (q === last) return;
    last = q;
    el.style.transform = `translateX(${(q - 1000) / 10}%)`;
  };
};

export function mountHud(root: HTMLElement, h: HudHandlers) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'hud';
  el.innerHTML = `
    <div class="edge l"></div><div class="edge r"></div><div class="edge t"></div><div class="edge b"></div>
    <div class="top">
      <div class="tl">
        <span class="lb">气血</span><div class="bar hp"><span class="f"><b></b><i></i></span></div><span class="v hpn"></span>
        <span class="lb">真气</span><div class="bar sk"><span class="f"><i></i></span></div><span class="v"></span>
        <span class="lb">等级</span><div class="bar xp"><span class="f"><i></i></span></div><span class="v"><span class="lv">1</span><span class="note up"></span></span>
        <span class="hint">空格 · 放神通</span>
      </div>
      <div class="tc"><div class="wv"></div><div class="cd"></div><div class="eb"><div class="en"></div><div class="bar ebb"><span class="f"><b></b><i></i></span><u style="left:50%"></u></div></div></div>
      <div class="bossbar"><div class="bn"><span></span></div><div class="bar bb"><span class="f"><b></b><i></i></span><u style="left:60%"></u><u style="left:30%"></u></div></div>
      <div class="trw">
        <div class="tr"><span class="lb">斩敌</span><span class="n kills">0</span><span class="lb">灵石</span><span class="n ls">0</span><span class="lb wx5">五行</span><span class="n wx5">${ELEMENTS.map((e) => `<i style="background:${ELEMENT_COLOR[e]}"></i>`).join('')}</span></div>
        <div class="combo">连斩 ×0</div>
      </div>
    </div>
    <div class="banner"><span><b></b><small></small></span></div>
    <button type="button" class="btn" aria-label="神通">神通</button>
    <div class="dim"></div>
    <div class="death"><div class="card">
      <h1>陨落</h1>
      <p class="s1"></p>
      <div class="stats"><div><span>用时</span><b class="st"></b></div><div><span>斩敌</span><b class="sk2"></b></div><div><span>最高连斩</span><b class="sc"></b></div></div>
      <p class="dao" hidden></p>
      <div class="acts"><button type="button" class="ink again"><i class="dia l"></i>再战<i class="dia r"></i></button><button type="button" class="ink home"><i class="dia l"></i>回到标题<i class="dia r"></i></button></div>
    </div></div>`;
  root.appendChild(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const hpB = $('.hp b');
  const bossN = $('.bossbar .bn');
  const bossNText = $('.bossbar .bn span');
  const boss = $('.bossbar');
  const top = $('.top');
  const tl = $('.tl');
  const trw = $('.trw');
  const combo = $('.combo');
  const banner = $('.banner');
  const bannerBox = $('.banner > span');
  const bannerSub = $('.banner small');
  const bannerText = $('.banner b');
  const btn = $<HTMLButtonElement>('.btn');
  const death = $('.death');
  const again = $<HTMLButtonElement>('.ink.again');
  const home = $<HTMLButtonElement>('.ink.home');
  home.hidden = !h.onQuit;

  // ---------- 只在变了的时候才写 ----------
  const setLabel = textSetter($('.tc .wv'));
  const setCd = textSetter($('.tc .cd'));
  const setLow = classSetter($('.tc'), 'low');
  const setOff = classSetter($('.tc'), 'off');
  const setXp = fillSetter($('.xp i'));
  const setLv = textSetter($('.lv'));
  const setUp = textSetter($('.up'));
  const setLs = textSetter($('.ls'));
  const setKills = textSetter($('.kills'));
  const setWx5 = classSetter($('.tr'), 'wx5on');
  const setBossOn = classSetter(boss, 'on');
  const echoBar = $('.tc .eb');
  const setEchoOn = classSetter(echoBar, 'on');
  const setEchoName = textSetter($('.tc .eb .en'));
  const setEchoI = fillSetter($('.ebb i'));
  const setEchoB = fillSetter($('.ebb b'));
  let lastEchoOpacity = -1;
  const setBossI = fillSetter($('.bb i'));
  const setBossB = fillSetter($('.bb b'));
  const setHp = fillSetter($('.hp i'));
  const setHpFlash = fillSetter(hpB);
  const setHpText = textSetter($('.hpn'));
  const setHpLow = classSetter($('.hpn'), 'low');
  const setSk = fillSetter($('.sk i'));
  const setSkFull = classSetter($('.sk'), 'full');
  const setHint = classSetter($('.hint'), 'on');
  const setBtnFull = classSetter(btn, 'full');
  const setComboOn = classSetter(combo, 'on');
  const setComboText = textSetter(combo);
  let lastBossName = '';
  let refitBoss = false;
  let lastBossOpacity = -1;
  let lastP = -1;
  let visible = true;

  // ---------- 跟着画布走 ----------
  let deathOn = false; // 陨落 / 通关面板开着
  let lockUntil = 0; // 面板刚出来的一小会儿不认按键和点击（人倒下时多半还在按空格）
  let leaving = false; // 已经点了「回到标题」
  let fitNow: OverlayFit | null = null;
  let strokeKey = '';
  const coarse = matchMedia('(pointer: coarse)');
  const pauseBox = { fromRight: 44, bottom: 44 }; // 手机右上角暂停钮的位置（见下面的 reservePause）
  const fitBossName = () => {
    if (!bossN.classList.contains('long') || !fitNow) return;
    bossN.style.setProperty('--fit', '1');
    const need = bossNText.offsetWidth;
    const b = boss.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    // 长名字可以比血条宽（居中往两边溢出），但不能碰到左右那两组
    // （竖屏分两行时首领名自己占一行，按整个宽度算）
    const room = el.classList.contains('narrow')
      ? fitNow.width - fitNow.base * 1.6
      : 2 * Math.min(cx - tl.getBoundingClientRect().right, trw.getBoundingClientRect().left - cx) - fitNow.base * 1.2;
    if (room > 0 && need > room) bossN.style.setProperty('--fit', Math.max(0.6, room / need).toFixed(3));
  };
  const strokes = () => {
    // 墨痕按钮的底：按现在的大小画一笔，一个墨痕像素约等于一个游戏像素
    if (!fitNow) return;
    const fs = fitNow.base * 1.3;
    const w = Math.max(24, Math.round((fs * 6.4) / fitNow.unit));
    const hh = Math.max(7, Math.round((fs * 1.5) / fitNow.unit));
    if (strokeKey === `${w}x${hh}`) return;
    strokeKey = `${w}x${hh}`;
    for (const b of [again, home]) {
      const seed = b === again ? 11 : 29;
      b.style.setProperty('--ink', `url("${bitmapToUrl(makeInkStroke(w, hh, seed + w, 'ink'))}")`);
      b.style.setProperty('--cin', `url("${bitmapToUrl(makeInkStroke(w, hh, seed + 3 + w, 'cinnabar'))}")`);
    }
  };
  const follower = followCanvas(el, (f) => {
    fitNow = f;
    const above = hudAbove(f);
    el.classList.toggle('above', above);
    el.classList.toggle('narrow', above && f.width / f.base < 30);
    // 画布哪几边没贴到窗口边（留了空边）：那几边要淡出
    const gaps = { l: f.left, t: f.top, r: innerWidth - (f.left + f.width), b: innerHeight - (f.top + f.height) };
    for (const [k, g] of Object.entries(gaps)) {
      el.classList.toggle(`g${k}`, g > 1);
      el.style.setProperty(`--g${k}`, `${Math.max(0, g).toFixed(1)}px`);
    }
    el.style.setProperty('--vw', `${innerWidth}px`);
    el.style.setProperty('--vh', `${innerHeight}px`);
    refitBoss = true;
    if (deathOn) strokes();
    reservePause();
  }, unhook);

  // ---------- 手机右上角的暂停钮 ----------
  // 暂停钮按窗口定位（pause.ts 的 #fs-pause .pbtn，只在触屏上有）。画布铺到窗口右上角时它会压在「斩敌」上，右上那组要往左让开。
  // 量得到就按量的；量不到时（它此刻藏着，或那一层还没挂上）按上一次量到的位置，最初按它平时的样子估：离右边缘 44 像素、高 44 像素。
  function reservePause() {
    if (!fitNow) return;
    let pr = 0;
    if (coarse.matches) {
      // 暂停钮左边可能还有一块全屏小牌（pause.ts）：取最左边那块
      const rs = [...document.querySelectorAll('#fs-pause .pbtn')].map((b) => b.getBoundingClientRect()).filter((x) => x.width > 0);
      const r = rs.length ? rs.reduce((a, b) => (b.left < a.left ? b : a)) : undefined;
      if (r && r.width > 0) {
        pauseBox.fromRight = innerWidth - r.left;
        pauseBox.bottom = r.bottom;
      }
      const intrude = fitNow.left + fitNow.width - (innerWidth - pauseBox.fromRight);
      // 顶上一排的上沿：平时是画布的上沿；挪到画布上面时是那一排自己的上沿
      const rowTop = el.classList.contains('above') ? fitNow.top - top.offsetHeight : fitNow.top;
      if (intrude > 0 && pauseBox.bottom > rowTop + 2) pr = intrude + fitNow.base * 0.35;
    }
    el.style.setProperty('--pr', `${pr.toFixed(1)}px`);
  }

  // ---------- 转屏提示盖住画面时通知一声（暂停由调用方做） ----------
  const rotate = document.getElementById('rotate');
  let obscured = false;
  const checkObscured = () => {
    const now = !!rotate && getComputedStyle(rotate).display !== 'none';
    if (now && !obscured) h.onObscured?.();
    obscured = now;
    requestAnimationFrame(reservePause);
  };
  addEventListener('resize', checkObscured);
  setTimeout(checkObscured, 0);
  setTimeout(reservePause, 400); // 暂停那一层比战斗界面晚挂上

  // ---------- 神通按钮 ----------
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 别同时起摇杆
    h.onSkill();
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 陨落 / 通关面板 ----------
  const live = () => [again, home].filter((b) => !b.hidden);
  again.addEventListener('click', () => {
    if (!deathOn || leaving || performance.now() < lockUntil) return;
    h.onRestart();
  });
  home.addEventListener('click', () => {
    if (!deathOn || leaving || performance.now() < lockUntil) return;
    leaving = true;
    h.onQuit?.();
  });
  for (const b of [again, home])
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') b.focus({ preventScroll: true }); // 鼠标移上去就把焦点给它：键盘和鼠标看到的是同一个「当前按钮」
    });
  // 面板开着时，整个窗口（压暗的那一层）上的点击都不漏给战场：不起摇杆、不当成「点一下再战」
  for (const layer of [$('.dim'), death]) layer.addEventListener('pointerdown', (e) => e.stopPropagation());
  const onKey = (e: KeyboardEvent) => {
    if (!deathOn || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const bs = live();
    const cur = bs.indexOf(document.activeElement as HTMLButtonElement);
    const step = k === 'arrowleft' || k === 'arrowup' || k === 'a' || k === 'w' || (k === 'tab' && e.shiftKey) ? -1 : k === 'arrowright' || k === 'arrowdown' || k === 'd' || k === 's' || k === 'tab' ? 1 : 0;
    if (step) {
      e.preventDefault();
      bs[cur < 0 ? 0 : (cur + step + bs.length) % bs.length]?.focus({ preventScroll: true });
    } else if (k === 'enter' || k === ' ' || k === 'j') {
      e.preventDefault(); // 按钮自己的回车 / 空格不再触发一遍
      if (!e.repeat) (bs[cur] ?? bs[0])?.click();
    }
  };
  addEventListener('keydown', onKey);
  /** 摘掉挂在 window 上的监听（这一层被移出页面时 followCanvas 会调）。 */
  function unhook() {
    removeEventListener('resize', checkObscured);
    removeEventListener('keydown', onKey);
  }

  // ---------- 连斩、横幅、受击 ----------
  let comboN = 0;
  let comboShown = 0;
  let comboDirty = false;
  const comboPop = combo.animate([{ transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
  comboPop.cancel();
  const hpFlash = hpB.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 350, easing: 'ease-out' });
  hpFlash.cancel();
  let bannerAnim: Animation | null = null;

  return {
    update(s: { hp: number; hpText?: string; skill: number; time: number; kills: number; xp: number; wave: number; waveLabel: string; left: number; lingshi: number; level: number; pending: number; wx5?: boolean; echo?: { name: string; frac: number; alpha: number } | null; boss: { name: string; frac: number; phase: number; alpha: number; behind?: boolean } | null }) {
      // 顶上中间：首领战只留首领的名字和血条；首领波没有倒计时
      const noTimer = !!s.boss || s.left < 0;
      const left = Math.max(0, Math.ceil(s.left));
      setLabel(s.waveLabel);
      setCd(noTimer ? '' : String(left).padStart(2, '0'));
      setLow(!noTimer && left <= 5);
      setOff(noTimer);
      setBossOn(!!s.boss);
      setWx5(!!s.wx5);
      // 回响化身：倒计时下面的小血条（现身时淡入，打倒、退走时淡出）
      setEchoOn(!!s.echo && !s.boss);
      if (s.echo) {
        setEchoName(s.echo.name);
        setEchoI(s.echo.frac);
        setEchoB(s.echo.frac);
        const o = Math.round(Math.max(0, Math.min(1, s.echo.alpha)) * 100);
        if (o !== lastEchoOpacity) {
          lastEchoOpacity = o;
          echoBar.style.opacity = String(o / 100);
        }
      }
      if (s.boss) {
        const name = s.boss.name;
        if (name !== lastBossName) {
          lastBossName = name;
          bossNText.textContent = name;
          bossN.classList.toggle('long', name.length > 6); // 「第二章首领（暂用魔化哪吒）」这种长名字用小一号的字
          refitBoss = true;
        }
        if (refitBoss) {
          refitBoss = false;
          fitBossName(); // 血条显示出来之后才量得到宽度
        }
        setBossI(s.boss.frac);
        setBossB(s.boss.frac);
        // 首领走到血条底下时把血条压淡，免得挡住人
        const o = Math.round(Math.max(0, Math.min(1, s.boss.alpha)) * (s.boss.behind ? 0.35 : 1) * 100);
        if (o !== lastBossOpacity) {
          lastBossOpacity = o;
          boss.style.opacity = String(o / 100);
        }
      }
      // 左上
      setHp(s.hp);
      setHpText(s.hpText ?? '');
      setHpLow(s.hp > 0 && s.hp < 0.3);
      setSk(s.skill);
      const full = s.skill >= 1;
      setSkFull(full);
      setHint(full);
      setBtnFull(full);
      const p = Math.round(Math.max(0, Math.min(1, s.skill)) * 100);
      if (p !== lastP) {
        lastP = p;
        btn.style.setProperty('--p', `${p}%`);
      }
      setXp(s.xp);
      setLv(String(s.level));
      setUp(s.pending ? `升级 ×${s.pending}` : '');
      // 右上
      setKills(String(s.kills));
      setLs(String(s.lingshi));
      // 连斩：一帧里不管斩了几个，只在这里更新一次
      if (comboDirty) {
        comboDirty = false;
        const on = comboN >= 5;
        setComboOn(on);
        if (on) {
          setComboText(`连斩 ×${comboN}`);
          if (comboN > comboShown) {
            comboPop.cancel();
            comboPop.play();
          }
        }
        comboShown = on ? comboN : 0;
      }
    },
    combo(n: number) {
      comboN = n;
      comboDirty = true;
    },
    /** 大字横幅：skill 书法金字（神通、平定）；warn 朱底（波次、精英）；boss 墨底上下两道朱线（首领名、首领招式、章节平定）。 */
    banner(text: string, kind: 'skill' | 'warn' | 'boss', sub = '') {
      banner.className = `banner ${kind}`;
      bannerText.textContent = text;
      bannerSub.textContent = sub;
      bannerSub.style.display = sub ? 'block' : 'none';
      // 不换行；比画面窄一些才好看，放不下就整体缩小
      bannerBox.style.setProperty('--fit', '1');
      const room = (fitNow?.width ?? banner.clientWidth) * 0.94;
      const need = bannerBox.offsetWidth;
      if (need > room && room > 0) bannerBox.style.setProperty('--fit', (room / need).toFixed(3));
      // 出现和消失都要有过程（用户口径）：淡入时略收一点，停一会儿，再慢慢淡出
      bannerAnim?.cancel();
      bannerAnim = banner.animate(
        kind === 'boss'
          ? [{ opacity: 0, transform: 'scale(1.05)' }, { opacity: 1, transform: 'scale(1)', offset: 0.2 }, { opacity: 1, offset: 0.72 }, { opacity: 0, transform: 'scale(1)' }]
          : [{ opacity: 0, transform: 'scale(1.15)' }, { opacity: 1, transform: 'scale(1)', offset: 0.14 }, { opacity: 1, offset: 0.72 }, { opacity: 0, transform: 'translateY(-4%)' }],
        { duration: kind === 'boss' ? 2800 : 1600, easing: 'ease-out', fill: 'forwards' },
      );
    },
    /** 现在这条横幅放完（淡出）时 resolve；没有横幅在放就立刻 resolve。给「等横幅放完再开对白 / 商店」用。 */
    bannerDone(): Promise<void> {
      const a = bannerAnim;
      if (!a || a.playState !== 'running') return Promise.resolve();
      return a.finished.then(
        () => undefined,
        () => undefined, // 被下一条横幅顶掉了
      );
    },
    hurt(hp: number) {
      setHpFlash(hp);
      hpFlash.cancel();
      hpFlash.play();
    },
    /**
     * 陨落 / 通关面板。jie：这一局的劫数；dao：这一局得的道行（sim/xiuwei.daoBreakdown 的结果，加上新解锁的劫数、是不是调试开局）。
     */
    showDeath(s: { time: number; kills: number; combo: number; wave: number; win?: boolean; jie?: number; dao?: { total: number; mul: number; unlocked: number; debug: boolean } }) {
      const sec = Math.floor(s.time);
      const wave = Math.max(1, s.wave);
      death.classList.toggle('win', !!s.win);
      $('.death h1').textContent = s.win ? '回响平定' : '陨落';
      // 波数的写法和顶上一致：第几章 · 第几波（不是全局的第几波）
      $('.s1').textContent = s.win ? '全部章节平定' : `止步 ${CHAPTER_NAME[chapterOf(wave)] ?? `第 ${chapterOf(wave)} 章`} · 第 ${waveInChapter(wave)} 波`;
      $('.st').textContent = `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
      $('.sk2').textContent = String(s.kills);
      $('.sc').textContent = `×${s.combo}`;
      const dao = $('.dao');
      dao.hidden = !s.dao;
      if (s.dao) {
        const jie = s.jie && s.jie > 1 ? `${JIE_TIERS[s.jie - 1].name} ×${+s.dao.mul.toFixed(2)}` : '';
        const un = s.dao.unlocked ? `<span class="un">解锁 ${JIE_TIERS[s.dao.unlocked - 1].name} · ${JIE_TIERS[s.dao.unlocked - 1].title}</span>` : '';
        dao.innerHTML = `道行<b>+${s.dao.total}</b>${jie ? `<i>（${jie}）</i>` : ''}${s.dao.debug ? '<i>（调试开局，不记）</i>' : ''}${un}`;
      }
      deathOn = true;
      leaving = false;
      lockUntil = performance.now() + 700;
      death.classList.add('on');
      el.classList.add('over');
      strokes();
      // 焦点：陨落给「再战」，通关给「回到标题」（通关后的提示正叫人回标题页导出存档码）
      (s.win && !home.hidden ? home : again).focus({ preventScroll: true });
    },
    hideDeath() {
      if (!deathOn) return;
      deathOn = false;
      death.classList.remove('on');
      el.classList.remove('over');
      for (const b of [again, home]) b.blur();
    },
    /** 波间界面、对白时把战斗界面藏起来。 */
    setVisible(v: boolean) {
      if (v === visible) return;
      visible = v;
      el.style.visibility = v ? 'visible' : 'hidden';
    },
    /** 摘掉监听（这一层被移出页面时也会自己摘，调不调都行）。 */
    dispose() {
      follower.dispose();
    },
  };
}
