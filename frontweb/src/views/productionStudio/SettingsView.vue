<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>常规设置</h1>
      <span class="sub">工作区 · 目录 · 创作默认值 · 备份</span>
      <div class="spacer"></div>
      <span class="badge" :class="dirty ? 'warn' : 'ok'">{{ dirty ? '有未保存修改' : '已保存' }}</span>
      <button v-if="dirty" class="btn ghost" @click="discard">放弃更改</button>
      <button class="btn primary" :disabled="!canSave || saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px; overflow:auto">
      <div v-if="saveError" class="card pad" style="padding:10px 14px">
        <div class="issue-row"><span class="badge danger">保存失败</span><span>{{ saveError }}</span></div>
      </div>

      <div class="card pad">
        <div class="sec-title"><svg><use href="#i-folder"/></svg>工作区</div>
        <div class="frow" style="align-items:center">
          <div class="flabel">工作区目录</div>
          <div class="input grow" style="width:100%; color:var(--text-2); font-family:Consolas,monospace; font-size:12.5px">
            <svg><use href="#i-folder"/></svg>backend-node/data（本地 SQLite + 媒体）
          </div>
          <button class="btn" @click="migrateOpen = true">更改工作区</button>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">更改工作区前会检查活动任务并创建备份与回滚点；迁移向导见下方「更改工作区」。</div></div>
      </div>

      <div class="card pad">
        <div class="sec-title"><svg><use href="#i-image"/></svg>媒体 / 成片 / 临时目录</div>
        <div v-for="row in dirs" :key="row.key" class="frow" style="align-items:center">
          <div class="flabel">{{ row.label }}</div>
          <div class="input grow" style="width:100%; color:var(--text-2); font-family:Consolas,monospace; font-size:12.5px">
            <svg><use href="#i-folder"/></svg>{{ row.path }}
          </div>
          <template v-if="row.key !== 'tmp'">
            <button class="btn" style="flex:0 0 auto" :disabled="row.checking" @click="checkDir(row)">{{ row.checking ? '检测中…' : '重新检测' }}</button>
            <span class="badge" :class="dirBadge(row).cls" style="flex:0 0 auto">{{ dirBadge(row).text }}</span>
          </template>
          <template v-else>
            <a style="flex:0 0 auto; color:var(--accent); cursor:pointer; font-size:13px" @click="$router.push('/settings/data-tools')">前往清理</a>
            <span class="badge idle" style="flex:0 0 auto">未检测</span>
          </template>
        </div>
        <div v-for="row in dirs.filter((d) => d.result)" :key="row.key + '-result'" class="frow">
          <div class="flabel"></div>
          <div v-if="dirLine(row).ok" class="fhint">
            目录存在且可写（{{ row.result.path }}）<template v-if="row.result.freeBytes != null"> · 剩余空间 {{ formatBytes(row.result.freeBytes) }}</template>
          </div>
          <div v-else class="fhint" style="color:var(--warn)">{{ dirLine(row).text }}（{{ row.result.path }}）</div>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">「重新检测」经只读目录状态端点检查真实目录的存在性、可写性与剩余空间（不创建目录，结果为检测时刻状态）；修复入口在高级数据工具。</div></div>
      </div>

      <div class="card pad">
        <div class="sec-title"><svg><use href="#i-clap"/></svg>创作默认值</div>
        <div class="frow" style="align-items:center">
          <div class="flabel">默认画幅</div>
          <div class="seg">
            <span :class="{ on: form.aspectRatio === '9:16' }" @click="form.aspectRatio = '9:16'">9:16 竖屏</span>
            <span :class="{ on: form.aspectRatio === '16:9' }" @click="form.aspectRatio = '16:9'">16:9 横屏</span>
            <span :class="{ on: form.aspectRatio === '1:1' }" @click="form.aspectRatio = '1:1'">1:1 方形</span>
          </div>
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">默认单集时长</div>
          <div class="grow">
            <div class="row" style="gap:10px; align-items:center">
              <input class="input" type="number" min="30" max="600" step="1" style="width:110px" v-model.number="form.episodeDurationSeconds">
              <span class="xs muted">秒</span>
              <div class="seg">
                <span :class="{ on: form.episodeDurationSeconds === 60 }" @click="form.episodeDurationSeconds = 60">60</span>
                <span :class="{ on: form.episodeDurationSeconds === 90 }" @click="form.episodeDurationSeconds = 90">90</span>
                <span :class="{ on: form.episodeDurationSeconds === 120 }" @click="form.episodeDurationSeconds = 120">120</span>
              </div>
            </div>
            <div v-if="!durationValid" class="fhint" style="color:var(--danger)">默认单集时长需为 30-600 的整数（秒）</div>
          </div>
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">界面语言</div>
          <div class="seg">
            <span :class="{ on: form.language === 'zh' }" @click="form.language = 'zh'">中文</span>
            <span :class="{ on: form.language === 'en' }" @click="form.language = 'en'">English</span>
          </div>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">默认值只影响新建项目、新建剧集和新任务；项目级设置优先，任务创建时冻结最终配置。</div></div>
      </div>

      <div class="card pad">
        <div class="sec-title"><svg><use href="#i-shield"/></svg>备份</div>
        <div class="frow" style="align-items:center">
          <div class="flabel">备份目录</div>
          <div class="input grow" style="width:100%; color:var(--text-2); font-family:Consolas,monospace; font-size:12.5px">
            <svg><use href="#i-folder"/></svg>{{ backupStatsData ? backupStatsData.backupDir : (backupStatsFailed ? '暂不可用' : '读取中…') }}
          </div>
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">备份保留天数</div>
          <div class="grow">
            <div class="row" style="gap:10px; align-items:center">
              <input class="input" type="number" min="1" max="365" step="1" style="width:110px" v-model.number="form.backupRetentionDays">
              <span class="xs muted">天（1-365）</span>
            </div>
            <div v-if="retentionClosed" class="fhint" style="color:var(--danger)">不允许关闭备份保护：保留天数至少 1 天</div>
            <div v-else-if="!retentionValid" class="fhint" style="color:var(--danger)">备份保留天数需为 1-365 的整数</div>
          </div>
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">备份统计</div>
          <div v-if="backupStatsData" class="small">
            {{ backupStatsData.backupCount }} 个备份 · 最近 {{ backupStatsData.lastBackupAt ? formatTime(backupStatsData.lastBackupAt) : '暂无' }} · 预计占用 {{ formatBytes(backupStatsData.estimatedUsageBytes) }}
          </div>
          <div v-else-if="backupStatsFailed" class="small muted">暂不可用</div>
          <div v-else class="small muted">读取中…</div>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">保留天数保存为后续自动清理的策略值；已创建的备份始终完整保留，清理需到高级数据工具进行影响预览与二次确认。</div></div>
        <div class="frow"><div class="flabel"></div>
          <button class="btn" :disabled="backupRunning" @click="runBackupNow">{{ backupRunning ? '正在创建备份…' : '立即创建备份' }}</button>
        </div>
        <div v-if="backupResult" class="issue-row"><span class="badge ok">备份完成</span><span class="mono">{{ backupResult }}</span></div>
        <div v-if="backupError" class="issue-row"><span class="badge danger">备份失败</span><span>{{ backupError }}</span></div>
      </div>

      <div class="card pad" style="margin-bottom:8px">
        <div class="sec-title"><svg><use href="#i-layers"/></svg>高级数据工具</div>
        <div class="grid-4">
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>完整性检查</b><p>SQLite / 媒体 / 引用 / 任务索引</p></div>
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>媒体重定位</b><p>扫描 → 预览 → 确认更新</p></div>
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>迁移与恢复记录</b><p>journal / 备份 / 回滚</p></div>
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>物理清理</b><p>dry-run → 永久清理</p></div>
        </div>
      </div>
    </div>

    <!-- 离开守卫确认（自建弹窗，dirty 时拦截路由离开） -->
    <div v-if="leaveConfirmOpen" class="scrim" style="z-index:80"></div>
    <div v-if="leaveConfirmOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--warn)"><use href="#i-warn"/></svg>
          <h3>有未保存的修改</h3>
        </div>
        <div class="modal-b">
          <p class="small">当前常规设置尚未保存，离开本页将丢失这些修改。</p>
        </div>
        <div class="modal-f" style="justify-content:flex-end">
          <button class="btn" @click="cancelLeave">继续编辑</button>
          <button class="btn danger" @click="discardAndLeave">放弃更改并离开</button>
        </div>
      </div>
    </div>

    <!-- 更改工作区向导（24）：选择 → 检查 → 范围预览 → 执行 → 重新打开提示 -->
    <div v-if="migrateOpen" class="scrim" style="z-index:80" @click="migrateStep !== 'executing' && (migrateOpen = false)"></div>
    <div v-if="migrateOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:640px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-folder"/></svg>
          <h3>更改工作区 · {{ migrateStepLabel }}</h3>
          <button class="icon-btn" @click="migrateOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <!-- 步骤条 -->
          <div class="seg" style="margin-bottom:14px">
            <span :class="{ on: migrateStep === 'select' }">1 选择</span>
            <span :class="{ on: ['check', 'preview', 'confirm'].includes(migrateStep) }">2 检查与预览</span>
            <span :class="{ on: migrateStep === 'executing' || migrateStep === 'done' }">3 执行</span>
          </div>

          <template v-if="migrateStep === 'select'">
            <div class="frow" style="align-items:center">
              <div class="flabel">新工作区目录</div>
              <input class="input grow" v-model="migrateDir" placeholder="例如 D:\\LocalMiniDrama（目录不存在时会自动创建）">
            </div>
            <div class="grid-2" style="margin-top:10px">
              <div class="v-row"><div><b style="font-size:13px">数据库</b><div class="vm">drama_generator.db · 全部项目数据</div></div></div>
              <div class="v-row"><div><b style="font-size:13px">媒体文件</b><div class="vm">storage/ 目录 · 分镜图与成片</div></div></div>
            </div>
            <div class="xs" style="color:var(--warn); line-height:1.7; margin-top:10px">
              <svg style="width:12px;height:12px;vertical-align:-1px"><use href="#i-warn"/></svg>
              有活动任务时禁止危险迁移；迁移前自动创建备份与回滚点，原目录默认保留。迁移完成后需要重新打开工作区。
            </div>
          </template>

          <template v-else-if="migrateStep === 'check' || migrateStep === 'preview'">
            <template v-if="migrateCheck">
              <template v-if="!migrateCheck.ok">
                <div v-for="b in migrateCheck.blockers" :key="b.code" class="issue-row">
                  <span class="badge danger">阻断</span><span>{{ b.message }}</span>
                </div>
              </template>
              <template v-else>
                <div class="issue-row"><span class="badge ok">通过</span><span>无活动任务 · 目录可写<template v-if="migrateCheck.details.freeBytes != null"> · 剩余空间 {{ formatBytes(migrateCheck.details.freeBytes) }}</template></span></div>
                <template v-if="migratePreview">
                  <div class="grid-2" style="margin-top:10px">
                    <div class="v-row"><div><b style="font-size:13px">数据库</b><div class="vm">{{ formatBytes(migratePreview.database.bytes) }}</div></div></div>
                    <div class="v-row"><div><b style="font-size:13px">媒体 storage</b><div class="vm">{{ formatBytes(migratePreview.storage.bytes) }} · {{ migratePreview.storage.files }} 个文件</div></div></div>
                  </div>
                  <div class="grid-2" style="margin-top:10px">
                    <div class="v-row"><div><b style="font-size:13px">任务</b><div class="vm">{{ migrateCheck.details.activeTasks > 0 ? migrateCheck.details.activeTasks + ' 个进行中任务' : '无进行中任务' }} · 运行中任务将阻断迁移</div></div></div>
                    <div class="v-row"><div><b style="font-size:13px">备份</b><div class="vm">迁移前自动创建备份（含 SHA-256 清单与回滚点）</div></div></div>
                  </div>
                  <p class="muted xs" style="margin-top:8px">{{ migratePreview.note }}</p>
                </template>
              </template>
            </template>
          </template>

          <template v-else-if="migrateStep === 'executing'">
            <p class="small">正在迁移：创建备份 → 复制数据库与媒体 → 原子改写配置 → 写迁移记录…</p>
          </template>

          <template v-else-if="migrateStep === 'done'">
            <div class="issue-row"><span class="badge ok">完成</span><span>迁移完成，备份与迁移记录已保留在原工作区。</span></div>
            <p class="muted xs" style="margin-top:8px">请重新打开工作区（重启后端）后使用新目录：<br><span class="mono">{{ migrateDir }}</span></p>
            <p class="muted xs">回滚点：<span class="mono">{{ migrateResult && migrateResult.backupDir }}</span></p>
          </template>

          <p v-if="migrateError" class="small" style="color:var(--danger);margin-top:10px">{{ migrateError }}</p>
        </div>
        <div class="modal-f" style="justify-content:space-between">
          <button class="btn ghost" @click="migrateOpen = false">取消</button>
          <div class="row" style="gap:8px">
            <template v-if="migrateStep === 'select'">
              <button class="btn primary" :disabled="!migrateDir || migrateChecking" @click="runWorkspaceCheck">{{ migrateChecking ? '检查中…' : '检查并预览' }}</button>
            </template>
            <template v-else-if="migrateStep === 'check' || migrateStep === 'preview'">
              <button class="btn" @click="migrateStep = 'select'">上一步</button>
              <button v-if="migrateCheck && migrateCheck.ok" class="btn primary" @click="migrateStep = 'confirm'">下一步</button>
            </template>
            <template v-else-if="migrateStep === 'confirm'">
              <button class="btn" @click="migrateStep = 'preview'">上一步</button>
              <input class="input" style="width:170px" v-model="migrateConfirmText" placeholder='输入「确认迁移」'>
              <button class="btn danger" :disabled="migrateConfirmText !== '确认迁移'" @click="runWorkspaceMigrate">确认迁移并重新打开</button>
            </template>
            <template v-else-if="migrateStep === 'done'">
              <button class="btn primary" @click="migrateOpen = false">知道了</button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import { v21 } from '../../v21/api.js'
