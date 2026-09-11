<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <span class="t2 bold">{{ projectTitle }}</span>
      <nav class="ptabs">
        <span class="ptab" @click="$router.push(`/projects/${projectId}`)">概览</span>
        <span class="ptab on">剧集</span>
        <span class="ptab" @click="$router.push(`/projects/${projectId}/assets`)">项目素材</span>
      </nav>
      <div class="spacer"></div>
      <div class="input" style="width:220px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="集号 / 标题" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13.5px" @input="load">
      </div>
    </header>
    <div class="page-body">

      <div class="ep-toolbar">
        <div class="seg">
          <span :class="{ on: status === 'all' }" @click="setStatus('all')">全部 {{ counts.all }}</span>
          <span :class="{ on: status === 'making' }" @click="setStatus('making')">制作中 {{ counts.making }}</span>
          <span :class="{ on: status === 'needs-attention' }" @click="setStatus('needs-attention')">需要处理 {{ counts.needsAttention }}</span>
          <span :class="{ on: status === 'completed' }" @click="setStatus('completed')">已完成 {{ counts.completed }}</span>
        </div>
        <div class="spacer"></div>
        <button class="btn" @click="importOpen = !importOpen">
          <svg><use href="#i-download"/></svg>导入 / 协作<svg class="chev" style="width:14px;height:14px"><use href="#i-chev-d"/></svg>
        </button>
        <button class="btn primary" style="height:36px" @click="newEpisode">
          <svg><use href="#i-plus"/></svg>新建剧集
        </button>
        <div v-if="importOpen" class="card popover" @click="importOpen = false">
          <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-package`)">
            <div class="ic"><svg><use href="#i-box"/></svg></div>
            <div><b>导入制作包</b><p>episode-package@2.1 · 五步预览导入</p></div>
          </div>
          <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/external-ai`)">
            <div class="ic"><svg><use href="#i-spark"/></svg></div>
            <div><b>外部 AI 制作</b><p>创建任务包，外部会话结果 JSON 回流为草稿</p></div>
          </div>
          <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-novel`)">
            <div class="ic"><svg><use href="#i-doc"/></svg></div>
            <div><b>小说 / 长文本拆集</b><p>按章节预览拆集与编号，逐集生成草稿</p></div>
          </div>
          <div class="pop-sep"></div>
          <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-video`)">
            <div class="ic" style="background:var(--neutral-subtle); color:var(--muted)"><svg><use href="#i-film"/></svg></div>
            <div><b>从已有视频开始剪辑</b><p>登记原片后进入短片页，只读保护原文件</p></div>
          </div>
        </div>
      </div>

      <div class="ep-list">
        <div v-for="ep in items" :key="ep.id" class="card ep-row" :class="{ current: ep.needsAttention }">
          <span class="ep-no">E{{ String(ep.episodeNumber).padStart(2, '0') }}</span>
          <div class="ep-title"><b>{{ ep.title || '未命名' }}</b></div>
          <div class="ep-src">
            <span v-if="ep.hasImportSource" class="badge accent">外部 AI 导入</span>
            <span v-else class="badge outline">{{ sourceLabel(ep) }}</span>
          </div>
          <div class="stage-cells">
            <div class="s-cell" :class="cellClass(ep, 'script')"><svg><use :href="cellIcon(ep, 'script')"/></svg>剧本 {{ cellText(ep, 'script') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'assets')"><svg><use :href="cellIcon(ep, 'assets')"/></svg>设定 {{ cellText(ep, 'assets') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'storyboard')"><svg><use :href="cellIcon(ep, 'storyboard')"/></svg>分镜 {{ cellText(ep, 'storyboard') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'cut')"><svg><use :href="cellIcon(ep, 'cut')"/></svg>成片 {{ cellText(ep, 'cut') }}</div>
          </div>
          <div class="ep-last">上次 · {{ stageLabel(ep.stage) }}<br>{{ relTime(ep.lastWorkedAt) }}</div>
          <div class="row">
            <button v-if="ep.status !== 'blank'" class="btn primary sm" @click="open(ep)">继续制作</button>
            <button v-else class="btn sm" @click="open(ep)">开始创建</button>
            <button class="icon-btn" @click="rowMenu(ep)"><svg><use href="#i-more"/></svg></button>
          </div>
        </div>
        <p v-if="items.length === 0" class="muted" style="text-align:center; padding:60px 0">还没有剧集，点击「新建剧集」直达空白剧本</p>
      </div>
    </div>

    <!-- 删除确认 Modal（32） -->
    <div v-if="deleteTarget" class="scrim" style="z-index:80" @click="deleteTarget = null"></div>
    <div v-if="deleteTarget" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:540px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>删除剧集 · E{{ String(deleteTarget.episodeNumber).padStart(2, '0') }}</h3>
          <button class="icon-btn" @click="deleteTarget = null"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <b style="font-size:13.5px">将移入回收站的内容：</b>
          <div class="imp-rows" style="margin-top:10px">
            <div class="kv"><span class="k">剧本版本</span><span class="v">{{ deleteImpact.scriptRevisions }} 个</span></div>
            <div class="kv"><span class="k">分镜</span><span class="v">{{ deleteImpact.storyboards }} 个</span></div>
            <div class="kv"><span class="k">时段</span><span class="v">{{ deleteImpact.segments }} 个</span></div>
            <div class="kv"><span class="k">候选（镜头组建）</span><span class="v">{{ deleteImpact.candidates }} 组</span></div>
            <div class="kv"><span class="k">导入来源记录</span><span class="v">{{ deleteImpact.imports }} 条（只读审计，保留）</span></div>
          </div>
          <div class="divider" style="margin:12px 0"></div>
          <div class="xs" style="color:var(--warn); line-height:1.6">
            <svg style="width:12px;height:12px;vertical-align:-1px"><use href="#i-warn"/></svg>
            回收站保护：30 天内可从回收站筛选恢复。运行中任务需先取消；导出成片与外部来源审计记录随项目保留。
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="deleteTarget = null">取消</button>
          <button class="btn primary" style="background:var(--danger); border-color:var(--danger)" @click="doDelete">确认删除（可恢复）</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectEpisodesView',
  data() {
    return {
      items: [], q: '', status: 'all', importOpen: false,
      projectTitle: '', deleteTarget: null, deleteImpact: {},
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    counts() {
      return {
        all: this.allItems.length,
        making: this.allItems.filter((i) => i.status === 'making').length,
        needsAttention: this.allItems.filter((i) => i.status === 'needs-attention').length,
        completed: this.allItems.filter((i) => i.status === 'completed').length,
      }
    },
    allItems() { return this._allItems || [] },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.listEpisodes(this.projectId, { q: this.q })
      this._allItems = data.items || []
      this.items = this.status === 'all' ? this._allItems : this._allItems.filter((i) => i.status === this.status)
      try {
        const overview = await v21.getOverview(this.projectId)
        this.projectTitle = overview.hero.title
      } catch { /* ignore */ }
    },
    setStatus(s) { this.status = s; this.load() },
    stageLabel(stage) {
      return { script: '剧本', assets: '本集设定', storyboard: '分镜', cut: '成片' }[stage] || '—'
    },
    sourceLabel(ep) {
      if (ep.status === 'blank') return '空白创建'
      return '手工创建'
    },
    cellState(ep, stage) {
      if (ep.stage === null || ep.status === 'blank') {
        return stage === 'script' ? 'empty-start' : 'locked'
      }
      if (ep.needsAttention) return 'warn-cell'
      const order = ['script', 'assets', 'storyboard', 'cut']
      const idx = order.indexOf(ep.stage)
      const stageIdx = order.indexOf(stage)
      if (stageIdx < idx) return 'ok'
      if (stageIdx === idx) return 'info'
      return 'empty'
    },
    cellClass(ep, stage) {
      const state = this.cellState(ep, stage)
      return { ok: 'ok', info: 'info', 'warn-cell': 'warn', empty: 'empty', 'empty-start': 'empty', locked: 'empty' }[state] || 'empty'
    },
    cellIcon(ep, stage) {
      const state = this.cellState(ep, stage)
      if (state === 'ok') return '#i-check-c'
      if (state === 'info') return '#i-refresh'
      if (state === 'warn-cell') return '#i-warn'
      return '#i-clock'
    },
    cellText(ep, stage) {
      const state = this.cellState(ep, stage)
      if (state === 'locked') return '未解锁'
      if (state === 'empty') return stage === 'script' ? '空白' : '未开始'
      if (state === 'ok') {
        if (stage === 'script') return '已确认'
        if (stage === 'assets') return '已准备'
        if (stage === 'storyboard') return '已完成'
        if (stage === 'cut') return '已完成'
      }
      if (state === 'info') {
        if (stage === 'script') return '编辑中'
        return '进行中'
      }
      if (state === 'warn-cell') return '需处理'
      return '—'
    },
    relTime(t) {
      if (!t) return '—'
      const diff = Date.now() - new Date(t).getTime()
      const h = Math.floor(diff / 3600000)
      if (h < 1) return '刚刚'
      if (h < 24) return `${h} 小时前`
      return String(t).slice(0, 10)
    },
    open(ep) {
      const stage = ep.stage || 'script'
      this.$router.push(`/projects/${this.projectId}/episodes/${ep.id}/${stage}`)
    },
    async newEpisode() {
      const next = (this.allItems.length || 0) + 1
      const value = window.prompt(`创建空白草稿并直接进入剧本页。集号：`, String(next))
      if (!value) return
      try {
        const created = await v21.createEpisode(this.projectId, { episodeNumber: Number(value) || undefined })
        this.$router.push(`/projects/${this.projectId}/episodes/${created.id}/script`)
      } catch (e) {
        alert(e.message)
      }
    },
    async rowMenu(ep) {
      const action = window.prompt(`剧集 E${String(ep.episodeNumber).padStart(2, '0')} 操作，输入序号：\n1 重命名\n2 调整集序\n3 删除（回收站）`, '1')
      if (!action) return
      if (action === '1') {
        const title = window.prompt('新标题', ep.title || '')
        if (title === null) return
        await v21.renameEpisode(ep.id, { title })
        this.load()
      } else if (action === '2') {
        const order = window.prompt('新的集号', String(ep.episodeNumber))
        if (!order) return
        const ids = this.allItems.map((i) => i.id)
        const from = ids.indexOf(ep.id)
        ids.splice(from, 1)
        ids.splice(Math.max(0, Number(order) - 1), 0, ep.id)
        try {
          await v21.reorderEpisodes(this.projectId, ids)
          this.load()
        } catch (e) { alert(e.message) }
      } else if (action === '3') {
        this.deleteTarget = ep
        this.deleteImpact = await v21.getDeleteImpact(ep.id)
      }
    },
    async doDelete() {
      if (!this.deleteTarget) return
      await v21.deleteEpisode(this.deleteTarget.id)
      this.deleteTarget = null
      this.load()
    },
    comingSoon(name) {
      importOpenClose(this)
      alert(`${name}向导将在本迭代内启用`)
    },
  },
}

function importOpenClose(ctx) {
  ctx.importOpen = false
}
</script>

<style scoped>
.ep-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.ep-list { display: flex; flex-direction: column; gap: 8px; }
.ep-row { display: flex; align-items: center; gap: 14px; padding: 12px 16px; }
.ep-row.current { border-color: var(--accent); }
.ep-no { font-weight: 700; font-size: 14px; color: var(--text-2); width: 36px; flex: 0 0 auto; }
.ep-title { min-width: 120px; }
.ep-title b { font-size: 13.5px; display: block; }
.ep-title span { font-size: 11px; color: var(--muted); }
.ep-src { flex: 0 0 auto; }
.stage-cells { display: flex; gap: 8px; flex: 1; flex-wrap: wrap; }
.s-cell {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px;
  border: 1px solid var(--line); border-radius: 7px; padding: 4px 9px; color: var(--text-2);
}
.s-cell svg { width: 12px; height: 12px; }
.s-cell.ok { border-color: rgba(69,211,156,.4); color: var(--ok); }
.s-cell.info { border-color: rgba(88,166,255,.4); color: var(--info); }
.s-cell.warn { border-color: rgba(255,182,92,.4); color: var(--warn); }
.s-cell.empty { color: var(--muted); opacity: .75; }
.ep-last { font-size: 11px; color: var(--muted); text-align: right; line-height: 1.55; flex: 0 0 auto; }
.popover { position: absolute; right: 210px; top: 118px; z-index: 40; padding: 8px; min-width: 300px; }
.pop-item { display: flex; gap: 11px; padding: 10px; border-radius: 8px; cursor: pointer; }
.pop-item:hover { background: var(--panel2); }
.pop-item .ic { width: 32px; height: 32px; border-radius: 8px; background: var(--accent-subtle); color: var(--accent); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.pop-item .ic svg { width: 15px; height: 15px; }
.pop-item b { font-size: 13px; display: block; }
.pop-item p { font-size: 11.5px; color: var(--muted); margin: 2px 0 0; }
.pop-sep { height: 1px; background: var(--line); margin: 6px 0; }
.ptabs { display: flex; gap: 4px; background: var(--panel2); border-radius: 8px; padding: 3px; }
.ptab { padding: 6px 16px; border-radius: 6px; font-size: 13px; color: var(--muted); cursor: pointer; }
.ptab.on { background: var(--accent-subtle); color: #fff; font-weight: 500; }
.imp-rows .kv { border-bottom: 1px solid var(--line); padding: 7px 0; }
.imp-rows .kv:last-of-type { border-bottom: none; }
</style>
