// 角色框架（模拟这一半）：神通、每帧的事按角色分派。角色表（主五行、专属法宝、宠物种类、被动的说明）在 catalog.HEROES，
// 宠物按种类分派在 pet.ts，被动和角色带来的减益在 passives.ts（core.hitEnemy 要用，单独放）。
// 加一个角色：
//   1. types.ts 的 HeroId、SkillId 加上他（新种类的宠物还要加 PetKind、PetBranch），catalog.HEROES 写上他的一行
//      （专属法宝在 catalog.WEAPONS 里标 exclusive: 他的 id，进化两条路的名字写进 catalog.PET_BRANCH）；
//   2. sim/heroes/<id>.ts 写神通（和需要的每帧推进），在下面的 KITS 登记、skillInfo 里写说明；被动写进 passives.ts 的 PASSIVES；
//   3. 专属法宝的出手登记进 weapons.ts 的 FIRE 表（有连招的话 followUp 里也分派过来）；宠物照 pet.ts 文件头加；
//   4. 表现层：game/hero-views.ts 的 HERO_VIEWS（人物帧、称号、对白名字牌颜色、掷出姿势……）、game/heroes/（神通、专属法宝、
//      被动的画面）、game/pets/（宠物的画面）、game/select.ts 的选角格；图标在 art/sprites/icons.ts（WEAPON_ICONS、BRANCH_ICONS、PET_BASE_ICONS）。
//   类型检查会指出漏登记的表（KITS、skillInfo、PET_KINDS、HERO_VIEWS、图标表都是按 id 的 Record）。
// 神通要托着人物的身子走（雷震子「风雷翅」的俯冲）：这一趟里 bodyHeld 为真，world.step 不听移动输入，位置由神通的每帧推进给。
// 联机大厅的角色按钮、万宝阁的小立绘按 HERO_IDS / HEROES 自动列出；
// 联机的 roster.addPlayer(w, hero) 和开局的 createWorld(seed, n, heroes) 都走 world.newPlayer，按角色表给起手（专属法宝、宠物）。
import type { Enemy, HeroId, Player, SimEvent, SkillId } from '../types.ts';
import type { World } from '../world.ts';
import { santou } from './nezha.ts';
import { gaze, updateYangjian } from './yangjian.ts';
import { jinbian, updateZhao } from './zhao.ts';
import { clearHeld, dropHeld, huanghe, updateYunxiao } from './yunxiao.ts';
import { dropWing, fenglei, updateLeizhenzi, wingHeld } from './leizhenzi.ts';
import { tujin, updateMozha } from './mozha.ts';
import { dingtou, updateHuizhao } from './huizhao.ts';
import { xueding, updateHuiyun } from './huiyun.ts';
import { faxiang, updateWukong } from './wukong.ts';
import { hualong, updateHuiao } from './huiao.ts';
import { HEROES, unlockIdOf } from '../catalog.ts';

interface HeroKit {
  /** 放神通（真气已经扣成 0）。 */
  skill(w: World, p: Player, ev: SimEvent[]): void;
  /** 每帧（战斗中、活着的时候，紧跟在法宝、宠物之后）：神通的持续部分。 */
  update?(w: World, p: Player, dt: number, ev: SimEvent[]): void;
}

const KITS: Record<SkillId, HeroKit> = {
  santou: { skill: santou },
  gaze: { skill: gaze, update: updateYangjian },
  jinbian: { skill: jinbian, update: updateZhao },
  huanghe: { skill: huanghe, update: updateYunxiao },
  fenglei: { skill: fenglei, update: updateLeizhenzi },
  tujin: { skill: tujin, update: updateMozha }, // 魔化哪吒：神通「火尖枪突进」（mozha.ts）
  dingtou: { skill: dingtou, update: updateHuizhao }, // 回响赵公明：神通「钉头七箭」，每帧还管被动「怨力」的震波（huizhao.ts）
  xueding: { skill: xueding, update: updateHuiyun }, // 回响云霄：神通「黄河阵 · 削顶」（huiyun.ts）
  hualong: { skill: hualong, update: updateHuiao }, // 回响敖丙：神通「化龙」（huiao.ts）
  faxiang: { skill: faxiang, update: updateWukong }, // 孙悟空：神通「法天象地」（wukong.ts）
};

/** 放这个人物的神通。 */
export function castSkill(w: World, p: Player, ev: SimEvent[]) {
  KITS[HEROES[p.hero].skill].skill(w, p, ev);
}

/** 每帧推进这个人物的神通（持续的那一部分）。 */
export function updateHero(w: World, p: Player, dt: number, ev: SimEvent[]) {
  KITS[HEROES[p.hero].skill].update?.(w, p, dt, ev);
}

