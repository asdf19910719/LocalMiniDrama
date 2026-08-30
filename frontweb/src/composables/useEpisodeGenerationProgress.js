import { onBeforeUnmount, ref, watch } from 'vue'
import { episodeGenerationProgressAPI } from '@/api/episodeGenerationProgress'

function resolveValue(source) {
  if (typeof source === 'function') return source()
  return source?.value ?? source
}

export function useEpisodeGenerationProgress(episodeIdSource, options = {}) {
  const intervalMs = Math.max(2000, Number(options.intervalMs) || 5000)
  const progress = ref(null)
  const loading = ref(false)
  const error = ref('')
  let timer = null
  let requestSerial = 0

  function stop() {
    if (timer != null) globalThis.clearTimeout(timer)
    timer = null
  }

  function schedule() {
    stop()
    if (resolveValue(episodeIdSource) == null) return
    timer = globalThis.setTimeout(async () => {
      timer = null
      await refresh({ silent: true })
    }, intervalMs)
  }

  async function refresh({ silent = false } = {}) {
    const episodeId = resolveValue(episodeIdSource)
    if (episodeId == null) {
      progress.value = null
      stop()
      return null
    }
    const serial = ++requestSerial
    if (!silent) loading.value = true
    try {
      const result = await episodeGenerationProgressAPI.get(episodeId)
      if (serial === requestSerial && String(resolveValue(episodeIdSource)) === String(episodeId)) {
        progress.value = result
        error.value = ''
      }
      return result
    } catch (requestError) {
      if (serial === requestSerial) error.value = requestError?.message || '获取生成进度失败'
      return null
    } finally {
      if (!silent) loading.value = false
      if (serial === requestSerial) schedule()
    }
  }

  async function start() {
    stop()
    return refresh()
  }

  watch(() => resolveValue(episodeIdSource), (episodeId) => {
    stop()
    progress.value = null
    error.value = ''
    if (episodeId != null) start()
  }, { immediate: true })

  onBeforeUnmount(() => {
    requestSerial += 1
    stop()
  })

  return { progress, loading, error, refresh, start, stop }
}

export function progressBucketLabel(key) {
  return {
    characters: '角色', scenes: '场景', props: '道具',
    storyboard_main: '分镜主图', storyboard_first: '分镜首帧', storyboard_last: '分镜尾帧',
  }[key] || key
}
