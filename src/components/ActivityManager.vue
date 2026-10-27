<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message, type TableProps } from 'ant-design-vue'
import { PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons-vue'
import { useFamilyStore } from '../stores/familyStore'
import { useAuth } from '../services/authService'
import { openTrackNavigation } from '../services/navigationBridge'
import { trackMemberIds, validateGpxFile } from '../services/trackService'
import {
  ACTIVITY_EVENT_TYPES, activityMemberName, filterActivityEvents, filterActivityTracks,
  type ActivityMemberFilter,
} from '../services/activityManager'
import type { FamilyEvent, FamilyEventInput, FamilyEventType, Track } from '../types/member'

const store = useFamilyStore()
const { canMaintain } = useAuth()
const initializing = ref(true)
const loadError = ref('')
const actionError = ref('')
const readingFile = ref(false)
const busy = computed(() => store.saving.value || readingFile.value)
const writable = computed(() => canMaintain.value && !busy.value && !initializing.value && !loadError.value)
const eventKeyword = ref('')
const eventType = ref<FamilyEventType>()
const eventMember = ref<ActivityMemberFilter>()
const trackKeyword = ref('')
const trackMember = ref<ActivityMemberFilter>()
const memberOptions = computed(() => store.members.value.map((member) => ({
  label: `${member.name} · #${member.id}`, value: member.id,
})))
const filterMemberOptions = computed(() => [
  { label: '未关联成员', value: 'unlinked' }, ...memberOptions.value,
])
const eventTypeOptions = ACTIVITY_EVENT_TYPES.map((type) => ({ label: type, value: type }))
const filteredEvents = computed(() => filterActivityEvents(
  store.events.value, store.members.value, eventKeyword.value, eventType.value, eventMember.value,
))
const filteredTracks = computed(() => filterActivityTracks(
  store.tracks.value, store.members.value, trackKeyword.value, trackMember.value,
))
const focusedTrackCount = computed(() => {
  const id = store.selectedId.value
  return id === null ? 0 : store.tracks.value.filter((track) => trackMemberIds(track).includes(id)).length
})
const eventColumns: TableProps<FamilyEvent>['columns'] = [
  { title: '日期', dataIndex: 'date', width: 130, sorter: (a, b) => a.date.localeCompare(b.date) },
  { title: '类型', key: 'type', width: 80 },
  { title: '标题', dataIndex: 'title', width: 200 },
  { title: '关联成员', key: 'member', width: 160 },
  { title: '说明', key: 'description', width: 280 },
  { title: '操作', key: 'actions', width: 140 },
]
const trackColumns: TableProps<Track>['columns'] = [
  { title: '轨迹名称', dataIndex: 'name', width: 200 },
  { title: '关联成员', key: 'member', width: 160 },
  { title: '距离', key: 'distance', width: 110, sorter: (a, b) => a.stats.distanceMeters - b.stats.distanceMeters },
  { title: '轨迹点', key: 'points', width: 100 },
  { title: '累计爬升', key: 'elevation', width: 110 },
  { title: '更新时间', key: 'updated', width: 180 },
  { title: '操作', key: 'actions', width: 230 },
]

const eventOpen = ref(false)
const eventId = ref<number | null>(null)
const eventError = ref('')
const eventForm = reactive<FamilyEventInput>({ memberId: null, type: '其他', title: '', date: '', description: '' })
const trackOpen = ref(false)
const trackId = ref<number | null>(null)
const trackError = ref('')
const trackForm = reactive<{ name: string; memberIds: number[] }>({ name: '', memberIds: [] })
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const deletion = ref<{ kind: 'event' | 'track'; id: number; name: string } | null>(null)
const deleteError = ref('')

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
function memberName(id: number | null): string {
  return activityMemberName(store.members.value, id)
}
async function load(refresh = false): Promise<void> {
  if (busy.value) return
  initializing.value = true
  loadError.value = ''
  try {
    if (refresh) {
      if (!await store.syncFromCloud()) throw new Error('未能取得云端数据，请重试')
    } else {
      await store.init()
    }
  } catch (error) {
    loadError.value = errorText(error, '无法加载事件与轨迹')
  } finally {
    initializing.value = false
  }
}
onMounted(() => { void load() })

function openEvent(id?: number): void {
  if (!writable.value) return
  const event = id === undefined ? undefined : store.events.value.find((item) => item.id === id)
  if (id !== undefined && !event) { message.error('事件不存在，请刷新列表'); return }
  eventId.value = event?.id ?? null
  Object.assign(eventForm, {
    memberId: event?.memberId ?? null, type: event?.type ?? '其他',
    title: event?.title ?? '', date: event?.date ?? '', description: event?.description ?? '',
  })
  eventError.value = ''
  eventOpen.value = true
}
async function saveEvent(): Promise<void> {
  if (!writable.value) return
  eventError.value = ''
  try {
    const result = eventId.value === null
      ? await store.addEvent({ ...eventForm })
      : await store.updateEvent(eventId.value, { ...eventForm })
    if (!result.ok) {
      eventError.value = result.message ?? '事件保存失败'
      return
    }
    eventOpen.value = false
    message.success('事件已保存到云端')
  } catch (error) {
    eventError.value = errorText(error, '事件保存失败')
  }
}
function openTrack(id?: number): void {
  if (!writable.value) return
  const track = id === undefined ? undefined : store.tracks.value.find((item) => item.id === id)
  if (id !== undefined && !track) { message.error('轨迹不存在，请刷新列表'); return }
  trackId.value = track?.id ?? null
  Object.assign(trackForm, { name: track?.name ?? '', memberIds: track ? [...trackMemberIds(track)] : [] })
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
  trackError.value = ''
  trackOpen.value = true
}
function selectFile(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0]
  if (file) {
    try {
      validateGpxFile(file)
      selectedFile.value = file
      trackError.value = ''
    } catch (error) {
      selectedFile.value = null
      trackError.value = errorText(error, '无法选择 GPX 文件')
    }
  }
  // Keep the File separately so failed uploads are retryable, including the same file.
  input.value = ''
}
function moveTrackMember(index: number, offset: number): void {
  const next = index + offset
  if (!writable.value || next < 0 || next >= trackForm.memberIds.length) return
  const ids = [...trackForm.memberIds]
  const [id] = ids.splice(index, 1)
  if (id === undefined) return
  ids.splice(next, 0, id)
  trackForm.memberIds = ids
}
async function saveTrack(): Promise<void> {
  if (!writable.value) return
  trackError.value = ''
  try {
    if (trackId.value !== null) {
      const result = await store.updateTrackMeta(trackId.value, trackForm.name, [...trackForm.memberIds])
      if (!result.ok) {
        trackError.value = result.message ?? '轨迹信息保存失败'
        return
      }
    } else {
      const file = selectedFile.value
      if (!file) { trackError.value = '请选择 GPX 文件'; return }
      validateGpxFile(file)
      readingFile.value = true
      const raw = await file.text()
      if (!canMaintain.value) { trackError.value = '当前账号没有维护权限'; return }
      const name = trackForm.name.trim() || file.name.replace(/\.gpx$/i, '')
      const result = await store.addTrackFromGpx(raw, name, [...trackForm.memberIds])
      if (!result.ok) {
        trackError.value = result.message ?? '轨迹上传失败'
        return
      }
    }
    trackOpen.value = false
    selectedFile.value = null
    message.success('轨迹已保存到云端')
  } catch (error) {
    trackError.value = errorText(error, '文件读取或轨迹保存失败，请重新选择文件后重试')
  } finally {
    readingFile.value = false
  }
}
function requestDelete(kind: 'event' | 'track', id: number, name: string): void {
  if (!writable.value) return
  deletion.value = { kind, id, name }
  deleteError.value = ''
}
async function confirmDelete(): Promise<void> {
  if (!writable.value || !deletion.value) return
  const target = deletion.value
  deleteError.value = ''
  try {
    const result = target.kind === 'event'
      ? await store.deleteEvent(target.id) : await store.deleteTrack(target.id)
    if (!result.ok) {
      deleteError.value = result.message ?? '删除失败'
      return
    }
    deletion.value = null
    message.success(target.kind === 'event' ? '事件已删除' : '轨迹已删除')
  } catch (error) {
    deleteError.value = errorText(error, '删除失败')
  }
}
function navigate(id: number): void {
  actionError.value = ''
  try {
    const track = store.tracks.value.find((item) => item.id === id)
    if (!track) throw new Error('轨迹不存在，请刷新列表')
    openTrackNavigation(track.endPoint)
    message.success('已打开终点导航页面')
  } catch (error) {
    actionError.value = errorText(error, '无法打开导航页面，请允许弹窗后重试')
  }
}
</script>

