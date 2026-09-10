<template>
  <div class="cut-stage">
    <div class="toolbar">
      <span>x/{{ review.total || 0 }} 已完成</span>
      <el-button size="small" @click="playAll">{{ playAllText }}</el-button>
      <span class="spacer"></span>
      <el-tooltip :disabled="review.gate?.canCompose" placement="bottom">
        <template #content><span>{{ gateBlockers.join('；') }}</span></template>
        <span>
          <el-button type="primary" :disabled="!review.gate?.canCompose || composing" @click="compose">生成成片</el-button>
        </span>
      </el-tooltip>
    </div>
    <el-alert v-if="gateBlockers.length" type="warning" :closable="false" :title="`尚未全部完成：可提前审片，合成前需处理 ${gateBlockers.length} 项`" />

    <div class="workbench">
      <section class="player-area">
        <video v-if="currentUrl" :key="currentUrl" :src="currentUrl" controls class="player"></video>
        <div v-else class="player empty">该镜头尚未生成视频 · 可回分镜修复</div>
        <div class="player-nav">
          <el-button size="small" @click="step(-1)">上一镜</el-button>
          <span class="source-label">{{ currentShot?.sourceLabel }}</span>
          <el-button size="small" @click="step(1)">下一镜</el-button>
          <el-button size="small" text type="primary" @click="repair">回分镜修复此镜</el-button>
        </div>
      </section>

      <aside class="settings">
        <h4>成片设置</h4>
        <div class="setting"><span>整集 BGM</span><el-switch v-model="settings.bgmOn" /></div>
        <div class="setting"><span>旁白 TTS</span><el-switch v-model="settings.narrationTts" /></div>
        <div class="setting"><span>字幕烧录</span><el-switch v-model="settings.subtitleBurn" /></div>
        <div class="setting"><span>超分增强</span><el-switch v-model="settings.upscale" /></div>
        <p class="hint">保留镜头原声；旁白 TTS 与 BGM 混音，不会覆盖原声</p>
        <template v-if="currentVersion">
          <h4>成片 v{{ currentVersion.version }}</h4>
          <p class="hint">{{ currentVersion.fileName }} · {{ Math.round(currentVersion.durationSeconds || 0) }}s</p>
          <el-button size="small" type="primary" @click="exportCut('mp4')">导出 MP4</el-button>
          <el-button size="small" @click="exportCut('srt')">导出 SRT</el-button>
        </template>
        <div v-if="versions.items?.length" class="history">
          <h5>历史版本</h5>
          <div v-for="v in versions.items" :key="v.versionId" class="hist">成片 v{{ v.version }} · {{ v.status }}</div>
        </div>
      </aside>
    </div>

    <footer class="timeline">
      <div v-for="s in review.shots || []" :key="s.shotId" class="tl-shot" :class="s.status" :class2="s.status" @click="selectShot(s)">
        {{ String(s.number).padStart(2, '0') }}
      </div>
    </footer>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'CutStage',
  props: { projectId: String, episodeId: String },
  data() {
    return {
      review: { shots: [], gate: { canCompose: false, blockers: [] }, completed: 0, total: 0 },
      currentIndex: 0,
      settings: { bgmOn: false, narrationTts: false, subtitleBurn: false, upscale: false },
      composing: false,
      playingAll: false,
      versions: { items: [] },
    }
  },
  computed: {
    currentShot() {
      return (this.review.shots || [])[this.currentIndex] || null
    },
    currentUrl() {
      return this.currentShot?.url || ''
    },
    playAllText() {
      return this.playingAll ? '停止连播' : '连续播放'
    },
    gateBlockers() {
      return this.review.gate?.blockers || []
    },
    currentVersion() {
      return (this.versions.items || [])[0] || null
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.review = await v21.getCut(this.episodeId)
      if (!this.currentShot && this.review.shots.length > 0) this.currentIndex = 0
      this.refreshVersions()
    },
    async refreshVersions() {
      const data = await v21.getCut(this.episodeId)
      this.versions = data.versions || { items: [] }
    },
    selectShot(shot) {
      this.currentIndex = this.review.shots.indexOf(shot)
    },
    step(delta) {
      const next = this.currentIndex + delta
      if (next >= 0 && next < this.review.shots.length) this.currentIndex = next
    },
    async playAll() {
      this.playingAll = !this.playingAll
      if (!this.playingAll) return
      const completed = this.review.shots.map((s, i) => ({ s, i })).filter((x) => x.s.status === 'completed')
      for (const { i } of completed) {
        if (!this.playingAll) break
        this.currentIndex = i
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      this.playingAll = false
    },
    repair() {
      this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`)
    },
    async compose() {
      this.composing = true
      try {
        const result = await v21.composeEpisode(this.episodeId, {
          bgmStrategy: this.settings.bgmOn ? 'episode-track' : 'none',
          narrationTts: this.settings.narrationTts,
          subtitleBurn: this.settings.subtitleBurn,
          upscale: this.settings.upscale,
        })
        ElMessage.success(`成片 v${result.version} 已生成`)
        await this.load()
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.composing = false
      }
    },
    async exportCut(format) {
      const result = await v21.exportCut(this.episodeId, format)
      if (result.ok) ElMessage.success(`已导出 ${format.toUpperCase()}：${result.filePath}`)
      else ElMessage.warning(result.reason)
    },
  },
}
</script>

<style scoped>
.cut-stage { padding: 12px 20px; display: flex; flex-direction: column; height: 100%; }
.toolbar { display: flex; gap: 12px; align-items: center; }
.spacer { flex: 1; }
.workbench { display: grid; grid-template-columns: 1fr 300px; gap: 14px; margin-top: 12px; flex: 1; }
.player-area, .settings { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; overflow: auto; }
.player { width: 100%; min-height: 320px; background: #111; border-radius: 8px; }
.player.empty { display: flex; align-items: center; justify-content: center; color: #9ca3af; }
.player-nav { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.source-label { color: #6b7280; font-size: 13px; flex: 1; text-align: center; }
.setting { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #f3f4f6; }
.hint { color: #9ca3af; font-size: 12px; }
.history { margin-top: 12px; }
.hist { font-size: 12px; color: #6b7280; padding: 4px 0; }
.timeline { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; }
.tl-shot { flex: none; width: 64px; text-align: center; padding: 10px 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
.tl-shot.completed { border-color: #22c55e; background: #f0fdf4; }
.tl-shot.stale { border-color: #f59e0b; background: #fffbeb; }
.tl-shot.failed, .tl-shot.missing { border-color: #ef4444; background: #fef2f2; }
h4, h5 { margin: 8px 0; }
</style>
