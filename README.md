# 家族云谱

> 立项与运营请阅读[完整项目企划书](docs/projectProposal.md)（安全、人力、预算、运行保障与阶段门禁）；具体开发任务见[长期产品路线、功能拆分与变现计划](docs/iterationPlan.md)。规划内容不代表已经实现、安全验收或市场验证通过。

基于 Vue 3、TypeScript、Vben Admin 核心布局和 ECharts 的电子族谱系统。
前端、业务 API 与 SQLite 数据库可在单台小型服务器上通过 Docker Compose 自托管；
运行不依赖 Cloudflare 或外部数据库服务。
首发部署目标为阿里云 1 vCPU / 1 GB RAM / 40 Mbps 出口带宽，服务器仅运行预构建镜像，
不在该规格上编译前端或安装构建依赖；资源预算和上线验收见[部署指南](docs/guides/deployment.md)。
首发入口为现有 HTTPS 站点的 `/family/` 子路径；版本标签触发 GitHub Actions 构建并通过 SSH 自动部署。

## 当前能力与边界

- 只读浏览：找家人、世系图、人物档案、家族事件与寻根轨迹。
- 数据维护：成员与关系、事件、GPX 轨迹、Markdown 导入预览，以及 JSON / SQLite 业务快照备份。
- 三角色权限：普通用户只读；维护人员可维护族谱；系统管理员另可管理登录账号与检查服务状态。
- 大字模式：登录页和登录后顶栏可随时切换，放大正文、表单、弹窗与图谱文字，并在本浏览器记住设置。
- SQLite 为主存储；保存等待服务端确认，失败回滚，并使用修订号防止并发覆盖。不会静默回退到 localStorage。
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

Vite 仅提供前端开发预览；要测试认证和数据读写，请使用 Docker Compose 或先构建再运行 Node 服务。
自托管首次启动与初始化说明见[部署指南](docs/guides/deployment.md)。
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
构建后本地完整服务使用 `npm run preview:local`，默认将 SQLite 数据保存在 `data/family-tree.sqlite`。

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
| [部署与发布](docs/guides/deployment.md) | Docker Compose + SQLite、自托管初始化、备份与升级 |
| [登录与迁移](docs/guides/login.md) | 独立密码、首次改密、旧账号迁移与会话边界 |
| [产品说明](docs/product/overview.md) | 合并后的产品说明、移动端行为与 PRD |
| [实施记录](docs/implementation/stage3.md) | Vben 分阶段实现范围、保存契约与回归记录 |
| [历史归档](docs/README.md#历史归档) | 旧部署、Drizzle/D1 迁移与历史校验报告，仅供追溯 |

`src/` 为前端，`api/index.ts` 为业务 API，`server/` 为 Node.js/SQLite 自托管入口，
`migrations/` 为 SQL 迁移，
`tests/` 为测试，`vendor/vben/` 保留上游源码、许可与兼容调整记录。
历史 D1 与 Workers 资料仅保留在归档中，不属于当前运行或发布链路。

部署操作统一遵循[部署指南](docs/guides/deployment.md)；当前版本不提供 Cloudflare 部署或相关凭据配置。