<template>
  <Space direction="vertical" :size="16" class="activity-manager">
    <Alert v-if="!canMaintain" type="warning" show-icon message="当前账号为只读权限，仅管理员和维护人员可修改事件与轨迹。" />
    <Alert v-if="loadError" type="error" show-icon :message="loadError">
      <template #action><Button size="small" :disabled="busy || initializing" @click="load(true)">重试</Button></template>
    </Alert>
    <Alert v-if="store.lastSaveError.value" type="error" show-icon message="本次修改未保存，原数据已恢复" :description="store.lastSaveError.value">
      <template #action><Button size="small" :disabled="busy || initializing" @click="load(true)">重新加载云端</Button></template>
    </Alert>
    <Alert v-if="busy" type="info" show-icon :message="readingFile ? '正在读取 GPX 或保存轨迹，请勿关闭页面' : '正在保存到云端，请勿关闭页面'" />
    <Alert v-if="actionError" type="error" show-icon :message="actionError" closable @close="actionError=''" />

    <Card :bordered="false" title="家族事件">
      <template #extra><Tag color="blue">{{ store.events.value.length }} 条事件</Tag></template>
      <div class="activity-toolbar">
        <Space wrap>
          <Input v-model:value="eventKeyword" allow-clear placeholder="搜索标题、说明、日期或成员" class="activity-search">
            <template #prefix><SearchOutlined /></template>
          </Input>
          <Select v-model:value="eventType" allow-clear placeholder="全部类型" :options="eventTypeOptions" class="activity-type" />
          <Select v-model:value="eventMember" allow-clear show-search option-filter-prop="label" placeholder="全部成员" :options="filterMemberOptions" class="activity-member" />
        </Space>
        <Space wrap>
          <Button :disabled="busy || initializing" @click="load(true)"><template #icon><ReloadOutlined /></template>刷新</Button>
          <Button v-if="canMaintain" type="primary" :disabled="!writable" @click="openEvent()"><template #icon><PlusOutlined /></template>新增事件</Button>
        </Space>
      </div>
      <Table :columns="eventColumns" :data-source="filteredEvents" row-key="id" :loading="initializing" :scroll="{x:1090}" :pagination="{pageSize:10, showTotal:(total:number)=>`共 ${total} 条事件`}" :locale="{emptyText:'暂无匹配事件'}">
        <template #bodyCell="{column, record}">
          <template v-if="column.key === 'type'"><Tag>{{ record.type }}</Tag></template>
          <template v-else-if="column.key === 'member'">{{ memberName(record.memberId) }}</template>
          <template v-else-if="column.key === 'description'"><span class="activity-text">{{ record.description || '未记录' }}</span></template>
          <template v-else-if="column.key === 'actions'">
            <Space v-if="canMaintain" :size="4">
              <Button type="link" size="small" :disabled="!writable" @click="openEvent(record.id)">编辑</Button>
              <Button type="link" size="small" danger :disabled="!writable" @click="requestDelete('event', record.id, record.title)">删除</Button>
            </Space>
            <span v-else>只读</span>
          </template>
        </template>
      </Table>
    </Card>

    <Card :bordered="false" title="扫墓轨迹">
      <template #extra><Tag color="blue">{{ store.tracks.value.length }} 条轨迹</Tag></template>
      <div class="activity-toolbar">
        <Space wrap>
          <Input v-model:value="trackKeyword" allow-clear placeholder="搜索轨迹名称、成员或 ID" class="activity-search">
            <template #prefix><SearchOutlined /></template>
          </Input>
          <Select v-model:value="trackMember" allow-clear show-search option-filter-prop="label" placeholder="全部成员" :options="filterMemberOptions" class="activity-member" />
        </Space>
        <Space wrap>
          <Button :disabled="busy || initializing" @click="load(true)"><template #icon><ReloadOutlined /></template>刷新</Button>
          <Button v-if="canMaintain" type="primary" :disabled="!writable" @click="openTrack()"><template #icon><UploadOutlined /></template>上传 GPX</Button>
        </Space>
      </div>
      <p v-if="store.selectedId.value !== null" class="activity-note">当前选中成员：{{ memberName(store.selectedId.value) }} · 关联 {{ focusedTrackCount }} 条轨迹</p>
      <Table :columns="trackColumns" :data-source="filteredTracks" row-key="id" :loading="initializing" :scroll="{x:1090}" :pagination="{pageSize:10, showTotal:(total:number)=>`共 ${total} 条轨迹`}" :locale="{emptyText:'暂无匹配轨迹，可上传 GPX 文件'}">
        <template #bodyCell="{column, record}">
          <template v-if="column.key === 'member'">{{ trackMemberIds({ memberId: record.memberId, memberIds: record.memberIds }).map((id, index) => `${index + 1}. ${memberName(id)}`).join(' → ') || '未关联成员' }}</template>
          <template v-else-if="column.key === 'distance'">{{ Math.round(record.stats.distanceMeters / 100) / 10 }} km</template>
          <template v-else-if="column.key === 'points'">{{ record.stats.pointCount }} 点</template>
          <template v-else-if="column.key === 'elevation'">{{ record.stats.elevationGainMeters === null ? '未记录' : `${record.stats.elevationGainMeters} m` }}</template>
          <template v-else-if="column.key === 'updated'">{{ new Date(record.updatedAt).toLocaleString() }}</template>
          <template v-else-if="column.key === 'actions'">
            <Space :size="4">
              <Button type="link" size="small" @click="navigate(record.id)">终点导航</Button>
              <Button v-if="canMaintain" type="link" size="small" :disabled="!writable" @click="openTrack(record.id)">编辑</Button>
              <Button v-if="canMaintain" type="link" size="small" danger :disabled="!writable" @click="requestDelete('track', record.id, record.name)">删除</Button>
            </Space>
          </template>
        </template>
      </Table>
      <p class="activity-note">{{ store.lastSavedAt.value ? `最近保存：${new Date(store.lastSavedAt.value).toLocaleString()}` : '事件与轨迹以云端保存结果为准。' }}</p>
    </Card>
  </Space>

  <Modal v-model:open="eventOpen" :title="eventId === null ? '新增事件' : '编辑事件'" :footer="null" width="min(680px, calc(100vw - 32px))" :mask-closable="!busy" :closable="!busy" :keyboard="!busy" :destroy-on-close="true">
    <Alert v-if="eventError" type="error" show-icon :message="eventError" class="activity-error" />
    <Alert v-if="!canMaintain" type="warning" message="维护权限已失效，无法保存。" class="activity-error" />
    <Form :model="eventForm" layout="vertical" :disabled="busy || !canMaintain" @finish="saveEvent">
      <div class="activity-form-grid">
        <Form.Item label="类型" name="type" :rules="[{required:true, message:'请选择事件类型'}]"><Select v-model:value="eventForm.type" :options="eventTypeOptions" /></Form.Item>
        <Form.Item label="日期" name="date" :rules="[{required:true, message:'请选择事件日期'}]"><Input v-model:value="eventForm.date" type="date" /></Form.Item>
      </div>
      <Form.Item label="标题" name="title" :rules="[{required:true, whitespace:true, message:'请输入事件标题'}]"><Input v-model:value="eventForm.title" placeholder="例如：长子成婚" /></Form.Item>
      <Form.Item label="关联成员（可选）"><Select :value="eventForm.memberId ?? undefined" allow-clear show-search option-filter-prop="label" :options="memberOptions" placeholder="未关联成员" @change="value=>eventForm.memberId=typeof value==='number'?value:null" /></Form.Item>
      <Form.Item label="说明"><Input.TextArea v-model:value="eventForm.description" :rows="4" placeholder="可记录事件细节" /></Form.Item>
      <div class="activity-form-actions"><Button :disabled="busy" @click="eventOpen=false">取消</Button><Button type="primary" html-type="submit" :disabled="!writable" :loading="busy">保存到云端</Button></div>
    </Form>
  </Modal>

  <Modal v-model:open="trackOpen" :title="trackId === null ? '上传 GPX 轨迹' : '编辑轨迹信息'" :footer="null" width="min(600px, calc(100vw - 32px))" :mask-closable="!busy" :closable="!busy" :keyboard="!busy" :destroy-on-close="true">
    <Alert v-if="trackError" type="error" show-icon :message="trackError" class="activity-error" />
    <Alert v-if="!canMaintain" type="warning" message="维护权限已失效，无法保存。" class="activity-error" />
    <Form :model="trackForm" layout="vertical" :disabled="busy || !canMaintain" @finish="saveTrack">
      <Form.Item label="轨迹名称（可选）"><Input v-model:value="trackForm.name" :placeholder="trackId === null ? '留空时使用 GPX 文件名' : '留空时保存为未命名轨迹'" /></Form.Item>
      <Form.Item label="关联族人（可多选，按下方顺序保存）">
        <Select v-model:value="trackForm.memberIds" mode="multiple" allow-clear show-search option-filter-prop="label" :options="memberOptions" placeholder="搜索并选择族人" />
        <ol v-if="trackForm.memberIds.length" class="track-member-order">
          <li v-for="(id, index) in trackForm.memberIds" :key="id">
            <span>{{ index + 1 }}. {{ memberName(id) }} · #{{ id }}</span>
            <Space :size="4">
              <Button size="small" :aria-label="`上移 ${memberName(id)}`" :disabled="!writable || index === 0" @click="moveTrackMember(index, -1)">上移</Button>
              <Button size="small" :aria-label="`下移 ${memberName(id)}`" :disabled="!writable || index === trackForm.memberIds.length - 1" @click="moveTrackMember(index, 1)">下移</Button>
            </Space>
          </li>
        </ol>
      </Form.Item>
      <Form.Item v-if="trackId === null" label="GPX 文件（上限 10MB）" required>
        <input ref="fileInput" type="file" class="gpx-file-input" aria-label="选择 GPX 文件" :disabled="busy || !canMaintain" @change="selectFile" />
        <p class="activity-note">可从手机“文件”中选择 .gpx 文件；系统文件列表不过滤类型，选取后校验格式与大小。</p>
        <p class="activity-file" aria-live="polite">{{ selectedFile ? selectedFile.name : '尚未选择文件' }}</p>
      </Form.Item>
      <div class="activity-form-actions"><Button :disabled="busy" @click="trackOpen=false">取消</Button><Button type="primary" html-type="submit" :disabled="!writable" :loading="busy">{{ trackId === null ? '上传到云端' : '保存到云端' }}</Button></div>
    </Form>
  </Modal>

  <Modal :open="deletion !== null" :title="deletion?.kind === 'event' ? '删除事件' : '删除轨迹'" ok-text="确认删除" cancel-text="取消" :ok-button-props="{danger:true, disabled:!writable}" :cancel-button-props="{disabled:busy}" :confirm-loading="busy" :mask-closable="!busy" :closable="!busy" :keyboard="!busy" @ok="confirmDelete" @cancel="deletion=null">
    <Alert v-if="deleteError" type="error" show-icon :message="deleteError" class="activity-error" />
    <p class="activity-text">确认删除「{{ deletion?.name }}」？此操作无法撤销。</p>
  </Modal>
