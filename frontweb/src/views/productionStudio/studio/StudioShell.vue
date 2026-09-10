<template>
  <div class="studio">
    <header class="studio-head">
      <el-button text @click="$router.push(`/projects/${projectId}/episodes`)">← 返回剧集</el-button>
      <nav class="stage-nav">
        <router-link v-for="st in stages" :key="st.id"
                     :to="`/projects/${projectId}/episodes/${episodeId}/${st.id}`"
                     class="stage-item" :class="{ current: st.id === stage }">
          {{ st.label }}
        </router-link>
      </nav>
      <div class="head-right">{{ episodeTitle }}</div>
    </header>
    <div class="studio-body">
      <component :is="stageComponent" :project-id="projectId" :episode-id="episodeId" @refresh="loadEpisode" />
    </div>
  </div>
</template>

<script>
import ScriptStage from './ScriptStage.vue'
import AssetsStage from './AssetsStage.vue'
import StoryboardStage from './StoryboardStage.vue'
import CutStage from './CutStage.vue'
import v21 from '@/v21/api.js'

const STAGES = [
  { id: 'script', label: '剧本', component: 'ScriptStage' },
  { id: 'assets', label: '设定', component: 'AssetsStage' },
  { id: 'storyboard', label: '分镜', component: 'StoryboardStage' },
  { id: 'cut', label: '成片', component: 'CutStage' },
]

export default {
  name: 'StudioShell',
  components: { ScriptStage, AssetsStage, StoryboardStage, CutStage },
  data() { return { episodeTitle: '' } },
  computed: {
    projectId() { return this.$route.params.projectId },
    episodeId() { return this.$route.params.episodeId },
    stage() { return this.$route.params.stage || 'script' },
    stages() { return STAGES },
    stageComponent() {
      const found = STAGES.find((s) => s.id === this.stage)
      return found ? found.component : 'ScriptStage'
    },
  },
  mounted() { this.loadEpisode() },
  methods: {
    async loadEpisode() {
      try {
        const ep = await v21.getEpisode(this.episodeId)
        this.episodeTitle = ep.title || `第 ${ep.episodeNumber} 集`
      } catch { this.episodeTitle = '' }
    },
  },
}
</script>

<style scoped>
.studio { display: flex; flex-direction: column; height: 100vh; }
.studio-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 24px; background: #fff; border-bottom: 1px solid #e5e7eb;
}
.stage-nav { display: flex; gap: 6px; }
.stage-item { padding: 6px 18px; border-radius: 999px; text-decoration: none; color: #4b5563; font-size: 14px; }
.stage-item.current { background: #2563eb; color: #fff; }
.head-right { color: #6b7280; font-size: 13px; width: 160px; text-align: right; }
.studio-body { flex: 1; overflow: auto; }
</style>
