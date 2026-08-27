<template>
  <section v-if="summary && summary.total" class="image-generation-queue">
    <span>图片任务 {{ summary.completed }}/{{ summary.total }}</span>
    <el-tag v-if="summary.needs_review" type="warning">待选 {{ summary.needs_review }}</el-tag>
    <el-tag v-if="summary.failed" type="danger">失败 {{ summary.failed }}</el-tag>
    <el-button size="small" @click="$emit('pause')">暂停</el-button>
    <el-button size="small" @click="$emit('skip')">跳过当前</el-button>
  </section>
</template>
<script setup>
defineProps({ summary: Object })
defineEmits(['pause', 'skip'])
</script>
<style scoped>.image-generation-queue{position:fixed;right:20px;bottom:20px;z-index:2000;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:var(--el-bg-color);box-shadow:var(--el-box-shadow-light)}</style>
