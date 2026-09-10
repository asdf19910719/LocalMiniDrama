<template>
  <div class="page">
    <h1>任务</h1>
    <el-tabs v-model="tab">
      <el-tab-pane label="进行中" name="running" />
      <el-tab-pane label="需要处理" name="attention" />
      <el-tab-pane label="历史" name="history" />
    </el-tabs>
    <div class="rows">
      <div v-for="task in items" :key="task.id" class="task-row">
        <div class="main">
          <span class="type">{{ task.type }}</span>
          <span class="status badge" :class="statusClass(task.status)">{{ statusLabel(task.status) }}</span>
        </div>
        <div class="meta">
          {{ task.message || '—' }} · 创建于 {{ formatTime(task.created_at) }}
          <span v-if="task.resource_id"> · 对象 {{ task.resource_id }}</span>
        </div>
      </div>
      <p v-if="items.length === 0" class="hint">暂无任务</p>
    </div>
  </div>
</template>

<script>
// 任务中心（最小闭环）：聚合展示统一任务表；进行中/需要处理/历史按下一步责任人分组
import axios from 'axios'

export default {
  name: 'TasksView',
  data() {
    return { tab: 'running', items: [], timer: null }
  },
  mounted() { this.load(); this.timer = setInterval(this.load, 5000) },
  unmounted() { clearInterval(this.timer) },
  watch: { tab() { this.load() } },
  methods: {
    async load() {
      const res = await axios.get('/api/v1/tasks', { params: { page: 1, page_size: 100 } })
      const all = res.data?.data?.items || res.data?.data || []
      const list = Array.isArray(all) ? all : []
      this.items = list.filter((t) => {
        if (this.tab === 'running') return ['pending', 'running', 'queued'].includes(t.status)
        if (this.tab === 'attention') return ['failed', 'cancelled', 'waiting_external', 'unknown'].includes(t.status)
        return ['completed', 'failed', 'cancelled'].includes(t.status) && this.tab === 'history'
      })
    },
    statusLabel(status) {
      return { pending: '排队中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', waiting_external: '等待外部结果', unknown: '未知' }[status] || status
    },
    statusClass(status) {
      return { pending: 'blue', running: 'blue', completed: 'green', failed: 'red', cancelled: 'gray', waiting_external: 'amber', unknown: 'amber' }[status] || 'gray'
    },
    formatTime(t) { return t ? String(t).replace('T', ' ').slice(0, 19) : '' },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 900px; }
.rows { display: flex; flex-direction: column; gap: 8px; }
.task-row { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; }
.main { display: flex; gap: 10px; align-items: center; }
.type { font-weight: 600; }
.meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; }
.badge.blue { background: #eff6ff; color: #2563eb; }
.badge.green { background: #ecfdf5; color: #047857; }
.badge.red { background: #fef2f2; color: #b91c1c; }
.badge.amber { background: #fffbeb; color: #b45309; }
.badge.gray { background: #f3f4f6; color: #6b7280; }
.hint { color: #9ca3af; }
</style>
