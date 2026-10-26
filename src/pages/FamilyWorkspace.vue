<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FamilyTreeChart from '../components/FamilyTreeChart.vue'
import MemberDetail from '../components/MemberDetail.vue'
import EventManager from '../components/EventManager.vue'
import LoginUserManager from '../components/LoginUserManager.vue'
import MemberForm from '../components/MemberForm.vue'
import MemberList from '../components/MemberList.vue'
import OcrImportManager from '../components/OcrImportManager.vue'
import PartDataImportPanel from '../components/PartDataImportPanel.vue'
import StatsDashboard from '../components/StatsDashboard.vue'
import TrackManager from '../components/TrackManager.vue'
import { initAuthSession, useAuth } from '../services/authService'
import {
  getD1ApiDiagnosticsConfig,
  runD1SelfCheck,
  type D1SelfCheckResult,
} from '../services/d1ApiService'
import { exportAsJson } from '../services/importExport'
import { computeGenerations } from '../services/generationService'
import { createMemberInput } from '../services/memberProfile'
import { buildNavigationUrl } from '../services/navigationBridge'
import { exportSqliteData, importSqliteData } from '../services/storage'
import { useFamilyStore } from '../stores/familyStore'
import type { FamilyEventInput, MemberInput, Track } from '../types/member'
import type { DuplicateAction, TempMember } from '../types/ocr'

import type { WorkspaceMode } from '../services/accessControl'

const props = withDefaults(
  defineProps<{
    mode?: WorkspaceMode
    section?: 'all' | 'activities' | 'imports'
  }>(),
  {
    mode: 'overview',
    section: 'all',
  },
)

const router = useRouter()
const route = useRoute()
const store = useFamilyStore()
const { isSysadmin, isAuthenticated, ready, canMaintain } = useAuth()
const isOverviewMode = computed(() => props.mode === 'overview')
const isManageMode = computed(() => props.mode === 'manage')
const isSystemMode = computed(() => props.mode === 'system')
const showDataWorkspace = computed(() => isOverviewMode.value || isManageMode.value)
const isViewerMode = computed(() => !isManageMode.value || !canMaintain.value)
const canShowManageActions = computed(() => isManageMode.value && canMaintain.value)
const canShowSystemPanels = computed(() => isSystemMode.value && isSysadmin.value)
const canShowImportActions = computed(() => canShowManageActions.value)
const showTree = computed(() => props.section === 'all')
const showActivities = computed(() => props.section !== 'imports')
const showImports = computed(() => props.section !== 'activities')

watch(
  [() => ready.value, () => isAuthenticated.value],
  ([authReady, authenticated]) => {
    if (!authReady || authenticated) {
      return
    }
    void router.replace({
      path: '/login',
      query: {
        redirect: route.fullPath,
      },
    })
  },
  { immediate: true },
)

const editingId = ref<number | null>(null)
const formModel = ref<MemberInput>(createMemberInput())
const fileInputRef = ref<HTMLInputElement | null>(null)
const treeChartRef = ref<InstanceType<typeof FamilyTreeChart> | null>(null)
const searchKeyword = ref('')
const isBootstrapping = ref(true)
const bootstrapError = ref('')
const selfCheckResult = ref<D1SelfCheckResult | null>(null)
const selfCheckPending = ref(false)

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

