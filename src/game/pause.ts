// 暂停（DOM）：局内按 Esc / P（手机上是右上角的一块小牌）弹出暂停面板：继续、设置、回到标题（要二次确认）。
// 页面切到后台（切应用、锁屏）时也自动暂停。
//
// 这个模块管按键、按钮、面板、paused 状态，以及暂停时的配乐（暂停时配乐停在原处，继续时接着放；界面音效照常响）。
// 不碰游戏本身：暂停时模拟不推进，要 feel.ts 主循环自己看一眼：
//   const pause = mountPause({ onQuit: () => …回到标题…, onPause, onResume });
//   app.ticker.add(() => { if (pause.paused) return; … });   // 或者 import { paused } from './pause.ts'（实时绑定）
// 暂停期间所有按下的键都被面板拦下（空格、J 不会漏给游戏去放神通），松开按键照常放行（免得方向键卡住）。
//
// 这一层的 z-index 比万宝阁高：万宝阁里也能暂停、回到标题，面板盖在万宝阁上面。
// 手机上的小牌平时在窗口右上角（避开刘海和圆角）。万宝阁打开时那里是灵石数：feel.ts 这时调 setButtonVisible(false)
// （= setCornerFree(false)），小牌不藏，而是挪到灵石框的左边、和它一样高的位置；找不到灵石框才藏起来。
// 灵石框怎么找：#inter 里带 data-pause-anchor 的元素 → .ls → 横梁（header）最右边的那一块。万宝阁改版时保住其中一个就行。
// 16:9 的手机上画面两侧没有空边，小牌会压在战斗界面右上角的斩数、灵石上：这里把小牌伸进画面的宽度写进
// --fs-pause-inset（:root 上；另有 --fs-pause-reach = 从窗口右边缘起占的宽度），并让战斗界面右上角那一块
// （#hud .tr）往左让出这么多。战斗界面改版时，右上角的东西照着这两个变量之一让开就行。
import type { Sfx } from '../audio/sfx.ts';
import { FULLSCREEN_ICON, PAUSE_ICON, WINDOWED_ICON } from '../art/title.ts';
import { C, P, bitmapUrl, centerIn, inkButton, inkWidth, injectCss, isTyping, mountLayer, navKeys, pushKeys, scrollPanel, snapPx, uiSfx, wait, type ScrollPanel } from './front-ui.ts';
import { openSettings } from './settings.ts';
import { hudAboveEm } from './ui-scale.ts';
import { isFullscreen, onFullscreenChange, setFullscreen, showFullscreenToggle } from './fullscreen.ts';

/** 现在是否暂停（实时绑定：别的模块 import 进去，读到的总是最新值）。 */
export let paused = false;

export interface PauseOptions {
  /** 玩家确认「回到标题」。 */
  onQuit(): void;
  /** 暂停了（可以在这里松开摇杆）。配乐由这个模块自己停。 */
  onPause?(): void;
  /** 继续了。 */
  onResume?(): void;
  /** 界面音效（默认用全游戏共用的那个）。 */
  sfx?: Sfx;
}

export interface PauseHandle {
  readonly paused: boolean;
  /** 暂停并打开面板。 */
  open(): void;
  /** 关上面板、继续。 */
  resume(): void;
  /** 对白、过场、陨落面板这类时候可以先关掉暂停（关掉时 Esc / P 和小牌都不响应）。 */
  setEnabled(v: boolean): void;
  /**
   * 窗口右上角空不空。万宝阁打开时那里是灵石数（传 false）：小牌挪到灵石框左边，照样能点；找不到灵石框才藏起来。
   */
  setCornerFree(v: boolean): void;
  /** 旧名字（feel.ts 在用），等同 setCornerFree：现在传 false 不再是「藏起来」，而是「右上角有东西，挪开」。 */
  setButtonVisible(v: boolean): void;
  dispose(): void;
}

/** 暂停面板的宽度（em）：菜单和确认两页同宽，换页时不跳。 */
const PANEL_W = 17.5;

