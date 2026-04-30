<script setup lang="ts">
import { computed } from 'vue'
import { findSpousesByHusband } from '../services/spouseService'
import { useFamilyStore } from '../stores/familyStore'
import type { Member } from '../types/member'

interface GenerationNode {
  member: Member
  children?: GenerationNode[]
}

const props = defineProps<{
  node: GenerationNode
  isSelected?: boolean
  isCollapsed?: boolean
}>()

const emit = defineEmits<{
  click: []
  toggle: []
}>()

const store = useFamilyStore()

const spouses = computed(() => findSpousesByHusband({ spouses: store.spouses.value }, props.node.member.id))
const spouseLabel = computed(() => {
  if (spouses.value.length === 0) return ''
  const head = spouses.value.slice(0, 2).map((s) => `${s.surname}氏`).join('、')
  return spouses.value.length > 2 ? `${head} 等 ${spouses.value.length} 人` : head
})

const member = computed(() => props.node.member)
</script>

<template>
  <div
    class="gen-node-card"
    :class="{ selected: isSelected }"
    @click="emit('click')"
  >
    <div class="node-name">{{ member.name }}</div>
    <div v-if="spouseLabel" class="node-spouse">配：{{ spouseLabel }}</div>
    <div v-if="member.birthDate" class="node-dates">{{ member.birthDate }}</div>
    <button
      v-if="node.children && node.children.length > 0"
      class="toggle-btn"
      :title="isCollapsed ? '展开' : '折叠'"
      @click.stop="emit('toggle')"
    >
      {{ isCollapsed ? '▶' : '▼' }}
    </button>
  </div>
</template>

<style scoped>
.gen-node-card {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 10px;
  background: #f5f0e6;
  border: 1px solid #c8b89a;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  min-width: 72px;
  max-width: 140px;
  transition: background 0.15s, border-color 0.15s;
}

.gen-node-card:hover {
  background: #ede5d5;
  border-color: #a07840;
}

.gen-node-card.selected {
  background: #2d5e2c;
  border-color: #1f421f;
  color: #fffef7;
}

.node-name {
  font-size: 0.95em;
  font-weight: 700;
  text-align: center;
  word-break: break-all;
}

.node-spouse {
  font-size: 0.72em;
  color: #7a5c30;
  margin-top: 2px;
  text-align: center;
}

.gen-node-card.selected .node-spouse {
  color: #d4c9a8;
}

.node-dates {
  font-size: 0.68em;
  color: #999;
  margin-top: 1px;
  text-align: center;
}

.gen-node-card.selected .node-dates {
  color: #b8c8b0;
}

.toggle-btn {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.6em;
  background: #fff;
  border: 1px solid #c8b89a;
  border-radius: 3px;
  padding: 0 4px;
  cursor: pointer;
  line-height: 14px;
  color: #7a5c30;
  z-index: 1;
}

.toggle-btn:hover {
  background: #ede5d5;
}
</style>
