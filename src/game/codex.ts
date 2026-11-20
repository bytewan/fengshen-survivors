// 图鉴（DOM，卷轴面板）：标题页的「图鉴」→ 这里。六个页签：角色、法宝、道具（灵物 / 丹药 / 符箓）、功法、敌人、首领。
// 成就（2026-11-12 用户：「成就得单独一列，不应该在图鉴里面」）：标题页另有一颗「成就」，openAchievements 打开的是同一副卷轴、
// 只有成就这一页（不出页签行），内容和样式照旧；图鉴里不再有成就页签。
// 见过才点亮（记录在 profile.ts 的 fs.v1.codex，记录点在 codex-track.ts）：法宝、道具在万宝阁里出现过或拿到过；敌人、首领打过照面；
// 角色解锁了就点亮（现在的角色一开始就都能用；要解锁的登记在 codex-notes.ts 的 HERO_LOCK）。没见过的是剪影 +「？？？」，不剧透名字。
// 每一条：像素图（游戏里的精灵 / 图标，整数倍放大，codex-art.ts）、名字、五行、说明（法宝四个品阶各一句、神品是两个器灵二选一；
// 敌人写招式和怎么躲；首领写三个阶段）、首次遇见于第几章、拿到 / 斩敌 / 出战 / 击败的次数。
// 条目都从现成的表里列（catalog 的 HEROES / WEAPONS / RELICS / ELIXIRS / CHARMS、heroes 的 HERO_IDS、enemies 的 ENEMY_NAME、
// 章节表的首领），别的分支加了角色、法宝、道具、敌人、首领，这里自动就有；只有敌人、首领的「招式和怎么躲」在 codex-notes.ts 里另写。
//
// 版面：卷轴上面是页签（五个同宽、一条轴；手机上和标题「图鉴」并成一行），左边是格子（能滑动），右边是选中那一条（能滑动），
// 下面一排：这一页见过几条、「返回」、整本见过几条。格子是一方方小纸笺（不画光圈），选中的描朱砂边；换页签、换条目都是淡入。
// 键盘：方向键在格子间走（最上一排再往上到页签，页签上左右换页；最下一排再往下到「返回」），Q / E（或 [ ]、PageUp / PageDown）换页签，Esc 返回。
import type { Sfx } from '../audio/sfx.ts';
import type { Grid } from '../art/pixel.ts';
import { makeInkStroke } from '../art/title.ts';
import { MYSTERY } from '../art/sprites/hidden.ts';
import { CHAPTERS, CHAPTER_NAME, CHARMS, ELEMENT_COLOR, ELIXIRS, HEROES, HIDDEN, PET_BRANCH, RELICS, TIER_COLOR, TIER_NAME, WEAPONS } from '../sim/catalog.ts';
import { HERO_IDS, skillInfo } from '../sim/heroes/index.ts';
import { ENEMY_NAME } from '../sim/enemies.ts';
import { ENEMIES } from '../sim/config.ts';
import { chapterDef } from '../sim/chapters.ts';
import { PET_KINDS } from '../sim/pet.ts';
import { ELEMENTS, ELEMENT_NAME, type CharmId, type Element, type ElixirId, type EnemyKindName, type HeroId, type RelicId, type WeaponKind } from '../sim/types.ts';
import { HERO_VIEWS } from './hero-views.ts';
import { FONT_TITLE } from './fonts.ts';
import { codexEntry, isUnlocked, loadAchieved, loadCodex, type Achieved, type Codex, type CodexCat } from './profile.ts';
import { ACHIEVEMENTS, ACH_GROUPS, lockLine, lockOf, reconcile, rewardText, type Reward } from './achievements.ts';
import { achSeal } from './achieve-art.ts';
import { AFFIX_NOTES, BOSS_NOTES, ECHO_NOTES, ELITE_NOTES, FOE_NOTES, HERO_LOCK, HERO_LOCK_HINT, TECH_NOTES } from './codex-notes.ts';
import { TECHNIQUES, TECH_IDS, type TechKind } from '../sim/techniques.ts';
import { TECH_ICONS } from '../art/sprites/icons.ts';
import { isEchoFamily, type BossId } from '../sim/bosspool.ts';
import { bossTitleOf } from './pool-lines.ts';
import { echoPortrait } from './echo-fx.ts';
import { affixArt, bossArt, charmArt, eliteArt, elixirArt, foeArt, heroArt, relicArt, silhouetteOf, tenArt, weaponArt } from './codex-art.ts';
import { TEN_NOTES, TEN_ORDER } from './ch2/ten-notes.ts';
import { AFFIXES, AFFIX_INFO, ELITE_INFO } from '../sim/elites/index.ts';
import type { EliteKind } from '../sim/elites/types.ts';
import { gridUrl, stripUrl } from './pixel-url.ts';
import { C, P, bitmapUrl, centerIn, inkButton, injectCss, isCompact, isTall, pushKeys, scrollPanel, snapPx, wait, type Layer, type UiFit } from './front-ui.ts';

// ---------- 条目 ----------

type TabId = 'hero' | 'weapon' | 'item' | 'tech' | 'foe' | 'boss' | 'ach';

interface Rec {
  ch: number;
  n: number;
  tier: number;
}

interface Entry {
  cat: CodexCat;
  id: string;
  name: string;
  /** 见过 / 解锁了。 */
  lit: boolean;
  rec: Rec | null;
  /** 像素图（裁过的几帧；格子里用第一帧，说明里动起来）。 */
  art: Grid[];
  /** 格子角上的五行小方印（有主五行的才有）。 */
  el?: Element;
  /** 小标题（道具分灵物 / 丹药 / 符箓，法宝分专属 / 公共）：和上一条不同就另起一段。 */
  group?: string;
  /** 说明（点亮了的）。 */
  body: () => string;
  /** 没见过时的一句话。 */
  hint: string;
  /** 还没靠成就解锁（法宝、道具；achievements.ts）：格子角上一个「锁」，说明里写解锁条件。 */
  lock?: string;
  /** 没点亮时也要写的说明（成就：没达成的也列出条件和奖励）；没有就是「？？？」+ hint。 */
  dim?: () => string;
  /** 说明栏的画像（不给就和格子一样）。 */
  port?: Grid[];
  /** 没点亮时的样子自己画好了（成就的墨拓）：格子里不再压成剪影。 */
  ownDim?: boolean;
}

/**
 * 页签。tile：这一页格子的边长；port：说明栏里画像那一块的高（都是 em，[电脑, 手机]）。
 * 角色、首领条目少、画大，用大格子；法宝、道具是 16 格见方的图标，画像矮一些，给说明多留几行。
 */
