import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeStorage, saveFamilyData } from '../../src/services/storage'
import { createEmptyFamilyData } from '../../src/services/importExport'
import { familyFixture } from '../fixtures/familyData'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('../../src/services/d1ApiService', () => ({ loadFamilyDataFromD1: mocks.load, saveFamilyDataToD1: mocks.save }))
beforeEach(() => vi.clearAllMocks())
describe('honest online storage', () => {
  it('does not seed or migrate data during a read, including read-only logins', async () => {
    mocks.load.mockResolvedValue(null)
    expect(await initializeStorage()).toEqual(createEmptyFamilyData())
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not replace an empty cloud family with demonstration members', async () => {
    mocks.load.mockResolvedValue(createEmptyFamilyData())
    expect((await initializeStorage()).members).toEqual([])
  })
  it('surfaces connection failure instead of returning an unrelated local family', async () => {
    mocks.load.mockRejectedValue(new Error('连接失败'))
    await expect(initializeStorage()).rejects.toThrow('连接失败')
  })
  it('propagates cloud write errors', async () => {
    mocks.save.mockRejectedValueOnce(new Error('409'))
    await expect(saveFamilyData(familyFixture())).rejects.toThrow('409')
  })
})
