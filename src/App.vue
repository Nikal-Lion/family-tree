<script setup lang="ts">
import { RouterView } from 'vue-router'
import { ConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
</script>

<template>
  <ConfigProvider
    :locale="zhCN"
    :theme="{ token: { colorPrimary: '#4f46e5', borderRadius: 8, fontFamily: 'Inter, system-ui, sans-serif' } }"
  >
    <RouterView />
  </ConfigProvider>
</template>
