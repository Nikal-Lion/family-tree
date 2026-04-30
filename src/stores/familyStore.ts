import { computed, reactive, ref } from 'vue'
import { analyzeFamilyDataImport, summarizeFamilyDataImport, summarizePartDataImportV2, type FamilyDataImportSummary } from '../services/importDiagnostics'
import { parseImportedJson } from '../services/importExport'
import { parsePartDataMarkdown } from '../services/partDataImport'
import { parsePartDataMarkdownV2, type PartDataImportReport } from '../services/partDataImportV2'
import { loadFamilyDataFromD1 } from '../services/d1ApiService'
import { initializeStorage, saveFamilyData } from '../services/storage'
import { parseGpx } from '../services/trackService'
import { canAssignParent, validateName } from '../services/validators'
import { createSpouse, deleteSpouse, deleteSpousesByHusband } from '../services/spouseService'
import { deleteChildClaimsByParent } from '../services/childClaimService'
import {
  APP_SCHEMA_VERSION,
  type BurialRecord,
  type FamilyData,
  type FamilyEvent,
  type FamilyEventInput,
  type KinshipRelation,
  type Member,
  type MemberInput,
  type NameAlias,
  type TemporalExpression,
  type Track,
  type UncertaintyFlag,
} from '../types/member'
import type { Spouse, SpouseInput } from '../types/spouse'
import type { ChildClaim } from '../types/childClaim'
import type { OcrImportOptions, TempMember } from '../types/ocr'

interface ActionResult {
  ok: boolean
  message?: string
}

interface MarkdownImportPreviewResult {
  ok: boolean
  message?: string
  summary?: FamilyDataImportSummary
  warnings: string[]
}

const state = reactive<{
  members: Member[]
  tracks: Track[]
  events: FamilyEvent[]
  aliases: NameAlias[]
  relations: KinshipRelation[]
  temporals: TemporalExpression[]
  burials: BurialRecord[]
  spouses: Spouse[]
  childClaims: ChildClaim[]
  nextId: number
  nextTrackId: number
  nextEventId: number
  nextAliasId: number
  nextRelationId: number
  nextTemporalId: number
  nextBurialId: number
  nextSpouseId: number
  nextChildClaimId: number
  selectedId: number | null
}>({
  members: [],
  tracks: [],
  events: [],
  aliases: [],
  relations: [],
  temporals: [],
  burials: [],
  spouses: [],
  childClaims: [],
  nextId: 1,
  nextTrackId: 1,
  nextEventId: 1,
  nextAliasId: 1,
  nextRelationId: 1,
  nextTemporalId: 1,
  nextBurialId: 1,
  nextSpouseId: 1,
  nextChildClaimId: 1,
  selectedId: null,
})

const schemaVersion = ref(APP_SCHEMA_VERSION)
const ready = ref(false)
let initPromise: Promise<void> | null = null
let persistQueue: Promise<void> = Promise.resolve()
let syncPromise: Promise<boolean> | null = null
const CORE_RELATION_TYPES = new Set<KinshipRelation['type']>(['father', 'spouse'])
const ALLOWED_UNCERTAINTY_FLAGS = new Set<UncertaintyFlag>([
  'missing',
  'estimated',
  'conflicting',
  'unverified',
])

function createRelationKey(type: KinshipRelation['type'], fromMemberId: number, toMemberId: number): string {
  return `${type}:${fromMemberId}:${toMemberId}`
}

function applyRelationsToMembers(): void {
  if (state.relations.length === 0 || state.members.length === 0) {
    return
  }

  const memberIds = new Set(state.members.map((member) => member.id))
  const fatherByChild = new Map<number, number>()
  let hasFatherRelations = false

  for (const relation of state.relations) {
    if (
      !memberIds.has(relation.fromMemberId) ||
      !memberIds.has(relation.toMemberId) ||
      relation.fromMemberId === relation.toMemberId
    ) {
      continue
    }

    if (relation.type === 'father') {
      hasFatherRelations = true
      if (!fatherByChild.has(relation.fromMemberId)) {
        fatherByChild.set(relation.fromMemberId, relation.toMemberId)
      }
    }
  }

  if (hasFatherRelations) {
    for (const member of state.members) {
      member.parentId = fatherByChild.get(member.id) ?? null
    }
  }
}

