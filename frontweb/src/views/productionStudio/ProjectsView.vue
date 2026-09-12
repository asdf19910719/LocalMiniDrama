<template>
  <div>
    <header class="page-head">
      <h1>项目</h1>
      <span class="sub">{{ total }} 个项目 · 本地工作区</span>
      <div class="spacer"></div>
      <div class="input" style="width:230px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="搜索项目名" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13.5px" @input="onSearch">
      </div>
      <div class="seg">
        <span v-for="opt in statusOptions" :key="opt.key" :class="{ on: status === opt.key }" @click="setStatus(opt.key)">{{ opt.label }}</span>
      </div>
      <div class="select" style="cursor:pointer">
        <select v-model="sort" class="sort-native" @change="load">
          <option value="recent">最近更新</option>
          <option value="title">项目名称</option>
        </select>
        <svg class="chev"><use href="#i-chev-d"/></svg>
      </div>
      <button class="btn" @click="$router.push('/projects/import-archive')">
        <svg><use href="#i-upload"/></svg>导入项目备份
      </button>
      <button class="btn primary" style="height:36px" @click="$router.push('/projects/new')">
        <svg><use href="#i-plus"/></svg>新建项目
      </button>
    </header>
    <div class="page-body">
      <!-- 三分状态机：加载骨架 → 错误重试 → 内容（加载完成前不渲染空态） -->
      <StateBlock v-if="loading && !loaded" state="loading" />
      <StateBlock v-else-if="loadError" state="error" :message="'项目列表加载失败：' + loadError" @retry="load" />
      <template v-else>
        <div v-if="items.length === 0" class="empty-box">
          <svg><use :href="hasFilter ? '#i-search' : '#i-film'"/></svg>
          <div>
            <p style="font-size:13.5px">{{ emptyTitle }}</p>
            <p class="xs muted" style="margin-top:4px">{{ emptyHint }}</p>
          </div>
          <button v-if="hasFilter" class="btn" @click="clearFilters">清除条件</button>
          <button v-else-if="status !== 'archived'" class="btn primary" @click="$router.push('/projects/new')">新建项目</button>
        </div>
        <div v-else class="proj-grid">
        <div v-for="(card, idx) in items" :key="card.id" class="card pcard" tabindex="0" role="button"
             @click="enter(card)" @keydown.enter="enter(card)">
          <div class="cover" :class="[card.thumbnail ? 'has-img' : 'ph', 'ph-' + (idx % 6)]">
            <img v-if="card.thumbnail" :src="card.thumbnail" alt="">
            <div class="meta-chips"><span class="badge" :class="statusBadgeClass(card.status)">{{ card.status.label }}</span></div>
            <span class="ratio">{{ card.aspectRatio || '16:9' }} · {{ card.episodeCount }} 集</span>
          </div>
          <div class="body">
            <div class="name-row">
              <h3>{{ card.title }}</h3>
              <span v-if="card.genre" class="badge outline">{{ card.genre }}</span>
            </div>
            <div class="meta">
              最近编辑 {{ relTime(card.updatedAt) }}
              <template v-if="card.lastWork"> · 第 {{ card.lastWork.episodeNumber }} 集<template v-if="card.lastEpisodeTitle">《{{ card.lastEpisodeTitle }}》</template></template>
            </div>
            <div class="taskline">
              <span v-if="card.health.generating" class="badge info">生成中 {{ card.health.generating }}</span>
              <span v-if="card.health.pending" class="badge warn">待处理 {{ card.health.pending }}</span>
              <span v-if="card.health.needsUpdate" class="badge warn">需要更新 {{ card.health.needsUpdate }}</span>
              <span v-if="card.status.key === 'completed'" class="badge ok">{{ card.episodeCount }}/{{ card.episodeCount }} 集已完成</span>
            </div>
            <div class="resume" v-if="card.lastWork" @click.stop="resume(card)">
              <template v-if="card.status.key === 'completed' && !card.health.needsUpdate">查看最新成片</template>
              <template v-else>继续第 {{ card.lastWork.episodeNumber }} 集 · {{ stageLabel(card.lastWork.stage) }}</template>
              <span class="muted xs">{{ card.lastWork.stageMeta }}</span>
              <span class="go"><svg><use :href="card.status.key === 'completed' ? '#i-eye' : '#i-fwd'"/></svg></span>
            </div>
            <div class="resume" v-else @click.stop="$router.push(`/projects/${card.id}/episodes`)">
              打开项目<span class="go"><svg><use href="#i-fwd"/></svg></span>
            </div>
          </div>
          <div class="pcard-menu" @click.stop>
            <button class="icon-btn" title="更多" @click="toggleMenu(card.id)">
              <svg><use href="#i-more"/></svg>
            </button>
            <div v-if="openMenuId === card.id" class="pcard-pop card">
              <button v-if="status === 'archived'" class="btn ghost sm" style="width:100%;justify-content:flex-start" :disabled="restoringId === card.id" @click="restoreProject(card)">{{ restoringId === card.id ? '恢复中…' : '恢复项目' }}</button>
              <button v-else class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="deleteProject(card)">移入回收站</button>
            </div>
          </div>
        </div>
        </div>
      </template>
    </div>

    <!-- 移入回收站确认 Modal（替代原生 confirm） -->
    <div v-if="deleteConfirmOpen" class="scrim" style="z-index:80" @click="cancelDeleteProject"></div>
    <div v-if="deleteConfirmOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>移入回收站</h3>
          <button class="icon-btn" @click="cancelDeleteProject"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small" style="line-height:1.6">确定将项目「{{ deleteTarget?.title }}」移入回收站？删除可恢复（保留 30 天）。</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="cancelDeleteProject">取消</button>
          <button class="btn danger" @click="confirmDeleteProject">移入回收站</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'
