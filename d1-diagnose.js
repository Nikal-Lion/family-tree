#!/usr/bin/env node

/**
 * D1 连接诊断脚本
 * 用法: node d1-diagnose.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

console.log('🔍 D1 连接诊断工具\n')
console.log('=' .repeat(50))

// 1. 检查 .env.local 文件
console.log('\n📋 检查 .env.local 配置...')
const envPath = path.join(__dirname, '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  const hasBaseUrl = envContent.includes('VITE_D1_API_BASE_URL')
  const hasToken = envContent.includes('VITE_D1_API_TOKEN')
  
  console.log(`✓ .env.local 存在`)
  console.log(`  - VITE_D1_API_BASE_URL: ${hasBaseUrl ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`  - VITE_D1_API_TOKEN: ${hasToken ? '✓ 已配置' : '✗ 未配置'}`)
  
  if (!hasBaseUrl || !hasToken) {
    console.log('\n⚠️  建议: 确保 .env.local 包含以下内容:')
    console.log('  VITE_D1_API_BASE_URL=https://your-worker-url.workers.dev')
    console.log('  VITE_D1_API_TOKEN=your-api-token')
  }
} else {
  console.log('✗ .env.local 不存在')
  console.log('  创建方法: 复制 .env.example 并填充变量值')
}

// 2. 检查 wrangler.jsonc
console.log('\n📋 检查 wrangler.jsonc 配置...')
const wranglerPath = path.join(__dirname, 'wrangler.jsonc')
if (fs.existsSync(wranglerPath)) {
  const wranglerContent = fs.readFileSync(wranglerPath, 'utf-8')
  const hasD1Binding = wranglerContent.includes('d1_databases')
  
  console.log(`✓ wrangler.jsonc 存在`)
  console.log(`  - D1 绑定: ${hasD1Binding ? '✓ 已配置' : '✗ 未配置'}`)
  
  if (!hasD1Binding) {
    console.log('\n⚠️  建议: 在 wrangler.jsonc 中添加 D1 绑定:')
    console.log(`
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-tree-db",
      "database_id": "your-database-id"
    }
  ]
    `)
  }
} else {
  console.log('✗ wrangler.jsonc 不存在')
}

// 3. 检查 package.json 依赖
console.log('\n📦 检查依赖...')
const packagePath = path.join(__dirname, 'package.json')
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
  const hasDrizzle = 'drizzle-orm' in pkg.dependencies
  const hasWrangler = 'wrangler' in pkg.devDependencies
  
  console.log(`  - drizzle-orm: ${hasDrizzle ? '✓' : '✗'}`)
  console.log(`  - wrangler: ${hasWrangler ? '✓' : '✗'}`)
  
  if (!hasDrizzle || !hasWrangler) {
    console.log('\n⚠️  建议: 执行 npm install')
  }
}

// 4. 检查文件结构
console.log('\n📁 检查文件结构...')
const files = [
  'cloudflare-d1-worker/src/schema.ts',
  'cloudflare-d1-worker/src/index.ts',
  'src/services/d1ApiService.ts',
]

files.forEach(file => {
  const filePath = path.join(__dirname, file)
  const exists = fs.existsSync(filePath)
  console.log(`  ${exists ? '✓' : '✗'} ${file}`)
})

// 5. 总结
console.log('\n' + '='.repeat(50))
console.log('\n✅ 诊断完成！\n')
console.log('后续步骤:')
console.log('1. 确保所有配置文件都已填充正确的值')
console.log('2. 执行 npm install 安装依赖')
console.log('3. 执行 npm run preview 启动本地开发服务器')
console.log('4. 打开浏览器控制台查看详细错误信息')
console.log('5. 如需查看 Worker 日志: wrangler tail\n')
