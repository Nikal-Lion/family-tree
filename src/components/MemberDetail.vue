<script setup lang="ts">
import type { Member } from '../types/member'

const props = defineProps<{
  member: Member | null
  findParentName: (id: number | null) => string
  findSpouseNames: (ids: number[]) => string
  generation: number | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  edit: [id: number]
  remove: [id: number]
  addChild: [parentId: number]
}>()
</script>

<template>
  <section class="panel-block detail-block">
    <h3>成员详情</h3>

    <div v-if="member" class="detail-grid">
      <p><span>姓名</span>{{ member.name }}</p>
      <p><span>性别</span>{{ member.gender }}</p>
      <p><span>ID</span>{{ member.id }}</p>
      <p><span>世代</span>第 {{ generation ?? '?' }} 代</p>
      <p><span>父亲</span>{{ findParentName(member.parentId) }}</p>
      <p><span>配偶</span>{{ findSpouseNames(member.spouseIds) }}</p>
      <p><span>出生</span>{{ member.birthDate || '未填写' }}</p>
      <p><span>照片</span>{{ member.photoUrl || '未填写' }}</p>
      <p><span>生平</span>{{ member.biography || '未填写' }}</p>
      <img
        v-if="member.photoUrl"
        class="member-photo"
        :src="member.photoUrl"
        alt="成员照片"
        loading="lazy"
      />
    </div>

    <p v-else class="empty-tip">暂无成员，请先新增族人。</p>

    <div v-if="member && !readonly" class="btn-row">
      <button class="btn-primary" type="button" @click="emit('edit', member.id)">编辑</button>
      <button class="btn-ghost" type="button" @click="emit('addChild', member.id)">添加子女</button>
      <button class="btn-danger" type="button" @click="emit('remove', member.id)">删除</button>
    </div>
  </section>
</template>
