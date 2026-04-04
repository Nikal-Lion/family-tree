# D1 连接问题 - 完整解决方案

## 问题症状
- 页面加载时出现警告：`D1 初始化失败，已回退到本地数据`
- 浏览器控制台错误：`TypeError: Failed to fetch`
- 无法从 D1 数据库读取数据

## 🔧 快速修复步骤

### 步骤 1：配置 Wrangler D1 绑定

D1 数据库需要与 Worker 绑定。编辑 `wrangler.jsonc`：

```jsonc
{
  "name": "family-tree",
  "compatibility_date": "2025-09-27",
  
  // 添加以下 D1 配置
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-tree-db",
      "database_id": "YOUR_DATABASE_ID_HERE"
    }
  ]
}
```

#### 获取数据库 ID

**方式 1：列出现有数据库**
```bash
wrangler d1 list
```

输出：
```
┌─────────────────────┬──────────────────────────────────────┐
│ name                │ uuid                                 │
├─────────────────────┼──────────────────────────────────────┤
│ family-tree-db      │ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx │
└─────────────────────┴──────────────────────────────────────┘
```

复制 `uuid` 列的值到 `wrangler.jsonc` 中的 `database_id`。

**方式 2：创建新数据库**
```bash
# 创建数据库
wrangler d1 create family-tree-db

# 系统会输出 database_id，复制该值
```

### 步骤 2：配置环境变量

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入实际的值：

```dotenv
# 你的 Worker URL
VITE_D1_API_BASE_URL=https://family-tree.wolfife.workers.dev

# 与 wrangler.jsonc 中 vars.API_TOKEN 相同的令牌
VITE_D1_API_TOKEN=your-secure-token-here
```

### 步骤 3：设置 API 鉴权令牌

在 `wrangler.jsonc` 中配置环境变量：

```jsonc
{
  "d1_databases": [...],
  
  "env": {
    "production": {
      "vars": {
        // 生成一个安全的令牌（例如使用 openssl rand -hex 16）
        "API_TOKEN": "your-secure-token-here"
      }
    }
  }
}
```

### 步骤 4：验证 Worker 代码

确保 Worker 代码正确读取 D1 绑定。检查 `cloudflare-d1-worker/src/index.ts`：

```typescript
interface Env {
  DB: D1Database  // ✓ 确保有这个属性
  ALLOWED_ORIGIN?: string
  API_TOKEN?: string
}

function getDb(env: Env) {
  return drizzle(env.DB)  // ✓ 正确初始化 Drizzle
}
```

### 步骤 5：重启开发服务器

```bash
# 停止当前运行的服务（Ctrl+C）

# 重新安装依赖（确保 drizzle-orm 已安装）
npm install

# 重新启动
npm run preview
```

## 🧪 验证配置

### 测试 1：本地 Worker 连接

```bash
# 启动本地 Worker
npm run preview

# 在另一个终端测试 API
curl -X GET http://localhost:8787/api/family-data \
  -H "Authorization: Bearer your-secure-token-here" \
  -H "Content-Type: application/json"
```

**预期响应**（200 OK）：
```json
{
  "data": {
    "schemaVersion": 2,
    "members": [],
    "events": [],
    "tracks": [],
    "nextId": 1,
    "nextTrackId": 1,
    "nextEventId": 1
  }
}
```

### 测试 2：前端能否读取环境变量

打开浏览器控制台（F12），执行：

```javascript
// 检查环境变量是否加载
console.log('API Base URL:', import.meta.env.VITE_D1_API_BASE_URL)
console.log('API Token:', import.meta.env.VITE_D1_API_TOKEN ? '已配置' : '未配置')
```

应该看到正确的值。

### 测试 3：前端网络请求

1. 打开开发者工具 → Network 标签
2. 刷新页面
3. 查找 `family-data` 请求
4. 检查：
   - 请求 URL 是否正确
   - 请求头中 Authorization 是否正确
   - 响应状态码（200 为成功，401 为鉴权失败）

### 测试 4：部署到生产环境

```bash
# 构建项目
npm run build

# 部署
npm run deploy

# 查看部署历史
wrangler deployments list

# 查看实时日志
wrangler tail

# 测试生产环境
curl -X GET https://family-tree.wolfife.workers.dev/api/family-data \
  -H "Authorization: Bearer your-secure-token-here"
```

## 🐛 常见问题和解决方案

### 问题 1：Database not found

**错误**：`ReferenceError: DB is not defined` 或类似错误

**原因**：D1 数据库未在 `wrangler.jsonc` 中绑定

