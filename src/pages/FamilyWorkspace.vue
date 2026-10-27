<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import FamilyTreeChart from '../components/FamilyTreeChart.vue'
import MemberDetail from '../components/MemberDetail.vue'
import EventManager from '../components/EventManager.vue'
import MemberList from '../components/MemberList.vue'
import StatsDashboard from '../components/StatsDashboard.vue'
import TrackManager from '../components/TrackManager.vue'
import { useAuth } from '../services/authService'
import { computeGenerations } from '../services/generationService'
import { buildNavigationUrl } from '../services/navigationBridge'
import { useFamilyStore } from '../stores/familyStore'
import type { Track } from '../types/member'

const route = useRoute()
const router = useRouter()
const store = useFamilyStore()
const { isAuthenticated, ready } = useAuth()
const treeChart = ref<InstanceType<typeof FamilyTreeChart> | null>(null)
const initializing = ref(true)
const refreshing = ref(false)
const loadError = ref('')
const syncError = ref('')
const keyword = ref('')
const members = computed(() => store.members.value)
const generations = computed(() => computeGenerations(members.value))
const selected = computed(() => store.selectedMember.value)
const selectedGeneration = computed(() => selected.value ? generations.value.get(selected.value.id) ?? null : null)
const selectedAliases = computed(() => store.aliases.value.filter(item => item.memberId === selected.value?.id))
const selectedRelations = computed(() => store.relations.value.filter(item => item.fromMemberId === selected.value?.id || item.toMemberId === selected.value?.id))
const selectedBurials = computed(() => store.burials.value.filter(item => item.memberId === selected.value?.id))
const highlighted = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return query ? members.value.filter(member => member.name.toLowerCase().includes(query) || String(member.id).includes(query)).map(member => member.id) : []
})

watch([ready, isAuthenticated], ([authReady, authenticated]) => {
  if (authReady && !authenticated) void router.replace({ path: '/login', query: { redirect: route.fullPath } })
}, { immediate: true })

function memberName(id: number): string {
  return members.value.find(member => member.id === id)?.name ?? `成员 #${id}`
}
function parentName(id: number | null): string {
  return id === null ? '始祖 / 未录父亲' : memberName(id)
}
async function load() {
  initializing.value = true
  loadError.value = ''
  try {
    await store.init()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法加载云端族谱'
  } finally {
    initializing.value = false
  }
}
async function refresh() {
  if (initializing.value || refreshing.value || !store.ready.value) return
  refreshing.value = true
  try {
    await store.syncFromCloud()
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : '同步云端数据失败'
  } finally {
    refreshing.value = false
  }
}
function onFocus() { void refresh() }
function onVisibility() { if (document.visibilityState === 'visible') void refresh() }
onMounted(() => {
  void load()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibility)
})
function exportTree() {
  if (!treeChart.value) { message.error('图谱尚未完成加载'); return }
  try {
    treeChart.value.exportAsPng()
    message.success('族谱树图已导出为 PNG')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出树图失败')
  }
}
function navigate(track: Track) {
  const popup = window.open(buildNavigationUrl(track.endPoint), '_blank', 'noopener,noreferrer')
  if (!popup) message.error('导航页面被拦截，请允许弹窗后重试')
}
</script>

<template>
  <div class="legacy-workspace">
    <div class="page">
      <header class="workspace-toolbar">
        <div><h1>{{ route.meta.title }}</h1><p>{{ route.meta.description }}</p></div>
        <div class="top-actions top-actions-readonly">
          <span class="readonly-tip">当前为只读总览页面</span>
          <button class="btn-ghost" type="button" :disabled="initializing || refreshing" @click="refresh">{{ refreshing ? '刷新中…' : '刷新云端' }}</button>
          <button class="btn-ghost" type="button" :disabled="initializing || !!loadError" @click="exportTree">导出树图 PNG</button>
        </div>
      </header>
      <section v-if="initializing" class="status-panel"><h3>正在连接云端存储</h3><p>请稍候，系统正在恢复族谱资料。</p></section>
      <section v-else-if="loadError" class="status-panel status-panel-error">
        <h3>初始化失败</h3><p>{{ loadError }}</p><button class="btn-primary" type="button" @click="load">重试</button>
      </section>
      <section v-if="syncError" role="alert" class="status-panel status-panel-error">
        <h3>同步失败，当前仍显示上次加载的数据</h3><p>{{ syncError }}</p><button class="btn-ghost" type="button" :disabled="refreshing" @click="refresh">重试同步</button>
      </section>
      <main v-if="!initializing && !loadError" class="main-layout">
        <section class="left-pane">
          <FamilyTreeChart ref="treeChart" :members="members" :selected-id="store.selectedId.value" :highlight-ids="highlighted" @select="store.selectMember" />
        </section>
        <aside class="right-pane">
          <StatsDashboard :members="members" :tracks="store.tracks.value" :events="store.events.value" />
          <MemberList :members="members" :selected-id="store.selectedId.value" :find-parent-name="parentName" :generation-map="generations" readonly @select="store.selectMember" @search="keyword=$event" />
          <TrackManager :tracks="store.tracks.value" :members="members" :selected-member-id="store.selectedId.value" readonly @navigate="navigate" />
          <EventManager :events="store.events.value" :members="members" readonly />
          <MemberDetail :member="selected" :find-parent-name="parentName" :generation="selectedGeneration" :aliases="selectedAliases" :relations="selectedRelations" :temporals="store.temporals.value" :burials="selectedBurials" :resolve-member-name="memberName" readonly />
        </aside>
      </main>
      <footer class="footer"><p>数据存储在 Cloudflare D1 云端数据库，请由维护人员定期导出备份。</p></footer>
    </div>
  </div>
</template>
