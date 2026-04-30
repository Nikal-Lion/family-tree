import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

async function main(): Promise<void> {
  const { parsePartDataMarkdownV2 } = await import('../src/services/partDataImportV2.ts')
  const markdownPath = resolve(projectRoot, 'docs', 'part-data.md')
  const outputPath = resolve(projectRoot, 'docs', 'part-data-verification-v2.md')
  mkdirSync(dirname(outputPath), { recursive: true })

  const raw = readFileSync(markdownPath, 'utf-8')
  const data = parsePartDataMarkdownV2(raw)

  const isolated = data.members.filter((m) => m.uncertaintyFlags?.includes('missing'))
  const matched = data.childClaims.filter((c) => c.status === 'matched').length
  const missing = data.childClaims.filter((c) => c.status === 'missing').length
  const ambiguous = data.childClaims.filter((c) => c.status === 'ambiguous').length

  const md = `# 族谱数据校验报告 V2

> 生成时间：${new Date().toISOString()}
> 源文件：docs/part-data.md
> 解析状态：✅ 成功

## 一、统计摘要

| 指标 | 数量 |
|------|------|
| 主成员 | ${data.members.length} |
| 配偶记录 | ${data.spouses.length} |
| 子女声明 | ${data.childClaims.length} |
| 匹配成功 | ${matched} |
| 缺失（无对应 Member）| ${missing} |
| 同名冲突 | ${ambiguous} |
| 孤立成员（uncertaintyFlags 含 missing） | ${isolated.length} |

## 二、孤立成员清单

${isolated.map((m) => `- [${m.generationLabelRaw}] ${m.name} (ID:${m.id})`).join('\n') || '✅ 无'}

## 三、不匹配子女声明（前 30 条）

${data.childClaims
  .filter((c) => c.status === 'missing')
  .slice(0, 30)
  .map((c) => {
    const parent = data.members.find((m) => m.id === c.parentId)
    return `- 父=${parent?.name} (gen ${parent?.generationNumber}) 声明子女 "${c.claimedName}"`
  })
  .join('\n') || '✅ 无'}
`
  writeFileSync(outputPath, md, 'utf-8')
  console.log(`✅ 报告已生成: ${outputPath}`)
  console.log(`孤立成员: ${isolated.length} (期望 0)`)
  if (isolated.length > 12) {
    console.error('❌ 孤立成员比旧版本（12 个）还多')
    process.exit(1)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
