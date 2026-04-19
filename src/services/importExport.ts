import {
  APP_SCHEMA_VERSION,
  type BurialRecord,
  type FamilyData,
  type FamilyEvent,
  type FamilyEventType,
  type KinshipRelation,
  type Member,
  type NameAlias,
  type Track,
  type TemporalExpression,
  type UncertaintyFlag,
} from '../types/member'

const EVENT_TYPES: FamilyEventType[] = ['婚', '丧', '嫁', '娶', '生', '卒', '其他']
const UNCERTAINTY_FLAGS: UncertaintyFlag[] = ['missing', 'estimated', 'conflicting', 'unverified']
const NAME_ALIAS_TYPES = ['primary', 'given', 'courtesy', 'art', 'taboo', 'alias', 'other']
const KINSHIP_RELATION_TYPES = [
  'father',
  'mother',
  'spouse',
  'step-parent',
  'adoptive-parent',
  'adopted-child',
  'successor',
  'other',
]
const KINSHIP_RELATION_STATUSES = ['active', 'ended', 'uncertain']
const TEMPORAL_CALENDAR_TYPES = ['gregorian', 'lunar-era', 'ganzhi', 'mixed', 'unknown']
const TEMPORAL_PRECISIONS = ['year', 'month', 'day', 'hour', 'unknown']

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') {
    return false
  }

  const member = value as Partial<Member>
  const genderOk = member.gender === '男' || member.gender === '女'
  const parentOk = member.parentId === null || typeof member.parentId === 'number'
  const spouseOk =
    member.spouseIds === undefined ||
    (Array.isArray(member.spouseIds) && member.spouseIds.every((id) => typeof id === 'number'))
  const birthDateOk = member.birthDate === undefined || typeof member.birthDate === 'string'
  const photoUrlOk = member.photoUrl === undefined || typeof member.photoUrl === 'string'
  const biographyOk = member.biography === undefined || typeof member.biography === 'string'
  const generationLabelRawOk =
    member.generationLabelRaw === undefined || typeof member.generationLabelRaw === 'string'
  const lineageBranchOk = member.lineageBranch === undefined || typeof member.lineageBranch === 'string'
  const rawNotesOk = member.rawNotes === undefined || typeof member.rawNotes === 'string'
  const uncertaintyFlagsOk =
    member.uncertaintyFlags === undefined ||
    (Array.isArray(member.uncertaintyFlags) &&
      member.uncertaintyFlags.every(
        (flag) => typeof flag === 'string' && UNCERTAINTY_FLAGS.includes(flag as UncertaintyFlag),
      ))

  return (
    typeof member.id === 'number' &&
    typeof member.name === 'string' &&
    genderOk &&
    parentOk &&
    spouseOk &&
    birthDateOk &&
    photoUrlOk &&
    biographyOk &&
    generationLabelRawOk &&
    lineageBranchOk &&
    rawNotesOk &&
    uncertaintyFlagsOk
  )
}

function isNameAlias(value: unknown): value is NameAlias {
  if (!value || typeof value !== 'object') {
    return false
  }

  const alias = value as Partial<NameAlias>
  const typeOk = typeof alias.type === 'string' && NAME_ALIAS_TYPES.includes(alias.type)
  return (
    typeof alias.id === 'number' &&
    typeof alias.memberId === 'number' &&
    typeof alias.name === 'string' &&
    typeOk &&
    typeof alias.isPreferred === 'boolean' &&
    (alias.note === undefined || typeof alias.note === 'string') &&
    (alias.rawText === undefined || typeof alias.rawText === 'string')
  )
}

function isKinshipRelation(value: unknown): value is KinshipRelation {
  if (!value || typeof value !== 'object') {
    return false
  }

  const relation = value as Partial<KinshipRelation>
  const typeOk = typeof relation.type === 'string' && KINSHIP_RELATION_TYPES.includes(relation.type)
  const statusOk =
    typeof relation.status === 'string' && KINSHIP_RELATION_STATUSES.includes(relation.status)

  return (
    typeof relation.id === 'number' &&
    typeof relation.fromMemberId === 'number' &&
    typeof relation.toMemberId === 'number' &&
    typeOk &&
    statusOk &&
    (relation.temporalId === null || typeof relation.temporalId === 'number') &&
    (relation.note === undefined || typeof relation.note === 'string') &&
    (relation.rawText === undefined || typeof relation.rawText === 'string')
  )
}

