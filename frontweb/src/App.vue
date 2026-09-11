<template>
  <div class="v21-root">
    <!-- SVG 图标 sprite（来源：docs/design/v2.1-ui/shared/head.html） -->
    <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
      <symbol id="i-grid" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></symbol>
      <symbol id="i-box" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/></symbol>
      <symbol id="i-tasks" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M9.5 6h11M9.5 12h11M9.5 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></symbol>
      <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3l1.5 2.2 2.6-.5 1 2.4 2.4 1-.5 2.6L21 12l-2 1.3.5 2.6-2.4 1-1 2.4-2.6-.5L12 21l-1.5-2.2-2.6.5-1-2.4-2.4-1 .5-2.6L3 12l2-1.3-.5-2.6 2.4-1 1-2.4 2.6.5z"/></symbol>
      <symbol id="i-spark" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 5v14M5 12h14"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path stroke="currentColor" stroke-width="1.7" d="M16 16l4.5 4.5"/></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6 6l12 12M18 6L6 18"/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
      <symbol id="i-check-c" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M8.5 12.3l2.4 2.4 4.8-5"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 7.5V12l3 2"/></symbol>
      <symbol id="i-warn" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 4L2.8 20h18.4z"/><path stroke="currentColor" stroke-width="1.8" d="M12 10v4.5"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M20 12a8 8 0 1 1-2.4-5.7M20 3v4h-4"/></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 15v3A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4.5 16v2A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-2"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></symbol>
      <symbol id="i-pause" viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></symbol>
      <symbol id="i-image" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5 17l4.5-4 3.5 3 3-2.5 3.5 3.5"/></symbol>
      <symbol id="i-film" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path stroke="currentColor" stroke-width="1.6" d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/></symbol>
      <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9.5" y="3.5" width="5" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3"/></symbol>
      <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5 20a7 7 0 0 1 14 0"/></symbol>
      <symbol id="i-scene" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M3.5 18.5l5.5-8 4 5.5 3-3.5 4.5 6z"/><circle cx="17" cy="7.5" r="1.8" fill="currentColor"/></symbol>
      <symbol id="i-cube" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.5l7.5 4v9L12 20.5l-7.5-4v-9zM4.5 7.5l7.5 4 7.5-4M12 11.5v9"/></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2zM5 17.5A2.5 2.5 0 0 1 7.5 15H18"/></symbol>
      <symbol id="i-palette" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2-1 1.5-2s0-2 1.5-2H18a2.5 2.5 0 0 0 2.5-2.5C20.5 7.6 16.7 3.5 12 3.5z"/><circle cx="8" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="16" cy="10" r="1.3" fill="currentColor"/></symbol>
      <symbol id="i-clap" viewBox="0 0 24 24"><rect x="3.5" y="10" width="17" height="9.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 10l1.5-4.5L20 8l-1 4M8.5 6.2l2 3.4M13 7.4l2 3.4"/></symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path stroke="currentColor" stroke-width="1.7" d="M9.5 20h5M12 16.5V20"/></symbol>
      <symbol id="i-back" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M14.5 5.5L8 12l6.5 6.5"/></symbol>
      <symbol id="i-fwd" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M9.5 5.5L16 12l-6.5 6.5"/></symbol>
      <symbol id="i-chev-d" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M6.5 9.5l5.5 5.5 5.5-5.5"/></symbol>
      <symbol id="i-external" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6v6M20 4l-9 9"/></symbol>
      <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13M10.5 10.5v6M13.5 10.5v6"/></symbol>
      <symbol id="i-pencil" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></symbol>
      <symbol id="i-filter" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 6h16M7 12h10M10 18h4"/></symbol>
      <symbol id="i-sort" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M7 5v14m0 0l-3-3m3 3l3-3M17 19V5m0 0l-3 3m3-3l3 3"/></symbol>
      <symbol id="i-vol" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4 10v4h3l4 3.5v-11L7 10zM14.5 9.5a4 4 0 0 1 0 5M17 7.5a7 7 0 0 1 0 9"/></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/></symbol>
      <symbol id="i-link" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M9.5 14.5l5-5M8 12l-2.2 2.2a3.5 3.5 0 0 0 5 5L13 17M11 7l2.2-2.2a3.5 3.5 0 0 1 5 5L16 12"/></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.5l8.5 4.5L12 12.5 3.5 8zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/></symbol>
      <symbol id="i-hist" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3M4.5 12V7.5M4.5 12H9M12 8.5V12l2.5 1.5"/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M12 3.5l7 2.5v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M9 12l2 2 4-4"/></symbol>
      <symbol id="i-wave" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="1.7" d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4"/></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" d="M6 3.5h8l4 4V20.5H6zM14 3.5V8h4M9 12h6M9 15.5h6"/></symbol>
    </svg>

    <div class="app">
      <aside class="rail">
        <div class="logo">剧</div>
        <router-link to="/projects" class="rail-btn" :class="{ active: isActive('/projects') }" data-tip="项目"
                     style="text-decoration:none">
          <svg><use href="#i-grid"/></svg>
        </router-link>
        <router-link to="/library" class="rail-btn" :class="{ active: isActive('/library') }" data-tip="资产库"
                     style="text-decoration:none">
          <svg><use href="#i-box"/></svg>
        </router-link>
        <router-link to="/tasks" class="rail-btn" :class="{ active: isActive('/tasks') }" data-tip="任务中心"
                     style="text-decoration:none">
          <svg><use href="#i-tasks"/></svg>
        </router-link>
        <div class="rail-spacer"></div>
        <router-link to="/ai-config" class="rail-btn" :class="{ active: isActive('/ai-config') }" data-tip="AI 配置"
                     style="text-decoration:none">
          <svg><use href="#i-spark"/></svg>
        </router-link>
        <router-link to="/settings" class="rail-btn" :class="{ active: isActive('/settings') }" data-tip="设置"
                     style="text-decoration:none">
          <svg><use href="#i-gear"/></svg>
        </router-link>
        <!-- 更多工具（规格 §24.7：自由创作/媒体素材库/高级页不进 Rail 一级导航，经此入口） -->
        <div class="rail-more">
          <button class="rail-btn rail-more-btn" :class="{ open: moreToolsOpen }" data-tip="更多工具"
                  aria-label="更多工具" @click.stop="moreToolsOpen = !moreToolsOpen">
            <svg><use href="#i-more"/></svg>
          </button>
          <div v-if="moreToolsOpen" class="card rail-more-pop" @click.stop>
            <router-link to="/quick-create" class="rail-more-item" @click="closeMoreTools">
              <svg><use href="#i-clap"/></svg><span>自由创作</span>
            </router-link>
            <router-link to="/media-library" class="rail-more-item" @click="closeMoreTools">
              <svg><use href="#i-film"/></svg><span>媒体素材库</span>
            </router-link>
            <router-link to="/ai-config/advanced" class="rail-more-item" @click="closeMoreTools">
              <svg><use href="#i-gear"/></svg><span>AI 配置 · 高级</span>
            </router-link>
          </div>
        </div>
      </aside>
      <div class="main">
        <router-view />
      </div>
    </div>

    <!-- 全局 toast 容器（唯一；跨层反馈：如遮罩下的成功提示） -->
    <div class="v21-toasts" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="v21-toast" :class="t.type">{{ t.message }}</div>
    </div>
  </div>
