<template>
  <section class="external-generation-panel">
    <header><strong>External Web Image</strong><el-tag size="small" effect="plain">{{ state }}</el-tag></header>
    <el-input v-model="prompt" type="textarea" :rows="4" placeholder="Prompt" />
    <div class="actions">
      <el-button type="primary" :loading="state === 'preparing'" @click="prepare">Prepare Job</el-button>
      <el-button :disabled="!job || ['preparing', 'sending'].includes(state)" :loading="state === 'sending'" @click="send">Send in ChatGPT</el-button>
      <el-button text :disabled="!job" @click="refresh">Refresh</el-button>
    </div>
    <p v-if="error" class="error">{{ error.message }}</p>
    <p v-if="job" class="job-meta">Job {{ job.id.slice(0, 8) }} / {{ job.site }} / {{ job.prompt_hash?.slice(0, 10) }}</p>
    <div v-if="results.length" class="results">
      <div v-for="result in results" :key="result.id" class="result-row">
        <img :src="result.preview_url || `/api/v1/external-generation/results/${encodeURIComponent(result.id)}/content`" alt="Generated candidate" />
        <span>Candidate {{ result.candidate_index ?? result.result_index }} · {{ result.status }}</span>
        <el-button size="small" type="primary" :disabled="result.selected === 1" @click="select(result.id)">{{ result.selected === 1 ? 'Selected' : 'Use for Shot' }}</el-button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useExternalGeneration } from '@/composables/useExternalGeneration'

const props = defineProps({ dramaId: [Number, String], storyboardId: [Number, String], initialPrompt: { type: String, default: '' }, references: { type: Array, default: () => [] }, site: { type: String, default: 'chatgpt' }, provider: { type: String, default: 'chatgpt-web' } })
const prompt = ref(props.initialPrompt)
const { state, job, results, error, prepare: create, createAttempt, refresh, selectResult } = useExternalGeneration()
watch(() => props.initialPrompt, (value) => { if (!prompt.value) prompt.value = value || '' })
const extensionId = import.meta.env.VITE_EXTERNAL_EXTENSION_ID || ''
async function notifyExtension(message) {
  if (extensionId && globalThis.chrome?.runtime?.sendMessage) {
    const response = await globalThis.chrome.runtime.sendMessage(extensionId, message)
    if (!response?.ok) throw new Error(response?.error || 'Extension rejected the request')
    return response
  }
  if (typeof window !== 'undefined') {
    window.postMessage({ source: 'aistory-external-generation', message }, '*')
    return { ok: true }
  }
  throw new Error('External generation bridge is unavailable')
}
async function hydrateReferences(references) {
  return Promise.all((references || []).map(async (reference) => {
    if (reference?.bytes || reference?.content || !reference?.url) return reference
    const response = await fetch(reference.url, { credentials: 'include' })
    if (!response.ok) throw new Error(`Reference download failed: ${response.status}`)
    return { ...reference, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }
  }))
}
async function prepare() {
  const prepared = await create({ dramaId: props.dramaId, storyboardId: props.storyboardId, site: props.site, provider: props.provider, promptSnapshot: prompt.value }, props.references)
  const hydratedReferences = await hydrateReferences(props.references)
  await notifyExtension({ action: 'prepare', dramaId: props.dramaId, site: props.site, jobId: prepared.id, prompt: prompt.value, references: hydratedReferences, conversationId: prepared.conversation_id })
}
async function send() { const attempt = await createAttempt({ conversationId: job.value?.conversation_id, sent_prompt_hash: job.value?.prompt_hash, status: 'ready_to_send' }); await notifyExtension({ action: 'send', dramaId: props.dramaId, site: props.site, attemptId: attempt.id, conversationId: job.value?.conversation_id, payload: attempt }) }
async function select(resultId) { await selectResult(resultId, props.storyboardId) }
</script>

<style scoped>
.external-generation-panel { padding: 12px; border-top: 1px solid var(--el-border-color); display: grid; gap: 10px; }
.external-generation-panel header, .actions, .result-row { display: flex; align-items: center; gap: 8px; }
.external-generation-panel header { justify-content: space-between; }
.actions { flex-wrap: wrap; }
.job-meta { font-size: 12px; color: var(--el-text-color-secondary); margin: 0; }
.error { color: var(--el-color-danger); }
.results { display: grid; gap: 8px; }
.result-row { min-height: 56px; border: 1px solid var(--el-border-color); padding: 6px; }
.result-row img { width: 52px; height: 52px; object-fit: cover; }
.result-row span { flex: 1; font-size: 12px; }
</style>
