<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Member } from '../types/member'

type SortKey = 'id' | 'name' | 'gender' | 'generation'

const props = defineProps<{
  members: Member[]
  selectedId: number | null
  findParentName: (id: number | null) => string
  generationMap: Map<number, number>
}>()

const emit = defineEmits<{
  select: [id: number]
  edit: [id: number]
  remove: [id: number]
  search: [keyword: string]
}>()

const searchKeyword = ref('')
const sortKey = ref<SortKey>('id')

const filteredMembers = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  let list = props.members

  if (keyword) {
    list = list.filter((member) => {
      return member.name.toLowerCase().includes(keyword) || String(member.id).includes(keyword)
    })
  }

  const key = sortKey.value
  return [...list].sort((a, b) => {
    if (key === 'id') return a.id - b.id
    if (key === 'name') return a.name.localeCompare(b.name, 'zh-CN')
    if (key === 'gender') return a.gender.localeCompare(b.gender)
    if (key === 'generation') {
      const ga = props.generationMap.get(a.id) ?? 0
      const gb = props.generationMap.get(b.id) ?? 0
      return ga - gb || a.id - b.id
    }
    return 0
  })
})

const resultLabel = computed(() => {
  return `匹配 ${filteredMembers.value.length} / 共 ${props.members.length}`
})

watch(searchKeyword, (value) => {
  emit('search', value)
})

function clearSearch() {
  searchKeyword.value = ''
}

function selectFirstResult() {
  if (filteredMembers.value.length > 0) {
    emit('select', filteredMembers.value[0].id)
  }
}

function getGeneration(id: number): number {
  return props.generationMap.get(id) ?? 0
}
</script>

<template>
  <section class="panel-block">
    <h3>族员名录</h3>

    <div class="list-tools">
      <div class="list-search">
        <input
          v-model="searchKeyword"
          type="text"
          class="search-input"
          placeholder="搜索姓名或 ID"
          @keydown.enter.prevent="selectFirstResult"
        />
        <button class="btn-ghost" type="button" @click="clearSearch">清空</button>
      </div>
      <div class="list-sort">
        <label class="sort-label">
          排序：
          <select v-model="sortKey" class="sort-select">
            <option value="id">ID</option>
            <option value="name">姓名</option>
            <option value="gender">性别</option>
            <option value="generation">世代</option>
          </select>
        </label>
      </div>
      <p class="search-meta">{{ resultLabel }}</p>
    </div>

    <ul class="member-list">
      <li
        v-for="member in filteredMembers"
        :key="member.id"
        :class="['member-item', { active: member.id === selectedId }]"
        @click="emit('select', member.id)"
      >
        <div class="member-text">
          <strong>{{ member.name }}</strong>
          <span>{{ member.gender }} | ID {{ member.id }} | 第{{ getGeneration(member.id) }}代</span>
          <span>
            {{ member.parentId === null ? '始祖' : `父：${findParentName(member.parentId)}` }}
          </span>
        </div>

        <div class="member-actions" @click.stop>
          <button class="btn-ghost" type="button" @click="emit('edit', member.id)">编辑</button>
          <button class="btn-danger" type="button" @click="emit('remove', member.id)">删除</button>
        </div>
      </li>

      <li v-if="filteredMembers.length === 0" class="member-empty">未匹配到族员</li>
    </ul>
  </section>
</template>

<style scoped>
.list-sort {
  margin: 4px 0;
}

.sort-label {
  font-size: 0.82em;
  color: #555;
}

.sort-select {
  padding: 2px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.95em;
  background: #fff;
}
</style>
