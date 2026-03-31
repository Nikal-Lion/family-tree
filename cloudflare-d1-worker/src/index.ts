interface D1QueryResult<T> {
  results?: T[]
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<D1QueryResult<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
  exec(query: string): Promise<unknown>
}

interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
  API_TOKEN?: string
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

function corsHeaders(env: Env): Headers {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*')
  headers.set('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  return headers
}

function jsonResponse(env: Env, data: unknown, status = 200): Response {
  const headers = corsHeaders(env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { status, headers })
}

function unauthorized(env: Env): Response {
  return jsonResponse(env, { error: '未授权请求' }, 401)
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = (env.API_TOKEN || '').trim()
  if (!expected) {
    return true
  }
  const auth = request.headers.get('Authorization') || ''
  return auth === `Bearer ${expected}`
}

async function ensureSchema(env: Env): Promise<void> {
  await env.DB.exec(`
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
}

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

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

async function readFamilyData(env: Env): Promise<FamilyData | null> {
  await ensureSchema(env)

  const memberRows = await env.DB.prepare(
    `SELECT
      id,
      name,
      parent_id,
      gender,
      spouse_ids,
      birth_date,
      photo_url,
      biography
    FROM members
    ORDER BY id ASC;`,
  ).all<Record<string, unknown>>()
  const members = (memberRows.results || []).map((row: Record<string, unknown>) => {
    const gender: '男' | '女' = row.gender === '女' ? '女' : '男'
    return {
      id: toInt(row.id),
      name: String(row.name || ''),
      parentId: row.parent_id === null ? null : toInt(row.parent_id),
      gender,
      spouseIds: parseJson<number[]>(row.spouse_ids, []).filter((id) => Number.isInteger(id)),
      birthDate: String(row.birth_date || ''),
      photoUrl: String(row.photo_url || ''),
      biography: String(row.biography || ''),
    }
  })

  if (members.length === 0) {
    return null
  }

  const trackRows = await env.DB.prepare(
    `SELECT
      id,
      name,
      member_id,
      points_json,
      start_point_json,
      end_point_json,
      stats_json,
      created_at,
      updated_at
    FROM tracks
    ORDER BY id ASC;`,
  ).all<Record<string, unknown>>()

  const tracks = (trackRows.results || []).map((row: Record<string, unknown>) => ({
    id: toInt(row.id),
    name: String(row.name || ''),
    memberId: row.member_id === null ? null : toInt(row.member_id),
    points: parseJson<unknown[]>(row.points_json, []),
    startPoint: parseJson<unknown>(row.start_point_json, {}),
    endPoint: parseJson<unknown>(row.end_point_json, {}),
    stats: parseJson<unknown>(row.stats_json, {}),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }))

  const eventRows = await env.DB.prepare(
    `SELECT
      id,
      member_id,
      type,
      title,
      date,
      description,
      created_at,
      updated_at
    FROM family_events
    ORDER BY date DESC, id DESC;`,
  ).all<Record<string, unknown>>()

  const events = (eventRows.results || []).map((row: Record<string, unknown>) => ({
    id: toInt(row.id),
    memberId: row.member_id === null ? null : toInt(row.member_id),
    type: String(row.type || '其他') as FamilyData['events'][number]['type'],
    title: String(row.title || ''),
    date: String(row.date || ''),
    description: String(row.description || ''),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }))

  const metaRows = await env.DB.prepare('SELECT key, value FROM metadata;').all<Record<string, unknown>>()
  const meta = new Map<string, string>()
  for (const row of metaRows.results || []) {
    meta.set(String(row.key), String(row.value || ''))
  }

  const maxMemberId = members.length > 0 ? Math.max(...members.map((m: { id: number }) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t: { id: number }) => t.id)) : 0
  const maxEventId = events.length > 0 ? Math.max(...events.map((e: { id: number }) => e.id)) : 0

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

async function writeFamilyData(env: Env, data: FamilyData): Promise<void> {
  await ensureSchema(env)

  const statements: D1PreparedStatement[] = []
  const nowTs = Math.floor(Date.now() / 1000)

  statements.push(env.DB.prepare('DELETE FROM tracks;'))
  statements.push(env.DB.prepare('DELETE FROM family_events;'))
  statements.push(env.DB.prepare('DELETE FROM members;'))

  for (const member of data.members) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO members (
            id,
            name,
            parent_id,
            gender,
            spouse_ids,
            birth_date,
            photo_url,
            biography,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .bind(
          member.id,
          member.name,
          member.parentId,
          member.gender,
          JSON.stringify(member.spouseIds || []),
          member.birthDate || '',
          member.photoUrl || '',
          member.biography || '',
          nowTs,
          nowTs,
        ),
    )
  }

  for (const event of data.events || []) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO family_events (
            id,
            member_id,
            type,
            title,
            date,
            description,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .bind(
          event.id,
          event.memberId,
          event.type,
          event.title,
          event.date,
          event.description || '',
          event.createdAt,
          event.updatedAt,
        ),
    )
  }

  for (const track of data.tracks) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO tracks (
            id,
            name,
            member_id,
            points_json,
            start_point_json,
            end_point_json,
            stats_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .bind(
          track.id,
          track.name,
          track.memberId,
          JSON.stringify(track.points || []),
          JSON.stringify(track.startPoint || {}),
          JSON.stringify(track.endPoint || {}),
          JSON.stringify(track.stats || {}),
          track.createdAt,
          track.updatedAt,
        ),
    )
  }

  statements.push(env.DB.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);').bind('schema_version', String(data.schemaVersion)))
  statements.push(env.DB.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);').bind('next_id', String(data.nextId)))
  statements.push(env.DB.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);').bind('next_track_id', String(data.nextTrackId)))
  statements.push(env.DB.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);').bind('next_event_id', String(data.nextEventId)))
  statements.push(env.DB.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);').bind('last_sync_time', new Date().toISOString()))

  await env.DB.batch(statements)
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
