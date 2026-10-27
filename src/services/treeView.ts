import type { ECharts } from 'echarts/core'
import type { Member } from '../types/member'
import type { TreeNode } from './treeBuilder'
import { getAncestorIds } from './overview'

export interface TreeViewNode extends TreeNode {
  collapsed: boolean
  childCount: number
  children?: TreeViewNode[]
}

export interface TreeNodePosition { x: number; y: number }

export function buildTreeView(
  node: TreeNode, depth: number, expansion: ReadonlyMap<number, boolean>,
): TreeViewNode {
  return {
    ...node,
    childCount: node.children?.length ?? 0,
    collapsed: typeof node.id === 'number' && !!node.children?.length
      && !(expansion.get(node.id) ?? (depth === -1 || node.level < depth)),
    children: node.children?.map((child) => buildTreeView(child, depth, expansion)),
  }
}

export function revealTreePaths(
  members: Member[], targetIds: number[], expansion: Map<number, boolean>,
) {
  const byId = new Map(members.map((member) => [member.id, member]))
  const parents = targetIds.flatMap((id) => {
    const parentId = byId.get(id)?.parentId
    return typeof parentId === 'number' ? [parentId] : []
  })
  for (const id of getAncestorIds(members, parents)) expansion.set(id, true)
}

export function measureTreeView(node: TreeViewNode): { leaves: number; levels: number; members: number } {
  const ownCount = typeof node.id === 'number' ? 1 : 0
  if (node.collapsed || !node.children?.length) {
    return { leaves: 1, levels: node.level + 1, members: ownCount }
  }
  const children = node.children.map(measureTreeView)
  return {
    leaves: children.reduce((sum, child) => sum + child.leaves, 0),
    levels: Math.max(...children.map((child) => child.levels)),
    members: ownCount + children.reduce((sum, child) => sum + child.members, 0),
  }
}

export function indexTreeView(node: TreeViewNode): Map<number, TreeViewNode> {
  const nodes = new Map<number, TreeViewNode>()
  function visit(current: TreeViewNode) {
    if (typeof current.id === 'number') nodes.set(current.id, current)
    current.children?.forEach(visit)
  }
  visit(node)
  return nodes
}

interface DisplayNode extends TreeViewNode {
  children?: DisplayNode[]
  itemStyle?: { color: string; borderColor: string; borderWidth: number }
  symbol?: string
  label?: { show: boolean }
  tooltip?: { show: boolean }
  lineStyle?: { opacity: number }
  emphasis?: { disabled: boolean }
}

export function renderTreeScene(
  chart: Pick<ECharts, 'getOption' | 'getWidth' | 'getHeight' | 'clear' | 'setOption'>,
  tree: TreeViewNode,
  options: { direction: 'LR' | 'TB'; selectedId: number | null; highlightIds: number[]; reset: boolean },
) {
  const highlighted = new Set(options.highlightIds)
  const nodeIds = new Map<number, number>()
  const positions = new Map<number, TreeNodePosition>()
  function decorate(node: TreeViewNode): DisplayNode {
    const selected = node.id === options.selectedId
    const matched = typeof node.id === 'number' && highlighted.has(node.id)
    const virtual = typeof node.id !== 'number'
    return {
      ...node,
      children: node.collapsed ? [] : node.children?.map(decorate),
      ...(virtual ? {
        symbol: 'none', label: { show: false }, tooltip: { show: false },
        lineStyle: { opacity: 0 }, emphasis: { disabled: true },
      } : {}),
      itemStyle: selected
        ? { color: '#1677ff', borderColor: '#0958d9', borderWidth: 3 }
        : matched ? { color: '#d48806', borderColor: '#ad6800', borderWidth: 2 } : undefined,
    }
  }
  const previousSeries = chart.getOption()?.series
  const previousView = Array.isArray(previousSeries) ? previousSeries[0] : undefined
  const { leaves, levels } = measureTreeView(tree)
  const width = Math.max(1, options.direction === 'LR' ? (levels - 1) * 160 : (leaves - 1) * 112)
  const height = Math.max(1, options.direction === 'LR' ? (leaves - 1) * 46 : (levels - 1) * 90)
  // TreeView 会复用同 ID 图形；清理旧场景，避免深层折叠后残留节点和连线。
  chart.clear()
  chart.setOption({
    animation: false,
    tooltip: {
      renderMode: 'richText',
      trigger: 'item',
      formatter: (params: { data?: TreeViewNode }) => {
        const node = params.data
        return typeof node?.id === 'number'
          ? `姓名：${node.name}\n性别：${node.gender}\nID：${node.id}\n相对层级：${node.level}`
            + (node.childCount ? `\n点击${node.collapsed ? '展开' : '收起'}后代` : '')
          : ''
      },
    },
    series: [{
      id: 'family-tree', type: 'tree', data: [decorate(tree)],
      orient: options.direction, roam: true, expandAndCollapse: false,
      center: options.reset ? ['50%', '50%'] : previousView?.center ?? ['50%', '50%'],
      zoom: options.reset ? 1 : previousView?.zoom ?? 1,
      left: options.direction === 'LR' ? 65 : Math.max(65, (chart.getWidth() - width) / 2),
      top: options.direction === 'LR' ? Math.max(50, (chart.getHeight() - height) / 2) : 50,
      width, height,
      symbol: 'roundRect', symbolSize: [92, 32],
      edgeShape: 'polyline', edgeForkPosition: '65%',
      lineStyle: { color: '#94a3b8', width: 1.5 },
      itemStyle: { color: '#526b85', borderColor: '#3b536b', borderWidth: 1 },
      label: {
        position: 'inside', verticalAlign: 'middle', align: 'center',
        color: '#fff', fontSize: 12, overflow: 'truncate', width: 80,
        formatter: (params: { data?: TreeViewNode; dataIndex?: number }) => {
          const node = params.data
          if (!node || typeof node.id !== 'number') return ''
          if (params.dataIndex !== undefined) nodeIds.set(params.dataIndex, node.id)
          return node.childCount ? `${node.collapsed ? '+' : '-'} ${node.name}` : node.name
        },
      },
      leaves: { label: { position: 'inside' } },
      labelLayout: (params: { dataIndex?: number; rect: { x: number; y: number; width: number; height: number } }) => {
        const id = params.dataIndex === undefined ? undefined : nodeIds.get(params.dataIndex)
        if (typeof id === 'number') {
          positions.set(id, { x: params.rect.x + params.rect.width / 2, y: params.rect.y + params.rect.height / 2 })
        }
        return {}
      },
      emphasis: { focus: 'ancestor' },
      initialTreeDepth: -1,
    }],
  }, { notMerge: true })
  return positions
}
