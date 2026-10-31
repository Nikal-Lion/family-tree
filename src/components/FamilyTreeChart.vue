<script setup lang="ts">
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { TooltipComponent } from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Alert, Button, Empty, Select, Space } from 'ant-design-vue'
import { buildTreeData } from '../services/treeBuilder'
import { buildTreeView, indexTreeView, measureTreeView, renderTreeScene, revealTreePaths, type TreeNodePosition } from '../services/treeView'
import type { Member } from '../types/member'

echarts.use([TreeChart, TooltipComponent, CanvasRenderer, LabelLayout])

const props = defineProps<{
  members: Member[]
  selectedId: number | null
  highlightIds: number[]
  rootId?: number | null
  generations?: ReadonlyMap<number, number>
}>()
const emit = defineEmits<{ select: [id: number]; inspect: [id: number] }>()
const chartRef = ref<HTMLElement | null>(null)
const direction = ref<'LR' | 'TB'>('LR')
const depth = ref(4)
const chartError = ref('')
const canvasSize = ref({ width: '100%', height: '560px' })
const treeData = computed(() => buildTreeData(props.members, props.rootId ?? null, props.generations))
const expansion = ref(new Map<number, boolean>())
const treeView = computed(() => buildTreeView(treeData.value, depth.value, expansion.value))
const viewIndex = computed(() => indexTreeView(treeView.value))
const selectedNode = computed(() => props.selectedId === null ? undefined : viewIndex.value.get(props.selectedId))
const extent = computed(() => measureTreeView(treeView.value))
const canToggleSelected = computed(() => !!selectedNode.value?.children?.length)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let renderFrame: number | null = null
let resetPending = false
let nodePositions = new Map<number, TreeNodePosition>()
let pendingAnchor: { id: number; point: TreeNodePosition } | null = null
let focusId: number | null = null
let viewportSize: { width: number; height: number } | null = null
let renderVersion = 0

function renderChart(reset = false) {
  if (!chart) return
  const viewport = chartRef.value?.parentElement
  if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return
  const version = ++renderVersion
  const previousViewportSize = viewportSize
  viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight }
  const previousScroll = { left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 }
  const anchor = reset ? null : pendingAnchor
  const targetId = reset ? null : focusId
  pendingAnchor = null
  focusId = null
  const width = Math.max(viewport?.clientWidth ?? 0,
    direction.value === 'LR' ? extent.value.levels * 160 + 120 : extent.value.leaves * 112 + 120)
  const height = Math.max(viewport?.clientHeight ?? 440,
    direction.value === 'LR' ? extent.value.leaves * 46 + 110 : extent.value.levels * 90 + 100)
  canvasSize.value = { width: `${width}px`, height: `${height}px` }
  if (chart.getWidth() !== width || chart.getHeight() !== height) chart.resize({ width, height })
  nodePositions = renderTreeScene(chart, treeView.value, {
    direction: direction.value, selectedId: props.selectedId, highlightIds: props.highlightIds, reset,
  })
  if (viewport) {
    const anchoredPosition = anchor ? nodePositions.get(anchor.id) : undefined
    const resetId = props.selectedId !== null && nodePositions.has(props.selectedId)
      ? props.selectedId : nodePositions.keys().next().value
    const focusedPosition = reset
      ? resetId === undefined ? undefined : nodePositions.get(resetId)
      : targetId === null ? undefined : nodePositions.get(targetId)
    void nextTick(() => {
      if (!chart || version !== renderVersion) return
      if (reset && focusedPosition) {
        viewport.scrollTo({
          left: Math.max(0, focusedPosition.x - viewport.clientWidth / 2),
          top: Math.max(0, focusedPosition.y - viewport.clientHeight / 2),
        })
      } else if (reset) {
        viewport.scrollTo({
          left: direction.value === 'TB' ? Math.max(0, (width - viewport.clientWidth) / 2) : 0,
          top: direction.value === 'LR' ? Math.max(0, (height - viewport.clientHeight) / 2) : 0,
        })
      } else if (anchor && anchoredPosition) {
        viewport.scrollTo({
          left: previousScroll.left + anchoredPosition.x - anchor.point.x,
          top: previousScroll.top + anchoredPosition.y - anchor.point.y,
        })
      } else if (focusedPosition) {
        viewport.scrollTo({
          left: focusedPosition.x - viewport.clientWidth / 2,
          top: focusedPosition.y - viewport.clientHeight / 2,
        })
      } else viewport.scrollTo({
        left: previousScroll.left + ((previousViewportSize?.width ?? viewport.clientWidth) - viewport.clientWidth) / 2,
        top: previousScroll.top + ((previousViewportSize?.height ?? viewport.clientHeight) - viewport.clientHeight) / 2,
      })
    })
  }
  chartError.value = ''
}

