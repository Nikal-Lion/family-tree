<script setup lang="ts">
import { computed, ref } from 'vue'
import { Alert, Button, Card, Modal, Space, Tabs, Tag, message } from 'ant-design-vue'
import { UploadOutlined } from '@ant-design/icons-vue'
import { useAuth } from '../services/authService'
import { useFamilyStore } from '../stores/familyStore'
import ImportStatsCard from './import/ImportStatsCard.vue'
import ImportIssuesList from './import/ImportIssuesList.vue'
import MemberPreviewList from './import/MemberPreviewList.vue'
import LineSampleViewer from './import/LineSampleViewer.vue'
import type { FamilyData } from '../types/member'
import type { PartDataImportReport } from '../services/partDataImportV2'

const store = useFamilyStore()
const { canMaintain } = useAuth()
const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<{ data: FamilyData; report: PartDataImportReport; rawText: string; filename: string } | null>(null)
const reading = ref(false)
const error = ref('')
const busy = computed(() => reading.value || store.saving.value)

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value || !canMaintain.value) return
  reading.value = true
  error.value = ''
  try {
    const rawText = await file.text()
    const result = store.previewPartDataV2(rawText)
    if (!result.ok || !result.data || !result.report) {
      throw new Error(result.message ?? '无法解析谱文')
    }
    preview.value = { data: result.data, report: result.report, rawText, filename: file.name }
  } catch (cause) {
    preview.value = null
    error.value = cause instanceof Error ? cause.message : '读取谱文文件失败'
  } finally {
    reading.value = false
    input.value = ''
  }
}

function confirmImport() {
  if (!preview.value || busy.value || !canMaintain.value) return
  const source = preview.value
  Modal.confirm({
    title: `导入 ${source.data.members.length} 位族人的谱文？`,
    content: '将替换现有成员、配偶、子女声明、别名、关系、葬地和时间记录。事件与轨迹保留，但原人物关联清空；登录账号不变。请先导出完整备份。',
    okText: '替换并保存到云端', cancelText: '取消', okButtonProps: { danger: true },
    async onOk() {
      const result = await store.importPartDataV2(source.rawText)
      if (!result.ok) {
        error.value = result.message ?? '谱文导入失败'
        message.error(error.value)
        throw new Error(error.value)
      }
      preview.value = null
      error.value = ''
      message.success(result.message ?? '谱文已保存到云端')
    },
  })
}
</script>

<template>
  <Card v-if="canMaintain" title="族谱 Markdown 导入" :bordered="false" class="markdown-manager">
    <p class="markdown-description">先预览成员、关系及问题清单，确认后再替换。预览不会写入云端。</p>
    <Alert type="warning" show-icon message="保留原字与长幼顺序，请核对后再导入" description="优先按原名匹配；姓名不同或同名待消歧时，仅在同分支、下一世代、父亲记载及排行唯一一致时自动关联，并列出依据。排行关联本身不改名、不归并人物。没有明确排行时，只有同父、同性别记录完整且顺序无冲突才按原文排序推定。嵌套、无名、缺字及冲突记载保留复核提示；缺字不前移后续排行。问题数量不是正确性证明。" class="markdown-section" />
    <Alert type="info" show-icon message="同名也可能是出继复载，不一律视为冲突" description="同分支同代有明确的生父出继、兄弟承继及双处正文对应时，整理为同一人物并保留两处原文。生父用于主树，承继父单独记录；只有同名而没有这些依据时不合并。已建立承继父关联的成员不再计为孤立成员。" class="markdown-section" />
    <Space wrap>
      <Button :disabled="busy" :loading="reading" @click="fileInput?.click()"><template #icon><UploadOutlined /></template>选择 Markdown 谱文</Button>
      <Tag v-if="preview" color="blue" class="markdown-filename">{{ preview.filename }}</Tag>
    </Space>
    <input ref="fileInput" type="file" accept=".md,.markdown,.txt" class="markdown-file-input" :disabled="busy" @change="onFile" />
    <Alert v-if="error" type="error" show-icon :message="error" class="markdown-section" />
    <template v-if="preview">
      <div class="markdown-section"><ImportStatsCard :data="preview.data" :report="preview.report" /></div>
      <Tabs default-active-key="issues">
        <Tabs.TabPane key="issues" tab="问题清单"><ImportIssuesList :data="preview.data" :report="preview.report" /></Tabs.TabPane>
        <Tabs.TabPane key="members" tab="成员预览"><MemberPreviewList :data="preview.data" /></Tabs.TabPane>
        <Tabs.TabPane key="source" tab="原文解析"><LineSampleViewer :raw-text="preview.rawText" :data="preview.data" /></Tabs.TabPane>
      </Tabs>
      <div class="markdown-actions">
        <Button :disabled="busy" @click="preview=null">取消预览</Button>
        <Button type="primary" :disabled="busy" :loading="store.saving.value" @click="confirmImport">确认导入谱文</Button>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.markdown-manager { min-width: 0; }
.markdown-description { color: #667085; line-height: 1.7; }
.markdown-filename { white-space: normal; overflow-wrap: anywhere; }
.markdown-file-input { display: none; }
.markdown-section { margin-top: 16px; }
.markdown-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
</style>
