// m4a 瘦身：afconvert 写出来的 .m4a 顶层有一块约 2.5 KB 的 free（留着给以后改元数据的空白），
// 音效几百个文件、每个 1–5 KB 的音频，这一块占了快三分之一。去掉它，mdat 往前挪，stco / co64 里的块偏移跟着减。
// moov 里的 udta 留着：里面的 iTunSMPB 记着编码延迟和结尾补的样本数，浏览器靠它去掉 AAC 开头的那几十毫秒。
// 只动这一个盒子，音频数据一个字节不改（2026-11-12 瘦身，docs/audio.md「瘦身」）。

const u32 = (b: Buffer, o: number) => b.readUInt32BE(o);
const typeAt = (b: Buffer, o: number) => b.toString('latin1', o + 4, o + 8);

interface Box {
  type: string;
  start: number;
  size: number;
}

function boxes(b: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    if (size === 1) size = Number(b.readBigUInt64BE(o + 8));
    else if (size === 0) size = to - o;
    if (size < 8 || o + size > to) throw new Error(`m4a 盒子越界：${typeAt(b, o)} @${o}`);
    out.push({ type: typeAt(b, o), start: o, size });
    o += size;
  }
  return out;
}

/** 去掉顶层的 free / skip，修正块偏移。不认识的结构原样返回。 */
export function slimM4a(src: Buffer): Buffer {
  const top = boxes(src, 0, src.length);
  const moov = top.find((x) => x.type === 'moov');
  const mdat = top.find((x) => x.type === 'mdat');
  if (!moov || !mdat) return src;
  const inner = boxes(src, moov.start + 8, moov.start + moov.size);
  const moovBody = Buffer.concat(inner.map((x) => src.subarray(x.start, x.start + x.size)));
  const newMoov = Buffer.alloc(8 + moovBody.length);
  newMoov.writeUInt32BE(newMoov.length, 0);
  newMoov.write('moov', 4, 'latin1');
  moovBody.copy(newMoov, 8);
  // 顶层：去掉 free / skip
  const kept = top.filter((x) => x.type !== 'free' && x.type !== 'skip');
  const parts = kept.map((x) => (x.type === 'moov' ? newMoov : src.subarray(x.start, x.start + x.size)));
  // mdat 往前挪了多少
  let newMdatStart = 0;
  for (const x of kept) {
    if (x.type === 'mdat') break;
    newMdatStart += x.type === 'moov' ? newMoov.length : x.size;
  }
  const delta = mdat.start - newMdatStart;
  if (delta === 0) return src;
  // 改 stco / co64（在新的 moov 里找，trak > mdia > minf > stbl）
  const fix = (buf: Buffer, from: number, to: number) => {
    for (const x of boxes(buf, from, to)) {
      if (['trak', 'mdia', 'minf', 'stbl'].includes(x.type)) fix(buf, x.start + 8, x.start + x.size);
      else if (x.type === 'stco') {
        const n = u32(buf, x.start + 12);
        for (let i = 0; i < n; i++) {
          const p = x.start + 16 + i * 4;
          buf.writeUInt32BE(u32(buf, p) - delta, p);
        }
      } else if (x.type === 'co64') {
        const n = u32(buf, x.start + 12);
        for (let i = 0; i < n; i++) {
          const p = x.start + 16 + i * 8;
          buf.writeBigUInt64BE(buf.readBigUInt64BE(p) - BigInt(delta), p);
        }
      }
    }
  };
  fix(newMoov, 8, newMoov.length);
  return Buffer.concat(parts);
}
