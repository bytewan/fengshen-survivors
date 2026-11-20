// 图鉴的记录点：一局里见到了什么、拿到了什么、斩了多少，全在这一个小类里记（存档在 profile.ts 的 fs.v1.codex，页面在 codex.ts），
// 挂在模拟发出来的事件上——别的画面都不碰图鉴。feel.ts 里只有三处：每个事件交给 onEvent、万宝阁开着时每帧 update、拆局时 dispose。
//   敌人：现身（spawn）就算见过，自己斩的（kill，owner 是自己）记只数；精英分种类记（键是 elite.<种类>，回响校尉是 elite.xiaowei），
//   身上的词缀各记一条见过（affix.<词缀>）；首领：入场（bossIntro）算见过，倒下（bossDeath）记一次击败；
//   法宝、道具：万宝阁货架上出现过（打开商店、刷新之后每帧看一眼货架，刷新没有事件）或拿到过就算见过，买下（bought）记一次拿到，
//   开局自带的专属法宝在第 1 波开打时记一次；法宝的最高品阶看手里那件（买同名、碎片、宝匣、器灵都会升）；
//   角色：第 1 波开打时记一局出战（角色本身解锁了就在图鉴里点亮，见 codex.ts）。
// 单人、联机（房主和其他人各记各的：其他人的事件是房主广播来的）、?bot 都记；调试开局（?wave=）不是从第 1 波开打，不记出战。
// 先记在内存里（这一段新见到的、新增的次数），开波 / 波末 / 商店打开 / 首领倒下 / 拆局 / 页面切到后台时并进存档（profile.addCodex：
// 读出现在的、合上、写回），一局里不会每斩一只就写一次本地存储。
import { isEchoFamily } from '../sim/bosspool.ts';
import { chapterOf } from '../sim/catalog.ts';
import { chapterDef } from '../sim/chapters.ts';
import type { ShopOffer, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { CODEX_CATS, addCodex, defaultCodex, loadCodex, type Codex, type CodexCat, type CodexEntry } from './profile.ts';

/** 第几章（第 0 波 = 还没开打，算第一章）。 */
const chapterNow = (w: World) => chapterOf(Math.max(1, w.wave));

/**
 * 精英身上分种类、带词缀的字段（各章的精英那条线加的：Enemy.elite 是哪一种、没有 = 回响校尉；Enemy.affixes 带的词缀；
 * 以前劫五的一条词缀是 Enemy.affix）。按「有就读」写，那条线合进来之前、之后都对。
 */
function eliteFields(w: World, id: number): { elite?: string; affixes?: string[]; affix?: string } | undefined {
  return w.enemies?.find((x) => x.id === id) as { elite?: string; affixes?: string[]; affix?: string } | undefined;
}

/** 首领在图鉴存档里的键：回响那一族沿用原来的 echo.<哪一位>（遭遇战时就这么记的），别的就是首领模块的 kind（和 codex.ts 的 bossCodexKey 一个口径）。 */
const bossKey = (kind: string) => (isEchoFamily(kind) ? `echo.${kind}` : kind);

export class CodexTracker {
  /** 已经在图鉴里的（开局时读的）和这一局新见到的：'分类:id'。见过的不再重复记「见过」。 */
  private known = new Set<string>();
  /** 法宝已知的最高品阶（只升不降）。 */
  private tiers = new Map<string, number>();
  /** 还没并进存档的这一段。 */
  private delta: Codex = defaultCodex();
  private dirty = false;
  private readonly onHide = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };
  private readonly onLeave = () => this.flush();

  constructor() {
    const c = loadCodex();
    for (const cat of CODEX_CATS)
      for (const [id, e] of Object.entries(c[cat])) {
        this.known.add(`${cat}:${id}`);
        if (cat === 'weapon' && e[2]) this.tiers.set(id, e[2]);
      }
    if (typeof document !== 'undefined') {
      addEventListener('pagehide', this.onLeave);
      document.addEventListener('visibilitychange', this.onHide);
    }
  }

  /** 见过（第一次见到时记下在第几章）；n：这一次要加的次数；tier：法宝这时的品阶。 */
  private note(cat: CodexCat, id: string, ch: number, n = 0, tier = 0) {
    const key = `${cat}:${id}`;
    const fresh = !this.known.has(key);
    const higher = tier > (this.tiers.get(id) ?? 0);
    if (!fresh && !n && !higher) return;
    this.known.add(key);
    if (higher) this.tiers.set(id, tier);
    const d = this.delta[cat];
    const cur = Object.hasOwn(d, id) ? d[id] : null;
    const t = Math.max(cur?.[2] ?? 0, higher ? tier : 0);
    const e: CodexEntry = [cur ? cur[0] : fresh ? ch : 0, (cur?.[1] ?? 0) + n];
    if (t) e[2] = t;
    d[id] = e;
    this.dirty = true;
  }

  /** 一件货架上的货：法宝（完整件、碎片、器灵都算见过这件法宝）、灵物、丹药、符箓。 */
  private seeOffer(o: ShopOffer, ch: number) {
    if (o.cat === 'weapon' || o.cat === 'spirit') this.note('weapon', o.kind, ch);
    else this.note(o.cat, o.id, ch);
  }

  /** 手里的法宝、灵物、符箓：都算见过；法宝记下现在的品阶。 */
  private scanHeld(w: World, me: number) {
    const p = w.players[me];
    if (!p) return;
    const ch = chapterNow(w);
    // 联机的其他人看的是镜像世界（房主发来的状态拼出来的）：哪一样还没到就当没有
    for (const wpn of p.weapons ?? []) this.note('weapon', wpn.kind, ch, 0, wpn.tier);
    for (const id of Object.keys(p.relics ?? {})) this.note('relic', id, ch);
    for (const id of p.charms ?? []) this.note('charm', id, ch);
  }

  /** 场上的精英是哪一种（现身时记下：斩的时候它可能已经从 w.enemies 里清掉了）。 */
  private elites = new Map<number, { sub: string; affixes: string[] }>();

  /** 上一个事件时的 w.tick：往回走了 = 换了一局（再战、回标题后再开；一局里 tick 只增不减）。 */
  private lastTick = -1;
  /** 这一局的出战记过没有。 */
  private counted = false;
  /**
   * 一局开始：第 1 波（世界建好时就在第 1 波里，没有 waveStart）里的第一个事件——记一局出战，开局自带的（专属法宝）记一次拿到。
   * 从中间开始的（调试的 ?wave=、联机中途进房）不算出战。
   */
  private runStart(w: World, me: number) {
    if (w.tick < this.lastTick) {
      this.counted = false;
      this.elites.clear();
    }
    this.lastTick = w.tick;
    if (this.counted) return;
    const p = w.players[me];
    if (!p) return;
    this.counted = true;
    if (w.wave !== 1 || w.phase !== 'wave') return;
    this.note('hero', p.hero, 0, 1);
    for (const wpn of p.weapons ?? []) this.note('weapon', wpn.kind, 1, 1, wpn.tier);
  }

  /** 每一个模拟事件（单人、房主、联机的其他人都走这里）。me：自己是第几个人物。 */
  onEvent(e: SimEvent, w: World, me: number) {
    this.runStart(w, me);
    switch (e.t) {
      case 'spawn': {
        if (e.kind === 'boss') break;
        const ch = chapterNow(w);
        if (e.kind !== 'elite') {
          this.note('foe', e.kind, ch);
          break;
        }
        // 精英按种类记（elite.回响校尉 / 东海夜叉……），身上的词缀各记一条（affix.迅捷……）
        const en = eliteFields(w, e.id);
        const sub = en?.elite ?? 'xiaowei';
        const affixes = en?.affixes ?? (en?.affix ? [en.affix] : []);
        this.elites.set(e.id, { sub, affixes });
        this.note('foe', `elite.${sub}`, ch);
        for (const a of affixes) this.note('foe', `affix.${a}`, ch);
        break;
      }
      case 'siteOn': // 第二章的十绝阵：亮起来见过一座就记下这一阵（图鉴「十绝阵」一组）
        this.note('foe', `ten.${e.kind}`, chapterNow(w));
        break;
      case 'kill': {
        if (e.kind === 'boss') break;
        let key: string = e.kind;
        let affixes: string[] = [];
        if (e.kind === 'elite') {
          const seen = this.elites.get(e.id);
          const en = seen ? undefined : eliteFields(w, e.id);
          key = `elite.${seen?.sub ?? en?.elite ?? 'xiaowei'}`;
          affixes = seen?.affixes ?? en?.affixes ?? [];
          this.elites.delete(e.id);
        }
        if (e.owner === me) {
          this.note('foe', key, chapterNow(w), 1);
          for (const a of affixes) this.note('foe', `affix.${a}`, chapterNow(w), 1); // 斩了带这条词缀的精英，词缀那一条也记一只
        }
        break;
      }
      // 首领池（sim/bosspool.ts）：池里的每一位不论当首领还是来遭遇战，现身算见过，打倒记一次（同一条：键见 bossKey）
      case 'bossIntro':
        this.note('boss', bossKey(e.kind), e.chapter);
        break;
      case 'echoIntro':
        this.note('boss', bossKey(e.kind), chapterNow(w));
        break;
      case 'echoDefeat':
        this.note('boss', bossKey(e.kind), chapterNow(w), 1);
        break;
      case 'bossDeath':
        this.note('boss', bossKey(e.kind), e.chapter, 1);
        this.flush();
        break;
      case 'waveStart':
        this.scanHeld(w, me);
        this.flush();
        break;
      case 'waveEnd':
        this.flush();
        break;
      case 'shopOpen':
        this.update(w, me);
        this.flush();
        break;
      case 'bought': {
        if (e.owner !== me) break;
        const o = e.offer;
        const ch = chapterNow(w);
        // 法宝只有「新拿到一件」算一次拿到；买同名升阶、碎片、器灵只是炼它（品阶从手里那件读）
        if (o.cat === 'weapon') this.note('weapon', o.kind, ch, e.result === 'new' ? 1 : 0, e.result === 'new' ? o.tier : 0);
        else if (o.cat === 'spirit') this.note('weapon', o.kind, ch, 0, 4);
        else this.note(o.cat, o.id, ch, 1);
        break;
      }
    }
  }

  /** 万宝阁开着时每帧调：货架上的货、手里的法宝。刷新货架没有事件，所以每帧看一眼（五六格，很便宜）。 */
  update(w: World, me: number) {
    const p = w.players[me];
    if (!p) return;
    const ch = chapterNow(w);
    for (const o of p.shop ?? []) if (o) this.seeOffer(o, ch);
    this.scanHeld(w, me);
  }

  /** 并进存档（没有新的就什么都不做）。 */
  flush() {
    if (!this.dirty) return;
    addCodex(this.delta);
    this.delta = defaultCodex();
    this.dirty = false;
  }

  /** 拆局：并进存档，摘掉监听。 */
  dispose() {
    this.flush();
    if (typeof document !== 'undefined') {
      removeEventListener('pagehide', this.onLeave);
      document.removeEventListener('visibilitychange', this.onHide);
    }
  }
}
