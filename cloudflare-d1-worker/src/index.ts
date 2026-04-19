import { drizzle } from 'drizzle-orm/d1'
import { eq, desc } from 'drizzle-orm'
import * as schema from './schema'

interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
  API_TOKEN?: string
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
  exec(query: string): Promise<unknown>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<D1QueryResult<T>>
}

interface D1QueryResult<T> {
  results?: T[]
}

interface FamilyData {
  schemaVersion: number
  members: Array<{
    id: number
    name: string
    parentId: number | null
    gender: '男' | '女'
    spouseIds: number[]
    birthDate?: string
    photoUrl?: string
    biography?: string
    generationLabelRaw?: string
    lineageBranch?: string
    rawNotes?: string
    uncertaintyFlags?: Array<'missing' | 'estimated' | 'conflicting' | 'unverified'>
  }>
  events: Array<{
    id: number
    memberId: number | null
    type: '婚' | '丧' | '嫁' | '娶' | '生' | '卒' | '其他'
    title: string
    date: string
    description?: string
    createdAt: string
    updatedAt: string
  }>
  tracks: Array<{
    id: number
    name: string
    memberId: number | null
    points: unknown[]
    startPoint: unknown
    endPoint: unknown
    stats: unknown
    createdAt: string
    updatedAt: string
  }>
  aliases: Array<{
    id: number
    memberId: number
    name: string
    type: 'primary' | 'given' | 'courtesy' | 'art' | 'taboo' | 'alias' | 'other'
    isPreferred: boolean
    note?: string
    rawText?: string
  }>
  relations: Array<{
    id: number
    fromMemberId: number
    toMemberId: number
    type: 'father' | 'mother' | 'spouse' | 'step-parent' | 'adoptive-parent' | 'adopted-child' | 'successor' | 'other'
    status: 'active' | 'ended' | 'uncertain'
    temporalId: number | null
    note?: string
    rawText?: string
  }>
  temporals: Array<{
    id: number
    memberId: number | null
    label: string
    rawText: string
    calendarType: 'gregorian' | 'lunar-era' | 'ganzhi' | 'mixed' | 'unknown'
    normalizedDate?: string
    precision: 'year' | 'month' | 'day' | 'hour' | 'unknown'
    confidence: number
  }>
  burials: Array<{
    id: number
    memberId: number
    temporalId: number | null
    placeRaw: string
    mountainDirection?: string
    fenjin?: string
    note?: string
    rawText?: string
  }>
  nextId: number
  nextTrackId: number
  nextEventId: number
  nextAliasId: number
  nextRelationId: number
  nextTemporalId: number
  nextBurialId: number
}

interface MemberProfileExtension {
  generationLabelRaw?: string
  lineageBranch?: string
  rawNotes?: string
  uncertaintyFlags?: Array<'missing' | 'estimated' | 'conflicting' | 'unverified'>
}

function normalizeUncertaintyFlags(value: unknown): Array<'missing' | 'estimated' | 'conflicting' | 'unverified'> {
  if (!Array.isArray(value)) {
    return []
  }
  const allowed = ['missing', 'estimated', 'conflicting', 'unverified'] as const
  return value.filter(
    (flag): flag is (typeof allowed)[number] => typeof flag === 'string' && allowed.includes(flag as (typeof allowed)[number]),
  )
}

/**
 * 创建 Drizzle 数据库实例
 */
function getDb(env: Env) {
  return drizzle(env.DB)
}

/**
 * 生成 CORS 响应头
 */
