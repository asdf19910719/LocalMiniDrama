<template>
  <el-dialog
    :model-value="modelValue"
    :title="episodeLabel ? `${episodeLabel} · 外部 JSON` : '外部 JSON 导入来源'"
    width="min(920px, 92vw)"
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="import-source-dialog">
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />
      <template v-else-if="source">
        <el-descriptions :column="2" border size="small" class="source-meta">
          <el-descriptions-item label="原始文件">{{ source.source_filename || 'episode-package.json' }}</el-descriptions-item>
          <el-descriptions-item label="导入时间">{{ formatTime(source.imported_at) }}</el-descriptions-item>
          <el-descriptions-item label="协议">{{ source.schema_name || '未知' }} v{{ source.schema_version || '?' }}</el-descriptions-item>
          <el-descriptions-item label="SHA-256"><code>{{ source.source_sha256 || '未记录' }}</code></el-descriptions-item>
          <el-descriptions-item v-if="source.task_package_id" label="任务包 ID"><code>{{ source.task_package_id }}</code></el-descriptions-item>
          <el-descriptions-item v-if="source.task_created_at" label="任务生成时间">{{ formatTime(source.task_created_at) }}</el-descriptions-item>
          <el-descriptions-item v-if="source.task_assets_digest" label="任务资产摘要" :span="2"><code>{{ source.task_assets_digest }}</code></el-descriptions-item>
        </el-descriptions>

        <div class="source-actions">
          <el-button size="small" @click="copyHash">复制哈希</el-button>
          <el-button size="small" @click="copyCurrent">复制当前内容</el-button>
          <el-button size="small" @click="downloadRaw">下载原始 JSON</el-button>
          <el-button size="small" :loading="loading" @click="loadSource">重新读取</el-button>
        </div>

        <el-tabs v-model="activeTab">
          <el-tab-pane label="原始 JSON" name="raw">
            <p class="tab-hint">以下内容是浏览器导入时保存的原始文本；浏览器不会保存或访问你电脑上的完整文件路径。</p>
            <pre class="json-view">{{ source.raw_json_text }}</pre>
          </el-tab-pane>
          <el-tab-pane label="规范化结果" name="normalized">
            <p class="tab-hint">这是经兼容规则补齐、实际用于落库的快照，可与原文对照定位字段映射。</p>
            <pre class="json-view">{{ normalizedDisplay }}</pre>
          </el-tab-pane>
          <el-tab-pane label="导入报告" name="report">
            <div class="report-summary">
              <el-tag :type="source.import_report?.projection?.status === 'verified' ? 'success' : 'warning'">
                投影校验：{{ source.import_report?.projection?.status || '未记录' }}
              </el-tag>
              <el-tag v-if="source.import_report?.backfill?.status" type="info">
                历史回填：{{ source.import_report.backfill.status }}
              </el-tag>
            </div>
            <el-collapse>
              <el-collapse-item
                v-for="section in reportSections"
                :key="section.key"
                :title="`${section.label}（${section.items.length}）`"
                :name="section.key"
              >
                <div v-if="section.items.length === 0" class="report-empty">无</div>
                <pre v-else class="report-view">{{ JSON.stringify(section.items, null, 2) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { episodePackageAPI } from '@/api/episodePackage'
import { formatJsonText, importReportSections, importSourceDownloadName } from '@/utils/episodeImportSource'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  episodeId: { type: [Number, String], default: null },
  episodeLabel: { type: String, default: '' },
})
defineEmits(['update:modelValue'])

const loading = ref(false)
const error = ref('')
const source = ref(null)
const activeTab = ref('raw')
const normalizedDisplay = computed(() => formatJsonText(source.value?.normalized_json_text || ''))
const reportSections = computed(() => importReportSections(
  source.value?.import_report,
  source.value?.parse_warnings,
  source.value?.match_decisions,
  source.value?.generator_metadata,
))
const reportDisplay = computed(() => JSON.stringify({
  import_report: source.value?.import_report || null,
  match_decisions: source.value?.match_decisions || null,
  generator_metadata: source.value?.generator_metadata || null,
  parse_warnings: source.value?.parse_warnings || [],
}, null, 2))

watch(() => [props.modelValue, props.episodeId], ([visible, episodeId]) => {
  if (!visible || !episodeId) return
  loadSource()
}, { immediate: true })

async function loadSource() {
  if (!props.episodeId) return
  loading.value = true
  error.value = ''
  source.value = null
  activeTab.value = 'raw'
  try {
    source.value = await episodePackageAPI.getImportSource(props.episodeId)
  } catch (e) {
    error.value = e.message || '读取导入来源失败'
  } finally {
    loading.value = false
  }
}

function currentText() {
  if (activeTab.value === 'raw') return source.value?.raw_json_text || ''
  if (activeTab.value === 'normalized') return normalizedDisplay.value
  return reportDisplay.value
}

async function copyCurrent() {
  try {
    await navigator.clipboard.writeText(currentText())
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

async function copyHash() {
  try {
    await navigator.clipboard.writeText(source.value?.source_sha256 || '')
    ElMessage.success('哈希已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

function downloadRaw() {
  const blob = new Blob([source.value?.raw_json_text || ''], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = importSourceDownloadName(source.value?.source_filename)
  link.click()
  URL.revokeObjectURL(url)
}

function formatTime(value) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<style scoped>
.import-source-dialog { min-height: 240px; }
.source-meta { margin-bottom: 12px; }
.source-meta code { word-break: break-all; font-size: 12px; }
.source-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 4px; }
.tab-hint { margin: 0 0 10px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.json-view, .report-view {
  max-height: 56vh;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.report-summary { display: flex; gap: 8px; margin-bottom: 12px; }
.report-view { max-height: 280px; }
.report-empty { color: var(--el-text-color-placeholder); font-size: 13px; }
</style>
