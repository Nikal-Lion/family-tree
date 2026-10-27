<script setup lang="ts">
import { computed } from 'vue'
import { Collapse, Table, type TableProps } from 'ant-design-vue'
import type { FamilyData, Member } from '../../types/member'

const props = defineProps<{ data: FamilyData }>()
const byId = computed(() => new Map(props.data.members.map((member) => [member.id, member])))
const groups = computed(() => {
  const byGeneration = new Map<number, Member[]>()
  for (const member of props.data.members) {
    const number = member.generationNumber ?? 0
    const members = byGeneration.get(number) ?? []
    members.push(member)
    byGeneration.set(number, members)
  }
  return [...byGeneration.entries()].sort((a, b) => a[0] - b[0])
})
const columns: TableProps<Member>['columns'] = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '姓名', dataIndex: 'name', width: 120 },
  { title: '生父', width: 140, customRender: ({ record }) => record.parentId === null ? '未录生父' : byId.value.get(record.parentId)?.name },
  { title: '承继父', width: 140, customRender: ({ record }) => props.data.relations
    .filter((relation) => relation.fromMemberId === record.id && relation.type === 'adoptive-parent')
    .map((relation) => byId.value.get(relation.toMemberId)?.name).join('、') || '未记录' },
  { title: '分支', dataIndex: 'lineageBranch', width: 140 },
  { title: '谱文', dataIndex: 'biography', width: 320 },
]
</script>

<template>
  <Collapse>
    <Collapse.Panel v-for="[generation,members] in groups" :key="generation" :header="`${generation ? `谱载第 ${generation} 代` : '谱载代数未确定'} · ${members.length} 人`">
      <Table :columns="columns" :data-source="members" row-key="id" size="small" :scroll="{x:940}" :pagination="{pageSize:10}" />
    </Collapse.Panel>
  </Collapse>
</template>
