<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Member, Track } from '../types/member'

const props = defineProps<{
  tracks: Track[]
  members: Member[]
  selectedMemberId: number | null
}>()

const emit = defineEmits<{
  upload: [payload: { raw: string; name: string; memberId: number | null }]
  remove: [id: number]
  navigate: [track: Track]
  updateMeta: [payload: { id: number; name: string; memberId: number | null }]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const trackName = ref('')
const memberId = ref<string>('')

const orderedTracks = computed(() => {
  return [...props.tracks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
})

const focusedTracks = computed(() => {
  if (props.selectedMemberId === null) {
    return [] as Track[]
  }
  return orderedTracks.value.filter((track) => track.memberId === props.selectedMemberId)
})

function memberNameById(id: number | null): string {
  if (id === null) {
    return '未关联成员'
  }
  return props.members.find((member) => member.id === id)?.name ?? `成员#${id}`
}

function triggerUpload() {
  fileInputRef.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  const raw = await file.text()
  const finalName = trackName.value.trim() || file.name.replace(/\.gpx$/i, '')
  const parsedMemberId = memberId.value ? Number(memberId.value) : null

  emit('upload', {
    raw,
    name: finalName,
    memberId: Number.isFinite(parsedMemberId as number) ? parsedMemberId : null,
  })

  input.value = ''
  trackName.value = ''
}

function onMemberSelectionChange(value: string) {
  memberId.value = value
}

function promptRename(track: Track) {
  const nextName = window.prompt('请输入新的轨迹名称', track.name)
  if (nextName === null) {
    return
  }

  emit('updateMeta', {
    id: track.id,
    name: nextName,
    memberId: track.memberId,
  })
}
</script>

<template>
  <section class="panel-block track-block">
    <h3>扫墓轨迹</h3>

    <div class="field-row">
      <input
        v-model="trackName"
        class="search-input"
        type="text"
        placeholder="轨迹名称（可选）"
      />
      <select
        class="search-input"
        :value="memberId"
        @change="onMemberSelectionChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="">未关联成员</option>
        <option v-for="member in members" :key="member.id" :value="String(member.id)">
          {{ member.name }}（#{{ member.id }}）
        </option>
      </select>
      <button class="btn-primary" type="button" @click="triggerUpload">上传 GPX</button>
    </div>

    <input ref="fileInputRef" class="hidden-input" type="file" accept=".gpx" @change="handleFileChange" />

    <p class="search-meta">已上传 {{ tracks.length }} 条轨迹</p>
    <p v-if="selectedMemberId !== null" class="search-meta">
      当前成员关联轨迹：{{ focusedTracks.length }}
    </p>

    <ul class="track-list" v-if="orderedTracks.length > 0">
      <li v-for="track in orderedTracks" :key="track.id" class="track-item">
        <div class="track-text">
          <strong>{{ track.name }}</strong>
          <span>
            {{ memberNameById(track.memberId) }} · {{ Math.round(track.stats.distanceMeters / 100) / 10 }} km ·
            {{ track.stats.pointCount }} 点
          </span>
        </div>
        <div class="member-actions">
          <button class="btn-ghost" type="button" @click.stop="emit('navigate', track)">导航</button>
          <button class="btn-ghost" type="button" @click.stop="promptRename(track)">重命名</button>
          <button class="btn-danger" type="button" @click.stop="emit('remove', track.id)">删除</button>
        </div>
      </li>
    </ul>

    <div v-else class="member-empty">暂无轨迹，请上传 GPX 文件。</div>
  </section>
</template>
