// 选劫（DOM，叠在标题页的背景上）：选好角色之后选这一局的劫数（劫一到劫五，词缀在 sim/jie.ts，解锁进度在 profile.ts）。
// 版面照选角页（select.ts）：左边一栏是大字「劫三」（书法体竖写，朱色）和下面一排五方小印（一到五），右边一卷纸写这一劫叠上的词缀、
// 前几劫带过来的、奖励、怎么解锁下一劫，纸下面是「返回」「入劫」（同宽）。没解锁的那几方印写着「锁」，选中时「入劫」变暗，
// 按下去有「不行」的音效、原因那一行晃一下。左右键换劫数，回车入劫，Esc 返回（回到选角）。
//
// 对齐（用户：「开局的选项等都得对齐」）：左栏的大字和印共用一条中轴；右栏的卷轴和两个按钮共用一条中轴；左右两栏的竖直中线对齐；
// 卷轴按字最多的那一劫留高度，换劫数时大小不变，按钮不会跟着跳。
import type { Sfx } from '../audio/sfx.ts';
import { DIAMOND } from '../art/title.ts';
import { JIE_MAX, JIE_TIERS, jieRewardText } from '../sim/jie.ts';
import { FONT_TITLE } from './fonts.ts';
import { loadJie, setLastJie, unlockedJie } from './profile.ts';
import { C, P, bitmapUrl, inkButton, inkWidth, injectCss, isCompact, isTall, navKeys, pushKeys, scrollPanel, snapPx, wait, type Layer, type UiFit } from './front-ui.ts';

const NUM = ['', '一', '二', '三', '四', '五'];

