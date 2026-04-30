import { APP_SCHEMA_VERSION, type FamilyData, type Member } from '../types/member'
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
}

function parseChildToken(token: string, gender: ChildClaimGender): ChildClaimRaw | null {
  let cleaned = token.trim()
  if (!cleaned) return null
  const flags: ChildClaimStatusFlag[] = []
  let isAdoptive = false
  if (/[（(](?:出继|出嗣)[）)]/.test(cleaned)) {
    isAdoptive = true
    cleaned = cleaned.replace(/[（(](?:出继|出嗣)[）)]/g, '')
  }
  if (/俱止|俱无后/.test(cleaned)) {
    flags.push('no-grandchildren')
    cleaned = cleaned.replace(/俱止|俱无后/g, '')
  }
  // Strip standalone trailing 止 (meaning "no descendants") that isn't part of the name
  // e.g. "等贞止" -> "等贞", but only when 止 is the final character appended after a valid name
  if (cleaned.endsWith('止') && cleaned.length > 1) {
    const withoutZhi = cleaned.slice(0, -1)
    if (isLikelyPersonName(withoutZhi)) {
      flags.push('no-grandchildren')
      cleaned = withoutZhi
    }
  }
  if (/早夭/.test(cleaned)) {
    flags.push('lost-record')
    cleaned = cleaned.replace(/早夭/g, '')
  }
  if (/往外|出嫁/.test(cleaned)) {
    flags.push('out-married')
    cleaned = cleaned.replace(/往外|出嫁/g, '')
  }
  cleaned = normalizeName(cleaned)
  if (!isLikelyPersonName(cleaned)) return null
  return { name: cleaned, isAdoptive, statusFlags: flags, gender }
}

function extractChildClaims(line: string, parentId: number, nextId: () => number): ChildClaim[] {
  const claims: ChildClaim[] = []
  let ordinal = 1
  // Capture stops at ，女 / ，生女 / 。 / ； — prevents son block from swallowing daughter section
  // Handles both "生N子：" (number before 子) and "生子N：" (number after 子)
  const sonBlocks = [...line.matchAll(/生(?:[一二三四五六七八九十]+)?子(?:[一二三四五六七八九十]+)?\s*[:：]\s*([^。；]*?)(?=[。；]|，(?:生)?女[：:]|$)/g)]
  for (const block of sonBlocks) {
    const tokens = (block[1] ?? '').split(/[、，,]/)
    for (const token of tokens) {
      const raw = parseChildToken(token, '男')
      if (!raw) continue
      claims.push({
        id: nextId(),
        parentId,
        claimedName: raw.name,
        ordinalIndex: ordinal++,
        gender: raw.gender,
        isAdoptive: raw.isAdoptive,
        outAdoptedToHint: '',
        resolvedMemberId: null,
        status: 'missing',
        statusFlags: raw.statusFlags,
        rawText: line,
      })
    }
  }
  // Handles "生N女：" and "生女N：" ordering variants
  const daughterBlocks = [...line.matchAll(/生(?:[一二三四五六七八九十]+)?女(?:[一二三四五六七八九十]+)?\s*[:：]\s*([^。；]*?)(?=[。；]|$)/g)]
  for (const block of daughterBlocks) {
    const tokens = (block[1] ?? '').split(/[、，,]/)
    for (const token of tokens) {
      const raw = parseChildToken(token, '女')
      if (!raw) continue
      claims.push({
        id: nextId(),
        parentId,
        claimedName: raw.name,
        ordinalIndex: ordinal++,
        gender: raw.gender,
        isAdoptive: raw.isAdoptive,
        outAdoptedToHint: '',
        resolvedMemberId: null,
        status: 'missing',
        statusFlags: raw.statusFlags,
        rawText: line,
      })
    }
  }
  // Abbreviated daughter form: "，女：A、B" or "。女：A、B" without the 生 prefix.
  // Only run if no daughter claims yet, to avoid double-counting when both forms appear.
  const hasDaughterClaim = claims.some((c) => c.gender === '女')
  if (!hasDaughterClaim) {
    const shorthandDaughterBlocks = [...line.matchAll(/(?:，|。|^)女\s*[:：]\s*([^。；]+)/g)]
    for (const block of shorthandDaughterBlocks) {
      const tokens = (block[1] ?? '').split(/[、，,]/)
      for (const token of tokens) {
        const raw = parseChildToken(token, '女')
        if (!raw) continue
        claims.push({
          id: nextId(), parentId, claimedName: raw.name,
          ordinalIndex: ordinal++, gender: raw.gender,
          isAdoptive: raw.isAdoptive, outAdoptedToHint: '',
          resolvedMemberId: null, status: 'missing',
          statusFlags: raw.statusFlags, rawText: line,
        })
      }
    }
  }
  // Fallback: "生N子。A、B、C" without colon (loose form)
  if (claims.length === 0) {
    const looseBlocks = [...line.matchAll(/生([一二三四五六七八九十]+)子。([^。；]+)/g)]
    for (const block of looseBlocks) {
      const tokens = (block[2] ?? '').split(/[、，,]/)
      for (const token of tokens) {
        const raw = parseChildToken(token, '男')
        if (!raw) continue
        claims.push({
          id: nextId(),
          parentId,
          claimedName: raw.name,
          ordinalIndex: ordinal++,
          gender: raw.gender,
          isAdoptive: raw.isAdoptive,
          outAdoptedToHint: '',
          resolvedMemberId: null,
          status: 'missing',
          statusFlags: raw.statusFlags,
          rawText: line,
        })
      }
    }
  }
  return claims
}