/**
 * 每帧，这个人物没在场上动（倒下、出局、离开；world.step 的玩家循环里，跳过他之前调）：手里还攥着的放掉——
 * 混元金斗里的敌人掉出来、九曲黄河卷着的松开（不管是什么角色：身上没有就什么都不做）。
 */
export function heroIdle(w: World, p: Player, ev: SimEvent[]) {
  dropHeld(w, p, ev);
  dropWing(p); // 风雷翅飞到一半倒下（联机里被魔气耗倒）：落回地上
}

/** 这一帧人物的身子由神通托着走（雷震子「风雷翅」的俯冲）：world.step 不听移动输入。 */
export const bodyHeld = (p: Player) => wingHeld(p);

/** 被角色暂时拿出 w.enemies 的敌人有几只（云霄的混元金斗里的）：刷怪的同屏上限把它们也算上。 */
export function heldOff(w: World): number {
  let n = 0;
  for (const p of w.players) n += p.dou?.held.length ?? 0;
  return n;
}

/** 被角色暂时拿出 w.enemies 的敌人（云霄的混元金斗里的；数值工具量伤害时要把它们当作还在场上）。 */
export function heldList(w: World): Enemy[] {
  const out: Enemy[] = [];
  for (const p of w.players) if (p.dou) out.push(...p.dou.held);
  return out;
}

/** 这一波结束（world.endWave 清场时调）：斗里的、水里卷着的跟着清掉，不带进下一波。 */
export function heroWaveEnd(p: Player) {
  clearHeld(p);
  dropWing(p);
}

/** 能选的角色（角色表里的全部；回响化身要解锁才能选，见 allowedHeroes）。 */
export const HERO_IDS = Object.keys(HEROES) as HeroId[];

/**
 * 解锁了这些（存档里的解锁 id，catalog.ECHO / catalog.HIDDEN）之后能选哪些角色：首发角色都能选，回响化身、隐藏角色要解锁了才能选。
 * 联机时按房主的解锁算（设计文档「选角规则」：房间内可选角色以房主的解锁进度为准）。
 */
export function allowedHeroes(unlocked: readonly string[]): HeroId[] {
  return HERO_IDS.filter((h) => {
    const u = unlockIdOf(h);
    return !u || unlocked.includes(u);
  });
}
/** 一开始就能选的角色（回响化身、隐藏角色要先解锁）。 */
export const OPEN_IDS = allowedHeroes([]);

/**
 * 联机：同一房间不能选重复的角色（设计文档「选角规则」）。want 已经被 taken 里的人选了，就换成 pool 里第一个还没人选的；
 * 角色都被选完了（人比角色多）才允许重复，还给 want。pool：这个房间能选的角色（回响化身、隐藏角色看房主解锁了没有，allowedHeroes 算好传进来；
 * 不传就是一开始就能选的那几位：替人换角色时不会换成谁都没解锁的角色）。
 */
export function pickFreeHero(taken: HeroId[], want: HeroId, pool: readonly HeroId[] = OPEN_IDS): HeroId {
  if (!pool.includes(want)) want = pool.find((h) => !taken.includes(h)) ?? pool[0] ?? want; // 选了房主没解锁的回响化身 / 隐藏角色：换成能选的
  if (!taken.includes(want)) return want;
  return pool.find((h) => !taken.includes(h)) ?? want;
}

/** 神通的名字与说明（选角、图鉴用）。说明只写意象和大概干什么，不报充能只数、秒数（用户 2026-11-12）。 */
export function skillInfo(id: SkillId): { name: string; desc: string } {
  const info: Record<SkillId, { name: string; desc: string }> = {
    santou: { name: '三头六臂', desc: '现三头六臂之相，震开周遭，八方乾坤圈齐出' },
    gaze: { name: '天眼', desc: '额间神目一开，金光所照，妖邪俱定' },
    jinbian: { name: '金鞭', desc: '金鞭虚影砸落，地裂金缝，迸出金元宝' },
    huanghe: { name: '九曲黄河', desc: '九曲黄河倒卷，裹敌向心，一齐砸下' },
    fenglei: { name: '风雷翅', desc: '风雷二翅一展，凌空连番俯冲，雷落风起' },
    tujin: { name: '火尖枪突进', desc: '端枪蓄势，一线冲阵，所向披靡，沿途燃火' },
    dingtou: { name: '钉头七箭', desc: '草人符钉于众敌，七箭齐落，重创其魂' },
    xueding: { name: '黄河阵 · 削顶', desc: '摆下黄河阵，削去阵中之敌顶上三花，伤重力衰' },
    hualong: { name: '化龙', desc: '化作白龙冲阵，刀兵不侵，所过冰封' },
    faxiang: { name: '法天象地', desc: '法天象地，身形暴长，一震退敌，金箍棒愈加沉重' },
  };
  return info[id];
}
