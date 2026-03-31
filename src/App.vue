<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FamilyTreeChart from './components/FamilyTreeChart.vue'
import MemberDetail from './components/MemberDetail.vue'
import EventManager from './components/EventManager.vue'
import MemberForm from './components/MemberForm.vue'
import MemberList from './components/MemberList.vue'
import OcrImportManager from './components/OcrImportManager.vue'
import StatsDashboard from './components/StatsDashboard.vue'
import TrackManager from './components/TrackManager.vue'
import { exportAsJson } from './services/importExport'
import { computeGenerations } from './services/generationService'
import { buildNavigationUrl } from './services/navigationBridge'
import { exportSqliteData, importSqliteData } from './services/storage'
import { useFamilyStore } from './stores/familyStore'
import type { FamilyEventInput, Gender, MemberInput, Track } from './types/member'
import type { DuplicateAction, TempMember } from './types/ocr'

const store = useFamilyStore()

const editingId = ref<number | null>(null)
const formModel = ref<MemberInput>({
  name: '',
  parentId: null,
  gender: '男' as Gender,
  spouseIds: [],
  birthDate: '',
  photoUrl: '',
  biography: '',
})
const fileInputRef = ref<HTMLInputElement | null>(null)
const treeChartRef = ref<InstanceType<typeof FamilyTreeChart> | null>(null)
const searchKeyword = ref('')
const isBootstrapping = ref(true)
const bootstrapError = ref('')

type ToastType = 'success' | 'error' | 'info'

const toast = ref<{ visible: boolean; message: string; type: ToastType }>({
  visible: false,
  message: '',
  type: 'info',
})
let toastTimerId: number | null = null

function showToast(message: string, type: ToastType = 'info'): void {
  toast.value = {
    visible: true,
    message,
    type,
  }

  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId)
  }

  toastTimerId = window.setTimeout(() => {
    toast.value.visible = false
  }, 2200)
}

function notifySuccess(message: string): void {
  showToast(message, 'success')
}

function notifyError(message: string): void {
  showToast(message, 'error')
}

function notifyInfo(message: string): void {
  showToast(message, 'info')
}

async function bootstrapStore() {
  bootstrapError.value = ''
  isBootstrapping.value = true
  try {
    await store.init()
  } catch (error) {
    bootstrapError.value = error instanceof Error ? error.message : '云端 D1 数据初始化失败'
  } finally {
    isBootstrapping.value = false
  }
}

onMounted(() => {
  void bootstrapStore()
})

onBeforeUnmount(() => {
  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId)
  }
})

const editingMember = computed(() => {
  if (editingId.value === null) {
    return null
  }
  return store.members.value.find((member) => member.id === editingId.value) ?? null
})

const members = computed(() => store.members.value)
const tracks = computed(() => store.tracks.value)
const events = computed(() => store.events.value)
const selectedMember = computed(() => store.selectedMember.value)

const generationMap = computed(() => computeGenerations(members.value))

const selectedGeneration = computed(() => {
  const id = store.selectedId.value
  if (id === null) return null
  return generationMap.value.get(id) ?? null
})

const highlightedIds = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) {
    return [] as number[]
  }

  return members.value
    .filter((member) => {
      return member.name.toLowerCase().includes(keyword) || String(member.id).includes(keyword)
    })
    .map((member) => member.id)
})

function countDeletionImpact(rootId: number): number {
  const byParent = new Map<number, number[]>()

  for (const member of members.value) {
    if (member.parentId === null) {
      continue
    }
    const children = byParent.get(member.parentId) ?? []
    children.push(member.id)
    byParent.set(member.parentId, children)
  }

  let count = 0
  const stack = [rootId]

  while (stack.length > 0) {
    const current = stack.pop()!
    count += 1
    stack.push(...(byParent.get(current) ?? []))
  }

  return count
}

function findParentName(parentId: number | null): string {
  if (parentId === null) {
    return '始祖'
  }
  const parent = members.value.find((member) => member.id === parentId)
  return parent?.name ?? '未知'
}

function findSpouseNames(spouseIds: number[]): string {
  if (spouseIds.length === 0) {
    return '暂无'
  }

  return spouseIds
    .map((id) => members.value.find((member) => member.id === id)?.name ?? `成员#${id}`)
    .join('、')
}

