<script setup lang="ts">
import { computed } from 'vue'
import { Button, Card, Descriptions, Empty, Image, Space, Tag } from 'ant-design-vue'
import { useFamilyStore } from '../stores/familyStore'
import { computeGenerations } from '../services/generationService'
import { childClaimAdoptionLabel } from '../services/childClaimService'
import type { Member } from '../types/member'

const props = defineProps<{ member: Member | null }>()
defineEmits<{ select: [id: number] }>()
const store = useFamilyStore()
const id = computed(() => props.member?.id)
const generations = computed(() => computeGenerations(store.members.value))
const children = computed(() => store.members.value.filter((item) => item.parentId === id.value))
const spouses = computed(() => store.spouses.value.filter((item) => item.husbandId === id.value).toSorted((a, b) => a.order - b.order))
const claims = computed(() => store.childClaims.value.filter((item) => item.parentId === id.value).toSorted((a, b) => a.ordinalIndex - b.ordinalIndex))
const aliases = computed(() => store.aliases.value.filter((item) => item.memberId === id.value))
const relations = computed(() => store.relations.value.filter((item) => item.fromMemberId === id.value || item.toMemberId === id.value))
const temporals = computed(() => store.temporals.value.filter((item) => item.memberId === id.value))
const burials = computed(() => store.burials.value.filter((item) => item.memberId === id.value))
const relationLabels: Record<string, string> = {
  father: '父系', mother: '母系', spouse: '配偶', 'step-parent': '继亲',
  'adoptive-parent': '养亲 / 承继父', 'adopted-child': '养子女', successor: '承继', other: '其他',
}
const flagLabels = { missing: '信息缺失', estimated: '推定信息', conflicting: '信息冲突', unverified: '待核验' }
const claimLabels = { 'no-grandchildren': '无后', unmarried: '未婚', 'out-married': '往外 / 出嫁', 'lost-record': '失考' }
const spouseLabels = { 'early-deceased': '早殁', 'lost-record': '失考', 'out-married': '往外 / 出嫁' }
function nameOf(memberId: number) {
  return store.members.value.find((item) => item.id === memberId)?.name ?? `成员 #${memberId}`
}
</script>

