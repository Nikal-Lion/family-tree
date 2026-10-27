<script setup lang="ts">
import { computed } from 'vue'
import { Alert, Collapse } from 'ant-design-vue'
import type { FamilyData } from '../../types/member'
import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report: PartDataImportReport }>()
const totalIssues = computed(() => props.report.isolatedMembers.length + props.report.unmatchedClaims.length
  + props.report.ambiguousAdoptions.length + props.report.contradictions.length)
</script>

<template>
  <Alert v-if="!totalIssues" type="success" show-icon message="本次预览未检出结构问题；仍需人工核对原文。" />
  <template v-else>
    <Alert type="warning" show-icon :message="`发现 ${totalIssues} 项待核对信息`" />
    <Collapse class="import-issues" :default-active-key="['isolated','unmatched']">
      <Collapse.Panel v-if="report.isolatedMembers.length" key="isolated" :header="`孤立成员（${report.isolatedMembers.length}）`">
        <p v-for="item in report.isolatedMembers" :key="item.id">{{ item.name }} #{{ item.id }}：{{ item.reason }}</p>
      </Collapse.Panel>
      <Collapse.Panel v-if="report.unmatchedClaims.length" key="unmatched" :header="`不匹配子女声明（${report.unmatchedClaims.length}）`">
        <p v-for="(item,index) in report.unmatchedClaims.slice(0,50)" :key="index">{{ item.parentName }} → {{ item.claimedName }}（谱载第 {{ item.gen }} 代）</p>
        <p v-if="report.unmatchedClaims.length>50">另有 {{ report.unmatchedClaims.length-50 }} 条，当前仅展示前 50 条。</p>
      </Collapse.Panel>
      <Collapse.Panel v-if="report.ambiguousAdoptions.length" key="ambiguous" :header="`同名冲突（${report.ambiguousAdoptions.length}）`">
        <p v-for="(item,index) in report.ambiguousAdoptions" :key="index">{{ item.name }}：{{ item.note }}</p>
      </Collapse.Panel>
      <Collapse.Panel v-if="report.contradictions.length" key="contradictions" :header="`数据矛盾（${report.contradictions.length}）`">
        <p v-for="(item,index) in report.contradictions" :key="index">{{ item.description }}</p>
      </Collapse.Panel>
    </Collapse>
  </template>
</template>

<style scoped>
.import-issues { margin-top: 16px; }
.import-issues p { overflow-wrap: anywhere; }
</style>
