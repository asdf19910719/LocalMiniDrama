<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/settings')"><svg><use href="#i-back"/></svg></button>
      <h1>高级数据工具</h1>
      <span class="sub">完整性检查 · 媒体重定位 · 迁移记录 · 物理清理</span>
      <div class="spacer"></div>
      <span class="badge warn">运行中任务将阻断危险写入</span>
    </header>
    <div class="page-body" style="display:flex; gap:16px; overflow:auto">

      <!-- 左侧工具导航 -->
      <div class="col" style="width:220px; flex:0 0 220px; gap:6px">
        <button v-for="tool in tools" :key="tool.id" class="btn" :class="{ primary: tool.id === active }" style="width:100%; justify-content:flex-start" @click="openTool(tool.id)">
          {{ tool.label }}
        </button>
      </div>

      <div class="grow" style="min-width:0">
        <!-- 完整性检查 -->
        <div v-if="active === 'integrity'" class="card pad">
          <div class="row" style="margin-bottom:12px"><b style="font-size:14px">完整性检查</b><div class="spacer"></div>
            <button class="btn" :disabled="scanning" @click="runCheck">{{ scanning ? '正在检查…' : '开始检查' }}</button>
          </div>
          <p v-if="!checked && !scanError" class="muted small">默认只读检查；完成后按「正常 / 警告 / 错误」列出结果，每项提供唯一恢复落点。</p>
          <p v-if="scanError" class="small" style="color:var(--danger)">检查失败：{{ scanError }}</p>
          <template v-if="checked">
            <div class="stats-row">
              <span class="badge ok">正常 {{ integrity.summary.ok }}</span>
              <span class="badge warn">警告 {{ integrity.summary.warn }}</span>
              <span class="badge danger">错误 {{ integrity.summary.error }}</span>
            </div>
            <div v-for="entry in integrity.items" :key="entry.id" class="issue">
              <span class="badge" :class="entry.severity === 'ok' ? 'ok' : entry.severity === 'warn' ? 'warn' : 'danger'">
                {{ entry.severity === 'ok' ? '正常' : entry.severity === 'warn' ? '警告' : '错误' }}
              </span>
              <span class="ellipsis">{{ entry.title }} · {{ entry.detail }}</span>
              <span v-if="recoveryLabel(entry.recovery)" class="act" @click="goRecovery(entry.recovery)">{{ recoveryLabel(entry.recovery) }}</span>
            </div>
          </template>
        </div>

        <!-- 媒体重定位（五态：唯一命中 / 多候选 / hash 不一致·阻断 / 路径越界·阻断 / 未找到） -->
        <div v-else-if="active === 'relocation'" class="card pad">
          <b style="font-size:14px">媒体重定位</b>
          <p class="muted small" style="margin:8px 0 14px">固定流程：选目录 → 扫描匹配 → 逐文件预览 → 明确确认更新。扫描产出五种结果：唯一命中可勾选；多候选需人工选择；hash 不一致与路径越界默认阻断；未找到保持离线。确认前不写入任何路径。</p>
          <div class="row" style="gap:8px">
            <input class="input grow" v-model="relocDir" placeholder="输入媒体文件所在目录（受控工作区根内的目录）">
            <button class="btn primary" :disabled="!relocDir || relocScanning" @click="startRelocScan">{{ relocScanning ? '扫描中…' : '扫描' }}</button>
          </div>
          <p v-if="relocError" class="small" style="color:var(--danger);margin-top:8px">扫描失败：{{ relocError }}</p>
          <template v-if="relocResult">
            <div class="stats-row" style="margin-top:12px">
              <span class="badge ok">唯一命中 {{ relocResult.summary.unique }}</span>
              <span class="badge warn">多候选 {{ relocResult.summary.ambiguous }}</span>
              <span class="badge danger">hash 不一致 {{ relocResult.summary.hashMismatch || 0 }}</span>
              <span class="badge danger">路径越界 {{ relocResult.summary.pathEscape || 0 }}</span>
              <span class="badge danger">未找到 {{ relocResult.summary.none }}</span>
            </div>
            <div v-for="row in relocResult.rows" :key="`${row.table}-${row.id}`" class="issue">
              <span class="badge" :class="relocBadgeClass(row.match.status)">{{ relocStatusLabel(row.match.status) }}</span>
              <div class="grow" style="min-width:0">
                <div class="mono xs ellipsis">{{ row.table }}#{{ row.id }} · {{ row.missingPath }}</div>
                <div v-if="row.evidence" class="xs t2 ellipsis">{{ row.evidence }}</div>
              </div>
              <template v-if="row.match.status === 'unique'">
                <span class="mono xs ellipsis" style="max-width:220px">→ {{ row.match.candidates[0] }}</span>
                <label class="act"><input type="checkbox" :value="relocKey(row)" v-model="relocSelected" :disabled="isRelocBlocked(row)"> 勾选</label>
              </template>
              <select v-else-if="row.match.status === 'ambiguous'" class="input xs" style="max-width:220px" @change="setAmbiguous(row, $event.target.value)">
                <option value="">选择候选…</option>
                <option v-for="c in row.match.candidates" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <div class="divider"></div>
            <div class="row">
              <span class="small t2">将更新 {{ relocSelected.length }} 项 · 阻断跳过 {{ relocBlockedCount }} 项 · 确认后才更新路径</span>
              <div class="spacer"></div>
              <button class="btn primary" :disabled="!relocSelected.length" @click="relocModalOpen = true">确认更新…</button>
            </div>
            <template v-if="relocDone">
              <div class="divider"></div>
              <p class="ok-t small">已更新 {{ relocDone.updated.length }} 条媒体路径<template v-if="relocDone.skipped.length"> · 未更新 {{ relocDone.skipped.length }} 条（含原因）</template>。</p>
              <p v-if="relocDone.skipped.length" class="small t2" style="margin-top:4px">
                <span v-for="(s, i) in relocDone.skipped" :key="i" class="ellipsis" style="display:block">{{ s.item && s.item.table }}#{{ s.item && s.item.id }} · {{ s.reason }}</span>
              </p>
              <p v-if="relocDone.reportPath" class="muted xs" style="margin-top:6px">报告：{{ relocDone.reportPath }}</p>
            </template>
          </template>
        </div>

        <!-- 迁移与恢复记录（真实 migration journal + 备份目录扫描） -->
        <div v-else-if="active === 'journal'" class="card pad">
          <div class="row" style="margin-bottom:12px"><b style="font-size:14px">迁移与恢复记录</b><div class="spacer"></div>
            <button class="btn" :disabled="migrationsLoading" @click="loadMigrations">{{ migrationsLoading ? '加载中…' : '刷新' }}</button>
          </div>
          <p v-if="migrationsError" class="small" style="color:var(--danger)">迁移记录加载失败：{{ migrationsError }} <span class="act" @click="loadMigrations">重试</span></p>
          <template v-else>
            <div class="v-row">
              <div class="grow" style="min-width:0">
                <b style="font-size:13px">迁移 journal</b>
                <div class="vm">
                  <template v-if="migrations.journal">
                    状态 {{ journalStatusLabel(migrations.journal.status) }}<template v-if="migrations.journal.targetVersion"> · 目标版本 {{ migrations.journal.targetVersion }}</template><template v-if="migrations.journal.sourceVersion"> · 源版本 {{ migrations.journal.sourceVersion }}</template><br>
                    <template v-if="migrations.journal.startedAt">开始 {{ formatTime(migrations.journal.startedAt) }} · </template>最近更新 {{ formatTime(migrations.journal.updatedAt) }}<template v-if="migrations.journal.migrationId"><br>迁移 ID {{ migrations.journal.migrationId }}</template><br>
                    <template v-if="migrations.journal.backupDir">备份位置 {{ migrations.journal.backupDir }}<br></template>
                    <template v-if="migrations.journal.status === 'FAILED' && migrations.journal.failureReason">失败原因 {{ migrations.journal.failureReason }}<br></template>
                  </template>
                  <template v-else-if="!migrationsLoaded">正在读取迁移记录…</template>
                  <template v-else>暂无迁移 journal（本工作区尚未执行过 schema 迁移，无需恢复动作）。</template>
                </div>
              </div>
              <span class="badge" :class="migrations.journal ? journalBadgeClass(migrations.journal.status) : ''" style="margin-left:auto">
                {{ migrations.journal ? journalStatusLabel(migrations.journal.status) : '无记录' }}
              </span>
            </div>
            <template v-if="migrations.journal && migrations.journal.status === 'FAILED'">
              <div class="row" style="margin-top:10px">
                <button class="btn" @click="journalDrawerOpen = true">查看迁移日志</button>
              </div>
              <p class="muted xs" style="margin-top:6px">回滚需按迁移报告人工执行：请核对备份与数据库状态后按报告步骤恢复，本工具仅提供记录查看，不代执行恢复。</p>
            </template>
            <div class="divider"></div>
            <b style="font-size:13px">备份列表（{{ migrations.backups.length }}）</b>
            <div v-for="b in migrations.backups" :key="b.dir" class="issue">
              <span class="badge ok">备份</span>
              <span class="ellipsis mono xs grow">{{ b.dir }}</span>
              <span class="xs t2">{{ formatTime(b.createdAt) }} · {{ formatBytes(b.bytes) }}</span>
            </div>
            <p v-if="!migrations.backups.length" class="muted xs">暂无迁移备份（仅统计含 manifest 的备份目录）。</p>
          </template>
        </div>

        <!-- 物理清理 -->
        <div v-else-if="active === 'cleanup'" class="card pad">
          <b style="font-size:14px">物理清理（dry-run）</b>
          <p class="muted small" style="margin:8px 0 12px">只能从 dry-run 清单进入；有引用、任务占用或路径越界的文件会被阻断。</p>
          <button class="btn primary" :disabled="cleanupScanning" @click="runCleanupDryRun">{{ cleanupScanning ? '扫描中…' : '生成 dry-run 清单' }}</button>
          <p v-if="cleanupError" class="small" style="color:var(--danger);margin-top:8px">扫描失败：{{ cleanupError }}</p>
          <template v-if="cleanupResult">
            <div class="divider"></div>
            <div v-for="f in cleanupResult.files" :key="f.path" class="issue">
              <span v-if="f.eligible" class="badge ok">可清理</span>
              <span v-else class="badge danger">阻断</span>
              <span class="ellipsis mono xs">{{ f.path }} · {{ formatBytes(f.sizeBytes) }}<template v-if="!f.eligible"> · {{ f.reason }}</template></span>
              <label v-if="f.eligible" class="act"><input type="checkbox" :value="f.path" v-model="cleanupSelected"> 勾选</label>
            </div>
            <div class="divider"></div>
            <div class="row">
              <span class="small t2">预计回收 {{ formatBytes(cleanupResult.summary.reclaimableBytes) }} · 可清理 {{ cleanupResult.summary.eligible }} 个文件</span>
              <div class="spacer"></div>
              <button class="btn danger" :disabled="!cleanupSelected.length" @click="cleanupModalOpen = true">永久清理…</button>
            </div>
            <template v-if="cleanupDone">
              <p class="ok-t small" style="margin-top:10px">已删除 {{ cleanupDone.deleted.length }} 个文件<template v-if="cleanupDone.failed.length"> · 未删除 {{ cleanupDone.failed.length }} 个（含原因）</template>。</p>
              <p v-if="cleanupDone.failed.length" class="small t2" style="margin-top:4px">
                <span v-for="f in cleanupDone.failed" :key="f.path" class="ellipsis" style="display:block">{{ f.path }} · {{ f.reason }}</span>
              </p>
              <p class="muted xs" style="margin-top:6px">报告：{{ cleanupDone.reportPath }}</p>
            </template>
          </template>
        </div>
      </div>
    </div>

    <!-- 物理清理第一层确认 Modal（确认文本门禁） -->
    <div v-if="cleanupModalOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <h3>确认永久清理</h3>
          <button class="icon-btn" @click="cleanupModalOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small">即将物理删除 <b>{{ cleanupSelected.length }}</b> 个文件（{{ formatBytes(selectedBytes) }}），此操作不可恢复。</p>
          <input class="input" style="width:100%;margin-top:12px" v-model="cleanupConfirmText" placeholder='输入「永久清理」以确认'>
        </div>
        <div class="modal-f">
          <button class="btn" @click="cleanupModalOpen = false">取消</button>
          <button class="btn danger" :disabled="cleanupConfirmText !== '永久清理'" @click="cleanupFinalOpen = true">下一步…</button>
        </div>
      </div>
    </div>

    <!-- 物理清理第二层确认 Modal（最终执行门禁） -->
    <div v-if="cleanupFinalOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <h3>确认执行物理清理</h3>
          <button class="icon-btn" @click="cleanupFinalOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small">最后一层确认：将物理删除 <b>{{ cleanupSelected.length }}</b> 个文件（共 {{ formatBytes(selectedBytes) }}），删除后无法从本工具恢复。</p>
          <p class="muted xs" style="margin-top:8px">请确认 dry-run 清单中没有仍需保留的文件。</p>
        </div>
        <div class="modal-f">
          <button class="btn" @click="cleanupFinalOpen = false">取消</button>
          <button class="btn danger" :disabled="cleanupExecuting" @click="executeCleanup">{{ cleanupExecuting ? '执行中…' : '确认执行物理清理' }}</button>
        </div>
      </div>
    </div>

    <!-- 媒体重定位确认 Modal -->
    <div v-if="relocModalOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <h3>确认更新媒体路径</h3>
          <button class="icon-btn" @click="relocModalOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small">将把 <b>{{ relocSelected.length }}</b> 条媒体记录的路径更新为扫描命中的新位置。此操作直接写库，请确认勾选无误。</p>
          <p class="muted xs" style="margin-top:8px">hash 不一致与路径越界项已默认阻断，不会进入本次更新（阻断跳过 {{ relocBlockedCount }} 项）。</p>
        </div>
        <div class="modal-f">
          <button class="btn" @click="relocModalOpen = false">取消</button>
          <button class="btn primary" :disabled="relocExecuting" @click="executeReloc">{{ relocExecuting ? '更新中…' : '确认更新' }}</button>
        </div>
      </div>
    </div>

    <!-- 迁移日志抽屉（journal 原始 JSON，只读） -->
    <div v-if="journalDrawerOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:640px">
        <div class="modal-h">
          <h3>迁移日志（journal 原始内容）</h3>
          <button class="icon-btn" @click="journalDrawerOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <pre class="mono xs" style="white-space:pre-wrap;word-break:break-all;max-height:380px;overflow:auto;margin:0">{{ journalRaw }}</pre>
          <p v-if="migrations.journalPath" class="muted xs" style="margin-top:8px">journal 文件：{{ migrations.journalPath }}</p>
        </div>
        <div class="modal-f">
          <button class="btn" @click="journalDrawerOpen = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { v21 } from '../../v21/api.js'