function formatDisplayTime(value: string | null | undefined): string {
  if (!value) {
    return '未检测'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', { hour12: false })
}

async function refreshD1Diagnostics(notify = false): Promise<void> {
  selfCheckPending.value = true
  try {
    const result = await runD1SelfCheck()
    selfCheckResult.value = result
    if (notify) {
      if (result.ok) {
        notifySuccess('D1 自检完成')
      } else {
        notifyError(`D1 自检失败：${result.message}`)
      }
    }
  } finally {
    selfCheckPending.value = false
  }
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

async function refreshCloudDataOnFocus(): Promise<void> {
  if (isBootstrapping.value || !store.ready.value) {
    return
  }

  try {
    await store.syncFromCloud()
  } catch (error) {
    console.warn('切回页面时同步 D1 数据失败', error)
  }
}

function handleWindowFocus(): void {
  void refreshCloudDataOnFocus()
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return
  }
  void refreshCloudDataOnFocus()
}

onMounted(() => {
  void initAuthSession()
  void bootstrapStore()
  if (isSysadmin.value) {
    void refreshD1Diagnostics()
  }
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId)
  }
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
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
const aliases = computed(() => store.aliases.value)
const relations = computed(() => store.relations.value)
const temporals = computed(() => store.temporals.value)
const burials = computed(() => store.burials.value)
const selectedMember = computed(() => store.selectedMember.value)

const selectedAliases = computed(() => {
  const id = store.selectedId.value
  if (id === null) {
    return []
  }
  return aliases.value.filter((alias) => alias.memberId === id)
})

const selectedRelations = computed(() => {
  const id = store.selectedId.value
  if (id === null) {
    return []
  }
  return relations.value.filter((relation) => relation.fromMemberId === id || relation.toMemberId === id)
})

const selectedBurials = computed(() => {
  const id = store.selectedId.value
  if (id === null) {
    return []
  }
  return burials.value.filter((burial) => burial.memberId === id)
})

const generationMap = computed(() => computeGenerations(members.value))

const selectedGeneration = computed(() => {
  const id = store.selectedId.value
  if (id === null) return null
  return generationMap.value.get(id) ?? null
})

const d1Config = computed(() => getD1ApiDiagnosticsConfig())
const d1ApiUrl = `${window.location.origin}/api/family-data`
const diagnostics = computed(() => selfCheckResult.value)
const diagnosticsTone = computed(() => diagnostics.value?.status ?? 'warning')
const diagnosticsTitle = computed(() => {
  if (selfCheckPending.value && !diagnostics.value) {
    return '正在检测 D1 连接'
  }
  if (!diagnostics.value) {
    return '尚未执行 D1 自检'
  }
  if (diagnostics.value.status === 'ok') {
    return 'D1 连接正常'
  }
  if (diagnostics.value.status === 'warning') {
    return 'D1 已连通，但状态需要确认'
  }
  return 'D1 自检失败'
})
const diagnosticsSummary = computed(() => {
  if (selfCheckPending.value && !diagnostics.value) {
    return '正在向 Cloudflare Worker 发起请求并验证 D1 返回。'
  }
  return diagnostics.value?.message ?? '点击“重新检测”后，可确认当前页面是否已连接到 D1。'
})
const diagnosticsTimeText = computed(() => formatDisplayTime(diagnostics.value?.checkedAt))
const diagnosticsHttpStatusText = computed(() => {
  const status = diagnostics.value?.httpStatus
  return typeof status === 'number' ? String(status) : '无'
})
const diagnosticsSchemaText = computed(() => {
  const schemaVersion = diagnostics.value?.schemaVersion
  return typeof schemaVersion === 'number' ? String(schemaVersion) : '无'
})
const diagnosticsStatusLabel = computed(() => {
  if (selfCheckPending.value) {
    return '检测中'
  }
  if (!diagnostics.value) {
    return '未检测'
  }
  if (diagnostics.value.status === 'ok') {
    return '正常'
  }
  if (diagnostics.value.status === 'warning') {
    return '空库'
  }
  return '失败'
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

function resolveMemberName(id: number): string {
  const target = members.value.find((member) => member.id === id)
  return target?.name ?? `成员#${id}`
}

async function handleSubmit(payload: MemberInput, id?: number) {
  const result = await (typeof id === 'number' ? store.updateMember(id, payload) : store.addMember(payload))
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

async function handleRemove(id: number) {
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

  const result = await store.deleteMember(id)
  if (!result.ok) {
    notifyError(result.message ?? '删除失败')
    return
  }

  editingId.value = null
  notifySuccess(result.message ?? '删除成功')
}

function handleAddChild(parentId: number) {
  editingId.value = null
  formModel.value = createMemberInput(undefined, parentId)
  notifyInfo('已自动填充父亲，请输入子女姓名后保存')
}

async function handleExport() {
  await store.whenIdle()
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
    await store.whenIdle()
    const binary = await exportSqliteData(store.exportData())
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

async function handleTrackUpload(payload: { raw: string; name: string; memberId: number | null }) {
  const result = await store.addTrackFromGpx(payload.raw, payload.name, payload.memberId)
  if (!result.ok) {
    notifyError(result.message ?? '轨迹上传失败')
    return
  }
  notifySuccess(result.message ?? '轨迹上传成功')
}

async function handleTrackRemove(id: number) {
  const confirmed = window.confirm('确认删除该轨迹吗？')
  if (!confirmed) {
    return
  }

  const result = await store.deleteTrack(id)
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

async function handleTrackMetaUpdate(payload: { id: number; name: string; memberId: number | null }) {
  const result = await store.updateTrackMeta(payload.id, payload.name, payload.memberId)
  if (!result.ok) {
    notifyError(result.message ?? '轨迹更新失败')
    return
  }
  notifySuccess(result.message ?? '轨迹信息已更新')
}

async function handleOcrImport(payload: { members: TempMember[]; duplicateAction: DuplicateAction }) {
  const result = await store.importOcrMembers(payload.members, {
    duplicateAction: payload.duplicateAction,
  })
  if (!result.ok) {
    notifyError(result.message ?? 'OCR 导入失败')
    return
  }
  notifySuccess(result.message ?? 'OCR 导入成功')
}

async function handleEventAdd(payload: FamilyEventInput) {
  const result = await store.addEvent(payload)
  if (!result.ok) {
    notifyError(result.message ?? '事件新增失败')
    return
  }
  notifySuccess(result.message ?? '事件新增成功')
}

async function handleEventUpdate(payload: { id: number; input: FamilyEventInput }) {
  const result = await store.updateEvent(payload.id, payload.input)
  if (!result.ok) {
    notifyError(result.message ?? '事件更新失败')
    return
  }
  notifySuccess(result.message ?? '事件更新成功')
}

async function handleEventRemove(id: number) {
  const result = await store.deleteEvent(id)
  if (!result.ok) {
    notifyError(result.message ?? '事件删除失败')
    return
  }
  notifySuccess(result.message ?? '事件已删除')
}

function openImportDialog() {
  if (!canShowImportActions.value) {
    notifyError('当前角色无导入权限')
    return
  }
  fileInputRef.value?.click()
}

async function handleImport(event: Event) {
  if (!canShowImportActions.value) {
    notifyError('当前角色无导入权限')
    return
  }

  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  try {
    const lowerName = file.name.toLowerCase()

    if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
      const text = await file.text()
      const preview = store.previewDataFromMarkdown(text)
      if (!preview.ok) {
        notifyError(preview.message ?? 'Markdown 预览失败')
        return
      }

      const summary = preview.summary
      const summaryText = summary
        ? `成员 ${summary.memberCount}，始祖分支 ${summary.rootCount}，别名 ${summary.aliasCount}，时间表达 ${summary.temporalCount}，葬地 ${summary.burialCount}`
        : '未生成统计信息'
      const warningPreview =
        preview.warnings.length > 0
          ? preview.warnings
              .slice(0, 4)
              .map((item, index) => `${index + 1}. ${item}`)
              .join('\n')
          : '未检测到明显结构风险'

      const confirmCover = window.confirm(
        `Markdown 预览结果：\n${summaryText}\n\n风险提示（最多展示 4 条）：\n${warningPreview}\n\n导入将替换成员资料，事件和轨迹保留但清空原人物关联。是否继续？`,
      )
      if (!confirmCover) return

      const result = await store.importDataFromMarkdown(text)
      if (!result.ok) {
        notifyError(result.message ?? 'Markdown 导入失败')
      } else {
        editingId.value = null
        notifySuccess(result.message ?? 'Markdown 导入成功')
      }
      return
    }

    const confirmCover = window.confirm('恢复备份将替换全部族谱业务资料（不影响登录账号），是否继续？')
    if (!confirmCover) return

    let result
    if (lowerName.endsWith('.sqlite') || lowerName.endsWith('.db')) {
      const buffer = await file.arrayBuffer()
      const imported = await importSqliteData(new Uint8Array(buffer))
      result = await store.importDataFromJson(exportAsJson(imported))
    } else {
      result = await store.importDataFromJson(await file.text())
    }

    if (!result.ok) {
      notifyError(result.message ?? '备份恢复失败')
    } else {
      editingId.value = null
      notifySuccess('备份已恢复并保存到云端')
    }
  } catch (error) {
    notifyError(error instanceof Error ? error.message : '读取备份失败')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="legacy-workspace">
  <div class="page">
    <header v-if="section !== 'activities'" class="workspace-toolbar">
      <div>
        <h1>{{ section === 'imports' ? '资料导入与备份' : route.meta.title }}</h1>
        <p>{{ section === 'imports' ? 'JSON / SQLite 备份保留全部族谱业务资料，不包含登录账号和会话。SQLite 为独立备份文件，并非 D1 整库镜像。' : route.meta.description }}</p>
      </div>

      <div v-if="canShowManageActions && showImports" class="top-actions">
        <button class="btn-ghost" type="button" @click="openImportDialog">导入 JSON/SQLite/Markdown</button>
        <button class="btn-primary" type="button" @click="handleExport">导出 JSON</button>
        <button class="btn-ghost" type="button" @click="handleExportSqlite">导出 SQLite</button>
        <button v-if="showTree" class="btn-ghost" type="button" @click="handleExportTreePng">导出树图 PNG</button>
      </div>

      <div v-else-if="isOverviewMode" class="top-actions top-actions-readonly">
        <span class="readonly-tip">当前为只读总览页面</span>
        <button class="btn-ghost" type="button" @click="handleExportTreePng">导出树图 PNG</button>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        accept="application/json,text/markdown,.md,.markdown,.sqlite,.db"
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

    <p v-if="store.saving.value" role="status">正在保存到云端，请勿关闭页面…</p>
    <p v-if="store.lastSaveError.value" role="alert" class="storage-error">修改未保存，已恢复原数据：{{ store.lastSaveError.value }}</p>
    <fieldset :disabled="store.saving.value" class="workspace-data-fields">
    <main v-if="showDataWorkspace && !isBootstrapping && !bootstrapError" class="main-layout" :class="{'workspace-tools-layout': !showTree}">
      <section v-if="showTree" class="left-pane">
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
          v-if="showTree"
          :members="members"
          :tracks="tracks"
          :events="events"
        />

        <MemberForm
          v-if="canShowManageActions && showTree"
          v-model:form="formModel"
          :members="members"
          :editing-member="editingMember"
          @submit="handleSubmit"
          @cancel="handleCancelEdit"
        />

        <MemberList
          v-if="showTree"
          :members="members"
          :selected-id="store.selectedId.value"
          :find-parent-name="findParentName"
          :generation-map="generationMap"
          :readonly="isViewerMode"
          @select="store.selectMember"
          @edit="handleEdit"
          @remove="handleRemove"
          @search="searchKeyword = $event"
        />

        <TrackManager
          v-if="showActivities"
          :tracks="tracks"
          :members="members"
          :selected-member-id="store.selectedId.value"
          :readonly="isViewerMode"
          @upload="handleTrackUpload"
          @remove="handleTrackRemove"
          @navigate="handleTrackNavigate"
          @update-meta="handleTrackMetaUpdate"
        />

        <EventManager
          v-if="showActivities"
          :events="events"
          :members="members"
          :readonly="isViewerMode"
          @add="handleEventAdd"
          @update="handleEventUpdate"
          @remove="handleEventRemove"
        />

        <OcrImportManager
          v-if="canShowManageActions && showImports"
          :members="members"
          @import-members="handleOcrImport"
        />

        <section v-if="canShowManageActions && showImports" class="manage-section">
          <PartDataImportPanel />
        </section>

        <MemberDetail
          v-if="showTree"
          :member="selectedMember"
          :find-parent-name="findParentName"
          :generation="selectedGeneration"
          :aliases="selectedAliases"
          :relations="selectedRelations"
          :temporals="temporals"
          :burials="selectedBurials"
          :resolve-member-name="resolveMemberName"
          :readonly="isViewerMode"
          @edit="handleEdit"
          @remove="handleRemove"
          @add-child="handleAddChild"
        />
      </aside>
    </main>
    </fieldset>

    <main v-if="canShowSystemPanels" class="system-layout">
      <section class="diagnostic-panel" :class="`diagnostic-panel-${diagnosticsTone}`">
        <div class="diagnostic-header">
          <div>
            <p class="diagnostic-kicker">D1 自检面板</p>
            <h3>{{ diagnosticsTitle }}</h3>
            <p>{{ diagnosticsSummary }}</p>
          </div>
          <button class="btn-ghost" type="button" :disabled="selfCheckPending" @click="refreshD1Diagnostics(true)">
            {{ selfCheckPending ? '检测中...' : '重新检测' }}
          </button>
        </div>

        <div class="diagnostic-grid">
          <div class="diagnostic-item">
            <span>状态</span>
            <strong>{{ diagnosticsStatusLabel }}</strong>
          </div>
          <div class="diagnostic-item diagnostic-item-wide">
            <span>API 地址</span>
            <strong>{{ d1ApiUrl }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>Token</span>
            <strong>{{ d1Config.tokenConfigured ? '已配置' : '未配置' }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>HTTP 状态</span>
            <strong>{{ diagnosticsHttpStatusText }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>最近检测</span>
            <strong>{{ diagnosticsTimeText }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>Schema</span>
            <strong>{{ diagnosticsSchemaText }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>云端成员</span>
            <strong>{{ diagnostics?.memberCount ?? 0 }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>云端轨迹</span>
            <strong>{{ diagnostics?.trackCount ?? 0 }}</strong>
          </div>
          <div class="diagnostic-item">
            <span>云端事件</span>
            <strong>{{ diagnostics?.eventCount ?? 0 }}</strong>
          </div>
        </div>
      </section>

      <LoginUserManager
        @notify="(msg, type) => showToast(msg, type)"
      />
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
  </div>
</template>
