// 回响的冷色（回响化身、遭遇战共用一套）：从封神榜里拘回来的魂——金、赭、琥珀、檀、朱换成石青、靛、黛蓝，眼白、冠珠换成天青（魂火的颜色）；
// 玄、乌、黛这些暗色不动，所以人物的轮廓、明暗还在，只是整个人冷下去、像隔着一层水看。只换颜色，不改形（和本人一样大）。
import { grid, type Grid } from '../pixel.ts';

/**
 * 人物：回响色。肤色（檀、赭石、肉色三档）换成青灰的三档（X T Z）：原来换成乌、黛紫，和胡子、铁甲是同一组颜色，
 * 回响赵公明的脸和胡子糊成一团；现在脸是一张苍白发青的脸，眉眼、鼻梁的明暗都在（和回响云霄的苍白一个意思）。
 */
export const ECHO_TONE: Record<string, string> = { y: 'c', Y: 'C', b: 'n', B: 'N', S: 'X', s: 'T', t: 'Z', r: 'C', e: 'c', o: 'C', j: 'C', i: 'c', h: 'n', w: 'C', f: 'C' };
/** 黑虎：乌黑的毛换成靛、黛蓝，肚子和口鼻石青，金眼、王字纹天青（回响赵公明的魂虎、遭遇战里的虎影）。 */
export const TIGER_TONE: Record<string, string> = { d: 'N', g: 'n', h: 'c', i: 'C', b: 'C', y: 'C', w: 'C', B: 'N' };

/** 按表换色。 */
export const tone = (g: Grid, m: Record<string, string>): Grid => grid(g.rows.map((r) => [...r].map((c) => m[c] ?? c).join('')));
/** 回响色的一帧。 */
export const echoTone = (g: Grid): Grid => tone(g, ECHO_TONE);
/**
 * 云霄的回响色：她本来就穿天青、月白，再往冷里换会糊成一片；所以往暗里压一档——天青的外袍压成黛蓝、月白的长裙换成天青、
 * 披帛和簪子换成石青，脸色苍白（缟换银鼠），墨发不动。
 */
export const YUNXIAO_TONE: Record<string, string> = { C: 'n', c: 'N', w: 'C', j: 'c', i: 'n', t: 'j', s: 'i', S: 'h', y: 'c', Y: 'C', b: 'n', B: 'N', e: 'c', r: 'C', o: 'C', f: 'C' };
/** 青鸾的回响色（回响云霄的玄鸾、遭遇战里掠过的鸾影）：天青、月白的羽毛压成黛蓝、靛，羽梢一点天青。 */
export const LUAN_TONE: Record<string, string> = { w: 'C', W: 'C', C: 'n', c: 'N', j: 'c', i: 'n', y: 'c', Y: 'C', b: 'n', e: 'c', r: 'C' };
