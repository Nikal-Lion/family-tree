import type { BurialRecord, FamilyData, GpxPoint, KinshipRelation, NameAlias, TemporalExpression, TrackStats, UncertaintyFlag } from '../src/types/member'
import type { Spouse } from '../src/types/spouse'
import type { ChildClaim } from '../src/types/childClaim'
import { FamilyDataValidationError, normalizeFamilyData } from '../src/services/importExport'
import { FAMILY_BROWSE_CONTRACT_VERSION, isCompleteFamilySnapshot, toFamilyBrowseData } from '../src/services/familyBrowseData'

interface Env {
  DB: D1Database
  API_TOKEN?: string
  ALLOW_LEGACY_API_TOKEN_AUTH?: string
  SYSADMIN_PASSWORD_PBKDF2?: string
  SYSADMIN_PASSWORD_PBKDF2_NEXT?: string
  SESSION_TTL_HOURS?: string
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1QueryResult<unknown>[]>
  exec(query: string): Promise<unknown>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<D1QueryResult<T>>
}

interface D1QueryResult<T> {
  results?: T[]
}

interface MemberProfileExtension {
  generationLabelRaw?: string
  lineageBranch?: string
  rawNotes?: string
  uncertaintyFlags?: UncertaintyFlag[]
}

function normalizeUncertaintyFlags(value: unknown): UncertaintyFlag[] {
  if (!Array.isArray(value)) {
    return []
  }

  const allowed: UncertaintyFlag[] = ['missing', 'estimated', 'conflicting', 'unverified']
  return value.filter((flag): flag is UncertaintyFlag => typeof flag === 'string' && allowed.includes(flag as UncertaintyFlag))
}

type LoginUserRole = 'user' | 'maintainer' | 'sysadmin'

interface LoginUserRecord {
  id: number
  mobile: string
  name: string
  role: LoginUserRole
  enabled: number
  password_hash: string | null
  auth_version: number
  created_at: string
  updated_at: string
}

interface LoginUserView {
  id: number
  mobile: string
  name: string
  role: LoginUserRole
  enabled: boolean
  passwordConfigured: boolean
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

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return null
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function timingSafeEqualHex(leftHex: string, rightHex: string): boolean {
  if (!leftHex || !rightHex || leftHex.length !== rightHex.length) {
    return false
  }

  let diff = 0
  for (let i = 0; i < leftHex.length; i += 1) {
    diff |= leftHex.charCodeAt(i) ^ rightHex.charCodeAt(i)
  }
  return diff === 0
}

interface Pbkdf2Hash {
  iterations: number
  saltHex: string
  hashHex: string
  hashLengthBytes: number
}

const PBKDF2_MIN_ITERATIONS = 100_000
const PBKDF2_MAX_ITERATIONS = 100_000

function parsePbkdf2Hash(raw: string): Pbkdf2Hash | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split('$')
  if (parts.length !== 4) {
    return null
  }

  const [algorithm, iterationText, saltHex, hashHex] = parts
  if (algorithm !== 'pbkdf2_sha256') {
    return null
  }

  const iterations = Number(iterationText)
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
    return null
  }

  const saltBytes = hexToBytes(saltHex)
  const hashBytes = hexToBytes(hashHex)
  if (!saltBytes || !hashBytes || saltBytes.length < 16 || hashBytes.length < 16) {
    return null
  }

  return {
    iterations,
    saltHex,
    hashHex,
    hashLengthBytes: hashBytes.length,
  }
}

async function derivePbkdf2Sha256Hex(
  password: string,
  saltHex: string,
  iterations: number,
  hashLengthBytes: number,
): Promise<string> {
  const salt = hexToBytes(saltHex)
  if (!salt) {
    throw new Error('PBKDF2 salt 格式无效')
  }

  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt,
    },
    keyMaterial,
    hashLengthBytes * 8,
  )

  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function validateMaintainerPassword(password: unknown): Response | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim()) {
    return errorResponse('维护人员密码须为 8 至 128 位，且不能全部为空白', 400, 'INVALID_PASSWORD')
  }
  return null
}

async function hashMaintainerPassword(password: string): Promise<string> {
  const saltHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const hashHex = await derivePbkdf2Sha256Hex(password, saltHex, PBKDF2_MIN_ITERATIONS, 32)
  return `pbkdf2_sha256$${PBKDF2_MIN_ITERATIONS}$${saltHex}$${hashHex}`
}

