# Stage3 角色权限、导航与 Vben 分阶段实施记录

## 1. 背景与目标

本计划起点是已有登录能力与基础权限控制的旧工作台，当时存在以下问题：

- 页面职责聚合在单一工作台中，数据展示与数据维护混合，导航路径不够清晰。
- 角色模型仅覆盖 user 与 sysadmin，缺少中间维护角色，权限颗粒度不足。
- 部分界面与按钮显示未与角色能力完全对齐。

Stage3 目标：

- 引入三角色模型：user、maintainer、sysadmin。
- 接入 Vben v5.7.0 官方核心布局和 Ant Design Vue，管理端侧栏导航、总览页轻量顶部布局。
- 将工作区拆分为三个页面：总览页、维护页、系统管理页。
- 保证前后端权限一致，避免仅前端控制带来的越权风险。

当前进度：第一阶段官方 Vben 5.7.0 核心布局、Ant Design Vue 登录与三角色导航已提交（`66725d1`），第二阶段可靠保存、备份与族人管理已提交（`6693ccc`）。第三阶段将剩余管理模块改为独立 Ant Design Vue 页面；本文记录实现范围，不表示已正式部署或完成整个系统的端到端验收。

---

## 2. 角色定义

| 角色 | 登录方式 | 页面访问 | 能力边界 |
|---|---|---|---|
| user | 手机号登录 | 总览页 | 仅查看数据，不可写入 |
| maintainer | 手机号登录 | 总览页、维护页 | 可维护业务数据（成员、事件、轨迹、OCR、导入导出） |
| sysadmin | 手机号 + 密码登录 | 总览页、维护页、系统管理页 | 全局权限，包含登录用户管理与系统诊断 |

---

## 3. 路由与导航信息架构

### 3.1 路由规划

- /login：登录页
- /app：角色默认入口（自动重定向）
- /app/overview：数据总览页（user/maintainer/sysadmin）
- /app/manage：数据维护页（maintainer/sysadmin）
- /app/system：系统管理页（sysadmin）

### 3.2 默认落地规则

- user -> /app/overview
- maintainer -> /app/manage
- sysadmin -> /app/manage

### 3.3 导航规则

- 管理端侧栏按角色动态展示菜单；总览页仅向维护人员和管理员显示“进入管理”入口。
- 用户不可访问页面不展示入口，同时直链访问也会被路由守卫拦截并跳转到可访问默认页。
- 菜单、默认落地页与登录后的安全跳转由 `src/services/accessControl.ts` 统一定义。
- 退出登录后重新载入页面，丢弃上一账号的内存工作区状态。

### 3.4 分阶段接入边界

- `vendor/vben/` 固定官方 v5.7.0 的核心运行包与主题，保留 MIT 许可及 `upstream.json` 溯源记录；不引入示例业务、Turbo 或 pnpm。
- 第一阶段切换登录页、布局与路由，业务界面由旧工作区桥接。
- 第二阶段新增 `ManagePage` 与 `MemberManager`，将族人管理独立为 Ant Design Vue 表格、表单和档案 Drawer。
- 第二阶段补齐 schema 4 业务全字段的云端可靠保存与 JSON / SQLite 快照备份；这不是登录账号/会话备份、任意 SQLite 导入或 D1 整库恢复。
- 第三阶段新增 `ActivityManager`、`ImportManager` 和 `SystemPage`，重写账号管理、Markdown 预览和 OCR 核对界面；管理端不再引用旧工作区。事件/轨迹与导入备份仍沿用现有 store 和服务契约，错误保留输入，只有云端确认才算成功。
- 总览仍使用旧 ECharts 图谱，未替换新引擎；OCR 语义与去重的已知问题未在本轮修复，不能称为业务全面重写。
- 当前以在线 D1 为主，离线编辑同步、SQLite + IndexedDB 主存储仍未实现，不宣称离线兜底可用。

---

## 4. 前端实施要点

### 4.1 认证能力扩展

- 角色类型扩展到 user/maintainer/sysadmin。
- 新增 canMaintain 能力判断，统一用于页面与按钮显隐。
- 保持 sysadmin 手机号+密码登录，不改变既有安全策略。

### 4.2 页面拆分策略

路由对应独立入口；旧工作区仅保留只读总览：

- `/app/overview`：`FamilyWorkspace` 只读展示树图、统计、成员列表、轨迹、事件、详情，不包含管理端写入和导入组件。
- `/app/manage`：独立 `ManagePage`，提供三个 Tab：
  - **族人管理**：新 `MemberManager`；Ant Design Vue 表格支持姓名/ID/分支/别名搜索、性别筛选与分页；全字段表单支持谱载代数 `generationNumber`，档案 Drawer 展示配偶、子女声明、别名、关系、纪年、葬地，并支持新增/删除配偶。
  - **事件与轨迹**：独立 `ActivityManager`，支持事件维护、搜索筛选及 GPX 上传、轨迹改名/成员关联/删除/终点导航。
  - **资料与备份**：独立 `ImportManager`，备份选择后先校验并展示九个集合数量，再确认恢复；Markdown 分析与 OCR 人工核对使用独立 Ant Design Vue 组件。切换主 Tab 保留已挂载页面中的预览和筛选。
