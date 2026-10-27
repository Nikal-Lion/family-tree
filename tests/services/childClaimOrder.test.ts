import { describe, expect, it } from 'vitest'
import { parsePartDataMarkdownV2, type PartDataParsingNote } from '../../src/services/partDataImportV2'
import { normalizeFamilyData } from '../../src/services/importExport'

function parse(children: string, records: string, branch = '# 分支') {
  const notes: PartDataParsingNote[] = []
  const data = parsePartDataMarkdownV2(`${branch}\n## 九世\n朝玉 ，${children}\n## 十世\n${records}`, (note) => notes.push(note))
  normalizeFamilyData(data)
  return { data, notes }
}

describe('可信长幼顺序关联 — 保留原字与证据', () => {
  it('异字且四项依据唯一时关联，不改双方姓名或原文', () => {
    const { data, notes } = parse('生二子：太琼、太璘。', '太琼 朝玉长子。\n太琳 朝玉次子。')
    const child = data.members.find((member) => member.name === '太琳')!
    const claim = data.childClaims[1]
    expect(claim).toMatchObject({ claimedName: '太璘', status: 'matched', resolvedMemberId: child.id, ordinalIndex: 2 })
    expect(child).toMatchObject({ name: '太琳', parentId: data.members[0].id })
    expect(child.rawNotes).toBe('太琳 朝玉次子。')
    expect(claim.rawText).toContain('太璘')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ lineNumber: 3, parentName: '朝玉' })
    expect(notes[0].reason).toContain('“太璘” → “太琳”')
    expect(data.aliases).toEqual([])
  })

  it('父名完整但未写长次时，只有同父子女记录完整才能按原文顺序关联', () => {
    const { data } = parse('生二子：太璘、太球。', '太琳 朝玉之子。\n太求 朝玉之子。')
    expect(data.childClaims.map((claim) => claim.resolvedMemberId)).toEqual(data.members.slice(1).map((member) => member.id))
  })

  it('缺少部分成员正文时仍可使用明确的排行，不靠邻近位置猜测', () => {
    const { data } = parse('生三子：太琼、太璘、太球。', '太琳 朝玉次子。')
    expect(data.childClaims.map((claim) => claim.status)).toEqual(['missing', 'matched', 'missing'])
  })

  it('支持空格、第四子和十一子，不把数字吞入父名', () => {
    const names = ['甲甲', '乙乙', '丙丙', '丁丁', '戊戊', '己己', '庚庚', '辛辛', '壬壬', '癸癸', '子子']
    const { data } = parse(`生十一子：${names.join('、')}。`, '丁异 朝玉 第四子。\n子异 朝玉十一子。')
    expect(data.childClaims[3].resolvedMemberId).toBe(data.members[1].id)
    expect(data.childClaims[10].resolvedMemberId).toBe(data.members[2].id)
  })

  it('可用父名和排行消歧同名，但不改其他候选', () => {
    const { data } = parse('生子：贤敬。', '贤敬 朝玉长子。\n贤敬 元卿长子。')
    expect(data.childClaims[0]).toMatchObject({ status: 'matched', resolvedMemberId: data.members[1].id })
    expect(data.members[2].parentId).toBeNull()
  })

  it('男女排行分别核对，声明仍保留原始先后顺序', () => {
    const { data } = parse('生女：春兰，生子：太璘。', '太琳 朝玉长子。\n春兰 朝玉长女。')
    expect(data.childClaims.map((claim) => [claim.claimedName, claim.ordinalIndex])).toEqual([['春兰', 1], ['太璘', 2]])
    expect(data.childClaims[1].resolvedMemberId).toBe(data.members[1].id)
  })

  it('出继匹配保留过继语义，也保留原本明确记载的生父', () => {
    const { data } = parse('生子：太璘（出继）。', '太琳 朝玉长子。')
    expect(data.childClaims[0]).toMatchObject({ status: 'matched', isAdoptive: true, resolvedMemberId: data.members[1].id })
    expect(data.members[1].parentId).toBe(data.members[0].id)
    expect(data.relations[0]).toMatchObject({ type: 'father', fromMemberId: data.members[1].id, toMemberId: data.members[0].id })
  })

  it('承继声明不占亲生子女排行，出继子女仍在生父排行内', () => {
    const { data } = parse('继子：太琼，生二子：太璘（出继）、太球。', '太琼 朝玉继子。\n太琳 朝玉长子。\n太求 朝玉次子。')
    expect(data.childClaims.map((claim) => claim.resolvedMemberId)).toEqual(data.members.slice(1).map((member) => member.id))
    expect(data.members.slice(1).map((member) => member.parentId)).toEqual([null, data.members[0].id, data.members[0].id])
    expect(data.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'adoptive-parent', fromMemberId: data.members[1].id }),
      expect.objectContaining({ type: 'father', fromMemberId: data.members[2].id }),
    ]))
  })

  it.each(['继', '嗣', '养'])('仅用方向一致且完整的%s子正文组按顺序关联', (label) => {
    const { data } = parse(`生子：太琼，${label}子：太璘、太球。`, `太琼 朝玉长子。\n太琳 朝玉${label}子。\n太求 朝玉${label}子。`)
    expect(data.childClaims.map((claim) => claim.resolvedMemberId)).toEqual(data.members.slice(1).map((member) => member.id))
    expect(data.members.slice(2).every((member) => member.parentId === null)).toBe(true)
    expect(data.relations.filter((relation) => relation.type === 'adoptive-parent').map((relation) => relation.fromMemberId)).toEqual(data.members.slice(2).map((member) => member.id))
  })

  it('预览是否订阅提示不影响实际导入结果', () => {
    const markdown = '# 分支\n## 九世\n朝玉 ，生子：太璘。\n## 十世\n太琳 朝玉之子。'
    const notes: PartDataParsingNote[] = []
    expect(parsePartDataMarkdownV2(markdown, (note) => notes.push(note))).toEqual(parsePartDataMarkdownV2(markdown))
    expect(notes).toHaveLength(1)
  })
})

