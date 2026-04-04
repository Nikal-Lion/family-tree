# D1 连接问题排查指南

## 问题描述
前端加载页面时报错：`TypeError: Failed to fetch`，无法连接到 D1 数据库，已回退到本地数据。

## 🔍 常见原因和解决方案

### 原因 1：CORS 配置问题
**症状**：浏览器控制台显示 CORS 错误

**解决方案**：
在 `wrangler.jsonc` 中配置 CORS（如果跨域）：

```jsonc
{
  "env": {
    "production": {
      "routes": [
        {
          "pattern": "https://your-domain.com/*",
          "zone_name": "your-domain.com"
        }
      ]
    }
  }
}
```

在 Worker 中已配置的 CORS headers 应该能处理。检查：
```typescript
headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*')
```

### 原因 2：D1 数据库未绑定到 Worker
**症状**：Worker 部署成功，但无法访问数据库

**步骤 1：检查 Worker 配置**
编辑 `wrangler.jsonc`，添加 D1 数据库绑定：

```jsonc
{
  "name": "family-tree",
  "compatibility_date": "2025-09-27",
  
  // 添加这部分
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-tree-db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ],
  
  "env": {
    "production": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "family-tree-db",
          "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        }
      ]
    }
  }
}
```

**步骤 2：获取数据库 ID**
```bash
wrangler d1 list
```

输出示例：
```
┌─────────────────────┬──────────────────────────────────────┐
│ name                │ uuid                                 │
├─────────────────────┼──────────────────────────────────────┤
│ family-tree-db      │ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx │
└─────────────────────┴──────────────────────────────────────┘
```

**步骤 3：创建数据库（如果不存在）**
```bash
wrangler d1 create family-tree-db
```

### 原因 3：环境变量未正确配置
**症状**：前端连接失败，错误提示"未配置 VITE_D1_API_BASE_URL"

**检查清单**：

1. **检查 `.env.local` 文件**
```dotenv
VITE_D1_API_BASE_URL=https://your-worker-url.workers.dev
VITE_D1_API_TOKEN=your-api-token
```

2. **重启开发服务器**
```bash
# Ctrl+C 停止当前服务
npm run preview
# 或
npm run dev
```

3. **检查浏览器是否读取到环境变量**
打开浏览器控制台，执行：
```javascript
// 检查环境变量是否被加载
console.log(import.meta.env.VITE_D1_API_BASE_URL)
```

### 原因 4：Worker 部署失败或已过期
**症状**：URL 可以访问但返回 404 或其他错误

**检查方案**：

```bash
# 查看最近部署
wrangler deployments list

# 重新部署
npm run deploy

# 或本地测试
npm run preview
```

### 原因 5：API 鉴权失败
**症状**：Worker 返回 401 Unauthorized

**检查步骤**：

1. **验证 API_TOKEN 配置**
在 `wrangler.jsonc` 中设置环境变量：

```jsonc
{
  "env": {
    "production": {
      "vars": {
        "API_TOKEN": "your-secret-token"
      }
    }
  }
}
```

2. **验证请求头格式**
```typescript
// 前端发送
headers.set('Authorization', `Bearer ${D1_API_TOKEN}`)

// Worker 验证
const auth = request.headers.get('Authorization') || ''
if (auth !== `Bearer ${expected}`) {
  return unauthorized(env)
}
```

## 🛠️ 调试步骤

### 步骤 1：检查本地 Worker 是否运行
```bash
npm run preview
```

在另一个终端测试：
```bash
curl -X GET http://localhost:8787/api/family-data \
  -H "Authorization: Bearer Token" \
  -H "Content-Type: application/json"
```

**预期响应**：
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

### 步骤 2：检查前端是否正确发送请求
打开浏览器开发者工具（F12）→ Network 标签：

1. 查看请求 URL 是否正确
2. 查看请求头中 Authorization 是否正确
3. 查看响应状态码和内容

### 步骤 3：启用详细日志
编辑 `src/services/d1ApiService.ts`，添加调试日志：

