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

describe('parsePartDataMarkdownV2 - 子女声明 ChildClaim', () => {
  it('TC6: 标准子女声明 — 创建 N 个 ChildClaim', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 ，生八子。太琼、太琪、太璋、太琳、太瑚、太琏、太璜、太琚。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.childClaims.length).toBe(8)
    expect(result.childClaims[0].claimedName).toBe('太琼')
    expect(result.childClaims[0].ordinalIndex).toBe(1)
    expect(result.childClaims[0].gender).toBe('男')
    expect(result.childClaims[7].ordinalIndex).toBe(8)
  })

  it('TC7: 出继标注 — isAdoptive=true', () => {
    const md = `# 太璋公房派下\n## 十五 世\n广甫 ，生子：礼敬（出继）、仪敬。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.childClaims).toHaveLength(2)
    expect(result.childClaims[0].claimedName).toBe('礼敬')
    expect(result.childClaims[0].isAdoptive).toBe(true)
    expect(result.childClaims[1].isAdoptive).toBe(false)
  })

  it('TC8: "俱止" 标注 — statusFlags 含 no-grandchildren', () => {
    const md = `# 太璋公房派下\n## 十八 世\n父亲 ，生子:日亮、日学、日魁俱止。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.childClaims).toHaveLength(3)
    expect(result.childClaims[2].claimedName).toBe('日魁')
    expect(result.childClaims[2].statusFlags).toContain('no-grandchildren')
  })
})

describe('parsePartDataMarkdownV2 - 描述段落附加', () => {
  it('TC9: 非主语行附加到上一成员 rawNotes', () => {
    const md = `# 太璋公房派下\n## 十五 世\n发甫 杭良三子,字必荣。\n公一脉下共有坟九穴，详见附录。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members).toHaveLength(1)
    expect(result.members[0].rawNotes).toContain('[公共备注] 公一脉下共有坟九穴')
  })

  it('TC10: 围栏块 \`\`\`text 附加到上一成员', () => {
    const md = `# 太璋公房派下\n## 十五 世\n发甫 ，字必荣。\n\`\`\`text\n附录内容\n\`\`\``
    const result = parsePartDataMarkdownV2(md)
    expect(result.members[0].rawNotes).toContain('[公共备注] 附录内容')
  })
})

describe('parsePartDataMarkdownV2 - Two-pass 跨代匹配', () => {
  it('TC11: ChildClaim 跨代匹配成功', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 ，生子：太琼。\n## 十 世祖\n太琼 ，本人。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members).toHaveLength(2)
    const taiqiong = result.members.find((m) => m.name === '太琼')!
    const claim = result.childClaims[0]
    expect(claim.status).toBe('matched')
    expect(claim.resolvedMemberId).toBe(taiqiong.id)
    expect(taiqiong.parentId).toBe(result.members[0].id)
  })

  it('TC12: 同名匹配冲突 — claim.status=ambiguous', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n朝玉 ，生子：太琼。\n## 十 世祖\n太琼 ，本人。\n太琼 ，另一个同名。`
    const result = parsePartDataMarkdownV2(md)
    const claim = result.childClaims[0]
    expect(claim.status).toBe('ambiguous')
  })

  it('TC13: 起始代之外的 parentId=null 标记 isolated', () => {
    const md = `# 太璋公房派下\n## 九 世祖\n孤儿甲 ，无父记录。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.members[0].uncertaintyFlags).not.toContain('missing')
  })
})

describe('parsePartDataMarkdownV2 - 子女声明 ChildClaim (abbreviated forms)', () => {
  it('TC14: 抽象 "女：" 简写 — 不带"生"前缀的女儿声明', () => {
    const md = `# 太璋公房派下\n## 廿三世\n德华 ，生子：连发，女：宝秀、金秀。`
    const result = parsePartDataMarkdownV2(md)
    const sons = result.childClaims.filter((c) => c.gender === '男')
    const daughters = result.childClaims.filter((c) => c.gender === '女')
    expect(sons).toHaveLength(1)
    expect(sons[0].claimedName).toBe('连发')
    expect(daughters).toHaveLength(2)
    expect(daughters.map((d) => d.claimedName)).toEqual(['宝秀', '金秀'])
    // 关键：不能出现"女宝秀"这种 son 段越界产物
    expect(result.childClaims.find((c) => c.claimedName === '女宝秀')).toBeUndefined()
  })

  it('TC15: 标准 "生子：" + "生女：" 同时出现', () => {
    const md = `# 太璋公房派下\n## 廿三世\n德安 ，生二子：荣华、永发，生女：带秀、茶秀。`
    const result = parsePartDataMarkdownV2(md)
    const sons = result.childClaims.filter((c) => c.gender === '男')
    const daughters = result.childClaims.filter((c) => c.gender === '女')
    expect(sons.map((s) => s.claimedName)).toEqual(['荣华', '永发'])
    expect(daughters.map((d) => d.claimedName)).toEqual(['带秀', '茶秀'])
  })

  it('TC16: 继子：声明 — isAdoptive=true', () => {
    const md = `# 太璋公房派下\n## 十五 世\n礼敬 ，继子：必贤。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.childClaims).toHaveLength(1)
    expect(result.childClaims[0].claimedName).toBe('必贤')
    expect(result.childClaims[0].isAdoptive).toBe(true)
  })

  it('TC17: 嗣子：声明 — isAdoptive=true', () => {
    const md = `# 太璋公房派下\n## 十五 世\n天兴 ，嗣子：有恩。`
    const result = parsePartDataMarkdownV2(md)
    expect(result.childClaims).toHaveLength(1)
    expect(result.childClaims[0].claimedName).toBe('有恩')
    expect(result.childClaims[0].isAdoptive).toBe(true)
  })
})
