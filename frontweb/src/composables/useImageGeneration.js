import { storeToRefs } from 'pinia'
import { useImageGenerationStore } from '@/stores/imageGenerationStore'

export function useImageGeneration() {
  const store = useImageGenerationStore()
  const state = storeToRefs(store)
  return {
    ...state,
    loadSummary: store.loadSummary,
    loadDefault: store.loadDefault,
    open: store.openTask,
    refresh: store.refreshTask,
    sendToChatGPT: store.sendToChatGPT,
    recoverCapture: store.recoverCapture,
    requeueTask: store.requeueTask,
    selectResult: store.selectResult,
    close: store.closeDrawer,
  }
}
