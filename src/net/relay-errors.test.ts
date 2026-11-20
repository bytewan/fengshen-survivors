import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Link } from './link.ts';

const { WebSocketServer } = createRequire(import.meta.url)('ws');

test('建房被拒绝时保留服务端原因，不把连接失效或繁忙误报成四人满员', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  server.on('connection', (socket: { on: Function; send: Function }) => {
    socket.on('message', (data: Buffer) => {
      const request = JSON.parse(data.toString());
      if (request.t === 'create') socket.send(JSON.stringify({ t: 'err', code: 'full', msg: request.name }));
    });
  });
  try {
    for (const reason of ['连接已失效，请重新加入', '建房过于频繁，请稍后重试', '房间满了']) {
      const link = new Link(`ws://127.0.0.1:${server.address().port}`);
      try {
        await assert.rejects(link.create(reason, {}), { message: reason });
      } finally {
        link.close();
      }
    }
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(resolve));
  }
});
