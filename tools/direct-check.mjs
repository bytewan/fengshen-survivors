// 两份真实浏览器页面验证数据通道的大消息、重建连接和房主迁移。
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';

const source = stripTypeScriptTypes(await readFile('src/net/direct.ts', 'utf8')).replace('export class DirectPeers', 'globalThis.DirectPeers = class DirectPeers');
const browser = await chromium.launch();
const lateIce = process.argv.includes('--late-ice');
try {
  const pages = [await browser.newPage(), await browser.newPage()];
  for (const [i, p] of pages.entries()) {
    await p.exposeFunction('signal', async (_id, text) => {
      if (lateIce) {
        const m = JSON.parse(text);
        // 初始描述不带地址，地址三秒后才到：旧的两秒收集方案无法覆盖此情况。
        if (m.sdp) m.sdp = m.sdp.split('\r\n').filter(line => !line.startsWith('a=candidate:') && line !== 'a=end-of-candidates').join('\r\n');
        if (m.type === 'ice') await new Promise(resolve => setTimeout(resolve, 3000));
        text = JSON.stringify(m);
      }
      return pages[1 - i].evaluate(({ from, text }) => window.peer.accept(from, text), { from: i + 1, text });
    });
    await p.addScriptTag({ content: source, type: 'module' });
    await p.evaluate(() => {
      window.received = [];
      window.peer = new window.DirectPeers(window.signal, (_id, text) => { if (text !== '{"t":"rtc-ready"}') window.received.push(text); }, () => {}, () => {});
    });
  }
  const members = [{ id: 1, on: true }, { id: 2, on: true }];
  await pages[1].evaluate(members => window.peer.update(2, 1, members), members);
  await pages[0].evaluate(members => window.peer.update(1, 1, members), members);
  for (const p of pages) await p.waitForFunction(() => window.peer.ready);
  const large = '封神🗡'.repeat(25000);
  await pages[0].evaluate(text => window.peer.send(text), large);
  await pages[1].waitForFunction(() => window.received.length === 1);
  assert.equal(await pages[1].evaluate(() => window.received[0]), large);
  console.log('PASS 大消息可靠分片，中文与表情完整恢复');
  const state = '状态片段'.repeat(3000);
  await pages[0].evaluate(text => window.peer.send(text, undefined, true), state);
  await pages[1].waitForFunction(text => window.received.includes(text), state);
  assert.ok(await pages[1].evaluate(() => [...window.peer.peers.values()][0].stateChannel.ordered === false && [...window.peer.peers.values()][0].stateChannel.maxRetransmits === 0));
  console.log('PASS 独立状态通道无序无重传，分片完整恢复');

  await pages[1].evaluate(() => [...window.peer.peers.values()][0].pc.close());
  await pages[0].waitForFunction(() => !window.peer.ready, null, { timeout: 10000 });
  for (const p of pages) await p.waitForFunction(() => window.peer.ready, null, { timeout: 20000 });
  await pages[0].evaluate(() => window.peer.send('after-reconnect'));
  await pages[1].waitForFunction(() => window.received.includes('after-reconnect'));
  console.log('PASS 数据通道关闭后重新协商，消息恢复');

  await pages[0].evaluate(members => window.peer.update(1, 2, members), members);
  await pages[1].evaluate(members => window.peer.update(2, 2, members), members);
  for (const p of pages) await p.waitForFunction(() => window.peer.ready);
  await pages[1].evaluate(() => window.peer.send('new-host'));
  await pages[0].waitForFunction(() => window.received.includes('new-host'));
  console.log('PASS 房主切换后重建直连');
  for (const p of pages) await p.evaluate(() => window.peer.close());
} finally {
  await browser.close();
}
