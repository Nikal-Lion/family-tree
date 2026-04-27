<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useFamilyStore } from '../stores/familyStore'
import { buildGenerationTree } from '../services/generationTreeBuilder'
import type {
  GenerationTree,
  GenerationMember,
  CollapsedState,
} from '../types/generationTree'
import GenerationNodeCard from './GenerationNodeCard.vue'
import BranchFilterBar from './BranchFilterBar.vue'

const store = useFamilyStore()

// --------------------------------------------------
// Tree data
// --------------------------------------------------
const tree = reactive<{ value: GenerationTree | null }>({ value: null })
const collapsed = reactive<CollapsedState>({ collapsedIds: new Set() })
const selectedRootId = ref<number | null>(null)

// --------------------------------------------------
// Build tree from store data
// --------------------------------------------------
function rebuildTree() {
  const members = store.members.value
  const relations = store.relations.value
  const aliases = store.aliases.value
  if (members.length === 0) {
    tree.value = null
    return
  }
  tree.value = buildGenerationTree(members, relations, aliases)
}

// Rebuild when members/relations/aliases change
watch(
  () => [store.members.value, store.relations.value, store.aliases.value],
  () => rebuildTree(),
  { immediate: true, deep: true },
)

// --------------------------------------------------
// Snap to scroll helper
// --------------------------------------------------
function snapToMember(memberId: number) {
  store.selectMember(memberId)
}

// --------------------------------------------------
// Collapse handling
// --------------------------------------------------
function isCollapsed(memberId: number): boolean {
  return collapsed.collapsedIds.has(memberId)
}

function toggleCollapse(memberId: number) {
  const set = collapsed.collapsedIds
  if (set.has(memberId)) {
    set.delete(memberId)
  } else {
    set.add(memberId)
  }
  // Trigger reactivity
  collapsed.collapsedIds = new Set(set)
}

// --------------------------------------------------
// Build the displayable node list (generation layers)
// --------------------------------------------------
interface DisplayLayer {
  generation: number
  label: string
  nodes: GenerationMember[]
}

const displayLayers = computed<DisplayLayer[]>(() => {
  if (!tree.value) return []

  const { layers, memberMap } = tree.value

  // Collect visible members based on collapse and root filter
  const visibleIds = new Set<number>()

  function walkVisible(memberId: number) {
    if (visibleIds.has(memberId)) return
    visibleIds.add(memberId)
    if (isCollapsed(memberId)) return
    const gm = memberMap.get(memberId)
    if (!gm) return
    for (const childId of gm.childIds) {
      walkVisible(childId)
    }
  }

  // Walk from filtered root or all visible roots
  if (selectedRootId.value !== null) {
    walkVisible(selectedRootId.value)
  } else {
    for (const layer of layers) {
      for (const gm of layer.members) {
        // Start from root nodes (no parent or parent not in map)
        if (gm.fatherId === null || !memberMap.has(gm.fatherId)) {
          walkVisible(gm.member.id)
        }
      }
    }
  }

  // Build display layers with only visible members
  const result: DisplayLayer[] = []
  for (const layer of layers) {
    const visibleMembers = layer.members.filter((gm) =>
      visibleIds.has(gm.member.id),
    )
    if (visibleMembers.length > 0) {
      result.push({
        generation: layer.generation,
        label: layer.label,
        nodes: visibleMembers,
      })
    }
  }

  return result
})

// --------------------------------------------------
// Root member options for branch filter
// --------------------------------------------------
const rootOptions = computed<GenerationMember[]>(() => {
  if (!tree.value) return []
  const { memberMap } = tree.value
  const candidates: GenerationMember[] = []
  for (const gm of memberMap.values()) {
    // Consider top-level ancestors (those without parent or parent is outside)
    if (gm.fatherId === null || !memberMap.has(gm.fatherId)) {
      candidates.push(gm)
    }
  }
  return candidates
})

// --------------------------------------------------
// Horizontal scroll container
// --------------------------------------------------
const scrollContainer = ref<HTMLElement | null>(null)

function scrollToLeft() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTo({ left: 0, behavior: 'smooth' })
  }
}

function scrollToRight() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTo({
      left: scrollContainer.value.scrollWidth,
      behavior: 'smooth',
    })
  }
}
</script>

