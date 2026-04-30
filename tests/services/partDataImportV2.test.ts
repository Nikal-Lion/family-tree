import { describe, it, expect } from 'vitest'
import { parsePartDataMarkdownV2 } from '../../src/services/partDataImportV2'

describe('parsePartDataMarkdownV2 - 主语行', () => {
  it('TC1: 标准主体行 — 创建 1 个 Member 并提取父亲 hint', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 宇衡三子，明景泰五年甲戌年生。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members).toHaveLength(1)
    expect(result.members[0].name).toBe('朝玉')
    expect(result.members[0].generationLabelRaw).toBe('九 世祖')
    expect(result.members[0].generationNumber).toBe(9)
  })
})

describe('parsePartDataMarkdownV2 - 父名提取（regex bug 修复）', () => {
  it('TC2: 单字父名"初" — 不应被漏', () => {
    const md = `# 太璋公房派下\n## 廿一世\n立球 初 长子,名祥顺,清咸丰年间生。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members).toHaveLength(1)
    const lijiu = result.members[0]
    expect(lijiu.name).toBe('立球')
    expect(lijiu.rawNotes).toContain('初')
  })

  it('TC3: 父名与"次子"间有空格 — 不应被漏', () => {
    const md = `# 太璋公房派下\n## 十四 世\n俊甫 元卿 次子,名士伟。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members).toHaveLength(1)
    expect(result.members[0].name).toBe('俊甫')
    expect(result.members[0].rawNotes).toContain('元卿')
  })
})

describe('parsePartDataMarkdownV2 - 配偶解析', () => {
  it('TC4: 单一配偶 — 创建 1 个 Spouse 记录', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 宇衡三子，配孔三娘，明景泰五年生，享寿八十六岁。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.spouses).toHaveLength(1)
    const s = result.spouses[0]
    expect(s.husbandId).toBe(result.members[0].id)
    expect(s.surname).toBe('孔')
    expect(s.relationLabel).toBe('配')
    expect(s.order).toBe(1)
    expect(s.aliases).toContain('三娘')
  })

  it('TC5: 多任配偶 — order 1,2,3', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 ，配刘氏，继配黄氏，三妣罗氏。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.spouses).toHaveLength(3)
    expect(result.spouses.map((s) => s.order)).toEqual([1, 2, 3])
    expect(result.spouses.map((s) => s.relationLabel)).toEqual(['配', '继配', '三妣'])
    expect(result.spouses.map((s) => s.surname)).toEqual(['刘', '黄', '罗'])
  })
})