function queueRender(reset = false) {
  if (!chart) return
  resetPending ||= reset
  if (renderFrame !== null) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null
    const viewport = chartRef.value?.parentElement
    if (!viewport?.clientWidth || !viewport.clientHeight) return
    const shouldReset = resetPending
    resetPending = false
    try { renderChart(shouldReset) }
    catch (error) { chartError.value = error instanceof Error ? error.message : '图谱绘制失败' }
  })
}
function revealTargets(targetIds = [
    ...props.highlightIds, ...(props.selectedId === null ? [] : [props.selectedId]),
  ]) {
  revealTreePaths(props.members, targetIds, expansion.value)
}
function resetView() {
  expansion.value.clear()
  revealTargets()
  queueRender(true)
}
function setSelectedExpanded(expanded: boolean) {
  if (props.selectedId === null || !canToggleSelected.value) return
  const point = nodePositions.get(props.selectedId)
  if (point) pendingAnchor = { id: props.selectedId, point: { ...point } }
  expansion.value.set(props.selectedId, expanded)
}
function exportAsPng() {
  if (!chart || chartError.value || !props.members.length) throw new Error('图谱尚未就绪或没有可导出的成员')
  const anchor = document.createElement('a')
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
  if (!url.startsWith('data:image/png;base64,')) throw new Error('图谱超出浏览器图片导出范围，请缩小子树或展开层级后重试')
  anchor.href = url
  anchor.download = 'family-tree.png'
  document.body.appendChild(anchor)
  try { anchor.click() } finally { anchor.remove() }
}
defineExpose({ exportAsPng })

function resize() {
  queueRender()
}
function initialize() {
  if (!chartRef.value) return
  chartError.value = ''
  try {
    chart?.dispose()
    chart = echarts.init(chartRef.value)
    chart.on('click', (params) => {
      const node = params.data
      if (!node || typeof node !== 'object' || !('id' in node) || typeof node.id !== 'number') return
      const current = viewIndex.value.get(node.id)
      if (!current) return
      pendingAnchor = params.event && (current.children?.length || props.selectedId !== node.id)
        ? { id: node.id, point: { x: params.event.offsetX, y: params.event.offsetY } } : null
      if (current.children?.length) expansion.value.set(node.id, current.collapsed)
      emit('select', node.id)
    })
    chart.on('treeroam', () => nodePositions.clear())
    viewportSize = null
    queueRender(true)
  } catch (error) {
    chartError.value = error instanceof Error ? error.message : '图谱初始化失败'
  }
}
onMounted(() => {
  initialize()
  resizeObserver = new ResizeObserver(resize)
  if (chartRef.value?.parentElement) resizeObserver.observe(chartRef.value.parentElement)
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (renderFrame !== null) cancelAnimationFrame(renderFrame)
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
watch(() => props.members, () => {
  const ids = new Set(props.members.map((member) => member.id))
  for (const id of expansion.value.keys()) if (!ids.has(id)) expansion.value.delete(id)
}, { deep: true })
watch(() => props.highlightIds, (ids, previous) => {
  if (previous && ids.length === previous.length && ids.every((id, index) => id === previous[index])) return
  revealTargets()
  focusId = props.highlightIds[0] ?? props.selectedId
}, { deep: true, immediate: true })
watch(() => props.selectedId, () => {
  revealTargets(props.selectedId === null ? [] : [props.selectedId])
  focusId = props.selectedId
}, { immediate: true })
watch([treeView, () => props.highlightIds, () => props.selectedId], () => queueRender(), { deep: true })
watch(() => props.rootId, resetView)
watch(direction, () => queueRender(true))
watch(depth, resetView)
</script>

<template>
  <div class="family-chart">
    <div class="chart-toolbar">
      <Space wrap>
        <Select v-model:value="direction" aria-label="图谱方向" :options="[{label:'横向世系',value:'LR'},{label:'纵向世系',value:'TB'}]" style="width:130px" />
        <Select v-model:value="depth" aria-label="展开层级" :options="[{label:'展开 2 层',value:2},{label:'展开 4 层',value:4},{label:'展开 6 层',value:6},{label:'展开全部',value:-1}]" style="width:130px" />
        <Button @click="resetView">重置视图</Button>
        <Button :disabled="!canToggleSelected || !selectedNode?.collapsed" @click="setSelectedExpanded(true)">展开所选</Button>
        <Button :disabled="!canToggleSelected || !!selectedNode?.collapsed" @click="setSelectedExpanded(false)">收起所选</Button>
        <Button :disabled="!selectedNode" @click="selectedId !== null && emit('inspect', selectedId)">查看档案</Button>
      </Space>
      <span class="chart-hint">当前显示 {{ extent.members }} / {{ viewIndex.size }} 人 · 点击节点展开/收起 · 拖拽移动 · 滚轮 / 双指缩放</span>
    </div>
    <Alert v-if="chartError" type="error" show-icon :message="chartError">
      <template #action><Button size="small" @click="initialize">重试</Button></template>
    </Alert>
    <div class="chart-stage">
      <div ref="chartRef" class="chart-canvas" :style="canvasSize" role="img" aria-label="族谱父系树图，可通过族人名录选择成员查看档案" />
      <Empty v-if="!members.length" class="chart-empty" description="当前范围没有族人资料" />
    </div>
    <p class="chart-hint chart-note">“+”表示可展开，“-”表示可收起；叶节点仅选中人物。未录父亲但有代数依据者按辈分对齐，不补造父亲或连线。连线只表示已记录的父系关系；配偶、过继及待关联声明请查看档案。搜索或从名录选人会展开其祖先路径，其他分支的手动状态保留。</p>
  </div>
</template>

<style scoped>
.family-chart { width: 100%; min-width: 0; max-width: 100%; }
.chart-toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chart-hint { color: #64748b; font-size: 12px; line-height: 1.8; }
.chart-stage { position: relative; width: 100%; min-width: 0; height: 560px; overflow: auto; overflow-anchor: none; scrollbar-gutter: stable; overscroll-behavior: contain; margin-top: 12px; }
.chart-canvas { touch-action: none; }
.chart-empty { position: absolute; inset: 30% 0 auto; pointer-events: none; }
.chart-note { margin: 0; }
@media (max-width: 767px) { .chart-stage { height: 440px; } }
</style>
