<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Alert, Button, Form, Input, Segmented, Tag } from 'ant-design-vue'
import { ApartmentOutlined, BookOutlined, SafetyCertificateOutlined } from '@ant-design/icons-vue'
import {
  initializeFirstSysadmin,
  loginAsUserByMobile,
  loginWithSysadminPassword,
  useAuth,
} from '../services/authService'
import { resolveLoginRedirect } from '../services/accessControl'

type LoginMode = 'user' | 'sysadmin' | 'bootstrap'
const route = useRoute()
const router = useRouter()
const { role } = useAuth()
const mode = ref<LoginMode>('user')
const pending = ref(false)
const errorMessage = ref('')
const form = reactive({ mobile: '', password: '', confirmPassword: '' })
const needsPassword = computed(() => mode.value !== 'user')
const modeOptions = [
  { label: '成员 / 维护人员', value: 'user' },
  { label: '系统管理员', value: 'sysadmin' },
  { label: '首次初始化', value: 'bootstrap' },
]
const descriptions = {
  user: '使用已登记的手机号登录，系统将自动识别你的角色。',
  sysadmin: '使用管理员手机号及验证密码登录，管理家族资料与系统设置。',
  bootstrap: '仅首次使用时操作。验证密码须与服务端管理员密钥配置一致。',
}

watch(mode, () => {
  errorMessage.value = ''
  form.password = ''
  form.confirmPassword = ''
})

