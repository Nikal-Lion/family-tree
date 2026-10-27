<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Alert, Button, Card, Descriptions, Space, Tag } from 'ant-design-vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import LoginUserManager from '../components/LoginUserManager.vue'
import { initAuthSession, useAuth } from '../services/authService'
import { getD1ApiDiagnosticsConfig, runD1SelfCheck, type D1SelfCheckResult } from '../services/d1ApiService'

const auth = useAuth()
const authorized = computed(() => auth.ready.value && auth.isSysadmin.value)
const result = ref<D1SelfCheckResult | null>(null)
const pending = ref(false)
const error = ref('')
let epoch = 0
let alive = true
const tone = computed(() => error.value || result.value?.ok === false ? 'error'
  : result.value?.status === 'warning' ? 'warning' : result.value ? 'success' : 'info')
const title = computed(() => pending.value ? '正在检测 D1 连接'
  : error.value || result.value?.ok === false ? 'D1 自检失败'
    : result.value?.status === 'warning' ? 'D1 已连接，数据库为空'
      : result.value ? 'D1 连接正常' : '尚未执行 D1 自检')
const tokenConfigured = computed(() => {
  if (!authorized.value) return false
  return result.value?.tokenConfigured ?? getD1ApiDiagnosticsConfig().tokenConfigured
})

async function check() {
  if (!authorized.value || pending.value) return
  const started = epoch
  pending.value = true
  error.value = ''
  result.value = null
  try {
    const response = await runD1SelfCheck()
    if (alive && started === epoch && authorized.value) result.value = response
  } catch (failure) {
    if (alive && started === epoch && authorized.value) {
      error.value = failure instanceof Error ? failure.message : '无法连接到 D1，请重试'
    }
  } finally {
    if (alive && started === epoch && authorized.value) pending.value = false
  }
}

watch(() => [auth.ready.value, auth.user.value, auth.isSysadmin.value] as const, () => {
  ++epoch
  result.value = null
  pending.value = false
  error.value = ''
  if (authorized.value) void check()
}, { immediate: true, flush: 'sync' })
onMounted(() => { void initAuthSession() })
onUnmounted(() => { alive = false; ++epoch })
</script>

<template>
  <div class="system-page">
    <header class="system-heading">
      <h1>系统管理</h1>
      <p>管理登录账号与访问角色，检查 Cloudflare D1 云端连接。账号修改以服务端确认结果为准；诊断仅执行真实读取，不写入示例数据。</p>
    </header>
    <Alert v-if="!auth.ready.value" type="info" show-icon message="正在验证登录权限…" />
    <Alert v-else-if="!authorized" type="error" show-icon message="无权访问系统管理" description="仅系统管理员（sysadmin）可以查看账号管理与 D1 诊断。" />
    <Space v-else direction="vertical" :size="16" class="system-content">
      <LoginUserManager />
      <Card :bordered="false" title="D1 云端诊断">
        <template #extra>
          <Button :loading="pending" @click="check"><template #icon><ReloadOutlined /></template>{{ result?.ok === false || error ? '重试' : '重新检测' }}</Button>
        </template>
        <Alert :type="tone" show-icon :message="title" :description="pending ? '正在向 Worker 发起真实请求并读取 D1 数据，请稍候。' : error || result?.message || '点击重新检测读取当前云端状态。'" class="diagnostic-alert" />
        <Descriptions bordered size="small" :column="{ xs: 1, sm: 2, md: 3 }">
          <Descriptions.Item label="状态"><Tag :color="tone">{{ pending ? '检测中' : error || result?.ok === false ? '失败' : result?.status === 'warning' ? '空库' : result ? '正常' : '未检测' }}</Tag></Descriptions.Item>
          <Descriptions.Item label="会话 Token">{{ tokenConfigured ? '已配置' : '未配置' }}</Descriptions.Item>
          <Descriptions.Item label="HTTP 状态">{{ result?.httpStatus ?? '无响应' }}</Descriptions.Item>
          <Descriptions.Item label="最近检测时间">{{ result ? new Date(result.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '—' }}</Descriptions.Item>
          <Descriptions.Item label="Schema 版本">{{ result?.schemaVersion ?? '—' }}</Descriptions.Item>
          <Descriptions.Item label="云端成员">{{ result?.ok ? result.memberCount : '—' }}</Descriptions.Item>
          <Descriptions.Item label="云端轨迹">{{ result?.ok ? result.trackCount : '—' }}</Descriptions.Item>
          <Descriptions.Item label="云端事件">{{ result?.ok ? result.eventCount : '—' }}</Descriptions.Item>
        </Descriptions>
        <p class="diagnostic-note">统计来自最近一次成功读取。网络或权限错误不代表空库；失败时不显示为 0。账号与会话不计入族谱统计。</p>
      </Card>
    </Space>
  </div>
</template>

<style scoped>
.system-page, .system-content { width: 100%; min-width: 0; }
.system-heading { margin-bottom: 20px; }
.system-heading h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
.system-heading p, .diagnostic-note { color: #64748b; overflow-wrap: anywhere; }
.system-heading p { margin: 0; }
.diagnostic-alert { margin-bottom: 16px; }
.diagnostic-note { font-size: 12px; margin: 16px 0 0; }
.system-content :deep(.ant-space-item) { min-width: 0; }
.system-content :deep(.ant-descriptions-item-content) { overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .system-content :deep(.ant-card-body) { padding: 16px; }
}
</style>
