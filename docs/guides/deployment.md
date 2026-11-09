# Docker Compose 自托管部署

首发目标为阿里云 Linux 服务器：**1 vCPU、1 GB RAM、40 Mbps 出口带宽**。
单个 Node.js 容器提供前端与 API，
SQLite 文件存放在 Docker named volume。不需要 Kubernetes、独立数据库或 Cloudflare 产品。
40M 按 Mbps 计，理论出口上限约 5 MB/s，不是 40 MB/s；实际可用吞吐低于理论值。
此规格是部署目标，不是已完成压测的容量承诺；实际需求取决于数据量、图片/轨迹附件和同时在线人数。
首发使用下文“阿里云自动发布”流程，入口为 `https://wolfife.top/family/`；
前面的通用步骤适用于独立站点手动部署，不要在现有生产目录另起一个不同项目名的 Compose 实例。

## 资源预算与构建边界

| 项目 | 首发配置 |
| --- | --- |
| 应用实例 | 1 个 Node.js 进程，容器最多使用 1 核 |
| 应用内存 | 容器硬上限 512 MiB；V8 old space 上限 256 MiB |
| 主机余量 | 其余约半数内存留给操作系统、Docker、反向代理和文件缓存 |
| 日志 | `json-file` 轮转，每文件 10 MiB，最多 3 个文件 |
| 数据库 | 本机持久卷中的 SQLite，禁止多副本共享写入 |
| 构建 | 在开发机或 CI 上完成，生产服务器仅加载/拉取并运行镜像 |

V8 old space 不是进程总内存；Buffer、SQLite、原生模块和健康检查进程也会占用容器内存。
达到容器上限可能触发 OOM，重启策略不能代替容量规划。不要在这台机器上同时跑构建、OCR 服务或其他重型应用。
Swap 可以缓解主机瞬时内存压力，但不能替代运行内存，也不作为上线通过条件。

### 阿里云与国内镜像加速

允许使用阿里云相关镜像服务，不使用 Cloudflare。GitHub 托管构建机默认使用官方源；
国内构建机可以指定自己的阿里云容器镜像加速地址与 npm 镜像：

```bash
docker build --platform linux/amd64 \
  --build-arg NODE_IMAGE='<你的阿里云加速地址>/library/node:22-bookworm-slim' \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg APP_BASE_PATH=/family/ \
  --tag family-tree:local .
```

使用阿里云控制台为当前账号提供且可访问的 Docker 加速地址，不假定网上的共享地址长期有效。
镜像必须保持 Node 22 + Debian bookworm，并匹配目标架构，确保 SQLite 原生模块兼容。
npm 使用锁文件和完整性校验，不删除 lockfile、不关闭 TLS 校验；镜像未同步或不可用时应明确失败，
检查后切回官方源，而不是静默跳过依赖安装。
GitHub Release 构建可通过 `FAMILY_NODE_IMAGE`、`FAMILY_NPM_REGISTRY` 仓库变量选择同样的参数。
参数仅作用于本次构建，不修改本机或服务器的 Docker daemon、npm 全局配置；
生产发布包已包含运行依赖，无需在 1 GB 服务器上执行 npm 安装。

## 1. 准备服务器

- 安装 Docker Engine 和 Docker Compose v2。
- 确认主机 CPU 架构（`uname -m`）；构建镜像时选择匹配的平台。`x86_64` 对应
  `linux/amd64`，`aarch64` 对应 `linux/arm64`；不要仅凭云厂商名称假定架构。
- 创建固定部署目录，只需放入 `docker-compose.yml` 和 `.env`；无需在服务器安装 Node.js、npm 或完整源码。
- 为外部访问准备 HTTPS 反向代理。Compose 默认只把服务绑定到 `127.0.0.1:3000`，
  不会直接向公网开放 HTTP 端口；可使用 Caddy、Nginx 或现有代理终止 TLS。
- 阿里云安全组和主机防火墙只开放业务所需的 80/443，SSH 限制管理来源；不要开放 3000。
  中国内地节点使用域名提供网站服务时，上线前确认域名备案等适用要求。

## 2. 首次启动

在有足够内存的开发机或构建机上，为目标架构构建镜像。以下以 `linux/amd64` 为例；
`release-001` 是示例镜像标签，每次发布使用新的可追溯标签，不覆盖已上线标签：

```bash
docker build --platform linux/amd64 --tag family-tree:release-001 .
docker save family-tree:release-001 | gzip > family-tree-release-001.tar.gz
node scripts/generate-admin-secret.mjs
```

