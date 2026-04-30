<script setup lang="ts">
import type { FamilyData } from '../../types/member'
import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report: PartDataImportReport }>()

const cards = [
  { label: '主成员', getValue: () => props.data.members.length, isIssue: false },
  { label: '配偶记录', getValue: () => props.data.spouses.length, isIssue: false },
  { label: '子女声明', getValue: () => props.data.childClaims.length, isIssue: false },
  { label: '孤立成员', getValue: () => props.report.isolatedMembers.length, isIssue: true },
  { label: '不匹配', getValue: () => props.report.unmatchedClaims.length, isIssue: true },
  { label: '矛盾', getValue: () => props.report.contradictions.length, isIssue: true },
]
</script>

<template>
  <div class="stats-grid">
    <div
      v-for="card in cards"
      :key="card.label"
      class="stat-card"
      :class="{ issue: card.isIssue && card.getValue() > 0 }"
    >
      <div class="stat-value">{{ card.getValue() }}</div>
      <div class="stat-label">{{ card.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.stat-card {
  flex: 1 1 80px;
  border-top: 3px solid #2d5e2c;
  background: #fff;
  border-radius: 6px;
  padding: 10px 12px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.stat-card.issue { border-top-color: #c0392b; }
.stat-value { font-size: 1.5rem; font-weight: bold; color: #2d5e2c; }
.stat-card.issue .stat-value { color: #c0392b; }
.stat-label { font-size: 0.8rem; color: #666; margin-top: 2px; }
</style>
