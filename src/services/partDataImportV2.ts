import { APP_SCHEMA_VERSION, type FamilyData, type KinshipRelation, type Member } from '../types/member'
import type { Spouse, SpouseRelation } from '../types/spouse'
import type { ChildClaim, ChildClaimStatusFlag, ChildClaimGender } from '../types/childClaim'

export interface PartDataImportReport {
  totalLines: number
  parsedMembers: number
  parsedSpouses: number
  parsedChildClaims: number
  isolatedMembers: Array<{ id: number; name: string; reason: string }>
  unmatchedClaims: Array<{ parentName: string; claimedName: string; gen: number }>
  unclaimedChildren: Array<{ memberId: number; name: string }>
  ambiguousAdoptions: Array<{ memberId: number; name: string; note: string }>
  contradictions: Array<{ memberId: number; description: string }>
  parsingNotes: PartDataParsingNote[]
}

export interface PartDataParsingNote {
  lineNumber: number
  parentId: number
  parentName: string
  segment: string
  reason: string
}

const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
}

export function parseChineseGenerationNumber(label: string): number {
  const cleaned = label.replace(/\s+/g, '').replace(/[世祖]+$/, '')
  if (cleaned.startsWith('廿')) {
    const tail = cleaned.slice(1)
    if (!tail) return 20
    return 20 + (CHINESE_NUM_MAP[tail] ?? 0)
  }
  if (cleaned.length === 1) return CHINESE_NUM_MAP[cleaned] ?? 0
  if (cleaned.startsWith('十')) {
    const tail = cleaned.slice(1)
    return 10 + (CHINESE_NUM_MAP[tail] ?? 0)
  }
  if (cleaned.endsWith('十')) {
    const head = cleaned.slice(0, -1)
    return (CHINESE_NUM_MAP[head] ?? 0) * 10
  }
  return 0
}

const STOP_WORDS = new Set([
  '无后', '失考', '往外', '幼夭', '止', '俱', '合葬', '分金',
  '生子', '生女', '墓', '坟', '山向', '公一脉', '出继', '出嫁',
  '出嗣', '嗣子', '继子', '葬东坑', '葬长汀', '无嗣', '无出',
])

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
  if (!token) return false
  if (STOP_WORDS.has(token)) return false
  if (token.length < 1 || token.length > 6) return false
  if (!/^[一-龥]+$/.test(token)) return false
  if (/世祖|世$/.test(token)) return false
  if (token.endsWith('氏') && token.length <= 2) return false
  if (/^[葬迁移徙出继嗣嫁归附公妣原]/.test(token)) return false
  return true
}

function extractSubjectName(line: string): string {
  const match = line.match(/^([一-龥]{1,6})(?=[\s，,。:：])/)
  if (!match?.[1]) return ''
  const raw = normalizeName(match[1])
  if (!isLikelyPersonName(raw)) return ''
  if (raw.endsWith('氏')) return ''
  return raw
}

// '配'/'妣'/'娶' are interchangeable primary-spouse markers (regional variants).
// '其他' falls through to prevOrder + 1 (treated as a subsequent spouse).
function inferSpouseOrder(label: SpouseRelation, prevOrder: number): number {
  if (label === '配' || label === '妣' || label === '娶') return 1
  if (label === '继配' || label === '继妣') return prevOrder + 1
  if (label === '三妣') return 3
  if (label === '四妣') return 4
  return prevOrder + 1
}

function extractAliases(text: string): string[] {
  const aliases: string[] = []
  const ngMatch = text.match(/([一二三四五六七八九十][娘姑姐妹])/g)
  if (ngMatch) aliases.push(...ngMatch)
  return aliases
}