import escMixin from '../../v21/escMixin.js'

const RELOC_STATUS_LABEL = {
  unique: '唯一命中',
  ambiguous: '多候选',
  hash_mismatch: 'hash 不一致 · 阻断',
  path_escape: '路径越界 · 阻断',
  none: '未找到',
}
const RELOC_BADGE_CLASS = {
  unique: 'ok',
  ambiguous: 'warn',
  hash_mismatch: 'danger',
  path_escape: 'danger',
  none: 'danger',
}
const JOURNAL_STATUS_LABEL = {
  PRECHECK: '预检中',
  BACKED_UP: '已备份',
  MIGRATING: '迁移中',
  VERIFYING: '校验中',
  COMMITTED: '已提交',
  FAILED: '失败',
}

export default {
  name: 'DataToolsView',
  mixins: [escMixin],
  data() {
    return {
      active: 'integrity', scanning: false, checked: false,
      integrity: { items: [], summary: { ok: 0, warn: 0, error: 0 } },
      scanError: '',
      cleanupScanning: false, cleanupError: '', cleanupResult: null,
      cleanupSelected: [], cleanupConfirmText: '', cleanupModalOpen: false, cleanupFinalOpen: false,
      cleanupExecuting: false, cleanupDone: null,
      relocDir: '', relocScanning: false, relocError: '', relocResult: null,
      relocSelected: [], relocAmbiguous: {}, relocModalOpen: false, relocExecuting: false, relocDone: null,
      migrations: { journal: null, journalPath: '', backups: [] },
      migrationsLoading: false, migrationsLoaded: false, migrationsError: '', journalDrawerOpen: false,
      tools: [
        { id: 'integrity', label: '完整性检查' },
        { id: 'relocation', label: '媒体重定位' },
        { id: 'journal', label: '迁移与恢复记录' },
        { id: 'cleanup', label: '物理清理' },
      ],
      recoveries: {
        relocation: { label: '媒体重定位', tool: 'relocation' },
        reindex: { label: '重建任务索引', route: '/tasks' },
        cleanup: { label: '物理清理', tool: 'cleanup' },
        paths: { label: '查看路径配置', route: '/settings' },
      },
    }
  },
  mounted() {
    this.bindEsc(this.onEsc)
  },
  computed: {
    selectedBytes() {
      if (!this.cleanupResult) return 0
      return this.cleanupResult.files
        .filter((f) => this.cleanupSelected.includes(f.path))
        .reduce((sum, f) => sum + f.sizeBytes, 0)
    },
    relocBlockedCount() {
      if (!this.relocResult) return 0
      return this.relocResult.rows.filter((row) => this.isRelocBlocked(row)).length
    },
    journalRaw() {
      return this.migrations.journal ? JSON.stringify(this.migrations.journal, null, 2) : '（journal 不存在）'
    },
  },
  methods: {
    // Esc 自上而下关本视图的弹层（清理终审 → 迁移日志 → 清理确认 → 重定位确认）
    onEsc() {
      if (this.cleanupFinalOpen) { this.cleanupFinalOpen = false; return true }
      if (this.journalDrawerOpen) { this.journalDrawerOpen = false; return true }
      if (this.cleanupModalOpen) { this.cleanupModalOpen = false; return true }
      if (this.relocModalOpen) { this.relocModalOpen = false; return true }
      return false
    },
    formatBytes(n) {
      const num = Number(n) || 0
      if (num >= 1024 * 1024) return `${(num / 1024 / 1024).toFixed(1)} MB`
      if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`
      return `${num} B`
    },
    formatTime(iso) {
      if (!iso) return '—'
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString()
    },
    openTool(id) {
      this.active = id
      if (id === 'journal') this.loadMigrations()
    },
    async loadMigrations() {
      this.migrationsLoading = true
      this.migrationsError = ''
      try {
        const result = await v21.migrations()
        this.migrations = {
          journal: result.journal || null,
          journalPath: result.journalPath || '',
          backups: Array.isArray(result.backups) ? result.backups : [],
        }
        // M-2：加载完成后才允许显示“暂无迁移 journal”空态（加载中显示“正在读取迁移记录…”）
        this.migrationsLoaded = true
      } catch (err) {
        this.migrationsError = err.message || '未知错误'
      } finally {
        this.migrationsLoading = false
      }
    },
    journalStatusLabel(status) {
      return JOURNAL_STATUS_LABEL[status] || (status ? String(status) : '无记录')
    },
    journalBadgeClass(status) {
      if (status === 'COMMITTED') return 'ok'
      if (status === 'FAILED') return 'danger'
      return 'warn'
    },
    relocStatusLabel(status) {
      return RELOC_STATUS_LABEL[status] || String(status || '')
    },
    relocBadgeClass(status) {
      return RELOC_BADGE_CLASS[status] || 'danger'
    },
    isRelocBlocked(row) {
      // M-1：未找到（none）不算阻断跳过——归入“未找到”计数；仅 hash 不一致与路径越界阻断
      const status = row && row.match && row.match.status
      return status === 'hash_mismatch' || status === 'path_escape'
    },
    relocKey(row) {
      return `${row.table}|${row.id}|${row.match.candidates[0]}`
    },
    async runCheck() {
      this.scanning = true
      this.scanError = ''
      try {
        this.integrity = await v21.runIntegrity()
        this.checked = true
      } catch (err) {
        this.scanError = err.message || '未知错误'
      } finally {
        this.scanning = false
      }
    },
    async runCleanupDryRun() {
      this.cleanupScanning = true
      this.cleanupError = ''
      this.cleanupSelected = []
      this.cleanupDone = null
      this.cleanupFinalOpen = false
      try {
        this.cleanupResult = await v21.cleanupDryRun()
      } catch (err) {
        this.cleanupError = err.message || '未知错误'
      } finally {
        this.cleanupScanning = false
      }
    },
    async executeCleanup() {
      this.cleanupExecuting = true
      try {
        this.cleanupDone = await v21.cleanupExecute(this.cleanupSelected, this.cleanupConfirmText)
        this.cleanupModalOpen = false
        this.cleanupFinalOpen = false
        this.cleanupConfirmText = ''
        await this.runCleanupDryRun()
      } catch (err) {
        this.cleanupError = err.message || '未知错误'
        this.cleanupModalOpen = false
        this.cleanupFinalOpen = false
      } finally {
        this.cleanupExecuting = false
      }
    },
    startRelocScan() {
      this.relocDone = null
      this.runRelocScan()
    },
    async runRelocScan() {
      this.relocScanning = true
      this.relocError = ''
      this.relocSelected = []
      this.relocAmbiguous = {}
      try {
        this.relocResult = await v21.relocationScan(this.relocDir)
        // 唯一命中默认勾选（阻断态不可勾选；预览后仍需明确确认才写库）
        this.relocSelected = this.relocResult.rows
          .filter((r) => r.match.status === 'unique' && !this.isRelocBlocked(r))
          .map((r) => this.relocKey(r))
      } catch (err) {
        this.relocError = err.message || '未知错误'
      } finally {
        this.relocScanning = false
      }
    },
    setAmbiguous(row, candidate) {
      const base = `${row.table}|${row.id}|`
      this.relocSelected = this.relocSelected.filter((item) => !item.startsWith(base))
      if (candidate) this.relocSelected.push(base + candidate)
    },
    async executeReloc() {
      this.relocExecuting = true
      try {
        const items = this.relocSelected.map((item) => {
          const [table, id, newPath] = item.split('|')
          return { table, id: /^\d+$/.test(id) ? Number(id) : id, newPath }
        })
        this.relocDone = await v21.relocationConfirm(items)
        this.relocModalOpen = false
        await this.runRelocScan()
      } catch (err) {
        this.relocError = err.message || '未知错误'
        this.relocModalOpen = false
      } finally {
        this.relocExecuting = false
      }
    },
    recoveryLabel(key) {
      return (key && this.recoveries[key] && this.recoveries[key].label) || ''
    },
    goRecovery(key) {
      const target = this.recoveries[key]
      if (!target) return
      if (target.tool) this.active = target.tool
      else if (target.route) this.$router.push(target.route)
    },
  },
}
</script>

<style scoped>
.page-body { display: flex; gap: 16px; overflow: auto; }
.stats-row { display: flex; gap: 8px; margin-bottom: 12px; }
.issue { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 12.5px; border-bottom: 1px solid var(--line); }
.issue .act { margin-left: auto; color: var(--accent); cursor: pointer; white-space: nowrap; font-size: 12px; }
.v-row { border: 1px solid var(--line); border-radius: 10px; background: var(--panel2); padding: 13px 12px; display: flex; align-items: flex-start; gap: 12px; }
.v-row .vm { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
.mono { font-family: Consolas, monospace; }
</style>
