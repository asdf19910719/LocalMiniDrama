<template>
  <el-drawer
    :model-value="visible"
    direction="rtl"
    size="min(880px, 96vw)"
    :with-header="false"
    class="character-variant-studio-drawer"
    @close="emit('close')"
  >
    <div v-if="activeVariant" class="variant-studio">
      <header class="variant-studio-header">
        <div class="variant-studio-heading">
          <el-icon><User /></el-icon>
          <div>
            <h2>{{ character?.name || '未命名人物' }} · {{ activeVariant.name || '未命名状态' }}</h2>
            <p>当前状态图被 {{ affectedStoryboards.length }} 个分镜明确引用</p>
          </div>
        </div>
        <el-button text circle aria-label="关闭人物状态工作台" @click="emit('close')"><el-icon><Close /></el-icon></el-button>
      </header>

      <div v-if="variants.length > 1" class="variant-switcher" aria-label="切换人物状态">
        <button
          v-for="variant in variants"
          :key="variant.id"
          type="button"
          class="variant-switcher-item"
          :class="{ active: Number(variant.id) === Number(activeVariant.id) }"
          @click="emit('select-variant', variant.id)"
        >
          <img v-if="assetImageUrl(variant)" :src="assetImageUrl(variant)" alt="" />
          <span v-else class="variant-switcher-empty"><el-icon><Picture /></el-icon></span>
          <span>{{ variant.name || '未命名' }}</span>
          <small v-if="variant.is_default">默认</small>
        </button>
      </div>

      <el-tabs v-model="activeTab" class="variant-studio-tabs">
        <el-tab-pane label="当前图与候选" name="candidates">
          <div class="variant-current-layout">
            <section class="variant-current-column">
              <button
                type="button"
                class="variant-current-image"
                :class="{ empty: !currentImageUrl }"
                :disabled="!currentImageUrl"
                @click="currentImageUrl && emit('preview', currentImageUrl)"
              >
                <img v-if="currentImageUrl" :src="currentImageUrl" :alt="`${activeVariant.name || '人物状态'}当前图`" />
                <span v-else><el-icon><Picture /></el-icon>暂无状态图</span>
                <em v-if="currentImageUrl">当前状态图</em>
              </button>
              <div class="variant-current-meta">
                <strong>{{ activeVariant.name || '未命名状态' }}</strong>
                <span>{{ activeVariant.is_default ? '默认状态' : '独立状态' }}</span>
              </div>
              <div class="identity-reference-card">
                <img v-if="identityImageUrl" :src="identityImageUrl" alt="角色身份参考图" />
                <span v-else class="identity-reference-empty"><el-icon><User /></el-icon></span>
                <div>
                  <strong>身份参考：{{ character?.name || '未命名人物' }}</strong>
                  <p>只锁定脸部、年龄和体型；基础人物图不会覆盖当前状态图。</p>
                </div>
              </div>
            </section>

            <section class="variant-candidate-column">
              <div class="variant-prompt-head">
                <label>状态生图提示词</label>
                <span>身份图自动作为角色参考</span>
              </div>
              <el-input
                :model-value="activeVariant.image_prompt || activeVariant.appearance || ''"
                type="textarea"
                :rows="4"
                readonly
                placeholder="请先在状态设定中填写生图提示词"
              />
              <div class="variant-generate-row">
                <ImageGenerateSplitButton
                  :default-channel="defaultChannel"
                  :loading="Number(generatingVariantId) === Number(activeVariant.id)"
                  @select-channel="(channel) => emit('select-channel', channel)"
                  @generate="() => emit('generate', activeVariant)"
                />
                <el-button @click="emit('edit', activeVariant)"><el-icon><Edit /></el-icon>编辑设定</el-button>
              </div>

              <div class="variant-candidate-heading">
                <strong>候选历史</strong>
                <span>{{ candidates.length }} 张</span>
              </div>
              <div v-if="candidates.length" class="variant-candidate-grid">
                <button
                  v-for="candidate in candidates"
                  :key="candidate.key"
                  type="button"
                  class="variant-candidate-card"
                  :class="{ selected: candidate.path === selectedCandidatePath }"
                  :aria-pressed="candidate.path === selectedCandidatePath"
                  @click="selectedCandidatePath = candidate.path"
                >
                  <img :src="assetImageUrl(candidate.path)" :alt="candidate.label" />
                  <span>{{ candidate.label }}</span>
                  <em v-if="candidate.is_current">当前</em>
                </button>
              </div>
              <el-empty v-else :image-size="72" description="生成后会在这里保留候选历史" />
              <div class="variant-candidate-actions">
                <p>{{ selectedCandidateDescription }}</p>
                <el-button
                  type="primary"
                  :loading="Number(candidateSettingId) === Number(activeVariant.id)"
                  :disabled="!selectedCandidatePath || selectedCandidatePath === currentCandidatePath"
                  @click="emit('choose-candidate', activeVariant, selectedCandidatePath)"
                >设为当前状态图</el-button>
              </div>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane name="impact">
          <template #label><span>影响的分镜 <el-badge :value="affectedStoryboards.length" :hidden="!affectedStoryboards.length" /></span></template>
          <div class="variant-impact-panel">
            <el-alert
              type="info"
              :closable="false"
              title="状态图与基础人物图分别管理"
              description="更新状态图只影响后续使用该状态生成的画面；已经生成的分镜图不会被静默替换，可在确认后单独重生。"
              show-icon
            />
            <div v-if="affectedStoryboards.length" class="variant-impact-list">
              <button
                v-for="storyboard in affectedStoryboards"
                :key="storyboard.id"
                type="button"
                class="variant-impact-chip"
                @click="emit('storyboard', storyboard.id)"
              >#{{ storyboard.storyboard_number || storyboard.id }}<span>{{ storyboard.title || '分镜' }}</span></button>
            </div>
            <el-empty v-else :image-size="84" description="当前状态尚未被任何分镜引用" />
            <div v-if="affectedStoryboards.length" class="variant-impact-actions">
              <span>共 {{ affectedStoryboards.length }} 个已有分镜</span>
              <el-button type="primary" plain :loading="regenerating" @click="emit('regenerate', activeVariant, affectedStoryboards)">重新生成这些分镜图</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="状态设定" name="settings">
          <div class="variant-settings-panel">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="状态名称">{{ activeVariant.name || '未命名' }}</el-descriptions-item>
              <el-descriptions-item label="外观描述">{{ activeVariant.appearance || '未填写' }}</el-descriptions-item>
              <el-descriptions-item label="负向提示词">{{ activeVariant.negative_prompt || '未填写' }}</el-descriptions-item>
              <el-descriptions-item label="默认状态">{{ activeVariant.is_default ? '是' : '否' }}</el-descriptions-item>
            </el-descriptions>
            <div class="variant-settings-actions">
              <el-button type="primary" @click="emit('edit', activeVariant)"><el-icon><Edit /></el-icon>编辑状态设定</el-button>
              <el-button
                :loading="Number(defaultSettingId) === Number(activeVariant.id)"
                :disabled="!!activeVariant.is_default"
                @click="emit('set-default', activeVariant)"
              ><el-icon><StarFilled /></el-icon>设为默认状态</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <el-empty v-else description="人物状态不存在" />
  </el-drawer>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Close, Edit, Picture, StarFilled, User } from '@element-plus/icons-vue'
