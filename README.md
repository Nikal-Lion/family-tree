# 家族云谱

基于 Vue 3、TypeScript、Vben Admin 核心布局和 ECharts 的电子族谱系统，
使用 Cloudflare Workers + Static Assets + D1 提供同源前端与业务 API。

## 当前能力与边界

- 只读浏览：找家人、世系图、人物档案、家族事件与寻根轨迹。
- 数据维护：成员与关系、事件、GPX 轨迹、Markdown 导入预览，以及 JSON / SQLite 业务快照备份。
- 三角色权限：普通用户只读；维护人员可维护族谱；系统管理员另可管理登录账号与执行 D1 诊断。
- 大字模式：登录页和登录后顶栏可随时切换，放大正文、表单、弹窗与图谱文字，并在本浏览器记住设置。
- 在线 D1 为主存储；保存等待服务端确认，失败回滚，并使用修订号防止并发覆盖。不会静默回退到 localStorage。
- 所有账号使用手机号和独立密码；新建、重置或升级账号首次登录须改密，改密前不能访问族谱。
  旧维护员密码保留用于过渡；旧管理员可用原服务端验证密码过渡；无密码成员需管理员设置临时密码。
  浏览接口保留获准的完整族谱资料，不构成敏感字段隐藏。
- OCR 暂缓开放；离线编辑同步、SQLite + IndexedDB 主存储、PDF/CSV 导出和关系路径查询仍未完成。
  本地回归记录不等于生产、真机或性能验收通过。

详细行为、版本演进和历史 PRD 已合并到[产品说明](docs/product/overview.md)，不再维护两份重复 README。

## 本地开发

使用 Node.js 22 与 npm 工作区，在仓库根目录执行：

```bash
npm ci
npm run dev
```

应用需要可用的 D1 绑定与服务端认证配置；开发服务器启动不等于业务数据连接已配置完成。
配置入口见 `wrangler.jsonc`、`.env.example` 与[登录说明](docs/guides/login.md)。
需要支持 ES2023 数组方法的现代浏览器。

### 验证与预览

```bash
npm test
npm run build
```

浏览器回归首次执行需安装 WebKit：

```bash
npx playwright install webkit
npm run test:browser
```

浏览器测试使用隔离的模拟数据，不能替代 iOS / Android 真机验收。
构建后本地预览使用 `npm run preview:local`；访问远程资源使用 `npm run preview`。

### 数据校验

```bash
npm run verify:part-data-v2 -- data/20260501.md
```

可传其他本地谱文路径。命令严格校验 schema，并将统计与完整诊断输出为 JSON；
不生成报告文件、不保存数据。谱文为本地资料，不是普通测试的必需输入。

## 文档导航

| 入口 | 内容 |
| --- | --- |
| [文档索引](docs/README.md) | 按使用指南、产品需求、实施记录与历史归档分类 |
| [更新日志](changelog.md) | 未发布修改与历次版本的主要变更 |
| [部署与发布](docs/guides/deployment.md) | Workers + D1、Actions 凭据、版本与 tag、部署排查 |
| [登录与迁移](docs/guides/login.md) | 独立密码、首次改密、旧账号迁移与会话边界 |
| [产品说明](docs/product/overview.md) | 合并后的产品说明、移动端行为与 PRD |
| [实施记录](docs/implementation/stage3.md) | Vben 分阶段实现范围、保存契约与回归记录 |
| [历史归档](docs/README.md#历史归档) | 旧部署、Drizzle/D1 迁移与历史校验报告，仅供追溯 |

`src/` 为前端，`api/index.ts` 为当前 Worker 入口，`migrations/` 为当前增量 SQL，
`tests/` 为测试，`vendor/vben/` 保留上游源码、许可与兼容调整记录。
`cloudflare-d1-worker/` 是历史独立 Worker，不是当前发布入口。

发布操作统一遵循[部署指南](docs/guides/deployment.md)，不要使用归档文档中的旧命令或前端 Token 配置。
