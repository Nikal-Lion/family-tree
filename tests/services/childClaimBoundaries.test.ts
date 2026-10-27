import { describe, expect, it } from 'vitest'
import { parsePartDataMarkdownV2 } from '../../src/services/partDataImportV2'
import type { ChildClaimStatusFlag } from '../../src/types/childClaim'

function parseDeclaration(declaration: string) {
  return parsePartDataMarkdownV2(`# 分支\n## 九世父辈\n朝玉 ，${declaration}`)
}

describe('子女声明边界 — 保留既有声明形式', () => {
  it.each([
    { declaration: '生二子：恭忠、长福。', names: ['恭忠', '长福'], gender: '男', adoptive: false },
    { declaration: '生子二：恭忠、长福。', names: ['恭忠', '长福'], gender: '男', adoptive: false },
    { declaration: '生二子。恭忠、长福。', names: ['恭忠', '长福'], gender: '男', adoptive: false },
    { declaration: '女：宝秀、金秀。', names: ['宝秀', '金秀'], gender: '女', adoptive: false },
    { declaration: '生二女：宝秀、金秀。', names: ['宝秀', '金秀'], gender: '女', adoptive: false },
    { declaration: '继子：必贤。', names: ['必贤'], gender: '男', adoptive: true },
    { declaration: '嗣子：有恩。', names: ['有恩'], gender: '男', adoptive: true },
  ])('$declaration', ({ declaration, names, gender, adoptive }) => {
    const { members, childClaims } = parseDeclaration(declaration)

    expect(childClaims.map((claim) => claim.claimedName)).toEqual(names)
    for (const claim of childClaims) {
      expect(claim.parentId).toBe(members[0].id)
      expect(claim.gender).toBe(gender)
      expect(claim.isAdoptive).toBe(adoptive)
    }
  })
})

describe('子女声明边界 — 姓名与尾注分离', () => {
  const cases: {
    declaration: string
    name: string
    flags: ChildClaimStatusFlag[]
    adoptive: boolean
    rawName: string
  }[] = [
    { declaration: '生子：湘敬失考。', name: '湘敬', flags: ['lost-record'], adoptive: false, rawName: '湘敬失考' },
    { declaration: '生子：凤敬早殁失考。', name: '凤敬', flags: ['lost-record'], adoptive: false, rawName: '凤敬早殁失考' },
    { declaration: '生子：凤敬早夭失考。', name: '凤敬', flags: ['lost-record'], adoptive: false, rawName: '凤敬早夭失考' },
    { declaration: '生子：日魁俱止。', name: '日魁', flags: ['no-grandchildren'], adoptive: false, rawName: '日魁俱止' },
    { declaration: '生子：日亮无后。', name: '日亮', flags: ['no-grandchildren'], adoptive: false, rawName: '日亮无后' },
    { declaration: '女：宝秀出嫁。', name: '宝秀', flags: ['out-married'], adoptive: false, rawName: '宝秀出嫁' },
    { declaration: '生子：礼敬出继。', name: '礼敬', flags: [], adoptive: true, rawName: '礼敬出继' },
    { declaration: '生子：乾英俱。', name: '乾英', flags: [], adoptive: false, rawName: '乾英俱' },
  ]

  it.each(cases)('$rawName', ({ declaration, name, flags, adoptive, rawName }) => {
    const { childClaims } = parseDeclaration(declaration)

    expect(childClaims).toHaveLength(1)
    expect(childClaims[0].claimedName).toBe(name)
    expect(childClaims[0].statusFlags).toEqual(flags)
    expect(childClaims[0].isAdoptive).toBe(adoptive)
    expect(childClaims[0].rawText).toContain(rawName)
  })
})