function corsHeaders(env: Env): Headers {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*')
  headers.set('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  return headers
}

/**
 * 生成 JSON 响应
 */
function jsonResponse(env: Env, data: unknown, status = 200): Response {
  const headers = corsHeaders(env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  headers.set('Pragma', 'no-cache')
  headers.set('Expires', '0')
  return new Response(JSON.stringify(data), { status, headers })
}

/**
 * 返回未授权响应
 */
function unauthorized(env: Env): Response {
  return jsonResponse(env, { error: '未授权请求' }, 401)
}

/**
 * 检查请求是否授权
 */
function isAuthorized(request: Request, env: Env): boolean {
  const expected = (env.API_TOKEN || '').trim()
  if (!expected) {
    return true
  }
  const auth = request.headers.get('Authorization') || ''
  return auth === `Bearer ${expected}`
}

/**
 * 确保数据库表存在
 */
async function ensureSchema(env: Env): Promise<void> {
  const db = getDb(env)
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER,
        gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
        spouse_ids TEXT DEFAULT '[]',
        birth_date TEXT,
        photo_url TEXT,
        biography TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS family_events (
        id INTEGER PRIMARY KEY,
        member_id INTEGER,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        member_id INTEGER,
        points_json TEXT NOT NULL,
        start_point_json TEXT NOT NULL,
        end_point_json TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS member_profiles (
        member_id INTEGER PRIMARY KEY,
        generation_label_raw TEXT,
        lineage_branch TEXT,
        raw_notes TEXT,
        uncertainty_flags_json TEXT DEFAULT '[]',
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS name_aliases (
        id INTEGER PRIMARY KEY,
        member_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        is_preferred INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        raw_text TEXT,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS temporal_expressions (
        id INTEGER PRIMARY KEY,
        member_id INTEGER,
        label TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        calendar_type TEXT NOT NULL,
        normalized_date TEXT,
        precision TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kinship_relations (
        id INTEGER PRIMARY KEY,
        from_member_id INTEGER NOT NULL,
        to_member_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        temporal_id INTEGER,
        note TEXT,
        raw_text TEXT,
        FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (temporal_id) REFERENCES temporal_expressions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS burial_records (
        id INTEGER PRIMARY KEY,
        member_id INTEGER NOT NULL,
        temporal_id INTEGER,
        place_raw TEXT NOT NULL,
        mountain_direction TEXT,
        fenjin TEXT,
        note TEXT,
        raw_text TEXT,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (temporal_id) REFERENCES temporal_expressions(id) ON DELETE SET NULL
      );
    `)

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_aliases_member_id ON name_aliases(member_id);
      CREATE INDEX IF NOT EXISTS idx_temporals_member_id ON temporal_expressions(member_id);
      CREATE INDEX IF NOT EXISTS idx_relations_from_member_id ON kinship_relations(from_member_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to_member_id ON kinship_relations(to_member_id);
      CREATE INDEX IF NOT EXISTS idx_relations_temporal_id ON kinship_relations(temporal_id);
      CREATE INDEX IF NOT EXISTS idx_burials_member_id ON burial_records(member_id);
      CREATE INDEX IF NOT EXISTS idx_burials_temporal_id ON burial_records(temporal_id);
    `)
  } catch {
    // 如果表已存在，Drizzle 会捕获错误，我们忽略它
  }
}

/**
 * 安全地将值转换为整数
 */
function toInt(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 * 安全地解析 JSON
 */
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * 从数据库读取完整的家族数据
 * 使用 Drizzle ORM 查询所有成员、事件、轨迹及元数据
 */
async function readFamilyData(env: Env): Promise<FamilyData | null> {
  await ensureSchema(env)

  const db = getDb(env)

  // 查询所有成员
  const memberRows = await db.select().from(schema.members).orderBy(schema.members.id).all()

  const members = memberRows.map((row) => ({
    id: row.id,
    name: row.name || '',
    parentId: row.parentId,
    gender: row.gender as '男' | '女',
    spouseIds: parseJson<number[]>(row.spouseIds, []).filter((id) => Number.isInteger(id)),
    birthDate: row.birthDate || '',
    photoUrl: row.photoUrl || '',
    biography: row.biography || '',
  }))

  if (members.length === 0) {
    return null
  }

  // 查询所有轨迹
  const trackRows = await db.select().from(schema.tracks).orderBy(schema.tracks.id).all()

  const tracks = trackRows.map((row) => ({
    id: row.id,
    name: row.name,
    memberId: row.memberId,
    points: parseJson<unknown[]>(row.pointsJson, []),
    startPoint: parseJson<unknown>(row.startPointJson, {}),
    endPoint: parseJson<unknown>(row.endPointJson, {}),
    stats: parseJson<unknown>(row.statsJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))

  // 查询所有事件
  const eventRows = await db
    .select()
    .from(schema.familyEvents)
    .orderBy(desc(schema.familyEvents.date), desc(schema.familyEvents.id))
    .all()

  const events = eventRows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    type: row.type as FamilyData['events'][number]['type'],
    title: row.title,
    date: row.date,
    description: row.description || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))

  const profileRows = await db.select().from(schema.memberProfiles).all()
  const aliasRows = await db.select().from(schema.nameAliases).orderBy(schema.nameAliases.id).all()
  const temporalRows = await db.select().from(schema.temporalExpressions).orderBy(schema.temporalExpressions.id).all()
  const relationRows = await db.select().from(schema.kinshipRelations).orderBy(schema.kinshipRelations.id).all()
  const burialRows = await db.select().from(schema.burialRecords).orderBy(schema.burialRecords.id).all()

  // 查询元数据
  const metaRows = await db.select().from(schema.metadata).all()
  const meta = new Map<string, string>()
  for (const row of metaRows) {
    meta.set(row.key, row.value || '')
  }

  const maxMemberId = members.length > 0 ? Math.max(...members.map((m) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0
  const maxEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 0
  const aliasesFromTable: FamilyData['aliases'] = aliasRows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    name: row.name,
    type: row.type as FamilyData['aliases'][number]['type'],
    isPreferred: row.isPreferred === 1,
    note: row.note || '',
    rawText: row.rawText || '',
  }))
  const relationsFromTable: FamilyData['relations'] = relationRows.map((row) => ({
    id: row.id,
    fromMemberId: row.fromMemberId,
    toMemberId: row.toMemberId,
    type: row.type as FamilyData['relations'][number]['type'],
    status: row.status as FamilyData['relations'][number]['status'],
    temporalId: row.temporalId,
    note: row.note || '',
    rawText: row.rawText || '',
  }))
  const temporalsFromTable: FamilyData['temporals'] = temporalRows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    label: row.label,
    rawText: row.rawText,
    calendarType: row.calendarType as FamilyData['temporals'][number]['calendarType'],
    normalizedDate: row.normalizedDate || '',
    precision: row.precision as FamilyData['temporals'][number]['precision'],
    confidence: typeof row.confidence === 'number' ? row.confidence : 1,
  }))
  const burialsFromTable: FamilyData['burials'] = burialRows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    temporalId: row.temporalId,
    placeRaw: row.placeRaw,
    mountainDirection: row.mountainDirection || '',
    fenjin: row.fenjin || '',
    note: row.note || '',
    rawText: row.rawText || '',
  }))

  const aliases = aliasesFromTable.length > 0 ? aliasesFromTable : parseJson<FamilyData['aliases']>(meta.get('aliases_json'), [])
  const relations =
    relationsFromTable.length > 0 ? relationsFromTable : parseJson<FamilyData['relations']>(meta.get('relations_json'), [])
  const temporals =
    temporalsFromTable.length > 0 ? temporalsFromTable : parseJson<FamilyData['temporals']>(meta.get('temporals_json'), [])
  const burials = burialsFromTable.length > 0 ? burialsFromTable : parseJson<FamilyData['burials']>(meta.get('burials_json'), [])

  const memberProfilesFromTable: Record<string, MemberProfileExtension> = Object.fromEntries(
    profileRows.map((row) => [
      String(row.memberId),
      {
        generationLabelRaw: row.generationLabelRaw || '',
        lineageBranch: row.lineageBranch || '',
        rawNotes: row.rawNotes || '',
        uncertaintyFlags: normalizeUncertaintyFlags(parseJson(row.uncertaintyFlagsJson, [])),
      },
    ]),
  )
  const memberProfiles =
    Object.keys(memberProfilesFromTable).length > 0
      ? memberProfilesFromTable
      : parseJson<Record<string, MemberProfileExtension>>(meta.get('member_profiles_json'), {})

  const membersWithExtensions = members.map((member) => {
    const extension = memberProfiles[String(member.id)]
    return {
      ...member,
      generationLabelRaw: typeof extension?.generationLabelRaw === 'string' ? extension.generationLabelRaw : '',
      lineageBranch: typeof extension?.lineageBranch === 'string' ? extension.lineageBranch : '',
      rawNotes: typeof extension?.rawNotes === 'string' ? extension.rawNotes : '',
      uncertaintyFlags: normalizeUncertaintyFlags(extension?.uncertaintyFlags),
    }
  })

  const maxAliasId = aliases.length > 0 ? Math.max(...aliases.map((item) => item.id)) : 0
  const maxRelationId = relations.length > 0 ? Math.max(...relations.map((item) => item.id)) : 0
  const maxTemporalId = temporals.length > 0 ? Math.max(...temporals.map((item) => item.id)) : 0
  const maxBurialId = burials.length > 0 ? Math.max(...burials.map((item) => item.id)) : 0

  return {
    schemaVersion: toInt(meta.get('schema_version'), 3),
    members: membersWithExtensions,
    events,
    tracks,
    aliases,
    relations,
    temporals,
    burials,
    nextId: Math.max(toInt(meta.get('next_id'), maxMemberId + 1), maxMemberId + 1),
    nextTrackId: Math.max(toInt(meta.get('next_track_id'), maxTrackId + 1), maxTrackId + 1),
    nextEventId: Math.max(toInt(meta.get('next_event_id'), maxEventId + 1), maxEventId + 1),
    nextAliasId: Math.max(toInt(meta.get('next_alias_id'), maxAliasId + 1), maxAliasId + 1),
    nextRelationId: Math.max(toInt(meta.get('next_relation_id'), maxRelationId + 1), maxRelationId + 1),
    nextTemporalId: Math.max(toInt(meta.get('next_temporal_id'), maxTemporalId + 1), maxTemporalId + 1),
    nextBurialId: Math.max(toInt(meta.get('next_burial_id'), maxBurialId + 1), maxBurialId + 1),
  }
}

