<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { VbenAdminLayout } from '@vben-core/layout-ui'
import {
  ApartmentOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue'
import { Breadcrumb, Button, Drawer, Dropdown, Menu, Tag, message } from 'ant-design-vue'
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
const accountName = computed(() => user.value?.name?.trim() || user.value?.mobile || '账号')
const avatarText = computed(() => user.value?.name?.trim()
  ? Array.from(user.value.name.trim())[0] : user.value?.mobile.slice(-2))
const collapsed = ref(false)
const loggingOut = ref(false)
const helpOpen = ref(false)
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
        <span class="workspace-brand-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="3.5" r="2" />
            <path d="M12 5.5V9M6 11V9h12v2" />
            <circle cx="6" cy="12.5" r="1.5" />
            <circle cx="18" cy="12.5" r="1.5" />
            <path d="M3 16c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v5c-3-1-6-.5-9 1-3-1.5-6-2-9-1zM12 17.5V22" />
          </svg>
        </span>
        <span v-if="!collapsed || browsing || mobile" class="workspace-brand-name">家族云谱</span>
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
            class="workspace-navigation-toggle"
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
          <Button v-if="browsing && canMaintain" class="workspace-header-switch" @click="navigate('/app/manage')">进入管理</Button>
          <Button v-else-if="!browsing" type="text" class="workspace-header-switch" @click="navigate('/app/overview')">浏览族谱</Button>
          <Tag v-if="!browsing || canMaintain" color="blue" class="workspace-role">{{ roleLabels[role] }}</Tag>
          <Dropdown :trigger="['click']">
            <Button type="text" class="workspace-account-button" :aria-label="`账号菜单：${accountName}`">
              <span class="workspace-avatar" aria-hidden="true">{{ avatarText }}</span>
              <span class="workspace-account-name" :title="accountName">{{ accountName }}</span>
            </Button>
            <template #overlay>
              <Menu>
                <Menu.Item key="identity" disabled>{{ accountName }} · {{ user?.mobile }}</Menu.Item>
                <Menu.Item key="help" @click="helpOpen = true">
                  <template #icon><QuestionCircleOutlined /></template>
                  使用帮助
                </Menu.Item>
                <Menu.Item key="logout" :disabled="loggingOut" @click="handleLogout">
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
  <Drawer v-model:open="helpOpen" title="使用帮助" width="min(420px, 100vw)">
    <div class="workspace-browse-help">
      <h2>从找到一位家人开始</h2>
      <ol>
        <li><strong>找家人</strong><p>输入姓名或别名，结合父亲、分支和代数区分同名人物。</p></li>
        <li><strong>看资料</strong><p>打开人物资料，查看生平和已记录的亲属。点击亲属姓名，可以继续查看。</p></li>
        <li><strong>看族谱</strong><p>点击“在族谱中查看”定位人物。点击图中的人物可展开或收起后代，查看资料需使用单独的按钮。</p></li>
      </ol>
      <p>图中连线表示已记录的父子关系，配偶和承继等关系请查看人物资料。暂未记录不等于不存在，待确认的记载也不代表已确认的关系。</p>
      <p>浏览不会修改族谱。发现资料有误或需要补充时，请联系家族维护人员。</p>
    </div>
  </Drawer>
</template>
