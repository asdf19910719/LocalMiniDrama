<template>
  <div class="sb-stage">
    <div class="readiness-bar">
      <span class="badge" :class="readinessClass">{{ readinessText }}</span>
      <el-button v-if="guardRecovery" size="small" type="warning" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/assets`)">去处理</el-button>
      <span class="spacer"></span>
      <el-dropdown trigger="click" @command="onMore">
        <el-button size="small">更多</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="update-structure">更新分镜结构</el-dropdown-item>
            <el-dropdown-item command="import">导入分镜文件</el-dropdown-item>
            <el-dropdown-item command="export">导出分镜资料</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="shots.length === 0" class="empty">
      <p>本集还没有分镜</p>
      <el-button type="primary" @click="createFromScript">从已确认剧本创建分镜</el-button>
    </div>

    <div v-else class="workbench">
      <aside class="inspector">
        <h4>镜头 {{ current.number }} · {{ current.duration }}s</h4>
        <div class="ref-groups">
          <h5>出场角色</h5>
          <div v-for="r in references.characters" :key="r.referenceId" class="ref-row">{{ r.name }} <el-tag size="small" type="info">固定版本</el-tag></div>
          <h5>分镜场景</h5>
          <div v-for="r in references.scene?.refs || []" :key="r.assetId" class="ref-row">{{ r.name }} <el-tag size="small">结构性</el-tag></div>
          <h5>场景道具</h5>
          <div v-for="r in references.props" :key="r.referenceId" class="ref-row">{{ r.name }}</div>
        </div>
        <div class="frame-chaining">
          首尾帧衔接：{{ frameChaining.stateLabel }}
          <el-button v-if="frameChaining.state === 'linkable'" size="small" @click="confirmLink">衔接</el-button>
        </div>
        <div class="image-area">
          <h5>分镜图</h5>
          <div class="img-row">
            <div v-for="c in imageCandidates" :key="c.candidateId" class="img-cand" :class="{ current: currentImage && currentImage.url === c.url }" @click="setCurrentImage(c)">
              <img :src="c.url">
            </div>
          </div>
          <el-button size="small" :loading="generatingImage" @click="generateImage">生成分镜图</el-button>
        </div>
      </aside>

      <section class="prompts">
        <div class="chips">
          <el-tag v-for="(r, i) in referenceChips" :key="i" size="small">@图片{{ i + 1 }} {{ r }}</el-tag>
        </div>
        <div v-for="seg in segments" :key="seg.id" class="seg-card">
          <div class="seg-head">
            <span class="tc">{{ seg.start_seconds.toFixed(1) }}–{{ seg.end_seconds.toFixed(1) }}s</span>
            <span class="seg-ops">
              <el-button size="small" text @click="split(seg)">拆分</el-button>
              <el-button size="small" text @click="merge(seg)">合并</el-button>
            </span>
          </div>
          <el-input v-model="seg.visual" type="textarea" :rows="2" @change="saveSegment(seg)" />
          <el-input v-model="seg.dialogue" placeholder="对白/声音（可留空）" @change="saveSegment(seg)" />
        </div>

        <div class="image-prompt">
          <h5>分镜图提示词 {{ imagePrompt.manual ? '（已手工覆盖）' : '' }}</h5>
          <el-input v-model="imagePrompt.text" type="textarea" :rows="2" @change="saveImagePrompt" />
          <el-button v-if="imagePrompt.manual" size="small" text type="primary" @click="resetImagePrompt">恢复自动拼装</el-button>
        </div>

        <div class="h3-bar">
          <span class="badge" :class="h3Class">{{ h3.statusLabel || '未生成' }}</span>
          <el-button size="small" @click="generateH3">{{ h3.statusLabel === '需要更新' ? '重新生成 H3 提示词' : '生成 H3 提示词' }}</el-button>
          <el-collapse v-if="h3.text" class="h3-editor">
            <el-collapse-item title="查看 / 编辑 H3 草稿">
              <el-input v-model="h3.text" type="textarea" :rows="6" @change="markH3Dirty" />
              <el-button size="small" type="primary" :disabled="!h3Dirty" @click="saveH3">保存并校验</el-button>
              <div class="h3-checks">
                <span v-for="c in h3.validation?.checks || []" :key="c.id" class="badge" :class="c.ok ? 'green' : 'red'">{{ c.label }}</span>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>

        <div class="gen-bar">
          <el-input-number v-model="videoCount" :min="1" :max="3" size="small" />
          <el-button type="primary" :disabled="!guard.canSubmit" @click="openVideoConfirm">
            用 H3 生成视频 {{ quote ? `· ${quote.count} 个候选` : '' }}
          </el-button>
          <div class="joint-checks">
            <span v-for="c in guard.checks || []" :key="c.id" class="badge" :class="c.ok ? 'green' : 'red'">{{ c.label }}</span>
          </div>
        </div>
      </section>

      <aside class="result">
        <h4>视频</h4>
        <video v-if="previewUrl" :key="previewUrl" :src="previewUrl" controls class="player"></video>
        <div v-else class="player empty">尚未选择候选预览</div>
        <div class="cand-strip">
          <div v-for="c in videoCandidates" :key="c.candidateId" class="vcand" :class="{ adopted: c.isAdopted }" @click="preview(c)">
            <span>候选 {{ c.candidateId.slice(-4) }}</span>
            <span v-if="c.isAdopted" class="badge green">用于本镜</span>
          </div>
        </div>
        <el-button v-if="previewCandidate && !previewCandidate.isAdopted" type="primary" size="small" @click="adopt">用于本镜</el-button>
        <el-button v-else-if="previewCandidate && previewCandidate.isAdopted" size="small" @click="undoAdopt">撤销采用</el-button>
      </aside>
    </div>

    <footer v-if="shots.length" class="shot-rail">
      <div v-for="s in shots" :key="s.id" class="rail-shot" :class="{ current: s.id === currentShotId }" @click="selectShot(s.id)">
        {{ String(s.number).padStart(2, '0') }}
      </div>
      <el-button size="small" type="primary" plain class="cut-entry" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/cut`)">
        进入成片审核（{{ completion.adopted }}/{{ completion.total }}）
      </el-button>
    </footer>

    <el-dialog v-model="videoConfirmOpen" title="确认生成视频" width="440px">
      <p>生成数量：{{ videoCount }} · 费用按数量乘算</p>
      <p class="hint">输出时长 {{ current.duration }}s · mock 本地执行，不产生 API 费用 · 预计 1–2 分钟（非承诺值）</p>
      <template #footer>
        <el-button @click="videoConfirmOpen = false">取消</el-button>
        <el-button type="primary" @click="submitVideo">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'StoryboardStage',
  props: { projectId: String, episodeId: String },
  data() {
    return {
      shots: [], currentShotId: null, current: null, references: { characters: [], props: [], scene: {} },
      segments: [], imagePrompt: { text: '', manual: false }, imageCandidates: [],
      h3: {}, h3Dirty: false, guard: {}, completion: { adopted: 0, total: 0 },
      videoCandidates: [], previewCandidate: null, previewUrl: '', videoCount: 1, videoConfirmOpen: false,
      generatingImage: false, readiness: { status: 'checking' }, frameChaining: { state: 'none', stateLabel: '首镜' },
    }
  },
  computed: {
    referenceChips() {
      return [...(this.references.characters || []), ...(this.references.props || [])].map((r) => r.name)
    },
    readinessText() {
      return {
        checking: '正在准备素材…', ready: '素材已准备', 'needs-attention': '有待处理项：受影响镜头生成已禁用',
        'snapshot-failed': '快照失败：生成已禁用', 'script-unapproved': '剧本未确认：生成已禁用',
      }[this.readiness.status] || '正在准备素材…'
    },
    readinessClass() {
      return { ready: 'green', 'needs-attention': 'amber', 'snapshot-failed': 'red', 'script-unapproved': 'red', checking: 'gray' }
    },
    h3Class() {
      return { 'ai-generated': 'green', valid: 'green', invalid: 'red', stale: 'amber' }[this.h3.status] || 'gray'
    },
    guardRecovery() {
      return this.readiness.status && this.readiness.status !== 'ready'
    },
    currentImage() {
      return this.current ? { url: this.current.currentImage } : null
    },
    quote() {
      return { count: this.videoCount }
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.getStoryboard(this.episodeId)
      this.shots = data.shots || []
      this.completion = data.completion || this.completion
      const guard = await v21.getMediaGuard(this.episodeId)
      this.readiness = { status: guard.readiness }
      if (this.currentShotId === null && this.shots.length > 0) this.selectShot(this.shots[0].id)
    },
    async createFromScript() {
      await v21.createFromScript(this.episodeId)
      await this.load()
    },
    async selectShot(shotId) {
      this.currentShotId = shotId
      const detail = await v21.getShot(shotId)
      this.current = detail.shot
      this.references = detail.references
      this.segments = detail.shot.segments
      this.imagePrompt = detail.imagePrompt
      this.imageCandidates = detail.imageCandidates
      this.h3 = detail.h3Draft || {}
      this.videoCandidates = detail.video.candidates
      this.previewCandidate = null
      this.previewUrl = ''
      this.frameChaining = { ...detail.frameChaining, stateLabel: { linked: '已衔接', linkable: '可衔接', waiting: '等待上一镜完成', none: '首镜' }[detail.frameChaining.state] }
      this.refreshGuard()
    },
    async refreshGuard() {
      this.guard = await v21.getVideoGuard(this.currentShotId)
    },
    async saveSegment(seg) {
      try {
        const result = await v21.editSegment(this.currentShotId, seg.id, { visual: seg.visual, dialogue: seg.dialogue })
        this.segments = result.segments
        ElMessage.closeAll()
      } catch (e) {
        ElMessage.error(e.message)
      }
    },
    async split(seg) {
      const mid = seg.start_seconds + (seg.end_seconds - seg.start_seconds) / 2
      const result = await v21.splitSegment(this.currentShotId, seg.id, mid)
      this.segments = result.segments
    },
    async merge(seg) {
      const result = await v21.mergeSegment(this.currentShotId, seg.id)
      this.segments = result.segments
    },
    async saveImagePrompt() {
      await v21.editImagePrompt(this.currentShotId, this.imagePrompt.text)
      this.imagePrompt.manual = true
    },
    async resetImagePrompt() {
      this.imagePrompt = await v21.resetImagePrompt(this.currentShotId)
    },
    async generateImage() {
      this.generatingImage = true
      try {
        await v21.generateShotImage(this.currentShotId, {})
        this.imageCandidates = await v21.getShot(this.currentShotId).then((d) => d.imageCandidates)
      } finally {
        this.generatingImage = false
      }
    },
    async setCurrentImage(candidate) {
      const result = await v21.setShotImageCurrent(this.currentShotId, candidate.candidateId)
      ElMessage.info({ message: '已设为当前分镜图；H3 需要更新', grouping: true })
      this.h3 = result.h3Draft
      await this.selectShot(this.currentShotId)
    },
    async generateH3() {
      try {
        this.h3 = await v21.generateH3(this.currentShotId, {})
        this.refreshGuard()
      } catch (e) {
        ElMessage.error(e.message)
      }
    },
    markH3Dirty() { this.h3Dirty = true },
    async saveH3() {
      this.h3 = await v21.saveH3(this.currentShotId, this.h3.text)
      this.h3Dirty = false
      this.refreshGuard()
    },
    async openVideoConfirm() {
      await v21.getVideoQuote(this.currentShotId, this.videoCount)
      this.videoConfirmOpen = true
    },
    async submitVideo() {
      this.videoConfirmOpen = false
      const submitted = await v21.submitVideo(this.currentShotId, { count: this.videoCount })
      ElMessage.success(`已创建 ${submitted.tasks.length} 个并行任务`)
      for (const task of submitted.tasks) {
        await v21.completeVideoTask(task.taskId)
      }
      await this.selectShot(this.currentShotId)
      ElMessage.success('生成完成，候选已追加（未自动采用）')
    },
    preview(candidate) {
      this.previewCandidate = candidate
      this.previewUrl = candidate.url
    },
    async adopt() {
      await v21.adoptVideo(this.currentShotId, this.previewCandidate.candidateId)
      await this.selectShot(this.currentShotId)
    },
    async undoAdopt() {
      await v21.undoAdoptVideo(this.currentShotId)
      await this.selectShot(this.currentShotId)
    },
    async confirmLink() {
      await v21.confirmFrameLink(this.currentShotId)
      await this.selectShot(this.currentShotId)
    },
    onMore(cmd) {
      ElMessage.info(`${cmd}：向导流程在更多菜单内打开（P1）`)
    },
  },
}
</script>

