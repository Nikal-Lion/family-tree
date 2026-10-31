<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message,
  type TableProps,
} from 'ant-design-vue'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons-vue'
import { initAuthSession, updateCurrentLoginUser, useAuth } from '../services/authService'
import { createLoginUser, deleteLoginUser, listLoginUsers, updateLoginUser } from '../services/d1ApiService'
import { filterLoginUsers, isLastEnabledSysadmin, normalizeLoginMobile } from './loginUserManagerHelpers'
import type { LoginUser, LoginUserRole } from '../types/auth'

const emit = defineEmits<{
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()
const auth = useAuth()
const users = ref<LoginUser[]>([])
const loading = ref(false)
const submitting = ref(false)
const loadError = ref('')
const actionError = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(10)
const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const confirmation = ref<{ user: LoginUser; action: 'delete' | 'toggle' } | null>(null)
const form = reactive<{ mobile: string; name: string; role: LoginUserRole; password: string; confirmPassword: string }>({
  mobile: '', name: '', role: 'user', password: '', confirmPassword: '',
})
let epoch = 0
let loadSequence = 0
let alive = true
const authorized = computed(() => auth.ready.value && auth.isSysadmin.value)
const busy = computed(() => submitting.value || loading.value)
const filtered = computed(() => filterLoginUsers(users.value, keyword.value))
const needsInitialPassword = computed(() => {
  const current = users.value.find((item) => item.id === editingId.value)
  return form.role === 'maintainer'
    && (!current || current.role !== 'maintainer' || current.passwordConfigured === false)
})
const roleLabels: Record<LoginUserRole, string> = {
  user: '普通用户', maintainer: '数据维护人员', sysadmin: '系统管理员',
}
const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value, label }))
const columns: TableProps<LoginUser>['columns'] = [
  { title: 'ID', dataIndex: 'id', width: 72 },
  { title: '名称', dataIndex: 'name', width: 140 },
  { title: '登录手机号', dataIndex: 'mobile', width: 180 },
  { title: '角色', key: 'role', width: 150 },
  { title: '状态', key: 'enabled', width: 90 },
  { title: '更新时间', key: 'updatedAt', width: 180 },
  { title: '操作', key: 'actions', width: 230 },
]
const isCurrent = (started: number) => alive && authorized.value && started === epoch
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

function notify(text: string) {
  message.success(text)
  emit('notify', text, 'success')
}

async function refreshUsers(showToast = false): Promise<void> {
  if (!authorized.value) return
  const started = epoch
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  try {
    const result = await listLoginUsers()
    if (!isCurrent(started) || sequence !== loadSequence) return
    users.value = result
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
    if (showToast) notify('登录用户列表已刷新')
  } catch (error) {
    if (isCurrent(started) && sequence === loadSequence) {
      loadError.value = errorText(error, '加载登录用户失败')
    }
  } finally {
    if (isCurrent(started) && sequence === loadSequence) loading.value = false
  }
}

function isProtected(id: number) {
  const item = users.value.find((entry) => entry.id === id)
  return item ? isLastEnabledSysadmin(users.value, item) : true
}

function openEditor(id?: number) {
  if (busy.value || !authorized.value) return
  const item = users.value.find((entry) => entry.id === id)
  if (id !== undefined && !item) return
  editingId.value = item?.id ?? null
  Object.assign(form, { mobile: item?.mobile ?? '', name: item?.name ?? '', role: item?.role ?? 'user', password: '', confirmPassword: '' })
  actionError.value = ''
  editorOpen.value = true
}

async function mutate(operation: () => Promise<unknown>, success: string, close: () => void) {
  if (busy.value || !authorized.value) return
  const started = epoch
  submitting.value = true
  actionError.value = ''
  ++loadSequence
  try {
    await operation()
    if (!isCurrent(started)) return
    close()
    notify(success)
    await refreshUsers()
  } catch (error) {
    if (isCurrent(started)) actionError.value = errorText(error, '操作失败，请重试')
  } finally {
    if (isCurrent(started)) submitting.value = false
  }
}

function save() {
  const mobile = normalizeLoginMobile(form.mobile)
  if (!mobile) { actionError.value = '手机号不能为空'; return }
  if (!/^\+?\d{6,20}$/.test(mobile)) { actionError.value = '手机号须为 6–20 位数字，可带 + 国际区号'; return }
  const id = editingId.value
  const current = users.value.find((item) => item.id === id)
  if (id !== null && !current) { actionError.value = '账号已不存在，请刷新列表'; return }
  if (current && isLastEnabledSysadmin(users.value, current) && form.role !== 'sysadmin') {
    actionError.value = '至少保留一个启用中的 sysadmin'
    return
  }
  if (form.role === 'maintainer') {
    if (needsInitialPassword.value && !form.password) { actionError.value = '请为维护人员设置初始密码'; return }
    if (form.password && (form.password.length < 8 || form.password.length > 128 || !form.password.trim())) {
      actionError.value = '密码须为 8–128 个字符，且不能全为空格'
      return
    }
    if (form.password !== form.confirmPassword) { actionError.value = '两次输入的密码不一致'; return }
  }
  const input = {
    mobile, name: form.name.trim(), role: form.role,
    ...(form.role === 'maintainer' && form.password ? { password: form.password } : {}),
  }
  void mutate(
    async () => {
      const saved = await (id === null ? createLoginUser(input) : updateLoginUser(id, input))
      updateCurrentLoginUser(saved)
    },
    id === null ? '登录用户创建成功' : '登录用户已更新',
    () => { editorOpen.value = false },
  )
}