</template>

<script>
import { dispatchEsc } from './v21/escBus.js'

export default {
  name: 'AppV21',
  data() {
    return { moreToolsOpen: false, toasts: [] }
  },
  mounted() {
    document.documentElement.classList.add('v21-active')
    document.body.classList.add('v21-active')
    document.addEventListener('click', this.onDocClick)
    document.addEventListener('keydown', this.onKeydown)
    window.addEventListener('v21:toast', this.onToastEvent)
  },
  unmounted() {
    document.documentElement.classList.remove('v21-active')
    document.body.classList.remove('v21-active')
    document.removeEventListener('click', this.onDocClick)
    document.removeEventListener('keydown', this.onKeydown)
    window.removeEventListener('v21:toast', this.onToastEvent)
    for (const t of this.toasts) clearTimeout(t.timer)
    this.toasts = []
  },
  methods: {
    isActive(prefix) {
      return this.$route.path === prefix || this.$route.path.startsWith(prefix + '/')
    },
    onDocClick() {
      // 菜单内部点击经 @click.stop 拦截，到达 document 的即视为外点
      this.moreToolsOpen = false
    },
    onKeydown(e) {
      if (e.key !== 'Escape') return
      // 先分发给订阅视图（最上层先关）；无人消费时才落到本壳层的工具弹层
      if (!dispatchEsc()) this.moreToolsOpen = false
    },
    closeMoreTools() {
      this.moreToolsOpen = false
    },
    onToastEvent(e) {
      const d = (e && e.detail) || {}
      const toast = {
        message: String(d.message || ''),
        type: d.type === 'danger' ? 'danger' : 'ok',
        id: d.id != null ? d.id : Date.now() + Math.random(),
      }
      // 3.5s 自动出队（P3.4 deferred：遮罩下的跨层反馈）
      toast.timer = setTimeout(() => this.removeToast(toast.id), 3500)
      this.toasts.push(toast)
    },
    removeToast(id) {
      const at = this.toasts.findIndex((t) => t.id === id)
      if (at >= 0) {
        clearTimeout(this.toasts[at].timer)
        this.toasts.splice(at, 1)
      }
    },
  },
}
</script>
