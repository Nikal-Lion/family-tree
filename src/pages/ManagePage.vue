<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { Tabs } from 'ant-design-vue'
import MemberManager from '../components/MemberManager.vue'

const ActivityManager = defineAsyncComponent(() => import('../components/ActivityManager.vue'))
const ImportManager = defineAsyncComponent(() => import('../components/ImportManager.vue'))
</script>

<template>
  <div class="manage-page">
    <header class="manage-page-heading">
      <h1>数据维护</h1>
      <p>整理族人档案、留存家族记事，核对谱文资料。所有修改在云端确认后才算保存成功。</p>
    </header>
    <Tabs default-active-key="members">
      <Tabs.TabPane key="members" tab="族人管理"><MemberManager /></Tabs.TabPane>
      <Tabs.TabPane key="activities" tab="事件与轨迹"><ActivityManager /></Tabs.TabPane>
      <Tabs.TabPane key="imports" tab="资料与备份"><ImportManager /></Tabs.TabPane>
    </Tabs>
  </div>
</template>
