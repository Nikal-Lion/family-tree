<script setup lang="ts">
import type { Member } from '../types/member'

const props = defineProps<{
  member: Member | null
  findParentName: (id: number | null) => string
  findSpouseNames: (ids: number[]) => string
}>()

const emit = defineEmits<{
  edit: [id: number]
  remove: [id: number]
}>()
</script>

<template>
  <section class="panel-block detail-block">
    <h3>成员详情</h3>

    <div v-if="member" class="detail-grid">
      <p><span>姓名</span>{{ member.name }}</p>
      <p><span>性别</span>{{ member.gender }}</p>
      <p><span>ID</span>{{ member.id }}</p>
      <p><span>父亲</span>{{ findParentName(member.parentId) }}</p>
      <p><span>配偶</span>{{ findSpouseNames(member.spouseIds) }}</p>
    </div>

    <p v-else class="empty-tip">暂无成员，请先新增族人。</p>

    <div v-if="member" class="btn-row">
      <button class="btn-primary" type="button" @click="emit('edit', member.id)">编辑</button>
      <button class="btn-danger" type="button" @click="emit('remove', member.id)">删除</button>
    </div>
  </section>
</template>