function syncCoreRelationsFromMembers(): void {
  const memberIds = new Set(state.members.map((member) => member.id))
  const existingCoreByKey = new Map<string, KinshipRelation>()
  const preservedRelations: KinshipRelation[] = []

  for (const relation of state.relations) {
    if (
      !memberIds.has(relation.fromMemberId) ||
      !memberIds.has(relation.toMemberId) ||
      relation.fromMemberId === relation.toMemberId
    ) {
      continue
    }

    if (CORE_RELATION_TYPES.has(relation.type)) {
      existingCoreByKey.set(createRelationKey(relation.type, relation.fromMemberId, relation.toMemberId), relation)
      continue
    }

    preservedRelations.push({
      ...relation,
      temporalId: relation.temporalId ?? null,
      status: relation.status ?? 'active',
    })
  }

  const derivedCoreRelations: KinshipRelation[] = []
  const derivedKeys = new Set<string>()
  for (const member of state.members) {
    if (member.parentId !== null && memberIds.has(member.parentId)) {
      const key = createRelationKey('father', member.id, member.parentId)
      if (!derivedKeys.has(key)) {
        derivedCoreRelations.push({
          id: 0,
          fromMemberId: member.id,
          toMemberId: member.parentId,
          type: 'father',
          status: 'active',
          temporalId: null,
          note: '',
          rawText: '',
        })
        derivedKeys.add(key)
      }
    }

  }

  let nextRelationId = Math.max(state.nextRelationId, 1)
  const normalizedCoreRelations = derivedCoreRelations.map((relation) => {
    const key = createRelationKey(relation.type, relation.fromMemberId, relation.toMemberId)
    const existing = existingCoreByKey.get(key)
    if (!existing) {
      const assigned = { ...relation, id: nextRelationId }
      nextRelationId += 1
      return assigned
    }

    return {
      ...relation,
      id: existing.id,
      status: existing.status ?? relation.status,
      temporalId: existing.temporalId ?? null,
      note: existing.note ?? '',
      rawText: existing.rawText ?? '',
    }
  })

  state.relations = [...preservedRelations, ...normalizedCoreRelations].sort((a, b) => a.id - b.id)
  const maxRelationId = state.relations.length > 0 ? Math.max(...state.relations.map((relation) => relation.id)) : 0
  state.nextRelationId = Math.max(nextRelationId, maxRelationId + 1, 1)
}

function buildPersistPayload(): FamilyData {
  syncCoreRelationsFromMembers()
  state.members.sort((a, b) => a.id - b.id)

  return {
    schemaVersion: schemaVersion.value,
    members: state.members,
    tracks: state.tracks,
    events: state.events,
    aliases: state.aliases,
    relations: state.relations,
    temporals: state.temporals,
    burials: state.burials,
    spouses: state.spouses,
    childClaims: state.childClaims,
    nextId: state.nextId,
    nextTrackId: state.nextTrackId,
    nextEventId: state.nextEventId,
    nextAliasId: state.nextAliasId,
    nextRelationId: state.nextRelationId,
    nextTemporalId: state.nextTemporalId,
    nextBurialId: state.nextBurialId,
    nextSpouseId: state.nextSpouseId,
    nextChildClaimId: state.nextChildClaimId,
  }
}

function enqueuePersist(payload: FamilyData): Promise<void> {
  persistQueue = persistQueue
    .catch((error) => {
      console.error('保存数据失败', error)
    })
    .then(() => saveFamilyData(payload))

  return persistQueue
}

function persist(): void {
  const payload = buildPersistPayload()

  void enqueuePersist(payload)
    .catch((error) => {
      console.error('保存数据失败', error)
    })
}

