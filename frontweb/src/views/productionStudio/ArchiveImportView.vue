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
        <p class="muted small" style="margin:8px 0 14px">只接受 LocalMiniDrama 项目归档（.zip）。导入会创建新项目；已有项目不会受影响。</p>
        <input type="file" accept=".zip" class="input" style="width:100%; padding:8px" @change="onFile">
        <div v-if="file" class="kv" style="margin-top:12px"><span class="k">文件</span><span class="v">{{ file.name }} · {{ (file.size / 1048576).toFixed(1) }} MB</span></div>
        <div class="row" style="margin-top:16px; justify-content:flex-end">
          <button class="btn primary" :disabled="!file" @click="validate">校验并确认</button>
        </div>
      </div>

      <!-- 阶段 2：校验并确认 -->
      <div v-else-if="phase === 1" class="card pad" style="max-width:760px">
        <b style="font-size:14px">校验并确认</b>
        <div class="grid-2" style="margin-top:14px">
          <div class="col" style="gap:10px">
            <div class="ck-row"><svg style="color:var(--ok)"><use href="#i-check-c"/></svg>归档文件可读取</div>
            <div class="ck-row"><svg style="color:var(--ok)"><use href="#i-check-c"/></svg>zip 结构完整</div>
            <div class="ck-row"><svg style="color:var(--warn)"><use href="#i-warn"/></svg>缺失媒体 = 可导入警告（保留引用）</div>
          </div>
          <div class="col" style="gap:12px">
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
          确认导入前请核对最终项目名称；历史任务只恢复为只读记录，绝不自动重新执行或调用 Provider。多 GB 归档导入为持久化本地任务，可离页恢复。
        </div>
        <div class="row" style="margin-top:16px; justify-content:flex-end; gap:8px">
          <button class="btn ghost" @click="phase = 0">上一步</button>
          <button class="btn primary" :disabled="importing" @click="doImport">{{ importing ? '导入中…' : '仍然导入为新项目' }}</button>
        </div>
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

export default {
  name: 'ArchiveImportView',
  data() {
    return { phase: 0, file: null, finalName: '', importing: false, error: '', importedProjectId: null }
  },
  methods: {
    onFile(e) {
      this.file = e.target.files[0] || null
      if (this.file) {
        this.finalName = this.file.name.replace(/\.zip$/i, '').replace(/[-_]?backup.*$/i, '') || '导入项目'
      }
    },
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
    validate() {
      this.phase = 1
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
.ck-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 5px 0; }
.ck-row svg { width: 14px; height: 14px; flex: 0 0 auto; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
</style>
