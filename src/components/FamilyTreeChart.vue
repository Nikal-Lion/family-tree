<script setup lang="ts">
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { TooltipComponent } from 'echarts/components'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Alert, Button, Empty, Select, Space } from 'ant-design-vue'
import { buildTreeData, type TreeNode } from '../services/treeBuilder'
import { getAncestorIds } from '../services/overview'
import type { Member } from '../types/member'

echarts.use([TreeChart, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  members: Member[]
  selectedId: number | null
  highlightIds: number[]
  rootId?: number | null
}>()
const emit = defineEmits<{ select: [id: number] }>()
const chartRef = ref<HTMLElement | null>(null)
const direction = ref<'LR' | 'TB'>('LR')
const depth = ref(4)
const chartError = ref('')
const canvasSize = ref({ width: '100%', height: '560px' })
const treeData = computed(() => buildTreeData(props.members, props.rootId ?? null))
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
const collapsedNodes = new Set<number>()
const expandedNodes = new Set<number>()

interface DisplayNode extends TreeNode {
  collapsed: boolean
  children?: DisplayNode[]
  itemStyle?: { color: string; borderColor: string; borderWidth: number }
}

function renderChart(reset = false) {
  if (!chart) return
  const highlighted = new Set(props.highlightIds)
  const expandedPath = getAncestorIds(props.members, [
    ...props.highlightIds, ...(props.selectedId === null ? [] : [props.selectedId]),
  ])
  function decorate(node: TreeNode, level: number): DisplayNode {
    const selected = node.id === props.selectedId
    const matched = typeof node.id === 'number' && highlighted.has(node.id)
    return {
      ...node,
      collapsed: typeof node.id === 'number' && (collapsedNodes.has(node.id)
        || (!expandedNodes.has(node.id) && depth.value !== -1 && level >= depth.value
          && !expandedPath.has(node.id))),
      children: node.children?.map((child) => decorate(child, level + 1)),
      itemStyle: selected
        ? { color: '#1677ff', borderColor: '#0958d9', borderWidth: 3 }
        : matched ? { color: '#d48806', borderColor: '#ad6800', borderWidth: 2 } : undefined,
    }
  }
  const decorated = decorate(treeData.value, 0)
  function measure(node: DisplayNode): { leaves: number; levels: number } {
    if (node.collapsed || !node.children?.length) return { leaves: 1, levels: 1 }
    const children = node.children.map(measure)
    return {
      leaves: children.reduce((sum, child) => sum + child.leaves, 0),
      levels: Math.max(...children.map((child) => child.levels)) + 1,
    }
  }
  const extent = measure(decorated)
  const viewport = chartRef.value?.parentElement
  const width = Math.max(viewport?.clientWidth ?? 0,
    direction.value === 'LR' ? extent.levels * 160 + 120 : extent.leaves * 112 + 120)
  const height = Math.max(viewport?.clientHeight ?? 440,
    direction.value === 'LR' ? extent.leaves * 46 + 110 : extent.levels * 90 + 100)
  canvasSize.value = { width: `${width}px`, height: `${height}px` }
  if (chart.getWidth() !== width || chart.getHeight() !== height) chart.resize({ width, height })
  if (reset && viewport) {
    void nextTick(() => viewport.scrollTo({
      left: direction.value === 'TB' ? Math.max(0, (width - viewport.clientWidth) / 2) : 0,
      top: direction.value === 'LR' ? Math.max(0, (height - viewport.clientHeight) / 2) : 0,
    }))
  }
  chart.setOption({
    animation: false,
    tooltip: {
      renderMode: 'richText',
      trigger: 'item',
      formatter: (params: { data?: { id?: number | string; name?: string; gender?: string } }) => {
        const node = params.data
        return typeof node?.id === 'number'
          ? `姓名：${node.name}\n性别：${node.gender}\nID：${node.id}`
          : treeData.value.name
      },
    },
    series: [{
      id: 'family-tree', type: 'tree', data: [decorated],
      orient: direction.value, roam: true, expandAndCollapse: false,
      ...(reset ? { center: ['50%', '50%'], zoom: 1 } : {}),
      left: direction.value === 'LR' ? 65 : 35,
      right: direction.value === 'LR' ? 85 : 35,
      top: 50, bottom: 60,
      symbol: 'roundRect', symbolSize: [92, 32],
      edgeShape: 'polyline', edgeForkPosition: '65%',
      lineStyle: { color: '#94a3b8', width: 1.5 },
      itemStyle: { color: '#526b85', borderColor: '#3b536b', borderWidth: 1 },
      label: {
        position: 'inside', verticalAlign: 'middle', align: 'center',
        color: '#fff', fontSize: 12, overflow: 'truncate', width: 80,
      },
      leaves: { label: { position: 'inside' } },
      emphasis: { focus: 'ancestor' },
      initialTreeDepth: -1,
    }],
  }, { notMerge: reset })
}

function resetView() { renderChart(true) }
function setSelectedExpanded(expanded: boolean) {
  if (props.selectedId === null) return
  const [add, remove] = expanded ? [expandedNodes, collapsedNodes] : [collapsedNodes, expandedNodes]
  add.add(props.selectedId)
  remove.delete(props.selectedId)
  renderChart()
}
function clearExpansion() {
  collapsedNodes.clear()
  expandedNodes.clear()
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
  renderChart()
}
function initialize() {
  if (!chartRef.value) return
  chartError.value = ''
  try {
    chart?.dispose()
    chart = echarts.init(chartRef.value)
    chart.on('click', (params) => {
      const node = params.data
      if (node && typeof node === 'object' && 'id' in node && typeof node.id === 'number') emit('select', node.id)
    })
    renderChart(true)
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
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
watch(() => props.members, () => {
  clearExpansion()
  renderChart(true)
}, { deep: true })
watch(() => [props.highlightIds, props.selectedId], () => {
  clearExpansion()
  renderChart()
}, { deep: true })
watch(() => props.rootId, () => { clearExpansion(); resetView() })
watch([direction, depth], () => { clearExpansion(); resetView() })
</script>

<template>
  <div class="family-chart">
    <div class="chart-toolbar">
      <Space wrap>
        <Select v-model:value="direction" aria-label="图谱方向" :options="[{label:'横向世系',value:'LR'},{label:'纵向世系',value:'TB'}]" style="width:130px" />
        <Select v-model:value="depth" aria-label="展开层级" :options="[{label:'展开 2 层',value:2},{label:'展开 4 层',value:4},{label:'展开 6 层',value:6},{label:'展开全部',value:-1}]" style="width:130px" />
        <Button @click="resetView">重置视图</Button>
        <Button :disabled="selectedId === null" @click="setSelectedExpanded(true)">展开所选</Button>
        <Button :disabled="selectedId === null" @click="setSelectedExpanded(false)">收起所选</Button>
      </Space>
      <span class="chart-hint">拖拽移动 · 滚轮 / 双指缩放 · 点击查看档案</span>
    </div>
    <Alert v-if="chartError" type="error" show-icon :message="chartError">
      <template #action><Button size="small" @click="initialize">重试</Button></template>
    </Alert>
    <div class="chart-stage">
      <div ref="chartRef" class="chart-canvas" :style="canvasSize" role="img" aria-label="族谱父系树图，可通过族人名录选择成员查看档案" />
      <Empty v-if="!members.length" class="chart-empty" description="当前范围没有族人资料" />
    </div>
    <p class="chart-hint chart-note">连线只表示已记录的父系关系；配偶、过继及待关联的子女声明请查看人物档案。选中或搜索成员会展开其祖先路径；仅看该人物及后代可使用“查看所选子树”。</p>
  </div>
</template>

<style scoped>
.family-chart { min-width: 0; }
.chart-toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.chart-hint { color: #64748b; font-size: 12px; line-height: 1.8; }
.chart-stage { position: relative; height: 560px; overflow: auto; overscroll-behavior: contain; margin-top: 12px; }
.chart-canvas { touch-action: none; }
.chart-empty { position: absolute; inset: 30% 0 auto; pointer-events: none; }
.chart-note { margin: 0; }
@media (max-width: 767px) { .chart-stage { height: 440px; } }
</style>
