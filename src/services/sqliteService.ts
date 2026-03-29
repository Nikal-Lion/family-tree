import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { FamilyData, Member, Track } from '../types/member'

const SQLITE_DB_NAME = 'family-tree-sqlite'
const SQLITE_STORE_NAME = 'dbfiles'
const SQLITE_DB_KEY = 'family-tree.db'

let sqlRuntimePromise: Promise<SqlJsStatic> | null = null
let dbInstance: Database | null = null

function getSqlRuntime(): Promise<SqlJsStatic> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = initSqlJs({
      locateFile: () => wasmUrl,
    })
  }
  return sqlRuntimePromise!
}

function openPersistDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(SQLITE_STORE_NAME)) {
        database.createObjectStore(SQLITE_STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'))
  })
}

async function readPersistedDbBinary(): Promise<Uint8Array | null> {
  const database = await openPersistDb()

  return new Promise((resolve, reject) => {
    const tx = database.transaction(SQLITE_STORE_NAME, 'readonly')
    const store = tx.objectStore(SQLITE_STORE_NAME)
    const request = store.get(SQLITE_DB_KEY)

    request.onsuccess = () => {
      const value = request.result
      if (value instanceof Uint8Array) {
        resolve(value)
        return
      }
      if (value instanceof ArrayBuffer) {
        resolve(new Uint8Array(value))
        return
      }
      resolve(null)
    }

    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'))
    tx.oncomplete = () => database.close()
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB 事务失败'))
      database.close()
    }
  })
}

async function persistDbBinary(binary: Uint8Array): Promise<void> {
  const database = await openPersistDb()

  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(SQLITE_STORE_NAME, 'readwrite')
    const store = tx.objectStore(SQLITE_STORE_NAME)
    store.put(binary, SQLITE_DB_KEY)

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
  })

  database.close()
}

function migrateTables(database: Database): void {
  database.run('PRAGMA foreign_keys = ON;')

  database.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER,
      gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
      spouse_ids TEXT DEFAULT '[]',
      birth_year TEXT,
      death_year TEXT,
      biography TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
    );
  `)

  database.run(`
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
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
}

function parseJsonValue<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readMetaNumber(database: Database, key: string, fallback: number): number {
  const result = database.exec('SELECT value FROM metadata WHERE key = ? LIMIT 1;', [key])
  const row = result[0]?.values?.[0]?.[0]
  const parsed = Number(row)
  return Number.isFinite(parsed) ? parsed : fallback
}

function queryMembers(database: Database): Member[] {
  const result = database.exec(
    'SELECT id, name, parent_id, gender, spouse_ids FROM members ORDER BY id ASC;',
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => {
    const spouseIdsRaw = parseJsonValue<number[]>(row[4], [])
    const spouseIds = spouseIdsRaw.filter((id) => Number.isInteger(id))

    return {
      id: Number(row[0]),
      name: String(row[1] ?? ''),
      parentId: row[2] === null ? null : Number(row[2]),
      gender: row[3] === '女' ? '女' : '男',
      spouseIds,
    }
  })
}

function queryTracks(database: Database): Track[] {
  const result = database.exec(
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
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => ({
    id: Number(row[0]),
    name: String(row[1] ?? ''),
    memberId: row[2] === null ? null : Number(row[2]),
    points: parseJsonValue(row[3], []),
    startPoint: parseJsonValue(row[4], { lat: 0, lng: 0 }),
    endPoint: parseJsonValue(row[5], { lat: 0, lng: 0 }),
    stats: parseJsonValue(row[6], {
      distanceMeters: 0,
      pointCount: 0,
      elevationGainMeters: null,
    }),
    createdAt: String(row[7] ?? new Date().toISOString()),
    updatedAt: String(row[8] ?? new Date().toISOString()),
  })) as Track[]
}

function toFamilyData(database: Database): FamilyData {
  const members = queryMembers(database)
  const tracks = queryTracks(database)
  const maxMemberId = members.length > 0 ? Math.max(...members.map((m) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0

  return {
    schemaVersion: readMetaNumber(database, 'schema_version', 2),
    members,
    tracks,
    nextId: Math.max(readMetaNumber(database, 'next_id', maxMemberId + 1), maxMemberId + 1),
    nextTrackId: Math.max(readMetaNumber(database, 'next_track_id', maxTrackId + 1), maxTrackId + 1),
  }
}

function hasRows(database: Database, tableName: 'members' | 'tracks'): boolean {
  const result = database.exec(`SELECT COUNT(1) FROM ${tableName};`)
  const count = Number(result[0]?.values?.[0]?.[0] ?? 0)
  return count > 0
}

function assertDbReady(): Database {
  if (!dbInstance) {
    throw new Error('SQLite 尚未初始化')
  }
  return dbInstance
}

export async function initSqliteStorage(): Promise<void> {
  if (dbInstance) {
    return
  }

  const SQL = await getSqlRuntime()
  const persisted = await readPersistedDbBinary()
  dbInstance = persisted ? new SQL.Database(persisted) : new SQL.Database()
  migrateTables(dbInstance)

  if (!persisted) {
    await persistDbBinary(dbInstance.export())
  }
}

export async function loadFamilyDataFromSqlite(): Promise<FamilyData | null> {
  await initSqliteStorage()
  const database = assertDbReady()
  if (!hasRows(database, 'members')) {
    return null
  }
  return toFamilyData(database)
}

export async function saveFamilyDataToSqlite(data: FamilyData): Promise<void> {
  await initSqliteStorage()
  const database = assertDbReady()
  const nowTs = Math.floor(Date.now() / 1000)

  database.run('BEGIN TRANSACTION;')
  try {
    database.run('DELETE FROM tracks;')
    database.run('DELETE FROM members;')

    const memberStmt = database.prepare(
      `INSERT INTO members (
        id,
        name,
        parent_id,
        gender,
        spouse_ids,
        birth_year,
        death_year,
        biography,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )

    for (const member of data.members) {
      memberStmt.run([
        member.id,
        member.name,
        member.parentId,
        member.gender,
        JSON.stringify(member.spouseIds),
        null,
        null,
        null,
        nowTs,
        nowTs,
      ])
    }
    memberStmt.free()

    const trackStmt = database.prepare(
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

    for (const track of data.tracks) {
      trackStmt.run([
        track.id,
        track.name,
        track.memberId,
        JSON.stringify(track.points),
        JSON.stringify(track.startPoint),
        JSON.stringify(track.endPoint),
        JSON.stringify(track.stats),
        track.createdAt,
        track.updatedAt,
      ])
    }
    trackStmt.free()

    const metaStmt = database.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);')
    metaStmt.run(['schema_version', String(data.schemaVersion)])
    metaStmt.run(['next_id', String(data.nextId)])
    metaStmt.run(['next_track_id', String(data.nextTrackId)])
    metaStmt.run(['last_write_at', new Date().toISOString()])
    metaStmt.free()

    database.run('COMMIT;')
    await persistDbBinary(database.export())
  } catch (error) {
    database.run('ROLLBACK;')
    throw error
  }
}

export async function exportSqliteBinary(): Promise<Uint8Array> {
  await initSqliteStorage()
  return assertDbReady().export()
}

export async function importSqliteBinary(binary: Uint8Array): Promise<FamilyData> {
  const SQL = await getSqlRuntime()
  const nextDb = new SQL.Database(binary)
  migrateTables(nextDb)

  if (dbInstance) {
    dbInstance.close()
  }
  dbInstance = nextDb

  await persistDbBinary(dbInstance.export())
  return toFamilyData(dbInstance)
}