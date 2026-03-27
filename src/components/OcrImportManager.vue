<script setup lang="ts">
import { computed, ref } from 'vue'
import { compressImage, toObjectUrl } from '../services/imageService'
import { parseTempMembersFromText } from '../services/ocrParserService'
import { recognizeTextFromImage } from '../services/ocrService'
import { detectOcrDuplicates } from '../services/dedupeService'
import type { Member } from '../types/member'
import type { DuplicateAction, OcrDuplicateCandidate, TempMember } from '../types/ocr'

const props = defineProps<{
  members: Member[]
}>()

const emit = defineEmits<{
  importMembers: [payload: { members: TempMember[]; duplicateAction: DuplicateAction }]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isRecognizing = ref(false)
const ocrError = ref('')
const previewUrl = ref('')
const rawText = ref('')
const tempMembers = ref<TempMember[]>([])
const duplicateAction = ref<DuplicateAction>('skip')

let compressedBlob: Blob | null = null

const duplicates = computed<OcrDuplicateCandidate[]>(() => {
  return detectOcrDuplicates(tempMembers.value, props.members)
})

function openFileDialog() {
  fileInputRef.value?.click()
}

function createEmptyTempMember(): TempMember {
  return {
    tempId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    fatherName: '',
    motherName: '',
    spouseName: '',
    birthYear: '',
    deathYear: '',
    gender: '男',
    rawText: '',
  }
}

function addRow() {
  tempMembers.value.push(createEmptyTempMember())
}

function removeRow(tempId: string) {
  tempMembers.value = tempMembers.value.filter((row) => row.tempId !== tempId)
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  ocrError.value = ''
  rawText.value = ''
  tempMembers.value = []

  try {
    compressedBlob = await compressImage(file, 2000, 0.86)
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
    }
    previewUrl.value = toObjectUrl(compressedBlob)
  } catch (error) {
    compressedBlob = null
    ocrError.value = error instanceof Error ? error.message : '图片预处理失败'
  }

  input.value = ''
}

async function runOcr() {
  if (!compressedBlob) {
    ocrError.value = '请先上传图片'
    return
  }

  isRecognizing.value = true
  ocrError.value = ''

  try {
    rawText.value = await recognizeTextFromImage(compressedBlob)
    tempMembers.value = parseTempMembersFromText(rawText.value)
    if (tempMembers.value.length === 0) {
      ocrError.value = '未识别到可解析成员，请调整图片后重试'
    }
  } catch (error) {
    ocrError.value = error instanceof Error ? error.message : 'OCR 识别失败'
  } finally {
    isRecognizing.value = false
  }
}

function importRecognizedMembers() {
  emit('importMembers', {
    members: tempMembers.value,
    duplicateAction: duplicateAction.value,
  })
}
</script>

<template>
  <section class="panel-block ocr-block">
    <h3>族谱照片 OCR 导入</h3>

    <div class="btn-row">
      <button type="button" class="btn-ghost" @click="openFileDialog">上传族谱照片</button>
      <button type="button" class="btn-primary" :disabled="isRecognizing" @click="runOcr">
        {{ isRecognizing ? '识别中...' : '开始 OCR 识别' }}
      </button>
    </div>

    <input
      ref="fileInputRef"
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg,image/heic,image/*"
      capture="environment"
      @change="handleFileChange"
    />

    <p v-if="ocrError" class="ocr-error">{{ ocrError }}</p>

    <div v-if="previewUrl" class="ocr-preview">
      <img :src="previewUrl" alt="OCR 图片预览" />
    </div>

    <div v-if="tempMembers.length > 0" class="ocr-edit">
      <div class="ocr-tools">
        <label>
          重复处理：
          <select v-model="duplicateAction">
            <option value="skip">跳过重复成员</option>
            <option value="create">仍然新建</option>
          </select>
        </label>
        <button type="button" class="btn-ghost" @click="addRow">添加行</button>
      </div>

      <table class="ocr-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>父亲</th>
            <th>母亲</th>
            <th>配偶</th>
            <th>性别</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tempMembers" :key="row.tempId">
            <td><input v-model="row.name" type="text" /></td>
            <td><input v-model="row.fatherName" type="text" /></td>
            <td><input v-model="row.motherName" type="text" /></td>
            <td><input v-model="row.spouseName" type="text" /></td>
            <td>
              <select v-model="row.gender">
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </td>
            <td><button type="button" class="btn-danger" @click="removeRow(row.tempId)">删除</button></td>
          </tr>
        </tbody>
      </table>

      <p class="search-meta">疑似重复：{{ duplicates.length }} 条</p>
      <ul v-if="duplicates.length > 0" class="ocr-duplicate-list">
        <li v-for="dup in duplicates" :key="`${dup.tempId}-${dup.existingId}`">
          {{ dup.tempName }} -> 已存在 #{{ dup.existingId }}（{{ dup.reason }}）
        </li>
      </ul>

      <button type="button" class="btn-primary" @click="importRecognizedMembers">导入识别结果</button>
    </div>
  </section>
</template>
