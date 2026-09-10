<template>
  <div class="app">
    <aside class="v21-rail">
      <router-link to="/projects" class="rail-item" :class="{ active: isActive('/projects') }" title="项目">
        <span class="rail-icon">🎬</span><span class="rail-text">项目</span>
      </router-link>
      <router-link to="/library" class="rail-item" :class="{ active: isActive('/library') }" title="资产库">
        <span class="rail-icon">🗂</span><span class="rail-text">资产库</span>
      </router-link>
      <router-link to="/tasks" class="rail-item" :class="{ active: isActive('/tasks') }" title="任务">
        <span class="rail-icon">⚙︎</span><span class="rail-text">任务</span>
      </router-link>
      <router-link to="/settings" class="rail-item" :class="{ active: isActive('/settings') }" title="设置">
        <span class="rail-icon">🛠</span><span class="rail-text">设置</span>
      </router-link>
    </aside>
    <main class="v21-main">
      <router-view />
    </main>
  </div>
</template>

<script>
export default {
  name: 'AppV21',
  methods: {
    isActive(prefix) {
      return this.$route.path === prefix || this.$route.path.startsWith(prefix + '/')
    },
  },
}
</script>

<style>
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: #f5f6f8;
  color: #1f2329;
}
.app { display: flex; }
.v21-rail {
  width: 64px;
  flex: none;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 0;
  position: sticky;
  top: 0;
  height: 100vh;
}
.rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 0;
  text-decoration: none;
  color: #4b5563;
  font-size: 12px;
  border-left: 3px solid transparent;
}
.rail-item.active {
  color: #2563eb;
  border-left-color: #2563eb;
  background: #eff6ff;
}
.rail-icon { font-size: 18px; }
.v21-main { flex: 1; min-width: 0; }
</style>
