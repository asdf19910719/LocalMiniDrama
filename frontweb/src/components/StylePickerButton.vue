<template>
  <div class="style-picker-wrap">
    <button type="button" class="style-picker-trigger" :class="{ 'has-value': !!modelValue }" @click="openPicker">
      <img v-if="selectedStyle?.preview?.localPath" :src="selectedStyle.preview.localPath" :alt="selectedStyle.labelZh" />
      <span v-else class="trigger-swatch" :style="fallbackStyle(selectedStyle)" />
      <span class="trigger-copy">
        <strong>{{ selectedStyle?.labelZh || placeholder }}</strong>
        <small v-if="selectedStyle">{{ selectedStyle.labelEn }}</small>
      </span>
      <el-icon><ArrowDown /></el-icon>
    </button>

    <el-dialog v-model="visible" title="选择项目画风" width="min(1120px, 94vw)" class="style-library-dialog" append-to-body>
      <div class="library-toolbar">
        <el-input v-model="search" clearable placeholder="搜索中文名、英文名或风格说明" class="style-search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button @click="customVisible = true"><el-icon><Plus /></el-icon>创建我的画风</el-button>
      </div>

      <div class="category-tabs" role="tablist" aria-label="风格分类">
        <button v-for="tab in tabs" :key="tab.value" type="button" :class="{ active: activeTab === tab.value }" @click="activeTab = tab.value">
          {{ tab.label }} <span>{{ tabCount(tab.value) }}</span>
        </button>
      </div>

      <div v-loading="loading" class="style-grid">
        <article
          v-for="style in filteredStyles"
          :key="style.id"
          class="style-card"
          :class="{ selected: style.id === modelValue }"
          @click="selectStyle(style)"
        >
          <div class="preview-frame">
            <img v-if="style.preview?.localPath" :src="style.preview.localPath" :alt="`${style.labelZh}预览`" loading="lazy" />
            <div v-else class="preview-fallback" :style="fallbackStyle(style)">{{ style.labelZh.slice(0, 2) }}</div>
            <span v-if="style.id === modelValue" class="selected-badge">已选</span>
            <button type="button" class="detail-button" @click.stop="showDetail(style)">详情</button>
          </div>
          <div class="style-card-copy">
            <strong>{{ style.labelZh }}</strong>
            <small>{{ style.labelEn }}</small>
            <p>{{ style.descriptionZh }}</p>
          </div>
        </article>
        <el-empty v-if="!loading && filteredStyles.length === 0" description="没有匹配的画风" />
      </div>

      <template #footer>
        <div class="dialog-footer">
          <span>项目风格会统一参与人物、场景、道具、分镜图片和视频提示词编译</span>
          <el-button @click="visible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="画风详情" size="430px" append-to-body>
      <template v-if="detailStyle">
        <img class="drawer-preview" :src="detailStyle.preview?.localPath" :alt="detailStyle.labelZh" />
        <h3>{{ detailStyle.labelZh }}</h3>
        <div class="drawer-en">{{ detailStyle.labelEn }}</div>
        <p>{{ detailStyle.descriptionZh }}</p>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="分类">{{ categoryLabel(detailStyle.category) }}</el-descriptions-item>
          <el-descriptions-item label="适用对象">{{ (detailStyle.suitableAssetTypes || []).join('、') }}</el-descriptions-item>
          <el-descriptions-item label="提示词语言">{{ detailStyle.recommendedCapabilities?.preferredPromptLanguage || 'auto' }}</el-descriptions-item>
        </el-descriptions>
        <el-collapse class="prompt-disclosure">
          <el-collapse-item title="查看实际中文风格提示词" name="zh"><p>{{ detailStyle.promptZh }}</p></el-collapse-item>
          <el-collapse-item title="查看实际英文风格提示词" name="en"><p>{{ detailStyle.promptEn }}</p></el-collapse-item>
        </el-collapse>
        <el-button type="primary" class="drawer-select" @click="selectStyle(detailStyle)">使用此画风</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="customVisible" title="创建我的画风" width="620px" append-to-body>
      <el-form label-position="top">
        <div class="custom-name-row">
          <el-form-item label="中文名称"><el-input v-model="customForm.labelZh" /></el-form-item>
          <el-form-item label="英文名称"><el-input v-model="customForm.labelEn" /></el-form-item>
        </div>
        <el-form-item label="中文说明"><el-input v-model="customForm.descriptionZh" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="中文风格提示词"><el-input v-model="customForm.promptZh" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="英文风格提示词"><el-input v-model="customForm.promptEn" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="customVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingCustom" @click="createCustomStyle">保存并使用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowDown, Plus, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { stylesAPI } from '@/api/styles'

const props = defineProps({
  modelValue: { type: String, default: '' },
  customPrompt: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '选择图片/视频风格' },
})
const emit = defineEmits(['update:modelValue', 'update:customPrompt', 'change'])

const styles = ref([])
const loading = ref(false)
const visible = ref(false)
const search = ref('')
const activeTab = ref('all')
const detailVisible = ref(false)
const detailStyle = ref(null)
const customVisible = ref(false)
const savingCustom = ref(false)
const customForm = ref({ labelZh: '', labelEn: '', descriptionZh: '', promptZh: '', promptEn: '' })
const tabs = [
  { label: '全部', value: 'all' },
  { label: '真人', value: 'realistic' },
  { label: '3D', value: '3d-special' },
  { label: '2D', value: '2d' },
  { label: '我的', value: 'mine' },
]