describe('子女声明边界 — 不把叙述或无名计数当姓名', () => {
  it.each([
    { declaration: '生子：良玉、佩玉、珩玉，往建阳、鸣玉、彩玉。', names: ['良玉', '佩玉', '珩玉', '鸣玉', '彩玉'] },
    { declaration: '生子：恭忠，往建阳住。', names: ['恭忠'] },
    { declaration: '生子：恭忠，坤山艮向。', names: ['恭忠'] },
    { declaration: '生子：恭忠，辛丑辛未分金。', names: ['恭忠'] },
    { declaration: '生子：恭忠，娶邹氏。', names: ['恭忠'] },
    { declaration: '生子：恭忠，字牛子。', names: ['恭忠'] },
    { declaration: '生叁个子。', names: [] },
    { declaration: '生二子：俱卒失考。', names: [] },
  ])('$declaration', ({ declaration, names }) => {
    const { members, childClaims } = parseDeclaration(declaration)

    expect(childClaims.map((claim) => claim.claimedName)).toEqual(names)
    expect(members).toHaveLength(1)
    expect(members[0].rawNotes).toContain(declaration)
  })
})

describe('子女声明边界 — 标点、性别段与重复声明', () => {
  it.each([
    '生二子：恭忠，长福；女：宝秀。',
    '生二子:恭忠,长福;女:宝秀。',
  ])('男、女段只各解析一次：%s', (declaration) => {
    const { childClaims } = parseDeclaration(declaration)

    expect(childClaims.map((claim) => [claim.claimedName, claim.gender])).toEqual([
      ['恭忠', '男'],
      ['长福', '男'],
      ['宝秀', '女'],
    ])
  })

  it('同一行的第二个声明不被首段吞入，也不重复创建', () => {
    const { childClaims } = parseDeclaration('生子：恭忠，生子：长福。')

    expect(childClaims.map((claim) => claim.claimedName)).toEqual(['恭忠', '长福'])
  })
})

describe('子女声明边界 — 前缀与跨辈叙述', () => {
  it('独立首次声明生子恭忠仍解析恭忠，不保留生子前缀', () => {
    const { childClaims } = parseDeclaration('生子恭忠。')

    expect(childClaims.map((claim) => claim.claimedName)).toEqual(['恭忠'])
    expect(childClaims[0].rawText).toContain('生子恭忠')
  })

  it('文秀之后的生子恭忠往外属于嵌套叙述，不升格为珀臣子女', () => {
    const result = parsePartDataMarkdownV2('# 分支\n## 九世父辈\n珀臣 ，生二子：文秀，生子恭忠往外，廷秀。')

    expect(result.childClaims.map((claim) => claim.claimedName)).toEqual(['文秀', '廷秀'])
    expect(result.childClaims[0].rawText).toContain('文秀，生子恭忠往外')
    expect(result.members[0].rawNotes).toContain('生二子：文秀，生子恭忠往外，廷秀')
  })

  it('能忠生子佛妹止只提取能忠，不转嫁佛妹的止状态或亲子关系', () => {
    const md = '# 分支\n## 九世父辈\n朝玉 ，生子：能忠生子佛妹止。\n## 十世子辈\n佛妹 ，本人。'
    const result = parsePartDataMarkdownV2(md)
    const parent = result.members.find((member) => member.name === '朝玉')!
    const fumei = result.members.find((member) => member.name === '佛妹')!
    const claims = result.childClaims.filter((claim) => claim.parentId === parent.id)

    expect(parent.rawNotes).toContain('能忠生子佛妹止')
    expect(claims.map((claim) => claim.claimedName)).toEqual(['能忠'])
    expect(claims[0].statusFlags).toEqual([])
    expect(claims[0].rawText).toContain('能忠生子佛妹止')
    expect(claims.some((claim) => claim.resolvedMemberId === fumei.id)).toBe(false)
    expect(fumei.parentId).not.toBe(parent.id)
  })

  it('保留合法单字名及含生、子的姓名', () => {
    const { childClaims } = parseDeclaration('生三子：靖、生财、子敬。')

    expect(childClaims.map((claim) => claim.claimedName)).toEqual(['靖', '生财', '子敬'])
  })
})
