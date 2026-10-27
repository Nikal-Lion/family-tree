import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activityMemberName, filterActivityEvents, filterActivityTracks } from '../../src/services/activityManager'
import { familyFixture } from '../fixtures/familyData'
import type { FamilyEvent, Member, Track } from '../../src/types/member'

const members: Member[] = [{ id: 1, name: '张三', parentId: null, gender: '男', generationNumber: 9 }]
const events: FamilyEvent[] = [
  { id: 1, memberId: 1, type: '婚', title: '成婚', date: '2026-10-01', description: '家族纪念 ABC', createdAt: '', updatedAt: '' },
  { id: 2, memberId: null, type: '其他', title: '祭祖', date: '2026-10-02', createdAt: '', updatedAt: '' },
  { id: 3, memberId: 99, type: '其他', title: '旧记录', date: '2026-10-02', createdAt: '', updatedAt: '' },
]
function track(id: number, memberId: number | null, name: string, updatedAt: string): Track {
  return {
    id, memberId, name, updatedAt, createdAt: '', points: [],
    startPoint: { lat: 1, lng: 2 }, endPoint: { lat: 3, lng: 4 },
    stats: { pointCount: 2, distanceMeters: 1000, elevationGainMeters: null },
  }
}
const tracks = [track(1, 1, '扫墓 ABC', '2026-10-01'), track(2, null, '公墓', '2026-10-02')]

describe('activity manager filters', () => {
  it('labels unlinked and missing members without confusing recorded generation with IDs', () => {
    expect(activityMemberName(members, null)).toBe('未关联成员')
    expect(activityMemberName(members, 1)).toBe('张三')
    expect(activityMemberName(members, 99)).toBe('成员#99')
  })
  it('combines event type, member and case-insensitive text filters', () => {
    expect(filterActivityEvents(events, members, ' abc ', '婚', 1).map((event) => event.id)).toEqual([1])
    expect(filterActivityEvents(events, members, '张三', undefined, undefined)).toHaveLength(1)
    expect(filterActivityEvents(events, members, '2026-10', '其他', 'unlinked').map((event) => event.id)).toEqual([2])
    expect(filterActivityEvents(events, members, '成员#99', undefined, undefined).map((event) => event.id)).toEqual([3])
    expect(filterActivityEvents(events, members, '成婚', '其他', undefined)).toEqual([])
  })
  it('orders events by date and ID without mutating the source', () => {
    expect(filterActivityEvents(events, members, '', undefined, undefined).map((event) => event.id)).toEqual([3, 2, 1])
    expect(events.map((event) => event.id)).toEqual([1, 2, 3])
  })
  it('filters tracks by name, linked member and unlinked selection', () => {
    expect(filterActivityTracks(tracks, members, ' abc ', 1).map((item) => item.id)).toEqual([1])
    expect(filterActivityTracks(tracks, members, '张三', undefined)).toHaveLength(1)
    expect(filterActivityTracks(tracks, members, '', 'unlinked').map((item) => item.id)).toEqual([2])
    expect(filterActivityTracks(tracks, members, '公墓', 1)).toEqual([])
  })
  it('sorts tracks by latest update without changing the source', () => {
    expect(filterActivityTracks(tracks, members, '', undefined).map((item) => item.id)).toEqual([2, 1])
    expect(tracks.map((item) => item.id)).toEqual([1, 2])
  })
  it('searches and filters by every linked member, not only the first', () => {
    const linked = [{ ...tracks[0]!, memberIds: [1, 2] }]
    const allMembers = [...members, { id: 2, name: '李四', parentId: null, gender: '女' as const }]
    expect(filterActivityTracks(linked, allMembers, '李四', 2)).toHaveLength(1)
    expect(filterActivityTracks(linked, allMembers, '', 'unlinked')).toEqual([])
    expect(filterActivityTracks(linked, allMembers, '', 99)).toEqual([])
  })
})

const storage = vi.hoisted(() => ({ initialize: vi.fn(), save: vi.fn(), load: vi.fn() }))
vi.mock('../../src/services/storage', () => ({ initializeStorage: storage.initialize, saveFamilyData: storage.save }))
vi.mock('../../src/services/d1ApiService', () => ({ loadFamilyDataFromD1: storage.load }))

