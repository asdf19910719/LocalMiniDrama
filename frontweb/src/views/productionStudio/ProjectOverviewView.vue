<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <span class="t2 bold">{{ overview?.hero?.title || '…' }}</span>
      <nav class="ptabs">
        <span class="ptab on">概览</span>
        <span class="ptab" @click="$router.push(`/projects/${projectId}/episodes`)">剧集</span>
        <span class="ptab" @click="$router.push(`/projects/${projectId}/assets`)">项目素材</span>
      </nav>
      <div class="spacer"></div>
      <div class="more-wrap">
        <button class="btn ghost" @click="opsOpen = !opsOpen"><svg><use href="#i-more"/></svg>项目操作</button>
        <div v-if="opsOpen" class="card more-pop">
          <button class="btn ghost sm" style="width:100%;justify-content:flex-start" :disabled="exporting" @click="exportBackup">{{ exporting ? '正在导出…' : '导出项目备份' }}</button>
          <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="opsOpen = false; $router.push('/settings/data-tools')">高级数据工具</button>
          <div class="more-sep"></div>
          <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="$router.push('/projects/import-archive')">从归档导入（创建新项目）</button>
          <div class="xs muted more-note">归档导入不会覆盖现有项目；项目内恢复需在高级数据工具处理</div>
          <div class="more-sep"></div>
          <button class="btn ghost sm danger" style="width:100%;justify-content:flex-start" @click="deleteProject">移入回收站</button>
          <div v-if="opsError" class="notice-strip danger xs" style="margin:6px">{{ opsError }}</div>
        </div>
      </div>
      <button class="btn" @click="editOpen = true"><svg><use href="#i-pencil"/></svg>编辑项目</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">

      <!-- 加载失败（不伪装） -->
      <div class="card pad" v-if="loadError" style="display:flex; align-items:center; gap:12px">
        <span style="color:var(--danger)">项目信息加载失败：{{ loadError }}</span>
        <div class="spacer"></div>
        <button class="btn" @click="load">重试</button>
      </div>

      <!-- Hero -->
      <div class="card hero" v-if="overview">
        <div class="cover" :class="overview.hero.thumbnail ? '' : 'ph'">
          <img v-if="overview.hero.thumbnail" :src="overview.hero.thumbnail">
        </div>
        <div class="grow col" style="gap:8px; justify-content:center">
          <div class="row" style="gap:10px">
            <h1 style="font-size:22px">{{ overview.hero.title }}</h1>
            <span class="badge" :class="statusBadgeClass">{{ statusLabel }}</span>
          </div>
          <div class="t2 small">{{ overview.hero.description || '暂无简介' }}</div>
          <div class="muted small">
            {{ overview.hero.genre || '未设置题材' }} · {{ overview.hero.aspectRatio }} · {{ overview.hero.episodeCount }} 集 · 最近编辑 {{ relTime(overview.hero.updatedAt) }}
          </div>
        </div>
      </div>

      <!-- 下一步 + 待处理 -->
      <div class="grid-2" v-if="overview">
        <div class="card pad" style="display:flex; flex-direction:column; gap:10px">
          <div class="row"><b style="font-size:13.5px">下一步</b><span class="badge accent">继续制作</span></div>
          <template v-if="overview.nextStep">
            <div>
              <div class="bold" style="font-size:15px">第 {{ overview.nextStep.episodeNumber }} 集 · {{ stageLabel(overview.nextStep.stage) }}</div>
              <div class="muted small" style="margin-top:4px">上次工作 {{ relTime(overview.hero.updatedAt) }}</div>
            </div>
            <div class="row" style="margin-top:4px">
              <button class="btn primary" @click="$router.push(`/projects/${projectId}/episodes/${overview.nextStep.episodeId}/${overview.nextStep.stage}`)">继续制作</button>
              <button class="btn ghost" @click="$router.push(`/projects/${projectId}/episodes`)">换一集</button>
            </div>
          </template>
          <template v-else>
            <div class="muted small">还没有剧集</div>
            <button class="btn primary" style="align-self:flex-start" @click="$router.push(`/projects/${projectId}/episodes`)">创建第 1 集</button>
          </template>
        </div>
        <div class="card pad">
          <div class="row" style="margin-bottom:4px"><b style="font-size:13.5px">待处理</b><span class="badge" :class="(overview.pending || []).length ? 'warn' : 'ok'">{{ (overview.pending || []).length }}</span><div class="spacer"></div><span class="muted xs">仅显示项目级优先项</span></div>
          <div v-for="(p, i) in overview.pending || []" :key="i" class="todo-item">
            <span class="badge" :class="p.severity === 'danger' ? 'danger' : 'warn'">{{ p.badge }}</span>
            <span class="ellipsis">{{ p.text }}</span>
            <span class="act" @click="goPending(p)">{{ p.action }}</span>
          </div>
          <p v-if="!(overview.pending || []).length" class="xs muted" style="padding:6px 0">暂无待处理项</p>
        </div>
      </div>

      <!-- 四阶段项目级汇总（点击进入剧集页并携带阶段筛选） -->
      <div class="grid-4" v-if="overview">
        <div v-for="(st, key) in overview.stageSummary || {}" :key="key" class="card stage-card" @click="goStage(key)">
          <div class="head"><svg><use :href="stageIcon(key)"/></svg><b>{{ stageLabel(key) }}</b><span class="muted xs">{{ overview.hero.episodeCount }} 集</span></div>
          <div class="srow"><span class="k"><span class="dot" style="background:var(--ok)"></span>已确认</span><span>{{ st.approved }} 集</span></div>
          <div class="srow"><span class="k"><span class="dot" style="background:var(--info)"></span>制作中</span><span>{{ st.inProgress }} 集</span></div>
          <div class="srow"><span class="k"><span class="dot" style="background:var(--warn)"></span>需处理</span><span>{{ st.needsAttention }} 集</span></div>
          <div class="srow"><span class="k"><span class="dot" style="background:var(--neutral)"></span>未开始</span><span>{{ st.notStarted }} 集</span></div>
        </div>
      </div>

      <!-- 项目素材摘要（assetsAggregate 聚合） -->
      <div class="card pad assets-summary" v-if="overview && overview.assetsAggregate">
        <b style="font-size:13.5px">项目素材</b>
        <span class="muted small">{{ overview.assetsAggregate.objectCount }} 个对象 · {{ overview.assetsAggregate.missingImageCount }} 个缺少当前图</span>
        <div class="spacer"></div>
        <span class="act" @click="$router.push(`/projects/${projectId}/assets`)">打开项目素材</span>
      </div>

      <!-- 项目画面风格 -->
      <div class="card look-card" v-if="overview">
        <div class="ph" style="width:132px; height:88px; border-radius:8px"></div>
        <div class="grow col" style="gap:6px">
          <div class="row"><b style="font-size:13.5px">项目画面风格</b><span class="badge ok">{{ overview.style.styleId }}</span></div>
          <div class="muted xs">应用只影响之后的新生成，不会改动现有素材与成片</div>
        </div>
        <div class="col" style="gap:8px">
          <button class="btn" @click="openStyleModal">更换风格</button>
          <button class="btn ghost" @click="openStyleDrawer">查看风格</button>
        </div>
      </div>
    </div>

    <!-- 编辑项目抽屉（31） -->
    <div v-if="editOpen" class="scrim" style="z-index:80" @click="closeEdit"></div>
    <aside v-if="editOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>编辑项目</h3>
        <span v-if="editDirty" class="badge warn" style="height:19px">有未保存修改</span>
        <button class="icon-btn" @click="closeEdit"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="col" style="gap:12px">
          <label class="col" style="gap:4px"><span class="xs muted">名称</span><input class="input" style="width:100%" v-model="editForm.title"></label>
          <label class="col" style="gap:4px"><span class="xs muted">题材</span><input class="input" style="width:100%" v-model="editForm.genre"></label>
          <label class="col" style="gap:4px"><span class="xs muted">画幅</span>
            <select class="input" style="width:100%" v-model="editForm.aspectRatio">
              <option>16:9</option><option>9:16</option><option>1:1</option>
            </select>
          </label>
          <label class="col" style="gap:4px"><span class="xs muted">简介</span><textarea class="input" style="width:100%; height:72px; padding:8px" v-model="editForm.description"></textarea></label>
          <div class="xs muted">保存只更新项目资料，并使外部 AI 协作上下文标记需要更新；不影响已有素材与成片。</div>
        </div>
      </div>
      <div class="drawer-f">
        <button class="btn ghost" @click="closeEdit">取消</button>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="!editDirty" @click="saveProfile">保存</button>
      </div>
    </aside>

    <!-- 查看风格抽屉（只读：来源/视觉规则/使用口径/版本记录） -->
    <div v-if="styleDrawerOpen" class="scrim" style="z-index:80" @click="styleDrawerOpen = false"></div>
    <aside v-if="styleDrawerOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>查看风格</h3>
        <button class="icon-btn" @click="styleDrawerOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="col" style="gap:16px">
          <div class="col" style="gap:4px">
            <span class="xs muted">当前风格</span>
            <div class="row" style="gap:8px">
              <b style="font-size:15px">{{ currentStyle ? currentStyle.labelZh : (overview.style.styleId || '未设置') }}</b>
              <span class="badge">{{ overview.style.styleId }}</span>
            </div>
          </div>
          <div class="col" style="gap:4px">
            <span class="xs muted">视觉规则</span>
            <div v-if="currentStyle" class="small" style="line-height:1.6">{{ currentStyle.descriptionZh }}</div>
            <div v-else class="small muted">风格目录中暂无该风格的详细描述</div>
          </div>
          <div class="col" style="gap:4px">
            <span class="xs muted">使用与影响范围</span>
            <div class="small" style="line-height:1.6">项目内未来生成默认使用该风格；更换风格不会自动重新生成已有素材。</div>
          </div>
          <div class="col" style="gap:4px">
            <span class="xs muted">版本记录</span>
            <div class="small">当前版本 v{{ currentStyle ? currentStyle.version : '?' }}</div>
            <div class="xs muted">版本历史暂未记录</div>
          </div>
        </div>
      </div>
      <div class="drawer-f">
        <div class="spacer"></div>
        <button class="btn primary" @click="styleDrawerOpen = false">关闭</button>
      </div>
    </aside>

    <!-- 更换风格 Modal（17）：选择 → 影响确认 → 应用 -->
    <div v-if="styleOpen" class="scrim" style="z-index:80" @click="styleOpen = false"></div>
    <div v-if="styleOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:880px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-palette"/></svg>
          <h3>{{ styleStep === 'confirm' ? '确认更换画面风格' : '更换画面风格' }}</h3>
          <button class="icon-btn" @click="styleOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="overflow:hidden">
          <template v-if="styleStep === 'select'">
            <div class="tabs" style="margin-bottom:8px">
              <span class="tab" :class="{ on: styleTab === 'preset' }" @click="switchStyleTab('preset')">预设风格</span>
              <span class="tab" :class="{ on: styleTab === 'mine' }" @click="switchStyleTab('mine')">我的风格</span>
              <span class="tab disabled">自定义风格</span>
            </div>
            <div class="xs muted" style="margin-bottom:10px">「自定义风格」需安装自定义风格目录后开放</div>
            <div class="input" style="width:280px; margin-bottom:12px">
              <svg><use href="#i-search"/></svg>
              <input v-model="styleQuery" placeholder="搜索风格" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13px" @input="loadStyles()">
            </div>
            <div class="style-grid">
              <div v-for="s in styles" :key="s.id" class="style-item card" :class="{ sel: s.id === selectedStyleId }" @click="selectedStyleId = s.id">
                <div class="ph" style="height:64px; border-radius:7px"></div>
                <b style="font-size:12.5px; display:block; margin-top:7px">{{ s.labelZh || s.label_zh || s.id }}</b>
                <span class="xs muted ellipsis" style="display:block">{{ s.descriptionZh || s.description_zh || '' }}</span>
              </div>
            </div>
            <p v-if="!styleLoading && !styles.length" class="xs muted" style="margin-top:10px">{{ styleTab === 'mine' ? '还没有自定义风格' : '没有匹配的风格' }}</p>
            <div class="xs muted" style="margin-top:12px">应用风格只影响之后的新生成，不会改动现有素材与成片。</div>
          </template>
          <template v-else>
            <div class="col" style="gap:14px">
              <div class="card pad" style="display:flex; align-items:center; gap:10px">
                <svg style="width:16px;height:16px;color:var(--accent)"><use href="#i-palette"/></svg>
                <b>{{ selectedStyleName }}</b>
                <span class="badge">{{ selectedStyleId }}</span>
              </div>
              <div class="col" style="gap:8px">
                <div class="row" style="gap:10px"><span class="badge info">1</span><span class="small">确认后创建新风格版本</span></div>
                <div class="row" style="gap:10px"><span class="badge info">2</span><span class="small">已引用素材与候选不自动重新生成</span></div>
                <div class="row" style="gap:10px"><span class="badge info">3</span><span class="small">历史版本保留可回看</span></div>
              </div>
              <div v-if="styleError" class="notice-strip danger small">{{ styleError }}</div>
            </div>
          </template>
        </div>
        <div class="modal-f">
          <template v-if="styleStep === 'select'">
            <button class="btn ghost" @click="styleOpen = false">取消</button>
            <div class="spacer"></div>
            <button class="btn primary" :disabled="!selectedStyleId" @click="styleStep = 'confirm'">下一步：确认影响</button>
          </template>
          <template v-else>
            <button class="btn ghost" @click="styleStep = 'select'">返回</button>
            <div class="spacer"></div>
            <button class="btn primary" :disabled="applying" @click="confirmApplyStyle">{{ applying ? '正在应用…' : '确认更换' }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectOverviewView',
  data() {
    return {
      overview: null, loadError: '', editOpen: false, editForm: {}, editDirty: false, savedForm: '',
      styleOpen: false, styles: [], styleQuery: '', selectedStyleId: '',
      styleTab: 'preset', styleStep: 'select', styleError: '', applying: false, styleLoading: false,
      styleDrawerOpen: false,
      opsOpen: false, opsError: '', exporting: false,
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    statusLabel() {
      if (!this.overview) return ''
      const pending = (this.overview.pending || []).length
      if (this.overview.hero.episodeCount === 0) return '未开始'
      if (pending > 0) return '需要处理'
      return '制作中'
    },
    statusBadgeClass() {
      return this.statusLabel === '需要处理' ? 'warn' : this.statusLabel === '未开始' ? 'neutral' : 'info'
    },
    currentStyle() {
      const id = this.overview?.style?.styleId
      if (!id) return null
      return (this.styles || []).find((s) => s.id === id) || null
    },
    selectedStyleName() {
      const hit = (this.styles || []).find((s) => s.id === this.selectedStyleId)
      return hit ? (hit.labelZh || hit.id) : (this.selectedStyleId || '未选择')
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.loadError = ''
      try {
        this.overview = await v21.getOverview(this.projectId)
        this.editForm = {
          title: this.overview.hero.title,
          genre: this.overview.hero.genre || '',
          aspectRatio: this.overview.hero.aspectRatio || '16:9',
          description: this.overview.hero.description || '',
        }
        this.savedForm = JSON.stringify(this.editForm)
        this.editDirty = false
      } catch (e) {
        this.overview = null
        this.loadError = e.message || '未知错误'
      }
    },
    async exportBackup() {
      this.exporting = true
      this.opsError = ''
      try {
        // GET /api/v1/dramas/:id/export 返回 application/zip 归档，按实际字节下载为 .zip
        const res = await axios.get(`/api/v1/dramas/${this.projectId}/export`, { responseType: 'blob' })
        const blob = new Blob([res.data], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${this.overview?.hero?.title || 'project'}-backup.zip`
        a.click()
        URL.revokeObjectURL(url)
        this.opsOpen = false
      } catch (e) {
        const status = e?.response?.status
        this.opsError = `导出项目备份失败：${status ? `HTTP ${status}` : (e.message || '网络错误')}`
      } finally {
        this.exporting = false
      }
    },
    goStage(key) {
      this.$router.push({ path: `/projects/${this.projectId}/episodes`, query: { stage: key } })
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '本集设定', storyboard: '分镜', cut: '成片' }[stage] || '剧本'
    },
    stageIcon(key) {
      return { script: '#i-book', assets: '#i-user', storyboard: '#i-clap', cut: '#i-monitor' }[key] || '#i-book'
    },
    relTime(t) {
      if (!t) return ''
      const diff = Date.now() - new Date(t).getTime()
      const m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return `${m} 分钟前`
      const h = Math.floor(m / 60)
      if (h < 24) return `${h} 小时前`
      const d = Math.floor(h / 24)
      if (d < 7) return `${d} 天前`
      return String(t).slice(0, 10)
    },
    goPending(p) {
      this.$router.push(`/projects/${this.projectId}/episodes/${p.target.episodeId}/${p.target.route}`)
    },
    closeEdit() {
      if (this.editDirty) {
        if (!window.confirm('有未保存修改，确定关闭？')) return
      }
      this.editOpen = false
    },
    async saveProfile() {
      await v21.updateProject(this.projectId, this.editForm)
      this.editOpen = false
      await this.load()
    },
    async openStyleModal() {
      this.styleOpen = true
      this.styleStep = 'select'
      this.styleError = ''
      this.styleTab = 'preset'
      this.selectedStyleId = this.overview.style.styleId || ''
      await this.loadStyles()
    },
    switchStyleTab(tab) {
      if (tab === 'custom') return
      this.styleTab = tab
      this.loadStyles()
    },
    async loadStyles(params = {}) {
      const query = { ...params }
      if (this.styleQuery) query.query = this.styleQuery
      if (!query.type && this.styleTab === 'mine') query.type = 'custom'
      if (!query.type) query.type = 'system'
      this.styleLoading = true
      try {
        this.styles = await v21.listStyles(query)
      } catch { this.styles = [] } finally { this.styleLoading = false }
    },
    async openStyleDrawer() {
      this.styleDrawerOpen = true
      // 目录全量拉取，供 currentStyle 解析名称/描述/版本
      try { this.styles = await v21.listStyles({}) } catch { this.styles = [] }
    },
    async confirmApplyStyle() {
      this.applying = true
      this.styleError = ''
      try {
        await v21.applyStyle(this.projectId, this.selectedStyleId)
        this.styleOpen = false
        await this.load()
      } catch (e) {
        this.styleError = e.message || '应用风格失败'
      } finally {
        this.applying = false
      }
    },
    async deleteProject() {
      this.opsOpen = false
      if (!window.confirm(`确定将项目“${this.overview.hero.title}”移入回收站？删除可恢复。`)) return
      await v21.deleteProject(this.projectId)
      this.$router.push('/projects')
    },
  },
  watch: {
    editForm: {
      deep: true,
      handler() { this.editDirty = JSON.stringify(this.editForm) !== this.savedForm },
    },
  },
}
</script>

<style scoped>
.hero { display: flex; gap: 20px; padding: 20px; }
.hero .cover { width: 140px; height: 92px; border-radius: 8px; overflow: hidden; flex: 0 0 auto; }
.hero .cover img { width: 100%; height: 100%; object-fit: cover; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.todo-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 12.5px; border-bottom: 1px solid var(--line); }
.todo-item:last-of-type { border-bottom: none; }
.todo-item .act { margin-left: auto; color: var(--accent); cursor: pointer; white-space: nowrap; font-size: 12px; }
.stage-card { cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
.stage-card:hover { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.stage-card .head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--line); font-size: 13px; }
.stage-card .head svg { width: 15px; height: 15px; color: var(--muted); }
.stage-card .srow { display: flex; justify-content: space-between; padding: 5px 14px; font-size: 12.5px; color: var(--text-2); }
.stage-card .srow .k { display: flex; align-items: center; gap: 7px; color: var(--muted); }
.stage-card .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.assets-summary { display: flex; align-items: center; gap: 10px; }
.assets-summary .act { margin-left: auto; color: var(--accent); cursor: pointer; white-space: nowrap; font-size: 12.5px; }
.look-card { display: flex; gap: 18px; padding: 16px; align-items: center; }
.ptabs { display: flex; gap: 4px; background: var(--panel2); border-radius: 8px; padding: 3px; }
.ptab { padding: 6px 16px; border-radius: 6px; font-size: 13px; color: var(--muted); cursor: pointer; }
.ptab.on { background: var(--accent-subtle); color: #fff; font-weight: 500; }
.more-wrap { position: relative; }
.more-pop { position: absolute; right: 0; top: 38px; z-index: 30; padding: 6px; min-width: 240px; display: flex; flex-direction: column; gap: 2px; }
.more-sep { height: 1px; background: var(--line); margin: 4px 2px; }
.more-note { padding: 2px 6px 4px; white-space: normal; line-height: 1.5; }
.tab.disabled { opacity: .45; cursor: not-allowed; }
.style-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; max-height: 380px; overflow: auto; }
.style-item { padding: 8px; cursor: pointer; }
.style-item.sel { border-color: var(--accent); background: var(--accent-subtle); }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
</style>
