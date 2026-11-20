// 带种子的随机数（mulberry32）。模拟里只能用它，不能用 Math.random。
export interface Rng {
  next(): number; // [0, 1)
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0, next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } };
}

export const range = (r: Rng, a: number, b: number) => a + (b - a) * r.next();
