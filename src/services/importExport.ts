import {
  APP_SCHEMA_VERSION,
  type FamilyData,
  type FamilyEvent,
  type FamilyEventType,
  type Member,
  type Track,
} from '../types/member'

const EVENT_TYPES: FamilyEventType[] = ['婚', '丧', '嫁', '娶', '生', '卒', '其他']

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

  return (
    typeof member.id === 'number' &&
    typeof member.name === 'string' &&
    genderOk &&
    parentOk &&
    spouseOk &&
    birthDateOk &&
    photoUrlOk &&
    biographyOk
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
  const members = Array.isArray(obj.members)
    ? obj.members.filter(isMember).map((member) => ({
        ...member,
        spouseIds: Array.isArray(member.spouseIds) ? member.spouseIds : [],
        birthDate: member.birthDate ?? '',
        photoUrl: member.photoUrl ?? '',
        biography: member.biography ?? '',
      }))
    : []
  const tracks = Array.isArray(obj.tracks) ? obj.tracks.filter(isTrack) : []
  const events = Array.isArray(obj.events)
    ? obj.events.filter(isEvent).map((event) => ({
        ...event,
        description: event.description ?? '',
      }))
    : []
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

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: normalizeMemberSpouses(members),
    tracks,
    events,
    nextId,
    nextTrackId,
    nextEventId,
  }
}
