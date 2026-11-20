#!/bin/sh
# 把源码推到服务器、在服务器上构建并起来（或更新）。在 Mac 上、项目根目录跑：
#   DEPLOY_HOST=ubuntu@1.2.3.4 sh deploy/push.sh            # 推到 /opt/fengshen，然后 docker compose up -d --build
#   DEPLOY_HOST=ubuntu@1.2.3.4 DEPLOY_DIR=/srv/fs sh deploy/push.sh
#   DRY_RUN=1 DEPLOY_HOST=ubuntu@1.2.3.4 sh deploy/push.sh  # 只列出会传哪些文件，不真传、不动服务器
# 前提（docs/deploy.md「一步步部署」）：服务器上装好了 Docker 和 compose 插件、配好了 Docker Hub 镜像加速，
# 服务器的 DEPLOY_DIR/deploy/.env 已经按 .env.example 填好（第一次推完之后去填，再跑一次这个脚本）。
#
# 这个项目只有本地 git、没有远端，所以直接用 rsync 推源码（约 15 MB；--delete：服务器上那份和本地的提交一模一样；
# 服务器上的 deploy/.env、deploy/certs/ 被排除在外，不会被删；文档、概念图（根目录的 art/，不是 src/art/）、skills 用不着，不传；
# 排除的写法都以 / 开头 = 只认仓库根目录下的那一个，不然 art/ 会把 src/art/ 也排除掉）。推之前先确认工作区是干净的、测试过了。
set -eu
: "${DEPLOY_HOST:?要设 DEPLOY_HOST，例如 DEPLOY_HOST=ubuntu@1.2.3.4}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/fengshen}"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有没提交的改动：先提交（服务器上要和某个提交一模一样，出了问题才好回退）" >&2
  git status --short >&2
  exit 1
fi
echo "推送 $(git log --oneline -1) → $DEPLOY_HOST:$DEPLOY_DIR"

RSYNC_DRY=""
[ "${DRY_RUN:-}" = "1" ] && RSYNC_DRY="--dry-run --itemize-changes"
# shellcheck disable=SC2086
rsync -az --delete $RSYNC_DRY \
  --exclude '/.git' --exclude 'node_modules/' --exclude '/dist/' --exclude '/scratch/' --exclude '/.wt/' --exclude '/.venv/' \
  --exclude '/.agents/' --exclude '/art/' --exclude '/docs/' \
  --exclude '.DS_Store' --exclude '*.key' --exclude '/deploy/.env' --exclude '/deploy/certs/' \
  ./ "$DEPLOY_HOST:$DEPLOY_DIR/"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "（DRY_RUN：没真传，也没动服务器）"
  exit 0
fi
# 服务器上：构建（npm ci 在 Docker 的层缓存里，依赖没变时很快）并起来；中继的镜像没变时容器不重建，正在打的联机局不受影响
ssh "$DEPLOY_HOST" "cd '$DEPLOY_DIR/deploy' && test -f .env || { echo '服务器上还没有 $DEPLOY_DIR/deploy/.env：照 .env.example 填一份再跑'; exit 1; } && docker compose up -d --build && docker compose ps"
