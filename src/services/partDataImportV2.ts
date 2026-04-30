import { APP_SCHEMA_VERSION, type FamilyData, type Member } from '../types/member'
import type { Spouse, SpouseRelation } from '../types/spouse'
import type { ChildClaim } from '../types/childClaim'

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
    aliases = [...aliases, ...extractAliases(tail)]

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

  const lines = raw.split(/\r?\n/).map(normalizeLine).filter((l) => l.length > 0)
  const now = new Date().toISOString()

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1?.[1]) { state.branchLabel = h1[1].trim(); continue }

    const h2 = line.match(/^##\s+(.+)$/)
    if (h2?.[1]) {
      state.generationLabel = h2[1].trim()
      state.generationNumber = parseChineseGenerationNumber(state.generationLabel)
      continue
    }

    const subject = extractSubjectName(line)
    if (!subject) continue

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
  }

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
