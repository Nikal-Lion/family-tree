<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { FamilyEvent, FamilyEventInput, FamilyEventType, Member } from '../types/member'

const EVENT_TYPES: FamilyEventType[] = ['婚', '丧', '嫁', '娶', '生', '卒', '其他']

const props = defineProps<{
  events: FamilyEvent[]
  members: Member[]
  readonly?: boolean
}>()

const emit = defineEmits<{
  add: [payload: FamilyEventInput]
  update: [payload: { id: number; input: FamilyEventInput }]
  remove: [id: number]
}>()

const editingId = computed(() => eventForm.id)

const eventForm = reactive<FamilyEventInput & { id: number | null }>({
  id: null,
  memberId: null,
  type: '其他',
  title: '',
  date: '',
  description: '',
})

watch(
  () => props.events,
  () => {
    if (editingId.value === null) {
      return
    }
    const stillExists = props.events.some((event) => event.id === editingId.value)
    if (!stillExists) {
      resetForm()
    }
  },
)

function resetForm(): void {
  eventForm.id = null
  eventForm.memberId = null
  eventForm.type = '其他'
  eventForm.title = ''
  eventForm.date = ''
  eventForm.description = ''
}

function beginEdit(event: FamilyEvent): void {
  eventForm.id = event.id
  eventForm.memberId = event.memberId
  eventForm.type = event.type
  eventForm.title = event.title
  eventForm.date = event.date
  eventForm.description = event.description ?? ''
}

function submitForm(): void {
  const input: FamilyEventInput = {
    memberId: eventForm.memberId,
    type: eventForm.type,
    title: eventForm.title,
    date: eventForm.date,
    description: eventForm.description,
  }

  if (eventForm.id === null) {
    emit('add', input)
    return
  }

  emit('update', { id: eventForm.id, input })
}

function removeEvent(id: number): void {
  const confirmed = window.confirm('确认删除该事件吗？')
  if (!confirmed) {
    return
  }
  emit('remove', id)
}

function findMemberName(memberId: number | null): string {
  if (memberId === null) {
    return '未关联成员'
  }
  return props.members.find((member) => member.id === memberId)?.name ?? `成员#${memberId}`
}
</script>

<template>
  <section class="panel-block event-block">
    <h3>{{ readonly ? '事件记录' : (editingId === null ? '新增事件' : '编辑事件') }}</h3>

    <template v-if="!readonly">
    <div class="field-row">
      <label class="field">
        <span>类型</span>
        <select v-model="eventForm.type">
          <option v-for="type in EVENT_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>

      <label class="field">
        <span>日期</span>
        <input v-model="eventForm.date" type="date" />
      </label>
    </div>

    <label class="field">
      <span>标题</span>
      <input v-model="eventForm.title" type="text" placeholder="例如：长子成婚" />
    </label>

    <label class="field">
      <span>关联成员（可选）</span>
      <select v-model="eventForm.memberId">
        <option :value="null">无</option>
        <option v-for="member in members" :key="member.id" :value="member.id">
          {{ member.name }}（{{ member.id }}）
        </option>
      </select>
    </label>

    <label class="field">
      <span>说明</span>
      <textarea v-model="eventForm.description" rows="2" placeholder="可记录细节"></textarea>
    </label>

    <div class="btn-row">
      <button type="button" class="btn-primary" @click="submitForm">
        {{ editingId === null ? '新增事件' : '保存事件' }}
      </button>
      <button v-if="editingId !== null" type="button" class="btn-ghost" @click="resetForm">取消编辑</button>
    </div>
    </template>

    <ul class="event-list">
      <li v-for="event in events" :key="event.id" class="event-item">
        <div class="event-text">
          <strong>{{ event.date }} · {{ event.type }} · {{ event.title }}</strong>
          <span>{{ findMemberName(event.memberId) }}</span>
          <span v-if="event.description">{{ event.description }}</span>
        </div>
        <div v-if="!readonly" class="member-actions">
          <button class="btn-ghost" type="button" @click="beginEdit(event)">编辑</button>
          <button class="btn-danger" type="button" @click="removeEvent(event.id)">删除</button>
        </div>
      </li>
      <li v-if="events.length === 0" class="member-empty">暂无事件记录</li>
    </ul>
  </section>
</template>
