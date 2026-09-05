<template>
  <section v-if="episodeId" class="section card audio-plan-panel">
    <div class="audio-plan-header">
      <div>
        <h2 class="section-title">剧集音频策略</h2>
        <small>控制 H3 每段原生音频、整集配乐与后期对白/旁白的唯一归属</small>
      </div>
      <div>
        <el-button :loading="planning" @click="planWithAI">AI 规划每段配乐</el-button>
        <el-button @click="restoreEpisodeAI">恢复 AI 管理</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存音频策略</el-button>
      </div>
    </div>
    <el-form label-width="118px" class="audio-plan-form">
      <el-form-item label="背景音乐模式">
        <el-radio-group v-model="model.bgm.mode" @change="markChanged">
          <el-radio-button value="none">不生成 BGM</el-radio-button>
          <el-radio-button value="episode_track">整集一条 BGM</el-radio-button>
          <el-radio-button value="per_segment">每段视频生成 BGM</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="配乐描述">
        <el-input v-model="model.bgm.prompt" type="textarea" :rows="2" @input="markChanged" />
      </el-form-item>
      <el-form-item label="主题连续键">
        <el-input v-model="model.bgm.continuity_key" placeholder="例如 episode_main_theme" @input="markChanged" />
      </el-form-item>
      <el-form-item v-if="model.bgm.mode === 'episode_track'" label="BGM 媒体路径">
        <el-input v-model="model.bgm.local_path" placeholder="项目媒体目录内的相对路径" @input="markChanged" />
      </el-form-item>
      <div class="audio-plan-grid">
        <el-form-item label="配乐音量 dB"><el-input-number v-model="model.bgm.volume_db" :min="-60" :max="0" @change="markChanged" /></el-form-item>
        <el-form-item label="对白压低 dB"><el-input-number v-model="model.bgm.ducking_db" :min="-30" :max="0" @change="markChanged" /></el-form-item>
        <el-form-item label="淡入 ms"><el-input-number v-model="model.bgm.fade_in_ms" :min="0" @change="markChanged" /></el-form-item>
        <el-form-item label="淡出 ms"><el-input-number v-model="model.bgm.fade_out_ms" :min="0" @change="markChanged" /></el-form-item>
        <el-form-item label="段间交叉淡化"><el-input-number v-model="model.bgm.crossfade_ms" :min="0" @change="markChanged" /></el-form-item>
      </div>
      <div class="audio-plan-grid">
        <el-form-item label="对白归属">
          <el-select v-model="model.speech.dialogue_owner" @change="markChanged">
            <el-option label="H3 原生对白" value="h3_native" /><el-option label="后期 TTS" value="post_tts" /><el-option label="无对白" value="none" />
          </el-select>
        </el-form-item>
        <el-form-item label="旁白归属">
          <el-select v-model="model.speech.narration_owner" @change="markChanged">
            <el-option label="H3 原生旁白" value="h3_native" /><el-option label="后期 TTS" value="post_tts" /><el-option label="无旁白" value="none" />
          </el-select>
        </el-form-item>
      </div>
      <div class="audio-plan-grid">
        <el-form-item label="目标响度 LUFS"><el-input-number v-model="model.mastering.target_lufs" :min="-30" :max="-5" @change="markChanged" /></el-form-item>
        <el-form-item label="真峰值 dB"><el-input-number v-model="model.mastering.true_peak_db" :min="-6" :max="0" :step="0.1" @change="markChanged" /></el-form-item>
      </div>
    </el-form>
    <el-alert v-if="dirty" type="warning" :closable="false" title="音频策略已修改；保存后现有 H3 草稿会标记为来源已变化。" />
    <el-collapse v-if="storyboards.length" class="shot-audio-list">
      <el-collapse-item v-for="shot in storyboards" :key="shot.id" :title="`分镜 ${shot.storyboard_number || shot.id} 音频`">
        <el-form v-if="shotModels[shot.id]" label-width="92px" size="small">
          <el-form-item label="环境声"><el-input v-model="shotModels[shot.id].ambience" placeholder="多个项目用逗号分隔" /></el-form-item>
          <el-form-item label="动作音效"><el-input v-model="shotModels[shot.id].sound_effects" placeholder="多个项目用逗号分隔" /></el-form-item>
          <el-form-item label="剧情内音乐"><el-input v-model="shotModels[shot.id].diegetic_music" placeholder="例如收音机播放的旧爵士乐；留空表示无" /></el-form-item>
          <el-form-item label="对白处理"><el-input v-model="shotModels[shot.id].dialogue_treatment" placeholder="例如贴近收音、压低耳语、保留喘息" /></el-form-item>
          <el-form-item label="本镜静音"><el-switch v-model="shotModels[shot.id].silence" /></el-form-item>
          <el-form-item label="段内配乐">
            <el-select v-model="shotModels[shot.id].music_cue.mode"><el-option label="继承整集主题" value="inherit" /><el-option label="覆盖" value="override" /><el-option label="静音" value="mute" /><el-option label="短促点缀" value="stinger" /></el-select>
          </el-form-item>
          <el-form-item label="配乐描述"><el-input v-model="shotModels[shot.id].music_cue.prompt" /></el-form-item>
          <el-form-item label="强度"><el-slider v-model="shotModels[shot.id].music_cue.intensity" :min="0" :max="1" :step="0.1" /></el-form-item>
          <div class="audio-plan-grid">
            <el-form-item label="本镜对白归属">
              <el-select v-model="shotModels[shot.id].speech_override.dialogue_owner">
                <el-option label="继承剧集" :value="null" /><el-option label="H3 原生" value="h3_native" /><el-option label="后期 TTS" value="post_tts" /><el-option label="无对白" value="none" />
              </el-select>
            </el-form-item>
            <el-form-item label="本镜旁白归属">
              <el-select v-model="shotModels[shot.id].speech_override.narration_owner">
                <el-option label="继承剧集" :value="null" /><el-option label="H3 原生" value="h3_native" /><el-option label="后期 TTS" value="post_tts" /><el-option label="无旁白" value="none" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item>
            <el-button type="primary" @click="saveShot(shot)">保存分镜音频</el-button>
            <el-button @click="restoreAI(shot)">恢复 AI 管理</el-button>
            <el-tag v-if="hasManualLock(shot)" type="warning" effect="plain">包含人工锁定字段</el-tag>
          </el-form-item>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { episodeAudioAPI } from '@/api/episodeAudio'
