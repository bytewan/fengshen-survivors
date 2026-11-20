// 游戏主循环（M1 骨架）：20 波 + 波间升级与商店 + 法宝 / 宠物 / 五行。
// 模拟（src/sim）固定 60Hz 推进，表现层按插值画出来；所有打击感都由模拟发出的事件驱动，只作用在表现层。
// 波间界面只发指令（Command），由模拟执行；联机时同样的指令发给房主。
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { grid } from '../art/pixel.ts';
import { RING_SIZES } from '../art/sprites/nezha.ts';
import { basePose, heroBare, heroFace, heroFrames, HERO_VIEWS, type HeroPose } from './hero-views.ts';
import { HeroFx } from './heroes/index.ts';
import { ORB } from '../art/sprites/caster.ts';
import { digitGlyph, GEM, GEM_BIG } from '../art/sprites/font.ts';
import { atlasFromGrids, flashTextureFromGrid, once, steppedLightTexture, textureFromBitmap, textureFromGrid } from '../render/textures.ts';
import { camCull, FlatLayer, type Flat } from '../render/flat-layer.ts';
import { frameProbe } from './frame-probe.ts';
import { quality } from '../render/quality.ts';
import { createStage, VIEW_H, VIEW_W } from '../render/stage.ts';
import { DamageNumbers, HitStop, Particles, Shake } from '../render/juice.ts';
import type { Sfx } from '../audio/sfx.ts';
import { chapterMusic } from '../audio/bank.ts';
import { ARENA, DT, SKILL } from '../sim/config.ts';

/** 说话人的像素头像：从精灵上裁下头部。 */
const crop = (g: Grid, x: number, y: number, w: number, h: number): Grid => ({ w, h, rows: g.rows.slice(y, y + h).map((r) => r.slice(x, x + w)) });
const DEMON_FACE = crop(DEMON_FRAMES.idle[0], 13, 5, 18, 15);
const YAO_FACE = crop(YAO_FRAMES.idle[0], 7, 1, 18, 15);
const ZX_FACE = crop(ZX_FRAMES.idle[0], 5, 3, 18, 15);
/** 对白里各说话人的名字牌颜色和头像（旁白没有）。玩家操控的角色（哪吒、杨戬……）的在 hero-views.ts（HERO_VIEWS）。 */
const SPEAKERS: Record<string, { color: string; face?: Grid }> = {
  魔化哪吒: { color: '#d9452b', face: DEMON_FACE },
  回响: { color: '#d9452b', face: DEMON_FACE }, // 魔化哪吒（回响化身）在第一章遇到的另一个自己（hero-views.ts 的 HERO_BOSS_AFTER.mozha）
  姚天君: { color: '#b89ac4', face: YAO_FACE },
  诛仙剑灵: { color: '#c3ccd2', face: ZX_FACE },
};
/** 首领池里新进的几位（回响那一族）在对白里的名字牌颜色和头像：回响色的本人，头像从回响色的待机帧上裁（和本人的头像同一个框）。 */
function bossPlate(kind: BossId): { color: string; face?: Grid } | null {
  if (kind === 'aobing') return { color: '#9fd3d6', face: crop(echoPortrait('aobing'), 7, 6, 18, 15) }; // 他自己的一套帧（art/sprites/aobing.ts）
  const base: Partial<Record<BossId, HeroId>> = { zhao: 'zhao', yunxiao: 'yunxiao' };
  const h = base[kind];
  if (!h || (kind !== 'zhao' && kind !== 'yunxiao')) return null;
  const [x, y, w, hh] = HERO_VIEWS[h].face;
  return { color: '#8fc7c9', face: crop(echoPortrait(kind), x, y, w, hh) };
}
/** 战后对白：台词按这一章抽到的首领查（pool-lines.ts；原来的首领是 story.ts / hero-views.ts 的那一套），这里只配名字牌颜色和头像（旁白没有）。 */
const afterLines = (kind: BossId, hero: HeroId): Line[] =>
  afterLinesOf(kind, hero).map((l) => {
    const plate = l.boss ? bossPlate(kind) : null;
    const mine = !l.boss && l.who === HEROES[hero].name;
    return {
      ...l,
      color: plate?.color ?? (mine ? HERO_VIEWS[hero].nameColor : (l.who && SPEAKERS[l.who]?.color) || '#f2e8d5'),
      face: plate ? plate.face : mine ? heroFace(hero) : l.who ? SPEAKERS[l.who]?.face : undefined,
    };
  });
import { CHAPTER_NAME, ECHO, HEROES, chapterOf, isBossWave, waveInChapter, xpToNext } from '../sim/catalog.ts';
import { skillInfo } from '../sim/heroes/index.ts';
import { elementCounts } from '../sim/core.ts';
import { distinctOf } from '../sim/wuxing.ts';
import type { HeroId } from '../sim/types.ts';
import { BOSS_INFO, bossName, fightEnemy, fightOf, isEchoFamily, parseCast, type BossId } from '../sim/bosspool.ts';
import { afterLinesOf, bossTitleOf, cutscenesOf, fightBark, guestEnd, waveLineOf } from './pool-lines.ts';
import { makeLevelOffers, restock } from '../sim/shop.ts';
import { offerTechnique, techSkillRadius } from '../sim/techniques.ts';
import { createWorld, ringGrowth, step, type Command, type PlayerInput, type SimEvent, type World } from '../sim/world.ts';
import { botInput as simBot, botShop } from '../sim/bot.ts';
import { mountHud } from './hud.ts';
import { mountIntermission } from './intermission.ts';
import { WeaponFx } from './fx.ts';
import { ArtifactFx } from './fx-new.ts';
import { ArtifactFx2 } from './fx-new2.ts';
import { RING_BIG } from '../art/sprites/weapons.ts';
import { PetViews } from './pets/index.ts';
import { DropsFx } from './drops-fx.ts';
import { BossFx } from './boss-fx.ts';
import { EnemyViews, foeLooks, type FoeViewKind } from './enemy-views.ts';
import { EnemyFx } from './enemy-fx.ts';
import { TechniqueFx } from './technique-fx.ts';
import { XianxiaFx } from './xfx.ts';
import { RelicFx } from './relic-fx.ts';
import { WuxingFx } from './wuxing-fx.ts';
import { TerrainFx } from './ch2/terrain-fx.ts';
import { Ch2FoeFx } from './ch2/foe-fx.ts';
import { YaoFx } from './ch2/yao-fx.ts';
import { YAO_FRAMES } from '../art/ch2/yao.ts';
import { SwordFx } from './ch3/terrain-fx.ts';
import { Ch3FoeFx } from './ch3/foe-fx.ts';
import { ZhuxianFx } from './ch3/zhuxian-fx.ts';
import { EchoFx, echoPortrait } from './echo-fx.ts';

/** 顶上那条遭遇战的小血条：名字、剩多少气血、透明度（现身时淡入，打倒、退走时淡出）。 */
function echoHud(w: World) {
  const f = w.echo!;
  const e = fightEnemy(w);
  const alpha = f.state === 'intro' ? Math.min(1, (f.t / Math.max(0.1, f.dur)) * 1.3) : f.state === 'dead' ? 1 - f.t / f.dur : 1;
  return { name: bossName(f.kind), frac: e ? Math.max(0, e.hp) / e.maxHp : 0, alpha };
}
import { ZX_FRAMES } from '../art/ch3/zhuxian.ts';
import { openCredits } from './credits.ts';
import { mountDialogue, type Line } from './dialogue.ts';
import { beforeCut, type CutsceneId } from './story.ts';
import { chapterOfWave } from '../sim/chapters.ts';
import { unlock, type UnlockId } from './save.ts';
import { bossEnemy } from '../sim/boss.ts';
import { DEMON_FRAMES } from '../art/sprites/demon-nezha.ts';
import { compose, type Grid } from '../art/pixel.ts';
import { mountLayer, toast, uiSfx } from './front-ui.ts';
import { bindSfx } from './settings.ts';
import { getSettings, hasSeen, loadXiuwei, markSeen, recordRun } from './profile.ts';
import { CodexTracker } from './codex-track.ts';
import { AchRun, sealedItems } from './achievements.ts';
import { mountPause } from './pause.ts';
// 联机（docs/netcode.md）：房主照常跑模拟并广播，其他人只画镜像世界
import type { NetSession } from '../net/session.ts';
import type { HostSide } from '../net/host.ts';
import type { GuestSide } from '../net/guest.ts';
import type { HostMsg } from '../net/protocol.ts';
import { PROTOCOL } from '../net/protocol.ts';
import { restore, type WorldSnapshot } from '../sim/snapshot.ts';
import { pixelTextTexture } from '../render/pixel-text.ts';
import { mountNetHud, type NetHud } from './net-hud.ts';
import { PALETTE } from '../art/palette.ts';
// 劫数与修为（sim/jie.ts、sim/xiuwei.ts）：开局的设定、结算的道行、局里词缀的画面（jie-fx.ts）
import type { RunSetup } from '../sim/world.ts';
import { jieTier } from '../sim/jie.ts';
import { AFFIX_INFO, ELITE_INFO, eliteKind } from '../sim/elites/index.ts';
import { daoBreakdown, wavesCleared, xiuweiPreset } from '../sim/xiuwei.ts';
import { JieFx } from './jie-fx.ts';
import { EliteFx } from './elites/fx.ts';
import { AffixFx } from './elites/affix-fx.ts';

export interface GameOptions {
  /** 用哪个音效对象。默认和标题页、暂停、设置共用一个（全游戏只开一个 AudioContext，设置里的音量直接作用到局内）。 */
  sfx?: Sfx;
  /** 玩家在暂停面板里确认了「回到标题」。这一局先记下成绩，调用方再 dispose() 拆掉、回到标题页。 */
  onQuit?: () => void;
  /** 选的角色（选角页给）。不给就看网址的 ?hero=（调试用，如 ?bot&hero=yangjian），都没有就是哪吒。 */
  hero?: HeroId;
  /** 联机的一局（大厅里开局之后交过来）；不给就是单人。拆局时一并关掉（离开房间）。 */
  net?: NetSession;
  /** 单人这一局的劫数（选劫页给，sim/jie.ts）。不给就看网址的 ?jie=（调试用，如 ?bot&jie=5），都没有就是劫一。联机的劫数在 net 里。 */
  jie?: number;
}

export interface Game {
  /** 拆掉这一局：停主循环、销毁画布、移除界面与按键监听、停音乐。之后可以再开一局。 */
  dispose(): void;
}

/**
 * 只能调一次的拆除函数：调过之后它不再握着这一局。调用方（main.ts）在标题页期间还拿着 Game 对象，
 * 这样那个对象就不会把拆掉的一整局（世界、特效、纹理……）留在内存里。
 */
function disposer(teardown: () => void): () => void {
  let f: (() => void) | null = teardown;
  return () => {
    const g = f;
    f = null;
    g?.();
  };
}

/**
 * 从现在起到调用返回的函数为止，记下新挂到 window 上的 resize 监听（往 bag 里放「摘掉它」的函数）。
 * 战斗界面、万宝阁、对白挂上时各自会给 window 加一个 resize 监听；它们自己带 dispose 的话拆局时会先调，
 * 这里是兜底：漏摘的监听会把整局留在内存里（监听 → 界面的回调 → 这一局），每回一次标题就多留一局。
 * 只在挂界面的那几行同步代码期间生效，只认 window 的 resize，别的监听不碰。
 */
function trackWindowResize(bag: (() => void)[]): () => void {
  const own = Object.getOwnPropertyDescriptor(window, 'addEventListener'); // 一般没有（原版在原型上）
  const add = window.addEventListener;
  window.addEventListener = function (this: Window, type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) {
    add.call(this, type, fn, o);
    if (type === 'resize') bag.push(() => window.removeEventListener(type, fn, o));
  } as typeof window.addEventListener;
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    // 上面那句是在 window 自己身上盖了一个同名属性：删掉它，原型上的原版就露出来了（原来就有自己的那份就放回去）
    if (own) Object.defineProperty(window, 'addEventListener', own);
    else delete (window as { addEventListener?: unknown }).addEventListener;
  };
  queueMicrotask(restore); // 保险：挂界面的那几行万一抛错、没走到调用方的还原，这一段同步代码一结束也会还原
  return restore;
}

/** 主循环里各处出过几次错（按出错的地方记）。 */
const faults = new Map<string, number>();
/**
 * 表现层某一处出错了：记一条日志（同一处只报前三次，免得每帧刷屏），然后照常往下走。
 * 一个特效、一个事件的异常不能把主循环停掉——Pixi 的 ticker 在回调抛错之后不会再排下一帧，整局就定住了。
 */
function fault(where: string, err: unknown) {
  const n = (faults.get(where) ?? 0) + 1;
  faults.set(where, n);
  if (n <= 3) console.error(`[feel] ${where} 出错（第 ${n} 次${n === 3 ? '，之后不再重复报' : ''}）`, err);
}
/**
 * 给一个特效模块的 onEvent / update 各包一层：出错只丢这一次调用，别的模块和主循环照常。
 * 包的那一层每次都去原型上取方法，所以自查脚本事后给原型打的补丁（计时、计数）照样生效。
 */
function guarded<T extends object>(name: string, module: T): T {
  const proto = Object.getPrototypeOf(module) as Record<string, unknown>;
  for (const key of ['onEvent', 'update']) {
    if (typeof proto[key] !== 'function') continue;
    const tag = `${name}.${key}`;
    (module as Record<string, unknown>)[key] = (a: unknown, b: unknown, c: unknown, d: unknown) => {
      const t0 = frameProbe.on ? performance.now() : 0; // ?perf：各模块每帧花多少（frame-probe.ts）
      try {
        return (proto[key] as (...args: unknown[]) => unknown).call(module, a, b, c, d);
      } catch (err) {
        fault(tag, err);
      } finally {
        if (t0) frameProbe.mod(tag, performance.now() - t0);
      }
    };
  }
  return module;
}

