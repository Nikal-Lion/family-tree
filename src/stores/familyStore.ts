import { computed, reactive, ref } from 'vue'
import { parseImportedJson } from '../services/importExport'
import { initializeStorage, saveFamilyData } from '../services/storage'
import { parseGpx } from '../services/trackService'
import { canAssignParent, validateName } from '../services/validators'
import type { FamilyData, Member, MemberInput, Track } from '../types/member'
import type { OcrImportOptions, TempMember } from '../types/ocr'

interface ActionResult {
  ok: boolean
  message?: string
}

const state = reactive<{
  members: Member[]
  tracks: Track[]
  nextId: number
  nextTrackId: number
  selectedId: number | null
}>({
  members: [],
  tracks: [],
  nextId: 1,
  nextTrackId: 1,
  selectedId: null,
})

const schemaVersion = ref(2)
const ready = ref(false)
let initPromise: Promise<void> | null = null
let persistQueue: Promise<void> = Promise.resolve()

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)]
}

function normalizeSpouseIds(spouseIds: number[], selfId?: number): number[] {
  return uniqueNumbers(
    spouseIds.filter((id) => {
      if (typeof id !== 'number') {
        return false
      }
      if (selfId !== undefined && id === selfId) {
        return false
      }
      return state.members.some((member) => member.id === id)
    }),
  ).sort((a, b) => a - b)
}

function ensureBidirectionalSpouses(): void {
  const byId = new Map<number, Member>()
  for (const member of state.members) {
    byId.set(member.id, member)
  }

  for (const member of state.members) {
    member.spouseIds = normalizeSpouseIds(member.spouseIds, member.id)
  }

  for (const member of state.members) {
    for (const spouseId of member.spouseIds) {
      const spouse = byId.get(spouseId)
      if (!spouse) {
        continue
      }
      if (!spouse.spouseIds.includes(member.id)) {
        spouse.spouseIds.push(member.id)
      }
    }
  }

  for (const member of state.members) {
    member.spouseIds = normalizeSpouseIds(member.spouseIds, member.id)
  }
}

function applySpouseLinks(memberId: number, nextSpouseIds: number[], prevSpouseIds: number[]): void {
  const normalizedNext = normalizeSpouseIds(nextSpouseIds, memberId)
  const prevSet = new Set(prevSpouseIds)
  const nextSet = new Set(normalizedNext)

  for (const prevId of prevSet) {
    if (nextSet.has(prevId)) {
      continue
    }
    const spouse = state.members.find((member) => member.id === prevId)
    if (!spouse) {
      continue
    }
    spouse.spouseIds = spouse.spouseIds.filter((id) => id !== memberId)
  }

  for (const nextId of normalizedNext) {
    const spouse = state.members.find((member) => member.id === nextId)
    if (!spouse) {
      continue
    }
    if (!spouse.spouseIds.includes(memberId)) {
      spouse.spouseIds.push(memberId)
    }
    spouse.spouseIds = normalizeSpouseIds(spouse.spouseIds, spouse.id)
  }

  const target = state.members.find((member) => member.id === memberId)
  if (target) {
    target.spouseIds = normalizedNext
  }
}

ensureBidirectionalSpouses()

function persist(): void {
  state.members.sort((a, b) => a.id - b.id)
  const payload: FamilyData = {
    schemaVersion: schemaVersion.value,
    members: state.members,
    tracks: state.tracks,
    nextId: state.nextId,
    nextTrackId: state.nextTrackId,
  }

  persistQueue = persistQueue
    .then(() => saveFamilyData(payload))
    .catch((error) => {
      console.error('保存数据失败', error)
    })
}

function applyLoadedData(data: FamilyData): void {
  schemaVersion.value = data.schemaVersion
  state.members = [...data.members].sort((a, b) => a.id - b.id)
  state.tracks = [...data.tracks].sort((a, b) => a.id - b.id)
  state.nextId = data.nextId
  state.nextTrackId = data.nextTrackId
  state.selectedId = data.members[0]?.id ?? null
  ensureBidirectionalSpouses()
}

async function init(): Promise<void> {
  if (ready.value) {
    return
  }
  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const loaded = await initializeStorage()
    applyLoadedData(loaded)
    ready.value = true
  })()

  return initPromise
}

function normalizeParent(parentId: number | null): number | null {
  if (parentId === null) {
    return null
  }

  const exists = state.members.some((member) => member.id === parentId)
  return exists ? parentId : null
}