function requestAction(id: number, action: 'delete' | 'toggle') {
  if (busy.value || !authorized.value) return
  const item = users.value.find((entry) => entry.id === id)
  if (!item) return
  actionError.value = ''
  confirmation.value = { user: item, action }
}

function confirmAction() {
  const pending = confirmation.value
  if (!pending) return
  const current = users.value.find((item) => item.id === pending.user.id)
  if (!current) { actionError.value = '账号已不存在，请刷新列表'; return }
  if (isLastEnabledSysadmin(users.value, current) && (pending.action === 'delete' || current.enabled)) {
    actionError.value = '至少保留一个启用中的 sysadmin'
    return
  }
  void mutate(
    async () => {
      if (pending.action === 'delete') {
        await deleteLoginUser(current.id)
        updateCurrentLoginUser({ ...current, enabled: false })
      } else {
        const saved = await updateLoginUser(current.id, { enabled: !current.enabled })
        updateCurrentLoginUser(saved)
      }
    },
    pending.action === 'delete' ? '登录用户已删除' : current.enabled ? '用户已禁用' : '用户已启用',
    () => { confirmation.value = null },
  )
}

watch(keyword, () => { page.value = 1 })
watch(() => form.role, () => { form.password = ''; form.confirmPassword = ''; actionError.value = '' })
watch(editorOpen, (open) => {
  if (!open) { form.password = ''; form.confirmPassword = '' }
}, { flush: 'sync' })
watch(() => [auth.ready.value, auth.user.value?.id, auth.isSysadmin.value] as const, () => {
  ++epoch
  ++loadSequence
  users.value = []
  loadError.value = ''
  actionError.value = ''
  loading.value = false
  submitting.value = false
  editorOpen.value = false
  confirmation.value = null
  page.value = 1
  if (authorized.value) void refreshUsers()
}, { immediate: true, flush: 'sync' })
onMounted(() => { void initAuthSession() })
onUnmounted(() => { alive = false; ++epoch; ++loadSequence })
</script>

