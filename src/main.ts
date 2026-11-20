import { applyFontTheme, loadFonts, loadPixelFont, loadTitleFonts } from './game/fonts.ts';
import { getSettings, hasSeen, markSeen, onSettingsChange } from './game/profile.ts';
import { CHAPTER_CUTSCENES } from './game/story.ts';
import { runFrontEnd, type FrontEnd } from './game/title.ts';
import { uiSfx, wait } from './game/front-ui.ts';
import { startPreload } from './game/preload.ts';
import { showLoadingStatus } from './game/loading-status.ts';

// 首包只有标题页这一层（标题、设置、致谢）：打开页面要下的最少（docs/deploy.md「包体积」）。
// 选角页（连带角色表和整套模拟）、联机大厅、战斗（feel.ts，连带 PixiJS 和特效）、实验页、过场都按需 import()：
// 标题页一画出来就在后台按顺序下（game/preload.ts：选角 → 完整字体 → 战斗与像素体 → 大厅、修为、图鉴），玩家点下去时多半早就到了；
// 带调试参数直接进局的就地等它们。
const loadGame = () => import('./game/feel.ts');
/** 标题页的开场动画约 3.3 秒：战斗那一包等它放完再执行（解析、执行要占几十到一两百毫秒，别让开场动画卡一下），下载不等。 */
const INTRO_MS = 3300;

// 启动流程：载入字体 → 标题页 → 选角 → 开一局；暂停面板里「回到标题」→ 拆掉这一局 → 回到标题页，如此往复。
// 网址带调试参数时第一次跳过标题页直接进局（保持原来的行为，方便测试）：?art 画风试画；?bot 机器人自动玩；
// ?wave= / ?gold= 从某一波开始；?fxlab、?enemylab 这类实验页（参数名以 lab 结尾的都算，实验页自己在下面分流）。
// 和这些参数一起加 ?title 就照样先进标题页。
// ?intro：从标题页进局时一定放第一章的开场过场（平时这台设备上只自动放第一次）。
// 联机（docs/netcode.md）：?room=ABCD 打开就进那个房的大厅；?online 打开就是大厅（测试用）。带着它们时不跳过标题页（大厅在标题页上），
// ?bot 照样生效（进了局由机器人替自己打）。
const params = new URLSearchParams(location.search);
const DEBUG = ['art', 'bot', 'wave', 'gold'];
const netEntry = params.has('room') || params.has('online');
const skipTitle = [...params.keys()].some((k) => DEBUG.includes(k) || k.endsWith('lab')) && !params.has('title') && !netEntry;

/**
 * index.html 里的首次载入画面（#boot）：第一个界面挂上、画出来之后收场——金线走满、淡出（那边的脚本 window.__fsBoot.finish）。
 * 页面上没有这个元素时什么都不做。
 */
function bootDone() {
  const b = (window as { __fsBoot?: { finish(): void } }).__fsBoot;
  requestAnimationFrame(() => (b ? b.finish() : document.getElementById('boot')?.remove()));
}

