import { pbkdf2Sync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../api/index'
import { TestD1Database } from '../helpers/d1Database'

const require = createRequire(import.meta.url)
const adminHeaders = { Authorization: 'Bearer authentication-test-admin', 'Content-Type': 'application/json' }
const password = 'maintainer-test-password'
const adminPassword = 'fixed-sysadmin-test-password'
const salt = '0123456789abcdef0123456789abcdef'
const adminHash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(adminPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`
let SQL: SqlJsStatic
let db: TestD1Database

beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }) })
beforeEach(() => { db = new TestD1Database(new SQL.Database()) })
afterEach(() => { vi.restoreAllMocks(); db.database.close() })

function request(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`http://local.invalid${path}`, { ...init, headers: init.headers ?? adminHeaders }), {
    DB: db,
    API_TOKEN: 'authentication-test-admin',
    ALLOW_LEGACY_API_TOKEN_AUTH: 'true',
    SYSADMIN_PASSWORD_PBKDF2: adminHash,
  })
}

function login(mobile: string, suppliedPassword?: string, extra: Record<string, unknown> = {}) {
  return request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, password: suppliedPassword, ...extra }),
  })
}

function update(id: number, input: Record<string, unknown>) {
  return request(`/api/login-users/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

async function create(role = 'maintainer', mobile = '13900000001', suppliedPassword: unknown = password) {
  const response = await request('/api/login-users', {
    method: 'POST', body: JSON.stringify({ mobile, role, ...(role === 'maintainer' ? { password: suppliedPassword } : {}) }),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json() as { user: { id: number; passwordConfigured: boolean } }).user
}

async function tokenFor(mobile = '13900000001', suppliedPassword?: string) {
  const response = await login(mobile, suppliedPassword)
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json() as { token: string }).token
}

function session(token: string) {
  return request('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
}

function account(id: number) {
  return db.database.exec(`SELECT password_hash, auth_version FROM login_users WHERE id = ${id}`)[0]!.values[0]!
}

async function seedToken(id: number, token: string) {
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex')
  db.database.run(`INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at,updated_at)
    VALUES (?,?,'2099-01-01','2026-01-01','2026-01-01')`, [hash, id])
}

function gate() {
  let release = () => {}
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

describe('role-resolved login and independent maintainer passwords', () => {
  it('reports bootstrap status anonymously, counting disabled administrators as initialized', async () => {
    const status = () => request('/api/auth/status', { headers: {} })
    const empty = await status()
    expect(empty.status).toBe(200)
    expect(empty.headers.get('Cache-Control')).toContain('no-store')
    expect(await empty.json()).toEqual({ initialized: false })
    const admin = await create('sysadmin')
    expect(await (await status()).json()).toEqual({ initialized: true })
    db.database.run('UPDATE login_users SET enabled = 0 WHERE id = ?', [admin.id])
    expect(await (await status()).json()).toEqual({ initialized: true })
  })

  it('detects password requirements without exposing identity or creating a session', async () => {
    await create('user', '+85212345678')
    await create('maintainer', '13900000002')
    await create('sysadmin', '13900000003')
    for (const [mobile, passwordRequired] of [
      [' +852 1234 5678 ', false], ['13900000002', true], ['13900000003', true],
    ] as const) {
      const response = await request('/api/auth/login-options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, role: 'user' }),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      expect(await response.json()).toEqual({ passwordRequired })
    }
    expect(db.database.exec('SELECT COUNT(*) FROM auth_sessions')[0]!.values[0]![0]).toBe(0)
  })

  it('does not make unknown, disabled or passwordless maintenance accounts login-ready', async () => {
    const legacy = await create('user')
    db.database.run("UPDATE login_users SET role = 'maintainer' WHERE id = ?", [legacy.id])
    const options = (mobile: string) => request('/api/auth/login-options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile }),
    })
    expect(await (await options('13900000001')).json()).toMatchObject({ code: 'PASSWORD_NOT_SET' })
    db.database.run('UPDATE login_users SET enabled = 0 WHERE id = ?', [legacy.id])
    const disabled = await options('13900000001')
    const unknown = await options('13900000002')
    expect(disabled.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await disabled.json()).toEqual(await unknown.json())
    expect((await options('invalid')).status).toBe(400)
    expect(db.database.exec('SELECT COUNT(*) FROM auth_sessions')[0]!.values[0]![0]).toBe(0)
  })

  it('keeps ordinary registered users phone-only and ignores client-supplied roles', async () => {
    await create('user', '+85212345678')
    const response = await login(' +852 1234 5678 ', undefined, { role: 'sysadmin' })
    expect(response.status).toBe(200)
    const payload = await response.json() as { user: { role: string }; token: string }
    expect(payload.user.role).toBe('user')
    expect((await session(payload.token)).status).toBe(200)
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${payload.token}` } })).status).toBe(403)
  })

  it('requires the maintainer account password, not a sysadmin password or a chosen role', async () => {
    await create()
    const missing = await login('13900000001', undefined, { role: 'user' })
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ code: 'PASSWORD_REQUIRED' })
    for (const supplied of ['incorrect-password', adminPassword]) {
      const response = await login('13900000001', supplied)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'INVALID_PASSWORD' })
    }
    const response = await login('13900000001', password)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: { role: 'maintainer', passwordConfigured: true } })
  })

  it('keeps sysadmin on the original server-configured fixed password', async () => {
    await create('sysadmin')
    expect(await (await login('13900000001')).json()).toMatchObject({ code: 'PASSWORD_REQUIRED' })
    expect((await login('13900000001', password)).status).toBe(401)
    expect((await login('13900000001', adminPassword)).status).toBe(200)
    const reset = await update(1, { password })
    expect(reset.status).toBe(400)
    expect(await reset.json()).toMatchObject({ code: 'PASSWORD_NOT_APPLICABLE' })
    expect(account(1)[0]).toBeNull()
  })

  it('preserves first sysadmin initialization using the fixed server password', async () => {
    const bootstrap = () => request('/api/auth/bootstrap-sysadmin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '13900000001', password: adminPassword }),
    })
    const response = await bootstrap()
    expect(response.status).toBe(200)
    const payload = await response.json() as { token: string }
    expect((await session(payload.token)).status).toBe(200)
    expect((await bootstrap()).status).toBe(409)
    expect((await login('13900000001', adminPassword)).status).toBe(200)
  })

  it('stores independently salted hashes without exposing them in login, account or family responses', async () => {
    const first = await create()
    const second = await create('maintainer', '13900000002')
    expect(account(first.id)[0]).toMatch(/^pbkdf2_sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/)
    expect(account(first.id)[0]).not.toBe(account(second.id)[0])
    for (const response of [await login('13900000001', password), await request('/api/login-users'), await request('/api/family-data')]) {
      const body = await response.text()
      expect(body).not.toContain('password_hash')
      expect(body).not.toContain('auth_version')
      expect(body).not.toContain('pbkdf2_sha256')
      expect(body).not.toContain(password)
    }
  })

  it.each(['', '        ', 'short12', 'x'.repeat(129), null, 123])('rejects invalid initial and reset passwords: %j', async (invalid) => {
    const response = await request('/api/login-users', {
      method: 'POST', body: JSON.stringify({ mobile: '13900000001', role: 'maintainer', password: invalid }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_PASSWORD' })
    const user = await create()
    expect((await update(user.id, { password: invalid })).status).toBe(400)
    expect((await login('13900000001', password)).status).toBe(200)
  })

  it.each(['12345678', 'x'.repeat(128), '  preserved spaces  '])('accepts the exact password without trimming: %j', async (accepted) => {
    await create('maintainer', '13900000001', accepted)
    expect((await login('13900000001', accepted)).status).toBe(200)
    if (accepted.trim() !== accepted) expect((await login('13900000001', accepted.trim())).status).toBe(401)
  })

  it('requires an initial password when creating or promoting a maintainer', async () => {
    const missing = await request('/api/login-users', {
      method: 'POST', body: JSON.stringify({ mobile: '13900000001', role: 'maintainer' }),
    })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ code: 'PASSWORD_REQUIRED' })
    const user = await create('user')
    expect((await update(user.id, { role: 'maintainer' })).status).toBe(400)
    expect((await update(user.id, { role: 'maintainer', password })).status).toBe(200)
  })

  it.each(['user', 'sysadmin'])('rejects independent passwords for %s accounts', async (role) => {
    const response = await request('/api/login-users', {
      method: 'POST', body: JSON.stringify({ mobile: '13900000001', role, password }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PASSWORD_NOT_APPLICABLE' })
  })

  it.each(['user', 'maintainer'])('does not allow %s sessions to set passwords or manage roles', async (role) => {
    const user = await create(role)
    const token = await tokenFor('13900000001', role === 'maintainer' ? password : undefined)
    for (const input of [{ password: 'attacker-reset-password' }, { role: 'sysadmin' }]) {
      expect((await request(`/api/login-users/${user.id}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })).status).toBe(403)
    }
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403)
    if (role === 'maintainer') {
      const write = await request('/api/family-data', {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-Match': '"0"' },
        body: JSON.stringify({ data: { schemaVersion: 4, members: [], spouses: [], childClaims: [], aliases: [], temporals: [], relations: [], burials: [], events: [], tracks: [], nextId: 1, nextSpouseId: 1, nextChildClaimId: 1, nextAliasId: 1, nextTemporalId: 1, nextRelationId: 1, nextBurialId: 1, nextEventId: 1, nextTrackId: 1 } }),
      })
      expect(write.status).toBe(200)
    }
  })

  it('rejects unknown and disabled accounts without creating sessions', async () => {
    expect((await login('13900000001')).status).toBe(401)
    const user = await create('user')
    await update(user.id, { enabled: false })
    expect((await login('13900000001')).status).toBe(401)
    expect((await login('13900000002')).status).toBe(401)
    expect(db.database.exec('SELECT COUNT(*) FROM auth_sessions')[0]!.values[0]![0]).toBe(0)
  })
})

describe('credential changes invalidate previous sessions atomically', () => {
  it('keeps sessions for name-only edits but invalidates every token on password reset', async () => {
    const user = await create()
    const tokens = [await tokenFor('13900000001', password), await tokenFor('13900000001', password)]
    expect((await update(user.id, { name: '新的显示名称' })).status).toBe(200)
    expect((await session(tokens[0]!)).status).toBe(200)
    expect((await update(user.id, { password: 'new-maintainer-password' })).status).toBe(200)
    for (const token of tokens) expect((await session(token)).status).toBe(401)
    expect((await login('13900000001', password)).status).toBe(401)
    expect((await login('13900000001', 'new-maintainer-password')).status).toBe(200)
  })

  it.each(['maintainer', 'sysadmin'])('requires reauthentication when an ordinary user is promoted to %s', async (role) => {
    const user = await create('user')
    const token = await tokenFor()
    expect((await update(user.id, { role, ...(role === 'maintainer' ? { password } : {}) })).status).toBe(200)
    expect((await session(token)).status).toBe(401)
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
    expect((await login('13900000001')).status).toBe(401)
    expect((await login('13900000001', role === 'maintainer' ? password : adminPassword)).status).toBe(200)
  })

  it('clears unused passwords and revokes sessions on demotion', async () => {
    const user = await create()
    const token = await tokenFor('13900000001', password)
    expect((await update(user.id, { role: 'user' })).status).toBe(200)
    expect(account(user.id)[0]).toBeNull()
    expect((await session(token)).status).toBe(401)
    const ordinary = await tokenFor()
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${ordinary}` } })).status).toBe(403)
    expect((await update(user.id, { role: 'maintainer' })).status).toBe(400)
  })

  it('revokes sessions on phone changes and does not restore tokens when reenabled', async () => {
    const user = await create('user')
    const token = await tokenFor()
    expect((await update(user.id, { mobile: '13900000002' })).status).toBe(200)
    expect((await session(token)).status).toBe(401)
    expect((await login('13900000001')).status).toBe(401)
    const next = await tokenFor('13900000002')
    await update(user.id, { enabled: false })
    await update(user.id, { enabled: true })
    expect((await session(next)).status).toBe(401)
    expect((await login('13900000002')).status).toBe(200)
  })

  it('preserves the last enabled sysadmin protection', async () => {
    const user = await create('sysadmin')
    for (const input of [{ role: 'user' }, { role: 'maintainer', password }, { enabled: false }]) {
      const response = await update(user.id, input)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'LAST_SYSADMIN' })
    }
    expect((await request(`/api/login-users/${user.id}`, { method: 'DELETE' })).status).toBe(400)
    expect((await login('13900000001', adminPassword)).status).toBe(200)
  })

  it('rolls back the password, auth version and revocations together if revocation fails', async () => {
    const user = await create()
    const token = await tokenFor('13900000001', password)
    const original = account(user.id)
    db.database.run(`CREATE TRIGGER fail_revocation BEFORE UPDATE ON auth_sessions
      BEGIN SELECT RAISE(ABORT, 'injected revocation failure'); END`)
    expect((await update(user.id, { password: 'replacement-password' })).status).toBe(500)
    expect(account(user.id)).toEqual(original)
    db.database.run('DROP TRIGGER fail_revocation')
    expect((await session(token)).status).toBe(200)
    expect((await login('13900000001', password)).status).toBe(200)
  })

  it('does not issue a successful stale login when the password changes during verification', async () => {
    const user = await create()
    const started = gate()
    const finish = gate()
    const derive = crypto.subtle.deriveBits.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementationOnce(async (...args) => {
      started.release()
      await finish.wait
      return derive(...args)
    })
    const inFlight = login('13900000001', password)
    await started.wait
    try {
      expect((await update(user.id, { password: 'replacement-password' })).status).toBe(200)
    } finally {
      finish.release()
    }
    const response = await inFlight
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'CREDENTIALS_CHANGED' })
    expect((await login('13900000001', 'replacement-password')).status).toBe(200)
  })

  it('fences concurrent account resets instead of silently overwriting one of them', async () => {
    const user = await create()
    const responses = await Promise.all([
      update(user.id, { password: 'first-replacement-password' }),
      update(user.id, { password: 'second-replacement-password' }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const accepted = responses[0]!.status === 200 ? 'first-replacement-password' : 'second-replacement-password'
    expect((await login('13900000001', accepted)).status).toBe(200)
  })
})

describe('legacy credential and session migration', () => {
  function legacySchema() {
    db.database.run(`CREATE TABLE login_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('user','maintainer','sysadmin')), enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
    db.database.run(`CREATE TABLE auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES login_users(id) ON DELETE CASCADE
    )`)
    db.database.run(`INSERT INTO login_users (id,mobile,role,created_at,updated_at) VALUES
      (1,'13900000001','user','2026-01-01','2026-01-01'),
      (2,'13900000002','maintainer','2026-01-01','2026-01-01'),
      (3,'13900000003','sysadmin','2026-01-01','2026-01-01')`)
  }

  it.each(['runtime', 'sql'])('upgrades using %s migration without default passwords or preserving phone-only maintainer access', async (method) => {
    legacySchema()
    await seedToken(1, 'old-user-token')
    await seedToken(2, 'old-maintainer-token')
    await seedToken(3, 'old-sysadmin-token')
    if (method === 'sql') {
      db.database.run(await readFile(new URL('../../migrations/0003_maintainer_passwords.sql', import.meta.url), 'utf8'))
    }
    expect((await session('old-user-token')).status).toBe(200)
    expect((await session('old-sysadmin-token')).status).toBe(200)
    expect((await session('old-maintainer-token')).status).toBe(401)
    expect(account(2)[0]).toBeNull()
    const denied = await login('13900000002', password)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'PASSWORD_NOT_SET' })
    expect((await update(2, { password })).status).toBe(200)
    expect((await session('old-maintainer-token')).status).toBe(401)
    expect((await login('13900000002', password)).status).toBe(200)
    expect((await session('old-user-token')).status).toBe(200)
    expect((await session('old-sysadmin-token')).status).toBe(200)
  })

  it('accepts a verified concurrent column addition, but does not hide unrelated migration failures', async () => {
    legacySchema()
    const prepare = db.prepare.bind(db)
    const alter = 'ALTER TABLE login_users ADD COLUMN password_hash TEXT'
    const spy = vi.spyOn(db, 'prepare').mockImplementation((query) => {
      if (query === alter) {
        db.database.run(alter)
        throw new Error('D1_ERROR: duplicate column name: password_hash: SQLITE_ERROR')
      }
      return prepare(query)
    })
    expect((await request('/api/login-users')).status).toBe(200)
    spy.mockRestore()
    expect(account(2)[0]).toBeNull()
    db.database.run('ALTER TABLE login_users DROP COLUMN password_hash')
    vi.spyOn(db, 'prepare').mockImplementation((query) => {
      if (query === alter) throw new Error('injected storage failure')
      return prepare(query)
    })
    const failure = await request('/api/login-users')
    expect(failure.status).toBe(500)
    expect(await failure.json()).toMatchObject({ error: 'injected storage failure' })
  })
})