export async function startFeelPrototype(mount: HTMLElement, opts: GameOptions = {}): Promise<Game> {
  const params = new URLSearchParams(location.search);
  const botMode = params.has('bot');
  /** 调试开局（机器人、从中间某一波开始）不记成绩，免得测试把玩家的战绩刷乱（解锁照常记）。 */
  const debugRun = botMode || Number(params.get('wave') ?? 1) > 1;
  // ---------- 联机（docs/netcode.md） ----------
  // net 为空就是单人，和原来完全一样。联机时分两种：
  //   房主（host 不为空）：照常 step，多了两件事——每帧把其他人最新的操作喂给模拟、每秒约 15 次广播状态和事件；
  //   其他人（guest 不为空）：不 step，每帧把房主发来的状态打到镜像世界（guest.mirror.world）上，表现层照常画它；
  //   自己的人物按本地操作先走（预测），操作每秒约 30 次发给房主，商店指令也发给房主执行。
  // 房主迁移时两者会互换（onHostChange）。改动都在下面带「联机」字样的几处。
  const net = opts.net ?? null;
  let host: HostSide | null = null;
  let guest: GuestSide | null = null;
  /** 自己是第几个人物（单人永远是 0）。 */
  let me = 0;
  /** 这一局的种子（房主：开局、再战时定；其他人用不着）。 */
  let seed = 0;
  const netHud: NetHud | null = net ? mountNetHud() : null;
  // 拆掉时要移除这一局加进来的样式：先记下现在有哪些
  const headBefore = new Set(document.head.children);
  const stage = await createStage(mount, ARENA.w, ARENA.h);
  const { app, entities, floor, fx, screen, tex } = stage;
  const sfx = opts.sfx ?? uiSfx();
  bindSfx(sfx); // 设置里的音量改了立即作用上来（重复登记无妨）

  // ---------- 纹理 ----------
  // 人物的帧、数字、暗角这些每一局都一样：整个会话只生成一次（textures.ts 的 once），再开一局直接拿
  // 角色：人物帧、画布、锚点按角色取（hero-views.ts）
  // 自己的角色：联机时是大厅里选的（net.slots），单人是选角页给的，调试直接进局的看 ?hero=
  const urlHero = params.get('hero') as HeroId | null;
  const heroId: HeroId = (net && net.slots[Math.max(0, net.me)]?.hero) || opts.hero || (urlHero && HEROES[urlHero] ? urlHero : 'nezha');
  const view = HERO_VIEWS[heroId];
  const frames = heroFrames(heroId);
  const heroTex = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map(textureFromGrid)])) as Record<HeroPose, Texture[]>;
  const heroFlash = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map(flashTextureFromGrid)])) as Record<HeroPose, Texture[]>;
  /** 每个角色的人物纹理（联机时各人按自己的角色画；用到时才建）。 */
  const texByHero = new Map<HeroId, { tex: Record<HeroPose, Texture[]>; flash: Record<HeroPose, Texture[]> }>([[heroId, { tex: heroTex, flash: heroFlash }]]);
  const heroTexOf = (id: HeroId) => {
    let t = texByHero.get(id);
    if (!t) {
      const f = heroFrames(id);
      t = {
        tex: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.map(textureFromGrid)])) as Record<HeroPose, Texture[]>,
        flash: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.map(flashTextureFromGrid)])) as Record<HeroPose, Texture[]>,
      };
      texByHero.set(id, t);
    }
    return t;
  };
  // 敌人（8 种）的精灵、换帧、眼光、死亡都在 enemy-views.ts（按种类查表）
  const orbTex = ORB.map(textureFromGrid);
  const ringTex = [...RING_SIZES, ...RING_BIG].map((fs) => fs.map(textureFromGrid)); // 5、7、9、11、13 像素
  /** 灵石的四帧（小的两帧、大的两帧）排在一张图集里：整层灵石画在一个 ParticleContainer 里（flat-layer.ts，docs/perf.md）。 */
  const gemFrames = atlasFromGrids('gem', [...GEM, ...GEM_BIG]);
  const digits = once('feel:digits', () => ({
    normal: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'normal'))),
    crit: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'crit'))),
    skill: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'skill'))),
    corrode: [...'0123456789'].map((d) => textureFromGrid(digitGlyph(d, 'corrode'))),
  }));
  const eyeTex = steppedLightTexture(3, 2);
  // 灵石和它身上那一点天青的光：各一层（满场时几千颗，做成场景里的节点每帧光重建绘制指令就要好几毫秒）。
  // 灵石这一层平时在贴地层的最上面：每掉一颗新的就把整层挪回最上面（原来每颗新灵石都叠在已有的影子、地面特效上面）
  // 只画镜头里的（满场时几千颗，镜头里的只有四分之一）；灵石换帧（贴图坐标）每帧都可能变
  const gemLayer = new FlatLayer(floor, gemFrames[0], { dynamic: { uvs: true }, cull: camCull(stage.cam) });
  const gemGlowLayer = new FlatLayer(stage.glow, eyeTex, { cull: camCull(stage.cam) });
  const soulTex = once('feel:soul', () => textureFromGrid(grid(['.C.', 'CWC', '.C.'])));

  // ---------- 表现层的工具 ----------
  const shake = new Shake(6, 4, 1.7);
  const hitStop = new HitStop();
  const particles = new Particles(fx, tex.dot);
  const glowParticles = new Particles(stage.glow, tex.dot);
  const numbers = new DamageNumbers(fx, digits);
  const whiteFlash = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0xffffff });
  whiteFlash.alpha = 0;
  const redFlash = new Graphics();
  for (let i = 0; i < 6; i++) redFlash.rect(i, i, VIEW_W - i * 2, VIEW_H - i * 2).stroke({ width: 1, color: 0xd9452b, alpha: 1 - i / 6 });
  redFlash.alpha = 0;
  // 身处魔气时的屏幕四周紫黑暗角（越深越浓，缓慢搏动）
  const miasmaVig = new Sprite(
    once('feel:miasma-vignette', () => {
      // 平滑的圆角暗角：只压四边，不出现任何直线（用户不喜欢「框」和「圈」）
      const data = new Uint8ClampedArray(VIEW_W * VIEW_H * 4);
      for (let y = 0; y < VIEW_H; y++)
        for (let x = 0; x < VIEW_W; x++) {
          const dx = Math.max(0, Math.abs(x - VIEW_W / 2) - (VIEW_W / 2 - 90)) / 90;
          const dy = Math.max(0, Math.abs(y - VIEW_H / 2) - (VIEW_H / 2 - 70)) / 70;
          const d = Math.min(1, Math.hypot(dx, dy));
          if (d <= 0) continue;
          const a = d * d * (3 - 2 * d);
          data.set([40, 18, 46, Math.round(a * 230)], (y * VIEW_W + x) * 4);
        }
      return textureFromBitmap({ w: VIEW_W, h: VIEW_H, data });
    }),
  );
  miasmaVig.alpha = 0;
  const waves: { g: Graphics; t: number; x: number; y: number; max: number; color: number; dur: number }[] = [];
  const stickBase = new Graphics().circle(0, 0, 18).stroke({ width: 1, color: 0xf2e8d5, alpha: 0.6 });
  const stickKnob = new Graphics().circle(0, 0, 7).fill({ color: 0xf2e8d5, alpha: 0.6 });
  stickBase.visible = stickKnob.visible = false;
  let stickDrawnR = 18; // 外圈现在画的半径（见下面画摇杆的地方）
  screen.addChild(miasmaVig, redFlash, whiteFlash, stickBase, stickKnob);

  // ---------- 状态 ----------
  let world: World;
  /** 一个人物的画面：精灵、影子、动作、受击闪白、神通的残影；联机时队友头顶还有一个名字签（tag）。 */
  type HeroView = { s: Sprite; sh: Sprite; pose: 'throw' | 'follow' | null; poseT: number; animT: number; flash: number; after: { s: Sprite; t: number }[]; tag: Sprite | null; tagKey: string; bar: Graphics | null; edge: Graphics | null; hero: HeroId };
  /** 所有人物的画面（下标 = 第几个人物）；hero 是自己的那个（单人就只有它）。 */
  let heroes: HeroView[] = [];
  let hero: HeroView;
  let ringViews: Map<number, { s: Sprite; trail: Sprite[]; hist: [number, number][]; t: number; sparkCd: number }>;
  let gemViews: Map<number, { s: Flat; big: boolean; t: number; glow: Flat }>;
  let orbViews: Map<number, { s: Sprite; t: number; glow: Sprite }>;
  let dying: { s: Sprite; t: number }[];
  let combo = 0;
  let comboT = 0;
  let pickStreak = 0;
  let pickT = 0;
  let killShake = 0;
  let ended = false; // 胜负已分，等玩家重来
  let bestCombo = 0;
  let skillsUsed = 0;
  let localFeedbackAt = -Infinity;
  let localSkillAt = -1;
  // 成绩（存进本地存档 profile.ts）：每局只记一次——陨落、通关、或中途回到标题
  let recorded = false;
  let chapterTimes: Record<number, number> = {};
  /** 这一局的道行（陨落 / 通关面板上写；调试开局照算、只是不记进存档）和这一局新解锁的劫数。 */
  let reward: (ReturnType<typeof daoBreakdown> & { unlocked: number; debug: boolean }) | null = null;
  /** 这一局的成就（achievements.ts）：机器人自动玩、调试开局不记。每次开局（reset）新建一个。 */
  let ach: AchRun | null = null;
  function record(win: boolean) {
    if (recorded) return;
    recorded = true;
    const p = world.players[me] ?? world.players[0];
    const wave = Math.max(1, world.wave);
    reward = { ...daoBreakdown({ cleared: wavesCleared(world), kills: p.kills, win, jie: world.jie }), unlocked: 0, debug: debugRun };
    if (debugRun) return;
    const r = recordRun({ chapter: chapterOf(wave), wave: waveInChapter(wave), time: world.time, kills: p.kills, combo: bestCombo, chapterTimes, win, jie: world.jie, dao: reward.total });
    reward.unlocked = r.unlockedJie;
    ach?.afterRun(); // 成就：累计斩敌、各章、劫数这些按存档对一遍
  }
  /**
   * 这一局的开局设定（sim/world.ts 的 RunSetup）：各人的角色、劫数和每个人点亮的修为。联机按房主开房时选的劫数、各人自己的修为（大厅里随名单带过来）；
   * 单人按选劫页（调试开局看 ?jie=，修为看 ?xw=all / half，不给就不带——机器人、截图的局不受本机存档影响）。
   */
  function runSetup(): RunSetup {
    // 首领池（sim/bosspool.ts）：每局按种子抽每一章谁当首领；调试用 ?boss=aobing / ?boss=nezha,zhao 指定，?boss=legacy 是加首领池之前的排法
    const cast = parseCast(params.get('boss'));
    // 还没解锁的东西（成就奖励，achievements.ts）：万宝阁不刷。联机各人带各人的（大厅里随名单带过来）；机器人、调试开局全开
    if (net) return { heroes: net.slots.map((s) => s.hero), jie: net.jie ?? world?.jie ?? 1, xiuwei: net.slots.map((s) => s.xw), cast, sealed: net.slots.map((s) => s.sl) };
    const xw = params.get('xw');
    const nodes = debugRun ? xiuweiPreset(xw) : loadXiuwei().nodes;
    return { heroes: [heroId], jie: opts.jie ?? (Number(params.get('jie')) || 1), xiuwei: [nodes], cast, sealed: [debugRun ? [] : sealedItems()] };
  }
  const cmds: Command[] = []; // 波间界面发来的指令，下一帧交给模拟
  /** 拆局时要做的收尾（摘监听）。 */
  const cleanups: (() => void)[] = [];
  const untrack = trackWindowResize(cleanups); // 下面三个界面挂上时给 window 加的 resize 监听，拆局时兜底摘掉

  const hud = mountHud(document.body, {
    onSkill: () => (skillPressed = true),
    onRestart: () => again(),
    onQuit: opts.onQuit, // 陨落 / 通关面板上的「回到标题」（成绩在面板弹出时已经记过了）
    onObscured: () => world.phase !== 'shop' && !ended && pause.open(), // 转屏提示盖住画面：打着的时候自动暂停
  });
  const inter = mountIntermission((c) => {
    sfx.unlock();
    cmds.push(c);
  }, sfx);
  const dialogue = mountDialogue(sfx);
  untrack();
  // 劫数在局里的画面：劫五精英的词缀字、分裂的精英裂开、首领狂暴（jie-fx.ts）
  const jieFx = new JieFx(stage, particles, glowParticles, (t, k, sub) => hud.banner(t, k, sub), sfx);
  /**
   * 首领倒下之后的一段：倒下的表现（模拟里约 2.4 秒）→ 收灵 → 放对白 → 有收尾过场的章放过场 → 第一章弹解锁提示 → 才打开商店。
   * 这期间不渲染波间界面，机器人也不发商店指令。
   */
  let outro: { chapter: number; kind: BossId; stage: 'death' | 'dialogue' | 'cutscene' | 'unlock' } | null = null;
  /** 波间旁白（showWaveLine）还在放：放完再开万宝阁（每波大约多等 2 秒）。 */
  let narrating = false;
  /** 回响化身的解锁卡还没放完：万宝阁等它。 */
  let echoCarding = false;
  /** 换章那一波开始时：'cut' 在放这一章的开场过场（整屏盖着，战场和战斗界面都不画），'curtain' 在放云海转场（战场照画）；这期间模拟不推进。 */
  let cine: '' | 'cut' | 'curtain' = '';
  /** 一局里的第几次「重来」：异步的过场、旁白放完时看看还是不是同一局，不是就不再动它。 */
  let runId = 0;
  /** 首领战中的对白气泡：稍等一会儿再出（先让横幅和首领本身亮相）。 */
  let bark: { text: string; at: number } | null = null;
  /** 这一章的首领倒下、第一次解锁了他的可玩版：战后对白放完弹解锁卡（null = 没有）。 */
  let chiefUnlocked: BossId | null = null;
  /** 这一波打倒了回响、第一次解锁了它：万宝阁打开时弹解锁卡（null = 没有）。 */
  let echoUnlocked: BossId | null = null;
  let agitate = 0; // 魔气推进前的翻涌（表现层计时）

  function clearViews() {
    entities.children.filter((c) => (c as { __dyn?: boolean }).__dyn).forEach((c) => c.destroy());
    for (const c of [...fx.children, ...floor.children, ...stage.glow.children]) if ((c as { __dyn?: boolean }).__dyn) c.destroy();
  }
  const dyn = <T extends Container>(c: T) => {
    (c as unknown as { __dyn: boolean }).__dyn = true;
    return c;
  };

  /** 一个人物的画面（精灵 + 影子；名字签用到时再建）。按这个人的角色取帧和锚点（hero-views.ts）。 */
  function makeHero(id: HeroId): HeroView {
    const hv = HERO_VIEWS[id];
    const s = dyn(new Sprite(heroTexOf(id).tex.idle[0]));
    s.anchor.set(hv.anchor.x / hv.w, hv.anchor.y / hv.h);
    entities.addChild(s);
    const sh = dyn(new Sprite(tex.shadow));
    sh.anchor.set(0.5);
    sh.alpha = 0.4;
    floor.addChild(sh);
    return { s, sh, pose: null, poseT: 0, animT: 0, flash: 0, after: [], tag: null, tagKey: '', bar: null, edge: null, hero: id };
  }

  /**
   * 开一局（再战也走这里）。restored：联机迁移房主后，新房主从这一波开始时的存档接着打（不新建世界）。
   * 联机的其他人不建自己的世界：先按同一个种子画出开局的样子，等房主发来第一份整的状态。
   */
  function reset(restored?: World) {
    if (world) clearViews();
    for (const h of heroes) h.edge?.destroy(); // 画面边上指向队友的小箭头在屏幕层里，clearViews 不管它
    // 神通的三圈冲击波也在 clearViews 里被销毁了：这张表要跟着清空，否则下一帧会去画已经销毁的图形、直接抛错
    // （放完神通 0.3 秒内陨落并再战，整局卡死，就是这里）
    waves.length = 0;
    releaseInput();
    localFeedbackAt = -Infinity; localSkillAt = -1;
    me = net ? Math.max(0, net.me) : 0;
    if (net && net.role === 'guest') {
      // 联机 · 其他人
      host = null;
      const placeholder = restored ?? createWorld(net.seed, net.slots.length, runSetup());
      guest = net.asGuest(placeholder);
      guest.mirror.reset(placeholder, me);
      guest.sync();
      world = guest.mirror.world;
    } else {
      seed = net ? net.seed : botMode ? 7 : (Date.now() & 0xffff);
      world = restored ?? createWorld(seed, net ? net.slots.length : 1, runSetup()); // 各人的角色（大厅里选的 / 选角页给的）、劫数、修为
      // 测试用（用户：现在先方便测试）：?wave=6 直接从第 6 波前的商店开始，带一大笔灵石和几次升级，买好再打
      const startAt = Number(params.get('wave') ?? 1);
      if (startAt > 1 && !restored) {
        world.wave = startAt - 1;
        world.phase = 'shop';
        world.enemies = [];
        for (const p0 of world.players) {
          p0.lingshi = Number(params.get('gold') ?? 999);
          p0.level = 1 + Math.round(startAt * 1.6);
          p0.pendingLevels = Math.round(startAt * 1.6);
          p0.levelOffers = makeLevelOffers(world, p0);
          offerTechnique(world, p0); // 功法：这几级里跨过的门槛（第 3 / 8 / 13 级）也要悟（techniques.ts）
          restock(world, p0);
        }
      }
      if (net) {
        // 联机 · 房主：下一份状态发整份；先发一份开局的存档（房主掉线迁移时用）
        guest = null;
        host = net.asHost();
        host.seed = seed;
        host.restart();
        host.save(world, seed);
      }
    }
    heroes = world.players.map((p) => makeHero(p.hero));
    hero = heroes[me];
    ringViews = new Map();
    gemViews = new Map();
    gemLayer.clear();
    gemGlowLayer.clear();
    orbViews = new Map();
    dying = [];
    combo = 0;
    bestCombo = 0;
    ended = false;
    recorded = false;
    reward = null;
    chapterTimes = {};
    ach = new AchRun(!debugRun, { hero: world.players[me]?.hero ?? heroId, jie: world.jie, online: !!net });
    cmds.length = 0;
    wfx?.clear();
    petFx?.clear();
    heroFx?.clear();
    dropsFx?.clear();
    bossFx?.clear();
    yaoFx?.clear();
    enemyViews?.clear();
    enemyFx?.clear();
    eliteFx?.clear();
    affixFx?.clear();
    techFx?.clear();
    terrainFx?.clear();
    ch2Fx?.clear();
    swordFx?.clear();
    ch3Fx?.clear();
    zxFx?.clear();
    curtain?.clear();
    jieFx.clear();
    echoFx?.warm(world); // 这一局会出场的回响化身的帧先拼好（现身那一帧不再现拼，docs/perf.md）
    curtainT = -1; // 还在等转场动画的那一段（chapterCurtain）马上放行，它看 runId 变了就不再动场景
    outro = null;
    narrating = false;
    echoCarding = false;
    cine = '';
    runId++;
    bark = null;
    echoUnlocked = null;
    agitate = 0;
    dialogue.close();
    inter.hide();
    hud.hideDeath();
    // 场景：这一局从哪一章开始就搭哪一章的（?wave=7 在第 6 波后的商店里开局，场景是第二章的）
    stage.setScene(chapterOfWave(world.phase === 'shop' ? world.wave + 1 : world.wave).scene);
    sfx.music(world.phase === 'shop' ? 'shop' : chapterMusic(chapterOf(world.wave), isBossWave(world.wave))); // 配乐按章（audio/bank.ts）
    // 劫数：开局时横幅报一下这一局是劫几（第 1 波没有开波的横幅；劫一不报。sim/jie.ts）
    if (!restored && world.phase === 'wave' && world.wave === 1 && world.jie > 1) {
      const run = runId;
      const t = jieTier(world.jie);
      setTimeout(() => run === runId && hud.banner(`${t.name} · ${t.title}`, 'warn', t.adds.join('；')), 700);
    }
    // 联机：房主收「再战」请求、其他人收开局 / 重开的消息
    if (host) host.onAgain = () => ended && again();
    if (guest) guest.onSlots = (slots) => net && (net.slots = slots);
    if (guest)
      guest.onStart = (m) => {
        if (!net) return;
        net.slots = m.slots;
        net.seed = m.seed;
        if (m.jie) net.jie = m.jie;
        // 迁移之后接着打（resume）：画面先停在现在的样子，等新房主的整份状态；新开一局：从开局的样子等
        reset(m.resume ? world : undefined);
      };
  }

  // ---------- 联机：再战、房主迁移 ----------
  /** 陨落 / 通关之后的「再战」：单人直接重开；联机的房主换个种子重开并告诉所有人；其他人请房主重开。 */
  function again() {
    if (guest) return guest.again();
    if (net && host) {
      net.seed = Date.now() & 0xffff;
      host.send({ t: 'start', seed: net.seed, slots: net.slots, v: PROTOCOL, jie: net.jie ?? world.jie } satisfies HostMsg);
    }
    reset();
  }
  /** 正中提示（接手房主、房主换人、有人进出）亮几秒。 */
  let netNote: { title: string; sub?: string; until: number } | null = null;
  /** 第 i 个人物的名字（联机）。 */
  const netName = (i: number) => net?.slots[i]?.name ?? `第 ${i + 1} 人`;
  if (net)
    net.onHostChange = (meNow) => {
      if (meNow && guest) {
        // 原来的房主掉线 / 离开了，中继指定我接手：从最近一份存档（这一波开始时）重开这一波
        const save = guest.lastSave;
        if (save) {
          net.slots = save.slots;
          net.seed = save.seed;
        }
        // 存档用 sim/snapshot.ts 恢复（逐位精确；不能拿镜像恢复，镜像取过整）。原来的房主那一格：syncRoster 会把他标成托管（还在名单上、掉线了）或去掉（退出了）
        reset(save ? restore(save.data as WorldSnapshot) : undefined);
        host?.send({ t: 'start', seed: net.seed, slots: net.slots, resume: !!save, v: PROTOCOL, jie: world.jie } satisfies HostMsg);
        netNote = { title: '接手房主', sub: save ? '原来的房主不在了 · 从这一波开始重打' : '原来的房主不在了 · 重新开局', until: performance.now() + 3500 };
      } else if (!meNow && host) {
        // 我让位了（切到后台太久）：变成其他人，画面先停着，等新房主的整份状态
        reset(world);
      } else if (guest) {
        const s = net.slots.find((x) => x.id === net.link.host);
        netNote = { title: '房主换人了', sub: `${s?.name ?? '新房主'}接手 · 从这一波开始重打`, until: performance.now() + 3500 };
      }
    };

  /** 过场的代码和画面用到才下载（main.ts 的 chapterIntro 也是这么做的）；下载失败、放的时候出错都不拦着游戏。 */
  const cutsceneMod = () => import('./cutscene.ts');
  /** 放一段过场（收尾、开场）。返回时这一局可能已经重开或拆掉了，调用方自己看 runId。 */
  async function playCut(id: CutsceneId) {
    try {
      const { playCutscene } = await cutsceneMod();
      await playCutscene(id, { sfx, hero: heroId }); // 要画「玩家」的镜头（第三章结尾）画本机玩家的角色
    } catch (err) {
      console.error(err);
    }
  }

  /** 解锁卡上的小像：打倒了谁，解锁的就是谁的可玩版（魔化哪吒用首领那一套帧，回响那一族是回响色的本人）。 */
  const unlockArt = (kind: BossId) => (isEchoFamily(kind) ? echoPortrait(kind) : DEMON_FRAMES.idle[0]);
  /** 解锁卡上的名字：可玩的那个回响化身的名字（sim/catalog.ts 的 ECHO 按解锁 id 找）。 */
  const unlockName = (kind: BossId) => {
    const id = BOSS_INFO[kind].unlock;
    const h = (Object.keys(ECHO) as HeroId[]).find((k) => ECHO[k]?.unlock === id);
    return h ? HEROES[h].name : bossName(kind);
  };
  /** 打倒了 kind（不论它当首领还是来遭遇战）：有可玩版就写进存档解锁。返回 true = 这次是新解锁的（之后弹解锁卡）。机器人自动玩不写。 */
  const unlockBy = (kind: BossId) => {
    const id = BOSS_INFO[kind].unlock;
    return !!id && !botMode && unlock(id as UnlockId);
  };

  /** 遭遇战打倒了、第一次解锁了它：等横幅放完，弹一张解锁卡（和打赢首领那张一样）。 */
  async function echoUnlockCard(kind: BossId) {
    const run = runId;
    echoUnlocked = null;
    echoCarding = true;
    try {
      await hud.bannerDone();
      while (narrating && run === runId) await new Promise((r) => setTimeout(r, 120)); // 波间旁白放完再弹，免得卡和旁白叠在一起
      if (run !== runId) return;
      sfx.play('ui.levelup');
      await dialogue.unlockCard('解锁回响化身', unlockName(kind), unlockArt(kind));
    } finally {
      if (run === runId) echoCarding = false;
    }
  }

  /** 收灵结束、商店要开了：先放对白；有收尾过场的章，对白之后放过场；第一次打倒这一位（有可玩版的）再弹「解锁回响化身」；然后才打开商店。 */
  async function bossOutro(chapter: number, kind: BossId) {
    const run = runId;
    await hud.bannerDone(); // 「平定」的横幅放完再往下：收灵很快时，对白或商店会把它半路盖掉
    while (pause.paused) await new Promise((r) => setTimeout(r, 120)); // 横幅按真实时间走、暂停管不住：这期间暂停了就等继续再放对白
    if (!outro || run !== runId) return; // 中途重开了，或这一局已经拆掉（回到标题）
    const cuts = cutscenesOf(chapter, kind); // 过场跟着这一章抽到的首领走（pool-lines.ts）
    const end = botMode ? undefined : cuts.end; // 机器人自动玩（截图、自测）不放过场
    const all = afterLines(kind, heroId);
    // 有收尾过场：对白框只放散去那一句（cue: 'dissolve'）之前的几句，从那一句起交给过场的画面（story.ts 的 beforeCut），免得出现两遍；
    // 过场不带散去那一镜的（keepDissolve），散去那一句留在对白框里，之后的交给过场
    const lines = !end ? all : cuts.keepDissolve ? all.slice(0, all.findIndex((l) => l.cue === 'dissolve') + 1 || all.length) : beforeCut(all);
    if (lines.length) {
      outro = { chapter, kind, stage: 'dialogue' };
      // 旁白那一句（魔化哪吒化作灰烬、姚天君散进阵眼）出现时，倒下的首领开始散去
      await dialogue.play(lines, { auto: botMode, onLine: (l) => l.cue === 'dissolve' && dissolveBoss() });
      if (!outro || run !== runId) return; // 中途重开了
    }
    dissolveBoss();
    if (end) {
      outro.stage = 'cutscene';
      await playCut(end);
      if (!outro || run !== runId) return;
    }
    if (chiefUnlocked === kind) {
      // 第一次打倒这一位：弹解锁卡（存档在他倒下的那一刻已经写了）
      chiefUnlocked = null;
      outro.stage = 'unlock';
      sfx.play('ui.levelup');
      await dialogue.unlockCard('解锁回响化身', unlockName(kind), unlockArt(kind));
      if (!outro || run !== runId) return;
    }
    outro = null;
    sfx.music('shop');
  }

  /** 通关面板（整局打赢）：这一局的用时、斩敌、劫与修为（再来一局 / 回到标题）；通关后提示导出存档码（设计文档「存档」）。 */
  function winPanel() {
    sfx.music('ending'); // 通关面板也放结局的曲子（从结局过场过来的已经在放，接着放）
    setTimeout(() => toast('全部平定 · 进度已存在本机；回到标题页，在「设置 → 存档码」里可以导出备份', 9000), 2500);
    dissolveBoss(); // 最后一章的首领：倒下的表现放完就散去
    outro = null;
    hud.showDeath({ time: world.time, kills: world.players[me].kills, combo: bestCombo, wave: world.wave, win: true, jie: world.jie, dao: reward ?? undefined });
  }

  /**
   * 首发版的结局（最后一章的首领倒下之后）：「平定」的横幅 → 战后对白（带 dissolve 的那一句旁白交给过场）→ 结尾过场
   * （门缝里的剪影，大字「三章平定 · 未完待续」）→ 致谢 → 通关面板（这一局得的修为；从那里再来一局或回到标题）。
   * 通关在 'win' 那一刻已经记进存档（record）。这期间不出暂停面板、不出战斗界面；中途重开 / 拆局就收手。
   */
  async function finale(chapter: number, kind: BossId) {
    const run = runId;
    outro = { chapter, kind, stage: 'death' };
    hud.banner('平定', 'boss', CHAPTER_NAME[chapter]);
    await hud.bannerDone();
    if (!outro || run !== runId) return;
    const end = cutscenesOf(chapter, kind).end;
    const all = afterLines(kind, heroId);
    const lines = end ? beforeCut(all) : all;
    if (lines.length) {
      outro.stage = 'dialogue';
      await dialogue.play(lines, { onLine: (l) => l.cue === 'dissolve' && dissolveBoss() });
      if (!outro || run !== runId) return;
    }
    dissolveBoss();
    sfx.music('ending'); // 结局的曲子（笛子）：从结尾过场一直放到致谢、通关面板
    if (end) {
      outro.stage = 'cutscene';
      await playCut(end);
      if (!outro || run !== runId) return;
    }
    if (chiefUnlocked === kind) {
      // 最后一章的首领也有可玩版的（回响云霄）：第一次打倒，致谢之前弹解锁卡
      chiefUnlocked = null;
      outro.stage = 'unlock';
      sfx.play('ui.levelup');
      await dialogue.unlockCard('解锁回响化身', unlockName(kind), unlockArt(kind));
      if (!outro || run !== runId) return;
    }
    // 致谢：盖在战场上（战场照画、压暗一点），按「返回」收起，接着弹通关面板
    outro.stage = 'unlock';
    const layer = mountLayer('fs-thanks', 9);
    try {
      await openCredits({ layer, sfx });
    } catch (err) {
      console.error(err);
    } finally {
      layer.dispose();
    }
    if (!outro || run !== runId) return;
    // 劫与修为：这一局得的修为在通关面板上（和别的结局一样），所以致谢之后不直接回标题
    winPanel();
  }

  /** 普通波打完：战场上淡入一行旁白（story.waveLine），放完再开万宝阁。 */
  async function waveNarration(wave: number) {
    const text = waveLineOf(heroId, wave, world.cast); // 别的角色有自己的一套旁白；首领前一波的那一句跟着抽到的首领走（pool-lines.ts）
    if (!text) return;
    const run = runId;
    narrating = true;
    try {
      const { showWaveLine } = await cutsceneMod();
      if (run === runId) await showWaveLine(text, { delay: 0.9 });
    } catch (err) {
      console.error(err);
    }
    if (run === runId) narrating = false;
  }

  /**
   * 换章那一波开始时放这一章的开场过场（第二章起；story.CHAPTER_CUTSCENES 里还没登记的章节不放）。放的时候模拟停着。
   * 规则同第一章的开场（main.ts 的 chapterIntro）：这台设备上只自动放第一次（跳过也算看过），网址带 ?intro 每次都放；
   * 带调试参数直接进局（?wave=）的不自动放。不放的时候照旧是云海转场。
   */
  async function chapterIntro(chapter: number) {
    // 联机时不放开场过场、只放约 2.4 秒的云海转场：过场各放各的、长短不一，房主看完（或跳过）就接着打，没看完的人人物白站着挨打
    const intro = botMode || net ? undefined : cutscenesOf(chapter, world.cast[chapter - 1]?.chief).intro; // 点了名的镜头跟着这一章抽到的首领换（pool-lines.ts）
    const id = intro && (params.has('intro') || (!debugRun && !hasSeen(intro))) ? intro : undefined;
    if (chapter <= 1) return; // 第一章的开场在选完角色、进局之前放（main.ts）
    if (!id) return chapterCurtain();
    const run = runId;
    cine = 'cut';
    await playCut(id);
    markSeen(id);
    if (run === runId) cine = '';
    stage.setScene(chapterOfWave(world.wave).scene);
  }

  /** 换章转场用的一层 pixelfx（屏幕坐标，盖在战场最上面；第一次换章时才建）。 */
  let curtain: { update(dt: number): void; clear(): void } | null = null;
  /** 云海转场放了多久（按画面的时间走：慢机器上掉帧时也和云的动画对得上）。 */
  let curtainT = -1;
  /** 等云海转场的动画走到 t 秒。 */
  const curtainAt = (t: number) =>
    new Promise<void>((r) => {
      const check = () => (curtainT < 0 || curtainT >= t ? r() : setTimeout(check, 30));
      check();
    });
  /**
   * 换章转场（还没有开场过场的章）：两岸云海从左右翻涌合拢（pixelfx 预设 chapterClouds，xfx 分支做的，约 2.4 秒），
   * 合拢的那一会儿把场景换成新一章的，再散开；这期间模拟停着。特效的代码用到才下载，出错就直接换场景、不拦着游戏。
   */
  async function chapterCurtain() {
    const run = runId;
    const scene = chapterOfWave(world.wave).scene;
    cine = 'curtain';
    try {
      const [{ PixelFxLayer }, { XFX }] = await Promise.all([import('../render/pixelfx.ts'), import('../render/pixelfx-xianxia.ts')]);
      if (run === runId) {
        const layer = (curtain ??= new PixelFxLayer(stage.screen));
        const P = XFX.chapterClouds;
        await (layer as InstanceType<typeof PixelFxLayer>).playId(P.id, { ...P.opts, x: 0, y: 0 });
        curtainT = 0;
        await curtainAt(1.0); // 合拢（约 0.95 秒）
        if (run === runId) {
          stage.setScene(scene);
          await curtainAt(1.42); // 整屏月白停一下，再散开
        }
      }
    } catch (err) {
      console.error(err);
    }
    if (run !== runId) return; // 中途重开了：reset 已经把转场收掉、cine 清掉
    curtainT = -1;
    stage.setScene(scene);
    cine = '';
  }

  // ---------- 输入 ----------
  // 这一局挂在 window / document 上的监听都带这个信号，拆局时一次摘干净
  const life = new AbortController();
  const on = { signal: life.signal };
  const keys = new Set<string>();
  let skillPressed = false;
  const onKeyDown = (e: KeyboardEvent) => {
    sfx.unlock();
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'j') skillPressed = true;
    if (k === 'r' && ended) again();
    keys.add(k);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  addEventListener('keydown', onKeyDown, on);
  addEventListener('keyup', onKeyUp, on);
  // 摇杆：(ox, oy) 是按下的位置（画面坐标，按在画布外的空边里时会落在画面之外），(dx, dy) 是推出去多少
  const stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0, r: 18 };
  const STICK_R = 18;
  /**
   * 摇杆推满要多远：平时 18 个画面像素；竖着拿手机时画面只有横屏的一半多大，18 个画面像素不到 15 个 CSS 像素，
   * 拇指一抖方向就乱——所以至少 26 个 CSS 像素（和手机横屏时差不多），按下的那一刻按画布的大小换算（stick.r，画面像素）。
   */
  const STICK_MIN_CSS = 26;
  const canvas = app.canvas;
  const toView = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H] as const;
  };
  /** 松开所有按着的东西：方向键、摇杆、还没用掉的神通键。 */
  function releaseInput() {
    keys.clear();
    Object.assign(stick, { active: false, id: -1, dx: 0, dy: 0 });
    skillPressed = false;
  }
  /**
   * 按在界面上的不算摇杆。战斗界面、万宝阁、对白、暂停这些层只有能点的地方才接指针（其余地方穿透到画布），
   * 所以按下的目标落在它们里面，就是点在了按钮或面板上；别的层想排除，给元素加 data-no-stick。
   */
  const NOT_STICK = '#hud, #inter, #dlg, #rotate, .fs-layer, [data-no-stick], button, a, input, select, textarea';
  // 指针监听挂在整个页面上：手机上画面两侧有空边，拇指常常就放在那里，按在画布外面也要能起摇杆
  addEventListener(
    'pointerdown',
    (e) => {
      sfx.unlock();
      if (stick.active || ended) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(NOT_STICK)) return;
      const [x, y] = toView(e);
      const cw = canvas.getBoundingClientRect().width || VIEW_W;
      Object.assign(stick, { active: true, id: e.pointerId, ox: x, oy: y, dx: 0, dy: 0, r: Math.max(STICK_R, Math.round((STICK_MIN_CSS * VIEW_W) / cw)) });
      // 拖出窗口也接着收得到移动和松手（触屏本来就跟着按下的元素走，鼠标要自己捕获）
      try {
        target?.setPointerCapture(e.pointerId);
      } catch {
        // 这个指针捕获不了（比如脚本合成的事件）：不要紧，只是拖出窗口后收不到松手
      }
    },
    on,
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (!stick.active || e.pointerId !== stick.id) return;
      const [x, y] = toView(e);
      let dx = x - stick.ox;
      let dy = y - stick.oy;
      const m = Math.hypot(dx, dy);
      if (m > stick.r) {
        dx = (dx / m) * stick.r;
        dy = (dy / m) * stick.r;
      }
      stick.dx = dx;
      stick.dy = dy;
    },
    on,
  );
  const endStick = (e: PointerEvent) => {
    if (e.pointerId === stick.id) Object.assign(stick, { active: false, id: -1, dx: 0, dy: 0 });
  };
  addEventListener('pointerup', endStick, on);
  addEventListener('pointercancel', endStick, on);
  // 窗口失焦、切到后台：松手的那一下这个页面收不到（键会一直算按着，回来后人物自己走），所以先全部松开；
  // 正打着的时候顺手暂停——键盘已经不在这个窗口上了，人物没人管（机器人自己玩的时候不停）
  addEventListener(
    'blur',
    () => {
      releaseInput();
      if (!botMode && !ended && world.phase !== 'shop') pause.open();
    },
    on,
  );
  document.addEventListener('visibilitychange', () => document.hidden && releaseInput(), on);

  function readInput(): PlayerInput {
    if (botMode) return botInput();
    let mx = 0;
    let my = 0;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (stick.active && Math.hypot(stick.dx, stick.dy) > 3) {
      mx = stick.dx / stick.r;
      my = stick.dy / stick.r;
    }
    const skill = skillPressed;
    skillPressed = false;
    return { mx, my, skill };
  }

  /** 试玩机器人（截图和自测用），逻辑在 src/sim/bot.ts。 */
  function botInput(): PlayerInput {
    return simBot(world, me, 0.6);
  }

  // ---------- 事件 → 打击感 ----------
  function onEvents(ev: SimEvent[], now: number) {
    for (const e of ev) {
      wfx.onEvent(e, world);
      afx.onEvent(e, world); // 后加的 8 件法宝（fx-new.ts；一波开始 / 结束、重开时自己清空）
      afx2.onEvent(e, world); // 再加的 11 件法宝（fx-new2.ts；同上）
      petFx.onEvent(e, world); // 宠物按种类分派（pets/）
      heroFx.onEvent(e, world); // 角色的法宝、神通、被动（heroes/；哪吒的照旧在下面和 fx.ts）
      dropsFx.onEvent(e, world);
      bossFx.onEvent(e, world, now);
      yaoFx.onEvent(e, world, now); // 第二章的首领姚天君（ch2/yao-fx.ts；两个首领的画面各管各的，按 world.boss.kind）
      enemyViews.onEvent(e); // 受击闪白、盾兵挡格亮符、引信计时
      enemyFx.onEvent(e, world); // 新敌人的预警线、出手、爆炸、分裂
      eliteFx.onEvent(e, world); // 各章的精英：夜叉潜水与拍浪、力士的金光、剑侍的剑（elites/fx.ts）
      affixFx.onEvent(e, world); // 精英词缀：反震、召唤、分魂、坚甲挨打的金屑（elites/affix-fx.ts）
      terrainFx.onEvent(e, world); // 第二章的地形：阵亮起、落雷、阵边冒兵、红水掉血（ch2/terrain-fx.ts）
      ch2Fx.onEvent(e, world); // 第二章的新敌人：风吼妖的冲刺、红沙、落魂幡的魂光（ch2/foe-fx.ts）
      swordFx.onEvent(e, world); // 第三章的地形：四剑出鞘、剑气路径与斩出去的剑光（ch3/terrain-fx.ts）
      ch3Fx.onEvent(e, world); // 第三章的新敌人：飞剑灵的瞄准线、门徒的剑气、傀儡的剑气线（ch3/foe-fx.ts）
      zxFx.onEvent(e, world, now); // 第三章的首领诛仙剑灵（ch3/zhuxian-fx.ts；按 world.boss.kind 各管各的）
      echoFx.onEvent(e, world); // 回响化身遭遇战（echo-fx.ts）
      techFx.onEvent(e, world); // 功法：天雷、莲花、反弹、碎冰、传火……（technique-fx.ts）
      wuxingFx.onEvent(e, world); // 五行三件档的金气、藤蔓、震地（wuxing-fx.ts）
      relicFx.onEvent(e, world); // 灵物、符箓：金刚琢、小雷、照妖镜、混元伞、定身符……（relic-fx.ts；换局时自己清空）
      xfx.onEvent(e, world); // 修仙版 pixelfx：魂散、命中、暴击、身上的状态、拾取、宝匣、突破（xfx.ts）
      codex.onEvent(e, world, me); // 图鉴：见到、拿到、斩了什么（codex-track.ts）
      switch (e.t) {
        case 'throw': {
          const h = heroes[e.owner];
          if (h) {
            // 掷出 → 收手的姿势只给要它的角色（哪吒；杨戬的出招姿势在 heroes/，见 HeroView.throwPose）
            if (HERO_VIEWS[world.players[e.owner]?.hero ?? 'nezha'].throwPose) {
              h.pose = 'throw';
              h.poseT = 0;
            }
            if (!net || e.owner === me) sfx.throw();
          }
          break;
        }
        case 'hit': {
          const dot = e.by === 'burn' || e.by === 'bleed' || e.by === 'zone'; // 持续伤害不闪白、跳字只显示一部分
          if (e.by === 'ring' || e.by === 'knife') sfx.hit(e.crit); // 命中的火星、暴击在 xfx.ts
          // 灼烧的跳字只显示一部分，免得满屏数字
          if (getSettings().damageNumbers && (!dot || Math.random() < 0.3)) {
            const top = e.kind === 'boss' ? 36 : (foeLooks()[e.kind as FoeViewKind]?.top ?? 22); // 跳字从头顶冒出来
            numbers.spawn(e.x, e.y - top, e.dmg, e.by === 'skill' || dot ? 'skill' : e.crit ? 'crit' : 'normal');
          }
          if (e.kind === 'elite' && e.by === 'ring') shake.add(0.06);
          break;
        }
        case 'kill': {
          if (e.kind === 'boss') break; // 首领倒下的画面由 boss-fx 管（bossDeath）
          const mine = !net || e.owner === me; // 联机：连斩和斩敌的音阶只算自己斩的，别人斩的只出画面（单人一律算）
          if (mine) {
            combo++;
            comboT = 1.1;
            bestCombo = Math.max(bestCombo, combo);
            hud.combo(combo);
          }
          const elite = e.kind === 'elite';
          // 魂散（敌人化成天青魂影散掉）在 xfx.ts
          if (elite) {
            hitStop.trigger(now, 0.075);
            shake.add(0.3); // 精英多了以后不再每只都震（11-12 起 Shake 只认特殊时刻，0.3 不震）
            sfx.eliteKill();
          } else if (mine) {
            if (killShake < 0.22) {
              shake.add(0.025);
              killShake += 0.025;
            }
            sfx.kill(combo);
          }
          break;
        }
        case 'corrode':
          if (getSettings().damageNumbers) numbers.spawn(e.x + (Math.random() - 0.5) * 8, e.y - 30, Math.max(1, Math.round(e.dmg)), 'corrode');
          glowParticles.emit(e.x, e.y - 10, 4, [0x8a4a7a, 0xd47aa0, 0x4b2a4f], [10, 30], [0.4, 0.7], { up: 18 });
          break;
        case 'cast':
          sfx.cast();
          break;
        case 'orb':
          sfx.orb();
          glowParticles.emit(e.x, e.y, 6, [0x7cc4c4, 0xffffff], [20, 60], [0.15, 0.3]);
          break;
        case 'dispel':
          glowParticles.emit(e.x, e.y, 12, [0x7cc4c4, 0xffffff, 0xf7dc7a], [40, 110], [0.2, 0.45]);
          sfx.dispel();
          break;
        case 'pickup':
          if (net && e.owner !== me) break; // 联机：别人捡的不响（拾灵石的光在 xfx.ts）
          pickStreak++;
          pickT = 0.6;
          // 拾灵石不再出声（用户 2026-11-12：「捡东西的音效太刺耳，可以考虑去掉」）；画面上的拾取光照旧（xfx.ts）。sfx.pickup 留着，以后要换柔和的声音再接回来
          break;
        case 'hurt':
          if (heroes[e.owner]) heroes[e.owner].flash = 0.16;
          else hero.flash = 0.16;
          if (net && e.owner !== me) {
            // 联机：队友挨打只在他身上闪一下、溅几点血
            particles.emit(e.x, e.y - 12, 5, [0xd9452b, 0xf2814a], [40, 90], [0.15, 0.3]);
            break;
          }
          redFlash.alpha = 1;
          shake.add(0.4);
          hitStop.trigger(now, 0.06);
          particles.emit(e.x, e.y - 12, 10, [0xd9452b, 0xf2814a], [50, 110], [0.2, 0.4]);
          sfx.hurt();
          hud.hurt(e.hp / world.players[me].stats.maxHp);
          break;
        case 'dodge':
          particles.emit(e.x, e.y - 12, 5, [0xffffff, 0xc9bcae], [30, 70], [0.12, 0.25]);
          break;
        case 'down':
          if (!net || e.owner === me) shake.add(0.7);
          if (e.t2) particles.emit(e.x, e.y - 6, 8, [0x9a8a86, 0xc9bcae], [20, 50], [0.2, 0.4]); // 联机：倒地（等人扶）
          break;
        // ---- 联机的事件（net-sim：coop.ts / roster.ts）：持续的状态（倒地、扶起进度、出局、托管）每帧从 Player 上读，这里只放那一刻的画面和提示 ----
        case 'revive':
          glowParticles.emit(e.x, e.y - 12, 16, [0xf7dc7a, 0xffffff, 0x7cc4c4], [30, 80], [0.35, 0.7], { up: 26 });
          if (e.owner === me || e.by.includes(me)) sfx.levelUp();
          if (e.owner !== me && e.by.includes(me)) netNote = { title: '扶起来了', sub: netName(e.owner), until: performance.now() + 1800 };
          break;
        case 'out':
          glowParticles.emit(e.x, e.y - 8, 10, [0x9a8a86, 0x6b5a62], [15, 40], [0.4, 0.8], { up: 14 });
          break;
        case 'rejoin':
          glowParticles.emit(e.x, e.y - 12, 14, [0x7cc4c4, 0xffffff], [25, 70], [0.3, 0.6], { up: 24 });
          break;
        case 'join':
          if (e.owner !== me) netNote = { title: '有人进来了', sub: `${netName(e.owner)}加入 · 下一波一起打`, until: performance.now() + 3000 };
          break;
        case 'leave':
          netNote = { title: '有人走了', sub: `${netName(e.owner)}离开了房间`, until: performance.now() + 3000 };
          break;
        case 'away':
          if (e.owner !== me) netNote = e.away ? { title: '同伴掉线了', sub: `${netName(e.owner)}先交给机器人托管`, until: performance.now() + 3000 } : { title: '同伴回来了', sub: netName(e.owner), until: performance.now() + 2000 };
          break;
        case 'gift':
          if (e.to === me) toast(`${netName(e.owner)}送你 ${e.amount} 枚灵石`, 3000);
          break;
        case 'over':
          sfx.music(null);
          ended = true;
          record(false);
          hud.showDeath({ time: world.time, kills: world.players[me].kills, combo: bestCombo, wave: world.wave, jie: world.jie, dao: reward ?? undefined });
          break;
        case 'chapterClear':
          chapterTimes[e.chapter] = world.time;
          whiteFlash.alpha = 0.4;
          shake.add(0.4);
          sfx.skill();
          hud.banner('平定', 'boss', CHAPTER_NAME[e.chapter]);
          break;
        case 'win': {
          // 最后一章的首领打赢：这一章也算平定（存档记下这一章的用时）、整局通关
          const ch = chapterOf(world.wave);
          chapterTimes[ch] ??= world.time;
          record(true);
          sfx.music(null); // 首领倒下：先静一下，结局的曲子从结尾过场起（finale / winPanel）
          ended = true;
          whiteFlash.alpha = 0.8;
          shake.add(0.8);
          sfx.skill();
          // 首发版的结局（第三章）：战后对白 → 结尾过场（门缝、剪影，大字「三章平定 · 未完待续」）→ 致谢 → 通关面板（这一局的修为；再来一局 / 回到标题）。
          // 机器人自动玩（截图、自测）、没有结尾过场的，直接弹通关面板
          const chief = world.cast[ch - 1]?.chief ?? chapterOfWave(world.wave).boss.kind;
          if (!botMode && cutscenesOf(ch, chief).end) void finale(ch, chief);
          else winPanel();
          break;
        }
        case 'levelup': {
          if (!net || e.owner === me) sfx.levelUp(); // 「突破」的金莲在 xfx.ts
          break;
        }
        case 'waveStart': {
          wfx.clear();
          petFx.clear();
          dropsFx.clear();
          bossFx.clear();
          yaoFx.clear();
          zxFx.clear();
          enemyFx.clear();
          eliteFx.clear();
          affixFx.clear();
          techFx.clear();
          // 换章：第 7 波开始换成第二章的场景（法宝、等级、灵物都不重置，只换战场）；这一章有开场过场就先放，没有就云海转场（合拢时换场景）
          if (waveInChapter(e.wave) === 1 && e.wave > 1) void chapterIntro(chapterOf(e.wave));
          else stage.setScene(chapterOfWave(e.wave).scene);
          sfx.waveStart();
          sfx.music(chapterMusic(chapterOf(e.wave), !e.duration)); // 这一章的战斗曲 / 首领曲（audio/bank.ts）
          // 首领波的横幅由 bossIntro 出（首领的名字）
          // 劫二起横幅下面写着这一局的劫数（sim/jie.ts）
          if (e.duration) hud.banner(`${CHAPTER_NAME[chapterOf(e.wave)]} · 第 ${waveInChapter(e.wave)} 波`, 'warn', world.jie > 1 ? `${jieTier(world.jie).name} · ${jieTier(world.jie).title}` : undefined);
          break;
        }
        case 'waveEnd':
          wfx.clear();
          petFx.clear();
          dropsFx.clear();
          enemyFx.clear();
          eliteFx.clear();
          sfx.waveEnd();
          if (!outro) {
            hud.banner('平 定', 'skill'); // 首领波的「平定」已经由 chapterClear 出过了
            if (!net) void waveNarration(e.wave); // 联机直接进商店，不让各端旁白的加载与播放时间阻挡操作
          }
          break;
        case 'shopOpen':
          if (outro) void bossOutro(outro.chapter, outro.kind);
          else {
            sfx.music('shop');
            if (echoUnlocked) void echoUnlockCard(echoUnlocked);
          }
          break;
        // ---- 遭遇战（本章第 4 波的精英换成池里没当首领的那一位；sim/bosspool.ts）----
        case 'echoIntro': {
          sfx.drumHit(true);
          hud.banner(bossName(e.kind), 'boss', '回响化身');
          const t = fightBark(e.kind, heroId, 'intro');
          if (t) bark = { text: t, at: now + 1.2 };
          break;
        }
        case 'echoPhase': {
          whiteFlash.alpha = 0.18;
          const t = fightBark(e.kind, heroId, 'phase2');
          if (t) bark = { text: t, at: now + 0.4 };
          break;
        }
        case 'echoDefeat':
          bark = null;
          whiteFlash.alpha = 0.3;
          hud.banner('回响平息', 'boss', guestEnd(e.kind).win);
          // 打倒了：写进存档解锁（机器人自动玩不写），第一次解锁的在这一波的万宝阁打开时弹解锁卡
          if (unlockBy(e.kind)) echoUnlocked = e.kind;
          break;
        case 'echoLeave':
          bark = null;
          hud.banner('回响散去', 'warn', guestEnd(e.kind).gone);
          break;
        case 'bossIntro': {
          const title = bossTitleOf(e.kind); // 这一章抽到的首领（首领池）
          hud.banner(title.name, 'boss', title.sub);
          const t = fightBark(e.kind, heroId, 'intro'); // 首领对这个角色说的话（pool-lines.ts）
          if (t) bark = { text: t, at: now + 1.1 };
          break;
        }
        case 'bossPhase': {
          whiteFlash.alpha = 0.25;
          const kind = world.boss?.kind ?? 'nezha';
          hud.banner(bossTitleOf(kind).phases[e.phase === 2 ? 0 : 1], 'boss');
          const t = fightBark(kind, heroId, e.phase === 2 ? 'phase2' : 'phase3');
          if (t) bark = { text: t, at: now + 1.5 }; // 横幅开始淡出时再说
          break;
        }
        case 'bossMiasmaWarn':
          agitate = 1.3;
          break;
        case 'bossMiasma':
          agitate = Math.max(agitate, 0.5);
          break;
        case 'bossDeath':
          bark = null;
          outro = { chapter: e.chapter, kind: e.kind, stage: 'death' };
          if (unlockBy(e.kind)) chiefUnlocked = e.kind; // 有可玩版的首领：倒下的那一刻就写进存档，解锁卡等战后对白放完再弹
          whiteFlash.alpha = 0.5;
          sfx.music(null);
          break;
        case 'evolve':
          if (!net || e.owner === me) sfx.levelUp();
          break;
        case 'skill': {
          // 联机：队友放神通——冲击波、碎光、残影照样画在他身上，但不停顿、不闪屏、不出横幅，震屏也轻
          const mine = !net || e.owner === me;
          const h = (net && heroes[e.owner]) || hero;
          if (e.kind) {
            // 别的角色的神通（杨戬「天眼」）：画面在 heroes/，这里只给打击感和横幅
            if (mine) {
              skillsUsed++;
              hitStop.trigger(now, 0.08);
              shake.add(0.5);
              whiteFlash.alpha = 0.3;
              if (now - localFeedbackAt >= 1.5) {
                sfx.skill();
                hud.banner(skillInfo(e.kind).name, 'skill');
              }
            } else shake.add(0.15);
            break;
          }
          if (mine) {
            skillsUsed++;
            hitStop.trigger(now, 0.12);
            shake.add(0.9);
            whiteFlash.alpha = 0.55;
          } else shake.add(0.2);
          for (const [color, dur, max] of [
            [0xf7dc7a, 0.22, SKILL.radius],
            [0xd9452b, 0.3, SKILL.radius * 0.8],
            [0xffffff, 0.16, SKILL.radius * 0.55],
          ] as const) {
            const g = dyn(new Graphics());
            fx.addChild(g);
            waves.push({ g, t: 0, x: e.x, y: e.y - 8, max, color, dur });
          }
          particles.emit(e.x, e.y - 10, 60, [0xd9452b, 0xf2814a, 0xf7dc7a, 0xffffff], [80, 260], [0.3, 0.7], { drag: 3 });
          // 三头六臂的残影
          for (let k = 0; k < 3; k++) {
            const a = dyn(new Sprite(heroTexOf(world.players[e.owner]?.hero ?? heroId).flash.idle[0]));
            a.anchor.copyFrom(h.s.anchor);
            a.tint = [0xd9452b, 0xf7dc7a, 0xd9452b][k];
            a.position.copyFrom(h.s.position);
            a.scale.x = h.s.scale.x;
            entities.addChild(a);
            h.after.push({ s: a, t: -k * 0.06 });
          }
          sfx.skill();
          if (mine) hud.banner('三头六臂', 'skill');
          break;
        }
        case 'spawn':
          if (e.kind === 'elite') {
            sfx.drumHit(true);
            // 精英按章是哪一种、带的词缀（sim/elites/）：横幅写名字，下面一行写词缀
            const el = world.enemies.find((x) => x.id === e.id);
            const sub = (el?.affixes ?? []).map((a) => `${AFFIX_INFO[a].name} · ${AFFIX_INFO[a].desc}`).join('　');
            hud.banner(`${ELITE_INFO[el ? eliteKind(el) : 'xiaowei'].name}现身`, 'warn', sub || undefined);
          }
          break;
        case 'surge':
          sfx.drumHit(true);
          hud.banner('回响合围', 'warn');
          break;
      }
      // 成就（achievements.ts）：放在最后——打倒回响化身时上面先写解锁、弹解锁卡，成就随后补上
      ach?.onEvent(e, world, me);
    }
  }

  // ---------- 视图同步（以后联机时，非房主客户端也只做这一步） ----------
  function syncViews(alpha: number) {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    // 敌人：enemy-views.ts（在主循环里和别的特效一起 update）
    // 乾坤圈
    const rseen = new Set<number>();
    for (const r of world.rings) {
      rseen.add(r.id);
      let v = ringViews.get(r.id);
      if (!v) {
        const s = dyn(new Sprite(ringTex[0][0]));
        s.anchor.set(0.5);
        const trail = [0.45, 0.25, 0.12].map((a) => {
          const t = dyn(new Sprite(ringTex[0][0]));
          t.anchor.set(0.5);
          t.alpha = a;
          t.tint = 0xffd070;
          fx.addChild(t);
          return t;
        });
        fx.addChild(s);
        v = { s, trail, hist: [], t: 0, sparkCd: 0 };
        ringViews.set(r.id, v);
      }
      const x = lerp(r.px, r.x);
      const y = lerp(r.py, r.y);
      v.hist.unshift([x, y]);
      if (v.hist.length > 10) v.hist.pop();
      const fi = Math.floor(v.t * 20) % 2;
      const g = ringGrowth(r);
      const size = (g < 1 + 0.25 ? 0 : g < 1 + 0.5 ? 1 : 2) + ((r.tier ?? 1) >= 3 ? 2 : (r.tier ?? 1) >= 2 ? 1 : 0); // 5 → 7 → 9 像素，灵品大一档、仙品起再大一档
      v.s.texture = ringTex[size][fi];
      v.s.position.set(Math.round(x), Math.round(y));
      v.trail.forEach((t, k) => {
        const h = v.hist[Math.min(v.hist.length - 1, (k + 1) * 3)];
        t.texture = ringTex[size][(fi + k + 1) % 2];
        t.position.set(Math.round(h[0]), Math.round(h[1]));
      });
      // 不加光圈（用户：武器不要俗气的光圈），只在飞行时偶尔落下一两粒金色碎光
      v.sparkCd -= 1 / 60;
      if (v.sparkCd <= 0) {
        v.sparkCd = 0.05 + Math.random() * 0.05;
        particles.emit(x, y, 1, [0xf7dc7a, 0xffe9a8], [4, 14], [0.18, 0.32], { drag: 4 });
      }
    }
    for (const [id, v] of ringViews) {
      if (rseen.has(id)) continue;
      v.s.destroy();
      v.trail.forEach((t) => t.destroy());
      ringViews.delete(id);
    }
    // 灵石（两层 ParticleContainer：flat-layer.ts）
    const gseen = new Set<number>();
    let gemBorn = false;
    for (const g of world.gems) {
      if (g.ingot) continue; // 赵公明「金鞭」迸出来的金元宝：画在 heroes/jinbian-fx.ts
      gseen.add(g.id);
      let v = gemViews.get(g.id);
      if (!v) {
        const big = g.value >= 2; // 精英、首领的大灵石（值 3）；普通敌人的是 1.15（M4 数值平衡），照旧画小的
        const s = gemLayer.add(gemFrames[big ? 2 : 0], 0.5, 1);
        const glow = gemGlowLayer.add(eyeTex, 0.5, 0.5);
        glow.tint(0x7cc4c4, 0.5);
        v = { s, big, t: Math.random() * 3, glow };
        gemViews.set(g.id, v);
        gemBorn = true;
      }
      const x = Math.round(lerp(g.px, g.x));
      const y = Math.round(lerp(g.py, g.y) + Math.sin(v.t * 4) * 0.6);
      v.s.texture = gemFrames[(v.big ? 2 : 0) + (Math.floor(v.t * 3) % 2)];
      v.s.x = x;
      v.s.y = y;
      v.glow.x = x;
      v.glow.y = y - 2;
    }
    for (const [id, v] of gemViews) {
      if (gseen.has(id)) continue;
      gemLayer.remove(v.s);
      gemGlowLayer.remove(v.glow);
      gemViews.delete(id);
    }
    if (gemBorn && floor.children[floor.children.length - 1] !== gemLayer.box) floor.addChild(gemLayer.box); // 新灵石叠在已有的影子、地面特效上面
    // 鬼火
    const oseen = new Set<number>();
    for (const o of world.orbs) {
      if (o.kind) continue; // 截教门徒的剑气（kind 'qi'）由 ch3/foe-fx.ts 画
      oseen.add(o.id);
      let v = orbViews.get(o.id);
      if (!v) {
        const s = dyn(new Sprite(orbTex[0]));
        s.anchor.set(0.5);
        fx.addChild(s);
        v = { s, t: 0, glow: dyn(stage.addGlow(eyeTex, 0x7cc4c4, 0.5)) };
        orbViews.set(o.id, v);
      }
      const x = Math.round(lerp(o.px, o.x));
      const y = Math.round(lerp(o.py, o.y));
      v.s.texture = orbTex[Math.floor(v.t * 10) % 2];
      v.s.position.set(x, y);
      v.glow.position.set(x, y);
      if (Math.random() < 0.5) glowParticles.emit(x, y, 1, [0x7cc4c4, 0x3f8a9e], [4, 12], [0.2, 0.4], { drag: 3 });
    }
    for (const [id, v] of orbViews) {
      if (oseen.has(id)) continue;
      v.s.destroy();
      v.glow.destroy();
      orbViews.delete(id);
    }
    // 哪吒（联机时每个人一个；队友头顶一个很小的名字签）
    while (heroes.length < world.players.length) heroes.push(makeHero(world.players[heroes.length].hero));
    let mine = { hx: 0, hy: 0 };
    let mate: { hx: number; hy: number } | null = null;
    for (const pl of world.players) {
      const h = heroes[pl.id];
      if (!h) continue;
      const at = drawHero(h, pl, lerp);
      if (pl.id === me) mine = at;
      else if (!mate && pl.alive) mate = at;
    }
    // 联机：自己出局了（这一波不再回来），镜头跟着一个活着的队友
    if (net && world.players[me]?.out && world.phase !== 'shop' && mate) return mate;
    return mine;
  }

  /** 名字签的颜色（按第几个人物）：缃、天青、桃红、葱黄。不发光、不加框，只一圈玄色描边。 */
  const TAG_COLORS = ['Y', 'C', 'm', 'L'];
  /**
   * 联机：不在画面里的队友，在画面边上朝他的方向画一个很小的三角（他名字签的颜色）；倒在地上等人扶的，三角亮一些、慢慢一明一暗——
   * 不然倒在画面外的人没人找得到。不发光、不加框。
   */
  function edgeMarks(sx: number, sy: number) {
    const t = performance.now() / 1000;
    for (const pl of world.players) {
      const h = heroes[pl.id];
      if (!h || pl.id === me) continue;
      const gone = !!pl.left || (!!pl.out && world.phase !== 'shop') || world.phase === 'shop';
      const x = h.s.x - stage.cam.x + sx;
      const y = h.s.y - 12 - stage.cam.y + sy;
      const inside = x > 4 && x < VIEW_W - 4 && y > 4 && y < VIEW_H - 4;
      if (gone || inside) {
        if (h.edge) h.edge.visible = false;
        continue;
      }
      if (!h.edge) {
        h.edge = new Graphics();
        screen.addChild(h.edge);
      }
      const cx = VIEW_W / 2;
      const cy = VIEW_H / 2;
      const dx = x - cx;
      const dy = y - cy;
      const k = Math.min((cx - 9) / Math.max(1e-6, Math.abs(dx)), (cy - 9) / Math.max(1e-6, Math.abs(dy)));
      const ex = Math.round(cx + dx * k);
      const ey = Math.round(cy + dy * k);
      const a = Math.atan2(dy, dx);
      const down = (pl.down ?? 0) > 0;
      const r = down ? 5 : 4;
      const col = parseInt((PALETTE[TAG_COLORS[pl.id % TAG_COLORS.length]] ?? '#f2e8d5').slice(1), 16);
      const pt = (ang: number, d: number) => [ex + Math.cos(a + ang) * d, ey + Math.sin(a + ang) * d] as const;
      const [x0, y0] = pt(0, r);
      const [x1, y1] = pt(2.4, r);
      const [x2, y2] = pt(-2.4, r);
      h.edge.clear().poly([x0, y0, x1, y1, x2, y2]).fill({ color: col }).stroke({ width: 1, color: 0x1a1520, alpha: 0.9 });
      h.edge.alpha = down ? 0.75 + 0.25 * Math.sin(t * 4) : 0.8;
      h.edge.visible = true;
    }
  }
  function drawHero(h: HeroView, p: World['players'][number], lerp: (a: number, b: number) => number) {
    const hx = Math.round(lerp(p.px, p.x));
    const hy = Math.round(lerp(p.py, p.y));
    // 姿势：倒下 / 出招（杨戬的刀，heroes/）/ 投掷（乾坤圈）/ 受击 / 跑或站（手里有没有法宝，hero-views.ts）。按这个人的角色取帧
    const hv = HERO_VIEWS[p.hero];
    const T = heroTexOf(p.hero);
    if (h.hero !== p.hero) {
      // 这一格换了人（离开的人的格子给了中途加入的新人）：换成新人的角色
      h.hero = p.hero;
      h.s.anchor.set(hv.anchor.x / hv.w, hv.anchor.y / hv.h);
    }
    const base = basePose(p, heroBare(p, heroFx.busy(p.id)));
    const pose: HeroPose = !p.alive && hv.hurtFrames ? 'down' : (heroFx.pose(p.id) ?? h.pose ?? (h.flash > 0 && hv.hurtFrames ? 'hurt' : base));
    const set = h.flash > 0 ? T.flash : T.tex;
    const fr = set[pose] ?? set[base]; // 飞的几组帧（fly / dive / slam）只有会飞的角色画了（hero-views.ts）
    h.s.texture = fr[Math.floor(h.animT * (p.moving ? 10 : 5)) % fr.length];
    if (h.flash > 0) h.s.tint = 0xff9a8a;
    else if (p.miasma > 0) {
      const k = Math.min(1, p.miasma * 1.2);
      const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
      h.s.tint = (mix(255, 200) << 16) | (mix(255, 160) << 8) | mix(255, 220);
    } else h.s.tint = 0xffffff;
    h.s.scale.x = p.facing;
    // 离地多高（雷震子「风雷翅」腾空、俯冲，被动「生翅」踩在减速的地上时脚下离地一点；heroes/）：人物往上画，影子留在地上、变小变淡。
    // 飞着的时候无敌是神通给的，不闪
    const lift = heroFx.lift(p.id);
    h.s.alpha = p.iframes > 0 && h.flash <= 0 && !heroFx.airborne(p.id) ? (Math.floor(p.iframes * 20) % 2 ? 0.45 : 1) : 1;
    h.s.position.set(hx, hy - lift);
    h.s.zIndex = hy;
    h.sh.position.set(hx, hy);
    h.sh.scale.set(1 - Math.min(0.45, lift / 50));
    h.sh.alpha = 0.4 * (1 - Math.min(0.5, lift / 40));
    if (!net) return { hx, hy };
    // ---- 联机（net-sim 的 Player.down / rescue / out / away / left）----
    // 离开的、出局的（这一波不再回来）不画；倒地的人侧躺在地上、颜色压暗，头上一道细细的扶起进度（不画光圈）
    const gone = !!p.left || (!!p.out && world.phase !== 'shop');
    const down = (p.down ?? 0) > 0;
    h.s.visible = h.sh.visible = !gone;
    h.s.rotation = down && !hv.hurtFrames ? (p.facing > 0 ? -Math.PI / 2 : Math.PI / 2) : 0; // 自己画了倒下（单膝跪地）的角色不用侧躺
    if (down) {
      h.s.alpha = 0.85;
      h.s.tint = 0x9a8a96;
      h.s.position.set(hx, hy - 2);
    } else if (!p.alive) h.s.alpha = 0.35;
    if (down) {
      if (!h.bar) {
        h.bar = dyn(new Graphics());
        fx.addChild(h.bar);
      }
      const k = Math.max(0, Math.min(1, p.rescue ?? 0));
      const W = 14;
      h.bar.clear().rect(hx - W / 2 - 1, hy - 14, W + 2, 3).fill({ color: 0x1a1520, alpha: 0.7 });
      if (k > 0) h.bar.rect(hx - W / 2, hy - 13, Math.max(1, Math.round(W * k)), 1).fill({ color: (p.helpers?.length ?? 0) > 0 ? 0xf7dc7a : 0xc9bcae });
      h.bar.visible = true;
    } else if (h.bar) h.bar.visible = false;
    if (p.id !== me) {
      // 名字签：名字（最多四个字），托管中的换成银灰、后面跟一个「托」
      const name = [...(net.slots[p.id]?.name ?? `${p.id + 1}`)].slice(0, 4).join('');
      const key = `${name}|${p.away ? 1 : 0}`;
      if (h.tagKey !== key) {
        h.tagKey = key;
        h.tag?.destroy();
        h.tag = dyn(new Sprite(pixelTextTexture(p.away ? `${name}·托` : name, { color: p.away ? 'i' : TAG_COLORS[p.id % TAG_COLORS.length], outline: 'k' })));
        h.tag.anchor.set(0.5, 1);
        fx.addChild(h.tag);
      }
      if (h.tag) {
        h.tag.visible = !gone;
        h.tag.position.set(hx, down ? hy - 16 : hy - hv.tag);
        h.tag.alpha = p.alive || down ? 0.9 : 0.45;
      }
    }
    return { hx, hy };
  }

  // ---------- 主循环 ----------
  const wfx = new WeaponFx(stage, particles, glowParticles, shake, sfx);
  const afx = new ArtifactFx(stage, particles, glowParticles, shake, sfx);
  const afx2 = new ArtifactFx2(stage, particles, glowParticles, shake, sfx);
  const petFx = new PetViews(stage, particles, sfx);
  const heroFx = new HeroFx(stage, particles, glowParticles, shake, sfx, { sprite: (i) => heroes[i]?.s, tex: heroTexOf }); // tex：孙悟空「法天象地」换成放大的那一张（heroes/faxiang-fx.ts）
  const dropsFx = new DropsFx(stage, particles, glowParticles, sfx);
  const bossFx = new BossFx(stage, particles, glowParticles, shake, hitStop, sfx);
  const yaoFx = new YaoFx(stage, particles, glowParticles, shake, hitStop, sfx);
  const zxFx = new ZhuxianFx(stage, particles, glowParticles, shake, hitStop, sfx);
  const echoFx = new EchoFx(stage, particles, glowParticles, shake, sfx); // 回响化身遭遇战（第 10、16 波；echo-fx.ts）
  /** 倒下的首领散去（对白里的 dissolve、对白放完、通关）。 */
  const dissolveBoss = () => {
    bossFx.dissolve();
    yaoFx.dissolve();
    zxFx.dissolve();
    echoFx.dissolve(); // 回响那一族当首领时（首领池）
  };
  /** 倒下的首领还在场上时镜头要照顾到它（人物和首领之间）。 */
  const bossFocus = () => bossFx.focus ?? yaoFx.focus ?? zxFx.focus ?? echoFx.corpseFocus;
  const enemyViews = new EnemyViews(stage, particles, glowParticles);
  const enemyFx = new EnemyFx(stage, particles, glowParticles, shake, sfx);
  const eliteFx = new EliteFx(stage, particles, glowParticles, shake, sfx); // 各章的精英（elites/fx.ts）
  const affixFx = new AffixFx(stage, particles, glowParticles, shake, sfx, enemyViews); // 精英词缀（elites/affix-fx.ts）
  const terrainFx = new TerrainFx(stage, particles, glowParticles, shake, sfx, numbers);
  const ch2Fx = new Ch2FoeFx(stage, particles, glowParticles, shake, sfx);
  const swordFx = new SwordFx(stage, particles, glowParticles, shake, sfx);
  const ch3Fx = new Ch3FoeFx(stage, particles, glowParticles, shake, sfx);
  // 功法的画面；法天象地要把人物换成大一圈的同一帧，所以把人物精灵和 feel 自己的纹理交给它
  const techFx = new TechniqueFx(stage, particles, glowParticles, shake, sfx, { sprite: (id) => heroes[id]?.s, frames, tex: heroTex, flash: heroFlash, anchor: { ...view.anchor, w: view.w, h: view.h } });
  // 灵物、符箓的画面（每个人的按触发它的那个人画）；遁地符要把那个人画淡，所以把每个人的精灵交给它
  const relicFx = new RelicFx(stage, particles, glowParticles, shake, sfx, (id) => heroes[id]?.s);
  const wuxingFx = new WuxingFx(stage, particles, shake, sfx); // 五行三件档：金气、藤蔓、震地（wuxing-fx.ts；换局时自己清空）
  const xfx = new XianxiaFx(stage, particles, glowParticles, { enemyViews, wfx, dropsFx, me: () => me }); // 修仙版 pixelfx（开局在后台预烘焙）
  const codex = guarded('codex', new CodexTracker()); // 图鉴的记录点（codex-track.ts）：见到、拿到、斩了什么；拆局时并进存档
  cleanups.push(() => codex.dispose());
  reset();
  // 各特效模块的 onEvent / update 出错时只丢那一次调用（见 guarded）
  for (const [name, m] of Object.entries({ wfx, afx, afx2, jieFx, petFx, heroFx, dropsFx, bossFx, yaoFx, zxFx, enemyViews, enemyFx, eliteFx, affixFx, techFx, terrainFx, ch2Fx, swordFx, ch3Fx, relicFx, wuxingFx, xfx })) guarded(name, m);
  /** 一次只交一个事件给 onEvents，这样一个事件出错不会连累同一步里的其余事件（比如紧跟着的「陨落」）。 */
  const oneEvent: SimEvent[] = [];
  // 镜头：平时锁在人物身上；首领倒下后的那一段对准人物和倒下的首领之间
  const camPos = { x: 0, y: 0, k: 0 };
  let acc = 0;
  let now = 0;
  let botShopT = 0;
  let guestBotShop = 0; // 联机的其他人开着 ?bot：上一次替自己在商店里点的时刻
  let lastHero = { hx: ARENA.w / 2, hy: ARENA.h / 2 };
  let paused = false; // 截图用：定住画面（模拟和表现都不推进）
  /** 联机：上一帧和中继的连接状态（断了又连上时，房主补发一份整的状态、其他人要一份整的）。 */
  let lastLinkState = net?.link.state ?? 'open';
  const NO_INPUT: PlayerInput = { mx: 0, my: 0, skill: false };
  // 暂停（pause.ts）：Esc / P / 手机右上角的小牌。暂停时这一帧什么都不推进（模拟、表现、计时都停），画面停在原样。
  const pause = mountPause({
    sfx,
    onPause() {
      releaseInput(); // 松开方向键和摇杆，继续时不会自己走
      sfx.setMiasma(0);
      // 联机：房主暂停 = 全房暂停（模拟就在房主这里）；其他人暂停只是自己的面板，局照常在打、人物原地不动
      if (host) {
        host.flush(world, true);
        host.send({ t: 'pause', on: true, why: 'menu' });
      } else if (guest) toast('联机中只有房主能让全房暂停：你的人物先原地不动', 4000);
    },
    onResume() {
      if (host) host.send({ t: 'pause', on: false, why: 'menu' });
    },
    onQuit() {
      if (world.time > 10) record(false); // 打了一会儿才算一局
      opts.onQuit?.();
    },
  });
  /**
   * 主循环的一帧。出了没人接住的错就丢掉这一帧剩下的部分、记一条日志：
   * 不能让异常传到 Pixi 的 ticker 里去——它在回调抛错之后不再排下一帧，整局从此定住。
   */
  const tick = (ticker: { deltaMS: number }) => {
    frameProbe.begin();
    try {
      frame(ticker);
    } catch (err) {
      fault('主循环', err);
    }
  };
  const frame = (ticker: { deltaMS: number }) => {
    // 对白、解锁提示放着的时候不响应暂停（Esc 留给对白的「跳过」）；万宝阁打开时藏起右上角的小牌（不压住灵石）
    pause.setEnabled(!cine && (!outro || outro.stage === 'death'));
    pause.setButtonVisible(world.phase !== 'shop' || !!outro);
    if (paused || pause.paused) return;
    // 神通键只在打着的时候算数：万宝阁里、战后对白里、收灵时按的空格 / J 不留到下一波（否则一开场就把攒满的真气放空）
    if (world.phase !== 'wave' || outro || ended || cine) skillPressed = false;
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    now += dt;
    if (world.phase === 'wave' && !outro && !ended && !cine) quality.frame(ticker.deltaMS); // 画质：自动档掉帧了换低档、装饰粒子跟着帧率走（render/quality.ts）
    // 联机：和中继的连接断了 / 重连上了
    const linkState = net?.link.state ?? 'open';
    if (net && linkState !== lastLinkState) {
      if (linkState === 'open' && lastLinkState === 'lost') {
        // 断的这段时间里的状态都没收到 / 没发出去：房主下一份发整份，其他人要一份整的
        host?.restart(false);
        guest?.sync();
      }
      lastLinkState = linkState;
    }
    // 兜底：自己的身份和中继说的对不上（换房主的那条消息错过了）——我以为自己是房主、其他人已经不是了，就变回其他人；反过来同理
    if (net && linkState === 'open') {
      if (host && net.role === 'guest') net.onHostChange?.(false);
      else if (guest && net.role === 'host') net.onHostChange?.(true);
    }
    // 房主自己连不上中继时停下模拟（其他人看不到、操作也到不了，接着打只会让他们白白挨打）
    const netHold = !!host && linkState !== 'open';
    /** 万宝阁先别开：首领战后的对白 / 过场 / 解锁提示还没放完，或者波间旁白还在。 */
    const holdShop = !!outro || narrating || echoCarding;
    // 模拟：固定步长，不受命中停顿影响；波间阶段只处理指令。章节开场过场放着的时候不推进
    if (guest) {
      // 联机 · 其他人：不推进模拟。商店指令和操作发给房主，房主的状态打到镜像上，到点的事件交给表现层
      for (const c of cmds.splice(0)) guest.sendCommand(c);
      // 机器人（?bot，测试用）：商店里每 0.4 秒替自己点一下（单人时这件事在下面房主的循环里做）
      if (botMode && world.phase === 'shop' && !holdShop && now - guestBotShop > 0.4) {
        guestBotShop = now;
        for (const c of botShop(world, me)) guest.sendCommand(c);
      }
      const inp = world.phase === 'wave' && !outro && !ended && !cine ? readInput() : NO_INPUT;
      const seq = guest.tickInput(inp);
      const evs = guest.mirror.advance(dt, !!guest.hostPaused);
      frameProbe.events += evs.length;
      world = guest.mirror.world;
      guest.mirror.predict(inp, dt, seq);
      // 自己按的神通先在本地放出来（真气满了的话房主那边一定也满，不会被拒），不等房主的事件绕一圈回来（约 0.1 秒）；
      // 房主那条到了就不再放一遍（1.5 秒内）。只有哪吒的「三头六臂」先放：别的角色的神通（天眼、金鞭）要房主那边定下方向、
      // 在人物身上记下那一扫 / 那一鞭（Player.gaze / whip）才画得出来，等房主的事件（赵公明 zhao 分支加的这一条）
      const self = world.players[me];
      if (inp.skill && self?.alive && self.skill >= 1 && HEROES[self.hero].skill !== 'santou' && now - localFeedbackAt > 0.5) {
        // 即时起手反馈不修改真气、伤害、方向或神通状态，房主确认后再播放完整动作。
        localFeedbackAt = now;
        sfx.skill(); hud.banner(skillInfo(HEROES[self.hero].skill).name, 'skill');
        whiteFlash.alpha = Math.max(whiteFlash.alpha, 0.12);
        particles.emit(self.x, self.y - 8, 8, [0xf7dc7a, 0x7cc4c4], [12, 35], [0.12, 0.25], { up: 15 });
      }
      if (inp.skill && self?.alive && self.skill >= 1 && HEROES[self.hero].skill === 'santou' && world.phase === 'wave' && !outro && !ended && !cine) {
        self.skill = 0; // 镜像里先清空（房主真放了之后，状态里也是 0）
        localSkillAt = now;
        oneEvent[0] = { t: 'skill', owner: me, x: self.x, y: self.y, radius: SKILL.radius * (1 + self.stats.area * 0.5) * techSkillRadius(self) }; // 半径和 world.step 里算的一样
        try {
          onEvents(oneEvent, now);
        } catch (err) {
          fault('事件 skill', err);
        }
      }
      for (const e of evs) {
        if (e.t === 'skill' && e.owner === me && localSkillAt >= 0 && now - localSkillAt < 1.5) {
          localSkillAt = -1;
          continue;
        }
        oneEvent[0] = e;
        try {
          onEvents(oneEvent, now);
        } catch (err) {
          fault(`事件 ${e.t}`, err);
        }
      }
    } else if (!ended && !cine && !netHold) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        const shop = world.phase === 'shop';
        // 机器人在商店里每 0.4 秒才动一下，方便看清（也方便截图）
        botShopT = shop ? botShopT + 1 : 0;
        const hold = shop && holdShop; // 对白、旁白放完之前不开商店
        const mine = shop && !hold ? (botMode ? (botShopT % 24 === 0 ? botShop(world, me) : []) : cmds.splice(0)) : [];
        // 联机 · 房主：再加上其他人的商店指令（掉线的人由机器人替他选完、按出战），每个人物的操作各给各的
        let commands = mine;
        let inputs: PlayerInput[] = [shop ? NO_INPUT : readInput()];
        if (host) {
          inputs = [];
          // 其他人的指令每一步都取走：不在商店时到的（上一个商店最后一刻点的）直接丢掉，不留到下一个商店去生效
          const theirs = host.takeCommands();
          commands = shop ? [...mine, ...theirs] : [];
          for (const pl of world.players) {
            if (pl.id === me) {
              inputs[pl.id] = shop ? NO_INPUT : readInput();
              continue;
            }
            const t = host.turn(pl.id, world);
            inputs[pl.id] = shop ? NO_INPUT : t.input;
            if (shop) commands.push(...t.commands);
          }
        }
        const ev = step(world, inputs, commands);
        frameProbe.steps++;
        frameProbe.events += ev.length;
        if (host) {
          host.record(ev, world.tick);
          // 每一波开打时（和商店打开时）存一份整局存档发给大家：房主掉线时，新房主从这里重开这一波
          if (ev.some((e) => e.t === 'waveStart' || e.t === 'shopOpen')) host.save(world, seed);
        }
        for (const e of ev) {
          oneEvent[0] = e;
          try {
            onEvents(oneEvent, now);
          } catch (err) {
            fault(`事件 ${e.t}`, err);
          }
        }
        acc -= DT;
        n++;
      }
    }
    if (host && !netHold) {
      // 名单变了（掉线、回来、退出、中途进房）：roster.ts 的事件和模拟的事件一样，自己画、也广播出去
      const rev = host.syncRoster(world);
      if (rev.length) {
        host.record(rev, world.tick);
        for (const e of rev) {
          oneEvent[0] = e;
          try {
            onEvents(oneEvent, now);
          } catch (err) {
            fault(`事件 ${e.t}`, err);
          }
        }
      }
      host.flush(world);
    }
    frameProbe.lap('sim');
    ach?.update(world, me, bestCombo); // 成就：隔几帧看一眼人物（斩敌、灵石、五行、神品……）
    if (world.phase === 'shop' && !holdShop) {
      inter.render(world, me); // 联机时每人看自己的商店（players[me]）
      codex.update(world, me); // 图鉴：货架上出现过的（刷新货架没有事件，每帧看一眼）
      hud.setVisible(false);
      app.stage.visible = false; // 万宝阁整屏不透明地盖着，底下的战场不用画（省 GPU）
    } else {
      if (inter.open) inter.hide();
      hud.setVisible(cine !== 'cut' && (!outro || outro.stage === 'death'));
      app.stage.visible = cine !== 'cut' && outro?.stage !== 'cutscene'; // 过场整屏盖着：底下的战场不用画
    }
    const frozen = hitStop.frozen(now);
    const vdt = frozen ? 0 : dt;
    // 计时器
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) {
        combo = 0;
        hud.combo(0);
      }
    }
    if (pickT > 0) {
      pickT -= dt;
      if (pickT <= 0) pickStreak = 0;
    }
    killShake = Math.max(0, killShake - dt * 0.5);
    // 表现层推进（命中停顿时冻住）
    if (!frozen) {
      for (const h of heroes) {
        h.animT += vdt;
        if (h.pose) {
          h.poseT += vdt;
          if (h.pose === 'throw' && h.poseT > 0.09) {
            h.pose = 'follow';
            h.poseT = 0;
          } else if (h.pose === 'follow' && h.poseT > 0.14) h.pose = null;
        }
        h.flash = Math.max(0, h.flash - vdt);
      }
      for (const v of ringViews.values()) v.t += vdt;
      for (const v of gemViews.values()) v.t += vdt;
      for (const v of orbViews.values()) v.t += vdt;
      // 插值：单人 / 房主在两帧模拟之间；联机的其他人在房主的两份状态之间（mirror.ts）
      const alpha = guest ? guest.mirror.alpha : ended || world.phase === 'shop' ? 1 : Math.min(1, acc / DT);
      lastHero = syncViews(alpha);
      enemyViews.update(vdt, world, alpha, world.players[me].x); // 敌人：建精灵、换帧着色、眼光、血条、死亡（被减速时动画也慢）
      jieFx.update(vdt, world, alpha); // 劫五首领狂暴的火星（jie-fx.ts）
      affixFx.update(vdt, world, alpha, world.players[me].x); // 精英词缀：血条左边的字、身上的点缀、反震、召唤（elites/affix-fx.ts）
      xfx.update(vdt, world, alpha); // 放在 wfx 前：身上的状态先定好归谁画
      enemyFx.update(vdt, world, alpha);
      eliteFx.update(vdt, world, alpha);
      terrainFx.update(vdt, world, alpha);
      ch2Fx.update(vdt, world, alpha);
      swordFx.update(vdt, world, alpha);
      ch3Fx.update(vdt, world, alpha);
      wfx.update(vdt, world, alpha);
      afx.update(vdt, world, alpha);
      afx2.update(vdt, world, alpha);
      petFx.update(vdt, world, alpha);
      heroFx.update(vdt, world, alpha);
      dropsFx.update(vdt, world, alpha);
      bossFx.update(vdt, world, alpha);
      yaoFx.update(vdt, world, alpha);
      zxFx.update(vdt, world, alpha);
      echoFx.update(vdt, world, alpha);
      techFx.update(vdt, world, alpha); // 放在人物换好帧之后（法天象地换成大一圈的那张）
      relicFx.update(vdt, world, alpha); // 同上（遁地符把人物画淡）
      wuxingFx.update(vdt, world, alpha);
      particles.update(vdt);
      glowParticles.update(vdt);
      numbers.update(vdt);
      for (let i = dying.length - 1; i >= 0; i--) {
        const d = dying[i];
        if (d.t < 0) {
          // 魂光：上升并淡出
          d.s.y -= 30 * vdt;
          d.s.alpha -= vdt * 1.6;
          if (d.s.alpha <= 0) {
            d.s.destroy();
            dying.splice(i, 1);
          }
          continue;
        }
        d.t += vdt;
        const k = 1 - d.t / 0.14;
        if (k <= 0) {
          d.s.destroy();
          dying.splice(i, 1);
          continue;
        }
        d.s.scale.y = k;
        d.s.alpha = k;
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        w.t += vdt;
        const k = w.t / w.dur;
        if (k >= 1) {
          w.g.destroy();
          waves.splice(i, 1);
          continue;
        }
        const r = w.max * (1 - (1 - k) ** 3);
        w.g.clear().ellipse(w.x, w.y, r, r * 0.72).stroke({ width: Math.max(1, Math.round(3 * (1 - k))), color: w.color, alpha: 1 - k });
      }
      for (const h of heroes)
        for (let i = h.after.length - 1; i >= 0; i--) {
          const a = h.after[i];
          a.t += vdt;
          if (a.t < 0) continue;
          a.s.alpha = Math.max(0, 0.7 - a.t * 1.4);
          a.s.y -= vdt * 6;
          if (a.s.alpha <= 0) {
            a.s.destroy();
            h.after.splice(i, 1);
          }
        }
    }
    frameProbe.lap('fx');
    // 镜头与闪屏（停顿时照常衰减，保证收得回来）
    shake.update(dt);
    const [sx, sy] = shake.offset;
    // 首领倒下之后：镜头慢慢移到人物和首领之间（离得远时首领也在画面里），之后再慢慢回到人物身上
    const focus = bossFocus();
    camPos.k += ((focus ? 1 : 0) - camPos.k) * Math.min(1, dt * 2.5);
    const fx0 = focus ? (lastHero.hx + focus.x) / 2 : lastHero.hx;
    const fy0 = focus ? (lastHero.hy + focus.y) / 2 : lastHero.hy;
    if (focus) {
      camPos.x = fx0;
      camPos.y = fy0;
    }
    const cx = lastHero.hx + (camPos.x - lastHero.hx) * camPos.k;
    const cy = lastHero.hy + (camPos.y - lastHero.hy) * camPos.k;
    stage.lookAt(Math.round(cx), Math.round(cy) - 12, sx, sy);
    if (net) edgeMarks(sx, sy);
    // 首领的对白气泡：跟着首领的头顶走
    if (bark && now >= bark.at) {
      dialogue.bubble(bark.text, Math.max(3.2, bark.text.length * 0.2));
      bark = null;
    }
    {
      const ft = fightOf(world); // 首领战、遭遇战都一样：气泡跟着它的头顶走
      const bb = ft && ft.state !== 'dead' ? bossEnemy(world) : null;
      if (bb) {
        const bx = Math.round(bb.x - stage.cam.x + sx);
        const by = Math.round(bb.y - stage.cam.y + sy);
        dialogue.bubbleAt(bx, by - 37, by + 2);
      }
      else dialogue.bubbleAt(null);
    }
    // 魔焰焚城：魔气缩进（模拟里已经是平滑推进 / 退回的）与推进前的翻涌
    stage.setMiasmaInset(world.miasmaInset.x, world.miasmaInset.y);
    agitate = Math.max(0, agitate - dt);
    stage.setMiasmaAgitation(Math.min(1, agitate / 0.6));
    const pm = world.players[me].miasma;
    miasmaVig.alpha = pm > 0 ? Math.min(1, 0.35 + pm * 0.8) * (0.85 + 0.15 * Math.sin(now * 5)) : Math.max(0, miasmaVig.alpha - dt * 2);
    sfx.setMiasma(world.players[me].alive ? pm : 0);
    whiteFlash.alpha = Math.max(0, whiteFlash.alpha - dt * 4);
    redFlash.alpha = Math.max(0, redFlash.alpha - dt * 3);
    curtain?.update(dt); // 换章的云海转场
    if (curtainT >= 0) curtainT += dt;
    stage.update(dt);
    frameProbe.lap('scene');
    // 摇杆
    stickBase.visible = stickKnob.visible = stick.active;
    // 按在画布外的空边里时，摇杆画在离那里最近的画面边上（推的方向和幅度仍按手指实际的位置算）
    if (stick.r !== stickDrawnR) {
      // 推满的距离变了（竖屏的摇杆大一圈）：外圈按新的半径重画
      stickDrawnR = stick.r;
      stickBase.clear().circle(0, 0, stick.r).stroke({ width: 1, color: 0xf2e8d5, alpha: 0.6 });
    }
    const sbx = Math.max(stick.r + 2, Math.min(VIEW_W - stick.r - 2, stick.ox));
    const sby = Math.max(stick.r + 2, Math.min(VIEW_H - stick.r - 2, stick.oy));
    stickBase.position.set(Math.round(sbx), Math.round(sby));
    stickKnob.position.set(Math.round(sbx + stick.dx), Math.round(sby + stick.dy));
    // 界面（联机时是自己的人物）
    const p = world.players[me];
    const boss = world.boss ? bossEnemy(world) : null;
    const bf = world.boss;
    // 首领血条：入场时淡入；倒下后清空、随倒下的表现慢慢淡出
    const bossAlpha = !bf ? 0 : bf.state === 'intro' ? (bf.t / Math.max(0.1, bf.dur)) * 1.3 : bf.state === 'dead' ? 1 - bf.t / bf.dur : 1;
    hud.update({
      hp: p.hp / p.stats.maxHp,
      skill: p.skill,
      time: world.time,
      kills: p.kills,
      xp: p.xp / xpToNext(p.level),
      wave: world.wave,
      waveLabel: `${CHAPTER_NAME[chapterOf(world.wave)]} · 第 ${waveInChapter(world.wave)} 波`,
      left: isBossWave(world.wave) ? -1 : world.waveLen - world.waveT, // 首领波没有倒计时
      lingshi: p.lingshi,
      level: p.level,
      pending: p.pendingLevels,
      wx5: distinctOf(elementCounts(p)) === 5, // 五行俱全：右上角的五色小标（hud.ts）
      hpText: `${Math.max(0, Math.ceil(p.hp))}`,
      echo: world.echo ? echoHud(world) : null,
      boss: bf ? { name: bossTitleOf(bf.kind).name, frac: boss ? boss.hp / boss.maxHp : 0, phase: bf.phase, alpha: bossAlpha, behind: !!boss && Math.abs(boss.x - stage.cam.x - VIEW_W / 2) < 115 && boss.y - stage.cam.y < 66 } : null,
    });
    sfx.setIntensity(world.enemies.length / 160);
    if (netHud) updateNetHud();
    frameProbe.lap('ui');
  };
  app.ticker.add(tick);
  // 联机模拟为 60 Hz、状态为 15 Hz。高刷新率屏幕不重复绘制 120/144 次，留出网络处理预算。
  if (net) app.ticker.maxFPS = 60;
  // ?perf：每帧各段的耗时（frame-probe.ts）；渲染那一段量的是 Application 的渲染（优先级 -25）前后
  app.ticker.add(frameProbe.beforeRender, undefined, -24);
  app.ticker.add(frameProbe.afterRender, undefined, -26);
  if (params.has('perf')) {
    frameProbe.on = true;
    frameProbe.showHud();
    frameProbe.note = () => `Q ${quality.tier}${quality.setting === 'auto' ? ' auto' : ''} decor ${quality.decor.toFixed(2)} r${stage.zoom}`;
  }

  // ---------- 联机：队友的小血条、角上的状态、正中的提示 ----------
  function updateNetHud() {
    if (!net || !netHud) return;
    const t = performance.now();
    const name = netName;
    const others = world.players.filter((x) => x.id !== me && !x.left);
    const status = (x: World['players'][number]) =>
      x.away ? '掉线 · 托管中' : (x.down ?? 0) > 0 ? `倒地 · ${Math.ceil(x.down ?? 0)} 秒` : x.out ? '出局 · 本波打完归队' : !net.online(x.id) ? '掉线' : '';
    const mates = others.map((x) => ({ name: name(x.id), hp: x.alive ? x.hp / x.stats.maxHp : 0, alive: x.alive, online: net.online(x.id) && !x.away, status: status(x) }));
    const self = world.players[me];
    let note: { title: string; sub?: string } | null = null;
    if (net.gone) note = { title: '房间没了', sub: `${net.gone} · 暂停里可以回到标题` };
    else if (net.link.state === 'lost') note = { title: '连接断了', sub: '正在重连中继…' };
    else if (guest && net.hostAwayUntil > t) note = { title: '房主掉线了', sub: `等他回来 · ${Math.ceil((net.hostAwayUntil - t) / 1000)} 秒后换人接手` };
    else if (guest?.hostPaused) note = { title: '房主暂停了', sub: guest.hostPaused === 'hidden' ? '房主切到了后台 · 等他回来' : '等房主继续' };
    else if (guest && !guest.mirror.ready) note = { title: '接上房主', sub: '等房主发来这一局的样子…' };
    else if (netNote && t < netNote.until) note = netNote;
    else if (self && world.phase === 'wave' && (self.down ?? 0) > 0) note = { title: '倒地了', sub: `队友站到身边就能扶你起来 · ${Math.ceil(self.down ?? 0)} 秒` };
    else if (self && world.phase === 'wave' && self.out) note = { title: '出局了', sub: '这一波打完即归队' };
    const room = net.link.room;
    const route = net.link.dataTransport === 'rtc' ? '直连' : net.link.dataTransport === 'mixed' ? '混合连接' : '中继';
    const info = host
      ? `房主 · ${route} · 房间 ${room} · ${net.link.members.filter((m) => m.on).length} 人 · 上行 ${(host.bytesPerSec / 1024).toFixed(1)} KB/s`
      : `${route} · 房间 ${room} · 延迟 ${guest?.rtt ? Math.round(guest.rtt) : '—'} ms`;
    const shop = world.phase === 'shop' && !outro && others.length > 0;
    const ready = shop ? { me: !!self?.ready, done: others.filter((x) => x.ready).map((x) => name(x.id)), wait: others.filter((x) => !x.ready && !x.away).map((x) => name(x.id)) } : null;
    netHud.update({ mates: world.phase === 'shop' ? [] : mates, info: world.phase === 'shop' && !outro ? '' : info, note, ready });
  }
  // 房主切到后台：告诉大家暂停；30 秒还没回来（电脑上后台的页面还在跑定时器）就把房主让给下一个人
  let abdicateTimer = 0;
  if (net)
    document.addEventListener(
      'visibilitychange',
      () => {
        clearTimeout(abdicateTimer);
        if (!host) return;
        if (document.hidden) {
          host.send({ t: 'pause', on: true, why: 'hidden' });
          abdicateTimer = window.setTimeout(() => {
            if (document.hidden && host && net.link.members.some((m) => m.on && m.id !== net.link.me)) net.link.abdicate();
          }, 30000);
        } else if (!pause.paused) host.send({ t: 'pause', on: false, why: 'hidden' });
      },
      on,
    );

  (window as unknown as { __feel: unknown }).__feel = {
    shakeOffset: () => shake.offset, // 调试：当前震屏偏移（scratch 量震屏用）
    get world() {
      return world;
    },
    /** 截图用：定住 / 放开画面。 */
    pause(v: boolean) {
      paused = v;
    },
    /** 截图用：把一个模拟事件直接交给表现层（不进模拟；拍相生、灵物这类特效的前后对照）。 */
    emit(e: SimEvent) {
      onEvents([e], now);
    },
    stats: () => ({ wave: world.wave, phase: world.phase, level: world.players[me].level, weapons: world.players[me].weapons.map((x) => x.kind + x.tier).join(','), skills: skillsUsed, fps: Math.round(app.ticker.FPS), enemies: world.enemies.length, particles: particles.count + glowParticles.count, time: world.time.toFixed(1), kills: world.players[me].kills, hp: world.players[me].hp, paused: pause.paused, cine, faults: Object.fromEntries(faults) }),
    /** 联机的统计（测试用）：自己是房主还是其他人、第几个人物、延迟、流量、镜像的缓冲。 */
    net: () =>
      net && {
        role: net.role,
        me,
        room: net.link.room,
        link: net.link.state,
        transport: net.link.dataTransport,
        stateHz: 20,
        alpha: guest?.mirror.alpha ?? 1,
        bufferMs: guest?.mirror.bufferMs ?? 0,
        extrapolatedMs: Math.round(guest?.mirror.extrapolated ?? 0),
        skippedStates: net.link.skippedStates,
        droppedFrames: guest?.mirror.dropped ?? 0,
        players: world.players.length,
        rtt: guest ? Math.round(guest.rtt) : 0,
        relayRtt: Math.round(net.link.rtt),
        up: host ? host.bytesPerSec : 0,
        down: guest ? guest.bytesPerSec : 0,
        sends: host?.sends ?? 0,
        ready: guest ? guest.mirror.ready : true,
        lag: guest ? Math.round(guest.mirror.lag) : 0,
        queued: guest ? guest.mirror.queued : 0,
        predErr: guest ? Math.round(guest.mirror.predError * 10) / 10 : 0,
        tick: world.tick,
      },
    /** 自查用：舞台（场景树在 stage.scene 底下）。 */
    stage,
    /** 自查用：每帧各段的耗时（frame-probe.ts；on = true 打开，stats() 读）。 */
    perf: frameProbe,
    /** 自查用：画质档（render/quality.ts）。 */
    quality,
  };

  return {
    dispose: disposer(() => {
      outro = null; // 首领战后那一段（等横幅、对白、解锁提示）还在等的话，醒来就收手，不在拆掉的界面上接着放
      life.abort(); // 这一局自己挂在 window / document 上的监听（按键、指针、失焦）
      pause.dispose();
      app.ticker.remove(tick);
      app.ticker.remove(frameProbe.beforeRender);
      app.ticker.remove(frameProbe.afterRender);
      frameProbe.hideHud();
      dialogue.close();
      sfx.music(null);
      sfx.setMiasma(0);
      sfx.setIntensity(0);
      // 战斗界面、万宝阁、对白：自己带 dispose 的先让它们收摊，再兜底摘掉挂上时记下的监听
      for (const ui of [hud, inter, dialogue]) (ui as { dispose?: () => void }).dispose?.();
      for (const off of cleanups) off();
      stage.destroy(); // 场景、渲染器、画布、舞台的窗口监听
      // 这一局加进来的界面（战斗界面、万宝阁、对白）和它们的样式；外围界面的样式（data-fs）留着，下次还要用
      for (const id of ['hud', 'inter', 'dlg']) document.getElementById(id)?.remove();
      // 联机：联机那一层拆掉，离开房间、断开中继（房主走了，中继会把房主交给下一个人，大家从这一波开始接着打）
      clearTimeout(abdicateTimer);
      netHud?.dispose();
      net?.dispose();
      for (const el of [...document.head.children]) if (!headBefore.has(el) && el.tagName === 'STYLE' && !(el as HTMLElement).dataset.fs) el.remove();
      delete (window as unknown as { __feel?: unknown }).__feel;
      const g = globalThis as unknown as { __techFx?: unknown };
      if (g.__techFx === techFx) delete g.__techFx; // 功法画面的调试钩子（technique-fx.ts 挂的）指着这一局，一并拿掉
    }),
  };
}
