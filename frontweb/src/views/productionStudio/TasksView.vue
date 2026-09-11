<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>任务中心</h1>
      <span class="sub">跨项目恢复 · 上次同步 {{ lastSync }}</span>
      <div class="spacer"></div>
      <span class="badge info">运行中 {{ counts.running }}</span>
      <span class="badge warn">需要处理 {{ counts.attention }}</span>
      <button class="btn ghost" style="border:1px solid var(--line)" @click="load">刷新</button>
    </header>

    <div class="tfilter">
      <div class="tabs" style="border:none; margin-right:8px">
        <span class="tab" :class="{ on: tab === 'running' }" @click="tab = 'running'">进行中<span class="cnt">{{ counts.running }}</span></span>
        <span class="tab" :class="{ on: tab === 'attention' }" @click="tab = 'attention'">需要处理<span class="cnt warn">{{ counts.attention }}</span></span>
        <span class="tab" :class="{ on: tab === 'history' }" @click="tab = 'history'">历史<span class="cnt">{{ counts.history }}</span></span>
      </div>
      <div class="spacer"></div>
      <div class="input" style="width:200px; height:32px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="搜索对象 / 任务 ID" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:12.5px">
      </div>
    </div>

    <div class="tlist">
      <div v-for="t in filtered" :key="t.id" class="card trow" :class="{ sel: selected === t.id }" @click="openDetail(t)">
        <div class="ic" :style="{ color: typeColor(t) }"><svg><use :href="typeIcon(t)"/></svg></div>
        <div class="tt grow"><b>{{ taskTitle(t) }}</b><span>{{ taskSource(t) }}</span></div>
        <div class="stat">
          <div class="lbl" :class="statusTextClass(t.status)">
            <svg style="width:12px;height:12px"><use :href="statusIcon(t.status)"/></svg>{{ statusLabel(t.status) }}<template v-if="t.status === 'completed'"> · {{ fmtTime(t.completed_at) }}</template>
          </div>
          <div class="progress" :class="statusProgressClass(t.status)"><i :style="{ width: (t.progress || 0) + '%' }"></i></div>
        </div>
        <div class="meta">{{ typeLabel(t.type) }}<br>{{ fmtTime(t.created_at) }}</div>
        <button class="btn sm" @click.stop="openDetail(t)">查看任务</button>
      </div>
      <p v-if="filtered.length === 0" class="muted" style="text-align:center; padding:50px 0">此分组暂无任务</p>
      <div class="row" style="padding:6px 4px">
        <span class="xs muted">百分比仅来自任务可信进度；无法确认时只显示状态与已用时间。</span>
      </div>
    </div>

    <!-- 任务详情抽屉 -->
    <div v-if="detail" class="scrim" style="z-index:80" @click="detail = null"></div>
    <aside v-if="detail" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3 style="font-size:14px">{{ taskTitle(detail) }}</h3>
        <span class="badge" :class="statusBadgeClass(detail.status)">{{ statusLabel(detail.status) }}</span>
        <button class="icon-btn" @click="detail = null"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="sec-t">生命周期</div>
        <div class="tl">
          <div class="tl-item done">任务创建<span class="t">{{ fmtFull(detail.created_at) }}</span></div>
          <div class="tl-item" :class="{ done: ['running', 'completed'].includes(detail.status), cur: detail.status === 'running' }">
            {{ detail.status === 'running' ? `执行中 · 进度 ${detail.progress || 0}%` : detail.status === 'pending' ? '排队中' : '开始执行' }}
            <span class="t">{{ fmtFull(detail.updated_at) }}</span>
          </div>
          <div v-if="detail.completed_at" class="tl-item done">完成<span class="t">{{ fmtFull(detail.completed_at) }}</span></div>
          <div v-if="detail.status === 'failed'" class="tl-item" style="color:var(--danger)">失败<span class="t">{{ detail.error || '' }}</span></div>
          <div v-if="detail.status === 'cancelled'" class="tl-item" style="color:var(--muted)">已取消（cancel-requested）<span class="t">记录保留</span></div>
        </div>
        <div class="divider"></div>
        <div class="kv"><span class="k">任务类型</span><span class="v">{{ typeLabel(detail.type) }}</span></div>
        <div class="kv"><span class="k">对象</span><span class="v">{{ detail.resource_id || detail.owner_id || '—' }}</span></div>
        <div class="kv" v-if="detail.cost"><span class="k">费用</span><span class="v">{{ detail.cost.note || '本地执行 · 不产生 API 费用' }}</span></div>
        <div class="kv" v-if="detail.error"><span class="k">错误</span><span class="v danger-t">{{ detail.error }}</span></div>

        <div class="divider"></div>
        <div class="sec-t" style="margin-bottom:6px">输入快照摘要</div>
        <div class="row" style="gap:6px; flex-wrap:wrap" v-if="detail.input">
          <span class="chip mono xs ellipsis" style="max-width:360px">{{ inputSummary(detail.input) }}</span>
        </div>
        <div class="row" style="margin-top:10px; padding:8px 11px; border:1px solid var(--line); border-radius:8px; cursor:pointer" @click="techOpen = !techOpen">
          <span class="small t2">技术详情</span><span class="xs muted">任务 ID · 快照 · 原始状态</span>
        </div>
        <div v-if="techOpen" class="xs muted" style="padding:8px 11px; line-height:1.8">
          任务 ID：{{ detail.id }}<br>状态：{{ detail.status }} · 进度 {{ detail.progress || 0 }}%<br>更新：{{ fmtFull(detail.updated_at) }}
        </div>
      </div>
      <div class="drawer-f">
        <button v-if="['pending', 'running'].includes(detail.status)" class="btn danger" @click="cancelTask(detail)">取消任务</button>
        <button v-if="['failed', 'cancelled'].includes(detail.status) && detail.type.startsWith('v21:mock')" class="btn primary" @click="retryTask(detail)">按原输入重试</button>
        <div class="spacer"></div>
        <span class="xs muted">重试创建新 attempt · 不覆盖记录</span>
      </div>
    </aside>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'TasksView',
  data() {
    return { all: [], tab: 'running', q: '', detail: null, techOpen: false, lastSync: '', timer: null }
  },
  computed: {
    counts() {
      return {
        running: this.all.filter((t) => ['pending', 'running', 'queued'].includes(t.status)).length,
        attention: this.all.filter((t) => ['failed', 'waiting_external', 'unknown'].includes(t.status)).length,
        history: this.all.filter((t) => ['completed', 'cancelled'].includes(t.status)).length,
      }
    },
    filtered() {
      let list = this.all
      if (this.tab === 'running') list = list.filter((t) => ['pending', 'running', 'queued'].includes(t.status))
      else if (this.tab === 'attention') list = list.filter((t) => ['failed', 'waiting_external', 'unknown'].includes(t.status))
      else list = list.filter((t) => ['completed', 'cancelled'].includes(t.status))
      if (this.q) {
        const needle = this.q.toLowerCase()
        list = list.filter((t) => (t.resource_id || '').toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle) || (t.input_json || '').toLowerCase().includes(needle))
      }
      return list
    },
  },
  mounted() {
    this.load()
    this.timer = setInterval(this.load, 5000)
  },
  unmounted() { clearInterval(this.timer) },
  methods: {
    async load() {
      try {
        const res = await axios.get('/api/v1/tasks', { params: { page: 1, page_size: 100 } })
        const data = res.data?.data
        this.all = Array.isArray(data) ? data : (data?.items || [])
        this.lastSync = new Date().toLocaleTimeString()
      } catch { /* 保留旧数据 */ }
    },
    taskTitle(t) {
      const input = t.input_json ? JSON.parse(t.input_json) : {}
      if (t.type === 'v21:mock-image') return `图片生成 · ${String(input.prompt || '').slice(0, 18)}`
      if (t.type === 'v21:mock-video') return `镜头视频生成 · ${String(input.prompt || '').slice(0, 18)}`
      if (t.type === 'v21:compose') return `整集成片合成`
      return `${t.type} · ${t.resource_id || t.id.slice(0, 8)}`
    },
    taskSource(t) {
      if (t.owner_type) return `${t.owner_type} · ${t.owner_id}`
      return t.resource_id || '—'
    },
    typeLabel(type) {
      return {
        'v21:mock-image': 'mock 图片生成', 'v21:mock-video': 'mock 视频生成', 'v21:compose': '整集合成',
      }[type] || type
    },
    typeIcon(t) {
      if (t.type?.includes('image')) return '#i-image'
      if (t.type?.includes('video') || t.type?.includes('compose')) return '#i-film'
      return '#i-spark'
    },
    typeColor(t) {
      if (t.type?.includes('image')) return 'var(--accent)'
      if (t.type?.includes('video') || t.type?.includes('compose')) return 'var(--info)'
      return 'var(--muted)'
    },
    statusLabel(status) {
      return {
        pending: '排队中', running: '运行中', completed: '已完成', failed: '失败',
        cancelled: '已取消', waiting_external: '等待外部结果', unknown: '未知 · 待核对',
      }[status] || status
    },
    statusIcon(status) {
      return { pending: '#i-clock', running: '#i-refresh', completed: '#i-check-c', failed: '#i-warn', cancelled: '#i-clock', waiting_external: '#i-clock', unknown: '#i-warn' }[status] || '#i-clock'
    },
    statusTextClass(status) {
      return { pending: '', running: 'info-t', completed: 'ok-t', failed: 'danger-t', cancelled: '', waiting_external: 'warn-t', unknown: 'warn-t' }[status] || ''
    },
    statusProgressClass(status) {
      return { running: 'info', completed: 'ok' }[status] || ''
    },
    statusBadgeClass(status) {
      return { pending: 'neutral', running: 'info', completed: 'ok', failed: 'danger', cancelled: 'neutral', waiting_external: 'warn', unknown: 'warn' }[status] || 'neutral'
    },
    inputSummary(input) {
      if (!input) return '—'
      const p = input.prompt || ''
      return p ? `prompt: ${p.slice(0, 80)}` : JSON.stringify(input).slice(0, 100)
    },
    fmtTime(t) { return t ? String(t).slice(11, 19) : '' },
    fmtFull(t) { return t ? String(t).replace('T', ' ').slice(5, 19) : '' },
    openDetail(t) {
      this.detail = t
      this.techOpen = false
    },
    async cancelTask(task) {
      if (!window.confirm('确认取消该任务？取消后记录保留。')) return
      try {
        await axios.post(`/api/v1/tasks/${task.id}/cancel`, { reason: '用户取消' })
        await this.load()
        this.detail = null
      } catch (e) {
        alert(e?.response?.data?.error?.message || e.message)
      }
    },
    async retryTask(task) {
      try {
        await axios.post(`/api/v2/video-tasks/${task.id}/retry`)
        await this.load()
        this.detail = null
      } catch (e) {
        // 非视频任务走通用重试（无通用端点则提示）
        alert(e?.response?.data?.error?.message || '该任务类型暂不支持自动重试，请在原页面按原输入重新提交')
      }
    },
  },
}
</script>

