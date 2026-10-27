<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Alert, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Image, Input,
  InputNumber, List, Modal, Select, Space, Table, Tag, message,
  type TableProps,
} from 'ant-design-vue'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons-vue'
import { useFamilyStore } from '../stores/familyStore'
import { createMemberInput } from '../services/memberProfile'
import { computeGenerations } from '../services/generationService'
import { childClaimAdoptionLabel } from '../services/childClaimService'
import { canAssignParent } from '../services/validators'
import type { Member, UncertaintyFlag } from '../types/member'
import type { SpouseInput, SpouseRelation } from '../types/spouse'
import MemberCardList from './MemberCardList.vue'
import { useMobile } from '../composables/useMobile'

const store = useFamilyStore()
const mobile = useMobile()
const initializing = ref(true)
const loadError = ref('')
const keyword = ref('')
const gender = ref<string>()
const editingId = ref<number | null>(null)
const editorOpen = ref(false)
const detailOpen = ref(false)
const spouseOpen = ref(false)
const form = reactive(createMemberInput())
const spouseForm = reactive({ surname: '', fullName: '', relationLabel: '配' as SpouseRelation })
const flagOptions: { label: string; value: UncertaintyFlag }[] = [
  { label: '信息缺失', value: 'missing' }, { label: '推定信息', value: 'estimated' },
  { label: '信息冲突', value: 'conflicting' }, { label: '待核验', value: 'unverified' },
]
const busy = computed(() => store.saving.value)
const members = computed(() => store.members.value)
const selected = computed(() => store.selectedMember.value)
const generations = computed(() => computeGenerations(members.value))
const byId = computed(() => new Map(members.value.map((member) => [member.id, member])))
const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return members.value.filter((member) => (
    (!gender.value || member.gender === gender.value)
    && (!query || [member.name, String(member.id), member.lineageBranch ?? '',
      ...store.aliases.value.filter((alias) => alias.memberId === member.id).map((alias) => alias.name),
    ].some((value) => value.toLowerCase().includes(query)))
  ))
})
const parentOptions = computed(() => members.value
  .filter((member) => editingId.value === null || canAssignParent(members.value, editingId.value, member.id))
  .map((member) => ({ label: `${member.name} · #${member.id}`, value: member.id })))
const selectedSpouses = computed(() => store.spouses.value.filter((item) => item.husbandId === selected.value?.id))
const selectedClaims = computed(() => store.childClaims.value.filter((item) => item.parentId === selected.value?.id))
const selectedAliases = computed(() => store.aliases.value.filter((item) => item.memberId === selected.value?.id))
const selectedRelations = computed(() => store.relations.value.filter((item) => item.fromMemberId === selected.value?.id || item.toMemberId === selected.value?.id))
const selectedTemporals = computed(() => store.temporals.value.filter((item) => item.memberId === selected.value?.id))
const selectedBurials = computed(() => store.burials.value.filter((item) => item.memberId === selected.value?.id))
const columns: TableProps<Member>['columns'] = [
  { title: 'ID', dataIndex: 'id', width: 76, sorter: (a, b) => a.id - b.id },
  { title: '姓名', key: 'name', width: 140 },
  { title: '性别', dataIndex: 'gender', width: 70 },
  { title: '父亲', key: 'parent', width: 130 },
  { title: '谱载代数', key: 'generation', width: 100 },
  { title: '分支', dataIndex: 'lineageBranch', width: 130 },
  { title: '出生日期', dataIndex: 'birthDate', width: 130 },
  { title: '操作', key: 'actions', width: 240 },
]
const relationLabels: Record<string, string> = {
  father: '父系', mother: '母系', spouse: '配偶', 'step-parent': '继亲',
  'adoptive-parent': '养亲 / 承继父', 'adopted-child': '养子女', successor: '承继', other: '其他',
}

async function load(refresh = false) {
  initializing.value = true
  loadError.value = ''
  try {
    if (refresh) await store.syncFromCloud()
    else await store.init()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法加载云端族谱'
  } finally {
    initializing.value = false
  }
}
onMounted(() => { void load() })

