import { pbkdf2Sync } from 'node:crypto'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../api/index'
import { TestD1Database } from '../helpers/d1Database'
import type { LoginUser } from '../../src/types/auth'
import { createEmptyFamilyData } from '../../src/services/importExport'

const require = createRequire(import.meta.url)
const password = 'test-only-admin-password'
const salt = '0123456789abcdef0123456789abcdef'
const passwordHash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`
const adminMobile = '13900000001'
const memberMobile = '13900000002'
const loginPath = '/api/auth/login'
const bootstrapPath = '/api/auth/bootstrap-sysadmin'
let SQL: SqlJsStatic
let db: TestD1Database

beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }) })
beforeEach(() => {
  db = new TestD1Database(new SQL.Database())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  db.database.close()
})

function request(path: string, init: RequestInit = {}, source: string | null = '203.0.113.1', handler = worker) {
  const req = new Request(`https://test.invalid${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(source ? { 'CF-Connecting-IP': source } : {}),
      ...init.headers,
    },
  })
  if (source !== null) Object.defineProperty(req, 'cf', { value: { colo: 'TEST' } })
  return handler.fetch(req, { DB: db, SYSADMIN_PASSWORD_PBKDF2: passwordHash })
}

function login(mobile = memberMobile, source: string | null = '203.0.113.1', suppliedPassword = password, path = loginPath) {
  return request(path, { method: 'POST', body: JSON.stringify({ mobile, password: suppliedPassword }) }, source)
}

async function seed(role = 'user') {
  // Initialize schema without using a legacy admin bypass.
  expect((await request('/api/auth/session')).status).toBe(401)
  await db.prepare(`INSERT INTO login_users (id, mobile, role, enabled, created_at, updated_at)
    VALUES (1, ?, 'sysadmin', 1, '', ''), (2, ?, ?, 1, '', '')`)
    .bind(adminMobile, memberMobile, role).all()
  await db.prepare('INSERT INTO login_credentials VALUES (1, ?, 0, 1), (2, ?, 0, 1)').bind(passwordHash, passwordHash).all()
}

async function tokenFor(mobile: string, suppliedPassword?: string) {
  const response = await login(mobile, '203.0.113.1', suppliedPassword)
  expect(response.status).toBe(200)
  return (await response.json() as { token: string }).token
}