**解决**：
1. 执行 `wrangler d1 list` 获取 database_id
2. 添加到 `wrangler.jsonc` 中的 `d1_databases` 配置
3. 重新启动本地服务或重新部署

### 问题 2：401 Unauthorized

**错误**：API 返回 401 状态码

**原因**：
- API Token 不匹配
- 请求头中的 Authorization 格式错误

**解决**：
1. 检查 `.env.local` 中的 token 是否与 `wrangler.jsonc` 一致
2. 验证请求头格式：`Authorization: Bearer <token>`（注意 "Bearer " 前缀）
3. 检查 token 中是否有多余的空格或特殊字符

### 问题 3：CORS 错误

**错误**：`Access to fetch at ... from origin ... has been blocked by CORS policy`

**原因**：Worker 返回的 CORS 头配置有误

**解决**：
在 Worker 代码中确保 CORS 头配置正确：

```typescript
function corsHeaders(env: Env): Headers {
  const headers = new Headers()
  // 允许所有来源（开发环境）或指定来源（生产环境）
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*')
  headers.set('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  return headers
}
```

### 问题 4：Network timeout

**错误**：请求超时

**原因**：
- Worker 响应缓慢
- D1 查询性能问题
- 网络连接问题

**解决**：
1. 查看 Worker 日志：`wrangler tail`
2. 检查 D1 数据库是否响应正常
3. 尝试简单查询测试

### 问题 5：Schema 表不存在

**错误**：`Error: no such table: members`

**原因**：`ensureSchema()` 未正确执行

**解决**：
```typescript
async function ensureSchema(env: Env): Promise<void> {
  const db = getDb(env)
  try {
    // 使用 db.run() 执行创建表 SQL
    await db.run(`CREATE TABLE IF NOT EXISTS members (...)`)
  } catch (error) {
    console.error('Schema 创建失败:', error)
    // 不中断执行，表可能已存在
  }
}
```

## 📝 完整配置示例

### `.env.local`
```dotenv
VITE_D1_API_BASE_URL=https://family-tree.wolfife.workers.dev
VITE_D1_API_TOKEN=abc123def456ghi789
```

### `wrangler.jsonc`
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "family-tree",
  "compatibility_date": "2025-09-27",
  
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-tree-db",
      "database_id": "12345678-1234-1234-1234-123456789012"
    }
  ],
  
  "env": {
    "production": {
      "vars": {
        "API_TOKEN": "abc123def456ghi789"
      }
    }
  }
}
```

### Worker 接口类型
```typescript
interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
  API_TOKEN?: string
}
```

## 🚀 部署检查清单

- [ ] D1 数据库已创建：`wrangler d1 list`
- [ ] `wrangler.jsonc` 中配置了 `d1_databases` 绑定
- [ ] `wrangler.jsonc` 中配置了 `API_TOKEN` 环境变量
- [ ] `.env.local` 中配置了前端环境变量
- [ ] 本地测试成功：`npm run preview` + curl 测试
- [ ] 代码编译通过：`npm run build`
- [ ] 部署成功：`npm run deploy`
- [ ] 部署后测试成功：curl 测试生产环境

## 📚 相关命令速查

| 命令 | 说明 |
|------|------|
| `wrangler d1 list` | 列出所有 D1 数据库 |
| `wrangler d1 create <name>` | 创建新数据库 |
| `wrangler d1 execute <name> --command "SQL"` | 执行 SQL 命令 |
| `npm run preview` | 启动本地开发服务器 |
| `npm run deploy` | 部署到 Cloudflare |
| `wrangler tail` | 查看 Worker 实时日志 |
| `wrangler deployments list` | 查看部署历史 |

## 🔗 更多资源

- [D1 完整调试指南](./D1_DEBUGGING.md)
- [Drizzle ORM 迁移详情](./DRIZZLE_MIGRATION.md)
- [快速开始指南](./DRIZZLE_QUICKSTART.md)
- [官方 Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [官方 Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)

## 💬 需要帮助？

1. **查看 Worker 日志**
   ```bash
   wrangler tail
   ```

2. **运行诊断脚本**
   ```bash
   node d1-diagnose.js
   ```

3. **测试 D1 数据库**
   ```bash
   wrangler d1 execute family-tree-db --command "SELECT * FROM members LIMIT 1"
   ```

4. **检查浏览器控制台**
   - F12 打开开发者工具
   - Console 标签查看错误
   - Network 标签查看请求/响应

---

**完成以上步骤后，D1 连接应该能够正常工作！** ✅