<style scoped>
.sb-stage { padding: 12px 20px; display: flex; flex-direction: column; height: 100%; }
.readiness-bar { display: flex; gap: 12px; align-items: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 14px; }
.spacer { flex: 1; }
.badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; }
.badge.green { background: #ecfdf5; color: #047857; }
.badge.amber { background: #fffbeb; color: #b45309; }
.badge.red { background: #fef2f2; color: #b91c1c; }
.badge.gray { background: #f3f4f6; color: #6b7280; }
.workbench { display: grid; grid-template-columns: 250px 1fr 420px; gap: 14px; margin-top: 12px; flex: 1; }
.inspector, .prompts, .result { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; overflow: auto; }
.ref-row { padding: 4px 0; font-size: 13px; }
.frame-chaining { margin-top: 12px; font-size: 13px; color: #6b7280; }
.img-cand { width: 72px; height: 54px; border-radius: 6px; overflow: hidden; cursor: pointer; border: 2px solid transparent; }
.img-cand.current { border-color: #22c55e; }
.img-cand img { width: 100%; height: 100%; object-fit: cover; }
.img-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.seg-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.seg-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
.tc { font-weight: 600; font-size: 13px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.h3-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
.h3-editor { width: 100%; }
.h3-checks { display: flex; gap: 6px; margin-top: 6px; }
.gen-bar { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
.joint-checks { display: flex; gap: 4px; }
.player { width: 100%; min-height: 240px; background: #111; border-radius: 8px; }
.player.empty { display: flex; align-items: center; justify-content: center; color: #9ca3af; }
.cand-strip { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.vcand { display: flex; justify-content: space-between; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.vcand.adopted { border-color: #22c55e; background: #f0fdf4; }
.shot-rail { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.rail-shot { padding: 8px 14px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
.rail-shot.current { border-color: #2563eb; background: #eff6ff; }
.cut-entry { margin-left: auto; }
.empty { text-align: center; padding: 80px 0; }
.hint { color: #9ca3af; font-size: 12px; }
h4, h5 { margin: 8px 0; }
</style>
