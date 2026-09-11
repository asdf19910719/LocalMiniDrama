<template>
  <div class="wizard">
    <el-button text @click="$router.push(`/projects/${projectId}/episodes`)">← 返回剧集</el-button>
    <h1>外部 AI 制作</h1>
    <el-steps :active="stepIndex" align-center finish-status="success">
      <el-step v-for="label in stepLabels" :key="label" :title="label" />
    </el-steps>

    <section class="step-body">
      <!-- 离页恢复提示（任务不存在/已取消时） -->
      <div v-if="restoreNotice" class="card restore-notice" style="margin-bottom: 16px; padding: 12px 14px; display: flex; align-items: center; gap: 10px; border-color: rgba(255,182,92,.45)">
        <svg style="width:14px;height:14px;color:var(--warn);flex:0 0 auto"><use href="#i-warn"/></svg>
        <span class="xs" style="color:var(--warn)">{{ restoreNotice }}</span>
        <span style="flex:1"></span>
        <button class="icon-btn" style="width:24px;height:24px" @click="restoreNotice = ''"><svg><use href="#i-close"/></svg></button>
      </div>

      <!-- 1 选择目标 -->
      <template v-if="step === 'target'">
        <h3>选择目标</h3>
        <p class="hint">非空剧集永不可写入；只能创建下一集或填充空白剧集。</p>
        <el-radio-group v-model="targetMode">
          <el-radio-button label="create_new">创建下一集（第 {{ nextNumber }} 集）</el-radio-button>
          <el-radio-button label="fill_blank">填充空白剧集</el-radio-button>
        </el-radio-group>
        <el-select v-if="targetMode === 'fill_blank'" v-model="targetEpisodeId" placeholder="选择空白剧集" style="margin-top: 14px; width: 260px">
          <el-option v-for="ep in blankEpisodes" :key="ep.id" :label="`第 ${ep.episodeNumber} 集 · ${ep.title || '未命名'}`" :value="ep.id" />
        </el-select>
        <div class="step-actions">
          <el-button type="primary" :disabled="targetMode === 'fill_blank' && !targetEpisodeId" @click="step = 'context'">下一步</el-button>
        </div>
      </template>

      <!-- 2 自动汇总上下文（只读） -->
      <template v-else-if="step === 'context'">
        <h3>自动汇总上下文（只读）</h3>
        <div class="context-box">
          <p>将包含：项目资料、当前画面风格、已确认的连续性、必要人物/场景/道具、上一集摘要。</p>
          <p class="hint">上下文由系统自动编译，生成时间与版本将冻结进任务包；本步骤零费用。</p>
        </div>
        <div class="step-actions">
          <el-button @click="step = 'target'">上一步</el-button>
          <el-button type="primary" @click="step = 'note'">下一步</el-button>
        </div>
      </template>

      <!-- 3 补充本次要求（唯一可编辑） -->
      <template v-else-if="step === 'note'">
        <h3>给外部 AI 的补充说明</h3>
        <el-input v-model="taskNote" type="textarea" :rows="5" placeholder="本次任务的特别要求、本集必须保持或不能改变的设定。" />
        <p class="hint">这是本次任务唯一可编辑的内容</p>
        <div class="step-actions">
          <el-button @click="step = 'context'">上一步</el-button>
          <el-button type="primary" @click="step = 'package'">下一步</el-button>
        </div>
      </template>

      <!-- 4 预览并创建任务包 -->
      <template v-else-if="step === 'package'">
        <h3>预览并创建任务包</h3>
        <div class="pkg-info">
          <p>目标：{{ targetMode === 'create_new' ? `创建第 ${nextNumber} 集` : `填充第 ${targetNumber} 集（空白）` }}</p>
          <p>包内容：任务说明 + 当前项目资产清单 + 返回格式 Schema（冻结版本与素材摘要）</p>
          <p class="hint">创建零费用；导入结果永远为草稿，不会创建图片/视频/音频任务</p>
        </div>
        <div class="step-actions">
          <el-button @click="step = 'note'">上一步</el-button>
          <el-button type="primary" :loading="creating" @click="createPackage">创建任务包</el-button>
        </div>
      </template>

      <!-- 5 等待外部结果 -->
      <template v-else-if="step === 'waiting'">
        <h3>等待外部结果</h3>
        <p>任务包 <code>{{ taskId }}</code> 已创建；任务已持久化，刷新或离页后可经剧集中心「外部 AI 任务」或本页 URL（?taskId=）恢复。</p>
        <div class="actions">
          <el-button @click="download('zip')">下载任务包</el-button>
          <el-button @click="download('json')">下载单文件任务 JSON</el-button>
          <el-button @click="copyInstructions">复制任务说明</el-button>
          <el-button @click="copyContext">复制完整上下文</el-button>
        </div>
        <div class="step-actions">
          <el-button type="primary" @click="step = 'result'">选择结果 JSON</el-button>
          <el-button @click="cancelTask">取消任务</el-button>
        </div>
      </template>

      <!-- 6 选择结果 JSON -->
      <template v-else-if="step === 'result'">
        <h3>选择结果 JSON</h3>
        <div v-if="checks && !checks.ok" class="check-fail">
          <p class="check-fail-hint">校验未通过，请修正结果 JSON 或返回上一步</p>
          <div v-for="c in checks.checks" :key="c.id" class="check-row" :class="{ fail: !c.ok }">
            <span class="check-mark">{{ c.ok ? '✓' : '✗' }}</span>
            <span class="check-label">{{ c.label }}</span>
            <span v-if="c.detail" class="check-detail">{{ c.detail }}</span>
          </div>
        </div>
        <el-input v-model="resultText" type="textarea" :rows="10" placeholder='粘贴外部 AI 返回的 JSON（external-ai-result@2.1）' />
        <div class="step-actions">
          <el-button @click="step = 'waiting'">上一步</el-button>
          <el-button type="primary" :loading="validating" @click="validate">校验结果</el-button>
        </div>
      </template>

      <!-- 7 预览导入 -->
      <template v-else-if="step === 'preview'">
        <h3>预览导入（五步）</h3>
        <el-alert v-if="checks" :type="checks.ok ? 'success' : 'error'" :title="checks.ok ? '全部校验通过' : '存在未通过项'" :closable="false" style="margin-bottom: 12px">
          <div v-for="c in checks.checks" :key="c.id">{{ c.ok ? '√' : '×' }} {{ c.label }} {{ c.detail }}</div>
        </el-alert>
        <div v-if="plan">
          <p>目标：{{ plan.summary?.target }}</p>
          <p>场次 {{ plan.summary?.scenes }} · 分镜 {{ plan.summary?.shots }} · 时段 {{ plan.summary?.segments }}</p>
          <p>新建素材 {{ plan.summary?.creates }} · 复用素材 {{ plan.summary?.reuses }} · 媒体任务 {{ plan.summary?.mediaTasks }}（零）· 远端费用 {{ plan.summary?.remoteCost }}</p>
        </div>
        <div class="step-actions">
          <el-button @click="step = 'result'">上一步</el-button>
          <el-button type="primary" :disabled="!plan || !plan.ok" :loading="importing" @click="confirmImport()">确认写入草稿</el-button>
        </div>
      </template>

      <!-- 8 已导入草稿 -->
      <template v-else-if="step === 'done'">
        <el-result icon="success" title="已导入草稿" :sub-title="`第 ${imported.episodeNumber || ''} 集已写入（剧本保持草稿；未创建任何媒体任务）`">
          <template #extra>
            <el-button type="primary" @click="$router.push(`/projects/${projectId}/episodes/${imported.episodeId}/script`)">打开剧本页</el-button>
            <el-button @click="$router.push(`/projects/${projectId}/episodes`)">返回剧集</el-button>
          </template>
        </el-result>
      </template>
    </section>

    <!-- 素材快照摘要不一致 · 三选面板（digest 失配） -->
    <div v-if="digestModal" class="scrim" style="z-index:80" @click="digestModal = false"></div>
    <div v-if="digestModal" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:560px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--warn)"><use href="#i-warn"/></svg>
          <h3>素材快照摘要不一致</h3>
          <button class="icon-btn" @click="digestModal = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="xs" style="line-height:1.8; color:var(--text-2)">
            结果 JSON 的 <code>assets_digest</code> 与任务包冻结值不一致（建包后项目素材已变化，或结果来自旧版本任务包）。
            请选择下一步：按冻结快照继续导入、放弃本任务，或返回修改结果 JSON。
          </p>
        </div>
        <div class="modal-f" style="flex-wrap:wrap; justify-content:flex-start; gap:8px">
          <button class="btn primary" :disabled="importing" @click="importFrozenSnapshot()">按冻结快照导入（素材快照与建包时不一致，确认后继续）</button>
          <button class="btn ghost" :disabled="abandoning" @click="abandonAndRecreate">放弃并创建新任务</button>
          <button class="btn ghost" @click="digestModal = false">返回修改结果 JSON</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus'