async function boot() {
  await Promise.race([loadTitleFonts(), wait(300)]); // 网络慢时先显示界面，字体到达后自动替换
  // 字体主题（设置里的「文楷 / 书法」）：先按存档里的应用，以后设置一变（包括导入存档码、别的标签页改了）就跟着变
  applyFontTheme(getSettings().fontTheme);
  onSettingsChange((s) => applyFontTheme(s.fontTheme));
  const mount = document.getElementById('stage')!;
  // 实验页在这里分流（不进标题页、不进局）；它们的代码只在打开实验页时才下载
  const lab = params.has('art')
    ? () => import('./trial/art-trial.ts').then((m) => m.startArtTrial)
    : params.has('enemylab')
      ? () => import('./game/enemy-lab.ts').then((m) => m.startEnemyLab)
      : params.has('fxlab')
        ? () => import('./game/fx-lab.ts').then((m) => m.startFxLab)
        : params.has('herolab')
          ? () => import('./game/hero-lab.ts').then((m) => m.startHeroLab)
          : params.has('echolab')
            ? () => import('./game/echo-lab.ts').then((m) => m.startEchoLab) // 回响化身遭遇战（?echolab=zhao / yunxiao）
            : null;
  if (lab) {
    const [start] = await Promise.all([lab(), loadPixelFont(), loadFonts()]);
    await start(mount);
    return bootDone();
  }
  // 标题页一调用就同步挂上（玩家选好角色时才返回，那时这一层已经压暗）
  const first = skipTitle ? null : runFrontEnd({ room: params.get('room') ?? undefined, online: params.has('online') });
  if (first) {
    bootDone();
    performance.mark('fs-title'); // 标题页挂上了：之前下的算首屏、之后的算后台预载（tools/bundle-size.mjs 按它分）
    // 后台预载：标题页画出来就开始（game/preload.ts）
    startPreload(wait(netEntry ? 0 : INTRO_MS), netEntry);
  }
  let fe: FrontEnd | null = await first;
  for (;;) {
    if (fe && !fe.net) await chapterIntro(1); // 从标题页进局的才放；带调试参数直接进局的不放；联机的不放（大家要一起开打）
    let quit = () => {};
    const quitting = new Promise<void>((r) => (quit = r));
    const loading = showLoadingStatus(fe?.net ? '正在准备联机游戏，请稍候…' : '正在准备游戏，请稍候…');
    const [{ startFeelPrototype }] = await loading.waitFor(Promise.all([loadGame(), loadPixelFont(), loadFonts()]), 60000).catch(e => { loading.close(); throw e; });
    // 选角页选的角色、选劫页选的劫数（联机的看大厅；调试直接进局的看 ?hero=、?jie=）
    const game = await startFeelPrototype(mount, { sfx: uiSfx(), onQuit: () => quit(), net: fe?.net, hero: fe?.hero, jie: fe?.jie }).catch(e => { loading.close(); throw e; });
    bootDone(); // 带调试参数直接进局的：这一局就是第一个界面
    replayHint();
    await fe?.done(); // 游戏建好了，标题这一层淡出
    loading.close();
    await quitting;
    // 回到标题：先压暗，在暗处拆掉这一局、摆好标题页（runFrontEnd 一调用就同步挂上不透明的一层），再亮起来。
    // 标题页这时直接是最后的样子（开场动画只在打开页面后的第一次放），亮起来不超过半秒
    const c = curtain();
    await wait(560);
    game.dispose();
    // 从调试参数（?bot、?wave= 等）进的那一局结束了：回到标题之后就是正常的一局，把参数去掉
    if (location.search) {
      const connection = new URLSearchParams();
      for (const key of ['relay', 'network', 'transport']) {
        const value = new URLSearchParams(location.search).get(key);
        if (value) connection.set(key, value);
      }
      history.replaceState(null, '', location.pathname + (connection.size ? `?${connection}` : ''));
    }
    const next = runFrontEnd();
    void lift(c);
    fe = await next;
  }
}

/**
 * 一章的开场过场：选完角色、这一局建起来之前放（这时标题那一层已经压暗，过场盖在它上面）。
 * 这台设备上只自动放第一次（可以跳过；跳过也算看过），免得每开一局都要等；网址带 ?intro 时每次都放。
 * 过场的代码和画面用到才下载；下载失败、放的时候出错都不拦着进游戏。
 */
async function chapterIntro(chapter: number) {
  const id = CHAPTER_CUTSCENES[chapter]?.intro;
  if (!id || (hasSeen(id) && !params.has('intro'))) return;
  try {
    const { playCutscene } = await import('./game/cutscene.ts');
    await playCutscene(id, { sfx: uiSfx() });
    markSeen(id);
  } catch (e) {
    console.error(e);
  }
}

/** 一块盖住整屏的暗幕（回到标题时用）：先淡入，等 lift 再淡出移除。 */
function curtain(): HTMLElement {
  const c = document.createElement('div');
  Object.assign(c.style, { position: 'fixed', inset: '0', zIndex: '9', background: '#1a1520', opacity: '0', transition: 'opacity .55s ease-in', pointerEvents: 'auto' });
  document.body.appendChild(c);
  void c.offsetWidth;
  c.style.opacity = '1';
  return c;
}
async function lift(c: HTMLElement) {
  await wait(60);
  c.style.transition = 'opacity .42s ease-out';
  c.style.opacity = '0';
  c.style.pointerEvents = 'none'; // 一开始亮就能点、能按，不用等暗幕完全淡完
  await wait(440);
  c.remove();
}

/** 底部的操作提示（index.html 里的 #hint）：进了局再亮 6 秒。 */
function replayHint() {
  const hint = document.getElementById('hint');
  if (!hint) return;
  hint.style.transition = 'none';
  hint.style.opacity = '1';
  void hint.offsetWidth;
  hint.style.transition = '';
  setTimeout(() => (hint.style.opacity = '0'), 6000);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('boot')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#d9452b;position:fixed;top:0;left:0;margin:8px;font:14px/1.5 var(--font-text, serif);white-space:pre-wrap">${String(e)}</pre>`);
});
