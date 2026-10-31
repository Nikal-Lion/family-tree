<script setup lang="ts">
defineProps<{ fields: { label: string; value: string | number }[] }>()
</script>

<template>
  <dl class="profile-fields">
    <div v-for="field in fields" :key="field.label" class="profile-field">
      <dt>{{ field.label }}</dt>
      <dd>{{ field.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.profile-fields { margin: 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.profile-field { display: grid; grid-template-columns: 120px minmax(0, 1fr); }
.profile-field + .profile-field { border-top: 1px solid #e2e8f0; }
.profile-field dt, .profile-field dd { margin: 0; padding: 12px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.profile-field dt { background: #f8fafc; color: #64748b; font-weight: 500; }
.profile-field dd { color: #1e293b; line-height: 1.8; }
@media (max-width: 767px) {
  .profile-fields { display: grid; gap: 12px; border: 0; overflow: visible; }
  .profile-field { display: block; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
  .profile-field + .profile-field { border-top: 1px solid #e2e8f0; }
  .profile-field dt, .profile-field dd { padding: 0; background: transparent; }
  .profile-field dt { margin-bottom: 6px; font-size: 0.8125rem; }
}
</style>
