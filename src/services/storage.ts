import {
  APP_SCHEMA_VERSION,
  type FamilyData,
  type FamilyEvent,
  type FamilyEventType,
  type Member,
  type Track,
} from '../types/member'
import {
  exportD1BackupBinary,
  importD1BackupBinary,
  loadFamilyDataFromD1,
  saveFamilyDataToD1,
} from './d1ApiService'

export const STORAGE_KEY = 'family_tree_app_data'
const STORAGE_MIGRATED_KEY = 'family_tree_storage_migrated'
const EVENT_TYPES: FamilyEventType[] = ['婚', '丧', '嫁', '娶', '生', '卒', '其他']

const defaultMembers: Member[] = [
  { id: 1, name: '始祖', parentId: null, gender: '男', spouseIds: [], birthDate: '', photoUrl: '', biography: '' },
  { id: 2, name: '长子', parentId: 1, gender: '男', spouseIds: [], birthDate: '', photoUrl: '', biography: '' },
  { id: 3, name: '次女', parentId: 1, gender: '女', spouseIds: [], birthDate: '', photoUrl: '', biography: '' },
]

const defaultData: FamilyData = {
  schemaVersion: APP_SCHEMA_VERSION,
  members: defaultMembers,
  tracks: [],
  events: [],
  nextId: 4,
  nextTrackId: 1,
  nextEventId: 1,
}

function cloneDefaultData(): FamilyData {
  return {
    schemaVersion: defaultData.schemaVersion,
    members: defaultData.members.map((member) => ({ ...member, spouseIds: [...member.spouseIds] })),
    tracks: [],
    events: [],
    nextId: defaultData.nextId,
    nextTrackId: defaultData.nextTrackId,
    nextEventId: defaultData.nextEventId,
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

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') {
    return false
  }

  const m = value as Partial<Member>
  const genderOk = m.gender === '男' || m.gender === '女'
  const parentOk = m.parentId === null || typeof m.parentId === 'number'
  const spouseOk =
    m.spouseIds === undefined ||
    (Array.isArray(m.spouseIds) && m.spouseIds.every((id) => typeof id === 'number'))
  const birthDateOk = m.birthDate === undefined || typeof m.birthDate === 'string'
  const photoUrlOk = m.photoUrl === undefined || typeof m.photoUrl === 'string'
  const biographyOk = m.biography === undefined || typeof m.biography === 'string'

  return (
    typeof m.id === 'number' &&
    typeof m.name === 'string' &&
    genderOk &&
    parentOk &&
    spouseOk &&
    birthDateOk &&
    photoUrlOk &&
    biographyOk
  )
}

function loadFamilyDataFromLocalStorage(): FamilyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return cloneDefaultData()
    }

    const parsed = JSON.parse(raw) as Partial<FamilyData>
    const members = Array.isArray(parsed.members)
      ? parsed.members.filter(isMember).map((member) => ({
          ...member,
          spouseIds: Array.isArray(member.spouseIds) ? member.spouseIds : [],
          birthDate: member.birthDate ?? '',
          photoUrl: member.photoUrl ?? '',
          biography: member.biography ?? '',
        }))
      : []
    const tracks = Array.isArray(parsed.tracks) ? parsed.tracks.filter(isTrack) : []
    const events = Array.isArray(parsed.events)
      ? parsed.events.filter(isEvent).map((event) => ({ ...event, description: event.description ?? '' }))
      : []
    const nextId = typeof parsed.nextId === 'number' ? parsed.nextId : 1
    const nextTrackId = typeof parsed.nextTrackId === 'number' ? parsed.nextTrackId : 1
    const nextEventId = typeof parsed.nextEventId === 'number' ? parsed.nextEventId : 1

    if (members.length === 0) {
      return cloneDefaultData()
    }

    const computedNextId = Math.max(nextId, ...members.map((m) => m.id + 1))
    const computedNextTrackId = Math.max(nextTrackId, ...tracks.map((t) => t.id + 1), 1)
    const computedNextEventId = Math.max(nextEventId, ...events.map((e) => e.id + 1), 1)

    return {
      schemaVersion: APP_SCHEMA_VERSION,
      members: normalizeMemberSpouses(members),
      tracks,
      events,
      nextId: computedNextId,
      nextTrackId: computedNextTrackId,
      nextEventId: computedNextEventId,
    }
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
      return d1Data
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
  return imported
}
