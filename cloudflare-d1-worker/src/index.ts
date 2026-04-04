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
  nextId: number
  nextTrackId: number
  nextEventId: number
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

  // 查询元数据
  const metaRows = await db.select().from(schema.metadata).all()
  const meta = new Map<string, string>()
  for (const row of metaRows) {
    meta.set(row.key, row.value || '')
  }

  const maxMemberId = members.length > 0 ? Math.max(...members.map((m) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0
  const maxEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 0

  return {
    schemaVersion: toInt(meta.get('schema_version'), 2),
    members,
    events,
    tracks,
    nextId: Math.max(toInt(meta.get('next_id'), maxMemberId + 1), maxMemberId + 1),
    nextTrackId: Math.max(toInt(meta.get('next_track_id'), maxTrackId + 1), maxTrackId + 1),
    nextEventId: Math.max(toInt(meta.get('next_event_id'), maxEventId + 1), maxEventId + 1),
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