function updateUser(token: string, body: Record<string, unknown>, id = 2) {
  return request(`/api/login-users/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })
}

function changePassword(token: string, currentPassword: string, newPassword: string) {
  return request('/api/auth/change-password', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

function resetPassword(token: string, nextPassword: unknown, id = 2) {
  return request(`/api/login-users/${id}/reset-password`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: nextPassword }),
  })
}

async function expectRevoked(token: string) {
  for (const path of ['/api/auth/session', '/api/login-users', '/api/family-data']) {
    expect((await request(path, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  }
}

describe('account changes and real sessions', () => {
  it.each(['user', 'maintainer'])('revokes all old %s sessions on promotion and requires a fresh password login', async (role) => {
    await seed(role)
    const oldTokens = [await tokenFor(memberMobile), await tokenFor(memberMobile)]
    const adminToken = await tokenFor(adminMobile, password)
    expect((await updateUser(adminToken, { role: 'sysadmin' })).status).toBe(200)
    for (const token of oldTokens) await expectRevoked(token)
    expect((await login(memberMobile, '203.0.113.1', '')).status).toBe(401)
    expect((await login(memberMobile, '203.0.113.1', 'wrong')).status).toBe(401)
    const newToken = await tokenFor(memberMobile, password)
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${newToken}` } })).status).toBe(200)
    expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${newToken}` } })).status).toBe(200)
    for (const token of oldTokens) await expectRevoked(token)
  })

  describe('independent account passwords', () => {
    const temporary = 'temporary-member-password'
    const personal = 'personal-new-password'

    it.each(['user', 'maintainer', 'sysadmin'])('refuses missing or wrong passwords for %s accounts', async (role) => {
      await seed(role)
      expect((await login(memberMobile, '203.0.113.1', '')).status).toBe(401)
      const wrong = await login(memberMobile, '203.0.113.1', 'incorrect')
      const absent = await login('13900000999', '203.0.113.1', 'incorrect')
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual(await absent.json())
      expect((await login()).status).toBe(200)
    })

    it.each(['user', 'maintainer', 'sysadmin'])('requires initial password replacement before %s access', async (role) => {
      await seed()
      const admin = await tokenFor(adminMobile)
      const response = await request('/api/login-users', {
        method: 'POST', headers: { Authorization: `Bearer ${admin}` },
        body: JSON.stringify({ mobile: '13900000003', name: 'New account', role, password: temporary }),
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ user: { passwordConfigured: true, passwordChangeRequired: true } })
      const signedIn = await login('13900000003', '203.0.113.1', temporary)
      const session = await signedIn.json() as { token: string; user: LoginUser; expiresAt: string }
      expect(session.user.passwordChangeRequired).toBe(true)
      expect(session.expiresAt).toBe('2026-10-31T12:15:00.000Z')
      for (const [path, method, body] of [
        ['/api/family-data', 'GET', undefined],
        ['/api/family-data', 'PUT', JSON.stringify({ data: createEmptyFamilyData() })],
        ['/api/login-users', 'GET', undefined],
        ['/api/login-users/2/reset-password', 'POST', JSON.stringify({ password: temporary })],
      ] as const) {
        const blocked = await request(path, { method, body, headers: { Authorization: `Bearer ${session.token}` } })
        expect(blocked.status).toBe(403)
        expect(await blocked.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
      }
      expect((await changePassword(session.token, 'wrong-password', personal)).status).toBe(401)
      expect((await changePassword(session.token, temporary, temporary)).status).toBe(400)
      expect((await changePassword(session.token, temporary, personal)).status).toBe(200)
      await expectRevoked(session.token)
      expect((await login('13900000003', '203.0.113.1', temporary)).status).toBe(401)
      const token = await tokenFor('13900000003', personal)
      expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)
      const write = await request('/api/family-data', {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-Match': '"0"' },
        body: JSON.stringify({ data: createEmptyFamilyData() }),
      })
      expect(write.status).toBe(role === 'user' ? 403 : 200)
    })

    it('uses unique random salts, stores only hashes, and never returns hashes in account responses', async () => {
      await seed()
      const admin = await tokenFor(adminMobile)
      for (const mobile of ['13900000003', '13900000004']) {
        expect((await request('/api/login-users', {
          method: 'POST', headers: { Authorization: `Bearer ${admin}` },
          body: JSON.stringify({ mobile, role: 'user', password: temporary }),
        })).status).toBe(201)
      }
      const rows = await db.prepare('SELECT password_hash FROM login_credentials WHERE user_id > 2 ORDER BY user_id').all<{ password_hash: string }>()
      expect(rows.results).toHaveLength(2)
      const hashes = rows.results!.map(row => row.password_hash)
      expect(hashes[0]).not.toBe(hashes[1])
      for (const hash of hashes) {
        expect(hash).toMatch(/^pbkdf2_sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/)
        expect(hash).not.toContain(temporary)
      }
      const text = await (await request('/api/login-users', { headers: { Authorization: `Bearer ${admin}` } })).text()
      expect(text).not.toContain('password_hash')
      expect(text).not.toContain(temporary)
      expect(text).not.toContain(hashes[0])
    })

    it('authenticates independent administrators without any provisioning Secret', async () => {
      await seed()
      const response = await worker.fetch(new Request('https://test.invalid/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: adminMobile, password }),
      }), { DB: db })
      expect(response.status).toBe(200)
      const session = await response.json() as { token: string; user: LoginUser }
      expect(session.user.passwordChangeRequired).toBe(false)
      const accounts = await worker.fetch(new Request('https://test.invalid/api/login-users', {
        headers: { Authorization: `Bearer ${session.token}` },
      }), { DB: db })
      expect(accounts.status).toBe(200)
    })

    it('migrates only legacy administrators through a restricted session, without a shared-password fallback afterward', async () => {
      await seed()
      const before = await tokenFor(adminMobile)
      db.database.run('DELETE FROM login_credentials')
      db.database.run('DELETE FROM auth_session_credentials')
      await expectRevoked(before)
      expect((await login()).status).toBe(401)
      expect((await login(memberMobile, '203.0.113.1', '')).status).toBe(401)
      const legacy = await login(adminMobile)
      expect(legacy.status).toBe(200)
      const { token, user } = await legacy.json() as { token: string; user: LoginUser }
      expect(user).toMatchObject({ passwordConfigured: false, passwordChangeRequired: true })
      expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403)
      expect((await changePassword(token, password, personal)).status).toBe(200)
      await expectRevoked(token)
      expect((await login(adminMobile)).status).toBe(401)
      const independent = await tokenFor(adminMobile, personal)
      expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${independent}` } })).status).toBe(200)
    })

    it('requires an independent password after bootstrap and permits only one bootstrap under concurrency', async () => {
      const responses = await Promise.all([
        login(adminMobile, '203.0.113.1', password, bootstrapPath),
        login(memberMobile, '203.0.113.2', password, bootstrapPath),
      ])
      expect(responses.map(response => response.status).sort()).toEqual([200, 409])
      const accepted = responses.find(response => response.status === 200)!
      const { token } = await accepted.json() as { token: string }
      expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403)
      expect((await changePassword(token, password, personal)).status).toBe(200)
      await expectRevoked(token)
    })

    it('lets an administrator provision a legacy member password and revokes full and temporary sessions on reset', async () => {
      await seed()
      const admin = await tokenFor(adminMobile)
      const old = await tokenFor(memberMobile)
      expect((await resetPassword(admin, temporary)).status).toBe(200)
      await expectRevoked(old)
      expect((await login()).status).toBe(401)
      const restricted = await tokenFor(memberMobile, temporary)
      expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${restricted}` } })).status).toBe(403)
      expect((await resetPassword(admin, personal)).status).toBe(200)
      await expectRevoked(restricted)
      db.database.run('DELETE FROM login_credentials WHERE user_id = 2')
      expect((await resetPassword(admin, temporary)).status).toBe(200)
      expect((await login(memberMobile, '203.0.113.1', temporary)).status).toBe(200)
    })

    it.each(['user', 'maintainer'])('does not let a %s reset another account password', async (role) => {
      await seed(role)
      const member = await tokenFor(memberMobile)
      expect((await resetPassword(member, personal, 1)).status).toBe(403)
      expect((await resetPassword('', personal)).status).toBe(401)
      const admin = await tokenFor(adminMobile)
      expect((await resetPassword(admin, personal, 1)).status).toBe(400)
      expect((await resetPassword(admin, personal, 999)).status).toBe(404)
    })

    it.each([undefined, null, 123, '', 'short', 'x'.repeat(129), 'a'.repeat(12), ' '.repeat(12)])('rejects invalid new passwords without changing credentials: %s', async (value) => {
      await seed()
      const admin = await tokenFor(adminMobile)
      expect((await resetPassword(admin, value)).status).toBe(400)
      expect((await request('/api/login-users', {
        method: 'POST', headers: { Authorization: `Bearer ${admin}` },
        body: JSON.stringify({ mobile: '13900000003', password: value }),
      })).status).toBe(400)
      expect((await db.prepare('SELECT version FROM login_credentials WHERE user_id = 2').all()).results).toEqual([{ version: 1 }])
      expect((await db.prepare('SELECT id FROM login_users WHERE id = 3').all()).results).toEqual([])
    })

    it('keeps disabled accounts disabled when their password is reset', async () => {
      await seed()
      const admin = await tokenFor(adminMobile)
      expect((await updateUser(admin, { enabled: false })).status).toBe(200)
      expect((await resetPassword(admin, temporary)).status).toBe(200)
      expect((await login(memberMobile, '203.0.113.1', temporary)).status).toBe(401)
      expect((await updateUser(admin, { enabled: true })).status).toBe(200)
      const token = await tokenFor(memberMobile, temporary)
      expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403)
    })

    it.each(['reset', 'change'])('rolls back credentials when session revocation fails during %s', async (operation) => {
      await seed()
      const member = await tokenFor(memberMobile)
      const admin = await tokenFor(adminMobile)
      db.database.run("CREATE TRIGGER fail_password_revoke BEFORE UPDATE ON auth_sessions WHEN NEW.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
      const response = operation === 'reset'
        ? await resetPassword(admin, temporary)
        : await changePassword(member, password, personal)
      expect(response.status).toBe(500)
      expect((await db.prepare('SELECT password_hash, version, must_change_password FROM login_credentials WHERE user_id = 2').all()).results)
        .toEqual([{ password_hash: passwordHash, version: 1, must_change_password: 0 }])
      expect((await request('/api/auth/session', { headers: { Authorization: `Bearer ${member}` } })).status).toBe(200)
    })

    it('allows only one concurrent change of a password version', async () => {
      await seed()
      const token = await tokenFor(memberMobile)
      const responses = await Promise.all([
        changePassword(token, password, personal),
        changePassword(token, password, temporary),
      ])
      expect(responses.filter(response => response.status === 200)).toHaveLength(1)
      expect([401, 409]).toContain(responses.find(response => response.status !== 200)!.status)
      await expectRevoked(token)
      expect((await db.prepare('SELECT version FROM login_credentials WHERE user_id = 2').all()).results).toEqual([{ version: 2 }])
    })

    it('rejects in-flight logins authenticated before a password reset', async () => {
      await seed()
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((query) => {
        if (query.includes('INSERT INTO auth_sessions')) db.database.run('UPDATE login_credentials SET version = version + 1 WHERE user_id = 2')
        return prepare(query)
      })
      expect((await login()).status).toBe(409)
      expect((await db.prepare('SELECT id FROM auth_sessions WHERE user_id = 2').all()).results).toEqual([])
    })

    it('shares the account quota with current-password verification and never persists guessed credentials', async () => {
      await seed()
      const token = await tokenFor(memberMobile)
      for (let i = 0; i < 9; i++) expect((await changePassword(token, 'wrong-password', personal)).status).toBe(401)
      const response = await changePassword(token, password, personal)
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('900')
      expect((await db.prepare('SELECT version FROM login_credentials WHERE user_id = 2').all()).results).toEqual([{ version: 1 }])
    })
  })

  it.each([{ mobile: '13900000003' }, { enabled: false }, { role: 'maintainer' }])('revokes sessions for identity/access changes: %j', async (change) => {
    await seed()
    const token = await tokenFor(memberMobile)
    const admin = await tokenFor(adminMobile, password)
    expect((await updateUser(admin, change)).status).toBe(200)
    await expectRevoked(token)
  })

  it('keeps sessions when only the name changes or identity stays the same', async () => {
    await seed()
    const token = await tokenFor(memberMobile)
    const admin = await tokenFor(adminMobile, password)
    expect((await updateUser(admin, { name: 'Updated', mobile: memberMobile, role: 'user', enabled: true })).status).toBe(200)
    const response = await request('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: { name: 'Updated' } })
  })

  it('revokes a sysadmin session when the admin demotes their own account', async () => {
    await seed('sysadmin')
    const admin = await tokenFor(adminMobile, password)
    expect((await updateUser(admin, { role: 'user' }, 1)).status).toBe(200)
    await expectRevoked(admin)
    const userToken = await tokenFor(adminMobile)
    expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${userToken}` } })).status).toBe(200)
  })

  it.each(['revoke', 'update'])('rolls back both account and sessions when %s fails', async (failure) => {
    await seed()
    const token = await tokenFor(memberMobile)
    const admin = await tokenFor(adminMobile, password)
    db.database.run(failure === 'revoke'
      ? "CREATE TRIGGER fail_revoke BEFORE UPDATE ON auth_sessions WHEN NEW.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected revoke failure'); END"
      : "CREATE TRIGGER fail_update BEFORE UPDATE ON login_users BEGIN SELECT RAISE(ABORT, 'injected account failure'); END")
    expect((await updateUser(admin, { role: 'sysadmin' })).status).toBe(500)
    const current = await request('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ user: { role: 'user' } })
    expect((await request('/api/login-users', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403)
    expect((await db.prepare('SELECT revoked_at FROM auth_sessions WHERE user_id = 2').all()).results).toEqual([{ revoked_at: null }])
  })

  it('does not create a privileged session if promotion races an in-flight mobile login', async () => {
    await seed()
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((query) => {
      if (query.includes('INSERT INTO auth_sessions')) {
        db.database.run("UPDATE login_users SET role = 'sysadmin' WHERE id = 2")
      }
      return prepare(query)
    })
    const response = await login()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'AUTH_CHANGED' })
    expect((await db.prepare('SELECT id FROM auth_sessions WHERE user_id = 2').all()).results).toEqual([])
  })
})