import { storyboardsAPI } from '@/api/storyboards'

const props = defineProps({ episodeId: [String, Number], audioPlan: Object, storyboards: { type: Array, default: () => [] } })
const emit = defineEmits(['updated', 'h3-stale', 'edit-shot'])
const saving = ref(false)
const planning = ref(false)
const dirty = ref(false)
const shotModels = reactive({})
const defaults = () => ({
  version: 1,
  bgm: { mode: 'none', prompt: null, planning: 'manual', continuity_key: null, source_type: 'none', local_path: null, volume_db: -22, ducking_db: -8, fade_in_ms: 800, fade_out_ms: 1200, crossfade_ms: 500 },
  mastering: { target_lufs: -14, true_peak_db: -1 },
  speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' },
})
const model = reactive(defaults())

function reset(value) {
  const next = { ...defaults(), ...(value || {}) }
  next.bgm = { ...defaults().bgm, ...(value?.bgm || {}) }
  next.speech = { ...defaults().speech, ...(value?.speech || {}) }
  next.mastering = { ...defaults().mastering, ...(value?.mastering || {}) }
  Object.assign(model, next)
  dirty.value = false
}
watch(() => [props.episodeId, props.audioPlan], ([, plan]) => reset(plan), { immediate: true, deep: true })
watch(() => props.storyboards, (shots) => {
  for (const shot of shots || []) {
    const audio = shot.audio_description || {}
    shotModels[shot.id] = {
      ambience: (audio.ambience || []).join(', '),
      sound_effects: (audio.sound_effects || []).join(', '),
      diegetic_music: audio.diegetic_music || '',
      dialogue_treatment: audio.dialogue_treatment || '',
      silence: audio.silence === true,
      music_cue: { mode: 'mute', prompt: null, intensity: 0, ...(audio.music_cue || {}) },
      speech_override: { dialogue_owner: null, narration_owner: null, ...(audio.speech_override || {}) },
    }
  }
}, { immediate: true, deep: true })
function markChanged() { dirty.value = true }
function splitList(value) { return String(value || '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean) }
function hasManualLock(shot) {
  const state = shot?.production_metadata?.field_state || {}
  return Object.entries(state).some(([key, value]) => key.startsWith('audio_description.') && value?.locked)
}
async function saveShot(shot) {
  const value = shotModels[shot.id]
  const updated = await storyboardsAPI.update(shot.id, {
    audio_description: {
      ambience: splitList(value.ambience),
      sound_effects: splitList(value.sound_effects),
      diegetic_music: value.diegetic_music?.trim() || null,
      dialogue_treatment: value.dialogue_treatment?.trim() || null,
      silence: value.silence,
      music_cue: value.music_cue,
      speech_override: value.speech_override,
    },
  })
  emit('updated', { storyboards: props.storyboards.map((item) => item.id === shot.id ? updated : item) })
  emit('h3-stale', { episodeId: props.episodeId, storyboardId: shot.id })
  ElMessage.success('分镜音频已保存')
}
async function restoreAI(shot) {
  const fields = Object.entries(shot?.production_metadata?.field_state || {})
    .filter(([key, value]) => key.startsWith('audio_description.') && value?.locked)
    .map(([key]) => key)
  if (!fields.length) return
  const updated = await storyboardsAPI.update(shot.id, { unlock_fields: fields })
  emit('updated', { storyboards: props.storyboards.map((item) => item.id === shot.id ? updated : item) })
  ElMessage.success('已恢复 AI 管理')
}

async function save() {
  saving.value = true
  try {
    const result = await episodeAudioAPI.updatePlan(props.episodeId, JSON.parse(JSON.stringify(model)))
    reset(result?.episode?.audio_plan || model)
    emit('updated', result)
    emit('h3-stale', { episodeId: props.episodeId })
    ElMessage.success('剧集音频策略已保存')
  } finally { saving.value = false }
}

async function restoreEpisodeAI() {
  saving.value = true
  try {
    const result = await episodeAudioAPI.updatePlan(props.episodeId, JSON.parse(JSON.stringify(model)), [
      'bgm.prompt', 'bgm.continuity_key',
    ])
    reset(result?.episode?.audio_plan || model)
    emit('updated', result)
    emit('h3-stale', { episodeId: props.episodeId })
    ElMessage.success('剧集配乐描述已恢复 AI 管理')
  } finally { saving.value = false }
}

async function planWithAI() {
  model.bgm.mode = 'per_segment'
  model.bgm.planning = 'ai'
  await save()
  planning.value = true
  try {
    const result = await episodeAudioAPI.planWithAI(props.episodeId)
    reset(result?.episode?.audio_plan || result?.audio_plan)
    emit('updated', result)
    emit('h3-stale', { episodeId: props.episodeId })
    ElMessage.success('每段配乐规划已更新')
  } finally { planning.value = false }
}
</script>

<style scoped>
.audio-plan-header,.audio-plan-grid{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}.audio-plan-grid>*{flex:1}.audio-plan-form{margin-top:16px}.shot-audio-list{margin-top:14px}.shot-audio-list pre{white-space:pre-wrap;margin:0 0 8px;font-size:12px}
</style>
