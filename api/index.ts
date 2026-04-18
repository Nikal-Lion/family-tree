interface Env {
  DB: D1Database
  API_TOKEN?: string
  SYSADMIN_PASSWORD_HASH?: string
  SESSION_TTL_HOURS?: string
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

type LoginUserRole = 'user' | 'sysadmin'

interface LoginUserRecord {
  id: number
  mobile: string
  role: LoginUserRole
  enabled: number
  created_at: string
  updated_at: string
}

interface LoginUserView {
  id: number
  mobile: string
  role: LoginUserRole
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface AuthContext {
  authenticated: boolean
  role: LoginUserRole | 'anonymous'
  user: LoginUserView | null
  sessionId: number | null
  legacyToken: boolean
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

function errorResponse(message: string, status = 400, code?: string): Response {
  return jsonResponse({ error: message, code }, status)
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) {
    return null
  }
  const token = auth.slice('Bearer '.length).trim()
  return token || null
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

function nowIso(): string {
  return new Date().toISOString()
}

function toIsoAfterHours(hours: number): string {
  const future = Date.now() + hours * 60 * 60 * 1000
  return new Date(future).toISOString()
}

function getSessionTtlHours(env: Env): number {
  const value = Number(env.SESSION_TTL_HOURS)
  if (!Number.isFinite(value)) {
    return 24
  }
  return Math.min(720, Math.max(1, Math.floor(value)))
}

function normalizeMobile(input: unknown): string {
  if (typeof input !== 'string') {
    return ''
  }
  return input.trim().replace(/\s+/g, '')
}

function isValidMobile(mobile: string): boolean {
  return /^\+?[0-9]{6,20}$/.test(mobile)
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toLoginUserView(row: LoginUserRecord): LoginUserView {
  return {
    id: row.id,
    mobile: row.mobile,
    role: row.role,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function findLoginUserByMobile(db: D1Database, mobile: string): Promise<LoginUserRecord | null> {
  const rows = await db
    .prepare(
      'SELECT id, mobile, role, enabled, created_at, updated_at FROM login_users WHERE mobile = ? LIMIT 1',
    )
    .bind(mobile)
    .all<LoginUserRecord>()

  return rows.results?.[0] ?? null
}

async function findLoginUserById(db: D1Database, id: number): Promise<LoginUserRecord | null> {
  const rows = await db
    .prepare('SELECT id, mobile, role, enabled, created_at, updated_at FROM login_users WHERE id = ? LIMIT 1')
    .bind(id)
    .all<LoginUserRecord>()

  return rows.results?.[0] ?? null
}

async function countSysadmins(db: D1Database): Promise<number> {
  const rows = await db
    .prepare("SELECT COUNT(1) AS count FROM login_users WHERE role = 'sysadmin' AND enabled = 1")
    .all<{ count: number }>()
  return toInt(rows.results?.[0]?.count, 0)
}

async function createSessionForUser(
  db: D1Database,
  userId: number,
  env: Env,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken()
  const tokenHash = await sha256Hex(token)
  const createdAt = nowIso()
  const updatedAt = createdAt
  const expiresAt = toIsoAfterHours(getSessionTtlHours(env))

  await db.batch([
    db
      .prepare(
        'INSERT INTO auth_sessions (token_hash, user_id, expires_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
      )
      .bind(tokenHash, userId, expiresAt, createdAt, updatedAt),
    db
      .prepare('DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?')
      .bind(createdAt),
  ])

  return { token, expiresAt }
}

async function verifySysadminPassword(password: string, env: Env): Promise<boolean> {
  const expectedHash = (env.SYSADMIN_PASSWORD_HASH || '').trim().toLowerCase()
  if (!expectedHash) {
    const error = new Error('SYSADMIN_PASSWORD_HASH is not configured')
    ;(error as Error & { code?: string }).code = 'SYSADMIN_PASSWORD_HASH_MISSING'
    throw error
  }
  const actual = await sha256Hex(password)
  return actual === expectedHash
}

async function resolveAuth(request: Request, env: Env): Promise<AuthContext> {
  const token = getBearerToken(request)
  if (!token) {
    return {
      authenticated: false,
      role: 'anonymous',
      user: null,
      sessionId: null,
      legacyToken: false,
    }
  }

  const expectedLegacyToken = (env.API_TOKEN || '').trim()
  if (expectedLegacyToken && token === expectedLegacyToken) {
    return {
      authenticated: true,
      role: 'sysadmin',
      user: {
        id: 0,
        mobile: 'legacy-token',
        role: 'sysadmin',
        enabled: true,
        createdAt: '',
        updatedAt: '',
      },
      sessionId: null,
      legacyToken: true,
    }
  }

  const tokenHash = await sha256Hex(token)
  const currentTime = nowIso()
  const rows = await env.DB
    .prepare(
      `SELECT s.id AS session_id, u.id, u.mobile, u.role, u.enabled, u.created_at, u.updated_at
       FROM auth_sessions s
       JOIN login_users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND u.enabled = 1
       LIMIT 1`,
    )
    .bind(tokenHash, currentTime)
    .all<
      LoginUserRecord & {
        session_id: number
      }
    >()

  const hit = rows.results?.[0]
  if (!hit) {
    return {
      authenticated: false,
      role: 'anonymous',
      user: null,
      sessionId: null,
      legacyToken: false,
    }
  }

  await env.DB
    .prepare('UPDATE auth_sessions SET updated_at = ? WHERE id = ?')
    .bind(currentTime, hit.session_id)
    .all()

  return {
    authenticated: true,
    role: hit.role,
    user: toLoginUserView(hit),
    sessionId: hit.session_id,
    legacyToken: false,
  }
}

function requireSysadmin(auth: AuthContext): Response | null {
  if (!auth.authenticated) {
    return errorResponse('未登录', 401, 'AUTH_REQUIRED')
  }
  if (auth.role !== 'sysadmin') {
    return errorResponse('需要 sysadmin 权限', 403, 'FORBIDDEN')
  }
  return null
}

function parseJsonBody<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as T
}

function parseLoginUserId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/login-users\/(\d+)$/)
  if (!match) {
    return null
  }
  return toInt(match[1], -1)
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
    db.prepare(`CREATE TABLE IF NOT EXISTS login_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('user', 'sysadmin')) DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES login_users(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_member_id ON family_events(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_date ON family_events(date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tracks_member_id ON tracks(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_login_users_role_enabled ON login_users(role, enabled)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)'),
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

    try {
      await ensureSchema(env.DB)
      const auth = await resolveAuth(request, env)

      if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-sysadmin') {
        const payload = parseJsonBody<{ mobile?: string; password?: string }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const mobile = normalizeMobile(payload.mobile)
        const password = typeof payload.password === 'string' ? payload.password : ''

        if (!isValidMobile(mobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }

        if (!password) {
          return errorResponse('sysadmin 密码不能为空', 400, 'PASSWORD_REQUIRED')
        }

        const existingSysadminResult = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM login_users WHERE role = 'sysadmin'")
          .all<{ count: number | string }>()
        const existingSysadminCount = Number(existingSysadminResult.results?.[0]?.count ?? 0)
        if (existingSysadminCount > 0) {
          return errorResponse('sysadmin 已初始化', 409, 'SYSADMIN_EXISTS')
        }

        const validPassword = await verifySysadminPassword(password, env)
        if (!validPassword) {
          return errorResponse('sysadmin 密码校验失败', 401, 'INVALID_SYSADMIN_PASSWORD')
        }

        const createdAt = nowIso()
        await env.DB
          .prepare("INSERT INTO login_users (mobile, role, enabled, created_at, updated_at) VALUES (?, 'sysadmin', 1, ?, ?)")
          .bind(mobile, createdAt, createdAt)
          .all()

        const created = await findLoginUserByMobile(env.DB, mobile)
        if (!created) {
          return errorResponse('sysadmin 初始化失败', 500, 'BOOTSTRAP_FAILED')
        }

        const session = await createSessionForUser(env.DB, created.id, env)
        return jsonResponse({
          ok: true,
          token: session.token,
          expiresAt: session.expiresAt,
          user: toLoginUserView(created),
        })
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const payload = parseJsonBody<{ mobile?: string; password?: string }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const mobile = normalizeMobile(payload.mobile)
        if (!isValidMobile(mobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }

        const user = await findLoginUserByMobile(env.DB, mobile)
        if (!user || user.enabled !== 1) {
          return errorResponse('登录失败：手机号不存在或已禁用', 401, 'LOGIN_FAILED')
        }

        if (user.role === 'sysadmin') {
          const password = typeof payload.password === 'string' ? payload.password : ''
          if (!password) {
            return errorResponse('sysadmin 登录需要密码', 401, 'PASSWORD_REQUIRED')
          }

          const validPassword = await verifySysadminPassword(password, env)
          if (!validPassword) {
            return errorResponse('sysadmin 密码错误', 401, 'INVALID_SYSADMIN_PASSWORD')
          }
        }

        const session = await createSessionForUser(env.DB, user.id, env)

        return jsonResponse({
          ok: true,
          token: session.token,
          expiresAt: session.expiresAt,
          user: toLoginUserView(user),
        })
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/session') {
        if (!auth.authenticated || !auth.user) {
          return errorResponse('未登录', 401, 'AUTH_REQUIRED')
        }
        return jsonResponse({ ok: true, user: auth.user })
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        if (auth.authenticated && !auth.legacyToken && auth.sessionId !== null) {
          const revokedAt = nowIso()
          await env.DB
            .prepare('UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?')
            .bind(revokedAt, revokedAt, auth.sessionId)
            .all()
        }
        return jsonResponse({ ok: true })
      }

      if (request.method === 'GET' && url.pathname === '/api/login-users') {
        const denied = requireSysadmin(auth)
        if (denied) {
          return denied
        }

        const rows = await env.DB
          .prepare(
            'SELECT id, mobile, role, enabled, created_at, updated_at FROM login_users ORDER BY role DESC, id ASC',
          )
          .all<LoginUserRecord>()

        return jsonResponse({ users: (rows.results ?? []).map(toLoginUserView) })
      }

      if (request.method === 'POST' && url.pathname === '/api/login-users') {
        const denied = requireSysadmin(auth)
        if (denied) {
          return denied
        }

        const payload = parseJsonBody<{ mobile?: string; role?: LoginUserRole }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const mobile = normalizeMobile(payload.mobile)
        const role: LoginUserRole = payload.role === 'sysadmin' ? 'sysadmin' : 'user'
        if (!isValidMobile(mobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }

        const existing = await findLoginUserByMobile(env.DB, mobile)
        if (existing) {
          return errorResponse('手机号已存在', 409, 'DUPLICATE_MOBILE')
        }

        const createdAt = nowIso()
        await env.DB
          .prepare('INSERT INTO login_users (mobile, role, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
          .bind(mobile, role, createdAt, createdAt)
          .all()

        const created = await findLoginUserByMobile(env.DB, mobile)
        if (!created) {
          return errorResponse('创建登录用户失败', 500, 'CREATE_FAILED')
        }

        return jsonResponse({ ok: true, user: toLoginUserView(created) }, 201)
      }

      const loginUserId = parseLoginUserId(url.pathname)
      if (loginUserId !== null && request.method === 'PUT') {
        const denied = requireSysadmin(auth)
        if (denied) {
          return denied
        }

        if (loginUserId <= 0) {
          return errorResponse('用户 ID 无效', 400, 'INVALID_ID')
        }

        const target = await findLoginUserById(env.DB, loginUserId)
        if (!target) {
          return errorResponse('登录用户不存在', 404, 'NOT_FOUND')
        }

        const payload = parseJsonBody<{ mobile?: string; role?: LoginUserRole; enabled?: boolean }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const nextMobile = payload.mobile !== undefined ? normalizeMobile(payload.mobile) : target.mobile
        const nextRole: LoginUserRole =
          payload.role === 'sysadmin' ? 'sysadmin' : payload.role === 'user' ? 'user' : target.role
        const nextEnabled = payload.enabled === undefined ? target.enabled === 1 : Boolean(payload.enabled)

        if (!isValidMobile(nextMobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }

        if (nextMobile !== target.mobile) {
          const duplicated = await findLoginUserByMobile(env.DB, nextMobile)
          if (duplicated) {
            return errorResponse('手机号已存在', 409, 'DUPLICATE_MOBILE')
          }
        }

        const willLoseSysadmin = target.role === 'sysadmin' && target.enabled === 1 && (nextRole !== 'sysadmin' || !nextEnabled)
        if (willLoseSysadmin) {
          const enabledSysadmins = await countSysadmins(env.DB)
          if (enabledSysadmins <= 1) {
            return errorResponse('至少保留一个启用中的 sysadmin', 400, 'LAST_SYSADMIN')
          }
        }

        const updatedAt = nowIso()
        await env.DB
          .prepare('UPDATE login_users SET mobile = ?, role = ?, enabled = ?, updated_at = ? WHERE id = ?')
          .bind(nextMobile, nextRole, nextEnabled ? 1 : 0, updatedAt, loginUserId)
          .all()

        if (!nextEnabled) {
          await env.DB
            .prepare('UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL')
            .bind(updatedAt, updatedAt, loginUserId)
            .all()
        }

        const updated = await findLoginUserById(env.DB, loginUserId)
        if (!updated) {
          return errorResponse('更新登录用户失败', 500, 'UPDATE_FAILED')
        }

        return jsonResponse({ ok: true, user: toLoginUserView(updated) })
      }

      if (loginUserId !== null && request.method === 'DELETE') {
        const denied = requireSysadmin(auth)
        if (denied) {
          return denied
        }

        if (loginUserId <= 0) {
          return errorResponse('用户 ID 无效', 400, 'INVALID_ID')
        }

        const target = await findLoginUserById(env.DB, loginUserId)
        if (!target) {
          return errorResponse('登录用户不存在', 404, 'NOT_FOUND')
        }

        if (target.role === 'sysadmin' && target.enabled === 1) {
          const enabledSysadmins = await countSysadmins(env.DB)
          if (enabledSysadmins <= 1) {
            return errorResponse('至少保留一个启用中的 sysadmin', 400, 'LAST_SYSADMIN')
          }
        }

        await env.DB.batch([
          env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(loginUserId),
          env.DB.prepare('DELETE FROM login_users WHERE id = ?').bind(loginUserId),
        ])

        return jsonResponse({ ok: true })
      }

      if (request.method === 'GET' && url.pathname === '/api/family-data') {
        if (!auth.authenticated) {
          return errorResponse('未登录，无法读取数据', 401, 'AUTH_REQUIRED')
        }
        const data = await readFamilyData(env.DB)
        return jsonResponse({ data })
      }

      if (request.method === 'PUT' && url.pathname === '/api/family-data') {
        if (!auth.authenticated) {
          return errorResponse('未登录，无法写入数据', 401, 'AUTH_REQUIRED')
        }
        if (auth.role !== 'sysadmin') {
          return errorResponse('仅 sysadmin 可写入数据', 403, 'FORBIDDEN')
        }

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