const TABS: { id: TabId; name: string; tile: [number, number]; port: [number, number] }[] = [
  { id: 'hero', name: '角色', tile: [4.6, 3.6], port: [5.8, 4.4] },
  { id: 'weapon', name: '法宝', tile: [3.3, 2.9], port: [4.2, 3.4] },
  { id: 'item', name: '道具', tile: [3.3, 2.9], port: [4.2, 3.4] },
  { id: 'tech', name: '功法', tile: [3.3, 2.9], port: [4.2, 3.4] },
  { id: 'foe', name: '敌人', tile: [3.7, 3.1], port: [5.2, 4.2] },
  { id: 'boss', name: '首领', tile: [5, 3.8], port: [5.8, 4.4] },
  { id: 'ach', name: '成就', tile: [3.3, 2.9], port: [5.2, 4.2] },
];

const chName = (ch: number) => CHAPTER_NAME[ch] ?? `第 ${ch} 章`;
const pc = (v: number) => `${Math.round(v * 100)}%`;
const row = (k: string, body: string) => `<dt>${k}</dt><dd>${body}</dd>`;
const elTag = (el: Element) => `<span class="el" style="--el:${ELEMENT_COLOR[el]}">${ELEMENT_NAME[el]}</span>`;
/** 记录那一行：首次遇见于哪一章、次数。 */
const recLine = (bits: (string | false | null | undefined)[]) => {
  const b = bits.filter(Boolean) as string[];
  return b.length ? `<div class="rec">${b.map((s) => `<span>${s}</span>`).join('')}</div>` : '';
};
const firstSeen = (r: Rec | null) => (r?.ch ? `首次遇见于${chName(r.ch)}` : null);
const nameLine = (name: string, sub: string) => `<div class="nm"><b>${name}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;

function heroEntries(c: Codex): Entry[] {
  return HERO_IDS.map((id: HeroId): Entry => {
    const h = HEROES[id];
    const lock = HERO_LOCK[id];
    const rec = codexEntry(c, 'hero', id);
    const lit = !lock || isUnlocked(lock);
    return {
      cat: 'hero',
      id,
      name: h.name,
      lit,
      rec,
      art: !lit && HIDDEN[id] ? [MYSTERY] : heroArt(id), // 隐藏角色解锁之前连剪影都不露（一看轮廓就认得出来），只是一个问号（art/sprites/hidden.ts）
      el: h.el,
      hint: HERO_LOCK_HINT[id] ?? '解锁后点亮',
      body: () => {
        const w = WEAPONS[h.exclusive];
        const sk = skillInfo(h.skill);
        const br = PET_KINDS[h.petKind]?.branches.map((b) => PET_BRANCH[b].name).join(' / ');
        return `${nameLine(h.name, HERO_VIEWS[id].epithet[0])}
          <dl class="its">
          ${row('主五行', `${elTag(h.el)}<span class="d">开局${ELEMENT_NAME[h.el]}行亲和 +${pc(h.affStart)}</span>`)}
          ${row('专属法宝', `<span class="v">${w.name}</span><span class="d">${w.desc}</span>`)}
          ${row('宠物', `<span class="v">${h.pet}${elTag(h.petEl).replace('class="el"', 'class="el pe"')}</span><span class="d">${h.petDesc}</span>${br ? `<span class="d2">进化二途：${br}</span>` : ''}`)}
          ${row('神通', `<span class="v">${sk.name}</span><span class="d">${sk.desc}</span>`)}
          ${h.passive ? row('被动', `<span class="v">${h.passive.name}</span><span class="d">${h.passive.desc}</span>`) : ''}
          </dl>
          ${recLine([rec?.n ? `出战 ${rec.n} 局` : '尚未出战'])}`;
      },
    };
  });
}

const ROLE_NAME = { defense: '护身', control: '控场' } as const;

function weaponEntries(c: Codex): Entry[] {
  const all = (Object.keys(WEAPONS) as WeaponKind[]).filter((k) => {
    const d = WEAPONS[k];
    return !d.wip && (!d.exclusive || HERO_IDS.includes(d.exclusive));
  });
  // 专属的在前（按角色的顺序），公共的按五行（金木水火土）排，同一行按表里的顺序
  const ex = all.filter((k) => WEAPONS[k].exclusive).sort((a, b) => HERO_IDS.indexOf(WEAPONS[a].exclusive!) - HERO_IDS.indexOf(WEAPONS[b].exclusive!));
  const common = all.filter((k) => !WEAPONS[k].exclusive).sort((a, b) => ELEMENTS.indexOf(WEAPONS[a].el) - ELEMENTS.indexOf(WEAPONS[b].el));
  return [...ex, ...common].map((k): Entry => {
    const d = WEAPONS[k];
    const rec = codexEntry(c, 'weapon', k);
    const lock = lockFor('weapon', k);
    return {
      cat: 'weapon',
      id: k,
      name: d.name,
      lit: !!rec,
      rec,
      art: weaponArt(k),
      el: d.el,
      group: d.exclusive ? '专属法宝' : '公共法宝',
      lock,
      hint: lock ?? (d.exclusive ? '其主人出战一次即录入' : '于万宝阁中见过即录入'),
      body: () => {
        const top = rec?.tier ?? 0;
        const sub = [`${ELEMENT_NAME[d.el]}行`, d.exclusive ? `${HEROES[d.exclusive].name}的专属法宝` : '公共法宝', d.role ? `${ROLE_NAME[d.role]}法宝` : ''].filter(Boolean).join(' · ');
        // 四个品阶各一句：凡、灵是数量和范围，仙品起是质变（标出来），神品是两个器灵二选一；炼到过的那几阶字是实的
        const tier = (t: number, text: string) =>
          `<dt class="${t <= top ? 'on' : ''}" style="--t:${TIER_COLOR[t]}"><i></i>${TIER_NAME[t]}</dt><dd class="${t <= top ? 'on' : ''}">${text}</dd>`;
        const god = d.spirits.map((s) => `<span class="v">${s.name}</span><span class="d">${s.desc}</span>`).join('');
        return `${nameLine(d.name, sub)}
          <div class="d lead">${d.desc}</div>
          <dl class="its tiers">
          ${tier(1, d.tiers[1])}${tier(2, d.tiers[2])}${tier(3, `<span class="q3">质变</span>${d.tiers[3]}`)}${tier(4, `<span class="q3">器灵二选一</span>${god}`)}
          </dl>
          ${recLine([firstSeen(rec), rec?.n ? `获得 ${rec.n} 次` : '尚未获得', top ? `炼至${TIER_NAME[top]}品` : null])}`;
      },
    };
  });
}

function itemEntries(c: Codex): Entry[] {
  const price = (p: number) => `万宝阁售 ${p} 灵石起`;
  const relics = (Object.keys(RELICS) as RelicId[]).map((id): Entry => {
    const d = RELICS[id];
    const rec = codexEntry(c, 'relic', id);
    const lock = lockFor('relic', id);
    return {
      cat: 'relic',
      id,
      name: d.name,
      lit: !!rec,
      rec,
      lock,
      art: relicArt(id),
      group: '灵物',
      hint: lock ?? '于万宝阁中见过即录入',
      body: () =>
        `${nameLine(d.name, d.demon ? '灵物 · 魔物（带代价）' : '灵物 · 常驻，可叠加')}
        <div class="d lead">${d.desc}</div>
        ${d.stack ? `<dl class="its">${row('叠加', `<span class="d">${d.stack.replace(/^每多一件，/, '')}</span>`)}</dl>` : ''}
        <div class="d dim">${price(d.price)}</div>
        ${recLine([firstSeen(rec), rec?.n ? `获得 ${rec.n} 次` : '尚未获得'])}`,
    };
  });
  const elixirs = (Object.keys(ELIXIRS) as ElixirId[]).map((id): Entry => {
    const d = ELIXIRS[id];
    const rec = codexEntry(c, 'elixir', id);
    const lock = lockFor('elixir', id);
    return {
      cat: 'elixir',
      id,
      name: d.name,
      lit: !!rec,
      rec,
      lock,
      art: elixirArt(id),
      group: '丹药',
      hint: lock ?? '于万宝阁中见过即录入',
      body: () =>
        `${nameLine(d.name, d.now ? '丹药 · 购下即刻生效' : '丹药 · 仅限下一波')}
        <div class="d lead">${d.desc}</div>
        <div class="d dim">${price(d.price)}</div>
        ${recLine([firstSeen(rec), rec?.n ? `服过 ${rec.n} 颗` : '尚未服用'])}`,
    };
  });
  const charms = (Object.keys(CHARMS) as CharmId[]).map((id): Entry => {
    const d = CHARMS[id];
    const rec = codexEntry(c, 'charm', id);
    const lock = lockFor('charm', id);
    return {
      cat: 'charm',
      id,
      name: d.name,
      lit: !!rec,
      rec,
      lock,
      art: charmArt(id),
      group: '符箓',
      hint: lock ?? '于万宝阁中见过即录入',
      body: () =>
        `${nameLine(d.name, '符箓 · 常驻，每波限次')}
        <div class="d lead">${d.desc}</div>
        <div class="d dim">${price(d.price)}</div>
        ${recLine([firstSeen(rec), rec?.n ? `获得 ${rec.n} 次` : '尚未获得'])}`,
    };
  });
  return [...relics, ...elixirs, ...charms];
}

function foeEntries(c: Codex): Entry[] {
  // 敌人表里会动的都列（首领本体、首领召出来不会动的幡和草人不列：它们写在首领那一条里），顺序就是表里的顺序（按章节先后加的）；
  // 精英另成一组排在后面：按 sim/elites 的 ELITE_INFO 一种一条（敌人的 kind 都是 'elite'，Enemy.elite 分种类；记录的键是 elite.<种类>，
  // 回响校尉是 elite.xiaowei，codex-track.ts）；再一组「精英词缀」按 AFFIX_INFO 一条一条（键是 affix.<词缀>：现身的精英身上带的都记下，
  // 斩了带它的精英记一只）。画像：精英是走路的几帧，词缀是东海夜叉的头发换成这条词缀的颜色（codex-art.ts）。
  const kinds = (Object.keys(ENEMY_NAME) as EnemyKindName[]).filter((k) => k !== 'elite' && (ENEMIES[k]?.speed[1] ?? 0) > 0);
  const foes = kinds.map((k): Entry => {
    const rec = codexEntry(c, 'foe', k);
    const note = FOE_NOTES[k];
    return {
      cat: 'foe',
      id: k,
      name: ENEMY_NAME[k],
      lit: !!rec,
      rec,
      art: foeArt(k),
      group: '敌人',
      hint: '交手后录入',
      body: () =>
        `${nameLine(ENEMY_NAME[k], '')}
        <dl class="its">
        ${row('招式', `<span class="d">${note?.move ?? '尚未录入其招式。'}</span>`)}
        ${note ? row('应对', `<span class="d">${note.dodge}</span>`) : ''}
        </dl>
        ${recLine([firstSeen(rec), rec?.n ? `斩 ${rec.n} 只` : '尚未斩过'])}`,
    };
  });
  const elites = (Object.keys(ELITE_INFO) as EliteKind[]).map((k): Entry => {
    const key = `elite.${k}`;
    const rec = codexEntry(c, 'foe', key);
    const info = ELITE_INFO[k];
    const note = k === 'xiaowei' ? FOE_NOTES.elite : ELITE_NOTES[k];
    return {
      cat: 'foe',
      id: key,
      name: info.name,
      lit: !!rec,
      rec,
      art: eliteArt(k),
      group: '精英',
      hint: `${info.where}的精英，交手后录入`,
      body: () =>
        `${nameLine(info.name, `精英 · ${info.where}`)}
        <dl class="its">
        ${row('招式', `<span class="d">${note?.move ?? info.desc}</span>`)}
        ${note ? row('应对', `<span class="d">${note.dodge}</span>`) : ''}
        </dl>
        ${recLine([firstSeen(rec), rec?.n ? `斩 ${rec.n} 只` : '尚未斩过'])}`,
    };
  });
  const affixes = AFFIXES.map((a): Entry => {
    const key = `affix.${a}`;
    const rec = codexEntry(c, 'foe', key);
    const info = AFFIX_INFO[a];
    const note = AFFIX_NOTES[a];
    return {
      cat: 'foe',
      id: key,
      name: info.name,
      lit: !!rec,
      rec,
      art: affixArt(a),
      group: '精英词缀',
      hint: '遇见带此词缀的精英后录入',
      body: () =>
        `${nameLine(info.name, `精英词缀 · 血条旁写「${info.mark}」`)}
        <dl class="its">
        ${row('效果', `<span class="d">${note.move}</span>`)}
        ${row('应对', `<span class="d">${note.dodge}</span>`)}
        </dl>
        ${recLine([firstSeen(rec), rec?.n ? `斩过 ${rec.n} 只` : '尚未斩过'])}`,
    };
  });
  // 十绝阵（第二章的地形；记录的键是 ten.<阵>，亮起来见过就记下：codex-track.ts）
  const ten = TEN_ORDER.map((k): Entry => {
    const key = `ten.${k}`;
    const rec = codexEntry(c, 'foe', key);
    const note = TEN_NOTES[k];
    return {
      cat: 'foe',
      id: key,
      name: note.name,
      lit: !!rec,
      rec,
      art: tenArt(k),
      group: '十绝阵',
      hint: '第二章的阵，见其亮起后录入',
      body: () =>
        `${nameLine(note.name, `十绝阵 · ${note.look}`)}
        <dl class="its">
        ${row('招式', `<span class="d">${note.move}</span>`)}
        ${row('应对', `<span class="d">${note.dodge}</span>`)}
        </dl>
        ${recLine([firstSeen(rec)])}`,
    };
  });
  return [...foes, ...elites, ...affixes, ...ten];
}

/** 首领在图鉴存档里的键：回响那一族沿用原来的 echo.<哪一位>（遭遇战时就这么记的），别的就是首领模块的 kind。 */
export const bossCodexKey = (kind: BossId) => (isEchoFamily(kind) ? `echo.${kind}` : kind);

/**
 * 首领页签：按章列出这一章的首领池（sim/bosspool.ts）——每局抽一个当首领、另一个来第四波的遭遇战，所以每一位只列一条：
 * 当首领时的三个阶段都写上；来遭遇战时只打到第二阶段。不论哪种打法，打过照面算见过、打倒记一次。
 */
function bossEntries(c: Codex): Entry[] {
  const out: Entry[] = [];
  for (let n = 1; n <= CHAPTERS; n++) {
    for (const mod of chapterDef(n).pool) {
      const kind = mod.kind;
      const id = bossCodexKey(kind);
      if (out.some((e) => e.id === id)) continue;
      const echo = isEchoFamily(kind);
      const t = bossTitleOf(kind);
      const rec = codexEntry(c, 'boss', id);
      const note = isEchoFamily(kind) ? ECHO_NOTES[kind] : BOSS_NOTES[kind];
      const where = chName(n).split(' · ')[0];
      out.push({
        cat: 'boss',
        id,
        name: t.name,
        lit: !!rec,
        rec,
        art: isEchoFamily(kind) ? [echoPortrait(kind)] : bossArt(kind),
        hint: `${where}的首领池：每局一位为首领，另一位于第四波现身。交手后录入`,
        body: () => {
          const ph = ['一', '二', '三'].map((num, i) => row(`第${num}阶段${i ? ` · ${t.phases[i - 1]}` : ''}`, `<span class="d">${note?.phases[i] ?? '尚未录入此阶段招式。'}</span>`)).join('');
          return `${nameLine(t.name, t.sub)}
          ${note ? `<div class="d lead">${note.lead}</div>` : ''}
          <dl class="its phases">${ph}</dl>
          <div class="d">${where}的首领每局择一：为首领者于第六波现身，历三阶段；另一位于第四波遭遇，只至第二阶段，波终未败即退去。</div>
          ${recLine([firstSeen(rec), rec?.n ? `击败 ${rec.n} 次` : '尚未击败'])}`;
        },
      });
    }
  }
  return out;
}

/** 还没解锁的成就奖励：解锁条件那一句（解锁了、不是成就奖励的是 undefined）。打开图鉴时读一次存档里的成就。 */
let achieved: Achieved = {};
function lockFor(cat: 'weapon' | 'relic' | 'elixir' | 'charm', id: string): string | undefined {
  const d = lockOf(cat, id);
  return d && !Object.hasOwn(achieved, d.id) ? lockLine(d) : undefined;
}

/** 达成的日子（补记的不写日子）。 */
const achDate = (t: number) => {
  if (!t) return '成就系统之前的进度，补记';
  const d = new Date(t * 1000);
  return `达成于 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

