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

      <!-- 阶段 1：选择目标集（复用空白剧集 或 创建第 N 集，与剧集页新建口径一致） -->
      <div v-if="phase === 0" class="card pad" style="max-width:640px">
        <b style="font-size:14px">选择目标剧集</b>
        <p class="muted small" style="margin:8px 0 12px">登记后可直接进入该集成片页开始剪辑；不自动生成任何镜头。</p>
        <label class="col" style="gap:4px">
          <span class="xs muted">目标集（复用空白剧集，或创建下一集）</span>
          <select class="input" style="width:100%" v-model="targetChoice">
            <option value="" disabled>选择剧集…</option>
            <option value="create">{{ createOptionLabel }}</option>
            <option v-for="b in blankEpisodes" :key="b.id" :value="String(b.id)">
              复用 E{{ String(b.episodeNumber).padStart(2, '0') }} · {{ b.title || '未命名' }}（空白）
            </option>
          </select>
        </label>
        <div class="row" style="margin-top:14px; justify-content:flex-end">
          <button class="btn primary" :disabled="!targetChoice" @click="phase = 1">下一步</button>
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
        <label class="col" style="gap:4px; margin-bottom:10px">
          <span class="xs muted">或 URL</span>
          <input class="input" style="width:100%" v-model="url" placeholder="https:// …">
        </label>
        <div class="row" style="gap:10px; margin-bottom:10px">
          <label class="col" style="gap:4px; flex:1">
            <span class="xs muted">SHA-256（可选）</span>
            <input class="input" style="width:100%" v-model="sha256" placeholder="可留空；用于后续媒体一致性校验">
          </label>
          <label class="col" style="gap:4px" title="按 MB 填写，登记时换算为字节">
            <span class="xs muted">文件大小（MB，可选）</span>
            <input class="input" type="number" min="0" step="0.1" style="width:130px" v-model.number="fileSizeMb" placeholder="如：700">
          </label>
        </div>
        <label class="col" style="gap:4px">
          <span class="xs muted">媒体信息（可选）</span>
          <input class="input" style="width:100%" v-model="mediaInfo" placeholder="如：1920x1080 · 03:24 · H.264">
        </label>
        <label class="row" style="margin-top:12px; gap:8px; align-items:flex-start">
          <input type="checkbox" v-model="licensed">
          <span class="xs" style="line-height:1.6">我确认拥有该素材的合法使用权，并理解原文件将被只读引用（许可确认）。</span>
        </label>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:8px">
          <button class="btn ghost" @click="phase = 0">上一步</button>
          <button class="btn primary" :disabled="!name.trim() || (!localPath.trim() && !url.trim()) || !licensed || registering" @click="register">
            {{ registering ? '登记中…' : '完成登记' }}
          </button>
        </div>
      </div>

      <!-- 阶段 3：完成 -->
      <div v-else class="card pad" style="max-width:640px">
        <div class="row" style="margin-bottom:10px">
          <span class="badge ok">已登记</span>
          <b style="font-size:14px">{{ name }}</b>
        </div>
        <p class="muted small">已登记，请在成片页关联使用。来源媒体零生成、零费用；原文件保持只读。</p>
        <div class="row" style="margin-top:14px; justify-content:flex-end; gap:8px">
          <button class="btn" @click="$router.push(`/projects/${projectId}/episodes`)">返回剧集中心</button>
          <button class="btn primary" @click="$router.push(`/projects/${projectId}/episodes/${registeredEpisodeId}/cut`)">进入成片页</button>
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
      phase: 0,
      blankEpisodes: [], targetChoice: '', nextEpisodeNumber: null,
      name: '', localPath: '', url: '', licensed: false,
      sha256: '', fileSizeMb: null, mediaInfo: '',
      registering: false, error: '', registeredEpisodeId: null,
    }
  },
  computed: {
    projectId() {
      return this.$route.params.projectId
    },
    createOptionLabel() {
      return this.nextEpisodeNumber
        ? `创建第 ${this.nextEpisodeNumber} 集（空白草稿）`
        : '创建下一集（空白草稿）'
    },
  },
  async mounted() {
    // 与剧集页「新建剧集」选择器同口径：空白集复用 + 创建第 N 集（N = 最大集号 + 1）
    try {
      const [blanks, all] = await Promise.all([
        v21.listBlankEpisodes(this.projectId),
        v21.listEpisodes(this.projectId, { sort: 'episode' }),
      ])
      this.blankEpisodes = blanks.items || []
      this.nextEpisodeNumber = Math.max(0, ...(all.items || []).map((i) => Number(i.episodeNumber) || 0)) + 1
      this.targetChoice = 'create'
    } catch {
      this.nextEpisodeNumber = null
      this.targetChoice = 'create' // 列表失败时降级为服务端默认集号
    }
  },
  methods: {
    async register() {
      this.registering = true
      this.error = ''
      try {
        let targetEpisodeId = Number(this.targetChoice)
        if (this.targetChoice === 'create') {
          // 创建新集 = 先 createEpisode 再登记（集号冲突由服务端 409 拦截）
          const created = await v21.createEpisode(this.projectId, { episodeNumber: this.nextEpisodeNumber })
          targetEpisodeId = created.id
        }
        const res = await v21.registerSourceVideo(this.projectId, {
          episodeId: targetEpisodeId,
          name: this.name.trim(),
          localPath: this.localPath.trim() || null,
          url: this.url.trim() || null,
          sha256: this.sha256.trim() || null,
          fileSize: this.fileSizeMb ? Math.round(Number(this.fileSizeMb) * 1024 * 1024) : null,
          mediaInfo: this.mediaInfo.trim() || null,
        })
        this.registeredEpisodeId = res.episodeId
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