function extractSpouses(line: string, husbandId: number, nextSpouseId: () => number, now: string): Spouse[] {
  const spouses: Spouse[] = []
  let prevOrder = 0
  // [一-龥]{1,8} stops at any non-CJK character (punctuation/space/digits).
  // Real data separates multiple spouses with fullwidth commas，so greedy match is safe.
  // If input lacks separators, nameToken can absorb the next relation keyword.
  const re = /(继配|三妣|四妣|继妣|配|妣|娶)\s*([一-龥]{1,8})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const relationLabel = m[1] as SpouseRelation
    const nameToken = m[2]
    let surname = ''
    let fullName: string | null = null
    let aliases: string[] = []
    const yiIdx = nameToken.indexOf('氏')
    if (yiIdx >= 0) {
      surname = nameToken.slice(0, yiIdx)
    } else {
      surname = nameToken.charAt(0)
      if (nameToken.length > 1) {
        fullName = nameToken
        // Extract aliases from the name portion after the surname character
        aliases = extractAliases(nameToken.slice(1))
      }
    }
    const tail = line.slice(m.index + m[0].length, m.index + m[0].length + 12)
    const tailAliases = extractAliases(tail)
    aliases = [...new Set([...aliases, ...tailAliases])]

    const order = inferSpouseOrder(relationLabel, prevOrder)
    prevOrder = order
    spouses.push({
      id: nextSpouseId(),
      husbandId,
      surname,
      fullName,
      aliases,
      relationLabel,
      order,
      birthDate: '', deathDate: '', burialPlace: '', biography: '',
      statusFlags: [],
      rawText: line,
      createdAt: now,
      updatedAt: now,
    })
  }
  return spouses
}

// ChildClaim parsing helpers

interface ChildClaimRaw {
  name: string
  isAdoptive: boolean
  statusFlags: ChildClaimStatusFlag[]
  gender: ChildClaimGender
  collective: boolean
  outAdoptedToHint: string
}

const CHILD_NUMERALS = '〇零一二两三四五六七八九十廿壹贰叁肆伍陆柒捌玖拾\\d'
const CHILD_HEAD = new RegExp(
  `生(?:([${CHILD_NUMERALS}]+)[个個]?)?([子女])([${CHILD_NUMERALS}]+)?\\s*([:：])?`
  + `|((?:继|嗣|养)[子女])\\s*([:：])?`
  + `|女(?:[${CHILD_NUMERALS}]+女)?\\s*[:：]`,
)
const CHILD_NOTE = /俱|无后|无嗣|无出|未婚|未娶|失考|早殁|早夭|幼夭|幼殁|俱卒|出嫁|出继|出嗣|继出|往外|止|嫁|适|住|往|徙|葬|字|号/
const CHILD_STATUS = /^(?:俱)?(?:止|无后|无嗣|无出|未婚|未娶|失考|早殁|早夭|幼夭|幼殁|卒|殁|往外|出嫁|嫁|出继|出嗣|继出)/

function childCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const financial: Record<string, string> = { 壹: '一', 贰: '二', 叁: '三', 肆: '四', 伍: '五', 陆: '六', 柒: '七', 捌: '八', 玖: '九', 拾: '十', 两: '二', 廿: '二十' }
  const value = raw.replace(/[壹贰叁肆伍陆柒捌玖拾两廿]/g, (char) => financial[char])
  if (/^\d+$/.test(value)) return Number(value)
  const parts = value.split('十')
  if (parts.length === 2) return (parts[0] ? CHINESE_NUM_MAP[parts[0]] ?? 0 : 1) * 10 + (CHINESE_NUM_MAP[parts[1]] ?? 0)
  return CHINESE_NUM_MAP[value]
}

function childStatus(text: string, gender: ChildClaimGender): ChildClaimRaw {
  const statusFlags: ChildClaimStatusFlag[] = []
  if (/止|无后|无嗣|无出/.test(text)) statusFlags.push('no-grandchildren')
  if (/未婚|未娶/.test(text)) statusFlags.push('unmarried')
  if (/早殁|早夭|幼夭|幼殁|失考/.test(text)) statusFlags.push('lost-record')
  if (/往外|出嫁|嫁/.test(text)) statusFlags.push('out-married')
  return {
    name: '', gender, statusFlags, collective: text.trim().startsWith('俱'),
    isAdoptive: /出继|出嗣|继出/.test(text),
    outAdoptedToHint: text.match(/(?:出继|出嗣|继出)(?:与|往|至)?(.+?)(?:承嗣|$)/)?.[1]?.trim() ?? '',
  }
}

function isChildAnnotation(text: string): boolean {
  return /^(?:往|住|迁|移|徙|嗣[徙往迁移]|葬|合葬|妣|继妣|配|继配|娶|字|号|名|讳|同兄|同弟|同公|与兄|与弟|与夫|夫妇|适|出家|俱)/.test(text)
    || /分金|山[一-龥]*向|合葬/.test(text)
}

