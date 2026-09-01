<template>
  <div v-if="formatted" class="image-updated-at">图更新于 {{ formatted }}</div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ value: { type: String, default: '' } })

const formatted = computed(() => {
  if (!props.value) return ''
  const date = new Date(props.value)
  if (Number.isNaN(date.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
})
</script>

<style scoped>
.image-updated-at { font-size: 11px; color: #909399; line-height: 1.5; }
</style>
