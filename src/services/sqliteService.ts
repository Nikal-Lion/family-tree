import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { APP_SCHEMA_VERSION, type FamilyData, type FamilyEvent, type Member, type Track } from '../types/member'
import type { ChildClaim, ChildClaimGender, ChildClaimStatus, ChildClaimStatusFlag } from '../types/childClaim'
import type { Spouse, SpouseRelation, SpouseStatusFlag } from '../types/spouse'

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

  // members table — v4 schema: no spouse_ids, has generation_number
  database.run(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER,
      gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
      generation_number INTEGER,
      birth_date TEXT,
      photo_url TEXT,
      biography TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
    );
  `)

  // Backward-compatible upgrades for existing local SQLite files (v3 → v4).
  try {
    database.run('ALTER TABLE members ADD COLUMN birth_date TEXT;')
  } catch {
    // column exists
  }
  try {
    database.run('ALTER TABLE members ADD COLUMN photo_url TEXT;')
  } catch {
    // column exists
  }
  try {
    database.run('ALTER TABLE members ADD COLUMN biography TEXT;')
  } catch {
    // column exists
  }
  // spouse_ids existed in v3 schema — keep it readable, but we no longer write it.
  try {
    database.run("ALTER TABLE members ADD COLUMN spouse_ids TEXT DEFAULT '[]';")
  } catch {
    // column exists (v3) or not needed (fresh v4 db)
  }
  try {
    database.run('ALTER TABLE members ADD COLUMN generation_number INTEGER;')
  } catch {
    // column exists
  }

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

  database.run(`
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
  `)

  // v4 new tables: spouses and child_claims
  database.run(`
    CREATE TABLE IF NOT EXISTS spouses (
      id INTEGER PRIMARY KEY,
      husband_id INTEGER NOT NULL,
      surname TEXT NOT NULL,
      full_name TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      relation_label TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 1,
      birth_date TEXT NOT NULL DEFAULT '',
      death_date TEXT NOT NULL DEFAULT '',
      burial_place TEXT NOT NULL DEFAULT '',
      biography TEXT NOT NULL DEFAULT '',
      status_flags_json TEXT NOT NULL DEFAULT '[]',
      raw_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (husband_id) REFERENCES members(id) ON DELETE CASCADE
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS child_claims (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL,
      claimed_name TEXT NOT NULL,
      ordinal_index INTEGER NOT NULL DEFAULT 1,
      gender TEXT NOT NULL DEFAULT 'unknown',
      is_adoptive INTEGER NOT NULL DEFAULT 0,
      out_adopted_to_hint TEXT NOT NULL DEFAULT '',
      resolved_member_id INTEGER,
      status TEXT NOT NULL DEFAULT 'missing',
      status_flags_json TEXT NOT NULL DEFAULT '[]',
      raw_text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_member_id) REFERENCES members(id) ON DELETE SET NULL
    );
  `)

  // Ensure metadata seeds for v4 sequence keys
  database.run("INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_spouse_id', '1');")
  database.run("INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_child_claim_id', '1');")
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
    `SELECT
      id,
      name,
      parent_id,
      gender,
      generation_number,
      birth_date,
      photo_url,
      biography
    FROM members
    ORDER BY id ASC;`,
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => {
    const genNum = row[4] === null || row[4] === undefined ? undefined : Number(row[4])
    return {
      id: Number(row[0]),
      name: String(row[1] ?? ''),
      parentId: row[2] === null ? null : Number(row[2]),
      gender: row[3] === '女' ? '女' : '男',
      generationNumber: Number.isFinite(genNum) ? genNum : undefined,
      birthDate: String(row[5] ?? ''),
      photoUrl: String(row[6] ?? ''),
      biography: String(row[7] ?? ''),
    }
  })
}

function querySpouses(database: Database): Spouse[] {
  const result = database.exec(
    `SELECT
      id,
      husband_id,
      surname,
      full_name,
      aliases_json,
      relation_label,
      order_index,
      birth_date,
      death_date,
      burial_place,
      biography,
      status_flags_json,
      raw_text,
      created_at,
      updated_at
    FROM spouses
    ORDER BY husband_id ASC, order_index ASC, id ASC;`,
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => ({
    id: Number(row[0]),
    husbandId: Number(row[1]),
    surname: String(row[2] ?? ''),
    fullName: row[3] === null ? null : String(row[3]),
    aliases: parseJsonValue<string[]>(row[4], []),
    relationLabel: String(row[5] ?? '配') as SpouseRelation,
    order: Number(row[6] ?? 1),
    birthDate: String(row[7] ?? ''),
    deathDate: String(row[8] ?? ''),
    burialPlace: String(row[9] ?? ''),
    biography: String(row[10] ?? ''),
    statusFlags: parseJsonValue<SpouseStatusFlag[]>(row[11], []),
    rawText: String(row[12] ?? ''),
    createdAt: String(row[13] ?? new Date().toISOString()),
    updatedAt: String(row[14] ?? new Date().toISOString()),
  }))
}

function queryChildClaims(database: Database): ChildClaim[] {
  const result = database.exec(
    `SELECT
      id,
      parent_id,
      claimed_name,
      ordinal_index,
      gender,
      is_adoptive,
      out_adopted_to_hint,
      resolved_member_id,
      status,
      status_flags_json,
      raw_text
    FROM child_claims
    ORDER BY parent_id ASC, ordinal_index ASC, id ASC;`,
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => ({
    id: Number(row[0]),
    parentId: Number(row[1]),
    claimedName: String(row[2] ?? ''),
    ordinalIndex: Number(row[3] ?? 1),
    gender: String(row[4] ?? 'unknown') as ChildClaimGender,
    isAdoptive: Number(row[5]) === 1,
    outAdoptedToHint: String(row[6] ?? ''),
    resolvedMemberId: row[7] === null ? null : Number(row[7]),
    status: String(row[8] ?? 'missing') as ChildClaimStatus,
    statusFlags: parseJsonValue<ChildClaimStatusFlag[]>(row[9], []),
    rawText: String(row[10] ?? ''),
  }))
}

function queryEvents(database: Database): FamilyEvent[] {
  const result = database.exec(
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
  )

  const rows = result[0]?.values ?? []
  return rows.map((row: unknown[]) => ({
    id: Number(row[0]),
    memberId: row[1] === null ? null : Number(row[1]),
    type: String(row[2] ?? '其他') as FamilyEvent['type'],
    title: String(row[3] ?? ''),
    date: String(row[4] ?? ''),
    description: String(row[5] ?? ''),
    createdAt: String(row[6] ?? new Date().toISOString()),
    updatedAt: String(row[7] ?? new Date().toISOString()),
  }))
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
  const events = queryEvents(database)
  const spouses = querySpouses(database)
  const childClaims = queryChildClaims(database)
  const maxMemberId = members.length > 0 ? Math.max(...members.map((m) => m.id)) : 0
  const maxTrackId = tracks.length > 0 ? Math.max(...tracks.map((t) => t.id)) : 0
  const maxEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 0
  const maxSpouseId = spouses.length > 0 ? Math.max(...spouses.map((s) => s.id)) : 0
  const maxChildClaimId = childClaims.length > 0 ? Math.max(...childClaims.map((c) => c.id)) : 0

  return {
    schemaVersion: readMetaNumber(database, 'schema_version', APP_SCHEMA_VERSION),
    members,
    events,
    tracks,
    aliases: [],
    relations: [],
    temporals: [],
    burials: [],
    spouses,
    childClaims,
    nextId: Math.max(readMetaNumber(database, 'next_id', maxMemberId + 1), maxMemberId + 1),
    nextTrackId: Math.max(readMetaNumber(database, 'next_track_id', maxTrackId + 1), maxTrackId + 1),
    nextEventId: Math.max(readMetaNumber(database, 'next_event_id', maxEventId + 1), maxEventId + 1),
    nextAliasId: Math.max(readMetaNumber(database, 'next_alias_id', 1), 1),
    nextRelationId: Math.max(readMetaNumber(database, 'next_relation_id', 1), 1),
    nextTemporalId: Math.max(readMetaNumber(database, 'next_temporal_id', 1), 1),
    nextBurialId: Math.max(readMetaNumber(database, 'next_burial_id', 1), 1),
    nextSpouseId: Math.max(readMetaNumber(database, 'next_spouse_id', maxSpouseId + 1), maxSpouseId + 1),
    nextChildClaimId: Math.max(readMetaNumber(database, 'next_child_claim_id', maxChildClaimId + 1), maxChildClaimId + 1),
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
    database.run('DELETE FROM child_claims;')
    database.run('DELETE FROM spouses;')
    database.run('DELETE FROM family_events;')
    database.run('DELETE FROM tracks;')
    database.run('DELETE FROM members;')

    const memberStmt = database.prepare(
      `INSERT INTO members (
        id,
        name,
        parent_id,
        gender,
        generation_number,
        birth_date,
        photo_url,
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
        member.generationNumber ?? null,
        member.birthDate || '',
        member.photoUrl || '',
        member.biography || '',
        nowTs,
        nowTs,
      ])
    }
    memberStmt.free()

    const eventStmt = database.prepare(
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

    for (const event of data.events) {
      eventStmt.run([
        event.id,
        event.memberId,
        event.type,
        event.title,
        event.date,
        event.description || '',
        event.createdAt,
        event.updatedAt,
      ])
    }
    eventStmt.free()

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

    const spouseStmt = database.prepare(
      `INSERT INTO spouses (
        id,
        husband_id,
        surname,
        full_name,
        aliases_json,
        relation_label,
        order_index,
        birth_date,
        death_date,
        burial_place,
        biography,
        status_flags_json,
        raw_text,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )

    for (const spouse of data.spouses) {
      spouseStmt.run([
        spouse.id,
        spouse.husbandId,
        spouse.surname,
        spouse.fullName ?? null,
        JSON.stringify(spouse.aliases),
        spouse.relationLabel,
        spouse.order,
        spouse.birthDate,
        spouse.deathDate,
        spouse.burialPlace,
        spouse.biography,
        JSON.stringify(spouse.statusFlags),
        spouse.rawText,
        spouse.createdAt,
        spouse.updatedAt,
      ])
    }
    spouseStmt.free()

    const childClaimStmt = database.prepare(
      `INSERT INTO child_claims (
        id,
        parent_id,
        claimed_name,
        ordinal_index,
        gender,
        is_adoptive,
        out_adopted_to_hint,
        resolved_member_id,
        status,
        status_flags_json,
        raw_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    )

    for (const claim of data.childClaims) {
      childClaimStmt.run([
        claim.id,
        claim.parentId,
        claim.claimedName,
        claim.ordinalIndex,
        claim.gender,
        claim.isAdoptive ? 1 : 0,
        claim.outAdoptedToHint,
        claim.resolvedMemberId ?? null,
        claim.status,
        JSON.stringify(claim.statusFlags),
        claim.rawText,
      ])
    }
    childClaimStmt.free()

    const metaStmt = database.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);')
    metaStmt.run(['schema_version', String(data.schemaVersion)])
    metaStmt.run(['next_id', String(data.nextId)])
    metaStmt.run(['next_track_id', String(data.nextTrackId)])
    metaStmt.run(['next_event_id', String(data.nextEventId)])
    metaStmt.run(['next_alias_id', String(data.nextAliasId)])
    metaStmt.run(['next_relation_id', String(data.nextRelationId)])
    metaStmt.run(['next_temporal_id', String(data.nextTemporalId)])
    metaStmt.run(['next_burial_id', String(data.nextBurialId)])
    metaStmt.run(['next_spouse_id', String(data.nextSpouseId)])
    metaStmt.run(['next_child_claim_id', String(data.nextChildClaimId)])
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