按提示在终端输入一个至少 12 位的初始化密码，输入不会回显。
通过 SSH/SCP 将镜像包、`docker-compose.yml` 和 `.env.example` 传到服务器的固定部署目录。
也可以使用自己配置且服务器可访问的镜像仓库；自动发布流程使用 GitHub Release 附件传递镜像，
不会上传到容器镜像仓库。
阿里云节点若拉取外部镜像不稳定，可使用上述离线镜像包，不依赖 Docker Hub 的生产机拉取链路。

在服务器部署目录执行：

```bash
cp .env.example .env
chmod 600 .env
docker load --input family-tree-release-001.tar.gz
```

编辑 `.env`，设置 `APP_IMAGE=family-tree:release-001`，并将本地生成的
`SYSADMIN_PASSWORD_PBKDF2='…'` 整行粘贴进去。不要把密码或哈希写进提交或构建镜像：

```bash
docker compose up -d --wait --wait-timeout 90
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

浏览器通过反向代理访问站点，在登录页使用手机号和初始化密码创建首位管理员；
首次登录后必须设置独立密码。确认管理员已完成改密后，可从 `.env` 删除
`SYSADMIN_PASSWORD_PBKDF2` 并重建容器；该值只用于首次初始化或受控恢复，不是日常登录密码。

服务日志不应包含密码或管理员哈希：

```bash
docker compose logs --tail=100 app
```

## 3. HTTPS、网络与来源限流

默认的 `BIND_ADDRESS=127.0.0.1` 只允许本机反向代理访问容器端口。除非已经配置好防火墙和 TLS，
不要改为 `0.0.0.0` 或直接把应用端口暴露到公网。若代理在另一台机器上，应通过受控私网连接，
不要无保护地开放应用端口。

默认 `TRUST_PROXY=false`，来源限流使用 Node 服务看到的 TCP 对端地址，不信任转发头。
同机反向代理下所有请求会共享代理地址的来源配额。仅当应用端口无法被代理以外的客户端访问，
且代理会覆盖（而不是盲目追加）`X-Forwarded-For` 时，才在 `.env` 设置 `TRUST_PROXY=true`；
信任错误会让客户端伪造来源地址并绕过限流。账号维度限流始终生效。

在反向代理启用文本资源压缩（例如 gzip），降低 JS/CSS/JSON 的出口占用；不要重复压缩图片。
应用已对带哈希的 `/assets/` 资源设置长期缓存，代理应保留该响应头；不要缓存登录接口或族谱 API。
40 Mbps 是整台主机共享出口，不能据此推算可支持的同时在线人数。

## 4. SQLite 数据与备份

- 数据库文件位于容器内 `/data/family-tree.sqlite`，由 `family-tree-data` named volume 持久化。
- `docker compose down` 不会删除数据；不要对包含业务资料的实例使用 `docker compose down -v`。
- SQLite 适合单台服务器和单个应用实例。不要启动多个应用副本共同写同一个数据库文件；
  需要多机写入或高并发时，应先评估并迁移到独立数据库，而不是共享 SQLite 文件。
- 数据库启用外键、WAL 和完整同步。定期备份整个 volume，备份前停止应用以确保数据库与 WAL 文件一致：

```bash
docker compose stop app
docker volume ls
docker run --rm \
  -v <compose项目名>_family-tree-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar -czf /backup/family-tree-data-$(date +%F).tar.gz -C /data .
docker compose start app
```

恢复前停止服务并先复制一份现有 volume；解压备份文件到该 volume 后再启动。至少定期演练一次恢复，
并将备份复制到服务器以外的安全位置。界面导出的 JSON / SQLite 文件是族谱业务快照，
不包含账号、密码摘要或会话；整库备份才包含认证数据。

## 5. 从旧在线版本迁移

在旧站点的维护界面导出完整 JSON 或 SQLite 业务快照，然后在新站点使用管理员账号登录，
通过导入功能预览并恢复数据。在线数据库不会被新版本自动连接、复制或删除。
业务快照不包含登录账号，须在新实例重新创建用户并安全交付临时密码。

## 6. 更新版本

先在构建机完成新版本构建，再传输并加载新标签镜像，或从配置好的仓库拉取。
在服务器的原部署目录修改 `.env` 的 `APP_IMAGE` 指向新标签，然后执行：

```bash
docker compose up -d --wait --wait-timeout 90
docker compose ps
```

更新前先完成数据库备份；保留旧镜像，确认健康检查和登录、读写正常后再清理。
保持部署目录或 Compose 项目名不变，避免意外使用新的空数据卷。
回滚镜像前确认数据库结构兼容；不兼容时需要在停止服务后恢复发布前的整库备份。
普通 CI 只检查代码和容器；版本标签的 Release 工作流还会发布镜像包。
服务器按下文的定时任务主动拉取，不需要 GitHub Actions 连接服务器的 SSH 端口。

## 7. 阿里云上线验收

在目标服务器上使用代表性数据检查首次管理员初始化、登录、浏览、保存、导入/导出；
重启容器后确认数据仍在，并完成一次备份恢复演练。用实际预计的并发量验证，而不是仅检查空库健康接口。

```bash
docker stats --no-stream
docker inspect "$(docker compose ps -q app)" \
  --format 'OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
