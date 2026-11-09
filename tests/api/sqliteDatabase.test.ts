import { pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import api, { initializeDatabase } from '../../api/index'
import { createSqliteDatabase } from '../../server/sqliteDatabase'
import { familyFixture } from '../fixtures/familyData'

const initialPassword = 'temporary-test-password'
const salt = '0123456789abcdef0123456789abcdef'
const passwordHash = `pbkdf2_sha256$100000$${salt}$${pbkdf2Sync(initialPassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`
let database: ReturnType<typeof createSqliteDatabase>
let databaseDirectory: string

afterEach(() => {
  database.close()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('self-hosted SQLite API adapter', () => {
  it('initializes schema and serves authenticated family-data requests', async () => {
    databaseDirectory = mkdtempSync(join(tmpdir(), 'family-tree-sqlite-'))
    const databasePath = join(databaseDirectory, 'family-tree.sqlite')
    database = createSqliteDatabase(databasePath)
    const environment = { DB: database }
    await initializeDatabase(database)
    await database.prepare(`INSERT INTO login_users (id, mobile, role, enabled, created_at, updated_at)
      VALUES (1, '13900000001', 'sysadmin', 1, '', '')`).all()
    await database.prepare('INSERT INTO login_credentials VALUES (1, ?, 0, 1)').bind(passwordHash).all()
    const login = await api.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '13900000001', password: initialPassword }),
    }), environment)
    expect(login.status).toBe(200)
    const { token } = await login.json() as { token: string }

    const data = familyFixture()
    const write = await api.fetch(new Request('http://localhost/api/family-data', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ data }),
    }), environment)
    expect(write.status).toBe(200)

    const read = await api.fetch(new Request('http://localhost/api/family-data', {
      headers: { Authorization: `Bearer ${token}` },
    }), environment)
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ data, revision: 1 })

    await database.exec(`CREATE TRIGGER reject_test_event BEFORE INSERT ON family_events
      WHEN NEW.title = 'force failure' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    const changed = familyFixture()
    changed.members[0]!.name = '不得部分保存'
    changed.events[0]!.title = 'force failure'
    const failedWrite = await api.fetch(new Request('http://localhost/api/family-data', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({ data: changed }),
    }), environment)
    expect(failedWrite.status).toBe(500)
    const afterFailure = await api.fetch(new Request('http://localhost/api/family-data', {
      headers: { Authorization: `Bearer ${token}` },
    }), environment)
    expect(await afterFailure.json()).toMatchObject({ data, revision: 1 })

    database.close()
    database = createSqliteDatabase(databasePath)
    const afterRestart = await api.fetch(new Request('http://localhost/api/family-data', {
      headers: { Authorization: `Bearer ${token}` },
    }), { DB: database })
    expect(await afterRestart.json()).toMatchObject({ data, revision: 1 })
  })
})