describe('可信长幼顺序关联 — 证据不足或冲突不自动关联', () => {
  it('不把亲生次子的排行证据用于异名承继声明', () => {
    const { data } = parse('生子：太琼，继子：太璘。', '太琼 朝玉长子。\n太琳 朝玉次子。')
    expect(data.childClaims[1]).toMatchObject({ status: 'missing', resolvedMemberId: null })
    expect(data.members[2].parentId).toBeNull()
    expect(data.relations).toEqual([])
  })

  it('承继正文组不完整时不凭邻近顺序猜测异名身份', () => {
    const { data } = parse('继子：太璘、太球。', '太琳 朝玉继子。')
    expect(data.childClaims.every((claim) => claim.resolvedMemberId === null)).toBe(true)
    expect(data.relations).toEqual([])
  })

  it.each(['失考', '俱失考', '无后'])('开头无目标的“%s”保留空位并阻止后项误认长子', (status) => {
    const { data, notes } = parse(`生子：${status}、太璘。`, '太琳 朝玉长子。\n太琼 朝玉次子。')
    expect(data.childClaims).toHaveLength(1)
    expect(data.childClaims[0]).toMatchObject({ claimedName: '太璘', ordinalIndex: 2, status: 'missing', resolvedMemberId: null })
    expect(data.members.slice(1).every((member) => member.parentId === null)).toBe(true)
    expect(notes).toEqual([expect.objectContaining({ segment: status, reason: expect.stringContaining('没有可附注的子女') })])
  })

  it('有目标的状态仍附注前一人，不额外占用排行或禁用可靠关联', () => {
    const { data, notes } = parse('生子：太琼、失考、太璘。', '太琼 朝玉长子。\n太琳 朝玉次子。')
    expect(data.childClaims[0].statusFlags).toContain('lost-record')
    expect(data.childClaims[1]).toMatchObject({ ordinalIndex: 2, status: 'matched', resolvedMemberId: data.members[2].id })
    expect(notes).toHaveLength(1)
    expect(notes[0].reason).toContain('长幼排行唯一关联')
  })

  it.each([
    ['父名不同', '太琳 元卿次子。'],
    ['没有父名记载', '太琳 ，本人。'],
    ['没有可确认的排行且记录不完整', '太琳 朝玉之子。'],
    ['明确排行不符', '太琳 朝玉三子。'],
    ['父名只出现在后文', '太琳 ，字朝玉次子。'],
    ['性别记载不符', '太琳 朝玉次女。'],
    ['世代不符', '## 十一世\n太琳 朝玉次子。'],
    ['分支不符', '# 其他分支\n太琳 朝玉次子。'],
    ['多个排行候选', '太琳 朝玉次子。\n太林 朝玉次子。'],
  ])('%s', (_label, records) => {
    const { data } = parse('生二子：太琼、太璘。', records)
    expect(data.childClaims[1].resolvedMemberId).toBeNull()
    expect(data.members.slice(1).every((member) => member.parentId === null)).toBe(true)
  })

  it('分支未知不把两个空值视作已确认的同分支', () => {
    const { data } = parse('生子：太璘。', '太琳 朝玉长子。', '')
    expect(data.childClaims[0].status).toBe('missing')
  })

  it('同代同分支有同名父亲时不猜是哪一支', () => {
    const { data } = parse('生子：太璘。\n朝玉 ，另一位同名父亲。', '太琳 朝玉长子。')
    expect(data.childClaims[0].status).toBe('missing')
  })

  it('缺字造成无法确认完整排行时不把后面的名字前移关联', () => {
    const { data, notes } = parse('生三子：太琼、太~、太球。', '太求 朝玉次子。')
    expect(data.childClaims.every((claim) => claim.resolvedMemberId === null)).toBe(true)
    expect(data.childClaims.map((claim) => claim.ordinalIndex)).toEqual([1, 3])
    expect(notes.some((note) => note.reason.includes('未能安全识别'))).toBe(true)
  })

  it('正文顺序与明确长次记载冲突时不自动关联异字', () => {
    const { data } = parse('生二子：太璘、太球。', '太求 朝玉次子。\n太琳 朝玉长子。')
    expect(data.childClaims.every((claim) => claim.resolvedMemberId === null)).toBe(true)
  })

  it('精确匹配优先，不把同一个成员又关联给另一个异字声明', () => {
    const { data, notes } = parse('生二子：太璘、太琳。', '太琳 朝玉长子。')
    expect(data.childClaims[0]).toMatchObject({ status: 'ambiguous', resolvedMemberId: null })
    expect(data.childClaims[1]).toMatchObject({ status: 'matched', resolvedMemberId: data.members[1].id })
    expect(notes[0].reason).toContain('被多条声明引用')
  })
})