free -m
df -h
```

观察持续内存占用、重启次数、响应延迟和磁盘空间；出现 OOM、持续交换或明显阻塞时，
先限制大批量操作、减少负载或升级规格，不应简单移除容器上限。
CI 的受限容器启动检查不等同于阿里云 1 GB 主机的压力测试，上述验收仍需在实机完成。

## 8. 本地验证

```bash
npm ci
npm test
npm run build
npm run build:server
docker build --tag family-tree:local .
docker compose config
docker compose up -d --wait --wait-timeout 90
```

本地完整运行可先准备 `.env` 中的初始化哈希，再执行 `npm run preview:local`；
默认数据库路径为 `data/family-tree.sqlite`。`npm run dev` 仅启动 Vite 前端开发服务器，
不代表 Node API 或 SQLite 服务已启动。

## 9. 阿里云自动发布

### 固定部署拓扑

- SSH 目标：`web@106.14.43.188`，部署根目录 `/srv/family-tree`。
- HTTPS 入口：`https://wolfife.top/family/`，复用 `stock-analyze-nginx` 和现有证书，
  保留原站点根路径，不新增公网应用端口。
- 应用通过 `docker-compose.production.yml` 加入既有 `stock-analyze_default` 网络，
  使用唯一别名 `family-tree-app`。不要删除这个共享网络；Nginx 与应用必须保留网络连接。
- Nginx 将 `/family/` 前缀剥离后转发到应用；镜像构建时使用
  `--build-arg APP_BASE_PATH=/family/`。仅修改运行环境变量不能改变已经构建好的前端路径。
- `deploy/nginx-family.conf` 是现有 HTTPS `server` 块内的配置片段，不是完整站点文件。
  Docker DNS 动态解析后端，容器更新时无需替换固定 IP；代理覆盖来源地址，允许开启 `TRUST_PROXY`。
  该共享网络中的其他服务应同样受信任。请求体限制为 10 MiB，大型导入须先拆分或评估内存后调整限制。
- 同一域名下的其他页面与族谱共享浏览器 origin，不构成安全隔离边界；
  原站点必须可信，未来需要隔离时应改用独立域名。

首次接入需由管理员授权部署目录和 Nginx 配置写入；不能使用 Docker 绕过未授予的主机文件权限。
修改代理前备份原文件、执行 `nginx -t`，成功后再平滑 reload；保留原文件 inode，
避免 bind mount 仍指向被替换的旧文件。自动发布只更新族谱应用，不改写共享 Nginx 配置。

### 构建与定时拉取

推送与 `package.json`、`package-lock.json` 一致的 `vX.Y.Z` 标签触发 `.github/workflows/release.yml`。
流水线执行测试、版本核对、`linux/amd64` 镜像构建、512 MiB 受限容器启动检查，
将镜像与部署脚本打包到 GitHub Release；发布包上限为 120 MiB。
服务器运行镜像只安装 `server` 工作区的依赖，不包含图标库等前端构建依赖。
此流程不会自动合并功能分支；标签所指向的提交才是发布内容。

服务器的 `web` 用户 crontab 每周四 **22:00 Asia/Shanghai（北京时间）** 执行一次
`/srv/family-tree/bin/run-weekly.sh`。系统时区必须保持 `Asia/Shanghai`，且 `cron` 服务保持运行；
任务启动时会检查时区，时区不符时记录错误并拒绝部署；
机器关机期间不会补跑。每次检查 GitHub 的最新非草稿、非预发布 Release，只部署新的 `vX.Y.Z`；
版本未变时只检查本机健康状态，不重启容器；不会自动降级。

