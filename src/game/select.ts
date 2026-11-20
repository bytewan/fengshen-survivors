// 选角（DOM，叠在标题页的背景上）：哪吒、杨戬、赵公明、云霄都能选；回响化身（变异角色）解锁了才能选。
// 左边一栏是立绘（战斗精灵按整数个物理像素放大，浮在云海上）、下面是角色栏；右边一卷纸写着主五行、专属法宝、
// 宠物、神通（有被动的再加一行被动），纸下面是「返回」「出战」。角色的说明都从角色表取（catalog.HEROES、hero-views.ts）。
// 回响化身（变异角色，catalog.ECHO）：没解锁时是剪影 +「打赢第一章首领后解锁」这样的一行；解锁后（存档里有对应的 id，
// 魔化哪吒是 demon-nezha）和别的角色一样能选，名字后面写「回响化身」。
// 隐藏角色（catalog.HIDDEN：孙悟空）：和回响化身排在同一行（第二行都是要解锁的）；没解锁时连剪影都不露，只是一个问号（art/sprites/hidden.ts）+ 一句暗示，
// 不写名字、不写在哪儿解锁；解锁了和别人一样能选。
//
// 对齐（用户：「开局的选项等都得对齐」）：
//  - 左栏：立绘和角色栏共用一条中轴；右栏：卷轴和两个按钮共用一条中轴，两个按钮同宽。左右两栏的竖直中线也对齐。
//  - 卷轴里四项说明是两列：左一列标签（主五行 / 专属法宝 / 宠物 / 神通）同宽，右一列的名字和说明都从同一条左边线起。
//  - 换角色时卷轴的大小不变（按字最多的那位留高度），所以卷轴和按钮的位置不会跟着跳。
//  - 不能选的角色，「出战」只是变暗（aria-disabled）、位置大小不变；按下去有「不行」的音效，原因那一行晃一下。
import type { Sfx } from '../audio/sfx.ts';
import { compose, grid, type Grid } from '../art/pixel.ts';
import { MYSTERY } from '../art/sprites/hidden.ts';
import { DIAMOND } from '../art/title.ts';
import { PALETTE, hexToRgba } from '../art/palette.ts';
import { EARNED, ECHO, ELEMENT_COLOR, HEROES, HIDDEN, WEAPONS, unlockIdOf } from '../sim/catalog.ts';
import { skillInfo } from '../sim/heroes/index.ts';
import { ELEMENT_NAME, type Element, type HeroId } from '../sim/types.ts';
import { heroFrames, HERO_VIEWS } from './hero-views.ts';
import { FONT_TITLE } from './fonts.ts';
import { isUnlocked } from './profile.ts';
import { C, P, bitmapUrl, inkButton, inkWidth, injectCss, isCompact, isTall, navKeys, pushKeys, scrollPanel, snapPx, wait, type Layer, type UiFit } from './front-ui.ts';

// ---------- 角色栏 ----------

interface Entry {
  id: HeroId | 'yunxiao';
  name: string;
  /** 立绘的帧（待机）。 */
  frames: Grid[];
  /** 出战时跑出画面的那几帧（能选的角色才有）。 */
  move?: Grid[];
  /** 'ready' 能选；'locked' 没解锁；'soon' 解锁了 / 首发角色，但还没做完。 */
  state: 'ready' | 'locked' | 'soon';
  /** 能选的角色（ready 的那几位）。 */
  hero?: HeroId;
  /** 还没做完的首发角色：主五行、称号、一句话（下一条线做；暂拟）。 */
  soon?: { el: Element; epithet: [string, string]; line: string };
  /** 回响化身：没解锁时那一行写什么（catalog.ECHO 的 where）。 */
  lockLine?: string;
  /** 没解锁的隐藏角色：那一句暗示（catalog.HIDDEN 的 hint）。 */
  hint?: string;
  /** 排在角色栏的第二行（要解锁的那一行：回响化身、隐藏角色）。 */
  echo?: boolean;
}

/** 立绘后面那个大字水印的颜色：按主五行，取暗一档的颜色，免得在灰天上发粉 / 发亮。 */
const MARK_COLOR: Record<Element, string> = { fire: C.zhu, metal: C.hupo, earth: C.zhe, water: C.shiqing, wood: '#3a6b43' };

