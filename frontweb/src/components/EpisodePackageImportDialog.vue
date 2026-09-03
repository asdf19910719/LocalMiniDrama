<template>
  <el-dialog
    v-model="visible"
    title="导入制作包"
    width="960px"
    append-to-body
    destroy-on-close
    @close="resetState"
  >
    <el-steps :active="step" align-center finish-status="success" class="pkg-steps">
      <el-step title="文件与基础信息" />
      <el-step title="资产匹配" />
      <el-step title="分镜预览" />
    </el-steps>

    <!-- Step 1: 文件与基础信息 -->
    <div v-show="step === 0" class="pkg-panel">
      <div class="pkg-upload-row">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :show-file-list="false"
          accept=".json,application/json"
          :on-change="onFileChange"
        >
          <el-button :loading="previewing">
            <el-icon><Upload /></el-icon>选择制作包 JSON
          </el-button>
        </el-upload>
        <span class="pkg-file" :class="{ 'is-empty': !fileName }">{{ fileName || '未选择文件' }}</span>
      </div>
      <div class="pkg-tip">选择单集制作包(.json,不超过 10MB)后自动预览;预览为只读操作。</div>

      <template v-if="packageInfo">
        <el-descriptions :column="2" border size="small" class="pkg-desc">
          <el-descriptions-item label="协议版本">{{ packageInfo.version || '—' }}</el-descriptions-item>
          <el-descriptions-item label="生成器">{{ generatorName }}</el-descriptions-item>
          <el-descriptions-item label="集号">{{ packageInfo.episode?.episode_number ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{ packageInfo.episode?.title || '—' }}</el-descriptions-item>
          <el-descriptions-item label="梗概" :span="2">{{ packageInfo.episode?.summary || '—' }}</el-descriptions-item>
        </el-descriptions>

        <div class="pkg-stats">
          <span class="pkg-stat">分镜 <b>{{ statNum('storyboards_created') }}</b></span>
          <span class="pkg-stat">人物 新建 <b>{{ statNum('characters_created') }}</b> / 复用 <b>{{ statNum('characters_reused') }}</b></span>
          <span class="pkg-stat">状态 新建 <b>{{ statNum('variants_created') }}</b> / 复用 <b>{{ statNum('variants_reused') }}</b></span>
          <span class="pkg-stat">场景 新建 <b>{{ statNum('scenes_created') }}</b> / 复用 <b>{{ statNum('scenes_reused') }}</b></span>
          <span class="pkg-stat">道具 新建 <b>{{ statNum('props_created') }}</b> / 复用 <b>{{ statNum('props_reused') }}</b></span>
        </div>
      </template>

      <el-form label-width="110px" class="pkg-target-form">
        <el-form-item label="导入目标">
          <el-radio-group v-model="targetMode" :disabled="previewing" @change="onTargetChange">
            <el-radio value="create">创建新剧集</el-radio>
            <el-radio value="fill">填充空白剧集</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="targetMode === 'fill'" label="空白剧集">
          <el-select
            v-model="targetEpisodeId"
            filterable
            :loading="blankEpisodesLoading"
            :disabled="previewing"
            placeholder="选择要填充的空白剧集"
            style="width: 100%"
            @change="onTargetChange"
          >
            <el-option
              v-for="ep in blankEpisodes"
              :key="ep.id"
              :label="blankEpisodeLabel(ep)"
              :value="ep.id"
            />
          </el-select>
          <span class="pkg-tip pkg-tip--inline">仅空白剧集可被填充;列表为空说明当前剧没有空白集</span>
        </el-form-item>
      </el-form>

      <div v-if="targetStatus && targetMode === 'fill'" class="pkg-target-status" :class="targetStatusClass">
        {{ targetStatusText }}
      </div>

      <div v-if="previewErrors.length" class="pkg-errors">
        <div class="pkg-errors-title">制作包校验未通过,无法继续:</div>
        <div v-for="(item, i) in previewErrors" :key="i" class="pkg-error-line">{{ formatIssue(item) }}</div>
      </div>
    </div>

    <!-- Step 2: 资产匹配 -->
    <div v-show="step === 1" class="pkg-panel">
      <el-table :data="matches" border stripe height="380" class="pkg-table" :row-class-name="matchRowClass">
        <el-table-column label="类型" width="80" align="center">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column prop="source_key" label="source_key" width="200" show-overflow-tooltip />
        <el-table-column label="名称" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="现有项" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ candidatesText(row) }}</template>
        </el-table-column>
        <el-table-column label="决策" width="200" align="center">
          <template #default="{ row }">
            <el-radio-group
              v-if="row.source_key"
              :model-value="choiceOf(row)"
              @update:model-value="(val) => setChoice(row, val)"
            >
              <el-radio value="create">新建</el-radio>
              <el-radio value="reuse" :disabled="reuseDisabled(row)">复用</el-radio>
            </el-radio-group>
            <span v-else class="pkg-undecidable">缺少 source_key,无法决策</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pkg-summary">
        <span>共 {{ matchSummary.total }} 项:</span>
        <span>人物 新建 {{ matchSummary.character.create }} / 复用 {{ matchSummary.character.reuse }} / 冲突 {{ matchSummary.character.conflict }}</span>
        <span>场景 新建 {{ matchSummary.scene.create }} / 复用 {{ matchSummary.scene.reuse }} / 冲突 {{ matchSummary.scene.conflict }}</span>
        <span>道具 新建 {{ matchSummary.prop.create }} / 复用 {{ matchSummary.prop.reuse }} / 冲突 {{ matchSummary.prop.conflict }}</span>
      </div>
      <div v-if="!canProceed" class="pkg-errors">
        <div class="pkg-error-line">存在冲突项,必须为每一项选择「新建」或「复用」后才能继续。</div>
      </div>
    </div>

    <!-- Step 3: 分镜预览 -->
    <div v-show="step === 2" class="pkg-panel">
      <el-table :data="storyboards" border stripe height="360" class="pkg-table">
        <el-table-column prop="storyboard_number" label="镜号" width="64" align="center" />
        <el-table-column prop="title" label="标题" width="130" show-overflow-tooltip />
        <el-table-column label="场景" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.scene_name || row.scene_ref || '—' }}</template>
        </el-table-column>
        <el-table-column label="人物状态" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCharacterRefs(row) }}</template>
        </el-table-column>
        <el-table-column label="道具" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.prop_refs || []).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="动作" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ truncText(row.action, 60) }}</template>
        </el-table-column>
        <el-table-column label="对白" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ truncText(row.dialogue, 60) }}</template>
        </el-table-column>
        <el-table-column label="时长" width="76" align="center">
          <template #default="{ row }">{{ row.duration_seconds != null ? `${row.duration_seconds}s` : '—' }}</template>
        </el-table-column>
      </el-table>

      <div v-if="previewErrors.length" class="pkg-errors">
        <div class="pkg-errors-title">存在 {{ previewErrors.length }} 个校验错误,无法导入:</div>
        <div v-for="(item, i) in previewErrors" :key="i" class="pkg-error-line">{{ formatIssue(item) }}</div>
      </div>

      <template v-if="previewWarnings.length">
        <div class="pkg-warnings">
          <div class="pkg-warnings-title">警告({{ previewWarnings.length }}):</div>
          <div v-for="(item, i) in previewWarnings" :key="i" class="pkg-warning-line">{{ formatIssue(item) }}</div>
        </div>
        <el-checkbox v-model="warningsAcked">我已确认上述警告</el-checkbox>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="step > 0" :disabled="importing" @click="step -= 1">上一步</el-button>
      <el-button v-if="step === 0" type="primary" :disabled="!step1Ready" :loading="previewing" @click="goStep2">下一步</el-button>
      <el-button v-else-if="step === 1" type="primary" :disabled="!canProceed" @click="step = 2">下一步</el-button>
      <el-button v-else type="primary" :loading="importing" :disabled="importBlocked" @click="doImport">导入</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { episodePackageAPI } from '@/api/episodePackage'