function nameOf(id: number | null) {
  return id === null ? '未关联' : byId.value.get(id)?.name ?? `#${id}`
}
function findMember(id: number) {
  const member = byId.value.get(id)
  if (!member) message.error('成员不存在，请刷新列表')
  return member
}
function openDetail(id: number) {
  if (!findMember(id)) return
  store.selectMember(id)
  detailOpen.value = true
}
function edit(id: number) {
  const member = findMember(id)
  if (member) openEditor(member)
}
function openEditor(member?: Member, parentId: number | null = null) {
  editingId.value = member?.id ?? null
  Object.assign(form, createMemberInput(member, parentId))
  editorOpen.value = true
}
async function save() {
  if (busy.value) return
  const result = editingId.value === null
    ? await store.addMember({ ...form, uncertaintyFlags: [...form.uncertaintyFlags] })
    : await store.updateMember(editingId.value, { ...form, uncertaintyFlags: [...form.uncertaintyFlags] })
  if (!result.ok) {
    message.error(result.message ?? '保存失败')
    return
  }
  editorOpen.value = false
  message.success('人物档案已保存到云端')
}
function remove(id: number) {
  const member = findMember(id)
  if (!member) return
  Modal.confirm({
    title: `删除 ${member.name}？`,
    content: `将删除该成员及后代共 ${store.getDeletionImpact(member.id)} 人，并清理其关联资料。轨迹保留为未关联记录。此操作无法撤销，请先备份。`,
    okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
    async onOk() {
      const result = await store.deleteMember(member.id)
      if (!result.ok) {
        message.error(result.message ?? '删除失败')
        throw new Error(result.message)
      }
      detailOpen.value = false
      message.success(result.message ?? '已删除')
    },
  })
}
function openSpouse() {
  Object.assign(spouseForm, { surname: '', fullName: '', relationLabel: '配' })
  spouseOpen.value = true
}
async function addSpouse() {
  if (!selected.value || busy.value) return
  const input: SpouseInput = {
    husbandId: selected.value.id, surname: spouseForm.surname.trim(),
    fullName: spouseForm.fullName.trim() || null, relationLabel: spouseForm.relationLabel,
    aliases: [], order: selectedSpouses.value.length + 1, birthDate: '', deathDate: '',
    burialPlace: '', biography: '', statusFlags: [], rawText: '',
  }
  const result = await store.addSpouseToMember(input)
  if (!result.ok) { message.error(result.message ?? '配偶保存失败'); return }
  spouseOpen.value = false
  message.success('配偶记录已保存到云端')
}
function removeSpouse(id: number) {
  Modal.confirm({
    title: '删除此配偶记录？', okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
    async onOk() {
      const result = await store.removeSpouseFromMember(id)
      if (!result.ok) { message.error(result.message ?? '删除失败'); throw new Error(result.message) }
      message.success('配偶记录已删除')
    },
  })
}
</script>

