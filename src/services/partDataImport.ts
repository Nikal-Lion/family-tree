import { APP_SCHEMA_VERSION, type FamilyData, type Member, type NameAlias, type TemporalExpression, type BurialRecord } from '../types/member'

const STOP_WORDS = new Set([
  '无后',
  '失考',
  '往外',
  '幼夭',
  '止',
  '俱',
  '合葬',
  '分金',
  '生子',
  '生女',
  '墓',
  '坟',
  '山向',
  '公一脉',
])

type Gender = '男' | '女'

interface BuilderState {
  branchLabel: string
  generationLabel: string
  members: Member[]
  aliases: NameAlias[]
  temporals: TemporalExpression[]
  burials: BurialRecord[]
  nextId: number
  nextAliasId: number
  nextTemporalId: number
  nextBurialId: number
  memberByScopedName: Map<string, number>
  temporalDedup: Set<string>
  burialDedup: Set<string>
}

function normalizeLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function normalizeName(raw: string): string {
  return raw
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[：:，,。；;、\s]/g, '')
    .trim()
}

function isLikelyPersonName(token: string): boolean {
  if (!token) {
    return false
  }
  if (STOP_WORDS.has(token)) {
    return false
  }
  if (token.length < 2 || token.length > 6) {
    return false
  }
  if (!/^[\u4e00-\u9fa5]+$/.test(token)) {
    return false
  }
  if (/世祖|世$/.test(token)) {
    return false
  }
  if (token.endsWith('氏') && token.length <= 2) {
    return false
  }
  if (/无后|失考|幼夭|分金|合葬|山向|往外/.test(token)) {
    return false
  }
  return true
}

function buildMemberScopeKey(name: string, generationLabel: string): string {
  return `${name}|${generationLabel || '未知世代'}`
}

function createMember(state: BuilderState, name: string, gender: Gender, sourceLine: string): Member {
  const member: Member = {
    id: state.nextId,
    name,
    parentId: null,
    gender,
    spouseIds: [],
    birthDate: '',
    photoUrl: '',
    biography: sourceLine,
    generationLabelRaw: state.generationLabel,
    lineageBranch: state.branchLabel,
    rawNotes: sourceLine,
    uncertaintyFlags: ['unverified'],
  }

  state.nextId += 1
  state.members.push(member)
  return member
}

function findMemberById(state: BuilderState, id: number): Member | undefined {
  return state.members.find((member) => member.id === id)
}

function getOrCreateMember(
  state: BuilderState,
  name: string,
  options: { gender?: Gender; generationLabel?: string; sourceLine: string },
): Member {
  const normalizedName = normalizeName(name)
  const generationLabel = options.generationLabel ?? state.generationLabel
  const key = buildMemberScopeKey(normalizedName, generationLabel)
  const existingByScope = state.memberByScopedName.get(key)
  if (typeof existingByScope === 'number') {
    const existing = findMemberById(state, existingByScope)
    if (existing) {
      if (existing.rawNotes && !existing.rawNotes.includes(options.sourceLine)) {
        existing.rawNotes = `${existing.rawNotes}\n${options.sourceLine}`
      }
      return existing
    }
  }

  const existingByName = state.members.find(
    (member) => member.name === normalizedName && member.generationLabelRaw === generationLabel,
  )
  if (existingByName) {
    state.memberByScopedName.set(key, existingByName.id)
    if (existingByName.rawNotes && !existingByName.rawNotes.includes(options.sourceLine)) {
      existingByName.rawNotes = `${existingByName.rawNotes}\n${options.sourceLine}`
    }
    return existingByName
  }

  const created = createMember(state, normalizedName, options.gender ?? '男', options.sourceLine)
  created.generationLabelRaw = generationLabel
  state.memberByScopedName.set(key, created.id)
  return created
}

function appendSpouse(member: Member, spouseId: number): void {
  if (spouseId === member.id) {
    return
  }
  if (!member.spouseIds.includes(spouseId)) {
    member.spouseIds.push(spouseId)
  }
}

function appendAlias(state: BuilderState, memberId: number, name: string, type: NameAlias['type'], rawText: string): void {
  const normalized = normalizeName(name)
  if (!normalized) {
    return
  }
  const duplicated = state.aliases.some(
    (alias) => alias.memberId === memberId && alias.name === normalized && alias.type === type,
  )
  if (duplicated) {
    return
  }
  state.aliases.push({
    id: state.nextAliasId,
    memberId,
    name: normalized,
    type,
    isPreferred: false,
    note: '由文稿自动提取',
    rawText,
  })
  state.nextAliasId += 1
}

function appendTemporal(state: BuilderState, memberId: number, label: string, rawText: string): void {
  const dedupKey = `${memberId}|${label}|${rawText}`
  if (state.temporalDedup.has(dedupKey)) {
    return
  }
  state.temporalDedup.add(dedupKey)
  state.temporals.push({
    id: state.nextTemporalId,
    memberId,
    label,
    rawText,
    calendarType: 'mixed',
    precision: 'unknown',
    confidence: 0.65,
  })
  state.nextTemporalId += 1
}

