<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Alert, Button, Card, Drawer, Empty, Input, Select, Space, Statistic,
  Table, Tabs, Tag, message, type TableProps,
} from 'ant-design-vue'
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons-vue'
import FamilyTreeChart from '../components/FamilyTreeChart.vue'
import MemberArchive from '../components/MemberArchive.vue'
import MemberCardList from '../components/MemberCardList.vue'
import { useMobile } from '../composables/useMobile'
import { trackMemberIds } from '../services/trackService'
import { ACTIVITY_EVENT_TYPES, filterActivityEvents, filterActivityTracks } from '../services/activityManager'
import { computeGenerations, countByGeneration, getMaxGeneration } from '../services/generationService'
import { openTrackNavigation } from '../services/navigationBridge'
import { filterOverviewMembers, getAncestorIds, getBranchTreeMembers } from '../services/overview'
import { useFamilyStore } from '../stores/familyStore'
import type { FamilyEvent, FamilyEventType, Member, Track } from '../types/member'

const store = useFamilyStore()
const mobile = useMobile()
const initializing = ref(true)
const refreshing = ref(false)
const loadError = ref('')
const syncError = ref('')
const detailOpen = ref(false)
const keyword = ref('')
const branch = ref<string>()
const gender = ref<Member['gender']>()
const page = ref(1)
const rootId = ref<number | null>(null)
const chart = ref<InstanceType<typeof FamilyTreeChart> | null>(null)
const members = computed(() => store.members.value)
const selected = computed(() => store.selectedMember.value)
const generations = computed(() => computeGenerations(members.value))
const filtered = computed(() => filterOverviewMembers(members.value, store.aliases.value, {
  keyword: keyword.value, branch: branch.value, gender: gender.value,
}))
const branchOptions = computed(() => [...new Set(members.value.map((member) => member.lineageBranch ?? ''))]
  .sort((a, b) => a.localeCompare(b, 'zh-CN')).map((value) => ({ label: value || '未记录分支', value })))
const treeMembers = computed(() => getBranchTreeMembers(members.value, branch.value))
const highlighted = computed(() => keyword.value.trim() || gender.value
  ? filtered.value.map((member) => member.id) : [])
const stats = computed(() => [
  { title: '族人', value: members.value.length, suffix: '人' },
  { title: '配偶记录', value: store.spouses.value.length, suffix: '条' },
  { title: '相对树层级', value: getMaxGeneration(generations.value), suffix: '层' },
  { title: '未录父亲', value: members.value.filter((member) => member.parentId === null).length, suffix: '人' },
])
const relativeCounts = computed(() => [...countByGeneration(generations.value)]
  .sort(([a], [b]) => a - b).map(([generation, count]) => ({ generation, count })))