/** 剪影：整个人压成一团墨色，只留那只赤红的眼（魔化哪吒的眼在第 13–16 行、第 23–28 列这一小块里）。 */
const silhouette = (g: Grid): Grid =>
  grid(g.rows.map((r, y) => [...r].map((c, x) => (c === '.' ? '.' : c === 'k' ? 'k' : (c === 'R' || c === 'e') && y >= 13 && y <= 16 && x >= 23 && x <= 28 ? 'e' : 'd')).join('')));

// ---------- 样式 ----------

const CSS = `
#fs-front .select { position: absolute; inset: 0; }
#fs-front .select .head { position: absolute; display: flex; align-items: center; gap: .45em; font-family: ${FONT_TITLE}; font-size: 1.45em; line-height: 1.3; color: ${C.yuebai}; letter-spacing: .18em; white-space: nowrap; text-shadow: 0 var(--p) 0 ${C.wu}; }
#fs-front .select .head i { display: block; flex: none; width: ${P(5)}; height: ${P(5)}; background: var(--dia) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
#fs-front .select .stage { position: absolute; }
#fs-front .select .stage .mark { position: absolute; left: -50%; right: -50%; text-align: center; top: var(--mt); font-family: ${FONT_TITLE}; font-size: var(--mk); line-height: 1; color: var(--el); opacity: .16; pointer-events: none; transition: opacity .5s, color .5s; }
/* 立绘踩着风火轮浮在云海上：慢慢上下浮动（按整格跳，不糊）。舞台正好是立绘那么宽，位置由 layout 按中轴摆在整像素上 */
#fs-front .select .stage .bob { position: absolute; inset: 0; animation: fs-bob 2.4s steps(2, jump-none) infinite alternate; }
@keyframes fs-bob { to { transform: translateY(calc(var(--p) * -2)); } }
/* 立绘脚底对齐（两个精灵的锚点都在画布正中、最底一行） */
#fs-front .select .stage .hero { position: absolute; left: 50%; bottom: 0; margin-left: calc(var(--hw) / -2); transition: transform .6s ease-in, opacity .6s ease-in; }
#fs-front .select .stage.go .hero { transform: translate(3em, -.8em); opacity: 0; }
/* 角色栏两行：上一行四位本人，下一行回响化身（同样大的格子、同样的间距，两行共用一条中轴） */
#fs-front .select .roster { position: absolute; display: flex; flex-direction: column; align-items: center; gap: ${P(4)}; }
#fs-front .select .roster .row { display: flex; gap: ${P(6)}; }
/* 角色格：选中的一格描朱砂边（内描边，不改大小）；焦点跟着选中走，不另画 */
#fs-front .select .tile { position: relative; flex: none; width: var(--tile); height: var(--tile); display: flex; align-items: flex-end; justify-content: center; overflow: hidden; background: ${C.yuebai}; box-shadow: inset 0 0 0 var(--p) ${C.yinshu}, 0 var(--p) 0 0 ${C.cang}; cursor: pointer; }
#fs-front .select .tile canvas { margin-bottom: ${P(3)}; }
#fs-front .select .tile.on { box-shadow: inset 0 0 0 var(--p) ${C.zhu}, inset 0 0 0 ${P(2)} ${C.zhusha}, 0 var(--p) 0 0 ${C.yin}; }
#fs-front .select .tile:focus { outline: none; }
#fs-front .select .tile .lock { position: absolute; right: ${P(2)}; top: ${P(2)}; padding: 0 .3em; font-size: .86em; line-height: 1.4; color: ${C.yuebai}; background: ${C.dai}; }
#fs-front .select .info .nm { display: flex; align-items: baseline; gap: .7em; margin-bottom: .35em; white-space: nowrap; }
#fs-front .select .info .nm b { flex: none; font-family: ${FONT_TITLE}; font-size: 2.2em; line-height: 1.25; color: ${C.xuan}; letter-spacing: .08em; }
#fs-front .select .info .nm span { color: ${C.cang}; }
#fs-front .select .info .nm b.q3 { letter-spacing: -.12em; color: ${C.dai}; }
#fs-front .select .info .ep-s { display: none; }
/* 四项说明：两列，标签同宽，右一列从同一条左边线起 */
#fs-front .select .info .its { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .9em; row-gap: .5em; margin: 0; }
#fs-front .select .info .its dt { color: ${C.zhu}; letter-spacing: .08em; white-space: nowrap; }
#fs-front .select .info .its dd { margin: 0; min-width: 0; }
#fs-front .select .info .v { display: block; color: ${C.xuan}; }
#fs-front .select .info .d { display: block; color: ${C.wu}; }
#fs-front .select .info .el { display: inline-block; width: 1.4em; height: 1.4em; line-height: 1.4em; text-align: center; color: ${C.yuebai}; background: var(--el); box-shadow: inset 0 0 0 var(--p) rgba(26,21,32,.35); margin-right: .45em; vertical-align: top; }
#fs-front .select .info .el + .d { display: inline; }
#fs-front .select .info .el.pe { width: 1.25em; height: 1.25em; line-height: 1.25em; margin: 0 0 0 .4em; font-size: .86em; vertical-align: .05em; } /* 宠物的五行（和主五行不同的另一行，用户 11-12） */
#fs-front .select .info .q { color: ${C.yinshu}; letter-spacing: .25em; }
#fs-front .select .info .lockline { margin-top: .8em; color: ${C.zhu}; text-align: center; letter-spacing: .08em; }
/* 版面紧（手机）：名字后面接着写说明，不另起一行 */
#fs-front .select.compact .info .ep-l { display: none; }
#fs-front .select.compact .info .ep-s { display: inline; }
#fs-front .select.compact .info .nm { margin-bottom: .1em; }
#fs-front .select.compact .info .nm b { font-size: 1.9em; }
#fs-front .select.compact .info .its { row-gap: .25em; column-gap: .7em; line-height: 1.42; }
#fs-front .select.compact .info .v, #fs-front .select.compact .info .d { display: inline; }
#fs-front .select.compact .info .v + .d::before { content: '·'; margin: 0 .35em; color: ${C.yinshu}; }
#fs-front .select .btns { position: absolute; display: flex; justify-content: center; gap: ${P(12)}; }
#fs-front .select.enter .stage { animation: fs-sel-in .7s ease-out both; }
#fs-front .select.enter .roster, #fs-front .select.enter .btns, #fs-front .select.enter .head { animation: fs-sel-fade .6s .25s ease-out both; }
@keyframes fs-sel-in { from { opacity: 0; transform: translateX(-.8em); } }
@keyframes fs-sel-fade { from { opacity: 0; } }
#fs-front .select.leave { animation: fs-sel-fade .4s ease-in reverse forwards; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { #fs-front .select .stage .bob { animation: none; } }
`;