// Two-pass resolution

function runTwoPassResolution(state: ParserState): void {
  const minGen = state.members.reduce(
    (m, x) => Math.min(m, x.generationNumber ?? Infinity),
    Infinity,
  )

  for (const claim of state.childClaims) {
    const parent = state.members.find((m) => m.id === claim.parentId)
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
      if (candidates[0].parentId === null && !claim.isAdoptive) {
        candidates[0].parentId = claim.parentId
      }
    } else if (candidates.length > 1) {
      claim.status = 'ambiguous'
    } else {
      claim.status = 'missing'
    }
  }

  for (const member of state.members) {
    if (member.parentId === null && (member.generationNumber ?? 0) > minGen) {
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
  nextId: number
  nextSpouseId: number
  nextChildClaimId: number
  lastMember: Member | null
}

export function parsePartDataMarkdownV2(raw: string): FamilyData {
  const state: ParserState = {
    branchLabel: '',
    generationLabel: '',
    generationNumber: 0,
    members: [],
    spouses: [],
    childClaims: [],
    nextId: 1,
    nextSpouseId: 1,
    nextChildClaimId: 1,
    lastMember: null,
  }

  // Keep raw lines (don't pre-filter) so we can handle fence blocks and descriptive paragraphs.
  const rawLines = raw.split(/\r?\n/)
  const now = new Date().toISOString()

  let inFence = false
  const fenceBuffer: string[] = []

  for (const rawLine of rawLines) {
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
    state.lastMember = member
    const newSpouses = extractSpouses(line, member.id, () => state.nextSpouseId++, now)
    state.spouses.push(...newSpouses)
    const newClaims = extractChildClaims(line, member.id, () => state.nextChildClaimId++)
    state.childClaims.push(...newClaims)
  }

  runTwoPassResolution(state)

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: state.members,
    tracks: [], events: [], aliases: [], relations: [],
    temporals: [], burials: [],
    spouses: state.spouses,
    childClaims: state.childClaims,
    nextId: state.nextId,
    nextTrackId: 1, nextEventId: 1, nextAliasId: 1,
    nextRelationId: 1, nextTemporalId: 1, nextBurialId: 1,
    nextSpouseId: state.nextSpouseId,
    nextChildClaimId: state.nextChildClaimId,
  }
}
