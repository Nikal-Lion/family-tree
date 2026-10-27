import { describe, expect, it, vi } from 'vitest'
import { familyFixture } from '../fixtures/familyData'
import { createSqliteBackup, readSqliteBackup } from '../../src/services/backupService'
import { parsePartDataMarkdownV2 } from '../../src/services/partDataImportV2'
import { normalizeFamilyData } from '../../src/services/importExport'

vi.mock('../../src/services/sqliteService', () => ({
  async getSqlRuntime() {
    const { default: init } = await import('sql.js')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    return init({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  },
}))
describe('real SQLite family backups', () => {
  it('exports a SQLite binary and restores every collection without a cloud write', async () => {
    const data = familyFixture()
    const binary = await createSqliteBackup(data)
    expect(new TextDecoder().decode(binary.slice(0, 16))).toBe('SQLite format 3\0')
    expect(await readSqliteBackup(binary)).toEqual(data)
  })
  it('accepts historical JSON content mislabeled as SQLite', async () => {
    const data = familyFixture()
    expect(await readSqliteBackup(new TextEncoder().encode(JSON.stringify(data)))).toEqual(data)
  })
  it('preserves biological and adoptive parents and both source claims across SQLite backup', async () => {
    const data = normalizeFamilyData(parsePartDataMarkdownV2('# 本房\n## 十世\n祥甫 ，生子：贤敬（出继）。\n俊甫 ，继子：贤敬。\n## 十一世\n贤敬 俊甫继子。'))
    expect(data.relations.map((relation) => relation.type)).toEqual(['father', 'adoptive-parent'])
    expect(await readSqliteBackup(await createSqliteBackup(data))).toEqual(data)
  })
  it('rejects unrelated real SQLite databases', async () => {
    const { getSqlRuntime } = await import('../../src/services/sqliteService')
    const SQL = await getSqlRuntime()
    const database = new SQL.Database()
    database.run('CREATE TABLE unrelated (id INTEGER)')
    const binary = database.export()
    database.close()
    await expect(readSqliteBackup(binary)).rejects.toThrow('本系统导出的完整备份')
  })
})