import { v21Toast } from '@/v21/ui.js'
import StateBlock from '@/components/v21/StateBlock.vue'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'ProjectsView',
  mixins: [escMixin],
  components: { StateBlock },
  data() {
    return {
      items: [], total: 0, q: '', status: 'all', sort: 'recent',
      searchTimer: null, openMenuId: null,
      deleteConfirmOpen: false, deleteTarget: null, restoringId: null,
      loading: false, loaded: false, loadError: '',
      statusOptions: [
        { key: 'all', label: '全部' },
        { key: 'making', label: '制作中' },
        { key: 'needs-attention', label: '需要处理' },
        { key: 'completed', label: '已完成' },
        { key: 'archived', label: '已归档' },
      ],
    }
  },
  computed: {
    // 筛选空与真空态区分：有搜索词或非「全部」页签即为筛选态
    hasFilter() {
      return !!this.q.trim() || this.status !== 'all'
    },
    emptyTitle() {
      if (this.hasFilter) return '没有匹配的项目'
      return this.status === 'archived' ? '回收站为空' : '还没有项目'
    },
    emptyHint() {
      if (this.hasFilter) return '换个关键词或页签，或清除条件后重试'
      return this.status === 'archived' ? '删除的项目会在这里保留 30 天' : '从一部短剧的剧本开始，创建第一个项目'
    },
  },
  watch: {
    '$route.query': { immediate: true, handler() { this.syncFromUrl(); this.load() } },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.globalClose = () => { this.openMenuId = null }
    window.addEventListener('click', this.globalClose)
  },
  unmounted() {
    window.removeEventListener('click', this.globalClose)
  },
  methods: {
    // Esc 自上而下关本视图的弹层（确认弹窗 → 卡片操作菜单）
    onEsc() {
      if (this.deleteConfirmOpen) { this.cancelDeleteProject(); return true }
      if (this.openMenuId != null) { this.openMenuId = null; return true }
      return false
    },
    syncFromUrl() {
      this.q = String(this.$route.query.q || '')
      this.status = String(this.$route.query.status || 'all')
      this.sort = String(this.$route.query.sort || 'recent')
    },
    writeUrl() {
      this.$router.replace({
        query: {
          q: this.q || undefined,
          status: this.status !== 'all' ? this.status : undefined,
          sort: this.sort !== 'recent' ? this.sort : undefined,
        },
      })
    },
    onSearch() {
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => { this.writeUrl(); this.load() }, 280)
    },
    setStatus(key) {
      this.status = key
      this.writeUrl()
      this.load()
    },
    async load() {
      this.loading = true
      try {
        const data = await v21.listProjects({ q: this.q, status: this.status, sort: this.sort })
        this.items = data.items || []
        this.total = data.total || 0
        this.loadError = ''
        this.loaded = true
      } catch (e) {
        // 失败呈现为可重试错误态，不再伪装成「还没有项目」
        this.loadError = e.message || '网络错误'
      } finally {
        this.loading = false
      }
    },
    clearFilters() {
      this.q = ''
      this.status = 'all'
      this.writeUrl()
      this.load()
    },
    statusBadgeClass(key) {
      return { making: 'info', 'needs-attention': 'warn', completed: 'ok', blank: 'neutral' }[key] || 'info'
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '本集设定', storyboard: '分镜', cut: '成片' }[stage] || '剧本'
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
    enter(card) {
      if (this.status === 'archived') return
      this.$router.push(`/projects/${card.id}`)
    },
    resume(card) {
      const stage = card.lastWork?.stage || 'script'
      this.$router.push(`/projects/${card.id}/episodes/${card.lastWork.episodeId}/${stage}`)
    },
    toggleMenu(cardId) {
      this.openMenuId = this.openMenuId === cardId ? null : cardId
    },
    deleteProject(card) {
      this.openMenuId = null
      this.deleteTarget = card
      this.deleteConfirmOpen = true
    },
    cancelDeleteProject() {
      this.deleteConfirmOpen = false
      this.deleteTarget = null
    },
    async confirmDeleteProject() {
      const card = this.deleteTarget
      this.cancelDeleteProject()
      if (!card) return
      await v21.deleteProject(card.id)
      this.load()
    },
    async restoreProject(card) {
      this.openMenuId = null
      if (!card || this.restoringId) return
      this.restoringId = card.id
      try {
        await v21.restoreProject(card.id)
        v21Toast('项目已恢复，可继续制作')
        this.load()
      } catch (e) {
        v21Toast(e.message || '恢复失败，请重试', 'danger')
      } finally {
        this.restoringId = null
      }
    },
  },
}
</script>