function isTemporalExpression(value: unknown): value is TemporalExpression {
  if (!value || typeof value !== 'object') {
    return false
  }

  const temporal = value as Partial<TemporalExpression>
  const calendarOk =
    typeof temporal.calendarType === 'string' && TEMPORAL_CALENDAR_TYPES.includes(temporal.calendarType)
  const precisionOk =
    typeof temporal.precision === 'string' && TEMPORAL_PRECISIONS.includes(temporal.precision)

  return (
    typeof temporal.id === 'number' &&
    (temporal.memberId === null || typeof temporal.memberId === 'number') &&
    typeof temporal.label === 'string' &&
    typeof temporal.rawText === 'string' &&
    calendarOk &&
    (temporal.normalizedDate === undefined || typeof temporal.normalizedDate === 'string') &&
    precisionOk &&
    typeof temporal.confidence === 'number'
  )
}

function isBurialRecord(value: unknown): value is BurialRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const burial = value as Partial<BurialRecord>
  return (
    typeof burial.id === 'number' &&
    typeof burial.memberId === 'number' &&
    (burial.temporalId === null || typeof burial.temporalId === 'number') &&
    typeof burial.placeRaw === 'string' &&
    (burial.mountainDirection === undefined || typeof burial.mountainDirection === 'string') &&
    (burial.fenjin === undefined || typeof burial.fenjin === 'string') &&
    (burial.note === undefined || typeof burial.note === 'string') &&
    (burial.rawText === undefined || typeof burial.rawText === 'string')
  )
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)]
}

function normalizeMemberSpouses(members: Member[]): Member[] {
  const byId = new Map<number, Member>()
  for (const member of members) {
    byId.set(member.id, member)
  }

  for (const member of members) {
    member.spouseIds = uniqueNumbers(
      member.spouseIds.filter((id) => id !== member.id && byId.has(id)),
    )
  }

  for (const member of members) {
    for (const spouseId of member.spouseIds) {
      const spouse = byId.get(spouseId)
      if (!spouse) {
        continue
      }
      if (!spouse.spouseIds.includes(member.id)) {
        spouse.spouseIds.push(member.id)
      }
    }
  }

  for (const member of members) {
    member.spouseIds = uniqueNumbers(member.spouseIds).sort((a, b) => a - b)
  }

  return members
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') {
    return false
  }

  const track = value as Partial<Track>
  const points = Array.isArray(track.points) ? track.points : []
  const hasValidPoints = points.every((point) => {
    if (!point || typeof point !== 'object') {
      return false
    }
    const p = point as { lat?: unknown; lng?: unknown }
    return typeof p.lat === 'number' && typeof p.lng === 'number'
  })

  return (
    typeof track.id === 'number' &&
    typeof track.name === 'string' &&
    (track.memberId === null || typeof track.memberId === 'number') &&
    hasValidPoints &&
    !!track.startPoint &&
    !!track.endPoint &&
    typeof track.createdAt === 'string' &&
    typeof track.updatedAt === 'string'
  )
}

function isEvent(value: unknown): value is FamilyEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Partial<FamilyEvent>
  const typeOk = typeof event.type === 'string' && EVENT_TYPES.includes(event.type as FamilyEventType)
  return (
    typeof event.id === 'number' &&
    (event.memberId === null || typeof event.memberId === 'number') &&
    typeOk &&
    typeof event.title === 'string' &&
    typeof event.date === 'string' &&
    (event.description === undefined || typeof event.description === 'string') &&
    typeof event.createdAt === 'string' &&
    typeof event.updatedAt === 'string'
  )
}

export function exportAsJson(data: FamilyData): string {
  return JSON.stringify(data, null, 2)
}

