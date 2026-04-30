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
import type { ChildClaim } from '../types/childClaim'
import type { Spouse } from '../types/spouse'
import {
  exportD1BackupBinary,
  importD1BackupBinary,
  loadFamilyDataFromD1,
  saveFamilyDataToD1,
} from './d1ApiService'

export const STORAGE_KEY = 'family_tree_app_data'
const STORAGE_MIGRATED_KEY = 'family_tree_storage_migrated'
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

const defaultMembers: Member[] = [
  { id: 1, name: '始祖', parentId: null, gender: '男', birthDate: '', photoUrl: '', biography: '' },
  { id: 2, name: '长子', parentId: 1, gender: '男', birthDate: '', photoUrl: '', biography: '' },
  { id: 3, name: '次女', parentId: 1, gender: '女', birthDate: '', photoUrl: '', biography: '' },
]

const defaultData: FamilyData = {
  schemaVersion: APP_SCHEMA_VERSION,
  members: defaultMembers,
  tracks: [],
  events: [],
  aliases: [],
  relations: [],
  temporals: [],
  burials: [],
  spouses: [],
  childClaims: [],
  nextId: 4,
  nextTrackId: 1,
  nextEventId: 1,
  nextAliasId: 1,
  nextRelationId: 1,
  nextTemporalId: 1,
  nextBurialId: 1,
  nextSpouseId: 1,
  nextChildClaimId: 1,
}

function cloneDefaultData(): FamilyData {
  return {
    schemaVersion: defaultData.schemaVersion,
    members: defaultData.members.map((member) => ({ ...member })),
    tracks: [],
    events: [],
    aliases: [],
    relations: [],
    temporals: [],
    burials: [],
    spouses: [],
    childClaims: [],
    nextId: defaultData.nextId,
    nextTrackId: defaultData.nextTrackId,
    nextEventId: defaultData.nextEventId,
    nextAliasId: defaultData.nextAliasId,
    nextRelationId: defaultData.nextRelationId,
    nextTemporalId: defaultData.nextTemporalId,
    nextBurialId: defaultData.nextBurialId,
    nextSpouseId: defaultData.nextSpouseId,
    nextChildClaimId: defaultData.nextChildClaimId,
  }
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
    typeof track.createdAt === 'string' &&
    typeof track.updatedAt === 'string' &&
    !!track.startPoint &&
    !!track.endPoint
  )
}


