<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Gender, Member, MemberInput, UncertaintyFlag } from '../types/member'

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
    spouseIds: [], // TODO Task 14: spouseIds removed from MemberInput
    birthDate: '',
    photoUrl: '',
    biography: '',
    generationLabelRaw: '',
    generationNumber: 0,
    lineageBranch: '',
    rawNotes: '',
    uncertaintyFlags: [],
  } as unknown as MemberInput,
})

const uncertaintyFlagOptions: Array<{ value: UncertaintyFlag; label: string }> = [
  { value: 'missing', label: '信息缺失' },
  { value: 'estimated', label: '推定信息' },
  { value: 'conflicting', label: '信息冲突' },
  { value: 'unverified', label: '待核验' },
]

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
        spouseIds: [...((member as any).spouseIds ?? [])], // TODO Task 14: spouseIds removed from MemberInput/Member
        birthDate: member.birthDate ?? '',
        photoUrl: member.photoUrl ?? '',
        biography: member.biography ?? '',
        generationLabelRaw: member.generationLabelRaw ?? '',
        generationNumber: member.generationNumber ?? 0,
        lineageBranch: member.lineageBranch ?? '',
        rawNotes: member.rawNotes ?? '',
        uncertaintyFlags: [...(member.uncertaintyFlags ?? [])],
      } as unknown as MemberInput
      return
    }

    form.value = {
      name: '',
      parentId: null,
      gender: '男',
      spouseIds: [], // TODO Task 14: spouseIds removed from MemberInput
      birthDate: '',
      photoUrl: '',
      biography: '',
      generationLabelRaw: '',
      generationNumber: 0,
      lineageBranch: '',
      rawNotes: '',
      uncertaintyFlags: [],
    } as unknown as MemberInput
  },
  { immediate: true },
)

function toggleUncertaintyFlag(flag: UncertaintyFlag, checked: boolean) {
  const next = new Set(form.value.uncertaintyFlags)
  if (checked) {
    next.add(flag)
  } else {
    next.delete(flag)
  }

  form.value = {
    ...form.value,
    uncertaintyFlags: [...next],
  }
}

function handleUncertaintyFlagChange(flag: UncertaintyFlag, event: Event) {
  const target = event.target as HTMLInputElement | null
  toggleUncertaintyFlag(flag, target?.checked ?? false)
}

function handleSpouseChange(event: Event) {
  const target = event.target as HTMLSelectElement
  form.value = {
    ...form.value,
    spouseIds: Array.from(target.selectedOptions) // TODO Task 14: spouseIds removed from MemberInput
      .map((option) => Number(option.value))
      .filter((id) => Number.isFinite(id)),
  } as unknown as MemberInput
}

function clearSpouses() {
  form.value = {
    ...form.value,
    spouseIds: [], // TODO Task 14: spouseIds removed from MemberInput
  } as unknown as MemberInput
}

// TODO Task 14: spouseIds removed from MemberInput — shim for template
const formSpouseIds = computed<string[]>(() => ((form.value as any).spouseIds ?? []).map(String))

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
        :value="formSpouseIds"
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

    <label class="field">
      <span>出生日期</span>
      <input v-model="form.birthDate" type="date" />
    </label>

    <label class="field">
      <span>照片链接</span>
      <input v-model="form.photoUrl" type="url" placeholder="https://example.com/photo.jpg" />
    </label>

    <label class="field">
      <span>生平</span>
      <textarea v-model="form.biography" rows="3" placeholder="可记录人物生平简介"></textarea>
    </label>

    <label class="field">
      <span>世代原文</span>
      <input v-model="form.generationLabelRaw" type="text" placeholder="如：二十四世" />
    </label>

    <label class="field">
      <span>分支标记</span>
      <input v-model="form.lineageBranch" type="text" placeholder="如：长房/三房" />
    </label>

    <label class="field">
      <span>谱文备注</span>
      <textarea v-model="form.rawNotes" rows="3" placeholder="保留纸质谱文原句、纪年或墓葬描述"></textarea>
    </label>

    <div class="field">
      <span>不确定标记</span>
      <div class="flag-options">
        <label
          v-for="item in uncertaintyFlagOptions"
          :key="item.value"
          class="flag-option"
        >
          <input
            type="checkbox"
            :checked="form.uncertaintyFlags.includes(item.value)"
            @change="handleUncertaintyFlagChange(item.value, $event)"
          />
          <span>{{ item.label }}</span>
        </label>
      </div>
    </div>

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