export function parseImportedJson(raw: string): FamilyData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('导入失败：JSON 格式无效')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('导入失败：数据结构错误')
  }

  const obj = parsed as Partial<FamilyData>
  if (obj.schemaVersion !== APP_SCHEMA_VERSION) {
    throw new Error(`导入失败：仅支持 schemaVersion=${APP_SCHEMA_VERSION} 的数据文件`)
  }

  const members = Array.isArray(obj.members)
    ? obj.members.filter(isMember).map((member) => ({
        ...member,
        spouseIds: Array.isArray(member.spouseIds) ? member.spouseIds : [],
        birthDate: member.birthDate ?? '',
        photoUrl: member.photoUrl ?? '',
        biography: member.biography ?? '',
        generationLabelRaw: member.generationLabelRaw ?? '',
        lineageBranch: member.lineageBranch ?? '',
        rawNotes: member.rawNotes ?? '',
        uncertaintyFlags: Array.isArray(member.uncertaintyFlags)
          ? member.uncertaintyFlags.filter((flag) => UNCERTAINTY_FLAGS.includes(flag))
          : [],
      }))
    : []
  const tracks = Array.isArray(obj.tracks) ? obj.tracks.filter(isTrack) : []
  const events = Array.isArray(obj.events)
    ? obj.events.filter(isEvent).map((event) => ({
        ...event,
        description: event.description ?? '',
      }))
    : []
  const aliases = Array.isArray(obj.aliases) ? obj.aliases.filter(isNameAlias) : []
  const relations = Array.isArray(obj.relations) ? obj.relations.filter(isKinshipRelation) : []
  const temporals = Array.isArray(obj.temporals) ? obj.temporals.filter(isTemporalExpression) : []
  const burials = Array.isArray(obj.burials) ? obj.burials.filter(isBurialRecord) : []
  if (members.length === 0) {
    throw new Error('导入失败：未找到有效成员数据')
  }

  const ids = new Set<number>()
  for (const member of members) {
    if (ids.has(member.id)) {
      throw new Error('导入失败：成员 ID 重复')
    }
    ids.add(member.id)
  }

  const maxId = Math.max(...members.map((m) => m.id))
  const nextId = typeof obj.nextId === 'number' ? Math.max(obj.nextId, maxId + 1) : maxId + 1
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0
  const nextTrackId =
    typeof obj.nextTrackId === 'number' ? Math.max(obj.nextTrackId, maxTrackId + 1) : maxTrackId + 1
  const maxEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 0
  const nextEventId =
    typeof obj.nextEventId === 'number' ? Math.max(obj.nextEventId, maxEventId + 1) : maxEventId + 1
  const maxAliasId = aliases.length > 0 ? Math.max(...aliases.map((alias) => alias.id)) : 0
  const nextAliasId =
    typeof obj.nextAliasId === 'number' ? Math.max(obj.nextAliasId, maxAliasId + 1) : maxAliasId + 1
  const maxRelationId = relations.length > 0 ? Math.max(...relations.map((relation) => relation.id)) : 0
  const nextRelationId =
    typeof obj.nextRelationId === 'number'
      ? Math.max(obj.nextRelationId, maxRelationId + 1)
      : maxRelationId + 1
  const maxTemporalId = temporals.length > 0 ? Math.max(...temporals.map((temporal) => temporal.id)) : 0
  const nextTemporalId =
    typeof obj.nextTemporalId === 'number'
      ? Math.max(obj.nextTemporalId, maxTemporalId + 1)
      : maxTemporalId + 1
  const maxBurialId = burials.length > 0 ? Math.max(...burials.map((burial) => burial.id)) : 0
  const nextBurialId =
    typeof obj.nextBurialId === 'number' ? Math.max(obj.nextBurialId, maxBurialId + 1) : maxBurialId + 1

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: normalizeMemberSpouses(members),
    tracks,
    events,
    aliases,
    relations,
    temporals,
    burials,
    nextId,
    nextTrackId,
    nextEventId,
    nextAliasId,
    nextRelationId,
    nextTemporalId,
    nextBurialId,
  }
}
