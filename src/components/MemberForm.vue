<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Gender, Member, MemberInput } from '../types/member'

const props = defineProps<{
  members: Member[]
  editingMember: Member | null
}>()

const emit = defineEmits<{
  submit: [payload: MemberInput, id?: number]
  cancel: []
}>()

const form = defineModel<MemberInput>('form', {
  required: true,
  default: {
    name: '',
    parentId: null,
    gender: '男' as Gender,
  },
})

const modeTitle = computed(() => (props.editingMember ? '编辑族人' : '新增族人'))

const parentOptions = computed(() => {
  if (!props.editingMember) {
    return props.members
  }
  return props.members.filter((member) => member.id !== props.editingMember?.id)
})

const spouseOptions = computed(() => {
  if (!props.editingMember) {
    return props.members
  }
  return props.members.filter((member) => member.id !== props.editingMember?.id)
})

watch(
  () => props.editingMember,
  (member) => {
    if (member) {
      form.value = {
        name: member.name,
        parentId: member.parentId,
        gender: member.gender,
        spouseIds: [...member.spouseIds],
      }
      return
    }

    form.value = {
      name: '',
      parentId: null,
      gender: '男',
      spouseIds: [],
    }
  },
  { immediate: true },
)

function handleSpouseChange(event: Event) {
  const target = event.target as HTMLSelectElement
  form.value = {
    ...form.value,
    spouseIds: Array.from(target.selectedOptions)
      .map((option) => Number(option.value))
      .filter((id) => Number.isFinite(id)),
  }
}

function clearSpouses() {
  form.value = {
    ...form.value,
    spouseIds: [],
  }
}

function submitForm() {
  emit('submit', form.value, props.editingMember?.id)
}
</script>

<template>
  <section class="panel-block">
    <h3>{{ modeTitle }}</h3>

    <label class="field">
      <span>姓名 *</span>
      <input v-model="form.name" type="text" placeholder="请输入姓名" />
    </label>

    <label class="field">
      <span>父亲（可选）</span>
      <select v-model="form.parentId">
        <option :value="null">无（始祖）</option>
        <option
          v-for="member in parentOptions"
          :key="member.id"
          :value="member.id"
        >
          {{ member.name }}（{{ member.id }}）
        </option>
      </select>
    </label>

    <label class="field">
      <span>性别</span>
      <select v-model="form.gender">
        <option value="男">男</option>
        <option value="女">女</option>
      </select>
    </label>

    <label class="field">
      <span>配偶（可多选）</span>
      <select
        multiple
        :value="form.spouseIds.map(String)"
        @change="handleSpouseChange"
      >
        <option
          v-for="member in spouseOptions"
          :key="member.id"
          :value="String(member.id)"
        >
          {{ member.name }}（{{ member.id }}）
        </option>
      </select>
      <div class="btn-row">
        <button type="button" class="btn-ghost" @click="clearSpouses">清空配偶</button>
      </div>
      <small class="search-meta">可不选择配偶；已选后可点“清空配偶”取消。</small>
    </label>

    <div class="btn-row">
      <button type="button" class="btn-primary" @click="submitForm">保存</button>
      <button
        v-if="editingMember"
        type="button"
        class="btn-ghost"
        @click="emit('cancel')"
      >
        取消编辑
      </button>
    </div>
  </section>
</template>
