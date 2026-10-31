import { computed, readonly, ref, shallowRef, watch, type Ref } from 'vue'
import { loadFamilyBrowseDataFromD1 } from '../services/d1ApiService'
import { APP_SCHEMA_VERSION, type FamilyBrowseData } from '../types/member'

function emptyBrowseData(): FamilyBrowseData {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    members: [], tracks: [], events: [], aliases: [], relations: [],
    temporals: [], burials: [], spouses: [], childClaims: [],
  }
}

// Each browsing page owns its snapshot; it never initializes maintenance storage.
export function createFamilyBrowseStore(accountKey: Readonly<Ref<string | null>>) {
  const snapshot = shallowRef<FamilyBrowseData>(emptyBrowseData())
  const ready = ref(false)
  const selectedId = ref<number | null>(null)
  let generation = 0
  let disposed = false
  let pending: Promise<boolean> | null = null
  const data = computed(() => readonly(snapshot.value) as FamilyBrowseData)
  const members = computed(() => data.value.members)
  const selectedMember = computed(() => members.value.find((member) => member.id === selectedId.value) ?? null)

  function reset() {
    generation += 1
    pending = null
    ready.value = false
    selectedId.value = null
    snapshot.value = emptyBrowseData()
  }
  const stopAccountWatch = watch(accountKey, reset, { flush: 'sync' })

  function syncFromCloud(): Promise<boolean> {
    if (disposed || !accountKey.value) return Promise.resolve(false)
    if (pending) return pending
    const started = generation
    const request = (async () => {
      try {
        const loaded = await loadFamilyBrowseDataFromD1()
        if (disposed || started !== generation) return false
        const next = loaded ?? emptyBrowseData()
        snapshot.value = {
          ...next,
          members: [...next.members].sort((a, b) => a.id - b.id),
          tracks: [...next.tracks].sort((a, b) => a.id - b.id),
          events: [...next.events].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
        }
        if (!snapshot.value.members.some((member) => member.id === selectedId.value)) {
          selectedId.value = snapshot.value.members[0]?.id ?? null
        }
        ready.value = true
        return true
      } catch (error) {
        if (disposed || started !== generation) return false
        throw error
      }
    })()
    pending = request
    const clearPending = () => {
      if (pending === request) pending = null
    }
    void request.then(clearPending, clearPending)
    return request
  }

  return {
    data, members, selectedMember,
    selectedId: computed(() => selectedId.value),
    ready: computed(() => ready.value),
    aliases: computed(() => data.value.aliases),
    spouses: computed(() => data.value.spouses),
    events: computed(() => data.value.events),
    tracks: computed(() => data.value.tracks),
    init: () => ready.value ? Promise.resolve(true) : syncFromCloud(),
    syncFromCloud,
    selectMember(id: number) {
      if (!disposed && members.value.some((member) => member.id === id)) selectedId.value = id
    },
    dispose() {
      disposed = true
      stopAccountWatch()
      reset()
    },
  }
}
