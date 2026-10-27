import { onBeforeUnmount, ref } from 'vue'

export function useMobile() {
  const media = window.matchMedia('(max-width: 767px)')
  const mobile = ref(media.matches)
  const update = () => { mobile.value = media.matches }
  media.addEventListener('change', update)
  onBeforeUnmount(() => media.removeEventListener('change', update))
  return mobile
}