const recordedCounts = computed(() => {
  const counts = new Map<number, number>()
  for (const member of members.value) {
    const generation = member.generationNumber ?? 0
    counts.set(generation, (counts.get(generation) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a - b).map(([generation, count]) => ({ generation, count }))
})
const generationColumns = [{ title: '代数 / 层级', key: 'generation' }, { title: '人数', dataIndex: 'count' }]
const memberColumns: TableProps<Member>['columns'] = [
  { title: '姓名', key: 'name', width: 180 },
  { title: '性别', dataIndex: 'gender', width: 70 },
  { title: '父亲', key: 'parent', width: 180 },
  { title: '谱载代数', key: 'generation', width: 110, sorter: (a, b) => (a.generationNumber ?? 0) - (b.generationNumber ?? 0) },
  { title: '分支', dataIndex: 'lineageBranch', width: 160 },
]
const eventKeyword = ref('')
const eventType = ref<FamilyEventType>()
const trackKeyword = ref('')
const events = computed(() => filterActivityEvents(store.events.value, members.value, eventKeyword.value, eventType.value, undefined))
const tracks = computed(() => filterActivityTracks(store.tracks.value, members.value, trackKeyword.value, undefined))
const eventColumns: TableProps<FamilyEvent>['columns'] = [
  { title: '日期', dataIndex: 'date', width: 130 },
  { title: '类型', dataIndex: 'type', width: 70 },
  { title: '标题', dataIndex: 'title', width: 180 },
  { title: '关联族人', key: 'member', width: 160 },
  { title: '说明', dataIndex: 'description', width: 260 },
]
const trackColumns: TableProps<Track>['columns'] = [
  { title: '轨迹名称', dataIndex: 'name', width: 180 },
  { title: '关联族人', key: 'member', width: 160 },
  { title: '距离', key: 'distance', width: 100 },
  { title: '轨迹点', key: 'points', width: 90 },
  { title: '累计爬升', key: 'elevation', width: 110 },
  { title: '操作', key: 'actions', width: 140 },
]

function nameOf(id: number) { return members.value.find((member) => member.id === id)?.name ?? `成员 #${id}` }
function select(id: number, openArchive = true) {
  if (!members.value.some((member) => member.id === id)) { message.error('人物不存在，请刷新云端数据'); return }
  if (!treeMembers.value.some((member) => member.id === id)) branch.value = undefined
  if (rootId.value !== null && !getAncestorIds(members.value, [id]).has(rootId.value)) rootId.value = null
  store.selectMember(id)
  detailOpen.value = openArchive
}
function focusSelected() {
  if (!selected.value) return
  if (!treeMembers.value.some((member) => member.id === selected.value?.id)) branch.value = undefined
  rootId.value = selected.value.id
  detailOpen.value = false
}
watch([keyword, branch, gender], () => { page.value = 1 })
watch(branch, () => { rootId.value = null }, { flush: 'sync' })
watch(members, () => {
  if (rootId.value !== null && !members.value.some((member) => member.id === rootId.value)) rootId.value = null
  if (branch.value !== undefined && !branchOptions.value.some((option) => option.value === branch.value)) branch.value = undefined
  if (!selected.value) detailOpen.value = false
  page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / 10)))
})

async function load() {
  if (refreshing.value) return
  initializing.value = true
  loadError.value = ''
  try { await store.init() }
  catch (error) { loadError.value = error instanceof Error ? error.message : '无法加载云端族谱' }
  finally { initializing.value = false }
}
async function refresh() {
  if (initializing.value || refreshing.value || !store.ready.value || store.saving.value) return
  refreshing.value = true
  try {
    await store.syncFromCloud()
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : '同步云端数据失败'
  } finally { refreshing.value = false }
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
  try {
    if (!chart.value) throw new Error('图谱尚未完成加载')
    chart.value.exportAsPng()
    message.success('树图 PNG 已生成')
  } catch (error) { message.error(error instanceof Error ? error.message : '导出树图失败') }
}
function navigate(id: number) {
  try {
    const track = store.tracks.value.find((item) => item.id === id)
    if (!track) throw new Error('轨迹不存在，请刷新云端数据')
    openTrackNavigation(track.endPoint)
  }
  catch (error) { message.error(error instanceof Error ? error.message : '打开导航失败') }
}
</script>

