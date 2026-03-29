# 电子族谱系统部署手册（Cloudflare Pages）

## 1. 概述
本系统为纯前端静态应用（HTML/CSS/JS），数据存储于浏览器本地 localStorage，无需后端服务。推荐使用 **Cloudflare Pages** 进行部署，享受全球 CDN 加速、自动 HTTPS、免费额度等优势。

---

## 2. 准备工作

### 2.1 注册 Cloudflare 账号
- 访问 [Cloudflare 官网](https://dash.cloudflare.com/sign-up) 注册账号（如已有账号则直接登录）。

### 2.2 准备 Git 仓库
Cloudflare Pages 支持从 GitHub 或 GitLab 仓库自动拉取代码。请将电子族谱系统的所有文件（`index.html` 及可能存在的其他静态资源）上传至一个 Git 仓库。

**示例仓库结构**：

```
family-tree/
├── index.html
└── (无其他文件，代码已内联)
```

如果代码已拆分为多个文件，请确保所有文件均被提交。

---

## 3. 部署步骤

### 3.1 进入 Cloudflare Pages
- 登录 Cloudflare Dashboard。
- 左侧菜单选择 **Pages**。
- 点击 **Create application** → **Connect to Git**。

### 3.2 连接 Git 提供商
- 选择 GitHub 或 GitLab。
- 授权 Cloudflare 访问您的仓库。
- 从列表中选择存放电子族谱代码的仓库。

### 3.3 配置构建设置
由于项目无构建步骤，请按以下填写：

| 字段 | 值 |
|------|-----|
| **Production branch** | `main` 或您的主分支名 |
| **Build command** | （留空） |
| **Build output directory** | `/` 或直接填写 `.` |
| **Environment variables** | 无需添加 |

> ⚠️ 注意：若您的代码位于仓库根目录，输出目录可留空或填 `.`；若位于子文件夹（如 `public/`），则需填写子文件夹路径。

### 3.4 保存并部署
- 点击 **Save and Deploy**。
- Cloudflare 将自动拉取代码并部署，部署完成后会提供一个默认的 `.pages.dev` 域名（如 `your-project-name.pages.dev`）。

---

## 4. 自定义域名（可选）

### 4.1 添加自定义域名
- 在 Pages 项目页面，点击 **Custom domains**。
- 输入您的域名（如 `family.yourdomain.com`）。
- 按提示在域名 DNS 中添加 CNAME 记录指向 `your-project-name.pages.dev`。
- Cloudflare 会自动为域名签发 SSL 证书。

### 4.2 等待 DNS 生效
通常几分钟内即可访问。

---

## 5. 验证部署
- 打开分配的域名（默认或自定义）。
- 检查族谱树是否正常渲染。
- 尝试添加、编辑、删除成员，确认数据持久化（刷新后数据不丢失）。

---

## 6. 注意事项

### 6.1 数据存储位置
- 所有族谱数据仅保存在用户浏览器的 localStorage 中，不同设备/浏览器之间**不会同步**。
- 如需备份，可手动导出 localStorage 内容（通过浏览器开发者工具）。

### 6.2 缓存策略
- Cloudflare Pages 默认启用静态资源缓存，代码更新后可能需要等待几分钟或手动清除浏览器缓存才能看到最新版本。

### 6.3 访问控制
- 当前版本无用户鉴权，任何知晓 URL 的人均可查看和编辑族谱。如需保护，可考虑在 Cloudflare 层面添加 Access 策略（需付费计划）。

---

## 7. 常见问题排查

| 问题现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| 页面加载后树图不显示 | 网络原因导致 ECharts 或 Font Awesome 加载失败 | 检查控制台是否有 404 错误，确认外链 CDN 可用；或改为本地资源 |
| 添加成员后刷新数据丢失 | localStorage 被清空或浏览器隐私模式 | 正常模式下使用，告知用户不要清理站点数据 |
| 自定义域名访问显示 404 | DNS 未生效或 Pages 域名未绑定 | 检查 CNAME 记录，等待 DNS 传播；确认在 Pages 中添加了自定义域名 |
| 树图在移动端无法缩放 | 触摸手势冲突 | ECharts 默认支持 `roam`，如未生效检查配置中 `roam: true` |

---

## 8. 使用 Wrangler CLI 部署（备选方案）

若您熟悉命令行，也可使用 Wrangler 直接部署：

1. 安装 Wrangler：

```bash
   npm install -g wrangler
```

2. 登录：

```bash
    wrangler login
```

3. 在项目目录执行：

```bash
    wrangler pages deploy . --project-name=family-tree
```


4. 按提示选择生产环境，部署后将获得类似 `family-tree.pages.dev` 的域名。

---

## 9. 附录：项目文件说明

本系统所有功能已集成在单个 `index.html` 文件中，无需额外文件。部署时只需将该文件上传至 Cloudflare Pages 即可。

如果希望进一步优化性能（如将 CSS/JS 分离），可按需拆分，但不影响部署流程。

---

> ✅ 部署完成后，您的电子族谱即可通过全球网络访问，家族成员可随时查看与维护族谱。如有任何问题，请参考 Cloudflare Pages 官方文档或联系技术支持。

---

## 10. 发布到 Cloudflare Workers 时的变量配置（D1 版本）

当前项目已接入 D1 API，部署到 Cloudflare Workers 时，需要配置两类变量：

### 10.1 前端构建变量（`VITE_*`）

这类变量在 `vite build` 时注入前端代码，部署后不会再动态读取。

需要配置：

| 变量名 | 作用 | 示例 |
|------|------|------|
| `VITE_D1_API_BASE_URL` | 前端请求的 D1 API 地址 | `https://family-tree-api.your-subdomain.workers.dev` |
| `VITE_D1_API_TOKEN` | 前端调用 API 使用的 Bearer Token（可选） | `your-token` |

本地构建时，在项目根目录配置 `.env.local` 或 `.env.production`：

```bash
VITE_D1_API_BASE_URL="https://family-tree-api.your-subdomain.workers.dev"
VITE_D1_API_TOKEN=""
```

### 10.2 Worker 运行时变量（API Worker）

这类变量在 Worker 运行时通过 `env` 读取。

在 `cloudflare-d1-worker/wrangler.toml` 中保留：

```toml
[[d1_databases]]
binding = "DB"
database_name = "family"
database_id = "你的 D1 数据库 ID"

[vars]
ALLOWED_ORIGIN = "https://你的前端域名"
```

`API_TOKEN` 建议使用 Secret（不要明文写进 `wrangler.toml`）：

```bash
cd cloudflare-d1-worker
wrangler secret put API_TOKEN
```

### 10.3 推荐发布顺序

1. 先部署 API Worker（`cloudflare-d1-worker`），拿到最终 `workers.dev` 地址。
2. 把该地址写入前端 `VITE_D1_API_BASE_URL` 后，再执行前端构建与发布。
3. 若启用了 `API_TOKEN`，确保前端 `VITE_D1_API_TOKEN` 与 Worker Secret 一致。

### 10.4 常见错误与排查

| 现象 | 常见原因 | 处理方式 |
|------|---------|---------|
| `初始化失败 / Failed to fetch` | `VITE_D1_API_BASE_URL` 地址错误、Worker 未部署、TLS/域名不可达 | 先在浏览器直接访问 `${VITE_D1_API_BASE_URL}/api/family-data` 验证可达性 |
| `401 未授权` | Worker 配置了 `API_TOKEN`，但前端未配置或不一致 | 重新设置 `wrangler secret put API_TOKEN`，并同步前端变量 |
| CORS 报错 | `ALLOWED_ORIGIN` 未匹配前端域名 | 将 `ALLOWED_ORIGIN` 改为前端实际域名后重新部署 Worker |
