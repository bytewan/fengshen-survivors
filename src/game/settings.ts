// 设置（DOM，卷轴面板）：主音量、音效、音乐三条滑块，伤害数字的开关，字体主题（文楷 / 书法）；
// 改了立即生效并写进存档（profile.ts）。从标题页打开时还有「存档码」：导出（复制）/ 导入（粘贴，校验全部通过、
// 玩家确认后才整份覆盖本机存档）。
//
// 对齐（用户：「选项等都得对齐」）：每一行是同一个三列网格——左边一列标签（左对齐、同宽），中间一列控件，右边一列数值（右对齐）。
// 中间那一列正好是两格：开关的两个选项、存档码的两个按钮各占一格，滑块横跨两格，所以各行的左边线、右边线、两格的中轴都对得上。
// 格宽取整到像素件的格子上（和墨痕按钮同一个算法），所以按钮和开关一样宽。
//
// 音量怎么作用到声音上：bindSfx(sfx) 登记一个音效对象，设置一变就调 sfx.setVolumes({ master, sfx, music })
// （滑块的位置 0..1，平方后换增益由音频那边做）。
// 伤害数字：feel.ts 每次要飘字前看 getSettings().damageNumbers。字体主题：applyFontTheme，启动时由 main.ts 先应用一次。
import { quality, type QualitySetting } from '../render/quality.ts';
import type { Sfx } from '../audio/sfx.ts';
import { CHAPTER_NAME } from '../sim/catalog.ts';
import { FONT_THEMES, applyFontTheme, type FontTheme } from './fonts.ts';
import { decodeProfile, describeProfile, exportCode, getSettings, importCode, loadProfile, onSettingsChange, updateSettings, type Settings } from './profile.ts';
import { C, P, bitmapUrl, cellsEven, centerIn, inkButton, inkStrokeCells, injectCss, isTyping, navKeys, pushKeys, refitWithin, scrollPanel, wait, type Layer, type UiFit } from './front-ui.ts';
import { makeKnob } from '../art/title.ts';
import { isFullscreen, onFullscreenChange, setFullscreen, showFullscreenToggle, showHomeScreenHint } from './fullscreen.ts';

// ---------- 音量作用到声音上 ----------

/** 把设置里的音量作用到一个音效对象上（立即生效）。 */
export function applyAudio(sfx: Sfx, s: Settings = getSettings()) {
  sfx.setVolumes({ master: s.master, sfx: s.sfx, music: s.music });
}

const bound = new Set<Sfx>();
let listening = false;
/** 登记一个音效对象：先按当前设置调好，以后设置一变就跟着变。返回取消登记的函数。 */
export function bindSfx(sfx: Sfx): () => void {
  bound.add(sfx);
  applyAudio(sfx);
  if (!listening) {
    listening = true;
    onSettingsChange((s) => bound.forEach((x) => applyAudio(x, s)));
  }
  return () => bound.delete(sfx);
}

// ---------- 样式 ----------

/** 一格的宽度、两格之间的空隙（em）；面板里按格子取整成 --cell / --cgap。 */
const CELL = 5.5;
const CGAP = 0.6;
/** 标签列、数值列的宽度，列与列之间的空隙（em）；同样按格子取整（--c1 / --c3 / --cg）。 */
const COL_NAME = 5.2;
const COL_VAL = 2.4;
const COL_GAP = 0.8;
/** 面板的宽度（em）：标签 + 两格 + 数值，加上各列之间的空隙和纸的边。 */
const PANEL_W = 24;