async function submit() {
  if (pending.value) return
  errorMessage.value = ''
  if (mode.value === 'bootstrap' && form.password !== form.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }
  pending.value = true
  try {
    const result = mode.value === 'user'
      ? await loginAsUserByMobile(form.mobile)
      : mode.value === 'sysadmin'
        ? await loginWithSysadminPassword(form.mobile, form.password)
        : await initializeFirstSysadmin(form.mobile, form.password)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    await router.replace(resolveLoginRedirect(route.query.redirect, role.value))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-story" aria-label="家族云谱介绍">
      <div class="login-brand"><BookOutlined /><span>家族云谱</span></div>
      <div class="login-story-content">
        <Tag color="purple">FAMILY · MEMORY · HERITAGE</Tag>
        <h1>每一个名字，<br />都有值得留存的故事。</h1>
        <p>连接家族的过去与现在，让世系清晰，让记忆长存。</p>
        <div class="login-tree-art" aria-hidden="true">
          <span class="art-root"><ApartmentOutlined /></span>
          <div class="art-branches"><span></span><span></span><span></span></div>
        </div>
        <div class="login-feature-row">
          <span>世系浏览</span><span>人物档案</span><span>家族记事</span>
        </div>
      </div>
      <p class="login-story-footer">记录家族世系，传承家族文化</p>
    </section>

    <section class="login-form-side">
      <div class="login-card">
        <div class="login-mobile-brand"><BookOutlined /> 家族云谱</div>
        <h2>欢迎回来</h2>
        <p class="login-subtitle">登录后，继续整理与探索你的家族故事。</p>
        <Segmented v-model:value="mode" :options="modeOptions" block :disabled="pending" />
        <p class="login-mode-description">{{ descriptions[mode] }}</p>
        <Form :model="form" layout="vertical" size="large" :disabled="pending" @finish="submit">
          <Form.Item
            label="手机号"
            name="mobile"
            :rules="[{ required: true, message: '请输入手机号' }, { pattern: /^1\d{10}$/, message: '请输入有效的 11 位手机号' }]"
          >
            <Input v-model:value="form.mobile" type="tel" autocomplete="username" placeholder="请输入已登记的手机号" :maxlength="11" />
          </Form.Item>
          <Form.Item
            v-if="needsPassword"
            label="管理员验证密码"
            name="password"
            :rules="[{ required: true, message: '请输入管理员验证密码' }]"
          >
            <Input.Password v-model:value="form.password" autocomplete="current-password" placeholder="请输入管理员验证密码" />
          </Form.Item>
          <Form.Item
            v-if="mode === 'bootstrap'"
            label="确认密码"
            name="confirmPassword"
            :rules="[{ required: true, message: '请再次输入密码' }]"
          >
            <Input.Password v-model:value="form.confirmPassword" autocomplete="current-password" placeholder="请再次输入管理员验证密码" />
          </Form.Item>
          <Alert v-if="errorMessage" :message="errorMessage" type="error" show-icon class="login-error" role="alert" />
          <Button type="primary" html-type="submit" block :loading="pending">
            {{ mode === 'bootstrap' ? '初始化并登录' : '登录' }}
          </Button>
        </Form>
        <div class="login-access-note"><SafetyCertificateOutlined /><span>账号由管理员维护，按角色开放数据与管理权限。</span></div>
      </div>
      <footer class="login-form-footer">家族云谱 · 用心留存每一代</footer>
    </section>
  </main>
</template>

<style scoped>
.login-page { display: grid; grid-template-columns: minmax(0, 1fr) minmax(480px, 1fr); min-height: 100vh; background: #fff; }
.login-story { display: flex; flex-direction: column; justify-content: space-between; padding: 40px 56px 24px; background: radial-gradient(ellipse at 20% 20%, #ecebff, transparent 60%), linear-gradient(145deg, #f6f5ff, #edf4ff); }
.login-brand { display: flex; gap: 12px; align-items: center; color: #312e81; font-size: 22px; font-weight: 700; }
.login-brand .anticon { background: #4f46e5; color: white; padding: 10px; border-radius: 12px; }
.login-story-content { max-width: 560px; margin: 60px auto; }
.login-story h1 { color: #1d2455; font-size: clamp(28px, 3vw, 46px); line-height: 1.5; font-weight: 650; margin: 24px 0 16px; letter-spacing: 1px; }
.login-story-content > p { color: #7a809b; font-size: 15px; line-height: 1.8; }
.login-tree-art { margin: 56px auto 36px; width: 240px; display: grid; justify-items: center; }
.art-root { display: grid; place-items: center; width: 70px; height: 70px; border-radius: 22px; font-size: 34px; background: #4f46e5; color: white; box-shadow: 0 12px 36px #4f46e530; }
.art-branches { display: flex; justify-content: space-between; width: 240px; border-top: 2px solid #c7c5f5; margin-top: 24px; position: relative; }
.art-branches::before { content: ''; width: 2px; height: 24px; background: #c7c5f5; position: absolute; left: 50%; top: -26px; }
.art-branches span { display: block; width: 48px; height: 48px; margin-top: 24px; background: white; border: 1px solid #e2e0ff; border-radius: 14px; box-shadow: 0 8px 24px #4f46e510; position: relative; }
.art-branches span::before { content: ''; width: 2px; height: 24px; background: #c7c5f5; position: absolute; left: 50%; top: -25px; }
.login-feature-row { display: flex; gap: 32px; color: #727795; font-size: 13px; justify-content: center; }
.login-story-footer { color: #9498ae; font-size: 12px; }
.login-form-side { display: flex; justify-content: center; flex-direction: column; align-items: center; padding: 48px; position: relative; }
.login-card { width: 100%; max-width: 420px; }
.login-card h2 { font-size: 28px; font-weight: 650; color: #172033; margin: 0 0 12px; }
.login-subtitle { color: #98a2b3; margin: 0 0 30px; line-height: 1.8; }
.login-mode-description { color: #98a2b3; min-height: 44px; font-size: 12px; line-height: 1.8; margin: 16px 0 20px; }
.login-error { margin-bottom: 20px; }
.login-access-note { display: flex; justify-content: center; gap: 7px; margin-top: 24px; color: #98a2b3; font-size: 12px; line-height: 1.8; }
.login-form-footer { position: absolute; bottom: 24px; color: #b0b7c3; font-size: 12px; }
.login-mobile-brand { display: none; }
@media (max-width: 900px) {
  .login-page { grid-template-columns: 1fr; }
  .login-story { display: none; }
  .login-form-side { min-height: 100vh; padding: 40px 24px 80px; }
  .login-mobile-brand { display: block; color: #4f46e5; font-size: 20px; font-weight: 700; margin-bottom: 36px; }
}
</style>
