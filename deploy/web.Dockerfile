# 静态页（游戏本身）的镜像：先在 node 里构建（npm ci && npm run build && 预压缩），再交给 Caddy 或 nginx 托管，
# 同时由它们把 /relay 反向代理给中继（WebSocket）。docker-compose.yml 按 target 选一个：
#   caddy（默认）：自动申请、续期 HTTPS 证书（Let's Encrypt / ZeroSSL），配置 deploy/Caddyfile
#   nginx        ：用云厂商控制台发的证书（放 deploy/certs/），配置 deploy/nginx/
# 单独构建（在仓库根目录跑）：docker build -f deploy/web.Dockerfile --target caddy -t fengshen-web .
# 国内拉 npm 慢的话：--build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NPM_REGISTRY=
COPY package.json package-lock.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.json vite.config.ts index.html ./
COPY src src
COPY public public
COPY tools tools
COPY vendor vendor
RUN npm run build && node tools/precompress.mjs dist

# ---------- Caddy ----------
FROM caddy:2-alpine AS caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 deploy/site-sync.sh /usr/local/bin/site-sync
COPY --from=build /app/dist /app/dist
# 起来时先把这一版拷进数据卷 /srv/site（旧版本的 assets 留着，见 site-sync.sh），再起 Caddy
CMD ["sh", "-c", "site-sync /app/dist /srv/site && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]

# ---------- nginx ----------
FROM nginx:1.28-alpine AS nginx
COPY deploy/nginx/fengshen-site.conf /etc/nginx/snippets/fengshen-site.conf
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
# 官方镜像的入口会先跑 /docker-entrypoint.d/ 里的脚本（也会把 templates 里的 ${SERVER_NAME} 换掉），再起 nginx
COPY --chmod=755 deploy/site-sync.sh /docker-entrypoint.d/40-site-sync.sh
COPY --from=build /app/dist /app/dist