function applyLoadedData(data: FamilyData, options?: { preserveSelectedId?: boolean }): void {
  schemaVersion.value = data.schemaVersion
  state.members = [...data.members].sort((a, b) => a.id - b.id)
  state.tracks = [...data.tracks].sort((a, b) => a.id - b.id)
  state.events = [...(data.events ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  state.aliases = [...(data.aliases ?? [])].sort((a, b) => a.id - b.id)
  state.relations = [...(data.relations ?? [])].sort((a, b) => a.id - b.id)
  state.temporals = [...(data.temporals ?? [])].sort((a, b) => a.id - b.id)
  state.burials = [...(data.burials ?? [])].sort((a, b) => a.id - b.id)
  state.spouses = [...(data.spouses ?? [])].sort((a, b) => a.id - b.id)
  state.childClaims = [...(data.childClaims ?? [])].sort((a, b) => a.id - b.id)
  state.nextId = data.nextId
  state.nextTrackId = data.nextTrackId
  state.nextEventId = data.nextEventId ?? 1
  state.nextAliasId = data.nextAliasId ?? 1
  state.nextRelationId = data.nextRelationId ?? 1
  state.nextTemporalId = data.nextTemporalId ?? 1
  state.nextBurialId = data.nextBurialId ?? 1
  state.nextSpouseId = data.nextSpouseId ?? 1
  state.nextChildClaimId = data.nextChildClaimId ?? 1
  const nextSelectedId = options?.preserveSelectedId ? state.selectedId : null
  state.selectedId =
    nextSelectedId !== null && data.members.some((member) => member.id === nextSelectedId)
      ? nextSelectedId
      : data.members[0]?.id ?? null
  applyRelationsToMembers()
  syncCoreRelationsFromMembers()
}

function normalizeProfileText(value: string): string {
  return value.trim()
}

function normalizeUncertaintyFlagsInput(values: MemberInput['uncertaintyFlags']): Member['uncertaintyFlags'] {
  return [...new Set(values.filter((flag) => ALLOWED_UNCERTAINTY_FLAGS.has(flag)))]
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

async function syncFromCloud(): Promise<boolean> {
  if (!ready.value) {
    await init()
    return true
  }
  if (syncPromise) {
    return syncPromise
  }

  syncPromise = (async () => {
    await persistQueue
    const loaded = await loadFamilyDataFromD1()
    if (!loaded) {
      return false
    }

    applyLoadedData(loaded, { preserveSelectedId: true })
    ready.value = true
    return true
  })()

  try {
    return await syncPromise
  } finally {
    syncPromise = null
  }
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
    birthDate: normalizeProfileText(input.birthDate),
    photoUrl: normalizeProfileText(input.photoUrl),
    biography: normalizeProfileText(input.biography),
    generationLabelRaw: normalizeProfileText(input.generationLabelRaw),
    lineageBranch: normalizeProfileText(input.lineageBranch),
    rawNotes: normalizeProfileText(input.rawNotes),
    uncertaintyFlags: normalizeUncertaintyFlagsInput(input.uncertaintyFlags),
  }

  state.nextId += 1
  state.members.push(member)
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

  target.name = input.name.trim()
  target.gender = input.gender
  target.parentId = normalizedParentId
  target.birthDate = normalizeProfileText(input.birthDate)
  target.photoUrl = normalizeProfileText(input.photoUrl)
  target.biography = normalizeProfileText(input.biography)
  target.generationLabelRaw = normalizeProfileText(input.generationLabelRaw)
  target.lineageBranch = normalizeProfileText(input.lineageBranch)
  target.rawNotes = normalizeProfileText(input.rawNotes)
  target.uncertaintyFlags = normalizeUncertaintyFlagsInput(input.uncertaintyFlags)
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
  const deletedTemporalIds = new Set(
    state.temporals
      .filter((temporal) => temporal.memberId !== null && deletionIds.has(temporal.memberId))
      .map((temporal) => temporal.id),
  )
  state.members = state.members.filter((member) => !deletionIds.has(member.id))
  state.events = state.events.filter((event) => event.memberId === null || !deletionIds.has(event.memberId))
  state.tracks = state.tracks.map((track) =>
    track.memberId !== null && deletionIds.has(track.memberId)
      ? { ...track, memberId: null, updatedAt: new Date().toISOString() }
      : track,
  )
  state.aliases = state.aliases.filter((alias) => !deletionIds.has(alias.memberId))
  state.temporals = state.temporals.filter(
    (temporal) => temporal.memberId === null || !deletionIds.has(temporal.memberId),
  )
  state.burials = state.burials.filter((burial) => !deletionIds.has(burial.memberId))
  state.relations = state.relations
    .filter((relation) => !deletionIds.has(relation.fromMemberId) && !deletionIds.has(relation.toMemberId))
    .map((relation) =>
      relation.temporalId !== null && deletedTemporalIds.has(relation.temporalId)
        ? { ...relation, temporalId: null }
        : relation,
    )
  for (const deletedId of deletionIds) {
    deleteSpousesByHusband(state, deletedId)
    deleteChildClaimsByParent(state, deletedId)
  }
  syncCoreRelationsFromMembers()

  if (state.members.length === 0) {
    state.selectedId = null
  } else if (state.selectedId !== null && deletionIds.has(state.selectedId)) {
    state.selectedId = state.members[0].id
  }

  persist()

  return { ok: true, message: `已删除 ${deletionIds.size} 位成员` }
}

async function importDataFromJson(raw: string): Promise<ActionResult> {
  try {
    const imported = parseImportedJson(raw)
    applyLoadedData(imported)
    ready.value = true
    await enqueuePersist(buildPersistPayload())
    return { ok: true, message: '导入成功' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '导入失败',
    }
  }
}

/**
 * @deprecated 改用 previewPartDataV2。V1 解析器（partDataImport.ts）将在下个 minor 版本移除。
 */
function previewDataFromMarkdown(raw: string): MarkdownImportPreviewResult {
  try {
    const imported = parsePartDataMarkdown(raw)
    const summary = summarizeFamilyDataImport(imported)
    const warnings = analyzeFamilyDataImport(imported)
    return {
      ok: true,
      message: `解析成功：识别 ${summary.memberCount} 位成员`,
      summary,
      warnings,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Markdown 预览失败',
      warnings: [],
    }
  }
}

/**
 * @deprecated 改用 importPartDataV2。V1 解析器（partDataImport.ts）将在下个 minor 版本移除。
 */
async function importDataFromMarkdown(raw: string): Promise<ActionResult> {
  try {
    const imported = parsePartDataMarkdown(raw)
    const warnings = analyzeFamilyDataImport(imported)
    applyLoadedData(imported)
    ready.value = true
    await enqueuePersist(buildPersistPayload())
    return {
      ok: true,
      message:
        warnings.length > 0
          ? `Markdown 导入成功，共识别 ${imported.members.length} 位成员，检测到 ${warnings.length} 条风险提示`
          : `Markdown 导入成功，共识别 ${imported.members.length} 位成员`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Markdown 导入失败',
    }
  }
}

function replaceData(data: FamilyData): void {
  applyLoadedData(data)
  ready.value = true
}

function previewPartDataV2(raw: string): {
  ok: boolean
  data: FamilyData | null
  report: PartDataImportReport | null
  message: string
} {
  try {
    const data = parsePartDataMarkdownV2(raw)
    if (data.members.length === 0) {
      return { ok: false, data: null, report: null, message: '未识别到任何成员' }
    }
    const report = summarizePartDataImportV2(data)
    report.totalLines = raw.split(/\r?\n/).length
    return { ok: true, data, report, message: `识别 ${data.members.length} 位成员` }
  } catch (error) {
    return { ok: false, data: null, report: null, message: error instanceof Error ? error.message : '解析失败' }
  }
}

async function importPartDataV2(raw: string): Promise<{ ok: boolean; message: string }> {
  const preview = previewPartDataV2(raw)
  if (!preview.ok || !preview.data) {
    return { ok: false, message: preview.message }
  }
  const data = preview.data
  state.members = data.members
  state.spouses = data.spouses
  state.childClaims = data.childClaims
  state.aliases = data.aliases
  state.relations = data.relations
  state.temporals = data.temporals
  state.burials = data.burials
  state.nextId = data.nextId
  state.nextAliasId = data.nextAliasId
  state.nextRelationId = data.nextRelationId
  state.nextTemporalId = data.nextTemporalId
  state.nextBurialId = data.nextBurialId
  state.nextSpouseId = data.nextSpouseId
  state.nextChildClaimId = data.nextChildClaimId
  ready.value = true
  await enqueuePersist(buildPersistPayload())
  return {
    ok: true,
    message: `导入成功：${data.members.length} 主成员、${data.spouses.length} 配偶、${data.childClaims.length} 子女声明`,
  }
}

function normalizeEventInput(input: FamilyEventInput): FamilyEventInput {
  return {
    memberId: input.memberId,
    type: input.type,
    title: input.title.trim(),
    date: input.date.trim(),
    description: input.description.trim(),
  }
}

function addEvent(input: FamilyEventInput): ActionResult {
  const normalized = normalizeEventInput(input)
  if (!normalized.title) {
    return { ok: false, message: '事件标题不能为空' }
  }
  if (!normalized.date) {
    return { ok: false, message: '事件日期不能为空' }
  }

  const now = new Date().toISOString()
  const event: FamilyEvent = {
    id: state.nextEventId,
    memberId: normalized.memberId,
    type: normalized.type,
    title: normalized.title,
    date: normalized.date,
    description: normalized.description,
    createdAt: now,
    updatedAt: now,
  }

  state.nextEventId += 1
  state.events.push(event)
  state.events.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  persist()
  return { ok: true, message: '事件新增成功' }
}

function updateEvent(id: number, input: FamilyEventInput): ActionResult {
  const target = state.events.find((event) => event.id === id)
  if (!target) {
    return { ok: false, message: '事件不存在' }
  }

  const normalized = normalizeEventInput(input)
  if (!normalized.title) {
    return { ok: false, message: '事件标题不能为空' }
  }
  if (!normalized.date) {
    return { ok: false, message: '事件日期不能为空' }
  }

  target.memberId = normalized.memberId
  target.type = normalized.type
  target.title = normalized.title
  target.date = normalized.date
  target.description = normalized.description
  target.updatedAt = new Date().toISOString()

  state.events.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  persist()
  return { ok: true, message: '事件更新成功' }
}

function deleteEvent(id: number): ActionResult {
  const before = state.events.length
  state.events = state.events.filter((event) => event.id !== id)
  if (state.events.length === before) {
    return { ok: false, message: '事件不存在' }
  }

  persist()
  return { ok: true, message: '事件已删除' }
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
      birthDate: '',
      photoUrl: '',
      biography: '',
      generationLabelRaw: '',
      lineageBranch: '',
      rawNotes: '',
      uncertaintyFlags: [],
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
      createSpouse(state, {
        husbandId: target.id,
        surname: item.spouseName.charAt(0),
        fullName: item.spouseName.length > 1 ? item.spouseName : null,
        aliases: [],
        relationLabel: '配',
        order: 1,
        birthDate: '',
        deathDate: '',
        burialPlace: '',
        biography: '',
        statusFlags: [],
        rawText: item.rawText ?? item.spouseName,
      })
    }

    importedCount += 1
  }

  persist()

  return {
    ok: true,
    message:
      skippedCount > 0
        ? `OCR 导入完成：新增/更新 ${importedCount} 人，跳过 ${skippedCount} 人`
        : `OCR 导入完成：新增/更新 ${importedCount} 人`,
  }
}

