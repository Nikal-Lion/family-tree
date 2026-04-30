<script setup lang="ts">
import { ref } from 'vue'
import { useFamilyStore } from '../stores/familyStore'
import ImportStatsCard from './import/ImportStatsCard.vue'
import ImportIssuesList from './import/ImportIssuesList.vue'
import MemberPreviewList from './import/MemberPreviewList.vue'
import LineSampleViewer from './import/LineSampleViewer.vue'
import type { FamilyData } from '../types/member'
import type { PartDataImportReport } from '../services/partDataImportV2'

const store = useFamilyStore()
const fileInput = ref<HTMLInputElement | null>(null)
const previewState = ref<{ data: FamilyData; report: PartDataImportReport; rawText: string } | null>(null)
const importing = ref(false)
const errorMsg = ref<string>('')

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const raw = await file.text()
  const result = store.previewPartDataV2(raw)
  if (!result.ok || !result.data || !result.report) {
    errorMsg.value = result.message ?? '解析失败'
    previewState.value = null
    return
  }
  errorMsg.value = ''
  previewState.value = { data: result.data, report: result.report, rawText: raw }
}

async function confirmImport() {
  if (!previewState.value) return
  if (!confirm('重新导入将清空现有成员、配偶、子女声明、别名、葬地、时间记录。（事件、轨迹、登录用户保留）确认继续？')) return
  importing.value = true
  const r = await store.importPartDataV2(previewState.value.rawText)
  importing.value = false
  if (r.ok) {
    previewState.value = null
    alert(r.message)
  } else {
    errorMsg.value = r.message ?? '导入失败'
  }
}

function cancel() { previewState.value = null }
</script>

<template>
  <div class="part-data-import-panel">
    <h3>📜 从族谱 Markdown 导入</h3>
    <input ref="fileInput" type="file" accept=".md,.markdown,.txt" @change="onFile" />
    <p v-if="errorMsg" class="err">{{ errorMsg }}</p>

    <div v-if="previewState" class="preview">
      <ImportStatsCard :data="previewState.data" :report="previewState.report" />
      <ImportIssuesList :data="previewState.data" :report="previewState.report" />
      <MemberPreviewList :data="previewState.data" />
      <LineSampleViewer :raw-text="previewState.rawText" :data="previewState.data" />

      <div class="sticky-actions">
        <button @click="cancel">取消</button>
        <button class="primary" :disabled="importing" @click="confirmImport">
          {{ importing ? '导入中…' : '确认导入' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.part-data-import-panel { padding: 16px; }
.preview { margin-top: 12px; }
.sticky-actions {
  position: sticky; bottom: 0; padding: 12px;
  background: #fffef7; border-top: 1px solid #ddd;
  display: flex; gap: 12px; justify-content: flex-end;
}
.primary { background: #2d5e2c; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; }
.err { color: #c0392b; }
</style>
