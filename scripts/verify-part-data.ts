/**
 * 族谱 Markdown 数据干跑验证脚本
 * 读取 docs/part-data.md，使用解析管线提取数据，输出统计和风险报告
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// 动态导入解析服务和诊断服务
// 因为源码使用 verbatimModuleSyntax + .ts 扩展, 使用 tsx 可直接 import .ts 文件
async function main(): Promise<void> {
  const { parsePartDataMarkdown } = await import('../src/services/partDataImport.ts')
  const { summarizeFamilyDataImport, analyzeFamilyDataImport } = await import('../src/services/importDiagnostics.ts')

  const markdownPath = resolve(projectRoot, 'docs', 'part-data.md')
  const outputPath = resolve(projectRoot, 'docs', 'part-data-verification.md')

  console.log(`读取文件: ${markdownPath}`)
  const raw = readFileSync(markdownPath, 'utf-8')

  // ===== 第一阶段：解析 =====
  console.log('开始解析 Markdown...')
  let data
  try {
    data = parsePartDataMarkdown(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`解析失败: ${message}`)
    writeFileSync(
      outputPath,
      `# 族谱数据校验报告\n\n> **状态：解析失败**\n\n错误信息：${message}\n`,
      'utf-8',
    )
    process.exit(1)
  }

  // ===== 第二阶段：统计摘要 =====
  const summary = summarizeFamilyDataImport(data)

  // ===== 第三阶段：风险分析 =====
  const warnings = analyzeFamilyDataImport(data)

  // ===== 第四阶段：附加细节诊断 =====
  const detailWarnings: string[] = []

  // 检测空名成员
  const emptyNames = data.members.filter((m) => !m.name || m.name.trim() === '')
  if (emptyNames.length > 0) {
    detailWarnings.push(`检测到 ${emptyNames.length} 位成员姓名为空`)
  }

  // 检测 biography 中长度异常短的（可能解析不完整）
  const sparseBioMembers = data.members.filter(
    (m) => m.biography && m.biography.length < 10 && m.generationLabelRaw !== '',
  )
  // 这不算错误，仅记录

  // 检测重名同代成员
  const nameGenMap = new Map<string, Member[]>()
  for (const m of data.members) {
    const key = `${m.generationLabelRaw}|${m.name}`
    const list = nameGenMap.get(key) ?? []
    list.push(m)
    nameGenMap.set(key, list)
  }
  const duplicateNameGenEntries: string[] = []
  for (const [key, members] of nameGenMap) {
    if (members.length > 1) {
      duplicateNameGenEntries.push(
        `  - "${key}": ${members.length} 位成员 (ID: ${members.map((m) => m.id).join(', ')})`,
      )
    }
  }
  if (duplicateNameGenEntries.length > 0) {
    detailWarnings.push(
      `同世代同姓名冲突（${duplicateNameGenEntries.length} 组）:\n${duplicateNameGenEntries.join('\n')}`,
    )
  }

  // 检测孤立成员（无父、无子、无配偶）
  const childIds = new Set(data.members.filter((m) => m.parentId !== null).map((m) => m.parentId!))
  const spouseIds = new Set(data.members.flatMap((m) => m.spouseIds))
  const isolatedMembers = data.members.filter(
    (m) => m.parentId === null && m.spouseIds.length === 0 && !childIds.has(m.id),
  )
  if (isolatedMembers.length > 10) {
    detailWarnings.push(
      `检测到 ${isolatedMembers.length} 位孤立成员（无父母、无配偶、无子女），可能解析遗漏` +
      `\n${isolatedMembers.slice(0, 20).map((m) => `  - [${m.generationLabelRaw}] ${m.name} (ID:${m.id})`).join('\n')}` +
      (isolatedMembers.length > 20 ? `\n  ... 等共 ${isolatedMembers.length} 位` : ''),
    )
  }

  // 统计配偶性别（女性配偶数量）
  const femaleSpouses = data.members.filter((m) => m.gender === '女' && m.spouseIds.length > 0)
  const maleWithSpouses = data.members.filter((m) => m.gender === '男' && m.spouseIds.length > 0)

  // ===== 第五阶段：按世代分组统计 =====
  const genGroups = new Map<string, Member[]>()
  for (const m of data.members) {
    const gen = m.generationLabelRaw || '未标记'
    const list = genGroups.get(gen) ?? []
    list.push(m)
    genGroups.set(gen, list)
  }
  const sortedGens = [...genGroups.entries()].sort((a, b) => {
    const numA = parseInt(a[0].match(/\d+/)?.[0] ?? '0', 10)
    const numB = parseInt(b[0].match(/\d+/)?.[0] ?? '0', 10)
    return numA - numB
  })

  // ===== 构建报告 =====
  const lines: string[] = []
  lines.push('# 族谱数据校验报告')
  lines.push('')
  lines.push(`> 生成时间：${new Date().toISOString()}`)
  lines.push(`> 源文件：docs/part-data.md`)
  lines.push(`> 解析状态：✅ 成功`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 一、数据统计摘要')
  lines.push('')
  lines.push('| 指标 | 数量 |')
  lines.push('|------|------|')
  lines.push(`| 成员总数 | ${summary.memberCount} |`)
  lines.push(`| 始祖（根节点）| ${summary.rootCount} |`)
  lines.push(`| 别名 | ${summary.aliasCount} |`)
  lines.push(`| 时间表达 | ${summary.temporalCount} |`)
  lines.push(`| 葬地记录 | ${summary.burialCount} |`)
  lines.push(`| 事件 | ${summary.eventCount} |`)
  lines.push(`| 轨迹 | ${summary.trackCount} |`)
  lines.push(`| 男性配偶所有者 | ${maleWithSpouses.length} |`)
  lines.push(`| 女性配偶成员 | ${femaleSpouses.length} |`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 二、世代分布')
  lines.push('')
  lines.push('| 世代 | 成员数 | 备注 |')
  lines.push('|------|--------|------|')
  for (const [gen, members] of sortedGens) {
    const maleCount = members.filter((m) => m.gender === '男').length
    const femaleCount = members.filter((m) => m.gender === '女').length
    lines.push(`| ${gen} | ${members.length} | 男:${maleCount} 女:${femaleCount} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 三、数据质量风险')
  lines.push('')
  const allWarnings = [...warnings, ...detailWarnings]
  if (allWarnings.length === 0) {
    lines.push('✅ 未检测到明显风险。')
  } else {
    lines.push(`共检测到 **${allWarnings.length}** 项风险提示：`)
    lines.push('')
    for (let i = 0; i < allWarnings.length; i++) {
      lines.push(`### 风险 ${i + 1}`)
      lines.push('')
      lines.push(allWarnings[i])
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('')
  lines.push('## 四、配偶关系概要')
  lines.push('')
  lines.push(`- 男性成员中拥有配偶的：${maleWithSpouses.length} 人`)
  lines.push(`- 被标记为配偶的女性成员：${femaleSpouses.length} 人`)
  lines.push(`- 配偶关系总数：${data.members.reduce((sum, m) => sum + m.spouseIds.length, 0)} 条（每对双向计数）`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 五、葬地记录抽样')
  lines.push('')
  if (data.burials.length > 0) {
    lines.push(`共 ${data.burials.length} 条葬地记录，前 10 条抽样：`)
    lines.push('')
    for (const burial of data.burials.slice(0, 10)) {
      const member = data.members.find((m) => m.id === burial.memberId)
      lines.push(`- **[${member?.name ?? '未知'}]** ${burial.placeRaw}`)
    }
    if (data.burials.length > 10) {
      lines.push(`  ... 等共 ${data.burials.length} 条`)
    }
  } else {
    lines.push('⚠️ 未识别到葬地记录。')
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 六、问题成员清单')
  lines.push('')
  
  // 列出 name 可能异常的成员
  const suspiciousNames = data.members.filter(
    (m) => m.name.length === 1 || m.name.length > 5,
  )
  if (suspiciousNames.length > 0) {
    lines.push(`### 姓名长度异常（${suspiciousNames.length} 位）`)
    lines.push('')
    lines.push('| ID | 姓名 | 世代 | 长度 |')
    lines.push('|----|------|------|------|')
    for (const m of suspiciousNames) {
      lines.push(`| ${m.id} | ${m.name} | ${m.generationLabelRaw} | ${m.name.length} |`)
    }
    lines.push('')
  }

  // 列出可能由续行断裂产生的成员（biography 很短且没有配偶/父/子关系）
  const likelyOrphans = data.members.filter(
    (m) => 
      m.parentId === null &&
      m.spouseIds.length === 0 &&
      !childIds.has(m.id) &&
      (m.biography?.length ?? 0) < 30,
  )
  if (likelyOrphans.length > 0) {
    lines.push(`### 疑似续行断裂产生的孤立成员（${likelyOrphans.length} 位）`)
    lines.push('')
    lines.push('| ID | 姓名 | 世代 | Biography 长度 |')
    lines.push('|----|------|------|----------------|')
    for (const m of likelyOrphans.slice(0, 30)) {
      lines.push(`| ${m.id} | ${m.name} | ${m.generationLabelRaw} | ${m.biography?.length ?? 0} |`)
    }
    if (likelyOrphans.length > 30) {
      lines.push(`| ... | ... | ... | 等共 ${likelyOrphans.length} 位 |`)
    }
    lines.push('')
  }

  // 写入文件
  const report = lines.join('\n')
  writeFileSync(outputPath, report, 'utf-8')
  console.log(`\n校验报告已写入: ${outputPath}`)

  // 控制台摘要
  console.log('\n========== 解析摘要 ==========')
  console.log(`成员: ${summary.memberCount}`)
  console.log(`根节点: ${summary.rootCount}`)
  console.log(`别名: ${summary.aliasCount}`)
  console.log(`时间表达: ${summary.temporalCount}`)
  console.log(`葬地: ${summary.burialCount}`)
  console.log(`\n风险提示: ${allWarnings.length} 项`)
  for (const w of allWarnings) {
    console.log(`  ⚠ ${w.split('\n')[0]}`)
  }
}

main().catch((err) => {
  console.error('执行失败:', err)
  process.exit(1)
})