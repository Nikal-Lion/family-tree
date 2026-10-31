<script setup lang="ts">
import { computed } from 'vue'
import { Button, Card, Empty, Image, Space, Tag } from 'ant-design-vue'
import ProfileFields from './ProfileFields.vue'
import { computeGenerations } from '../services/generationService'
import { childClaimAdoptionLabel } from '../services/childClaimService'
import type { FamilyBrowseData, KinshipRelation, Member, NameAliasType } from '../types/member'

const props = defineProps<{ member: Member | null; data: FamilyBrowseData }>()
defineEmits<{ select: [id: number]; 'view-tree': [id: number] }>()
const id = computed(() => props.member?.id)
const generations = computed(() => computeGenerations(props.data.members))
const children = computed(() => props.data.members.filter((item) => item.parentId === id.value))
const spouses = computed(() => props.data.spouses.filter((item) => item.husbandId === id.value).toSorted((a, b) => a.order - b.order))
const claims = computed(() => props.data.childClaims.filter((item) => item.parentId === id.value).toSorted((a, b) => a.ordinalIndex - b.ordinalIndex))
const aliases = computed(() => props.data.aliases.filter((item) => item.memberId === id.value))
const relations = computed(() => props.data.relations.filter((item) => item.fromMemberId === id.value || item.toMemberId === id.value))
const temporals = computed(() => props.data.temporals.filter((item) => item.memberId === id.value))
const burials = computed(() => props.data.burials.filter((item) => item.memberId === id.value))
const membersById = computed(() => new Map(props.data.members.map((item) => [item.id, item])))
const nameCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of props.data.members) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  return counts
})
const relationLabels: Record<string, string> = {
  father: '生父', mother: '母亲', spouse: '配偶', 'step-parent': '继亲',
  'adoptive-parent': '养亲 / 承继父', 'adopted-child': '养子女', successor: '承继', other: '其他',
}
const aliasLabels: Record<NameAliasType, string> = {
  primary: '本名', given: '名', courtesy: '字', art: '号', taboo: '讳', alias: '别名', other: '其他称呼',
}
const relationStatusLabels = { active: '有效记录', ended: '已结束的关系记录', uncertain: '关系尚待核验' }
const flagLabels = { missing: '信息缺失', estimated: '推定信息', conflicting: '信息冲突', unverified: '待核验' }
const claimLabels = { 'no-grandchildren': '无后', unmarried: '未婚', 'out-married': '往外 / 出嫁', 'lost-record': '失考' }
const spouseLabels = { 'early-deceased': '早殁', 'lost-record': '失考', 'out-married': '往外 / 出嫁' }
function nameOf(memberId: number) {
  const person = membersById.value.get(memberId)
  if (!person) return `档案暂不可用（记录编号 ${memberId}）`
  if ((nameCounts.value.get(person.name) ?? 0) < 2) return person.name
  const context = [
    person.parentId === null ? '暂未记录生父' : `生父：${membersById.value.get(person.parentId)?.name ?? '档案暂不可用'}`,
    person.lineageBranch,
    person.generationNumber ? `族谱记载：第 ${person.generationNumber} 代` : person.generationLabelRaw,
  ].filter(Boolean).join(' · ')
  return `${person.name}（${context}；记录编号 ${person.id}）`
}
function relationDescription(relation: KinshipRelation) {
  if (['father', 'mother', 'adoptive-parent', 'step-parent'].includes(relation.type)) {
    return `的${relationLabels[relation.type]}记载：`
  }
  return `与以下族人有${relationLabels[relation.type]}关系记载：`
}
function fatherRecordStatus(child: Member) {
  const records = props.data.relations.filter((relation) => relation.type === 'father'
    && relation.fromMemberId === child.id && relation.toMemberId === child.parentId)
  if (records.some((relation) => relation.status === 'uncertain')) return '生父关系尚待核验'
  if (records.some((relation) => relation.status === 'ended')) return '含已结束的生父关系记录，需核对'
  return ''
}
</script>