import ImageGenerateSplitButton from '@/components/imageGeneration/ImageGenerateSplitButton.vue'
import { assetImageUrl } from '@/utils/mediaUrl'
import { buildVariantImageCandidates, findVariantAffectedStoryboards } from '@/utils/characterVariantStudio'

const props = defineProps({
  visible: Boolean,
  character: { type: Object, default: null },
  variants: { type: Array, default: () => [] },
  activeVariantId: { type: [Number, String], default: null },
  storyboards: { type: Array, default: () => [] },
  defaultChannel: { type: String, default: 'api' },
  generatingVariantId: { type: [Number, String], default: null },
  defaultSettingId: { type: [Number, String], default: null },
  candidateSettingId: { type: [Number, String], default: null },
  regenerating: Boolean,
})
const emit = defineEmits([
  'close', 'select-variant', 'generate', 'edit', 'set-default', 'choose-candidate',
  'preview', 'storyboard', 'regenerate', 'select-channel',
])

const activeTab = ref('candidates')
const selectedCandidatePath = ref('')
const activeVariant = computed(() => props.variants.find((variant) => Number(variant.id) === Number(props.activeVariantId)) || props.variants[0] || null)
const candidates = computed(() => buildVariantImageCandidates(activeVariant.value))
const currentCandidatePath = computed(() => candidates.value.find((candidate) => candidate.is_current)?.path || '')
const currentImageUrl = computed(() => activeVariant.value ? assetImageUrl(activeVariant.value) : '')
const identityImageUrl = computed(() => props.character ? assetImageUrl(props.character) : '')
const affectedStoryboards = computed(() => findVariantAffectedStoryboards(props.storyboards, activeVariant.value?.id))
const selectedCandidateDescription = computed(() => {
  if (!selectedCandidatePath.value) return '选择一张候选图查看操作'
  if (selectedCandidatePath.value === currentCandidatePath.value) return '这张图正在作为当前状态图使用'
  return '确认后立即覆盖状态展示，旧图会保留在候选历史'
})

watch([activeVariant, candidates], () => {
  selectedCandidatePath.value = currentCandidatePath.value
  activeTab.value = 'candidates'
}, { immediate: true })
</script>

