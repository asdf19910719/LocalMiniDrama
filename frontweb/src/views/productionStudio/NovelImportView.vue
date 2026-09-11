<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes`)"><svg><use href="#i-back"/></svg></button>
      <h1>小说 / 长文本拆集</h1>
      <span class="sub">按章节解析 · 建议集号 · 逐集创建草稿（零媒体任务）</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">
      <div class="wsteps">
        <span v-for="(s, i) in ['粘贴文本', '预览章节', '拆集结果']" :key="s" class="wstep" :class="{ on: phase === i, done: phase > i }">
          <span class="wn">{{ phase > i ? '✓' : i + 1 }}</span>{{ s }}
        </span>
      </div>

      <!-- 阶段 1：粘贴/上传文本 -->
      <div v-if="phase === 0" class="card pad" style="max-width:760px">
        <b style="font-size:14px">粘贴小说或长文本</b>
        <p class="muted small" style="margin:8px 0 12px">识别「第 N 章 / 第 N 节 / Chapter N / 【标题】」等常见章节格式；未识别到章节时整篇作为单章。</p>
        <input type="file" accept=".txt,.md" class="input" style="width:100%; padding:8px" @change="onFile">
        <textarea class="input" v-model="text" rows="12" style="width:100%; margin-top:10px; font-family:inherit; line-height:1.7" placeholder="粘贴小说文本…"></textarea>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:10px">
          <label class="xs muted">起始集号 <input class="input" type="number" v-model.number="startNumber" min="1" style="width:76px; margin-left:6px"></label>
          <button class="btn primary" :disabled="!text.trim() || parsing" @click="preview">{{ parsing ? '解析中…' : '解析章节' }}</button>
        </div>
      </div>

      <!-- 阶段 2：预览章节 -->
      <div v-else-if="phase === 1" class="card pad" style="max-width:860px">
        <div class="row" style="margin-bottom:10px">
          <b style="font-size:14px">章节预览</b>
          <span class="chip">共 {{ preview.chapterCount }} 章 · 拆为 {{ preview.suggestedEpisodes }} 集</span>
          <span class="chip" v-if="preview.existingEpisodes">现有 {{ preview.existingEpisodes }} 集</span>
          <div class="spacer"></div>
          <span class="badge warn" v-if="conflictCount">{{ conflictCount }} 个建议集号冲突</span>
        </div>
        <div class="ch-row" v-for="c in preview.preview" :key="c.index">
          <span class="badge" :class="c.conflict ? 'warn' : 'outline'">E{{ String(c.suggestedEpisodeNumber).padStart(2, '0') }}{{ c.conflict ? ' · 冲突' : '' }}</span>
          <b class="ellipsis grow">{{ c.title }}</b>
          <span class="xs muted">{{ c.chars }} 字</span>
        </div>
        <p class="xs muted" style="margin-top:10px">冲突集号会被跳过并提示原因；确认后逐集创建草稿剧集与剧本草稿，全程零媒体任务。</p>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:8px">
          <button class="btn ghost" @click="phase = 0">上一步</button>
          <button class="btn primary" :disabled="importing" @click="confirm">{{ importing ? '创建中…' : `确认拆集（${preview.suggestedEpisodes} 集）` }}</button>
        </div>
      </div>

      <!-- 阶段 3：结果 -->
      <div v-else class="card pad" style="max-width:760px">
        <div class="row" style="margin-bottom:10px">
          <span class="badge ok">完成</span>
          <b style="font-size:14px">已创建 {{ result.episodes.length }} 集草稿</b>
          <template v-if="result.skipped.length">
            <span class="badge warn">跳过 {{ result.skipped.length }}</span>
          </template>
        </div>
        <div class="ch-row" v-for="ep in result.episodes" :key="ep.episodeId">
          <span class="badge outline">E{{ String(ep.episodeNumber).padStart(2, '0') }}</span>
          <b class="ellipsis grow">{{ ep.title }}</b>
          <button class="btn sm" @click="$router.push(`/projects/${projectId}/episodes/${ep.episodeId}/stage/script`)">打开剧本</button>
        </div>
        <div class="ch-row" v-for="s in result.skipped" :key="'s' + s.index">
          <span class="badge warn">跳过</span>
          <span class="ellipsis grow">{{ s.title }} · {{ s.reason }}</span>
        </div>
        <div class="row" style="margin-top:14px; justify-content:flex-end">
          <button class="btn primary" @click="$router.push(`/projects/${projectId}/episodes`)">返回剧集中心</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { v21 } from '../../v21/api.js'

export default {
  name: 'NovelImportView',
  data() {
    return {
      phase: 0, text: '', startNumber: 1, parsing: false, importing: false,
      preview: null, result: null, error: '',
    }
  },
  computed: {
    projectId() {
      return this.$route.params.projectId
    },
    conflictCount() {
      return (this.preview?.preview || []).filter((c) => c.conflict).length
    },
  },
  methods: {
    onFile(event) {
      const file = event.target.files && event.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => { this.text = String(reader.result || '') }
      reader.readAsText(file)
    },
    async preview() {
      this.parsing = true
      this.error = ''
      try {
        this.preview = await v21.previewNovelSplit(this.projectId, {
          text: this.text,
          maxChapters: 20,
          startNumber: this.startNumber,
        })
        this.phase = 1
      } catch (err) {
        this.error = err.message || '解析失败'
      } finally {
        this.parsing = false
      }
    },
    async confirm() {
      this.importing = true
      this.error = ''
      try {
        this.result = await v21.confirmNovelSplit(this.projectId, {
          text: this.text,
          maxChapters: 20,
          startNumber: this.startNumber,
        })
        this.phase = 2
      } catch (err) {
        this.error = err.message || '拆集失败'
      } finally {
        this.importing = false
      }
    },
  },
}
</script>

<style scoped>
.wsteps { display: flex; align-items: center; gap: 14px; padding: 4px 2px; }
.wstep { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.wstep .wn { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; }
.wstep.on { color: #fff; font-weight: 600; }
.wstep.on .wn { background: var(--accent); border-color: var(--accent); color: #fff; }
.wstep.done { color: var(--ok); }
.wstep.done .wn { background: var(--ok-subtle); border-color: var(--ok); color: var(--ok); }
.ch-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
textarea.input { resize: vertical; }
</style>
