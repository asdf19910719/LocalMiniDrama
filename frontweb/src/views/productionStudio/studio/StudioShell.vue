<template>
  <div class="studio">
    <header class="topbar">
      <div class="crumb">
        <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes`)"><svg><use href="#i-back"/></svg></button>
        <span class="proj">{{ projectTitle }}</span><span class="muted">/</span>
        <!-- §4.3 制作头剧集下拉：同项目全部剧集，切换前经 dirty 守卫 -->
        <select class="ep-select" :value="episodeId" @change="onEpisodePick" title="切换剧集">
          <option v-for="ep in episodes" :key="ep.id" :value="ep.id">第 {{ ep.episodeNumber }} 集<template v-if="ep.title && ep.title !== '未命名'"> · {{ ep.title }}</template></option>
          <option v-if="!episodes.length" :value="episodeId">第 {{ episodeNumber }} 集<template v-if="episodeTitle"> · {{ episodeTitle }}</template></option>
        </select>
      </div>
      <div class="save-state"><span class="dot" :style="saveState.error ? 'background:var(--danger)' : ''"></span>{{ saveState.text }}</div>
      <div class="spacer"></div>
      <div class="topbar-right">
        <router-link to="/tasks" class="btn sm" style="text-decoration:none">
          <svg><use href="#i-tasks"/></svg>任务<span v-if="runningTasks" class="badge info">{{ runningTasks }}</span>
        </router-link>
      </div>
    </header>

    <!-- 切集守卫：剧本阶段有未保存修改时，明确二选一（保存并切换 / 放弃并切换），不静默丢稿 -->
    <div v-if="pendingEpisodeId" class="switch-guard card">
      <svg style="width:14px;height:14px;color:var(--warn)"><use href="#i-warn"/></svg>
      <span class="small">本集有未保存修改，切换前请选择处理方式</span>
      <button class="btn sm primary" :disabled="guardSaving" @click="saveAndSwitch">{{ guardSaving ? '保存中…' : '保存并切换' }}</button>
      <button class="btn sm ghost" @click="discardAndSwitch">放弃并切换</button>
      <button class="icon-btn" title="留在本集" @click="pendingEpisodeId = null"><svg><use href="#i-close"/></svg></button>
    </div>

    <nav class="stagenav">
      <template v-for="(st, i) in navStages" :key="st.id">
        <span v-if="i > 0" class="stage-arrow"><svg style="width:14px;height:14px"><use href="#i-fwd"/></svg></span>
        <router-link :to="`/projects/${projectId}/episodes/${episodeId}/${st.id}`"
                     class="stage-item" :class="{ active: st.id === stage }" style="text-decoration:none">
          <span class="stage-idx">{{ st.idx }}</span>
          <span class="stage-name">{{ st.label }}</span>
          <span class="stage-meta">{{ st.meta }}</span>
          <span v-if="st.warn > 0" class="badge warn" style="height:18px;padding:0 6px" :title="`待处理：${st.meta || '有需要处理的项'}`">{{ st.warn }}</span>
        </router-link>
      </template>
      <div style="position:absolute; right:16px" class="muted small">
        <template v-if="nav.completionPercent !== null">本集完成度 {{ nav.completionPercent }}%</template>
        <template v-if="nav.basedOnApprovedRevision"> · 基于已确认剧本 v{{ nav.basedOnApprovedRevision }}</template>
      </div>
    </nav>

    <div class="studio-body">
      <!-- :key=episodeId：切集必须重建阶段组件——同路由记录下复用实例会停留旧集内容，
           且剧本页 800ms 自动保存定时器会带着旧集草稿按新 episodeId 写库（跨集污染） -->
      <component v-if="stageValid" :is="stageComponent" :key="episodeId" :project-id="projectId" :episode-id="episodeId" @refresh="loadEpisode" />
      <div v-else class="stage-fallback muted">正在打开剧本阶段…</div>
    </div>
  </div>
</template>

<script>
import { reactive, provide } from 'vue'
import ScriptStage from './ScriptStage.vue'
import AssetsStage from './AssetsStage.vue'
import StoryboardStage from './StoryboardStage.vue'
import CutStage from './CutStage.vue'
import v21 from '@/v21/api.js'

const STAGES = [
  { id: 'script', idx: 1, label: '剧本', component: 'ScriptStage' },
  { id: 'assets', idx: 2, label: '设定', component: 'AssetsStage' },
  { id: 'storyboard', idx: 3, label: '分镜', component: 'StoryboardStage' },
  { id: 'cut', idx: 4, label: '成片', component: 'CutStage' },
]

export default {
  name: 'StudioShell',
  components: { ScriptStage, AssetsStage, StoryboardStage, CutStage },
  setup() {
    const saveState = reactive({ text: '更改会自动保存', error: false, dirty: false, save: null })
    provide('studioSave', saveState)
    return { saveState }
  },
  data() {
    return {
      episodeTitle: '', episodeNumber: '', projectTitle: '',
      nav: { stages: [], completionPercent: null, basedOnApprovedRevision: null }, runningTasks: 0,
      episodes: [], pendingEpisodeId: null, guardSaving: false,
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    episodeId() { return this.$route.params.episodeId },
    stage() { return this.$route.params.stage || 'script' },
    stageValid() { return STAGES.some((s) => s.id === this.stage) },
    navStages() {
      if (this.nav.stages.length > 0) {
        return this.nav.stages.map((s) => ({ ...s, component: undefined }))
      }
      return STAGES.map((s) => ({ id: s.id, idx: s.idx, label: s.label, meta: '', warn: 0 }))
    },
    stageComponent() {
      const found = STAGES.find((s) => s.id === this.stage)
      return found ? found.component : 'ScriptStage'
    },
  },
  watch: {
    stage() {
      this.loadNav()
      // 保存态透传：成片/设定等阶段无草稿保存概念，显示真实语义“更改实时生效”；
      // 剧本阶段由 ScriptStage 经 studioSave 通道回写真实保存状态
      if (this.stage !== 'script') {
        this.saveState.text = '更改实时生效'
        this.saveState.error = false
        this.saveState.dirty = false
      }
    },
    // 切集后刷新头部（当前集标题/下拉）与阶段导航，清掉未消费的守卫目标
    episodeId() {
      this.pendingEpisodeId = null
      this.loadEpisode()
      this.loadNav()
    },
  },
  created() {
    // 规格 §3.1 要求未知 stage“回退到该集最近有效阶段”，此处最小实现统一回退到该集 /script；
    // 替换跳转生效前，模板中的“正在打开剧本阶段…”占位负责兜底渲染。
    if (!this.stageValid) {
      this.$router.replace(`/projects/${this.projectId}/episodes/${this.episodeId}/script`)
    } else if (this.stage !== 'script') {
      this.saveState.text = '更改实时生效'
    }
  },
  mounted() { this.loadEpisode(); this.loadNav() },
  methods: {
    async loadEpisode() {
      try {
        const ep = await v21.getEpisode(this.episodeId)
        this.episodeTitle = ep.title && ep.title !== '未命名' ? ep.title : ''
        this.episodeNumber = ep.episodeNumber
        const overview = await v21.getOverview(this.projectId)
        this.projectTitle = overview.hero.title
        this.loadNav()
      } catch { /* 保留占位 */ }
      try {
        const data = await v21.listEpisodes(this.projectId)
        this.episodes = data.items || []
      } catch { /* 列表失败时下拉回退为当前集占位 */ }
    },
    async loadNav() {
      try {
        this.nav = await v21.getStageNav(this.episodeId)
      } catch { /* 忽略 */ }
    },
    onEpisodePick(e) {
      const target = e.target.value
      if (!target || String(target) === String(this.episodeId)) return
      // 切换守卫：剧本阶段 dirty 时先出二选一守卫（无该通道的阶段视为非 dirty 直接切）
      if (this.saveState.dirty) {
        this.pendingEpisodeId = target
        e.target.value = this.episodeId
        return
      }
      this.goEpisode(target)
    },
    goEpisode(id) {
      this.$router.push(`/projects/${this.projectId}/episodes/${id}/${this.stage}`)
    },
    async saveAndSwitch() {
      const save = this.saveState.save
      if (typeof save === 'function') {
        this.guardSaving = true
        try {
          await save()
        } catch { /* 通道已回写错误文案，留在守卫让用户重试或放弃 */ } finally {
          this.guardSaving = false
        }
        if (this.saveState.error || this.saveState.dirty) return
      }
      const id = this.pendingEpisodeId
      this.pendingEpisodeId = null
      if (id) this.goEpisode(id)
    },
    discardAndSwitch() {
      const id = this.pendingEpisodeId
      this.pendingEpisodeId = null
      this.saveState.dirty = false
      if (id) this.goEpisode(id)
    },
  },
}
</script>

<style scoped>
.studio { position: relative; display: flex; flex-direction: column; height: 100vh; }
.studio-body { flex: 1; display: flex; min-height: 0; }
.stage-fallback { flex: 1; display: flex; align-items: center; justify-content: center; }
.ep-select {
  background: transparent; border: none; outline: none; color: var(--text);
  font-size: 13px; font-weight: 600; cursor: pointer; max-width: 260px;
}
.ep-select option { background: var(--panel2); color: var(--text); }
.switch-guard {
  position: absolute; top: 52px; left: 50%; transform: translateX(-50%); z-index: 80;
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; box-shadow: var(--shadow, 0 8px 24px rgba(0,0,0,.35));
}
</style>
