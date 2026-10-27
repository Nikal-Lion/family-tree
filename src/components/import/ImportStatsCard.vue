<script setup lang="ts">
import { computed } from 'vue'
import { Statistic } from 'ant-design-vue'
import type { FamilyData } from '../../types/member'
import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report: PartDataImportReport }>()
const cards = computed(() => [
  { label: '主成员', value: props.data.members.length, issue: false },
  { label: '配偶记录', value: props.data.spouses.length, issue: false },
  { label: '子女声明', value: props.data.childClaims.length, issue: false },
  { label: '孤立成员', value: props.report.isolatedMembers.length, issue: true },
  { label: '待关联子女声明', value: props.report.unmatchedClaims.length, issue: true },
  { label: '待消歧', value: props.report.ambiguousAdoptions.length, issue: true },
  { label: '解析复核提示', value: props.report.parsingNotes.length, issue: true },
])
</script>

<template>
  <div class="import-statistics">
    <Statistic v-for="card in cards" :key="card.label" :title="card.label" :value="card.value" :value-style="{color:card.issue && card.value>0?'#d97706':'#4f46e5'}" />
  </div>
</template>

<style scoped>
.import-statistics { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 16px; padding: 16px; background: #f8f9fc; border-radius: 8px; }
</style>
