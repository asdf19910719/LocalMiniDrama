<template>
  <div v-if="style" class="project-style-summary">
    <img :src="style.preview?.localPath" :alt="style.labelZh" />
    <div>
      <div class="summary-title"><strong>{{ style.labelZh }}</strong><span>{{ style.labelEn }}</span></div>
      <p>{{ style.descriptionZh }}</p>
      <small>项目唯一风格 · 生图与生视频任务创建时由后端编译并冻结</small>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { stylesAPI } from '@/api/styles'

const props = defineProps({ styleId: { type: String, default: '' } })
const style = ref(null)
let serial = 0
watch(() => props.styleId, async (id) => {
  const current = ++serial
  if (!id) { style.value = null; return }
  try {
    const result = await stylesAPI.get(id)
    if (current === serial) style.value = result
  } catch (_) {
    if (current === serial) style.value = null
  }
}, { immediate: true })
</script>

<style scoped>
.project-style-summary { display: flex; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-light); }
.project-style-summary img { width: 74px; height: 48px; object-fit: cover; border-radius: 7px; flex: none; }
.project-style-summary > div { min-width: 0; }.summary-title { display: flex; align-items: baseline; gap: 8px; }.summary-title span,.project-style-summary small { color: var(--el-text-color-secondary); }.project-style-summary p { margin: 4px 0; font-size: 12px; line-height: 1.4; color: var(--el-text-color-regular); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
