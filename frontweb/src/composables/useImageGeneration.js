import { storeToRefs } from 'pinia'
import { useImageGenerationStore } from '@/stores/imageGenerationStore'
import { createImageGenerationFacade } from './imageGenerationFacade'

export function useImageGeneration() {
  const store = useImageGenerationStore()
  const state = storeToRefs(store)
  return createImageGenerationFacade(store, state)
}