import v21 from '@/v21/api.js'

const STEP_LABELS = ['选择目标', '自动汇总上下文', '补充本次要求', '预览并创建任务包', '等待外部结果', '选择结果 JSON', '预览导入', '已导入草稿']
const STEP_KEYS = ['target', 'context', 'note', 'package', 'waiting', 'result', 'preview', 'done']

export default {
  name: 'ExternalAiWizardView',
  data() {
    return {
      step: 'target',
      stepLabels: STEP_LABELS,
      targetMode: 'create_new',
      targetEpisodeId: '',
      blankEpisodes: [],
      taskNote: '',
      taskId: '',
      task: null,
      resultText: '',
      checks: null,
      plan: null,
      imported: null,
      creating: false, validating: false, importing: false,
      restoreNotice: '', digestModal: false, abandoning: false,
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    stepIndex() { return STEP_KEYS.indexOf(this.step) },
    nextNumber() {
      return this.task?.targetEpisodeNumber || null
    },
    targetNumber() {
      const ep = this.blankEpisodes.find((e) => String(e.id) === String(this.targetEpisodeId))
      return ep ? ep.episodeNumber : ''
    },
  },
  async mounted() {
    this.blankEpisodes = (await v21.listBlankEpisodes(this.projectId)).items || []
    const taskId = this.$route.query.taskId
    if (taskId) await this.restoreFromTask(String(taskId))
  },
  methods: {
    /** 离页恢复：按 URL 中的 taskId 取回任务与其当前步（waiting-result / imported-draft） */
    async restoreFromTask(taskId) {
      try {
        const model = await v21.getWizard(this.projectId, taskId)
        if (!model || !model.task) {
          this.restoreNotice = '任务不存在或已取消'
          this.clearTaskQuery()
          return
        }
        this.taskId = taskId
        this.task = model.task
        if (model.target) {
          this.targetMode = model.target.selectedMode || 'create_new'
          this.targetEpisodeId = model.target.selectedEpisodeId || ''
        }
        if (model.currentStep === 'imported-draft') {
          this.imported = {
            episodeId: this.task.targetEpisodeId,
            episodeNumber: this.task.targetEpisodeNumber,
          }
          this.step = 'done'
        } else {
          this.step = 'waiting'
        }
      } catch (e) {
        this.restoreNotice = '任务不存在或已取消'
        this.clearTaskQuery()
      }
    },
    clearTaskQuery() {
      if (this.$route.query.taskId) this.$router.replace({ query: {} })
    },
    async createPackage() {
      this.creating = true
      try {
        const created = await v21.createPackage(this.projectId, {
          mode: this.targetMode,
          episodeId: this.targetEpisodeId || null,
          taskNote: this.taskNote,
        })
        this.taskId = created.packageId
        this.task = await v21.getExternalTask(this.taskId)
        this.step = 'waiting'
        this.$router.replace({ query: { taskId: this.taskId } })
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.creating = false
      }
    },
    async download(format) {
      const result = await v21.downloadTask(this.taskId, format)
      const blob = format === 'zip' ? result.data : new Blob([result.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = format === 'zip' ? `${this.taskId}.zip` : `${this.taskId}.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    async copyInstructions() {
      await navigator.clipboard.writeText(this.task?.instructions || '')
      ElMessage.success('已复制任务说明')
    },
    async copyContext() {
      await navigator.clipboard.writeText(this.task?.context || '')
      ElMessage.success('已复制完整上下文')
    },
    async cancelTask() {
      await ElMessageBox.confirm('取消任务将保留审计记录，确认？', '取消任务', { type: 'warning' })
        .then(async () => {
          await v21.cancelExternalTask(this.taskId)
          ElMessage.info('任务已取消')
          this.clearTaskQuery()
          this.$router.push(`/projects/${this.projectId}/episodes`)
        })
        .catch(() => {})
    },
    async validate() {
      this.validating = true
      try {
        this.checks = await v21.validateResult(this.taskId, this.resultText)
        if (!this.checks.ok) {
          return // 校验失败：结果步就地渲染 checks 清单
        }
        this.plan = await v21.previewImport(this.taskId, this.resultText)
        this.step = 'preview'
      } catch (e) {
        if (e.code === 'ASSETS_DIGEST_MISMATCH') {
          this.digestModal = true
          return
        }
        ElMessage.error(e.message)
      } finally {
        this.validating = false
      }
    },
    async confirmImport(options = {}) {
      this.importing = true
      try {
        this.imported = await v21.confirmImport(this.taskId, this.resultText, options)
        this.digestModal = false
        this.step = 'done'
      } catch (e) {
        if (e.code === 'ASSETS_DIGEST_MISMATCH') {
          this.digestModal = true
          return
        }
        ElMessage.error(e.message)
      } finally {
        this.importing = false
      }
    },
    async importFrozenSnapshot() {
      await this.confirmImport({ frozenSnapshot: true })
    },
    /** 放弃当前任务：取消后回第一步，可重新创建新任务包 */
    async abandonAndRecreate() {
      this.abandoning = true
      try {
        await v21.cancelExternalTask(this.taskId)
        this.digestModal = false
        this.taskId = ''
        this.task = null
        this.checks = null
        this.plan = null
        this.resultText = ''
        this.imported = null
        this.step = 'target'
        this.clearTaskQuery()
      } catch (e) {
        ElMessage.error(e.message)
      } finally {
        this.abandoning = false
      }
    },
  },
}
</script>

<style scoped>
.wizard { padding: 24px 48px; max-width: 900px; margin: 0 auto; }
.step-body { margin-top: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px; min-height: 320px; }
.step-actions { margin-top: 20px; display: flex; gap: 10px; }
.hint { color: #9ca3af; font-size: 12px; }
.context-box, .pkg-info { background: #f9fafb; border-radius: 8px; padding: 14px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
.check-fail { border: 1px solid rgba(239, 68, 68, .35); background: rgba(239, 68, 68, .06); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.check-fail-hint { color: var(--danger, #ef4444); font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.check-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; padding: 3px 0; color: var(--text-2, #374151); }
.check-row .check-mark { flex: 0 0 auto; width: 16px; text-align: center; }
.check-row.fail { color: var(--danger, #ef4444); }
.check-row.fail .check-mark { font-weight: 700; }
.check-detail { color: inherit; opacity: .8; font-size: 12px; word-break: break-all; }
</style>
