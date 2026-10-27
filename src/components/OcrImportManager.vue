<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Alert, Button, Card, Collapse, Form, Image, Input, Modal, Select, Space, Table, Tag, message, type TableProps } from 'ant-design-vue'
import { PlusOutlined, ScanOutlined, UploadOutlined } from '@ant-design/icons-vue'
import { compressImage, toObjectUrl } from '../services/imageService'
import { parseTempMembersFromText } from '../services/ocrParserService'
import { recognizeTextFromImage } from '../services/ocrService'
import { detectOcrDuplicates } from '../services/dedupeService'
import { useAuth } from '../services/authService'
import { useFamilyStore } from '../stores/familyStore'
import type { Member } from '../types/member'
import type { DuplicateAction, TempMember } from '../types/ocr'

const props = defineProps<{ members: Member[] }>()
const store = useFamilyStore()
const { canMaintain } = useAuth()
const fileInput = ref<HTMLInputElement | null>(null)
const preparing = ref(false)
const recognizing = ref(false)
const error = ref('')
const previewUrl = ref('')
const filename = ref('')
const rawText = ref('')
const tempMembers = ref<TempMember[]>([])
const duplicateAction = ref<DuplicateAction>('skip')
const busy = computed(() => preparing.value || recognizing.value || store.saving.value)
const duplicates = computed(() => detectOcrDuplicates(tempMembers.value, props.members))
const validRows = computed(() => tempMembers.value.length > 0 && tempMembers.value.every(row => row.name.trim()))
const columns: TableProps<TempMember>['columns'] = [
  { title: '姓名', key: 'name', width: 150 },
  { title: '父亲', key: 'fatherName', width: 150 },
  { title: '母亲（预览）', key: 'motherName', width: 150 },
  { title: '配偶', key: 'spouseName', width: 150 },
  { title: '性别', key: 'gender', width: 100 },
  { title: '生年（预览）', dataIndex: 'birthYear', width: 120 },
  { title: '卒年（预览）', dataIndex: 'deathYear', width: 120 },
  { title: '操作', key: 'actions', width: 80 },
]
let compressedBlob: Blob | null = null
let active = true
onBeforeUnmount(() => {
  active = false
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

async function selectImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value || !canMaintain.value) return
  preparing.value = true
  error.value = ''
  try {
    const blob = await compressImage(file, 2000, 0.86)
    if (!active) return
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    compressedBlob = blob
    previewUrl.value = toObjectUrl(blob)
    filename.value = file.name
    rawText.value = ''
    tempMembers.value = []
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片预处理失败'
  } finally {
    preparing.value = false
    input.value = ''
  }
}

function parseText() {
  tempMembers.value = parseTempMembersFromText(rawText.value)
  error.value = tempMembers.value.length ? '' : '未识别到可解析成员，请补充文字或手动添加预览行'
}
function reparse() {
  if (busy.value || !canMaintain.value) return
  if (!tempMembers.value.length) { parseText(); return }
  Modal.confirm({
    title: '重新解析文字？', content: '将替换当前预览行中的人工修改，云端数据不会改变。',
    okText: '重新解析', cancelText: '取消', onOk: parseText,
  })
}
async function recognize() {
  if (!compressedBlob || busy.value || !canMaintain.value) return
  recognizing.value = true
  error.value = ''
  try {
    const text = await recognizeTextFromImage(compressedBlob)
    if (!active) return
    rawText.value = text
    parseText()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'OCR 识别失败'
  } finally {
    recognizing.value = false
  }
}
function startOcr() {
  if (busy.value || !canMaintain.value) return
  if (!tempMembers.value.length) { void recognize(); return }
  Modal.confirm({
    title: '重新识别图片？', content: '识别成功后将替换当前文字与预览，请先保存人工核对结果。',
    okText: '重新识别', cancelText: '取消', onOk: recognize,
  })
}
function addRow() {
  tempMembers.value.push({
    tempId: crypto.randomUUID(), name: '', fatherName: '', motherName: '', spouseName: '',
    birthYear: '', deathYear: '', gender: '男', rawText: '',
  })
}
function editRow(id: string, field: unknown, value: string) {
  if (field !== 'name' && field !== 'fatherName' && field !== 'motherName' && field !== 'spouseName') {
    throw new Error('不支持的 OCR 预览字段')
  }
  const row = tempMembers.value.find(item => item.tempId === id)
  if (row) row[field] = value
}
function setGender(id: string, value: unknown) {
  const row = tempMembers.value.find(item => item.tempId === id)
  if (row && (value === '男' || value === '女')) row.gender = value
}
function confirmImport() {
  if (!canMaintain.value || busy.value || !validRows.value) return
  Modal.confirm({
    title: `导入 ${tempMembers.value.length} 行识别结果？`,
    content: 'OCR 仍使用现有实验解析规则，同名处理和母系、生卒信息映射尚未完善。请人工核对并先导出完整备份，云端确认后才算保存成功。',
    okText: '确认导入', cancelText: '取消',
    async onOk() {
      const result = await store.importOcrMembers(tempMembers.value.map(row => ({ ...row })), { duplicateAction: duplicateAction.value })
      if (!result.ok) {
        error.value = result.message ?? 'OCR 导入失败'
        message.error(error.value)
        throw new Error(error.value)
      }
      tempMembers.value = []
      message.success(result.message ?? '识别结果已保存到云端')
    },
  })
}
</script>