function parseChildToken(
  token: string, gender: ChildClaimGender, note: (segment: string, reason: string) => void,
  reserveOrdinal: () => void,
): ChildClaimRaw | null {
  let text = token.trim()
  const nested = text.match(/生(?:[一二三四五六七八九十\d]+)?[子女]/)
  if (nested && nested.index !== undefined && nested.index > 0) {
    note(text, '包含孙辈或嵌套生育记载，仅提取前面的子女姓名，不自动跨代建立关系')
    text = text.slice(0, nested.index)
  }
  if (!text) return null
  const parentheses = [...text.matchAll(/[（(]([^（）()]*)[）)]/g)].map((match) => match[1])
  text = text.replace(/[（(][^（）()]*[）)]/g, '').trim()
  const suffix = text.search(CHILD_NOTE)
  const name = (suffix < 0 ? text : text.slice(0, suffix)).trim()
  const annotation = [suffix < 0 ? '' : text.slice(suffix), ...parentheses].join(' ')
  if (!/^[一-龥]{1,6}$/.test(name) || STOP_WORDS.has(name)) {
    if (text) {
      reserveOrdinal()
      note(token, '未能安全识别子女姓名，原文保留且不前移后续排行，需人工核对')
    }
    return null
  }
  return { ...childStatus(annotation, gender), name }
}

function childSegments(line: string): Array<{ text: string; separator: string }> {
  const segments: Array<{ text: string; separator: string }> = []
  let text = ''
  let parentheses = 0
  for (const char of line) {
    if (char === '(' || char === '（') parentheses++
    if (char === ')' || char === '）') parentheses = Math.max(0, parentheses - 1)
    if (!parentheses && /[、，,。；;]/.test(char)) {
      segments.push({ text: text.trim(), separator: char })
      text = ''
    } else text += char
  }
  if (text.trim()) segments.push({ text: text.trim(), separator: '' })
  return segments
}

function extractChildClaims(
  line: string, parentId: number, nextId: () => number,
  note: (segment: string, reason: string) => void,
  knownNames: ReadonlySet<string>,
  incomingClaims: Set<number>,
): ChildClaim[] {
  const claims: ChildClaim[] = []
  let nextOrdinal = 1
  interface Block {
    gender: ChildClaimGender
    adoptive: boolean
    count: number | undefined
    claims: ChildClaim[]
    source: string
    awaitingNames: boolean
    spouseNote: boolean
  }
  let block: Block | null = null
  let nestedList = false
  function finish() {
    if (block?.count !== undefined && block.count !== block.claims.length) {
      note(block.source, `声明 ${block.count} 位子女，安全识别 ${block.claims.length} 位；可能有无名、缺字或嵌套记载，请核对原文`)
    }
    block = null
  }
  function applyStatus(raw: ChildClaimRaw, targets: ChildClaim[]) {
    for (const claim of targets) {
      claim.statusFlags = [...new Set([...claim.statusFlags, ...raw.statusFlags])]
      if (raw.isAdoptive) claim.isAdoptive = true
      if (raw.outAdoptedToHint) claim.outAdoptedToHint = raw.outAdoptedToHint
    }
  }
  function append(text: string) {
    if (!block || !text) return
    block.awaitingNames = false
    const last = block.claims.at(-1)
    if (CHILD_STATUS.test(text)) {
      const raw = childStatus(text, block.gender)
      if (!last) {
        nextOrdinal++
        note(text, '状态记载没有可附注的子女，保留排行空位且不启用排行推定，需人工核对')
        return
      }
      applyStatus(raw, raw.collective ? block.claims : [last])
      return
    }
    if (isChildAnnotation(text) && !knownNames.has(text)) {
      if (/^(?:妣|继妣|配|继配|娶)/.test(text)) block.spouseNote = true
      return
    }
    const raw = parseChildToken(text, block.gender, note, () => { nextOrdinal++ })
    if (!raw) return
    const claim: ChildClaim = {
      id: nextId(), parentId, claimedName: raw.name, ordinalIndex: nextOrdinal++,
      gender: raw.gender, isAdoptive: block.adoptive || raw.isAdoptive,
      outAdoptedToHint: raw.outAdoptedToHint, resolvedMemberId: null,
      status: 'missing', statusFlags: raw.statusFlags, rawText: line,
    }
    claims.push(claim)
    if (block.adoptive) incomingClaims.add(claim.id)
    block.claims.push(claim)
    block.awaitingNames = false
    if (raw.collective) applyStatus(raw, block.claims)
  }
  for (const segment of childSegments(line)) {
    const head = CHILD_HEAD.exec(segment.text)
    if (head) {
      const prefix = segment.text.slice(0, head.index).trim()
      const tail = segment.text.slice(head.index + head[0].length).trim()
      const gender: ChildClaimGender = (head[2] ?? head[5]?.slice(-1) ?? '女') === '女' ? '女' : '男'
      const count = childCount(head[1] ?? head[3])
      const colon = head[4] || head[6] || head[0].includes('：') || head[0].includes(':')
      if (block && prefix && !prefix.includes('氏') && !isChildAnnotation(prefix)) {
        append(segment.text)
      } else if (block && !prefix && !head[5] && block.gender === gender && block.claims.length
        && !block.spouseNote && (!colon || (block.count !== undefined && block.claims.length >= block.count))) {
        note(segment.text, '前段已记子女，此处可能是孙辈记载，未自动挂到当前主体名下')
        if (colon) { finish(); nestedList = true }
      } else if (tail || count !== undefined || colon) {
        finish()
        nestedList = false
        block = { gender, adoptive: !!head[5], count, claims: [], source: segment.text, awaitingNames: !tail, spouseNote: false }
        append(tail)
      }
    } else if (!nestedList) append(segment.text)
    if (/[。；;]/.test(segment.separator)) {
      if (!block?.awaitingNames || segment.separator !== '。') finish()
      nestedList = false
    }
  }
  finish()
  return claims
}

