// 贴地宠物画面的防抖（用户 2026-11-12：「宠物很容易抽搐抖动」）：朝向、姿势都加回差（滞后），速度在门槛附近晃的时候不来回换。
// - 朝向：横向速度够大（> FACE_V，而且横向占了速度的一截）才转身，两次转身至少隔 FACE_GAP 秒；停下来超过 STILL_T 秒才转去和主人朝同一边。
// - 姿势（站 / 小跑 / 奔）：往上换要过门槛的 UP 倍，往下换要低于门槛的 DOWN 倍；两次换档至少隔 BAND_GAP 秒（冲过去那一趟一定是奔，不等）。
export interface Steady {
  face: number;
  flipT: number; // 离上次转身多久
  stillT: number; // 停着多久
  band: number; // 0 站 / 1 小跑 / 2 奔
  bandT: number; // 离上次换档多久
}

const FACE_V = 22;
const FACE_GAP = 0.22;
const STILL_T = 0.4;
const UP = 1.3;
const DOWN = 0.65;
const BAND_GAP = 0.2;

export const steady = (face: number): Steady => ({ face, flipT: 9, stillT: 0, band: 0, bandT: 9 });

/** 推进一帧朝向：vx 横向速度、sp 速率、owner 主人的朝向。 */
export function steadyFace(s: Steady, vx: number, sp: number, owner: number, dt: number): number {
  s.flipT += dt;
  s.stillT = sp < 8 ? s.stillT + dt : 0;
  let want = s.face;
  if (Math.abs(vx) > FACE_V && Math.abs(vx) > sp * 0.35) want = vx > 0 ? 1 : -1;
  else if (s.stillT > STILL_T) want = owner;
  if (want !== s.face && s.flipT >= FACE_GAP) {
    s.face = want;
    s.flipT = 0;
  }
  return s.face;
}

/** 推进一帧姿势档：trot / run 是原来的门槛（速率过了 trot 是小跑、过了 run 是奔），force 是一定要奔（冲过去的那一趟）。 */
export function steadyBand(s: Steady, sp: number, trot: number, run: number, force = false, dt = 1 / 60): number {
  s.bandT += dt;
  if (force) {
    if (s.band !== 2) s.bandT = 0;
    return (s.band = 2);
  }
  const want = s.band === 0 ? (sp > trot * UP ? (sp > run * UP ? 2 : 1) : 0) : s.band === 1 ? (sp > run * UP ? 2 : sp < trot * DOWN ? 0 : 1) : sp < run * DOWN ? (sp < trot * DOWN ? 0 : 1) : 2;
  if (want !== s.band && s.bandT >= BAND_GAP) {
    s.band = want;
    s.bandT = 0;
  }
  return s.band;
}
