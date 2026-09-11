<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>导入项目归档</h1>
      <span class="sub">三阶段向导 · 只创建新项目，永不覆盖已有项目</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">
      <div class="wsteps">
        <span v-for="(s, i) in ['选择归档', '校验并确认', '导入结果']" :key="s" class="wstep" :class="{ on: phase === i, done: phase > i }">
          <span class="wn">{{ phase > i ? '✓' : i + 1 }}</span>{{ s }}
        </span>
      </div>

      <!-- 阶段 1：选择归档 -->
      <div v-if="phase === 0" class="card pad" style="max-width:640px">
        <b style="font-size:14px">选择项目归档文件</b>
        <p class="muted small" style="margin:8px 0 14px">只接受 LocalMiniDrama 项目归档（.zip）。导入会创建新项目；导入不覆盖现有项目。</p>
        <input type="file" accept=".zip" class="input" style="width:100%; padding:8px" @change="onFile">
        <div v-if="file" class="kv" style="margin-top:12px"><span class="k">文件</span><span class="v">{{ file.name }} · {{ (file.size / 1048576).toFixed(1) }} MB</span></div>
        <label class="col" style="gap:4px; margin-top:12px">
          <span class="xs muted">归档本地路径（校验用 · 服务与本应用同机时可直接粘贴 .zip 完整路径）</span>
          <input class="input" style="width:100%" v-model="localPath" placeholder="例如 D:\backup\我的项目.zip">
        </label>
        <p v-if="validateError" class="small" style="color:var(--danger); margin-top:10px">
          <svg style="width:12px;height:12px;vertical-align:-1px"><use href="#i-warn"/></svg>
          校验失败：{{ validateError }} <span class="act" style="color:var(--accent); cursor:pointer" @click="validate">重试</span>
        </p>
        <div class="row" style="margin-top:16px; justify-content:flex-end">
          <button class="btn primary" :disabled="!localPath || validating" @click="validate">{{ validating ? '校验中…' : '校验并确认' }}</button>
        </div>
      </div>

      <!-- 阶段 2：校验并确认（真实校验结果：检查矩阵 + 概要指标） -->
      <div v-else-if="phase === 1" class="card pad" style="max-width:760px">
        <b style="font-size:14px">校验并确认</b>

        <!-- unsupported：如实呈现归档版本，不伪装通过 -->
        <div v-if="validateResult && validateResult.overall === 'unsupported'" class="notice-strip warn" style="margin-top:10px">
          <svg style="width:14px;height:14px"><use href="#i-warn"/></svg>
          <span>检测到归档版本 v{{ validateResult.archiveVersion || '?' }}，当前仅支持 {{ validateResult.supportedVersion }}；以下检查结果仅供参考，继续导入可能出现字段缺失。</span>
          <div class="spacer"></div>
          <button class="btn sm" @click="phase = 0">重新选择</button>
        </div>

        <div class="grid-2" style="margin-top:14px">
          <div class="col" style="gap:4px">
            <div v-for="c in validateResult?.checks || []" :key="c.id" class="ck-row">
              <svg :style="{ color: checkColor(c.status) }"><use :href="checkIcon(c.status)"/></svg>
              <span>{{ c.label }} · {{ checkStatusLabel(c.status) }}<template v-if="c.detail"> — {{ c.detail }}</template></span>
            </div>
          </div>
          <div class="col" style="gap:12px">
            <div class="col" style="gap:2px">
              <div class="kv"><span class="k">项目名</span><span class="v">{{ validateResult?.summary?.projectName || '—' }}</span></div>
              <div class="kv"><span class="k">剧集数</span><span class="v">{{ validateResult?.summary?.episodeCount ?? '—' }}</span></div>
              <div class="kv"><span class="k">媒体文件数</span><span class="v">{{ validateResult?.summary?.mediaCount ?? '—' }}</span></div>
              <div class="kv"><span class="k">预计大小</span><span class="v">{{ formatBytes(validateResult?.summary?.estimatedSizeBytes) }}</span></div>
            </div>
            <label class="col" style="gap:4px"><span class="xs muted">最终项目名称</span>
              <input class="input" style="width:100%" v-model="finalName">
            </label>
            <label class="col" style="gap:4px"><span class="xs muted">媒体策略</span>
              <select class="input" style="width:100%"><option>复制媒体到项目目录</option><option>引用原路径</option></select>
            </label>
          </div>
        </div>
        <div class="divider"></div>
        <div class="xs muted" style="line-height:1.7">
          导入不覆盖现有项目：导入总是创建新项目，已有项目不受影响。确认导入前请核对最终项目名称；历史任务只恢复为只读记录，绝不自动重新执行或调用 Provider。多 GB 归档导入为持久化本地任务，可离页恢复。
        </div>
        <div class="row" style="margin-top:16px; justify-content:flex-end; gap:8px">
          <button class="btn ghost" @click="phase = 0">上一步</button>
          <button class="btn primary" :disabled="importing || !file" :title="file ? '' : '请返回上一步选择归档文件（导入走文件上传）'" @click="doImport">{{ importing ? '导入中…' : '仍然导入为新项目' }}</button>
        </div>
        <p v-if="!file" class="xs muted" style="margin-top:8px; text-align:right">校验只需归档本地路径；执行导入需在第一阶段选择归档文件。</p>
      </div>

      <!-- 阶段 3：导入结果 -->
      <div v-else class="card pad" style="max-width:640px; text-align:center; padding:40px">
        <svg v-if="!error" style="width:40px;height:40px;color:var(--ok);margin:0 auto"><use href="#i-check-c"/></svg>
        <svg v-else style="width:40px;height:40px;color:var(--danger);margin:0 auto"><use href="#i-warn"/></svg>
        <h3 style="margin:12px 0 6px; font-size:16px">{{ error ? '导入失败' : '导入成功' }}</h3>
        <p class="muted small" style="margin-bottom:16px">{{ error || `项目「${finalName}」已导入。历史任务恢复为只读记录。` }}</p>
        <div v-if="error" class="row" style="justify-content:center; gap:8px">
          <button class="btn ghost" @click="phase = 0">重新选择</button>
        </div>
        <div v-else class="row" style="justify-content:center; gap:8px">
          <button class="btn ghost" @click="$router.push('/projects')">返回项目列表</button>
          <button class="btn primary" v-if="importedProjectId" @click="$router.push(`/projects/${importedProjectId}`)">打开项目</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import v21 from '@/v21/api.js'

