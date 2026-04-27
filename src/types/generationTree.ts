import type { Member, NameAlias } from './member'

/** 配偶简要信息 */
export interface SpouseInfo {
  id: number
  name: string
  /** 配偶关系的描述，如 "配" "继配" "妣" */
  relationLabel: string
}

/** 树状图中的成员节点 */
export interface GenerationMember {
  /** 成员基本数据 */
  member: Member
  /** 在世代层级中的位置索引（0-based） */
  positionIndex: number
  /** 父节点ID */
  fatherId: number | null
  /** 母节点ID */
  motherId: number | null
  /** 子女ID列表 */
  childIds: number[]
  /** 配偶信息（用于展示） */
  spouses: SpouseInfo[]
  /** 是否折叠（隐藏子代） */
  collapsed: boolean
  /** 别名列表 */
  aliases: string[]
  /** 生卒简写 */
  birthDeathSummary: string
  /** 按父节点索引排序后的子节点顺序 */
  childOrder: number
}

/** 世代层级，包含该代所有成员 */
export interface GenerationLayer {
  /** 世代序号，从1开始 */
  generation: number
  /** 世代标签，如 "八世祖""九 世祖" 或 "第 1 代" */
  label: string
  /** 该世代中的成员列表（按 positionIndex 排序） */
  members: GenerationMember[]
}

/** 完整的世代树数据 */
export interface GenerationTree {
  /** 按世代序号排序的层级列表 */
  layers: GenerationLayer[]
  /** memberId -> GenerationMember 快速查找 */
  memberMap: Map<number, GenerationMember>
  /** 最大世代数 */
  maxGeneration: number
  /** 最小世代数 */
  minGeneration: number
  /** 所有别名数据 */
  aliases: NameAlias[]
}

/** 树图展示配置 */
export interface TreeDisplayOptions {
  /** 按分支筛选：只显示指定成员的后代，null 表示显示全部 */
  rootFilterId: number | null
  /** 是否显示配偶信息 */
  showSpouses: boolean
  /** 是否显示生卒简写 */
  showLifeSpan: boolean
  /** 展开的世代数上限，0 表示不限制 */
  maxVisibleGenerations: number
}

/** 节点折叠状态 */
export interface CollapsedState {
  collapsedIds: Set<number>
}

/** 父子连线定义 */
export interface ConnectionLine {
  fromId: number
  toId: number
  /** 连线起点（子节点顶部中间） */
  x1: number
  y1: number
  /** 连线终点（父节点底部中间） */
  x2: number
  y2: number
}