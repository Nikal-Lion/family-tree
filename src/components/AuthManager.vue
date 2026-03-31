<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  hasAdminPassword,
  setupAdminPassword,
  loginAsAdmin,
  changeAdminPassword,
  logout,
  useAuth,
} from '../services/authService'

const emit = defineEmits<{
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const { role, isAdmin } = useAuth()

type AuthView = 'idle' | 'login' | 'setup' | 'change-password'

const view = ref<AuthView>('idle')
const passwordInput = ref('')
const oldPasswordInput = ref('')
const newPasswordInput = ref('')
const confirmPasswordInput = ref('')
const errorMessage = ref('')
const pending = ref(false)

const needsSetup = computed(() => !hasAdminPassword())
const roleLabel = computed(() => (isAdmin.value ? '管理员' : '浏览者'))

function openLogin(): void {
  if (needsSetup.value) {
    view.value = 'setup'
  } else {
    view.value = 'login'
  }
  passwordInput.value = ''
  oldPasswordInput.value = ''
  newPasswordInput.value = ''
  confirmPasswordInput.value = ''
  errorMessage.value = ''
}

function openChangePassword(): void {
  view.value = 'change-password'
  oldPasswordInput.value = ''
  newPasswordInput.value = ''
  confirmPasswordInput.value = ''
  errorMessage.value = ''
}

function closeDialog(): void {
  view.value = 'idle'
  errorMessage.value = ''
}

async function handleSetup(): Promise<void> {
  if (pending.value) return
  errorMessage.value = ''

  if (passwordInput.value !== confirmPasswordInput.value) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }

  pending.value = true
  try {
    const result = await setupAdminPassword(passwordInput.value)
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

async function handleLogin(): Promise<void> {
  if (pending.value) return
  errorMessage.value = ''
  pending.value = true
  try {
    const result = await loginAsAdmin(passwordInput.value)
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

async function handleChangePassword(): Promise<void> {
  if (pending.value) return
  errorMessage.value = ''

  if (newPasswordInput.value !== confirmPasswordInput.value) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }

  pending.value = true
  try {
    const result = await changeAdminPassword(oldPasswordInput.value, newPasswordInput.value)
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

function handleLogout(): void {
  logout()
  emit('notify', '已退出管理员身份', 'info')
}
</script>

<template>
  <div class="auth-bar">
    <span class="auth-role" :class="isAdmin ? 'role-admin' : 'role-viewer'">
      {{ roleLabel }}
    </span>

    <template v-if="isAdmin">
      <button class="btn-ghost btn-sm" type="button" @click="openChangePassword">修改密码</button>
      <button class="btn-ghost btn-sm" type="button" @click="handleLogout">退出管理</button>
    </template>
    <template v-else>
      <button class="btn-primary btn-sm" type="button" @click="openLogin">
        {{ needsSetup ? '设置管理密码' : '管理员登录' }}
      </button>
    </template>
  </div>

  <!-- Dialog overlay -->
  <teleport to="body">
    <transition name="auth-fade">
      <div v-if="view !== 'idle'" class="auth-overlay" @click.self="closeDialog">
        <div class="auth-dialog">
          <!-- Setup password -->
          <template v-if="view === 'setup'">
            <h3>首次设置管理员密码</h3>
            <p class="auth-hint">设置密码后，只有管理员才能编辑族谱数据。浏览者可自由查看。</p>
            <label class="field">
              <span>管理员密码</span>
              <input
                v-model="passwordInput"
                type="password"
                placeholder="请输入密码（至少 4 位）"
                @keydown.enter="handleSetup"
              />
            </label>
            <label class="field">
              <span>确认密码</span>
              <input
                v-model="confirmPasswordInput"
                type="password"
                placeholder="再次输入密码"
                @keydown.enter="handleSetup"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleSetup">
                {{ pending ? '设置中...' : '设置密码' }}
              </button>
              <button class="btn-ghost" type="button" @click="closeDialog">取消</button>
            </div>
          </template>

          <!-- Login -->
          <template v-if="view === 'login'">
            <h3>管理员登录</h3>
            <p class="auth-hint">输入管理员密码后即可编辑族谱数据。</p>
            <label class="field">
              <span>密码</span>
              <input
                v-model="passwordInput"
                type="password"
                placeholder="请输入管理员密码"
                @keydown.enter="handleLogin"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleLogin">
                {{ pending ? '验证中...' : '登录' }}
              </button>
              <button class="btn-ghost" type="button" @click="closeDialog">取消</button>
            </div>
          </template>

          <!-- Change password -->
          <template v-if="view === 'change-password'">
            <h3>修改管理员密码</h3>
            <label class="field">
              <span>旧密码</span>
              <input
                v-model="oldPasswordInput"
                type="password"
                placeholder="请输入当前密码"
              />
            </label>
            <label class="field">
              <span>新密码</span>
              <input
                v-model="newPasswordInput"
                type="password"
                placeholder="请输入新密码（至少 4 位）"
              />
            </label>
            <label class="field">
              <span>确认新密码</span>
              <input
                v-model="confirmPasswordInput"
                type="password"
                placeholder="再次输入新密码"
                @keydown.enter="handleChangePassword"
              />
            </label>
            <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>
            <div class="btn-row">
              <button class="btn-primary" type="button" :disabled="pending" @click="handleChangePassword">
                {{ pending ? '修改中...' : '确认修改' }}
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
}

.auth-role {
  font-size: 0.82em;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  letter-spacing: 0.5px;
}

.role-admin {
  background: rgba(45, 94, 44, 0.18);
  color: #2d5e2c;
}

.role-viewer {
  background: rgba(182, 122, 68, 0.16);
  color: #8a5b30;
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
  max-width: 380px;
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
