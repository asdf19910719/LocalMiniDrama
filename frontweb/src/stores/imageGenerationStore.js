import { defineStore } from 'pinia'
import { ref } from 'vue'
import { imageGenerationTaskAPI } from '@/api/imageGenerationTasks'

export const useImageGenerationStore = defineStore('imageGeneration', () => {
  const dramaId = ref(null)
  const defaultChannel = ref('api')
  const summary = ref(null)
  const currentTask = ref(null)
  const drawerVisible = ref(false)
  const loading = ref(false)

  async function loadSummary(id) {
    if (id == null) return null
    dramaId.value = id
    summary.value = await imageGenerationTaskAPI.summary(id)
    return summary.value
  }
  async function loadDefault(id) {
    const result = await imageGenerationTaskAPI.getDefault(id)
    defaultChannel.value = result?.channel || 'api'
    return defaultChannel.value
  }
  async function openTask(input) {
    loading.value = true
    try {
      currentTask.value = await imageGenerationTaskAPI.create(input)
      drawerVisible.value = true
      await loadSummary(input.dramaId)
      return currentTask.value
    } finally { loading.value = false }
  }
  async function refreshTask() {
    if (!currentTask.value?.id) return null
    currentTask.value = await imageGenerationTaskAPI.get(currentTask.value.id)
    return currentTask.value
  }
  function closeDrawer() { drawerVisible.value = false }

  return { dramaId, defaultChannel, summary, currentTask, drawerVisible, loading, loadSummary, loadDefault, openTask, refreshTask, closeDrawer }
})
