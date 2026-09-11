<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>任务中心</h1>
      <span class="sub">跨项目恢复 · 上次同步 {{ lastSync || '—' }}</span>
      <div class="spacer"></div>
      <span class="badge info">进行中 {{ counts.in_progress }}</span>
      <span class="badge warn">需要处理 {{ counts.attention }}</span>
      <button class="btn ghost" style="border:1px solid var(--line)" :disabled="loading" @click="load">刷新</button>
    </header>

    <div v-if="loadError" class="banner danger" role="alert">
      <svg><use href="#i-warn"/></svg>
      <span>任务列表加载失败：{{ loadError }}</span>
      <button class="btn sm primary" @click="load">重新加载</button>
    </div>

    <div class="tfilter">
      <div class="tabs" style="border:none; margin-right:8px">
        <span class="tab" :class="{ on: tab === 'in_progress' }" @click="tab = 'in_progress'">进行中<span class="cnt">{{ counts.in_progress }}</span></span>
        <span class="tab" :class="{ on: tab === 'attention' }" @click="tab = 'attention'">需要处理<span class="cnt warn">{{ counts.attention }}</span></span>
        <span class="tab" :class="{ on: tab === 'done' }" @click="tab = 'done'">已完成<span class="cnt">{{ counts.done }}</span></span>
      </div>
      <select v-model="typeFilter" class="input" style="width:118px; height:32px; flex:0 0 auto" aria-label="按类型筛选">
        <option value="">全部类型</option>
        <option value="image">图片</option>
        <option value="video">视频</option>
        <option value="external">外部协作</option>
        <option value="compose">整集合成</option>
        <option value="quick-create">自由创作</option>
      </select>
      <select v-model="projectFilter" class="input" style="width:140px; height:32px; flex:0 0 auto" aria-label="按项目筛选">
        <option value="">全部项目</option>
        <option v-for="p in projectOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
      <div class="spacer"></div>
      <div class="input" style="width:200px; height:32px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="搜索标题 / 任务 ID" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:12.5px">
      </div>
    </div>

    <div class="tlist">
      <div v-for="t in displayedTasks" :key="t.id" class="card trow" :class="{ sel: selected === t.id }" @click="openDetail(t)">
        <div class="ic" :style="{ color: typeColor(t) }"><svg><use :href="typeIcon(t)"/></svg></div>
        <div class="tt grow"><b>{{ t.title }}</b><span>{{ taskSource(t) }}</span></div>
        <div class="stat">
          <div class="lbl" :class="statusTextClass(t.status)">
            <svg style="width:12px;height:12px"><use :href="statusIcon(t.status)"/></svg>{{ statusLabel(t.status) }}<template v-if="t.completedAt"> · {{ fmtTime(t.completedAt) }}</template>
          </div>
          <div class="progress" :class="statusProgressClass(t.status)"><i :style="{ width: (t.progress || 0) + '%' }"></i></div>
        </div>
        <div class="meta">{{ typeLabel(t.taskType) }}<br>{{ fmtTime(t.createdAt) }}</div>
        <router-link v-if="targetRoute(t)" class="btn sm" :to="targetRoute(t)" @click.stop>打开对象</router-link>
        <button class="btn sm" @click.stop="openDetail(t)">查看任务</button>
      </div>
      <p v-if="!loadError && displayedTasks.length === 0" class="muted" style="text-align:center; padding:50px 0">{{ q || projectFilter ? '没有匹配的任务' : '此分组暂无任务' }}</p>
      <div class="row" style="padding:8px 4px; align-items:center; gap:10px">
        <span class="xs muted">共 {{ total }} 项<template v-if="projectFilter"> · 当前筛选显示 {{ displayedTasks.length }} 项</template></span>
        <button v-if="hasMore" class="btn sm" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '加载中…' : '加载更多' }}</button>
        <span class="xs muted">百分比仅来自任务可信进度；无法确认时只显示状态与已用时间。</span>
      </div>
    </div>

    <!-- 任务详情抽屉 -->
    <div v-if="detail" class="scrim" style="z-index:80" @click="closeDetail"></div>
    <aside v-if="detail" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3 style="font-size:14px">{{ detail.title }}</h3>
        <span class="badge" :class="statusBadgeClass(detail.status)">{{ statusLabel(detail.status) }}</span>
        <button class="icon-btn" @click="closeDetail"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="sec-t">生命周期</div>
        <div class="tl">
          <div class="tl-item done">任务创建<span class="t">{{ fmtFull(detail.createdAt) }}</span></div>
          <div class="tl-item" :class="{ done: ['running', 'composing', 'completed', 'exported', 'imported'].includes(detail.status), cur: ['running', 'composing'].includes(detail.status) }">
            {{ lifecycleText(detail) }}
            <span class="t">{{ fmtFull(detail.updatedAt) }}</span>
          </div>
          <div v-if="detail.completedAt" class="tl-item done">完成<span class="t">{{ fmtFull(detail.completedAt) }}</span></div>
          <div v-if="detail.status === 'failed'" class="tl-item" style="color:var(--danger)">失败<span class="t">{{ detail.statusMessage || '' }}</span></div>
          <div v-if="detail.status === 'cancelled'" class="tl-item" style="color:var(--muted)">已取消（记录保留）</div>
        </div>

        <div class="divider"></div>
        <div class="sec-t">输入快照</div>
        <div class="row" style="flex-wrap:wrap; gap:6px; margin-bottom:6px">
          <span class="chip">{{ typeShortLabel(detail.taskType) }}</span>
          <span class="chip">{{ sourceTagLabel(detail.source) }}</span>
          <span class="chip mono">{{ detail.sourceId }}</span>
          <span v-if="detail.prompt" class="chip">{{ detail.prompt }}</span>
        </div>
        <p class="xs muted" style="margin:0">快照为任务中心聚合记录的输入摘要；完整生成参数在对应阶段页查看。</p>

        <div class="divider"></div>
        <div class="sec-t">Provider / 规格</div>
        <div class="kv"><span class="k">类型</span><span class="v">{{ typeShortLabel(detail.taskType) }}</span></div>
        <div class="kv"><span class="k">执行方式</span><span class="v">{{ sourceTagLabel(detail.source) }}</span></div>
        <div class="kv"><span class="k">对象</span><span class="v">{{ describeTarget(detail.target) || detail.sourceId }}</span></div>
        <div class="kv" v-if="detail.progress != null"><span class="k">进度</span><span class="v">{{ detail.progress }}%</span></div>

        <div class="divider"></div>
        <div class="sec-t">时间与费用</div>
        <div class="kv"><span class="k">创建时间</span><span class="v">{{ fmtFull(detail.createdAt) }}</span></div>
        <div class="kv"><span class="k">更新时间</span><span class="v">{{ fmtFull(detail.updatedAt) }}</span></div>
        <div class="kv" v-if="detail.completedAt"><span class="k">完成时间</span><span class="v">{{ fmtFull(detail.completedAt) }}</span></div>
        <div class="kv"><span class="k">费用</span><span class="v">{{ costNoteText(detail) }}</span></div>

        <template v-if="detail.statusMessage">
          <div class="divider"></div>
          <div class="sec-t">错误与恢复</div>
          <p class="small" :class="{ 'danger-t': detail.status === 'failed' }" style="margin:0 0 8px; white-space:pre-wrap; word-break:break-word">{{ detail.statusMessage }}</p>
          <div class="row" style="gap:8px">
            <button v-if="failedRetryable(detail)" class="btn sm danger" @click="retryTask(detail)">按原输入重试</button>
            <button v-else-if="detail.status === 'failed' && detail.source === 'external'" class="btn sm primary" @click="openExternalWizard(detail)">打开外部向导</button>
          </div>
        </template>

        <div class="divider"></div>
        <div class="row" style="margin-top:10px; padding:8px 11px; border:1px solid var(--line); border-radius:8px; cursor:pointer" @click="techOpen = !techOpen">
          <span class="small t2">技术详情</span><span class="xs muted">任务 ID · 来源 · 原始状态</span>
        </div>
        <div v-if="techOpen" class="xs muted" style="padding:8px 11px; line-height:1.8">
          任务 ID：{{ detail.id }}<br>来源：{{ detail.source }} · {{ detail.sourceId }}<br>状态：{{ detail.status }} · 进度 {{ detail.progress != null ? detail.progress + '%' : '—' }}<br>更新：{{ fmtFull(detail.updatedAt) }}
        </div>
      </div>
      <div class="drawer-f">
        <button v-if="cancellable(detail)" class="btn danger" @click="cancelTask(detail)">取消任务</button>
        <button v-if="retryable(detail)" class="btn primary" @click="retryTask(detail)">按原输入重试</button>
        <router-link v-if="targetRoute(detail)" class="btn" :to="targetRoute(detail)">打开对象</router-link>
        <div class="spacer"></div>
        <span class="xs muted">重试创建新 attempt · 不覆盖记录</span>
      </div>
    </aside>
  </div>
