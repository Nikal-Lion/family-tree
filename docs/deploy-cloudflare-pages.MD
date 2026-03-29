# Cloudflare Pages 部署指南

本文档用于将本项目发布到 Cloudflare Pages。

## 1. 部署前准备

1. 拥有 Cloudflare 账号并可登录 Dashboard。
2. 项目可本地构建通过。
3. 代码已推送到 GitHub（推荐自动部署方式）。

本项目关键配置（来自 package.json）：

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node 项目：Vite + Vue 3 + TypeScript

## 2. 本地构建自检（建议先执行）

在项目根目录执行：

```bash
npm ci
npm run build
```

构建成功后应生成 `dist/` 目录。

## 3. 方式 A：连接 GitHub 自动部署（推荐）

1. 登录 Cloudflare Dashboard。
2. 进入 `Workers & Pages` -> `Create` -> `Pages` -> `Connect to Git`。
3. 授权并选择仓库。
4. 在构建配置中填写：
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: 留空（仓库根目录）
5. 点击 `Save and Deploy`。
6. 首次部署完成后会生成 `*.pages.dev` 预览域名。

后续每次 push 到默认分支（如 `main`）会自动触发生产部署。

## 4. 方式 B：直接上传构建产物（手动部署）

适合临时验证，不依赖 Git 自动构建。

1. 本地执行：

```bash
npm ci
npm run build
```

2. Cloudflare Dashboard 进入 `Workers & Pages` -> 你的 Pages 项目。
3. 选择 `Create deployment`（或上传入口）。
4. 上传 `dist/` 目录内容完成部署。

## 5. 环境变量（按需）

当前项目默认无需环境变量。

若后续新增配置（如 API 地址），可在 Pages 项目中分别设置：

- `Settings` -> `Environment variables`
- 分别为 `Production` 与 `Preview` 配置

示例：

- `VITE_API_BASE_URL=https://example.com/api`

注意：Vite 中变量需使用 `VITE_` 前缀才能在前端读取。

## 6. 自定义域名（可选）

1. 进入 Pages 项目 -> `Custom domains`。
2. 添加域名（如 `family.example.com`）。
3. 按提示完成 DNS 记录绑定。
4. Cloudflare 会自动签发并续期 HTTPS 证书。

## 7. SPA 路由回退（当前项目可先不配）

如果后续引入前端路由（history 模式），需要增加回退配置，避免刷新 404。

可在构建产物根目录放置 `_redirects` 文件：

```text
/*    /index.html   200
```

对于当前项目（单页内容未启用路由），可暂不添加。

## 8. 常见问题排查

### 8.1 部署日志报 "command not found"

- 确认构建命令填写为 `npm run build`。
- 确认项目根目录是否正确。

### 8.2 部署成功但页面空白

- 打开浏览器控制台检查静态资源 404。
- 确认输出目录为 `dist`。
- 检查是否使用了未配置的环境变量。

### 8.3 每次 push 没有触发部署

- 确认仓库连接正常。
- 确认 push 的分支是 Pages 项目配置的生产分支。

### 8.4 报错：deploy configuration 指向不存在的 `dist/wrangler.json`

如果日志出现类似报错：

```text
There is a deploy configuration at '.wrangler/deploy/config.json'; but the redirected configuration path it points to '.wrangler/deploy/..\\..\\dist\\wrangler.json', does not exists
```

通常是 `.wrangler` 目录中的临时配置残留导致（尤其是本地 Windows 生成过缓存后）。

处理方式：

- 确认 Pages 的 Build command 使用 `npm run build`（不要填 `npm run deploy`）。
- 确认仓库未提交 `.wrangler/` 目录。
- 本项目已内置 `npm run clean:wrangler`，并在 `prebuild` / `predeploy` 自动执行清理，重新推送后可恢复。

## 9. 发布建议

1. 生产分支建议开启 PR 合并流程，避免直接 push。
2. 每次发布前至少执行一次本地 `npm run build`。
3. 重要版本发布后，保留一个可回滚的 Git tag。