- `/app/system`：独立 `SystemPage`，提供账号管理与真实 D1 自检；账号支持搜索、分页、三角色、启停及删除，保护最后一个启用的管理员。

### 4.3 UI 展示规则

- user：只显示总览入口，维护按钮隐藏。
- maintainer：显示总览与维护入口，显示维护按钮，不显示系统管理入口。
- sysadmin：显示全部入口与系统管理模块。

### 4.4 保存与备份反馈

- 所有 store 写入串行排队，等待云端确认才反馈成功；失败完整回滚，不将“内存已改”当作“已保存”。
- 导入先执行共享严格校验与版本迁移，再进入同一保存链路，失败保留原业务数据。
- JSON 使用 schema 4；SQLite 由 SQL.js 生成真实二进制文件，包含 `family_backup(format_version,payload)` 单行快照，格式版本为 1，payload 为 canonical JSON。备份保留业务全字段，但不包含登录账号与会话。
- 兼容历史 JSON 文本伪装的 `.sqlite/.db`；无关 SQLite 数据库与不支持的版本会拒绝。
- 空 D1 保持空库，不 seed；云端失败不静默回退 localStorage，不自动上传或删除历史 localStorage。

---

## 5. 后端实施要点

### 5.1 角色模型扩展

- LoginUserRole 扩展为 user/maintainer/sysadmin。
- 登录用户表 role 约束更新为三角色。

### 5.2 授权策略

- 保持 requireSysadmin 用于系统管理接口。
- 新增 requireMaintainerOrSysadmin 用于业务写入接口。
- /api/family-data PUT 放开为 maintainer + sysadmin。
- /api/login-users* 维持 sysadmin-only。

### 5.3 兼容迁移

- 对已存在 login_users 表执行约束升级（重建表并迁移数据）。
- 保留历史用户和会话关联，不改变主键语义。

### 5.4 第二阶段数据契约与并发保护

- `src/services/importExport.ts` 为前后端共享的严格 schema 4 契约；兼容 schema 2/3，将历史 `spouseIds` 迁为显式配偶关系，拒绝坏引用、循环与重复 ID，不静默丢弃。
- 保留 `members`、`tracks`、`events`、`aliases`、`relations`、`temporals`、`burials`、`spouses`、`childClaims` 九个集合、全部 `next*` 计数器及成员 `generationNumber`。
- 真实 Workers 入口为 `api/index.ts`。`migrations/0001_family_schema_v4.sql` 增量新增 `family_data_revision`、`member_generations`、`spouses`、`child_claims`，不清空旧业务与认证表。
- GET `/api/family-data` 返回 `{ data, revision }`；PUT 通过 `If-Match` 修订号 CAS 与全字段数据保存组成同一个 D1 batch 事务，拒绝并发覆盖。
- 旧客户端需刷新，修订号冲突后需重新读取数据并处理，不能自动以旧快照覆盖新数据。

---

## 6. 关键文件改造清单

