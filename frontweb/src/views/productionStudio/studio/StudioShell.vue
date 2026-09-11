<template>
  <div class="studio">
    <header class="topbar">
      <div class="crumb">
        <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes`)"><svg><use href="#i-back"/></svg></button>
        <span class="proj">{{ projectTitle }}</span><span class="muted">/</span><span class="ep">第 {{ episodeNumber }} 集<template v-if="episodeTitle"> · {{ episodeTitle }}</template></span>
      </div>
      <div class="save-state"><span class="dot" :style="saveState.error ? 'background:var(--danger)' : ''"></span>{{ saveState.text }}</div>
      <div class="spacer"></div>
      <div class="topbar-right">
        <router-link to="/tasks" class="btn sm" style="text-decoration:none">
          <svg><use href="#i-tasks"/></svg>任务<span v-if="runningTasks" class="badge info">{{ runningTasks }}</span>
        </router-link>
      </div>
    </header>

    <nav class="stagenav">
      <template v-for="(st, i) in navStages" :key="st.id">
        <span v-if="i > 0" class="stage-arrow"><svg style="width:14px;height:14px"><use href="#i-fwd"/></svg></span>
        <router-link :to="`/projects/${projectId}/episodes/${episodeId}/${st.id}`"
                     class="stage-item" :class="{ active: st.id === stage }" style="text-decoration:none">
          <span class="stage-idx">{{ st.idx }}</span>
          <span class="stage-name">{{ st.label }}</span>
          <span class="stage-meta">{{ st.meta }}</span>
          <span v-if="st.warn > 0" class="badge warn" style="height:18px;padding:0 6px">{{ st.warn }}</span>
        </router-link>
      </template>
      <div style="position:absolute; right:16px" class="muted small">
        <template v-if="nav.completionPercent !== null">本集完成度 {{ nav.completionPercent }}%</template>
        <template v-if="nav.basedOnApprovedRevision"> · 基于已确认剧本 v{{ nav.basedOnApprovedRevision }}</template>
      </div>
    </nav>

    <div class="studio-body">
      <component v-if="stageValid" :is="stageComponent" :project-id="projectId" :episode-id="episodeId" @refresh="loadEpisode" />
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
    const saveState = reactive({ text: '更改会自动保存', error: false })
    provide('studioSave', saveState)
    return { saveState }
  },
  data() {
    return { episodeTitle: '', episodeNumber: '', projectTitle: '', nav: { stages: [], completionPercent: null, basedOnApprovedRevision: null }, runningTasks: 0 }
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
    stage() { this.loadNav() },
  },
  created() {
    // 规格 §3.1 要求未知 stage“回退到该集最近有效阶段”，此处最小实现统一回退到该集 /script；
    // 替换跳转生效前，模板中的“正在打开剧本阶段…”占位负责兜底渲染。
    if (!this.stageValid) {
      this.$router.replace(`/projects/${this.projectId}/episodes/${this.episodeId}/script`)
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
    },
    async loadNav() {
      try {
        this.nav = await v21.getStageNav(this.episodeId)
      } catch { /* 忽略 */ }
    },
  },
}
</script>

<style scoped>
.studio { display: flex; flex-direction: column; height: 100vh; }
.studio-body { flex: 1; display: flex; min-height: 0; }
.stage-fallback { flex: 1; display: flex; align-items: center; justify-content: center; }
</style>
