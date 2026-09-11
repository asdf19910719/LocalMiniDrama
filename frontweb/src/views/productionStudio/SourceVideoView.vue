<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes`)"><svg><use href="#i-back"/></svg></button>
      <h1>从已有视频开始剪辑</h1>
      <span class="sub">登记来源媒体 · 零生成 · 零费用 · 只读保护原文件</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">
      <div class="wsteps">
        <span v-for="(s, i) in ['选择目标集', '登记媒体', '完成']" :key="s" class="wstep" :class="{ on: phase === i, done: phase > i }">
          <span class="wn">{{ phase > i ? '✓' : i + 1 }}</span>{{ s }}
        </span>
      </div>

      <!-- 阶段 1：选择目标集 -->
      <div v-if="phase === 0" class="card pad" style="max-width:640px">
        <b style="font-size:14px">选择目标剧集</b>
        <p class="muted small" style="margin:8px 0 12px">登记后可直接进入该集成片页开始剪辑；不自动生成任何镜头。</p>
        <label class="col" style="gap:4px">
          <span class="xs muted">目标集（可为空白剧集或下一集）</span>
          <select class="input" style="width:100%" v-model="episodeId">
            <option :value="''" disabled>选择剧集…</option>
            <option v-for="ep in episodes" :key="ep.id" :value="ep.id">
              E{{ String(ep.episodeNumber).padStart(2, '0') }} · {{ ep.title || '未命名' }}{{ ep.isBlank ? '（空白）' : '' }}
            </option>
          </select>
        </label>
        <div class="row" style="margin-top:14px; justify-content:flex-end">
          <button class="btn primary" :disabled="!episodeId" @click="phase = 1">下一步</button>
        </div>
      </div>

      <!-- 阶段 2：登记媒体 -->
      <div v-else-if="phase === 1" class="card pad" style="max-width:760px">
        <b style="font-size:14px">登记来源视频</b>
        <p class="muted small" style="margin:8px 0 12px">支持本地路径或 URL。默认只读引用原文件：不复制、不转码、不删除原文件。</p>
        <label class="col" style="gap:4px; margin-bottom:10px">
          <span class="xs muted">媒体名称</span>
          <input class="input" style="width:100%" v-model="name" placeholder="如：原始拍摄素材-第 1 机位">
        </label>
        <label class="col" style="gap:4px; margin-bottom:10px">
          <span class="xs muted">本地路径</span>
          <input class="input" style="width:100%" v-model="localPath" placeholder="D:\footage\ep01.mp4">
        </label>
        <label class="col" style="gap:4px">
          <span class="xs muted">或 URL</span>
          <input class="input" style="width:100%" v-model="url" placeholder="https:// …">
        </label>
        <label class="row" style="margin-top:12px; gap:8px; align-items:flex-start">
          <input type="checkbox" v-model="licensed">
          <span class="xs" style="line-height:1.6">我确认拥有该素材的合法使用权，并理解原文件将被只读引用（许可确认）。</span>
        </label>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:8px">
          <button class="btn ghost" @click="phase = 0">上一步</button>
          <button class="btn primary" :disabled="!name.trim() || (!localPath.trim() && !url.trim()) || !licensed || registering" @click="register">
            {{ registering ? '登记中…' : '登记并进入成片页' }}
          </button>
        </div>
      </div>

      <!-- 阶段 3：完成 -->
      <div v-else class="card pad" style="max-width:640px">
        <div class="row" style="margin-bottom:10px">
          <span class="badge ok">已登记</span>
          <b style="font-size:14px">{{ name }}</b>
        </div>
        <p class="muted small">来源媒体已登记（零生成、零费用）。可直接进入短片时间线剪辑；原文件保持只读。</p>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:8px">
          <button class="btn" @click="$router.push(`/projects/${projectId}/episodes`)">返回剧集中心</button>
          <button class="btn primary" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/stage/cut`)">进入成片页</button>
        </div>
      </div>

      <p v-if="error" class="small" style="color:var(--danger)">{{ error }}</p>
    </div>
  </div>
</template>

<script>
import { v21 } from '../../v21/api.js'

export default {
  name: 'SourceVideoView',
  data() {
    return {
      phase: 0, episodes: [], episodeId: '',
      name: '', localPath: '', url: '', licensed: false,
      registering: false, error: '',
    }
  },
  computed: {
    projectId() {
      return this.$route.params.projectId
    },
  },
  async mounted() {
    try {
      const res = await v21.listEpisodes(this.projectId, {})
      this.episodes = (res.items || []).map((ep) => ({ ...ep, isBlank: ep.status === 'not_started' }))
      const blank = this.episodes.find((ep) => ep.isBlank)
      if (blank) this.episodeId = blank.id
    } catch {
      this.episodes = []
    }
  },
  methods: {
    async register() {
      this.registering = true
      this.error = ''
      try {
        await v21.registerSourceVideo(this.projectId, {
          episodeId: this.episodeId || null,
          name: this.name.trim(),
          localPath: this.localPath.trim() || null,
          url: this.url.trim() || null,
        })
        this.phase = 2
      } catch (err) {
        this.error = err.message || '登记失败'
      } finally {
        this.registering = false
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
</style>
