import { APP_SCHEMA_VERSION, type FamilyData, type GpxPoint, type Member } from '../types/member'

export class FamilyDataValidationError extends Error {}

type Row = Record<string, unknown>

function invalid(message: string): never {
  throw new FamilyDataValidationError(`数据无效：${message}`)
}

function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('记录必须为对象')
  return value as Row
}

function text(row: Row, key: string, fallback = ''): string {
  const value = row[key] ?? fallback
  if (typeof value !== 'string') invalid(`${key} 必须为文本`)
  return value
}

function integer(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalid(`${label} 必须为不小于 ${minimum} 的整数`)
  }
  return value
}

function reference(value: unknown): number | null {
  return value == null ? null : integer(value, '关联 ID')
}

function literal<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) invalid(`${label} 不合法`)
  return value as T
}

function strings(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) invalid('列表必须为文本数组')
  return [...value]
}

function flags<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  return strings(value).map((item) => literal(item, allowed, '标记'))
}

function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') invalid('布尔字段不合法')
  return value
}

function rows<T extends { id: number }>(root: Row, key: string, parse: (row: Row) => T): T[] {
  const value = root[key] ?? []
  if (!Array.isArray(value)) invalid(`${key} 必须为数组`)
  const ids = new Set<number>()
  return value.map((item) => {
    const row = parse(record(item))
    if (ids.has(row.id)) invalid(`${key} ID 重复：${row.id}`)
    ids.add(row.id)
    return row
  })
}

function point(value: unknown): GpxPoint {
  const row = record(value)
  if (
    typeof row.lat !== 'number' || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90
    || typeof row.lng !== 'number' || !Number.isFinite(row.lng) || Math.abs(row.lng) > 180
  ) invalid('轨迹经纬度不合法')
  if (row.ele !== undefined && (typeof row.ele !== 'number' || !Number.isFinite(row.ele))) invalid('轨迹海拔不合法')
  return { lat: row.lat, lng: row.lng, ...(row.ele === undefined ? {} : { ele: row.ele as number }), ...(row.time === undefined ? {} : { time: text(row, 'time') }) }
}

function nextId(root: Row, key: string, values: { id: number }[]): number {
  const minimum = values.reduce((max, item) => Math.max(max, item.id + 1), 1)
  return Math.max(root[key] === undefined ? 1 : integer(root[key], key), minimum)
}