// Two-pass resolution

interface ParentHint {
  ordinal: number | undefined
  gender: ChildClaimGender
}

function parentHint(member: Member, parentName: string): ParentHint | null {
  const intro = member.biography?.slice(member.name.length).trim() ?? ''
  if (!intro.startsWith(parentName)) return null
  const match = intro.slice(parentName.length).trim().match(
    /^(?:第)?(长|次|之|[一二三四五六七八九十\d]+)\s*([子女])(?=[，,。；;\s(（]|$)/,
  )
  if (!match) return null
  return {
    ordinal: match[1] === '长' ? 1 : match[1] === '次' ? 2 : childCount(match[1]),
    gender: match[2] === '女' ? '女' : '男',
  }
}

function incomingParentHint(member: Member, parent: Member): ChildClaimGender | null {
  const intro = member.biography?.slice(member.name.length).trim() ?? ''
  if (!intro.startsWith(parent.name)) return null
  const match = intro.slice(parent.name.length).trim().match(/^(?:继|嗣|养)([子女])(?=[，,。；;\s(（]|$)/)
  return match ? match[1] === '女' ? '女' : '男' : null
}

function consolidateAdoptionRecords(state: ParserState, unsafeOrderParents: Set<number>, notes: PartDataParsingNote[]): void {
  const groups = new Map<string, Member[]>()
  for (const member of state.members) {
    const key = JSON.stringify([member.lineageBranch, member.generationNumber, member.name])
    const group = groups.get(key) ?? []
    group.push(member)
    groups.set(key, group)
  }
  for (const records of groups.values()) {
    if (records.length !== 2) continue
    const child = records[0]
    if (!child.lineageBranch || !child.generationNumber) continue
    const generation = child.generationNumber
    const claims = state.childClaims.filter((claim) => claim.claimedName === child.name
      && state.members.some((parent) => parent.id === claim.parentId
        && parent.lineageBranch === child.lineageBranch && parent.generationNumber === generation - 1))
    const outgoing = claims.filter((claim) => claim.isAdoptive && !state.incomingClaims.has(claim.id))
    const incoming = claims.filter((claim) => state.incomingClaims.has(claim.id))
    if (claims.length !== 2 || outgoing.length !== 1 || incoming.length !== 1 || outgoing[0].gender !== incoming[0].gender) continue
    const birthParent = state.members.find((member) => member.id === outgoing[0].parentId)!
    const adoptiveParent = state.members.find((member) => member.id === incoming[0].parentId)!
    if (birthParent.id === adoptiveParent.id) continue
    const commonParents = state.members.filter((parent) => parent.lineageBranch === child.lineageBranch
      && parent.generationNumber === generation - 2
      && parentHint(birthParent, parent.name) && parentHint(adoptiveParent, parent.name))
    if (commonParents.length !== 1) continue
    const biological = records.filter((member) => parentHint(member, birthParent.name)?.gender === outgoing[0].gender)
    const adopted = records.filter((member) => incomingParentHint(member, adoptiveParent) === incoming[0].gender)
    if (biological.length !== 1 || adopted.length !== 1 || biological[0].id === adopted[0].id) continue
    const canonical = biological[0]
    const duplicate = adopted[0]
    // Two separate child lists need manual reconciliation before their order can be trusted.
    if (state.childClaims.some((claim) => claim.parentId === canonical.id)
      && state.childClaims.some((claim) => claim.parentId === duplicate.id)) continue
    const original = [canonical.biography, duplicate.biography].filter(Boolean).join('\n')
    canonical.biography = original
    canonical.rawNotes = [canonical.rawNotes, duplicate.rawNotes].filter(Boolean).join('\n')
    for (const spouse of state.spouses) if (spouse.husbandId === duplicate.id) spouse.husbandId = canonical.id
    for (const claim of state.childClaims) if (claim.parentId === duplicate.id) claim.parentId = canonical.id
    for (const note of notes) if (note.parentId === duplicate.id) note.parentId = canonical.id
    if (unsafeOrderParents.has(duplicate.id)) unsafeOrderParents.add(canonical.id)
    state.members = state.members.filter((member) => member.id !== duplicate.id)
    notes.push({
      lineNumber: state.memberLines.get(canonical.id)!, parentId: canonical.id, parentName: canonical.name,
      segment: original,
      reason: `同分支同代的生父“${birthParent.name}”出继、兄弟“${adoptiveParent.name}”承继及双处正文对应，整理为同一人物 #${canonical.id}；保留两处原文、生父和承继父，不按同名一律合并`,
    })
  }
}

function runTwoPassResolution(
  state: ParserState, unsafeOrderParents: Set<number>, onNote?: (note: PartDataParsingNote) => void,
): void {
  const minGen = state.members.reduce(
    (m, x) => Math.min(m, x.generationNumber ?? Infinity),
    Infinity,
  )

  const membersById = new Map(state.members.map((member) => [member.id, member]))
  for (const claim of state.childClaims) {
    const parent = membersById.get(claim.parentId)
    if (!parent) continue
    const expectedGen = (parent.generationNumber ?? 0) + 1
    const candidates = state.members.filter(
      (m) =>
        m.name === claim.claimedName &&
        m.generationNumber === expectedGen &&
        m.lineageBranch === parent.lineageBranch,
    )
    if (candidates.length === 1) {
      claim.status = 'matched'
      claim.resolvedMemberId = candidates[0].id
    } else if (candidates.length > 1) {
      claim.status = 'ambiguous'
    } else {
      claim.status = 'missing'
    }
  }

  const proposals = new Map<number, ChildClaim[]>()
  for (const claim of state.childClaims.filter((item) => item.status !== 'matched')) {
    const parent = membersById.get(claim.parentId)
    if (!parent?.lineageBranch || !parent.generationNumber || unsafeOrderParents.has(parent.id)) continue
    const sameParents = state.members.filter((member) => member.name === parent.name
      && member.lineageBranch === parent.lineageBranch && member.generationNumber === parent.generationNumber)
    if (sameParents.length !== 1) continue
    const incoming = state.incomingClaims.has(claim.id)
    const siblings = state.childClaims.filter((item) => item.parentId === parent.id && item.gender === claim.gender
      && state.incomingClaims.has(item.id) === incoming)
    const ordinal = siblings.indexOf(claim) + 1
    const expectedGen = parent.generationNumber + 1
    const recordedSiblings = state.members.flatMap((member) => {
      if (member.generationNumber !== expectedGen || member.lineageBranch !== parent.lineageBranch) return []
      const hint: ParentHint | null = incoming
        ? incomingParentHint(member, parent) === claim.gender ? { ordinal: undefined, gender: claim.gender } : null
        : parentHint(member, parent.name)
      return hint?.gender === claim.gender ? [{ member, hint }] : []
    })
    const completeOrder = recordedSiblings.length === siblings.length
    if (completeOrder && recordedSiblings.some(({ hint }, index) => hint.ordinal !== undefined && hint.ordinal !== index + 1)) continue
    const ranked = recordedSiblings.filter(({ member, hint }, index) =>
      (hint.ordinal ?? (completeOrder ? index + 1 : undefined)) === ordinal
      && (claim.status !== 'ambiguous' || member.name === claim.claimedName))
    if (ranked.length === 1) {
      const memberId = ranked[0].member.id
      const group = proposals.get(memberId) ?? []
      group.push(claim)
      proposals.set(memberId, group)
    }
  }

  for (const [memberId, claims] of proposals) {
    const member = membersById.get(memberId)!
    const occupied = state.childClaims.some((claim) => claim.resolvedMemberId === memberId)
    for (const claim of claims) {
      const parent = membersById.get(claim.parentId)!
      const conflict = occupied || claims.length > 1
      if (conflict) claim.status = 'ambiguous'
      else {
        claim.status = 'matched'
        claim.resolvedMemberId = memberId
      }
      onNote?.({
        lineNumber: state.memberLines.get(parent.id)!,
        parentId: parent.id, parentName: parent.name, segment: claim.rawText,
        reason: conflict
          ? `排行候选“${member.name}” #${memberId} 被多条声明引用，未自动关联“${claim.claimedName}”，需人工核对`
          : `按同分支、下一世代、父亲记载和长幼排行唯一关联：“${claim.claimedName}” → “${member.name}” #${memberId}；双方原名保留，请核对`,
      })
    }
  }
  const biologicalClaims = new Map<number, ChildClaim[]>()
  for (const claim of state.childClaims) {
    if (claim.resolvedMemberId === null || state.incomingClaims.has(claim.id)) continue
    const group = biologicalClaims.get(claim.resolvedMemberId) ?? []
    group.push(claim)
    biologicalClaims.set(claim.resolvedMemberId, group)
  }
  for (const [memberId, claims] of biologicalClaims) {
    if (new Set(claims.map((claim) => claim.parentId)).size < 2) continue
    const member = membersById.get(memberId)!
    member.uncertaintyFlags = [...(member.uncertaintyFlags ?? []), 'conflicting']
    for (const claim of claims) {
      claim.status = 'ambiguous'
      claim.resolvedMemberId = null
      const parent = membersById.get(claim.parentId)!
      onNote?.({
        lineNumber: state.memberLines.get(parent.id)!, parentId: parent.id, parentName: parent.name, segment: claim.rawText,
        reason: `“${member.name}”被不同主体声明为亲生子女，缺少可靠的出继方向依据；未选择生父，需人工核对`,
      })
    }
  }
  for (const claim of state.childClaims) {
    const member = claim.resolvedMemberId === null ? undefined : membersById.get(claim.resolvedMemberId)
    if (!member) continue
    const incoming = state.incomingClaims.has(claim.id)
    if (member.parentId === null && !incoming) member.parentId = claim.parentId
    if (claim.isAdoptive) {
      state.relations.push({
        id: state.relations.length + 1, fromMemberId: member.id, toMemberId: claim.parentId,
        type: incoming ? 'adoptive-parent' : 'father', status: 'active', temporalId: null,
        note: incoming ? '谱载继/嗣/养子女：承继父，不覆盖生父' : '谱载生子女后出继：保留生父',
        rawText: claim.rawText,
      })
    }
  }

  for (const member of state.members) {
    const hasAdoptiveParent = state.relations.some((relation) => relation.fromMemberId === member.id && relation.type === 'adoptive-parent')
    if (member.parentId === null && !hasAdoptiveParent && (member.generationNumber ?? 0) > minGen) {
      member.uncertaintyFlags = [...(member.uncertaintyFlags ?? []), 'missing']
    }
  }
}

interface ParserState {
  branchLabel: string
  generationLabel: string
  generationNumber: number
  members: Member[]
  spouses: Spouse[]
  childClaims: ChildClaim[]
  incomingClaims: Set<number>
  relations: KinshipRelation[]
  nextId: number
  nextSpouseId: number
  nextChildClaimId: number
  lastMember: Member | null
  memberLines: Map<number, number>
}

export function parsePartDataMarkdownV2(raw: string, onNote?: (note: PartDataParsingNote) => void): FamilyData {
  const state: ParserState = {
    branchLabel: '',
    generationLabel: '',
    generationNumber: 0,
    members: [],
    spouses: [],
    childClaims: [],
    incomingClaims: new Set(),
    relations: [],
    nextId: 1,
    nextSpouseId: 1,
    nextChildClaimId: 1,
    lastMember: null,
    memberLines: new Map(),
  }

  // Keep raw lines (don't pre-filter) so we can handle fence blocks and descriptive paragraphs.
  const rawLines = raw.split(/\r?\n/)
  const now = new Date().toISOString()
  const unsafeOrderParents = new Set<number>()
  const notes: PartDataParsingNote[] = []

  let inFence = false
  const fenceBuffer: string[] = []

  for (const [lineIndex, rawLine] of rawLines.entries()) {
    const line = normalizeLine(rawLine)

    // Fence block detection (```text ... ```)
    if (line.startsWith('```')) {
      if (!inFence) {
        inFence = true
        fenceBuffer.length = 0
      } else {
        // End of fence — flush buffer to lastMember.rawNotes
        inFence = false
        if (fenceBuffer.length > 0 && state.lastMember) {
          const fenceContent = fenceBuffer.join('\n')
          state.lastMember.rawNotes = (state.lastMember.rawNotes ?? '') + '\n[公共备注] ' + fenceContent
        }
        fenceBuffer.length = 0
      }
      continue
    }

    if (inFence) {
      fenceBuffer.push(line)
      continue
    }

    // Skip empty lines
    if (line.length === 0) continue

    const h1 = line.match(/^#\s+(.+)$/)
    if (h1?.[1]) { state.branchLabel = h1[1].trim(); continue }

    const h2 = line.match(/^##\s+(.+)$/)
    if (h2?.[1]) {
      state.generationLabel = h2[1].trim()
      state.generationNumber = parseChineseGenerationNumber(state.generationLabel)
      continue
    }

    const subject = extractSubjectName(line)
    if (!subject) {
      // Non-subject line: if long enough and not a heading, append to lastMember.rawNotes
      if (line.length >= 5 && !line.startsWith('#') && state.lastMember) {
        state.lastMember.rawNotes = (state.lastMember.rawNotes ?? '') + '\n[公共备注] ' + line
      }
      continue
    }

    const member: Member = {
      id: state.nextId++,
      name: subject,
      parentId: null,
      gender: '男',
      generationLabelRaw: state.generationLabel,
      generationNumber: state.generationNumber,
      lineageBranch: state.branchLabel,
      biography: line,
      rawNotes: line,
      uncertaintyFlags: [],
    }
    state.members.push(member)
    state.memberLines.set(member.id, lineIndex + 1)
    state.lastMember = member
    const newSpouses = extractSpouses(line, member.id, () => state.nextSpouseId++, now)
    state.spouses.push(...newSpouses)
  }

  const knownNames = new Set(state.members.map((member) => member.name))
  for (const member of state.members) {
    const newClaims = extractChildClaims(member.biography ?? '', member.id, () => state.nextChildClaimId++, (segment, reason) => {
      unsafeOrderParents.add(member.id)
      notes.push({ lineNumber: state.memberLines.get(member.id)!, parentId: member.id, parentName: member.name, segment, reason })
    }, knownNames, state.incomingClaims)
    state.childClaims.push(...newClaims)
  }

  consolidateAdoptionRecords(state, unsafeOrderParents, notes)
  runTwoPassResolution(state, unsafeOrderParents, (note) => notes.push(note))
  for (const note of notes) onNote?.(note)

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: state.members,
    tracks: [], events: [], aliases: [], relations: state.relations,
    temporals: [], burials: [],
    spouses: state.spouses,
    childClaims: state.childClaims,
    nextId: state.nextId,
    nextTrackId: 1, nextEventId: 1, nextAliasId: 1,
    nextRelationId: state.relations.length + 1, nextTemporalId: 1, nextBurialId: 1,
    nextSpouseId: state.nextSpouseId,
    nextChildClaimId: state.nextChildClaimId,
  }
}
