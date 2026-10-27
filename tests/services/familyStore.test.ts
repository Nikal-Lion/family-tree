import { beforeEach, describe, expect, it, vi } from 'vitest'
import { familyFixture } from '../fixtures/familyData'
import { createMemberInput } from '../../src/services/memberProfile'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), save: vi.fn(), load: vi.fn() }))
vi.mock('../../src/services/storage', () => ({ initializeStorage: mocks.initialize, saveFamilyData: mocks.save }))
vi.mock('../../src/services/d1ApiService', () => ({ loadFamilyDataFromD1: mocks.load }))

async function storeFixture() {
  const { useFamilyStore } = await import('../../src/stores/familyStore')
  const store = useFamilyStore()
  await store.init()
  return store
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.initialize.mockResolvedValue(familyFixture())
  mocks.load.mockResolvedValue(familyFixture())
  mocks.save.mockResolvedValue(undefined)
})
describe('durable family mutations', () => {
  it('waits for cloud acknowledgement before reporting success', async () => {
    const store = await storeFixture()
    let release!: () => void
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    let done = false
    const result = store.addMember({ ...createMemberInput(), name: '新成员', generationNumber: 11 }).then((value) => { done = true; return value })
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(store.saving.value).toBe(true)
    expect(done).toBe(false)
    release()
    expect((await result).ok).toBe(true)
    expect(store.saving.value).toBe(false)
    expect(mocks.save.mock.calls[0]![0].members.at(-1).generationNumber).toBe(11)
  })
  it('rolls back failed writes including counters, relations and selection', async () => {
    const store = await storeFixture()
    const before = store.exportData()
    const selected = store.selectedId.value
    mocks.save.mockRejectedValueOnce(new Error('网络不可用'))
    const result = await store.addMember({ ...createMemberInput(), name: '不能假成功' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('网络不可用')
    expect(store.exportData()).toEqual(before)
    expect(store.selectedId.value).toBe(selected)
    expect(store.lastSaveError.value).toBe('网络不可用')
  })
  it('does not poison later writes or cloud refresh after failure', async () => {
    const store = await storeFixture()
    mocks.save.mockRejectedValueOnce(new Error('403'))
    expect((await store.updateMember(1, { ...createMemberInput(store.members.value[0]), name: '拒绝保存' })).ok).toBe(false)
    expect((await store.updateMember(1, { ...createMemberInput(store.members.value[0]), name: '后续成功', generationNumber: 12 })).ok).toBe(true)
    expect(store.lastSaveError.value).toBe('')
    await expect(store.syncFromCloud()).resolves.toBe(true)
  })
  it('clears the failed-save warning after cloud refresh and allows another write', async () => {
    const store = await storeFixture()
    mocks.save.mockRejectedValueOnce(new Error('需要重新加载云端'))
    expect((await store.updateMember(1, { ...createMemberInput(store.members.value[0]), name: '未保存修改' })).ok).toBe(false)
    expect(store.lastSaveError.value).toBe('需要重新加载云端')
    const cloud = familyFixture()
    cloud.members[0]!.name = '云端最新成员'
    mocks.load.mockResolvedValueOnce(cloud)
    await expect(store.syncFromCloud()).resolves.toBe(true)
    expect(store.lastSaveError.value).toBe('')
    expect(store.members.value[0]?.name).toBe('云端最新成员')
    expect(mocks.save).toHaveBeenCalledOnce()
    expect((await store.updateMember(1, { ...createMemberInput(store.members.value[0]), name: '重新保存成功' })).ok).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]![0].members[0]?.name).toBe('重新保存成功')
    expect(store.lastSaveError.value).toBe('')
    expect(store.saving.value).toBe(false)
  })
  it('restores all related collections after a cascading deletion fails', async () => {
    const store = await storeFixture()
    const before = store.exportData()
    const selected = store.selectedId.value
    mocks.save.mockRejectedValueOnce(new Error('拒绝删除'))
    expect((await store.deleteMember(1)).ok).toBe(false)
    const attempted = mocks.save.mock.calls[0]![0]
    expect(attempted.members.map((item: { id: number }) => item.id)).toEqual([2])
    expect(attempted.spouses).toEqual([])
    expect(attempted.childClaims).toEqual([])
    expect(attempted.tracks[0]?.memberId).toBe(null)
    expect(store.exportData()).toEqual(before)
    expect(store.selectedId.value).toBe(selected)
  })
  it('serializes overlapping mutations and snapshots their payloads', async () => {
    const store = await storeFixture()
    const first = store.addMember({ ...createMemberInput(), name: '第一人' })
    const second = store.addMember({ ...createMemberInput(), name: '第二人' })
    expect((await first).ok).toBe(true)
    expect((await second).ok).toBe(true)
    const firstPayload = mocks.save.mock.calls[0]![0]
    const secondPayload = mocks.save.mock.calls[1]![0]
    expect(firstPayload.members.map((item: { name: string }) => item.name)).not.toContain('第二人')
    expect(secondPayload.members.at(-1).id).toBe(5)
  })
  it('avoids deadlock when refresh is requested immediately after a write', async () => {
    const store = await storeFixture()
    const results = await Promise.all([store.addMember({ ...createMemberInput(), name: '并发' }), store.syncFromCloud()])
    expect(results[0].ok).toBe(true)
    expect(results[1]).toBe(true)
  })
  it('orders a write, refresh and another write without circular waiting', async () => {
    const store = await storeFixture()
    let release!: () => void
    mocks.load.mockImplementationOnce(() => new Promise<ReturnType<typeof familyFixture>>((resolve) => {
      release = () => resolve(familyFixture())
    }))
    const first = store.addMember({ ...createMemberInput(), name: '刷新前' })
    const refresh = store.syncFromCloud()
    const second = store.addMember({ ...createMemberInput(), name: '刷新后' })
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce())
    expect(mocks.save).toHaveBeenCalledOnce()
    release()
    const results = await Promise.all([first, refresh, second])
    expect(results[0].ok).toBe(true)
    expect(results[1]).toBe(true)
    expect(results[2].ok).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(store.members.value.at(-1)?.name).toBe('刷新后')
  })
  it('leaves memory intact when full backup restore is forbidden', async () => {
    const store = await storeFixture()
    const before = store.exportData()
    const imported = familyFixture()
    imported.members[0]!.name = '不可导入'
    mocks.save.mockRejectedValueOnce(new Error('需要 maintainer 权限'))
    expect((await store.importDataFromJson(JSON.stringify(imported))).ok).toBe(false)
    expect(store.exportData()).toEqual(before)
  })
  it('preserves legacy spouse evidence and clears claims resolving to deleted people', async () => {
    const store = await storeFixture()
    expect((await store.deleteMember(3)).ok).toBe(true)
    expect(store.childClaims.value[0]?.resolvedMemberId).toBe(null)
    expect(store.childClaims.value[0]?.status).toBe('missing')
    expect(store.relations.value.some((item) => item.type === 'spouse')).toBe(true)
    expect(store.exportData().tracks[0]?.memberId).toBe(null)
  })
  it('retries initialization after an unavailable cloud endpoint', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('连接失败'))
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await expect(store.init()).rejects.toThrow('连接失败')
    await expect(store.init()).resolves.toBeUndefined()
    expect(store.ready.value).toBe(true)
  })
})
