<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyData } from '../../types/member'

import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report?: PartDataImportReport; rawText: string }>()

const sampleLines = computed(() => {
  const lines = props.rawText.split(/\r?\n/)
  const result: Array<{ line: string; matchedName: string | null }> = []
  for (const line of lines) {
    if (result.length >= 20) break
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const member = props.data.members.find((m) => m.biography === trimmed)
    result.push({ line: trimmed, matchedName: member ? member.name : null })
  }
  return result
})
</script>

<template>
  <details class="line-sample-block">
    <summary class="section-title">📝 行解析样本（前 20 行）</summary>
    <div class="sample-list">
      <div v-for="(item, idx) in sampleLines" :key="idx" class="sample-item">
        <div class="original">原文：{{ item.line }}</div>
        <div class="parsed" :class="{ skipped: !item.matchedName }">
          → 解析为成员: {{ item.matchedName ?? '（跳过）' }}
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.line-sample-block { border: 1px solid #ddd; border-radius: 6px; padding: 10px; margin-bottom: 12px; background: #fff; }
.section-title { font-weight: bold; cursor: pointer; color: #2d5e2c; }
.sample-list { margin-top: 8px; font-size: 0.82rem; font-family: monospace; }
.sample-item { margin-bottom: 6px; padding: 4px 8px; background: #f9f9f9; border-radius: 4px; }
.original { color: #333; }
.parsed { color: #2d5e2c; }
.parsed.skipped { color: #aaa; font-style: italic; }
</style>
