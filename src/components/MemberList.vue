<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Member } from '../types/member'

const props = defineProps<{
  members: Member[]
  selectedId: number | null
  findParentName: (id: number | null) => string
}>()

const emit = defineEmits<{
  select: [id: number]
  edit: [id: number]
  remove: [id: number]
  search: [keyword: string]
}>()

const searchKeyword = ref('')

const filteredMembers = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) {
    return props.members
  }

  return props.members.filter((member) => {
    return member.name.toLowerCase().includes(keyword) || String(member.id).includes(keyword)
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
          <span>{{ member.gender }} | ID {{ member.id }}</span>
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
