<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button, Empty, Spin, Tag } from 'ant-design-vue'
import type { Member } from '../types/member'

const props = withDefaults(defineProps<{ members: Member[]; allMembers: Member[]; loading?: boolean; emptyText?: string }>(), {
  emptyText: '暂无符合条件的族人',
})
const emit = defineEmits<{ select: [id: number] }>()
const visibleCount = ref(20)
const sentinel = ref<HTMLElement | null>(null)
const visible = computed(() => props.members.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < props.members.length)
const names = computed(() => new Map(props.allMembers.map((member) => [member.id, member.name])))
const nameCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const member of props.allMembers) counts.set(member.name, (counts.get(member.name) ?? 0) + 1)
  return counts
})
const flagLabels = { missing: '信息缺失', estimated: '推定信息', conflicting: '信息冲突', unverified: '待核验' }
let observer: IntersectionObserver | undefined
function loadMore() { visibleCount.value += 20 }
watch(() => props.members, () => { visibleCount.value = 20 }, { flush: 'sync' })
watch([sentinel, visibleCount, () => props.members, () => props.loading], () => {
  observer?.disconnect()
  if (!sentinel.value || !hasMore.value || props.loading || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) loadMore()
  }, { rootMargin: '200px' })
  observer.observe(sentinel.value)
}, { flush: 'post' })
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="member-card-list" :aria-busy="loading">
    <Spin v-if="loading" />
    <Empty v-else-if="!members.length" :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="emptyText" />
    <button v-for="member in visible" :key="member.id" type="button" class="member-summary-card" @click="emit('select', member.id)">
      <span class="member-summary-title"><strong>{{ member.name }}</strong><Tag>{{ member.gender }}</Tag></span>
      <span>生父：{{ member.parentId === null ? '暂未记录生父' : names.get(member.parentId) ?? '生父档案暂不可用' }}</span>
      <span>{{ member.generationNumber ? `族谱记载：第 ${member.generationNumber} 代` : `族谱代数：${member.generationLabelRaw || '暂未记录'}` }}</span>
      <span>分支：{{ member.lineageBranch || '未记录' }}</span>
      <span>出生：{{ member.birthDate || '未记录' }}</span>
      <span v-if="(nameCounts.get(member.name) ?? 0) > 1" class="member-same-name">有同名人物，请结合亲属和分支区分 · 档案编号 {{ member.id }}</span>
      <span v-if="member.uncertaintyFlags?.length" class="member-same-name">{{ member.uncertaintyFlags.map((flag) => flagLabels[flag]).join('、') }}</span>
      <span class="member-card-hint">查看人物档案</span>
    </button>
    <div v-if="!loading && hasMore" ref="sentinel" class="member-load-more">
      <Button @click="loadMore">加载更多（已显示 {{ visible.length }} / {{ members.length }}）</Button>
    </div>
    <p v-else-if="!loading && members.length" class="member-save-note">已显示全部 {{ members.length }} 位族人</p>
  </div>
</template>

<style scoped>
.member-card-list { display: grid; gap: 12px; min-width: 0; }
.member-summary-card { display: grid; gap: 8px; width: 100%; min-width: 0; min-height: 44px; padding: 16px; border: 1px solid #e4e7ec; border-radius: 12px; background: #fff; color: #475467; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.member-summary-card:hover, .member-summary-card:focus-visible { border-color: #4f46e5; }
.member-summary-card:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
.member-summary-card { font: inherit; }
.member-summary-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.member-summary-title strong { font-size: 17px; color: #182230; }
.member-summary-title > * { min-width: 0; }
.member-same-name { color: #92400e; font-size: 12px; }
.member-card-hint { color: #4f46e5; font-size: 12px; }
.member-load-more { text-align: center; padding: 8px 0; }
.member-load-more :deep(.ant-btn) { min-height: 44px; height: auto; max-width: 100%; white-space: normal; }
</style>