<template>
  <div class="gen-tree-view">
    <!-- Toolbar -->
    <div class="gen-tree-view__toolbar">
      <BranchFilterBar
        v-if="tree.value"
        :root-options="rootOptions"
        v-model="selectedRootId"
      />
      <div class="gen-tree-view__stats" v-if="tree.value">
        {{ tree.value.minGeneration }} - {{ tree.value.maxGeneration }} 世,
        {{ tree.value.memberMap.size }} 人
      </div>
    </div>

    <!-- Tree Container -->
    <div v-if="displayLayers.length === 0" class="gen-tree-view__empty">
      <p>暂无数据</p>
      <p>请先导入族谱数据</p>
    </div>

    <div v-else class="gen-tree-view__scroll-wrapper">
      <!-- Scroll Buttons -->
      <button
        class="gen-tree-view__scroll-btn gen-tree-view__scroll-btn--left"
        @click="scrollToLeft"
        title="滚动到最左边"
      >
        ◀
      </button>
      <button
        class="gen-tree-view__scroll-btn gen-tree-view__scroll-btn--right"
        @click="scrollToRight"
        title="滚动到最右边"
      >
        ▶
      </button>

      <div ref="scrollContainer" class="gen-tree-view__scroll-content">
        <!-- Tree Grid: Horizontal = generations (left to right) -->
        <div class="gen-tree-view__grid">
          <div
            v-for="layer in displayLayers"
            :key="layer.generation"
            class="gen-tree-view__layer"
          >
            <!-- Generation Header -->
            <div class="gen-tree-view__layer-header">
              {{ layer.label }}
            </div>

            <!-- Layer Members -->
            <div class="gen-tree-view__layer-members">
              <div
                v-for="member in layer.nodes"
                :key="member.member.id"
                class="gen-tree-view__node-wrapper"
              >
                <GenerationNodeCard
                  :member="member"
                  :is-collapsed="isCollapsed(member.member.id)"
                  @toggle-collapse="toggleCollapse"
                  @select-member="snapToMember"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="gen-tree-view__legend">
      <span class="gen-tree-view__legend-item">
        <span class="gen-tree-view__legend-male"></span> 男性
      </span>
      <span class="gen-tree-view__legend-item">
        <span class="gen-tree-view__legend-female"></span> 女性
      </span>
      <span class="gen-tree-view__legend-item">
        <span class="gen-tree-view__legend-dashed"></span> 已折叠
      </span>
    </div>
  </div>
</template>

<style scoped>
.gen-tree-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: #fafafa;
  border-radius: 8px;
  padding: 16px;
}

.gen-tree-view__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.gen-tree-view__stats {
  font-size: 13px;
  color: #78909c;
  white-space: nowrap;
  padding: 4px 12px;
  background: #eceff1;
  border-radius: 12px;
}

.gen-tree-view__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #90a4ae;
  font-size: 16px;
  gap: 8px;
}

.gen-tree-view__empty p {
  margin: 0;
}

.gen-tree-view__scroll-wrapper {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.gen-tree-view__scroll-content {
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
  padding: 8px 0 20px 0;
  /* Hide scrollbar */
  scrollbar-width: thin;
  scrollbar-color: #b0bec5 transparent;
}

.gen-tree-view__scroll-content::-webkit-scrollbar {
  height: 6px;
  width: 6px;
}

.gen-tree-view__scroll-content::-webkit-scrollbar-track {
  background: transparent;
}

.gen-tree-view__scroll-content::-webkit-scrollbar-thumb {
  background: #b0bec5;
  border-radius: 3px;
}

.gen-tree-view__scroll-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  width: 28px;
  height: 56px;
  border: 1px solid #e0e0e0;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: 4px;
  color: #78909c;
  transition: all 0.2s ease;
  opacity: 0;
}

.gen-tree-view__scroll-wrapper:hover .gen-tree-view__scroll-btn {
  opacity: 1;
}

.gen-tree-view__scroll-btn:hover {
  background: #e3f2fd;
  border-color: #90caf9;
  color: #1976d2;
}

.gen-tree-view__scroll-btn--left {
  left: 4px;
}

.gen-tree-view__scroll-btn--right {
  right: 4px;
}

.gen-tree-view__grid {
  display: flex;
  gap: 32px;
  min-height: 300px;
  padding: 0 8px;
}

.gen-tree-view__layer {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 130px;
  max-width: 220px;
  flex-shrink: 0;
}

.gen-tree-view__layer-header {
  font-weight: 700;
  font-size: 14px;
  color: #37474f;
  padding: 6px 12px;
  background: #eceff1;
  border-radius: 6px;
  margin-bottom: 12px;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 5;
}

.gen-tree-view__layer-members {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.gen-tree-view__node-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Legend */
.gen-tree-view__legend {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  background: #f5f5f5;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  font-size: 12px;
  color: #616161;
  justify-content: center;
  flex-wrap: wrap;
}

.gen-tree-view__legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.gen-tree-view__legend-male {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 2px solid #90a4ae;
  background: #ffffff;
}

.gen-tree-view__legend-female {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 2px solid #e91e63;
  background: #ffffff;
}

.gen-tree-view__legend-dashed {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 2px dashed #90a4ae;
  background: #ffffff;
}
</style>