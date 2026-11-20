// 解锁记录（首领分支写的接口，保留原样给 feel.ts 等调用）。存档已经统一到 profile.ts：
// 同一个键 fs.v1.unlocks、同一个格式（JSON 字符串数组），这里只是薄包装，不另存一份。
import * as profile from './profile.ts';

/** 解锁的 id：魔化哪吒（第一章首领），回响赵公明、回响云霄（第 10、16 波的遭遇战）；回响化身的表在 sim/catalog.ts 的 ECHO。
 * wukong 孙悟空（隐藏角色，catalog.HIDDEN：通关之后标题页天上的金色裂缝，game/wukong-rift.ts）。 */
export type UnlockId = 'demon-nezha' | 'echo-zhao' | 'echo-yunxiao' | 'echo-aobing' | 'wukong';

/** 已解锁的全部 id。 */
export function unlocks(): string[] {
  return profile.unlocks();
}

export function isUnlocked(id: UnlockId): boolean {
  return profile.isUnlocked(id);
}

/** 解锁一个角色；返回 true 表示这次是新解锁的（表现层据此弹提示）。 */
export function unlock(id: UnlockId): boolean {
  return profile.unlock(id);
}
