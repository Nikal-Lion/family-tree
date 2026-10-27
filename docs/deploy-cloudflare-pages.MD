# Cloudflare Workers 部署与发布门禁

保留原文件路径以兼容旧链接。当前项目使用 **Cloudflare Workers + Static Assets + D1**，不是仅静态的 Cloudflare Pages 应用。只上传 `dist` 不会部署登录、权限、可靠保存或系统诊断 API。

## 1. 当前发布状态

- 第四阶段已迁移只读总览与图谱浏览；OCR 按范围决定暂缓，维护页不挂载实验 OCR 入口。
- `npm test` 完整回归已通过，原有 19 条 Markdown 边界失败已修复，没有删除、跳过或放宽断言。生产环境、目标浏览器和生产网络性能仍待验收，不能将本地测试通过解释为系统可直接正式发布。
- 本轮只进行隔离本地验证，未执行远程迁移、推送或部署。
- 500 人浏览器场景使用只读 GET 模拟数据，不代表生产网络首屏性能、全浏览器或上千人容量验收。

## 2. 构建与本地验证

使用支持 Vite 8 的 Node.js（例如 Node 22.12+），按锁文件安装：

```bash
npm ci
npm test
npm run build
```

完整测试结果必须保留。仅为了分别验证非暂缓范围，可以运行以下命令，但它**不代替完整发布门禁**：

```bash
npm test -- --exclude tests/services/childClaimBoundaries.test.ts
```

实际产物：

- `dist/client/`：浏览器资源。
- `dist/family_tree/index.js`：真实 API 入口 `api/index.ts` 的构建产物。
- `dist/family_tree/wrangler.json`：Vite Cloudflare 插件生成的 Worker 配置，关联上述前端资源。

本地预览须明确 `--local`，并将测试数据放到独立目录：

```bash
npx wrangler dev --config dist/family_tree/wrangler.json --local --port 8791 --persist-to /absolute/path/to/isolated-test-d1
```

管理员登录还需为本地 Worker 配置测试专用的 `SYSADMIN_PASSWORD_PBKDF2`。不要使用生产密码，不要将密码、hash、会话 token 或家族原始资料提交到仓库。`npm run preview` 包含 `--remote`，不能作为隔离本地验收命令。

`.wrangler/deploy/config.json` 是插件生成的本机重定向配置，不是发布源文件。构建后的路径分隔符变化不应作为业务改动提交。不要为了修复此缓存删除其他会话的持久化数据库；尤其不能在共用环境中盲目清理整个 `.wrangler`。

## 3. 发布前逐项确认

1. 修复或正式收敛全部已知失败，完整 `npm test` 与 `npm run build` 通过。
2. 明确目标 Cloudflare 账号、Worker 名称、D1 数据库和环境；检查构建产物中 `DB` 绑定与静态资源路径。当前 `wrangler.jsonc` 顶层有 D1 绑定，但 `env.production` 未单独声明 D1。绑定不能依靠环境继承，**不要直接加 `--env production` 后就认为数据库配置完整**。
3. 从现网导出业务 JSON/SQLite 备份并验证能恢复；另行做 D1 数据库级备份，覆盖登录账号和会话。业务快照不包含认证数据，不是 D1 整库恢复工具。
4. 在独立预发布数据库上验证现有库升级。`api/index.ts` 会幂等初始化 schema 并兼容升级账号 role 约束；`migrations/0001_family_schema_v4.sql` 是增量表迁移，不是完整旧库初始化脚本。不能把历史 `cloudflare-d1-worker/` 当作当前部署入口。
5. 确认服务端 secret `SYSADMIN_PASSWORD_PBKDF2` 有效；轮换方式见 [登录说明](Login.md)。除明确的紧急兼容决策外，不启用 `ALLOW_LEGACY_API_TOKEN_AUTH`。
6. 在预发布站点逐一验证普通用户只读、维护人员业务写入、管理员账号管理；同时检查直链守卫和真实 API 的 401/403。
7. 验证全字段保存、JSON/SQLite 往返、409 冲突不覆盖、503/事务失败不假成功、空库不 seed，以及退出登录后的会话隔离。
8. 验证桌面和窄屏总览、搜索、分支上下文、子树、档案、PNG、事件、轨迹及深层直链刷新。通知旧客户端刷新，以适配 `If-Match` 修订号协议。

## 4. 发布与回滚顺序

以下仅为人工发布参考，需先满足门禁并确认目标；本次不会执行。

1. 固定已验证的提交与依赖锁文件，保留现网配置和数据库备份。
2. 按已确认环境构建并检查生成配置。顶层目标的发布入口为 `npx wrangler deploy --config dist/family_tree/wrangler.json`；若使用命名环境，先补全该环境的非继承绑定、secret 和路由，再重新构建、检查，不混用环境产物。
3. 发布真实 Worker 及其静态资源后，用三类账号做小范围冒烟。不要以 HTTP 200、静态页面打开或构建通过代替业务验收。
4. 出现错误先停止维护写入并保留现场；应用回滚需选取兼容 schema 4 / 修订号协议的已验证版本，不能让不带 `If-Match` 的旧客户端静默覆盖数据。
5. 增量表和账号约束升级不通过删表“回滚”。若确需恢复数据库，先评估发布后新增数据，再按数据库级备份恢复；不能用业务快照替代账号/会话恢复。
