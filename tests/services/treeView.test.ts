import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { SVGRenderer } from 'echarts/renderers'
import { LabelLayout } from 'echarts/features'
import { TooltipComponent } from 'echarts/components'
import { computeGenerations } from '../../src/services/generationService'
import { buildTreeData, type TreeNode } from '../../src/services/treeBuilder'
import { buildTreeView, indexTreeView, measureTreeView, renderTreeScene, revealTreePaths } from '../../src/services/treeView'
import type { Member } from '../../src/types/member'

const members: Member[] = [
  { id: 1, name: '始祖', gender: '男', parentId: null, generationNumber: 8 },
  { id: 2, name: '长房', gender: '男', parentId: 1, generationNumber: 9 },
  { id: 3, name: '次房', gender: '男', parentId: 1, generationNumber: 9 },
  { id: 4, name: '长房子', gender: '男', parentId: 2, generationNumber: 10 },
  { id: 5, name: '长房孙', gender: '男', parentId: 4, generationNumber: 11 },
  { id: 6, name: '次房子', gender: '男', parentId: 3, generationNumber: 10 },
  { id: 7, name: '未录父亲', gender: '男', parentId: null, generationNumber: 10 },
  { id: 8, name: '独立分支子', gender: '男', parentId: 7, generationNumber: 11 },
]
function positionOf(tree: TreeNode, id: number, depth = 0): number | undefined {
  if (tree.id === id) return depth
  for (const child of tree.children ?? []) {
    const found = positionOf(child, id, depth + 1)
    if (found !== undefined) return found
  }
}

describe('图谱辈分排版', () => {
  it('缺失父系者在实际图结构中与同辈同层，真实后代仍保持父子关系', () => {
    const original = structuredClone(members)
    const tree = buildTreeData(members)
    expect(positionOf(tree, 7)).toBe(positionOf(tree, 4))
    expect(positionOf(tree, 8)).toBe(positionOf(tree, 5))
    const branch = tree.children?.find((node) => node.id === 'gap:7:1')
    expect(branch).toMatchObject({
      placeholder: true, level: 1,
      children: [{ id: 'gap:7:2', placeholder: true, children: [{ id: 7, children: [{ id: 8 }] }] }],
    })
    expect(members).toEqual(original)
  })

  it('分支筛选使用全谱层级，不因隐藏早代人物而重新置顶', () => {
    const tree = buildTreeData(members.filter((member) => member.id >= 7), null, computeGenerations(members))
    expect(positionOf(tree, 7)).toBe(3)
    expect(positionOf(tree, 8)).toBe(4)
  })

  it('所选子树从该人物起显示，不携带全谱的空白代际', () => {
    const tree = buildTreeData(members, 7)
    expect(tree.children?.map((node) => node.id)).toEqual([7])
    expect(positionOf(tree, 7)).toBe(1)
    expect(positionOf(tree, 8)).toBe(2)
    expect(tree.children?.[0]?.level).toBe(1)
  })

  it('没有代数依据的孤立人物保持独立，空库或无效子树不回退全图', () => {
    const tree = buildTreeData([...members, { id: 9, name: '未知辈分', gender: '男', parentId: null }])
    expect(positionOf(tree, 9)).toBe(1)
    expect(buildTreeData([]).children).toEqual([])
    expect(buildTreeData(members, 999).children).toEqual([])
  })
})