<style scoped>
.variant-studio { min-height: 100%; background: var(--el-bg-color); color: var(--el-text-color-primary); }
.variant-studio-header { min-height: 70px; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.variant-studio-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.variant-studio-heading > .el-icon { color: var(--el-color-primary); font-size: 22px; flex: 0 0 auto; }
.variant-studio-heading h2 { margin: 0 0 4px; font-size: 18px; line-height: 1.25; }
.variant-studio-heading p { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }
.variant-switcher { display: flex; gap: 8px; overflow-x: auto; padding: 12px 20px 2px; }
.variant-switcher-item { min-width: 132px; max-width: 180px; display: grid; grid-template-columns: 38px 1fr; grid-template-rows: auto auto; gap: 2px 8px; align-items: center; padding: 6px; border: 1px solid var(--el-border-color); border-radius: 9px; background: var(--el-fill-color-blank); color: inherit; text-align: left; cursor: pointer; }
.variant-switcher-item.active { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }
.variant-switcher-item img,.variant-switcher-empty { grid-row: 1 / 3; width: 38px; height: 50px; object-fit: cover; border-radius: 5px; background: var(--el-fill-color); display: grid; place-items: center; }
.variant-switcher-item span:not(.variant-switcher-empty) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; }
.variant-switcher-item small { color: var(--el-color-success); }
.variant-studio-tabs { padding: 0 20px 24px; }
.variant-current-layout { display: grid; grid-template-columns: minmax(250px, 310px) 1fr; gap: 28px; padding-top: 4px; }
.variant-current-image { position: relative; width: 100%; aspect-ratio: 3 / 4; padding: 0; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-light); cursor: zoom-in; }
.variant-current-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.variant-current-image.empty { display: grid; place-items: center; color: var(--el-text-color-placeholder); cursor: default; }
.variant-current-image.empty span { display: grid; justify-items: center; gap: 8px; }
.variant-current-image.empty .el-icon { font-size: 38px; }
.variant-current-image em { position: absolute; left: 10px; bottom: 10px; padding: 5px 8px; border-radius: 6px; background: rgba(0,0,0,.68); color: #fff; font-size: 11px; font-style: normal; }
.variant-current-meta { display: flex; align-items: center; justify-content: space-between; padding: 9px 0 12px; font-size: 12px; }
.variant-current-meta span { color: var(--el-color-success); }
.identity-reference-card { display: grid; grid-template-columns: 58px 1fr; gap: 10px; padding: 9px; border-radius: 9px; background: var(--el-color-primary-light-9); }
.identity-reference-card img,.identity-reference-empty { width: 58px; height: 74px; object-fit: cover; border-radius: 6px; background: var(--el-fill-color); display: grid; place-items: center; }
.identity-reference-card strong { font-size: 12px; }
.identity-reference-card p { margin: 7px 0 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.55; }
.variant-prompt-head,.variant-candidate-heading,.variant-candidate-actions,.variant-impact-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.variant-prompt-head { margin-bottom: 7px; font-size: 12px; }
.variant-prompt-head label,.variant-candidate-heading strong { font-weight: 650; }
.variant-prompt-head span,.variant-candidate-heading span { color: var(--el-text-color-secondary); }
.variant-generate-row { display: flex; gap: 8px; margin: 12px 0 18px; }
.variant-candidate-heading { margin-bottom: 9px; font-size: 12px; }
.variant-candidate-grid { display: grid; grid-template-columns: repeat(4, minmax(76px, 1fr)); gap: 8px; }
.variant-candidate-card { position: relative; padding: 5px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-fill-color-blank); color: inherit; cursor: pointer; text-align: left; }
.variant-candidate-card.selected { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }
.variant-candidate-card img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 5px; display: block; }
.variant-candidate-card span { display: block; margin-top: 5px; overflow: hidden; color: var(--el-text-color-regular); font-size: 10px; white-space: nowrap; text-overflow: ellipsis; }
.variant-candidate-card em { position: absolute; left: 9px; top: 9px; padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,.7); color: #fff; font-size: 9px; font-style: normal; }
.variant-candidate-actions { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); }
.variant-candidate-actions p { margin: 0; color: var(--el-text-color-secondary); font-size: 11px; }
.variant-impact-panel,.variant-settings-panel { padding-top: 4px; }
.variant-impact-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
.variant-impact-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--el-border-color); border-radius: 999px; background: var(--el-fill-color-light); color: var(--el-color-primary); cursor: pointer; }
.variant-impact-chip span { max-width: 130px; overflow: hidden; color: var(--el-text-color-secondary); white-space: nowrap; text-overflow: ellipsis; }
.variant-impact-actions { padding-top: 14px; border-top: 1px solid var(--el-border-color-lighter); font-size: 12px; }
.variant-settings-actions { display: flex; gap: 10px; margin-top: 18px; }
@media (max-width: 720px) {
  .variant-studio-header,.variant-switcher,.variant-studio-tabs { padding-left: 14px; padding-right: 14px; }
  .variant-current-layout { grid-template-columns: 1fr; gap: 20px; }
  .variant-current-image { max-width: 300px; margin: 0 auto; display: block; }
  .variant-candidate-grid { grid-template-columns: repeat(2, minmax(90px, 1fr)); }
  .variant-candidate-actions { align-items: flex-start; flex-direction: column; }
}
</style>