</template>

<style scoped>
.activity-manager { display: flex; width: 100%; min-width: 0; max-width: 100%; }
.activity-manager :deep(.ant-space-item),
.activity-manager :deep(.ant-card),
.activity-manager :deep(.ant-card-body),
.activity-manager :deep(.ant-table-wrapper) { min-width: 0; max-width: 100%; }
.activity-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.activity-toolbar > :deep(.ant-space) { max-width: 100%; }
.activity-search { width: 280px; max-width: 100%; }
.activity-member { width: 200px; }
.activity-type { width: 120px; }
.activity-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.activity-note { color: #64748b; font-size: 12px; margin: 12px 0 0; overflow-wrap: anywhere; }
.activity-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.activity-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.activity-error { margin-bottom: 16px; }
.activity-file { margin: 8px 0 0; overflow-wrap: anywhere; }
.gpx-file-input { display: block; width: 100%; min-width: 0; }
.gpx-file-input::file-selector-button { padding: 6px 12px; margin-right: 8px; border: 1px solid #d0d5dd; border-radius: 6px; background: white; cursor: pointer; }
.track-member-order { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.track-member-order li { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.track-member-order li > span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .activity-manager :deep(.ant-card-body) { padding: 16px; }
  .activity-toolbar { flex-direction: column; }
  .activity-toolbar :deep(.ant-space-item) { max-width: 100%; }
  .activity-form-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