import escMixin from '../../v21/escMixin.js'

function clampIntField(value, min, max) {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

export default {
  name: 'SettingsView',
  mixins: [escMixin],
  data() {
    return {
      dirty: false, migrateOpen: false,
      form: { aspectRatio: '16:9', language: 'zh', episodeDurationSeconds: 90, backupRetentionDays: 30 },
      savedForm: '',
      saving: false, saveError: '',
      backupStatsData: null, backupStatsFailed: false,
      backupRunning: false, backupResult: '', backupError: '',
      leaveConfirmOpen: false, pendingNav: null,
      dirs: [
        { key: 'storage', label: '媒体目录', path: 'backend-node/data/storage', checking: false, result: null },
        { key: 'export', label: '成片导出目录', path: 'backend-node/data/storage/v21-exports', checking: false, result: null },
        { key: 'tmp', label: '临时目录', path: '系统临时目录', checking: false, result: null },
      ],
      migrateStep: 'select', migrateDir: '', migrateChecking: false,
      migrateCheck: null, migratePreview: null, migrateConfirmText: '',
      migrateExecuting: false, migrateResult: null, migrateError: '',
    }
  },
  computed: {
    formChanged() {
      return JSON.stringify(this.form) !== this.savedForm
    },
    durationValid() {
      return clampIntField(this.form.episodeDurationSeconds, 30, 600) !== null
    },
    retentionValid() {
      return clampIntField(this.form.backupRetentionDays, 1, 365) !== null
    },
    retentionClosed() {
      return Number(this.form.backupRetentionDays) === 0
    },
    canSave() {
      return this.dirty && this.durationValid && this.retentionValid
    },
    migrateStepLabel() {
      return { select: '选择目录', check: '检查与范围预览', preview: '检查与范围预览', confirm: '确认迁移', executing: '正在迁移', done: '迁移完成' }[this.migrateStep] || '迁移'
    },
  },
  watch: {
    form: { deep: true, handler() { this.dirty = JSON.stringify(this.form) !== this.savedForm } },
  },
  async mounted() {
    this.bindEsc(this.onEsc)
    await Promise.all([
      axios.get('/api/v1/settings/language').then((r) => {
        const lang = r.data?.data?.language
        if (lang) this.form.language = lang
      }).catch(() => {}),
      v21.getSettingsDefaults().then((d) => {
        if (d && typeof d === 'object') {
          if (d.aspectRatio) this.form.aspectRatio = d.aspectRatio
          const dur = clampIntField(d.episodeDurationSeconds, 30, 600)
          if (dur !== null) this.form.episodeDurationSeconds = dur
          const ret = clampIntField(d.backupRetentionDays, 1, 365)
          if (ret !== null) this.form.backupRetentionDays = ret
        }
      }).catch(() => {}),
    ])
    this.savedForm = JSON.stringify(this.form)
    this.dirty = false
    this.loadBackupStats()
  },
  beforeRouteLeave(to, from, next) {
    if (!this.dirty) {
      next()
      return
    }
    this.pendingNav = next
    this.leaveConfirmOpen = true
  },
  methods: {
    // Esc 自上而下关本视图的弹层（离开守卫确认 → 更改工作区向导；迁移执行中不允许关闭）
    onEsc() {
      if (this.leaveConfirmOpen) { this.cancelLeave(); return true }
      if (this.migrateOpen) {
        if (this.migrateStep === 'executing') return true
        this.migrateOpen = false
        return true
      }
      return false
    },
    formatBytes(n) {
      const num = Number(n) || 0
      if (num >= 1024 * 1024) return `${(num / 1024 / 1024).toFixed(1)} MB`
      if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`
      return `${num} B`
    },
    formatTime(iso) {
      const t = new Date(iso)
      return Number.isNaN(t.getTime()) ? '暂无' : t.toLocaleString()
    },
    dirLine(row) {
      const r = row.result
      if (!r) return { ok: false, text: '' }
      if (!r.exists) return { ok: false, text: r.error || '目录不存在' }
      if (r.writable && !r.error) return { ok: true, text: '' }
      return { ok: false, text: r.error || '目录不可写' }
    },
    dirBadge(row) {
      if (!row.result) return { cls: 'idle', text: '未检测' }
      return this.dirLine(row).ok ? { cls: 'ok', text: '正常' } : { cls: 'warn', text: '有异常' }
    },
    async loadBackupStats() {
      this.backupStatsFailed = false
      try {
        this.backupStatsData = await v21.backupStats()
      } catch (_) {
        this.backupStatsData = null
        this.backupStatsFailed = true
      }
    },
    async checkDir(row) {
      if (row.checking) return
      row.checking = true
      try {
        // 只读目录状态端点：按 dataRoot/配置解析真实路径并探测，绝不创建目录
        const rows = await v21.dirStatus()
        const found = (Array.isArray(rows) ? rows : []).find((r) => r.key === row.key)
        row.result = found
          ? {
              path: found.path != null ? found.path : row.path,
              exists: !!found.exists,
              writable: !!found.writable,
              freeBytes: found.freeBytes != null ? found.freeBytes : null,
              error: found.error != null ? found.error : null,
            }
          : { path: row.path, exists: false, writable: false, freeBytes: null, error: '未返回该目录的状态' }
      } catch (e) {
        row.result = { path: row.path, exists: false, writable: false, freeBytes: null, error: e.message || '检测失败' }
      } finally {
        row.checking = false
      }
    },
    async runBackupNow() {
      if (this.backupRunning) return
      this.backupRunning = true
      this.backupResult = ''
      this.backupError = ''
      try {
        const r = await v21.runBackup()
        this.backupResult = r.path || ''
        this.loadBackupStats()
      } catch (e) {
        this.backupError = e.message || '备份失败'
      } finally {
        this.backupRunning = false
      }
    },
    async runWorkspaceCheck() {
      this.migrateChecking = true
      this.migrateError = ''
      this.migrateCheck = null
      this.migratePreview = null
      try {
        this.migrateCheck = await v21.workspaceCheck(this.migrateDir)
        if (this.migrateCheck.ok) {
          this.migratePreview = await v21.workspacePreview(this.migrateDir)
        }
        this.migrateStep = 'check'
      } catch (err) {
        this.migrateError = err.message || '未知错误'
      } finally {
        this.migrateChecking = false
      }
    },
    async runWorkspaceMigrate() {
      this.migrateExecuting = true
      this.migrateError = ''
      this.migrateStep = 'executing'
      try {
        this.migrateResult = await v21.workspaceMigrate(this.migrateDir, this.migrateConfirmText)
        this.migrateStep = 'done'
      } catch (err) {
        this.migrateError = err.message || '迁移失败'
        this.migrateStep = 'preview'
      } finally {
        this.migrateExecuting = false
      }
    },
    discard() {
      if (this.savedForm) this.form = JSON.parse(this.savedForm)
      this.dirty = false
    },
    discardAndLeave() {
      this.discard()
      this.leaveConfirmOpen = false
      const nav = this.pendingNav
      this.pendingNav = null
      if (nav) nav()
    },
    cancelLeave() {
      this.leaveConfirmOpen = false
      const nav = this.pendingNav
      this.pendingNav = null
      if (nav) nav(false)
    },
    async save() {
      if (!this.canSave || this.saving) return
      this.saving = true
      this.saveError = ''
      try {
        await v21.updateSettingsDefaults({
          aspectRatio: this.form.aspectRatio,
          episodeDurationSeconds: Number(this.form.episodeDurationSeconds),
          backupRetentionDays: Number(this.form.backupRetentionDays),
        })
        if (this.form.language) {
          await axios.put('/api/v1/settings/language', { language: this.form.language })
        }
        this.savedForm = JSON.stringify(this.form)
        this.dirty = false
      } catch (e) {
        this.saveError = e?.response?.data?.error?.message || e.message || '保存失败'
      } finally {
        this.saving = false
      }
    },
  },
}
</script>

<style scoped>
.card.pad { max-width: 860px; }
.sec-title { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; margin-bottom: 14px; }
.sec-title svg { width: 16px; height: 16px; color: var(--muted); }
.frow { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 10px; }
.flabel { width: 110px; flex: 0 0 110px; font-size: 13px; color: var(--text-2); padding-top: 8px; }
.fhint { font-size: 11px; color: var(--muted); margin-top: 4px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.tool-card { padding: 13px 14px; cursor: pointer; }
.tool-card:hover { border-color: var(--accent); }
.tool-card b { font-size: 13px; display: block; margin-bottom: 4px; }
.tool-card p { margin: 0; font-size: 11px; color: var(--muted); }
.v-row { border: 1px solid var(--line); border-radius: 10px; background: var(--panel2); padding: 13px 12px; }
.v-row .vm { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
.issue-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 12.5px; }
.mono { font-family: Consolas, monospace; }
.badge.warn { background: var(--warn-subtle); color: var(--warn); }
.badge.ok { background: var(--ok-subtle); color: var(--ok); }
.badge.idle { background: var(--panel2); color: var(--muted); }
</style>