function addMember(input: MemberInput): ActionResult {
  const nameError = validateName(input.name)
  if (nameError) {
    return { ok: false, message: nameError }
  }

  const member: Member = {
    id: state.nextId,
    name: input.name.trim(),
    gender: input.gender,
    parentId: normalizeParent(input.parentId),
    spouseIds: [],
  }

  state.nextId += 1
  state.members.push(member)
  applySpouseLinks(member.id, input.spouseIds, [])
  ensureBidirectionalSpouses()
  state.selectedId = member.id
  persist()

  return { ok: true }
}

function updateMember(id: number, input: MemberInput): ActionResult {
  const target = state.members.find((member) => member.id === id)
  if (!target) {
    return { ok: false, message: '成员不存在' }
  }

  const nameError = validateName(input.name)
  if (nameError) {
    return { ok: false, message: nameError }
  }

  const normalizedParentId = normalizeParent(input.parentId)
  if (!canAssignParent(state.members, id, normalizedParentId)) {
    return { ok: false, message: '父节点不能是本人或后代' }
  }

  const previousSpouseIds = [...target.spouseIds]
  target.name = input.name.trim()
  target.gender = input.gender
  target.parentId = normalizedParentId
  applySpouseLinks(id, input.spouseIds, previousSpouseIds)
  ensureBidirectionalSpouses()
  persist()

  return { ok: true }
}

function collectDescendants(rootId: number): number[] {
  const byParent = new Map<number, number[]>()
  for (const member of state.members) {
    if (member.parentId === null) {
      continue
    }
    const list = byParent.get(member.parentId) ?? []
    list.push(member.id)
    byParent.set(member.parentId, list)
  }

  const toDelete = [rootId]
  const stack = [rootId]

  while (stack.length > 0) {
    const current = stack.pop()!
    const children = byParent.get(current) ?? []
    for (const childId of children) {
      toDelete.push(childId)
      stack.push(childId)
    }
  }

  return toDelete
}

function deleteMember(id: number): ActionResult {
  const existing = state.members.find((member) => member.id === id)
  if (!existing) {
    return { ok: false, message: '成员不存在' }
  }

  const deletionIds = new Set(collectDescendants(id))
  state.members = state.members.filter((member) => !deletionIds.has(member.id))
  ensureBidirectionalSpouses()

  if (state.members.length === 0) {
    state.selectedId = null
  } else if (state.selectedId !== null && deletionIds.has(state.selectedId)) {
    state.selectedId = state.members[0].id
  }

  persist()

  return { ok: true, message: `已删除 ${deletionIds.size} 位成员` }
}

function importDataFromJson(raw: string): ActionResult {
  try {
    const imported = parseImportedJson(raw)
    state.members = imported.members.sort((a, b) => a.id - b.id)
    state.tracks = imported.tracks.sort((a, b) => a.id - b.id)
    state.nextId = imported.nextId
    state.nextTrackId = imported.nextTrackId
    state.selectedId = imported.members[0]?.id ?? null
    ensureBidirectionalSpouses()
    persist()
    return { ok: true, message: '导入成功' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '导入失败',
    }
  }
}

function replaceData(data: FamilyData): void {
  applyLoadedData(data)
  ready.value = true
}

function normalizeTrackName(name: string): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : '未命名轨迹'
}

function normalizeTrackMemberId(memberId: number | null): number | null {
  if (memberId === null) {
    return null
  }
  const exists = state.members.some((member) => member.id === memberId)
  return exists ? memberId : null
}

function addTrackFromGpx(raw: string, name: string, memberId: number | null): ActionResult {
  if (raw.length > 10 * 1024 * 1024) {
    return { ok: false, message: 'GPX 文件过大（上限 10MB）' }
  }

  try {
    const parsed = parseGpx(raw)
    const now = new Date().toISOString()
    const track: Track = {
      id: state.nextTrackId,
      name: normalizeTrackName(name),
      memberId: normalizeTrackMemberId(memberId),
      points: parsed.points,
      startPoint: parsed.startPoint,
      endPoint: parsed.endPoint,
      stats: parsed.stats,
      createdAt: now,
      updatedAt: now,
    }

    state.nextTrackId += 1
    state.tracks.push(track)
    state.tracks.sort((a, b) => a.id - b.id)
    persist()
    return { ok: true, message: '轨迹上传成功' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '轨迹上传失败',
    }
  }
}

