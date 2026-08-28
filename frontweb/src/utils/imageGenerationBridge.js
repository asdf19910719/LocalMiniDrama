function requestId() {
  return globalThis.crypto?.randomUUID?.() || `image-generation-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function sendImageGenerationBridgeMessage(message, timeoutMs = 15000) {
  const extensionId = import.meta.env.VITE_EXTERNAL_EXTENSION_ID || ''
  if (extensionId && globalThis.chrome?.runtime?.sendMessage) {
    const response = await globalThis.chrome.runtime.sendMessage(extensionId, message)
    if (!response?.ok) throw new Error(response?.error || '浏览器插件拒绝了图片生成请求')
    return response
  }
  if (typeof window === 'undefined') throw new Error('浏览器插件桥接不可用')
  const id = requestId()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('浏览器插件未响应，请确认插件已安装并启用'))
    }, timeoutMs)
    function onMessage(event) {
      if (event.source !== window || event.data?.source !== 'aistory-external-generation-response' || event.data.requestId !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      const response = event.data.response
      if (!response?.ok) reject(new Error(response?.error || '浏览器插件拒绝了图片生成请求'))
      else resolve(response)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'aistory-external-generation', requestId: id, message }, '*')
  })
}
