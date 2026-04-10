interface Env {
  DB: D1Database
  API_TOKEN?: string
}

interface GpxPoint {
  lat: number
  lng: number
  ele?: number
  time?: string
}

interface TrackStats {
  distanceMeters: number
  pointCount: number
  elevationGainMeters: number | null
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
    points: GpxPoint[]
    startPoint: GpxPoint
    endPoint: GpxPoint
    stats: TrackStats
    createdAt: string
    updatedAt: string
  }>
  nextId: number
  nextTrackId: number
  nextEventId: number
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = (env.API_TOKEN || '').trim()
  if (!expected) return true
  const auth = request.headers.get('Authorization') || ''
  return auth === `Bearer ${expected}`
}

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER,
      gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
      spouse_ids TEXT DEFAULT '[]',
      birth_date TEXT,
      photo_url TEXT,
      biography TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS family_events (
      id INTEGER PRIMARY KEY,
      member_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      member_id INTEGER,
      points_json TEXT NOT NULL,
      start_point_json TEXT NOT NULL,
      end_point_json TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )`),
  ])
}

async function readFamilyData(db: D1Database): Promise<FamilyData | null> {
  await ensureSchema(db)

  const memberRows = await db.prepare('SELECT * FROM members ORDER BY id').all<{
    id: number
    name: string
    parent_id: number | null
    gender: string
    spouse_ids: string
    birth_date: string | null
    photo_url: string | null
    biography: string | null
  }>()

  const members = (memberRows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name || '',
    parentId: row.parent_id,
    gender: row.gender as '男' | '女',
    spouseIds: parseJson<number[]>(row.spouse_ids, []).filter((id) => Number.isInteger(id)),
    birthDate: row.birth_date || '',
    photoUrl: row.photo_url || '',
    biography: row.biography || '',
  }))

  if (members.length === 0) return null

  const trackRows = await db.prepare('SELECT * FROM tracks ORDER BY id').all<{
    id: number
    name: string
    member_id: number | null
    points_json: string
    start_point_json: string
    end_point_json: string
    stats_json: string
    created_at: string
    updated_at: string
  }>()

  const tracks = (trackRows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    memberId: row.member_id,
    points: parseJson<GpxPoint[]>(row.points_json, []),
    startPoint: parseJson<GpxPoint>(row.start_point_json, { lat: 0, lng: 0 }),
    endPoint: parseJson<GpxPoint>(row.end_point_json, { lat: 0, lng: 0 }),
    stats: parseJson<TrackStats>(row.stats_json, { distanceMeters: 0, pointCount: 0, elevationGainMeters: null }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  const eventRows = await db
    .prepare('SELECT * FROM family_events ORDER BY date DESC, id DESC')
    .all<{
      id: number
      member_id: number | null
      type: string
      title: string
      date: string
      description: string | null
      created_at: string
      updated_at: string
    }>()

  const events = (eventRows.results ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    type: row.type as FamilyData['events'][number]['type'],
    title: row.title,
    date: row.date,
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  const metaRows = await db.prepare('SELECT key, value FROM metadata').all<{ key: string; value: string }>()
  const meta = new Map<string, string>()
  for (const row of metaRows.results ?? []) {
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

async function writeFamilyData(db: D1Database, data: FamilyData): Promise<void> {
  await ensureSchema(db)

  const nowTs = Math.floor(Date.now() / 1000)

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM tracks'),
    db.prepare('DELETE FROM family_events'),
    db.prepare('DELETE FROM members'),
  ]

  for (const member of data.members) {
    statements.push(
      db
        .prepare(
          'INSERT INTO members (id, name, parent_id, gender, spouse_ids, birth_date, photo_url, biography, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          member.id,
          member.name,
          member.parentId,
          member.gender,
          JSON.stringify(member.spouseIds || []),
          member.birthDate || null,
          member.photoUrl || null,
          member.biography || null,
          nowTs,
          nowTs,
        ),
    )
  }

  for (const event of data.events ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO family_events (id, member_id, type, title, date, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          event.id,
          event.memberId,
          event.type,
          event.title,
          event.date,
          event.description || null,
          event.createdAt,
          event.updatedAt,
        ),
    )
  }

  for (const track of data.tracks ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO tracks (id, name, member_id, points_json, start_point_json, end_point_json, stats_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

  const metaEntries = [
    ['schema_version', String(data.schemaVersion)],
    ['next_id', String(data.nextId)],
    ['next_track_id', String(data.nextTrackId)],
    ['next_event_id', String(data.nextEventId)],
    ['last_sync_time', new Date().toISOString()],
  ]

  for (const [key, value] of metaEntries) {
    statements.push(
      db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value),
    )
  }

  await db.batch(statements)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 })
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: '未授权请求' }, 401)
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/family-data') {
        const data = await readFamilyData(env.DB)
        return jsonResponse({ data })
      }

      if (request.method === 'PUT' && url.pathname === '/api/family-data') {
        const payload = (await request.json()) as { data?: FamilyData }
        if (!payload?.data) {
          return jsonResponse({ error: '请求体缺少 data' }, 400)
        }
        await writeFamilyData(env.DB, payload.data)
        return jsonResponse({ ok: true })
      }

      return jsonResponse({ error: '未找到接口' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D1 服务内部错误'
      return jsonResponse({ error: message }, 500)
    }
  },
}