const CSS = `
#fs-front .jie { position: absolute; inset: 0; }
#fs-front .jie .head { position: absolute; display: flex; align-items: center; gap: .45em; font-family: ${FONT_TITLE}; font-size: 1.45em; line-height: 1.3; color: ${C.yuebai}; letter-spacing: .18em; white-space: nowrap; text-shadow: 0 var(--p) 0 ${C.wu}; }
#fs-front .jie .head i { display: block; flex: none; width: ${P(5)}; height: ${P(5)}; background: var(--dia) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
/* 大字：竖写的「劫三」，朱色描一层乌边（和标题的大字同一路，不发光）；没解锁的是银鼠色 */
#fs-front .jie .big { position: absolute; display: flex; flex-direction: column; align-items: center; font-family: ${FONT_TITLE}; font-size: var(--bs); line-height: 1.02; color: ${C.zhu}; transition: color .35s; pointer-events: none;
  text-shadow: 0 calc(var(--bs) * .04) 0 ${C.wu}; -webkit-text-stroke: calc(var(--bs) * .018) ${C.wu}; paint-order: stroke fill; }
#fs-front .jie .big.locked { color: ${C.yinshu}; }
#fs-front .jie .big span { display: block; }
#fs-front .jie .tiers { position: absolute; display: flex; gap: ${P(6)}; }
/* 一方小印：选中的描朱砂边（内描边，不改大小），和选角页的角色格一样 */
#fs-front .jie .tier { position: relative; flex: none; width: var(--tile); height: var(--tile); display: flex; align-items: center; justify-content: center; font-family: ${FONT_TITLE}; font-size: calc(var(--tile) * .5); line-height: 1; color: ${C.xuan};
  background: ${C.yuebai}; box-shadow: inset 0 0 0 var(--p) ${C.yinshu}, 0 var(--p) 0 0 ${C.cang}; cursor: pointer; }
#fs-front .jie .tier.locked { color: ${C.gao}; }
#fs-front .jie .tier.on { color: ${C.yuebai}; background: ${C.zhu}; box-shadow: inset 0 0 0 var(--p) ${C.yin}, inset 0 var(--p) 0 var(--p) ${C.zhusha}, 0 var(--p) 0 0 ${C.yin}; }
#fs-front .jie .tier.on.locked { color: ${C.gao}; background: ${C.dai}; box-shadow: inset 0 0 0 var(--p) ${C.wu}, 0 var(--p) 0 0 ${C.wu}; }
#fs-front .jie .tier:focus { outline: none; }
#fs-front .jie .tier .lock { position: absolute; right: ${P(2)}; top: ${P(2)}; padding: 0 .3em; font-family: var(--font-text); font-size: calc(var(--tile) * .2); line-height: 1.4; color: ${C.yuebai}; background: ${C.dai}; }
#fs-front .jie .info .nm { display: flex; align-items: baseline; gap: .7em; margin-bottom: .45em; white-space: nowrap; }
#fs-front .jie .info .nm b { flex: none; font-family: ${FONT_TITLE}; font-size: 2.2em; line-height: 1.25; color: ${C.xuan}; letter-spacing: .08em; }
#fs-front .jie .info .nm span { color: ${C.cang}; letter-spacing: .3em; }
#fs-front .jie .info .its { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .9em; row-gap: .5em; margin: 0; }
#fs-front .jie .info .its dt { color: ${C.zhu}; letter-spacing: .08em; white-space: nowrap; }
#fs-front .jie .info .its dd { margin: 0; min-width: 0; color: ${C.wu}; }
#fs-front .jie .info .its dd .x { display: block; }
#fs-front .jie .info .its dd .x::before { content: '·'; margin-right: .4em; color: ${C.yinshu}; }
#fs-front .jie .info .its dd.old { color: ${C.cang}; }
#fs-front .jie .info .its dd.old .x { display: inline; }
#fs-front .jie .info .its dd.old .x::before { content: none; }
#fs-front .jie .info .its dd.old .x + .x::before { content: '；'; margin: 0; color: ${C.yinshu}; }
#fs-front .jie .info .q { color: ${C.yinshu}; }
#fs-front .jie .info .lockline { margin-top: .8em; color: ${C.zhu}; text-align: center; letter-spacing: .08em; }
#fs-front .jie.compact .info .nm { margin-bottom: .15em; }
#fs-front .jie.compact .info .nm b { font-size: 1.9em; }
#fs-front .jie.compact .info .its { row-gap: .25em; column-gap: .7em; line-height: 1.42; }
#fs-front .jie.compact .info .its dd .x { display: inline; }
#fs-front .jie.compact .info .its dd .x + .x::before { content: '；'; margin: 0; color: ${C.wu}; }
#fs-front .jie.compact .info .its dd .x:first-child::before { content: none; }
#fs-front .jie .btns { position: absolute; display: flex; justify-content: center; gap: ${P(12)}; }
#fs-front .jie.enter .big, #fs-front .jie.enter .tiers { animation: fs-jie-in .7s ease-out both; }
#fs-front .jie.enter .btns, #fs-front .jie.enter .head { animation: fs-jie-fade .6s .25s ease-out both; }
@keyframes fs-jie-in { from { opacity: 0; transform: translateX(-.8em); } }
@keyframes fs-jie-fade { from { opacity: 0; } }
#fs-front .jie.leave { animation: fs-jie-fade .4s ease-in reverse forwards; pointer-events: none; }
`;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 选劫。返回选中的劫数（1..5）；点「返回」返回 null（回到选角）。 */
export async function showJiePick(layer: Layer, sfx: Sfx): Promise<number | null> {
  injectCss('fs-jie', CSS);
  const cleared = loadJie().cleared;
  const top = unlockedJie();
  let cur = clamp(loadJie().last, 1, top);
  const root = document.createElement('div');
  root.className = 'jie enter';
  root.style.setProperty('--dia', `url("${bitmapUrl(DIAMOND)}")`);
  root.innerHTML = `<div class="head"><i></i>选择劫数</div><div class="big"><span class="a">劫</span><span class="b">一</span></div><div class="tiers"></div><div class="btns"></div>`;
  layer.ui.appendChild(root);
  const head = root.querySelector('.head') as HTMLElement;
  const big = root.querySelector('.big') as HTMLElement;
  const bigN = big.querySelector('.b') as HTMLElement;
  const row = root.querySelector('.tiers') as HTMLElement;
  const btns = root.querySelector('.btns') as HTMLElement;
  const panel = scrollPanel(26);
  panel.el.classList.add('info');
  root.appendChild(panel.el);

  const tiles = JIE_TIERS.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tier${t.n > top ? ' locked' : ''}`;
    b.textContent = NUM[t.n];
    b.setAttribute('aria-label', `${t.name} · ${t.title}${t.n > top ? '（未解锁）' : ''}`);
    if (t.n > top) b.insertAdjacentHTML('beforeend', '<span class="lock">锁</span>');
    b.addEventListener('click', () => {
      if (cur !== t.n) sfx.play('ui.click');
      pick(t.n);
    });
    b.addEventListener('pointerenter', (ev) => ev.pointerType === 'mouse' && b.focus({ preventScroll: true }));
    b.addEventListener('focus', () => pick(i + 1));
    row.appendChild(b);
    return b;
  });
  const bw = inkWidth('返回', '入劫');
  const back = inkButton('返回', { w: bw });
  const go = inkButton('入劫', { primary: true, w: bw });
  btns.append(back, go);

  const dl = (k: string, body: string, cls = '') => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${body}</dd>`;
  const lines = (xs: readonly string[]) => xs.map((x) => `<span class="x">${x}</span>`).join('');
  const info = (n: number) => {
    const t = JIE_TIERS[n - 1];
    const before = JIE_TIERS.slice(1, n - 1).flatMap((x) => x.adds);
    // 通关过的写「已通关」（劫五通关过也写）；没通关过的写怎么解锁下一劫
    const next = n <= cleared ? `已通关过${n < JIE_MAX ? `，${JIE_TIERS[n].name}已解锁` : ''}` : n < JIE_MAX ? `整局通关${t.name}，解锁${JIE_TIERS[n].name}` : '';
    return `<div class="nm"><b>${t.name}</b><span>${t.title}</span></div>
      <dl class="its">
      ${dl(n === 1 ? '难度' : '叠上', lines(t.adds))}
      ${n > 2 ? dl('前几劫', lines(before), 'old') : ''}
      ${dl('奖励', jieRewardText(n))}
      ${next ? dl('通关', next) : ''}
      </dl>
      ${n > top ? `<div class="lockline">整局通关${JIE_TIERS[n - 2].name}后解锁</div>` : ''}`;
  };

  const pick = (n: number) => {
    cur = n;
    tiles.forEach((t, k) => t.classList.toggle('on', k === n - 1));
    bigN.textContent = NUM[n];
    big.classList.toggle('locked', n > top);
    panel.paper.innerHTML = info(n);
    go.setAttribute('aria-disabled', String(n > top));
  };

  const layout = (f: UiFit) => {
    if (isTall(f)) return layoutTall(f);
    const em = f.base;
    const compact = isCompact(f);
    root.classList.toggle('compact', compact);
    // 版面矩形：和选角页一样（窗口去掉安全区；比 16:9 宽的最多用到 2.2:1，再宽就居中留边）
    const safeW = f.w - f.safe.left - f.safe.right;
    const boxW = Math.min(safeW, f.h * 2.2);
    const boxH = Math.min(f.h, boxW * 0.62);
    const bx = f.safe.left + (safeW - boxW) / 2;
    const by = (f.h - boxH) / 2;
    const mx = (compact ? 1.1 : 1.8) * em;
    Object.assign(head.style, { left: `${snapPx(bx + mx, f)}px`, top: `${snapPx(by + (compact ? 0.35 : 0.9) * em, f)}px` });
    // 右栏：卷轴 + 按钮。卷轴按字最多的那一劫留高度
    let pwEm = compact ? clamp((boxW * 0.52) / em, 23, 27) : clamp((boxW * 0.44) / em, 22, 28);
    const rod = f.p * 6;
    const gapPB = (compact ? 0.3 : 0.9) * em;
    const bottomPad = f.safe.bottom + (compact ? 0.3 : 1) * em;
    const topPad = (compact ? 0.4 : 1) * em;
    const maxPanel = boxH - topPad - bottomPad - f.tap - gapPB - f.p * 14;
    panel.paper.style.minHeight = '';
    panel.paper.style.maxHeight = '';
    let need = 0;
    for (let tries = 0; ; tries++) {
      panel.setWidth(pwEm);
      need = 0;
      for (let n = 1; n <= JIE_MAX; n++) {
        panel.paper.innerHTML = info(n);
        need = Math.max(need, panel.paper.offsetHeight);
      }
      const wider = Math.min((boxW * 0.62) / em, pwEm + 1.5);
      if (need <= maxPanel || wider <= pwEm || tries >= 5) break;
      pwEm = wider;
    }
    panel.paper.innerHTML = info(cur);
    const ph = Math.round(Math.min(need, maxPanel));
    panel.paper.style.minHeight = `${ph}px`;
    panel.paper.style.maxHeight = `${ph}px`;
    const panelW = panel.el.offsetWidth;
    const panelH = panel.el.offsetHeight;
    const blockH = panelH + gapPB + f.tap;
    const midY = by + topPad + (boxH - topPad - bottomPad) / 2; // 左右两栏共用的竖直中线
    const panelLeft = snapPx(bx + boxW - mx - rod - panelW, f);
    const panelTop = snapPx(midY - blockH / 2, f);
    Object.assign(panel.el.style, { left: `${panelLeft}px`, top: `${panelTop}px` });
    Object.assign(btns.style, { left: `${panelLeft}px`, width: `${panelW}px`, top: `${snapPx(panelTop + panelH + gapPB, f)}px` });
    // 左栏：大字 + 一排印，共用一条中轴
    const leftX = bx + mx;
    const leftW = panelLeft - rod - mx * 0.5 - leftX;
    const axis = snapPx(leftX + leftW / 2, f);
    const tile = snapPx(Math.min((compact ? 2.6 : 3.2) * em, (leftW * 0.9 - f.p * 6 * 4) / 5), f);
    const rowW = tile * 5 + f.p * 6 * 4;
    row.style.setProperty('--tile', `${tile}px`);
    const gapBR = (compact ? 0.6 : 1.1) * em;
    const availH = boxH - topPad - bottomPad - tile - gapBR - (compact ? 1.4 : 2.2) * em;
    // 大字：两个字竖着（约 2.04 个字高）
    const bs = Math.round(clamp(Math.min(availH / 2.2, leftW * 0.34), em * 2.4, em * 6.5));
    big.style.setProperty('--bs', `${bs}px`);
    const bigH = big.offsetHeight;
    const blockL = bigH + gapBR + tile;
    const bigTop = snapPx(midY - blockL / 2, f);
    Object.assign(big.style, { left: `${axis - big.offsetWidth / 2}px`, top: `${bigTop}px` });
    Object.assign(row.style, { left: `${snapPx(axis - rowW / 2, f)}px`, top: `${snapPx(bigTop + bigH + gapBR, f)}px` });
  };
  /**
   * 竖着的版面（和选角页的竖版一样）：从上往下叠——「选择劫数」、大字、一排五方印、卷轴、两个按钮，都在窗口的中轴上。
   * 卷轴按字最多的那一劫留高度；大字用剩下的高度，太挤时卷轴让出来、在里面滚动。
   */
  const layoutTall = (f: UiFit) => {
    const em = f.base;
    const safeW = f.w - f.safe.left - f.safe.right;
    const safeH = f.h - f.safe.top - f.safe.bottom;
    const compact = safeH / em < 44;
    root.classList.toggle('compact', compact);
    const mx = clamp(safeW * 0.05, 0.6 * em, 1.8 * em);
    const rod = f.p * 6;
    const axis = snapPx(f.safe.left + safeW / 2, f);
    const headTop = f.safe.top + (compact ? 0.5 : 0.9) * em;
    Object.assign(head.style, { left: `${snapPx(f.safe.left + mx, f)}px`, top: `${snapPx(headTop, f)}px` });
    const headBottom = headTop + head.offsetHeight;
    const tile = snapPx(Math.min(3.2 * em, (safeW - 2 * mx - f.p * 6 * 4) / 5), f);
    const rowW = tile * 5 + f.p * 6 * 4;
    row.style.setProperty('--tile', `${tile}px`);
    panel.paper.style.minHeight = '';
    panel.paper.style.maxHeight = '';
    panel.setWidth(Math.min(26, (safeW - 2 * mx - 2 * rod) / em));
    let need = 0;
    for (let n = 1; n <= JIE_MAX; n++) {
      panel.paper.innerHTML = info(n);
      need = Math.max(need, panel.paper.offsetHeight);
    }
    panel.paper.innerHTML = info(cur);
    const gapHB = (compact ? 0.5 : 1.1) * em; // 标题 → 大字
    const gapBR = (compact ? 0.5 : 0.9) * em; // 大字 → 印
    const gapRP = (compact ? 0.6 : 1.1) * em; // 印 → 卷轴
    const gapPB = (compact ? 0.4 : 0.9) * em; // 卷轴 → 按钮
    const bottomPad = f.safe.bottom + (compact ? 0.5 : 1.2) * em;
    const rods = f.p * 10;
    const free = f.h - bottomPad - headBottom - gapHB - gapBR - tile - gapRP - rods - gapPB - f.tap; // 大字 + 纸
    // 大字：两个字竖着（约 2.04 个字高）；纸先拿够，剩下的给大字（最大约三成窗口高）
    const bs = Math.round(clamp(Math.min((free - need) / 2.1, (safeH * 0.3) / 2.1, safeW * 0.3), em * 2.4, em * 6.5));
    big.style.setProperty('--bs', `${bs}px`);
    const bigH = big.offsetHeight;
    const ph = Math.round(Math.max(em * 4, Math.min(need, free - bigH)));
    panel.paper.style.minHeight = `${ph}px`;
    panel.paper.style.maxHeight = `${ph}px`;
    const panelW = panel.el.offsetWidth;
    const panelH = panel.el.offsetHeight;
    const block = bigH + gapBR + tile + gapRP + panelH + gapPB + f.tap;
    const top0 = headBottom + gapHB;
    const bigTop = snapPx(top0 + Math.max(0, (f.h - bottomPad - top0 - block) / 2), f);
    Object.assign(big.style, { left: `${snapPx(axis - big.offsetWidth / 2, f)}px`, top: `${bigTop}px` });
    const rowTop = snapPx(bigTop + bigH + gapBR, f);
    Object.assign(row.style, { left: `${snapPx(axis - rowW / 2, f)}px`, top: `${rowTop}px` });
    const panelLeft = snapPx(axis - panelW / 2, f);
    const panelTop = snapPx(rowTop + tile + gapRP, f);
    Object.assign(panel.el.style, { left: `${panelLeft}px`, top: `${panelTop}px` });
    Object.assign(btns.style, { left: `${panelLeft}px`, width: `${panelW}px`, top: `${snapPx(panelTop + panelH + gapPB, f)}px` });
  };
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    layout(f);
  };
  pick(cur);
  layout(layer.fit);
  void panel.open();
  await wait(60);
  go.focus({ preventScroll: true });

  return new Promise<number | null>((resolve) => {
    let done = false;
    const finish = async (v: number | null) => {
      if (done) return;
      done = true;
      popKeys();
      sfx.play(v ? 'jie.pick' : 'ui.click'); // 选定一劫入局：一口低的钟、远处的闷雷（docs/audio.md「劫数」）
      if (v) setLastJie(v);
      root.classList.remove('enter');
      root.classList.add('leave');
      await wait(380);
      root.remove();
      layer.onFit = refit;
      resolve(v);
    };
    const deny = () => {
      sfx.play('ui.denied');
      panel.paper
        .querySelector('.lockline')
        ?.animate(
          [
            { transform: 'translateX(0)', color: C.zhusha },
            { transform: 'translateX(-.4em)', color: C.zhusha },
            { transform: 'translateX(.4em)', color: C.zhusha },
            { transform: 'translateX(-.2em)', color: C.zhusha },
            { transform: 'translateX(0)', color: C.zhu },
          ],
          { duration: 420, easing: 'ease-out' },
        );
    };
    go.addEventListener('click', () => (cur > top ? deny() : void finish(cur)));
    back.addEventListener('click', () => void finish(null));
    const popKeys = pushKeys((e) => {
      if (done) return 'consume';
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        void finish(null);
        return 'consume';
      }
      if (k === 'arrowleft' || k === 'a' || k === 'arrowright' || k === 'd') {
        const n = clamp(cur + (k === 'arrowleft' || k === 'a' ? -1 : 1), 1, JIE_MAX);
        if (n !== cur) sfx.play('ui.click');
        tiles[n - 1].focus({ preventScroll: true });
        return 'consume';
      }
      if (k === 'enter' || k === ' ' || k === 'j') {
        if (document.activeElement === back) back.click();
        else go.click(); // 在印上按回车 = 入劫
        return 'consume';
      }
      navKeys(e, [tiles[cur - 1], go, back]);
      return 'consume';
    });
  });
}
