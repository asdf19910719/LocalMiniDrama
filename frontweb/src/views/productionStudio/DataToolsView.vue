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
        <button v-for="tool in tools" :key="tool.id" class="btn" :class="{ primary: tool.id === active }" style="width:100%; justify-content:flex-start" @click="active = tool.id">
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

        <!-- 媒体重定位 -->
        <div v-else-if="active === 'relocation'" class="card pad">
          <b style="font-size:14px">媒体重定位</b>
          <p class="muted small" style="margin:8px 0 14px">固定流程：选目录 → 扫描匹配 → 逐文件预览 → 明确确认更新。确认前不写入任何路径。</p>
          <div class="row" style="gap:8px">
            <input class="input grow" v-model="relocDir" placeholder="输入媒体文件所在目录（如移动后的盘符/目录）">
            <button class="btn primary" :disabled="!relocDir || relocScanning" @click="runRelocScan">{{ relocScanning ? '扫描中…' : '扫描' }}</button>
          </div>
          <p v-if="relocError" class="small" style="color:var(--danger);margin-top:8px">扫描失败：{{ relocError }}</p>
          <template v-if="relocResult">
            <div class="stats-row" style="margin-top:12px">
              <span class="badge ok">唯一命中 {{ relocResult.summary.unique }}</span>
              <span class="badge warn">多候选 {{ relocResult.summary.ambiguous }}</span>
              <span class="badge danger">未找到 {{ relocResult.summary.none }}</span>
            </div>
            <div v-for="row in relocResult.rows" :key="`${row.table}-${row.id}`" class="issue">
              <span class="badge" :class="row.match.status === 'unique' ? 'ok' : row.match.status === 'ambiguous' ? 'warn' : 'danger'">
                {{ row.match.status === 'unique' ? '唯一命中' : row.match.status === 'ambiguous' ? '多候选' : '未找到' }}
              </span>
              <span class="ellipsis mono xs grow">{{ row.table }}#{{ row.id }} · {{ row.missingPath }}</span>
              <template v-if="row.match.status === 'unique'">
                <span class="mono xs ellipsis" style="max-width:220px">→ {{ row.match.candidates[0] }}</span>
                <label class="act"><input type="checkbox" :value="`${row.table}|${row.id}|${row.match.candidates[0]}`" v-model="relocSelected"> 勾选</label>
              </template>
              <select v-else-if="row.match.status === 'ambiguous'" class="input xs" style="max-width:220px" @change="setAmbiguous(row, $event.target.value)">
                <option value="">选择候选…</option>
                <option v-for="c in row.match.candidates" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <div class="divider"></div>
            <div class="row">
              <span class="small t2">已勾选 {{ relocSelected.length }} 项 · 确认后才更新路径</span>
              <div class="spacer"></div>
              <button class="btn primary" :disabled="!relocSelected.length" @click="relocModalOpen = true">确认更新…</button>
            </div>
          </template>
        </div>

        <!-- 迁移与恢复记录 -->
        <div v-else-if="active === 'journal'" class="card pad">
          <b style="font-size:14px">迁移与恢复记录</b>
          <div class="v-row" style="margin-top:12px">
            <div>
              <b style="font-size:13px">V2.1 正式迁移</b>
              <div class="vm">状态 COMMITTED · 目标版本 2.1.0<br>备份目录 backend-node/data/backups/v2.1/&lt;migration-id&gt; · 首次成功备份永久保留</div>
            </div>
            <span class="badge ok" style="margin-left:auto">COMMITTED</span>
          </div>
          <p class="muted small" style="margin-top:10px">失败记录会提供 journal / 备份 / 事务步骤与继续迁移或回滚入口。</p>
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

    <!-- 物理清理最终确认 Modal（不可恢复操作走专用容器） -->
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
          <button class="btn danger" :disabled="cleanupConfirmText !== '永久清理' || cleanupExecuting" @click="executeCleanup">{{ cleanupExecuting ? '执行中…' : '确认永久清理' }}</button>
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
          <p class="small">将把 <b>{{ relocSelected.length }}</b> 条媒体记录的 local_path 更新为扫描命中的新位置。此操作直接写库，请确认勾选无误。</p>
        </div>
        <div class="modal-f">
          <button class="btn" @click="relocModalOpen = false">取消</button>
          <button class="btn primary" :disabled="relocExecuting" @click="executeReloc">{{ relocExecuting ? '更新中…' : '确认更新' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { v21 } from '../../v21/api.js'

export default {
  name: 'DataToolsView',
  data() {
    return {
      active: 'integrity', scanning: false, checked: false,
      integrity: { items: [], summary: { ok: 0, warn: 0, error: 0 } },
      scanError: '',
      cleanupScanning: false, cleanupError: '', cleanupResult: null,
      cleanupSelected: [], cleanupConfirmText: '', cleanupModalOpen: false,
      cleanupExecuting: false, cleanupDone: null,
      relocDir: '', relocScanning: false, relocError: '', relocResult: null,
      relocSelected: [], relocAmbiguous: {}, relocModalOpen: false, relocExecuting: false, relocDone: null,
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
  computed: {
    selectedBytes() {
      if (!this.cleanupResult) return 0
      return this.cleanupResult.files
        .filter((f) => this.cleanupSelected.includes(f.path))
        .reduce((sum, f) => sum + f.sizeBytes, 0)
    },
  },
  methods: {
    formatBytes(n) {
      const num = Number(n) || 0
      if (num >= 1024 * 1024) return `${(num / 1024 / 1024).toFixed(1)} MB`
      if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`
      return `${num} B`
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
        this.cleanupConfirmText = ''
        await this.runCleanupDryRun()
      } catch (err) {
        this.cleanupError = err.message || '未知错误'
        this.cleanupModalOpen = false
      } finally {
        this.cleanupExecuting = false
      }
    },
    async runRelocScan() {
      this.relocScanning = true
      this.relocError = ''
      this.relocSelected = []
      this.relocAmbiguous = {}
      this.relocDone = null
      try {
        this.relocResult = await v21.relocationScan(this.relocDir)
        // 唯一命中默认勾选（预览后仍需明确确认才写库）
        this.relocSelected = this.relocResult.rows
          .filter((r) => r.match.status === 'unique')
          .map((r) => `${r.table}|${r.id}|${r.match.candidates[0]}`)
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
          return { table, id: Number(id), newPath }
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
