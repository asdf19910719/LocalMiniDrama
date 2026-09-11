<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>AI 配置</h1>
      <span class="sub">通道 · 解析顺序 · 业务映射</span>
      <div class="spacer"></div>
      <span class="badge outline">密钥只存本机 · 不进入项目与导出</span>
      <button class="btn sm" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px; overflow:auto">

      <!-- 加载失败：错误横幅 + 重试（不再静默清空） -->
      <div v-if="loadError" class="notice-strip danger" style="margin:0; align-items:center; gap:10px">
        <svg style="width:15px;height:15px"><use href="#i-warn"/></svg>
        <span>AI 配置加载失败：{{ loadError }}</span>
        <button class="btn sm" :disabled="loading" @click="load">重试</button>
      </div>

      <!-- 解析顺序链 -->
      <div class="card pad">
        <b style="font-size:13.5px">通道解析顺序</b>
        <div class="chain" style="margin-top:10px">
          <span class="chip chain-first">本次任务覆盖</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">项目默认</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">全局默认</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">安装默认</span>
        </div>
        <div class="xs muted" style="margin-top:8px">任务创建后冻结 Provider/模型/费用快照，不随设置漂移</div>
      </div>

      <!-- 三通道卡 -->
      <div class="grid-3">
        <div class="card pad chan">
          <div class="chan-h"><span class="chan-ic ic-a"><svg><use href="#i-external"/></svg></span><div class="grow"><div class="row"><b style="font-size:14px">API 中转站</b><span class="badge info">联网</span></div></div></div>
          <p class="muted small" style="margin:7px 0 10px">OpenAI 兼容接口 · 图片 / 视频 / 剧本文本 · 按 Provider 计费</p>
          <div class="kv"><span class="k">已配置</span><span class="v">{{ providers.length }} 项</span></div>
          <div class="kv"><span class="k">可用</span><span class="v">{{ usableCount }} 项 · 缺密钥 {{ missingKeyCount }} 项</span></div>
          <div class="kv"><span class="k">费用</span><span class="v">Provider 返回价</span></div>
        </div>
        <div class="card pad chan">
          <div class="chan-h"><span class="chan-ic ic-g"><svg><use href="#i-spark"/></svg></span><div class="grow"><div class="row"><b style="font-size:14px">ChatGPT 网页</b><span class="badge ok">零费用</span></div></div></div>
          <p class="muted small" style="margin:7px 0 10px">网页自动化出图 · 需要本机浏览器会话与登录状态</p>
          <div class="kv"><span class="k">通道开关</span><span class="v">{{ chatgptWebEnabled ? '已启用' : '已停用' }}</span></div>
          <div class="kv"><span class="k">浏览器程序</span><span class="v">{{ chatgptExecutable || '未设置' }}</span></div>
          <div class="kv"><span class="k">用户在场</span><span class="v">生成期间需要</span></div>
          <div class="kv"><span class="k">环境检查</span><span class="v" style="color:var(--muted)">依赖桌面桥 · 当前版本未接入</span></div>
          <p class="xs muted" style="margin:8px 0 0">环境检查（浏览器 / 登录 / 捕获 / 桥接）依赖桌面桥，当前版本未接入；此处只显示可读取的本机配置状态，不伪造检测结果。</p>
        </div>
        <div class="card pad chan">
          <div class="chan-h"><span class="chan-ic ic-i"><svg><use href="#i-monitor"/></svg></span><div class="grow"><div class="row"><b style="font-size:14px">ComfyUI 本地</b><span class="badge outline">本地</span></div></div></div>
          <p class="muted small" style="margin:7px 0 10px">本机工作流执行 · 显存与队列由本机 GPU 决定</p>
          <div class="kv"><span class="k">费用</span><span class="v">本地执行 · ¥0 API 费用</span></div>
          <div class="kv"><span class="k">依赖</span><span class="v">本机 ComfyUI 服务在线</span></div>
        </div>
      </div>

      <!-- 已配置通道（真实 Provider 卡） -->
      <div class="card">
        <div class="card-h"><h3>已配置通道（{{ providers.length }}）</h3><div class="spacer"></div>
          <a class="btn ghost sm" style="border:1px solid var(--line); text-decoration:none" href="/ai-config/advanced">高级配置（旧页 · 全量操作）</a>
        </div>
        <div class="card-b" style="padding:12px 16px 16px">
          <div v-if="providers.length === 0" class="muted small" style="padding:8px 0">暂无已配置通道 · 无 Key 时 mock 通道可运行全部核心流程；可到高级配置页添加。</div>
          <div class="grid-3">
            <div v-for="p in providers" :key="p.id" class="card pad prov">
              <div class="row">
                <b style="font-size:13px">{{ p.name || '(未命名)' }}</b>
                <span class="badge outline">{{ p.serviceType }}</span>
                <span class="badge" :class="statusMeta(p.status).cls" style="margin-left:auto">{{ statusMeta(p.status).label }}</span>
              </div>
              <div class="kv"><span class="k">地址</span><span class="v">{{ p.baseUrlDomain || '—' }}</span></div>
              <div class="kv"><span class="k">密钥</span><span class="v">{{ p.hasKey ? '已配置（尾号 ' + p.keyTail + '）' : '未配置' }}</span></div>
              <div class="kv"><span class="k">默认模型</span><span class="v">{{ p.defaultModel || '—' }}</span></div>
              <div class="row" style="gap:8px; margin-top:10px">
                <button class="btn sm" @click="openEdit(p)">编辑</button>
                <button class="btn sm" :disabled="testState[p.id] && testState[p.id].state === 'running'" @click="testConnection(p)">
                  {{ testState[p.id] && testState[p.id].state === 'running' ? '测试中…' : '测试连接' }}
                </button>
              </div>
              <div v-if="testState[p.id] && testState[p.id].state === 'ok'" class="notice-strip ok xs" style="margin:8px 0 0">
                {{ testState[p.id].message || '连接测试成功' }}
              </div>
              <div v-if="testState[p.id] && testState[p.id].state === 'fail'" class="notice-strip danger xs" style="margin:8px 0 0">
                <div>{{ testState[p.id].message }}</div>
                <div v-if="testState[p.id].hint" class="xs muted" style="margin-top:4px">建议：{{ testState[p.id].hint }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 默认生图通道 -->
      <div class="card pad">
        <b style="font-size:13.5px">默认生图通道</b>
        <p class="xs muted" style="margin:6px 0 0">解析顺序中的「项目默认 / 全局默认」在此设置；本次生成仍可在任务里临时覆盖，不反向写入。</p>

        <div class="sec-t" style="margin-top:12px">全局默认</div>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <span class="xs muted">当前：{{ imageDefault ? channelLabel(imageDefault.global.channel) : '—' }}（{{ sourceLabel(imageDefault && imageDefault.global.source) }}）</span>
          <template v-if="imageDefault">
            <button v-for="c in imageDefault.channels" :key="'g-' + c" class="btn sm"
              :class="{ primary: imageDefault.global.channel === c }"
              :disabled="channelBusy || imageDefault.global.channel === c || (c === 'chatgpt_web' && !chatgptWebEnabled)"
              :title="c === 'chatgpt_web' && !chatgptWebEnabled ? 'ChatGPT 网页生图通道未启用：请先在 设置 · 生成设置 中启用' : ''"
              @click="setDefaultChannel('global', c)">
              {{ imageDefault.global.channel === c ? '当前默认' : ('设为默认 · ' + channelLabel(c)) }}
            </button>
          </template>
        </div>

        <div class="divider" style="margin:12px 0"></div>
        <div class="sec-t">项目默认</div>
        <div class="frow" style="align-items:center; max-width:520px">
          <div class="flabel">项目</div>
          <select class="input grow" v-model="projectId">
            <option value="">选择项目…</option>
            <option v-for="pr in projects" :key="pr.id" :value="String(pr.id)">{{ pr.title || ('项目 #' + pr.id) }}</option>
          </select>
        </div>
        <div v-if="projectId && projectDefault" class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px">
          <span class="xs muted">当前：{{ channelLabel(projectDefault.channel) }}（{{ sourceLabel(projectDefault.source) }}）</span>
          <button v-for="c in imageDefault.channels" :key="'p-' + c" class="btn sm"
            :class="{ primary: projectDefault.channel === c }"
            :disabled="channelBusy || projectDefault.channel === c || (c === 'chatgpt_web' && !chatgptWebEnabled)"
            :title="c === 'chatgpt_web' && !chatgptWebEnabled ? 'ChatGPT 网页生图通道未启用：请先在 设置 · 生成设置 中启用' : ''"
            @click="setDefaultChannel('project', c)">
            {{ projectDefault.channel === c ? '当前默认' : ('设为默认 · ' + channelLabel(c)) }}
          </button>
        </div>
        <p v-else class="xs muted" style="margin:8px 0 0">选择项目后可为该项目设置默认生图通道（项目默认优先于全局默认）。</p>

        <div v-if="channelWrite" class="notice-strip xs" :class="channelWrite.ok ? 'ok' : 'danger'" style="margin:10px 0 0">
          {{ channelWrite.message }}
        </div>
      </div>

      <!-- 业务映射（只读展示 + 诚实降级去向） -->
      <div class="card pad">
        <b style="font-size:13.5px">业务映射</b>
        <p class="xs muted" style="margin:6px 0 0">8 类业务当前生效的 Provider / 模型（每类取该业务默认配置中的首个可用 Key 项）。本页为只读展示：常规版本暂无单业务编辑端点，请在 AI 配置·高级页调整对应 service_type 的配置。</p>
        <div style="margin-top:10px">
          <div v-for="m in businessMapping" :key="m.key" class="map-row">
            <span class="badge outline">{{ m.group }}</span>
            <b style="font-size:12.5px">{{ m.label }}</b>
            <template v-if="m.providerBacked">
              <span v-if="m.configured" class="small">{{ m.provider }}<span class="muted"> · {{ m.model || '未指定默认模型' }}</span></span>
              <span v-else class="muted small">{{ m.note }}</span>
            </template>
            <span v-else class="muted small">{{ m.note }}</span>
            <div class="spacer"></div>
            <router-link v-if="m.providerBacked" class="btn ghost sm" style="border:1px solid var(--line); text-decoration:none"
              :to="'/ai-config/advanced'">修改 · 前往高级页</router-link>
            <span v-else class="xs muted">本地执行 · 无需修改</span>
          </div>
        </div>
      </div>

      <!-- 配置导入 / 导出 -->
      <div class="card pad">
        <b style="font-size:13.5px">配置导入 / 导出</b>
        <p class="xs muted" style="margin:6px 0 10px">导出与导入均不含任何密钥与浏览器授权；导入采用后如需真实调用，请在本机编辑对应配置补填密钥。</p>
        <div class="row" style="gap:8px">
          <button class="btn sm" @click="openExportConfirm"><svg style="width:13px;height:13px"><use href="#i-download"/></svg> 导出配置 JSON</button>
          <span v-if="exportDone" class="xs" style="color:var(--ok)">{{ exportDone }}</span>
          <span v-if="exportError" class="xs" style="color:var(--danger)">{{ exportError }}</span>
        </div>

        <div class="divider" style="margin:12px 0"></div>
        <div class="sec-t">导入配置（粘贴导出 JSON）</div>
        <textarea class="input" v-model="importText" rows="4" style="width:100%; font-family:var(--mono, monospace); font-size:12px"
          placeholder='粘贴本工具导出的 {"kind":"localminidrama-ai-config", ...} JSON'></textarea>
        <div class="row" style="gap:8px; margin-top:8px">
          <button class="btn sm" :disabled="importParsing || !importText.trim()" @click="parseImport">{{ importParsing ? '解析中…' : '解析差异' }}</button>
          <button v-if="adoptCount > 0" class="btn sm primary" :disabled="importApplying" @click="applyImport">
            {{ importApplying ? '应用中…' : `应用 ${adoptCount} 项采用` }}
          </button>
        </div>
        <p v-if="importError" class="small" style="color:var(--danger); margin:8px 0 0">解析失败：{{ importError }}</p>
        <p v-if="importApplyError" class="small" style="color:var(--danger); margin:8px 0 0">{{ importApplyError }}</p>

        <div v-if="importRows.length" style="margin-top:10px">
          <div v-for="(row, idx) in importRows" :key="idx" class="imp-row">
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <b style="font-size:12.5px">{{ row.title }}</b>
              <span class="badge" :class="row.adoptable ? 'outline' : 'neutral'">{{ row.adoptable ? (row.kind === 'provider' ? '配置差异' : '默认通道差异') : '不可采用' }}</span>
            </div>
            <div v-if="row.fields && row.fields.length" class="xs" style="margin:4px 0 0; line-height:1.7">
              <div v-for="f in row.fields" :key="f.field" class="muted">{{ f.label }}：本机「{{ f.local }}」→ 导入「{{ f.incoming }}」</div>
            </div>
            <p v-if="!row.adoptable" class="xs muted" style="margin:4px 0 0">{{ row.reason }}</p>
            <div v-if="row.adoptable" class="row" style="gap:14px; margin-top:6px">
              <label class="row xs" style="gap:5px; cursor:pointer">
                <input type="radio" :name="'imp-' + idx" value="keep" v-model="row.decision"> 保留本机
              </label>
              <label class="row xs" style="gap:5px; cursor:pointer">
                <input type="radio" :name="'imp-' + idx" value="adopt" v-model="row.decision"> 采用导入
              </label>
            </div>
          </div>
          <div v-if="importResult" class="notice-strip xs" :class="importResult.failures.length ? 'warn' : 'ok'" style="margin-top:8px">
            <div>已应用 {{ importResult.applied }} 项<template v-if="importResult.failures.length">，失败 {{ importResult.failures.length }} 项：</template></div>
            <div v-for="(f, i) in importResult.failures" :key="i" class="xs">· {{ f.title }}：{{ f.message }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑 Provider 抽屉 -->
    <div v-if="editOpen" class="scrim" style="z-index:80" @click="editOpen = false"></div>
    <aside v-if="editOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>编辑 Provider{{ editTarget ? ' · ' + (editTarget.name || '#' + editTarget.id) : '' }}</h3>
        <button class="icon-btn" @click="editOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="frow" style="align-items:center">
          <div class="flabel">名称</div>
          <input class="input grow" v-model="editForm.name" placeholder="配置名称">
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">服务地址</div>
          <input class="input grow" v-model="editForm.baseUrl" placeholder="https://api.example.com/v1">
        </div>
        <div class="frow" style="align-items:center">
          <div class="flabel">访问密钥</div>
          <input class="input grow" type="password" v-model="editForm.apiKey" autocomplete="new-password" placeholder="留空=不修改（已配置：尾号即可见）">
        </div>
        <p class="xs muted" style="margin:8px 0 0">密钥留空=不修改；输入新密钥保存后只写入本机安全存储，不进入项目、导出文件与任务快照。保存成功后可在卡片上「测试连接」。</p>
        <div v-if="editSavedMsg" class="notice-strip ok xs" style="margin:10px 0 0">
          {{ editSavedMsg }}<template v-if="editSavedKeyChanged"> · 密钥已写入本机安全存储</template>
        </div>
        <div v-if="editError" class="notice-strip danger xs" style="margin:10px 0 0">{{ editError }}</div>
        <div v-if="editLoadError" class="notice-strip warn xs" style="margin:10px 0 0">{{ editLoadError }}</div>
      </div>
      <div class="drawer-f">
        <span class="xs muted">编辑走 V1 update 端点 · 密钥不回显</span>
        <div class="spacer"></div>
        <button class="btn" @click="editOpen = false">关闭</button>
        <button class="btn primary" :disabled="editSaving" @click="saveEdit">{{ editSaving ? '保存中…' : '保存' }}</button>
      </div>
    </aside>

    <!-- 导出确认弹窗（注明脱敏范围） -->
    <div v-if="exportConfirmOpen" class="scrim" style="z-index:80" @click="exportConfirmOpen = false"></div>
    <div v-if="exportConfirmOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:460px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-download"/></svg>
          <h3>确认导出配置</h3>
        </div>
        <div class="modal-b">
          <p class="small" style="margin:0 0 8px">导出内容（脱敏范围）：</p>
          <p class="xs" style="margin:0 0 4px">· 包含：{{ providers.length }} 项 Provider 配置（名称 / 服务地址 / 模型 / 默认标记）与全局默认生图通道</p>
          <p class="xs" style="margin:0 0 4px; color:var(--danger)">· 排除：API 密钥、浏览器授权、项目数据——导出文件不含任何密钥字段</p>
          <p class="xs muted" style="margin:0">导入采用后如需真实调用，需在本机补填密钥。</p>
        </div>
        <div class="modal-f" style="justify-content:flex-end">
          <button class="btn" @click="exportConfirmOpen = false">取消</button>
          <button class="btn primary" :disabled="exporting" @click="confirmExport">{{ exporting ? '导出中…' : '确认导出' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { v21 } from '@/v21/api'
import { buildExportPayload, parseImportedConfig, diffImportedConfig, buildUpdateBody } from '@/v21/aiConfigTransfer'
import escMixin from '@/v21/escMixin.js'

const CHANNEL_LABELS = { api: 'API 中转站', chatgpt_web: 'ChatGPT 网页' }
const SOURCE_LABELS = { global_default: '全局默认', project_default: '项目默认', install_default: '安装默认' }
const STATUS_META = {
  ok: { label: '可用', cls: 'ok' },
  missing_key: { label: '缺密钥', cls: 'warn' },
  disabled: { label: '已停用', cls: 'neutral' },
}

export default {
  name: 'AiConfigV21View',
  mixins: [escMixin],
  data() {
    return {
      loading: false,
      loadError: '',
      overview: null,
      chatgptSettings: null,
      projects: [],
      projectId: '',
      testState: {},
      channelBusy: false,
      channelWrite: null,
      editOpen: false,
      editTarget: null,
      editForm: { name: '', baseUrl: '', apiKey: '' },
      editOriginalBaseUrl: '',
      editSaving: false,
      editError: '',
      editSavedMsg: '',
      editSavedKeyChanged: false,
      editLoadError: '',
      exportConfirmOpen: false,
      exporting: false,
      exportError: '',
      exportDone: '',
      importText: '',
      importParsing: false,
      importError: '',
      importRows: [],
      importApplying: false,
      importApplyError: '',
      importResult: null,
    }
  },
  computed: {
    providers() { return (this.overview && this.overview.providers) || [] },
    businessMapping() { return (this.overview && this.overview.businessMapping) || [] },
    imageDefault() { return (this.overview && this.overview.imageDefault) || null },
    projectDefault() { return (this.imageDefault && this.imageDefault.project) || null },
    chatgptWebEnabled() {
      if (this.overview && this.overview.imageDefault) return this.overview.imageDefault.chatgptWebEnabled !== false
      return true
    },
    chatgptExecutable() {
      const s = this.chatgptSettings
      return (s && s.chatgpt_web && s.chatgpt_web.executable) || ''
    },
    usableCount() { return this.providers.filter((p) => p.status === 'ok').length },
    missingKeyCount() { return this.providers.filter((p) => p.status === 'missing_key').length },
    adoptCount() { return this.importRows.filter((r) => r.adoptable && r.decision === 'adopt').length },
  },
  watch: {
    projectId() { this.load() },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.loadProjects()
    this.load()
  },
  methods: {
    // Esc 自上而下关本视图的弹层（导出确认 → 编辑抽屉）
    onEsc() {
      if (this.exportConfirmOpen) { this.exportConfirmOpen = false; return true }
      if (this.editOpen) { this.editOpen = false; return true }
      return false
    },
    channelLabel(c) { return CHANNEL_LABELS[c] || c || '—' },
    sourceLabel(s) { return SOURCE_LABELS[s] || s || '—' },
    statusMeta(status) { return STATUS_META[status] || { label: status || '未知', cls: 'outline' } },
    async load() {
      this.loading = true
      this.loadError = ''
      try {
        const projectId = this.projectId ? Number(this.projectId) : undefined
        const [overview, settings] = await Promise.all([
          v21.aiConfigOverview(Number.isInteger(projectId) ? projectId : undefined),
          v21.getImageGenerationSettings().catch(() => null),
        ])
        this.overview = overview
        if (settings) this.chatgptSettings = settings
      } catch (e) {
        this.loadError = (e && e.message) || '加载失败，请检查后端服务是否在运行'
      } finally {
        this.loading = false
      }
    },
    async loadProjects() {
      try {
        const data = await v21.listProjects({})
        this.projects = (data && Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []))
          .filter((p) => p && p.id != null && p.deleted !== true)
      } catch { this.projects = [] }
    },
    // ---- Provider 编辑（密钥留空=不修改） ----
    async openEdit(p) {
      this.editTarget = p
      this.editError = ''
      this.editSavedMsg = ''
      this.editLoadError = ''
      this.editForm = { name: p.name || '', baseUrl: '', apiKey: '' }
      this.editOriginalBaseUrl = ''
      this.editOpen = true
      try {
        const full = await v21.getV1AiConfig(p.id)
        this.editForm.name = full.name || p.name || ''
        this.editForm.baseUrl = full.base_url || ''
        this.editOriginalBaseUrl = full.base_url || ''
        // 注意：V1 返回包含 api_key，但绝不写入表单、绝不回显
      } catch (e) {
        this.editLoadError = `完整配置读取失败（${(e && e.message) || '未知错误'}），当前仅可编辑名称；服务地址请到高级页修改。`
      }
    },
    async saveEdit() {
      if (!this.editTarget) return
      this.editError = ''
      this.editSavedMsg = ''
      const name = this.editForm.name.trim()
      if (!name) {
        this.editError = '名称不能为空'
        return
      }
      const body = { name }
      const baseUrl = this.editForm.baseUrl.trim()
      if (baseUrl && baseUrl !== this.editOriginalBaseUrl) body.base_url = baseUrl
      // 密钥留空=不修改：仅当输入了新密钥才回传 api_key
      if (this.editForm.apiKey.trim()) body.api_key = this.editForm.apiKey.trim()
      this.editSaving = true
      try {
        await v21.updateV1AiConfig(this.editTarget.id, body)
        this.editSavedKeyChanged = Boolean(body.api_key)
        this.editSavedMsg = '已保存'
        this.editForm.apiKey = ''
        await this.load()
      } catch (e) {
        this.editError = (e && e.message) || '保存失败'
      } finally {
        this.editSaving = false
      }
    },
    // ---- 测试连接（密钥只在服务端参与） ----
    async testConnection(p) {
      this.testState = { ...this.testState, [p.id]: { state: 'running' } }
      try {
        const r = await v21.testProviderConnection(p.id, {})
        this.testState = { ...this.testState, [p.id]: { state: 'ok', message: (r && r.message) || '连接测试成功' } }
      } catch (e) {
        this.testState = {
          ...this.testState,
          [p.id]: { state: 'fail', message: (e && e.message) || '连接测试失败', hint: (e && e.hint) || '' },
        }
      }
    },
    // ---- 默认生图通道 ----
    async setDefaultChannel(scope, channel) {
      if (scope === 'project' && !this.projectId) return
      this.channelBusy = true
      this.channelWrite = null
      try {
        const body = scope === 'project'
          ? { scope, projectId: Number(this.projectId), channel }
          : { scope, channel }
        await v21.setImageDefault(body)
        this.channelWrite = { ok: true, message: `已设为${scope === 'project' ? '项目' : '全局'}默认：${this.channelLabel(channel)}` }
        await this.load()
      } catch (e) {
        this.channelWrite = { ok: false, message: (e && e.message) || '设置失败' }
      } finally {
        this.channelBusy = false
      }
    },
    // ---- 导出（前端剔除密钥字段） ----
    openExportConfirm() {
      this.exportError = ''
      this.exportDone = ''
      this.exportConfirmOpen = true
    },
    async confirmExport() {
      this.exporting = true
      this.exportError = ''
      try {
        const configs = await v21.listV1AiConfigs()
        const payload = buildExportPayload(configs, this.overview)
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `localminidrama-ai-config-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        this.exportDone = `已导出 ${payload.providers.length} 项配置（不含密钥）`
        this.exportConfirmOpen = false
      } catch (e) {
        this.exportError = (e && e.message) || '导出失败'
      } finally {
        this.exporting = false
      }
    },
    // ---- 导入（差异逐项二选一） ----
    async parseImport() {
      this.importError = ''
      this.importApplyError = ''
      this.importResult = null
      this.importParsing = true
      try {
        const parsed = parseImportedConfig(this.importText)
        if (!parsed.ok) {
          this.importError = parsed.error
          this.importRows = []
          return
        }
        const locals = await v21.listV1AiConfigs()
        this.importRows = diffImportedConfig(parsed.config, locals, this.overview)
      } catch (e) {
        this.importError = (e && e.message) || '解析失败'
        this.importRows = []
      } finally {
        this.importParsing = false
      }
    },
    async applyImport() {
      this.importApplyError = ''
      this.importResult = null
      this.importApplying = true
      try {
        const adopted = this.importRows.filter((r) => r.adoptable && r.decision === 'adopt')
        if (!adopted.length) {
          this.importApplyError = '没有勾选「采用导入」的条目'
          return
        }
        let applied = 0
        const failures = []
        for (const row of adopted) {
          try {
            if (row.kind === 'provider') {
              await v21.updateV1AiConfig(row.configId, buildUpdateBody(row))
            } else if (row.kind === 'global_image_default') {
              await v21.setImageDefault({ scope: 'global', channel: row.incoming })
            }
            applied += 1
          } catch (e) {
            failures.push({ title: row.title, message: (e && e.message) || '更新失败' })
          }
        }
        this.importResult = { applied, failures }
        await this.load()
      } finally {
        this.importApplying = false
      }
    },
  },
}
</script>

<style scoped>
.chain { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chain-first { border-color: var(--accent); background: var(--accent-subtle); color: #fff; font-weight: 500; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.chan-h { display: flex; align-items: center; gap: 12px; }
.chan-ic { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.chan-ic svg { width: 19px; height: 19px; }
.chan-ic.ic-a { background: var(--accent-subtle); color: var(--accent); }
.chan-ic.ic-g { background: var(--ok-subtle); color: var(--ok); }
.chan-ic.ic-i { background: var(--info-subtle); color: var(--info); }
.chan .kv { border-top: 1px solid var(--line); padding: 6px 0; }
.chan .kv:first-of-type { border-top: none; margin-top: 4px; }
.prov { background: var(--panel2); }
.prov .kv { border-top: 1px solid var(--line); padding: 5px 0; font-size: 12px; }
.prov .kv:first-of-type { border-top: none; margin-top: 8px; }
.map-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); }
.map-row:last-of-type { border-bottom: none; }
.imp-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: var(--panel2); }
.badge.warn { background: var(--warn-subtle, #f5f0e0); color: var(--warn, #8a6d1a); }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
.notice-strip.xs { font-size: 12px; }
</style>
