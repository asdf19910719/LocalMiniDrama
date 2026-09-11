<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>资产库</h1>
      <span class="sub">跨项目复用 · 本地素材</span>
      <div class="spacer"></div>
      <button class="btn primary" style="height:36px" @click="openAddSelector"><svg><use href="#i-plus"/></svg>添加到资产库</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">

      <div v-if="notice" class="notice-strip" :class="noticeType">
        <span style="flex:1">{{ notice }}</span>
        <button class="btn ghost sm" @click="notice = ''">关闭</button>
      </div>

      <div class="toolbar">
        <div class="seg">
          <span :class="{ on: type === 'all' }" @click="type = 'all'">全部 {{ totalAll }}</span>
          <span :class="{ on: type === 'character' }" @click="type = 'character'">人物 {{ countOf('character') }}</span>
          <span :class="{ on: type === 'scene' }" @click="type = 'scene'">场景 {{ countOf('scene') }}</span>
          <span :class="{ on: type === 'prop' }" @click="type = 'prop'">道具 {{ countOf('prop') }}</span>
        </div>
        <div class="input" style="width:220px">
          <svg><use href="#i-search"/></svg>
          <input v-model="q" placeholder="搜索素材名称" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13px" @input="load">
        </div>
        <div class="spacer"></div>
        <span class="muted xs">人物 3:4 · 场景 16:9 · 道具 1:1 · 音色以波形卡展示</span>
      </div>

      <!-- 三分状态机：加载骨架 → 错误重试 → 内容（加载完成前不渲染空态） -->
      <StateBlock v-if="loading && !loaded" state="loading" />
      <StateBlock v-else-if="loadError" state="error" :message="'资产库加载失败：' + loadError" @retry="load" />
      <template v-else>
        <div v-for="grp in grouped" :key="grp.key">
          <div class="sec-label">{{ grp.label }} <span class="hint muted">· {{ grp.items.length }} 项 · 点击打开详情抽屉</span></div>
          <div class="agrid">
            <div v-for="(item, i) in grp.items" :key="grp.key + item.id" class="card acard" :class="[grp.key, { offline: !item.local_path && !item.image_url }]" @click="openDetail(grp.key, item)">
              <div class="thumb" :class="item.image_url ? 'has-img' : 'ph ph-' + ((i + grp.key.length) % 6)">
                <img v-if="item.image_url" :src="item.image_url">
                <span v-if="!item.local_path && !item.image_url" class="st badge danger">文件不可访问</span>
              </div>
              <div class="info"><b>{{ item.name || item.location }}</b><p>{{ descOf(item) }}</p></div>
            </div>
          </div>
        </div>
        <!-- 空态区分：筛选无结果（清除条件） vs 资产库真空态 -->
        <StateBlock
          v-if="grouped.length === 0"
          state="empty"
          :icon="hasFilter ? '#i-search' : '#i-cube'"
          :message="hasFilter ? '没有匹配的资产：换个关键词或类型页签，或清除条件后重试' : '资产库为空 · 从项目素材或本地导入添加'"
        >
          <button v-if="hasFilter" class="btn" @click="clearFilters">清除条件</button>
        </StateBlock>
      </template>
    </div>

    <!-- 资产库详情抽屉（33） -->
    <div v-if="detail" class="scrim" style="z-index:80" @click="detail = null"></div>
    <aside v-if="detail" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 资产库</span></h3>
        <span class="badge outline">{{ typeLabel(detail._kind) }}</span>
        <span v-if="!detail.local_path && !detail.image_url" class="badge danger">文件不可访问</span>
        <button class="icon-btn" @click="detail = null"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="row" style="gap:16px; align-items:flex-start; margin-bottom:14px">
          <div class="thumb-prev" :class="detail.image_url ? '' : 'ph'">
            <img v-if="detail.image_url" :src="detail.image_url">
          </div>
          <div class="grow col" style="gap:2px; min-width:0">
            <div class="kv"><span class="k">类型</span><span class="v">{{ typeLabel(detail._kind) }}</span></div>
            <div class="kv"><span class="k">描述</span><span class="v">{{ detail.description || '—' }}</span></div>
            <div class="kv"><span class="k">当前版本</span><span class="v">v1</span></div>
          </div>
        </div>
        <div class="sec-t">来源与许可</div>
        <div class="kv"><span class="k">来源</span><span class="v">{{ detail.source_type || '本地导入' }}</span></div>
        <div class="sec-t">文件状态</div>
        <div class="kv"><span class="k">状态</span><span class="v" :class="detail.local_path || detail.image_url ? 'ok-t' : 'danger-t'">{{ detail.local_path || detail.image_url ? '可访问' : '文件不可访问' }}</span></div>
        <div class="kv"><span class="k">本地路径</span><span class="v mono xs">{{ detail.local_path || detail.image_url || '—' }}</span></div>
        <div class="notice-card info" style="margin-top:14px">
          <svg><use href="#i-shield"/></svg>
          <span>被项目引用的资产只能归档，不能物理删除；用于项目时选择「使用这个版本」固定当前版本，不随库更新漂移。</span>
        </div>
      </div>
      <div class="drawer-f">
        <button class="btn ghost" style="border:1px solid var(--line)" @click="comingSoon('归档')">归档</button>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="!detail.local_path && !detail.image_url" @click="useInProject">用于项目</button>
      </div>
    </aside>

    <!-- 用于项目向导 -->
    <div v-if="useOpen" class="scrim" style="z-index:80" @click="useOpen = false"></div>
    <div v-if="useOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:460px">
        <div class="modal-h"><h3>用于项目</h3><button class="icon-btn" @click="useOpen = false"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-b">
          <div class="col" style="gap:12px">
            <label class="col" style="gap:4px"><span class="xs muted">目标项目</span>
              <select class="input" style="width:100%" v-model="useTarget">
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
              </select>
            </label>
            <div class="row" style="gap:6px; padding:9px 12px; border:1px solid var(--line); border-radius:8px">
              <span class="xs" style="color:var(--ok); line-height:1.6">使用这个版本（固定 v1）— 库更新不会自动影响项目。</span>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="useOpen = false">取消</button>
          <button class="btn primary" :disabled="!useTarget" @click="doUseInProject">复制到项目素材</button>
        </div>
      </div>
    </div>

    <!-- 添加到资产库：入口选择器 / 本地导入向导 / 从项目保存向导（P0-13） -->
    <div v-if="addOpen" class="scrim" style="z-index:80" @click="closeAdd"></div>
    <div v-if="addOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:520px">
        <div class="modal-h">
          <h3>{{ addModalTitle }}</h3>
          <span v-if="addPath" class="muted xs">第 {{ addStep }} / 3 步</span>
          <button class="icon-btn" @click="closeAdd"><svg><use href="#i-close"/></svg></button>
        </div>

        <div class="modal-b">
          <!-- 入口选择器：两条路径卡 -->
          <div v-if="!addPath" class="col" style="gap:10px">
            <div class="add-path-card" @click="chooseAddPath('local')">
              <b>从本地文件添加</b>
              <p class="xs muted">上传本机图片，命名后直接入资产库</p>
            </div>
            <div class="add-path-card" @click="chooseAddPath('project')">
              <b>从现有项目保存</b>
              <p class="xs muted">挑选项目内的人物 / 场景 / 道具素材，复制一份进资产库</p>
            </div>
          </div>

          <!-- 第 3 步：结果 / 同来源冲突处理 / 项目保存确认（两向导共用） -->
          <div v-else-if="(addPath === 'local' && localStep === 3) || (addPath === 'project' && projStep === 3)" class="col" style="gap:12px">
            <div v-if="addDone" class="col" style="gap:6px; text-align:center; padding:20px 0">
              <b>已入库</b>
              <span class="xs muted">「{{ addDoneName }}」已保存到个人资产库</span>
            </div>
            <div v-else-if="conflict" class="col" style="gap:10px">
              <div class="row" style="gap:6px; padding:9px 12px; border:1px solid rgba(255,182,92,.3); border-radius:8px; background:var(--warn-subtle)">
                <span class="xs" style="color:var(--warn); line-height:1.6">资产库已有同来源条目：{{ conflict.existing.name || '（未命名）' }}。可复用现有条目，或另存独立副本。</span>
              </div>
              <div class="row" style="gap:10px; align-items:stretch">
                <div class="col" style="flex:1; gap:6px; padding:10px; border:1px solid var(--line); border-radius:8px">
                  <span class="xs muted">库中现有</span>
                  <img v-if="conflict.existing.image_url" :src="conflict.existing.image_url" style="width:100%;height:96px;object-fit:cover;border-radius:6px">
                  <b class="xs">{{ conflict.existing.name || '（未命名）' }}</b>
                  <span class="xs muted">{{ typeLabel(conflict.pending.kind) }} · 来源 {{ conflict.existing.source_type || '—' }}</span>
                </div>
                <div class="col" style="flex:1; gap:6px; padding:10px; border:1px dashed var(--accent); border-radius:8px">
                  <span class="xs muted">本次待保存</span>
                  <img v-if="conflict.pending.image_url" :src="conflict.pending.image_url" style="width:100%;height:96px;object-fit:cover;border-radius:6px">
                  <label class="col" style="gap:2px"><span class="xs muted">名称（可改）</span>
                    <input class="input" style="width:100%" v-model="conflictName">
                  </label>
                  <span class="xs muted">{{ typeLabel(conflict.pending.kind) }} · 来源 {{ conflict.pending.source_type === 'local-import' ? '本地导入' : '项目素材' }}</span>
                </div>
              </div>
              <p v-if="conflict.pending.source_type === 'project-asset'" class="xs muted" style="line-height:1.6">独立副本与原条目共用同一图片文件；后续再次保存同一素材时，仍会提示同来源供你选择处理方式。</p>
              <p v-if="addError" class="xs" style="color:var(--danger)">{{ addError }}</p>
            </div>
            <div v-else-if="addPath === 'project' && projAsset" class="col" style="gap:10px">
              <div class="row" style="gap:12px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:8px">
                <img v-if="projAsset.currentImage" :src="projAsset.currentImage" style="width:72px;height:72px;object-fit:cover;border-radius:8px">
                <div class="col" style="gap:4px">
                  <b>{{ projAsset.name }}</b>
                  <span class="xs muted">类型：{{ projAsset.typeLabel }} · 来源：项目素材</span>
                  <span class="xs muted">来源项目：{{ projProjectTitle || '—' }}</span>
                </div>
              </div>
              <p v-if="addError" class="xs" style="color:var(--danger)">{{ addError }}</p>
              <p v-if="saving" class="xs muted">正在保存…</p>
            </div>
            <p v-else class="xs muted">正在处理…</p>
          </div>

          <!-- 从本地文件添加：步骤 1 / 2 -->
          <div v-else-if="addPath === 'local'" class="col" style="gap:12px">
            <div v-if="localStep === 1" class="col" style="gap:12px">
              <label class="col" style="gap:4px"><span class="xs muted">名称</span>
                <input class="input" style="width:100%" v-model="localForm.name" placeholder="资产名称">
              </label>
              <div class="col" style="gap:4px"><span class="xs muted">类型</span>
                <div class="seg">
                  <span :class="{ on: localForm.kind === 'character' }" @click="localForm.kind = 'character'">人物</span>
                  <span :class="{ on: localForm.kind === 'scene' }" @click="localForm.kind = 'scene'">场景</span>
                  <span :class="{ on: localForm.kind === 'prop' }" @click="localForm.kind = 'prop'">道具</span>
                </div>
              </div>
              <label class="col" style="gap:4px"><span class="xs muted">描述（可选）</span>
                <textarea class="input" rows="2" style="width:100%;resize:vertical" v-model="localForm.description" placeholder="一句话描述，便于复用时识别"></textarea>
              </label>
              <div class="col" style="gap:6px"><span class="xs muted">图片文件</span>
                <input type="file" accept="image/*" @change="onLocalFileChange">
                <div v-if="localForm.upload" class="row" style="gap:8px; align-items:center">
                  <img :src="localForm.upload.url" style="width:56px;height:56px;object-fit:cover;border-radius:8px">
                  <span class="badge ok">已上传</span>
                  <span class="xs muted">{{ localForm.upload.filename }}</span>
                </div>
                <p v-if="localUploadError" class="xs" style="color:var(--danger)">{{ localUploadError }}</p>
              </div>
            </div>
            <div v-else-if="localStep === 2" class="col" style="gap:12px">
              <div class="row" style="gap:12px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:8px">
                <img v-if="localForm.upload" :src="localForm.upload.url" style="width:72px;height:72px;object-fit:cover;border-radius:8px">
                <div class="col" style="gap:4px">
                  <b>{{ localForm.name }}</b>
                  <span class="xs muted">类型：{{ typeLabel(localForm.kind) }} · 来源：本地导入</span>
                  <span v-if="localForm.description" class="xs muted">{{ localForm.description }}</span>
                </div>
              </div>
              <p class="xs muted">确认后写入个人资产库；同来源已存在时会先给出处理选择。</p>
            </div>
          </div>

          <!-- 从现有项目保存：步骤 1 / 2 -->
          <div v-else class="col" style="gap:12px">
            <div v-if="projStep === 1" class="col" style="gap:12px">
              <label class="col" style="gap:4px"><span class="xs muted">选择项目（不含已归档）</span>
                <select class="input" style="width:100%" v-model="projProjectId">
                  <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
                </select>
              </label>
              <p v-if="projError" class="xs" style="color:var(--danger)">{{ projError }}</p>
              <p v-if="projects.length === 0" class="xs muted">暂无可用项目</p>
            </div>
            <div v-else-if="projStep === 2" class="col" style="gap:8px">
              <span class="xs muted">选择素材（单选）</span>
              <div class="col" style="gap:6px; max-height:300px; overflow:auto">
                <label v-for="a in projAssets" :key="a.assetType + '-' + a.id" class="row" style="gap:8px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; cursor:pointer; align-items:center" :style="String(a.id) === String(projAssetId) ? 'border-color:var(--accent)' : ''">
                  <input type="radio" name="proj-asset" :value="a.id" v-model="projAssetId">
                  <img v-if="a.currentImage" :src="a.currentImage" style="width:36px;height:36px;object-fit:cover;border-radius:6px">
                  <span class="badge neutral">{{ a.typeLabel }}</span>
                  <b class="xs">{{ a.name }}</b>
                </label>
                <p v-if="projAssets.length === 0 && !projLoading" class="xs muted">该项目暂无可保存素材</p>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-f" v-if="!addPath">
          <button class="btn ghost" @click="closeAdd">取消</button>
        </div>
        <div class="modal-f" v-else-if="addStep === 3">
          <template v-if="addDone">
            <button class="btn primary" @click="closeAdd">完成</button>
          </template>
          <template v-else-if="conflict">
            <button class="btn ghost" @click="backFromConflict">返回修改</button>
            <button class="btn ghost" @click="useExistingItem">使用已有条目</button>
            <button class="btn primary" :disabled="!conflictName.trim() || saving" @click="stillCreateIndependent">仍创建独立条目</button>
          </template>
          <template v-else-if="addPath === 'project'">
            <button class="btn ghost" @click="projStep = 2">上一步</button>
            <button class="btn primary" :disabled="saving" @click="confirmProjectSave">确认保存</button>
          </template>
        </div>
        <div class="modal-f" v-else-if="addPath === 'local'">
          <template v-if="localStep === 1">
            <button class="btn ghost" @click="addPath = ''">上一步</button>
            <button class="btn primary" :disabled="localUploading || !localForm.name.trim() || !localForm.upload" @click="localStep = 2">下一步：预览</button>
          </template>
          <template v-else>
            <button class="btn ghost" @click="localStep = 1">上一步</button>
            <button class="btn primary" :disabled="saving || !localForm.upload" @click="confirmLocalImport">确认入库</button>
          </template>
        </div>
        <div class="modal-f" v-else>
          <template v-if="projStep === 1">
            <button class="btn ghost" @click="addPath = ''">上一步</button>
            <button class="btn primary" :disabled="!projProjectId" @click="chooseProject">下一步：选择素材</button>
          </template>
          <template v-else>
            <button class="btn ghost" @click="projStep = 1">上一步</button>
            <button class="btn primary" :disabled="!projAsset" @click="projStep = 3">下一步：确认</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import v21 from '@/v21/api.js'
