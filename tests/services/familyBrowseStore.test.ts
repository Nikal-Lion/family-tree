import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isReadonly, ref } from 'vue'
import { familyFixture } from '../fixtures/familyData'
import { toFamilyBrowseData } from '../../src/services/familyBrowseData'
import type { FamilyBrowseData } from '../../src/types/member'
import { createFamilyBrowseStore } from '../../src/stores/familyBrowseStore'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../../src/services/d1ApiService', () => ({ loadFamilyBrowseDataFromD1: mocks.load }))

function deferred() {
  let resolve!: (data: FamilyBrowseData | null) => void
  let reject!: (error: Error) => void
  const promise = new Promise<FamilyBrowseData | null>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.load.mockResolvedValue(toFamilyBrowseData(familyFixture()))
})

describe('page-local family browsing', () => {
  it('exposes read-only evidence and selection without maintenance methods or counters', async () => {
    const store = createFamilyBrowseStore(ref('account'))
    await store.init()
    expect(store.data.value).toEqual(toFamilyBrowseData(familyFixture()))
    expect(isReadonly(store.data.value)).toBe(true)
    expect(isReadonly(store.members.value[0])).toBe(true)
    expect(Object.keys(store.data.value).some((key) => key.startsWith('next'))).toBe(false)
    for (const key of ['addMember', 'updateMember', 'deleteMember', 'importData', 'exportData', 'saving', 'save']) {
      expect(store).not.toHaveProperty(key)
    }
    store.selectMember(3)
    expect(store.selectedMember.value?.name).toBe('太琼')
    store.selectMember(900)
    expect(store.selectedId.value).toBe(3)
    store.dispose()
  })

  it('selects the first displayed member when a response arrives out of order', async () => {
    const next = toFamilyBrowseData(familyFixture())
    next.members.reverse()
    mocks.load.mockResolvedValueOnce(next)
    const store = createFamilyBrowseStore(ref('account'))
    await store.init()
    expect(store.members.value.map((member) => member.id)).toEqual([1, 2, 3])
    expect(store.selectedId.value).toBe(1)
    expect(next.members.map((member) => member.id)).toEqual([3, 2, 1])
    store.dispose()
  })

  it('deduplicates initial loads and refreshes and preserves selection and the last successful snapshot on failure', async () => {
    const store = createFamilyBrowseStore(ref('account'))
    const first = deferred()
    mocks.load.mockReturnValueOnce(first.promise)
    const initial = store.init()
    const simultaneous = store.syncFromCloud()
    expect(mocks.load).toHaveBeenCalledOnce()
    first.resolve(toFamilyBrowseData(familyFixture()))
    expect(await initial).toBe(true)
    expect(await simultaneous).toBe(true)
    store.selectMember(3)
    await store.init()
    expect(mocks.load).toHaveBeenCalledOnce()
    mocks.load.mockRejectedValueOnce(new Error('网络失败'))
    await expect(store.syncFromCloud()).rejects.toThrow('网络失败')
    expect(store.ready.value).toBe(true)
    expect(store.selectedId.value).toBe(3)
    expect(store.members.value).toHaveLength(3)
    await store.syncFromCloud()
    expect(store.selectedId.value).toBe(3)
    const next = toFamilyBrowseData(familyFixture())
    next.members = next.members.filter((member) => member.id !== 3)
    mocks.load.mockResolvedValueOnce(next)
    await store.syncFromCloud()
    expect(store.selectedId.value).toBe(1)
    store.dispose()
  })

  it('only shows empty data after a successful empty response, not an initial error', async () => {
    const store = createFamilyBrowseStore(ref('account'))
    mocks.load.mockRejectedValueOnce(new Error('503'))
    await expect(store.init()).rejects.toThrow('503')
    expect(store.ready.value).toBe(false)
    await store.init()
    mocks.load.mockResolvedValueOnce(null)
    await store.syncFromCloud()
    expect(store.ready.value).toBe(true)
    expect(store.members.value).toEqual([])
    expect(store.selectedId.value).toBeNull()
    store.dispose()
  })

  it.each([false, true])('keeps pages isolated and ignores a pending response after disposal (%s)', async (fails) => {
    const first = createFamilyBrowseStore(ref('first'))
    const second = createFamilyBrowseStore(ref('second'))
    await first.init()
    expect(second.ready.value).toBe(false)
    const pending = deferred()
    mocks.load.mockReturnValueOnce(pending.promise)
    const loading = second.init()
    second.dispose()
    if (fails) pending.reject(new Error('disposed request failure'))
    else pending.resolve(toFamilyBrowseData(familyFixture()))
    await expect(loading).resolves.toBe(false)
    expect(second.members.value).toEqual([])
    expect(first.members.value).toHaveLength(3)
    await expect(second.init()).resolves.toBe(false)
    first.dispose()
  })

  it.each([false, true])('clears account data and fences old requests even when their completion fails (%s)', async (fails) => {
    const account = ref<string | null>('first')
    const store = createFamilyBrowseStore(account)
    await store.init()
    const old = deferred()
    mocks.load.mockReturnValueOnce(old.promise)
    const loadingOld = store.syncFromCloud()
    account.value = 'second'
    expect(store.ready.value).toBe(false)
    expect(store.members.value).toEqual([])
    const next = deferred()
    mocks.load.mockReturnValueOnce(next.promise)
    const loadingNext = store.init()
    if (fails) old.reject(new Error('old account failure'))
    else old.resolve(toFamilyBrowseData(familyFixture()))
    await expect(loadingOld).resolves.toBe(false)
    expect(store.members.value).toEqual([])
    expect(store.syncFromCloud()).toBe(loadingNext)
    const nextData = toFamilyBrowseData(familyFixture())
    nextData.members[0]!.name = '新会话族人'
    next.resolve(nextData)
    await loadingNext
    expect(store.members.value[0]?.name).toBe('新会话族人')
    account.value = null
    expect(store.members.value).toEqual([])
    await expect(store.init()).resolves.toBe(false)
    store.dispose()
  })
})
