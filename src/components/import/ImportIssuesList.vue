<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Alert, Collapse, Pagination } from 'ant-design-vue'
import type { FamilyData } from '../../types/member'
import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report: PartDataImportReport }>()
const totalIssues = computed(() => props.report.isolatedMembers.length + props.report.unmatchedClaims.length
  + props.report.ambiguousAdoptions.length + props.report.contradictions.length + props.report.parsingNotes.length)
const unmatchedPage = ref(1)
const notesPage = ref(1)
const pageSize = 20
const unmatched = computed(() => props.report.unmatchedClaims.slice((unmatchedPage.value - 1) * pageSize, unmatchedPage.value * pageSize))
const notes = computed(() => props.report.parsingNotes.slice((notesPage.value - 1) * pageSize, notesPage.value * pageSize))
watch(() => props.report, () => { unmatchedPage.value = 1; notesPage.value = 1 })
</script>

<template>
  <Alert v-if="!totalIssues" type="success" show-icon message="本次预览未检出结构问题；仍需人工核对原文。" />
  <template v-else>
    <Alert type="warning" show-icon :message="`发现 ${totalIssues} 项待核对信息`" />
    <Collapse class="import-issues" :default-active-key="['notes','isolated','unmatched']">
      <Collapse.Panel v-if="report.parsingNotes.length" key="notes" :header="`解析复核提示（${report.parsingNotes.length}）`">
        <p v-for="(item,index) in notes" :key="index"><strong>第 {{ item.lineNumber }} 行 · {{ item.parentName }} #{{ item.parentId }}</strong><br />{{ item.reason }}<br /><span class="issue-source">原文片段：{{ item.segment }}</span></p>
        <Pagination v-if="report.parsingNotes.length>pageSize" v-model:current="notesPage" :total="report.parsingNotes.length" :page-size="pageSize" :show-size-changer="false" simple />
      </Collapse.Panel>
      <Collapse.Panel v-if="report.isolatedMembers.length" key="isolated" :header="`孤立成员（${report.isolatedMembers.length}）`">
        <p v-for="item in report.isolatedMembers" :key="item.id">{{ item.name }} #{{ item.id }}：{{ item.reason }}</p>
      </Collapse.Panel>
      <Collapse.Panel v-if="report.unmatchedClaims.length" key="unmatched" :header="`尚未关联人物档案的子女声明（${report.unmatchedClaims.length}）`">
        <p class="issue-source">原文记载了这些子女，但暂未找到可可靠关联的人物档案；不代表子女不存在或原文有误。姓名、顺序、状态和原文仍保留，暂不据此建立人物连线。</p>
        <p v-for="(item,index) in unmatched" :key="index">{{ item.parentName }} → {{ item.claimedName }}（谱载第 {{ item.gen }} 代）</p>
        <Pagination v-if="report.unmatchedClaims.length>pageSize" v-model:current="unmatchedPage" :total="report.unmatchedClaims.length" :page-size="pageSize" :show-size-changer="false" simple />
      </Collapse.Panel>
      <Collapse.Panel v-if="report.ambiguousAdoptions.length" key="ambiguous" :header="`待消歧声明（${report.ambiguousAdoptions.length}）`">
        <p v-for="(item,index) in report.ambiguousAdoptions" :key="index">{{ item.name }}：{{ item.note }}</p>
      </Collapse.Panel>
      <Collapse.Panel v-if="report.contradictions.length" key="contradictions" :header="`数据矛盾（${report.contradictions.length}）`">
        <p v-for="(item,index) in report.contradictions" :key="index">{{ item.description }}</p>
      </Collapse.Panel>
    </Collapse>
  </template>
  <p class="issue-source">以上仅为匹配结果和解析复核提示，不代表已完成历史事实或全部数据矛盾检查。孤立、待关联不等于原文错误，同音异字请人工核对。</p>
</template>

<style scoped>
.import-issues { margin-top: 16px; }
.import-issues p { overflow-wrap: anywhere; }
.issue-source { color: #64748b; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
</style>
