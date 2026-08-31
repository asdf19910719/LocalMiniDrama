<template>
  <span v-if="visible || environment">
    <ImageGenerationEnvironmentStatus :environment="environment" :checking="checking" @check="check" />
    <el-tooltip v-if="visible" :content="'点击查看生图任务抽屉'" placement="top">
      <el-button size="small" :type="attention ? 'warning' : 'info'" plain class="image-task-pill" @click="open">
        {{ label }}
      </el-button>
    </el-tooltip>
  </span>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useImageGenerationStore } from '@/stores/imageGenerationStore'
import ImageGenerationEnvironmentStatus from './ImageGenerationEnvironmentStatus.vue'

const props = defineProps({ dramaId: { type: [Number, String], required: true } })
const store = useImageGenerationStore()
const summary = ref(null)
const { environment, defaultChannel } = storeToRefs(store)
const checking = ref(false)
let timer = null

const counts = computed(() => summary.value || {})
const visible = computed(() => (
  [counts.value.queued, counts.value.preparing, counts.value.submitted, counts.value.generating, counts.value.needs_review]
    .some((n) => Number(n) > 0)
))
const attention = computed(() => Number(counts.value.needs_review) > 0)
const label = computed(() => {
  const c = counts.value
  const parts = []
  if (Number(c.queued) + Number(c.preparing) > 0) parts.push(`排队 ${Number(c.queued) + Number(c.preparing)}`)
  if (Number(c.submitted) + Number(c.generating) > 0) parts.push(`生成中 ${Number(c.submitted) + Number(c.generating)}`)
  if (Number(c.needs_review) > 0) parts.push(`待选 ${c.needs_review}`)
  return `生图任务：${parts.join(' · ')}`
})

async function refresh() {
  try {
    summary.value = await store.loadSummary(props.dramaId, { reattach: false })
    await check()
  } catch (_) {
    // 摘要暂时不可用时保持上次内容，下个周期重试
  }
}

async function check() {
  if (checking.value) return
  checking.value = true
  try { await store.checkEnvironment({ dramaId: props.dramaId, channel: defaultChannel.value }) } catch (_) {}
  finally { checking.value = false }
}

function open() {
  const id = summary.value?.active_task_id
  if (id) store.openTaskById(id)
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 5000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  timer = null
})
</script>