/** 成就页签：按组分段；达成的是朱印（亮），没达成的是淡墨的拓影；隐秘的没达成只露问号、不写条件。每条写奖励。 */
function achEntries(): Entry[] {
  const rewardArt = (r: Reward): Grid[] =>
    r.cat === 'hero' ? heroArt(r.id) : r.cat === 'weapon' ? weaponArt(r.id) : r.cat === 'relic' ? relicArt(r.id) : r.cat === 'elixir' ? elixirArt(r.id) : charmArt(r.id);
  const groupName = (g: string) => ACH_GROUPS.find((x) => x.id === g)?.name ?? '';
  return ACHIEVEMENTS.map((d): Entry => {
    const lit = Object.hasOwn(achieved, d.id);
    const hide = d.secret && !lit;
    const reward = d.reward ? row('奖励', `<span class="v">${rewardText(d.reward)}</span>`) : row('奖励', '<span class="d dim0">无，唯记其功</span>');
    const text = (on: boolean) =>
      `${nameLine(d.name, `${groupName(d.group)}${d.secret ? ' · 隐秘' : ''}`)}
      <div class="d lead">${d.desc}</div>
      <dl class="its">${reward}</dl>
      ${recLine([on ? achDate(achieved[d.id]) : '尚未达成'])}`;
    return {
      cat: 'hero',
      id: d.id,
      name: hide ? '？？？' : d.name,
      lit,
      rec: null,
      art: hide ? [MYSTERY] : achSeal(d.group, lit),
      port: hide ? [MYSTERY] : d.reward ? (lit ? rewardArt(d.reward) : silhouetteOf(rewardArt(d.reward))) : achSeal(d.group, lit),
      group: groupName(d.group),
      hint: '隐秘成就。达成之后，方显其名与条件',
      dim: hide ? undefined : () => text(false),
      ownDim: true,
      body: () => text(true),
    };
  });
}

