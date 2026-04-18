<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  initAuthSession,
  initializeFirstSysadmin,
  loginAsUserByMobile,
  loginWithSysadminPassword,
  useAuth,
} from '../services/authService'

type LoginMode = 'user' | 'sysadmin' | 'bootstrap'

const router = useRouter()
const route = useRoute()
const { isAuthenticated, ready, resolveDefaultAppPath } = useAuth()

const mode = ref<LoginMode>('user')
const pending = ref(false)
const errorMessage = ref('')

const userMobile = ref('')
const sysadminMobile = ref('')
const sysadminPassword = ref('')
const bootstrapMobile = ref('')
const bootstrapPassword = ref('')
const bootstrapConfirmPassword = ref('')

const pageReady = computed(() => ready.value)

function resolveRedirectPath(): string {
  const redirectRaw =
    typeof route.query.redirect === 'string' ? route.query.redirect : resolveDefaultAppPath()
  if (!redirectRaw.startsWith('/')) {
    return resolveDefaultAppPath()
  }
  return redirectRaw
}

async function navigateAfterLogin(): Promise<void> {
  await router.replace(resolveRedirectPath())
}

async function handleUserLogin(): Promise<void> {
  if (pending.value) {
    return
  }

  pending.value = true
  errorMessage.value = ''

  try {
    const result = await loginAsUserByMobile(userMobile.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    await navigateAfterLogin()
  } finally {
    pending.value = false
  }
}

async function handleSysadminLogin(): Promise<void> {
  if (pending.value) {
    return
  }

  pending.value = true
  errorMessage.value = ''

  try {
    const result = await loginWithSysadminPassword(sysadminMobile.value, sysadminPassword.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    await navigateAfterLogin()
  } finally {
    pending.value = false
  }
}

async function handleBootstrap(): Promise<void> {
  if (pending.value) {
    return
  }

  errorMessage.value = ''
  if (bootstrapPassword.value !== bootstrapConfirmPassword.value) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  pending.value = true
  try {
    const result = await initializeFirstSysadmin(bootstrapMobile.value, bootstrapPassword.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    await navigateAfterLogin()
  } finally {
    pending.value = false
  }
}

onMounted(async () => {
  await initAuthSession()
  if (isAuthenticated.value) {
    await navigateAfterLogin()
  }
})
</script>

<template>
  <div class="login-page">
    <section v-if="pageReady" class="login-card">
      <h1>家族云谱登录</h1>
      <p class="login-subtitle">登录后可按角色访问总览、维护与系统管理页面</p>

      <div class="mode-switch">
        <button class="btn-ghost" :class="{ active: mode === 'user' }" type="button" @click="mode = 'user'">
          用户/维护人员
        </button>
        <button
          class="btn-ghost"
          :class="{ active: mode === 'sysadmin' }"
          type="button"
          @click="mode = 'sysadmin'"
        >
          sysadmin
        </button>
        <button
          class="btn-ghost"
          :class="{ active: mode === 'bootstrap' }"
          type="button"
          @click="mode = 'bootstrap'"
        >
          初始化
        </button>
      </div>

      <template v-if="mode === 'user'">
        <label class="field">
          <span>手机号</span>
          <input v-model="userMobile" type="tel" placeholder="请输入手机号" @keydown.enter="handleUserLogin" />
        </label>
        <p class="mode-tip">普通用户和维护人员均使用手机号登录。</p>
        <button class="btn-primary login-submit" type="button" :disabled="pending" @click="handleUserLogin">
          {{ pending ? '登录中...' : '登录' }}
        </button>
      </template>

      <template v-if="mode === 'sysadmin'">
        <label class="field">
          <span>sysadmin 手机号</span>
          <input v-model="sysadminMobile" type="tel" placeholder="请输入手机号" />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            v-model="sysadminPassword"
            type="password"
            placeholder="请输入密码"
            @keydown.enter="handleSysadminLogin"
          />
        </label>
        <button class="btn-primary login-submit" type="button" :disabled="pending" @click="handleSysadminLogin">
          {{ pending ? '验证中...' : '登录' }}
        </button>
      </template>

      <template v-if="mode === 'bootstrap'">
        <label class="field">
          <span>sysadmin 手机号</span>
          <input v-model="bootstrapMobile" type="tel" placeholder="请输入手机号" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="bootstrapPassword" type="password" placeholder="请输入密码" />
        </label>
        <label class="field">
          <span>确认密码</span>
          <input
            v-model="bootstrapConfirmPassword"
            type="password"
            placeholder="请再次输入密码"
            @keydown.enter="handleBootstrap"
          />
        </label>
        <button class="btn-primary login-submit" type="button" :disabled="pending" @click="handleBootstrap">
          {{ pending ? '初始化中...' : '初始化并登录' }}
        </button>
      </template>

      <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
    </section>

    <section v-else class="login-card">
      <h1>家族云谱</h1>
      <p class="login-subtitle">正在检查登录状态...</p>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-card {
  width: min(460px, 100%);
  background: #fffef7;
  border: 1px solid #d8cdb4;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(69, 49, 26, 0.18);
  padding: 24px;
}

.login-card h1 {
  margin: 0;
  color: #2d5e2c;
}

.login-subtitle {
  margin: 8px 0 16px;
  color: #6e6a5e;
}

.mode-switch {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.mode-switch .active {
  border-color: #6e8f57;
  box-shadow: inset 0 0 0 1px #6e8f57;
}

.login-submit {
  width: 100%;
  margin-top: 6px;
}

.mode-tip {
  margin: 2px 0 10px;
  color: #6e6a5e;
  font-size: 0.86em;
}

.auth-error {
  margin: 10px 0 0;
  color: #a44436;
  background: #fff3f0;
  border: 1px solid #e4b5ad;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 0.88em;
}
</style>
