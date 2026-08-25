<template>
  <VideoGenerationPanel
    :storyboard-id="shotId"
    :storyboard="panelStoryboard"
    display-mode="sidebar"
    @selected="$emit('selected', $event)"
    @anchor-created="$emit('anchor-created', $event)"
    @close="$emit('close')"
  />
</template>

<script setup>
import { computed } from 'vue'
import VideoGenerationPanel from '@/components/video/VideoGenerationPanel.vue'

const props = defineProps({
  shotId: { type: [String, Number], required: true },
  storyboard: { type: Object, default: null },
  sourceAnchor: { type: Object, default: null },
})

defineEmits(['selected', 'anchor-created', 'close'])

const panelStoryboard = computed(() => ({
  ...(props.storyboard || {}),
  _videoSourceAnchor: props.sourceAnchor || null,
}))
</script>
