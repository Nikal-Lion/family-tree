import { APP_SCHEMA_VERSION, type FamilyData, type Member, type Track } from '../types/member'

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

  return typeof member.id === 'number' && typeof member.name === 'string' && genderOk && parentOk && spouseOk
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
      }))
    : []
  const tracks = Array.isArray(obj.tracks) ? obj.tracks.filter(isTrack) : []
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

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: normalizeMemberSpouses(members),
    tracks,
    nextId,
    nextTrackId,
  }
}