function appendBurial(state: BuilderState, memberId: number, placeRaw: string, rawText: string): void {
  const normalizedPlace = placeRaw.trim()
  if (!normalizedPlace) {
    return
  }
  const dedupKey = `${memberId}|${normalizedPlace}`
  if (state.burialDedup.has(dedupKey)) {
    return
  }
  state.burialDedup.add(dedupKey)

  const mountainDirectionMatch = normalizedPlace.match(/([子丑寅卯辰巳午未申酉戌亥][山向][^，,。；;]*)/)
  const fenjinMatch = normalizedPlace.match(/([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥][甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]分金)/)

  state.burials.push({
    id: state.nextBurialId,
    memberId,
    temporalId: null,
    placeRaw: normalizedPlace,
    mountainDirection: mountainDirectionMatch?.[1] ?? '',
    fenjin: fenjinMatch?.[1] ?? '',
    note: '由文稿自动提取',
    rawText,
  })
  state.nextBurialId += 1
}

function extractSubjectName(line: string): string {
  const match = line.match(/^([\u4e00-\u9fa5]{2,6})(?=[\s，,。:：])/)
  if (match?.[1]) {
    return normalizeName(match[1])
  }
  return ''
}

function inferSubjectGender(subjectName: string): Gender {
  if (subjectName.endsWith('氏')) {
    return '女'
  }
  return '男'
}

function extractFatherName(line: string, subjectName: string): string {
  const escapedSubject = subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const afterSubject = line.replace(new RegExp(`^${escapedSubject}[\\s，,。:：]*`), '')
  const directMatch = afterSubject.match(/^([\u4e00-\u9fa5]{2,6})(?:长子|次子|三子|四子|五子|六子|七子|八子|九子|十子|之子)/)
  if (directMatch?.[1]) {
    return normalizeName(directMatch[1])
  }

  const genericMatch = line.match(/([\u4e00-\u9fa5]{2,6})之子/)
  if (genericMatch?.[1]) {
    return normalizeName(genericMatch[1])
  }

  return ''
}

function extractSpouseNames(line: string): string[] {
  const names: string[] = []
  const pattern = /(?:继配|配|继妣|妣|娶)\s*([\u4e00-\u9fa5]{1,6}(?:氏)?)(?=[，,。；;\s]|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    const candidate = normalizeName(match[1])
    if (!candidate || candidate === '氏' || !isLikelyPersonName(candidate)) {
      continue
    }
    names.push(candidate)
  }
  return [...new Set(names)]
}

function extractChildrenNames(line: string): string[] {
  const result = new Set<string>()
  const childBlocks = [...line.matchAll(/生(?:[一二三四五六七八九十]?子)?[:：]\s*([^。；;]+)/g)]
  for (const block of childBlocks) {
    const raw = block[1] ?? ''
    const candidates = raw.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []
    for (const candidate of candidates) {
      const normalized = normalizeName(candidate)
      if (!isLikelyPersonName(normalized)) {
        continue
      }
      result.add(normalized)
    }
  }

  return [...result]
}

function extractAliases(line: string): Array<{ alias: string; type: NameAlias['type'] }> {
  const pairs: Array<{ alias: string; type: NameAlias['type'] }> = []
  const mapping: Array<{ regex: RegExp; type: NameAlias['type'] }> = [
    { regex: /讳([\u4e00-\u9fa5]{1,6})/g, type: 'taboo' },
    { regex: /名([\u4e00-\u9fa5]{1,6})/g, type: 'given' },
    { regex: /字([\u4e00-\u9fa5]{1,6})/g, type: 'courtesy' },
    { regex: /号([\u4e00-\u9fa5]{1,6})/g, type: 'art' },
  ]

  for (const item of mapping) {
    let match: RegExpExecArray | null
    while ((match = item.regex.exec(line)) !== null) {
      const alias = normalizeName(match[1])
      if (!isLikelyPersonName(alias)) {
        continue
      }
      pairs.push({ alias, type: item.type })
    }
  }

  return pairs
}

function extractTemporalSnippets(line: string): Array<{ label: string; raw: string }> {
  const snippets: Array<{ label: string; raw: string }> = []
  const temporalBlocks = line.match(/[^。；;]*?(?:生于|出生|生|殁|卒|终|去世)[^。；;]*/g) ?? []
  for (const raw of temporalBlocks) {
    const trimmed = raw.trim()
    if (!trimmed) {
      continue
    }
    const label = /殁|卒|终|去世/.test(trimmed) ? 'death' : 'birth'
    snippets.push({ label, raw: trimmed })
  }
  return snippets
}

function extractBurialPlaceSnippets(line: string): string[] {
  const results: string[] = []
  const matches = [...line.matchAll(/葬([^。；;]+)/g)]
  for (const match of matches) {
    const value = (match[1] ?? '').trim()
    if (!value) {
      continue
    }
    results.push(value)
  }
  return results
}

