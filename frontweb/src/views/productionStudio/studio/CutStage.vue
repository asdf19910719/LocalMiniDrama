<template>
  <div class="cut-stage">
    <!-- 顶部瞬时提示（成功/取消等反馈） -->
    <div v-if="notice" class="notice-strip" :class="noticeType">
      <span>{{ notice }}</span>
      <div class="spacer"></div>
      <button class="btn ghost sm" @click="notice = ''">关闭</button>
    </div>

    <!-- 门禁阻塞：顶部聚合一条，逐项清单收进右侧设置面板的门禁卡 -->
    <div v-if="blockedShots.length" class="notice-strip warn">
      <svg style="width:14px;height:14px"><use href="#i-warn"/></svg>
      <span>生成成片前需完成 {{ blockedShots.length }} 项 · 可提前审片，逐项处理见右侧门禁清单</span>
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

    <!-- 三分状态机：加载骨架 → 错误重试 → 工作台（G8：加载完成前不渲染空数据内容） -->
    <StateBlock v-if="loading && !loaded" state="loading" />
    <StateBlock v-else-if="loadError && !loaded" state="error" :message="'成片数据加载失败：' + loadError" @retry="load" />
    <template v-else>
    <div class="toolbar">
      <span class="chip">{{ review.completed || 0 }}/{{ review.total || 0 }} 已完成</span>
      <button class="btn sm" @click="playAll">{{ playAllText }}</button>
      <div class="spacer"></div>
      <button class="btn primary" :disabled="!canComposeNow" @click="openComposeConfirm">
        生成成片<span v-if="!canComposeNow && blockedShots.length" class="price">{{ blockedShots.length }} 镜未完成</span>
      </button>
    </div>

    <div class="workbench">
      <section class="player-area">
        <div class="player-zone">
          <video v-if="currentUrl" :key="currentUrl" :src="currentUrl" controls class="player"></video>
          <div v-else class="player empty ph">该镜头尚未生成视频 · 可回分镜修复</div>
          <span v-if="currentShot" class="badge accent p-badge">{{ currentShot.title || ('镜头 ' + pad(currentShot.number)) }}</span>
          <span v-if="currentUrl" class="badge ok p-ok">{{ currentShot?.waived ? '已豁免 · 用于审片' : '当前镜 · 用于成片' }}</span>
          <span v-if="currentUrl" class="p-dur">{{ currentShot?.durationSeconds ? Math.round(currentShot.durationSeconds) + 's' : '' }}</span>
        </div>
        <div class="player-nav">
          <button class="icon-btn" title="上一镜" @click="step(-1)"><svg><use href="#i-back"/></svg></button>
          <span class="source-label">{{ currentShot?.sourceLabel || ('镜头 ' + pad(currentShot?.number)) }}</span>
          <button class="icon-btn" title="下一镜" @click="step(1)"><svg><use href="#i-fwd"/></svg></button>
          <span class="nav-sep"></span>
          <button class="btn ghost sm accent-t" style="border:1px solid var(--line)" @click="repair"><svg><use href="#i-clap"/></svg>回分镜修复此镜</button>
        </div>
      </section>

      <aside class="settings">
        <h4>成片设置</h4>
        <div class="setting"><div class="s-main"><span>整集 BGM</span><small>沿用项目主题曲 · 关闭则仅镜头原声</small></div><button type="button" class="toggle" :class="{ on: settings.bgmOn }" @click="settings.bgmOn = !settings.bgmOn"></button></div>
        <div class="setting"><div class="s-main"><span>旁白 TTS</span><small>混入旁白配音 · 保留镜头原声</small></div><button type="button" class="toggle" :class="{ on: settings.narrationTts }" @click="settings.narrationTts = !settings.narrationTts"></button></div>
        <div class="setting"><div class="s-main"><span>字幕烧录</span><small>关闭时仅导出 SRT 字幕文件</small></div><button type="button" class="toggle" :class="{ on: settings.subtitleBurn }" @click="settings.subtitleBurn = !settings.subtitleBurn"></button></div>
        <div class="setting"><div class="s-main"><span>超分增强</span><small>画质更清晰 · 合成耗时更长</small></div><button type="button" class="toggle" :class="{ on: settings.upscale }" @click="settings.upscale = !settings.upscale"></button></div>

        <!-- 门禁清单卡：逐条列出未完成镜头与唯一恢复落点 -->
        <div v-if="blockedShots.length" class="gate">
          <b>生成成片前需完成（{{ blockedShots.length }}）</b>
          <div v-for="b in blockedShots" :key="b.shotId" class="g-row">
            <span class="chip" style="height:20px; font-size:11px">镜头 {{ pad(b.number) }}</span>
            <span class="grow" style="font-size:11.5px; line-height:1.5">{{ blockerReason(b) }}</span>
            <span class="g-act" @click="goShot(b)">去处理</span>
            <span v-if="canWaive(b)" class="g-act" @click="openWaiver(b)">豁免</span>
          </div>
        </div>

        <div v-if="versions.items?.length" class="history">
          <h5>历史版本</h5>
          <div v-for="v in versions.items" :key="v.versionId" class="hist">
            <div>成片 v{{ v.version }} · {{ statusLabel(v) }}</div>
            <div v-if="v.status === 'exported'" class="xs muted">已导出 {{ formatTime(v.exportedAt) }}<span v-if="v.fileName"> · {{ v.fileName }}</span></div>
          </div>
        </div>
      </aside>
    </div>

    <!-- 成片结果条（设计稿 11：缩略 + 版本 + 建议 + 导出横排） -->
    <div v-if="currentVersion && currentVersion.status !== 'composing' && !composeInFlight" class="resultbar">
      <div class="rb-thumb ph"></div>
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:8px">
          <b style="font-size:13.5px">成片 v{{ currentVersion.version }}</b>
          <span v-if="blockedShots.length" class="badge warn" style="height:20px">{{ blockedShots.length }} 镜已更新 · 建议重新合成</span>
        </div>
        <div class="xs muted" style="margin-top:2px">{{ currentVersion.fileName || '—' }} · 约 {{ Math.round(currentVersion.durationSeconds || 0) }}s · {{ statusLabel(currentVersion) }}</div>
      </div>
      <button class="btn sm" @click="exportCut('srt')">导出 SRT</button>
      <button class="btn sm primary" @click="exportCut('mp4')">导出 MP4</button>
    </div>

    <footer class="timeline">
      <span class="xs muted" style="flex:0 0 auto">镜头时间线</span>
      <div class="tl-row">
        <div v-for="(s, i) in review.shots || []" :key="s.shotId" class="tl-shot" :class="[s.status, { cur: i === currentIndex }]" @click="selectShot(s)">
          <div class="im">
            <video v-if="s.url" :src="s.url + '#t=0.1'" preload="metadata" muted></video>
            <span v-else class="im ph" style="display:block"></span>
            <i class="dot" :style="{ background: shotDotColor(s) }"></i>
          </div>
          <div class="no">{{ pad(s.number) }}<span v-if="s.waived" class="wv">已豁免</span></div>
        </div>
      </div>
      <button v-if="blockedShots.length" class="btn sm" style="flex:0 0 auto" @click="repair">回分镜处理（{{ blockedShots.length }}）</button>
    </footer>
    </template>

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
import StateBlock from '@/components/v21/StateBlock.vue'
import escMixin from '@/v21/escMixin.js'