<template>
  <Card v-if="canMaintain" title="照片 OCR 与文字核对" :bordered="false" class="ocr-manager">
    <Alert type="warning" show-icon message="实验功能：请先核对，再导入" description="本阶段仅迁移操作界面，未修复 OCR 同名处理及母系、生卒映射。母亲、生年和卒年目前仅供预览，不能视为已写入档案。请保留原始资料。" />
    <Space wrap class="ocr-toolbar">
      <Button :disabled="busy" :loading="preparing" @click="fileInput?.click()"><template #icon><UploadOutlined /></template>上传族谱照片</Button>
      <Button :disabled="busy || !previewUrl" :loading="recognizing" @click="startOcr"><template #icon><ScanOutlined /></template>开始 OCR 识别</Button>
      <span class="ocr-filename">{{ filename }}</span>
    </Space>
    <input ref="fileInput" class="ocr-file-input" type="file" accept="image/png,image/jpeg,image/heic,image/*" capture="environment" :disabled="busy" @change="selectImage" />
    <Alert v-if="error" type="error" show-icon :message="error" class="ocr-section" />
    <Image v-if="previewUrl" :src="previewUrl" :width="180" alt="OCR 图片预览" class="ocr-section" />
    <Form layout="vertical" class="ocr-section">
      <Form.Item label="识别原文 / 待核对文字">
        <Input.TextArea v-model:value="rawText" :disabled="busy" :rows="5" placeholder="上传图片后识别，或粘贴谱文进行预览；解析不会自动写入云端。" />
      </Form.Item>
      <Button :disabled="busy || !rawText.trim()" @click="reparse">解析文字为预览</Button>
    </Form>
    <div class="ocr-toolbar">
      <Space wrap>
        <Tag color="blue">{{ tempMembers.length }} 行预览</Tag>
        <Select v-model:value="duplicateAction" :disabled="busy" aria-label="重复处理" :options="[{label:'跳过疑似重复',value:'skip'},{label:'仍然新建（现有实验规则）',value:'create'}]" style="width:230px" />
        <Button :disabled="busy" @click="addRow"><template #icon><PlusOutlined /></template>添加预览行</Button>
      </Space>
      <Button type="primary" :disabled="busy || !validRows" :loading="store.saving.value" @click="confirmImport">导入核对结果</Button>
    </div>
    <Table :columns="columns" :data-source="tempMembers" row-key="tempId" :scroll="{x:1120}" :pagination="{pageSize:10,showTotal:(total:number)=>`共 ${total} 行`}">
      <template #bodyCell="{column,record}">
        <Input v-if="column.key === 'name' || column.key === 'fatherName' || column.key === 'motherName' || column.key === 'spouseName'" :value="record[column.key]" :disabled="busy" :aria-label="`${column.title} ${record.tempId}`" @update:value="value=>editRow(record.tempId,column.key,value)" />
        <Select v-else-if="column.key === 'gender'" :value="record.gender" :disabled="busy" :options="[{label:'男',value:'男'},{label:'女',value:'女'}]" @change="value=>setGender(record.tempId,value)" />
        <Button v-else-if="column.key === 'actions'" type="link" danger :disabled="busy" @click="tempMembers=tempMembers.filter(row=>row.tempId!==record.tempId)">删除</Button>
      </template>
    </Table>
    <Collapse v-if="duplicates.length" class="ocr-section">
      <Collapse.Panel key="duplicates" :header="`疑似重复 ${duplicates.length} 条`">
        <p v-for="item in duplicates" :key="`${item.tempId}-${item.existingId}`">{{ item.tempName }} → {{ item.existingName }} #{{ item.existingId }}（{{ item.reason }}）</p>
      </Collapse.Panel>
    </Collapse>
  </Card>
</template>

<style scoped>
.ocr-manager { min-width: 0; }
.ocr-toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.ocr-filename { color: #667085; overflow-wrap: anywhere; }
.ocr-file-input { display: none; }
.ocr-section { margin-top: 16px; }
</style>
