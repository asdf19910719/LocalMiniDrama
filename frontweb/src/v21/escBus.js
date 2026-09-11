// V2.1 Esc 关闭总线：App.vue 挂全局 keydown Escape 并经 dispatchEsc 分发。
// 约定：后注册的订阅者先被调用（最上层视图先关）；
// 处理函数返回 true 表示“已消费”（关掉了自己最上层的一层），分发随即停止；
// 返回 falsy 表示本视图没有打开的层，继续传给更早注册的订阅者。
const subscribers = []

export function subscribeEsc(fn) {
  if (typeof fn !== 'function') return () => {}
  subscribers.push(fn)
  return () => unsubscribeEsc(fn)
}

export function unsubscribeEsc(fn) {
  const at = subscribers.lastIndexOf(fn)
  if (at >= 0) subscribers.splice(at, 1)
}

export function dispatchEsc() {
  for (let i = subscribers.length - 1; i >= 0; i--) {
    if (subscribers[i]() === true) return true
  }
  return false
}
