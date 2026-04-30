<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Gender, Member, MemberInput, UncertaintyFlag } from '../types/member'
import type { SpouseRelation } from '../types/spouse'
import { useFamilyStore } from '../stores/familyStore'
import { findSpousesByHusband } from '../services/spouseService'

const props = defineProps<{
  members: Member[]
  editingMember: Member | null
}>()

const emit = defineEmits<{
  submit: [payload: MemberInput, id?: number]
  cancel: []
}>()

const store = useFamilyStore()

const form = defineModel<MemberInput>('form', {
  required: true,
  default: {
    name: '',
    parentId: null,
    gender: '男' as Gender,
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

watch(
  () => props.editingMember,
  (member) => {
    if (member) {
      form.value = {
        name: member.name,
        parentId: member.parentId,
        gender: member.gender,
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

// Spouse subform state
const newSpouseSurname = ref('')
const newSpouseFullName = ref('')
const newSpouseRelation = ref<SpouseRelation>('配')

const currentSpouses = computed(() => {
  const id = props.editingMember?.id
  if (!id) return []
  return findSpousesByHusband({ spouses: store.spouses.value }, id)
})

function addSpouseRow() {
  const id = props.editingMember?.id
  if (!id || !newSpouseSurname.value.trim()) return
  store.addSpouseToMember({
    husbandId: id,
    surname: newSpouseSurname.value.trim(),
    fullName: newSpouseFullName.value.trim() || null,
    aliases: [],
    relationLabel: newSpouseRelation.value,
    order: currentSpouses.value.length + 1,
    birthDate: '',
    deathDate: '',
    burialPlace: '',
    biography: '',
    statusFlags: [],
    rawText: '',
  })
  newSpouseSurname.value = ''
  newSpouseFullName.value = ''
  newSpouseRelation.value = '配'
}

function removeSpouse(id: number) {
  if (!confirm('删除该配偶记录？')) return
  store.removeSpouseFromMember(id)
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

    <section v-if="editingMember" class="spouse-editor">
      <h4>配偶记录</h4>
      <ul v-if="currentSpouses.length > 0">
        <li v-for="s in currentSpouses" :key="s.id">
          [{{ s.relationLabel }}] {{ s.surname }}氏 {{ s.fullName ?? '' }}
          <button type="button" class="btn-danger btn-sm" @click="removeSpouse(s.id)">删除</button>
        </li>
      </ul>
      <p v-else class="empty-tip">暂无配偶记录。</p>
      <div class="add-spouse">
        <input v-model="newSpouseSurname" type="text" placeholder="姓 (如 孔)" />
        <input v-model="newSpouseFullName" type="text" placeholder="全名 (可选)" />
        <select v-model="newSpouseRelation">
          <option value="配">配</option>
          <option value="继配">继配</option>
          <option value="妣">妣</option>
          <option value="继妣">继妣</option>
          <option value="娶">娶</option>
          <option value="其他">其他</option>
        </select>
        <button type="button" class="btn-ghost" @click="addSpouseRow">+ 新增配偶</button>
      </div>
    </section>

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

<style scoped>
.spouse-editor {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #f9f7f0;
  border-radius: 6px;
  border: 1px solid #e8e0cc;
}

.spouse-editor h4 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  color: #5a4a2a;
}

.spouse-editor ul {
  list-style: none;
  padding: 0;
  margin: 0 0 0.5rem;
}

.spouse-editor li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid #e8e0cc;
  font-size: 0.9rem;
}

.spouse-editor li:last-child {
  border-bottom: none;
}

.add-spouse {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.add-spouse input,
.add-spouse select {
  flex: 1;
  min-width: 80px;
  padding: 0.3rem 0.5rem;
  border: 1px solid #c8b89a;
  border-radius: 4px;
  font-size: 0.9rem;
}

.btn-sm {
  padding: 0.15rem 0.5rem;
  font-size: 0.8rem;
}
</style>
