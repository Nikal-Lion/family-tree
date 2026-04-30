<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyData } from '../../types/member'

import type { PartDataImportReport } from '../../services/partDataImportV2'

const props = defineProps<{ data: FamilyData; report?: PartDataImportReport }>()

const generationGroups = computed(() => {
  const map = new Map<number, typeof props.data.members>()
  for (const m of props.data.members) {
    const gen = m.generationNumber ?? 0
    if (!map.has(gen)) map.set(gen, [])
    map.get(gen)!.push(m)
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
})
</script>

<template>
  <details class="member-list-block">
    <summary class="section-title">👥 成员清单 ({{ data.members.length }})</summary>
    <div class="groups">
      <details v-for="[gen, members] in generationGroups" :key="gen" class="gen-group">
        <summary>第 {{ gen }} 代 ({{ members.length }})</summary>
        <ul>
          <li v-for="m in members" :key="m.id">
            {{ m.name }} <span class="dim">(ID:{{ m.id }})</span>
          </li>
        </ul>
      </details>
    </div>
  </details>
</template>

<style scoped>
.member-list-block { border: 1px solid #ddd; border-radius: 6px; padding: 10px; margin-bottom: 12px; background: #fff; }
.section-title { font-weight: bold; cursor: pointer; color: #2d5e2c; }
.groups { padding-left: 8px; margin-top: 8px; }
.gen-group summary { cursor: pointer; font-size: 0.9rem; color: #444; padding: 2px 0; }
ul { margin: 4px 0 4px 16px; padding: 0; font-size: 0.85rem; }
.dim { color: #aaa; font-size: 0.78rem; }
</style>