describe('shared, atomic authentication rate limits', () => {
  it('allows ten attempts per account, blocks the eleventh from another source, then recovers at 15 minutes', async () => {
    await seed()
    for (let i = 0; i < 10; i += 1) {
      expect((await login(adminMobile, `203.0.113.${i + 1}`, 'wrong')).status).toBe(401)
    }
    let response = await login(adminMobile, '198.51.100.1', password)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    vi.setSystemTime(new Date('2026-10-31T12:14:59Z'))
    response = await login(adminMobile, '198.51.100.2', password)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('1')
    vi.setSystemTime(new Date('2026-10-31T12:15:00Z'))
    expect((await login(adminMobile, '198.51.100.3', password)).status).toBe(200)
  })

  it('limits one source across changing account numbers and both endpoints', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await login(`1390000${String(i).padStart(4, '0')}`, '203.0.113.1', '', i % 2 ? bootstrapPath : loginPath)).status).toBeLessThan(429)
    }
    for (const path of [loginPath, bootstrapPath]) {
      const response = await login('13999999999', '203.0.113.1', password, path)
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('900')
    }
    expect((await login('13999999999', '203.0.113.2')).status).toBe(401)
    vi.setSystemTime(new Date('2026-10-31T12:15:00Z'))
    expect((await login('13999999999', '203.0.113.1')).status).toBe(401)
  })

  it('shares account counts between bootstrap and login, including valid initialization', async () => {
    for (let i = 0; i < 9; i += 1) {
      expect((await login(adminMobile, `203.0.113.${i + 1}`, i % 2 ? 'wrong' : undefined, i % 2 ? bootstrapPath : loginPath)).status).toBe(401)
    }
    expect((await login(adminMobile, '203.0.113.10', password, bootstrapPath)).status).toBe(200)
    expect((await login(adminMobile, '203.0.113.11', password)).status).toBe(429)
    expect((await login(adminMobile, '203.0.113.12', password, bootstrapPath)).status).toBe(429)
  })

  it('counts account and source reservations atomically under concurrent requests', async () => {
    await seed()
    const accountResults = await Promise.all(Array.from({ length: 25 }, (_, i) => login(memberMobile, `198.51.100.${i + 1}`)))
    expect(accountResults.filter((response) => response.status === 200)).toHaveLength(10)
    expect(accountResults.filter((response) => response.status === 429)).toHaveLength(15)
    const sourceResults = await Promise.all(Array.from({ length: 45 }, (_, i) => login(`1390001${String(i).padStart(4, '0')}`, '203.0.113.99')))
    expect(sourceResults.filter((response) => response.status === 401)).toHaveLength(30)
    expect(sourceResults.filter((response) => response.status === 429)).toHaveLength(15)
  })

  it('keeps counts after a new Worker module and database adapter use the same D1', async () => {
    for (let i = 0; i < 10; i += 1) expect((await login()).status).toBe(401)
    vi.resetModules()
    const restartedWorker = (await import('../../api/index')).default
    db = new TestD1Database(db.database)
    const response = await request(loginPath, { method: 'POST', body: JSON.stringify({ mobile: memberMobile }) }, '203.0.113.9', restartedWorker)
    expect(response.status).toBe(429)
  })

  it('ignores spoofed forwarding headers and uses a shared fallback without platform metadata', async () => {
    for (let i = 0; i < 31; i += 1) {
      const response = await request(loginPath, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': `203.0.113.${i + 1}`, 'X-Forwarded-For': `198.51.100.${i + 1}` },
        body: JSON.stringify({ mobile: `1390002${String(i).padStart(4, '0')}` }),
      }, null)
      expect(response.status).toBe(i < 30 ? 401 : 429)
    }
    expect((await login('13999999999', null)).status).toBe(429)
  })

  it('does not let X-Forwarded-For override the Cloudflare source', async () => {
    for (let i = 0; i < 31; i += 1) {
      const response = await request(loginPath, {
        method: 'POST', headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` },
        body: JSON.stringify({ mobile: `1390003${String(i).padStart(4, '0')}` }),
      })
      expect(response.status).toBe(i < 30 ? 401 : 429)
    }
  })

  it('shares the fallback for absent and malformed Cloudflare source addresses', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await login(`1390005${String(i).padStart(4, '0')}`, i % 2 ? '' : 'not-an-ip')).status).toBe(401)
    }
    expect((await login('13999999999', null)).status).toBe(429)
  })

  it('normalizes account whitespace and equivalent IPv6 spellings', async () => {
    for (let i = 0; i < 10; i += 1) expect((await login(` 139 0000 0002 `, `203.0.113.${i + 1}`)).status).toBe(401)
    expect((await login(memberMobile, '203.0.113.50')).status).toBe(429)
    for (let i = 0; i < 30; i += 1) expect((await login(`1390004${String(i).padStart(4, '0')}`, '2001:0db8:0:0:0:0:0:1')).status).toBe(401)
    expect((await login('13999999999', '2001:db8::1')).status).toBe(429)
  })

  it('does not reset limits after successful logins or rate-limit ordinary authenticated requests', async () => {
    await seed()
    const token = await tokenFor(memberMobile)
    for (let i = 0; i < 9; i += 1) expect((await login()).status).toBe(200)
    expect((await login()).status).toBe(429)
    const prepare = vi.spyOn(db, 'prepare')
    for (let i = 0; i < 35; i += 1) {
      expect((await request('/api/family-data', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)
    }
    expect(prepare.mock.calls.some(([query]) => query.includes('auth_rate_limits'))).toBe(false)
  })

  it('stores only digest keys, bounds expired-row cleanup, and does not slide the window on denial', async () => {
    await login()
    const rows = await db.prepare('SELECT bucket_key, attempts, expires_at FROM auth_rate_limits').all<{ bucket_key: string; attempts: number; expires_at: number }>()
    expect(rows.results).toHaveLength(2)
    for (const row of rows.results ?? []) expect(row.bucket_key).toMatch(/^[a-f0-9]{64}$/)
    const expiry = rows.results![0]!.expires_at
    for (let i = 0; i < 110; i += 1) {
      db.database.run('INSERT INTO auth_rate_limits VALUES (?, 1, ?)', [`expired-${i}`, expiry - 1000])
    }
    await login()
    expect((await db.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits WHERE bucket_key LIKE 'expired-%'").all()).results).toEqual([{ count: 10 }])
    for (let i = 0; i < 20; i += 1) await login()
    expect((await db.prepare('SELECT MAX(attempts) AS attempts, MAX(expires_at) AS expiry FROM auth_rate_limits').all()).results)
      .toEqual([{ attempts: 22, expiry }])
  })

  it.each(['CREATE TABLE IF NOT EXISTS auth_rate_limits', 'INSERT INTO auth_rate_limits'])('fails closed when limiter storage fails at %s', async (failingQuery) => {
    const prepare = db.prepare.bind(db)
    const spy = vi.spyOn(db, 'prepare').mockImplementation((query) => {
      if (query.includes(failingQuery)) throw new Error('injected storage outage')
      return prepare(query)
    })
    for (const path of [loginPath, bootstrapPath]) {
      const response = await login(adminMobile, '203.0.113.1', password, path)
      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(await response.json()).toMatchObject({ code: 'AUTH_RATE_LIMIT_UNAVAILABLE' })
    }
    expect(spy.mock.calls.some(([query]) => query.includes('login_users') || query.includes('auth_sessions'))).toBe(false)
  })

  it('fails closed if the account reservation fails after the source reservation succeeds', async () => {
    const prepare = db.prepare.bind(db)
    let reservations = 0
    const spy = vi.spyOn(db, 'prepare').mockImplementation((query) => {
      if (query.includes('INSERT INTO auth_rate_limits') && ++reservations === 2) {
        throw new Error('injected account reservation outage')
      }
      return prepare(query)
    })
    const response = await login(adminMobile, '203.0.113.1', password)
    expect(response.status).toBe(503)
    expect(spy.mock.calls.some(([query]) => query.includes('login_users'))).toBe(false)
  })

  it('rejects throttled requests before schema, bearer-session resolution, user lookup or PBKDF2', async () => {
    await seed()
    for (let i = 0; i < 10; i += 1) await login(adminMobile, '203.0.113.1', 'wrong')
    const prepare = vi.spyOn(db, 'prepare')
    const derive = vi.spyOn(crypto.subtle, 'deriveBits')
    const response = await request(loginPath, {
      method: 'POST', headers: { Authorization: 'Bearer untrusted-session' },
      body: JSON.stringify({ mobile: adminMobile, password }),
    })
    expect(response.status).toBe(429)
    expect(derive).not.toHaveBeenCalled()
    expect(prepare.mock.calls.every(([query]) => query.includes('auth_rate_limits'))).toBe(true)
  })

  it.each([
    ['not json', 400],
    [JSON.stringify({ mobile: '1'.repeat(65) }), 400],
    [JSON.stringify({ mobile: memberMobile, password: 'a'.repeat(1025) }), 400],
    [JSON.stringify({ mobile: memberMobile, password: 123 }), 400],
    [JSON.stringify({ mobile: memberMobile, padding: 'x'.repeat(4096) }), 413],
    [JSON.stringify({ mobile: memberMobile, padding: '汉'.repeat(1400) }), 413],
  ])('bounds input before expensive work: %s', async (body, status) => {
    const prepare = vi.spyOn(db, 'prepare')
    const response = await request(loginPath, { method: 'POST', body })
    expect(response.status).toBe(status)
    expect(prepare.mock.calls.every(([query]) => query.includes('auth_rate_limits'))).toBe(true)
  })

  it('counts malformed requests against the source limit', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await request(loginPath, { method: 'POST', body: '{' })).status).toBe(400)
    }
    expect((await login()).status).toBe(429)
  })

  it('bounds streamed bodies even with a false Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"mobile":"13900000002","padding":"'))
        controller.enqueue(new TextEncoder().encode('x'.repeat(4096)))
      },
      cancel() { cancelled = true },
    })
    const init: RequestInit & { duplex: string } = {
      method: 'POST', headers: { 'Content-Length': '1' }, body, duplex: 'half',
    }
    expect((await request(loginPath, init)).status).toBe(413)
    expect(cancelled).toBe(true)
  })
})
