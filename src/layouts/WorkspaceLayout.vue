<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { VbenAdminLayout } from '@vben-core/layout-ui'
import {
  ApartmentOutlined,
  BookOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue'
import { Breadcrumb, Button, Dropdown, Menu, Tag, message } from 'ant-design-vue'
import { getWorkspaceEntries } from '../services/accessControl'
import { logout, useAuth } from '../services/authService'

const route = useRoute()
const router = useRouter()
const { role, user, canMaintain, isAuthenticated, ready } = useAuth()
const browsing = computed(() => route.path === '/app/overview')
const entries = computed(() => getWorkspaceEntries(role.value))
const roleLabels = { anonymous: '未登录', user: '家族成员', maintainer: '维护人员', sysadmin: '系统管理员' }
const icons = { overview: ApartmentOutlined, manage: TeamOutlined, system: SettingOutlined }
const selectedKeys = computed(() => [route.path])
const collapsed = ref(false)
const loggingOut = ref(false)
const media = window.matchMedia('(max-width: 767px)')
const mobile = ref(media.matches)

function updateViewport() {
  mobile.value = media.matches
  if (mobile.value) collapsed.value = true
}
updateViewport()
media.addEventListener('change', updateViewport)
onBeforeUnmount(() => media.removeEventListener('change', updateViewport))

watch(
  [ready, isAuthenticated],
  ([authReady, authenticated]) => {
    if (authReady && !authenticated) {
      void router.replace({ path: '/login', query: { redirect: route.fullPath } })
    }
  },
  { immediate: true },
)

async function navigate(path: string) {
  await router.push(path)
  if (mobile.value) collapsed.value = true
}

async function handleLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await logout()
    // Reload to discard the previous account's in-memory workspace and pending UI state.
    window.location.replace('/login')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '退出登录失败')
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <VbenAdminLayout
    v-model:sidebar-collapse="collapsed"
    :layout="browsing ? 'header-nav' : 'sidebar-nav'"
    :sidebar-enable="!browsing"
    :is-mobile="mobile"
    :sidebar-width="224"
    :side-collapse-width="64"
    :sidebar-draggable="false"
    :sidebar-expand-on-hover="true"
    :sidebar-fixed-button="false"
    :sidebar-collapsed-button="false"
    :header-toggle-sidebar-button="false"
    :tabbar-enable="false"
    :footer-enable="false"
    :header-height="64"
    sidebar-theme="light"
    header-theme="light"
    :content-padding="0"
    class="workspace-shell"
    :class="{ 'workspace-shell-browse': browsing, 'workspace-shell-collapsed': collapsed && !mobile }"
  >
    <template #logo>
      <RouterLink class="workspace-brand" to="/app/overview" aria-label="家族云谱首页">
        <span class="workspace-brand-icon"><BookOutlined /></span>
        <span v-if="!collapsed || browsing || mobile">家族云谱</span>
      </RouterLink>
    </template>

    <template #menu>
      <div class="workspace-menu-caption" v-if="!collapsed">工作空间</div>
      <Menu
        mode="inline"
        :selected-keys="selectedKeys"
        :inline-collapsed="!mobile && collapsed"
        class="workspace-menu"
        @click="({ key }) => navigate(String(key))"
      >
        <Menu.Item v-for="entry in entries" :key="entry.path">
          <template #icon><component :is="icons[entry.mode]" /></template>
          <span>{{ entry.title }}</span>
        </Menu.Item>
      </Menu>
      <div v-if="!collapsed" class="workspace-sidebar-note">
        <strong>让家族记忆有迹可循</strong>
        <span>整理世系，留存故事，传承家风。</span>
      </div>
    </template>

    <template #header>
      <div class="workspace-header">
        <div class="workspace-header-context">
          <Button
            v-if="!browsing"
            type="text"
            :aria-label="collapsed ? '展开导航' : '收起导航'"
            :aria-expanded="!collapsed"
            @click="collapsed = !collapsed"
          >
            <template #icon><MenuUnfoldOutlined v-if="collapsed" /><MenuFoldOutlined v-else /></template>
          </Button>
          <span v-if="browsing" class="workspace-browse-label">家族的故事，从这里读起</span>
          <Breadcrumb v-else>
            <Breadcrumb.Item>工作空间</Breadcrumb.Item>
            <Breadcrumb.Item>{{ route.meta.title }}</Breadcrumb.Item>
          </Breadcrumb>
        </div>
        <div class="workspace-account">
          <Button v-if="browsing && canMaintain" @click="navigate('/app/manage')">进入管理</Button>
          <Button v-else-if="!browsing" type="text" @click="navigate('/app/overview')">浏览族谱</Button>
          <Tag color="blue" class="workspace-role">{{ roleLabels[role] }}</Tag>
          <Dropdown :trigger="['click']">
            <Button type="text" class="workspace-account-button" aria-label="账号菜单">
              <span class="workspace-avatar">{{ user?.mobile.slice(-2) }}</span>
              <span class="workspace-account-mobile">{{ user?.mobile }}</span>
            </Button>
            <template #overlay>
              <Menu @click="handleLogout">
                <Menu.Item key="logout" :disabled="loggingOut">
                  <template #icon><LogoutOutlined /></template>
                  退出登录
                </Menu.Item>
              </Menu>
            </template>
          </Dropdown>
        </div>
      </div>
    </template>

    <template #content>
      <RouterView />
    </template>
  </VbenAdminLayout>
</template>