describe('activity cloud mutations', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    const data = familyFixture()
    data.events = events.filter((event) => event.memberId !== 99).map((event) => ({ ...event }))
    data.nextEventId = 4
    storage.initialize.mockResolvedValue(data)
    storage.load.mockResolvedValue(data)
    storage.save.mockResolvedValue(undefined)
  })

  it('waits for cloud acknowledgement before an event save succeeds', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    let release!: () => void
    storage.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    let completed = false
    const pending = store.addEvent({ memberId: 1, type: '生', title: '新事件', date: '2026-10-03', description: '说明' })
      .then((result) => { completed = true; return result })
    await vi.waitFor(() => expect(storage.save).toHaveBeenCalledOnce())
    expect(store.saving.value).toBe(true)
    expect(completed).toBe(false)
    release()
    expect((await pending).ok).toBe(true)
    expect(store.saving.value).toBe(false)
  })

  it('rolls back rejected event creation, editing and deletion, and permits retry', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    const before = store.exportData()
    const input = { memberId: 1, type: '婚' as const, title: '重试内容', date: '2026-10-03', description: '保留说明' }
    for (const action of [
      () => store.addEvent(input),
      () => store.updateEvent(1, input),
      () => store.deleteEvent(1),
    ]) {
      storage.save.mockRejectedValueOnce(new Error('403 无维护权限'))
      expect((await action()).ok).toBe(false)
      expect(store.exportData()).toEqual(before)
      expect(store.lastSaveError.value).toBe('403 无维护权限')
    }
    expect((await store.updateEvent(1, input)).ok).toBe(true)
    expect(store.events.value.find((event) => event.id === 1)?.description).toBe('保留说明')
    expect(store.lastSaveError.value).toBe('')
  })

  it('preserves track metadata, associations and selection after rejected writes', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    const before = store.exportData()
    const selected = store.selectedId.value
    const id = store.tracks.value[0]!.id
    storage.save.mockRejectedValueOnce(new Error('网络失败'))
    expect((await store.updateTrackMeta(id, '改名失败', null)).ok).toBe(false)
    expect(store.exportData()).toEqual(before)
    expect(store.selectedId.value).toBe(selected)
    storage.save.mockRejectedValueOnce(new Error('删除失败'))
    expect((await store.deleteTrack(id)).ok).toBe(false)
    expect(store.exportData()).toEqual(before)
    expect((await store.updateTrackMeta(id, '改名重试', 1)).ok).toBe(true)
    expect(store.tracks.value[0]?.name).toBe('改名重试')
    expect(store.tracks.value[0]?.memberId).toBe(1)
  })

  it('preserves the pre-existing store GPX text-length limit without discarding tracks', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    const before = store.exportData()
    const result = await store.addTrackFromGpx('x'.repeat(10 * 1024 * 1024 + 1), '保留文件名', 1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('10MB')
    expect(storage.save).not.toHaveBeenCalled()
    expect(store.exportData()).toEqual(before)
  })
  it('saves reordered associations and rolls back all associations on a cloud failure', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    expect((await store.updateTrackMeta(12, '多人轨迹', [2, 1, 3])).ok).toBe(true)
    expect(store.exportData().tracks[0]).toMatchObject({ memberId: 2, memberIds: [2, 1, 3] })
    storage.save.mockRejectedValueOnce(new Error('保存失败'))
    expect((await store.updateTrackMeta(12, '不能丢失顺序', [3, 2])).ok).toBe(false)
    expect(store.exportData().tracks[0]).toMatchObject({ name: '多人轨迹', memberId: 2, memberIds: [2, 1, 3] })
    expect((await store.updateTrackMeta(12, '取消关联', [])).ok).toBe(true)
    expect(store.exportData().tracks[0]).toMatchObject({ memberId: null, memberIds: [] })
  })
  it('imports GPX with ordered members and restores the snapshot after a failed upload', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const trackService = await import('../../src/services/trackService')
    const parser = vi.spyOn(trackService, 'parseGpx').mockReturnValue(familyFixture().tracks[0]!)
    try {
      const store = useFamilyStore()
      await store.init()
      const before = store.exportData()
      storage.save.mockRejectedValueOnce(new Error('上传失败'))
      expect((await store.addTrackFromGpx('<gpx/>', '失败的轨迹', [2, 1])).ok).toBe(false)
      expect(store.exportData()).toEqual(before)
      expect((await store.addTrackFromGpx('<gpx/>', '重试成功', [2, 1])).ok).toBe(true)
      expect(store.exportData().tracks.at(-1)).toMatchObject({ id: 70, name: '重试成功', memberId: 2, memberIds: [2, 1] })
    } finally {
      parser.mockRestore()
    }
  })
  it('rejects missing and duplicate track members without mutating or saving', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    const before = store.exportData()
    expect((await store.updateTrackMeta(12, '坏引用', [3, 999])).ok).toBe(false)
    expect((await store.updateTrackMeta(12, '重复', [3, 3])).ok).toBe(false)
    expect(store.exportData()).toEqual(before)
    expect(storage.save).not.toHaveBeenCalled()
  })
  it('removes only deleted members from tracks while preserving the remaining order', async () => {
    const { useFamilyStore } = await import('../../src/stores/familyStore')
    const store = useFamilyStore()
    await store.init()
    expect((await store.updateTrackMeta(12, '保留顺序', [3, 2, 1])).ok).toBe(true)
    expect((await store.deleteMember(3)).ok).toBe(true)
    expect(store.exportData().tracks[0]).toMatchObject({ memberId: 2, memberIds: [2, 1] })
    expect((await store.deleteMember(1)).ok).toBe(true)
    expect(store.exportData().tracks[0]).toMatchObject({ memberId: 2, memberIds: [2] })
    expect((await store.deleteMember(2)).ok).toBe(true)
    expect(store.exportData().tracks[0]).toMatchObject({ memberId: null, memberIds: [] })
  })
})
