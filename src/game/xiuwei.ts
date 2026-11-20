// 修为（DOM，卷轴面板）：标题页的「修为」→ 这里。用每局攒下的「道行」点亮一张修行图谱（节点表、加成在 sim/xiuwei.ts，存档在 profile.ts）。
//
// 图谱（2026-11-12 重做，暂拟，待评审确认；同日用户又改两条：「修为变成一个个点，不要一个个框里有中文」「应该倒过来，问道在最上方」）：
// 像一张星图 / 经络穴位图。问道在最上方正中，五条路线（身、灵、器、财、心）是五道经络往下长；五层境界自上而下（地仙在上、大罗金仙在最下），
// 每层是一道微微下弯的虚线弧，境界名写在弧的两头。节点是点，盘上不写字：小节点一个圆点；心法和问道大一号、外面隔一道缝绕一圈细纹；
// 二选一是那一层并排的两点（从前一节岔开、在下一节合回来），被封的那一点灰下去、压一道朱红的小斜划。
// 点：点亮的是金（左上一点内亮）；能点的纸色透暖、藤黄细边（微亮）；够不着的淡墨（暗）。点击范围是点外面一圈透明的格子（手机上不小于 32）。
// 名字只在选中的那一点旁边浮一个小标签（往右、左、下、上里挑不压着别的点和字的一边）；名字、说明、花费都在说明栏。
// 经络：没走过的是一串淡墨点；走过的是一笔金线，点亮的那一下顺着经络流过去，然后那一点「落」下来。
// 境界的弧：入了这一境（门槛够了）是淡金的虚线，还没入是淡墨点。不用任何发光、光圈，背景就是卷轴的纸。
// 说明栏（横着的窗口在右边一栏，竖屏在下面）：名字、境界与路线、一句意象、一行小字写加多少、能不能点；按钮「点亮」「重置」「返回」同宽、一排。
// 鼠标停在点上只在说明栏里预览、不换选中。键盘：方向键在图上朝那个方向找最近的一点，回车点亮，Esc 返回。
import type { Sfx } from '../audio/sfx.ts';
import { PATHS, PATH_DESC, PATH_NAME, REALMS, XIUWEI, XIUWEI_FULL, XIUWEI_NODES, gateOf, nodeState, type NodeState, type XiuweiId, type XiuweiNode } from '../sim/xiuwei.ts';
import { FONT_TITLE } from './fonts.ts';
import { freeDao, lightNode, loadXiuwei, resetXiuwei } from './profile.ts';
import { C, centerIn, inkButton, inkWidth, injectCss, isCompact, isTall, navKeys, pushKeys, scrollPanel, snapPx, wait, type Layer, type UiFit } from './front-ui.ts';

/** 环上写的境界名（两个字；全名在说明栏里）。 */
const REALM_SHORT = ['', '地仙', '天仙', '金仙', '太乙', '大罗'];
const CN = ['', '一', '二', '三', '四', '五'];