<template>
  <div class="login-user-manager">
    <Alert v-if="!auth.ready.value" type="info" show-icon message="正在验证登录权限…" />
    <Alert v-else-if="!authorized" type="error" show-icon message="仅系统管理员（sysadmin）可管理登录账号" />
    <Card v-else :bordered="false" title="登录账号管理">
      <template #extra><Tag color="blue">{{ users.length }} 个账号</Tag></template>
      <Alert v-if="loadError" type="error" show-icon message="账号列表刷新失败" :description="`${loadError}；当前列表可能不是最新状态，请重试。`" class="account-alert">
        <template #action><Button size="small" :disabled="busy" @click="refreshUsers()">重试</Button></template>
      </Alert>
      <div class="account-toolbar">
        <Input v-model:value="keyword" allow-clear placeholder="搜索名称、手机号、ID、角色或状态" class="account-search">
          <template #prefix><SearchOutlined /></template>
        </Input>
        <Space wrap>
          <Button :disabled="busy" @click="refreshUsers(true)"><template #icon><ReloadOutlined /></template>刷新</Button>
          <Button type="primary" :disabled="busy || !!loadError" @click="openEditor()"><template #icon><PlusOutlined /></template>新增账号</Button>
        </Space>
      </div>
      <Table
        :columns="columns" :data-source="filtered" row-key="id" :loading="loading"
        :scroll="{ x: 1000 }"
        :pagination="{ current: page, pageSize, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 个账号`, onChange: (next: number, size: number) => { page = next; pageSize = size } }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'role'"><Tag :color="record.role === 'sysadmin' ? 'purple' : record.role === 'maintainer' ? 'blue' : 'default'">{{ roleLabels[record.role as LoginUserRole] }} · {{ record.role }}</Tag></template>
          <template v-else-if="column.key === 'enabled'"><Tag :color="record.enabled ? 'success' : 'default'">{{ record.enabled ? '启用' : '禁用' }}</Tag></template>
          <template v-else-if="column.key === 'updatedAt'">{{ record.updatedAt ? new Date(record.updatedAt).toLocaleString('zh-CN') : '未记录' }}</template>
          <template v-else-if="column.key === 'actions'">
            <Space :size="4">
              <Button type="link" size="small" :disabled="busy || !!loadError" @click="openEditor(record.id)">编辑</Button>
              <Button type="link" size="small" :danger="record.enabled" :disabled="busy || !!loadError || isProtected(record.id)" @click="requestAction(record.id, 'toggle')">{{ record.enabled ? '禁用' : '启用' }}</Button>
              <Button type="link" size="small" danger :disabled="busy || !!loadError || isProtected(record.id)" @click="requestAction(record.id, 'delete')">删除</Button>
            </Space>
          </template>
        </template>
        <template #emptyText>{{ loadError ? '无法读取账号，请重试' : keyword.trim() ? '没有匹配的账号' : '暂无登录账号，请新增' }}</template>
      </Table>
      <p class="account-note">普通用户使用手机号登录，维护人员使用各自的账号密码，系统管理员沿用服务端固定密码。至少保留一个启用中的系统管理员。修改手机号、角色、启用状态或维护人员密码会退出该账号的所有登录设备；仅改名称不会退出。</p>
    </Card>

    <Modal :open="authorized && editorOpen" :title="editingId === null ? '新增登录账号' : '编辑登录账号'" :footer="null" width="min(520px, calc(100vw - 32px))" :closable="!submitting" :mask-closable="!submitting" :keyboard="!submitting" destroy-on-close @cancel="editorOpen = false">
      <Alert v-if="actionError" type="error" show-icon :message="actionError" class="account-alert" />
      <Form :model="form" layout="vertical" :disabled="submitting" @finish="save">
        <Form.Item name="name" label="用户名称">
          <Input v-model:value="form.name" :maxlength="100" placeholder="用于页面显示；未设置时显示手机号" />
        </Form.Item>
        <Form.Item name="mobile" label="登录手机号" :rules="[{ required: true, whitespace: true, message: '请输入手机号' }]">
          <Input v-model:value="form.mobile" type="tel" inputmode="tel" autocomplete="off" placeholder="6–20 位数字，可带 + 国际区号" />
        </Form.Item>
        <Form.Item name="role" label="角色" :rules="[{ required: true, message: '请选择角色' }]">
          <Select v-model:value="form.role" :options="roleOptions" />
        </Form.Item>
        <template v-if="form.role === 'maintainer'">
          <Alert type="info" show-icon :message="needsInitialPassword ? '请设置维护人员的初始密码，之后由该人员使用手机号和密码登录。' : '不修改密码请留空。重设密码后，该账号所有已登录设备都会退出。'" class="account-alert" />
          <Form.Item name="password" :label="needsInitialPassword ? '初始密码' : '重设密码（选填）'">
            <Input.Password v-model:value="form.password" :aria-label="needsInitialPassword ? '初始密码' : '重设密码（选填）'" autocomplete="new-password" placeholder="8–128 个字符，不能全为空格" :maxlength="128" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认密码">
            <Input.Password v-model:value="form.confirmPassword" aria-label="确认密码" autocomplete="new-password" placeholder="请再次输入新密码" :maxlength="128" />
          </Form.Item>
        </template>
        <Alert v-else-if="form.role === 'sysadmin'" type="info" show-icon message="系统管理员使用服务端配置的固定密码，此处无需设置密码。" class="account-alert" />
        <div class="account-form-actions">
          <Button :disabled="submitting" @click="editorOpen = false">取消</Button>
          <Button type="primary" html-type="submit" :loading="submitting">保存到云端</Button>
        </div>
      </Form>
    </Modal>
    <Modal :open="authorized && confirmation !== null" :title="confirmation?.action === 'delete' ? '确认删除登录账号？' : confirmation?.user.enabled ? '确认禁用登录账号？' : '确认启用登录账号？'" :confirm-loading="submitting" :ok-button-props="{ danger: confirmation?.action === 'delete' || confirmation?.user.enabled, disabled: busy }" :cancel-button-props="{ disabled: submitting }" :closable="!submitting" :mask-closable="!submitting" :keyboard="!submitting" ok-text="确认" cancel-text="取消" width="min(480px, calc(100vw - 32px))" @ok="confirmAction" @cancel="confirmation = null">
      <Alert v-if="actionError" type="error" show-icon :message="actionError" class="account-alert" />
      <p>账号：{{ confirmation?.user.mobile }}</p>
      <p>{{ confirmation?.action === 'delete' ? '此操作无法撤销，将同时删除该账号的登录会话。' : confirmation?.user.enabled ? '禁用后该账号无法登录，已有登录会话将被撤销。' : '启用后该账号可再次登录。' }}</p>
    </Modal>
  </div>
</template>

<style scoped>
.login-user-manager { width: 100%; min-width: 0; }
.account-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.account-search { width: 320px; max-width: 100%; }
.account-alert { margin-bottom: 16px; }
.account-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.account-form-actions :deep(.ant-btn-primary) { min-height: 44px; }
.account-note { color: #64748b; margin: 16px 0 0; font-size: 12px; overflow-wrap: anywhere; }
.login-user-manager :deep(.ant-card-body) { min-width: 0; }
.login-user-manager :deep(.ant-table-wrapper) { max-width: 100%; min-width: 0; }
.login-user-manager :deep(.ant-pagination) { flex-wrap: wrap; }
@media (max-width: 600px) {
  .login-user-manager :deep(.ant-card-body) { padding: 16px; }
  .account-search { width: 100%; }
}
</style>