<style scoped>
.proj-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.pcard { position: relative; display: flex; flex-direction: column; overflow: hidden; cursor: pointer; transition: border-color .15s; }
.pcard:hover { border-color: var(--line-strong); }
.pcard .cover { position: relative; height: 200px; border-radius: 0; }
.pcard .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pcard .cover .meta-chips { position: absolute; left: 10px; top: 10px; display: flex; gap: 6px; z-index: 2; }
.pcard .cover .ratio {
  position: absolute; right: 10px; bottom: 10px; z-index: 2; font-size: 11px; color: #e6e9f2;
  background: rgba(10, 12, 18, .55); border-radius: 5px; padding: 2px 7px;
}
.pcard .body { padding: 13px 14px 14px; display: flex; flex-direction: column; gap: 9px; flex: 1; }
.pcard .name-row { display: flex; align-items: center; gap: 8px; }
.pcard .name-row h3 { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; }
.pcard .meta { font-size: 12px; color: var(--muted); }
.pcard .resume {
  margin-top: auto; display: flex; align-items: center; gap: 8px; height: 38px;
  border-radius: 8px; border: 1px solid var(--line-strong); background: var(--panel2);
  padding: 0 12px; font-size: 13px; font-weight: 500; cursor: pointer;
}
.pcard .resume:hover { border-color: var(--line-strong); background: #1e2330; }
.pcard .resume .go { margin-left: auto; color: var(--accent); display: flex; }
.pcard .resume .go svg { width: 15px; height: 15px; }
.pcard .taskline { display: flex; gap: 6px; align-items: center; min-height: 22px; }
.pcard-menu { position: absolute; right: 8px; top: 8px; z-index: 5; }
.pcard-menu .icon-btn { background: rgba(10, 12, 18, .55); color: #e6e9f2; }
.pcard-pop { position: absolute; right: 0; top: 34px; z-index: 6; padding: 6px; min-width: 130px; }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
.sort-native {
  background: transparent; border: none; outline: none; color: var(--text);
  font-size: 13.5px; appearance: none; cursor: pointer; padding-right: 4px;
}
.sort-native option { background: var(--panel2); color: var(--text); }
.empty-box { text-align: center; padding: 90px 0; display: flex; flex-direction: column; gap: 16px; align-items: center; }
.empty-box svg { width: 40px; height: 40px; color: var(--muted); }
</style>
