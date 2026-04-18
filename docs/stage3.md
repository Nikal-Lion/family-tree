# Stage3 角色权限与导航拆分实施计划

## 1. 背景与目标

当前系统已具备登录能力与基础权限控制，但仍存在以下问题：

- 页面职责聚合在单一工作台中，数据展示与数据维护混合，导航路径不够清晰。
- 角色模型仅覆盖 user 与 sysadmin，缺少中间维护角色，权限颗粒度不足。
- 部分界面与按钮显示未与角色能力完全对齐。

Stage3 目标：

- 引入三角色模型：user、maintainer、sysadmin。
- 新增顶部导航，按角色动态展示可访问页面。
- 将工作区拆分为三个页面：总览页、维护页、系统管理页。
- 保证前后端权限一致，避免仅前端控制带来的越权风险。

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

- 顶部导航按角色动态展示菜单。
- 用户不可访问页面不展示入口，同时直链访问也会被路由守卫拦截并跳转到可访问默认页。

---

## 4. 前端实施要点

### 4.1 认证能力扩展

- 角色类型扩展到 user/maintainer/sysadmin。
- 新增 canMaintain 能力判断，统一用于页面与按钮显隐。
- 保持 sysadmin 手机号+密码登录，不改变既有安全策略。

### 4.2 页面拆分策略

以工作区模式驱动页面渲染：

- overview 模式：只读展示（树图、统计、成员列表、轨迹、事件、详情）。
- manage 模式：在 overview 基础上开放维护能力（成员表单、OCR、导入导出）。
- system 模式：登录用户管理 + D1 自检。

### 4.3 UI 展示规则

- user：只显示总览入口，维护按钮隐藏。
- maintainer：显示总览与维护入口，显示维护按钮，不显示系统管理入口。
- sysadmin：显示全部入口与系统管理模块。

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

---

## 6. 关键文件改造清单

- src/types/auth.ts：角色类型扩展
- src/services/authService.ts：新增 canMaintain 与默认跳转
- src/router/index.ts：新增三页面路由与角色守卫
- src/pages/FamilyWorkspace.vue：按模式拆分页面与模块
- src/components/AuthManager.vue：角色展示文案扩展
- src/components/LoginUserManager.vue：三角色管理交互
- src/pages/LoginPage.vue：按角色默认落地
- api/index.ts：后端角色与写权限改造、表约束兼容升级
- cloudflare-d1-worker/src/schema.ts：角色枚举同步
- cloudflare-d1-worker/migrations/0001_init.sql：初始化约束同步

---

## 7. 验收标准

- [ ] user 登录后仅可访问总览页，维护与系统管理页不可达。
- [ ] maintainer 登录后可访问维护页并完成业务数据增删改。
- [ ] sysadmin 登录后可访问系统管理页并管理登录用户。
- [ ] 直链越权访问会被路由守卫拦截并跳转至角色默认页。
- [ ] 后端接口层与前端按钮层权限表现一致。
- [ ] 旧库升级后可正常创建与更新 maintainer 账号。

---

## 8. 风险与应对

| 风险 | 说明 | 应对 |
|---|---|---|
| 数据库约束不一致 | 老库 role 约束仍为双角色会导致 maintainer 操作失败 | 启动时执行 role 约束兼容升级 |
| 仅前端拦截导致越权 | 用户可直接调用接口写入 | 接口层强制 role 校验 |
| 页面拆分引入状态回归 | 由单页转多入口可能出现状态初始化问题 | 统一复用 store 初始化与模式化渲染 |

---

## 9. 发布与回归建议

1. 先部署后端角色改造与约束升级，再部署前端路由与界面。
2. 使用三类账号逐一回归：user、maintainer、sysadmin。
3. 重点验证：
- 写接口权限边界（/api/family-data PUT）
- 系统管理接口边界（/api/login-users*）
- 路由直链拦截和默认跳转
- 登录用户角色编辑与最后一个 sysadmin 保护逻辑
