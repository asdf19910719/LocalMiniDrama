const CACHE_TTL_MS = 30_000
const cache = new Map()

function keyOf({ dramaId, channel, targetType, targetId }) {
  return [dramaId, channel, targetType || '', targetId || ''].join(':')
}

function mergeChecks(...reports) {
  const checks = reports.flatMap((report) => Array.isArray(report?.checks) ? report.checks : [])
  return checks
}

export async function runImageGenerationEnvironmentCheck({
  dramaId, channel = 'api', targetType, targetId, force = false,
  requestBackend, requestBridge, now = () => Date.now(),
}) {
  const cacheKey = keyOf({ dramaId, channel, targetType, targetId })
  const cached = cache.get(cacheKey)
  if (!force && cached && now() - cached.timestamp < CACHE_TTL_MS) return cached.value
  let backend
  try {
    backend = await requestBackend({ dramaId, channel, targetType, targetId })
  } catch (error) {
    backend = { canProceed: false, checks: [{ key: 'backend', status: 'failed', code: 'BACKEND_UNAVAILABLE', message: error?.message || '后端服务不可用' }] }
  }
  const reports = [backend]
  if (channel === 'chatgpt_web') {
    try {
      reports.push(await requestBridge({ action: 'diagnostics', dramaId, site: 'chatgpt' }))
    } catch (error) {
      reports.push({ canProceed: false, checks: [{ key: 'workbench_bridge', status: 'failed', code: 'BRIDGE_OFFLINE', message: error?.message || '浏览器扩展未响应' }] })
    }
  }
  const value = {
    canProceed: reports.every((report) => report?.canProceed === true) && mergeChecks(...reports).every((check) => check.status !== 'failed'),
    channel,
    checkedAt: new Date(now()).toISOString(),
    checks: mergeChecks(...reports),
  }
  cache.set(cacheKey, { timestamp: now(), value })
  return value
}

export function clearImageGenerationEnvironmentCache() { cache.clear() }
export const IMAGE_GENERATION_ENVIRONMENT_CACHE_TTL_MS = CACHE_TTL_MS