function finalizeMembers(state: BuilderState): void {
  const membersById = new Map<number, Member>()
  for (const member of state.members) {
    membersById.set(member.id, member)
  }

  for (const member of state.members) {
    member.spouseIds = [...new Set(member.spouseIds.filter((id) => id !== member.id && membersById.has(id)))].sort(
      (a, b) => a - b,
    )
    if (!member.lineageBranch) {
      member.lineageBranch = state.branchLabel
    }
    if (!member.generationLabelRaw) {
      member.generationLabelRaw = state.generationLabel
    }
  }

  for (const member of state.members) {
    for (const spouseId of member.spouseIds) {
      const spouse = membersById.get(spouseId)
      if (!spouse) {
        continue
      }
      if (!spouse.spouseIds.includes(member.id)) {
        spouse.spouseIds.push(member.id)
      }
    }
  }

  for (const member of state.members) {
    member.spouseIds = [...new Set(member.spouseIds)].sort((a, b) => a - b)
  }
}

function createEmptyState(): BuilderState {
  return {
    branchLabel: '',
    generationLabel: '',
    members: [],
    aliases: [],
    temporals: [],
    burials: [],
    nextId: 1,
    nextAliasId: 1,
    nextTemporalId: 1,
    nextBurialId: 1,
    memberByScopedName: new Map<string, number>(),
    temporalDedup: new Set<string>(),
    burialDedup: new Set<string>(),
  }
}

export function parsePartDataMarkdown(raw: string): FamilyData {
  const state = createEmptyState()
  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0)

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1?.[1]) {
      state.branchLabel = h1[1].trim()
      continue
    }

    const h2 = line.match(/^##\s+(.+)$/)
    if (h2?.[1]) {
      state.generationLabel = h2[1].trim()
      continue
    }

    if (/^[一二三四五六七八九十]+世祖$/.test(line)) {
      state.generationLabel = line
      continue
    }

    const subjectName = extractSubjectName(line)
    if (!isLikelyPersonName(subjectName)) {
      continue
    }

    const member = getOrCreateMember(state, subjectName, {
      gender: inferSubjectGender(subjectName),
      sourceLine: line,
    })

    if (!member.biography || member.biography.length < line.length) {
      member.biography = line
    }

    const fatherName = extractFatherName(line, subjectName)
    if (isLikelyPersonName(fatherName) && fatherName !== subjectName) {
      const father = getOrCreateMember(state, fatherName, {
        gender: '男',
        sourceLine: line,
      })
      if (member.id !== father.id) {
        member.parentId = father.id
      }
    }

    for (const spouseName of extractSpouseNames(line)) {
      const spouse = getOrCreateMember(state, spouseName, {
        gender: '女',
        sourceLine: line,
      })
      appendSpouse(member, spouse.id)
      appendSpouse(spouse, member.id)
    }

    for (const childName of extractChildrenNames(line)) {
      if (childName === subjectName) {
        continue
      }
      const child = getOrCreateMember(state, childName, {
        gender: '男',
        sourceLine: line,
      })
      if (child.id !== member.id && child.parentId === null) {
        child.parentId = member.id
      }
    }

    for (const alias of extractAliases(line)) {
      if (alias.alias === member.name) {
        continue
      }
      appendAlias(state, member.id, alias.alias, alias.type, line)
    }

    for (const temporal of extractTemporalSnippets(line)) {
      appendTemporal(state, member.id, temporal.label, temporal.raw)
    }

    for (const burialPlace of extractBurialPlaceSnippets(line)) {
      appendBurial(state, member.id, burialPlace, line)
    }
  }

  finalizeMembers(state)

  if (state.members.length === 0) {
    throw new Error('导入失败：未在 Markdown 中识别到有效成员')
  }

  const maxId = Math.max(...state.members.map((member) => member.id))
  const maxAliasId = state.aliases.length > 0 ? Math.max(...state.aliases.map((alias) => alias.id)) : 0
  const maxTemporalId = state.temporals.length > 0 ? Math.max(...state.temporals.map((temporal) => temporal.id)) : 0
  const maxBurialId = state.burials.length > 0 ? Math.max(...state.burials.map((burial) => burial.id)) : 0

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: state.members.sort((a, b) => a.id - b.id),
    tracks: [],
    events: [],
    aliases: state.aliases.sort((a, b) => a.id - b.id),
    relations: [],
    temporals: state.temporals.sort((a, b) => a.id - b.id),
    burials: state.burials.sort((a, b) => a.id - b.id),
    nextId: maxId + 1,
    nextTrackId: 1,
    nextEventId: 1,
    nextAliasId: maxAliasId + 1,
    nextRelationId: 1,
    nextTemporalId: maxTemporalId + 1,
    nextBurialId: maxBurialId + 1,
  }
}