const CSS = `
.fs-ui .xw-body { display: flex; flex-direction: column; align-items: center; min-height: 0; }
.fs-ui .xw-side { display: flex; flex-direction: column; align-self: stretch; }
.fs-ui .xw-body.side { flex-direction: row; align-items: center; gap: 1.2em; }
.fs-ui .xw-body.side .xw-side { width: var(--sw); flex: none; align-self: center; }
.fs-ui .xw-head { display: flex; justify-content: center; align-items: baseline; gap: 1.2em; white-space: nowrap; color: ${C.cang}; margin-bottom: .15em; }
.fs-ui .xw-head b { font-size: 1.35em; color: ${C.hupo}; margin: 0 .15em; font-variant-numeric: tabular-nums; }
.fs-ui .xw-head span { letter-spacing: .06em; }
.fs-ui .xw-how { color: ${C.yinshu}; text-align: center; margin-bottom: .3em; }
.fs-ui .xw-tree { position: relative; flex: none; }
.fs-ui .xw-tree svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
/* 经络是墨线（用户 2026-11-12：「用黑色的线，不需要直线」「线不需要这么粗，要随机一点」）：每一笔是一个填色的笔形——
   起笔重、收笔轻，中间略有抖动（形状按节点 id 定的种子算，每次打开都一样）。没走过的一笔淡墨（.vein）；走过的浓墨（.ink），
   用遮罩里一道沿经络走的描边把它「洇」出来（.mk：pathLength = 1，dashoffset 从 1 走到 0） */
.fs-ui .xw-tree .vein { fill: ${C.xuan}; opacity: .2; }
.fs-ui .xw-tree .ink { fill: ${C.xuan}; opacity: .86; }
.fs-ui .xw-tree .mk { fill: none; stroke: #fff; stroke-linecap: butt; stroke-dasharray: 1 1; stroke-dashoffset: 1; }
.fs-ui .xw-tree .mk.on { stroke-dashoffset: 0; }
.fs-ui .xw-tree .mk.draw { transition: stroke-dashoffset .8s cubic-bezier(.35,.1,.25,1); }
.fs-ui .xw-tree .rl { position: absolute; transform: translate(-50%, -50%); font-size: .78em; line-height: 1; letter-spacing: .08em; color: ${C.yinshu}; white-space: nowrap; transition: color .4s; }
.fs-ui .xw-tree.vlab .rl { writing-mode: vertical-rl; letter-spacing: .02em; }
.fs-ui .xw-tree .rl.in { color: ${C.dai}; }
.fs-ui .xw-tree .pl { position: absolute; transform: translate(-50%, -50%); font-family: ${FONT_TITLE}; font-size: 1.2em; line-height: 1; color: ${C.yinshu}; transition: color .4s; }
.fs-ui .xw-tree .pl.on { color: ${C.xuan}; }
/* 节点是一个个墨点（用户 2026-11-12：「点也是黑色」），盘上不写字。按钮本身是透明的点击范围（手机上不小于 32），里面的 b 是看得见的点：
   直径 --d，形状略不规则（--br，按种子），像毛笔点下去的一点。心法和问道大一号，外面隔一道缝绕一圈很细的淡墨环（outline）。
   名字只在选中的那一点旁边浮一个朱红小字（.xw-tag），墨色里留一点朱红点睛 */
.fs-ui .xw-node { position: absolute; display: flex; align-items: center; justify-content: center; padding: 0; background: none; border: 0; cursor: pointer; }
.fs-ui .xw-node b { display: block; width: var(--d); height: var(--d); border-radius: var(--br, 50%); transform: rotate(var(--rot, 0deg));
  background: radial-gradient(circle at 50% 50%, rgba(26,21,32,.16) 0 50%, rgba(26,21,32,0) 88%); transition: background .3s, transform .25s, opacity .3s; }
.fs-ui .xw-node.orb b { outline: calc(var(--p) * .7) solid rgba(26,21,32,.16); outline-offset: calc(var(--p) * 2.2); }
/* 道行不够（前置都满足）：淡墨圈 */
.fs-ui .xw-node.s-poor b { background: radial-gradient(circle, rgba(242,232,213,1) 0 42%, rgba(26,21,32,.32) 52% 64%, rgba(26,21,32,0) 90%); }
/* 能点：墨圈里透出纸色 */
.fs-ui .xw-node.s-ok b { background: radial-gradient(circle, rgba(250,244,230,1) 0 40%, rgba(26,21,32,.7) 50% 62%, rgba(26,21,32,0) 86%); }
.fs-ui .xw-node.orb.s-ok b { outline-color: rgba(26,21,32,.4); }
/* 点亮：浓墨实心，边上一点墨晕 */
.fs-ui .xw-node.s-lit b { background: radial-gradient(circle at 46% 44%, #221a24 0 52%, rgba(26,21,32,.82) 66%, rgba(26,21,32,0) 92%); }
.fs-ui .xw-node.orb.s-lit b { outline-color: rgba(26,21,32,.5); }
/* 二选一被封：几乎隐去，只描一圈很浅的墨虚边（用户 2026-11-12：「不需要叉号」） */
.fs-ui .xw-node.s-sealed b { background: none; border: var(--p) dashed rgba(26,21,32,.22); box-sizing: border-box; outline: none; }
.fs-ui .xw-node.stamp b { animation: xw-stamp .45s cubic-bezier(.3,1.3,.5,1) both; animation-delay: .6s; }
@keyframes xw-stamp { from { transform: rotate(var(--rot, 0deg)) scale(1.8); opacity: 0; } }
/* 选中的那一个：点略放大，旁边浮朱红的名字；鼠标停着的略放大 */
.fs-ui .xw-node.sel b { transform: rotate(var(--rot, 0deg)) scale(1.18); }
.fs-ui .xw-node.peek b { transform: rotate(var(--rot, 0deg)) scale(1.1); }
.fs-ui .xw-node:focus { outline: none; }
.fs-ui .xw-tag { position: absolute; transform: translateY(-50%); font-size: .82em; line-height: 1; letter-spacing: .06em; white-space: nowrap; color: ${C.zhu}; pointer-events: none;
  text-shadow: 0 0 calc(var(--p) * 2) ${C.yuebai}, 0 0 var(--p) ${C.yuebai}; transition: opacity .2s; }
.fs-ui .xw-info { flex: none; display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .9em; align-items: baseline; margin: .7em .4em 0; min-height: 4.4em; align-self: stretch; }
.fs-ui .xw-info .nm { font-family: ${FONT_TITLE}; font-size: 1.6em; line-height: 1.2; color: ${C.xuan}; letter-spacing: .08em; white-space: nowrap; }
.fs-ui .xw-info .w { display: block; color: ${C.cang}; font-size: .86em; letter-spacing: .04em; }
.fs-ui .xw-info .d { display: block; color: ${C.wu}; }
.fs-ui .xw-info .e { display: block; color: ${C.hupo}; font-size: .86em; font-variant-numeric: tabular-nums; }
.fs-ui .xw-info .s { display: block; color: ${C.cang}; font-size: .86em; }
.fs-ui .xw-info .s.can { color: ${C.zhu}; }
.fs-ui.compact .xw-head { margin-bottom: 0; gap: .9em; }
.fs-ui.compact .xw-info { margin-top: .4em; min-height: 4em; }
.fs-ui.compact .xw-info .nm { font-size: 1.4em; }
.fs-ui .xw-body.side .xw-info { grid-template-columns: 1fr; margin: .5em 0 .2em; min-height: 7.6em; }
/* 竖屏：说明栏的高固定（最长的一条五行：境界、意象两行、加成、能不能点），换选中时图谱不跳 */
.fs-ui .xw-body:not(.side) .xw-info { min-height: 8.6em; }
.fs-ui .xw-body.side .xw-info .nm { margin-bottom: .1em; }
.fs-ui .xw-body.side .xw-head { flex-wrap: wrap; row-gap: 0; }
.fs-ui .xw-body.side .bar { flex-wrap: nowrap; }
.fs-ui.compact .xw-body.side .bar { gap: .4em; }
.fs-ui .xw-body.side .xw-how { margin-bottom: 0; }
`;