function handleSubmit(payload: MemberInput, id?: number) {
  const result = typeof id === 'number' ? store.updateMember(id, payload) : store.addMember(payload)
  if (!result.ok) {
    notifyError(result.message ?? '保存失败')
    return
  }
  editingId.value = null
  notifySuccess(typeof id === 'number' ? '编辑成功' : '新增成功')
}

function handleEdit(id: number) {
  store.selectMember(id)
  editingId.value = id
}

function handleCancelEdit() {
  editingId.value = null
}

function handleRemove(id: number) {
  const target = members.value.find((member) => member.id === id)
  if (!target) {
    return
  }

  const impactCount = countDeletionImpact(id)
  const confirmed = window.confirm(
    `确认删除 ${target.name} 及其全部后代吗？预计删除 ${impactCount} 位成员。`,
  )
  if (!confirmed) {
    return
  }

  const result = store.deleteMember(id)
  if (!result.ok) {
    notifyError(result.message ?? '删除失败')
    return
  }

  editingId.value = null
  notifySuccess(result.message ?? '删除成功')
}

function handleAddChild(parentId: number) {
  editingId.value = null
  formModel.value = {
    name: '',
    parentId,
    gender: '男',
    spouseIds: [],
    birthDate: '',
    photoUrl: '',
    biography: '',
  }
  notifyInfo('已自动填充父亲，请输入子女姓名后保存')
}

function handleExport() {
  const json = exportAsJson(store.exportData())
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'family-tree-backup.json'
  anchor.click()
  URL.revokeObjectURL(url)
  notifySuccess('导出 JSON 成功')
}