</template>

<script>
import v21 from '../../v21/api.js'

const SOURCE_LABELS = { async: '平台任务', external: '外部协作', compose: '成片合成' }
const SOURCE_TAG_LABELS = { async: '本地任务', external: '外部任务', compose: '合成任务' }
const TYPE_SHORT_LABELS = { image: '图片', video: '视频', external: '外部协作', compose: '合成', 'quick-create': '自由创作' }
const STAGE_LABELS = { storyboard: '分镜阶段', cut: '成片阶段', episodes: '剧集' }

export default {
  name: 'TasksView',
  data() {
    return {
      all: [],
      counts: { in_progress: 0, attention: 0, done: 0 },
      tab: 'in_progress',
      q: '',
      typeFilter: '',
      projectFilter: '',
      page: 1,
      pageSize: 100,
      total: 0,
      loadingMore: false,
      detail: null,
      selected: null,
      techOpen: false,
      lastSync: '',
      loadError: '',
      loading: false,
      timer: null,
      qTimer: null,
    }
  },
  computed: {
    hasMore() { return this.all.length < this.total },
    // 项目筛选选项：从当前已加载 items 的 target.projectId 去重生成（客户端过滤，不新增后端）
    projectOptions() {
      const seen = new Map()
      for (const t of this.all) {
        const pid = t.target?.projectId
        if (pid == null || seen.has(String(pid))) continue
        seen.set(String(pid), `项目 #${pid}`)
      }
      return Array.from(seen, ([value, label]) => ({ value, label }))
    },
    displayedTasks() {
      if (!this.projectFilter) return this.all
      return this.all.filter((t) => String(t.target?.projectId) === this.projectFilter)
    },
  },
  watch: {
    tab() { this.load() },
    typeFilter() { this.load() },
    q() {
      clearTimeout(this.qTimer)
      this.qTimer = setTimeout(() => this.load(), 350)
    },
  },
  async mounted() {
    await this.load()
    await this.consumeFocusQuery()
    this.timer = setInterval(() => this.load(), 5000)
  },
  unmounted() {
    clearInterval(this.timer)
    clearTimeout(this.qTimer)
  },
  methods: {
    buildListParams(page) {
      const params = { status: this.tab, page, page_size: this.pageSize }
      if (this.typeFilter) params.type = this.typeFilter
      if (this.q.trim()) params.q = this.q.trim()
      return params
    },
    async load() {
      this.loading = true
      try {
        const params = this.buildListParams(1)
        // 当页签数据 + 三个页签的 total（page_size=1 只取计数）
        const [data, inProgress, attention, done] = await Promise.all([
          v21.listV21Tasks(params),
          v21.listV21Tasks({ status: 'in_progress', page: 1, page_size: 1 }),
          v21.listV21Tasks({ status: 'attention', page: 1, page_size: 1 }),
          v21.listV21Tasks({ status: 'done', page: 1, page_size: 1 }),
        ])
        this.all = Array.isArray(data?.items) ? data.items : []
        this.page = 1
        this.total = Number(data?.total) || 0
        this.counts = {
          in_progress: inProgress?.total ?? 0,
          attention: attention?.total ?? 0,
          done: done?.total ?? 0,
        }
        this.loadError = ''
        this.lastSync = new Date().toLocaleTimeString()
        // 轮询后让打开中的抽屉跟随最新数据（任务已不在本页签时保留旧快照）
        if (this.detail) {
          const fresh = this.all.find((t) => t.id === this.detail.id)
          if (fresh) this.detail = fresh
        }
      } catch (e) {
        this.loadError = e?.message || '加载任务失败，请稍后重试'
      } finally {
        this.loading = false
      }
    },
    async loadMore() {
      if (this.loadingMore || this.all.length >= this.total) return
      this.loadingMore = true
      try {
        const data = await v21.listV21Tasks(this.buildListParams(this.page + 1))
        const items = Array.isArray(data?.items) ? data.items : []
        this.all = this.all.concat(items)
        this.page += 1
        this.total = Number(data?.total) || this.total
      } catch (e) {
        this.loadError = e?.message || '加载更多失败，请稍后重试'
      } finally {
        this.loadingMore = false
      }
    },
    // §24.10 深链：?focus=<任务id> 自动切到所在页签并打开详情，随后清除 query
    async consumeFocusQuery() {
      const focusId = this.$route?.query?.focus
      if (!focusId) return
      try {
        const data = await v21.listV21Tasks({ page: 1, page_size: 100 })
        const items = Array.isArray(data?.items) ? data.items : []
        const target = items.find((t) => t.id === focusId)
        if (target) {
          this.tab = this.statusTab(target.status)
          this.openDetail(target)
        }
      } catch (e) {
        // 深链定位失败不阻塞任务中心本身，仍清除 query
      } finally {
        this.$router.replace({ query: {} })
      }
    },
    statusTab(status) {
      if (['failed', 'waiting_external'].includes(status)) return 'attention'
      if (['completed', 'cancelled', 'exported', 'imported'].includes(status)) return 'done'
      return 'in_progress'
    },
    taskSource(t) {
      const parts = [SOURCE_LABELS[t.source] || t.source]
      if (t.target?.projectId) parts.push(`项目 #${t.target.projectId}`)
      return parts.join(' · ')
    },
    targetRoute(t) {
      const tg = t?.target
      if (!tg || !tg.projectId || !tg.episodeId || !tg.stage) return null
      return `/projects/${tg.projectId}/episodes/${tg.episodeId}/${tg.stage}`
    },
    describeTarget(tg) {
      if (!tg) return ''
      const bits = []
      if (tg.projectId) bits.push(`项目 #${tg.projectId}`)
      if (tg.episodeId) bits.push(`集 #${tg.episodeId}`)
      if (tg.shotId) bits.push(`镜头 #${tg.shotId}`)
      if (tg.stage && STAGE_LABELS[tg.stage]) bits.push(STAGE_LABELS[tg.stage])
      return bits.join(' · ')
    },
    typeLabel(type) {
      return {
        image: '图片生成', video: '视频生成', 'quick-create': '自由创作',
        external: '外部 AI 制作包', compose: '整集合成',
      }[type] || type
    },
    typeShortLabel(type) {
      return TYPE_SHORT_LABELS[type] || this.typeLabel(type)
    },
    sourceTagLabel(source) {
      return SOURCE_TAG_LABELS[source] || source
    },
    costNoteText(task) {
      if (task.costNote) return task.costNote
      if (task.source === 'external') return '费用由外部服务结算'
      return '本地执行 · 不产生 API 费用'
    },
    typeIcon(t) {
      if (t.taskType === 'external') return '#i-spark'
      if (t.taskType === 'image') return '#i-image'
      if (t.taskType === 'video' || t.taskType === 'compose') return '#i-film'
      return '#i-spark'
    },
    typeColor(t) {
      if (t.taskType === 'image') return 'var(--accent)'
      if (t.taskType === 'video' || t.taskType === 'compose') return 'var(--info)'
      if (t.taskType === 'external') return 'var(--warn, var(--info))'
      return 'var(--muted)'
    },
    statusLabel(status) {
      return {
        pending: '排队中', running: '运行中', completed: '已完成', failed: '失败',
        cancelled: '已取消', waiting_external: '等待外部结果', composing: '合成中',
        exported: '已导出', imported: '已导入', 'cancel-requested': '取消中',
      }[status] || status
    },
    statusIcon(status) {
      return {
        pending: '#i-clock', running: '#i-refresh', composing: '#i-refresh',
        completed: '#i-check-c', exported: '#i-check-c', imported: '#i-check-c',
        failed: '#i-warn', cancelled: '#i-clock', waiting_external: '#i-clock',
        'cancel-requested': '#i-clock',
      }[status] || '#i-clock'
    },
    statusTextClass(status) {
      return {
        pending: '', running: 'info-t', composing: 'info-t', completed: 'ok-t',
        exported: 'ok-t', imported: 'ok-t', failed: 'danger-t', cancelled: '',
        waiting_external: 'warn-t', 'cancel-requested': 'warn-t',
      }[status] || ''
    },
    statusProgressClass(status) {
      return { running: 'info', composing: 'info', completed: 'ok', exported: 'ok', imported: 'ok' }[status] || ''
    },
    statusBadgeClass(status) {
      return {
        pending: 'neutral', running: 'info', composing: 'info', completed: 'ok',
        exported: 'ok', imported: 'ok', failed: 'danger', cancelled: 'neutral',
        waiting_external: 'warn', 'cancel-requested': 'warn',
      }[status] || 'neutral'
    },
    lifecycleText(detail) {
      if (detail.status === 'pending') return '排队中'
      if (detail.status === 'running') return `执行中 · 进度 ${detail.progress || 0}%`
      if (detail.status === 'composing') return '整集合成中'
      if (detail.status === 'waiting_external') return '等待外部 AI 结果'
      if (detail.status === 'cancelled') return '已取消'
      return '开始执行'
    },
    cancellable(task) {
      return ['pending', 'running', 'composing', 'waiting_external'].includes(task.status)
    },
    retryable(task) {
      return task.source === 'async' && ['failed', 'cancelled'].includes(task.status)
    },
    // 错误与恢复区的内联重试：failed 的 async/compose 任务按原输入重试
    failedRetryable(task) {
      return task.status === 'failed' && ['async', 'compose'].includes(task.source)
    },
    fmtTime(t) { return t ? String(t).slice(11, 19) : '' },
    fmtFull(t) { return t ? String(t).replace('T', ' ').slice(5, 19) : '' },
    openDetail(t) {
      this.detail = t
      this.selected = t.id
      this.techOpen = false
    },
    closeDetail() {
      this.detail = null
      this.selected = null
    },
    openExternalWizard(task) {
      const pid = task?.target?.projectId
      if (!pid) {
        window.alert('缺少项目信息，无法打开外部向导')
        return
      }
      // 带 taskId 让外部 AI 向导直接恢复到该任务
      this.$router.push(`/projects/${pid}/episodes/external-ai?taskId=${task.sourceId}`)
    },
    async cancelTask(task) {
      // 本期仅外部协作任务支持在任务中心直接取消；其余类型给说明性提示（到对应阶段页操作）
      if (task.source !== 'external') {
        window.alert('该任务类型暂不支持在任务中心直接取消，请打开对象进入对应阶段页（分镜/成片）操作。')
        return
      }
      if (!window.confirm('确认取消该外部 AI 任务？取消后记录保留。')) return
      try {
        await v21.cancelExternalTask(task.sourceId)
        this.closeDetail()
        await this.load()
      } catch (e) {
        window.alert(e?.message || '取消失败，请稍后重试')
      }
    },
    async retryTask(task) {
      try {
        await v21.retryVideoTask(task.sourceId)
        this.closeDetail()
        await this.load()
      } catch (e) {
        window.alert(e?.message || '该任务类型暂不支持自动重试，请在原页面按原输入重新提交')
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
.banner.danger { display: flex; align-items: center; gap: 10px; margin: 10px 24px 0; padding: 10px 14px; border: 1px solid var(--danger); border-radius: 9px; color: var(--danger); background: rgba(248, 81, 73, .08); font-size: 12.5px; }
.banner.danger svg { width: 15px; height: 15px; flex: 0 0 auto; }
.banner.danger span { flex: 1; }
.sec-t { font-size: 11.5px; font-weight: 600; color: var(--muted); margin-bottom: 8px; letter-spacing: .3px; }
.tl { display: flex; flex-direction: column; gap: 0; }
.tl-item { position: relative; padding: 5px 0 5px 18px; font-size: 12.5px; color: var(--text-2); }
.tl-item::before { content: ""; position: absolute; left: 3px; top: 11px; width: 7px; height: 7px; border-radius: 50%; background: var(--neutral); }
.tl-item.done::before { background: var(--ok); }
.tl-item.cur::before { background: var(--info); box-shadow: 0 0 0 3px rgba(88,166,255,.2); }
.tl-item .t { color: var(--muted); font-size: 11px; margin-left: 8px; }
.mono { font-family: Consolas, monospace; }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
.tfilter select.input { padding: 0 8px; }
</style>