```typescript
export async function loadFamilyDataFromD1(): Promise<FamilyData | null> {
  const base = requireApiBaseUrl()
  console.log('[D1] 正在加载数据，URL:', base)
  
  try {
    const response = await fetch(buildFamilyDataRequestUrl(base), {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    })
    
    console.log('[D1] 响应状态:', response.status)
    
    if (!response.ok) {
      const text = await response.text()
      console.error('[D1] 错误响应:', text)
      throw new Error(text || `D1 读取失败（${response.status}）`)
    }
    
    const payload = await response.json()
    console.log('[D1] 成功读取:', payload)
    return payload.data
  } catch (error) {
    console.error('[D1] 异常:', error)
    throw error
  }
}
```

### 步骤 4：测试 D1 自检
打开浏览器控制台，运行：
```javascript
// 导入服务（假设已加载）
import { runD1SelfCheck } from '@/services/d1ApiService'

// 执行自检
const result = await runD1SelfCheck()
console.log(result)
```

## 📋 完整的故障排查清单

- [ ] `.env.local` 中配置了 `VITE_D1_API_BASE_URL`
- [ ] `.env.local` 中配置了 `VITE_D1_API_TOKEN`
- [ ] `wrangler.jsonc` 中配置了 D1 数据库绑定 (`d1_databases`)
- [ ] D1 数据库已创建：`wrangler d1 list`
- [ ] 本地 Worker 可以启动：`npm run preview`
- [ ] 本地测试能访问 `/api/family-data` 端点
- [ ] 前端环境变量在运行时可访问
- [ ] 浏览器网络标签显示正确的请求和响应
- [ ] API Token 格式正确（如果需要）
- [ ] Worker 已部署到 Cloudflare：`npm run deploy`

## 🚀 快速修复方案

### 场景 A：尚未创建 D1 数据库
```bash
# 创建数据库
wrangler d1 create family-tree-db

# 获取数据库 ID
wrangler d1 list

# 更新 wrangler.jsonc（使用实际的 database_id）
# ... 见上方示例

# 重新部署
npm run deploy
```

### 场景 B：本地开发，想测试 Worker
```bash
# 启动本地 Worker
npm run preview

# 在浏览器中访问
open http://localhost:8787
```

### 场景 C：部署到生产环境
```bash
# 构建项目
npm run build

# 部署
npm run deploy

# 验证
curl https://your-worker-url.workers.dev/api/family-data \
  -H "Authorization: Bearer your-token"
```

## 📞 进阶调试

### 查看 Worker 日志
```bash
wrangler tail
```

这会显示实时的 Worker 执行日志。

### 测试 D1 数据库本身
```bash
# 连接到远程数据库
wrangler d1 execute family-tree-db --command "SELECT * FROM members LIMIT 1"
```

### 检查 Drizzle ORM 是否正确
在 Worker 代码中添加日志：

```typescript
async function readFamilyData(env: Env): Promise<FamilyData | null> {
  await ensureSchema(env)
  
  const db = getDb(env)
  console.log('[Drizzle] 数据库实例已创建')
  
  try {
    const memberRows = await db.select().from(schema.members).all()
    console.log('[Drizzle] 查询成功，得到', memberRows.length, '条成员记录')
    // ...
  } catch (error) {
    console.error('[Drizzle] 查询失败:', error)
    throw error
  }
}
```

## 💡 预防措施

1. **定期检查部署状态**
   - 使用 `wrangler deployments list` 查看历史
   - 设置告警通知

2. **添加健康检查端点**
   ```typescript
   if (request.method === 'GET' && url.pathname === '/health') {
     return jsonResponse(env, { status: 'ok' })
   }
   ```

3. **记录完整的错误日志**
   - 在 catch 块中捕获堆栈跟踪
   - 返回详细的错误信息用于调试

4. **使用环境隔离**
   - 开发环境（localhost）
   - 测试环境（staging Worker）
   - 生产环境（production Worker）

## 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [D1 文档](https://developers.cloudflare.com/d1/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Drizzle ORM D1 集成](https://orm.drizzle.team/docs/get-started-sqlite)

---

**还有问题？** 请提供以下信息：
1. 完整的错误信息
2. 浏览器控制台的错误堆栈
3. Worker 日志输出（`wrangler tail`）
4. 当前 `wrangler.jsonc` 和 `.env.local` 的配置