/**
 * 将完整的家族数据写入数据库
 * 使用 Drizzle ORM 进行事务性操作：
 * 1. 删除所有现有数据（成员、事件、轨迹）
 * 2. 批量插入新的成员、事件、轨迹
 * 3. 更新元数据
 */
async function writeFamilyData(env: Env, data: FamilyData): Promise<void> {
  await ensureSchema(env)

  const db = getDb(env)
  const nowTs = Math.floor(Date.now() / 1000)

  // 执行删除操作
  await db.delete(schema.kinshipRelations).run()
  await db.delete(schema.burialRecords).run()
  await db.delete(schema.temporalExpressions).run()
  await db.delete(schema.nameAliases).run()
  await db.delete(schema.memberProfiles).run()
  await db.delete(schema.tracks).run()
  await db.delete(schema.familyEvents).run()
  await db.delete(schema.members).run()

  // 批量插入成员
  if (data.members.length > 0) {
    await db
      .insert(schema.members)
      .values(
        data.members.map((member) => ({
          id: member.id,
          name: member.name,
          parentId: member.parentId,
          gender: member.gender,
          spouseIds: JSON.stringify(member.spouseIds || []),
          birthDate: member.birthDate || null,
          photoUrl: member.photoUrl || null,
          biography: member.biography || null,
          createdAt: nowTs,
          updatedAt: nowTs,
        })),
      )
      .run()
  }

  // 批量插入事件
  if (data.events && data.events.length > 0) {
    await db
      .insert(schema.familyEvents)
      .values(
        data.events.map((event) => ({
          id: event.id,
          memberId: event.memberId,
          type: event.type,
          title: event.title,
          date: event.date,
          description: event.description || null,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
        })),
      )
      .run()
  }

  if (data.temporals && data.temporals.length > 0) {
    await db
      .insert(schema.temporalExpressions)
      .values(
        data.temporals.map((temporal) => ({
          id: temporal.id,
          memberId: temporal.memberId,
          label: temporal.label,
          rawText: temporal.rawText,
          calendarType: temporal.calendarType,
          normalizedDate: temporal.normalizedDate || null,
          precision: temporal.precision,
          confidence: temporal.confidence,
        })),
      )
      .run()
  }

  if (data.aliases && data.aliases.length > 0) {
    await db
      .insert(schema.nameAliases)
      .values(
        data.aliases.map((alias) => ({
          id: alias.id,
          memberId: alias.memberId,
          name: alias.name,
          type: alias.type,
          isPreferred: alias.isPreferred ? 1 : 0,
          note: alias.note || null,
          rawText: alias.rawText || null,
        })),
      )
      .run()
  }

  if (data.relations && data.relations.length > 0) {
    await db
      .insert(schema.kinshipRelations)
      .values(
        data.relations.map((relation) => ({
          id: relation.id,
          fromMemberId: relation.fromMemberId,
          toMemberId: relation.toMemberId,
          type: relation.type,
          status: relation.status,
          temporalId: relation.temporalId,
          note: relation.note || null,
          rawText: relation.rawText || null,
        })),
      )
      .run()
  }

  if (data.burials && data.burials.length > 0) {
    await db
      .insert(schema.burialRecords)
      .values(
        data.burials.map((burial) => ({
          id: burial.id,
          memberId: burial.memberId,
          temporalId: burial.temporalId,
          placeRaw: burial.placeRaw,
          mountainDirection: burial.mountainDirection || null,
          fenjin: burial.fenjin || null,
          note: burial.note || null,
          rawText: burial.rawText || null,
        })),
      )
      .run()
  }

  if (data.members && data.members.length > 0) {
    await db
      .insert(schema.memberProfiles)
      .values(
        data.members.map((member) => ({
          memberId: member.id,
          generationLabelRaw: member.generationLabelRaw || null,
          lineageBranch: member.lineageBranch || null,
          rawNotes: member.rawNotes || null,
          uncertaintyFlagsJson: JSON.stringify(normalizeUncertaintyFlags(member.uncertaintyFlags)),
        })),
      )
      .run()
  }

  // 批量插入轨迹
  if (data.tracks && data.tracks.length > 0) {
    await db
      .insert(schema.tracks)
      .values(
        data.tracks.map((track) => ({
          id: track.id,
          name: track.name,
          memberId: track.memberId,
          pointsJson: JSON.stringify(track.points || []),
          startPointJson: JSON.stringify(track.startPoint || {}),
          endPointJson: JSON.stringify(track.endPoint || {}),
          statsJson: JSON.stringify(track.stats || {}),
          createdAt: track.createdAt,
          updatedAt: track.updatedAt,
        })),
      )
      .run()
  }

  // 更新元数据
  const metadataUpdates = [
    { key: 'schema_version', value: String(data.schemaVersion) },
    { key: 'next_id', value: String(data.nextId) },
    { key: 'next_track_id', value: String(data.nextTrackId) },
    { key: 'next_event_id', value: String(data.nextEventId) },
    { key: 'next_alias_id', value: String(data.nextAliasId) },
    { key: 'next_relation_id', value: String(data.nextRelationId) },
    { key: 'next_temporal_id', value: String(data.nextTemporalId) },
    { key: 'next_burial_id', value: String(data.nextBurialId) },
    { key: 'aliases_json', value: JSON.stringify(data.aliases ?? []) },
    { key: 'relations_json', value: JSON.stringify(data.relations ?? []) },
    { key: 'temporals_json', value: JSON.stringify(data.temporals ?? []) },
    { key: 'burials_json', value: JSON.stringify(data.burials ?? []) },
    {
      key: 'member_profiles_json',
      value: JSON.stringify(
        Object.fromEntries(
          (data.members ?? []).map((member) => [
            String(member.id),
            {
              generationLabelRaw: member.generationLabelRaw ?? '',
              lineageBranch: member.lineageBranch ?? '',
              rawNotes: member.rawNotes ?? '',
              uncertaintyFlags: normalizeUncertaintyFlags(member.uncertaintyFlags),
            },
          ]),
        ),
      ),
    },
    { key: 'last_sync_time', value: new Date().toISOString() },
  ]

  for (const { key, value } of metadataUpdates) {
    await db
      .insert(schema.metadata)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.metadata.key, set: { value } })
      .run()
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }

    if (!isAuthorized(request, env)) {
      return unauthorized(env)
    }

    const url = new URL(request.url)

    try {
      if (request.method === 'GET' && url.pathname === '/api/family-data') {
        const data = await readFamilyData(env)
        return jsonResponse(env, { data })
      }

      if (request.method === 'PUT' && url.pathname === '/api/family-data') {
        const payload = (await request.json()) as { data?: FamilyData }
        if (!payload || !payload.data) {
          return jsonResponse(env, { error: '请求体缺少 data' }, 400)
        }
        await writeFamilyData(env, payload.data)
        return jsonResponse(env, { ok: true })
      }

      return jsonResponse(env, { error: '未找到接口' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D1 服务内部错误'
      return jsonResponse(env, { error: message }, 500)
    }
  },
}
