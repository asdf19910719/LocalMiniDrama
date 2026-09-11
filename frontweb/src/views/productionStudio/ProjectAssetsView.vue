<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push(`/projects/${projectId}`)"><svg><use href="#i-back"/></svg></button>
      <span class="t2 bold">{{ projectTitle }}</span>
      <nav class="ptabs">
        <span class="ptab" @click="$router.push(`/projects/${projectId}`)">概览</span>
        <span class="ptab" @click="$router.push(`/projects/${projectId}/episodes`)">剧集</span>
        <span class="ptab on">项目素材</span>
      </nav>
      <div class="spacer"></div>
      <button class="btn ghost" style="border:1px solid var(--line)" @click="comingSoon('从个人资产库添加')"><svg><use href="#i-box"/></svg>从个人资产库添加</button>
      <button class="btn primary" style="height:36px" @click="createOpen = true"><svg><use href="#i-plus"/></svg>新增素材</button>
    </header>
    <div class="page-body" style="padding:16px 24px 14px">

      <div v-if="notice" class="notice-strip warn" style="margin-bottom:12px">
        <span style="flex:1">{{ notice }}</span>
        <span style="text-decoration:underline dotted; text-underline-offset:3px; cursor:pointer" @click="notice = ''">关闭</span>
      </div>

      <div class="stats">
        <div class="card stat"><div class="ic"><svg><use href="#i-user"/></svg></div><div><b>{{ countOf('character') }}</b><span>人物</span></div></div>
        <div class="card stat"><div class="ic"><svg><use href="#i-scene"/></svg></div><div><b>{{ countOf('scene') }}</b><span>场景资产</span></div></div>
        <div class="card stat"><div class="ic"><svg><use href="#i-cube"/></svg></div><div><b>{{ countOf('prop') }}</b><span>道具</span></div></div>
        <div class="card stat warn"><div class="ic"><svg><use href="#i-warn"/></svg></div><div><b>{{ blockedCount }}</b><span>需要处理</span></div></div>
      </div>

      <div class="toolbar">
        <div class="seg">
          <span :class="{ on: type === 'all' }" @click="setType('all')">全部 {{ allCount }}</span>
          <span :class="{ on: type === 'character' }" @click="setType('character')">人物 {{ countOf('character') }}</span>
          <span :class="{ on: type === 'scene' }" @click="setType('scene')">场景 {{ countOf('scene') }}</span>
          <span :class="{ on: type === 'prop' }" @click="setType('prop')">道具 {{ countOf('prop') }}</span>
        </div>
        <div class="input" style="width:210px">
          <svg><use href="#i-search"/></svg>
          <input v-model="q" placeholder="搜索素材名称" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13px" @input="load">
        </div>
        <span class="muted xs" style="margin-left:auto">缩略比例：人物 3:4 · 场景 16:9 · 道具 1:1</span>
      </div>

      <template v-for="grp in grouped" :key="grp.key">
        <div class="sec-label">{{ grp.label }} <span class="hint muted">· {{ grp.items.length }} 项 · 点击卡片打开详情抽屉</span></div>
        <div class="agrid">
          <div v-for="(item, i) in grp.items" :key="item.assetType + item.id" class="card acard" :class="[item.assetType, { miss: item.blocked }]" @click="openDetail(item)">
            <div class="thumb" :class="item.currentImage ? 'has-img' : 'ph ph-' + ((i + grp.key.length) % 6)">
              <img v-if="item.currentImage" :src="item.currentImage">
              <span class="st badge" :class="item.blocked ? 'danger' : 'ok'">{{ item.blocked ? '缺少当前图' : '已确认' }}</span>
            </div>
            <div class="info"><b>{{ item.name }}</b><p>{{ typeLabel(item.assetType) }} · {{ item.description || '—' }}</p></div>
          </div>
        </div>
      </template>
      <p v-if="grouped.length === 0" class="muted" style="text-align:center; padding:60px 0">暂无素材</p>
    </div>

    <!-- 新增素材 Modal -->
    <div v-if="createOpen" class="scrim" style="z-index:80" @click="createOpen = false"></div>
    <div v-if="createOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:460px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-plus"/></svg>
          <h3>新增素材</h3>
          <button class="icon-btn" @click="createOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="col" style="gap:12px">
            <label class="col" style="gap:4px"><span class="xs muted">类型</span>
              <select class="input" style="width:100%" v-model="createForm.type">
                <option value="character">角色</option><option value="scene">场景</option><option value="prop">道具</option>
              </select>
            </label>
            <label class="col" style="gap:4px"><span class="xs muted">名称</span><input class="input" style="width:100%" v-model="createForm.name"></label>
            <label class="col" style="gap:4px"><span class="xs muted">描述</span><textarea class="input" style="width:100%; height:64px; padding:8px" v-model="createForm.description"></textarea></label>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="createOpen = false">取消</button>
          <button class="btn primary" :disabled="!createForm.name" @click="create">创建素材</button>
        </div>
      </div>
    </div>

    <!-- 素材详情 Drawer（P0-5：五标签结构） -->
    <div v-if="detailOpen" class="scrim" style="z-index:80" @click="detailOpen = false"></div>
    <aside v-if="detailOpen" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail?.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 项目素材</span></h3>
        <button class="icon-btn" @click="detailOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="tabs" style="padding:0 16px">
        <span v-for="t in drawerTabs" :key="t.key" class="tab" :class="{ on: activeTab === t.key }" @click="activeTab = t.key">{{ t.label }}</span>
      </div>
      <div class="drawer-b" style="overflow:auto">

        <!-- 标签 1：概览：当前图大图 + 资料编辑 -->
        <div v-if="activeTab === 'overview'">
          <div v-if="detail?.currentImage" style="border-radius:10px; overflow:hidden; margin-bottom:12px; max-height:280px">
            <img :src="detail.currentImage" style="width:100%; display:block">
          </div>
          <div v-else class="ph-big">当前图空缺——到「版本与候选」标签点击候选或先生成一张</div>
          <div class="sec-t">资料编辑</div>
          <div v-if="profileError" class="err-line">{{ profileError }}</div>
          <div v-if="profileSaved" class="ok-line">资料已保存</div>
          <label class="col" style="gap:4px; margin-bottom:8px"><span class="xs muted">名称</span>
            <input class="input" style="width:100%" v-model="editForm.name">
          </label>
          <label class="col" style="gap:4px; margin-bottom:10px"><span class="xs muted">描述</span>
            <textarea class="input" style="width:100%; height:64px; padding:8px" v-model="editForm.description"></textarea>
          </label>
          <button class="btn primary" :disabled="savingProfile" @click="saveProfile">{{ savingProfile ? '保存中…' : '保存资料' }}</button>
        </div>

        <!-- 标签 2：版本与候选：候选缩略图 + 撤销横条 + 人物状态切换条 -->
        <div v-if="activeTab === 'versions'">
          <div v-if="undoStrip" class="undo-strip">
            <span>已设为当前图</span>
            <button class="btn ghost undo-btn" @click="undoUseCandidate">撤销</button>
          </div>
          <div class="sec-t cand-head">候选 <span class="muted" style="font-weight:400">· 点击候选即设为当前图</span>
            <button class="btn ghost head-gen-btn" :disabled="generating" @click="openGenSheet"><svg style="width:13px;height:13px"><use href="#i-spark"/></svg>生成候选</button>
          </div>
          <div class="cand-row">
            <div v-for="c in detail?.candidates || []" :key="c.candidateId" class="cand" :class="{ cur: c.isCurrent }" @click="useCandidate(c)">
              <div class="im"><img :src="c.url" style="width:100%;height:100%;object-fit:cover"></div>
              <div class="cap" :class="c.isCurrent ? 'ok-t' : ''">{{ c.isCurrent ? '当前图' : providerLabel(c.provider) }} · {{ shortTime(c.createdAt) }}</div>
            </div>
            <div class="cand"><div class="im" style="border:1px dashed var(--line-strong); display:flex; align-items:center; justify-content:center; color:var(--muted); cursor:pointer" @click="openGenSheet"><svg style="width:18px;height:18px"><use href="#i-plus"/></svg></div><div class="cap">生成</div></div>
          </div>
          <template v-if="detail?.assetType === 'character'">
            <div class="sec-t">人物状态 <span class="muted" style="font-weight:400">· 点击状态卡把该状态图设为人物当前图</span></div>
            <div class="state-row" v-if="(detail?.states || []).length">
              <div v-for="s in detail?.states || []" :key="s.id" class="state-card" @click="applyStateToCurrent(s)">
                <div class="im">
                  <img v-if="s.imageUrl" :src="s.imageUrl" style="width:100%;height:100%;object-fit:cover">
                  <span v-else class="ph-txt">无图</span>
                </div>
                <div class="cap">{{ s.name }}<span v-if="s.isDefault" class="badge ok def-badge">默认</span></div>
                <button class="mini-btn" @click.stop="openStateGenSheet(s)">生成该状态候选</button>
              </div>
            </div>
            <p v-else class="muted" style="font-size:12px">该人物还没有状态（如"常服 / 夜班服"），可经制作包导入或状态管理创建</p>
          </template>
        </div>

        <!-- 标签 3：使用位置 -->
        <div v-if="activeTab === 'usage'">
          <p v-if="(detail?.usage || []).length === 0" class="muted empty-tip">尚未被任何剧集使用</p>
          <template v-else>
            <router-link v-for="u in detail?.usage || []" :key="u.kind + '-' + u.episodeId" class="usage-row" :to="`/projects/${projectId}/episodes/${u.episodeId}/script`">
              <b>第 {{ u.episodeNumber ?? '—' }} 集</b>
              <span class="badge">{{ usageLabel(u.kind) }}</span>
              <span class="muted go-tip">打开剧本 ›</span>
            </router-link>
          </template>
        </div>

        <!-- 标签 4：生成记录 -->
        <div v-if="activeTab === 'records'">
          <p v-if="(detail?.records || []).length === 0" class="muted empty-tip">还没有生成或上传记录——到「版本与候选」标签生成第一张候选图</p>
          <div v-for="r in detail?.records || []" :key="r.candidateId" class="record-row">
            <div class="kv"><span class="k">时间</span><span class="v">{{ shortTime(r.createdAt) || '—' }}</span></div>
            <div class="kv"><span class="k">通道</span><span class="v">{{ providerLabel(r.provider) }}</span></div>
            <div class="kv"><span class="k">结果</span><span class="v" :class="r.status === 'succeeded' ? 'ok-t' : ''">{{ recordStatusLabel(r.status) }}</span></div>
            <div class="kv" v-if="r.prompt"><span class="k">提示词</span><span class="v prompt-txt">{{ r.prompt }}</span></div>
          </div>
        </div>

        <!-- 标签 5：高级：只读信息 + 危险区 -->
        <div v-if="activeTab === 'advanced'">
          <div class="sec-t">只读信息</div>
          <div class="kv"><span class="k">素材 ID</span><span class="v">{{ detail?.id }}</span></div>
          <div class="kv"><span class="k">类型</span><span class="v">{{ typeLabel(detail?.assetType) }}</span></div>
          <div class="kv"><span class="k">创建时间</span><span class="v">{{ shortTime(detail?.createdAt) || '—' }}</span></div>
          <div class="kv"><span class="k">更新时间</span><span class="v">{{ shortTime(detail?.updatedAt) || '—' }}</span></div>
          <div class="kv"><span class="k">候选数</span><span class="v">{{ (detail?.candidates || []).length }}</span></div>
          <div class="kv"><span class="k">状态数</span><span class="v">{{ (detail?.states || []).length }}</span></div>
          <div class="sec-t" style="color:var(--danger)">危险区</div>
          <div class="danger-zone">
            <p class="muted" style="margin:0; font-size:12px; line-height:1.6">移入回收站后素材不再出现在项目素材列表，可在高级数据工具中恢复删除。</p>
            <button class="btn danger" @click="askRemove"><svg><use href="#i-trash"/></svg>移入回收站</button>
          </div>
        </div>
      </div>
    </aside>

    <!-- 删除确认 Modal（B7：确认先行，确认后才调用删除） -->
    <div v-if="removeOpen" class="scrim" style="z-index:100" @click="removeOpen = false"></div>
    <div v-if="removeOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>移入回收站</h3>
          <button class="icon-btn" @click="removeOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div v-if="removeError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-bottom:12px">{{ removeError }}</div>
          <p style="margin:0; line-height:1.6">素材「{{ detail?.name || '—' }}」会移入回收站，可恢复删除。确认移入？</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="removeOpen = false">取消</button>
          <button class="btn danger" :disabled="removing" @click="confirmRemove">{{ removing ? '删除中…' : '确认删除' }}</button>
        </div>
      </div>
    </div>

    <!-- 生成确认 Sheet（P0-7：生成前确认对象 / 通道 / 参数 / 费用） -->
    <div v-if="genSheetOpen" class="scrim" style="z-index:100" @click="genSheetOpen = false"></div>
    <div v-if="genSheetOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-spark"/></svg>
          <h3>生成候选</h3>
          <button class="icon-btn" @click="genSheetOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="col" style="gap:12px">
            <div v-if="genError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px">{{ genError }}</div>
            <div class="kv"><span class="k">对象</span><span class="v">{{ typeLabel(detail?.assetType) }} · {{ detail?.name || '—' }}<template v-if="genStateName"> · 状态：{{ genStateName }}</template></span></div>
            <div class="kv"><span class="k">生成通道</span><span class="v">本地生成（mock 通道）</span></div>
            <div class="kv"><span class="k">画布尺寸</span><span class="v">{{ genSize }}</span></div>
            <label class="col" style="gap:4px"><span class="xs muted">提示词（可编辑）</span>
              <textarea class="input" style="width:100%; height:64px; padding:8px" v-model="genPrompt"></textarea>
            </label>
            <div class="kv"><span class="k">任务与费用</span><span class="v">1 个生成任务 · 本地生成，不产生 API 费用</span></div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="genSheetOpen = false">取消</button>
          <button class="btn primary" :disabled="generating" @click="confirmGenerate">{{ generating ? '生成中…' : '确认生成' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectAssetsView',
  data() {
    return {
      items: [], type: 'all', q: '',
      createOpen: false, createForm: { type: 'character', name: '', description: '' },
      detailOpen: false, detail: null, generating: false, projectTitle: '',
      notice: '',
      removeOpen: false, removing: false, removeError: '',
      genSheetOpen: false, genPrompt: '', genSize: '720x480', genError: '',
      // P0-5：五标签结构（当前标签名存组件 state；URL 深链 Phase 5 统一做）
      activeTab: 'overview',
      drawerTabs: [
        { key: 'overview', label: '概览' },
        { key: 'versions', label: '版本与候选' },
        { key: 'usage', label: '使用位置' },
        { key: 'records', label: '生成记录' },
        { key: 'advanced', label: '高级' },
      ],
      editForm: { name: '', description: '' },
      savingProfile: false, profileError: '', profileSaved: false,
      // P0-8：候选撤销横条（5 秒或下次操作前可撤销）
      undoStrip: null, undoTimer: null,
      // P0-6：状态候选生成（打开既有生成 Sheet，prompt 注入状态名并透传 stateId）
      genStateId: null, genStateName: '',
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    allItems() { return this._all || [] },
    allCount() { return this.allItems.length },
    blockedCount() { return this.allItems.filter((i) => i.blocked).length },
    grouped() {
      const groups = []
      for (const key of ['character', 'scene', 'prop']) {
        if (this.type !== 'all' && this.type !== key) continue
        const items = this.allItems.filter((i) => i.assetType === key)
        if (items.length === 0 && this.type === 'all') continue
        groups.push({
          key,
          label: { character: '人物', scene: '场景资产', prop: '道具' }[key],
          items,
        })
      }
      return groups
    },
  },
  mounted() {
    this.load()
    v21.getOverview(this.projectId).then((o) => { this.projectTitle = o.hero.title }).catch(() => {})
  },
  methods: {
    async load() {
      const data = await v21.listAssets(this.projectId, { type: this.type, q: this.q })
      this.items = data.items || []
      this._all = await v21.listAssets(this.projectId, { type: 'all', q: this.q }).then((d) => d.items || [])
    },
    setType(t) { this.type = t; this.load() },
    countOf(t) { return this.allItems.filter((i) => i.assetType === t).length },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    providerLabel(p) {
      return { mock: '本地生成', upload: 'URL 上传' }[p] || p || '—'
    },
    usageLabel(kind) {
      return { cast: '出演', scene: '场景', prop: '道具', selection: '本集引用' }[kind] || kind
    },
    recordStatusLabel(s) {
      return { succeeded: '成功', failed: '失败', pending: '进行中', running: '进行中', cancelled: '已取消' }[s] || s || '—'
    },
    shortTime(t) {
      return typeof t === 'string' ? t.slice(0, 16).replace('T', ' ') : ''
    },
    async create() {
      await v21.createAsset(this.projectId, { type: this.createForm.type, fields: { name: this.createForm.name, description: this.createForm.description } })
      this.createOpen = false
      this.createForm = { type: this.createForm.type, name: '', description: '' }
      this.load()
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.id)
      this.activeTab = 'overview'
      this.editForm = { name: this.detail.name || '', description: this.detail.description || '' }
      this.profileError = ''
      this.profileSaved = false
      this.undoStrip = null
      this.genStateId = null
      this.genStateName = ''
      this.detailOpen = true
    },
    // 概览标签：资料编辑保存（PATCH /assets/:type/:assetId），保存中/失败在标签内呈现
    async saveProfile() {
      if (!this.detail || this.savingProfile) return
      this.savingProfile = true
      this.profileError = ''
      this.profileSaved = false
      try {
        await v21.updateAsset(this.detail.assetType, this.detail.id, { name: this.editForm.name, description: this.editForm.description })
        this.detail.name = this.editForm.name
        this.detail.description = this.editForm.description
        this.profileSaved = true
        this.load()
      } catch (e) {
        this.profileError = e.message || '保存失败，请重试'
      } finally {
        this.savingProfile = false
      }
    },
    // 换图后统一本地同步 + 弹出「已设为当前图｜撤销」横条（5 秒或下次操作前可撤销）
    applyCurrentResult(result) {
      this.detail.currentImage = result.current.imageUrl
      for (const c of this.detail.candidates || []) c.isCurrent = c.url === result.current.imageUrl
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.undoStrip = { previousUrl: result.previous.imageUrl }
      this.undoTimer = setTimeout(() => { this.undoStrip = null }, 5000)
    },
    async useCandidate(candidate) {
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
        this.applyCurrentResult(result)
        this.load()
      } catch (e) {
        this.notice = e.message || '候选设为当前图失败'
      }
    },
    // P0-8：撤销 = useCandidate 传回旧指针（响应 previous 字段）
    async undoUseCandidate() {
      if (!this.undoStrip || !this.detail) return
      const previousUrl = this.undoStrip.previousUrl
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.undoStrip = null
      if (!previousUrl) return
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, imageUrl: previousUrl })
        this.applyCurrentResult(result)
        if (this.undoTimer) clearTimeout(this.undoTimer)
        this.undoStrip = null
        this.load()
      } catch (e) {
        this.notice = e.message || '撤销失败，可在候选列表重新选择'
      }
    },
    // P0-6：点击状态卡 = 把该状态图应用为人物当前图（useCandidate 传状态 imageUrl）
    async applyStateToCurrent(s) {
      if (!this.detail || !s || !s.imageUrl) return
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, imageUrl: s.imageUrl })
        this.applyCurrentResult(result)
        this.load()
      } catch (e) {
        this.notice = e.message || '状态图设为当前图失败'
      }
    },
    // P0-7：生成入口只负责打开确认 Sheet，确认后才真正生成
    openGenSheet() {
      if (!this.detail) return
      this.genStateId = null
      this.genStateName = ''
      this.genPrompt = this.detail.name || ''
      // 画布尺寸按素材类型的展示比例取默认值（人物 3:4 · 场景 16:9 · 道具 1:1）
      this.genSize = { character: '720x960', scene: '1280x720', prop: '720x720' }[this.detail.assetType] || '720x480'
      this.genError = ''
      this.genSheetOpen = true
    },
    // P0-6：为指定状态生成候选——打开既有生成 Sheet，prompt 注入状态名并透传 stateId
    openStateGenSheet(s) {
      if (!this.detail || !s) return
      this.genStateId = s.id
      this.genStateName = s.name
      this.genPrompt = `${this.detail.name || ''}，状态：${s.name}`
      this.genSize = { character: '720x960', scene: '1280x720', prop: '720x720' }[this.detail.assetType] || '720x480'
      this.genError = ''
      this.genSheetOpen = true
    },
    async confirmGenerate() {
      if (!this.detail || this.generating) return
      this.generating = true
      this.genError = ''
      try {
        await v21.generateAssetCandidate(this.projectId, { type: this.detail.assetType, assetId: this.detail.id, prompt: this.genPrompt, size: this.genSize, stateId: this.genStateId || null })
        this.genStateId = null
        this.genStateName = ''
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.load()
        this.genSheetOpen = false
        this.notice = '已生成候选'
      } catch (e) {
        // 失败时 Sheet 仍打开，错误必须呈现在 Sheet 体内（页面 notice 会被遮罩遮挡）
        this.genError = e.message || '候选生成失败'
      } finally {
        this.generating = false
      }
    },
    // B7：删除确认先行——弹窗确认后才调一次 deleteAsset；失败/阻塞时素材保留
    askRemove() {
      if (!this.detail) return
      this.removeError = ''
      this.removeOpen = true
    },
    async confirmRemove() {
      if (!this.detail || this.removing) return
      this.removing = true
      this.removeError = ''
      try {
        const result = await v21.deleteAsset(this.detail.assetType, this.detail.id)
        if (result.blocked) {
          // 弹窗仍打开，阻塞原因呈现在弹窗体内（页面 notice 会被遮罩遮挡）
          this.removeError = result.message || '该素材仍被引用，暂不能删除'
          return
        }
        this.removeOpen = false
        this.detailOpen = false
        this.load()
        this.notice = '已移入回收站'
      } catch (e) {
        this.removeError = e.message || '删除失败，素材已保留'
      } finally {
        this.removing = false
      }
    },
    comingSoon(name) {
      this.notice = `${name}将在本迭代内启用`
    },
  },
}
</script>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat { display: flex; align-items: center; gap: 12px; padding: 13px 16px; }
.stat.warn .ic { background: var(--warn-subtle); color: var(--warn); }
.stat .ic { width: 36px; height: 36px; border-radius: 9px; background: var(--accent-subtle); color: var(--accent); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.stat .ic svg { width: 17px; height: 17px; }
.stat b { font-size: 18px; display: block; }
.stat span { font-size: 12px; color: var(--muted); }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.sec-label { font-size: 13px; font-weight: 600; margin: 4px 0 10px; }
.sec-label .hint { font-weight: 400; font-size: 11.5px; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 13px; margin-bottom: 20px; }
.acard { cursor: pointer; overflow: hidden; }
.acard .thumb { position: relative; overflow: hidden; }
.acard.character .thumb { height: 200px; }
.acard.scene .thumb { height: 144px; }
.acard.prop .thumb { height: 144px; display: flex; align-items: center; justify-content: center; background: #10131b; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard .st { position: absolute; left: 8px; bottom: 8px; z-index: 2; }
.acard .info { padding: 8px 12px 10px; }
.acard .info b { font-size: 13.5px; display: block; }
.acard .info p { font-size: 11.5px; color: var(--muted); margin-top: 2px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cand-row { display: flex; gap: 10px; flex-wrap: wrap; }
.cand { width: 110px; cursor: pointer; }
.cand .im { height: 104px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; }
.cand.cur .im { border: 2px solid var(--ok); }
.cand .cap { font-size: 10.5px; color: var(--muted); text-align: center; margin-top: 4px; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; letter-spacing: .3px; }
.ptabs { display: flex; gap: 4px; background: var(--panel2); border-radius: 8px; padding: 3px; }
.ptab { padding: 6px 16px; border-radius: 6px; font-size: 13px; color: var(--muted); cursor: pointer; }
.ptab.on { background: var(--accent-subtle); color: #fff; font-weight: 500; }
/* 五标签抽屉 */
.cand-head { display: flex; align-items: center; gap: 6px; }
.head-gen-btn { margin-left: auto; height: 26px; padding: 0 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.undo-strip { display: flex; align-items: center; gap: 12px; background: var(--ok-subtle); color: var(--ok); border-radius: 8px; padding: 7px 12px; font-size: 12.5px; margin-bottom: 10px; }
.undo-btn { height: 24px; padding: 0 12px; font-size: 12px; color: var(--ok); border-color: rgba(69, 211, 156, .4); }
.state-row { display: flex; gap: 10px; flex-wrap: wrap; }
.state-card { width: 110px; cursor: pointer; }
.state-card .im { height: 84px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; display: flex; align-items: center; justify-content: center; background: #10131b; }
.state-card .im .ph-txt { font-size: 11px; color: var(--muted); }
.state-card .cap { font-size: 11.5px; margin-top: 5px; display: flex; align-items: center; gap: 5px; }
.def-badge { font-size: 10px; padding: 0 6px; }
.mini-btn { margin-top: 4px; width: 100%; height: 22px; font-size: 10.5px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
.mini-btn:hover { color: var(--text-2); border-color: var(--line-strong); }
.usage-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 8px; color: var(--text); text-decoration: none; font-size: 13px; }
.usage-row:hover { border-color: var(--line-strong); }
.usage-row .go-tip { margin-left: auto; font-size: 11.5px; }
.record-row { border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; margin-bottom: 8px; }
.record-row .prompt-txt { max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; vertical-align: bottom; }
.err-line { background: var(--danger-subtle); color: var(--danger); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
.ok-line { background: var(--ok-subtle); color: var(--ok); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
.empty-tip { text-align: center; padding: 32px 0; font-size: 12.5px; }
.ph-big { border: 1px dashed var(--line-strong); border-radius: 10px; padding: 40px 16px; text-align: center; font-size: 12.5px; color: var(--muted); margin-bottom: 12px; }
.danger-zone { border: 1px solid rgba(255, 107, 120, .35); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.ph-0 { background: radial-gradient(120% 100% at 75% 15%, rgba(124,92,255,.30), transparent 55%), linear-gradient(155deg, #1c2440 0%, #0e1424 60%, #141b2e 100%); }
.ph-1 { background: radial-gradient(130% 100% at 70% 80%, rgba(255,182,92,.25), transparent 55%), linear-gradient(160deg, #2a1d33 0%, #10131f 60%, #191225 100%); }
.ph-2 { background: radial-gradient(120% 100% at 25% 20%, rgba(69,211,156,.22), transparent 55%), linear-gradient(150deg, #10281f 0%, #0c1622 65%, #122032 100%); }
.ph-3 { background: radial-gradient(120% 100% at 50% 10%, rgba(88,166,255,.30), transparent 55%), linear-gradient(165deg, #101b33 0%, #0b1220 60%, #0f1a2c 100%); }
.ph-4 { background: radial-gradient(110% 90% at 30% 75%, rgba(179,160,255,.22), transparent 55%), linear-gradient(150deg, #1d1830 0%, #0d101c 60%, #151228 100%); }
.ph-5 { background: radial-gradient(120% 90% at 75% 60%, rgba(69,211,156,.18), transparent 55%), linear-gradient(155deg, #14243a 0%, #0c1220 65%, #101c30 100%); }
</style>