function updateTrackMeta(id: number, name: string, memberId: number | null): ActionResult {
  const target = state.tracks.find((track) => track.id === id)
  if (!target) {
    return { ok: false, message: '轨迹不存在' }
  }

  target.name = normalizeTrackName(name)
  target.memberId = normalizeTrackMemberId(memberId)
  target.updatedAt = new Date().toISOString()
  persist()
  return { ok: true, message: '轨迹信息已更新' }
}

function deleteTrack(id: number): ActionResult {
  const before = state.tracks.length
  state.tracks = state.tracks.filter((track) => track.id !== id)
  if (state.tracks.length === before) {
    return { ok: false, message: '轨迹不存在' }
  }

  persist()
  return { ok: true, message: '轨迹已删除' }
}

function getMemberById(id: number | null): Member | null {
  if (id === null) {
    return null
  }
  return state.members.find((member) => member.id === id) ?? null
}

function findMemberByName(name: string): Member | null {
  const normalized = name.trim()
  if (!normalized) {
    return null
  }
  return state.members.find((member) => member.name === normalized) ?? null
}

function importOcrMembers(tempMembers: TempMember[], options: OcrImportOptions): ActionResult {
  const validItems = tempMembers.filter((item) => item.name.trim().length > 0)
  if (validItems.length === 0) {
    return { ok: false, message: 'OCR 导入失败：无有效成员姓名' }
  }

  const createdIdsByName = new Map<string, number>()
  let importedCount = 0
  let skippedCount = 0

  function resolveOrCreateByName(name: string, gender: '男' | '女' = '男'): number | null {
    const normalized = name.trim()
    if (!normalized) {
      return null
    }

    const createdId = createdIdsByName.get(normalized)
    if (typeof createdId === 'number') {
      return createdId
    }

    const existing = findMemberByName(normalized)
    if (existing) {
      return existing.id
    }

    const newMember: Member = {
      id: state.nextId,
      name: normalized,
      gender,
      parentId: null,
      spouseIds: [],
    }

    state.nextId += 1
    state.members.push(newMember)
    createdIdsByName.set(normalized, newMember.id)
    return newMember.id
  }

  for (const item of validItems) {
    const memberName = item.name.trim()
    const existing = findMemberByName(memberName)
    if (existing && options.duplicateAction === 'skip') {
      skippedCount += 1
      continue
    }

    const fatherId = resolveOrCreateByName(item.fatherName, '男')
    const memberId = resolveOrCreateByName(memberName, item.gender)
    if (memberId === null) {
      skippedCount += 1
      continue
    }

    const target = state.members.find((member) => member.id === memberId)
    if (!target) {
      skippedCount += 1
      continue
    }

    if (fatherId !== null && fatherId !== target.id && canAssignParent(state.members, target.id, fatherId)) {
      target.parentId = fatherId
    }

    if (item.spouseName.trim()) {
      const spouseId = resolveOrCreateByName(item.spouseName, item.gender === '男' ? '女' : '男')
      if (spouseId !== null) {
        applySpouseLinks(target.id, [...target.spouseIds, spouseId], target.spouseIds)
      }
    }

    importedCount += 1
  }

  ensureBidirectionalSpouses()
  persist()

  return {
    ok: true,
    message:
      skippedCount > 0
        ? `OCR 导入完成：新增/更新 ${importedCount} 人，跳过 ${skippedCount} 人`
        : `OCR 导入完成：新增/更新 ${importedCount} 人`,
  }
}

export function useFamilyStore() {
  const members = computed(() => state.members)
  const tracks = computed(() => state.tracks)
  const selectedId = computed(() => state.selectedId)
  const selectedMember = computed(() => getMemberById(state.selectedId))

  return {
    members,
    tracks,
    selectedId,
    selectedMember,
    ready: computed(() => ready.value),
    init,
    nextId: computed(() => state.nextId),
    nextTrackId: computed(() => state.nextTrackId),
    selectMember: (id: number) => {
      state.selectedId = id
    },
    addMember,
    updateMember,
    deleteMember,
    addTrackFromGpx,
    updateTrackMeta,
    deleteTrack,
    importOcrMembers,
    importDataFromJson,
    replaceData,
    exportData: () => ({
      schemaVersion: schemaVersion.value,
      members: state.members,
      tracks: state.tracks,
      nextId: state.nextId,
      nextTrackId: state.nextTrackId,
    }),
  }
}