describe('图谱展开状态', () => {
  it('按真实层级折叠，虚拟根和代际占位永不折叠或计入族人数', () => {
    const view = buildTreeView(buildTreeData(members), 2, new Map())
    const indexed = indexTreeView(view)
    expect(indexed.get(2)?.collapsed).toBe(true)
    expect(indexed.get(7)?.collapsed).toBe(true)
    expect(view.collapsed).toBe(false)
    expect(view.children?.find((node) => node.placeholder)?.collapsed).toBe(false)
    expect(measureTreeView(view)).toMatchObject({ members: 4, levels: 4 })
  })

  describe('真实 ECharts 图形更新', () => {
    let chart: echarts.ECharts
    beforeEach(() => {
      echarts.use([TreeChart, SVGRenderer, LabelLayout, TooltipComponent])
      chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 1200, height: 600 })
    })
    afterEach(() => chart.dispose())
    function render(expansion = new Map<number, boolean>(), reset = false, direction: 'LR' | 'TB' = 'LR') {
      renderTreeScene(chart, buildTreeView(buildTreeData(members), -1, expansion), {
        direction, selectedId: 2, highlightIds: [6], reset,
      })
      return chart.renderToSVGString()
    }

    it('折叠时真正移除全部隐藏后代及其图形，反复展开也不残留', () => {
      expect(render()).toContain('长房孙')
      for (let index = 0; index < 3; index++) {
        const collapsed = render(new Map([[2, false]]))
        expect(collapsed).not.toContain('长房子')
        expect(collapsed).not.toContain('长房孙')
        expect(collapsed).toContain('+ 长房')
        expect(collapsed).toContain('次房子')
        expect(render()).toContain('长房孙')
      }
    })

    it('重绘保留公开 API 中的缩放和漫游中心，仅显式重置时恢复默认', () => {
      render()
      chart.dispatchAction({ type: 'treeRoam', seriesId: 'family-tree', zoom: 1.5, originX: 400, originY: 200 })
      const previous = chart.getOption().series
      render(new Map([[2, false]]))
      expect(chart.getOption().series).toMatchObject([{ center: previous[0].center, zoom: previous[0].zoom }])
      render(new Map(), true)
      expect(chart.getOption().series).toMatchObject([{ center: ['50%', '50%'], zoom: 1 }])
    })

    it('占位和虚拟根不显示、不交互，也不画虚构的父系连线', () => {
      const svg = render()
      expect(svg).not.toContain('族谱总览')
      const series = chart.getOption().series[0]
      const root = series.data[0]
      expect(root).toMatchObject({
        symbol: 'none', label: { show: false }, tooltip: { show: false },
        lineStyle: { opacity: 0 }, emphasis: { disabled: true },
      })
      expect(root.children.find((node: TreeNode) => node.placeholder)).toMatchObject({
        symbol: 'none', lineStyle: { opacity: 0 }, collapsed: false,
      })
      expect(indexTreeView(root).get(7)?.level).toBe(indexTreeView(root).get(4)?.level)
      expect(svg).toContain('未录父亲')
    })

    it('横纵向使用一致的折叠状态和高亮，不改变成员身份', () => {
      const expansion = new Map([[2, false]])
      expect(render(expansion, true, 'TB')).not.toContain('长房孙')
      expect(chart.getOption().series[0].orient).toBe('TB')
      const nodes = indexTreeView(chart.getOption().series[0].data[0])
      expect(nodes.has(5)).toBe(false)
      expect(nodes.has(6)).toBe(true)
      expect(render(expansion, true, 'LR')).not.toContain('长房孙')
    })

    it('通过公开 labelLayout 坐标保持选中节点位置并定位搜索结果', () => {
      const view = buildTreeView(buildTreeData(members), -1, new Map())
      const positions = renderTreeScene(chart, view, {
        direction: 'LR', selectedId: 7, highlightIds: [], reset: true,
      })
      expect([...positions.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(positions.get(7)?.x).toBeCloseTo(positions.get(4)!.x)
      expect(positions.get(5)!.x - positions.get(4)!.x).toBeCloseTo(160)
      const collapsed = renderTreeScene(chart, buildTreeView(buildTreeData(members), -1, new Map([[2, false]])), {
        direction: 'LR', selectedId: 2, highlightIds: [], reset: false,
      })
      expect(collapsed.has(2)).toBe(true)
      expect(collapsed.has(5)).toBe(false)
      expect(Number.isFinite(collapsed.get(2)?.y)).toBe(true)
    })

    it('小树不拉满画布，横纵向保持固定的代际间距', () => {
      const single = buildTreeView(buildTreeData(members.slice(0, 1)), -1, new Map())
      const positions = renderTreeScene(chart, single, {
        direction: 'LR', selectedId: null, highlightIds: [], reset: true,
      })
      expect(positions.get(1)!.x).toBeCloseTo(225)
      expect(positions.get(1)!.y).toBeCloseTo(300)
      const vertical = renderTreeScene(chart, buildTreeView(buildTreeData(members), -1, new Map()), {
        direction: 'TB', selectedId: null, highlightIds: [], reset: true,
      })
      expect(vertical.get(7)!.y).toBeCloseTo(vertical.get(4)!.y)
      expect(vertical.get(5)!.y - vertical.get(4)!.y).toBeCloseTo(90)
    })

    it('大字模式同步放大文字、节点与间距，并保留折叠和漫游状态', () => {
      render()
      chart.dispatchAction({ type: 'treeRoam', seriesId: 'family-tree', zoom: 1.2, originX: 400, originY: 200 })
      const previous = chart.getOption().series[0]
      const expansion = new Map([[3, false]])
      const view = buildTreeView(buildTreeData(members), -1, expansion)
      for (const direction of ['LR', 'TB'] as const) {
        const positions = renderTreeScene(chart, view, {
          direction, selectedId: 2, highlightIds: [4], reset: false, textScale: 1.5,
        })
        const series = chart.getOption().series[0]
        expect(series).toMatchObject({
          symbolSize: [138, 48], label: { fontSize: 18, width: 120 },
          center: previous.center, zoom: previous.zoom,
        })
        expect(chart.getOption().tooltip[0].textStyle.fontSize).toBe(21)
        expect(positions.has(6)).toBe(false)
        expect(series.data[0].children[0].children.find((node: TreeNode) => node.id === 2).itemStyle.color).toBe('#1677ff')
        expect(chart.renderToSVGString()).toContain('18px')
      }
      render()
      expect(chart.getOption().series[0]).toMatchObject({
        symbolSize: [92, 32], label: { fontSize: 12, width: 80 },
      })
    })
  })

  it('手动展开/收起覆盖默认深度，连续切换不依赖上次绘制的数据', () => {
    const expansion = new Map<number, boolean>()
    const tree = buildTreeData(members)
    for (let index = 0; index < 10; index++) {
      const current = indexTreeView(buildTreeView(tree, 2, expansion)).get(2)!
      expansion.set(2, current.collapsed)
      expect(indexTreeView(buildTreeView(tree, 2, expansion)).get(2)?.collapsed).toBe(index % 2 !== 0)
    }
    expansion.set(1, false)
    expect(measureTreeView(buildTreeView(tree, -1, expansion)).members).toBe(3)
  })

  it('选人或搜索只展开目标祖先，不重置旁系折叠，也不自动展开目标本人', () => {
    const expansion = new Map([[1, false], [2, false], [3, false], [4, false], [7, false]])
    revealTreePaths(members, [4], expansion)
    expect(expansion.get(1)).toBe(true)
    expect(expansion.get(2)).toBe(true)
    expect(expansion.get(3)).toBe(false)
    expect(expansion.get(4)).toBe(false)
    expect(expansion.get(7)).toBe(false)
    revealTreePaths(members, [5, 6, 999], expansion)
    expect(expansion.get(3)).toBe(true)
    expect(expansion.get(4)).toBe(true)
    expect(expansion.get(7)).toBe(false)
  })

  it('收起再展开父分支后保留下级的手动状态，重建数据也不丢失', () => {
    const expansion = new Map([[1, false], [2, false]])
    expansion.set(1, true)
    const view = buildTreeView(buildTreeData(structuredClone(members)), -1, expansion)
    expect(indexTreeView(view).get(2)?.collapsed).toBe(true)
    expect(indexTreeView(view).get(3)?.collapsed).toBe(false)
  })

  it('五百节点按可见人数测量，折叠后不为隐藏后代保留巨型画布', () => {
    const large: Member[] = Array.from({ length: 500 }, (_, index) => ({
      id: index + 1, name: `成员${index + 1}`, gender: '男',
      parentId: index === 0 ? null : Math.floor((index - 1) / 3) + 1,
    }))
    const tree = buildTreeData(large)
    const all = measureTreeView(buildTreeView(tree, -1, new Map()))
    const collapsed = measureTreeView(buildTreeView(tree, -1, new Map([[1, false]])))
    expect(all.members).toBe(500)
    expect(collapsed).toEqual({ members: 1, levels: 2, leaves: 1 })
    expect(all.leaves).toBeGreaterThan(collapsed.leaves)
  })
})
