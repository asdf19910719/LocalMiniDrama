<template>
  <div class="cut-stage">
    <!-- 顶部瞬时提示（成功/取消等反馈） -->
    <div v-if="notice" class="notice-strip" :class="noticeType">
      <span>{{ notice }}</span>
      <div class="spacer"></div>
      <button class="btn ghost sm" @click="notice = ''">关闭</button>
    </div>

    <!-- 门禁阻塞：逐条镜头 -->
    <div v-if="blockedShots.length" class="notice-strip warn">
      <span>尚未全部完成：可提前审片，生成成片前需处理 {{ blockedShots.length }} 项</span>
    </div>
    <div v-for="b in blockedShots" :key="b.shotId" class="notice-strip warn blocker-strip">
      <span class="chip">镜头 {{ pad(b.number) }}</span>
      <span class="t2">{{ blockerReason(b) }}</span>
      <div class="spacer"></div>
      <button class="btn ghost sm" @click="goShot(b)">回分镜处理</button>
      <button v-if="canWaive(b)" class="btn sm" @click="openWaiver(b)">豁免并继续</button>
    </div>

    <!-- 合成进行中：不确定进度 + 请求取消 -->
    <div v-if="composeInFlight" class="notice-strip info">
      <span>正在合成…</span>
      <div class="progress indeterminate grow"><i></i></div>
      <button class="btn sm" :disabled="cancelling" @click="requestCancel">请求取消</button>
    </div>

    <!-- 失败条：非取消失败 -->
    <div v-else-if="latestFailed && !latestCancelled" class="notice-strip danger">
      <span>合成失败{{ composeError ? '：' + composeError : '，中间结果与设置已保留' }}</span>
      <div class="spacer"></div>
      <button class="btn sm" :disabled="!review.gate?.canCompose" @click="retryFailed">按原设置重试</button>
    </div>

    <!-- 已取消条 -->
    <div v-else-if="latestCancelled" class="notice-strip warn">
      <span>已取消，任务记录与设置已保留</span>
    </div>

    <div class="toolbar">
      <span class="chip">{{ review.completed || 0 }}/{{ review.total || 0 }} 已完成</span>
      <button class="btn sm" @click="playAll">{{ playAllText }}</button>
      <div class="spacer"></div>
      <button class="btn primary" :disabled="!canComposeNow" @click="openComposeConfirm">生成成片</button>
    </div>

    <div class="workbench">
      <section class="player-area">
        <video v-if="currentUrl" :key="currentUrl" :src="currentUrl" controls class="player"></video>
        <div v-else class="player empty">该镜头尚未生成视频 · 可回分镜修复</div>
        <div class="player-nav">
          <button class="btn sm" @click="step(-1)">上一镜</button>
          <span class="source-label">{{ currentShot?.sourceLabel }}</span>
          <button class="btn sm" @click="step(1)">下一镜</button>
          <button class="btn ghost sm accent-t" @click="repair">回分镜修复此镜</button>
        </div>
      </section>

      <aside class="settings">
        <h4>成片设置</h4>
        <div class="setting"><span>整集 BGM</span><button type="button" class="toggle" :class="{ on: settings.bgmOn }" @click="settings.bgmOn = !settings.bgmOn"></button></div>
        <div class="setting"><span>旁白 TTS</span><button type="button" class="toggle" :class="{ on: settings.narrationTts }" @click="settings.narrationTts = !settings.narrationTts"></button></div>
        <div class="setting"><span>字幕烧录</span><button type="button" class="toggle" :class="{ on: settings.subtitleBurn }" @click="settings.subtitleBurn = !settings.subtitleBurn"></button></div>
        <div class="setting"><span>超分增强</span><button type="button" class="toggle" :class="{ on: settings.upscale }" @click="settings.upscale = !settings.upscale"></button></div>
        <p class="hint">保留镜头原声；旁白 TTS 与 BGM 混音，不会覆盖原声</p>
        <template v-if="currentVersion && currentVersion.status !== 'composing'">
          <h4>成片 v{{ currentVersion.version }}</h4>
          <p class="hint">{{ currentVersion.fileName }} · {{ Math.round(currentVersion.durationSeconds || 0) }}s</p>
          <div class="row" style="gap:8px">
            <button class="btn sm primary" @click="exportCut('mp4')">导出 MP4</button>
            <button class="btn sm" @click="exportCut('srt')">导出 SRT</button>
          </div>
        </template>
        <div v-if="versions.items?.length" class="history">
          <h5>历史版本</h5>
          <div v-for="v in versions.items" :key="v.versionId" class="hist">
            <div>成片 v{{ v.version }} · {{ statusLabel(v) }}</div>
            <div v-if="v.status === 'exported'" class="xs muted">已导出 {{ formatTime(v.exportedAt) }}<span v-if="v.fileName"> · {{ v.fileName }}</span></div>
          </div>
        </div>
      </aside>
    </div>

    <footer class="timeline">
      <div v-for="s in review.shots || []" :key="s.shotId" class="tl-shot" :class="s.status" @click="selectShot(s)">
        {{ pad(s.number) }}
        <i v-if="s.waived" class="wv">已豁免</i>
      </div>
    </footer>

    <!-- 生成成片确认抽屉 -->
    <div v-if="composeConfirmOpen" class="modal-wrap" @click.self="composeConfirmOpen = false">
      <div class="modal compose-modal">
        <div class="modal-h"><h3>生成成片</h3></div>
        <div class="modal-b col">
          <p class="small t2">将按以下设置生成新的成片版本：</p>
          <div class="kv"><span class="k">整集 BGM</span><span class="v">{{ settings.bgmOn ? '开' : '关' }}</span></div>
          <div class="kv"><span class="k">旁白 TTS</span><span class="v">{{ settings.narrationTts ? '开' : '关' }}</span></div>
          <div class="kv"><span class="k">字幕烧录</span><span class="v">{{ settings.subtitleBurn ? '开' : '关' }}</span></div>
          <div class="kv"><span class="k">超分增强</span><span class="v">{{ settings.upscale ? '开' : '关' }}</span></div>
          <p class="xs muted">保留镜头原声；旁白 TTS 与 BGM 混音，不会覆盖原声</p>
        </div>
        <div class="modal-f">
          <button class="btn" @click="composeConfirmOpen = false">取消</button>
          <button class="btn primary" :disabled="composing" @click="confirmCompose">确认生成</button>
        </div>
      </div>
    </div>

    <!-- 豁免原因弹窗（原因必填） -->
    <div v-if="waiver.open" class="modal-wrap" @click.self="closeWaiver">
      <div class="modal waiver-modal">
        <div class="modal-h"><h3>豁免镜头 {{ pad(waiver.number) }}</h3></div>
        <div class="modal-b col">
          <p class="small t2">该镜头{{ blockerReason(waiverShot) || '未就绪' }}。豁免后不再阻止生成成片，豁免决策与原因会被记录。</p>
          <textarea
            v-model="waiver.reason"
            class="waiver-reason"
            placeholder="必填：请说明豁免原因（如：空镜头以黑场过渡）"
          ></textarea>
          <div v-if="waiver.error" class="waiver-error">{{ waiver.error }}</div>
        </div>
        <div class="modal-f">
          <button class="btn" @click="closeWaiver">取消</button>
          <button class="btn primary" :disabled="!waiver.reason.trim() || waiver.submitting" @click="confirmWaiver">豁免并继续</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

