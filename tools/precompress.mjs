// 预压缩：给 dist/ 里的文本文件（脚本、页面、manifest、许可文本……）各写一份 .gz 和 .br，放在原文件旁边。
// 部署时 nginx（gzip_static on）和 Caddy（file_server precompressed br gzip）直接发这些，不用每次现压；Caddy 还能发 brotli（比 gzip 再小一成多）。
// 字体（woff2）、音频（m4a）、PNG 本来就压缩过，不管。每个文本文件都写（不管大小、压完是不是更小）：
// 部署的数据卷里会留着旧版本的文件（docs/deploy.md「更新」），每一版都把旁边的 .gz / .br 一起盖掉，才不会留下和新文件对不上的旧压缩包。
//
// 用法：node tools/precompress.mjs [dist]   （deploy/web.Dockerfile 在 npm run build 之后跑；本机一般用不着）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = path.resolve(process.argv[2] ?? 'dist');
const TEXT = /\.(js|mjs|css|html|json|webmanifest|svg|txt|xml|map)$/i;
let n = 0;
let raw = 0;
let gz = 0;
let br = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (TEXT.test(e.name)) {
      const buf = fs.readFileSync(p);
      const g = zlib.gzipSync(buf, { level: 9 });
      const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      fs.writeFileSync(`${p}.gz`, g);
      fs.writeFileSync(`${p}.br`, b);
      n++;
      raw += buf.length;
      gz += g.length;
      br += b.length;
    }
  }
};
if (!fs.existsSync(dir)) {
  console.error(`没有 ${dir}：先 npm run build`);
  process.exit(1);
}
walk(dir);
const kb = (x) => `${(x / 1024).toFixed(0)} KB`;
console.log(`预压缩 ${n} 个文本文件：原始 ${kb(raw)} → gzip ${kb(gz)}、brotli ${kb(br)}`);
