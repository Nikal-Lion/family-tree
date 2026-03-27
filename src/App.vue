<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FamilyTreeChart from './components/FamilyTreeChart.vue'
import MemberDetail from './components/MemberDetail.vue'
import MemberForm from './components/MemberForm.vue'
import MemberList from './components/MemberList.vue'
import OcrImportManager from './components/OcrImportManager.vue'
import TrackManager from './components/TrackManager.vue'
import { exportAsJson } from './services/importExport'
import { buildNavigationUrl } from './services/navigationBridge'
import { exportSqliteData, importSqliteData } from './services/storage'
import { useFamilyStore } from './stores/familyStore'
import type { Gender, MemberInput, Track } from './types/member'
import type { DuplicateAction, TempMember } from './types/ocr'

const store = useFamilyStore()

const editingId = ref<number | null>(null)
const formModel = ref<MemberInput>({
  name: '',
  parentId: null,
  gender: '男' as Gender,
  spouseIds: [],
})
const fileInputRef = ref<HTMLInputElement | null>(null)
const searchKeyword = ref('')
const isBootstrapping = ref(true)
const bootstrapError = ref('')

async function bootstrapStore() {
  bootstrapError.value = ''
  isBootstrapping.value = true
  try {
    await store.init()
  } catch (error) {
    bootstrapError.value = error instanceof Error ? error.message : '本地数据库初始化失败'
  } finally {
    isBootstrapping.value = false
  }
}

onMounted(() => {
  void bootstrapStore()
})

const editingMember = computed(() => {
  if (editingId.value === null) {
    return null
  }
  return store.members.value.find((member) => member.id === editingId.value) ?? null
})

const members = computed(() => store.members.value)
const tracks = computed(() => store.tracks.value)
const selectedMember = computed(() => store.selectedMember.value)
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
    window.alert(result.message ?? '保存失败')
    return
  }
  editingId.value = null
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
    window.alert(result.message ?? '删除失败')
    return
  }

  editingId.value = null
  window.alert(result.message ?? '删除成功')
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
}

async function handleExportSqlite() {
  try {
    const binary = await exportSqliteData()
    const blob = new Blob([binary], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'family-tree-backup.sqlite'
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : '导出 SQLite 失败')
  }
}

function handleTrackUpload(payload: { raw: string; name: string; memberId: number | null }) {
  const result = store.addTrackFromGpx(payload.raw, payload.name, payload.memberId)
  if (!result.ok) {
    window.alert(result.message ?? '轨迹上传失败')
    return
  }
  window.alert(result.message ?? '轨迹上传成功')
}

function handleTrackRemove(id: number) {
  const confirmed = window.confirm('确认删除该轨迹吗？')
  if (!confirmed) {
    return
  }

  const result = store.deleteTrack(id)
  if (!result.ok) {
    window.alert(result.message ?? '轨迹删除失败')
    return
  }
  window.alert(result.message ?? '轨迹已删除')
}

function handleTrackNavigate(track: Track) {
  const url = buildNavigationUrl(track.endPoint)
  window.open(url, '_blank', 'noopener,noreferrer')
}

function handleTrackMetaUpdate(payload: { id: number; name: string; memberId: number | null }) {
  const result = store.updateTrackMeta(payload.id, payload.name, payload.memberId)
  if (!result.ok) {
    window.alert(result.message ?? '轨迹更新失败')
    return
  }
  window.alert(result.message ?? '轨迹信息已更新')
}

function handleOcrImport(payload: { members: TempMember[]; duplicateAction: DuplicateAction }) {
  const result = store.importOcrMembers(payload.members, {
    duplicateAction: payload.duplicateAction,
  })
  if (!result.ok) {
    window.alert(result.message ?? 'OCR 导入失败')
    return
  }
  window.alert(result.message ?? 'OCR 导入成功')
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
      window.alert('SQLite 导入成功')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'SQLite 导入失败')
    }
    input.value = ''
    return
  }

  const text = await file.text()
  const result = store.importDataFromJson(text)
  if (!result.ok) {
    window.alert(result.message ?? '导入失败')
  } else {
    editingId.value = null
    window.alert(result.message ?? '导入成功')
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
      <h3>正在加载本地数据库</h3>
      <p>请稍候，系统正在初始化 SQLite 存储并恢复数据。</p>
    </section>

    <section v-else-if="bootstrapError" class="status-panel status-panel-error">
      <h3>初始化失败</h3>
      <p>{{ bootstrapError }}</p>
      <button class="btn-primary" type="button" @click="bootstrapStore">重试</button>
    </section>

    <main v-else class="main-layout">
      <section class="left-pane">
        <FamilyTreeChart
          :members="members"
          :selected-id="store.selectedId.value"
          :highlight-ids="highlightedIds"
          @select="store.selectMember"
        />
      </section>

      <aside class="right-pane">
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

        <OcrImportManager
          :members="members"
          @import-members="handleOcrImport"
        />

        <MemberDetail
          :member="selectedMember"
          :find-parent-name="findParentName"
          :find-spouse-names="findSpouseNames"
          @edit="handleEdit"
          @remove="handleRemove"
        />
      </aside>
    </main>

    <footer class="footer">
      <p>数据默认存储在本地 SQLite（IndexedDB 持久化），请定期导出备份。</p>
    </footer>
  </div>
</template>