const CSS = `
.fs-ui .set { display: grid; grid-template-columns: var(--c1) calc(var(--cell) * 2 + var(--cgap)) var(--c3); column-gap: var(--cg); justify-content: center; align-items: center; }
.fs-ui .set > * { min-height: var(--row); }
.fs-ui .set .name { display: flex; align-items: center; white-space: nowrap; color: ${C.wu}; letter-spacing: .06em; }
.fs-ui .set .val { display: flex; align-items: center; justify-content: flex-end; color: ${C.cang}; font-variant-numeric: tabular-nums; }
.fs-ui .set .rule { grid-column: 1 / -1; min-height: 0; margin: .3em 0; }
/* iPhone / iPad 上怎么全屏：一句话占住控件和数值两列 */
.fs-ui .set .tip { grid-column: 2 / -1; display: flex; align-items: center; white-space: nowrap; color: ${C.cang}; letter-spacing: .04em; }
.fs-ui .set .two { display: grid; grid-template-columns: var(--cell) var(--cell); column-gap: var(--cgap); align-items: center; }
.fs-ui .set .three { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: var(--cgap); align-items: center; }
/* 滑块：玉牌（7 格宽）在轨道里面走，两头不伸出去——左右边线和别的行的控件对得上。--v 是 0..1 的位置，--run 是玉牌能走的距离 */
.fs-ui .slider { position: relative; height: var(--row); cursor: pointer; touch-action: none; outline: none; --run: calc(100% - var(--p) * 7); }
.fs-ui .slider .track { position: absolute; left: 0; right: 0; top: calc(50% - var(--p) / 2); height: var(--p); background: ${C.yinshu}; }
.fs-ui .slider .tick { position: absolute; left: calc(var(--p) * 3 + var(--run) * var(--at)); top: calc(50% - var(--p) * 1.5); width: var(--p); height: ${P(3)}; background: ${C.yinshu}; }
.fs-ui .slider .fill { position: absolute; left: 0; top: calc(50% - var(--p) * 1.5); width: calc(var(--p) * 3 + var(--run) * var(--v)); height: ${P(3)}; background: ${C.zhu}; box-shadow: 0 var(--p) 0 ${C.yin}; }
.fs-ui .slider .knob { position: absolute; left: calc(var(--run) * var(--v)); top: calc(50% - var(--p) * 4.5); width: ${P(7)}; height: ${P(9)}; background: var(--knob) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
.fs-ui .slider:focus .knob { background-image: var(--knob-on); }
.fs-ui .slider:focus .track { background: ${C.cang}; }
.fs-ui .seg { outline: none; cursor: pointer; }
.fs-ui .seg span { display: flex; align-items: center; justify-content: center; height: var(--segh, 1.9em); letter-spacing: .12em; text-indent: .12em; white-space: nowrap; color: ${C.cang}; box-shadow: inset 0 0 0 var(--p) ${C.gao}; }
.fs-ui .seg span.on { color: ${C.yuebai}; background: ${C.zhu}; box-shadow: inset 0 0 0 var(--p) ${C.yin}, inset 0 var(--p) 0 var(--p) ${C.zhusha}; }
.fs-ui .seg:focus span:not(.on) { box-shadow: inset 0 0 0 var(--p) ${C.yinshu}; color: ${C.wu}; }
.fs-ui .seg:focus span.on { box-shadow: inset 0 0 0 var(--p) ${C.yin}, inset 0 var(--p) 0 var(--p) ${C.zhusha}, 0 0 0 var(--p) ${C.teng}; }
.fs-ui .code { display: block; width: 100%; height: 6.2em; resize: none; margin: 0; padding: .3em .5em; font: inherit; line-height: 1.4; color: ${C.wu}; background: #fbf5e8; border: 0; border-radius: 0; outline: none; box-shadow: inset 0 0 0 var(--p) ${C.yinshu}; word-break: break-all; -webkit-user-select: text; user-select: text; -webkit-appearance: none; appearance: none; }
.fs-ui .code:focus { box-shadow: inset 0 0 0 var(--p) ${C.zhu}; }
.fs-ui .code::placeholder { color: ${C.yinshu}; }
.fs-ui.compact .code { height: 4.6em; }
.fs-ui .summary { color: ${C.wu}; text-align: center; text-wrap: balance; }
.fs-ui .summary b { color: ${C.zhu}; }
`;

// ---------- 小部件 ----------

