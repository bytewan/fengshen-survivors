// 一次启动生产网页和内网中继，不修改 Pages 使用的 dist/。
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { startRelay, lanAddresses } from '../server/relay.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.env.GAME_BASE_PATH = '/';
process.env.VITE_RELAY_URL = '';
const port = Number(process.env.LAN_PORT || 5181);
const relayPort = Number(process.env.LAN_RELAY_PORT || 5300);
for (const n of [port, relayPort]) {
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('端口必须是 1024–65535 的整数');
}
if (port === relayPort) throw new Error('网页和中继需要使用不同端口');

let relay;
let web;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([
    relay?.shutdown('局域网房主关闭程序'),
    web && new Promise(resolve => web.httpServer.close(resolve)),
  ]);
}
try {
  console.log('正在准备局域网游戏…');
  await build({ base: '/', build: { outDir: 'dist-lan' } });
  relay = await startRelay({ port: relayPort, host: '0.0.0.0', lan: true, trustProxy: false, maxRooms: 100, maxConns: 400 });
  web = await preview({ base: '/', build: { outDir: 'dist-lan' }, preview: { host: '0.0.0.0', port, strictPort: true } });
  console.log('\n局域网游戏已启动。以下网址可以发给同一网络的玩家：');
  for (const host of [...lanAddresses(), 'localhost']) {
    const u = new URL(`http://${host}:${port}/`);
    u.searchParams.set('online', '');
    u.searchParams.set('network', 'lan');
    u.searchParams.set('relay', `ws://${host}:${relayPort}`);
    console.log(u.href);
  }
  console.log('房主建房后可复制邀请链接或展示二维码。保持电脑和此程序运行，Ctrl+C 结束。');
  console.log('无法连接时检查系统防火墙、访客 Wi-Fi 的设备隔离；勿将这两个端口映射到公网。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop().then(() => process.exit(0)));
} catch (error) {
  console.error(`局域网启动失败：${error.message}`);
  await stop();
  process.exitCode = 1;
}
