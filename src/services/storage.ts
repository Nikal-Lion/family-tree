import { APP_SCHEMA_VERSION, type FamilyData, type Member, type Track } from '../types/member'
import {
  exportSqliteBinary,
  importSqliteBinary,
  initSqliteStorage,
  loadFamilyDataFromSqlite,
  saveFamilyDataToSqlite,
} from './sqliteService'

export const STORAGE_KEY = 'family_tree_app_data'
const STORAGE_MIGRATED_KEY = 'family_tree_storage_migrated'
const USE_SQLITE = import.meta.env.VITE_USE_SQLITE !== 'false'
const SQLITE_DUAL_WRITE = import.meta.env.VITE_SQLITE_DUAL_WRITE !== 'false'

const defaultMembers: Member[] = [
  { id: 1, name: '始祖', parentId: null, gender: '男', spouseIds: [] },
  { id: 2, name: '长子', parentId: 1, gender: '男', spouseIds: [] },
  { id: 3, name: '次女', parentId: 1, gender: '女', spouseIds: [] },
]

const defaultData: FamilyData = {
  schemaVersion: APP_SCHEMA_VERSION,
  members: defaultMembers,
  tracks: [],
  nextId: 4,
  nextTrackId: 1,
}

function cloneDefaultData(): FamilyData {
  return {
    schemaVersion: defaultData.schemaVersion,
    members: defaultData.members.map((member) => ({ ...member, spouseIds: [...member.spouseIds] })),
    tracks: [],
    nextId: defaultData.nextId,
    nextTrackId: defaultData.nextTrackId,
  }
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

  return typeof m.id === 'number' && typeof m.name === 'string' && genderOk && parentOk && spouseOk
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
        }))
      : []
    const tracks = Array.isArray(parsed.tracks) ? parsed.tracks.filter(isTrack) : []
    const nextId = typeof parsed.nextId === 'number' ? parsed.nextId : 1
    const nextTrackId = typeof parsed.nextTrackId === 'number' ? parsed.nextTrackId : 1

    if (members.length === 0) {
      return cloneDefaultData()
    }

    const computedNextId = Math.max(nextId, ...members.map((m) => m.id + 1))
    const computedNextTrackId = Math.max(nextTrackId, ...tracks.map((t) => t.id + 1), 1)

    return {
      schemaVersion: APP_SCHEMA_VERSION,
      members: normalizeMemberSpouses(members),
      tracks,
      nextId: computedNextId,
      nextTrackId: computedNextTrackId,
    }
  } catch {
    return cloneDefaultData()
  }
}

function saveFamilyDataToLocalStorage(data: FamilyData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
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

export async function initializeStorage(): Promise<FamilyData> {
  const localData = loadFamilyDataFromLocalStorage()

  if (!USE_SQLITE) {
    return localData
  }

  await initSqliteStorage()
  const sqliteData = await loadFamilyDataFromSqlite()
  if (sqliteData) {
    return sqliteData
  }

  const hasLocalData = hasLocalPersistedPayload()
  const seedData = hasLocalData ? localData : cloneDefaultData()
  await saveFamilyDataToSqlite(seedData)

  if (hasLocalData && !wasMigratedToSqlite()) {
    markMigratedToSqlite()
  }

  if (SQLITE_DUAL_WRITE) {
    saveFamilyDataToLocalStorage(seedData)
  }

  return seedData
}

export async function saveFamilyData(data: FamilyData): Promise<void> {
  if (USE_SQLITE) {
    await saveFamilyDataToSqlite(data)
    if (SQLITE_DUAL_WRITE) {
      saveFamilyDataToLocalStorage(data)
    }
    return
  }

  saveFamilyDataToLocalStorage(data)
}

export async function exportSqliteData(): Promise<Uint8Array> {
  if (!USE_SQLITE) {
    throw new Error('当前未启用 SQLite 模式')
  }
  return exportSqliteBinary()
}

export async function importSqliteData(binary: Uint8Array): Promise<FamilyData> {
  if (!USE_SQLITE) {
    throw new Error('当前未启用 SQLite 模式')
  }
  const imported = await importSqliteBinary(binary)
  if (SQLITE_DUAL_WRITE) {
    saveFamilyDataToLocalStorage(imported)
  }
  markMigratedToSqlite()
  return imported
}
