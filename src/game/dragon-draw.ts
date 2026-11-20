// 敖丙的龙怎么画（首领 / 遭遇战的冰龙、化成的白龙，和可玩的回响敖丙的游龙戟、神通「化龙」共用）。
// 身子是沿一条路线每帧画的像素点（一节一节的鳞、背亮腹暗、两边各一格深色轮廓、背鳍、尾鳍、地上的影子），
// 龙头是一张预先转成 16 个方向的小图（角、须、眼睛）。不成圈、不带光晕。
// big：白龙（长约 58、身子 7 粗、离地 9）；小的是冰龙（长约 34、身子 5 粗、离地 5）。
import type { Texture } from 'pixi.js';
import { grid } from '../art/pixel.ts';
import { lined, rotSprite } from '../art/sprites/fx.ts';
import { textureFromGrid } from '../render/textures.ts';
import { C, type Pixels } from './fx.ts';

/** 龙头（朝右；从上往下看，上下对称：一对往后的角、两缕须、一点眼睛）。 */
const DRAGON_HEAD = ['.CC..........', '...CCc.......', '.....wwww....', '.cCwwWWWwwZ..', '...ZwWWNWwwwn', '.cCwwWWWwwZ..', '.....wwww....', '...CCc.......', '.CC..........'];
const ICE_HEAD = ['.CC......', '...CZZ...', '.cZZWWZZ.', '..ZWWNWZn', '.cZZWWZZ.', '...CZZ...', '.CC......'];
const headTex = new Map<boolean, { tex: Texture; ax: number; ay: number }[]>();
/** 16 个方向的龙头（第 i 个朝 i / 16 圈）；ax / ay 是锚点（颈根，按比例）。 */
export function dragonHeads(big: boolean) {
  let v = headTex.get(big);
  if (!v) {
    const g = grid(big ? DRAGON_HEAD : ICE_HEAD);
    v = Array.from({ length: 16 }, (_, i) => {
      const r = rotSprite(g, (i / 16) * Math.PI * 2, big ? 5.5 : 3.5, g.h / 2);
      const o = lined(r.g, 'n');
      return { tex: textureFromGrid(o), ax: (r.ax + 1.5) / o.w, ay: (r.ay + 1.5) / o.h };
    });
    headTex.set(big, v);
  }
  return v;
}
/** 朝 (ux, uy) 游时用第几个龙头。 */
export const headIndex = (ux: number, uy: number) => ((Math.round((Math.atan2(uy, ux) / (Math.PI * 2)) * 16) % 16) + 16) % 16;

export const DRAGON = {
  big: { L: 58, half: 3, lift: 9, wave: 4.2 },
  small: { L: 34, half: 2, lift: 5, wave: 2.6 },
};

/**
 * 画身子。at(s)：离龙头 s 像素处的那一点（地面坐标）和那里的朝向（单位向量，指向龙头那一边）；路线到头了返回 null。
 * T 是上面那层（身子），F 是地面那层（影子）。a：整体的透明度；time：摆动的相位。
 */
export function drawDragonBody(T: Pixels, F: Pixels, big: boolean, at: (s: number) => { x: number; y: number; ux: number; uy: number } | null, a: number, time: number) {
  const D = big ? DRAGON.big : DRAGON.small;
  const body = big ? [C.W, C.w, 0xc3ccd2] : [C.W, 0xc3ccd2, C.Cc];
  for (let s = 3; s <= D.L; s += 0.5) {
    const q = at(s);
    if (!q) break;
    const t = s / D.L;
    const nx = -q.uy;
    const ny = q.ux;
    const up = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1; // 屏幕上靠上的那一侧（背）
    const wave = Math.sin(s * 0.2 - time * 15) * D.wave * Math.min(1, s / 9);
    const cx = q.x + nx * wave;
    const cy = q.y + ny * wave - D.lift;
    const wHalf = t > 0.9 ? 0 : Math.max(1, Math.round(D.half * Math.pow(1 - t, 0.6)));
    const fade = a * (1 - t * 0.25);
    if ((Math.round(s * 2) & 3) === 0) F.dot(q.x + nx * wave, q.y + ny * wave + 1, C.k, (big ? 0.2 : 0.14) * a * (1 - t));
    for (let o = -wHalf; o <= wHalf; o++) {
      // 背亮、腹暗一档；一节一节的鳞（隔三格一道天青）
      const col = Math.floor(s) % 4 === 0 && Math.abs(o) < wHalf ? C.Cc : o * up > 0 ? body[0] : o === 0 ? body[1] : body[2];
      T.dot(cx + nx * o, cy + ny * o, col, fade);
    }
    // 轮廓：两边各一格深色（浅色的龙压在浅色的地上也看得清）
    T.dot(cx + nx * (wHalf + 1), cy + ny * (wHalf + 1), C.n, fade);
    T.dot(cx - nx * (wHalf + 1), cy - ny * (wHalf + 1), C.n, fade);
    // 背鳍：隔几格一撮天青，长在背上
    if (s > 6 && t < 0.85 && Math.floor(s) % 6 < 2) {
      T.dot(cx + nx * up * (wHalf + 2), cy + ny * up * (wHalf + 2), C.Cc, fade);
      if (big && Math.floor(s) % 6 === 0) T.dot(cx + nx * up * (wHalf + 3), cy + ny * up * (wHalf + 3), C.c, fade);
    }
    // 尾鳍：尾尖上叉开的两撮
    if (t > 0.93) for (const sd of [-1, 1]) T.dot(cx + nx * sd * (1 + (t - 0.93) * 30), cy + ny * sd * (1 + (t - 0.93) * 30), C.Cc, fade);
  }
}

/**
 * 龙头走过的路（最新的在前）。push 记下这一帧的位置（挪了不到半个像素就不记）；at(s) 给出沿这条路往回 s 像素处的点和朝向。
 * 可玩的那两条龙（游龙戟的冰龙会拐弯、化龙跟着摇杆走）身子就沿它画。
 */
export class DragonTrail {
  private pts: number[] = []; // [x0, y0, x1, y1, …]，最新的在前
  private max: number;
  constructor(max = 90) {
    this.max = max;
  }
  /** 一开始就给一段直的尾巴（从 (x, y) 往 (-ux, -uy) 排 len 像素），龙一出来就是整条的。 */
  seed(x: number, y: number, ux: number, uy: number, len: number) {
    this.pts = [];
    for (let s = 0; s <= len; s += 2) this.pts.push(x - ux * s, y - uy * s);
  }
  push(x: number, y: number) {
    const p = this.pts;
    if (p.length >= 2 && (p[0] - x) ** 2 + (p[1] - y) ** 2 < 0.25) return;
    p.unshift(x, y);
    if (p.length > this.max * 2) p.length = this.max * 2;
  }
  get head(): { x: number; y: number; ux: number; uy: number } | null {
    return this.at(0);
  }
  at = (s: number): { x: number; y: number; ux: number; uy: number } | null => {
    const p = this.pts;
    let acc = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i] - p[i + 2];
      const dy = p[i + 1] - p[i + 3];
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      if (acc + d >= s) {
        const k = (s - acc) / d;
        return { x: p[i] - dx * k, y: p[i + 1] - dy * k, ux: dx / d, uy: dy / d };
      }
      acc += d;
    }
    return null;
  };
}