<template>
  <Space direction="vertical" :size="16" class="member-manager">
    <Alert v-if="loadError" type="error" show-icon :message="loadError">
      <template #action><Button size="small" @click="load()">重试</Button></template>
    </Alert>
    <Alert v-if="store.lastSaveError.value" type="error" show-icon message="本次修改未保存，原数据已恢复" :description="store.lastSaveError.value">
      <template #action><Button size="small" :disabled="busy" @click="load(true)">重新加载云端</Button></template>
    </Alert>
    <Alert v-if="busy" type="info" show-icon message="正在保存到云端，请勿关闭页面" />
    <Card :bordered="false" title="族人名录">
      <template #extra><Tag color="blue">{{ members.length }} 位族人</Tag></template>
      <div class="member-table-toolbar">
        <Space wrap>
          <Input v-model:value="keyword" allow-clear placeholder="搜索姓名、ID、分支或别名" class="member-search">
            <template #prefix><SearchOutlined /></template>
          </Input>
          <Select v-model:value="gender" allow-clear placeholder="全部性别" :options="[{label:'男',value:'男'}, {label:'女',value:'女'}]" style="width:120px" />
        </Space>
        <Space>
          <Button :disabled="busy || initializing" @click="load(true)"><template #icon><ReloadOutlined /></template>刷新</Button>
          <Button type="primary" :disabled="busy || initializing || !!loadError" @click="openEditor()"><template #icon><PlusOutlined /></template>新增族人</Button>
        </Space>
      </div>
      <MemberCardList v-if="mobile" :members="filtered" :all-members="members" :loading="initializing" @select="openDetail" />
      <Table v-else :columns="columns" :data-source="filtered" row-key="id" :loading="initializing" :scroll="{x:1100}" :pagination="{pageSize:10, showTotal:(total:number)=>`共 ${total} 人`}">
        <template #bodyCell="{column, record}">
          <template v-if="column.key === 'name'"><Button type="link" @click="openDetail(record.id)">{{ record.name }}</Button></template>
          <template v-else-if="column.key === 'parent'">{{ record.parentId === null ? '始祖 / 未录父亲' : nameOf(record.parentId) }}</template>
          <template v-else-if="column.key === 'generation'">{{ record.generationNumber || '未确定' }}</template>
          <template v-else-if="column.key === 'actions'">
            <Space :size="4">
              <Button type="link" size="small" @click="openDetail(record.id)">档案</Button>
              <Button type="link" size="small" :disabled="busy" @click="edit(record.id)">编辑</Button>
              <Button type="link" size="small" :disabled="busy" @click="openEditor(undefined, record.id)">添加子女</Button>
              <Button type="link" size="small" danger :disabled="busy" @click="remove(record.id)">删除</Button>
            </Space>
          </template>
        </template>
      </Table>
      <p class="member-save-note">{{ store.lastSavedAt.value ? `最近保存：${new Date(store.lastSavedAt.value).toLocaleString()}` : '数据来自云端；空库不会自动写入示例族人。' }}</p>
    </Card>
  </Space>

  <Modal v-model:open="editorOpen" :title="editingId === null ? '新增族人' : '编辑人物档案'" :footer="null" width="min(760px, calc(100vw - 32px))" :mask-closable="!busy" :closable="!busy" :keyboard="!busy" :destroy-on-close="true">
    <Form :model="form" layout="vertical" :disabled="busy" @finish="save">
      <div class="member-form-grid">
        <Form.Item label="姓名" name="name" :rules="[{required:true, whitespace:true, message:'请输入姓名'}]"><Input v-model:value="form.name" :maxlength="100" /></Form.Item>
        <Form.Item label="性别" name="gender"><Select v-model:value="form.gender" :options="[{label:'男',value:'男'},{label:'女',value:'女'}]" /></Form.Item>
        <Form.Item label="父亲"><Select :value="form.parentId ?? undefined" show-search allow-clear :options="parentOptions" option-filter-prop="label" placeholder="始祖或未录父亲" @change="value => form.parentId = typeof value === 'number' ? value : null" /></Form.Item>
        <Form.Item label="出生日期"><Input v-model:value="form.birthDate" placeholder="支持公历日期或谱载原文" /></Form.Item>
        <Form.Item label="谱载代数（0 表示未确定）"><InputNumber :value="form.generationNumber" :min="0" :precision="0" style="width:100%" @change="value=>form.generationNumber=typeof value==='number'?value:0" /></Form.Item>
        <Form.Item label="世代原文"><Input v-model:value="form.generationLabelRaw" placeholder="例如：九世" /></Form.Item>
        <Form.Item label="分支标记"><Input v-model:value="form.lineageBranch" /></Form.Item>
        <Form.Item label="照片链接"><Input v-model:value="form.photoUrl" placeholder="https://..." /></Form.Item>
      </div>
      <Form.Item label="生平"><Input.TextArea v-model:value="form.biography" :rows="3" /></Form.Item>
      <Form.Item label="谱文备注"><Input.TextArea v-model:value="form.rawNotes" :rows="3" /></Form.Item>
      <Form.Item label="不确定标记"><Checkbox.Group v-model:value="form.uncertaintyFlags" :options="flagOptions" /></Form.Item>
      <div class="member-form-actions"><Button :disabled="busy" @click="editorOpen=false">取消</Button><Button type="primary" html-type="submit" :loading="busy">保存到云端</Button></div>
    </Form>
  </Modal>

  <Drawer v-model:open="detailOpen" :title="selected ? `${selected.name} · 人物档案` : '人物档案'" width="min(680px, 100vw)">
    <template v-if="selected">
      <Space class="member-detail-actions" wrap>
        <Tag color="blue">ID {{ selected.id }}</Tag><Tag>{{ selected.gender }}</Tag>
        <Button :disabled="busy" @click="openEditor(selected)">编辑档案</Button>
        <Button :disabled="busy" @click="openEditor(undefined, selected.id)">添加子女</Button>
        <Button danger :disabled="busy" @click="remove(selected.id)">删除</Button>
      </Space>
      <Image v-if="selected.photoUrl" :src="selected.photoUrl" :width="120" :alt="selected.name" />
      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item label="父亲">{{ selected.parentId === null ? '始祖 / 未录父亲' : nameOf(selected.parentId) }}</Descriptions.Item>
        <Descriptions.Item label="出生日期">{{ selected.birthDate || '未记录' }}</Descriptions.Item>
        <Descriptions.Item label="谱载代数">{{ selected.generationNumber || '未确定' }}</Descriptions.Item>
        <Descriptions.Item label="相对树层级">{{ generations.get(selected.id) ?? '未确定' }}</Descriptions.Item>
        <Descriptions.Item label="世代原文">{{ selected.generationLabelRaw || '未记录' }}</Descriptions.Item>
        <Descriptions.Item label="分支">{{ selected.lineageBranch || '未记录' }}</Descriptions.Item>
        <Descriptions.Item label="生平"><span class="member-preserved-text">{{ selected.biography || '未记录' }}</span></Descriptions.Item>
        <Descriptions.Item label="谱文备注"><span class="member-preserved-text">{{ selected.rawNotes || '未记录' }}</span></Descriptions.Item>
        <Descriptions.Item label="不确定标记">{{ flagOptions.filter(option=>selected?.uncertaintyFlags?.includes(option.value)).map(option=>option.label).join('、') || '无' }}</Descriptions.Item>
      </Descriptions>
      <Card title="配偶记录" size="small" class="member-detail-card">
        <template #extra><Button type="link" :disabled="busy" @click="openSpouse()">添加配偶</Button></template>
        <Empty v-if="!selectedSpouses.length" :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无配偶记录" />
        <List v-else :data-source="selectedSpouses">
          <template #renderItem="{item}">
            <List.Item>
              <template #actions><Button type="link" danger :disabled="busy" @click="removeSpouse(item.id)">删除</Button></template>
              <List.Item.Meta :title="`${item.relationLabel} ${item.fullName || item.surname}`" :description="[item.birthDate && `生：${item.birthDate}`, item.deathDate && `卒：${item.deathDate}`, item.burialPlace, item.biography, item.rawText].filter(Boolean).join('；')" />
            </List.Item>
          </template>
        </List>
      </Card>
      <Card title="谱载子女声明" size="small" class="member-detail-card">
        <p v-if="!selectedClaims.length" class="member-save-note">暂无子女声明</p>
        <p v-for="claim in selectedClaims" :key="claim.id"><Tag>{{ claim.status === 'matched' ? '已匹配' : claim.status === 'ambiguous' ? '待消歧' : '待关联' }}</Tag>{{ claim.claimedName }}<Tag v-if="claim.isAdoptive">{{ childClaimAdoptionLabel({ relations: store.relations.value }, claim) }}</Tag><span v-if="claim.resolvedMemberId"> → {{ nameOf(claim.resolvedMemberId) }}</span><br /><span class="member-save-note">{{ claim.rawText }}</span></p>
      </Card>
      <Card title="别名、关系与谱文证据" size="small" class="member-detail-card">
        <p v-for="alias in selectedAliases" :key="`alias-${alias.id}`"><Tag>别名</Tag>{{ alias.name }} {{ alias.note }} {{ alias.rawText }}</p>
        <p v-for="relation in selectedRelations" :key="`relation-${relation.id}`"><Tag>{{ relationLabels[relation.type] }}</Tag>{{ nameOf(relation.fromMemberId) }} → {{ nameOf(relation.toMemberId) }} {{ relation.note }} {{ relation.rawText }}</p>
        <p v-for="temporal in selectedTemporals" :key="`time-${temporal.id}`"><Tag>纪年</Tag>{{ temporal.label }}：{{ temporal.rawText }} {{ temporal.normalizedDate }}</p>
        <p v-for="burial in selectedBurials" :key="`burial-${burial.id}`"><Tag>葬地</Tag>{{ [burial.placeRaw, burial.mountainDirection, burial.fenjin, burial.note, burial.rawText].filter(Boolean).join('；') }}</p>
        <p v-if="!selectedAliases.length && !selectedRelations.length && !selectedTemporals.length && !selectedBurials.length" class="member-save-note">暂无附加资料</p>
      </Card>
    </template>
  </Drawer>

  <Modal v-model:open="spouseOpen" title="添加配偶记录" :footer="null" :closable="!busy" :mask-closable="!busy" :keyboard="!busy">
    <Form :model="spouseForm" layout="vertical" :disabled="busy" @finish="addSpouse">
      <Form.Item label="姓氏" name="surname" :rules="[{required:true, whitespace:true,message:'请输入姓氏'}]"><Input v-model:value="spouseForm.surname" /></Form.Item>
      <Form.Item label="全名（选填）"><Input v-model:value="spouseForm.fullName" /></Form.Item>
      <Form.Item label="关系"><Select v-model:value="spouseForm.relationLabel" :options="['配','继配','妣','继妣','三妣','四妣','娶','其他'].map(value=>({label:value,value}))" /></Form.Item>
      <Button type="primary" html-type="submit" :loading="busy">保存配偶记录</Button>
    </Form>
  </Modal>
</template>