const BLOCKER_REASONS = {
  generating: '视频正在生成，请等待完成或回分镜查看',
  failed: '视频生成失败，需要回分镜处理',
  missing: '尚未生成视频',
  stale: '视频基于旧分镜图，需要回分镜确认',
}

export default {
  name: 'CutStage',
  props: { projectId: String, episodeId: String },
  data() {
    return {
      review: { shots: [], gate: { canCompose: false, blockers: [] }, completed: 0, total: 0, waivedShots: [] },
      currentIndex: 0,
      settings: { bgmOn: false, narrationTts: false, subtitleBurn: false, upscale: false },
      composing: false,
      cancelling: false,
      playingAll: false,
      versions: { items: [] },
      composeConfirmOpen: false,
      composeError: '',
      cancelledVersionIds: [],
      notice: '',
      noticeType: 'ok',
      noticeTimer: null,
      waiver: { open: false, shotId: null, number: null, reason: '', submitting: false, error: '' },
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
    currentVersion() {
      return (this.versions.items || [])[0] || null
    },
    // 与后端门禁同口径的逐条阻塞项（gate.blockers 为聚合文案，无法逐镜头定位）
    blockedShots() {
      return (this.review.shots || []).filter(
        (s) => ['generating', 'failed', 'stale'].includes(s.status) || (s.status === 'missing' && !s.waived)
      )
    },
    composingVersion() {
      return (this.versions.items || []).find((v) => v.status === 'composing') || null
    },
    composeInFlight() {
      return this.composing || !!this.composingVersion
    },
    latestVersion() {
      return (this.versions.items || [])[0] || null
    },
    latestFailed() {
      return this.latestVersion?.status === 'failed'
    },
    latestCancelled() {
      return this.latestFailed && this.cancelledVersionIds.includes(this.latestVersion.versionId)
    },
    canComposeNow() {
      return !!this.review.gate?.canCompose && !this.composeInFlight
    },
    waiverShot() {
      return (this.review.shots || []).find((s) => s.shotId === this.waiver.shotId) || null
    },
  },
  mounted() { this.load() },
  methods: {
    pad(n) {
      return String(n ?? '').padStart(2, '0')
    },
    blockerReason(shot) {
      return shot ? BLOCKER_REASONS[shot.status] || '' : ''
    },
    canWaive(shot) {
      // 后端门禁仅对"尚未生成"的镜头认可豁免，其余状态豁免不会解除门禁
      return !!shot && shot.status === 'missing' && !shot.waived
    },
    statusLabel(v) {
      if (!v) return ''
      if (v.status === 'failed') return this.cancelledVersionIds.includes(v.versionId) ? '已取消' : '合成失败'
      return { composing: '合成中', ready: '已就绪', exported: '已导出' }[v.status] || v.status
    },
    formatTime(iso) {
      return iso ? String(iso).replace('T', ' ').slice(0, 16) : ''
    },
    flashNotice(type, text) {
      this.noticeType = type
      this.notice = text
      if (this.noticeTimer) clearTimeout(this.noticeTimer)
      this.noticeTimer = setTimeout(() => { this.notice = '' }, 4000)
    },
    async load() {
      const data = await v21.getCut(this.episodeId)
      this.review = data
      this.versions = data.versions || { items: [] }
      if (!this.currentShot && this.review.shots.length > 0) this.currentIndex = 0
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
    goShot(blocked) {
      this.$router.push({ path: `/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`, query: { shot: blocked.shotId } })
    },
    repair() {
      this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`)
    },
    openWaiver(shot) {
      this.waiver = { open: true, shotId: shot.shotId, number: shot.number, reason: '', submitting: false, error: '' }
    },
    closeWaiver() {
      this.waiver.open = false
    },
    async confirmWaiver() {
      const reason = this.waiver.reason.trim()
      if (!reason || this.waiver.submitting) return
      this.waiver.submitting = true
      this.waiver.error = ''
      try {
        await v21.createWaiver({ gate: 'video', ownerType: 'shot', ownerId: this.waiver.shotId, reason })
        this.waiver.open = false
        this.flashNotice('ok', `镜头 ${this.pad(this.waiver.number)} 已豁免`)
        await this.load()
      } catch (e) {
        this.waiver.error = e.message || '豁免失败，请重试'
      } finally {
        this.waiver.submitting = false
      }
    },
    openComposeConfirm() {
      if (!this.canComposeNow) return
      this.composeConfirmOpen = true
    },
    confirmCompose() {
      this.composeConfirmOpen = false
      this.compose()
    },
    buildSettings() {
      return {
        bgmStrategy: this.settings.bgmOn ? 'episode-track' : 'none',
        narrationTts: !!this.settings.narrationTts,
        subtitleBurn: !!this.settings.subtitleBurn,
        upscale: !!this.settings.upscale,
      }
    },
    applyVersionSettings(s) {
      if (!s) return
      this.settings = {
        bgmOn: s.bgmStrategy === 'episode-track',
        narrationTts: !!s.narrationTts,
        subtitleBurn: !!s.subtitleBurn,
        upscale: !!s.upscale,
      }
    },
    async compose(customSettings = null) {
      if (this.composeInFlight) return
      this.composing = true
      this.composeError = ''
      try {
        const result = await v21.composeEpisode(this.episodeId, customSettings || this.buildSettings())
        this.flashNotice('ok', `成片 v${result.version} 已生成`)
        await this.load()
      } catch (e) {
        this.composeError = e.message || '合成失败'
        await this.load()
      } finally {
        this.composing = false
      }
    },
    async requestCancel() {
      if (!this.composeInFlight || this.cancelling) return
      this.cancelling = true
      try {
        const result = await v21.cancelCutCompose(this.episodeId)
        if (this.composingVersion) this.cancelledVersionIds.push(this.composingVersion.versionId)
        this.flashNotice(
          result && result.cancelled > 0 ? 'info' : 'warn',
          result && result.cancelled > 0 ? '已请求取消，任务记录与设置已保留' : '当前没有进行中的合成任务'
        )
        await this.load()
      } catch (e) {
        this.flashNotice('danger', e.message || '取消请求失败，请重试')
      } finally {
        this.cancelling = false
      }
    },
    async retryFailed() {
      const v = this.latestVersion
      if (!v || !v.settings) return
      if (!this.review.gate?.canCompose) {
        this.flashNotice('danger', '仍有镜头未处理，无法重试合成')
        return
      }
      this.applyVersionSettings(v.settings)
      await this.compose({ ...v.settings })
    },
    async exportCut(format) {
      const result = await v21.exportCut(this.episodeId, format)
      if (result.ok) this.flashNotice('ok', `已导出 ${format.toUpperCase()}：${result.filePath}`)
      else this.flashNotice('warn', result.reason || '导出失败')
    },
  },
}
</script>

<style scoped>
.cut-stage { padding: 12px 20px; display: flex; flex-direction: column; height: 100%; overflow: auto; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.spacer { flex: 1; }
.blocker-strip { padding: 9px 12px; }
.progress.indeterminate > i { width: 34%; animation: cut-indeterminate 1.2s ease-in-out infinite; }
@keyframes cut-indeterminate {
  0% { margin-left: -34%; }
  100% { margin-left: 100%; }
}
.workbench { display: grid; grid-template-columns: 1fr 300px; gap: 14px; margin-top: 12px; flex: 1; min-height: 0; }
.player-area, .settings { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; overflow: auto; }
.player { width: 100%; min-height: 320px; background: #000; border-radius: 8px; }
.player.empty { display: flex; align-items: center; justify-content: center; color: var(--muted); }
.player-nav { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.source-label { color: var(--muted); font-size: 13px; flex: 1; text-align: center; }
.setting { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--line); }
button.toggle { border: none; }
.hint { color: var(--muted); font-size: 12px; }
.history { margin-top: 12px; }
.hist { font-size: 12px; color: var(--text-2); padding: 4px 0; border-bottom: 1px dashed var(--line); }
.timeline { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; }
.tl-shot { flex: none; width: 64px; text-align: center; padding: 10px 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; color: var(--text-2); }
.tl-shot.completed { border-color: rgba(69, 211, 156, .5); background: var(--ok-subtle); color: var(--ok); }
.tl-shot.stale { border-color: rgba(255, 182, 92, .5); background: var(--warn-subtle); color: var(--warn); }
.tl-shot.failed, .tl-shot.missing { border-color: rgba(255, 107, 120, .5); background: var(--danger-subtle); color: var(--danger); }
.tl-shot .wv { display: block; font-style: normal; font-size: 10px; margin-top: 2px; color: var(--warn); }
.compose-modal { width: 420px; }
.waiver-modal { width: 460px; }
.waiver-reason {
  min-height: 96px; resize: vertical; font: inherit; color: var(--text);
  background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; outline: none;
}
.waiver-reason:focus { border-color: var(--focus); box-shadow: 0 0 0 2px rgba(124, 92, 255, .25); }
.waiver-reason::placeholder { color: #5c6478; }
.waiver-error { background: var(--danger-subtle); color: var(--danger); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; }
h4, h5 { margin: 8px 0; }
</style>