<template>
  <div class="family-overview">
    <header class="overview-heading">
      <div><h1>读懂世系，留住家族记忆</h1><p>浏览族人档案、世系与家族足迹。此页面只读，不修改族谱资料。</p></div>
      <Button :loading="refreshing" :disabled="initializing || !!loadError || store.saving.value" @click="refresh"><template #icon><ReloadOutlined /></template>刷新云端</Button>
    </header>
    <Alert v-if="loadError" type="error" show-icon message="族谱加载失败" :description="loadError">
      <template #action><Button @click="load">重试</Button></template>
    </Alert>
    <Alert v-if="syncError" type="error" show-icon message="同步失败，仍显示上次加载的数据" :description="syncError">
      <template #action><Button :loading="refreshing" @click="refresh">重试同步</Button></template>
    </Alert>
    <Card v-if="initializing" :loading="true" title="正在加载云端族谱" />
    <template v-else-if="!loadError">
      <div class="overview-stats"><Card v-for="stat in stats" :key="stat.title" :bordered="false"><Statistic :title="stat.title" :value="stat.value" :suffix="stat.suffix" /></Card></div>
      <Card :bordered="false" class="overview-content">
        <Tabs default-active-key="genealogy">
          <Tabs.TabPane key="genealogy" tab="族谱与族人">
            <div class="overview-filters">
              <Input v-model:value="keyword" allow-clear placeholder="搜索姓名、ID、分支或别名" aria-label="搜索族人" class="overview-search"><template #prefix><SearchOutlined /></template></Input>
              <Select v-model:value="branch" allow-clear placeholder="全部分支" aria-label="筛选分支" :options="branchOptions" class="overview-select" />
              <Select v-model:value="gender" allow-clear placeholder="全部性别" aria-label="筛选性别" :options="[{label:'男',value:'男'},{label:'女',value:'女'}]" class="overview-select" />
              <Tag color="blue">名录 {{ filtered.length }} / {{ members.length }} 人</Tag>
            </div>
            <div class="overview-tree-heading">
              <div><h2>父系世系图</h2><p>谱载代数与相对树层级分别展示，不以树层级代替谱载代数。分支筛选保留已记录的祖先路径；子树按当前分支范围显示。</p></div>
              <Space wrap>
                <Button :disabled="!selected" @click="focusSelected">查看所选子树</Button>
                <Button v-if="rootId !== null" @click="rootId = null">返回当前分支全图</Button>
                <Button :disabled="!treeMembers.length" @click="exportTree"><template #icon><DownloadOutlined /></template>导出 PNG</Button>
              </Space>
            </div>
            <p v-if="selected" class="overview-selection">当前人物：<Button type="link" @click="select(selected.id)">{{ selected.name }} · #{{ selected.id }}</Button><Tag v-if="rootId !== null" color="blue">子树视图</Tag></p>
            <FamilyTreeChart ref="chart" :members="treeMembers" :selected-id="store.selectedId.value" :highlight-ids="highlighted" :root-id="rootId" :generations="generations" @select="id => select(id, false)" @inspect="select" />
            <h2 class="overview-directory-title">族人名录</h2>
            <MemberCardList v-if="mobile" :members="filtered" :all-members="members" @select="select" />
            <Table v-else :columns="memberColumns" :data-source="filtered" row-key="id" :scroll="{x:700}" :pagination="{current:page,pageSize:10,showSizeChanger:false,showTotal:(total:number)=>`共 ${total} 人`,onChange:(value:number)=>page=value}">
              <template #bodyCell="{column, record}">
                <template v-if="column.key === 'name'"><Button type="link" @click="select(record.id)">{{ record.name }} · #{{ record.id }}</Button></template>
                <template v-else-if="column.key === 'parent'"><Button v-if="record.parentId !== null" type="link" @click="select(record.parentId)">{{ nameOf(record.parentId) }}</Button><span v-else>未录父亲</span></template>
                <template v-else-if="column.key === 'generation'">{{ record.generationNumber || '未记录' }}</template>
              </template>
              <template #emptyText><Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="members.length ? '没有符合条件的族人，请调整筛选' : '暂无族谱资料，请由维护人员添加或导入'" /></template>
            </Table>
          </Tabs.TabPane>
          <Tabs.TabPane key="statistics" tab="世代统计">
            <Alert type="info" show-icon message="谱载代数来自原始记录；相对树层级按父系逐层计算，并以谱载代数对齐独立分支。无代数依据的分支从第 1 层起算，两者不能互相替代。" />
            <Space wrap class="overview-gender">
              <Tag color="blue">男性 {{ members.filter(member=>member.gender==='男').length }} 人</Tag>
              <Tag color="purple">女性 {{ members.filter(member=>member.gender==='女').length }} 人</Tag>
            </Space>
            <div class="overview-generation-grid">
              <section><h2 class="overview-directory-title">谱载代数分布</h2>
                <Table :columns="generationColumns" :data-source="recordedCounts" row-key="generation" :pagination="false">
                  <template #bodyCell="{column, record}"><template v-if="column.key === 'generation'">{{ record.generation ? `第 ${record.generation} 世` : '未记录' }}</template></template>
                </Table>
              </section>
              <section><h2 class="overview-directory-title">相对树层级分布</h2>
                <Table :columns="generationColumns" :data-source="relativeCounts" row-key="generation" :pagination="false">
                  <template #bodyCell="{column, record}"><template v-if="column.key === 'generation'">第 {{ record.generation }} 层</template></template>
                </Table>
              </section>
            </div>
          </Tabs.TabPane>
          <Tabs.TabPane key="events" :tab="`家族事件 · ${store.events.value.length}`">
            <Space wrap class="overview-filters">
              <Input v-model:value="eventKeyword" allow-clear placeholder="搜索事件或关联族人" aria-label="搜索事件" />
              <Select v-model:value="eventType" allow-clear placeholder="全部类型" aria-label="事件类型" :options="ACTIVITY_EVENT_TYPES.map(type=>({label:type,value:type}))" style="width:130px" />
            </Space>
            <Table :columns="eventColumns" :data-source="events" row-key="id" :scroll="{x:800}" :pagination="{pageSize:10,showSizeChanger:false}">
              <template #bodyCell="{column, record}"><template v-if="column.key === 'member'"><Button v-if="record.memberId !== null" type="link" @click="select(record.memberId)">{{ nameOf(record.memberId) }}</Button><span v-else>家族公共事件</span></template></template>
            </Table>
          </Tabs.TabPane>
          <Tabs.TabPane key="tracks" :tab="`寻根足迹 · ${store.tracks.value.length}`">
            <Input v-model:value="trackKeyword" allow-clear placeholder="搜索轨迹或关联族人" aria-label="搜索轨迹" class="overview-search overview-filters" />
            <Table :columns="trackColumns" :data-source="tracks" row-key="id" :scroll="{x:780}" :pagination="{pageSize:10,showSizeChanger:false}">
              <template #bodyCell="{column, record}">
                <template v-if="column.key === 'member'"><template v-for="(id, index) in trackMemberIds({ memberId: record.memberId, memberIds: record.memberIds })" :key="id"><span v-if="index"> → </span><Button type="link" @click="select(id)">{{ index + 1 }}. {{ nameOf(id) }}</Button></template><span v-if="record.memberId === null">未关联族人</span></template>
                <template v-else-if="column.key === 'distance'">{{ (record.stats.distanceMeters / 1000).toFixed(2) }} km</template>
                <template v-else-if="column.key === 'points'">{{ record.stats.pointCount }}</template>
                <template v-else-if="column.key === 'elevation'">{{ record.stats.elevationGainMeters === null ? '未记录' : `${record.stats.elevationGainMeters.toFixed(0)} m` }}</template>
                <template v-else-if="column.key === 'actions'"><Button type="link" @click="navigate(record.id)">导航到终点 ↗</Button></template>
              </template>
            </Table>
            <p class="overview-note">导航将打开外部 Google 地图；本页不采集当前位置，也不修改轨迹。</p>
          </Tabs.TabPane>
        </Tabs>
      </Card>
      <footer class="overview-note">资料来自 Cloudflare D1 云端。未记录、待匹配及待消歧不等于已确认事实；同音异字不会自动合并。请由维护人员定期导出备份。</footer>
    </template>
    <Drawer v-model:open="detailOpen" :title="selected ? `${selected.name} · 人物档案` : '人物档案'" width="min(680px, 100vw)">
      <template #extra><Button :disabled="!selected" @click="focusSelected">查看此人及后代</Button></template>
      <MemberArchive :member="selected" @select="select" />
    </Drawer>
  </div>