function addSpouseToMember(input: SpouseInput): ActionResult {
  const memberExists = state.members.some((m) => m.id === input.husbandId)
  if (!memberExists) {
    return { ok: false, message: '成员不存在' }
  }
  createSpouse(state, input)
  persist()
  return { ok: true }
}

function removeSpouseFromMember(id: number): ActionResult {
  const removed = deleteSpouse(state, id)
  if (!removed) {
    return { ok: false, message: '配偶记录不存在' }
  }
  persist()
  return { ok: true }
}

export function useFamilyStore() {
  const members = computed(() => state.members)
  const tracks = computed(() => state.tracks)
  const events = computed(() => state.events)
  const aliases = computed(() => state.aliases)
  const relations = computed(() => state.relations)
  const temporals = computed(() => state.temporals)
  const burials = computed(() => state.burials)
  const spouses = computed(() => state.spouses)
  const childClaims = computed(() => state.childClaims)
  const selectedId = computed(() => state.selectedId)
  const selectedMember = computed(() => getMemberById(state.selectedId))

  return {
    members,
    tracks,
    events,
    aliases,
    relations,
    temporals,
    burials,
    spouses,
    childClaims,
    selectedId,
    selectedMember,
    ready: computed(() => ready.value),
    init,
    syncFromCloud,
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
    addEvent,
    updateEvent,
    deleteEvent,
    importOcrMembers,
    importDataFromJson,
    previewDataFromMarkdown,
    importDataFromMarkdown,
    previewPartDataV2,
    importPartDataV2,
    replaceData,
    addSpouseToMember,
    removeSpouseFromMember,
    exportData: () => ({
      schemaVersion: schemaVersion.value,
      members: state.members,
      tracks: state.tracks,
      events: state.events,
      aliases: state.aliases,
      relations: state.relations,
      temporals: state.temporals,
      burials: state.burials,
      spouses: state.spouses,
      childClaims: state.childClaims,
      nextId: state.nextId,
      nextTrackId: state.nextTrackId,
      nextEventId: state.nextEventId,
      nextAliasId: state.nextAliasId,
      nextRelationId: state.nextRelationId,
      nextTemporalId: state.nextTemporalId,
      nextBurialId: state.nextBurialId,
      nextSpouseId: state.nextSpouseId,
      nextChildClaimId: state.nextChildClaimId,
    }),
  }
}