<template>
  <Empty v-if="!member" description="选择一位族人查看档案" />
  <Space v-else direction="vertical" :size="16" class="member-archive">
    <Space wrap>
      <Tag color="blue">#{{ member.id }}</Tag><Tag>{{ member.gender }}</Tag>
      <Tag v-for="flag in member.uncertaintyFlags" :key="flag" color="orange">{{ flagLabels[flag] }}</Tag>
    </Space>
    <Image v-if="member.photoUrl" :src="member.photoUrl" :width="120" :alt="member.name" />
    <Descriptions bordered size="small" :column="1">
      <Descriptions.Item label="生父">
        <Button v-if="member.parentId !== null" type="link" @click="$emit('select', member.parentId)">{{ nameOf(member.parentId) }} · #{{ member.parentId }}</Button>
        <span v-else>始祖 / 未录生父（不代表已确认是始祖；承继关系见下方）</span>
      </Descriptions.Item>
      <Descriptions.Item label="谱载代数">{{ member.generationNumber || '未记录' }}</Descriptions.Item>
      <Descriptions.Item label="相对树层级">{{ generations.get(member.id) ?? '未确定' }}</Descriptions.Item>
      <Descriptions.Item label="世代原文">{{ member.generationLabelRaw || '未记录' }}</Descriptions.Item>
      <Descriptions.Item label="分支">{{ member.lineageBranch || '未记录' }}</Descriptions.Item>
      <Descriptions.Item label="出生日期">{{ member.birthDate || '未记录' }}</Descriptions.Item>
      <Descriptions.Item label="生平">{{ member.biography || '未记录' }}</Descriptions.Item>
      <Descriptions.Item label="谱文备注">{{ member.rawNotes || '未记录' }}</Descriptions.Item>
    </Descriptions>
    <Card title="已建立父系关系的子女" size="small">
      <Space v-if="children.length" wrap><Button v-for="child in children" :key="child.id" @click="$emit('select', child.id)">{{ child.name }} · #{{ child.id }}</Button></Space>
      <span v-else class="archive-note">暂无已建立关系的子女，不等于无子女</span>
    </Card>
    <Card title="配偶记录" size="small">
      <Empty v-if="!spouses.length" :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无配偶记录" />
      <section v-for="spouse in spouses" :key="spouse.id" class="archive-entry">
        <strong>{{ spouse.relationLabel }} {{ spouse.fullName || (spouse.surname.endsWith('氏') ? spouse.surname : `${spouse.surname}氏`) }}</strong>
        <Tag v-for="flag in spouse.statusFlags" :key="flag">{{ spouseLabels[flag] }}</Tag>
        <p v-if="spouse.aliases.length">别名：{{ spouse.aliases.join('、') }}</p>
        <p>{{ [spouse.birthDate && `生：${spouse.birthDate}`, spouse.deathDate && `卒：${spouse.deathDate}`, spouse.burialPlace, spouse.biography].filter(Boolean).join('；') || '暂无补充记载' }}</p>
        <p class="archive-note">{{ spouse.rawText }}</p>
      </section>
    </Card>
    <Card title="谱载子女声明（与已建立关系分开展示）" size="small">
      <p v-if="!claims.length" class="archive-note">暂无子女声明</p>
      <section v-for="claim in claims" :key="claim.id" class="archive-entry">
        <Tag :color="claim.status === 'matched' ? 'green' : 'orange'">{{ claim.status === 'matched' ? '已匹配' : claim.status === 'ambiguous' ? '待消歧' : '待关联' }}</Tag>
        {{ claim.ordinalIndex }}. {{ claim.claimedName }}
        <Tag v-if="claim.isAdoptive">{{ childClaimAdoptionLabel({ relations: store.relations.value }, claim) }}</Tag>
        <Tag v-for="flag in claim.statusFlags" :key="flag">{{ claimLabels[flag] }}</Tag>
        <Button v-if="claim.resolvedMemberId !== null" type="link" @click="$emit('select', claim.resolvedMemberId)">查看 {{ nameOf(claim.resolvedMemberId) }} · #{{ claim.resolvedMemberId }}</Button>
        <Tag v-if="claim.resolvedMemberId !== null && nameOf(claim.resolvedMemberId) !== claim.claimedName" color="blue">异名关联 · 保留原字</Tag>
        <p v-if="claim.outAdoptedToHint" class="archive-note">出继线索：{{ claim.outAdoptedToHint }}</p>
        <p class="archive-note">{{ claim.rawText }}</p>
      </section>
    </Card>
    <Card title="别名、关系与谱文证据" size="small">
      <p v-for="alias in aliases" :key="`alias-${alias.id}`"><Tag>别名 · {{ alias.type }}</Tag>{{ alias.name }} {{ alias.note }} {{ alias.rawText }}</p>
      <p v-for="relation in relations" :key="`relation-${relation.id}`">
        <Tag>{{ relationLabels[relation.type] }}</Tag>{{ nameOf(relation.fromMemberId) }} → {{ nameOf(relation.toMemberId) }}
        <span class="archive-note">（{{ relation.status === 'active' ? '有效' : relation.status === 'ended' ? '已结束' : '待核验' }}）{{ relation.note }} {{ relation.rawText }}</span>
      </p>
      <p v-for="temporal in temporals" :key="`time-${temporal.id}`"><Tag>纪年</Tag>{{ temporal.label }}：{{ temporal.rawText }} {{ temporal.normalizedDate }}</p>
      <p v-for="burial in burials" :key="`burial-${burial.id}`"><Tag>葬地</Tag>{{ [burial.placeRaw, burial.mountainDirection, burial.fenjin, burial.note, burial.rawText].filter(Boolean).join('；') }}</p>
      <p v-if="!aliases.length && !relations.length && !temporals.length && !burials.length" class="archive-note">暂无附加资料</p>
    </Card>
  </Space>
</template>

<style scoped>
.member-archive { width: 100%; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.archive-note { color: #64748b; font-size: 12px; line-height: 1.8; margin: 8px 0; }
.archive-entry + .archive-entry { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
.archive-entry p { margin: 8px 0 0; }
.member-archive :deep(.ant-descriptions-item-label) { width: 106px; }
</style>
