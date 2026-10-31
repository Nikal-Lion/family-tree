<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Alert, Button, Card, Form, Input, Space } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import { changeOwnPassword, logout, useAuth } from '../services/authService'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../services/passwordPolicy'

const router = useRouter()
const { user, needsPasswordChange, resolveDefaultAppPath } = useAuth()
const form = reactive({ currentPassword: '', newPassword: '', confirmation: '' })
const pending = ref(false)
const error = ref('')

async function submit() {
  if (pending.value) return
  error.value = ''
  if (form.newPassword !== form.confirmation) {
    error.value = '两次输入的新密码不一致'
    return
  }
  pending.value = true
  try {
    const result = await changeOwnPassword(form.currentPassword, form.newPassword)
    if (!result.ok) { error.value = result.message; return }
    form.currentPassword = ''
    form.newPassword = ''
    form.confirmation = ''
    window.location.replace('/login?passwordChanged=1')
  } finally { pending.value = false }
}
async function signOut() {
  if (pending.value) return
  pending.value = true
  await logout()
  window.location.replace('/login')
}
</script>

<template>
  <main class="password-page">
    <Card title="设置自己的密码" class="password-card">
      <p>账号：{{ user?.mobile }}</p>
      <Alert v-if="needsPasswordChange" type="warning" show-icon message="请先修改初始密码" description="完成前只能修改密码或退出登录，暂不能访问族谱和管理功能。旧管理员的“当前密码”为原服务端验证密码。" />
      <p>新密码须为 {{ PASSWORD_MIN_LENGTH }}–{{ PASSWORD_MAX_LENGTH }} 个字符，建议使用密码管理器生成，或使用较长且不易猜测的短语。修改后所有设备需要重新登录。</p>
      <Form :model="form" layout="vertical" :disabled="pending" @finish="submit">
        <Form.Item label="当前密码或临时密码" name="currentPassword" :rules="[{required:true,message:'请输入当前密码'}]">
          <Input.Password v-model:value="form.currentPassword" autocomplete="current-password" :maxlength="1024" />
        </Form.Item>
        <Form.Item label="新密码" name="newPassword" :rules="[{required:true,message:'请输入新密码'}]">
          <Input.Password v-model:value="form.newPassword" autocomplete="new-password" :maxlength="PASSWORD_MAX_LENGTH" />
        </Form.Item>
        <Form.Item label="确认新密码" name="confirmation" :rules="[{required:true,message:'请再次输入新密码'}]">
          <Input.Password v-model:value="form.confirmation" autocomplete="new-password" :maxlength="PASSWORD_MAX_LENGTH" />
        </Form.Item>
        <Alert v-if="error" type="error" show-icon :message="error" role="alert" class="password-error" />
        <Space wrap>
          <Button type="primary" html-type="submit" :loading="pending">保存新密码</Button>
          <Button v-if="!needsPasswordChange" :disabled="pending" @click="router.replace(resolveDefaultAppPath())">返回</Button>
          <Button :disabled="pending" @click="signOut">退出登录</Button>
        </Space>
      </Form>
    </Card>
  </main>
</template>

<style scoped>
.password-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f5f7fb; }
.password-card { width: 100%; max-width: 520px; }
.password-card p { color: #64748b; line-height: 1.8; overflow-wrap: anywhere; }
.password-error { margin-bottom: 16px; }
</style>