export function normalizeFamilyData(value: unknown): FamilyData {
  const root = record(value)
  const version = root.schemaVersion ?? 3
  if (version !== 2 && version !== 3 && version !== APP_SCHEMA_VERSION) invalid('仅支持 schemaVersion 2、3、4')
  if (!Array.isArray(root.members)) invalid('缺少成员数组')

  const members = rows<Member>(root, 'members', (row) => ({
    id: integer(row.id, '成员 ID'),
    name: text(row, 'name').trim() || invalid('成员姓名不能为空'),
    parentId: reference(row.parentId),
    gender: literal(row.gender ?? '男', ['男', '女'], '性别'),
    birthDate: text(row, 'birthDate'),
    photoUrl: text(row, 'photoUrl'),
    biography: text(row, 'biography'),
    generationLabelRaw: text(row, 'generationLabelRaw'),
    ...(row.generationNumber == null ? {} : { generationNumber: integer(row.generationNumber, '世代数', 0) }),
    lineageBranch: text(row, 'lineageBranch'),
    rawNotes: text(row, 'rawNotes'),
    uncertaintyFlags: flags(row.uncertaintyFlags, ['missing', 'estimated', 'conflicting', 'unverified']),
  }))
  const aliases = rows<FamilyData['aliases'][number]>(root, 'aliases', (row) => ({
    id: integer(row.id, '别名 ID'), memberId: integer(row.memberId, '别名成员 ID'),
    name: text(row, 'name'), type: literal(row.type, ['primary', 'given', 'courtesy', 'art', 'taboo', 'alias', 'other'], '别名类型'),
    isPreferred: boolean(row.isPreferred), note: text(row, 'note'), rawText: text(row, 'rawText'),
  }))
  const temporals = rows<FamilyData['temporals'][number]>(root, 'temporals', (row) => {
    const confidence = row.confidence ?? 1
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) invalid('纪年可信度不合法')
    return {
      id: integer(row.id, '纪年 ID'), memberId: reference(row.memberId), label: text(row, 'label'), rawText: text(row, 'rawText'),
      calendarType: literal(row.calendarType, ['gregorian', 'lunar-era', 'ganzhi', 'mixed', 'unknown'], '历法'),
      normalizedDate: text(row, 'normalizedDate'), precision: literal(row.precision, ['year', 'month', 'day', 'hour', 'unknown'], '纪年精度'), confidence,
    }
  })
  const relations = rows<FamilyData['relations'][number]>(root, 'relations', (row) => ({
    id: integer(row.id, '关系 ID'), fromMemberId: integer(row.fromMemberId, '关系来源 ID'), toMemberId: integer(row.toMemberId, '关系目标 ID'),
    type: literal(row.type, ['father', 'mother', 'spouse', 'step-parent', 'adoptive-parent', 'adopted-child', 'successor', 'other'], '关系类型'),
    status: literal(row.status ?? 'active', ['active', 'ended', 'uncertain'], '关系状态'),
    temporalId: reference(row.temporalId), note: text(row, 'note'), rawText: text(row, 'rawText'),
  }))
  const burials = rows<FamilyData['burials'][number]>(root, 'burials', (row) => ({
    id: integer(row.id, '葬地 ID'), memberId: integer(row.memberId, '葬地成员 ID'), temporalId: reference(row.temporalId),
    placeRaw: text(row, 'placeRaw'), mountainDirection: text(row, 'mountainDirection'), fenjin: text(row, 'fenjin'),
    note: text(row, 'note'), rawText: text(row, 'rawText'),
  }))
  const spouses = rows<FamilyData['spouses'][number]>(root, 'spouses', (row) => ({
    id: integer(row.id, '配偶 ID'), husbandId: integer(row.husbandId, '配偶关联成员 ID'),
    surname: text(row, 'surname'), fullName: row.fullName == null ? null : text(row, 'fullName'),
    aliases: strings(row.aliases), relationLabel: literal(row.relationLabel, ['配', '继配', '妣', '继妣', '三妣', '四妣', '娶', '其他'], '配偶关系'),
    order: integer(row.order ?? 1, '配偶顺序', 0), birthDate: text(row, 'birthDate'), deathDate: text(row, 'deathDate'),
    burialPlace: text(row, 'burialPlace'), biography: text(row, 'biography'),
    statusFlags: flags(row.statusFlags, ['early-deceased', 'lost-record', 'out-married']), rawText: text(row, 'rawText'),
    createdAt: text(row, 'createdAt'), updatedAt: text(row, 'updatedAt'),
  }))
  const childClaims = rows<FamilyData['childClaims'][number]>(root, 'childClaims', (row) => ({
    id: integer(row.id, '子女声明 ID'), parentId: integer(row.parentId, '声明父亲 ID'), claimedName: text(row, 'claimedName'),
    ordinalIndex: integer(row.ordinalIndex ?? 0, '子女顺序', 0), gender: literal(row.gender ?? 'unknown', ['男', '女', 'unknown'], '声明性别'),
    isAdoptive: boolean(row.isAdoptive), outAdoptedToHint: text(row, 'outAdoptedToHint'), resolvedMemberId: reference(row.resolvedMemberId),
    status: literal(row.status ?? 'missing', ['matched', 'missing', 'ambiguous'], '声明状态'),
    statusFlags: flags(row.statusFlags, ['no-grandchildren', 'unmarried', 'out-married', 'lost-record']), rawText: text(row, 'rawText'),
  }))
  const events = rows<FamilyData['events'][number]>(root, 'events', (row) => ({
    id: integer(row.id, '事件 ID'), memberId: reference(row.memberId), type: literal(row.type, ['婚', '丧', '嫁', '娶', '生', '卒', '其他'], '事件类型'),
    title: text(row, 'title'), date: text(row, 'date'), description: text(row, 'description'),
    createdAt: text(row, 'createdAt'), updatedAt: text(row, 'updatedAt'),
  }))
  const tracks = rows<FamilyData['tracks'][number]>(root, 'tracks', (row) => {
    const memberId = reference(row.memberId)
    if (row.memberIds !== undefined && !Array.isArray(row.memberIds)) invalid('轨迹关联成员必须为数组')
    const memberIds = Array.isArray(row.memberIds)
      ? row.memberIds.map((id) => integer(id, '轨迹关联成员 ID'))
      : (memberId === null ? [] : [memberId])
    if (new Set(memberIds).size !== memberIds.length) invalid('轨迹关联成员重复')
    if (row.memberIds !== undefined && row.memberId !== undefined && memberId !== (memberIds[0] ?? null)) {
      invalid('轨迹首位成员与旧版关联不一致')
    }
    if (!Array.isArray(row.points) || row.points.length === 0) invalid('轨迹缺少有效点')
    const points = row.points.map(point)
    const stats = record(row.stats)
    if (typeof stats.distanceMeters !== 'number' || !Number.isFinite(stats.distanceMeters) || stats.distanceMeters < 0) invalid('轨迹距离不合法')
    const elevation = stats.elevationGainMeters ?? null
    if (elevation !== null && (typeof elevation !== 'number' || !Number.isFinite(elevation))) invalid('轨迹爬升不合法')
    return {
      id: integer(row.id, '轨迹 ID'), name: text(row, 'name'), memberId: memberIds[0] ?? null, memberIds, points,
      startPoint: point(row.startPoint), endPoint: point(row.endPoint),
      stats: { distanceMeters: stats.distanceMeters, pointCount: points.length, elevationGainMeters: elevation },
      createdAt: text(row, 'createdAt'), updatedAt: text(row, 'updatedAt'),
    }
  })

  const byId = new Map(members.map((member) => [member.id, member]))
  const temporalIds = new Set(temporals.map((item) => item.id))
  const memberRef = (id: number | null) => { if (id !== null && !byId.has(id)) invalid(`关联成员不存在：${id}`) }
  const temporalRef = (id: number | null) => { if (id !== null && !temporalIds.has(id)) invalid(`关联纪年不存在：${id}`) }

  for (const member of members) memberRef(member.parentId)
  for (const item of [...aliases, ...burials, ...temporals, ...events, ...tracks]) memberRef(item.memberId)
  for (const track of tracks) for (const id of track.memberIds ?? []) memberRef(id)
  for (const item of [...burials, ...relations]) temporalRef(item.temporalId)
  for (const relation of relations) {
    memberRef(relation.fromMemberId)
    memberRef(relation.toMemberId)
    if (relation.fromMemberId === relation.toMemberId) invalid('关系不能指向本人')
    if (relation.type === 'father') {
      const member = byId.get(relation.fromMemberId)!
      if (member.parentId !== null && member.parentId !== relation.toMemberId) invalid('父系关系与成员记录冲突')
      member.parentId = relation.toMemberId
    }
  }
  for (const spouse of spouses) memberRef(spouse.husbandId)
  for (const claim of childClaims) {
    memberRef(claim.parentId)
    memberRef(claim.resolvedMemberId)
    if (claim.status === 'matched' && claim.resolvedMemberId === null) invalid('已匹配的子女声明缺少关联成员')
  }

  const checked = new Set<number>()
  for (const member of members) {
    const path = new Set<number>()
    let current: number | null = member.id
    while (current !== null && !checked.has(current)) {
      if (path.has(current)) invalid('父系关系存在循环')
      path.add(current)
      current = byId.get(current)!.parentId
    }
    for (const id of path) checked.add(id)
  }

  let relationId = nextId(root, 'nextRelationId', relations)
  for (const item of root.members) {
    const row = record(item)
    if (row.spouseIds === undefined) continue
    if (!Array.isArray(row.spouseIds)) invalid('旧版配偶关联必须为数组')
    for (const value of row.spouseIds) {
      const spouseId = integer(value, '旧版配偶 ID')
      memberRef(spouseId)
      if (spouseId === row.id) invalid('配偶不能是本人')
      if (!relations.some((relation) => relation.type === 'spouse' && (
        (relation.fromMemberId === row.id && relation.toMemberId === spouseId)
        || (relation.fromMemberId === spouseId && relation.toMemberId === row.id)
      ))) {
        relations.push({ id: relationId++, fromMemberId: integer(row.id, '成员 ID'), toMemberId: spouseId, type: 'spouse', status: 'active', temporalId: null, note: '', rawText: '' })
      }
    }
  }

  return {
    schemaVersion: APP_SCHEMA_VERSION, members, tracks, events, aliases, relations, temporals, burials, spouses, childClaims,
    nextId: nextId(root, 'nextId', members), nextTrackId: nextId(root, 'nextTrackId', tracks),
    nextEventId: nextId(root, 'nextEventId', events), nextAliasId: nextId(root, 'nextAliasId', aliases),
    nextRelationId: Math.max(nextId(root, 'nextRelationId', relations), relationId),
    nextTemporalId: nextId(root, 'nextTemporalId', temporals), nextBurialId: nextId(root, 'nextBurialId', burials),
    nextSpouseId: nextId(root, 'nextSpouseId', spouses), nextChildClaimId: nextId(root, 'nextChildClaimId', childClaims),
  }
}

export function createEmptyFamilyData(): FamilyData {
  return normalizeFamilyData({ schemaVersion: APP_SCHEMA_VERSION, members: [] })
}

export function exportAsJson(data: FamilyData): string {
  return JSON.stringify(normalizeFamilyData(data), null, 2)
}

export function parseImportedJson(raw: string): FamilyData {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new FamilyDataValidationError('导入失败：JSON 格式无效')
  }
  return normalizeFamilyData(value)
}