const BLOCKER_REASONS = {
  generating: '视频正在生成，请等待完成或回分镜查看',
  failed: '视频生成失败，需要回分镜处理',
  missing: '尚未生成视频',
  stale: '视频基于旧分镜图，需要回分镜确认',
}

export default {
  name: 'CutStage',
  mixins: [escMixin],
  components: { StateBlock },
  props: { projectId: String, episodeId: String },
  data() {
    return {
      review: { shots: [], gate: { canCompose: false, blockers: [] }, completed: 0, total: 0, waivedShots: [] },
      loading: false, loaded: false, loadError: '',
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
  mounted() {
    this.bindEsc(this.onEsc)
    this.load()
  },
  methods: {
    // Esc 自上而下关本视图的弹层（豁免原因弹窗 → 生成成片确认弹窗）
    onEsc() {
      if (this.waiver.open) { this.closeWaiver(); return true }
      if (this.composeConfirmOpen) { this.composeConfirmOpen = false; return true }
      return false
    },
    pad(n) {
      return String(n ?? '').padStart(2, '0')
    },
    blockerReason(shot) {
      return shot ? BLOCKER_REASONS[shot.status] || '' : ''
    },
    shotDotColor(shot) {
      return {
        completed: 'var(--ok)', stale: 'var(--warn)', failed: 'var(--danger)',
        missing: 'var(--neutral)', generating: 'var(--info)',
      }[shot?.status] || 'var(--neutral)'
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
      this.loading = true
      try {
        const data = await v21.getCut(this.episodeId)
        this.review = data
        this.versions = data.versions || { items: [] }
        if (!this.currentShot && this.review.shots.length > 0) this.currentIndex = 0
        this.loadError = ''
        this.loaded = true
      } catch (e) {
        // 失败呈现为可重试错误态（原为无兜底裸 await，失败页面白板）
        this.loadError = e.message || '网络错误'
      } finally {
        this.loading = false
      }
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
.progress.indeterminate > i { width: 34%; animation: cut-indeterminate 1.2s ease-in-out infinite; }
@keyframes cut-indeterminate {
  0% { margin-left: -34%; }
  100% { margin-left: 100%; }
}
.workbench { display: grid; grid-template-columns: 1fr 300px; gap: 14px; margin-top: 12px; flex: 1; min-height: 0; }
.player-area { background: transparent; border: none; padding: 0; overflow: auto; }
.settings { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; overflow: auto; }
.player-zone { position: relative; }
.player { width: 100%; aspect-ratio: 16 / 9; max-height: 56vh; background: #000; border-radius: 12px; }
.player.empty { display: flex; align-items: center; justify-content: center; color: var(--muted); }
.p-badge { position: absolute; left: 10px; top: 10px; z-index: 3; height: 24px; }
.p-ok { position: absolute; left: 10px; top: 40px; z-index: 3; height: 20px; }
.p-dur {
  position: absolute; right: 10px; top: 10px; z-index: 3;
  font-size: 11px; background: rgba(10, 12, 18, .6); border-radius: 5px; padding: 2px 7px;
  font-variant-numeric: tabular-nums;
}
.player-nav { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.nav-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.source-label { color: var(--muted); font-size: 13px; flex: 1; text-align: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.s-main small { font-size: 11px; color: var(--muted); line-height: 1.5; }
.setting { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.gate {
  background: var(--warn-subtle); border: 1px solid rgba(255, 182, 92, .3); border-radius: 10px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; margin-top: 12px;
  font-size: 12.5px; color: var(--warn);
}
.g-row { display: flex; align-items: flex-start; gap: 7px; }
.g-act {
  font-size: 11.5px; color: var(--warn); cursor: pointer; white-space: nowrap;
  text-decoration: underline dotted; text-underline-offset: 3px;
}
.hint { color: var(--muted); font-size: 12px; }
.resultbar {
  display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 11px 14px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
}
.rb-thumb { width: 82px; height: 46px; border-radius: 8px; flex: 0 0 auto; }
.history { margin-top: 12px; }
.hist { font-size: 12px; color: var(--text-2); padding: 4px 0; border-bottom: 1px solid var(--line); }
.timeline { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex: 0 0 92px; overflow: hidden; }
.tl-row { display: flex; gap: 8px; overflow-x: auto; flex: 1; min-width: 0; padding: 4px 0; }
.tl-shot { flex: none; width: 66px; cursor: pointer; }
.tl-shot .im { position: relative; height: 42px; border-radius: 6px; border: 1px solid var(--line); overflow: hidden; }
.tl-shot .im video { width: 100%; height: 100%; object-fit: cover; display: block; }
.tl-shot .dot { position: absolute; right: 4px; top: 4px; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--bg); }
.tl-shot .no { font-size: 10px; color: var(--muted); text-align: center; margin-top: 3px; }
.tl-shot.cur .im { border: 2px solid var(--accent); }
.tl-shot.cur .no { color: #fff; font-weight: 600; }
.tl-shot.completed .im { border-color: rgba(69, 211, 156, .5); }
.tl-shot.stale .im { border-color: rgba(255, 182, 92, .5); }
.tl-shot.failed .im, .tl-shot.missing .im { opacity: .55; }
.tl-shot .wv { font-style: normal; color: var(--warn); }
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
