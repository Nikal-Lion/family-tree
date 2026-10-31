import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import worker from '../../api/index'
import { createEmptyFamilyData } from '../../src/services/importExport'
import type { FamilyData } from '../../src/types/member'
import { familyFixture } from '../fixtures/familyData'
import { TestD1Database } from '../helpers/d1Database'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
let db: TestD1Database
const accountPassword = 'temporary-test-password'
const adminHeaders = { Authorization: 'Bearer unit-test-only', 'Content-Type': 'application/json' }
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }) })
beforeEach(() => { db = new TestD1Database(new SQL.Database()) })
afterEach(() => db.database.close())
function request(path = '/api/family-data', init: RequestInit = {}) {
  return worker.fetch(new Request(`http://local.invalid${path}`, { ...init, headers: init.headers ?? adminHeaders }), {
    DB: db, API_TOKEN: 'unit-test-only', ALLOW_LEGACY_API_TOKEN_AUTH: 'true',
  })
}
async function read() {
  const response = await request()
  expect(response.status).toBe(200)
  return await response.json() as { data: FamilyData | null; revision: number }
}
function write(data: unknown, revision: number) {
  return request('/api/family-data', { method: 'PUT', headers: { ...adminHeaders, 'If-Match': `"${revision}"` }, body: JSON.stringify({ data }) })
}
describe('actual Worker family persistence with SQLite transactions', () => {
  it('does not initialize a blank database with sample members', async () => {
    expect(await read()).toEqual({ data: null, revision: 0 })
    expect(await read()).toEqual({ data: null, revision: 0 })
  })
  it('round-trips the complete v4 snapshot and ID counters', async () => {
    await read()
    const data = familyFixture()
    expect((await write(data, 0)).status).toBe(200)
    expect(await read()).toEqual({ data, revision: 1 })
  })
  it('keeps standalone public events and tracks even when no members remain', async () => {
    await read()
    const source = familyFixture()
    const data = { ...createEmptyFamilyData(), events: source.events.map((item) => ({ ...item, memberId: null })), tracks: source.tracks.map((item) => ({ ...item, memberId: null, memberIds: [] })), nextEventId: source.nextEventId, nextTrackId: source.nextTrackId }
    expect((await write(data, 0)).status).toBe(200)
    expect((await read()).data).toEqual(data)
  })
  it('round-trips multiple track members in the configured order', async () => {
    await read()
    const data = familyFixture()
    data.tracks[0]!.memberId = 2
    data.tracks[0]!.memberIds = [2, 3, 1]
    expect((await write(data, 0)).status).toBe(200)
    expect((await read()).data?.tracks[0]?.memberIds).toEqual([2, 3, 1])
  })
  it.each([false, true])('upgrades legacy account roles with an existing name column: %s', async (hasName) => {
    db.database.run(`CREATE TABLE login_users (
      id INTEGER PRIMARY KEY, mobile TEXT UNIQUE, role TEXT CHECK(role IN ('user','sysadmin')),
      enabled INTEGER, created_at TEXT, updated_at TEXT${hasName ? ", name TEXT NOT NULL DEFAULT ''" : ''}
    )`)
    db.database.run(`INSERT INTO login_users (id,mobile,role,enabled,created_at,updated_at)
      VALUES (1,'13900000001','sysadmin',1,'2026-01-01','2026-01-01')`)
    if (hasName) db.database.run("UPDATE login_users SET name='已有名称'")
    db.database.run(`CREATE TABLE auth_sessions (
      id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE, user_id INTEGER,
      expires_at TEXT, revoked_at TEXT, created_at TEXT, updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES login_users(id) ON DELETE CASCADE
    )`)
    const token = 'legacy-session-test'
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')
    db.database.run("INSERT INTO auth_sessions VALUES (1,?,1,'2099-01-01',NULL,'2026-01-01','2026-01-01')", [hash])
    await read()
    const users = await request('/api/login-users')
    expect(users.status).toBe(200)
    expect(await users.json()).toMatchObject({ users: [{ id: 1, name: hasName ? '已有名称' : '', mobile: '13900000001' }] })
    const session = await request('/api/auth/session', { headers: { Authorization: `Bearer ${token}` } })
    expect(session.status).toBe(401)
    db.database.run("INSERT INTO members (id,name,gender) VALUES (1,'甲','男')")
    db.database.run(`INSERT INTO tracks (id,name,member_id,points_json,start_point_json,end_point_json,stats_json,created_at,updated_at)
      VALUES (1,'旧轨迹',1,'[{"lat":1,"lng":2},{"lat":2,"lng":3}]','{"lat":1,"lng":2}','{"lat":2,"lng":3}','{"distanceMeters":100}', '', '')`)
    expect((await read()).data?.tracks[0]?.memberIds).toEqual([1])
  })
  it('persists account names in account lists, login and restored sessions', async () => {
    const response = await request('/api/login-users', { method: 'POST', body: JSON.stringify({ mobile: '13900000002', name: '  测试族人  ', role: 'user', password: accountPassword }) })
    expect(response.status).toBe(201)
    const { user } = await response.json() as { user: { id: number; name: string } }
    expect(user.name).toBe('测试族人')
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ mobile: '13900000002', password: accountPassword }) })
    const session = await login.json() as { user: { name: string }; token: string }
    expect(session.user.name).toBe('测试族人')
    expect((await request(`/api/login-users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name: '新名称' }) })).status).toBe(200)
    const restored = await request('/api/auth/session', { headers: { Authorization: `Bearer ${session.token}` } })
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({ user: { name: '新名称' } })
    expect(await (await request('/api/login-users')).json()).toMatchObject({ users: [{ name: '新名称' }] })
    expect((await request(`/api/login-users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name: 123 }) })).status).toBe(400)
    expect(await (await request('/api/login-users')).json()).toMatchObject({ users: [{ name: '新名称' }] })
  })
  it.each([123, null, '名'.repeat(101)])('rejects invalid account names %s without creating an account', async (name) => {
    const response = await request('/api/login-users', { method: 'POST', body: JSON.stringify({ mobile: '13900000002', name, password: accountPassword }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_NAME' })
  })
  it('persists an intentionally emptied family and never recreates example people', async () => {
    await read()
    expect((await write(familyFixture(), 0)).status).toBe(200)
    expect((await write(createEmptyFamilyData(), 1)).status).toBe(200)
    expect(await read()).toEqual({ data: createEmptyFamilyData(), revision: 2 })
  })
  it('rolls back all tables and the revision when a later SQL statement fails', async () => {
    await read()
    const original = familyFixture()
    expect((await write(original, 0)).status).toBe(200)
    db.database.run("CREATE TRIGGER injected_failure BEFORE INSERT ON family_events WHEN NEW.title='fail' BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    const changed = familyFixture()
    changed.members[0]!.name = '不能部分保存'
    changed.events[0]!.title = 'fail'
    expect((await write(changed, 1)).status).toBe(500)
    expect(await read()).toEqual({ data: original, revision: 1 })
    expect((await write(original, 1)).status).toBe(200)
  })
  it('rejects stale and concurrent whole-family replacements atomically', async () => {
    await read()
    const first = familyFixture()
    const second = familyFixture()
    second.members[0]!.name = '另一页面'
    const responses = await Promise.all([write(first, 0), write(second, 0)])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const accepted = responses[0]!.status === 200 ? first : second
    expect(await read()).toEqual({ data: accepted, revision: 1 })
  })
  it('rejects missing revisions, invalid references and cycles without changing data', async () => {
    await read()
    expect((await request('/api/family-data', { method: 'PUT', body: JSON.stringify({ data: familyFixture() }) })).status).toBe(428)
    const bad = familyFixture()
    bad.spouses[0]!.husbandId = 999
    expect((await write(bad, 0)).status).toBe(400)
    const cycle = familyFixture()
    cycle.members[0]!.parentId = 3
    expect((await write(cycle, 0)).status).toBe(400)
    const track = familyFixture()
    track.tracks[0]!.memberIds = [3, 999]
    expect((await write(track, 0)).status).toBe(400)
    expect(await read()).toEqual({ data: null, revision: 0 })
  })
  it('migrates legacy spouse IDs to explicit relations without losing the people', async () => {
    await read()
    db.database.run("INSERT INTO members (id,name,parent_id,gender,spouse_ids) VALUES (1,'甲',NULL,'男','[2]'),(2,'乙',NULL,'女','[1]')")
    db.database.run("INSERT INTO metadata VALUES ('schema_version','3')")
    const legacy = await read()
    expect(legacy.data?.members).toHaveLength(2)
    expect(legacy.data?.relations).toHaveLength(1)
    expect(legacy.data?.relations[0]?.type).toBe('spouse')
    expect((await write(legacy.data, 0)).status).toBe(200)
    expect((await read()).data).toEqual(legacy.data)
  })
  it('allows read-only sessions to read but refuses their writes', async () => {
    await read()
    const create = await request('/api/login-users', { method: 'POST', body: JSON.stringify({ mobile: '13900000002', role: 'user', password: accountPassword }) })
    expect(create.status).toBe(201)
    db.database.run('UPDATE login_credentials SET must_change_password = 0')
    const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ mobile: '13900000002', password: accountPassword }) })
    expect(login.status).toBe(200)
    const session = await login.json() as { token: string }
    const headers = { ...adminHeaders, Authorization: `Bearer ${session.token}`, 'If-Match': '"0"' }
    expect((await request('/api/family-data', { headers })).status).toBe(200)
    expect((await request('/api/family-data', { method: 'PUT', headers, body: JSON.stringify({ data: familyFixture() }) })).status).toBe(403)
    expect(await read()).toEqual({ data: null, revision: 0 })
  })
})
