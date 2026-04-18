<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  initializeFirstSysadmin,
  initAuthSession,
  loginAsUserByMobile,
  loginWithSysadminPassword,
  logout,
  useAuth,
} from '../services/authService'

const emit = defineEmits<{
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

void initAuthSession()

const { role, user } = useAuth()

type AuthView = 'idle' | 'user-login' | 'sysadmin-login' | 'bootstrap-sysadmin'

const view = ref<AuthView>('idle')
const userMobileInput = ref('')
const sysadminMobileInput = ref('')
const sysadminPasswordInput = ref('')
const bootstrapMobileInput = ref('')
const bootstrapPasswordInput = ref('')
const bootstrapConfirmPasswordInput = ref('')
const errorMessage = ref('')
const pending = ref(false)

const roleLabel = computed(() => {
  if (role.value === 'sysadmin') return '系统管理员'
  if (role.value === 'maintainer') return '数据维护人员'
  if (role.value === 'user') return '普通用户'
  return '未登录'
})

function resetForms(): void {
  userMobileInput.value = ''
  sysadminMobileInput.value = ''
  sysadminPasswordInput.value = ''
  bootstrapMobileInput.value = ''
  bootstrapPasswordInput.value = ''
  bootstrapConfirmPasswordInput.value = ''
  errorMessage.value = ''
}

function openUserLogin(): void {
  view.value = 'user-login'
  resetForms()
}

function openSysadminLogin(): void {
  view.value = 'sysadmin-login'
  resetForms()
}

function openBootstrapSysadmin(): void {
  view.value = 'bootstrap-sysadmin'
  resetForms()
}

function closeDialog(): void {
  view.value = 'idle'
  errorMessage.value = ''
}

async function handleUserLogin(): Promise<void> {
  if (pending.value) return
  pending.value = true
  errorMessage.value = ''

  try {
    const result = await loginAsUserByMobile(userMobileInput.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('notify', result.message, 'success')
    closeDialog()
  } finally {
    pending.value = false
  }
}

async function handleSysadminLogin(): Promise<void> {
  if (pending.value) return
  pending.value = true
  errorMessage.value = ''

  try {
    const result = await loginWithSysadminPassword(sysadminMobileInput.value, sysadminPasswordInput.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('notify', result.message, 'success')
    closeDialog()
  } finally {
    pending.value = false
  }
}

async function handleBootstrapSysadmin(): Promise<void> {
  if (pending.value) return
  errorMessage.value = ''

  if (bootstrapPasswordInput.value !== bootstrapConfirmPasswordInput.value) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  pending.value = true
  try {
    const result = await initializeFirstSysadmin(bootstrapMobileInput.value, bootstrapPasswordInput.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('notify', result.message, 'success')
    closeDialog()
  } finally {
    pending.value = false
  }
}

async function handleLogout(): Promise<void> {
  await logout()
  emit('notify', '已退出当前登录', 'info')
}
</script>

<template>
  <div class="auth-bar">
    <span class="auth-role" :class="`role-${role}`">
      {{ roleLabel }}
    </span>
    <span v-if="user" class="auth-mobile">{{ user.mobile }}</span>

    <template v-if="role !== 'anonymous'">
      <button class="btn-ghost btn-sm" type="button" @click="handleLogout">退出登录</button>
    </template>

    <template v-else>
      <button class="btn-ghost btn-sm" type="button" @click="openUserLogin">用户/维护登录</button>
      <button class="btn-primary btn-sm" type="button" @click="openSysadminLogin">sysadmin 登录</button>
    </template>

    <button
      v-if="role === 'anonymous'"
      class="btn-ghost btn-sm"
      type="button"
      @click="openBootstrapSysadmin"
    >
      初始化 sysadmin
    </button>
  </div>

  <teleport to="body">
    <transition name="auth-fade">
      <div v-if="view !== 'idle'" class="auth-overlay" @click.self="closeDialog">
        <div class="auth-dialog">
          <template v-if="view === 'user-login'">
            <h3>用户/维护人员登录</h3>
            <p class="auth-hint">输入手机号即可登录。账号需存在于 login_users 表。</p>
            <label class="field">
              <span>手机号</span>
              <input
                v-model="userMobileInput"
                type="tel"
                placeholder="请输入手机号"
                @keydown.enter="handleUserLogin"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleUserLogin">
                {{ pending ? '登录中...' : '登录' }}
              </button>
              <button class="btn-ghost" type="button" @click="closeDialog">取消</button>
            </div>
          </template>

          <template v-if="view === 'sysadmin-login'">
            <h3>sysadmin 登录</h3>
            <p class="auth-hint">sysadmin 需要手机号和密码，密码由服务端 Secret 校验。</p>
            <label class="field">
              <span>手机号</span>
              <input
                v-model="sysadminMobileInput"
                type="tel"
                placeholder="请输入 sysadmin 手机号"
              />
            </label>
            <label class="field">
              <span>密码</span>
              <input
                v-model="sysadminPasswordInput"
                type="password"
                placeholder="请输入 sysadmin 密码"
                @keydown.enter="handleSysadminLogin"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleSysadminLogin">
                {{ pending ? '验证中...' : '登录' }}
              </button>
              <button class="btn-ghost" type="button" @click="closeDialog">取消</button>
            </div>
          </template>

          <template v-if="view === 'bootstrap-sysadmin'">
            <h3>初始化 sysadmin</h3>
            <p class="auth-hint">仅当系统尚未存在 sysadmin 时可成功。成功后自动登录。</p>
            <label class="field">
              <span>手机号</span>
              <input
                v-model="bootstrapMobileInput"
                type="tel"
                placeholder="请输入 sysadmin 手机号"
              />
            </label>
            <label class="field">
              <span>密码</span>
              <input
                v-model="bootstrapPasswordInput"
                type="password"
                placeholder="请输入 sysadmin 密码"
              />
            </label>
            <label class="field">
              <span>确认密码</span>
              <input
                v-model="bootstrapConfirmPasswordInput"
                type="password"
                placeholder="请再次输入密码"
                @keydown.enter="handleBootstrapSysadmin"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleBootstrapSysadmin">
                {{ pending ? '初始化中...' : '初始化并登录' }}
              </button>
              <button class="btn-ghost" type="button" @click="closeDialog">取消</button>
            </div>
          </template>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.auth-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.auth-role {
  font-size: 0.82em;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  letter-spacing: 0.5px;
}

.role-sysadmin {
  background: rgba(45, 94, 44, 0.18);
  color: #2d5e2c;
}

.role-user {
  background: rgba(42, 96, 150, 0.16);
  color: #24537f;
}

.role-maintainer {
  background: rgba(119, 97, 38, 0.18);
  color: #7e5d1e;
}

.role-anonymous {
  background: rgba(182, 122, 68, 0.16);
  color: #8a5b30;
}

.auth-mobile {
  font-size: 0.8em;
  opacity: 0.92;
}

.btn-sm {
  font-size: 0.82em;
  padding: 4px 10px;
}

.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(42, 40, 31, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.auth-dialog {
  background: #fffef7;
  border: 1px solid #d8cdb4;
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 16px 48px rgba(69, 49, 26, 0.22);
}

.auth-dialog h3 {
  margin: 0 0 8px;
  color: #2d5e2c;
}

.auth-hint {
  margin: 0 0 14px;
  font-size: 0.88em;
  color: #6e6a5e;
  line-height: 1.5;
}

.auth-error {
  margin: 6px 0;
  color: #a44436;
  background: #fff3f0;
  border: 1px solid #e4b5ad;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 0.88em;
}

.auth-fade-enter-active,
.auth-fade-leave-active {
  transition: opacity 0.2s ease;
}

.auth-fade-enter-from,
.auth-fade-leave-to {
  opacity: 0;
}
</style>