<template>
  <Empty v-if="!member" description="选择一位族人查看档案" />
  <Space v-else :key="member.id" direction="vertical" :size="16" class="member-archive">
    <Space wrap>
      <strong class="archive-name">{{ member.name }}</strong><Tag>{{ member.gender }}</Tag>
      <Tag v-for="flag in member.uncertaintyFlags" :key="flag" color="orange">{{ flagLabels[flag] }}</Tag>
    </Space>
    <p v-if="(nameCounts.get(member.name) ?? 0) > 1" class="archive-note">族谱中有同名人物，请结合生父、分支和族谱代数区分；同名不代表同一人。</p>
    <Button class="archive-tree-action" @click="$emit('view-tree', member.id)">在族谱中查看</Button>
    <Image v-if="member.photoUrl" :src="member.photoUrl" :width="120" :alt="member.name" />
    <ProfileFields :fields="[
      { label: '族谱代数', value: member.generationNumber ? `族谱记载：第 ${member.generationNumber} 代` : member.generationLabelRaw || '暂未记录' },
      { label: '分支', value: member.lineageBranch || '未记录' },
      { label: '出生日期', value: member.birthDate || '未记录' },
      { label: '生平', value: member.biography || '未记录' },
      ...(aliases.length ? [{ label: '姓名与称呼', value: aliases.map(alias => `${aliasLabels[alias.type]}：${alias.name}`).join('\n') }] : []),
    ]" />
    <Card title="生父记载" size="small">
      <Button v-if="member.parentId !== null && membersById.has(member.parentId)" type="link" @click="$emit('select', member.parentId)">{{ nameOf(member.parentId) }}</Button>
      <span v-else-if="member.parentId !== null">{{ nameOf(member.parentId) }}</span>
      <span v-else>暂未记录生父</span>
      <Tag v-if="fatherRecordStatus(member)" color="orange">{{ fatherRecordStatus(member) }}</Tag>
      <p class="archive-note">此处展示已关联的生父档案；养亲、承继及其他关系另列，不替代生父记载。资料中的推定、冲突或待核验标记仍需一并参考。</p>
    </Card>
    <Card title="配偶记录" size="small">
      <Empty v-if="!spouses.length" :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无配偶记录" />
      <p v-else class="archive-note">以下为文字记载，不代表已关联到独立人物档案。</p>
      <section v-for="spouse in spouses" :key="spouse.id" class="archive-entry">
        <strong>{{ spouse.relationLabel }} {{ spouse.fullName || (spouse.surname.endsWith('氏') ? spouse.surname : `${spouse.surname}氏`) }}</strong>
        <Tag v-for="flag in spouse.statusFlags" :key="flag">{{ spouseLabels[flag] }}</Tag>
        <p v-if="spouse.aliases.length">别名：{{ spouse.aliases.join('、') }}</p>
        <p>{{ [spouse.birthDate && `生：${spouse.birthDate}`, spouse.deathDate && `卒：${spouse.deathDate}`, spouse.burialPlace, spouse.biography].filter(Boolean).join('；') || '暂无补充记载' }}</p>
      </section>
    </Card>
    <Card title="已关联档案的子女" size="small">
      <Space v-if="children.length" wrap>
        <span v-for="child in children" :key="child.id">
          <Button @click="$emit('select', child.id)">{{ nameOf(child.id) }}</Button>
          <Tag v-if="fatherRecordStatus(child)" color="orange">{{ fatherRecordStatus(child) }}</Tag>
        </span>
      </Space>
      <span v-else class="archive-note">暂无已建立生父关系的子女档案，不等于没有子女。</span>
      <p v-if="children.length" class="archive-note">此处按已建立的生父关系列出；原谱文字与过继、承嗣记载请见下方。</p>
    </Card>
    <Card title="原谱中的子女记载" size="small">
      <p class="archive-note">原谱中的记载与已建立的档案关联分开展示；尚待确认的记录不作已确认关系。</p>
      <p v-if="!claims.length" class="archive-note">暂未记录子女原文，不代表没有子女。</p>
      <section v-for="claim in claims" :key="claim.id" class="archive-entry">
        <Tag :color="claim.status === 'matched' ? 'blue' : 'orange'">{{ claim.status === 'matched' ? '已关联档案' : claim.status === 'ambiguous' ? '有同名记录，尚待确认' : '尚未关联档案' }}</Tag>
        {{ claim.ordinalIndex }}. {{ claim.claimedName }}
        <Tag v-if="claim.gender !== 'unknown'">{{ claim.gender }}</Tag>
        <Tag v-if="claim.isAdoptive">{{ childClaimAdoptionLabel({ relations: data.relations }, claim) }}</Tag>
        <Tag v-for="flag in claim.statusFlags" :key="flag">{{ claimLabels[flag] }}</Tag>
        <Button v-if="claim.resolvedMemberId !== null && membersById.has(claim.resolvedMemberId)" type="link" @click="$emit('select', claim.resolvedMemberId)">{{ claim.status === 'matched' ? '查看档案：' : '查看待确认档案：' }}{{ nameOf(claim.resolvedMemberId) }}</Button>
        <span v-else-if="claim.resolvedMemberId !== null">{{ nameOf(claim.resolvedMemberId) }}</span>
        <Tag v-if="claim.resolvedMemberId !== null && membersById.has(claim.resolvedMemberId) && membersById.get(claim.resolvedMemberId)?.name !== claim.claimedName" color="blue">异名关联 · 保留原字</Tag>
        <p v-if="claim.outAdoptedToHint" class="archive-note">出继线索：{{ claim.outAdoptedToHint }}</p>
      </section>
    </Card>
    <Card title="承继、养亲及其他关系记载" size="small">
      <p v-if="!relations.length" class="archive-note">暂无补充关系记载。</p>
      <section v-for="relation in relations" :key="relation.id" class="archive-entry">
        <Tag :color="relation.status === 'uncertain' ? 'orange' : undefined">{{ relationStatusLabels[relation.status] }}</Tag>
        <p>
          <Button v-if="membersById.has(relation.fromMemberId)" type="link" @click="$emit('select', relation.fromMemberId)">{{ nameOf(relation.fromMemberId) }}</Button>
          <span v-else>{{ nameOf(relation.fromMemberId) }}</span>
          {{ relationDescription(relation) }}
          <Button v-if="membersById.has(relation.toMemberId)" type="link" @click="$emit('select', relation.toMemberId)">{{ nameOf(relation.toMemberId) }}</Button>
          <span v-else>{{ nameOf(relation.toMemberId) }}</span>
        </p>
        <p v-if="relation.note" class="archive-note">{{ relation.note }}</p>
      </section>
    </Card>
    <details class="archive-evidence">
      <summary>查看原始记录与详细资料</summary>
      <p class="archive-note">原文、整理备注及技术编号保留在此，供核对；记载不完整或有疑义时，请以待核验状态理解。</p>
      <ProfileFields :fields="[
        { label: '档案编号', value: member.id },
        { label: '世代原文', value: member.generationLabelRaw || '未记录' },
        { label: '相对树层级', value: `${generations.get(member.id) ?? '未确定'}（仅用于图谱布局，不是谱载代数）` },
        { label: '谱文备注', value: member.rawNotes || '未记录' },
      ]" />
      <section v-for="spouse in spouses" :key="`spouse-${spouse.id}`" class="archive-entry">
        <h4>配偶原文 · {{ spouse.fullName || spouse.surname }}（记录编号 {{ spouse.id }}）</h4>
        <p>{{ spouse.rawText || '未记录原文' }}</p>
      </section>
      <section v-for="claim in claims" :key="`claim-${claim.id}`" class="archive-entry">
        <h4>子女原文 · {{ claim.ordinalIndex }}. {{ claim.claimedName }}（记录编号 {{ claim.id }}）</h4>
        <p>{{ claim.rawText || '未记录原文' }}</p>
        <p class="archive-note">关联档案编号：{{ claim.resolvedMemberId ?? '未关联' }}；性别：{{ claim.gender === 'unknown' ? '未记录' : claim.gender }}</p>
      </section>
      <section v-for="alias in aliases" :key="`alias-${alias.id}`" class="archive-entry">
        <h4>{{ aliasLabels[alias.type] }}：{{ alias.name }}<Tag v-if="alias.isPreferred">优先显示的姓名</Tag></h4>
        <p>{{ alias.note }} {{ alias.rawText }}</p>
      </section>
      <section v-for="relation in relations" :key="`relation-${relation.id}`" class="archive-entry">
        <h4>{{ relationLabels[relation.type] }} · {{ relationStatusLabels[relation.status] }}</h4>
        <p>{{ nameOf(relation.fromMemberId) }} → {{ nameOf(relation.toMemberId) }}</p>
        <p class="archive-note">档案编号：{{ relation.fromMemberId }} → {{ relation.toMemberId }}</p>
        <p>{{ relation.note }} {{ relation.rawText }}</p>
      </section>
      <p v-for="temporal in temporals" :key="`time-${temporal.id}`"><Tag>纪年</Tag>{{ temporal.label }}：{{ temporal.rawText }} {{ temporal.normalizedDate }}</p>
      <p v-for="burial in burials" :key="`burial-${burial.id}`"><Tag>葬地</Tag>{{ [burial.placeRaw, burial.mountainDirection, burial.fenjin, burial.note, burial.rawText].filter(Boolean).join('；') }}</p>
    </details>
  </Space>
</template>

<style scoped>
.member-archive { width: 100%; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.member-archive :deep(.ant-space-item) { min-width: 0; max-width: 100%; }
.member-archive :deep(.ant-btn) { height: auto; min-height: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.member-archive :deep(.ant-tag) { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.archive-name { font-size: 20px; }
.archive-evidence { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
.archive-evidence summary { cursor: pointer; font-weight: 600; min-height: 44px; align-content: center; }
.archive-evidence summary:focus-visible { outline: 2px solid #4f46e5; outline-offset: 4px; }
.archive-evidence h4 { margin: 12px 0 8px; }
.archive-note { color: #64748b; font-size: 12px; line-height: 1.8; margin: 8px 0; }
.archive-entry + .archive-entry { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
.archive-entry p { margin: 8px 0 0; }
</style>
