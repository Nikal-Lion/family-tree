import { afterEach, describe, expect, it, vi } from 'vitest'
import { familyFixture } from '../fixtures/familyData'
import { createBackupDownload, downloadBackup, readBackupFile } from '../../src/services/backupFiles'
import { createSqliteBackup, readSqliteBackup } from '../../src/services/backupService'

vi.mock('../../src/services/backupService', () => ({
  createSqliteBackup: vi.fn(),
  readSqliteBackup: vi.fn(),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('backup file workflow', () => {
  it('reads uppercase JSON extensions and preserves every business collection', async () => {
    const data = familyFixture()
    expect(await readBackupFile(new File([JSON.stringify(data)], 'family.JSON'))).toEqual(data)
  })
  it.each(['family.sqlite', 'family.DB'])('routes %s through the binary backup validator', async name => {
    const binary = new Uint8Array([83, 81, 76, 0, 255])
    vi.mocked(readSqliteBackup).mockResolvedValueOnce(familyFixture())
    const file = new File([binary], name)
    const text = vi.spyOn(file, 'text')
    expect(await readBackupFile(file)).toEqual(familyFixture())
    expect(readSqliteBackup).toHaveBeenLastCalledWith(binary)
    expect(text).not.toHaveBeenCalled()
  })
  it('rejects unsupported file formats without treating them as JSON', async () => {
    const file = new File(['{}'], 'family.md')
    const text = vi.spyOn(file, 'text')
    await expect(readBackupFile(file)).rejects.toThrow('Markdown 导入')
    expect(text).not.toHaveBeenCalled()
  })
  it('surfaces invalid JSON and file read failures', async () => {
    await expect(readBackupFile(new File(['broken'], 'family.json'))).rejects.toThrow()
    await expect(readBackupFile({
      name: 'family.json',
      text: () => Promise.reject(new Error('read failed')),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })).rejects.toThrow('read failed')
  })
  it('generates timestamped full JSON downloads', async () => {
    const data = familyFixture()
    const { blob, filename } = await createBackupDownload(data, 'json', new Date('2026-01-02T03:04:05Z'))
    expect(filename).toBe('family-tree-2026-01-02T03-04-05-000Z.json')
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(JSON.parse(await blob.text())).toEqual(data)
  })
  it('keeps exact SQLite bytes and propagates export failures', async () => {
    const binary = new Uint8Array([83, 81, 76, 0, 255])
    vi.mocked(createSqliteBackup).mockResolvedValueOnce(binary)
    const { blob, filename } = await createBackupDownload(familyFixture(), 'sqlite')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(binary)
    expect(filename).toMatch(/\.sqlite$/)
    vi.mocked(createSqliteBackup).mockRejectedValueOnce(new Error('WASM failed'))
    await expect(createBackupDownload(familyFixture(), 'sqlite')).rejects.toThrow('WASM failed')
  })
  it.each([false, true])('cleans up download anchors and URLs even when click fails (%s)', fail => {
    vi.useFakeTimers()
    const anchor = {
      href: '', download: '',
      click: vi.fn(() => { if (fail) throw new Error('download blocked') }),
      remove: vi.fn(),
    }
    const append = vi.fn()
    vi.stubGlobal('document', { createElement: () => anchor, body: { append } })
    vi.stubGlobal('window', { setTimeout })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup-test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const run = () => downloadBackup(new Blob(['test']), 'backup.json')
    if (fail) expect(run).toThrow('download blocked')
    else run()
    expect(append).toHaveBeenCalledWith(anchor)
    expect(anchor.download).toBe('backup.json')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:backup-test')
  })
})
