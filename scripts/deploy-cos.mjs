// 上传已构建的静态游戏；凭证只从环境或指定的本机文件读取。
import { createHash, createHmac } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const arg = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? undefined : process.argv[i + 1]; };
const bucket = arg('bucket'), region = arg('region');
const prefix = arg('prefix') || 'fengshen-survivors';
const dir = resolve(arg('dir') || 'dist');
if (!bucket || !/^[a-z0-9-]+-\d+$/.test(bucket) || !region || !/^ap-[a-z0-9-]+$/.test(region) || !/^[a-z0-9_-]+$/.test(prefix)) throw new Error('需要有效的 --bucket、--region 和独立目录 --prefix');
if (arg('credentials')) process.loadEnvFile(resolve(arg('credentials')));
const secretId = process.env.COS_SECRET_ID, secretKey = process.env.COS_SECRET_KEY;
const dry = process.argv.includes('--dry-run');
if (!dry && (!secretId || !secretKey)) throw new Error('需要 COS_SECRET_ID / COS_SECRET_KEY，或 --credentials 本机凭证文件');
const host = `${bucket}.cos.${region}.myqcloud.com`;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const files = [];
async function walk(folder, rel = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = rel + entry.name;
    if (entry.name === '.nojekyll') continue;
    if (entry.isDirectory()) await walk(join(folder, entry.name), name + '/');
    else if (entry.isFile()) {
      const ext = name.slice(name.lastIndexOf('.'));
      if (!mime[ext]) throw new Error(`拒绝上传未知文件类型：${name}`);
      files.push({ name, ext });
    }
  }
}
await walk(dir);
if (!files.some(f => f.name === 'index.html')) throw new Error('构建目录缺少 index.html');
const hmac = (key, value) => createHmac('sha1', key).update(value).digest('hex');
function auth(method, path) {
  const start = Math.floor(Date.now() / 1000) - 5, time = `${start};${start + 600}`;
  const http = `${method.toLowerCase()}\n${path}\n\nhost=${encodeURIComponent(host)}\n`;
  const hash = createHash('sha1').update(http).digest('hex');
  const signature = hmac(hmac(secretKey, time), `sha1\n${time}\n${hash}\n`);
  return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}
async function upload(file, alias) {
  const key = alias ?? `${prefix}/${file.name}`;
  const path = '/' + key.split('/').map(encodeURIComponent).join('/');
  let body = await readFile(join(dir, file.name));
  const compressed = ['.html', '.js', '.css', '.json', '.svg'].includes(file.ext);
  if (compressed) body = gzipSync(body);
  if (dry) { console.log(`${key} ${body.length}B`); return; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://${host}${path}`, {
      method: 'PUT', body,
      headers: {
        Authorization: auth('PUT', path),
        'Content-Type': mime[file.ext],
        'Content-MD5': createHash('md5').update(body).digest('base64'),
        'Cache-Control': file.ext === '.html' ? 'no-cache, no-store, must-revalidate' : file.name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    await response.body?.cancel();
    if (response.ok) return;
    // 不输出鉴权响应正文，避免日志包含凭证相关字段。
    if (response.status < 500 || attempt === 2) throw new Error(`上传失败 ${key} HTTP ${response.status} request-id=${response.headers.get('x-cos-request-id') ?? ''}`);
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
}
// 先上传全部资源，最后更新入口；不删除旧版本资源。
const assets = files.filter(f => f.ext !== '.html');
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (cursor < assets.length) await upload(assets[cursor++]); }));
for (const file of files.filter(f => f.ext === '.html')) await upload(file);
// 目录 URL 也保存入口，支持 COS 普通对象域名直接访问，不修改桶的全局网站配置。
await upload(files.find(f => f.name === 'index.html'), prefix + '/');
console.log(`${dry ? '上传计划' : '上传完成'}：${files.length + 1} 个对象，目录 ${prefix}/`);
