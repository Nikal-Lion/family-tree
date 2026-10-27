# Cloudflare 自动部署指南

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

## 3. 自动发布

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
