<script setup lang="ts">
import { computed } from 'vue'
import { computeGenerations, countByGeneration, getMaxGeneration } from '../services/generationService'
import { useFamilyStore } from '../stores/familyStore'
import type { FamilyEvent, Member, Track } from '../types/member'

const props = defineProps<{
  members: Member[]
  tracks: Track[]
  events: FamilyEvent[]
}>()

const store = useFamilyStore()

const generationMap = computed(() => computeGenerations(props.members))
const maxGeneration = computed(() => getMaxGeneration(generationMap.value))
const genCounts = computed(() => {
  const counts = countByGeneration(generationMap.value)
  const result: { gen: number; count: number }[] = []
  for (let i = 1; i <= maxGeneration.value; i++) {
    result.push({ gen: i, count: counts.get(i) ?? 0 })
  }
  return result
})

const totalMembers = computed(() => props.members.length)
const totalSpouses = computed(() => store.spouses.value.length)

const maleCount = computed(() => props.members.filter((m) => m.gender === '男').length)
const femaleCount = computed(() => props.members.filter((m) => m.gender === '女').length)

const ancestorCount = computed(
  () => props.members.filter((m) => m.parentId === null).length,
)

const malePercent = computed(() => {
  if (totalMembers.value === 0) return '0'
  return ((maleCount.value / totalMembers.value) * 100).toFixed(1)
})

const femalePercent = computed(() => {
  if (totalMembers.value === 0) return '0'
  return ((femaleCount.value / totalMembers.value) * 100).toFixed(1)
})
</script>

<template>
  <section class="panel-block stats-block">
    <h3>族谱概览</h3>

    <div v-if="totalMembers === 0" class="empty-tip">暂无成员数据</div>

    <div v-else class="stats-grid">
      <div class="stat-card">
        <span class="stat-value">{{ totalMembers }}</span>
        <span class="stat-label">总人数</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ maxGeneration }}</span>
        <span class="stat-label">世代数</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ ancestorCount }}</span>
        <span class="stat-label">始祖/分支</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ tracks.length }}</span>
        <span class="stat-label">轨迹数</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ events.length }}</span>
        <span class="stat-label">事件数</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ totalSpouses }}</span>
        <span class="stat-label">配偶记录</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{{ maleCount }}/{{ femaleCount }}</span>
        <span class="stat-label">男/女</span>
      </div>
    </div>

    <div v-if="totalMembers > 0" class="stats-detail">
      <h4>性别比例</h4>
      <div class="gender-bar">
        <div
          class="gender-male"
          :style="{ width: malePercent + '%' }"
          :title="`男 ${maleCount} 人（${malePercent}%）`"
        >
          男 {{ malePercent }}%
        </div>
        <div
          class="gender-female"
          :style="{ width: femalePercent + '%' }"
          :title="`女 ${femaleCount} 人（${femalePercent}%）`"
        >
          女 {{ femalePercent }}%
        </div>
      </div>

      <h4>各代人数</h4>
      <ul class="gen-list">
        <li v-for="item in genCounts" :key="item.gen" class="gen-item">
          <span class="gen-label">第 {{ item.gen }} 代</span>
          <span class="gen-bar-wrap">
            <span
              class="gen-bar-fill"
              :style="{ width: Math.max(8, (item.count / totalMembers) * 100) + '%' }"
            />
          </span>
          <span class="gen-count">{{ item.count }} 人</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.stats-block {
  margin-bottom: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  background: #f5f0e6;
  border-radius: 6px;
}

.stat-value {
  font-size: 1.3em;
  font-weight: 700;
  color: #2d5e2c;
}

.stat-label {
  font-size: 0.78em;
  color: #666;
  margin-top: 2px;
}

.stats-detail h4 {
  margin: 10px 0 6px;
  font-size: 0.88em;
  color: #555;
}

.gender-bar {
  display: flex;
  height: 22px;
  border-radius: 4px;
  overflow: hidden;
  font-size: 0.75em;
  line-height: 22px;
  color: #fff;
  font-weight: 600;
}

.gender-male {
  background: #4a7c59;
  text-align: center;
  min-width: 30px;
  transition: width 0.3s;
}

.gender-female {
  background: #b67a44;
  text-align: center;
  min-width: 30px;
  transition: width 0.3s;
}

.gen-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.gen-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 0.82em;
}

.gen-label {
  width: 56px;
  flex-shrink: 0;
  color: #555;
}

.gen-bar-wrap {
  flex: 1;
  height: 14px;
  background: #eee;
  border-radius: 3px;
  overflow: hidden;
}

.gen-bar-fill {
  display: block;
  height: 100%;
  background: #4a7c59;
  border-radius: 3px;
  transition: width 0.3s;
}

.gen-count {
  width: 44px;
  flex-shrink: 0;
  text-align: right;
  color: #666;
  font-size: 0.9em;
}
</style>
