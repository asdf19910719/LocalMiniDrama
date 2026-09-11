<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>常规设置</h1>
      <span class="sub">工作区 · 目录 · 创作默认值 · 备份</span>
      <div class="spacer"></div>
      <span class="badge" :class="dirty ? 'warn' : 'ok'">{{ dirty ? '有未保存修改' : '已保存' }}</span>
      <button class="btn primary" :disabled="!dirty" @click="save">保存</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px; overflow:auto">

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
          <span class="badge ok" style="flex:0 0 auto">正常</span>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">目录状态每行显示存在性、权限与空间；离线时不自动改写，修复入口在高级数据工具。</div></div>
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
            <svg><use href="#i-folder"/></svg>backend-node/data/backups
          </div>
        </div>
        <div class="frow"><div class="flabel"></div><div class="fhint">首次 V2.1 成功备份默认永久保留；清理需到高级数据工具进行影响预览与二次确认。</div></div>
        <div class="frow"><div class="flabel"></div><button class="btn" @click="comingSoon('立即创建备份')">立即创建备份</button></div>
      </div>

      <div class="card pad" style="margin-bottom:8px">
        <div class="sec-title"><svg><use href="#i-layers"/></svg>高级数据工具</div>
        <div class="grid-4">
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>完整性检查</b><p>SQLite / 媒体 / 引用 / 任务索引</p></div>
          <div class="tool-card card" @click="comingSoon('媒体重定位')"><b>媒体重定位</b><p>扫描 → 预览 → 确认更新</p></div>
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>迁移与恢复记录</b><p>journal / 备份 / 回滚</p></div>
          <div class="tool-card card" @click="$router.push('/settings/data-tools')"><b>物理清理</b><p>dry-run → 永久清理</p></div>
        </div>
      </div>
    </div>

    <!-- 更改工作区向导（24） -->
    <div v-if="migrateOpen" class="scrim" style="z-index:80" @click="migrateOpen = false"></div>
    <div v-if="migrateOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:640px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-folder"/></svg>
          <h3>更改工作区 · 迁移范围预览</h3>
          <button class="icon-btn" @click="migrateOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="grid-2">
            <div class="v-row"><div><b style="font-size:13px">数据库</b><div class="vm">drama_generator.db · 全部项目数据</div></div></div>
            <div class="v-row"><div><b style="font-size:13px">媒体文件</b><div class="vm">storage/ 目录 · 分镜图与成片</div></div></div>
            <div class="v-row"><div><b style="font-size:13px">任务记录</b><div class="vm">async_tasks · 含进行中任务</div></div></div>
            <div class="v-row"><div><b style="font-size:13px">备份</b><div class="vm">backups/ · 迁移前自动创建回滚点</div></div></div>
          </div>
          <div class="divider"></div>
          <div class="xs" style="color:var(--warn); line-height:1.7">
            <svg style="width:12px;height:12px;vertical-align:-1px"><use href="#i-warn"/></svg>
            有活动任务时禁止危险迁移；迁移前自动创建备份与回滚点，原目录默认保留。迁移完成后需要重新打开工作区。
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="migrateOpen = false">取消</button>
          <button class="btn primary" disabled title="工作区迁移执行器将在后续版本接入">确认迁移并重新打开</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'SettingsView',
  data() {
    return {
      dirty: false, migrateOpen: false,
      form: { aspectRatio: '16:9', language: 'zh' },
      savedForm: '',
      dirs: [
        { key: 'media', label: '媒体目录', path: 'backend-node/data/storage' },
        { key: 'export', label: '成片导出目录', path: 'backend-node/data/storage/v21-exports' },
        { key: 'tmp', label: '临时目录', path: '系统临时目录' },
      ],
    }
  },
  computed: {
    formChanged() {
      return JSON.stringify(this.form) !== this.savedForm
    },
  },
  watch: {
    form: { deep: true, handler() { this.dirty = JSON.stringify(this.form) !== this.savedForm } },
  },
  mounted() {
    axios.get('/api/v1/settings/language').then((r) => {
      const lang = r.data?.data?.language
      if (lang) this.form.language = lang
      this.savedForm = JSON.stringify(this.form)
      this.dirty = false
    }).catch(() => {})
  },
  methods: {
    async save() {
      try {
        if (this.form.language) {
          await axios.put('/api/v1/settings/language', { language: this.form.language })
        }
        this.savedForm = JSON.stringify(this.form)
        this.dirty = false
      } catch (e) {
        alert(e?.response?.data?.error?.message || e.message)
      }
    },
    comingSoon(name) {
      alert(`${name}将在本迭代内启用`)
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
.badge.warn { background: var(--warn-subtle); color: var(--warn); }
.badge.ok { background: var(--ok-subtle); color: var(--ok); }
</style>
