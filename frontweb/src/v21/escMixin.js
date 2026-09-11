// V2.1 Esc 接线 mixin（Options API）：视图在 mounted 里 this.bindEsc(this.onEsc)，
// 组件卸载时自动解绑，避免向 escBus 泄漏订阅。
// 注：Vue 3 Options API 的卸载钩子名为 beforeUnmount（简报所写 beforeDestroy 为 Vue 2 名称）。
import { subscribeEsc, unsubscribeEsc } from './escBus.js'

export default {
  data() {
    return { escHandlers: [] }
  },
  beforeUnmount() {
    const handlers = this.escHandlers || []
    for (const fn of handlers) unsubscribeEsc(fn)
    this.escHandlers = []
  },
  methods: {
    // 订阅一个 Esc 处理函数（自动随组件卸载解绑）；返回手动解绑函数
    bindEsc(fn) {
      if (typeof fn !== 'function') return () => {}
      subscribeEsc(fn)
      this.escHandlers.push(fn)
      return () => this.unbindEsc(fn)
    },
    unbindEsc(fn) {
      unsubscribeEsc(fn)
      const at = (this.escHandlers || []).indexOf(fn)
      if (at >= 0) this.escHandlers.splice(at, 1)
    },
  },
}