/**
 * 功法（2026-11-12，24 门）：不用见过才点亮——功法不藏，一开始就都列着，按玩法类别分组（类别的先后见 TECH_KIND_ORDER）。
 * 说明：类别与五行、悟功法时卡上的那一句、「其法」（codex-notes.ts 的 TECH_NOTES）。不记次数（图鉴的存档没有功法这一类）。
 */
const TECH_KIND_ORDER: TechKind[] = ['五行', '输出', '神通', '宠物', '召唤', '控场', '护身', '走位', '经济', '代价'];
function techEntries(): Entry[] {
  const ids = [...TECH_IDS].sort((a, b) => TECH_KIND_ORDER.indexOf(TECHNIQUES[a].kind) - TECH_KIND_ORDER.indexOf(TECHNIQUES[b].kind));
  return ids.map((id): Entry => {
    const d = TECHNIQUES[id];
    const note = TECH_NOTES[id];
    return {
      cat: 'hero',
      id,
      name: d.name,
      lit: true,
      rec: null,
      art: [TECH_ICONS[id]],
      el: d.el,
      group: `${d.kind}之法`,
      hint: '',
      body: () =>
        `${nameLine(d.name, [d.el ? `${ELEMENT_NAME[d.el]}行` : '', `${d.kind}之法`, '悟得之后一局之内常在'].filter(Boolean).join(' · '))}
        <div class="d lead">${d.desc}</div>
        ${note ? `<dl class="its">${row('其法', `<span class="d">${note}</span>`)}</dl>` : ''}`,
    };
  });
}

const BUILD: Record<TabId, (c: Codex) => Entry[]> = { hero: heroEntries, weapon: weaponEntries, item: itemEntries, tech: techEntries, foe: foeEntries, boss: bossEntries, ach: achEntries };

// ---------- 样式 ----------

