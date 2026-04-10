# D1 连接问题 - 快速参考卡

## 🚨 问题
```
TypeError: Failed to fetch
D1 初始化失败，已回退到本地数据
```

## ✅ 3 分钟快速修复

### 1. 配置 D1 绑定（wrangler.jsonc）
```bash
# 获取数据库 ID
wrangler d1 list

# 复制输出中的 uuid，添加到 wrangler.jsonc：
```

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-tree-db",
      "database_id": "YOUR_ID_HERE"  // 粘贴这里
    }
  ]
}
```

### 2. 配置环境变量（.env.local）
```bash
# 从 .env.example 复制
cp .env.local .env.example

# 编辑 .env.local，填入值：
VITE_D1_API_BASE_URL=https://family-tree.wolfife.workers.dev
VITE_D1_API_TOKEN=your-token-here
```

### 3. 配置 API Token（wrangler.jsonc）
```jsonc
{
  "env": {
    "production": {
      "vars": {
        "API_TOKEN": "your-token-here"  // 与 .env.local 的 TOKEN 相同
      }
    }
  }
}
```

### 4. 重启服务
```bash
npm install
npm run preview
```

### 5. 验证
```bash
# 在浏览器控制台测试
curl -X GET http://localhost:8787/api/family-data \
  -H "Authorization: Bearer your-token-here"
```

## 🔍 诊断

### 运行诊断工具
```bash
node d1-diagnose.js
```

### 查看 Worker 日志
```bash
wrangler tail
```

### 查看浏览器网络请求
1. F12 打开开发者工具
2. 切换到 Network 标签
3. 刷新页面
4. 查找 `family-data` 请求
5. 检查状态码和响应内容

## 📋 检查清单

- [ ] `wrangler d1 list` 显示数据库
- [ ] `wrangler.jsonc` 中有 `d1_databases` 配置
- [ ] `.env.local` 中有 `VITE_D1_API_BASE_URL` 和 `VITE_D1_API_TOKEN`
- [ ] 本地 Worker 可以启动：`npm run preview`
- [ ] curl 测试返回 200 OK
- [ ] 浏览器网络标签显示正确的请求和响应

## 🆘 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|--------|
| `DB is not defined` | D1 未绑定 | 添加 `d1_databases` 配置 |
| `401 Unauthorized` | Token 不匹配 | 检查 `.env.local` 和 `wrangler.jsonc` 中的 token |
| `CORS error` | 跨域问题 | 检查 Worker 中的 CORS 头配置 |
| `no such table` | Schema 创建失败 | 检查 `ensureSchema()` 是否执行 |
| `Connection timeout` | 网络问题 | 查看 `wrangler tail` 日志 |

## 📚 完整指南

- 详细配置：[D1_SETUP.md](./D1_SETUP.md)
- 完整调试：[D1_DEBUGGING.md](./D1_DEBUGGING.md)
- Drizzle 迁移：[DRIZZLE_MIGRATION.md](./DRIZZLE_MIGRATION.md)

## 🎯 下一步

1. ✅ 完成上述 5 个步骤
2. ✅ 验证本地连接成功
3. 📤 部署到 Cloudflare：`npm run deploy`
4. 🧪 测试生产环境
5. 📊 监控日志：`wrangler tail`

---

**需要帮助？** 查看 [完整调试指南](./D1_DEBUGGING.md)
