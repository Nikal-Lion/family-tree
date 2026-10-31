<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Drawer } from 'ant-design-vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; width?: string }>(), {
  width: 'min(680px, 100vw)',
})
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const content = ref<HTMLElement | null>(null)
let origin: HTMLElement | null = null
let scroll = { left: 0, top: 0 }

function modalIsOpen() {
  return [...document.querySelectorAll('.ant-modal-wrap')]
    .some(element => getComputedStyle(element).display !== 'none')
}

watch(() => props.open, (open, _previous, onCleanup) => {
  if (open) {
    origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    scroll = { left: window.scrollX, top: window.scrollY }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || modalIsOpen()) return
      emit('update:open', false)
    }
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => document.removeEventListener('keydown', onKeyDown))
  }
}, { flush: 'sync', immediate: true })

watch([content, () => props.title], () => {
  const dialog = content.value?.closest('.ant-drawer-content')
  dialog?.setAttribute('role', 'dialog')
  dialog?.setAttribute('aria-modal', 'true')
  dialog?.setAttribute('aria-label', props.title)
}, { flush: 'post' })

function restorePosition() {
  if (origin?.isConnected && origin.getClientRects().length) origin.focus({ preventScroll: true })
  window.scrollTo({ ...scroll, behavior: 'instant' })
}
function afterOpenChange(open: boolean) {
  if (open) {
    if (!modalIsOpen()) {
      content.value?.closest('.ant-drawer-content')
        ?.querySelector<HTMLButtonElement>('.ant-drawer-close')?.focus({ preventScroll: true })
    }
  } else restorePosition()
}
onBeforeUnmount(() => {
  if (props.open) restorePosition()
})
</script>

<template>
  <Drawer :open="open" :title="title" :width="width" :autofocus="false" :push="false" root-class-name="workspace-drawer" @update:open="emit('update:open', $event)" @after-open-change="afterOpenChange">
    <template v-if="$slots.extra" #extra><slot name="extra" /></template>
    <div ref="content" class="workspace-drawer-content"><slot /></div>
  </Drawer>
</template>
