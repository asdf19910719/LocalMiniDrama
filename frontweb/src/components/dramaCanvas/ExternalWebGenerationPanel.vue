<template><section class="external-generation-panel"><header><strong>External Web Image</strong><span>{{ state }}</span></header><el-input v-model="prompt" type="textarea" :rows="4" placeholder="Prompt"/><el-button type="primary" :loading="state==='preparing'" @click="prepare">Prepare Job</el-button><p v-if="error" class="error">{{ error.message }}</p><p v-if="job">Job {{ job.id.slice(0, 8) }} · {{ job.site }}</p></section></template>
<script setup>
import { ref } from 'vue'
import { useExternalGeneration } from '@/composables/useExternalGeneration'
const props = defineProps({ dramaId: [Number, String], storyboardId: [Number, String], site: { type: String, default: 'chatgpt' }, provider: { type: String, default: 'chatgpt-web' } })
const prompt = ref(''); const { state, job, error, prepare: create } = useExternalGeneration()
async function prepare() { await create({ dramaId: props.dramaId, storyboardId: props.storyboardId, site: props.site, provider: props.provider, promptSnapshot: prompt.value }, []) }
</script>
<style scoped>.external-generation-panel{padding:12px;border-top:1px solid var(--el-border-color);display:grid;gap:10px}.external-generation-panel header{display:flex;justify-content:space-between}.error{color:var(--el-color-danger)}</style>
