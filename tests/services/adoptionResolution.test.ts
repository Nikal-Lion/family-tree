import { describe, expect, it, vi } from 'vitest'
import { parsePartDataMarkdownV2, type PartDataParsingNote } from '../../src/services/partDataImportV2'
import { exportAsJson, normalizeFamilyData, parseImportedJson } from '../../src/services/importExport'
import { childClaimAdoptionLabel } from '../../src/services/childClaimService'
import { summarizePartDataImportV2 } from '../../src/services/importDiagnostics'

const source = `# 本房
## 九世
元卿 ，生二子：祥甫、俊甫。
## 十世
祥甫 元卿长子，生二子：卓敬、贤敬（出继）。
俊甫 元卿次子，继子：贤敬。
## 十一世
卓敬 祥甫长子。
贤敬 祥甫次子，往外。
贤敬 俊甫继子，配黄氏，生子：生龙。
## 十二世
生龙 贤敬长子。`

function parse(markdown = source) {
  const notes: PartDataParsingNote[] = []
  const data = normalizeFamilyData(parsePartDataMarkdownV2(markdown, (note) => notes.push(note)))
  return { data, notes }
}

describe('出继复载 — 一人一档与两种父子关系', () => {
  it('兄弟间出继对应唯一时整理一份档案，双方声明指向同一人', () => {
    const { data, notes } = parse()
    const children = data.members.filter((member) => member.name === '贤敬')
    expect(children).toHaveLength(1)
    const child = children[0]
    const birth = data.members.find((member) => member.name === '祥甫')!
    const adoptive = data.members.find((member) => member.name === '俊甫')!
    expect(child.parentId).toBe(birth.id)
    expect(data.childClaims.filter((claim) => claim.claimedName === child.name).map((claim) => claim.resolvedMemberId)).toEqual([child.id, child.id])
    expect(data.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromMemberId: child.id, toMemberId: birth.id, type: 'father' }),
      expect.objectContaining({ fromMemberId: child.id, toMemberId: adoptive.id, type: 'adoptive-parent' }),
    ]))
    expect(notes).toHaveLength(1)
    expect(notes[0].reason).toContain('同一人物')
    expect(child.uncertaintyFlags).not.toContain('missing')
  })

  it('保留两处原文，并重连配偶、后代及子女声明，不留下已移除 ID 的引用', () => {
    const { data } = parse()
    const child = data.members.find((member) => member.name === '贤敬')!
    const grandchild = data.members.find((member) => member.name === '生龙')!
    expect(child.biography?.split('\n')).toEqual(['贤敬 祥甫次子，往外。', '贤敬 俊甫继子，配黄氏，生子：生龙。'])
    expect(child.rawNotes).toContain('祥甫次子')
    expect(child.rawNotes).toContain('俊甫继子')
    expect(data.spouses[0].husbandId).toBe(child.id)
    expect(grandchild.parentId).toBe(child.id)
    expect(data.childClaims.find((claim) => claim.claimedName === '生龙')?.parentId).toBe(child.id)
    expect(data.nextId).toBeGreaterThan(Math.max(...data.members.map((member) => member.id)))
    expect(data.nextRelationId).toBe(data.relations.length + 1)
    expect(parseImportedJson(exportAsJson(data))).toEqual(data)
  })

  it('出继和承继标签区分方向，不把承继父当生父', () => {
    const { data } = parse()
    const claims = data.childClaims.filter((claim) => claim.claimedName === '贤敬')
    expect(claims.map((claim) => childClaimAdoptionLabel(data, claim))).toEqual(['出继（生父记载）', '承继（继父记载）'])
    expect(childClaimAdoptionLabel(data, data.childClaims[0])).toBe('')
  })

  it('本来只有一条人物正文也建立生父及承继父，不需先制造重复人物', () => {
    const { data } = parse(source.replace('贤敬 祥甫次子，往外。\n', ''))
    const child = data.members.find((member) => member.name === '贤敬')!
    expect(child.parentId).toBe(data.members.find((member) => member.name === '祥甫')?.id)
    expect(data.relations.filter((relation) => relation.fromMemberId === child.id).map((relation) => relation.type)).toEqual(['father', 'adoptive-parent'])
  })

  it('只有继子记载时不捏造生父，已有承继父不再误报孤立', () => {
    const { data } = parse('# 本房\n## 十世\n俊甫 ，继子：贤敬。\n## 十一世\n贤敬 俊甫继子。')
    const child = data.members[1]
    expect(child.parentId).toBeNull()
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].type).toBe('adoptive-parent')
    expect(summarizePartDataImportV2(data).isolatedMembers).toEqual([])
  })

  it('没有订阅报告时仍整理同一人物与持久关系', () => {
    vi.useFakeTimers()
    try {
      const first = parsePartDataMarkdownV2(source)
      const second = parsePartDataMarkdownV2(source, () => {})
      expect(first).toEqual(second)
      expect(first.members.filter((member) => member.name === '贤敬')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})

describe('出继复载 — 不凭同名合并', () => {
  it.each([
    ['没有出继声明', source.replace('贤敬（出继）', '贤敬')],
    ['没有承继声明', source.replace('继子：贤敬', '生子：贤敬')],
    ['父辈兄弟关系不确定', source.replace('俊甫 元卿次子', '俊甫 旁支次子')],
    ['双处正文没有对应的承继父', source.replace('贤敬 俊甫继子', '贤敬 他人继子')],
    ['不同分支', source.replace('贤敬 俊甫继子', '# 其他房\n贤敬 俊甫继子')],
    ['不同世代', source.replace('贤敬 俊甫继子', '## 十二世\n贤敬 俊甫继子')],
    ['多于两条同名正文', source.replace('## 十二世', '贤敬 ，其他同名记录。\n## 十二世')],
  ])('%s', (_label, markdown) => {
    const { data, notes } = parse(markdown)
    expect(data.members.filter((member) => member.name === '贤敬').length).toBeGreaterThan(1)
    expect(notes.some((note) => note.reason.includes('同一人物'))).toBe(false)
  })

  it('仅凭两个亲生子女声明争抢同一人时不随便选生父', () => {
    const { data, notes } = parse('# 本房\n## 十世\n祥甫 ，生子：贤敬。\n俊甫 ，生子：贤敬。\n## 十一世\n贤敬 ，本人。')
    expect(data.members[2].parentId).toBeNull()
    expect(data.childClaims.map((claim) => claim.status)).toEqual(['ambiguous', 'ambiguous'])
    expect(notes).toHaveLength(2)
    expect(notes[0].reason).toContain('未选择生父')
  })

  it('没有落地关系的旧标记仍显示方向待核对', () => {
    const { data } = parse()
    const claim = data.childClaims.find((item) => item.claimedName === '贤敬')!
    expect(childClaimAdoptionLabel({ relations: [] }, claim)).toBe('过继 / 承嗣（方向待核对）')
  })
})
