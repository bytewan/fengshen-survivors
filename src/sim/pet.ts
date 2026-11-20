// 专属宠物：按种类分派（种类跟着角色走：catalog.HEROES[hero].petKind）。每种宠物一个模块，都是无敌、不造成伤害、只上减益：
//   huntian 哪吒 · 混天绫（pets/huntian.ts：飘在半空，掠过敌群缠住一串，减速 + 破绽）；
//   xiaotian 杨戬 · 哮天犬（pets/xiaotian.ts：贴地跑，从敌群里一冲而过咬一口就走，破甲）；
//   heihu 赵公明 · 黑虎（pets/heihu.ts：贴地跑，扑过敌群吼一声就走，震慑：被吓住的往外逃、打人伤害降低）；
//   qingluan 云霄 · 青鸾（pets/qingluan.ts：飞法和混天绫同一套，低飞掠过敌群洒下冰羽，寒羽：走得慢、出手慢，再沾一次冻住）；
//   leipeng 雷震子 · 雷鹏（pets/leipeng.ts：在身后高处盘着，拔高之后之字形俯冲、贴地掠过敌群，麻痹：一颤打断蓄力、时不时再颤、出手慢）；
//   bishui 回响敖丙 · 避水兽（pets/bishui.ts：贴地跑，从敌群里冲过去，浪头把两边的推开、打湿：走得慢，再挨一下水行的伤害就冻住）；
//   maohou 孙悟空 · 毫毛猴（pets/maohou.ts：蹲在主人脚边，拔毛一吹，小猴分身窜过敌群，戏弄：出手变慢、走路乱晃）。
// 状态是同一个 Pet（types.ts），进化的时机（5 / 10 / 15 级）和二选一在 shop.ts；两条路是哪两条看 PET_KINDS。
// 加一种宠物：在 pets/ 下写一个模块（new / update / place），在这里登记，再在 game/pets/ 加它的画面。
import { HEROES } from './catalog.ts';
import { newPet as newHuntian, updatePet as updateHuntian } from './pets/huntian.ts';
import { newXiaotian, placeXiaotian, updateXiaotian } from './pets/xiaotian.ts';
import { newHeihu, placeHeihu, updateHeihu } from './pets/heihu.ts';
import { newQingluan, placeQingluan, updateQingluan } from './pets/qingluan.ts';
import { newLeipeng, placeLeipeng, updateLeipeng } from './pets/leipeng.ts';
import { newMaohou, placeMaohou, updateMaohou } from './pets/maohou.ts';
import { newBishui, placeBishui, updateBishui } from './pets/bishui.ts';
import type { Pet, PetBranch, PetKind, Player, SimEvent } from './types.ts';
import type { World } from './world.ts';

/** 混天绫的数值表（表现层和测试一直从这里拿，原样转出）。 */
export { PET } from './pets/huntian.ts';
export { XIAOTIAN } from './pets/xiaotian.ts';
export { HEIHU } from './pets/heihu.ts';
export { QINGLUAN } from './pets/qingluan.ts';
export { LEIPENG } from './pets/leipeng.ts';
export { MAOHOU } from './pets/maohou.ts';
export { BISHUI } from './pets/bishui.ts';

interface PetModule {
  /** 进化的两条路（第一次进化时二选一）。 */
  branches: [PetBranch, PetBranch];
  make(x: number, y: number): Pet;
  update(w: World, p: Player, dt: number, ev: SimEvent[]): void;
  /** 主人瞬移之后（联机归队）把宠物摆回主人身边。 */
  place(p: Player): void;
}

export const PET_KINDS: Record<PetKind, PetModule> = {
  huntian: {
    branches: ['bind', 'fire'],
    make: newHuntian,
    update: updateHuntian,
    place(p) {
      p.pet.x = p.pet.px = p.x - 24;
      p.pet.y = p.pet.py = p.y - 28;
    },
  },
  xiaotian: { branches: ['pounce', 'fang'], make: newXiaotian, update: updateXiaotian, place: placeXiaotian },
  heihu: { branches: ['gale', 'broke'], make: newHeihu, update: updateHeihu, place: placeHeihu },
  qingluan: { branches: ['rime', 'deep'], make: newQingluan, update: updateQingluan, place: placeQingluan },
  leipeng: { branches: ['flash', 'clap'], make: newLeipeng, update: updateLeipeng, place: placeLeipeng },
  maohou: { branches: ['hold', 'drowse'], make: newMaohou, update: updateMaohou, place: placeMaohou },
  bishui: { branches: ['surge', 'marrow'], make: newBishui, update: updateBishui, place: placeBishui },
};

/** 这个人物带的是哪种宠物。 */
export const petKindOf = (p: Player): PetKind => HEROES[p.hero].petKind;

/** 开局的宠物（在主人 (x, y) 身边）。 */
export const newPet = (kind: PetKind, x: number, y: number): Pet => PET_KINDS[kind].make(x, y);

/** 推进一帧（战斗、收灵时每帧调）。 */
export function updatePet(w: World, p: Player, dt: number, ev: SimEvent[]) {
  if (p.boon?.petHaste && p.pet.cd > 0) p.pet.cd -= dt * p.boon.petHaste; // 修为「万灵归心」：冷却多走几成（xiuwei.ts）
  PET_KINDS[petKindOf(p)].update(w, p, dt, ev);
}

/** 主人瞬移之后把宠物摆回身边。 */
export function placePet(p: Player) {
  PET_KINDS[petKindOf(p)].place(p);
}