- src/types/auth.ts：角色类型扩展
- src/services/authService.ts：新增 canMaintain 与默认跳转
- src/router/index.ts：新增三页面路由与角色守卫
- src/pages/ManagePage.vue：独立维护页与三个 Tab
- src/components/MemberManager.vue：族人表格、搜索筛选、分页、全字段表单弹窗与档案 Drawer
- src/pages/FamilyWorkspace.vue：仅保留只读总览，不再提供管理端桥接分区
- src/components/ActivityManager.vue：事件、GPX 与轨迹管理
- src/components/ImportManager.vue：完整业务备份与恢复预览
- src/components/PartDataImportPanel.vue、src/components/import/*：Markdown 预览和确认导入
- src/components/OcrImportManager.vue：图片/文字识别核对界面，保留现有实验解析规则
- src/pages/SystemPage.vue：独立账号管理与 D1 诊断页面
- src/services/backupFiles.ts：文件类型校验、时间戳备份文件名与下载资源清理
- src/services/memberProfile.ts：成员档案关联展示
- src/services/importExport.ts：前后端共享严格 schema 4 契约
- src/services/backupService.ts、src/services/sqliteService.ts：真正 SQLite 快照备份与历史格式兼容
- src/services/d1ApiService.ts：带修订号的云端读写
- src/services/storage.ts、src/stores/familyStore.ts：在线初始化、串行保存与失败回滚
- migrations/0001_family_schema_v4.sql：业务数据增量表迁移
- src/components/AuthManager.vue：角色展示文案扩展
- src/components/LoginUserManager.vue：三角色管理交互
- src/pages/LoginPage.vue：按角色默认落地
- api/index.ts：真实 Workers 入口，角色与写权限、表约束兼容升级、全字段事务保存与修订号 CAS
- cloudflare-d1-worker/src/schema.ts：历史独立 Worker 的角色枚举同步记录，非当前运行入口
- cloudflare-d1-worker/migrations/0001_init.sql：历史独立 Worker 的初始化约束同步记录

---

## 7. 验收标准

以下为逐项验收清单，不因代码实现或文档更新自动勾选。验证命令为 `npm test`、`npm run build`；管理端关键操作还需使用隔离 D1 和浏览器实际验证，不能以构建成功代替整个系统验收。

- [ ] user 登录后仅可访问总览页，维护与系统管理页不可达。
- [ ] maintainer 登录后可访问维护页并完成业务数据增删改。
- [ ] sysadmin 登录后可访问系统管理页并管理登录用户。
- [ ] 直链越权访问会被路由守卫拦截并跳转至角色默认页。
- [ ] 后端接口层与前端按钮层权限表现一致。
- [ ] 旧库升级后可正常创建与更新 maintainer 账号。
- [ ] 族人管理搜索、性别筛选、分页、全字段编辑及配偶新增/删除行为正确。
- [ ] schema 2/3 升级与 schema 4 全字段 JSON / SQLite 备份往返保留九个集合、计数器与谱载代数。
- [ ] 无效引用、循环、重复 ID、无关 SQLite 文件被拒绝，原数据不受影响。
- [ ] D1 保存失败、事务失败或并发修订号冲突时完整回滚，无假成功、部分写入或静默覆盖。
- [ ] 空库不会自动填充，本地历史数据不会自动上传/删除，云端失败不会静默回退本地。
- [x] 管理端不再挂载旧工作区；事件、轨迹、Markdown、OCR 核对、备份恢复与系统管理使用独立组件。
- [x] 备份恢复先校验与预览，取消不写入、失败保留预览，文件可重复选择。
- [x] 桌面与 390px 窄屏无整页横向溢出，宽表格在自身容器内滚动。

### 第三阶段本地验收记录（2026-10-26）

- 使用隔离 Wrangler / D1，未访问或部署生产环境。实际验证事件新增及修订号冲突后的表单保留、GPX 无效坐标拒绝与合法 `(0,0)` 上传、Markdown / OCR 文字预览及主 Tab 切换保留草稿、SQLite 导出与完整恢复、模拟保存失败保留备份预览。
- 实际验证临时账号新增/禁用/删除、最后启用管理员的前端保护、D1 503 诊断明确失败且统计显示未知而非 0，以及恢复真实请求后重试。
- 普通用户直链系统页重定向总览，写请求返回 403；维护人员直链系统页重定向维护页，可见维护操作但无系统菜单。四个管理界面均检查 390px 宽布局。
- 验收后恢复原族谱快照并核对原登录账号元数据，临时账号已删除。照片 OCR 的真实识别效果、现有解析规则正确性、新图谱及全系统性能不在本次验收结论内。

---

## 8. 风险与应对

| 风险 | 说明 | 应对 |
|---|---|---|
| 数据库约束不一致 | 老库 role 约束仍为双角色会导致 maintainer 操作失败 | 启动时执行 role 约束兼容升级 |
| 仅前端拦截导致越权 | 用户可直接调用接口写入 | 接口层强制 role 校验 |
| 页面拆分引入状态回归 | 由单页转多入口可能出现状态初始化问题 | 统一复用 store 初始化与模式化渲染 |
| 云端并发覆盖 | 多客户端保存旧快照可能丢失更新 | `If-Match` CAS 与全字段同事务保存，冲突需刷新处理 |
| 备份范围误判 | SQLite 扩展名不代表任意数据库均可恢复 | 明确 family_backup 版本 1 格式与不含认证数据的边界 |
| 离线能力误判 | 文件备份不等于离线编辑与同步 | 云端失败明确报错，不静默切换 localStorage |

---

## 9. 发布与回归建议

以下仅为后续发布建议，本次文档更新不执行部署。

1. 发布前验证真实 Workers 入口及 D1 增量迁移、角色约束升级，再同步前端；通知旧客户端刷新以适配修订号协议。
2. 使用三类账号逐一回归：user、maintainer、sysadmin。
3. 重点验证：
- 写接口权限边界（/api/family-data PUT）
- 系统管理接口边界（/api/login-users*）
- 路由直链拦截和默认跳转
- 登录用户角色编辑与最后一个 sysadmin 保护逻辑
- 业务九集合与计数器的全字段保存、备份往返和合法空库
- 网络/事务故障回滚、并发冲突与历史 localStorage 不自动迁移
- 独立管理端与只读总览互不混入操作入口；OCR 已知语义问题、新图谱与离线同步不在本轮完成范围