<style scoped>
.tfilter { display: flex; align-items: center; gap: 10px; padding: 10px 24px; border-bottom: 1px solid var(--line); }
.tlist { flex: 1; overflow: auto; padding: 14px 24px; display: flex; flex-direction: column; gap: 9px; }
.trow { display: flex; align-items: center; gap: 14px; padding: 13px 16px; cursor: pointer; }
.trow.sel { border-color: var(--accent); }
.trow .ic { width: 34px; height: 34px; border-radius: 9px; background: var(--panel2); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.trow .ic svg { width: 16px; height: 16px; }
.trow .tt { min-width: 0; }
.trow .tt b { font-size: 13.5px; display: block; }
.trow .tt span { font-size: 11.5px; color: var(--muted); }
.trow .stat { width: 220px; flex: 0 0 220px; }
.trow .lbl { font-size: 11.5px; display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
.trow .lbl svg { width: 12px; height: 12px; }
.trow .meta { font-size: 11px; color: var(--muted); line-height: 1.55; width: 160px; flex: 0 0 160px; }
.sec-t { font-size: 11.5px; font-weight: 600; color: var(--muted); margin-bottom: 8px; letter-spacing: .3px; }
.tl { display: flex; flex-direction: column; gap: 0; }
.tl-item { position: relative; padding: 5px 0 5px 18px; font-size: 12.5px; color: var(--text-2); }
.tl-item::before { content: ""; position: absolute; left: 3px; top: 11px; width: 7px; height: 7px; border-radius: 50%; background: var(--neutral); }
.tl-item.done::before { background: var(--ok); }
.tl-item.cur::before { background: var(--info); box-shadow: 0 0 0 3px rgba(88,166,255,.2); }
.tl-item .t { color: var(--muted); font-size: 11px; margin-left: 8px; }
.mono { font-family: Consolas, monospace; }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
</style>