服务器需能通过 IPv4 HTTPS 访问 `api.github.com` 和 GitHub Release 资产下载端点。
当前公开仓库无需 GitHub 凭据；仓库若改为私有，必须先另行设计受限的读取凭据。
运行端不需要 npm、Docker Hub 或入站 SSH 访问；保留现有 22 端口白名单。
自动拉取信任仓库发布者：发布包 SHA-256 由 GitHub Release 元数据提供，能检测下载损坏，
但并不是独立的发布签名。应严格限制有权限创建或替换 Release 的账号。

首次安装或更新定时任务时，在有 SSH 权限的管理机执行：

```bash
ssh web@106.14.43.188 'mkdir -p /srv/family-tree/installer'
scp scripts/install-schedule.sh scripts/pull-release.py scripts/run-weekly.sh \
  web@106.14.43.188:/srv/family-tree/installer/
ssh web@106.14.43.188 'bash /srv/family-tree/installer/install-schedule.sh && crontab -l'
```

安装程序只管理自己的 crontab 标记块、保留其他任务；并检查当前时区和 cron 状态。
成功部署的新发布包可以更新拉取脚本和日志包装脚本，不会修改其他 cron 任务。
需要临时立即检查并发布时，在服务器执行：

```bash
DEPLOY_ROOT=/srv/family-tree /bin/bash /srv/family-tree/bin/run-weekly.sh
tail -n 100 /srv/family-tree/logs/weekly-deploy.log
```

日志达到 5 MiB 时保留一份轮转文件。拉取失败写入日志并返回非零状态，
不会停止现有应用；下次定时运行才会再次检查，也可由管理员手动重试。
没有配置独立告警时，需要主动检查日志。

### 更新与失败处理

部署脚本 `scripts/deploy.sh` 在服务器上使用 `flock` 加锁，保持项目名 `family-tree` 不变。
更新会短暂停止旧应用，将包含 WAL 的完整数据卷备份到 `backups/`，
再启动新容器并检查本机健康接口、外部 HTTPS 健康接口和子路径登录页。
通过后原子更新 `current` 软链接，写入 `current-image.txt`。

备份失败且新应用尚未启动时，脚本尝试恢复旧容器；新版本启动或健康检查失败时，
停止新应用并让工作流失败，保留备份和日志。**不会自动恢复数据库或盲目启动旧镜像**，
因为迁移后的结构可能与旧版本不兼容。需人工判断兼容性，必要时停止应用并恢复发布前整库备份。
GitHub Release 创建成功不等于生产部署成功，以服务器定时日志和实际 HTTPS 健康状态为准。

日常操作使用固定项目、当前发布文件与已记录镜像，而非默认的 `family-tree:local`：

```bash
cd /srv/family-tree
export APP_IMAGE="$(cat current-image.txt)"
docker compose -p family-tree --env-file .env \
  -f current/docker-compose.yml -f current/docker-compose.production.yml ps
docker compose -p family-tree --env-file .env \
  -f current/docker-compose.yml -f current/docker-compose.production.yml logs --tail=100 app
```

服务器保留解包后的发布文件、旧镜像和整库备份供回滚；部署成功后删除重复的下载压缩包，
不自动删除旧版本或备份。
20 GB 磁盘上应监控使用量，将备份转移到安全的异机存储，确认恢复窗口后再清理明确的旧版本；
不要运行会删除业务卷的全局 prune。

### 首位管理员

首次部署自动生成随机初始化密码和 PBKDF2 哈希，分别写入
`/srv/family-tree/bootstrap-password.txt` 与 `.env`，文件权限均为 `0600`，不打印到流水线日志。
由管理员在自己的终端通过 SSH 读取密码：

```bash
ssh web@106.14.43.188 'cat /srv/family-tree/bootstrap-password.txt'
```

通过 HTTPS 入口用手机号与初始化密码创建首位管理员，然后按提示改密。
成功后删除初始化密码文件、移除 `.env` 中的初始化哈希并重新创建应用容器。
初始化和真实业务数据导入由管理员完成，部署流程不会代建个人账号或写入演示族谱。

### 子路径回归

```bash
VITE_BASE_PATH=/family/ npm run build
VITE_BASE_PATH=/family/ npm run test:browser -- tests/browser/passwordLogin.spec.ts --project=desktop
```

覆盖登录、强制改密、刷新、账号管理和退出后的路径。生产首次上线仍需管理员完成真实账号验收。