const CSS = `
#fs-pause { pointer-events: none; }
#fs-pause .pbtn { position: absolute; width: var(--pb); height: var(--pb); display: none; align-items: center; justify-content: center; pointer-events: auto; opacity: .86; }
#fs-pause .pbtn i { display: block; width: ${P(12)}; height: ${P(12)}; background: var(--icon) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
#fs-pause .pbtn:active { opacity: 1; }
#fs-pause .coarse .pbtn.on { display: flex; }
#fs-pause .veil { pointer-events: auto; background: rgba(26,21,32,.55); opacity: 0; transition: opacity .3s; }
#fs-pause .veil.on { opacity: 1; }
#fs-pause .scroll { pointer-events: auto; }
#fs-pause .scroll.pmenu .paper { align-items: center; }
/* 菜单：同宽的按钮沿中轴排成一列，间距一样 */
#fs-pause .scroll .menu { display: flex; flex-direction: column; align-items: center; gap: ${P(2)}; }
#fs-pause .scroll .ask { text-align: center; color: ${C.wu}; margin-bottom: .3em; }
/* 小牌伸进画面右上角时，战斗界面右上角那一块往左让开（hud.ts 的 .tr） */
#hud .tr { margin-right: var(--fs-pause-inset, 0px); }
`;

export function mountPause(o: PauseOptions): PauseHandle {
  injectCss('fs-pause', CSS);
  const sfx = o.sfx ?? uiSfx();
  const layer = mountLayer('fs-pause', 8);
  const ui = layer.ui;
  // 右上角的小牌（触屏才显示）
  const pbtn = document.createElement('button');
  pbtn.type = 'button';
  pbtn.className = 'pbtn on';
  pbtn.setAttribute('aria-label', '暂停');
  pbtn.style.setProperty('--icon', `url("${bitmapUrl(PAUSE_ICON)}")`);
  pbtn.innerHTML = '<i></i>';
  ui.appendChild(pbtn);
  // 小牌左边一块同样的「全屏」小牌（2026-11-12）：触屏上、支持网页全屏、不是从主屏幕打开的才有；右上角被万宝阁占着时不出（暂停面板里照样能切）
  const canFs = showFullscreenToggle();
  const fbtn = document.createElement('button');
  fbtn.type = 'button';
  fbtn.className = 'pbtn';
  const fsIcon = () => {
    fbtn.style.setProperty('--icon', `url("${bitmapUrl(isFullscreen() ? WINDOWED_ICON : FULLSCREEN_ICON)}")`);
    fbtn.setAttribute('aria-label', isFullscreen() ? '退出全屏' : '全屏');
  };
  fsIcon();
  fbtn.innerHTML = '<i></i>';
  if (canFs) ui.appendChild(fbtn);
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.display = 'none';
  ui.appendChild(veil);

  let enabled = true;
  let cornerFree = true;
  let anchored = true; // 右上角被占着时：找到灵石框、挪过去了没有
  let placedAt = 0;
  let panel: ScrollPanel | null = null;
  let view: 'menu' | 'confirm' | 'settings' | 'none' = 'none';
  let items: HTMLElement[] = [];
  let quitting = false;
  // 面板的切换（展开、卷起、换页、开设置）一个接一个排队做：动画进行中点的按钮不会被吞掉，等前一个做完就接着做
  let chain: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void> | void) => (chain = chain.then(fn).catch((e) => console.error(e)));

  const showButton = () => {
    pbtn.classList.toggle('on', enabled && !paused && (cornerFree || anchored));
    fbtn.classList.toggle('on', canFs && enabled && !paused && cornerFree);
  };

  /** 摆小牌：平时在窗口右上角；右上角被万宝阁的灵石占着时挪到灵石框左边。 */
  const placeButton = () => {
    const f = layer.fit;
    placedAt = performance.now();
    const pb = Math.max(f.tap, 36);
    const m = 4;
    ui.style.setProperty('--pb', `${pb}px`);
    let left = f.w - f.safe.right - m - pb;
    let top = f.safe.top + m;
    let inset = 0;
    if (cornerFree) {
      // 伸进画面矩形多少（画面两侧有空边的手机上是 0）。竖屏时战斗界面顶上那一排挪到了画布上面（ui-scale.ts 的 hudAboveEm），
      // 小牌在它上面、碰不到的话也是 0
      const frameRight = f.frame.left + f.frame.width;
      const rowTop = f.frame.top - hudAboveEm(f.frame.top, f.frame.width, f.base, f.safe.top) * f.base;
      const reach = canFs ? pb * 2 : pb; // 连同全屏小牌
      if (f.coarse && enabled && top + pb + m > rowTop) inset = Math.max(0, Math.min(reach + m * 2, frameRight - (left - (reach - pb))));
      anchored = true;
    } else {
      // 万宝阁右上角要避开的东西：优先找带 data-pause-anchor 的元素，其次是灵石框（.ls），再其次是横梁最右边的那一块
      const ls = document.querySelector('#inter [data-pause-anchor]') ?? document.querySelector('#inter .ls') ?? document.querySelector('#inter header > :last-child');
      const r = ls?.getBoundingClientRect();
      anchored = !!r && r.width > 0 && r.height > 0;
      if (r && anchored) {
        left = Math.max(f.safe.left + m, r.left - m * 2 - pb);
        top = Math.max(f.safe.top, r.top + r.height / 2 - pb / 2);
      }
    }
    Object.assign(pbtn.style, { left: `${snapPx(left, f)}px`, top: `${snapPx(top, f)}px` });
    Object.assign(fbtn.style, { left: `${snapPx(left - pb, f)}px`, top: `${snapPx(top, f)}px` });
    // 告诉战斗界面右上角要让出多少：--fs-pause-inset 是小牌伸进画面矩形的宽度（按画面矩形摆的东西用它），
    // --fs-pause-reach 是小牌连同空隙从窗口右边缘起占的宽度（按窗口摆的东西用它）。没有小牌时两个都不设
    const rootStyle = document.documentElement.style;
    const shown = cornerFree && f.coarse && enabled;
    if (inset > 0) rootStyle.setProperty('--fs-pause-inset', `${Math.round(inset)}px`);
    else rootStyle.removeProperty('--fs-pause-inset');
    if (shown) rootStyle.setProperty('--fs-pause-reach', `${Math.round(f.w - left + m + (canFs ? pb : 0))}px`);
    else rootStyle.removeProperty('--fs-pause-reach');
    showButton();
  };
  placeButton();

  const w = inkWidth('继续', '设置', '回到标题', '再想想'); // 两页的按钮都这么宽
  const build = (v: 'menu' | 'confirm') => {
    view = v;
    const p = scrollPanel(PANEL_W);
    p.el.classList.add('pmenu');
    const paper = p.paper;
    const m = document.createElement('div');
    m.className = 'menu';
    if (v === 'menu') {
      paper.insertAdjacentHTML('beforeend', '<h2>暂停</h2>');
      const cont = inkButton('继续', { primary: true, w, onClick: () => (sfx.play('ui.click'), resume()) });
      const set = inkButton('设置', { w, onClick: () => (sfx.play('ui.click'), settings()) });
      const quit = inkButton('回到标题', { w, onClick: () => (sfx.play('ui.click'), swap('confirm')) });
      m.append(cont, set);
      items = [cont, set];
      // 全屏 / 退出全屏（fullscreen.ts）：支持网页全屏、又不是从主屏幕打开的才有。点下去立即进出全屏，字跟着变
      if (showFullscreenToggle()) {
        const fsb = inkButton(isFullscreen() ? '退出全屏' : '全屏', {
          w,
          onClick: () => {
            sfx.play('ui.click');
            void setFullscreen(!isFullscreen());
          },
        });
        m.appendChild(fsb);
        items.push(fsb);
      }
      m.appendChild(quit);
      items.push(quit);
    } else {
      paper.insertAdjacentHTML('beforeend', '<h2>回到标题？</h2><div class="ask">本局进度将不保留</div>');
      const yes = inkButton('回到标题', {
        primary: true,
        w,
        onClick: () => {
          if (quitting) return;
          quitting = true;
          sfx.play('ui.click');
          o.onQuit();
        },
      });
      const no = inkButton('再想想', { w, onClick: () => (sfx.play('ui.click'), swap('menu')) });
      m.append(no, yes); // 和暂停菜单一样竖着排（手机上横排放不下）
      items = [no, yes]; // 焦点先给「再想想」：误按回车不会丢掉这一局
    }
    paper.appendChild(m);
    ui.appendChild(p.el);
    centerIn(p.el, layer.fit);
    return p;
  };

  /** 换一页（菜单 ⇄ 确认）。 */
  const swap = (v: 'menu' | 'confirm') =>
    void queue(async () => {
      if (!paused || !panel || view === v) return;
      await panel.close();
      panel = build(v);
      items[0]?.focus({ preventScroll: true });
      await panel.open();
    });

  const open = () => {
    if (paused || !enabled) return;
    paused = true;
    quitting = false;
    showButton();
    sfx.pauseMusic(); // 配乐停在原处（界面音效照常）
    o.onPause?.();
    if (!document.hidden) sfx.play('ui.click'); // 切到后台时自动暂停的不出声（不然这一声会留到回来时才响）
    veil.style.display = '';
    requestAnimationFrame(() => veil.classList.add('on'));
    setTimeout(() => veil.classList.add('on'), 30); // 主循环停着时 requestAnimationFrame 可能不来
    void queue(async () => {
      panel = build('menu');
      items[0]?.focus({ preventScroll: true });
      await panel.open();
    });
  };

  const resume = () =>
    void queue(async () => {
      if (!paused || quitting) return;
      veil.classList.remove('on');
      const p = panel;
      panel = null;
      view = 'none';
      if (p) await p.close();
      await wait(60);
      veil.style.display = 'none';
      paused = false;
      showButton();
      (document.activeElement as HTMLElement | null)?.blur?.();
      sfx.unlock(); // 从后台回来、音频还停着的话，借这一下点击把它叫起来
      sfx.resumeMusic(); // 配乐从停下的地方接着放
      o.onResume?.();
    });

  const settings = () =>
    void queue(async () => {
      if (!paused || !panel) return;
      const p = panel;
      panel = null;
      view = 'settings';
      await p.close();
      await openSettings({ layer, context: 'game', sfx });
      panel = build('menu');
      items[1]?.focus({ preventScroll: true });
      await panel.open();
    });

  pbtn.addEventListener('click', () => open());
  fbtn.addEventListener('click', () => {
    if (!enabled || paused) return;
    sfx.play('ui.click');
    void setFullscreen(!isFullscreen());
  });
  // 进出全屏（点了暂停面板里的按钮，或系统手势、Esc 退出的）：按钮上的字跟着变
  const offFs = onFullscreenChange((on) => {
    fsIcon();
    for (const b of items) {
      const lb = b.querySelector('.lb');
      if (lb && (lb.textContent === '全屏' || lb.textContent === '退出全屏')) lb.textContent = on ? '退出全屏' : '全屏';
    }
  });
  const onVis = () => {
    if (document.hidden) open();
  };
  document.addEventListener('visibilitychange', onVis);
  const popKeys = pushKeys((e) => {
    if (!enabled) return;
    const k = e.key.toLowerCase();
    if (!paused) {
      if ((k === 'escape' || k === 'p') && !isTyping(e) && !e.repeat) {
        open();
        return 'consume';
      }
      return; // 不暂停时按键照常给游戏
    }
    if (view === 'settings' || quitting) return 'consume';
    if (k === 'escape' || (k === 'p' && view === 'menu')) {
      if (view === 'confirm') void swap('menu');
      else {
        sfx.play('ui.click');
        resume();
      }
      return 'consume';
    }
    navKeys(e, items, 'both');
    return 'consume';
  });
  layer.onFit = () => {
    placeButton();
    if (panel) centerIn(panel.el, layer.fit);
  };

  const setCornerFree = (v: boolean) => {
    // feel.ts 每帧都调：状态变了马上重摆；占着右上角的时候灵石框会动（数字变宽变窄），隔一会儿重新量一次
    if (v !== cornerFree) {
      cornerFree = v;
      placeButton();
    } else if (!v && layer.fit.coarse && performance.now() - placedAt > 250) placeButton();
  };

  return {
    get paused() {
      return paused;
    },
    open,
    resume,
    setEnabled(v) {
      if (v === enabled) return;
      enabled = v;
      placeButton();
    },
    setCornerFree,
    setButtonVisible: setCornerFree,
    dispose() {
      popKeys();
      offFs();
      document.removeEventListener('visibilitychange', onVis);
      document.documentElement.style.removeProperty('--fs-pause-inset');
      document.documentElement.style.removeProperty('--fs-pause-reach');
      layer.dispose();
      paused = false;
      sfx.resumeMusic(); // 这一局拆了：配乐别还停着（回到标题要放标题页的音乐）
    },
  };
}
