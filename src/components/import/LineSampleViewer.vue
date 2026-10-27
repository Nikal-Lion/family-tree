<script setup lang="ts">
import { computed } from 'vue'
import { Table } from 'ant-design-vue'
import type { FamilyData } from '../../types/member'

const props = defineProps<{ data: FamilyData; rawText: string }>()
const samples = computed(() => props.rawText.split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith('#')).slice(0, 20)
  .map((line, index) => ({
    id: index, line, matched: props.data.members.find(member => member.biography === line)?.name ?? '未匹配 / 跳过',
  })))
const columns = [
  { title: '原文（前 20 行）', dataIndex: 'line', width: 420 },
  { title: '解析为成员', dataIndex: 'matched', width: 180 },
]
</script>

<template>
  <Table :columns="columns" :data-source="samples" row-key="id" size="small" :scroll="{x:600}" :pagination="false" />
</template>
