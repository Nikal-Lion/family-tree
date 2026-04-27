<script setup lang="ts">
import type { GenerationMember } from '../types/generationTree'

const props = defineProps<{
  member: GenerationMember
  isCollapsed: boolean
}>()

const emit = defineEmits<{
  toggleCollapse: [memberId: number]
  selectMember: [memberId: number]
}>()

function handleClick() {
  emit('selectMember', props.member.member.id)
}

function handleToggleCollapse() {
  emit('toggleCollapse', props.member.member.id)
}
</script>

<template>
  <div
    class="gen-node-card"
    :class="{
      'gen-node-card--female': member.member.gender === '女',
      'gen-node-card--collapsed': isCollapsed,
      'gen-node-card--no-children': member.childIds.length === 0,
    }"
    @click.stop="handleClick"
  >
    <!-- Collapse/Expand Toggle -->
    <button
      v-if="member.childIds.length > 0"
      class="gen-node-card__toggle"
      @click.stop="handleToggleCollapse"
      :title="isCollapsed ? '展开后代' : '折叠后代'"
    >
      {{ isCollapsed ? '⊞' : '⊟' }}
    </button>

    <!-- Main Name -->
    <div class="gen-node-card__name">
      <span class="gen-node-card__name-text">{{ member.member.name }}</span>
      <span
        v-if="member.aliases.length > 0"
        class="gen-node-card__alias"
        :title="member.aliases.join(', ')"
      >
        ({{ member.aliases[0] }})
      </span>
    </div>

    <!-- Spouse Info -->
    <div v-if="member.spouses.length > 0" class="gen-node-card__spouses">
      <span
        v-for="spouse in member.spouses"
        :key="spouse.id"
        class="gen-node-card__spouse"
      >
        {{ spouse.relationLabel }}{{ spouse.name }}
      </span>
    </div>

    <!-- Birth/Death Summary -->
    <div
      v-if="member.birthDeathSummary"
      class="gen-node-card__dates"
    >
      {{ member.birthDeathSummary }}
    </div>

    <!-- Branch Label -->
    <div
      v-if="member.member.lineageBranch"
      class="gen-node-card__branch"
    >
      {{ member.member.lineageBranch }}
    </div>

    <!-- Collapsed Indicator -->
    <div
      v-if="isCollapsed"
      class="gen-node-card__collapsed-badge"
    >
      {{ member.childIds.length }} 子女
    </div>
  </div>
</template>

<style scoped>
.gen-node-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 100px;
  max-width: 180px;
  padding: 8px 12px;
  border: 2px solid #90a4ae;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  user-select: none;
  text-align: center;
  font-size: 13px;
}

.gen-node-card:hover {
  border-color: #1976d2;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.2);
  transform: translateY(-1px);
}

.gen-node-card--female {
  border-color: #e91e63;
}

.gen-node-card--female:hover {
  border-color: #c2185b;
  box-shadow: 0 2px 8px rgba(233, 30, 99, 0.2);
}

.gen-node-card--collapsed {
  border-style: dashed;
  opacity: 0.85;
}

.gen-node-card--no-children {
  border-radius: 50%;
  min-width: 80px;
  max-width: 80px;
  aspect-ratio: 1;
  padding: 8px;
}

.gen-node-card__toggle {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid #b0bec5;
  background: #eceff1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  padding: 0;
  line-height: 1;
  color: #546e7a;
  transition: all 0.15s ease;
}

.gen-node-card__toggle:hover {
  background: #cfd8dc;
  border-color: #78909c;
}

.gen-node-card__name {
  font-weight: 600;
  color: #263238;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.gen-node-card__name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.gen-node-card__alias {
  font-size: 11px;
  font-weight: 400;
  color: #78909c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.gen-node-card__spouses {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
}

.gen-node-card__spouse {
  font-size: 11px;
  color: #5c6bc0;
  background: #e8eaf6;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
}

.gen-node-card__dates {
  margin-top: 4px;
  font-size: 10px;
  color: #9e9e9e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.gen-node-card__branch {
  margin-top: 2px;
  font-size: 10px;
  color: #8d6e63;
  font-style: italic;
}

.gen-node-card__collapsed-badge {
  margin-top: 4px;
  font-size: 10px;
  color: #ef6c00;
  background: #fff3e0;
  padding: 1px 6px;
  border-radius: 8px;
}
</style>