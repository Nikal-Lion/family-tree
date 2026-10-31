<script setup lang="ts">
import { FontSizeOutlined } from '@ant-design/icons-vue'
import { Button, message } from 'ant-design-vue'
import { useTextSize } from '../composables/useTextSize'

const { largeText, toggleLargeText } = useTextSize()

function toggle() {
  if (!toggleLargeText()) message.warning('大字模式已切换，但无法记住设置，下次打开时需重新选择。')
}
</script>

<template>
  <Button
    class="text-size-toggle"
    :type="largeText ? 'primary' : 'default'"
    aria-label="大字模式"
    :aria-pressed="largeText"
    :title="largeText ? '关闭大字模式' : '开启大字模式'"
    @click="toggle"
  >
    <template #icon><FontSizeOutlined /></template>
    <span class="text-size-toggle-label">大字模式</span>
  </Button>
</template>

<style scoped>
.text-size-toggle { flex-shrink: 0; min-height: 44px; height: auto; }
</style>