function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') {
    return false
  }

  const m = value as Partial<Member>
  const genderOk = m.gender === '男' || m.gender === '女'
  const parentOk = m.parentId === null || typeof m.parentId === 'number'
  const birthDateOk = m.birthDate === undefined || typeof m.birthDate === 'string'
  const photoUrlOk = m.photoUrl === undefined || typeof m.photoUrl === 'string'
  const biographyOk = m.biography === undefined || typeof m.biography === 'string'
  const generationLabelRawOk = m.generationLabelRaw === undefined || typeof m.generationLabelRaw === 'string'
  const lineageBranchOk = m.lineageBranch === undefined || typeof m.lineageBranch === 'string'
  const rawNotesOk = m.rawNotes === undefined || typeof m.rawNotes === 'string'
  const uncertaintyFlagsOk =
    m.uncertaintyFlags === undefined ||
    (Array.isArray(m.uncertaintyFlags) &&
      m.uncertaintyFlags.every((flag) =>
        typeof flag === 'string' && UNCERTAINTY_FLAGS.includes(flag as UncertaintyFlag),
      ))

  return (
    typeof m.id === 'number' &&
    typeof m.name === 'string' &&
    genderOk &&
    parentOk &&
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

function isSpouse(value: unknown): value is Spouse {
  if (!value || typeof value !== 'object') {
    return false
  }
  const s = value as Partial<Spouse>
  return (
    typeof s.id === 'number' &&
    typeof s.husbandId === 'number' &&
    typeof s.surname === 'string' &&
    typeof s.relationLabel === 'string'
  )
}

function isChildClaim(value: unknown): value is ChildClaim {
  if (!value || typeof value !== 'object') {
    return false
  }
  const c = value as Partial<ChildClaim>
  return (
    typeof c.id === 'number' &&
    typeof c.parentId === 'number' &&
    typeof c.claimedName === 'string'
  )
}

function normalizeFamilyDataPayload(parsed: Partial<FamilyData>): FamilyData {
  const members = Array.isArray(parsed.members)
    ? parsed.members.filter(isMember).map((member) => ({
        ...member,
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

  if (members.length === 0) {
    return cloneDefaultData()
  }

  const tracks = Array.isArray(parsed.tracks) ? parsed.tracks.filter(isTrack) : []
  const events = Array.isArray(parsed.events)
    ? parsed.events.filter(isEvent).map((event) => ({ ...event, description: event.description ?? '' }))
    : []
  const aliases = Array.isArray(parsed.aliases) ? parsed.aliases.filter(isNameAlias) : []
  const relations = Array.isArray(parsed.relations) ? parsed.relations.filter(isKinshipRelation) : []
  const temporals = Array.isArray(parsed.temporals) ? parsed.temporals.filter(isTemporalExpression) : []
  const burials = Array.isArray(parsed.burials) ? parsed.burials.filter(isBurialRecord) : []
  const spouses = Array.isArray(parsed.spouses) ? parsed.spouses.filter(isSpouse) : []
  const childClaims = Array.isArray(parsed.childClaims) ? parsed.childClaims.filter(isChildClaim) : []

  const nextId = typeof parsed.nextId === 'number' ? parsed.nextId : 1
  const nextTrackId = typeof parsed.nextTrackId === 'number' ? parsed.nextTrackId : 1
  const nextEventId = typeof parsed.nextEventId === 'number' ? parsed.nextEventId : 1
  const nextAliasId = typeof parsed.nextAliasId === 'number' ? parsed.nextAliasId : 1
  const nextRelationId = typeof parsed.nextRelationId === 'number' ? parsed.nextRelationId : 1
  const nextTemporalId = typeof parsed.nextTemporalId === 'number' ? parsed.nextTemporalId : 1
  const nextBurialId = typeof parsed.nextBurialId === 'number' ? parsed.nextBurialId : 1
  const nextSpouseId = typeof parsed.nextSpouseId === 'number' ? parsed.nextSpouseId : 1
  const nextChildClaimId = typeof parsed.nextChildClaimId === 'number' ? parsed.nextChildClaimId : 1

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members,
    tracks,
    events,
    aliases,
    relations,
    temporals,
    burials,
    spouses,
    childClaims,
    nextId: Math.max(nextId, ...members.map((m) => m.id + 1)),
    nextTrackId: Math.max(nextTrackId, ...tracks.map((track) => track.id + 1), 1),
    nextEventId: Math.max(nextEventId, ...events.map((event) => event.id + 1), 1),
    nextAliasId: Math.max(nextAliasId, ...aliases.map((alias) => alias.id + 1), 1),
    nextRelationId: Math.max(nextRelationId, ...relations.map((relation) => relation.id + 1), 1),
    nextTemporalId: Math.max(nextTemporalId, ...temporals.map((temporal) => temporal.id + 1), 1),
    nextBurialId: Math.max(nextBurialId, ...burials.map((burial) => burial.id + 1), 1),
    nextSpouseId: Math.max(nextSpouseId, ...spouses.map((s) => s.id + 1), 1),
    nextChildClaimId: Math.max(nextChildClaimId, ...childClaims.map((c) => c.id + 1), 1),
  }
}

function loadFamilyDataFromLocalStorage(): FamilyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return cloneDefaultData()
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return cloneDefaultData()
    }

    return normalizeFamilyDataPayload(parsed as Partial<FamilyData>)
  } catch {
    return cloneDefaultData()
  }
}

function hasLocalPersistedPayload(): boolean {
  return typeof localStorage.getItem(STORAGE_KEY) === 'string'
}

function markMigratedToSqlite(): void {
  localStorage.setItem(STORAGE_MIGRATED_KEY, '1')
}

function wasMigratedToSqlite(): boolean {
  return localStorage.getItem(STORAGE_MIGRATED_KEY) === '1'
}

function clearLegacyLocalStorageData(): void {
  localStorage.removeItem(STORAGE_KEY)
}

function saveFamilyDataToLocalStorage(data: FamilyData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function initializeStorage(): Promise<FamilyData> {
  const localData = loadFamilyDataFromLocalStorage()
  try {
    const d1Data = await loadFamilyDataFromD1()
    if (d1Data) {
      return normalizeFamilyDataPayload(d1Data)
    }

    const hasLocalData = hasLocalPersistedPayload()
    const seedData = hasLocalData ? localData : cloneDefaultData()
    await saveFamilyDataToD1(seedData)

    if (hasLocalData && !wasMigratedToSqlite()) {
      markMigratedToSqlite()
      clearLegacyLocalStorageData()
    }

    return seedData
  } catch (error) {
    // Keep the app usable when cloud endpoint is temporarily unavailable.
    console.warn('D1 初始化失败，已回退到本地数据。', error)
    return localData
  }
}

export async function saveFamilyData(data: FamilyData): Promise<void> {
  await saveFamilyDataToD1(data)
}

export async function exportSqliteData(): Promise<Uint8Array> {
  return exportD1BackupBinary()
}

export async function importSqliteData(binary: Uint8Array): Promise<FamilyData> {
  const imported = await importD1BackupBinary(binary)
  markMigratedToSqlite()
  clearLegacyLocalStorageData()
  return normalizeFamilyDataPayload(imported)
}
