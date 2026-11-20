// 二维码编码（qr.ts）的测试：和标准里的参照值对（格式信息表、Reed-Solomon 的经典例子），再查结构（大小、定位图案、版本挑选）。
// 能不能真扫出来，开发时用独立的解码器（jsQR）对截图核对过，见 docs/netcode.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBits, makeQr, rsEncode } from './qr.ts';

test('二维码：纠错等级 L 的格式信息和标准的表一致', () => {
  // ISO/IEC 18004 表 C.1，纠错等级 L、掩码 0–7
  const table = ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'];
  for (let m = 0; m < 8; m++) assert.equal(formatBits(m).toString(2).padStart(15, '0'), table[m], `掩码 ${m}`);
});

test('二维码：Reed-Solomon 纠错码字（「HELLO WORLD」1-M 的经典例子）', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('二维码：按长度挑版本；三个角上有定位图案；太长返回 null', () => {
  const finder = (q: NonNullable<ReturnType<typeof makeQr>>, ox: number, oy: number) => {
    for (let dy = 0; dy < 7; dy++)
      for (let dx = 0; dx < 7; dx++) {
        const r = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        assert.equal(q.dark(ox + dx, oy + dy), r !== 2, `(${ox + dx}, ${oy + dy})`);
      }
  };
  for (const [text, v] of [
    ['HELLO', 1],
    ['http://localhost:5180/?room=7SB8', 2],
    ['http://192.168.1.23:5180/?room=ABCD', 3],
  ] as const) {
    const q = makeQr(text)!;
    assert.equal(q.version, v, text);
    assert.equal(q.size, 17 + v * 4);
    finder(q, 0, 0);
    finder(q, q.size - 7, 0);
    finder(q, 0, q.size - 7);
    // 时序线：第 6 行、第 6 列深浅交替
    for (let i = 8; i < q.size - 8; i++) {
      assert.equal(q.dark(i, 6), i % 2 === 0);
      assert.equal(q.dark(6, i), i % 2 === 0);
    }
    assert.equal(q.dark(8, q.size - 8), true, '固定的深色模块');
  }
  assert.equal(makeQr('x'.repeat(120)), null);
});