</template>

<style scoped>
.family-overview { width: 100%; max-width: 1600px; margin: 0 auto; padding: 28px; display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.overview-heading, .overview-tree-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.overview-heading > *, .overview-tree-heading > * { min-width: 0; max-width: 100%; }
.overview-heading h1 { font-size: 24px; font-weight: 650; color: #1e293b; margin: 0 0 8px; }
.overview-heading p, .overview-tree-heading p, .overview-note { color: #64748b; font-size: 13px; line-height: 1.8; margin: 0; }
.overview-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.overview-content { min-width: 0; }
.overview-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.overview-search { width: min(100%, 320px); }
.overview-select { width: 160px; }
.overview-tree-heading h2, .overview-directory-title { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
.overview-directory-title { margin-top: 24px; }
.overview-gender { margin-top: 16px; }
.overview-generation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.overview-selection { margin: 8px 0; color: #64748b; font-size: 13px; }
.overview-selection :deep(.ant-btn-link) { max-width: 100%; height: auto; white-space: normal; text-align: start; overflow-wrap: anywhere; }
.overview-content :deep(.ant-table-cell) { overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 767px) {
  .family-overview { padding: 16px 12px; gap: 16px; }
  .overview-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .overview-heading h1 { font-size: 20px; }
  .overview-content :deep(.ant-card-body) { padding: 14px; }
  .overview-select { width: calc(50% - 6px); }
  .overview-generation-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