function slider(value: number, onChange: (v: number) => void) {
  const el = document.createElement('div');
  el.className = 'slider';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.style.setProperty('--knob', `url("${bitmapUrl(makeKnob(false))}")`);
  el.style.setProperty('--knob-on', `url("${bitmapUrl(makeKnob(true))}")`);
  el.innerHTML = `<div class="track"></div>${[0.25, 0.5, 0.75].map((p) => `<div class="tick" style="--at:${p}"></div>`).join('')}<div class="fill"></div><div class="knob"></div>`;
  const knob = el.querySelector('.knob') as HTMLElement;
  let v = value;
  const show = () => {
    // 填充和玉牌的位置都由 --v 在 CSS 里算：窗口大小变了不用重新量
    el.style.setProperty('--v', String(v));
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  const set = (nv: number) => {
    nv = Math.round(Math.max(0, Math.min(1, nv)) * 100) / 100;
    if (nv === v) return;
    v = nv;
    show();
    onChange(v);
  };
  const fromPointer = (e: PointerEvent) => {
    // 手指 / 鼠标对准玉牌的中心：玉牌能走的距离是轨道宽减去它自己的宽
    const r = el.getBoundingClientRect();
    const kw = knob.offsetWidth;
    set((e.clientX - r.left - kw / 2) / Math.max(1, r.width - kw));
  };
  el.addEventListener('pointerdown', (e) => {
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  show();
  return {
    el,
    get value() {
      return v;
    },
    step(d: number) {
      set(v + d);
    },
  };
}

/** 两个（或三个）选项的开关（两格各占一格；三个时三等分同样的宽度）：点哪个选哪个；键盘上左右键、回车、空格换下一个。 */
function segmented<T>(options: [T, string][], value: T, onChange: (v: T) => void) {
  const el = document.createElement('div');
  el.className = options.length === 3 ? 'seg three' : 'seg two';
  el.tabIndex = 0;
  el.setAttribute('role', 'radiogroup');
  const cells = options.map(([, label]) => {
    const s = document.createElement('span');
    s.setAttribute('role', 'radio');
    s.textContent = label;
    el.appendChild(s);
    return s;
  });
  let cur = Math.max(0, options.findIndex(([id]) => id === value));
  const show = () => cells.forEach((c, i) => (c.classList.toggle('on', i === cur), c.setAttribute('aria-checked', String(i === cur))));
  const set = (i: number) => {
    if (i === cur) return;
    cur = i;
    show();
    onChange(options[i][0]);
  };
  cells.forEach((c, i) => c.addEventListener('click', () => set(i)));
  show();
  return {
    el,
    /** 换成另一个（dir < 0 往左，> 0 往右，到头绕回去）。 */
    flip(dir = 1) {
      set((cur + (dir < 0 ? options.length - 1 : 1)) % options.length);
    },
    /** 只改显示、不回调（外面的状态自己变了：比如全屏被系统的手势退出了）。 */
    show(v: T) {
      cur = Math.max(0, options.findIndex(([id]) => id === v));
      show();
    },
  };
}

// ---------- 面板 ----------

export interface SettingsOptions {
  /** 放在哪一层界面上（标题页那一层，或暂停那一层）。 */
  layer: Layer;
  /** 'title'：带存档码；'game'：局内（不带存档码）。 */
  context: 'title' | 'game';
  sfx: Sfx;
}

/** 打开设置面板；关上时 resolve。 */
export async function openSettings(o: SettingsOptions): Promise<void> {
  injectCss('fs-settings', CSS);
  const { layer, sfx } = o;
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = 'rgba(26,21,32,.32)';
  layer.ui.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  let panel = scrollPanel(PANEL_W);
  layer.ui.appendChild(panel.el);

  /** 按格子取整的格宽、空隙、行高（和墨痕按钮同一个取整，按钮正好占满一格）。 */
  const place = (f: UiFit) => {
    const s = panel.el.style;
    const cells = (em: number) => Math.round((em * f.base) / f.p);
    const cell = cellsEven(CELL, f); // 和墨痕按钮同一个取整：按钮正好占满一格
    const cgap = cells(CGAP);
    let c1 = cells(COL_NAME);
    const c3 = cells(COL_VAL);
    const cg = cells(COL_GAP);
    // 整个网格的宽度凑成偶数个物理像素：在纸上居中时各列都落在整像素上
    if (Math.round(f.p * f.dpr) % 2 && (c1 + cell * 2 + cgap + c3 + cg * 2) % 2) c1++;
    for (const [k, n] of [['--cell', cell], ['--cgap', cgap], ['--c1', c1], ['--c3', c3], ['--cg', cg]] as const) s.setProperty(k, `${n * f.p}px`);
    // 行高：平时和按钮一样高；矮窗口（手机浏览器带着地址栏，只剩三百来像素高）放不下时把各行压矮一点，
    // 免得最下面的「返回」掉到纸外面去。实在放不下，纸里面可以上下滑
    s.setProperty('--row', `${f.tap}px`);
    s.setProperty('--tap', `${f.tap}px`);
    s.setProperty('--segh', `${inkStrokeCells(f) * f.p}px`); // 开关的两格和墨痕按钮一样高，这一列的上下沿对得上
    refitWithin(panel.paper, f);
    panel.paper.style.maxHeight = `${f.h - f.p * 16}px`;
    const over = panel.paper.scrollHeight - panel.paper.clientHeight;
    const rows = panel.paper.querySelectorAll('.set > .name').length;
    if (over > 0 && rows) {
      const cellsNeed = Math.ceil(over / rows / f.p / 2) * 2; // 按偶数格减：按钮里的墨痕上下仍对称
      const row = Math.max(Math.min(f.tap, Math.ceil(28 / f.p) * f.p), f.tap - cellsNeed * f.p);
      const pressed = { ...f, tap: row };
      s.setProperty('--row', `${row}px`);
      s.setProperty('--tap', `${row}px`);
      s.setProperty('--segh', `${inkStrokeCells(pressed) * f.p}px`);
      refitWithin(panel.paper, pressed); // 按钮里的墨痕按压矮了的行高重新取，不比行高
    }
    centerIn(panel.el, f);
  };

  let tickT = 0;
  const tick = () => {
    const now = performance.now();
    if (now - tickT > 140) {
      tickT = now;
      sfx.play('ui.click', 0.6); // 拖动音量时轻轻响一下，听得出大小
    }
  };

  let focusables: HTMLElement[] = [];
  let onKey: (e: KeyboardEvent) => boolean = () => false;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  let closing = false;

  let offFs = () => {};
  const close = async () => {
    if (closing) return;
    closing = true;
    sfx.play('ui.click');
    popKeys();
    offFs();
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await panel.close();
    veil.remove();
    finish();
  };

  /** 换一页内容（主页 / 导出 / 导入）：卷起来、换内容、再展开。 */
  const swap = async (build: () => void, first = false) => {
    if (!first) {
      await panel.close();
      panel = scrollPanel(PANEL_W);
      layer.ui.appendChild(panel.el);
    }
    panel.paper.innerHTML = '';
    build();
    place(layer.fit);
    await panel.open();
    focusables[0]?.focus({ preventScroll: true });
  };

  const main = () => {
    const s = getSettings();
    const p = panel.paper;
    p.insertAdjacentHTML('beforeend', '<h2>设置</h2>');
    const grid = document.createElement('div');
    grid.className = 'set';
    p.appendChild(grid);
    const label = (text: string) => {
      const l = document.createElement('span');
      l.className = 'name'; // 不叫 lb：墨痕按钮里的字也叫 .lb
      l.textContent = text;
      grid.appendChild(l);
    };
    const blank = () => grid.appendChild(document.createElement('span')); // 数值那一列空着，占住格子

    const rows: [string, 'master' | 'sfx' | 'music'][] = [
      ['主音量', 'master'],
      ['音效', 'sfx'],
      ['音乐', 'music'],
    ];
    const sliders: ReturnType<typeof slider>[] = [];
    for (const [text, key] of rows) {
      label(text);
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = String(Math.round(s[key] * 100));
      const sl = slider(s[key], (v) => {
        updateSettings({ [key]: v });
        val.textContent = String(Math.round(v * 100));
        tick();
      });
      sl.el.setAttribute('aria-label', text);
      grid.append(sl.el, val);
      sliders.push(sl);
    }

    label('伤害数字');
    const dmg = segmented<boolean>(
      [
        [true, '显示'],
        [false, '隐藏'],
      ],
      s.damageNumbers,
      (on) => {
        updateSettings({ damageNumbers: on });
        sfx.play('ui.click');
      },
    );
    dmg.el.setAttribute('aria-label', '伤害数字');
    grid.appendChild(dmg.el);
    blank();

    label('字体');
    const font = segmented<FontTheme>(
      (Object.keys(FONT_THEMES) as FontTheme[]).map((id) => [id, FONT_THEMES[id].name]),
      s.fontTheme,
      (theme) => {
        applyFontTheme(theme);
        updateSettings({ fontTheme: theme });
        sfx.play('ui.click');
        layer.refit(); // 换了字体，各处的字宽会变一点：重新摆
      },
    );
    font.el.setAttribute('aria-label', '字体');
    grid.appendChild(font.el);
    blank();

    // 画质（render/quality.ts）：这台设备自己的，不进存档码。自动 = 先按高档，掉帧了自己换成低档
    label('画质');
    const qual = segmented<QualitySetting>(
      [
        ['auto', '自动'],
        ['high', '高'],
        ['low', '低'],
      ],
      quality.setting,
      (v) => {
        quality.choose(v);
        sfx.play('ui.click');
      },
    );
    qual.el.setAttribute('aria-label', '画质');
    grid.appendChild(qual.el);
    blank();
    const segs = [dmg, font, qual];

    // 全屏（fullscreen.ts）：支持网页全屏的浏览器上是开关（点了立即进出全屏）；iPhone / iPad 上不支持的写一句怎么全屏；
    // 从主屏幕打开的本来就没有浏览器的栏，这一行不出
    if (showFullscreenToggle()) {
      label('全屏');
      const fs = segmented<boolean>(
        [
          [true, '开启'],
          [false, '关闭'],
        ],
        isFullscreen(),
        (on) => {
          sfx.play('ui.click');
          void setFullscreen(on).then((now) => fs.show(now));
        },
      );
      fs.el.setAttribute('aria-label', '全屏');
      grid.appendChild(fs.el);
      blank();
      segs.push(fs);
      offFs = onFullscreenChange((on) => fs.show(on));
    } else if (showHomeScreenHint()) {
      label('全屏');
      grid.insertAdjacentHTML('beforeend', '<span class="tip">分享 → 添加到主屏幕</span>');
    }

    const extra: HTMLElement[] = [];
    if (o.context === 'title') {
      grid.insertAdjacentHTML('beforeend', '<div class="rule"></div>');
      label('存档码');
      const two = document.createElement('div');
      two.className = 'two';
      const ex = inkButton('导出', { w: CELL, onClick: () => (sfx.play('ui.click'), void swap(exportView)) });
      const im = inkButton('导入', { w: CELL, onClick: () => (sfx.play('ui.click'), void swap(importView)) });
      two.append(ex, im);
      grid.appendChild(two);
      blank();
      extra.push(ex, im);
    }
    const bar = document.createElement('div');
    bar.className = 'bar';
    const backBtn = inkButton('返回', { onClick: () => void close() });
    bar.appendChild(backBtn);
    p.appendChild(bar);
    focusables = [...sliders.map((x) => x.el), ...segs.map((x) => x.el), ...extra, backBtn];
    onKey = (e) => {
      const k = e.key.toLowerCase();
      const t = document.activeElement;
      const left = k === 'arrowleft' || k === 'a';
      const right = k === 'arrowright' || k === 'd';
      const sl = sliders.find((x) => x.el === t);
      if (sl && (left || right)) {
        sl.step(left ? -0.1 : 0.1);
        return true;
      }
      const sg = segs.find((x) => x.el === t);
      if (sg && (left || right || k === 'enter' || k === ' ')) {
        sg.flip(left ? -1 : 1);
        return true;
      }
      // 存档码的两个按钮并排：左右键在它们之间走
      if ((left || right) && extra.includes(t as HTMLElement)) {
        extra[(extra.indexOf(t as HTMLElement) + 1) % extra.length].focus({ preventScroll: true });
        return true;
      }
      if (k === 'escape') {
        void close();
        return true;
      }
      return navKeys(e, focusables);
    };
  };

  const exportView = () => {
    const p = panel.paper;
    p.insertAdjacentHTML('beforeend', '<h2>导出存档码</h2>');
    const ta = document.createElement('textarea');
    ta.className = 'code';
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.value = exportCode();
    const msg = document.createElement('div');
    msg.className = 'hint';
    // 两行，在句读处断开（让浏览器自己折，会把「之后」这样的词拆在两行）
    msg.innerHTML = '<div>请妥善保存。换设备或清除浏览器数据后，</div><div>于「导入」中粘贴即可。</div>';
    const status = document.createElement('div');
    status.className = 'ok';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const copy = inkButton('复制', {
      primary: true,
      onClick: async () => {
        ta.select();
        let ok = false;
        try {
          await navigator.clipboard.writeText(ta.value);
          ok = true;
        } catch {
          try {
            ok = document.execCommand('copy');
          } catch {
            ok = false;
          }
        }
        status.className = ok ? 'ok' : 'err';
        status.textContent = ok ? '已复制' : '未能自动复制，请长按或选中上方文字手动复制';
        sfx.play(ok ? 'ui.buy' : 'ui.denied');
      },
    });
    const back = inkButton('返回', { onClick: () => (sfx.play('ui.click'), void swap(main)) });
    bar.append(copy, back);
    p.append(ta, status, msg, bar);
    ta.addEventListener('focus', () => ta.select());
    focusables = [copy, back, ta];
    onKey = (e) => {
      if (e.key === 'Escape') {
        void swap(main);
        return true;
      }
      if (isTyping(e) && !['ArrowUp', 'ArrowDown'].includes(e.key)) return false;
      return navKeys(e, focusables, 'both');
    };
  };

  const importView = () => {
    const p = panel.paper;
    p.insertAdjacentHTML('beforeend', '<h2>导入存档码</h2>');
    const ta = document.createElement('textarea');
    ta.className = 'code';
    ta.spellcheck = false;
    ta.placeholder = '在此粘贴存档码（以 FS1- 开头）';
    const status = document.createElement('div');
    status.className = 'err';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const go = inkButton('导入', {
      primary: true,
      onClick: () => {
        const r = decodeProfile(ta.value);
        if (!r.ok) {
          status.className = 'err';
          status.textContent = r.error;
          sfx.play('ui.denied');
          return;
        }
        sfx.play('ui.click');
        void swap(() => confirmView(ta.value));
      },
    });
    const back = inkButton('返回', { onClick: () => (sfx.play('ui.click'), void swap(main)) });
    bar.append(go, back);
    p.append(ta, status, bar);
    ta.addEventListener('input', () => (status.textContent = ''));
    focusables = [ta, go, back];
    onKey = (e) => {
      if (e.key === 'Escape') {
        void swap(main);
        return true;
      }
      if (isTyping(e) && !['ArrowUp', 'ArrowDown'].includes(e.key)) return false;
      return navKeys(e, focusables, document.activeElement === ta ? 'v' : 'both');
    };
  };

  const chapterName = (n: number) => CHAPTER_NAME[n] ?? `第 ${n} 章`;
  const confirmView = (code: string) => {
    const p = panel.paper;
    const r = decodeProfile(code);
    if (!r.ok) return main();
    p.insertAdjacentHTML(
      'beforeend',
      `<h2>覆盖本机存档？</h2><div class="summary">存档码里：<br><b>${describeProfile(r.profile, chapterName)}</b></div><div class="rule"></div><div class="summary">本机现在：<br>${describeProfile(loadProfile(), chapterName)}</div>`,
    );
    const status = document.createElement('div');
    status.className = 'ok';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const yes = inkButton('覆盖', {
      primary: true,
      onClick: async () => {
        const res = importCode(code);
        if (!res.ok) {
          status.className = 'err';
          status.textContent = res.error;
          sfx.play('ui.denied');
          return;
        }
        applyFontTheme(getSettings().fontTheme); // 存档码里带着设置：字体主题跟着换
        layer.refit();
        sfx.play('ui.buy');
        status.className = 'ok';
        status.textContent = '已导入';
        yes.disabled = true;
        no.disabled = true;
        await wait(700);
        void swap(main);
      },
    });
    const no = inkButton('取消', { onClick: () => (sfx.play('ui.click'), void swap(main)) });
    bar.append(no, yes);
    p.append(status, bar);
    focusables = [no, yes]; // 焦点先给「取消」：误按回车不会覆盖掉本机的存档
    onKey = (e) => {
      if (e.key === 'Escape') {
        void swap(main);
        return true;
      }
      return navKeys(e, focusables, 'both');
    };
  };

  const popKeys = pushKeys((e) => {
    if (closing) return 'consume';
    if (onKey(e)) return 'consume';
    return isTyping(e) ? 'pass' : 'consume';
  });
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    place(f);
  };
  void swap(main, true);
  await done;
  layer.onFit = refit;
}
