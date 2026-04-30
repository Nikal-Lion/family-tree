<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyData } from '../../types/member'
import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report: PartDataImportReport }>()

const totalIssues = computed(() =>
  props.report.isolatedMembers.length +
  props.report.unmatchedClaims.length +
  props.report.ambiguousAdoptions.length +
  props.report.contradictions.length
)

const truncatedUnmatched = computed(() => props.report.unmatchedClaims.slice(0, 50))
const unmatchedExtra = computed(() => props.report.unmatchedClaims.length - 50)
</script>

<template>
  <details open class="issues-block">
    <summary class="section-title">⚠️ 问题清单 ({{ totalIssues }})</summary>

    <details v-if="report.isolatedMembers.length" class="sub-block">
      <summary>孤立成员 ({{ report.isolatedMembers.length }})</summary>
      <ul>
        <li v-for="m in report.isolatedMembers" :key="m.id">{{ m.name }} (ID:{{ m.id }}, {{ m.reason }})</li>
      </ul>
    </details>

    <details v-if="report.unmatchedClaims.length" class="sub-block">
      <summary>不匹配子女声明 ({{ report.unmatchedClaims.length }})</summary>
      <ul>
        <li v-for="c in truncatedUnmatched" :key="`${c.parentName}-${c.claimedName}`">{{ c.parentName }} → {{ c.claimedName }} (第{{ c.gen }}代)</li>
        <li v-if="unmatchedExtra > 0" class="extra">...还有 {{ unmatchedExtra }} 条</li>
      </ul>
    </details>

    <details v-if="report.ambiguousAdoptions.length" class="sub-block">
      <summary>同名冲突 ({{ report.ambiguousAdoptions.length }})</summary>
      <ul>
        <li v-for="a in report.ambiguousAdoptions" :key="a.memberId">{{ a.name }} — {{ a.note }}</li>
      </ul>
    </details>

    <details v-if="report.contradictions.length" class="sub-block">
      <summary>数据矛盾 ({{ report.contradictions.length }})</summary>
      <ul>
        <li v-for="c in report.contradictions" :key="c.memberId">{{ c.description }}</li>
      </ul>
    </details>

    <p v-if="totalIssues === 0" class="no-issues">无问题 ✅</p>
  </details>
</template>

<style scoped>
.issues-block { border: 1px solid #f0c040; border-radius: 6px; padding: 10px; margin-bottom: 12px; background: #fffdf0; }
.section-title { font-weight: bold; cursor: pointer; color: #8a6000; }
.sub-block { margin-top: 8px; padding-left: 12px; }
.sub-block summary { cursor: pointer; color: #555; font-size: 0.9rem; }
ul { margin: 4px 0 0 16px; padding: 0; font-size: 0.85rem; }
.extra { color: #888; font-style: italic; }
.no-issues { color: #2d5e2c; margin: 6px 0 0; font-size: 0.9rem; }
</style>
