// 修仙版 pixelfx 特效接进战斗（fx-wire，2026-11-11）。
//
// 用户 11-10 让评估 pixelfx「能不能用来做特效优化」，第一批 27 个修仙预设（src/render/pixelfx-xianxia.ts 的 XFX）做好以后，
// 这里把「比现在的画面好」的那几个接进战斗，换下原来的画法（不叠两层）；逐个比较的结论和截图见 docs/pixelfx.md「接进战斗」。
// 用户口径：特效要显眼、华丽、出现消失有过程、不要一闪而过；不要光圈；尺寸收着（人物约 16×24）。
//
// 接了什么（事件 → 预设，括号里是换掉的原画法）：
// - 敌人被打死 → soulScatter 魂散（EnemyViews 的闪白压扁 0.14 秒 + feel.ts 的一团天青光点和一粒魂光）。按敌人种类各烘一份剪影，朝左的镜像。
// - 暴击 → critHit；乾坤圈、斩仙飞刀的一般命中 → hitSpark（feel.ts 的三五粒白金火星）。每只敌人 0.3 秒最多一次、同屏有上限，超出的照旧放火星。
// - 冻结 → frozen（fx.ts 的冰壳；化开时碎成冰屑留着）；水行减速 → chilled、晕眩 / 定身 → stunSeal（原来没有画）。
//   灼烧的 burning 比过没换：三处小火苗贴在头顶、肩、腰，敌人自己是暖色（精英的红靠旗、术士的紫袍），火混在身上看不清，
//   满场都在烧时火星又碎；原来那一柱火苗更醒目（fx.ts 照旧画）。
// - 土生金「淬锋」→ armorBreak（fx.ts 相生时的金屑和小星；飘字照旧）。
// - 拾灵石 → stonePickup（三粒天青光点）；吃蟠桃 → peachHeal、拾聚灵符 → talismanGather、开乾坤宝匣 → chestOpen（drops-fx.ts 的光线和粒子；精灵、开盖、奖励字照旧）。
// - 升级 → breakthrough（十几粒上飘的光点）；在万宝阁里悟了功法的，下一波一开场再放一次。
// 换章的云海 chapterClouds 由 feel.ts 的 chapterCurtain 放（chapters 分支接的：合拢时换场景、这期间模拟停着），不在这里。
// 三章的氛围（ambientPetals / ambientSand / ambientMist）比过没接：在游戏里只是零星几个像素，看不出比场景自己飘的桃花瓣、尘土好，
// 却要每两帧现场画一整屏 480×270、合成、上传一次（见 docs/pixelfx.md）。
// 没接的和原因见 docs/pixelfx.md。
//
// 层：ent 直接放进 stage.entities（和角色一起按 y 排序：魂散、身上的状态、宝匣、金莲）；top 在 stage.fx（命中、拾取，盖在角色上面）。
// 性能：全部预烘焙（开局载入时一个接一个画好，播放只是换贴图，同一种的很多份还能合批），没有现场画的。
// 同时在播的个数按种类封顶（CAP），满了就照旧用原来的画法。
import { quality } from '../render/quality.ts';
import { Sprite, type Texture } from 'pixi.js';
import type { Stage } from '../render/stage.ts';
import type { Particles } from '../render/juice.ts';
import { PixelFxLayer, prebake, type FxHandle, type FxId } from '../render/pixelfx.ts';
import { XFX } from '../render/pixelfx-xianxia.ts';
import type { FxOptions } from '../../vendor/pixelfx/src/core/index.js';
import { grid } from '../art/pixel.ts';
import { textureFromGrid } from '../render/textures.ts';
import { BODY, FOE_ART as FOES, actorOf, type Body } from '../render/pixelfx-actor.ts';
import { bossEnemy } from '../sim/boss.ts';
import type { DropKind, Enemy, EnemyKindName, ReactionKind, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { EnemyViews } from './enemy-views.ts';
import type { WeaponFx } from './fx.ts';
import type { DropsFx } from './drops-fx.ts';

/** 同时在播的上限（按种类）。满了的照旧用原来的画法（命中、拾取、魂散）或者不画（新加的减速、晕眩）。 */
export const XFX_CAP = { soul: 28, hit: 10, crit: 6, frozen: 24, chill: 24, stun: 20, armor: 8, stone: 3, chest: 3, peach: 4, talisman: 2, lotus: 4, qi: 1, slam: 4, zap: 16, cut: 8, react: 12, blaze: 10 };
/** 低画质（render/quality.ts）：打死、命中、暴击这三种装饰性的同屏上限减半（满了照旧退回原来的画法）；身上的状态（冻结、减速、眩晕、破甲）不减。 */
export const XFX_CAP_LOW: Partial<typeof XFX_CAP> = { soul: 14, hit: 5, crit: 3, react: 6, blaze: 5 };
/**
 * 魔化哪吒身上的黑焰 demonQi：比过，拿不准，先不开（暂拟，待评审）——紫黑的火舌贴在首领本来就深紫的身上，
 * 魔气是更足了，但轮廓变得发糊、偶尔压到半边头发；首领原来那几粒往上飘的黑焰更干净。要试就改成 true（只影响画面）。
 */
const BOSS_QI = false;
/** 比较用（只在开发时看）：网址带 ?xfxtry=slam,zap,knife 时把法宝的这几处落点也换成修仙版。 */
const TRY = new Set(typeof location === 'undefined' ? [] : (new URLSearchParams(location.search).get('xfxtry') ?? '').split(','));
/** 同一只敌人隔多久才再放一次命中 / 暴击（秒）；拾灵石全局隔多久放一次。 */
const GAP = { hit: 0.3, crit: 0.3, stone: 0.1 };

/** 这种敌人身上的状态按哪种体型摆（表里没有的按回响兵；首领按大个子）。 */
const bodyOf = (kind: EnemyKindName): Body => FOES[kind]?.body ?? (kind === 'boss' ? 'big' : 'mid');

interface Bake {
  key: string;
  id: FxId;
  opts: FxOptions;
}
const preset = (name: string, extra: FxOptions = {}, key = name): Bake => ({ key: `x:${key}`, id: XFX[name].id, opts: { ...XFX[name].opts, ...extra } });

/** 五行相生（fxpolish）：每种一个预设（xianxia/xiangsheng）。 */
const REACT_PRESET = ['reactFrost', 'reactConduct', 'reactIgnite', 'reactLava', 'reactPierce', 'blaze', 'blazeBig'];
const REACT_NAME: Record<ReactionKind, string> = { frost: 'reactFrost', conduct: 'reactConduct', ignite: 'reactIgnite', lava: 'reactLava', pierce: 'reactPierce' };

/** 要预烘焙的全部（开局载入时一个接一个画，中间让出主线程）。 */
function bakeList(): Bake[] {
  // 蟠桃不要身上那团化开的软光（人物身上不要光晕），只留花瓣和两侧升起的光点
  const list: Bake[] = [preset('hitSpark'), preset('critHit'), preset('armorBreak'), preset('stonePickup'), preset('peachHeal', { glow: 0 }), preset('talismanGather'), preset('chestOpen'), preset('breakthrough'), ...REACT_PRESET.map((n) => preset(n)), ...(BOSS_QI ? [preset('demonQi')] : [])];
  if (TRY.has('slam')) for (const r of [22, 27, 31]) list.push(preset('sealSlam', { reach: Math.round(r * 0.72) }, `slam:${r}`));
  if (TRY.has('zap')) list.push(preset('zapHit'), preset('zapHitGold'), preset('zapHitViolet'));
  if (TRY.has('knife')) for (let k = 0; k < 8; k++) list.push(preset('swordCut', { aim: (k * Math.PI) / 4 - Math.PI / 2 }, `cut:${k}`));
  for (const [kind, f] of Object.entries(FOES)) if (f!.soul !== false) list.push(preset('soulScatter', { actor: actorOf(f!.g, f!.a), height: f!.rise }, `soul:${kind}`));
  for (const b of Object.keys(BODY) as Body[]) {
    const body = BODY[b];
    list.push(preset('frozen', { body }, `frozen:${b}`), preset('chilled', { body }, `chilled:${b}`), preset('stunSeal', { body }, `stun:${b}`));
  }
  return list;
}

/** 一只敌人身上正在放的状态效果（follow 读这里的位置；want = false 时那一项收尾）。 */
interface Status {
  x: number;
  y: number;
  z: number;
  flip: boolean;
  seen: number;
  frozen: FxHandle | null;
  chill: FxHandle | null;
  stun: FxHandle | null;
  want: { frozen: boolean; chill: boolean; stun: boolean };
}
type StatusKey = 'frozen' | 'chill' | 'stun';
const STATUS_KEYS: StatusKey[] = ['frozen', 'chill', 'stun'];
/** 每种状态用哪个预设、烘焙的 key 前缀。 */
const STATUS_PRESET: Record<StatusKey, [string, string]> = { frozen: ['frozen', 'frozen'], chill: ['chilled', 'chilled'], stun: ['stunSeal', 'stun'] };

export interface XfxLinks {
  enemyViews: EnemyViews;
  wfx: WeaponFx;
  dropsFx: DropsFx;
  /** 本机的人物是几号（单人是 0；联机时每个人的画面只把自己的拾取画成修仙版，别人的照旧用光点）。 */
  me: () => number;
}

export class XianxiaFx {
  private stage: Stage;
  private sparks: Particles;
  private glows: Particles;
  private ent: PixelFxLayer;
  private top: PixelFxLayer;
  private low: PixelFxLayer; // 贴地（番天印落地的裂纹和尘，比较用）
  /** 已经画好、可以直接放的 key。 */
  private ready = new Set<string>();
  /** 每一类正在放的（数上限用；放完的顺手清掉）。 */
  private live: Record<keyof typeof XFX_CAP, FxHandle[]> = { soul: [], hit: [], crit: [], frozen: [], chill: [], stun: [], armor: [], stone: [], chest: [], peach: [], talisman: [], lotus: [], qi: [], slam: [], zap: [], cut: [], react: [], blaze: [] };
  private status = new Map<number, Status>();
  private lastHit = new Map<number, number>(); // 敌人 id → 上一次命中 / 暴击的时刻
  private lastStone = -1;
  private killed = new Set<number>(); // 这一帧被打死的敌人（EnemyViews 撤精灵时问）
  private world: World | null = null;
  private time = 0;
  private frame = 0;
  private hero = { x: 0, y: 0 }; // 本机的人物（插值后的脚下）
  private heroes: { x: number; y: number }[] = []; // 每个人物（按 id），跟随用
  private me: () => number;
  private lotusOf = new Map<number, FxHandle>(); // 每个人物正在开的金莲（连升几级时不叠）
  private learned = new Set<number>(); // 在万宝阁里悟了功法的人：下一波开场放一次「突破」
  private souls: { s: Sprite; life: number }[] = []; // 魂散超过上限时的旧画法：一粒上升的魂光
  private soulTex: Texture;
  private chillZones: { x: number; y: number; r: number }[] = [];
  private held = new Set<number>(); // 被金绳捆住、旋风卷住的（不再贴镇魂符）
  private qi: FxHandle | null = null; // 魔化哪吒身上的黑焰
  private qiAt = { x: 0, y: 0, z: 0, flip: false, on: false };

  constructor(stage: Stage, sparks: Particles, glows: Particles, links: XfxLinks) {
    this.stage = stage;
    this.sparks = sparks;
    this.glows = glows;
    this.ent = new PixelFxLayer(stage.entities, { flat: true });
    this.top = new PixelFxLayer(stage.fx);
    this.low = new PixelFxLayer(stage.floor);
    this.soulTex = textureFromGrid(SOUL);
    this.me = links.me;
    // 原来的画法在别的模块里：魂散（EnemyViews 撤精灵）、冰壳和相生的金屑（WeaponFx）、宝匣蟠桃聚灵符的光与粒子（DropsFx）。这里接管的就告诉它们不画
    links.enemyViews.onDeath = (id, kind, x, y, dir) => this.soul(id, kind, x, y, dir);
    links.wfx.skipStatus = (id, what) => this.claims(id, what);
    links.wfx.reactFx = (kind, id, x, y) => this.react(kind, id, x, y);
    links.wfx.explodeFx = (x, y, r, ice) => !ice && !!this.play('blaze', this.top, r > 29 ? 'blazeBig' : 'blaze', r > 29 ? 'blazeBig' : 'blaze', { x, y });
    if (TRY.size) links.wfx.impactFx = (what, x, y, r, tier, style) => this.impact(what, x, y, r, tier, style);
    links.dropsFx.onLoot = (kind, x, y, owner) => this.loot(kind, x, y, owner);
    void this.prebakeAll();
  }

  /** 开局载入：一个接一个画好（每个几毫秒到二十几毫秒，中间让出主线程）。没画好的先用原来的画法。 */
  private async prebakeAll() {
    for (const b of bakeList()) {
      try {
        await prebake(b.key, b.id, b.opts);
        this.ready.add(b.key);
      } catch (e) {
        console.warn('xfx 预烘焙失败', b.key, e);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** 正在播的个数（调试、量性能用）。 */
  get count() {
    return this.ent.count + this.top.count + this.low.count;
  }

  /** 这一类还能不能再放一个（顺手清掉放完的）。 */
  private room(k: keyof typeof XFX_CAP): boolean {
    const a = this.live[k];
    for (let i = a.length - 1; i >= 0; i--) if (a[i].done) a.splice(i, 1);
    return a.length < (quality.tier === 'low' ? (XFX_CAP_LOW[k] ?? XFX_CAP[k]) : XFX_CAP[k]);
  }

  private play(k: keyof typeof XFX_CAP, layer: PixelFxLayer, name: string, key: string, at: Parameters<PixelFxLayer['playBaked']>[3]): FxHandle | null {
    const full = `x:${key}`;
    if (!this.ready.has(full) || !this.room(k)) return null;
    const h = layer.playBaked(full, XFX[name].id, XFX[name].opts, at);
    this.live[k].push(h);
    return h;
  }

  clear() {
    this.ent.clear();
    this.top.clear();
    this.low.clear();
    for (const k of Object.keys(this.live) as (keyof typeof XFX_CAP)[]) this.live[k] = [];
    this.status.clear();
    this.lastHit.clear();
    this.killed.clear();
    this.lotusOf.clear();
    this.qi = null;
    this.qiAt.on = false;
    for (const s of this.souls) s.s.destroy();
    this.souls = [];
  }

  onEvent(e: SimEvent, w: World) {
    this.adopt(w);
    switch (e.t) {
      case 'kill':
        if (e.kind !== 'boss') this.killed.add(e.id);
        break;
      case 'hit':
        this.hit(e);
        break;
      case 'pickup':
        this.pickup(e.x, e.y, e.owner);
        break;
      case 'levelup':
        this.breakthrough(e.owner);
        break;
      case 'learn':
        this.learned.add(e.owner);
        break;
      case 'waveStart':
        this.clear();
        for (const id of this.learned) this.breakthrough(id);
        this.learned.clear();
        break;
      case 'waveEnd':
        // 场上的敌人收走了：身上的状态都淡掉（一次性的放完）
        for (const s of this.status.values()) for (const k of STATUS_KEYS) s[k]?.stop();
        this.status.clear();
        break;
    }
  }

  /** 新开了一局（world 换了一个）：全部清掉。 */
  private adopt(w: World) {
    if (w === this.world) return;
    this.world = w;
    this.clear();
    this.learned.clear();
  }

  // ---------- 魂散 ----------

  /** EnemyViews 撤掉一只敌人的精灵时问：被打死的放魂散（返回 true，原来的闪白压扁就不放了）。 */
  private soul(id: number, kind: EnemyKindName, x: number, y: number, dir: 1 | -1): boolean {
    if (!this.killed.has(id)) return false; // 自爆、换波收走的：照旧
    this.killed.delete(id);
    const f = FOES[kind];
    const h = f && f.soul !== false && this.play('soul', this.ent, 'soulScatter', `soul:${kind}`, { x, y, z: y, flip: dir < 0 });
    if (h) return true;
    // 满了（或者还没画好）：原来的画法——一团天青光点、几粒白色碎光、一粒上升的魂光
    const elite = kind === 'elite';
    const big = f?.body === 'big';
    this.glows.emit(x, y - 8, elite ? 34 : big ? 20 : 9, [0x7cc4c4, 0x3f8a9e, 0xffffff], [20, elite ? 120 : big ? 90 : 60], [0.3, 0.7], { up: 20, drag: 3 });
    this.sparks.emit(x, y - 8, elite ? 16 : big ? 9 : 4, 0xffffff, [60, 140], [0.08, 0.18]);
    const s = new Sprite(this.soulTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.position.set(Math.round(x), Math.round(y - 12));
    this.stage.glow.addChild(s);
    this.souls.push({ s, life: 1 });
    return false;
  }

  // ---------- 命中 ----------

  private hit(e: Extract<SimEvent, { t: 'hit' }>) {
    const dot = e.by === 'burn' || e.by === 'bleed' || e.by === 'zone';
    if (dot) return;
    const last = this.lastHit.get(e.id) ?? -9;
    const f = FOES[e.kind];
    const lift = e.kind === 'boss' ? 10 : (f?.dy ?? 0);
    const fromRight = e.x < this.hero.x; // 打过来的方向：火星往背着人物的一侧溅
    const metal = e.by === 'ring' || e.by === 'knife';
    if (this.time - last >= (e.crit ? GAP.crit : GAP.hit)) {
      const at = { x: e.x, y: e.y - lift, flip: fromRight };
      if (e.crit && this.play('crit', this.top, 'critHit', 'critHit', at)) {
        this.lastHit.set(e.id, this.time);
        return;
      }
      if (metal && this.play('hit', this.top, 'hitSpark', 'hitSpark', at)) {
        this.lastHit.set(e.id, this.time);
        return;
      }
    }
    // 原来的：白金色的几粒火星（乾坤圈、飞刀多几粒，暴击再多几粒）
    if (metal) this.sparks.emit(e.x, e.y - 9 - lift, e.crit ? 6 : 3, [0xffffff, 0xf7dc7a], [40, 90], [0.12, 0.25]);
    else this.sparks.emit(e.x, e.y - 9 - lift, 1, [0xffffff, 0xf7dc7a], [30, 70], [0.1, 0.2]);
  }

  /**
   * 五行相生（fxpolish）：每种自己的修仙版（凝霜的冰棱、导雷的细电弧、引燃的叶火与地火、熔岩的地裂与熔滴、淬锋的金锋），
   * 淬锋再叠一个破甲。fx.ts 相生时问；放了返回 true（它就不放原来的火星和一圈方块火苗；飘字照旧）。同屏满了退回原来的画法。
   */
  private react(kind: ReactionKind, id: number, x: number, y: number): boolean {
    const e = this.world ? this.enemy(this.world, id) : undefined;
    const ex = e?.x ?? x;
    const ey = e?.y ?? y;
    const name = REACT_NAME[kind];
    const h = this.play('react', this.top, name, name, { x: ex, y: ey, flip: ex < this.hero.x });
    if (kind === 'pierce') return this.pierce(id, x, y) || !!h;
    return !!h;
  }

  /** 土生金「淬锋」：胸口裂开、甲片崩落（相生的飘字照旧由 fx.ts 出）。fx.ts 相生时问；放了返回 true（它就不放金屑和小星）。 */
  private pierce(id: number, x: number, y: number): boolean {
    const e = this.world ? this.enemy(this.world, id) : undefined;
    const f = e ? FOES[e.kind] : undefined;
    const lift = e?.kind === 'boss' ? 10 : (f?.dy ?? 0);
    return !!this.play('armor', this.top, 'armorBreak', 'armorBreak', { x: e?.x ?? x, y: (e?.y ?? y) - lift, flip: (e?.x ?? x) < this.hero.x });
  }

  /** fx.ts 问：这只敌人的冰壳是不是归这里画了（是就别画原来的）。灼烧没换，一律由 fx.ts 画。 */
  private claims(id: number, what: 'burn' | 'frozen'): boolean {
    if (what !== 'frozen') return false;
    const s = this.status.get(id);
    return !!s?.frozen && !s.frozen.done;
  }

  // ---------- 拾取、掉落、升级 ----------

  /** 人物 id 现在在哪（插值后的脚下；跟随用，返回的是同一个对象，每帧更新）。 */
  private at(id: number) {
    return this.heroes[id] ?? this.hero;
  }

  /**
   * 拾灵石：本机的人物胸口那一点天青白一下、几粒光点迸开上飘。隔 GAP.stone 秒才放一次，波末收灵（一口气几百颗）时不放；
   * 别人捡的、隔得太近的，照旧是三粒天青光点。
   */
  private pickup(x: number, y: number, owner: number) {
    if (owner === this.me() && this.world?.phase !== 'collect' && this.time - this.lastStone >= GAP.stone) {
      const p = this.at(owner);
      if (this.play('stone', this.top, 'stonePickup', 'stonePickup', { x: p.x, y: p.y - 12, follow: () => ({ x: p.x, y: p.y - 12 }) })) {
        this.lastStone = this.time;
        return;
      }
    }
    this.glows.emit(x, y, 3, 0x7cc4c4, [20, 50], [0.15, 0.3]);
  }

  /** DropsFx 拾取时问：宝匣的金光瑞气、蟠桃的回血光、聚灵符收拢的灵气归这里放（返回 true 它就不放原来的光线和粒子）。 */
  private loot(kind: DropKind, x: number, y: number, owner: number): boolean {
    if (kind === 'chest') return !!this.play('chest', this.ent, 'chestOpen', 'chestOpen', { x, y, z: y + 2 });
    if (kind === 'peach') {
      // 回血在吃的人身上（花瓣和两侧升起的光点，跟着他走）
      const p = this.at(owner >= 0 ? owner : this.me());
      return !!this.play('peach', this.top, 'peachHeal', 'peachHeal', { x: p.x, y: p.y, follow: () => p });
    }
    // 聚灵符：灵气收到符面正中（符的精灵脚下往上 5 像素起、约 17 像素高）
    return !!this.play('talisman', this.top, 'talismanGather', 'talismanGather', { x, y: y - 13 });
  }

  /**
   * 升级 / 悟功法：脚下八瓣金莲由合到开、一道细金线冲到头顶（跟着人物走）。金莲放在人物身后（zIndex 比人物小）：
   * 人站在莲台前面，腿不被花瓣挡住。一个人一次只开一朵：连升几级时不叠。
   */
  private breakthrough(owner: number) {
    if (this.lotusOf.get(owner)?.done === false) return;
    const p = this.at(owner);
    const follow = () => ({ x: p.x, y: p.y, z: p.y - 0.5 });
    const h = this.play('lotus', this.ent, 'breakthrough', 'breakthrough', { ...follow(), follow });
    if (h) this.lotusOf.set(owner, h);
    else this.glows.emit(p.x, p.y - 14, 14, [0x7cc4c4, 0xf7dc7a, 0xffffff], [30, 80], [0.3, 0.6], { up: 30 });
  }

  // ---------- 首领 ----------

  /** 魔化哪吒（第一章的首领）：肩、背、后脑四处黑焰火舌（跟着走，朝左时镜像：火在后脑那一侧，不挡脸）。入场显形之后才有，倒下时淡掉。 */
  private updateQi(w: World, alpha: number) {
    const f = w.boss;
    const b = BOSS_QI && f && f.kind === 'nezha' && f.state !== 'intro' && f.state !== 'dead' ? bossEnemy(w) : null;
    const q = this.qiAt;
    q.on = !!b;
    if (!b || !f) return;
    q.x = Math.round(b.px + (b.x - b.px) * alpha);
    q.y = Math.round(b.py + (b.y - b.py) * alpha);
    q.z = q.y + 0.5;
    q.flip = f.facing < 0;
    if (!this.qi || this.qi.done) this.qi = this.play('qi', this.ent, 'demonQi', 'demonQi', { x: q.x, y: q.y, z: q.z, flip: q.flip, fadeIn: 0.6, follow: () => (q.on ? q : null) });
  }

  // ---------- 每帧 ----------

  private enemy(w: World, id: number): Enemy | undefined {
    for (const e of w.enemies) if (e.id === id) return e;
    return undefined;
  }

  /** 每帧一次：寒霜、水域在哪（减速画不画寒气），谁被金绳捆着、旋风卷着（不贴镇魂符）。 */
  private scanZones(w: World) {
    this.chillZones.length = 0;
    this.held.clear();
    for (const z of w.zones) {
      if (z.kind === 'frost' || z.kind === 'water') this.chillZones.push({ x: z.x, y: z.y, r: z.r });
      else if ((z.kind === 'rope' || z.kind === 'whirl') && z.ids) for (const id of z.ids) this.held.add(id);
    }
  }

  /** 冻水的减速（寒气缠足）：带着水行印记，或者站在寒霜、水域里。别的减速（地裂、金莲、混天绫）不画寒气。 */
  private chilly(e: Enemy): boolean {
    if (e.mark === 'water' && e.markT > 0) return true;
    for (const z of this.chillZones) if ((e.x - z.x) ** 2 + (e.y - z.y) ** 2 < (z.r + 6) ** 2) return true;
    return false;
  }

  update(dt: number, w: World, alpha: number) {
    this.adopt(w);
    this.time += dt;
    this.frame++;
    for (const p of w.players) {
      const h = (this.heroes[p.id] ??= { x: 0, y: 0 });
      h.x = Math.round(p.px + (p.x - p.px) * alpha);
      h.y = Math.round(p.py + (p.y - p.py) * alpha);
    }
    const mine = this.heroes[this.me()];
    if (mine) {
      this.hero.x = mine.x;
      this.hero.y = mine.y;
    }
    if (w.phase === 'shop') return; // 万宝阁盖着：不画
    this.scanZones(w);
    // 身上的状态：先定这一帧谁要什么，follow 读位置和 want
    for (const e of w.enemies) {
      const wantFrozen = e.frozen > 0;
      let s = this.status.get(e.id);
      if (!s && !wantFrozen && !(e.slowT > 0) && !(e.stun > 0.4)) continue;
      const wantChill = !wantFrozen && e.slowT > 0 && e.wrapT <= 0 && this.chilly(e);
      // 晕眩：刚晕上的时候还要晕 0.4 秒以上才贴符（分魂鬼刚分出来愣一下、雷法的小晕不贴）；冻住、被混天绫缠着、被金绳捆着的不贴
      const wantStun = !wantFrozen && e.stun > 0 && e.wrapT <= 0 && !this.held.has(e.id) && e.kind !== 'boss' && (!!s?.stun || e.stun > 0.4);
      if (!s) {
        if (!wantFrozen && !wantChill && !wantStun) continue;
        s = { x: 0, y: 0, z: 0, flip: false, seen: 0, frozen: null, chill: null, stun: null, want: { frozen: false, chill: false, stun: false } };
        this.status.set(e.id, s);
      }
      s.seen = this.frame;
      s.x = Math.round(e.px + (e.x - e.px) * alpha);
      s.y = Math.round(e.py + (e.y - e.py) * alpha);
      s.z = s.y + 0.5;
      s.flip = s.x > this.hero.x; // 朝着人物：敌人在右边就朝左（符、火偏在后脑那一侧）
      s.want.frozen = wantFrozen;
      s.want.chill = wantChill;
      s.want.stun = wantStun;
      const body = bodyOf(e.kind);
      for (const k of STATUS_KEYS) {
        if (s[k]?.done) s[k] = null;
        if (s.want[k] && !s[k]) {
          const st = s;
          s[k] = this.play(k, this.ent, STATUS_PRESET[k][0], `${STATUS_PRESET[k][1]}:${body}`, {
            x: s.x,
            y: s.y,
            z: s.z,
            flip: s.flip,
            fadeIn: 0.18,
            follow: () => (st.want[k] && st.seen >= this.frame - 1 ? st : null),
          });
        }
      }
    }
    for (const [id, s] of this.status)
      if (s.seen !== this.frame) {
        // 死了、被收走了：这一帧没出现。把还在放的收掉（死了的魂散盖着，不用等它淡出）
        for (const k of STATUS_KEYS) s[k]?.stop();
        this.status.delete(id);
      }
    this.killed.clear();
    for (let i = this.souls.length - 1; i >= 0; i--) {
      const o = this.souls[i];
      o.s.y -= 30 * dt;
      o.s.alpha -= dt * 1.6;
      if (o.s.alpha <= 0) {
        o.s.destroy();
        this.souls.splice(i, 1);
      }
    }
    for (const [id, t] of this.lastHit) if (this.time - t > 1) this.lastHit.delete(id);
    this.updateQi(w, alpha);
    this.ent.update(dt);
    this.top.update(dt);
    this.low.update(dt);
  }

  /** 比较用：法宝落点换成修仙版（见 TRY）。 */
  private impact(what: 'slam' | 'zap' | 'knife', x: number, y: number, r: number, tier: number, style?: string): boolean {
    if (!TRY.has(what)) return false;
    if (what === 'slam') {
      const k = r <= 24 ? 22 : r <= 29 ? 27 : 31;
      return !!this.play('slam', this.low, 'sealSlam', `slam:${k}`, { x, y });
    }
    if (what === 'zap') {
      const name = style === 'gold' ? 'zapHitGold' : style === 'violet' ? 'zapHitViolet' : 'zapHit';
      return !!this.play('zap', this.top, name, name, { x, y, flip: Math.random() < 0.5 });
    }
    // 飞刀：刀光顺着飞刀的方向（找离命中点最近的那把）
    const w = this.world;
    let best: { vx: number; vy: number } | null = null;
    let bd = 1e9;
    for (const kn of w?.knives ?? []) {
      if (kn.kind && kn.kind !== 'zhanxian') continue;
      const d = (kn.x - x) ** 2 + (kn.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = kn;
      }
    }
    const a = best ? Math.atan2(best.vy, best.vx) : 0;
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return !!this.play('cut', this.top, 'swordCut', `cut:${k}`, { x, y }); // 刀光的中点抬在胸口（预设的 height）
  }
}

/** 魂散超过上限时的那粒魂光（原来 feel.ts 里的）。 */
const SOUL = grid(['.C.', 'CWC', '.C.']);