async function handleExportSqlite() {
  try {
    const binary = await exportSqliteData()
    const binaryBuffer = binary.buffer.slice(
      binary.byteOffset,
      binary.byteOffset + binary.byteLength,
    ) as ArrayBuffer
    const blob = new Blob([binaryBuffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'family-tree-backup.sqlite'
    anchor.click()
    URL.revokeObjectURL(url)
    notifySuccess('导出 SQLite 成功')
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '导出 SQLite 失败')
  }
}

function handleExportTreePng() {
  treeChartRef.value?.exportAsPng()
  notifySuccess('族谱树图已导出为 PNG')
}

function handleTrackUpload(payload: { raw: string; name: string; memberId: number | null }) {
  const result = store.addTrackFromGpx(payload.raw, payload.name, payload.memberId)
  if (!result.ok) {
    notifyError(result.message ?? '轨迹上传失败')
    return
  }
  notifySuccess(result.message ?? '轨迹上传成功')
}

function handleTrackRemove(id: number) {
  const confirmed = window.confirm('确认删除该轨迹吗？')
  if (!confirmed) {
    return
  }

  const result = store.deleteTrack(id)
  if (!result.ok) {
    notifyError(result.message ?? '轨迹删除失败')
    return
  }
  notifySuccess(result.message ?? '轨迹已删除')
}

function handleTrackNavigate(track: Track) {
  const url = buildNavigationUrl(track.endPoint)
  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (popup) {
    notifyInfo('导航页面已打开')
    return
  }
  notifyError('导航页面被拦截，请允许弹窗后重试')
}

function handleTrackMetaUpdate(payload: { id: number; name: string; memberId: number | null }) {
  const result = store.updateTrackMeta(payload.id, payload.name, payload.memberId)
  if (!result.ok) {
    notifyError(result.message ?? '轨迹更新失败')
    return
  }
  notifySuccess(result.message ?? '轨迹信息已更新')
}

function handleOcrImport(payload: { members: TempMember[]; duplicateAction: DuplicateAction }) {
  const result = store.importOcrMembers(payload.members, {
    duplicateAction: payload.duplicateAction,
  })
  if (!result.ok) {
    notifyError(result.message ?? 'OCR 导入失败')
    return
  }
  notifySuccess(result.message ?? 'OCR 导入成功')
}

function handleEventAdd(payload: FamilyEventInput) {
  const result = store.addEvent(payload)
  if (!result.ok) {
    notifyError(result.message ?? '事件新增失败')
    return
  }
  notifySuccess(result.message ?? '事件新增成功')
}

function handleEventUpdate(payload: { id: number; input: FamilyEventInput }) {
  const result = store.updateEvent(payload.id, payload.input)
  if (!result.ok) {
    notifyError(result.message ?? '事件更新失败')
    return
  }
  notifySuccess(result.message ?? '事件更新成功')
}

function handleEventRemove(id: number) {
  const result = store.deleteEvent(id)
  if (!result.ok) {
    notifyError(result.message ?? '事件删除失败')
    return
  }
  notifySuccess(result.message ?? '事件已删除')
}

function openImportDialog() {
  fileInputRef.value?.click()
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  const confirmCover = window.confirm('导入将覆盖当前数据，是否继续？')
  if (!confirmCover) {
    input.value = ''
    return
  }

  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.sqlite') || lowerName.endsWith('.db')) {
    try {
      const buffer = await file.arrayBuffer()
      const imported = await importSqliteData(new Uint8Array(buffer))
      store.replaceData(imported)
      editingId.value = null
      notifySuccess('SQLite 导入成功')
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'SQLite 导入失败')
    }
    input.value = ''
    return
  }

  const text = await file.text()
  const result = store.importDataFromJson(text)
  if (!result.ok) {
    notifyError(result.message ?? '导入失败')
  } else {
    editingId.value = null
    notifySuccess(result.message ?? '导入成功')
  }

  input.value = ''
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <h1>家族云谱</h1>
      <p>记录家族世系，传承家族文化</p>
      <div class="top-actions">
        <button class="btn-ghost" type="button" @click="openImportDialog">导入 JSON/SQLite</button>
        <button class="btn-primary" type="button" @click="handleExport">导出 JSON</button>
        <button class="btn-ghost" type="button" @click="handleExportSqlite">导出 SQLite</button>
        <button class="btn-ghost" type="button" @click="handleExportTreePng">导出树图 PNG</button>
      </div>
      <input
        ref="fileInputRef"
        type="file"
        accept="application/json,.sqlite,.db"
        class="hidden-input"
        @change="handleImport"
      />
    </header>

    <section v-if="isBootstrapping" class="status-panel">
      <h3>正在连接云端存储</h3>
      <p>请稍候，系统正在初始化 Cloudflare D1 数据并恢复内容。</p>
    </section>

    <section v-else-if="bootstrapError" class="status-panel status-panel-error">
      <h3>初始化失败</h3>
      <p>{{ bootstrapError }}</p>
      <button class="btn-primary" type="button" @click="bootstrapStore">重试</button>
    </section>

    <main v-else class="main-layout">
      <section class="left-pane">
        <FamilyTreeChart
          ref="treeChartRef"
          :members="members"
          :selected-id="store.selectedId.value"
          :highlight-ids="highlightedIds"
          @select="store.selectMember"
        />
      </section>

      <aside class="right-pane">
        <StatsDashboard
          :members="members"
          :tracks="tracks"
          :events="events"
        />

        <MemberForm
          v-model:form="formModel"
          :members="members"
          :editing-member="editingMember"
          @submit="handleSubmit"
          @cancel="handleCancelEdit"
        />

        <MemberList
          :members="members"
          :selected-id="store.selectedId.value"
          :find-parent-name="findParentName"
          :generation-map="generationMap"
          @select="store.selectMember"
          @edit="handleEdit"
          @remove="handleRemove"
          @search="searchKeyword = $event"
        />

        <TrackManager
          :tracks="tracks"
          :members="members"
          :selected-member-id="store.selectedId.value"
          @upload="handleTrackUpload"
          @remove="handleTrackRemove"
          @navigate="handleTrackNavigate"
          @update-meta="handleTrackMetaUpdate"
        />

        <EventManager
          :events="events"
          :members="members"
          @add="handleEventAdd"
          @update="handleEventUpdate"
          @remove="handleEventRemove"
        />

        <OcrImportManager
          :members="members"
          @import-members="handleOcrImport"
        />

        <MemberDetail
          :member="selectedMember"
          :find-parent-name="findParentName"
          :find-spouse-names="findSpouseNames"
          :generation="selectedGeneration"
          @edit="handleEdit"
          @remove="handleRemove"
          @add-child="handleAddChild"
        />
      </aside>
    </main>

    <footer class="footer">
      <p>数据默认存储在 Cloudflare D1 云端数据库，请定期导出备份。</p>
    </footer>

    <transition name="toast-fade">
      <div
        v-if="toast.visible"
        class="app-toast"
        :class="`app-toast-${toast.type}`"
        role="status"
        aria-live="polite"
      >
        {{ toast.message }}
      </div>
    </transition>
  </div>
</template>
