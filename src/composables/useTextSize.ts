import { readonly, ref } from 'vue'

const preferenceKey = 'family_large_text_v1'
const largeText = ref(false)
let initialized = false

export function useTextSize() {
  if (!initialized) {
    initialized = true
    try {
      largeText.value = localStorage.getItem(preferenceKey) === '1'
    } catch (error) {
      console.warn('[TextSize] 无法读取大字模式设置', error)
    }
  }

  function toggleLargeText(): boolean {
    largeText.value = !largeText.value
    try {
      localStorage.setItem(preferenceKey, largeText.value ? '1' : '0')
      return true
    } catch (error) {
      console.warn('[TextSize] 无法保存大字模式设置', error)
      return false
    }
  }

  return { largeText: readonly(largeText), toggleLargeText }
}
