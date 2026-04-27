<script setup lang="ts">
import { computed } from 'vue'
import type { GenerationMember } from '../types/generationTree'

const props = defineProps<{
  /** 所有可选的根节点成员（通常是最高世代的成员） */
  rootOptions: GenerationMember[]
  /** 当前选中的根节点ID */
  modelValue: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const selectedId = computed({
  get: () => props.modelValue,
  set: (val: number | null) => emit('update:modelValue', val),
})

function selectAll() {
  selectedId.value = null
}

function selectBranch(id: number) {
  selectedId.value = id
}
</script>

<template>
  <div class="branch-filter-bar" v-if="rootOptions.length > 0">
    <label class="branch-filter-bar__label">分支筛选:</label>
    <div class="branch-filter-bar__options">
      <button
        class="branch-filter-bar__btn"
        :class="{ 'branch-filter-bar__btn--active': selectedId === null }"
        @click="selectAll"
      >
        全部成员
      </button>
      <button
        v-for="option in rootOptions"
        :key="option.member.id"
        class="branch-filter-bar__btn"
        :class="{ 'branch-filter-bar__btn--active': selectedId === option.member.id }"
        @click="selectBranch(option.member.id)"
      >
        {{ option.member.name }}{{ option.member.lineageBranch ? ` (${option.member.lineageBranch})` : '' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.branch-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f5f5f5;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  flex-wrap: wrap;
}

.branch-filter-bar__label {
  font-weight: 600;
  color: #455a64;
  font-size: 14px;
  white-space: nowrap;
}

.branch-filter-bar__options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.branch-filter-bar__btn {
  padding: 4px 12px;
  border: 1px solid #bdbdbd;
  border-radius: 16px;
  background: #ffffff;
  color: #616161;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.branch-filter-bar__btn:hover {
  border-color: #1976d2;
  color: #1976d2;
  background: #e3f2fd;
}

.branch-filter-bar__btn--active {
  background: #1976d2;
  color: #ffffff;
  border-color: #1976d2;
}

.branch-filter-bar__btn--active:hover {
  background: #1565c0;
  border-color: #1565c0;
  color: #ffffff;
}
</style>