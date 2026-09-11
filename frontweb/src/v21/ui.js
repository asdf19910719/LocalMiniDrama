// V2.1 全局 toast：跨层反馈通道（如遮罩下的成功提示——P3.4 deferred 项）。
// 本模块只负责派发事件；容器由 App.vue 唯一挂载（.v21-toasts），样式在 v21-ui.css。
// 约定：type 仅支持 'ok' / 'danger' 两种色调，其余值归一为 'ok'。
export function v21Toast(message, type = 'ok') {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const detail = {
    message: String(message ?? ''),
    type: type === 'danger' ? 'danger' : 'ok',
    id: Date.now() + Math.random(),
  }
  window.dispatchEvent(new CustomEvent('v21:toast', { detail }))
}