async function verifyMaintainerPassword(password: string, encoded: string): Promise<boolean> {
  const hash = parsePbkdf2Hash(encoded)
  if (!hash) throw new Error('维护人员密码记录格式无效，请联系系统管理员重置')
  const derived = await derivePbkdf2Sha256Hex(password, hash.saltHex, hash.iterations, hash.hashLengthBytes)
  return timingSafeEqualHex(derived, hash.hashHex)
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
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
    name: row.name,
    role: row.role,
    enabled: row.enabled === 1,
    passwordConfigured: Boolean(row.password_hash),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function findLoginUserByMobile(db: D1Database, mobile: string): Promise<LoginUserRecord | null> {
  const rows = await db
    .prepare(
      'SELECT id, mobile, name, role, enabled, password_hash, auth_version, created_at, updated_at FROM login_users WHERE mobile = ? LIMIT 1',
    )
    .bind(mobile)
    .all<LoginUserRecord>()

  return rows.results?.[0] ?? null
}

async function findLoginUserById(db: D1Database, id: number): Promise<LoginUserRecord | null> {
  const rows = await db
    .prepare('SELECT id, mobile, name, role, enabled, password_hash, auth_version, created_at, updated_at FROM login_users WHERE id = ? LIMIT 1')
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
  user: LoginUserRecord,
  env: Env,
): Promise<{ token: string; expiresAt: string } | null> {
  const token = generateSessionToken()
  const tokenHash = await sha256Hex(token)
  const createdAt = nowIso()
  const updatedAt = createdAt
  const expiresAt = toIsoAfterHours(getSessionTtlHours(env))

  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, expires_at, revoked_at, created_at, updated_at, auth_version)
         SELECT ?, id, ?, NULL, ?, ?, auth_version FROM login_users
         WHERE id = ? AND enabled = 1 AND auth_version = ? AND role = ? AND password_hash IS ?
         RETURNING id`,
      )
      .bind(tokenHash, expiresAt, createdAt, updatedAt, user.id, user.auth_version, user.role, user.password_hash),
    db
      .prepare('DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?')
      .bind(createdAt),
  ])

  return result[0]?.results?.length ? { token, expiresAt } : null
}

async function verifySysadminPassword(password: string, env: Env): Promise<boolean> {
  const pbkdf2RawValues = [
    { key: 'SYSADMIN_PASSWORD_PBKDF2', value: (env.SYSADMIN_PASSWORD_PBKDF2 || '').trim() },
    { key: 'SYSADMIN_PASSWORD_PBKDF2_NEXT', value: (env.SYSADMIN_PASSWORD_PBKDF2_NEXT || '').trim() },
  ]

  const pbkdf2Hashes: Pbkdf2Hash[] = []
  for (const entry of pbkdf2RawValues) {
    if (!entry.value) {
      continue
    }

    const parsed = parsePbkdf2Hash(entry.value)
    if (!parsed) {
      const error = new Error(
        `${entry.key} format invalid; expected pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex> and iterations must be ${PBKDF2_MIN_ITERATIONS}`,
      )
      ;(error as Error & { code?: string }).code = 'SYSADMIN_PASSWORD_PBKDF2_INVALID'
      throw error
    }
    pbkdf2Hashes.push(parsed)
  }

  if (pbkdf2Hashes.length > 0) {
    for (const hash of pbkdf2Hashes) {
      let derived = ''
      try {
        derived = await derivePbkdf2Sha256Hex(password, hash.saltHex, hash.iterations, hash.hashLengthBytes)
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message.toLowerCase().includes('iteration counts above')) {
          const runtimeError = new Error(`PBKDF2 iterations exceed runtime support; use ${PBKDF2_MAX_ITERATIONS}`)
          ;(runtimeError as Error & { code?: string }).code = 'SYSADMIN_PASSWORD_PBKDF2_ITERATION_LIMIT'
          throw runtimeError
        }
        throw error
      }
      if (timingSafeEqualHex(derived, hash.hashHex)) {
        return true
      }
    }
    return false
  }

  const error = new Error('SYSADMIN_PASSWORD_PBKDF2 is not configured')
  ;(error as Error & { code?: string }).code = 'SYSADMIN_PASSWORD_PBKDF2_MISSING'
  throw error
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
  const allowLegacyTokenAuth = isTruthyEnv(env.ALLOW_LEGACY_API_TOKEN_AUTH)
  if (allowLegacyTokenAuth && expectedLegacyToken && token === expectedLegacyToken) {
    return {
      authenticated: true,
      role: 'sysadmin',
      user: {
        id: 0,
        mobile: 'legacy-token',
        name: '系统管理员',
        role: 'sysadmin',
        enabled: true,
        passwordConfigured: false,
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
      `SELECT s.id AS session_id, u.id, u.mobile, u.name, u.role, u.enabled, u.password_hash, u.auth_version, u.created_at, u.updated_at
       FROM auth_sessions s
       JOIN login_users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND u.enabled = 1
         AND s.auth_version = u.auth_version
         AND (u.role != 'maintainer' OR u.password_hash IS NOT NULL)
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

function requireMaintainerOrSysadmin(auth: AuthContext): Response | null {
  if (!auth.authenticated) {
    return errorResponse('未登录', 401, 'AUTH_REQUIRED')
  }
  if (auth.role !== 'maintainer' && auth.role !== 'sysadmin') {
    return errorResponse('需要 maintainer 或 sysadmin 权限', 403, 'FORBIDDEN')
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
    db.prepare(`CREATE TABLE IF NOT EXISTS family_data_revision (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL
    )`),
    db.prepare('INSERT OR IGNORE INTO family_data_revision VALUES (1, 0)'),
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
      member_ids_json TEXT,
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
    db.prepare(`CREATE TABLE IF NOT EXISTS member_profiles (
      member_id INTEGER PRIMARY KEY,
      generation_label_raw TEXT,
      lineage_branch TEXT,
      raw_notes TEXT,
      uncertainty_flags_json TEXT DEFAULT '[]',
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS member_generations (
      member_id INTEGER PRIMARY KEY,
      generation_number INTEGER NOT NULL,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS spouses (
      id INTEGER PRIMARY KEY,
      husband_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (husband_id) REFERENCES members(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS child_claims (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL,
      resolved_member_id INTEGER,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_member_id) REFERENCES members(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS name_aliases (
      id INTEGER PRIMARY KEY,
      member_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_preferred INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      raw_text TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS temporal_expressions (
      id INTEGER PRIMARY KEY,
      member_id INTEGER,
      label TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      calendar_type TEXT NOT NULL,
      normalized_date TEXT,
      precision TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS kinship_relations (
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
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS burial_records (
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
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS login_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('user', 'maintainer', 'sysadmin')) DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      auth_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES login_users(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_member_id ON family_events(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_events_date ON family_events(date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_tracks_member_id ON tracks(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_aliases_member_id ON name_aliases(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_temporals_member_id ON temporal_expressions(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_relations_from_member_id ON kinship_relations(from_member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_relations_to_member_id ON kinship_relations(to_member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_relations_temporal_id ON kinship_relations(temporal_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_burials_member_id ON burial_records(member_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_burials_temporal_id ON burial_records(temporal_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_login_users_role_enabled ON login_users(role, enabled)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)'),
  ])

  const userColumns = await db.prepare('PRAGMA table_info(login_users)').all<{ name: string }>()
  if (!userColumns.results?.some((column) => column.name === 'name')) {
    await db.prepare("ALTER TABLE login_users ADD COLUMN name TEXT NOT NULL DEFAULT ''").all()
  }
  const trackColumns = await db.prepare('PRAGMA table_info(tracks)').all<{ name: string }>()
  if (!trackColumns.results?.some((column) => column.name === 'member_ids_json')) {
    await db.prepare('ALTER TABLE tracks ADD COLUMN member_ids_json TEXT').all()
  }
  await ensureLoginUsersRoleConstraint(db)
  await ensureAuthColumns(db)
}

async function ensureAuthColumns(db: D1Database): Promise<void> {
  const additions = [
    ['login_users', 'password_hash', 'TEXT'],
    ['login_users', 'auth_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['auth_sessions', 'auth_version', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const
  for (const [table, column, definition] of additions) {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
    if (columns.results?.some((entry) => entry.name === column)) continue
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).all()
    } catch (error) {
      // Another Worker isolate can add the same column after the schema check.
      if (!(error instanceof Error) || !error.message.includes(`duplicate column name: ${column}`)) throw error
      const current = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
      if (!current.results?.some((entry) => entry.name === column)) throw error
    }
  }
}

async function ensureLoginUsersRoleConstraint(db: D1Database): Promise<void> {
  const row = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'login_users' LIMIT 1")
    .all<{ sql: string }>()

  const sql = (row.results?.[0]?.sql || '').toLowerCase()
  if (sql.includes("'maintainer'")) {
    return
  }

  // D1 runtime does not reliably support PRAGMA toggles in exec(), so run a pure SQL rebuild.
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS auth_sessions__new'),
    db.prepare('DROP TABLE IF EXISTS login_users__new'),
    db.prepare(`CREATE TABLE login_users__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mobile TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('user', 'maintainer', 'sysadmin')) DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE auth_sessions__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES login_users__new(id) ON DELETE CASCADE
    )`),
    db.prepare(`INSERT INTO login_users__new (id, mobile, name, role, enabled, created_at, updated_at)
      SELECT
        id,
        mobile,
        name,
        CASE
          WHEN role IN ('user', 'maintainer', 'sysadmin') THEN role
          ELSE 'user'
        END,
        enabled,
        created_at,
        updated_at
      FROM login_users`),
    db.prepare(`INSERT INTO auth_sessions__new (id, token_hash, user_id, expires_at, revoked_at, created_at, updated_at)
      SELECT id, token_hash, user_id, expires_at, revoked_at, created_at, updated_at
      FROM auth_sessions`),
    db.prepare('DROP TABLE auth_sessions'),
    db.prepare('DROP TABLE login_users'),
    db.prepare('ALTER TABLE login_users__new RENAME TO login_users'),
    db.prepare('ALTER TABLE auth_sessions__new RENAME TO auth_sessions'),
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

  const trackRows = await db.prepare('SELECT * FROM tracks ORDER BY id').all<{
    id: number
    name: string
    member_id: number | null
    member_ids_json: string | null
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
    ...(row.member_ids_json === null ? {} : { memberIds: JSON.parse(row.member_ids_json) as unknown }),
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

  const profileRows = await db
    .prepare('SELECT member_id, generation_label_raw, lineage_branch, raw_notes, uncertainty_flags_json FROM member_profiles')
    .all<{
      member_id: number
      generation_label_raw: string | null
      lineage_branch: string | null
      raw_notes: string | null
      uncertainty_flags_json: string | null
    }>()

  const aliasRows = await db
    .prepare('SELECT id, member_id, name, type, is_preferred, note, raw_text FROM name_aliases ORDER BY id')
    .all<{
      id: number
      member_id: number
      name: string
      type: NameAlias['type']
      is_preferred: number
      note: string | null
      raw_text: string | null
    }>()

  const temporalRows = await db
    .prepare(
      'SELECT id, member_id, label, raw_text, calendar_type, normalized_date, precision, confidence FROM temporal_expressions ORDER BY id',
    )
    .all<{
      id: number
      member_id: number | null
      label: string
      raw_text: string
      calendar_type: TemporalExpression['calendarType']
      normalized_date: string | null
      precision: TemporalExpression['precision']
      confidence: number
    }>()

  const relationRows = await db
    .prepare(
      'SELECT id, from_member_id, to_member_id, type, status, temporal_id, note, raw_text FROM kinship_relations ORDER BY id',
    )
    .all<{
      id: number
      from_member_id: number
      to_member_id: number
      type: KinshipRelation['type']
      status: KinshipRelation['status']
      temporal_id: number | null
      note: string | null
      raw_text: string | null
    }>()

  const burialRows = await db
    .prepare('SELECT id, member_id, temporal_id, place_raw, mountain_direction, fenjin, note, raw_text FROM burial_records ORDER BY id')
    .all<{
      id: number
      member_id: number
      temporal_id: number | null
      place_raw: string
      mountain_direction: string | null
      fenjin: string | null
      note: string | null
      raw_text: string | null
    }>()

  const metaRows = await db.prepare('SELECT key, value FROM metadata').all<{ key: string; value: string }>()
  const meta = new Map<string, string>()
  for (const row of metaRows.results ?? []) {
    meta.set(row.key, row.value || '')
  }
  const generationRows = await db.prepare('SELECT member_id, generation_number FROM member_generations')
    .all<{ member_id: number; generation_number: number }>()
  const generations = new Map((generationRows.results ?? []).map((row) => [row.member_id, row.generation_number]))
  const spouseRows = await db.prepare('SELECT payload_json FROM spouses ORDER BY id').all<{ payload_json: string }>()
  const claimRows = await db.prepare('SELECT payload_json FROM child_claims ORDER BY id').all<{ payload_json: string }>()
  const spouses = (spouseRows.results ?? []).map((row) => JSON.parse(row.payload_json) as Spouse)
  const childClaims = (claimRows.results ?? []).map((row) => JSON.parse(row.payload_json) as ChildClaim)
  if (!members.length && !tracks.length && !events.length && !meta.has('schema_version')) return null

  const maxMemberId = members.length > 0 ? Math.max(...members.map((m) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0
  const maxEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 0
  const aliasesFromTable: NameAlias[] = (aliasRows.results ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    name: row.name,
    type: row.type,
    isPreferred: row.is_preferred === 1,
    note: row.note || '',
    rawText: row.raw_text || '',
  }))
  const relationsFromTable: KinshipRelation[] = (relationRows.results ?? []).map((row) => ({
    id: row.id,
    fromMemberId: row.from_member_id,
    toMemberId: row.to_member_id,
    type: row.type,
    status: row.status,
    temporalId: row.temporal_id,
    note: row.note || '',
    rawText: row.raw_text || '',
  }))
  const temporalsFromTable: TemporalExpression[] = (temporalRows.results ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    label: row.label,
    rawText: row.raw_text,
    calendarType: row.calendar_type,
    normalizedDate: row.normalized_date || '',
    precision: row.precision,
    confidence: Number.isFinite(row.confidence) ? row.confidence : 1,
  }))
  const burialsFromTable: BurialRecord[] = (burialRows.results ?? []).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    temporalId: row.temporal_id,
    placeRaw: row.place_raw,
    mountainDirection: row.mountain_direction || '',
    fenjin: row.fenjin || '',
    note: row.note || '',
    rawText: row.raw_text || '',
  }))
  const aliases = aliasesFromTable.length > 0 ? aliasesFromTable : parseJson<NameAlias[]>(meta.get('aliases_json'), [])
  const relations =
    relationsFromTable.length > 0 ? relationsFromTable : parseJson<KinshipRelation[]>(meta.get('relations_json'), [])
  const temporals =
    temporalsFromTable.length > 0 ? temporalsFromTable : parseJson<TemporalExpression[]>(meta.get('temporals_json'), [])
  const burials = burialsFromTable.length > 0 ? burialsFromTable : parseJson<BurialRecord[]>(meta.get('burials_json'), [])

  const memberProfilesFromTable: Record<string, MemberProfileExtension> = Object.fromEntries(
    (profileRows.results ?? []).map((row) => [
      String(row.member_id),
      {
        generationLabelRaw: row.generation_label_raw || '',
        lineageBranch: row.lineage_branch || '',
        rawNotes: row.raw_notes || '',
        uncertaintyFlags: normalizeUncertaintyFlags(parseJson(row.uncertainty_flags_json, [])),
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
      generationNumber: generations.get(member.id),
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

  return normalizeFamilyData({
    schemaVersion: toInt(meta.get('schema_version'), 3),
    members: membersWithExtensions,
    events,
    tracks,
    aliases,
    relations,
    temporals,
    burials,
    spouses,
    childClaims,
    nextId: Math.max(toInt(meta.get('next_id'), maxMemberId + 1), maxMemberId + 1),
    nextTrackId: Math.max(toInt(meta.get('next_track_id'), maxTrackId + 1), maxTrackId + 1),
    nextEventId: Math.max(toInt(meta.get('next_event_id'), maxEventId + 1), maxEventId + 1),
    nextAliasId: Math.max(toInt(meta.get('next_alias_id'), maxAliasId + 1), maxAliasId + 1),
    nextRelationId: Math.max(toInt(meta.get('next_relation_id'), maxRelationId + 1), maxRelationId + 1),
    nextTemporalId: Math.max(toInt(meta.get('next_temporal_id'), maxTemporalId + 1), maxTemporalId + 1),
    nextBurialId: Math.max(toInt(meta.get('next_burial_id'), maxBurialId + 1), maxBurialId + 1),
    nextSpouseId: toInt(meta.get('next_spouse_id'), 1),
    nextChildClaimId: toInt(meta.get('next_child_claim_id'), 1),
  })
}

async function readRevision(db: D1Database): Promise<number> {
  const rows = await db.prepare('SELECT revision FROM family_data_revision WHERE singleton = 1').all<{ revision: number }>()
  return rows.results?.[0]?.revision ?? 0
}

async function writeFamilyData(db: D1Database, data: FamilyData, expectedRevision: number): Promise<void> {
  await ensureSchema(db)

  const nowTs = Math.floor(Date.now() / 1000)

  const statements: D1PreparedStatement[] = [
    // A stale revision violates NOT NULL and rolls back the entire D1 batch.
    db.prepare('UPDATE family_data_revision SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE NULL END WHERE singleton = 1').bind(expectedRevision),
    db.prepare('DELETE FROM child_claims'),
    db.prepare('DELETE FROM spouses'),
    db.prepare('DELETE FROM member_generations'),
    db.prepare('DELETE FROM kinship_relations'),
    db.prepare('DELETE FROM burial_records'),
    db.prepare('DELETE FROM temporal_expressions'),
    db.prepare('DELETE FROM name_aliases'),
    db.prepare('DELETE FROM member_profiles'),
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
          '[]',
          member.birthDate || null,
          member.photoUrl || null,
          member.biography || null,
          nowTs,
          nowTs,
        ),
    )
  }

  for (const member of data.members) {
    if (member.generationNumber !== undefined) {
      statements.push(db.prepare('INSERT INTO member_generations VALUES (?, ?)').bind(member.id, member.generationNumber))
    }
  }
  for (const spouse of data.spouses) {
    statements.push(db.prepare('INSERT INTO spouses VALUES (?, ?, ?)').bind(spouse.id, spouse.husbandId, JSON.stringify(spouse)))
  }
  for (const claim of data.childClaims) {
    statements.push(db.prepare('INSERT INTO child_claims VALUES (?, ?, ?, ?)').bind(claim.id, claim.parentId, claim.resolvedMemberId, JSON.stringify(claim)))
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

  for (const temporal of data.temporals ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO temporal_expressions (id, member_id, label, raw_text, calendar_type, normalized_date, precision, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          temporal.id,
          temporal.memberId,
          temporal.label,
          temporal.rawText,
          temporal.calendarType,
          temporal.normalizedDate || null,
          temporal.precision,
          temporal.confidence,
        ),
    )
  }

  for (const alias of data.aliases ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO name_aliases (id, member_id, name, type, is_preferred, note, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          alias.id,
          alias.memberId,
          alias.name,
          alias.type,
          alias.isPreferred ? 1 : 0,
          alias.note || null,
          alias.rawText || null,
        ),
    )
  }

  for (const relation of data.relations ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO kinship_relations (id, from_member_id, to_member_id, type, status, temporal_id, note, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          relation.id,
          relation.fromMemberId,
          relation.toMemberId,
          relation.type,
          relation.status || 'active',
          relation.temporalId,
          relation.note || null,
          relation.rawText || null,
        ),
    )
  }

  for (const burial of data.burials ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO burial_records (id, member_id, temporal_id, place_raw, mountain_direction, fenjin, note, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          burial.id,
          burial.memberId,
          burial.temporalId,
          burial.placeRaw,
          burial.mountainDirection || null,
          burial.fenjin || null,
          burial.note || null,
          burial.rawText || null,
        ),
    )
  }

  for (const member of data.members ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO member_profiles (member_id, generation_label_raw, lineage_branch, raw_notes, uncertainty_flags_json) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
          member.id,
          member.generationLabelRaw || null,
          member.lineageBranch || null,
          member.rawNotes || null,
          JSON.stringify(normalizeUncertaintyFlags(member.uncertaintyFlags)),
        ),
    )
  }

  for (const track of data.tracks ?? []) {
    statements.push(
      db
        .prepare(
          'INSERT INTO tracks (id, name, member_id, member_ids_json, points_json, start_point_json, end_point_json, stats_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          track.id,
          track.name,
          track.memberId,
          JSON.stringify(track.memberIds),
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
    ['next_alias_id', String(data.nextAliasId)],
    ['next_relation_id', String(data.nextRelationId)],
    ['next_temporal_id', String(data.nextTemporalId)],
    ['next_burial_id', String(data.nextBurialId)],
    ['next_spouse_id', String(data.nextSpouseId)],
    ['next_child_claim_id', String(data.nextChildClaimId)],
    ['aliases_json', JSON.stringify(data.aliases ?? [])],
    ['relations_json', JSON.stringify(data.relations ?? [])],
    ['temporals_json', JSON.stringify(data.temporals ?? [])],
    ['burials_json', JSON.stringify(data.burials ?? [])],
    [
      'member_profiles_json',
      JSON.stringify(
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
    ],
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

      if (request.method === 'GET' && url.pathname === '/api/auth/status') {
        const existing = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM login_users WHERE role = 'sysadmin'")
          .all<{ count: number | string }>()
        return jsonResponse({ initialized: Number(existing.results?.[0]?.count ?? 0) > 0 })
      }

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

        const session = await createSessionForUser(env.DB, created, env)
        if (!session) return errorResponse('账号信息已变更，请重新登录', 401, 'CREDENTIALS_CHANGED')
        return jsonResponse({
          ok: true,
          token: session.token,
          expiresAt: session.expiresAt,
          user: toLoginUserView(created),
        })
      }

      if (request.method === 'POST' && ['/api/auth/login', '/api/auth/login-options'].includes(url.pathname)) {
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
          const totalUsers = await env.DB
            .prepare('SELECT COUNT(1) AS count FROM login_users')
            .all<{ count: number }>()
          const userCount = toInt(totalUsers.results?.[0]?.count, 0)
          if (userCount === 0) {
            return errorResponse('当前数据库尚无登录账号，请先初始化 sysadmin 或切换到远程 D1', 401, 'LOGIN_USERS_EMPTY')
          }
          return errorResponse('登录失败：手机号不存在或已禁用', 401, 'LOGIN_FAILED')
        }

        if (user.role === 'maintainer' && !user.password_hash) {
          return errorResponse('此维护账号尚未设置密码，请联系系统管理员设置后登录', 403, 'PASSWORD_NOT_SET')
        }
        if (url.pathname === '/api/auth/login-options') {
          return jsonResponse({ passwordRequired: user.role !== 'user' })
        }

        const password = typeof payload.password === 'string' ? payload.password : ''
        if (user.role === 'maintainer') {
          if (!password) return errorResponse('此账号需要密码，请输入后继续登录', 401, 'PASSWORD_REQUIRED')
          if (password.length > 128 || !user.password_hash || !await verifyMaintainerPassword(password, user.password_hash)) {
            return errorResponse('密码错误，请重新输入；忘记密码请联系系统管理员', 401, 'INVALID_PASSWORD')
          }
        } else if (user.role === 'sysadmin') {
          if (!password) {
            return errorResponse('此账号需要密码，请输入后继续登录', 401, 'PASSWORD_REQUIRED')
          }

          const validPassword = await verifySysadminPassword(password, env)
          if (!validPassword) {
            return errorResponse('sysadmin 密码错误', 401, 'INVALID_SYSADMIN_PASSWORD')
          }
        }

        const session = await createSessionForUser(env.DB, user, env)
        if (!session) return errorResponse('账号信息已变更，请重新登录', 401, 'CREDENTIALS_CHANGED')

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
            `SELECT id, mobile, name, role, enabled, password_hash, auth_version, created_at, updated_at
             FROM login_users
             ORDER BY CASE role
               WHEN 'sysadmin' THEN 0
               WHEN 'maintainer' THEN 1
               ELSE 2
             END, id ASC`,
          )
          .all<LoginUserRecord>()

        return jsonResponse({ users: (rows.results ?? []).map(toLoginUserView) })
      }

      if (request.method === 'POST' && url.pathname === '/api/login-users') {
        const denied = requireSysadmin(auth)
        if (denied) {
          return denied
        }

        const payload = parseJsonBody<{ mobile?: string; name?: string; role?: LoginUserRole; password?: string }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const mobile = normalizeMobile(payload.mobile)
        if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length > 100)) {
          return errorResponse('用户名称必须为不超过 100 字的文本', 400, 'INVALID_NAME')
        }
        const name = payload.name?.trim() ?? ''
        if (payload.role !== undefined && !['user', 'maintainer', 'sysadmin'].includes(payload.role)) {
          return errorResponse('账号角色无效', 400, 'INVALID_ROLE')
        }
        const role: LoginUserRole =
          payload.role === 'sysadmin' || payload.role === 'maintainer' ? payload.role : 'user'
        if (!isValidMobile(mobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }
        if (role !== 'maintainer' && payload.password !== undefined) {
          return errorResponse('只有维护人员使用独立密码；系统管理员沿用服务端验证密码', 400, 'PASSWORD_NOT_APPLICABLE')
        }
        let passwordHash: string | null = null
        if (role === 'maintainer') {
          if (payload.password === undefined) return errorResponse('请为维护人员设置初始密码', 400, 'PASSWORD_REQUIRED')
          const invalidPassword = validateMaintainerPassword(payload.password)
          if (invalidPassword) return invalidPassword
          passwordHash = await hashMaintainerPassword(payload.password)
        }

        const existing = await findLoginUserByMobile(env.DB, mobile)
        if (existing) {
          return errorResponse('手机号已存在', 409, 'DUPLICATE_MOBILE')
        }

        const createdAt = nowIso()
        await env.DB
          .prepare('INSERT INTO login_users (mobile, name, role, enabled, password_hash, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
          .bind(mobile, name, role, passwordHash, createdAt, createdAt)
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

        const payload = parseJsonBody<{ mobile?: string; name?: string; role?: LoginUserRole; enabled?: boolean; password?: string }>(await request.json())
        if (!payload) {
          return errorResponse('请求体格式错误', 400, 'BAD_REQUEST')
        }

        const nextMobile = payload.mobile !== undefined ? normalizeMobile(payload.mobile) : target.mobile
        if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length > 100)) {
          return errorResponse('用户名称必须为不超过 100 字的文本', 400, 'INVALID_NAME')
        }
        const nextName = payload.name === undefined ? target.name : payload.name.trim()
        if (payload.role !== undefined && !['user', 'maintainer', 'sysadmin'].includes(payload.role)) {
          return errorResponse('账号角色无效', 400, 'INVALID_ROLE')
        }
        if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
          return errorResponse('账号启用状态必须为布尔值', 400, 'INVALID_ENABLED')
        }
        const nextRole: LoginUserRole =
          payload.role === 'sysadmin' || payload.role === 'maintainer' || payload.role === 'user'
            ? payload.role
            : target.role
        const nextEnabled = payload.enabled === undefined ? target.enabled === 1 : Boolean(payload.enabled)

        if (!isValidMobile(nextMobile)) {
          return errorResponse('手机号格式无效', 400, 'INVALID_MOBILE')
        }
        if (nextRole !== 'maintainer' && payload.password !== undefined) {
          return errorResponse('只有维护人员使用独立密码；系统管理员沿用服务端验证密码', 400, 'PASSWORD_NOT_APPLICABLE')
        }
        if (nextRole === 'maintainer') {
          if ((!target.password_hash || target.role !== 'maintainer') && payload.password === undefined) {
            return errorResponse('请为维护人员设置初始密码', 400, 'PASSWORD_REQUIRED')
          }
          if (payload.password !== undefined) {
            const invalidPassword = validateMaintainerPassword(payload.password)
            if (invalidPassword) return invalidPassword
          }
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
        const passwordHash = nextRole !== 'maintainer' ? null
          : payload.password !== undefined ? await hashMaintainerPassword(payload.password) : target.password_hash
        const credentialsChanged = nextMobile !== target.mobile || nextRole !== target.role
          || nextEnabled !== (target.enabled === 1) || payload.password !== undefined
        const statements = [
          env.DB.prepare(`UPDATE login_users
            SET mobile = ?, name = ?, role = ?, enabled = ?, password_hash = ?, updated_at = ?, auth_version = auth_version + ?
            WHERE id = ? AND auth_version = ? RETURNING id`)
            .bind(nextMobile, nextName, nextRole, nextEnabled ? 1 : 0, passwordHash, updatedAt,
              credentialsChanged ? 1 : 0, loginUserId, target.auth_version),
        ]
        if (credentialsChanged) {
          statements.push(env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?, updated_at = ?
            WHERE user_id = ? AND auth_version = ? AND revoked_at IS NULL`)
            .bind(updatedAt, updatedAt, loginUserId, target.auth_version))
        }
        const result = await env.DB.batch(statements)
        if (!result[0]?.results?.length) {
          return errorResponse('账号信息已被其他操作更新，请刷新后重试', 409, 'ACCOUNT_CONFLICT')
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

      if (request.method === 'GET' && (url.pathname === '/api/family-data' || url.pathname === '/api/browse-data')) {
        if (!auth.authenticated) {
          return errorResponse('未登录，无法读取数据', 401, 'AUTH_REQUIRED')
        }
        const browsing = url.pathname === '/api/browse-data'
        if (!browsing) {
          const denied = requireMaintainerOrSysadmin(auth)
          if (denied) return denied
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const revision = await readRevision(env.DB)
          const data = await readFamilyData(env.DB)
          if (revision === await readRevision(env.DB)) {
            return jsonResponse(browsing
              ? { contractVersion: FAMILY_BROWSE_CONTRACT_VERSION, data: data === null ? null : toFamilyBrowseData(data), revision }
              : { data, revision })
          }
        }
        return errorResponse('数据正在更新，请稍后重试', 503, 'DATA_BUSY')
      }

      if (request.method === 'PUT' && url.pathname === '/api/family-data') {
        const denied = requireMaintainerOrSysadmin(auth)
        if (denied) {
          return denied
        }

        const payload = (await request.json()) as { data?: unknown }
        if (!payload?.data) {
          return jsonResponse({ error: '请求体缺少 data' }, 400)
        }
        const match = /^"(\d+)"$/.exec(request.headers.get('If-Match') ?? '')
        if (!match || !Number.isSafeInteger(Number(match[1]))) {
          return errorResponse('缺少数据版本，请刷新页面后再保存', 428, 'REVISION_REQUIRED')
        }
        const expectedRevision = Number(match[1])
        if (!isCompleteFamilySnapshot(payload.data)) {
          return errorResponse('保存需要完整的维护数据及编号计数器；浏览资料不能用于覆盖维护数据', 400, 'WRITE_SNAPSHOT_REQUIRED')
        }
        const data = normalizeFamilyData(payload.data)
        try {
          await writeFamilyData(env.DB, data, expectedRevision)
        } catch (error) {
          if (await readRevision(env.DB) !== expectedRevision) {
            return errorResponse('云端数据已被其他页面更新，请重新加载后再修改；本次修改未保存', 409, 'DATA_CONFLICT')
          }
          throw error
        }
        return jsonResponse({ ok: true, revision: expectedRevision + 1 })
      }

      return jsonResponse({ error: '未找到接口' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D1 服务内部错误'
      return jsonResponse({ error: message }, error instanceof FamilyDataValidationError || error instanceof SyntaxError ? 400 : 500)
    }
  },
}
