<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button, Empty, Spin, Tag } from 'ant-design-vue'
import type { Member } from '../types/member'

const props = defineProps<{ members: Member[]; allMembers: Member[]; loading?: boolean }>()
const emit = defineEmits<{ select: [id: number] }>()
const visibleCount = ref(20)
const sentinel = ref<HTMLElement | null>(null)
const visible = computed(() => props.members.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < props.members.length)
const names = computed(() => new Map(props.allMembers.map((member) => [member.id, member.name])))
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
    <Empty v-else-if="!members.length" :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无符合条件的族人" />
    <button v-for="member in visible" :key="member.id" type="button" class="member-summary-card" @click="emit('select', member.id)">
      <span class="member-summary-title"><strong>{{ member.name }}</strong><Tag>{{ member.gender }}</Tag><span>#{{ member.id }}</span></span>
      <span>父亲：{{ member.parentId === null ? '未录父亲' : names.get(member.parentId) ?? `#${member.parentId}` }}</span>
      <span>谱载代数：{{ member.generationNumber || '未确定' }} · 分支：{{ member.lineageBranch || '未记录' }}</span>
      <span>出生：{{ member.birthDate || '未记录' }}</span>
      <span class="member-card-hint">点击展开人物详情</span>
    </button>
    <div v-if="!loading && hasMore" ref="sentinel" class="member-load-more">
      <Button @click="loadMore">加载更多（已显示 {{ visible.length }} / {{ members.length }}）</Button>
    </div>
    <p v-else-if="!loading && members.length" class="member-save-note">已显示全部 {{ members.length }} 位族人</p>
  </div>
</template>

<style scoped>
.member-card-list { display: grid; gap: 12px; min-width: 0; }
.member-summary-card { display: grid; gap: 8px; width: 100%; min-width: 0; padding: 16px; border: 1px solid #e4e7ec; border-radius: 12px; background: #fff; color: #475467; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.member-summary-card:hover, .member-summary-card:focus-visible { border-color: #4f46e5; }
.member-summary-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.member-summary-title strong { font-size: 17px; color: #182230; }
.member-card-hint { color: #4f46e5; font-size: 12px; }
.member-load-more { text-align: center; padding: 8px 0; }
</style>