const CHECK_STATUS_LABEL = { pass: '通过', warn: '警告', block: '阻断', unsupported: '版本不支持' }
const CHECK_STATUS_COLOR = { pass: 'var(--ok)', warn: 'var(--warn)', block: 'var(--danger)', unsupported: 'var(--warn)' }

export default {
  name: 'ArchiveImportView',
  data() {
    return {
      phase: 0, file: null, localPath: '',
      validating: false, validateError: '', validateResult: null,
      finalName: '', importing: false, error: '', importedProjectId: null,
    }
  },
  methods: {
    onFile(e) {
      this.file = e.target.files[0] || null
      if (this.file) {
        this.finalName = this.file.name.replace(/\.zip$/i, '').replace(/[-_]?backup.*$/i, '') || '导入项目'
      }
    },
    // 真实校验：调 POST /api/v2/archive/validate（收本地 zip 路径）；失败保留输入可重试
    async validate() {
      const path = (this.localPath || '').trim()
      if (!path || this.validating) return
      this.validating = true
      this.validateError = ''
      try {
        this.validateResult = await v21.validateArchive(path)
        if (this.validateResult?.summary?.projectName && (!this.finalName || this.phase === 0)) {
          this.finalName = this.validateResult.summary.projectName
        }
        this.phase = 1
      } catch (e) {
        this.validateError = e.message || '校验失败'
      } finally {
        this.validating = false
      }
    },
    checkStatusLabel(status) {
      return CHECK_STATUS_LABEL[status] || String(status || '')
    },
    checkColor(status) {
      return CHECK_STATUS_COLOR[status] || 'var(--muted)'
    },
    checkIcon(status) {
      return status === 'pass' ? '#i-check-c' : '#i-warn'
    },
    formatBytes(n) {
      const num = Number(n)
      if (!Number.isFinite(num)) return '—'
      if (num >= 1048576) return `${(num / 1048576).toFixed(1)} MB`
      if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`
      return `${num} B`
    },
    // 导入动作保持现状：POST /api/v1/dramas/import（multipart 上传），永不覆盖现有项目
    async doImport() {
      this.importing = true
      this.error = ''
      try {
        const form = new FormData()
        form.append('file', this.file)
        const res = await axios.post('/api/v1/dramas/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
        const data = res.data?.data
        this.importedProjectId = data?.id || data?.drama?.id || null
        this.phase = 2
      } catch (e) {
        this.error = e?.response?.data?.error?.message || e?.response?.data?.message || e.message
        this.phase = 2
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
.ck-row { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; padding: 5px 0; }
.ck-row svg { width: 14px; height: 14px; flex: 0 0 auto; margin-top: 1px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
</style>
