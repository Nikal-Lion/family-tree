import type { FamilyData } from '../types/member'
import { exportAsJson, parseImportedJson } from './importExport'

export async function createSqliteBackup(data: FamilyData): Promise<Uint8Array> {
  const payload = exportAsJson(data)
  const { getSqlRuntime } = await import('./sqliteService')
  const SQL = await getSqlRuntime()
  const database = new SQL.Database()
  try {
    database.run('CREATE TABLE family_backup (format_version INTEGER NOT NULL, payload TEXT NOT NULL)')
    database.run('INSERT INTO family_backup VALUES (?, ?)', [1, payload])
    return database.export()
  } finally {
    database.close()
  }
}

export async function readSqliteBackup(binary: Uint8Array): Promise<FamilyData> {
  const header = new TextDecoder().decode(binary.slice(0, 16))
  if (header !== 'SQLite format 3\0') {
    // Early releases mislabeled JSON downloads as SQLite.
    return parseImportedJson(new TextDecoder().decode(binary))
  }
  const { getSqlRuntime } = await import('./sqliteService')
  const SQL = await getSqlRuntime()
  const database = new SQL.Database(binary)
  try {
    const table = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='family_backup'")
    if (!table.length) throw new Error('不支持此 SQLite 文件：请选择本系统导出的完整备份')
    const rows = database.exec('SELECT format_version, payload FROM family_backup')
    if (rows[0]?.values.length !== 1 || rows[0].values[0]?.[0] !== 1 || typeof rows[0].values[0]?.[1] !== 'string') {
      throw new Error('SQLite 备份格式或版本不正确')
    }
    return parseImportedJson(rows[0].values[0][1])
  } finally {
    database.close()
  }
}