export interface XiuweiOptions {
  layer: Layer;
  sfx: Sfx;
}

/** 一段经络：from → to（两头都点亮了就是浓墨）。base 淡墨的笔形；ink 浓墨的笔形，被遮罩 mask 里那道描边 mk 一点点洇出来。 */
interface Vein {
  from: XiuweiId;
  to: XiuweiId;
  base: SVGPathElement;
  ink: SVGPathElement;
  mk: SVGPathElement;
  mask: SVGMaskElement;
  /** 两层二选一之间交叉的那两笔。 */
  cross: boolean;
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls = '') => {
  const e = document.createElementNS(SVG, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
};
const cls = (st: NodeState) => `s-${st}`;

let opened = 0;

/** 按字符串定的随机数（同一个 id 每次打开都一样，不是每帧抖）：FNV-1a 散列做种子，mulberry32 往下走。返回 0..1。 */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 打开修为面板；关上时 resolve。 */
export async function openXiuwei(o: XiuweiOptions): Promise<void> {
  injectCss('fs-xiuwei', CSS);
  const { layer, sfx } = o;
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = 'rgba(26,21,32,.32)';
  layer.ui.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  const panel = scrollPanel(40);
  layer.ui.appendChild(panel.el);
  const p = panel.paper;
  const h2 = document.createElement('h2');
  h2.textContent = '修为';
  const head = document.createElement('div');
  head.className = 'xw-head';
  const how = document.createElement('div');
  how.className = 'xw-how';
  how.textContent = '道行得自每局破阵斩敌，劫数愈高所得愈丰';
  const body = document.createElement('div');
  body.className = 'xw-body';
  const tree = document.createElement('div');
  tree.className = 'xw-tree';
  const side = document.createElement('div');
  side.className = 'xw-side';
  const info = document.createElement('div');
  info.className = 'xw-info';
  const bar = document.createElement('div');
  bar.className = 'bar';
  const bw = inkWidth('点亮', '重置', '返回');
  const light = inkButton('点亮', { primary: true, w: bw });
  const reset = inkButton('重置', { w: bw });
  const back = inkButton('返回', { w: bw });
  bar.append(light, reset, back);
  body.append(tree, side);
  p.append(body);

  // ---------- 图谱：经络、点、境界名、路名 ----------
  const svg = svgEl('svg');
  const defs = svgEl('defs');
  const gVeins = svgEl('g');
  const gInk = svgEl('g');
  svg.append(defs, gVeins, gInk);
  tree.appendChild(svg);
  const veins: Vein[] = [];
  let maskN = 0;
  const uid = ++opened; // 遮罩的 id 在页面里不重名（关上再开是新的一套）
  for (const n of XIUWEI_NODES)
    for (const q of n.req) {
      const base = svgEl('path', 'vein');
      const ink = svgEl('path', 'ink');
      const mask = svgEl('mask');
      const mk = svgEl('path', 'mk');
      mask.id = `xw-m-${uid}-${maskN++}`;
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.appendChild(mk);
      defs.appendChild(mask);
      mk.setAttribute('pathLength', '1');
      ink.setAttribute('mask', `url(#${mask.id})`);
      gVeins.appendChild(base);
      gInk.appendChild(ink);
      // 交叉：前后两层都是二选一，而且一个在左一个在右
      const fromN = XIUWEI[q];
      const pairSide = (m: XiuweiNode) => (m.rival ? (XIUWEI_NODES.indexOf(m) < XIUWEI_NODES.indexOf(XIUWEI[m.rival]) ? 0 : 1) : -1);
      const cross = pairSide(fromN) >= 0 && pairSide(n) >= 0 && pairSide(fromN) !== pairSide(n);
      veins.push({ from: q, to: n.id, base, ink, mk, mask, cross });
    }
  const nodes = new Map<XiuweiId, HTMLButtonElement>();
  for (const n of XIUWEI_NODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `xw-node${n.big || n.path === 'root' ? ' orb' : ''}`;
    b.dataset.id = n.id;
    b.innerHTML = '<b></b>';
    b.setAttribute('aria-label', `${n.name}：${n.desc}（${n.effect}）`);
    b.addEventListener('click', () => {
      if (sel === n.id) tryLight();
      else select(n.id, true);
    });
    // 鼠标移上去只在说明栏里预览（不换选中）：移去按「点亮」的路上掠过别的印，点亮的还是选中的那一方
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || peek === n.id) return;
      peek = n.id;
      render();
    });
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || peek !== n.id) return;
      peek = null;
      render();
    });
    nodes.set(n.id, b);
    tree.appendChild(b);
  }
  const tag = document.createElement('span');
  tag.className = 'xw-tag';
  tree.appendChild(tag);
  /** 选中那一个旁边的名字：放在点的右边，靠右边出了图谱就放左边。 */
  const placeTag = () => {
    const q = pos.get(sel);
    tag.textContent = XIUWEI[sel].name;
    if (!q) return;
    const w = tag.offsetWidth;
    const h = tag.offsetHeight;
    const gap = q.r + 0.3 * (parseFloat(getComputedStyle(tree).fontSize) || 14);
    // 依次试右、左、下、上，取第一个不压着别的点、不出图谱的（都压着就放右边）
    const tries = [
      [q.x + gap, q.y],
      [q.x - gap - w, q.y],
      [q.x - w / 2, q.y + gap + h / 2],
      [q.x - w / 2, q.y - gap - h / 2],
    ];
    // 路名、境界名占的地方也别压
    const tr = tree.getBoundingClientRect();
    const labs = [...pathLabels.values(), ...realmLabels.flat()].map((l) => {
      const r = l.getBoundingClientRect();
      return { x0: r.left - tr.left, x1: r.right - tr.left, y0: r.top - tr.top, y1: r.bottom - tr.top };
    });
    const clear = ([lx, ly]: number[]) =>
      lx >= 0 && lx + w <= tree.offsetWidth && ly - h / 2 >= 0 && ly + h / 2 <= tree.offsetHeight &&
      [...pos.entries()].every(([id, o]) => id === sel || o.x + o.r < lx - 2 || o.x - o.r > lx + w + 2 || o.y + o.r < ly - h / 2 - 2 || o.y - o.r > ly + h / 2 + 2) &&
      labs.every((r) => r.x1 < lx - 2 || r.x0 > lx + w + 2 || r.y1 < ly - h / 2 - 2 || r.y0 > ly + h / 2 + 2);
    const [lx, ly] = tries.find(clear) ?? tries[0];
    tag.style.left = `${Math.round(lx)}px`;
    tag.style.top = `${Math.round(ly)}px`;
  };
  const realmLabels: HTMLElement[][] = [[]];
  for (let r = 1; r <= 5; r++) {
    const pair = [0, 1].map(() => {
      const l = document.createElement('span');
      l.className = 'rl';
      l.textContent = REALM_SHORT[r];
      tree.appendChild(l);
      return l;
    });
    realmLabels.push(pair);
  }
  const pathLabels = new Map<string, HTMLElement>();
  for (const path of PATHS) {
    const l = document.createElement('span');
    l.className = 'pl';
    l.textContent = PATH_NAME[path];
    pathLabels.set(path, l);
    tree.appendChild(l);
  }

  // ---------- 状态 ----------
  let x = loadXiuwei();
  let sel: XiuweiId = XIUWEI_NODES.find((n) => nodeState(x.nodes, n.id, freeDao(x)) === 'ok')?.id ?? 'wendao';
  let peek: XiuweiId | null = null; // 鼠标停着的那一方（说明栏先给它看）
  let armed = false; // 「重置」按了一下：再按一下才真的重置
  let armT = 0;
  // 刚点亮的那一个点：先画经络、再落点；放完之前别的重画（悬停换了选中）不把它掐掉
  let stamped: { id: XiuweiId; until: number } | null = null;
  /** 每个节点的中心、点击范围的边长 s、看得见的那个点（连同细纹）的半径 r。 */
  const pos = new Map<XiuweiId, { x: number; y: number; s: number; r: number }>();

  const render = (stamp?: XiuweiId) => {
    const free = freeDao(x);
    if (stamp) stamped = { id: stamp, until: performance.now() + 1100 };
    const anim = stamped && performance.now() < stamped.until ? stamped.id : undefined;
    head.innerHTML = `<span>道行 余<b>${free}</b></span><span>共得 ${x.dao}</span><span>点亮 ${x.nodes.length} / ${XIUWEI_FULL.length}</span>`;
    for (const n of XIUWEI_NODES) {
      const b = nodes.get(n.id)!;
      const st = nodeState(x.nodes, n.id, free);
      // 前置没点、境界不够、道行不够都是「暗」；道行不够但够得着的字深一档
      const look: NodeState = st === 'locked' || st === 'gated' ? 'locked' : st;
      b.className = `xw-node${n.big || n.path === 'root' ? ' orb' : ''} ${cls(look)}${n.id === sel ? ' sel' : n.id === peek ? ' peek' : ''}${n.id === anim ? ' stamp' : ''}`;
    }
    for (const v of veins) {
      const on = x.nodes.includes(v.from) && x.nodes.includes(v.to);
      // 一对二选一接下一对二选一（身：太乙 → 大罗）：交叉的两笔平时不画（不画成一个叉），选成交叉时只画走过的那一笔
      v.base.style.display = v.cross && !on ? 'none' : '';
      const was = v.mk.classList.contains('on');
      v.mk.classList.toggle('draw', on && !was && v.to === anim);
      v.mk.classList.toggle('on', on);
    }
    for (let r = 1; r <= 5; r++) {
      const g = gateOf(x.nodes, r);
      const open = x.nodes.includes('wendao') && g.have >= g.need;
      for (const l of realmLabels[r]) l.classList.toggle('in', open);
    }
    for (const path of PATHS) pathLabels.get(path)!.classList.toggle('on', XIUWEI_NODES.some((n) => n.path === path && n.realm === 5 && x.nodes.includes(n.id)));
    // 说明栏：名字、境界与路线、一句意象、一行加成、能不能点
    const shown = peek ?? sel;
    const n = XIUWEI[shown];
    const st = nodeState(x.nodes, shown, free);
    const where = n.path === 'root' ? '树根 · 修行之始' : `${REALMS[n.realm]} · ${PATH_NAME[n.path]}${n.big ? ' · 心法' : ''}${n.rival ? ' · 二择其一' : ''}`;
    const nm = (id: XiuweiId) => `「${XIUWEI[id].name}」`;
    let state: string;
    if (st === 'lit') state = '<span class="s">已点亮</span>';
    else if (st === 'ok') state = `<span class="s can">点亮需道行 ${n.cost}（余 ${free}）</span>`;
    else if (st === 'poor') state = `<span class="s">需道行 ${n.cost}，尚缺 ${n.cost - free}</span>`;
    else if (st === 'sealed') state = `<span class="s">已择${nm(n.rival!)}，此节封存；重置方可改选</span>`;
    else if (st === 'locked') state = `<span class="s">须先点亮${n.req.map(nm).join('或')}</span>`;
    else {
      const g = gateOf(x.nodes, n.realm);
      state = `<span class="s">入${REALMS[n.realm]}，须先点亮${REALMS[n.realm - 1]}${CN[g.need]}节（已有${g.have ? CN[g.have] : '零'}节）</span>`;
    }
    info.innerHTML = `<span class="nm">${n.name}</span><span><span class="w">${where}</span><span class="d">${n.desc}</span><span class="e">${n.effect}</span>${state}</span>`;
    info.title = n.path === 'root' ? '' : PATH_DESC[n.path];
    light.setAttribute('aria-disabled', String(nodeState(x.nodes, sel, free) !== 'ok'));
    (reset.querySelector('.lb') as HTMLElement).textContent = armed ? '确定' : '重置';
    reset.setAttribute('aria-disabled', String(!x.nodes.length));
    placeTag();
    // 说明换了一条更长的（竖屏里多折一行），纸放不下了：按现在的高重排一次（图谱收一点），按钮不被挤出纸外
    if (laidOut && p.scrollHeight > p.clientHeight + 1) layout(layer.fit);
  };

  const select = (id: XiuweiId, sound: boolean) => {
    if (id === sel) return;
    if (sound) sfx.play('ui.click');
    sel = id;
    peek = null;
    disarm();
    render();
  };
  const tryLight = () => {
    if (!lightNode(sel)) {
      sfx.play('ui.denied');
      info.querySelector('.s')?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-.3em)' }, { transform: 'translateX(.3em)' }, { transform: 'translateX(0)' }], { duration: 360, easing: 'ease-out' });
      return;
    }
    sfx.play('xiuwei.light'); // 盖印：木印按在纸上、一声清的手铃（docs/audio.md「修为页」）
    x = loadXiuwei();
    disarm();
    render(sel);
  };
  const disarm = () => {
    armed = false;
    clearTimeout(armT);
  };
  const tryReset = () => {
    if (!x.nodes.length) return sfx.play('ui.denied');
    if (!armed) {
      armed = true;
      sfx.play('ui.click');
      render();
      armT = window.setTimeout(() => {
        armed = false;
        if (!closing) render();
      }, 3000);
      return;
    }
    disarm();
    resetXiuwei();
    sfx.play('xiuwei.reset');
    x = loadXiuwei();
    sel = 'wendao';
    render();
  };
  light.addEventListener('click', () => tryLight());
  reset.addEventListener('click', () => tryReset());

  // ---------- 排版 ----------
  // 自下而上的一棵树：树根在下方正中，五条路线是五道往上长的经络（从左到右 身、灵、器、财、心），五层境界是五道微微拱起的弧。
  // 二选一的两方在那一层左右岔开；排列让同一层里相邻两道经络不同时岔开（二选一在：天仙 器；金仙 灵、心；太乙 身、财；大罗 身、器、心），
  // 所以经络的间距只要放得下「一对加一方」。
  const ORDER = ['shen', 'ling', 'qi', 'cai', 'xin'] as const;
  let chrome = 0; // 纸上图谱以外的东西（标题、说明、按钮、内边距）占的高：量出来的
  const layout = (f: UiFit, pass = 0) => {
    const em = f.base;
    const compact = isCompact(f);
    const sideMode = !isTall(f); // 横着的窗口（电脑、手机横屏）：说明、按钮放右边一栏，图谱占满纸的高
    const snap = (v: number) => snapPx(v, f);
    body.classList.toggle('side', sideMode);
    // 侧栏模式：标题、道行、说明、按钮都在右边一栏；否则在图谱上下（竖屏不写「道行得自……」那一行，省出高度给图谱）
    if (sideMode) {
      side.replaceChildren(h2, head, how, info, bar);
      body.replaceChildren(tree, side);
      p.replaceChildren(body);
    } else {
      side.replaceChildren(info, bar);
      body.replaceChildren(tree, side);
      p.replaceChildren(h2, head, body);
    }
    how.style.display = compact ? 'none' : '';
    const padX = (compact ? 1.4 : 1.6) * em;
    const paperMax = (Math.floor((f.w - f.base) / f.p) - 12) * f.p;
    // 竖屏：图谱往纸的内边距里伸进去一些（纸边留半个字），窄屏上点才放得下
    const bleed = sideMode ? 0 : Math.max(0, padX - 0.6 * em);
    tree.style.margin = bleed ? `0 ${-bleed}px` : '';
    const innerMax = paperMax - padX * 2 + bleed * 2;
    const maxH = Math.max(f.base * 8, f.h - f.safe.top - f.safe.bottom - f.p * 6);
    const sideEm = compact ? 20 : 21.5;
    body.style.setProperty('--sw', `${sideEm}em`);
    const sideW = (sideEm + 1.2) * em;
    if (pass === 0) chrome = sideMode ? f.p * 10 + 1.7 * em : f.p * 10 + 2.4 * em + 2.9 * em + 1.6 * em + 5.1 * em + f.tap + 0.4 * em;
    const BW = Math.floor(Math.min(sideMode ? innerMax - sideW : innerMax, 44 * em));
    const BH = Math.floor(Math.max(14 * em, maxH - chrome));
    // 点的格子边长：电脑上约 2.7 个字；手机上（触屏、或窗口一边不到 600）不小于 32（好按）。放不下就一格一格收
    const sMin = f.coarse || Math.min(f.w, f.h) < 600 ? 32 : 28;
    const g = Math.max(3.5, (compact ? 0.28 : 0.35) * em);
    // 先不错落、境界名横写；不行竖写；都不行再让大罗一层的单节往上错开半层（窄的竖屏）
    let G: Geo | null = null;
    // （横写的境界名好看：为它把格子收小几格也值得，收太多才改竖写）
    const S0 = Math.ceil(Math.max(sMin, (compact ? 2.5 : 2.8) * em));
    search: for (const stagger of [false, true])
      for (const [vl, floor] of [
        [false, Math.max(sMin, S0 - 6)],
        [true, sMin],
      ] as const)
        for (let S = S0; S >= floor; S--) {
          G = fit(BW, BH, S, g, em, vl, stagger);
          if (G.ok) break search;
        }
    const W0 = G!.w;
    const H0 = G!.h;
    tree.style.width = `${W0}px`;
    tree.style.height = `${H0}px`;
    svg.setAttribute('width', String(W0));
    svg.setAttribute('height', String(H0));
    svg.setAttribute('viewBox', `0 0 ${W0} ${H0}`);
    pos.clear();
    for (const n of XIUWEI_NODES) {
      const s = snap(G!.size(n));
      // 随手一点：位置在格子里略微错开（问道不动），形状略不规则、转一点角度；都按 id 定的种子，每次打开一样
      const rnd = seeded(n.id);
      const j = n.path === 'root' ? 0 : G!.S * 0.07;
      const q0 = G!.at.get(n.id)!;
      const q = { x: q0.x + (rnd() * 2 - 1) * j, y: q0.y + (rnd() * 2 - 1) * j };
      // 看得见的点：小节点约三成半格宽；心法、问道大一号，外面一圈很细的淡墨环
      const ring = n.big || n.path === 'root';
      const d = snap(Math.max(9, G!.S * (ring ? 0.42 : 0.34) * (0.92 + rnd() * 0.16)));
      pos.set(n.id, { x: q.x, y: q.y, s, r: d / 2 + (ring ? f.p * 3 : 0) });
      const b = nodes.get(n.id)!;
      Object.assign(b.style, { left: `${snap(q.x - s / 2)}px`, top: `${snap(q.y - s / 2)}px`, width: `${s}px`, height: `${s}px` });
      b.style.setProperty('--d', `${d}px`);
      const pc = () => `${Math.round(42 + rnd() * 16)}%`;
      b.style.setProperty('--br', `${pc()} ${pc()} ${pc()} ${pc()} / ${pc()} ${pc()} ${pc()} ${pc()}`);
      b.style.setProperty('--rot', `${Math.round(rnd() * 360)}deg`);
    }
    // 经络：两个点之间一笔柔和的曲线（像毛笔顺势一带）。弯的方向按所在的路线、境界错开，弯多少、粗细、抖动按这一笔的种子随一点；
    // 二选一岔开、合回、从问道扇出去的斜笔顺着横向那一侧鼓出去。笔形：起笔重、收笔轻，中间略有抖动
    const W = Math.max(1, f.p * 0.62); // 主笔的宽（约 1–1.5 像素）
    const colOf = (id: XiuweiId) => Math.max(0, ORDER.indexOf(XIUWEI[id].path as (typeof ORDER)[number]));
    const fmt = (v: number) => v.toFixed(1);
    for (const v of veins) {
      const a = pos.get(v.from)!;
      const b = pos.get(v.to)!;
      const rnd = seeded(`${v.from}>${v.to}`);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nTo = XIUWEI[v.to];
      const slant = Math.abs(dx) > len * 0.15;
      const side = slant ? Math.sign(dx) * (nTo.realm === 1 ? -1 : 1) : (colOf(v.to) + nTo.realm) % 2 ? 1 : -1;
      const bend = len * (slant ? 0.1 : 0.07) * side * (0.55 + rnd() * 0.9);
      const px = -uy; // 垂直于连线
      const py = ux;
      const gap = f.p * 2;
      const x0 = a.x + ux * (a.r + gap);
      const y0 = a.y + uy * (a.r + gap);
      const x1 = b.x - ux * (b.r + gap);
      const y1 = b.y - uy * (b.r + gap);
      const k2 = 0.6 + rnd() * 0.4;
      const c1 = { x: x0 + (x1 - x0) / 3 + px * bend, y: y0 + (y1 - y0) / 3 + py * bend };
      const c2 = { x: x0 + ((x1 - x0) * 2) / 3 + px * bend * k2, y: y0 + ((y1 - y0) * 2) / 3 + py * bend * k2 };
      const at = (t: number) => {
        const m = 1 - t;
        return {
          x: m * m * m * x0 + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * x1,
          y: m * m * m * y0 + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * y1,
        };
      };
      // 中线上取 18 个点，各自往法向抖一点（两道不同频的正弦叠起来，相位按种子）；宽从起笔约 1.3 倍收到约 0.45 倍
      const N = 18;
      const ph1 = rnd() * 6.28;
      const ph2 = rnd() * 6.28;
      const amp = Math.min(1.2, len * 0.012) * (0.5 + rnd());
      const L: { x: number; y: number }[] = [];
      const R: { x: number; y: number }[] = [];
      const mid: { x: number; y: number }[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p0 = at(Math.max(0, t - 0.01));
        const p1 = at(Math.min(1, t + 0.01));
        const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        const nx = -(p1.y - p0.y) / tl;
        const ny = (p1.x - p0.x) / tl;
        const c = at(t);
        const wob = (Math.sin(t * 7.1 + ph1) * 0.6 + Math.sin(t * 13.3 + ph2) * 0.4) * amp * Math.sin(Math.PI * t);
        const cx = c.x + nx * wob;
        const cy = c.y + ny * wob;
        mid.push({ x: cx, y: cy });
        const w = W * (1.3 - 0.85 * t) * (0.88 + 0.24 * Math.sin(t * 9 + ph2)) * (t < 0.08 ? 1.12 : 1);
        L.push({ x: cx + (nx * w) / 2, y: cy + (ny * w) / 2 });
        R.push({ x: cx - (nx * w) / 2, y: cy - (ny * w) / 2 });
      }
      const outline = `M${L.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join('L')}L${R.reverse().map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join('L')}Z`;
      v.base.setAttribute('d', outline);
      v.ink.setAttribute('d', outline);
      // 遮罩里那道描边沿中线走，宽到盖住整笔
      v.mk.setAttribute('d', `M${mid.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join('L')}`);
      v.mk.setAttribute('stroke-width', String(W * 6));
      v.mask.setAttribute('x', '0');
      v.mask.setAttribute('y', '0');
      v.mask.setAttribute('width', String(W0));
      v.mask.setAttribute('height', String(H0));
    }
    // 境界名写在左右两侧，和那一层的点对齐（窄的竖屏上竖着写）；不画横的弧（用户 2026-11-12：「不需要横的虚线」）
    tree.classList.toggle('vlab', G!.vlab);
    for (let r = 1; r <= 5; r++) {
      const k = G!.rows[r];
      const [l0, l1] = realmLabels[r];
      l0.style.left = `${snap(k.lx0)}px`;
      l1.style.left = `${snap(k.lx1)}px`;
      for (const l of [l0, l1]) l.style.top = `${snap(k.y + k.b)}px`;
    }
    for (const path of PATHS) {
      const l = pathLabels.get(path)!;
      const q = G!.label.get(path)!;
      l.style.left = `${snap(q.x)}px`;
      l.style.top = `${snap(q.y)}px`;
    }
    const want = sideMode ? (W0 + sideW) / em + 2.8 : Math.max(compact ? 27 : 30, (W0 - bleed * 2) / em + 3.2);
    panel.setWidth(want);
    // 量一下图谱以外占了多高，不对就再排一次（只再排一次）
    // 侧栏模式里图谱和右栏并排，纸的高只看图谱：不用量
    if (pass === 0 && !sideMode) {
      const used = panel.el.offsetHeight - p.clientHeight + p.scrollHeight - tree.offsetHeight;
      if (Math.abs(used - chrome) > 2) {
        chrome = used;
        return layout(f, 1);
      }
    }
    placeTag();
    centerIn(panel.el, f);
  };

  interface Row {
    /** 这一层在正中那道经络上的高（弧顶）。 */
    y: number;
    /** 弧拱起多少（两头比正中低 b）。 */
    b: number;
    x0: number;
    x1: number;
    /** 两头境界名的中心。 */
    lx0: number;
    lx1: number;
  }
  interface Geo {
    ok: boolean;
    w: number;
    h: number;
    cx: number;
    at: Map<XiuweiId, { x: number; y: number }>;
    label: Map<string, { x: number; y: number }>;
    rows: Row[];
    size: (n: XiuweiNode) => number;
    vlab: boolean;
    S: number;
  }

  /**
   * 按格子的边长 S、缝 g 排出所有点的中心，框是 BW × BH（放不下 ok = false）。树根在下方正中；五道经络是五列（间距 D），
   * 第 r 层在离根往上第 r 行（行距 R，最外一行宽一些），每一行顺着一道拱弧：离正中越远越低 b·u²。
   * 二选一的两方在那一层沿左右岔开半个「格宽 + 缝」；相邻两列不会在同一层都岔开（ORDER 排好的），D 放得下「一对加一方」就谁也不碰谁。
   */
  function fit(BW: number, BH: number, S: number, g: number, em: number, narrow: boolean, stagger: boolean): Geo {
    const SB = Math.round(S * (S >= 40 ? 1.3 : 1.16));
    const SR = Math.round(S * 1.1);
    const size = (n: XiuweiNode) => (n.big ? SB : n.path === 'root' ? SR : S);
    const vlab = narrow;
    const labW = vlab ? 0.95 * em : 1.75 * em; // 境界名（两个字，.78em）占的宽
    // 列距：放得下「一对加一方」。大罗一层错落时（那一层的单节往上错开），那一层只要放得下相邻两对
    const Dmin = stagger ? Math.max(1.5 * S + 1.25 * g, SB + g) : 1.5 * SB + 1.25 * g;
    const side = SB + g / 2 + g + labW + g; // 最外一列中心到框边：岔开的心法 + 缝 + 境界名
    const D = Math.min(Dmin * 1.5, (BW - 2 * side) / 4);
    const w = Math.ceil(4 * D + 2 * side);
    const cx = w / 2;
    const raise = stagger ? SB + g * 0.5 : 0; // 大罗一层的单节往上错开多少
    const top = 1.65 * em + SB / 2 + raise; // 路名 + 半方心法
    const rootGap = Math.max(S + g + 0.6 * em, S / 2 + SR / 2 + 1.2 * em); // 根到第一层：扇开的五道线要有个长度
    const foot = SR / 2 + 0.3 * em;
    const Rmin = S + g + 0.5 * em;
    const extra5 = (SB - S) / 2;
    // 行距：竖着放得下就放开一点（最多约两格），放不下 ok = false
    const R = Math.min(2.05 * S, (BH - top - foot - rootGap - extra5) / 4);
    const bow = 0; // 原来每层是一道拱弧；不画弧之后各层排平，左右两侧的境界名和那一层的点对齐
    const h = Math.ceil(top + 4 * R + extra5 + rootGap + foot);
    const ok = D >= Dmin && R >= Rmin && h <= BH;
    const yRoot = h - foot;
    const hw = 2 * D + SB + g * 1.5; // 弧的半宽：过了最外一列岔开的心法再留一条缝
    const rows: Row[] = [{ y: yRoot, b: 0, x0: 0, x1: 0, lx0: 0, lx1: 0 }];
    for (let r = 1; r <= 5; r++) {
      const y = yRoot - rootGap - (r - 1) * R - (r === 5 ? extra5 : 0) - bow;
      rows.push({ y, b: bow, x0: cx - hw, x1: cx + hw, lx0: cx - hw - g - labW / 2, lx1: cx + hw + g + labW / 2 });
    }
    const yAt = (r: number, x: number) => rows[r].y + rows[r].b * ((x - cx) / hw) ** 2;
    const at = new Map<XiuweiId, { x: number; y: number }>();
    const label = new Map<string, { x: number; y: number }>();
    at.set('wendao', { x: cx, y: yRoot });
    ORDER.forEach((path, i) => {
      const colX = cx + (i - 2) * D;
      for (let r = 1; r <= 5; r++) {
        const here = XIUWEI_NODES.filter((n) => n.path === path && n.realm === r);
        const s = r === 5 ? SB : S;
        here.forEach((n, j) => {
          const x = colX + (here.length > 1 ? (j === 0 ? -1 : 1) * ((s + g) / 2) : 0); // 先写的一边在左
          at.set(n.id, { x, y: yAt(r, x) - (r === 5 && here.length === 1 ? raise : 0) });
        });
      }
      const lone = XIUWEI_NODES.filter((n) => n.path === path && n.realm === 5).length === 1;
      label.set(path, { x: colX, y: yAt(5, colX) - SB / 2 - 0.85 * em - (lone ? raise : 0) });
    });
    // 倒过来（用户 2026-11-12：「应该倒过来，问道在最上方」）：上面按树根在下排好，这里整张上下翻过来——问道在最上方，地仙在上、大罗在最下
    for (const q of at.values()) q.y = h - q.y;
    for (const q of label.values()) q.y = h - q.y;
    for (const r of rows) {
      r.y = h - r.y;
      r.b = -r.b;
    }
    return { ok, w, h, cx, at, label, rows, size, vlab, S };
  }

  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    layout(f);
  };
  let laidOut = false;
  render();
  layout(layer.fit);
  laidOut = true;
  // 字体下完之后字的高可能变了：再排一次
  void document.fonts?.ready.then(() => !closing && layout(layer.fit));

  // ---------- 关上 ----------
  let closing = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const close = async () => {
    if (closing) return;
    closing = true;
    disarm();
    sfx.play('ui.click');
    popKeys();
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await panel.close();
    veil.remove();
    layer.onFit = refit;
    finish();
  };
  back.addEventListener('click', () => void close());

  // 方向键：朝那个方向找最近的一个点（偏离方向的打折算远）；往下没有点了就到按钮上
  const toward = (dx: number, dy: number): XiuweiNode | null => {
    const a = pos.get(sel)!;
    let best: XiuweiNode | null = null;
    let bd = Infinity;
    for (const n of XIUWEI_NODES) {
      if (n.id === sel) continue;
      const b = pos.get(n.id)!;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const along = vx * dx + vy * dy;
      if (along <= 2) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const d = along + across * 2.2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const popKeys = pushKeys((e) => {
    if (closing) return 'consume';
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      void close();
      return 'consume';
    }
    const a = document.activeElement;
    const onNode = !a || a === document.body || [...nodes.values()].includes(a as HTMLButtonElement);
    const go = (dx: number, dy: number) => {
      const n = toward(dx, dy);
      if (n) {
        select(n.id, true);
        nodes.get(n.id)!.focus({ preventScroll: true });
      } else if (dy > 0) light.focus({ preventScroll: true });
      return 'consume' as const;
    };
    if (onNode) {
      if (k === 'arrowleft' || k === 'a') return go(-1, 0);
      if (k === 'arrowright' || k === 'd') return go(1, 0);
      if (k === 'arrowup' || k === 'w') return go(0, -1);
      if (k === 'arrowdown' || k === 's') return go(0, 1);
      if (k === 'enter' || k === ' ' || k === 'j') return (tryLight(), 'consume');
    } else if ((k === 'arrowup' || k === 'w') && [light, reset, back].includes(a as HTMLButtonElement)) {
      nodes.get(sel)!.focus({ preventScroll: true });
      return 'consume';
    }
    navKeys(e, [light, reset, back], 'h');
    return 'consume';
  });
  await panel.open();
  await wait(20);
  nodes.get(sel)!.focus({ preventScroll: true });
  await done;
}
