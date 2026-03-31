<script setup lang="ts">
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildTreeData } from '../services/treeBuilder'
import type { Member } from '../types/member'

echarts.use([TreeChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  members: Member[]
  selectedId: number | null
  highlightIds: number[]
}>()

const emit = defineEmits<{
  select: [id: number]
}>()

function exportAsPng() {
  if (!chart) {
    return
  }
  const url = chart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#fffef7',
  })
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'family-tree.png'
  anchor.click()
}

defineExpose({ exportAsPng })

const chartRef = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let lastCenteredId: number | null = null

const treeData = computed(() => buildTreeData(props.members))

function decorateTree(node: any, highlightSet: Set<number>): any {
  const id = node.id
  const isSelected = typeof id === 'number' && id === props.selectedId
  const isHighlighted = typeof id === 'number' && highlightSet.has(id)

  const children = Array.isArray(node.children)
    ? node.children.map((child: any) => decorateTree(child, highlightSet))
    : undefined

  if (typeof id !== 'number') {
    return {
      ...node,
      children,
    }
  }

  const baseNode = {
    ...node,
    children,
  }

  if (isSelected) {
    return {
      ...baseNode,
      itemStyle: {
        color: '#2d5e2c',
        borderColor: '#1f421f',
        borderWidth: 2,
      },
      label: {
        color: '#fffef7',
        fontWeight: 700,
      },
    }
  }

  if (isHighlighted) {
    return {
      ...baseNode,
      itemStyle: {
        color: '#4f7f3a',
        borderColor: '#2f5b2a',
        borderWidth: 2,
      },
      label: {
        color: '#fffef7',
        fontWeight: 600,
      },
    }
  }

  return baseNode
}

function centerOnSelectedNode() {
  if (!chart || props.selectedId === null) {
    return
  }

  if (lastCenteredId === props.selectedId) {
    return
  }

  const model = (chart as any).getModel().getSeriesByIndex(0) as any
  const data = model?.getData?.()
  if (!data || typeof data.count !== 'function') {
    return
  }

  let targetIndex = -1
  for (let i = 0; i < data.count(); i += 1) {
    const raw = data.getRawDataItem(i)
    if (raw?.id === props.selectedId) {
      targetIndex = i
      break
    }
  }

  if (targetIndex < 0) {
    return
  }

  const layout = data.getItemLayout(targetIndex)
  if (!layout || typeof layout.x !== 'number' || typeof layout.y !== 'number') {
    return
  }

  const zr = chart.getZr()
  if (!zr) {
    return
  }
  const width = Number((zr as any).getWidth?.() ?? 0)
  const height = Number((zr as any).getHeight?.() ?? 0)
  const x = Number(layout.x)
  const y = Number(layout.y)
  const dx = width * 0.46 - x
  const dy = height * 0.5 - y

  chart.dispatchAction({
    type: 'treeRoam',
    seriesIndex: 0,
    dx,
    dy,
    zoom: 1,
    originX: 0,
    originY: 0,
  })

  chart.dispatchAction({
    type: 'showTip',
    seriesIndex: 0,
    dataIndex: targetIndex,
  })

  lastCenteredId = props.selectedId
}

function renderChart() {
  if (!chart) {
    return
  }

  const highlightSet = new Set(props.highlightIds)
  const decoratedTree = decorateTree(treeData.value, highlightSet)

  chart.setOption({
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter: (params: { data?: { id?: number | string; name?: string; gender?: string } }) => {
        const data = params.data
        if (!data || data.id === undefined || typeof data.id === 'string') {
          return '族谱总览'
        }
        return `姓名：${data.name}<br/>性别：${data.gender}<br/>ID：${data.id}`
      },
    },
    series: [
      {
        type: 'tree',
        data: [decoratedTree],
        left: '2%',
        right: '10%',
        top: '6%',
        bottom: '6%',
        orient: 'LR',
        symbol: 'roundRect',
        symbolSize: [96, 34],
        edgeShape: 'polyline',
        edgeForkPosition: '72%',
        lineStyle: {
          color: '#b4a57f',
          width: 1.6,
        },
        itemStyle: {
          color: '#b67a44',
          borderColor: '#8a5b30',
          borderWidth: 1,
        },
        label: {
          position: 'inside',
          verticalAlign: 'middle',
          align: 'center',
          color: '#fffef7',
          fontSize: 12,
          overflow: 'truncate',
          width: 84,
        },
        leaves: {
          label: {
            position: 'inside',
          },
        },
        emphasis: {
          focus: 'descendant',
        },
        initialTreeDepth: -1,
        roam: true,
        expandAndCollapse: true,
        animationDuration: 300,
        animationDurationUpdate: 260,
      },
    ],
  }, { replaceMerge: ['series'] })
}

function handleResize() {
  chart?.resize()
}

onMounted(() => {
  if (!chartRef.value) {
    return
  }

  chart = echarts.init(chartRef.value)
  chart.on('click', (params: any) => {
    const id = params.data?.id
    if (typeof id === 'number') {
      emit('select', id)
    }
  })

  renderChart()
  setTimeout(() => {
    centerOnSelectedNode()
  }, 0)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})

watch(
  () => [props.members, props.highlightIds],
  () => {
    renderChart()
  },
  { deep: true },
)

watch(
  () => props.selectedId,
  () => {
    renderChart()
    setTimeout(() => {
      centerOnSelectedNode()
    }, 0)
  },
)
</script>

<template>
  <section class="tree-card">
    <header class="tree-title">族谱树图（支持拖拽、滚轮/双指缩放）</header>
    <div ref="chartRef" class="tree-canvas" />
  </section>
</template>
