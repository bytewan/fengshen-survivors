// 音频工具共用的信号处理：RBJ 双二阶滤波、近似 BS.1770 的响度。build.ts 生成时用它归一，check.ts --measure 用它复量成品。
export const SR = 44100;

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const toDb = (g: number) => 20 * Math.log10(Math.max(1e-9, g));

/** RBJ 双二阶滤波（就地）。 */
export function biquad(x: Float32Array, type: 'lowpass' | 'highpass' | 'highshelf' | 'peaking', f: number, q = 0.707, gainDb = 0, sr = SR) {
  const w0 = (2 * Math.PI * f) / sr;
  const cs = Math.cos(w0);
  const al = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'highshelf') {
    const A = Math.pow(10, gainDb / 40);
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * (A + 1 + (A - 1) * cs + s);
    b1 = -2 * A * (A - 1 + (A + 1) * cs);
    b2 = A * (A + 1 + (A - 1) * cs - s);
    a0 = A + 1 - (A - 1) * cs + s;
    a1 = 2 * (A - 1 - (A + 1) * cs);
    a2 = A + 1 - (A - 1) * cs - s;
  } else if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + al * A;
    b1 = -2 * cs;
    b2 = 1 - al * A;
    a0 = 1 + al / A;
    a1 = -2 * cs;
    a2 = 1 - al / A;
  } else {
    b0 = type === 'lowpass' ? (1 - cs) / 2 : (1 + cs) / 2;
    b1 = type === 'lowpass' ? 1 - cs : -(1 + cs);
    b2 = b0;
    a0 = 1 + al;
    a1 = -2 * cs;
    a2 = 1 - al;
  }
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** 近似 ITU-R BS.1770 的 K 加权响度：短音效取最大 400ms 瞬时响度，长音乐取门限后的整体响度。 */
export function loudness(chs: Float32Array[], integrated: boolean, sr = SR) {
  const k = chs.map((c) => {
    const y = c.slice();
    biquad(y, 'highshelf', 1500, 0.707, 4, sr);
    biquad(y, 'highpass', 38, 0.5, 0, sr);
    return y;
  });
  const n = k[0].length;
  const W = Math.min(n, Math.round(0.4 * sr));
  const H = Math.max(1, Math.round(0.1 * sr));
  const blocks: number[] = [];
  for (let s = 0; s + W <= n; s += H) {
    let ms = 0;
    for (const y of k) for (let i = s; i < s + W; i++) ms += y[i] * y[i];
    blocks.push(ms / W);
  }
  if (!blocks.length) blocks.push(0);
  const lk = (ms: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
  if (!integrated) return lk(Math.max(...blocks));
  const abs = blocks.filter((b) => lk(b) > -70);
  const mean = abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length);
  const rel = abs.filter((b) => lk(b) > lk(mean) - 10);
  return lk(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
}