/** 立绘：一张小画布逐帧换图，CSS 放大（scale = 一个精灵像素是几个 CSS 像素）；换一组帧时画布跟着换大小。 */
function spritePlayer(frames: Grid[], scale: number, fps: number) {
  const c = document.createElement('canvas');
  c.className = 'px';
  const ctx = c.getContext('2d')!;
  let fs = frames;
  let k = scale;
  let i = 0;
  const imgs = new Map<Grid, ImageData>();
  const size = () => {
    const w = Math.max(...fs.map((f) => f.w));
    const h = Math.max(...fs.map((f) => f.h));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.style.width = `${w * k}px`;
    c.style.height = `${h * k}px`;
    c.style.setProperty('--hw', `${w * k}px`);
  };
  const draw = () => {
    const g = fs[i % fs.length];
    let img = imgs.get(g);
    if (!img) {
      const one = compose(c.width, c.height, [{ g, x: Math.floor((c.width - g.w) / 2), y: c.height - g.h }]);
      const rgba = new Uint8ClampedArray(c.width * c.height * 4);
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const ch = one.rows[y][x];
          if (ch !== '.') rgba.set(hexRgba(ch), (y * c.width + x) * 4);
        }
      img = new ImageData(rgba, c.width, c.height);
      imgs.set(g, img);
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.putImageData(img, 0, 0);
  };
  size();
  draw();
  const timer = setInterval(() => {
    i++;
    draw();
  }, 1000 / fps);
  return {
    el: c,
    set(next: Grid[]) {
      fs = next;
      i = 0;
      imgs.clear();
      size();
      draw();
    },
    setScale(s: number) {
      k = s;
      size();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

const hexRgba = (ch: string) => hexToRgba(PALETTE[ch]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 人物画布的标准宽（「人物与宠物的尺子」：44×40）。 */
const STAGE_W = 44;
/**
 * 选角页用的帧：画布比标准宽的（回响敖丙 62 宽，右边留给刺出去的戟）按脚底锚点两边对称地裁到标准宽——
 * 不然立绘和格子都按最宽的那张定大小，所有人的小像跟着缩一圈，他自己还偏在格子左边。
 */
function stageFrames(id: HeroId, pose: 'idle' | 'move'): Grid[] {
  const v = HERO_VIEWS[id];
  const fs = heroFrames(id)[pose];
  if (v.w <= STAGE_W) return fs;
  const x0 = v.anchor.x - STAGE_W / 2;
  return fs.map((g) => ({ w: STAGE_W, h: g.h, rows: g.rows.map((r) => ('.'.repeat(Math.max(0, -x0)) + r.slice(Math.max(0, x0))).slice(0, STAGE_W).padEnd(STAGE_W, '.')) }));
}

/** 选角。返回选中的角色；点「返回」返回 null。 */
export async function showSelect(layer: Layer, sfx: Sfx): Promise<HeroId | null> {
  injectCss('fs-select', CSS);
  const hero = (id: HeroId): Entry => ({ id, hero: id, name: HEROES[id].name, frames: stageFrames(id, 'idle'), move: stageFrames(id, 'move'), state: 'ready' });
  /** 回响化身：解锁了和别人一样能选；没解锁是剪影（只留那只赤红的眼）+ 在哪儿遇到。 */
  const echo = (id: HeroId): Entry => {
    const u = unlockIdOf(id);
    if (!u || isUnlocked(u)) return { ...hero(id), echo: true };
    return { id, name: HEROES[id].name, frames: stageFrames(id, 'idle').map(silhouette), state: 'locked', lockLine: ECHO[id]?.where, echo: true };
  };
  /** 成就奖励的角色（catalog.EARNED：雷震子平定第一章后解锁）：排在本人那一行；没解锁是剪影 + 怎么解锁。 */
  const earned = (id: HeroId): Entry => {
    const u = EARNED[id]?.unlock;
    if (!u || isUnlocked(u)) return hero(id);
    return { id, name: HEROES[id].name, frames: stageFrames(id, 'idle').map(silhouette), state: 'locked', lockLine: EARNED[id]?.where };
  };
  /** 隐藏角色：解锁了和别人一样能选；没解锁是一个问号剪影（不露名字、不露轮廓）+ 一句暗示。和回响化身排在同一行。 */
  const hidden = (id: HeroId): Entry => {
    const h = HIDDEN[id];
    if (!h || isUnlocked(h.unlock)) return { ...hero(id), echo: true };
    return { id, name: '？？？', frames: [MYSTERY], state: 'locked', hint: h.hint, echo: true };
  };
  const entries: Entry[] = [
    hero('nezha'),
    hero('yangjian'),
    hero('zhao'),
    hero('yunxiao'),
    earned('leizhenzi'),
    echo('mozha'),
    echo('huiao'), // 回响敖丙（第一章首领池的另一位）
    echo('huizhao'),
    echo('huiyun'),
    hidden('wukong'),
  ];
  const root = document.createElement('div');
  root.className = 'select enter';
  root.style.setProperty('--dia', `url("${bitmapUrl(DIAMOND)}")`);
  root.innerHTML = `<div class="head"><i></i>选择角色</div><div class="stage"><div class="mark"></div><div class="bob"></div></div><div class="roster"></div><div class="btns"></div>`;
  layer.ui.appendChild(root);
  const head = root.querySelector('.head') as HTMLElement;
  const stage = root.querySelector('.stage') as HTMLElement;
  const mark = root.querySelector('.mark') as HTMLElement;
  const bob = root.querySelector('.bob') as HTMLElement;
  const roster = root.querySelector('.roster') as HTMLElement;
  const rows = [document.createElement('div'), document.createElement('div')];
  for (const r of rows) {
    r.className = 'row';
    roster.appendChild(r);
  }
  const perRow = Math.max(entries.filter((e) => !e.echo).length, entries.filter((e) => e.echo).length);
  const btns = root.querySelector('.btns') as HTMLElement;
  const panel = scrollPanel(28);
  panel.el.classList.add('info');
  root.appendChild(panel.el);

  let cur = 0;
  const portrait = spritePlayer(entries[0].frames, 4, 5);
  portrait.el.classList.add('hero');
  bob.appendChild(portrait.el);
  const tilePlayers: ReturnType<typeof spritePlayer>[] = [];
  const tiles = entries.map((e, i) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'tile';
    t.setAttribute('aria-label', e.name);
    const pl = spritePlayer([e.frames[0]], 1, 1);
    pl.stop();
    tilePlayers.push(pl);
    t.appendChild(pl.el);
    if (e.state === 'locked') t.insertAdjacentHTML('beforeend', '<span class="lock">锁</span>');
    t.addEventListener('click', () => {
      if (cur !== i) sfx.play('ui.click');
      pick(i);
    });
    // 鼠标滑过不再选中（用户 2026-11-12：「选择英雄应该是点击锁定，而不是滑过锁定」）；点击、方向键 / Tab 才换人
    t.addEventListener('focus', () => pick(i));
    rows[e.echo ? 1 : 0].appendChild(t);
    return t;
  });
  // 两个按钮同宽，和卷轴共用一条中轴
  const bw = inkWidth('返回', '出战');
  const back = inkButton('返回', { w: bw });
  const go = inkButton('出战', { primary: true, w: bw });
  btns.append(back, go);

  const row = (k: string, body: string) => `<dt>${k}</dt><dd>${body}</dd>`;
  const info = (e: Entry) => {
    if (e.hero) {
      const h = HEROES[e.hero];
      const w = WEAPONS[h.exclusive];
      const el = ELEMENT_COLOR[h.el];
      const sk = skillInfo(h.skill);
      const [epL, epS] = HERO_VIEWS[e.hero].epithet;
      return `<div class="nm"><b>${h.name}</b><span class="ep-l">${epL}</span><span class="ep-s">${epS}</span></div>
        <dl class="its">
        ${row('主五行', `<span class="el" style="--el:${el}">${ELEMENT_NAME[h.el]}</span><span class="d">开局${ELEMENT_NAME[h.el]}行亲和 +${Math.round(h.affStart * 100)}%</span>`)}
        ${row('专属法宝', `<span class="v">${w.name}</span><span class="d">${w.desc}</span>`)}
        ${row('宠物', `<span class="v">${h.pet}<span class="el pe" style="--el:${ELEMENT_COLOR[h.petEl]}">${ELEMENT_NAME[h.petEl]}</span></span><span class="d">${h.petDesc}</span>`)}
        ${row('神通', `<span class="v">${sk.name}</span><span class="d">${sk.desc}</span>`)}
        ${h.passive ? row('被动', `<span class="v">${h.passive.name}</span><span class="d">${h.passive.desc}</span>`) : ''}
        </dl>`;
    }
    if (e.soon) {
      const el = ELEMENT_COLOR[e.soon.el];
      return `<div class="nm"><b>${e.name}</b><span class="ep-l">${e.soon.epithet[0]}</span><span class="ep-s">${e.soon.epithet[1]}</span></div>
        <dl class="its">
        ${row('主五行', `<span class="el" style="--el:${el}">${ELEMENT_NAME[e.soon.el]}</span>`)}
        ${row('专属法宝', '<span class="q">？？？</span>')}
        ${row('宠物', '<span class="q">？？？</span>')}
        ${row('神通', '<span class="q">？？？</span>')}
        </dl>
        <div class="d" style="margin-top:.6em">${e.soon.line}</div>
        <div class="lockline">即将开放</div>`;
    }
    if (e.hint)
      return `<div class="nm"><b class="q3">？？？</b></div>
        <dl class="its">
        ${row('主五行', '<span class="q">？</span>')}
        ${row('专属法宝', '<span class="q">？？？</span>')}
        ${row('宠物', '<span class="q">？？？</span>')}
        ${row('神通', '<span class="q">？？？</span>')}
        </dl>
        <div class="lockline">${e.hint}</div>`;
    if (e.state === 'locked')
      return `<div class="nm"><b class="q3">？？？</b><span>${e.echo ? '回响化身' : '成就奖励'}</span></div>
        <dl class="its">
        ${row('主五行', '<span class="q">？</span>')}
        ${row('专属法宝', '<span class="q">？？？</span>')}
        ${row('宠物', '<span class="q">？？？</span>')}
        ${row('神通', '<span class="q">？？？</span>')}
        </dl>
        <div class="lockline">${e.lockLine ?? '击败其回响后解锁'}</div>`;
    return '';
  };

  const pick = (i: number) => {
    cur = i;
    const e = entries[i];
    tiles.forEach((t, k) => t.classList.toggle('on', k === i));
    portrait.set(e.frames);
    // 水印：主五行的字（能选的、即将开放的），魔化哪吒是「魔」，没解锁的是「？」
    const mel = e.hero ? HEROES[e.hero].el : e.soon?.el;
    stage.style.setProperty('--el', mel ? MARK_COLOR[mel] : C.zitang);
    mark.textContent = mel ? ELEMENT_NAME[mel] : e.state === 'locked' ? '？' : '魔';
    mark.style.opacity = e.state === 'locked' ? '0.08' : e.soon ? '0.1' : '';
    panel.paper.innerHTML = info(e);
    // 不能选的：按钮只是变暗，位置大小不变，照样能按（按下去给「不行」的反馈）
    go.setAttribute('aria-disabled', String(e.state !== 'ready'));
  };

  const layout = (f: UiFit) => {
    if (isTall(f)) return layoutTall(f);
    const em = f.base;
    const compact = isCompact(f);
    root.classList.toggle('compact', compact);
    // 版面矩形：窗口去掉安全区；比 16:9 宽的最多用到 2.2:1（再宽就居中留边），比 16:9 高的取中间一条
    const safeW = f.w - f.safe.left - f.safe.right;
    const boxW = Math.min(safeW, f.h * 2.2);
    const boxH = Math.min(f.h, boxW * 0.62);
    const bx = f.safe.left + (safeW - boxW) / 2;
    const by = (f.h - boxH) / 2;
    const mx = (compact ? 1.1 : 1.8) * em;
    Object.assign(head.style, { left: `${snapPx(bx + mx, f)}px`, top: `${snapPx(by + (compact ? 0.35 : 0.9) * em, f)}px` });

    // 右栏：卷轴 + 按钮。卷轴按字最多的那位留高度，换角色时大小不变
    let pwEm = compact ? clamp((boxW * 0.56) / em, 24, 27.5) : clamp((boxW * 0.46) / em, 22, 29);
    const rod = f.p * 6; // 轴比纸两边各宽出 6 格
    const gapPB = (compact ? 0.3 : 0.9) * em; // 卷轴和按钮之间
    const bottomPad = f.safe.bottom + (compact ? 0.3 : 1) * em;
    const topPad = (compact ? 0.4 : 1) * em;
    const maxPanel = boxH - topPad - bottomPad - f.tap - gapPB - f.p * 14; // 两根轴、投影
    panel.paper.style.minHeight = '';
    panel.paper.style.maxHeight = '';
    let need = 0;
    // 矮窗口里放不下时把卷轴加宽一点（说明少折几行），最多到版面的三分之二
    for (let tries = 0; ; tries++) {
      panel.setWidth(pwEm);
      need = 0;
      for (const e of entries) {
        panel.paper.innerHTML = info(e);
        need = Math.max(need, panel.paper.offsetHeight);
      }
      const wider = Math.min((boxW * 0.66) / em, pwEm + 1.5);
      if (need <= maxPanel || wider <= pwEm || tries >= 5) break;
      pwEm = wider;
    }
    panel.paper.innerHTML = info(entries[cur]);
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

    // 左栏：立绘 + 角色栏，共用一条中轴（axis，落在整像素上；立绘和角色栏的宽度都是偶数个物理像素，两边各占一半）。
    // 立绘按最大的那张（魔化哪吒的画布比哪吒大）留地方
    const leftX = bx + mx;
    const leftW = panelLeft - rod - mx * 0.5 - leftX;
    const axis = snapPx(leftX + leftW / 2, f);
    const fw = Math.max(...entries.map((e) => e.frames[0].w));
    const fh = Math.max(...entries.map((e) => e.frames[0].h));
    // 角色格里的精灵：一个精灵像素是几个 CSS 像素（一行四格要放得进左栏，放不下就缩一档）
    const fitS = Math.floor((((leftW * 0.96 - f.p * 6 * (perRow - 1)) / perRow) * f.dpr) / fw);
    const tileS = Math.max(1, Math.min(Math.round((4.2 * em * f.dpr) / fw), fitS)) / f.dpr;
    const tile = fw * tileS;
    const rosterW = tile * perRow + f.p * 6 * (perRow - 1);
    const rosterH = tile * 2 + f.p * 4; // 两行：本人一行，回响化身和隐藏角色一行
    const gapSR = (compact ? 0.5 : 1) * em;
    const availH = boxH - topPad - bottomPad - rosterH - gapSR - (compact ? 1.2 : 2) * em;
    const hs = Math.max(1, Math.floor(Math.min((boxH * 0.42) / fh, availH / fh, (leftW * 0.92) / fw) * f.dpr)) / f.dpr;
    portrait.setScale(hs);
    tilePlayers.forEach((pl) => pl.setScale(tileS));
    const sw = fw * hs;
    const sh = fh * hs;
    const stageTop = snapPx(midY - (sh + gapSR + rosterH) / 2, f);
    Object.assign(stage.style, { left: `${axis - sw / 2}px`, top: `${stageTop}px`, width: `${sw}px`, height: `${sh}px` });
    stage.style.setProperty('--mk', `${Math.round(sh * 1.05)}px`);
    stage.style.setProperty('--mt', `${Math.round(-sh * 0.12)}px`);
    roster.style.setProperty('--tile', `${tile}px`);
    Object.assign(roster.style, { left: `${axis - rosterW / 2}px`, top: `${snapPx(stageTop + sh + gapSR, f)}px` });
  };
  /**
   * 竖着的版面（手机竖着拿、又高又窄的窗口）：从上往下叠——「选择角色」、立绘、角色栏、卷轴、两个按钮，都在窗口的中轴上。
   * 卷轴照旧按字最多的那位留高度（换角色时大小不变）；立绘用剩下的高度（最大约三成窗口高），太挤时卷轴让出来、在里面滚动。
   */
  const layoutTall = (f: UiFit) => {
    const safeH = f.h - f.safe.top - f.safe.bottom;
    // 先按宽松的版面量；立绘因此小于三倍时换紧版面（名字后面接着写说明，行距收一点），再量一次
    let compact = safeH / f.base < 44;
    for (;;) {
      root.classList.toggle('compact', compact);
      const fit = tallFit(f, compact);
      if (compact || fit) return;
      compact = true;
    }
  };
  /** 竖版按 compact 摆一次；宽松版面（compact 为 false）里立绘放不到三倍大时不摆、返回 false。 */
  const tallFit = (f: UiFit, compact: boolean): boolean => {
    const em = f.base;
    const safeW = f.w - f.safe.left - f.safe.right;
    const safeH = f.h - f.safe.top - f.safe.bottom;
    const mx = clamp(safeW * 0.05, 0.6 * em, 1.8 * em);
    const rod = f.p * 6;
    const axis = snapPx(f.safe.left + safeW / 2, f);
    const headTop = f.safe.top + (compact ? 0.5 : 0.9) * em;
    Object.assign(head.style, { left: `${snapPx(f.safe.left + mx, f)}px`, top: `${snapPx(headTop, f)}px` });
    const headBottom = headTop + head.offsetHeight;
    // 角色栏：两行（本人一行、回响化身一行），一行 perRow 格，放不下就把格子缩小
    const fw = Math.max(...entries.map((e) => e.frames[0].w));
    const fh = Math.max(...entries.map((e) => e.frames[0].h));
    const gapT = f.p * 6;
    const n = perRow;
    const maxTile = (safeW - 2 * mx - gapT * (n - 1)) / n;
    const tileS = Math.max(1, Math.floor((Math.min(4.2 * em, maxTile) * f.dpr) / fw)) / f.dpr;
    const tile = fw * tileS;
    const rosterW = tile * n + gapT * (n - 1);
    const rosterH = tile * 2 + f.p * 4;
    // 卷轴：尽量宽（最多 28 个字），按字最多的那位量高度
    panel.paper.style.minHeight = '';
    panel.paper.style.maxHeight = '';
    panel.setWidth(Math.min(28, (safeW - 2 * mx - 2 * rod) / em));
    let need = 0;
    for (const e of entries) {
      panel.paper.innerHTML = info(e);
      need = Math.max(need, panel.paper.offsetHeight);
    }
    panel.paper.innerHTML = info(entries[cur]);
    const gapHS = (compact ? 0.5 : 1.1) * em; // 标题 → 立绘
    const gapSR = (compact ? 0.5 : 0.9) * em; // 立绘 → 角色栏
    const gapRP = (compact ? 0.6 : 1.1) * em; // 角色栏 → 卷轴
    const gapPB = (compact ? 0.4 : 0.9) * em; // 卷轴 → 按钮
    const bottomPad = f.safe.bottom + (compact ? 0.5 : 1.2) * em;
    const rods = f.p * 10; // 两根轴比纸多出来的高
    const free = f.h - bottomPad - headBottom - gapHS - gapSR - rosterH - gapRP - rods - gapPB - f.tap; // 立绘 + 纸
    // 立绘最大约三成窗口高、也不超过 14 个字高（平板竖屏的窗口高，再大就和字不成比例了）
    const hsMax = Math.max(1, Math.floor(Math.min(Math.min(safeH * 0.32, em * 14) / fh, (safeW * 0.62) / fw) * f.dpr)) / f.dpr;
    const hsMin = Math.min(hsMax, Math.max(1, Math.round(2 * f.dpr)) / f.dpr); // 立绘至少两倍大
    const hs = Math.max(hsMin, Math.min(hsMax, Math.floor(((free - need) / fh) * f.dpr) / f.dpr));
    if (!compact && hs < Math.min(hsMax, 3)) return false;
    const ph = Math.round(Math.max(em * 4, Math.min(need, free - fh * hs)));
    panel.paper.style.minHeight = `${ph}px`;
    panel.paper.style.maxHeight = `${ph}px`;
    const panelW = panel.el.offsetWidth;
    const panelH = panel.el.offsetHeight;
    portrait.setScale(hs);
    tilePlayers.forEach((pl) => pl.setScale(tileS));
    const sw = fw * hs;
    const sh = fh * hs;
    const block = sh + gapSR + rosterH + gapRP + panelH + gapPB + f.tap;
    const top0 = headBottom + gapHS;
    const stageTop = snapPx(top0 + Math.max(0, (f.h - bottomPad - top0 - block) / 2), f);
    Object.assign(stage.style, { left: `${axis - sw / 2}px`, top: `${stageTop}px`, width: `${sw}px`, height: `${sh}px` });
    stage.style.setProperty('--mk', `${Math.round(sh * 1.05)}px`);
    stage.style.setProperty('--mt', `${Math.round(-sh * 0.12)}px`);
    roster.style.setProperty('--tile', `${tile}px`);
    const rosterTop = snapPx(stageTop + sh + gapSR, f);
    Object.assign(roster.style, { left: `${snapPx(axis - rosterW / 2, f)}px`, top: `${rosterTop}px` });
    const panelLeft = snapPx(axis - panelW / 2, f);
    const panelTop = snapPx(rosterTop + rosterH + gapRP, f);
    Object.assign(panel.el.style, { left: `${panelLeft}px`, top: `${panelTop}px` });
    Object.assign(btns.style, { left: `${panelLeft}px`, width: `${panelW}px`, top: `${snapPx(panelTop + panelH + gapPB, f)}px` });
    return true;
  };
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    layout(f);
  };
  pick(0);
  layout(layer.fit);
  void panel.open();
  await wait(60);
  go.focus({ preventScroll: true });

  return new Promise<HeroId | null>((resolve) => {
    let done = false;
    const finish = async (v: HeroId | null) => {
      if (done) return;
      done = true;
      popKeys();
      if (v) {
        sfx.play('ui.ready');
        portrait.set(entries[cur].move ?? entries[cur].frames);
        stage.classList.add('go');
        await wait(500);
      } else sfx.play('ui.click');
      root.classList.remove('enter');
      root.classList.add('leave');
      await wait(380);
      portrait.stop();
      root.remove();
      layer.onFit = refit;
      resolve(v);
    };
    /** 这位不能选：「不行」的音效，原因那一行晃一下、亮一下。 */
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
    go.addEventListener('click', () => {
      const e = entries[cur];
      if (e.state !== 'ready') return deny();
      void finish(e.id as HeroId);
    });
    back.addEventListener('click', () => void finish(null));
    const popKeys = pushKeys((e) => {
      if (done) return 'consume';
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        void finish(null);
        return 'consume';
      }
      // 左右键换角色（焦点落到角色格上）；上下键在角色格、「出战」、「返回」之间走
      if (k === 'arrowleft' || k === 'a' || k === 'arrowright' || k === 'd') {
        const n = (cur + (k === 'arrowleft' || k === 'a' ? -1 : 1) + entries.length) % entries.length;
        sfx.play('ui.click');
        tiles[n].focus({ preventScroll: true });
        return 'consume';
      }
      if (k === 'enter' || k === ' ' || k === 'j') {
        const a = document.activeElement;
        if (a === back) back.click();
        else go.click(); // 在角色格上按回车 = 出战
        return 'consume';
      }
      navKeys(e, [tiles[cur], go, back]);
      return 'consume';
    });
  });
}
