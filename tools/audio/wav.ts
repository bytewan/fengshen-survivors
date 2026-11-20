// 最小 WAV 读写（PCM 8/16/24/32 位整数、32/64 位浮点），只给 Node 工具用。
// 读出来统一成每声道一条 Float32Array（-1..1）。

export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}

export function readWav(buf: Buffer): Pcm {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是 WAV');
  let off = 12;
  let fmt: { tag: number; ch: number; sr: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    if (id === 'fmt ') {
      let tag = body.readUInt16LE(0);
      if (tag === 0xfffe) tag = body.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE：子格式 GUID 的前两字节
      fmt = { tag, ch: body.readUInt16LE(2), sr: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('缺 fmt 或 data 块');
  const { tag, ch, sr, bits } = fmt;
  const bps = bits / 8;
  const n = Math.floor(data.length / (bps * ch));
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const p = (i * ch + c) * bps;
      let v: number;
      if (tag === 3) v = bits === 32 ? data.readFloatLE(p) : data.readDoubleLE(p);
      else if (bits === 8) v = (data[p] - 128) / 128;
      else if (bits === 16) v = data.readInt16LE(p) / 32768;
      else if (bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else v = data.readInt32LE(p) / 2147483648;
      out[c][i] = v;
    }
  return { sampleRate: sr, channels: out };
}

/** 写成 16 位 PCM（交给 afconvert 编码前的中间文件）。 */
export function writeWav16(pcm: Pcm): Buffer {
  const ch = pcm.channels.length;
  const n = pcm.channels[0].length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(pcm.sampleRate, 24);
  buf.writeUInt32LE(pcm.sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * ch * 2, 40);
  let p = 44;
  // 三角抖动，免得淡出尾巴量化成颗粒；用固定种子的伪随机，同样的配方每次生成的文件完全一样
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const d = (rnd() - rnd()) / 32768;
      const v = Math.max(-1, Math.min(1, pcm.channels[c][i] + d));
      buf.writeInt16LE(Math.round(v * 32767), p);
      p += 2;
    }
  return buf;
}
