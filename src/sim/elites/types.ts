// 精英（各章自己的精英 + 精英词缀）的类型：纯数据（数字、字符串、数组、普通对象），整局存档原样存下。
// 行为在同目录：index.ts（按章刷精英、分派、各处的钩子）、yecha.ts / lishi.ts / jianshi.ts（三种新精英）、affixes.ts（词缀）。
// 精英的 kind 一律是 'elite'（别处所有「是不是精英」的判断照旧生效：精英倍率、宝匣、捆仙绳捆不住、宠物的威胁……），
// Enemy.elite 分是哪一种；状态都放在敌人身上（Enemy 里「精英」那一段字段），表现层只读它们、再配上下面的事件。

/**
 * 精英的种类（Enemy.elite；没有这个字段 = 回响校尉）：
 * xiaowei 回响校尉（第一章，原来那一种）；yecha 东海夜叉（第一章劫二起，潜水突袭、拍浪击退）；
 * lishi 金光力士（第二章，举金光阵旗给身边的敌人套一层挡一下的金光）；jianshi 截教剑侍（第三章，身边绕着三柄小剑、轮流射出）。
 */
export type EliteKind = 'xiaowei' | 'yecha' | 'lishi' | 'jianshi';

/**
 * 精英词缀（Enemy.affixes；第一章劫一不带，别的一条，劫五两条）：
 * swift 迅捷（走得快）；armor 坚甲（受到的伤害少，哮天犬「破甲」照样破得开）；split 分魂（死时分出两只离魂）；
 * recoil 反震（被身边的人打中就蓄力震一下：伤人、把人震开）；summon 召唤（隔一会儿从身边地里叫出两只回响兵）。
 */
export type EliteAffix = 'swift' | 'armor' | 'split' | 'recoil' | 'summon';

/**
 * 精英自己的动作（Enemy.act 里，接在第一章新敌人的 windup / strike / rest 之后）：
 * dive 东海夜叉沉进水里（打不着）；under 在水下游向人物（地上一圈涟漪，打不着、不接触伤人）；
 * rise 停在水下、地上亮出要冒出来的那一片（还是打不着）；cast 金光力士举旗（之后套金光）。
 * 拍浪、剑侍出剑的预警用 windup，浪头推过去用 strike，收招用 rest（宠物、机器人照常认得 windup）。
 */
export type EliteAct = 'dive' | 'under' | 'rise' | 'cast';

/** 召唤词缀正在召的那一次：t 还剩多久冒出来，pts 地上亮出符印的两处（地面高度）。 */
export interface EliteCall {
  t: number;
  len: number;
  pts: [number, number][];
}

/**
 * 精英的事件（elites/ 发出）。线段、圆都在地面高度（脚底）；r 是判定半径（已经加上人物半径的那些写明了）。
 * 每一种精英的预警都先发「亮出来」那一条（表现层按 t2 推亮淡红光），再发「出手」那一条。
 */
export type EliteEvent =
  // 东海夜叉：沉进水里（之后是一圈在地上游走的涟漪，Enemy.hidden）
  | { t: 'yechaDive'; id: number; x: number; y: number }
  // 东海夜叉：在水下停住，地上亮出要冒出来的那一片（以 (x, y) 为圆心、半径 r，量到人物脚下），t2 秒后冒出
  | { t: 'yechaRise'; id: number; x: number; y: number; r: number; t2: number }
  // 东海夜叉冒出水面：浪花往四周炸开（r 内的人挨一下、被震开）
  | { t: 'yechaBurst'; id: number; x: number; y: number; r: number }
  // 东海夜叉拍浪的预警：浪会从 (x0, y0) 沿线推到 (x1, y1)，半宽 r（已加人物半径），t2 秒后拍下
  | { t: 'yechaSlapWarn'; id: number; x0: number; y0: number; x1: number; y1: number; r: number; t2: number }
  // 拍下：浪头在 dur 秒里沿线推过去（推到的人挨一下、顺着浪的方向被推开）
  | { t: 'yechaSlap'; id: number; x0: number; y0: number; x1: number; y1: number; dur: number }
  // 金光力士举旗（t2 秒后套金光）
  | { t: 'aegisRaise'; id: number; x: number; y: number; t2: number }
  // 金光护体：ids 套上了一层挡一下的金光（连它自己；r 是够得着的半径）
  | { t: 'aegisCast'; id: number; x: number; y: number; r: number; ids: number[] }
  // 金光挡下了一下（id 是被挡的那只，(x, y) 是它的位置）
  | { t: 'aegisBlock'; id: number; x: number; y: number }
  // 截教剑侍出剑的预警：第 k 柄小剑停在 (x0, y0) 指向人物，地上亮出它要射过的直线（到 (x1, y1)，半宽 r 已加人物半径），t2 秒后射出
  | { t: 'bladeAim'; id: number; k: number; x0: number; y0: number; x1: number; y1: number; r: number; t2: number }
  // 射出：w.orbs 里 kind 'blade' 的那一柄（orb 是它的 id），dur 秒飞完这条线
  | { t: 'bladeShot'; id: number; k: number; orb: number; x0: number; y0: number; x1: number; y1: number; dur: number }
  // 三柄都射出去以后，重新聚齐
  | { t: 'bladeReform'; id: number; x: number; y: number }
  // 反震：被身边的人打中，开始蓄力（以它脚下为圆心、半径 r 的一圈，跟着它走），t2 秒后震开
  | { t: 'recoilWarn'; id: number; x: number; y: number; r: number; t2: number }
  // 反震：震开（r 内的人挨一下、被往外震开）
  | { t: 'recoil'; id: number; x: number; y: number; r: number }
  // 召唤：地上 pts 两处亮出符印，t2 秒后冒出回响兵
  | { t: 'eliteCallWarn'; id: number; pts: [number, number][]; t2: number }
  // 召唤：从地里冒出来的回响兵（ids；刚冒出来愣一下）。这几只是「敌人不在屏幕里凭空出现」的例外（从精英身边的符印里冒出来）
  | { t: 'eliteCall'; id: number; ids: number[] }
  // 分魂：精英死时分出离魂（ids），从它倒下的地方往外弹开
  | { t: 'affixSplit'; id: number; x: number; y: number; ids: number[] };
