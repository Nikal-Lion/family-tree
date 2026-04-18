<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { LoginUser, LoginUserRole } from '../types/auth'
import { createLoginUser, deleteLoginUser, listLoginUsers, updateLoginUser } from '../services/d1ApiService'

const emit = defineEmits<{
  notify: [message: string, type: 'success' | 'error' | 'info']
}>()

const users = ref<LoginUser[]>([])
const loading = ref(false)
const submitting = ref(false)
const newMobile = ref('')
const newRole = ref<LoginUserRole>('user')

function sortUsers(items: LoginUser[]): LoginUser[] {
  return [...items].sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === 'sysadmin' ? -1 : 1
    }
    return a.id - b.id
  })
}

async function refreshUsers(showToast = false): Promise<void> {
  loading.value = true
  try {
    users.value = sortUsers(await listLoginUsers())
    if (showToast) {
      emit('notify', '登录用户列表已刷新', 'success')
    }
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '加载登录用户失败', 'error')
  } finally {
    loading.value = false
  }
}

async function handleCreateUser(): Promise<void> {
  if (submitting.value) {
    return
  }

  const mobile = newMobile.value.trim()
  if (!mobile) {
    emit('notify', '手机号不能为空', 'error')
    return
  }

  submitting.value = true
  try {
    const created = await createLoginUser({ mobile, role: newRole.value })
    users.value = sortUsers([...users.value, created])
    newMobile.value = ''
    newRole.value = 'user'
    emit('notify', '登录用户创建成功', 'success')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '创建登录用户失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function handleToggleEnabled(item: LoginUser): Promise<void> {
  if (submitting.value) {
    return
  }

  submitting.value = true
  try {
    const updated = await updateLoginUser(item.id, { enabled: !item.enabled })
    users.value = sortUsers(users.value.map((entry) => (entry.id === item.id ? updated : entry)))
    emit('notify', updated.enabled ? '用户已启用' : '用户已禁用', 'success')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '更新用户状态失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function handleToggleRole(item: LoginUser): Promise<void> {
  if (submitting.value) {
    return
  }

  const nextRole: LoginUserRole = item.role === 'sysadmin' ? 'user' : 'sysadmin'

  submitting.value = true
  try {
    const updated = await updateLoginUser(item.id, { role: nextRole })
    users.value = sortUsers(users.value.map((entry) => (entry.id === item.id ? updated : entry)))
    emit('notify', `角色已更新为 ${nextRole}`, 'success')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '更新用户角色失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(item: LoginUser): Promise<void> {
  if (submitting.value) {
    return
  }

  const confirmed = window.confirm(`确认删除登录用户 ${item.mobile} 吗？`)
  if (!confirmed) {
    return
  }

  submitting.value = true
  try {
    await deleteLoginUser(item.id)
    users.value = users.value.filter((entry) => entry.id !== item.id)
    emit('notify', '登录用户已删除', 'success')
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '删除登录用户失败', 'error')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void refreshUsers()
})
</script>

<template>
  <section class="panel-block">
    <h3>登录用户管理</h3>

    <div class="field-row login-user-create-row">
      <input
        v-model="newMobile"
        type="tel"
        class="search-input"
        placeholder="输入手机号"
      />
      <select v-model="newRole">
        <option value="user">普通用户</option>
        <option value="sysadmin">sysadmin</option>
      </select>
      <button class="btn-primary" type="button" :disabled="submitting" @click="handleCreateUser">
        {{ submitting ? '处理中...' : '新增' }}
      </button>
    </div>

    <div class="btn-row login-user-tools">
      <button class="btn-ghost" type="button" :disabled="loading || submitting" @click="refreshUsers(true)">
        {{ loading ? '刷新中...' : '刷新列表' }}
      </button>
    </div>

    <ul class="member-list">
      <li v-for="item in users" :key="item.id" class="member-item">
        <div class="member-text">
          <strong>{{ item.mobile }}</strong>
          <span>
            角色: {{ item.role }} · 状态: {{ item.enabled ? '启用' : '禁用' }}
          </span>
        </div>

        <div class="member-actions">
          <button class="btn-ghost" type="button" :disabled="submitting" @click="handleToggleRole(item)">
            {{ item.role === 'sysadmin' ? '设为普通用户' : '设为 sysadmin' }}
          </button>
          <button class="btn-ghost" type="button" :disabled="submitting" @click="handleToggleEnabled(item)">
            {{ item.enabled ? '禁用' : '启用' }}
          </button>
          <button class="btn-danger" type="button" :disabled="submitting" @click="handleDelete(item)">
            删除
          </button>
        </div>
      </li>

      <li v-if="!loading && users.length === 0" class="member-empty">
        暂无登录用户，请先新增。
      </li>
    </ul>
  </section>
</template>

<style scoped>
.login-user-create-row {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.login-user-create-row select {
  border: 1px solid #ccbfa1;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fffdf8;
}

.login-user-tools {
  margin-bottom: 10px;
}
</style>
