# Cloudflare Workers 部署与发布指南

当前项目使用 **Cloudflare Workers + 静态资源 + D1**，不是仅上传 `dist/`
的 Pages 静态站点。前端与 `api/index.ts` 由同一个 `family-tree` Worker 提供服务，
部署配置位于根目录 `wrangler.jsonc`。

## 1. PR 检查

`.github/workflows/ci.yml` 在提交 PR 到 `main`、推送 `main` 和手动运行时执行：

- `Test`：`npm ci` 后执行 `npm test`。
- `Build`：`npm ci` 后执行 `npm run build`，包含 Vue/TypeScript 类型检查。

CI 使用 Node.js 22 与已提交的 `package-lock.json`。
PR 不会部署，也不会取得 Cloudflare 发布凭据。若配置分支保护，
请将必需检查更新为 `Test` 和 `Build`，不再使用旧的多平台测试矩阵或 ECC 校验任务。

## 2. 配置发布凭据

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 仅授权目标账户的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | `family-tree` Worker 所属账户 ID |

Token 至少需要目标账户的 Workers Scripts 编辑权限与 D1 读取权限，
以便上传 Worker 并校验已有 D1 绑定。若 Cloudflare 返回权限错误，
根据错误补充所需的最小权限，不要使用全局 API Key。
不要把 Token 提交到仓库或写入 `VITE_*` 变量。

`wrangler.jsonc` 已配置 `DB` 绑定与现有 `family` D1 数据库。
发布工作流不创建数据库、不执行迁移，也不导入或覆盖族谱数据。
应用运行时的密码摘要等 Secrets 由 Cloudflare 单独管理，不是前端构建变量。

`v0.1.7` 将独立密码扩展到所有角色，保留主线维护员密码作为受限过渡凭证。
认证字段由 Worker 自动补齐，详见[登录与迁移说明](login.md)。浏览客户端使用 `/api/browse-data`，
完整 `/api/family-data` 仅供维护账号使用，旧页面需刷新，不提供自动回退。

### 登录限流与会话变更

`/api/auth/login`、`/api/auth/bootstrap-sysadmin` 和 `/api/auth/change-password` 共用 D1 限流：
每个来源 IP 每 15 分钟 30 次、每个手机号每 15 分钟 10 次，成功尝试也计数。
窗口从首次尝试开始，超限返回 429 和 `Retry-After`；存储故障返回 503，
不会绕过限制。运行时自动创建 `auth_rate_limits` 表与过期索引，不需要新的
外部服务或 Secret；所有 Worker 实例必须绑定同一 D1。

来源只使用 Cloudflare 平台元数据存在时的 `CF-Connecting-IP`，
不信任 `X-Forwarded-For`。本地或来源信息缺失时，所有请求共用保守的来源桶。
若前置其他 Worker/代理，发布前需确认实际客户端 IP 传递语义；
不要通过允许任意客户端传入 IP 的方式修复来源识别。
计数器仅存摘要键，过期后不再阻断；每次认证请求最多清理 100 条过期计数。
请求体限制为 4096 字节，详细输入限制、窗口恢复与错误码见 [登录文档](login.md)。

账号改角色、改手机号或禁用时，账号更新与全部旧会话撤销处于同一 D1 事务。
升为 sysadmin 后必须使用该账号的独立密码重新登录；修改自身登录信息会返回登录页，
仅改名称不会退出。所有角色均已取消手机号免密登录。

### 独立密码升级注意事项

此次升级会使旧会话失效，必须同时发布前端与 Worker。
运行时自动创建 `login_credentials` 和 `auth_session_credentials`，
也提供幂等迁移 `migrations/0004_account_passwords.sql`（须先具备 0003 的字段）；不修改族谱业务数据。
不要对已自动升级的数据库重复执行非幂等的 `0003_maintainer_passwords.sql`。
v0.1.4–v0.1.6 的维护员密码原样迁入新凭证表，只能取得受限改密会话；
改密后不会被旧列覆盖，原密码不再可用。旧密码列不作为认证回退；
`login_users.auth_version` 保留作为账号更新的并发保护，新凭证版本负责会话失效。
发布前确认至少一名启用的管理员及原服务端初始化 Secret 可用：
旧管理员先用原密码登录并设置独立密码，然后为旧成员设置临时密码。
新建/重置账号的临时密码只能取得 15 分钟改密会话，不能直接访问族谱。
已经设置独立密码的账号不再接受共享 Secret 作为备用密码。
完整过渡、恢复与密码存储说明见 [登录文档](login.md)。

生产保持 `ALLOW_LEGACY_API_TOKEN_AUTH` 未设置或 `false`；
不要保留能连接同一 D1 的旧免密 Worker。首次升级后应实际验收：
无密码登录被拒绝、首次改密前读写均被拒绝、重置后旧 token 失效、
正常成员及管理员重新登录后权限正确。请勿在工单或日志中记录真实密码。

应用限流不能替代边缘防护：被拒绝的请求仍消耗 Worker/D1 资源，共享出口会
共用配额，攻击者也能暂时耗尽某账号配额。需要在 Cloudflare 按实际流量配置
可用的 WAF/边缘限流与监控，核验代理来源，并留意 D1 配额；本地测试不能证明
这些生产配置已生效。此次代码更改不会自动配置边缘规则或部署。

## 3. 自动发布

每次发布更新必须同步递增根目录 `package.json` 的版本，并更新
`package-lock.json` 中的根包版本；对应发布提交必须创建同版本的 Git tag
（格式为 `v<package.json version>`）。版本文件与 tag 必须一致，
不得复用已有 tag。重试同一版本的失败部署不需要再次递增版本。
仅修改代码或本地验证不等于发布，不自动提交、推送或创建 tag。

推送 `main` 后，只有 `Test` 与 `Build` 都成功，才运行 `Deploy to Cloudflare`：

1. 安装锁定的依赖。
2. 执行 `npm run build`，生成 Worker 与静态资源。
3. 执行 `npx --no-install wrangler deploy`，使用 Vite 插件生成的部署配置发布。

部署使用 Wrangler 默认环境，与现有 `npm run deploy` 一致；
不要擅自添加 `--env production`，该环境的绑定和路由需要单独配置。
发布任务串行执行，不会因为新提交而中途取消正在运行的发布。
发布地址和版本 ID 见 Actions 中的 Wrangler 日志。

## 4. 手动重试发布

在 GitHub **Actions → CI → Run workflow** 选择 `main`。
也可以执行：

```bash
gh workflow run ci.yml --ref main
```

手动运行同样先检查，再发布；其他分支只执行检查。
发布失败后先修复凭据或 Cloudflare 配置，再重新运行失败任务。

## 5. 本地验证与发布

```bash
npm ci
npm test
npm run build
```

本地发布需要先使用 Wrangler 登录，或通过环境变量提供发布凭据：

```bash
npx wrangler login
npm run deploy
```

本地预览使用 `npm run preview:local`；访问远程资源可使用 `npm run preview`。

## 6. 常见问题

- **缺少 Actions Secrets**：发布任务会明确失败；按第 2 节配置后重试。
- **D1 绑定失败**：核对账户、数据库 ID 和 Token 的 D1 权限。
- **推送后没有运行**：确认推送的是 `main`，并确认仓库已启用 Actions。
- **构建失败**：先执行 `npm ci`，再按 CI 日志修复类型或构建错误，不要跳过检查发布。
- **Wrangler 配置重定向指向旧路径**：运行 `npm run clean:wrangler` 后重新构建，
  不要提交 `.wrangler/` 或其他机器的构建产物。