import { buildDecisions, canProceedMatches, summarizeMatches } from '@/utils/episodePackageMatch'

const MAX_PACKAGE_BYTES = 10 * 1024 * 1024

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  dramaId: { type: [Number, String], default: null },
})

const emit = defineEmits(['update:modelValue', 'imported'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const step = ref(0)
const uploadRef = ref(null)
const fileName = ref('')
const rawText = ref('')
const previewing = ref(false)
const packageInfo = ref(null) // normalized_package
const sourceSha256 = ref('')
const targetStatus = ref(null)
const matches = ref([])
const previewErrors = ref([])
const previewWarnings = ref([])
const stats = ref({})
const targetMode = ref('create') // create | fill
const targetEpisodeId = ref(null)
const importing = ref(false)
const warningsAcked = ref(false)
const choices = reactive({ characters: {}, scenes: {}, props: {} })

const TYPE_LABELS = { character: '人物', scene: '场景', prop: '道具' }
const GROUP_KEYS = { character: 'characters', scene: 'scenes', prop: 'props' }
const REASON_LABELS = {
  script_content_not_empty: '剧本内容非空',
  description_not_empty: '梗概非空',
  has_storyboards: '已存在分镜',
  storyboard_has_media: '分镜已含图片/视频',
  has_import_record: '已有导入记录',
}

const generatorName = computed(() => {
  const gen = packageInfo.value?.generator
  if (!gen) return '—'
  if (typeof gen === 'string') return gen
  return gen.name || '—'
})

const storyboards = computed(() => {
  const list = Array.isArray(packageInfo.value?.storyboards) ? [...packageInfo.value.storyboards] : []
  return list.sort((a, b) => (a?.storyboard_number ?? 0) - (b?.storyboard_number ?? 0))
})

const matchSummary = computed(() => summarizeMatches(matches.value))

const canProceed = computed(() => canProceedMatches(matches.value, choices))

const step1Ready = computed(() => {
  if (!packageInfo.value || previewErrors.value.length > 0) return false
  if (targetMode.value === 'fill') {
    return targetStatus.value?.status === 'blank'
  }
  return true
})

const importBlocked = computed(() => {
  if (previewErrors.value.length > 0) return true
  if (previewWarnings.value.length > 0 && !warningsAcked.value) return true
  return false
})

const targetStatusClass = computed(() => {
  const status = targetStatus.value?.status
  if (status === 'blank') return 'is-ok'
  return 'is-bad'
})

const targetStatusText = computed(() => {
  const status = targetStatus.value?.status
  if (status === 'blank') return '目标集为空白剧集,可以填充'
  if (status === 'not_found') return '目标剧集不存在或已删除,请重新选择'
  if (status === 'non_blank') {
    const reasons = (targetStatus.value?.reasons || []).map((r) => REASON_LABELS[r] || r).join('、')
    return `目标集不是空白剧集(${reasons || '原因未知'}),不可填充`
  }
  if (status === 'new_episode') return targetMode.value === 'fill' ? '请选择空白剧集后重新预览' : ''
  return ''
})

watch(visible, (val) => {
  if (val) resetState()
})

// ---------- 空白剧集下拉(懒加载) ----------
const blankEpisodes = ref([])
const blankEpisodesLoading = ref(false)
let blankEpisodesLoadedForDrama = null

function blankEpisodeLabel(ep) {
  const numberText = ep?.episode_number != null ? `第${ep.episode_number}集` : `集 ${ep?.id ?? ''}`
  const title = String(ep?.title || '').trim()
  return title ? `${numberText}·${title} (ID:${ep.id})` : `${numberText} (ID:${ep.id})`
}

/** 进入填充模式时才拉取空白剧集列表(每剧只拉一次,失败可重试) */
async function loadBlankEpisodes() {
  if (props.dramaId == null) return
  if (blankEpisodesLoadedForDrama === String(props.dramaId)) return
  blankEpisodesLoading.value = true
  try {
    const data = await episodePackageAPI.listBlankEpisodes(props.dramaId)
    blankEpisodes.value = Array.isArray(data) ? data : []
    blankEpisodesLoadedForDrama = String(props.dramaId)
  } catch (e) {
    ElMessage.error(e.message || '空白剧集列表加载失败')
  } finally {
    blankEpisodesLoading.value = false
  }
}

watch(targetMode, (mode) => {
  if (mode === 'fill') loadBlankEpisodes()
})

function resetState() {
  step.value = 0
  fileName.value = ''
  rawText.value = ''
  previewing.value = false
  packageInfo.value = null
  sourceSha256.value = ''
  targetStatus.value = null
  matches.value = []
  previewErrors.value = []
  previewWarnings.value = []
  stats.value = {}
  targetMode.value = 'create'
  targetEpisodeId.value = null
  blankEpisodes.value = []
  blankEpisodesLoading.value = false
  blankEpisodesLoadedForDrama = null
  importing.value = false
  warningsAcked.value = false
  choices.characters = {}
  choices.scenes = {}
  choices.props = {}
  if (uploadRef.value) uploadRef.value.clearFiles()
}

function statNum(key) {
  return Number(stats.value?.[key] ?? 0)
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type
}

function formatIssue(item) {
  if (!item) return ''
  const path = item.path ? `${item.path}: ` : ''
  return `${path}${item.message || ''}`
}

function truncText(text, max) {
  const str = String(text ?? '')
  if (!str) return '—'
  return str.length > max ? `${str.slice(0, max)}…` : str
}

function formatCharacterRefs(row) {
  const refs = Array.isArray(row?.character_refs) ? row.character_refs : []
  return refs
    .map((ref) => (ref?.character_ref ? `${ref.character_ref}·${ref.variant_ref || ''}` : ''))
    .filter(Boolean)
    .join('、') || '—'
}

function candidatesText(row) {
  const candidates = Array.isArray(row?.candidates) ? row.candidates : []
  if (!candidates.length) return '—'
  return `#${candidates.map((c) => c.id).join(' #')} ${candidates.map((c) => c.name).join('、')}`
}

function matchRowClass({ row }) {
  return row?.decision === 'conflict' ? 'pkg-row-conflict' : ''
}

function choiceOf(row) {
  const group = GROUP_KEYS[row.type]
  if (!group || !row.source_key) return ''
  return choices[group][row.source_key] ?? ''
}

function setChoice(row, val) {
  const group = GROUP_KEYS[row.type]
  if (!group || !row.source_key) return
  choices[group][row.source_key] = val
}

function reuseDisabled(row) {
  // 库内无任何候选(既无 source_key 匹配也无同名)时,不允许选择"复用"
  return !(Array.isArray(row?.candidates) && row.candidates.length > 0)
}

function onFileChange(uploadFile) {
  if (!uploadFile || uploadFile.status !== 'ready' || !uploadFile.raw) return
  const file = uploadFile.raw
  if (file.size > MAX_PACKAGE_BYTES) {
    ElMessage.error('制作包文件超过 10MB,已拒绝')
    resetFile()
    return
  }
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => {
    rawText.value = String(ev.target?.result || '')
    runPreview()
  }
  reader.onerror = () => {
    ElMessage.error('读取文件失败')
    resetFile()
  }
  reader.readAsText(file, 'utf-8')
}

function resetFile() {
  fileName.value = ''
  rawText.value = ''
  packageInfo.value = null
  sourceSha256.value = ''
  targetStatus.value = null
  matches.value = []
  previewErrors.value = []
  previewWarnings.value = []
  stats.value = {}
  if (uploadRef.value) uploadRef.value.clearFiles()
}

function onTargetChange() {
  if (!rawText.value) return
  runPreview()
}

async function runPreview() {
  previewing.value = true
  try {
    const data = await episodePackageAPI.preview({
      raw_json_text: rawText.value,
      filename: fileName.value || undefined,
      drama_id: props.dramaId ?? null,
      target_episode_id: targetMode.value === 'fill' && targetEpisodeId.value != null ? targetEpisodeId.value : null,
    })
    packageInfo.value = data.normalized_package || null
    sourceSha256.value = data.source_sha256 || ''
    targetStatus.value = data.target_status || null
    matches.value = Array.isArray(data.asset_matches) ? data.asset_matches : []
    previewErrors.value = Array.isArray(data.errors) ? data.errors : []
    previewWarnings.value = Array.isArray(data.warnings) ? data.warnings : []
    stats.value = data.stats || {}
    warningsAcked.value = false
    rebuildChoices()
    if (step.value > 0) step.value = 0
  } catch (e) {
    packageInfo.value = null
    sourceSha256.value = ''
    targetStatus.value = null
    matches.value = []
    previewErrors.value = []
    previewWarnings.value = []
    stats.value = {}
    ElMessage.error(e.message || '预览失败')
  } finally {
    previewing.value = false
  }
}

/** 冲突项初始为空(必须显式选择),其余项采用后端给出的 decision */
function rebuildChoices() {
  choices.characters = {}
  choices.scenes = {}
  choices.props = {}
  for (const match of matches.value) {
    const group = GROUP_KEYS[match?.type]
    if (!group || !match.source_key) continue
    choices[group][match.source_key] = match.decision === 'conflict' ? '' : match.decision
  }
}

function goStep2() {
  if (!step1Ready.value) return
  step.value = 1
}

async function doImport() {
  if (importBlocked.value || importing.value) return
  importing.value = true
  try {
    const decisions = buildDecisions(matches.value, choices)
    const data = await episodePackageAPI.importPackage({
      raw_json_text: rawText.value,
      source_sha256: sourceSha256.value,
      drama_id: props.dramaId ?? null,
      target_episode_id: targetMode.value === 'fill' && targetEpisodeId.value != null ? targetEpisodeId.value : null,
      filename: fileName.value || undefined,
      decisions,
    })
    ElMessage.success('制作包导入成功')
    emit('imported', data?.episode_id ?? null)
    visible.value = false
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.pkg-steps { margin-bottom: 20px; }
.pkg-panel { display: flex; flex-direction: column; gap: 14px; min-height: 300px; }
.pkg-upload-row { display: flex; align-items: center; gap: 12px; }
.pkg-file { font-size: 0.85rem; color: #a1a1aa; }
.pkg-file.is-empty { color: #71717a; }
.pkg-tip { font-size: 0.8rem; color: #71717a; }
.pkg-tip--inline { margin-left: 10px; }
.pkg-desc { width: 100%; }
.pkg-stats { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 0.82rem; color: #a1a1aa; }
.pkg-stat b { color: #e4e4e7; font-weight: 600; }
.pkg-target-form { margin-top: 4px; margin-bottom: 0; }
.pkg-target-status { font-size: 0.85rem; }
.pkg-target-status.is-ok { color: #4ade80; }
.pkg-target-status.is-bad { color: #f87171; }
.pkg-errors { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid rgba(248, 113, 113, 0.4); border-radius: 8px; background: rgba(248, 113, 113, 0.06); }
.pkg-errors-title { color: #f87171; font-size: 0.85rem; font-weight: 600; }
.pkg-error-line { color: #f87171; font-size: 0.8rem; line-height: 1.5; word-break: break-all; }
.pkg-warnings { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid rgba(250, 204, 21, 0.4); border-radius: 8px; background: rgba(250, 204, 21, 0.06); }
.pkg-warnings-title { color: #facc15; font-size: 0.85rem; font-weight: 600; }
.pkg-warning-line { color: #facc15; font-size: 0.8rem; line-height: 1.5; word-break: break-all; }
.pkg-summary { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.82rem; color: #a1a1aa; }
.pkg-undecidable { color: #f87171; font-size: 0.8rem; }
.pkg-table :deep(.el-table) { --el-table-bg-color: transparent; --el-table-tr-bg-color: transparent; --el-table-border-color: #3f3f46; --el-table-header-bg-color: rgba(39, 39, 42, 0.9); --el-table-row-hover-bg-color: rgba(139, 92, 246, 0.08); color: #e4e4e7; }
.pkg-table :deep(.el-table__inner-wrapper::before) { display: none; }
.pkg-table :deep(th.el-table__cell) { color: #fafafa; }
.pkg-table :deep(td.el-table__cell) { vertical-align: top; }
.pkg-table :deep(.pkg-row-conflict) { background: rgba(248, 113, 113, 0.08); }
</style>
