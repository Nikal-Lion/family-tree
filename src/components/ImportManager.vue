<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Alert, Button, Card, Descriptions, Modal, Space, Spin, Tag, message } from 'ant-design-vue'
import { DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons-vue'
import OcrImportManager from './OcrImportManager.vue'
import PartDataImportPanel from './PartDataImportPanel.vue'
import { useAuth } from '../services/authService'
import { createBackupDownload, downloadBackup, readBackupFile, type BackupFormat } from '../services/backupFiles'
import { exportAsJson } from '../services/importExport'
import { useFamilyStore } from '../stores/familyStore'
import type { FamilyData } from '../types/member'

const store = useFamilyStore()
const { canMaintain } = useAuth()
const initializing = ref(true)
const loadError = ref('')
const fileError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const preparing = ref(false)
const exporting = ref<BackupFormat | null>(null)
const restoreOpen = ref(false)
const preview = ref<{ name: string; data: FamilyData } | null>(null)
const busy = computed(() => store.saving.value || preparing.value || exporting.value !== null)
const summary = computed(() => preview.value ? [
  ['族人', preview.value.data.members.length], ['配偶', preview.value.data.spouses.length],
  ['子女声明', preview.value.data.childClaims.length], ['别名', preview.value.data.aliases.length],
  ['关系', preview.value.data.relations.length], ['纪年', preview.value.data.temporals.length],
  ['葬地', preview.value.data.burials.length], ['事件', preview.value.data.events.length],
  ['轨迹', preview.value.data.tracks.length],
] : [])

async function load(refresh = false) {
  if (!canMaintain.value) { initializing.value = false; return }
  initializing.value = true
  loadError.value = ''
  try {
    if (refresh) await store.syncFromCloud()
    else await store.init()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载云端资料失败'
  } finally {
    initializing.value = false
  }
}
onMounted(() => { void load() })

async function exportBackup(format: BackupFormat) {
  if (!canMaintain.value || busy.value || initializing.value || loadError.value) return
  exporting.value = format
  fileError.value = ''
  try {
    await store.whenIdle()
    const { blob, filename } = await createBackupDownload(store.exportData(), format)
    downloadBackup(blob, filename)
    message.success(`${format === 'json' ? 'JSON' : 'SQLite'} 备份已生成`)
  } catch (error) {
    fileError.value = error instanceof Error ? error.message : '生成备份失败'
  } finally {
    exporting.value = null
  }
}

async function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !canMaintain.value || busy.value) return
  preparing.value = true
  fileError.value = ''
  preview.value = null
  try {
    preview.value = { name: file.name, data: await readBackupFile(file) }
    restoreOpen.value = true
  } catch (error) {
    fileError.value = error instanceof Error ? error.message : '读取备份失败'
  } finally {
    preparing.value = false
    input.value = ''
  }
}

async function restore() {
  if (!preview.value || !canMaintain.value || busy.value) return
  const result = await store.importDataFromJson(exportAsJson(preview.value.data))
  if (!result.ok) { message.error(result.message ?? '备份恢复失败'); return }
  restoreOpen.value = false
  preview.value = null
  message.success('备份已恢复并保存到云端')
}
</script>

<template>
  <Alert v-if="!canMaintain" type="error" show-icon message="仅维护人员和管理员可管理资料与备份" />
  <Space v-else direction="vertical" :size="16" class="imports-manager">
    <Alert v-if="loadError" type="error" show-icon :message="loadError">
      <template #action><Button size="small" @click="load()">重试</Button></template>
    </Alert>
    <Alert v-if="store.lastSaveError.value" type="error" show-icon message="修改未保存，原数据已恢复" :description="store.lastSaveError.value">
      <template #action><Button size="small" :disabled="busy" @click="load(true)">重新加载云端</Button></template>
    </Alert>
    <Alert v-if="store.saving.value" type="info" show-icon message="正在保存到云端，请勿关闭页面" />
    <Spin :spinning="initializing">
      <Card title="完整业务备份" :bordered="false">
        <template #extra><Button :disabled="busy || initializing" @click="load(true)"><template #icon><ReloadOutlined /></template>刷新</Button></template>
        <p class="backup-description">备份保留全部族谱业务资料，不包含登录账号和会话。恢复会替换现有业务数据，请先导出备份。</p>
        <Space wrap>
          <Button type="primary" :disabled="busy || initializing || !!loadError" :loading="exporting === 'json'" @click="exportBackup('json')"><template #icon><DownloadOutlined /></template>导出 JSON</Button>
          <Button :disabled="busy || initializing || !!loadError" :loading="exporting === 'sqlite'" @click="exportBackup('sqlite')"><template #icon><DownloadOutlined /></template>导出 SQLite</Button>
          <Button :disabled="busy || initializing || !!loadError" :loading="preparing" @click="fileInput?.click()"><template #icon><UploadOutlined /></template>从备份恢复</Button>
        </Space>
        <input ref="fileInput" class="backup-file-input" type="file" accept=".json,.sqlite,.db" :disabled="busy || initializing || !!loadError" @change="selectBackup" />
        <Alert v-if="fileError" type="error" show-icon :message="fileError" class="backup-alert" />
        <p class="backup-description">SQLite 是包含完整业务快照的独立备份文件，并非 D1 整库镜像；兼容早期扩展名为 .sqlite 的 JSON 备份，不接受任意 SQLite 数据库。</p>
      </Card>
    </Spin>
    <template v-if="!initializing && !loadError">
      <PartDataImportPanel />
      <OcrImportManager :members="store.members.value" />
    </template>
  </Space>
  <Modal v-model:open="restoreOpen" title="确认恢复业务备份" ok-text="恢复并保存到云端" cancel-text="取消" :confirm-loading="store.saving.value" :ok-button-props="{danger:true, disabled:busy}" :cancel-button-props="{disabled:busy}" :mask-closable="!busy" :closable="!busy" :keyboard="!busy" @ok="restore">
    <template v-if="preview">
      <p class="backup-filename">{{ preview.name }} <Tag color="blue">Schema {{ preview.data.schemaVersion }}</Tag></p>
      <Alert type="warning" show-icon message="将替换全部族谱业务资料，不影响登录账号。只有云端确认后才算恢复成功。" />
      <Descriptions bordered size="small" :column="1" class="backup-alert">
        <Descriptions.Item v-for="[label, count] in summary" :key="label" :label="String(label)">{{ count }}</Descriptions.Item>
      </Descriptions>
    </template>
  </Modal>
</template>

<style scoped>
.imports-manager { width: 100%; min-width: 0; }
.backup-description { color: #667085; line-height: 1.7; margin: 12px 0; overflow-wrap: anywhere; }
.backup-file-input { display: none; }
.backup-alert { margin-top: 16px; }
.backup-filename { overflow-wrap: anywhere; }
</style>