const CSS = `
.fs-ui .cx .paper { padding-bottom: .9em; }
.fs-ui .cx-head { flex: none; display: flex; flex-direction: column; align-items: center; }
.fs-ui .cx-head h2 { margin-bottom: .05em; }
/* 页签：五个同宽，字摆正中；当前这一页的字是朱砂，字下面一笔朱砂的短墨痕（像素画，从左往右刷出来） */
.fs-ui .cx-tabs { display: flex; justify-content: center; gap: ${P(4)}; }
.fs-ui .cx-tab { position: relative; width: var(--tw); height: var(--tap); display: flex; align-items: center; justify-content: center; color: ${C.cang}; transition: color .25s; }
.fs-ui .cx-tab b { font-family: ${FONT_TITLE}; font-size: 1.3em; line-height: 1.1; letter-spacing: .12em; margin-right: -.12em; }
.fs-ui .cx-tab::after { content: ''; position: absolute; left: calc(50% - var(--sw) / 2); bottom: ${P(1)}; width: var(--sw); height: var(--sh); background: var(--stroke) 0 0 / 100% 100% no-repeat; image-rendering: pixelated; clip-path: inset(0 100% 0 0); transition: clip-path .35s cubic-bezier(.3,.6,.2,1); }
.fs-ui .cx-tab.on { color: ${C.zhu}; }
.fs-ui .cx-tab.on::after { clip-path: inset(0 0 0 0); }
.fs-ui .cx-tab:focus-visible b { text-decoration: underline ${C.teng} var(--p); text-underline-offset: .3em; }
@media (hover: hover) { .fs-ui .cx-tab:not(.on):hover { color: ${C.wu}; } }
/* 下面：左边格子、右边说明，中间一道淡淡的竖线。还能往下滑的那一栏，下沿淡出去（滑到底就不淡了） */
.fs-ui .cx-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--dw); column-gap: 1.1em; margin-top: .45em; }
/* 竖屏（.tall）：格子在上（格子少的页签只占它那么高，多的最多占一半、在里面滑）、说明在下，中间一道淡淡的横线 */
.fs-ui .cx.tall .cx-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: fit-content(46%) minmax(0, 1fr); row-gap: .5em; }
.fs-ui .cx-list, .fs-ui .cx-detail { position: relative; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.fs-ui .cx-list::-webkit-scrollbar, .fs-ui .cx-detail::-webkit-scrollbar { display: none; }
.fs-ui .more-b { -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 2.2em), transparent); mask-image: linear-gradient(180deg, #000 calc(100% - 2.2em), transparent); }
.fs-ui .more-t { -webkit-mask-image: linear-gradient(0deg, #000 calc(100% - 1.6em), transparent); mask-image: linear-gradient(0deg, #000 calc(100% - 1.6em), transparent); }
.fs-ui .more-t.more-b { -webkit-mask-image: linear-gradient(180deg, transparent, #000 1.6em, #000 calc(100% - 2.2em), transparent); mask-image: linear-gradient(180deg, transparent, #000 1.6em, #000 calc(100% - 2.2em), transparent); }
.fs-ui .cx-list { display: flex; flex-wrap: wrap; align-content: flex-start; gap: ${P(3)}; padding: ${P(2)} ${P(2)} ${P(6)}; }
.fs-ui .cx-detail { padding: ${P(1)} ${P(2)} ${P(6)} 1.1em; box-shadow: inset var(--p) 0 0 ${C.gao}; }
.fs-ui .cx.tall .cx-detail { padding: .6em ${P(2)} ${P(6)}; box-shadow: inset 0 var(--p) 0 ${C.gao}; }
.fs-ui .cx-grp { flex: 0 0 100%; margin: .25em 0 .05em; color: ${C.cang}; letter-spacing: .12em; font-size: .9em; line-height: 1.5; }
.fs-ui .cx-grp:first-child { margin-top: 0; }
/* 格子：一方小纸笺，像素图摆在正中、脚底对齐；没见过的纸色暗一点、画是淡墨的剪影 */
.fs-ui .cx-t { position: relative; flex: none; width: var(--ts); height: var(--ts); display: flex; align-items: center; justify-content: center; padding: 0; background: #fbf5e8; box-shadow: inset 0 0 0 var(--p) ${C.gao}, 0 var(--p) 0 0 ${C.gao}; cursor: pointer; transition: background-color .25s, box-shadow .25s; }
.fs-ui .cx-t.dark { background: #ece2cf; }
.fs-ui .cx-t .im { display: block; background: 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
.fs-ui .cx-t .mk { position: absolute; left: ${P(2)}; top: ${P(2)}; width: ${P(2)}; height: ${P(2)}; background: var(--el); }
.fs-ui .cx-t .lk { position: absolute; right: ${P(1)}; top: ${P(1)}; font-size: .6em; line-height: 1; padding: .14em .16em .12em; color: ${C.yuebai}; background: ${C.zhu}; text-decoration: none; }
.fs-ui .cx-detail .lockline { margin-bottom: .45em; color: ${C.zhu}; }
.fs-ui .cx-detail .lockline s { display: inline-block; margin-right: .4em; padding: .1em .2em; font-size: .8em; line-height: 1; vertical-align: .1em; color: ${C.yuebai}; background: ${C.zhu}; text-decoration: none; }
.fs-ui .cx-detail .dim0 { color: ${C.cang}; }
.fs-ui .cx-t.sel { box-shadow: inset 0 0 0 var(--p) ${C.zhu}, inset 0 0 0 ${P(2)} ${C.zhusha}, 0 var(--p) 0 0 ${C.yin}; }
.fs-ui .cx-t:focus { outline: none; }
@media (hover: hover) { .fs-ui .cx-t:not(.sel):hover { box-shadow: inset 0 0 0 var(--p) ${C.yinshu}, 0 var(--p) 0 0 ${C.gao}; } }
/* 说明：上面一块是会动的画像（脚底贴着下沿），下面是名字、说明、记录 */
.fs-ui .cx-pt { position: relative; height: var(--ph); display: flex; align-items: flex-end; justify-content: center; margin-bottom: .4em; overflow: hidden; }
.fs-ui .cx-pt .im { position: relative; display: block; background: 0 0 / 100% 100% no-repeat; image-rendering: pixelated; }
.fs-ui .cx-in { animation: cx-in .3s ease-out both; }
@keyframes cx-in { from { opacity: 0; } }
.fs-ui .cx-detail .nm { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: .6em; margin-bottom: .3em; }
.fs-ui .cx-detail .nm b { flex: none; font-family: ${FONT_TITLE}; font-size: 1.75em; line-height: 1.25; color: ${C.xuan}; letter-spacing: .06em; }
.fs-ui .cx-detail .nm b.q { color: ${C.yinshu}; letter-spacing: .06em; }
.fs-ui .cx-detail .nm span { color: ${C.cang}; }
.fs-ui .cx-detail .d { display: block; color: ${C.wu}; }
.fs-ui .cx-detail .d.lead { margin-bottom: .45em; }
.fs-ui .cx-detail .d.dim { color: ${C.cang}; margin-top: .35em; }
.fs-ui .cx-detail .d2 { display: block; color: ${C.cang}; }
.fs-ui .cx-detail .v { display: block; color: ${C.xuan}; }
.fs-ui .cx-detail .hint { color: ${C.cang}; text-align: left; }
.fs-ui .cx-detail .its { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .8em; row-gap: .45em; margin: 0; }
.fs-ui .cx-detail .its dt { color: ${C.zhu}; letter-spacing: .06em; white-space: nowrap; }
.fs-ui .cx-detail .its dd { margin: 0; min-width: 0; }
.fs-ui .cx-detail .el { display: inline-block; width: 1.4em; height: 1.4em; line-height: 1.4em; text-align: center; color: ${C.yuebai}; background: var(--el); box-shadow: inset 0 0 0 var(--p) rgba(26,21,32,.35); margin-right: .45em; vertical-align: top; }
.fs-ui .cx-detail .el + .d { display: inline; }
.fs-ui .cx-detail .el.pe { width: 1.25em; height: 1.25em; line-height: 1.25em; margin: 0 0 0 .4em; font-size: .86em; vertical-align: .05em; } /* 宠物的五行 */
/* 品阶：一方小色块 + 字（和那一阶的头一行对齐）；炼到过的是实的，没炼到的淡一些 */
.fs-ui .cx-detail .tiers dt { display: flex; align-items: center; gap: .3em; height: 1.5em; align-self: start; color: ${C.yinshu}; }
.fs-ui .cx-detail .tiers dt i { display: block; width: ${P(4)}; height: ${P(4)}; background: var(--t); box-shadow: inset 0 0 0 var(--p) rgba(26,21,32,.25); opacity: .45; }
.fs-ui .cx-detail .tiers dt.on { color: ${C.xuan}; }
.fs-ui .cx-detail .tiers dt.on i { opacity: 1; }
.fs-ui .cx-detail .tiers dd { color: ${C.cang}; }
.fs-ui .cx-detail .tiers dd.on { color: ${C.wu}; }
.fs-ui .cx-detail .tiers dd .v { color: inherit; }
.fs-ui .cx-detail .tiers dd .v::after { content: '：'; }
.fs-ui .cx-detail .tiers dd .v, .fs-ui .cx-detail .tiers dd .d { display: inline; }
.fs-ui .cx-detail .tiers dd .d + .v::before { content: '；'; color: ${C.cang}; }
.fs-ui .cx-detail .q3 { color: ${C.zhu}; margin-right: .35em; }
/* 首领的三个阶段：阶段名单独一行，招式写在下面（阶段名长短不一，放成两列会把说明挤到右边去） */
.fs-ui .cx-detail .phases { display: block; }
.fs-ui .cx-detail .phases dt { color: ${C.zhu}; margin-top: .35em; }
.fs-ui .cx-detail .phases dt:first-child { margin-top: 0; }
.fs-ui .cx-detail .rec { display: flex; flex-wrap: wrap; column-gap: 1.1em; margin-top: .7em; padding-top: .45em; color: ${C.cang}; box-shadow: inset 0 var(--p) 0 ${C.gao}; }
.fs-ui .cx-detail .rec span { white-space: nowrap; }
/* 下面一排：这一页见过几条（左）、返回（正中）、整本见过几条（右） */
.fs-ui .cx-bar { flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-top: .45em; }
.fs-ui .cx-bar .n { color: ${C.cang}; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fs-ui .cx-bar .n b { color: ${C.zhu}; margin: 0 .1em; }
.fs-ui .cx-bar .n:last-child { text-align: right; }
/* 手机横屏：标题和页签并成一行，页签下不写数，说明里的画像矮一些 */
.fs-ui .cx.compact .cx-head { flex-direction: row; justify-content: center; gap: 1em; }
.fs-ui .cx.compact .cx-head h2 { margin: 0; font-size: 1.55em; letter-spacing: .2em; }
.fs-ui .cx.compact .cx-body { margin-top: .25em; }
.fs-ui .cx.compact .cx-detail .nm b { font-size: 1.5em; }
.fs-ui .cx.compact .cx-detail .its { row-gap: .3em; line-height: 1.42; }
.fs-ui .cx.compact .cx-detail .rec { margin-top: .45em; padding-top: .3em; }
.fs-ui .cx.compact .cx-bar { margin-top: .25em; }
@media (prefers-reduced-motion: reduce) { .fs-ui .cx-in { animation: none; } .fs-ui .cx-tab::after { transition: none; } }
`;