import StateBlock from '@/components/v21/StateBlock.vue'
import { findConflictingItem } from '@/v21/libraryIdentity.js'
import { v21Toast } from '@/v21/ui.js'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'LibraryView',
  mixins: [escMixin],
  components: { StateBlock },
  data() {
    return {
      type: 'all', q: '', loaded: false, loading: false, loadError: '',
      chars: [], scenes: [], props: [],
      detail: null, useOpen: false, useTarget: '', projects: [],
      // 添加到资产库（P0-13）：入口选择器 + 双路径三步向导 + 同来源冲突处理
      addOpen: false, addPath: '', addDone: false, addDoneName: '', addError: '',
      localStep: 1, projStep: 1,
      conflict: null, conflictName: '',
      localForm: { name: '', kind: 'character', description: '', upload: null },
      localUploading: false, localUploadError: '',
      projProjectId: '', projAssets: [], projAssetId: '', projLoading: false, projError: '',
      saving: false,
      notice: '', noticeType: 'ok', noticeTimer: null,
    }
  },
  computed: {
    totalAll() { return this.chars.length + this.scenes.length + this.props.length },
    // 筛选空与真空态区分：有搜索词或类型页签非「全部」即为筛选态
    hasFilter() {
      return this.type !== 'all' || !!this.q.trim()
    },
    grouped() {
      const groups = []
      for (const [key, label, items] of [
        ['character', '人物', this.chars],
        ['scene', '场景', this.scenes],
        ['prop', '道具', this.props],
      ]) {
        if (this.type !== 'all' && this.type !== key) continue
        const filtered = this.q ? items.filter((i) => String(i.name || i.location || '').toLowerCase().includes(this.q.toLowerCase())) : items
        if (filtered.length === 0) continue
        groups.push({ key, label, items: filtered })
      }
      return groups
    },
    addStep() { return this.addPath === 'local' ? this.localStep : this.projStep },
    addModalTitle() {
      if (this.addPath === 'local') return '从本地文件添加'
      if (this.addPath === 'project') return '从现有项目保存'
      return '添加到资产库'
    },
    projAsset() {
      return this.projAssets.find((a) => String(a.id) === String(this.projAssetId)) || null
    },
    projProjectTitle() {
      const p = this.projects.find((x) => String(x.id) === String(this.projProjectId))
      return p ? p.title : ''
    },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.load()
  },
  beforeUnmount() { if (this.noticeTimer) clearTimeout(this.noticeTimer) },
  methods: {
    // Esc 自上而下关本视图的弹层（添加向导 → 用于项目弹窗 → 详情抽屉）
    onEsc() {
      if (this.addOpen) { this.closeAdd(); return true }
      if (this.useOpen) { this.useOpen = false; return true }
      if (this.detail) { this.detail = null; return true }
      return false
    },
    async load() {
      this.loading = true
      try {
        const [c, s, p] = await Promise.all([
          axios.get('/api/v1/character-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
          axios.get('/api/v1/scene-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
          axios.get('/api/v1/prop-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
        ])
        this.chars = c.map((x) => ({ ...x, _kind: 'character' }))
        this.scenes = s.map((x) => ({ ...x, _kind: 'scene' }))
        this.props = p.map((x) => ({ ...x, _kind: 'prop' }))
        this.loadError = ''
        // 数据到达后才置 loaded：加载中绝不渲染空态（原实现提前置位导致空态抢跑）
        this.loaded = true
      } catch (e) {
        // 失败呈现为可重试错误态，不再静默伪装成空态
        this.loadError = e.message || '网络错误'
      } finally {
        this.loading = false
      }
      try {
        const proj = await v21.listProjects({})
        this.projects = proj.items || []
      } catch { this.projects = [] }
    },
    countOf(t) {
      return { character: this.chars.length, scene: this.scenes.length, prop: this.props.length }[t] || 0
    },
    // 筛选空态清除条件：重置搜索词与类型页签（客户端筛选，grouped 计算属性即时生效）
    clearFilters() {
      this.q = ''
      this.type = 'all'
    },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    descOf(item) {
      return item.description || item._kind
    },
    itemsOf(kind) {
      return { character: this.chars, scene: this.scenes, prop: this.props }[kind] || []
    },
    flashNotice(type, text) {
      this.noticeType = type
      this.notice = text
      if (this.noticeTimer) clearTimeout(this.noticeTimer)
      this.noticeTimer = setTimeout(() => { this.notice = '' }, 4000)
    },
    openDetail(kind, item) {
      this.detail = { ...item, _kind: kind }
    },
    useInProject() {
      v21.listProjects({}).then((data) => { this.projects = data.items || [] })
      this.useOpen = true
    },
    async doUseInProject() {
      const item = this.detail
      try {
        await v21.createAsset(this.useTarget, {
          type: item._kind,
          fields: { name: item.name, description: item.description || '' },
        })
        this.useOpen = false
        // 遮罩下的跨层反馈：成功走全局 toast（P3.4 deferred）
        v21Toast(`已复制「${item.name}」到目标项目素材（复制独立副本，保留来源记录）`)
      } catch (e) {
        v21Toast(e.message, 'danger')
      }
    },
    comingSoon(name) {
      v21Toast(`${name}将在本迭代内启用`)
    },
    // ---------- 添加到资产库（P0-13） ----------
    openAddSelector() {
      this.resetAddFlow()
      this.addOpen = true
    },
    resetAddFlow() {
      this.addPath = ''
      this.localStep = 1
      this.projStep = 1
      this.addDone = false
      this.addDoneName = ''
      this.addError = ''
      this.conflict = null
      this.conflictName = ''
      this.localForm = { name: '', kind: 'character', description: '', upload: null }
      this.localUploading = false
      this.localUploadError = ''
      this.projProjectId = ''
      this.projAssets = []
      this.projAssetId = ''
      this.projLoading = false
      this.projError = ''
      this.saving = false
    },
    closeAdd() {
      this.addOpen = false
      this.resetAddFlow()
    },
    chooseAddPath(path) {
      this.addPath = path
      this.localStep = 1
      this.projStep = 1
      if (path === 'project') {
        v21.listProjects({}).then((data) => { this.projects = data.items || [] }).catch(() => {})
      }
    },
    async onLocalFileChange(event) {
      const file = event.target.files && event.target.files[0]
      if (!file) return
      this.localUploadError = ''
      this.localUploading = true
      this.localForm.upload = null
      try {
        const form = new FormData()
        form.append('file', file)
        const data = await axios.post('/api/v1/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
          .then((r) => (r.data && r.data.data) || {})
        this.localForm.upload = {
          url: data.url || '',
          path: data.path || data.local_path || '',
          filename: data.filename || file.name,
        }
        if (!this.localForm.name.trim()) {
          this.localForm.name = String(file.name || '').replace(/\.[^.]+$/, '')
        }
      } catch (e) {
        this.localUploadError = e?.response?.data?.error?.message || e.message || '上传失败'
      } finally {
        this.localUploading = false
        event.target.value = ''
      }
    },
    pendingFromLocal() {
      const upload = this.localForm.upload || {}
      return {
        kind: this.localForm.kind,
        name: this.localForm.name.trim(),
        description: this.localForm.description.trim(),
        image_url: upload.url || '',
        source_type: 'local-import',
        source_id: upload.filename || upload.path || '',
      }
    },
    pendingFromProject() {
      const asset = this.projAsset
      return {
        kind: asset.assetType,
        name: String(asset.name || '').trim(),
        description: String(asset.description || '').trim(),
        image_url: asset.currentImage || '',
        source_type: 'project-asset',
        source_id: `${asset.assetType}:${asset.id}`,
      }
    },
    confirmLocalImport() {
      const pending = this.pendingFromLocal()
      const existing = findConflictingItem(this.itemsOf(pending.kind), pending)
      if (existing) {
        this.openConflict(pending, existing)
        return
      }
      this.createLibraryEntry(pending)
    },
    async chooseProject() {
      if (!this.projProjectId) return
      this.projLoading = true
      this.projError = ''
      try {
        const data = await v21.listAssets(this.projProjectId, { type: 'all' })
        this.projAssets = data.items || []
        this.projAssetId = ''
        this.projStep = 2
      } catch (e) {
        // 弹窗开着时页面提示条会被 scrim 遮挡：错误就地呈现在弹窗体内
        this.projError = e.message || '素材列表加载失败'
      } finally {
        this.projLoading = false
      }
    },
    confirmProjectSave() {
      const asset = this.projAsset
      if (!asset) return
      const pending = this.pendingFromProject()
      const existing = findConflictingItem(this.itemsOf(pending.kind), pending)
      if (existing) {
        this.openConflict(pending, existing)
        return
      }
      this.createLibraryEntry(pending)
    },
    openConflict(pending, existing) {
      this.conflict = { pending, existing }
      this.conflictName = `${pending.name}（副本）`
    },
    backFromConflict() {
      this.conflict = null
      this.addDone = false
      this.addError = ''
      if (this.addPath === 'local') this.localStep = 2
      else this.projStep = 2
    },
    useExistingItem() {
      this.conflict = null
      this.closeAdd()
      this.flashNotice('ok', '已使用现有条目')
    },
    async stillCreateIndependent() {
      const conflict = this.conflict
      if (!conflict) return
      const name = this.conflictName.trim() || `${conflict.pending.name}（副本）`
      // 名称不影响来源指纹：另存副本需改 source_id（追加时间戳）绕开同源判定
      await this.createLibraryEntry({
        ...conflict.pending,
        name,
        source_id: `${conflict.pending.source_id}-${Date.now()}`,
      })
    },
    async createLibraryEntry(pending) {
      this.addError = ''
      this.saving = true
      try {
        const payload = {
          name: pending.name,
          description: pending.description,
          image_url: pending.image_url,
          source_type: pending.source_type,
          source_id: pending.source_id,
        }
        // 场景库 create 只认 location（sceneLibraryService.createLibraryItem 不读 name），同步场景名
        if (pending.kind === 'scene') payload.location = pending.name
        const resp = await v21.addToLibrary(pending.kind, payload)
        if (resp && resp.duplicated && resp.item) {
          this.openConflict(pending, { ...resp.item })
          return
        }
        this.addDoneName = pending.name
        this.finishAddSuccess()
      } catch (e) {
        this.addError = e.message || '入库失败'
      } finally {
        this.saving = false
      }
    },
    finishAddSuccess() {
      this.addDone = true
      this.load()
      // 入库成功：弹窗仍在遮罩下，notice 会被遮挡 → 用全局 toast 跨层反馈
      v21Toast(`「${this.addDoneName}」已保存到个人资产库`)
    },
  },
}
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; }
.sec-label { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .4px; margin: 4px 0 10px; }
.sec-label .hint { font-weight: 400; font-size: 11.5px; letter-spacing: 0; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 20px; }
.acard { cursor: pointer; overflow: hidden; }
.acard .thumb { position: relative; overflow: hidden; }
.acard.character .thumb { aspect-ratio: 3 / 4; height: auto; }
.acard.scene .thumb { aspect-ratio: 16 / 9; height: auto; }
.acard.prop .thumb { aspect-ratio: 1 / 1; height: auto; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard.offline .thumb { filter: grayscale(.7) brightness(.6); }
.acard .st { position: absolute; left: 8px; top: 8px; z-index: 2; }
.acard .info { padding: 8px 12px 10px; }
.acard .info b { font-size: 13.5px; display: block; }
.acard .info p { font-size: 11.5px; color: var(--muted); margin-top: 2px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thumb-prev { width: 120px; height: 160px; border-radius: 10px; overflow: hidden; flex: 0 0 auto; }
.acard.prop .thumb-prev, .drawer .thumb-prev { background: var(--panel2); }
.thumb-prev img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; letter-spacing: .3px; }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
.mono { font-family: Consolas, monospace; }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
.add-path-card { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; transition: border-color .15s, background .15s; }
.add-path-card:hover { border-color: var(--line-strong); background: var(--panel2); }
.add-path-card b { font-size: 14px; }
</style>
