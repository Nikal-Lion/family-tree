<script setup lang="ts">
import { computed } from 'vue'
import type {
  BurialRecord,
  KinshipRelation,
  Member,
  NameAlias,
  TemporalExpression,
} from '../types/member'

const props = defineProps<{
  member: Member | null
  findParentName: (id: number | null) => string
  findSpouseNames: (ids: number[]) => string
  generation: number | null
  aliases: NameAlias[]
  relations: KinshipRelation[]
  temporals: TemporalExpression[]
  burials: BurialRecord[]
  resolveMemberName: (id: number) => string
  readonly?: boolean
}>()

const emit = defineEmits<{
  edit: [id: number]
  remove: [id: number]
  addChild: [parentId: number]
}>()

// TODO Task 14: spouseIds removed from Member — shim until spouse tab is wired
const memberSpouseIds = computed<number[]>(() => (props.member as any)?.spouseIds ?? [])

const relationTypeText: Record<KinshipRelation['type'], string> = {
  father: '父系',
  mother: '母系',
  spouse: '婚配',
  'step-parent': '继亲',
  'adoptive-parent': '收养',
  'adopted-child': '过继',
  successor: '承嗣',
  other: '其他',
}

const aliasTypeText: Record<NameAlias['type'], string> = {
  primary: '主名',
  given: '讳名',
  courtesy: '字',
  art: '号',
  taboo: '避讳名',
  alias: '别名',
  other: '其他',
}

const memberAliases = computed(() => {
  if (!props.member) {
    return [] as NameAlias[]
  }
  return props.aliases.filter((alias) => alias.memberId === props.member?.id)
})

const temporalMap = computed(() => {
  return new Map(props.temporals.map((temporal) => [temporal.id, temporal]))
})

const memberTemporals = computed(() => {
  if (!props.member) {
    return [] as TemporalExpression[]
  }

  const relevantTemporalIds = new Set<number>()
  for (const relation of props.relations) {
    if (relation.temporalId !== null) {
      relevantTemporalIds.add(relation.temporalId)
    }
  }
  for (const burial of props.burials) {
    if (burial.temporalId !== null) {
      relevantTemporalIds.add(burial.temporalId)
    }
  }

  return props.temporals.filter(
    (temporal) => temporal.memberId === props.member?.id || relevantTemporalIds.has(temporal.id),
  )
})

function getTemporalText(temporalId: number | null): string {
  if (temporalId === null) {
    return '未标注时间'
  }
  const temporal = temporalMap.value.get(temporalId)
  if (!temporal) {
    return `时间#${temporalId}`
  }
  if (temporal.normalizedDate) {
    return `${temporal.label}：${temporal.normalizedDate}`
  }
  return `${temporal.label}：${temporal.rawText}`
}

function getRelationText(relation: KinshipRelation, memberId: number): string {
  const relationLabel = relationTypeText[relation.type] ?? relation.type
  if (relation.fromMemberId === memberId) {
    return `${relationLabel} -> ${props.resolveMemberName(relation.toMemberId)}`
  }
  return `${relationLabel} <- ${props.resolveMemberName(relation.fromMemberId)}`
}
</script>

<template>
  <section class="panel-block detail-block">
    <h3>成员详情</h3>

    <div v-if="member" class="detail-grid">
      <p><span>姓名</span>{{ member.name }}</p>
      <p><span>性别</span>{{ member.gender }}</p>
      <p><span>ID</span>{{ member.id }}</p>
      <p><span>世代</span>第 {{ generation ?? '?' }} 代</p>
      <p><span>父亲</span>{{ findParentName(member.parentId) }}</p>
      <p><span>配偶</span>{{ findSpouseNames(memberSpouseIds) }}</p>
      <p><span>出生</span>{{ member.birthDate || '未填写' }}</p>
      <p><span>照片</span>{{ member.photoUrl || '未填写' }}</p>
      <p><span>生平</span>{{ member.biography || '未填写' }}</p>
      <p><span>世代原文</span>{{ member.generationLabelRaw || '未填写' }}</p>
      <p><span>分支标记</span>{{ member.lineageBranch || '未填写' }}</p>
      <p><span>谱文备注</span>{{ member.rawNotes || '未填写' }}</p>
      <p><span>不确定标记</span>{{ (member.uncertaintyFlags ?? []).length > 0 ? member.uncertaintyFlags?.join('、') : '无' }}</p>
      <img
        v-if="member.photoUrl"
        class="member-photo"
        :src="member.photoUrl"
        alt="成员照片"
        loading="lazy"
      />
    </div>

    <div v-if="member" class="detail-grid">
      <p><span>别名记录</span>{{ memberAliases.length }}</p>
      <p><span>关系记录</span>{{ relations.length }}</p>
      <p><span>纪年记录</span>{{ memberTemporals.length }}</p>
      <p><span>墓葬记录</span>{{ burials.length }}</p>
    </div>

    <div v-if="member && memberAliases.length > 0" class="detail-section">
      <h4>别名明细</h4>
      <ul>
        <li v-for="alias in memberAliases" :key="alias.id">
          {{ alias.name }}（{{ aliasTypeText[alias.type] ?? alias.type }}）
          <span v-if="alias.note">，{{ alias.note }}</span>
        </li>
      </ul>
    </div>

    <div v-if="member && relations.length > 0" class="detail-section">
      <h4>关系明细</h4>
      <ul>
        <li v-for="relation in relations" :key="relation.id">
          {{ getRelationText(relation, member.id) }}
          （{{ getTemporalText(relation.temporalId) }}）
        </li>
      </ul>
    </div>

    <div v-if="member && memberTemporals.length > 0" class="detail-section">
      <h4>纪年明细</h4>
      <ul>
        <li v-for="temporal in memberTemporals" :key="temporal.id">
          {{ temporal.label }}：{{ temporal.rawText }}
        </li>
      </ul>
    </div>

    <div v-if="member && burials.length > 0" class="detail-section">
      <h4>墓葬明细</h4>
      <ul>
        <li v-for="burial in burials" :key="burial.id">
          {{ burial.placeRaw }}
          <span v-if="burial.mountainDirection">，山向 {{ burial.mountainDirection }}</span>
          <span v-if="burial.fenjin">，分金 {{ burial.fenjin }}</span>
          （{{ getTemporalText(burial.temporalId) }}）
        </li>
      </ul>
    </div>

    <p v-if="!member" class="empty-tip">暂无成员，请先新增族人。</p>

    <div v-if="member && !readonly" class="btn-row">
      <button class="btn-primary" type="button" @click="emit('edit', member.id)">编辑</button>
      <button class="btn-ghost" type="button" @click="emit('addChild', member.id)">添加子女</button>
      <button class="btn-danger" type="button" @click="emit('remove', member.id)">删除</button>
    </div>
  </section>
</template>
