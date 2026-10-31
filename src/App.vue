<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView } from 'vue-router'
import { ConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useTextSize } from './composables/useTextSize'

const { largeText } = useTextSize()
const theme = computed(() => ({
  token: {
    colorPrimary: '#4f46e5', borderRadius: 8, fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: largeText.value ? 18 : 14,
    fontSizeSM: largeText.value ? 16 : 12,
    fontSizeLG: largeText.value ? 20 : 16,
    controlHeight: largeText.value ? 44 : 32,
    controlHeightSM: largeText.value ? 40 : 24,
    controlHeightLG: largeText.value ? 48 : 40,
  },
}))
watch(largeText, (enabled) => {
  document.documentElement.classList.toggle('large-text', enabled)
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <ConfigProvider
    :locale="zhCN"
    :theme="theme"
  >
    <RouterView />
  </ConfigProvider>
</template>