const selectedStyle = computed(() => styles.value.find((style) => style.id === props.modelValue) || null)
const filteredStyles = computed(() => {
  const q = search.value.trim().toLocaleLowerCase()
  return styles.value.filter((style) => {
    if (activeTab.value === 'mine' && style.type !== 'custom') return false
    if (!['all', 'mine'].includes(activeTab.value) && style.category !== activeTab.value) return false
    return !q || [style.labelZh, style.labelEn, style.descriptionZh, style.key]
      .some((value) => String(value || '').toLocaleLowerCase().includes(q))
  })
})

function tabCount(value) {
  if (value === 'all') return styles.value.length
  if (value === 'mine') return styles.value.filter((style) => style.type === 'custom').length
  return styles.value.filter((style) => style.category === value).length
}
function categoryLabel(value) {
  return ({ realistic: '真人', '3d-special': '3D', '2d': '2D', custom: '我的画风' })[value] || value || '其他'
}
function fallbackStyle(style) {
  return { background: style?.preview?.fallbackColor || 'linear-gradient(135deg,#42526e,#101828)' }
}
function legacyFallback() {
  return props.options.flatMap((group) => group.options || []).map((item, index) => ({
    id: item.value, key: item.value, type: 'system', category: '2d', sortOrder: index,
    labelZh: item.label, labelEn: item.label, descriptionZh: item.prompt || '', promptZh: item.prompt || '',
    promptEn: item.promptEn || item.prompt || '', suitableAssetTypes: [], recommendedCapabilities: {},
    preview: { localPath: item.thumb || '', fallbackColor: item.color },
  }))
}
async function loadStyles() {
  loading.value = true
  try {
    const result = await stylesAPI.list()
    styles.value = result?.items || []
  } catch (error) {
    styles.value = legacyFallback()
    ElMessage.error(error?.message || '画风库加载失败')
  } finally {
    loading.value = false
  }
}
function openPicker() {
  visible.value = true
  if (!styles.value.length) loadStyles()
}
function selectStyle(style) {
  emit('update:modelValue', style.id)
  emit('update:customPrompt', '')
  emit('change', style.id, style)
  detailVisible.value = false
  visible.value = false
}
function showDetail(style) {
  detailStyle.value = style
  detailVisible.value = true
}
async function createCustomStyle() {
  const value = customForm.value
  if (![value.labelZh, value.labelEn, value.descriptionZh, value.promptZh, value.promptEn].every((item) => item.trim())) {
    ElMessage.warning('请完整填写名称、说明和中英文提示词')
    return
  }
  savingCustom.value = true
  try {
    const style = await stylesAPI.create(value)
    styles.value.push(style)
    customVisible.value = false
    selectStyle(style)
    ElMessage.success('自定义画风已保存')
  } finally {
    savingCustom.value = false
  }
}

watch(() => props.modelValue, async (id) => {
  if (id && styles.value.length && !selectedStyle.value) await loadStyles()
})
onMounted(loadStyles)
</script>

<style scoped>
.style-picker-wrap { display: inline-block; width: 100%; }
.style-picker-trigger { width: 100%; min-width: 190px; height: 48px; padding: 5px 10px; display: flex; align-items: center; gap: 9px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-fill-color-blank); color: var(--el-text-color-placeholder); cursor: pointer; text-align: left; }
.style-picker-trigger:hover,.style-picker-trigger.has-value { border-color: var(--el-color-primary); }
.style-picker-trigger img,.trigger-swatch { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex: none; }
.trigger-copy { display: grid; min-width: 0; flex: 1; }.trigger-copy strong,.trigger-copy small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.trigger-copy strong { color: var(--el-text-color-primary); font-size: 13px; }.trigger-copy small { font-size: 11px; }
.library-toolbar,.dialog-footer,.custom-name-row { display: flex; align-items: center; gap: 12px; }.style-search { max-width: 430px; }.library-toolbar { justify-content: space-between; }
.category-tabs { display: flex; gap: 8px; margin: 16px 0; border-bottom: 1px solid var(--el-border-color-lighter); }.category-tabs button { padding: 9px 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--el-text-color-secondary); cursor: pointer; }.category-tabs button.active { color: var(--el-color-primary); border-color: var(--el-color-primary); }.category-tabs span { opacity: .65; }
.style-grid { min-height: 240px; max-height: 62vh; overflow: auto; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 14px; padding: 2px; }.style-card { min-width: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--el-fill-color-light); cursor: pointer; transition: .18s ease; }.style-card:hover { transform: translateY(-2px); box-shadow: var(--el-box-shadow-light); }.style-card.selected { border-color: var(--el-color-primary); }
.preview-frame { position: relative; aspect-ratio: 16/10; overflow: hidden; }.preview-frame img,.preview-fallback { width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center; color: white; font-weight: 700; }.selected-badge,.detail-button { position: absolute; top: 8px; border: 0; border-radius: 999px; color: white; }.selected-badge { left: 8px; padding: 3px 8px; background: var(--el-color-primary); font-size: 11px; }.detail-button { right: 8px; padding: 4px 9px; background: rgba(0,0,0,.55); cursor: pointer; }
.style-card-copy { padding: 10px; }.style-card-copy strong,.style-card-copy small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }.style-card-copy small { color: var(--el-text-color-secondary); margin-top: 2px; }.style-card-copy p { margin: 7px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; height: 3em; overflow: hidden; }
.dialog-footer { justify-content: space-between; color: var(--el-text-color-secondary); font-size: 12px; }.drawer-preview { width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 10px; }.drawer-en { color: var(--el-text-color-secondary); }.prompt-disclosure { margin-top: 18px; }.prompt-disclosure p { white-space: pre-wrap; line-height: 1.6; }.drawer-select { width: 100%; margin-top: 18px; }.custom-name-row > * { flex: 1; }
@media (max-width: 860px) { .style-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
