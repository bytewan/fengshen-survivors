// 二维码（QR Code）编码：大厅里把分享链接画成二维码，手机用相机一扫就进房（不用在手机上敲 http://192.168……）。
// 只做用得上的那一小部分：字节模式、纠错等级 L、版本 1–5（最多约 100 个字节，局域网的链接 40 来个字），
// 8 种掩码按标准的扣分规则挑最好的一种。不依赖任何库；返回一个 size × size 的布尔矩阵（true = 深色），四周的空白（4 格）由调用方留。
// 规范：ISO/IEC 18004。测试在 qr.test.ts（结构）；实际能不能扫，开发时用独立的解码器核对过（docs/netcode.md）。

/** 版本 1–5、纠错等级 L：每个版本的数据码字数、纠错码字数（都只有一个块）、对齐图案的中心位置。 */
const SPEC: { data: number; ec: number; align: number[] }[] = [
  { data: 19, ec: 7, align: [] },
  { data: 34, ec: 10, align: [6, 18] },
  { data: 55, ec: 15, align: [6, 22] },
  { data: 80, ec: 20, align: [6, 26] },
  { data: 108, ec: 26, align: [6, 30] },
];

// ---------- GF(256) 与 Reed-Solomon ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** 生成多项式 (x − α^0)(x − α^1)…(x − α^(n−1)) 的系数（最高次在前，首项 1 省略之外全留）。 */
function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** 纠错码字：数据当成多项式除以生成多项式的余数。 */
export function rsEncode(data: number[], n: number): number[] {
  const g = generator(n);
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
  }
  return rem;
}

// ---------- 码字 ----------
function codewords(bytes: Uint8Array, version: number): number[] {
  const { data, ec } = SPEC[version - 1];
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4); // 字节模式
  put(bytes.length, 8); // 版本 1–9 的字数是 8 位
  for (const b of bytes) put(b, 8);
  const cap = data * 8;
  put(0, Math.min(4, cap - bits.length)); // 结束符
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; out.length < data; pad++) out.push(pad % 2 ? 0x11 : 0xec);
  return [...out, ...rsEncode(out, ec)];
}

// ---------- 矩阵 ----------
type Grid = { size: number; dark: Uint8Array; fixed: Uint8Array };

function place(version: number): Grid {
  const size = 17 + version * 4;
  const dark = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, v: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    dark[y * size + x] = v ? 1 : 0;
    fixed[y * size + x] = 1;
  };
  // 三个角上的定位图案（含一圈白边）
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ])
    for (let dy = -1; dy <= 7; dy++)
      for (let dx = -1; dx <= 7; dx++) {
        const r = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(ox + dx, oy + dy, r !== 2 && r <= 3);
      }
  // 时序线
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  // 对齐图案（避开三个定位图案）
  const al = SPEC[version - 1].align;
  for (const cy of al)
    for (const cx of al) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === al[al.length - 1]) || (cy === 6 && cx === al[al.length - 1])) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // 格式信息的位置先占住（后面再写），还有那一个固定的深色模块
  for (let i = 0; i < 9; i++) {
    if (!fixed[8 * size + i]) set(i, 8, false);
    if (!fixed[i * size + 8]) set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  return { size, dark, fixed };
}

/** 数据按标准的之字形从右下角开始放（两列一组，跳过第 6 列的时序线）。 */
function fill(g: Grid, words: number[]) {
  const { size, dark, fixed } = g;
  let bit = 0;
  const total = words.length * 8;
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const i = y * size + x;
        if (fixed[i]) continue;
        const v = bit < total ? (words[bit >> 3] >>> (7 - (bit & 7))) & 1 : 0;
        dark[i] = v;
        bit++;
      }
    }
    up = !up;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 格式信息：纠错等级 L（01）+ 掩码编号，BCH(15, 5) 再异或 0x5412。 */
export function formatBits(mask: number): number {
  const d = (0b01 << 3) | mask;
  let r = d << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((d << 10) | r) ^ 0x5412;
}

function writeFormat(g: Grid, mask: number) {
  const { size, dark } = g;
  const f = formatBits(mask);
  const bitAt = (i: number) => (f >>> i) & 1;
  // 左上角那一圈：第 0–5 位竖着在第 8 列（行 0–5），第 6、7 位在 (8,7)、(8,8)，第 8 位在 (7,8)，第 9–14 位横着在第 8 行（列 5–0）
  for (let i = 0; i <= 5; i++) dark[i * size + 8] = bitAt(i);
  dark[7 * size + 8] = bitAt(6);
  dark[8 * size + 8] = bitAt(7);
  dark[8 * size + 7] = bitAt(8);
  for (let i = 9; i <= 14; i++) dark[8 * size + (14 - i)] = bitAt(i);
  // 另一份：第 0–7 位横着在第 8 行（从最右边往左），第 8–14 位竖着在第 8 列（从下往上数第 7 格起）
  for (let i = 0; i <= 7; i++) dark[8 * size + (size - 1 - i)] = bitAt(i);
  for (let i = 8; i <= 14; i++) dark[(size - 15 + i) * size + 8] = bitAt(i);
  dark[(size - 8) * size + 8] = 1; // 固定的深色模块
}

/** 标准的四条扣分规则（连成一串、2×2 色块、像定位图案的序列、深浅比例）。 */
function penalty(size: number, d: Uint8Array): number {
  let p = 0;
  const at = (x: number, y: number) => d[y * size + x];
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const same = pass ? at(a, b) === at(a, b - 1) : at(b, a) === at(b - 1, a);
        if (same) run++;
        else {
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
      if (run >= 5) p += run - 2;
    }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
    }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const rev = [...pat].reverse();
  for (let a = 0; a < size; a++)
    for (let b = 0; b + 11 <= size; b++)
      for (const pp of [pat, rev]) {
        let h = true;
        let v = true;
        for (let k = 0; k < 11 && (h || v); k++) {
          if (at(b + k, a) !== pp[k]) h = false;
          if (at(a, b + k) !== pp[k]) v = false;
        }
        if (h) p += 40;
        if (v) p += 40;
      }
  let darkN = 0;
  for (const v of d) darkN += v;
  p += Math.floor(Math.abs((darkN * 100) / (size * size) - 50) / 5) * 10;
  return p;
}

export interface QrCode {
  size: number;
  version: number;
  mask: number;
  /** 第 y 行第 x 列是不是深色。 */
  dark(x: number, y: number): boolean;
}

/** 把一串文字（UTF-8）编成二维码；太长（超过版本 5 能装的）返回 null。 */
export function makeQr(text: string): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  const version = SPEC.findIndex((s) => s.data * 8 >= 4 + 8 + bytes.length * 8) + 1;
  if (version <= 0) return null;
  const words = codewords(bytes, version);
  const base = place(version);
  fill(base, words);
  let best: Uint8Array | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const d = base.dark.slice();
    const f = MASKS[m];
    for (let y = 0; y < base.size; y++) for (let x = 0; x < base.size; x++) if (!base.fixed[y * base.size + x] && f(x, y)) d[y * base.size + x] ^= 1;
    const g = { ...base, dark: d };
    writeFormat(g, m);
    const s = penalty(base.size, d);
    if (s < bestScore) {
      bestScore = s;
      best = d;
      bestMask = m;
    }
  }
  const d = best!;
  const size = base.size;
  return { size, version, mask: bestMask, dark: (x, y) => d[y * size + x] === 1 };
}