// ---------- 像素图的尺寸 ----------

/** 一张 w×h 的像素图放进 box×box 的格子：整数个物理像素一格（最近邻放大才清楚），最大不超过 cap 个物理像素。返回 CSS 像素。 */
function fitScale(w: number, h: number, boxW: number, boxH: number, f: UiFit, cap: number): number {
  const k = Math.floor(Math.min(boxW / w, boxH / h) * f.dpr + 1e-6);
  return Math.max(1, Math.min(cap, k)) / f.dpr;
}

export interface CodexOptions {
  layer: Layer;
  sfx: Sfx;
  /** 'ach'：成就页（标题页的「成就」）；不给就是图鉴（不含成就）。 */
  only?: 'ach';
}

/** 打开成就页（标题页的「成就」）；关上时 resolve。 */
export const openAchievements = (o: Omit<CodexOptions, 'only'>) => openCodex({ ...o, only: 'ach' });

/** 打开图鉴；关上时 resolve。 */
export async function openCodex(o: CodexOptions): Promise<void> {
  injectCss('fs-codex', CSS);
  const { layer, sfx } = o;
  const achOnly = o.only === 'ach';
  reconcile(); // 成就：图鉴点亮了多少条这一类，打开时对一遍（新达成的在右上角弹出）
  achieved = loadAchieved();
  const codex = loadCodex();
  const tabs = TABS.filter((t) => (t.id === 'ach') === achOnly).map((t) => ({ ...t, entries: BUILD[t.id](codex) }));
  // 「总计」只算图鉴的条目（成就页签另算达成几项；功法一开始就都列着、不用收集，也不算）
  const book = tabs.filter((t) => t.id !== 'ach' && t.id !== 'tech');
  const total = book.reduce((s, t) => s + t.entries.length, 0);
  const totalLit = book.reduce((s, t) => s + t.entries.filter((e) => e.lit).length, 0);

  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = 'rgba(26,21,32,.32)';
  layer.ui.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  const panel = scrollPanel(52);
  panel.el.classList.add('cx');
  layer.ui.appendChild(panel.el);
  const p = panel.paper;
  const head = document.createElement('div');
  head.className = 'cx-head';
  head.innerHTML = achOnly ? '<h2>成就</h2>' : '<h2>图鉴</h2>';
  const tabRow = document.createElement('div');
  tabRow.className = 'cx-tabs';
  head.appendChild(tabRow);
  const body = document.createElement('div');
  body.className = 'cx-body';
  const list = document.createElement('div');
  list.className = 'cx-list';
  const detail = document.createElement('div');
  detail.className = 'cx-detail';
  body.append(list, detail);
  const bar = document.createElement('div');
  bar.className = 'cx-bar';
  const tabCount = document.createElement('span');
  tabCount.className = 'n';
  const back = inkButton('返回', { primary: true });
  const allCount = document.createElement('span');
  allCount.className = 'n';
  if (!achOnly) allCount.innerHTML = `总计 <b>${totalLit}</b> / ${total}`;
  bar.append(tabCount, back, allCount);
  p.append(head, body, bar);
  if (achOnly) tabRow.style.display = 'none'; // 只有一页：不出页签行

  // ---------- 页签 ----------
  const tabBtns = tabs.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cx-tab';
    const lit = t.entries.filter((e) => e.lit).length;
    b.innerHTML = `<b>${t.name}</b>`;
    b.setAttribute('aria-label', `${t.name}：${t.id === 'ach' ? '达成' : '见过'} ${lit} / ${t.entries.length}`);
    b.addEventListener('click', () => showTab(i, true));
    tabRow.appendChild(b);
    return b;
  });

  // ---------- 状态 ----------
  let cur = 0; // 当前页签
  const selOf = tabs.map(() => 0); // 每一页选中的是第几条（换回来还停在那里）
  let tiles: HTMLButtonElement[] = [];
  let fit = layer.fit;
  /** 说明栏的宽（layout 里按窗口算好）；compact：手机横屏的紧版面。 */
  let detailW = 0;
  let compact = false;

  /** 还能往上 / 下滑的那一栏：上沿 / 下沿淡出去（滑到头就不淡了），看得出下面还有。 */
  const edges = (el: HTMLElement) => {
    const room = el.scrollHeight - el.clientHeight;
    el.classList.toggle('more-t', room > 2 && el.scrollTop > 2);
    el.classList.toggle('more-b', room > 2 && el.scrollTop < room - 2);
  };
  list.addEventListener('scroll', () => edges(list), { passive: true });
  detail.addEventListener('scroll', () => edges(detail), { passive: true });

  // 手机上：在格子、说明上横着一划就换页签（竖着划照常是滑动；两栏都是 touch-action: pan-y，横着划浏览器不接）
  let swipe: { id: number; x: number; y: number; t: number } | null = null;
  body.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.isPrimary) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  });
  body.addEventListener('pointerup', (e) => {
    const s = swipe;
    swipe = null;
    if (!s || e.pointerId !== s.id || performance.now() - s.t > 700) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > fit.base * 3.2 && Math.abs(dx) > Math.abs(dy) * 1.8) showTab(cur + (dx < 0 ? 1 : -1), true, null);
  });
  body.addEventListener('pointercancel', () => (swipe = null));

  const artOf = (e: Entry) => (e.lit || e.ownDim ? e.art : silhouetteOf(e.art));

  /** 一张像素图元素：k 是一格几个 CSS 像素；frames 多于一帧就一格一格地播（静的用第一帧）。 */
  const pixelEl = (frames: Grid[], k: number, animate: boolean) => {
    const i = document.createElement('i');
    i.className = 'im';
    const g = frames[0];
    const w = g.w * k;
    const h = g.h * k;
    Object.assign(i.style, { width: `${w}px`, height: `${h}px` });
    if (!animate || frames.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      i.style.backgroundImage = `url("${gridUrl(g)}")`;
      return i;
    }
    const s = stripUrl(frames);
    i.style.backgroundImage = `url("${s.url}")`;
    i.style.backgroundSize = `${s.w * frames.length * k}px ${h}px`;
    // 一秒四五帧，走得不快（用户口径：动画不要太快）
    i.animate([{ backgroundPositionX: '0px' }, { backgroundPositionX: `${-s.w * frames.length * k}px` }], { duration: (frames.length / 4.5) * 1000, iterations: Infinity, easing: `steps(${frames.length})` });
    return i;
  };

  const renderList = () => {
    const t = tabs[cur];
    const keep = list.scrollTop;
    list.textContent = '';
    tiles = [];
    let group: string | undefined;
    // 格子的边长：这一页的（角色、首领用大格子），取整到格子上
    const tileS = Math.round((t.tile[compact ? 1 : 0] * fit.base) / fit.p) * fit.p;
    list.style.setProperty('--ts', `${tileS}px`);
    const inner = tileS - fit.p * 6;
    // 一页里的格子用同一个放大上限：图标（16 格）正好铺满的那个倍数；大个子缩小，小个子不放得比图标还大
    const cap = Math.max(1, Math.floor((inner / 16) * fit.dpr + 1e-6));
    t.entries.forEach((e, i) => {
      if (e.group && e.group !== group) {
        group = e.group;
        const g = document.createElement('div');
        g.className = 'cx-grp';
        g.textContent = e.group;
        list.appendChild(g);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cx-t${e.lit ? '' : ' dark'}${i === selOf[cur] ? ' sel' : ''}`;
      b.setAttribute('aria-label', e.lit || e.dim ? e.name : '没见过');
      const fr = artOf(e);
      b.appendChild(pixelEl(fr, fitScale(fr[0].w, fr[0].h, inner, inner, fit, cap), false));
      if (e.lit && e.el) {
        const mk = document.createElement('s');
        mk.className = 'mk';
        mk.style.setProperty('--el', ELEMENT_COLOR[e.el]);
        b.appendChild(mk);
      }
      if (e.lock) {
        const lk = document.createElement('s');
        lk.className = 'lk';
        lk.textContent = '锁';
        b.appendChild(lk);
      }
      b.addEventListener('click', () => select(i, true, false));
      list.appendChild(b);
      tiles.push(b);
    });
    list.scrollTop = keep;
    edges(list);
    const lit = t.entries.filter((e) => e.lit).length;
    tabCount.innerHTML = t.id === 'ach' ? `达成 <b>${lit}</b> / ${t.entries.length}` : `${t.name} <b>${lit}</b> / ${t.entries.length}`;
  };

  const renderDetail = () => {
    const e = tabs[cur].entries[selOf[cur]];
    detail.textContent = '';
    if (!e) return;
    const wrap = document.createElement('div');
    wrap.className = 'cx-in';
    const pt = document.createElement('div');
    pt.className = 'cx-pt';
    const fr = e.port ?? artOf(e);
    const g = fr[0];
    const portH = Math.round((tabs[cur].port[compact ? 1 : 0] * fit.base) / fit.p) * fit.p;
    pt.style.setProperty('--ph', `${portH}px`);
    // 画像：放进说明栏那么宽、--ph 那么高的一块，整数倍；最大七倍（物理像素再乘 dpr），免得一只小鬼糊满一栏
    const cap = Math.max(1, Math.round(7 * fit.dpr * Math.min(1.4, fit.base / 20)));
    pt.appendChild(pixelEl(fr, fitScale(g.w, g.h, detailW - fit.base * 1.4, portH - fit.p * 2, fit, cap), true));
    wrap.appendChild(pt);
    const text = document.createElement('div');
    // 还没解锁的成就奖励：见过了也在最上面写一行解锁条件（没见过的，条件就是 hint）
    text.innerHTML = e.lit ? (e.lock ? `<div class="lockline"><s>锁</s>${e.lock}</div>` : '') + e.body() : e.dim ? e.dim() : `<div class="nm"><b class="q">？？？</b></div><div class="hint">${e.hint}</div>`;
    wrap.appendChild(text);
    detail.appendChild(wrap);
    detail.scrollTop = 0;
    edges(detail);
  };

  /** 把选中的格子滚进格子栏里看得见的地方（只滚这一栏，不动别的）。 */
  const reveal = (b: HTMLElement) => {
    const pad = fit.p * 4;
    const top = b.offsetTop - pad;
    const bottom = b.offsetTop + b.offsetHeight + pad;
    if (top < list.scrollTop) list.scrollTo({ top, behavior: 'smooth' });
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight, behavior: 'smooth' });
  };

  const select = (i: number, sound: boolean, focus = true) => {
    const n = tabs[cur].entries.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const same = i === selOf[cur];
    if (!same && sound) sfx.play('ui.click');
    tiles[selOf[cur]]?.classList.remove('sel');
    selOf[cur] = i;
    tiles[i]?.classList.add('sel');
    if (focus) tiles[i]?.focus({ preventScroll: true });
    if (tiles[i]) reveal(tiles[i]);
    if (!same) renderDetail();
  };

  const showTab = (i: number, sound: boolean, focusOn: 'tab' | 'list' | null = 'tab') => {
    i = (i + tabs.length) % tabs.length;
    if (i !== cur && sound) sfx.play('ui.click');
    const changed = i !== cur;
    cur = i;
    tabBtns.forEach((b, k) => b.classList.toggle('on', k === i));
    if (changed) {
      list.scrollTop = 0;
      renderList();
      list.classList.remove('cx-in');
      void list.offsetWidth;
      list.classList.add('cx-in');
      renderDetail();
    }
    if (focusOn === 'tab') tabBtns[i].focus({ preventScroll: true });
    else if (focusOn === 'list') tiles[selOf[cur]]?.focus({ preventScroll: true });
  };

  // ---------- 排版 ----------
  const layout = (f: UiFit) => {
    fit = f;
    const em = f.base;
    compact = isCompact(f);
    panel.el.classList.toggle('compact', compact);
    // 竖屏（手机竖着拿）：格子在上、说明在下（.tall），卷轴可以更高
    const tall = isTall(f);
    panel.el.classList.toggle('tall', tall);
    // 卷轴：尽量大（宽最多 56 个字、高最多 34 行字；竖屏最多 52 行），窗口小就收；两头的轴各伸出 6 格
    const availW = f.w - f.safe.left - f.safe.right;
    const wEm = Math.min(compact ? 58 : 54, availW / em - 2);
    panel.setWidth(wEm);
    const availH = f.h - f.safe.top - f.safe.bottom;
    const H = Math.min(availH - (compact ? 0.5 : 1.4) * em, (tall ? 52 : 33) * em);
    panel.el.style.height = `${snapPx(H, f)}px`;
    // 页签：五个同宽（按两个字加数字取），整格；竖屏窄，取紧的那一档
    const tw = Math.round(((compact || tall ? 3.6 : 4.4) * em) / f.p) * f.p;
    panel.el.style.setProperty('--tw', `${tw}px`);
    const sw = Math.max(8, Math.round((tw * 0.72) / f.p));
    const sh = Math.max(2, Math.round((0.32 * em) / f.p));
    panel.el.style.setProperty('--sw', `${sw * f.p}px`);
    panel.el.style.setProperty('--sh', `${sh * f.p}px`);
    panel.el.style.setProperty('--stroke', `url("${bitmapUrl(makeInkStroke(sw, sh, 31 + sw, 'cinnabar', 0.25, 0.2))}")`);
    // 说明栏宽：版面宽的四成多（手机上一半）
    const pcs = getComputedStyle(panel.paper);
    const paperW = panel.paper.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    // 六个页签在窄的竖屏上放不下那么宽：按纸宽收（同宽、整格）
    const twFit = Math.floor((paperW - f.p * 4 * (tabs.length - 1)) / tabs.length / f.p) * f.p;
    if (twFit < tw) panel.el.style.setProperty('--tw', `${twFit}px`);
    detailW = tall ? Math.round(paperW) : Math.round(paperW * (compact ? 0.5 : 0.44));
    panel.el.style.setProperty('--dw', `${detailW}px`);
    renderList();
    renderDetail();
    centerIn(panel.el, f);
  };
  const refit = layer.onFit;
  layer.onFit = (f) => {
    refit?.(f);
    layout(f);
  };
  tabBtns[0].classList.add('on');
  layout(layer.fit);

  // ---------- 关上 ----------
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
  back.addEventListener('click', () => void close());

  // ---------- 键盘 ----------
  /** 格子里往上 / 下一排：挑那一排里横着离得最近的一格；没有那一排就返回 -1。 */
  const vertical = (dir: 1 | -1) => {
    const a = tiles[selOf[cur]];
    if (!a) return -1;
    const y = a.offsetTop;
    const x = a.offsetLeft;
    let best = -1;
    let bestY = dir > 0 ? Infinity : -Infinity;
    let bestDx = Infinity;
    tiles.forEach((b, i) => {
      const by = b.offsetTop;
      if (dir > 0 ? by <= y + 1 : by >= y - 1) return;
      const dx = Math.abs(b.offsetLeft - x);
      // 先挑最近的那一排，再在那一排里挑横着最近的
      if ((dir > 0 ? by < bestY - 1 : by > bestY + 1) || (Math.abs(by - bestY) <= 1 && dx < bestDx)) {
        best = i;
        bestY = by;
        bestDx = dx;
      }
    });
    return best;
  };
  const popKeys = pushKeys((e) => {
    if (closing) return 'consume';
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      void close();
      return 'consume';
    }
    // 换页签：Q / E、[ ]、PageUp / PageDown（焦点留在原来那一块：页签上的还在页签上，格子里的落到新一页选中的那一格）
    const zone = tabBtns.includes(document.activeElement as HTMLButtonElement) ? 'tab' : document.activeElement === back ? 'back' : 'list';
    if (k === 'q' || k === '[' || k === 'pageup' || k === 'e' || k === ']' || k === 'pagedown') {
      if (achOnly) return 'consume'; // 成就页只有一页
      showTab(cur + (k === 'q' || k === '[' || k === 'pageup' ? -1 : 1), true, zone === 'tab' ? 'tab' : zone === 'list' ? 'list' : null);
      return 'consume';
    }
    const left = k === 'arrowleft' || k === 'a';
    const right = k === 'arrowright' || k === 'd';
    const up = k === 'arrowup' || k === 'w';
    const down = k === 'arrowdown' || k === 's';
    const enter = k === 'enter' || k === ' ' || k === 'j';
    if (zone === 'tab') {
      if (left || right) showTab(cur + (left ? -1 : 1), true);
      else if (down || enter) tiles[selOf[cur]]?.focus({ preventScroll: true });
      return 'consume';
    }
    if (zone === 'back') {
      if (up) tiles[selOf[cur]]?.focus({ preventScroll: true });
      else if (enter) back.click();
      return 'consume';
    }
    // 格子里
    if (left || right) select(selOf[cur] + (left ? -1 : 1), true);
    else if (up || down) {
      const n = vertical(up ? -1 : 1);
      if (n >= 0) select(n, true);
      else if (up && !achOnly) tabBtns[cur].focus({ preventScroll: true });
      else back.focus({ preventScroll: true });
    } else if (enter) tiles[selOf[cur]]?.focus({ preventScroll: true });
    return 'consume';
  });

  await panel.open();
  await wait(20);
  tiles[selOf[cur]]?.focus({ preventScroll: true });
  await done;
}
