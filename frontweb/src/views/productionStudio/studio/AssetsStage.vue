<template>
  <div style="flex:1; display:flex; flex-direction:column; min-height:0; overflow:auto">
    <div class="notice-strip" :class="readinessClass" style="margin-top:12px">
      <svg style="width:14px;height:14px"><use :href="readiness.status === 'ready' ? '#i-check-c' : '#i-warn'"/></svg>
      {{ readinessText }}
      <div class="spacer"></div>
      <span style="text-decoration:underline dotted; text-underline-offset:3px; cursor:pointer" @click="recheck">重新检查</span>
    </div>
    <div v-if="notice" class="notice-strip warn" style="margin-top:8px">
      <svg style="width:14px;height:14px"><use href="#i-warn"/></svg>
      {{ notice }}
      <div class="spacer"></div>
      <span style="text-decoration:underline dotted; text-underline-offset:3px; cursor:pointer" @click="notice = ''">关闭</span>
    </div>

    <div class="atoolbar">
      <div class="tabs" style="border:none">
        <span v-for="t in tabs" :key="t.id" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
          {{ t.label }}<span class="cnt">{{ (referenced[t.id] || []).length }}</span>
        </span>
      </div>
      <div class="spacer"></div>
      <span class="muted xs">仅显示本集剧本引用的素材 · 完整资料在「项目素材」维护</span>
      <button class="btn primary" style="height:36px" :disabled="entering" @click="enterStoryboard">进入分镜</button>
    </div>

    <div class="agrid">
      <!-- 加载中显示骨架占位，避免空态文案抢跑（G6） -->
      <div v-if="loading" style="grid-column:1/-1">
        <StateBlock state="loading" />
      </div>
      <div v-for="(item, i) in referenced[tab] || []" :key="item.assetId" class="card acard" :class="{ miss: item.blocked }" @click="openDetail(item, i)">
        <div class="thumb" :class="[item.currentImage ? '' : 'ph', 'ph-' + (i % 6)]">
          <img v-if="item.currentImage" :src="item.currentImage" style="width:100%;height:100%;object-fit:cover">
          <span class="st badge" :class="item.blocked ? 'danger' : 'ok'">{{ item.blocked ? '缺当前图' : '已准备' }}</span>
        </div>
        <div class="info"><b>{{ item.name }}</b><p>{{ item.description || typeLabel(item.assetType) + ' · 本集引用' }}</p></div>
      </div>
      <p v-if="!loading && (referenced[tab] || []).length === 0" class="xs muted" style="padding:12px">本集剧本没有引用{{ tabLabel }}</p>
    </div>

    <!-- 素材详情抽屉（09） -->
    <div v-if="detailOpen" class="scrim" style="z-index:80" @click="detailOpen = false"></div>
    <aside v-if="detailOpen" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail?.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 本集设定</span></h3>
        <span class="badge" :class="detail?.blocked ? 'danger' : 'ok'">{{ detail?.blocked ? '缺当前图' : '已准备' }}</span>
        <button class="icon-btn" @click="detailOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="ed-thumb">
          <div class="main" :class="detail?.currentImage ? '' : 'ph'">
            <img v-if="detail?.currentImage" :src="detail.currentImage" style="width:100%;height:100%;object-fit:cover;border-radius:8px">
          </div>
          <div class="grow col" style="gap:10px">
            <div>
              <div class="sec-t" style="margin:0 0 7px">状态切换</div>
              <div class="stchips">
                <span v-for="st in detail?.states || []" :key="st.id" class="stchip" :class="{ on: st.id === selectedStateId }" @click="selectState(st)">{{ st.name }}</span>
                <span class="stchip" style="border-style:dashed" @click="variantModalOpen = true"><svg style="width:11px;height:11px"><use href="#i-plus"/></svg>新增状态</span>
              </div>
            </div>
            <div class="kv" style="border-top:1px solid var(--line); padding-top:10px"><span class="k">本集使用</span><span class="v">固定版本指针</span></div>
            <div class="kv"><span class="k">出现于</span><span class="v">{{ usedInText }}</span></div>
            <div v-if="detail?.assetType === 'character'" class="kv"><span class="k">人物音色</span>
              <span class="v">
                <span class="chip" style="height:24px; cursor:pointer" @click="voiceOpen = true">
                  <svg style="width:12px;height:12px;color:var(--accent)"><use href="#i-vol"/></svg>{{ voiceLabel }}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div class="sec-t">当前形象与候选 <span class="muted" style="font-weight:400">· 点击候选即设为当前图</span></div>
        <div class="cand-row">
          <div v-for="c in detail?.candidates || []" :key="c.candidateId" class="cand" :class="{ cur: c.isCurrent }" @click="useCandidate(c)">
            <div class="im"><img :src="c.url" style="width:100%;height:100%;object-fit:cover"></div>
            <div class="cap" :class="c.isCurrent ? 'ok-t' : ''">{{ c.isCurrent ? '当前图' : '候选 ' + c.candidateId }}</div>
          </div>
          <div class="cand"><div class="im" style="border:1px dashed var(--line-strong); display:flex; align-items:center; justify-content:center; color:var(--muted); cursor:pointer" @click="generate"><svg style="width:18px;height:18px"><use href="#i-plus"/></svg></div><div class="cap">生成候选</div></div>
        </div>

        <div class="sec-t">简短资料</div>
        <div class="kv"><span class="k">描述</span><span class="v">{{ detail?.description || '—' }}</span></div>

        <div class="row" style="margin-top:14px; padding:9px 12px; border:1px solid var(--line); border-radius:8px; cursor:pointer" @click="techOpen = !techOpen">
          <svg style="width:14px;height:14px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="small t2">技术详情</span>
          <span class="muted xs">快照 hash · 修订记录 · 生成参数</span>
        </div>
        <div v-if="techOpen" class="xs muted" style="padding:8px 12px; line-height:1.8">
          素材 ID：{{ detail?.id }} · 类型：{{ detail?.assetType }}<br>
          状态数：{{ detail?.states?.length || 0 }} · 候选数：{{ detail?.candidates?.length || 0 }}<br>
          变化只影响未来选择，已确认剧集快照不受影响。
        </div>
      </div>
      <div class="drawer-f">
        <button class="btn" @click="uploadImage"><svg><use href="#i-upload"/></svg>上传图片</button>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="generating" @click="generate"><svg><use href="#i-spark"/></svg>生成候选</button>
      </div>
    </aside>

    <!-- 人物音色抽屉（34） -->
    <div v-if="voiceOpen" class="scrim" style="z-index:80" @click="voiceOpen = false"></div>
    <aside v-if="voiceOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>人物音色 <span class="muted" style="font-weight:400; font-size:12px">· {{ detail?.name }}</span></h3>
        <span class="badge" :class="voiceChoice && voiceChoice.type !== 'default' ? 'ok' : 'warn'">{{ voiceChoice && voiceChoice.type !== 'default' ? '已设置' : '未设置' }}</span>
        <button class="icon-btn" @click="voiceOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="notice-card warn" style="margin-bottom:4px">
          <svg><use href="#i-warn"/></svg>
          <span>本集有对白将参考人物音色生成配音；未设置时使用模型默认声音，不阻断进入分镜。</span>
        </div>
        <div class="sec-t">预设音色</div>
        <div v-for="p in voicePresets" :key="p.id" class="v-opt" :class="{ on: voiceChoice?.type === 'preset' && voiceChoice?.presetId === p.id }" @click="pickPreset(p)">
          <span class="rad"></span>
          <div class="grow"><b style="font-size:13px">{{ p.name }}</b><div class="vm">{{ p.desc }}</div></div>
          <span class="xs muted" style="flex:0 0 auto">暂无样音</span>
        </div>
        <div class="v-opt" v-if="legacyVoiceUrl" :class="{ on: voiceChoice?.type === 'upload' && voiceChoice?.url === legacyVoiceUrl }" @click="voiceChoice = { type: 'upload', name: '已认证音色', url: legacyVoiceUrl }">
          <span class="rad"></span>
          <div class="grow"><b style="font-size:13px">已认证音色</b><div class="vm">来自角色音色资产（seedance2 voice）</div></div>
          <span class="v-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <button class="btn sm ghost" style="border:1px solid var(--line)" @click.stop="voiceChoice = { type: 'upload', name: '已认证音色', url: legacyVoiceUrl }">试听</button>
        </div>
        <div class="sec-t">上传 / 素材库</div>
        <div class="row" style="gap:8px; flex-wrap:wrap; align-items:center">
          <label class="btn sm" style="border:1px solid var(--line)">
            上传音频<input type="file" accept=".mp3,.wav,.m4a,.ogg,audio/*" style="display:none" @change="uploadVoice">
          </label>
          <button class="btn sm" @click="loadLibraryVoices">从素材库选择</button>
          <button class="btn sm" disabled title="依赖 Provider 音色提取能力（P2）">从音视频提取</button>
        </div>
        <p v-if="voiceUploading" class="xs muted" style="margin-top:6px">音频上传中…</p>
        <div v-if="libraryVoices.length" class="col" style="margin-top:9px; gap:6px">
          <div v-for="lv in libraryVoices" :key="lv.id" class="v-row" style="margin-bottom:0" :class="{ cur: voiceChoice?.type === 'library' && voiceChoice?.libraryId === lv.id }" @click="voiceChoice = { type: 'library', libraryId: lv.id, name: lv.name }">
            <span class="vn"><svg style="width:14px;height:15px"><use href="#i-doc"/></svg></span>
            <div><b style="font-size:12.5px">{{ lv.name }}</b><div class="vm">{{ lv.category || '素材库音色' }}</div></div>
          </div>
        </div>
        <audio v-if="previewVoiceUrl" controls :src="previewVoiceUrl" style="width:100%; margin-top:10px; height:34px"></audio>
        <p class="xs muted" style="margin-top:6px">{{ voiceChoice?.url ? '试听当前音色' : '选择带音频文件的音色后可试听' }}</p>
        <div class="divider"></div>
        <div class="row" style="padding:9px 12px; border:1px solid var(--line); border-radius:8px; cursor:pointer" @click="voiceChoice = { type: 'default', name: '模型默认声音' }">
          <svg style="width:14px;height:14px;color:var(--muted);flex:0 0 auto"><use href="#i-fwd"/></svg>
          <div class="grow">
            <b style="font-size:12.5px">改用模型默认声音</b>
            <div class="xs muted" style="margin-top:2px">本集声音策略改为「默认」 · 音色条件立即解除</div>
          </div>
          <span v-if="voiceChoice?.type === 'default'" class="badge ok" style="height:20px">当前</span>
        </div>
      </div>
      <div class="drawer-f">
        <span class="muted xs">选择保存后自动重新检查 · 只影响本集配音生成</span>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="voiceSaving" @click="saveVoice">{{ voiceSaving ? '保存中…' : '用于本集' }}</button>
      </div>
    </aside>

    <!-- 新增人物状态 Modal（B5） -->
    <div v-if="variantModalOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <h3>新增状态（人物状态）</h3>
          <button class="icon-btn" @click="variantModalOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <label class="col" style="gap:4px">
            <span class="xs muted">状态名称</span>
            <input class="input" style="width:100%" v-model="variantName" placeholder="如：受伤 · 夜晚">
          </label>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="variantModalOpen = false">取消</button>
          <button class="btn primary" :disabled="!variantName.trim() || variantSaving" @click="createVariant">{{ variantSaving ? '创建中…' : '创建' }}</button>
        </div>
      </div>
    </div>

    <!-- 图片 URL 输入 Modal（C1：专用容器） -->
    <div v-if="imgUrlOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <h3>上传图片 URL</h3>
          <button class="icon-btn" @click="imgUrlOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <input class="input" style="width:100%" v-model="imgUrlText" placeholder="https:// …">
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="imgUrlOpen = false">取消</button>
          <button class="btn primary" :disabled="!imgUrlText.trim()" @click="confirmImageUrl">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import v21 from '@/v21/api.js'
import StateBlock from '@/components/v21/StateBlock.vue'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'AssetsStage',
  mixins: [escMixin],
  components: { StateBlock },
  props: { projectId: String, episodeId: String },
  data() {
    return {
      tab: 'characters',
      tabs: [
        { id: 'characters', label: '角色' },
        { id: 'scenes', label: '场景' },
        { id: 'props', label: '道具' },
      ],
      referenced: { characters: [], scenes: [], props: [] },
      loading: false,
      readiness: { status: 'checking' },
      detailOpen: false, detail: null, generating: false, entering: false,
      selectedStateId: '', selectionMediaVersionId: null, techOpen: false,
      voiceOpen: false, voiceChoice: null, legacyVoiceUrl: '',
      libraryVoices: [], voiceUploading: false, voiceSaving: false,
      variantModalOpen: false, variantName: '', variantSaving: false,
      imgUrlOpen: false, imgUrlText: '', notice: '',
      voicePresets: [
        { id: 'preset-cold', name: '青城夜雨 · 低沉偏冷', desc: '女声 · 冷调叙事 · 适合悬疑氛围' },
        { id: 'preset-warm', name: '晨光 · 清亮温和', desc: '女声 · 日常对话 · 亲和自然' },
        { id: 'preset-deep', name: '夜行者 · 沉稳低音', desc: '男声 · 低沉 mystery · 适合旁白' },
      ],
    }
  },
  computed: {
    readinessText() {
      const missing = this.readiness.missing?.length || 0
      return {
        checking: '正在准备素材…',
        ready: '本集设定已准备好',
        'needs-attention': `本集设定有 ${missing} 项可稍后处理`,
        'snapshot-failed': '素材快照保存失败，媒体生成已暂停',
        'script-unapproved': '确认剧本后才能生成本集媒体',
      }[this.readiness.status] || '正在准备素材…'
    },
    readinessClass() {
      return { ready: 'ok', 'needs-attention': 'warn', 'snapshot-failed': 'warn', 'script-unapproved': 'warn', checking: '' }
    },
    tabLabel() {
      return { characters: '角色', scenes: '场景', props: '道具' }[this.tab] || ''
    },
    usedInText() {
      const key = this.detail?.assetType === 'scene' ? 'scenes' : this.detail?.assetType === 'prop' ? 'props' : 'characters'
      const item = (this.referenced[key] || []).find((x) => x.assetId === this.detail?.id)
      return item ? '本集引用' : '未在本集引用'
    },
    voiceLabel() {
      const c = this.voiceChoice
      if (!c) return '未设置 · 点击选择'
      if (c.type === 'default') return '模型默认声音'
      const preset = this.voicePresets.find((x) => x.id === c.presetId)
      return preset ? preset.name : (c.name || '已选择')
    },
    previewVoiceUrl() {
      return this.voiceChoice?.url || ''
    },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.load()
  },
  methods: {
    // Esc 自上而下关本视图的弹层（URL 弹窗 → 新增状态弹窗 → 音色抽屉 → 素材详情抽屉）
    onEsc() {
      if (this.imgUrlOpen) { this.imgUrlOpen = false; return true }
      if (this.variantModalOpen) { this.variantModalOpen = false; return true }
      if (this.voiceOpen) { this.voiceOpen = false; return true }
      if (this.detailOpen) { this.detailOpen = false; return true }
      return false
    },
    async load() {
      this.loading = true
      try {
        const data = await v21.getEpisodeAssets(this.episodeId)
        this.referenced = data.referenced
        this.readiness = data.readiness
      } catch (e) {
        this.notice = e.message || '本集设定加载失败'
      } finally {
        this.loading = false
      }
    },
    async recheck() {
      await this.load()
    },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    async openDetail(item) {
      try {
        this.detail = await v21.getAssetDetail(item.assetType, item.assetId)
      } catch (e) {
        this.notice = e.message || '素材详情加载失败'
        return
      }
      // B5：集级选择指针合并进本地 state（getAssetDetail 无 episodeId，指针以本集引用投影为准）
      this.selectedStateId = item.stateId || (this.detail.states?.[0]?.id ?? '')
      this.selectionMediaVersionId = item.mediaVersionId ?? null
      // B4：预选已保存的音色指针
      this.voiceChoice = item.voice || null
      this.legacyVoiceUrl = ''
      if (item.assetType === 'character') {
        try {
          const res = await axios.get(`/api/v1/characters/${item.assetId}`)
          const row = res.data?.data || res.data
          const asset = row?.seedance2_voice_asset
          if (asset && String(asset.status || '').toLowerCase() === 'active' && asset.url) {
            this.legacyVoiceUrl = asset.url
          }
        } catch { /* 无音色资产时静默 */ }
      }
      this.detailOpen = true
    },
    pickPreset(p) {
      this.voiceChoice = { type: 'preset', presetId: p.id, name: p.name }
    },
    // B5：状态选择持久化（stateId + 当前媒体指针一并落库，失败写 notice 不静默）
    async selectState(st) {
      this.selectedStateId = st.id
      try {
        await v21.updateSelection(this.episodeId, {
          assetType: this.detail.assetType,
          assetId: this.detail.id,
          stateId: st.id,
          mediaVersionId: this.selectionMediaVersionId ?? null,
        })
      } catch (e) {
        this.notice = e.message || '状态保存失败，刷新后会回到上次保存的状态'
      }
    },
    async uploadVoice(event) {
      const file = event.target.files && event.target.files[0]
      if (!file || this.detail?.assetType !== 'character') return
      this.voiceUploading = true
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await axios.post(`/api/v1/characters/${this.detail.id}/sd2-voice-upload`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        const row = res.data?.data || res.data
        const url = row?.url || row?.payload?.url || null
        this.voiceChoice = { type: 'upload', name: file.name, url }
      } catch (err) {
        this.notice = err?.response?.data?.error?.message || err.message || '音频上传失败'
      } finally {
        this.voiceUploading = false
        event.target.value = ''
      }
    },
    async loadLibraryVoices() {
      try {
        const res = await axios.get('/api/v1/character-library', { params: { limit: 50 } })
        const rows = res.data?.data?.items || res.data?.items || res.data?.data || []
        this.libraryVoices = (Array.isArray(rows) ? rows : []).slice(0, 20)
      } catch {
        this.libraryVoices = []
      }
    },
    async saveVoice() {
      if (this.detail?.assetType !== 'character') {
        this.voiceOpen = false
        return
      }
      this.voiceSaving = true
      try {
        // B5：携带当前选择指针，避免 updateSelection 把 state_id/media_version_id 覆盖为空
        await v21.updateSelection(this.episodeId, {
          assetType: 'character',
          assetId: this.detail.id,
          stateId: this.selectedStateId || '',
          mediaVersionId: this.selectionMediaVersionId ?? null,
          voice: this.voiceChoice,
        })
        this.voiceOpen = false
        this.load()
      } catch (e) {
        this.notice = e.message || '音色保存失败'
      } finally {
        this.voiceSaving = false
      }
    },
    async createVariant() {
      this.variantSaving = true
      try {
        await axios.post(`/api/v1/characters/${this.detail.id}/variants`, { name: this.variantName.trim() })
        this.variantModalOpen = false
        this.variantName = ''
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.load()
      } catch (e) {
        this.notice = e?.response?.data?.error?.message || e.message || '状态创建失败'
      } finally {
        this.variantSaving = false
      }
    },
    openImageUrl() {
      this.imgUrlText = ''
      this.imgUrlOpen = true
    },
    async confirmImageUrl() {
      const url = this.imgUrlText.trim()
      if (!url) return
      this.imgUrlOpen = false
      // B6：上传走素材候选端点（仅入候选，不改当前图），而非分镜图片上传
      try {
        await v21.uploadAssetCandidate(this.detail.assetType, this.detail.id, url)
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.notice = '已添加候选，点击候选可设为当前图'
      } catch (e) {
        this.notice = e.message || '图片上传失败'
      }
    },
    async generate() {
      this.generating = true
      try {
        await v21.generateAssetCandidate(this.projectId, {
          type: this.detail.assetType,
          assetId: this.detail.id,
          // 默认提示词优先素材已保存的生图提示词，回退素材名
          prompt: this.detail.prompt || this.detail.name,
        })
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.load()
      } catch (e) {
        this.notice = e.message || '候选生成失败'
      } finally {
        this.generating = false
      }
    },
    async useCandidate(candidate) {
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
        this.detail.currentImage = result.current.imageUrl
        for (const c of this.detail.candidates || []) c.isCurrent = c.candidateId === candidate.candidateId
        // 评审修复：换图后把新指针落库到本集选择行（含回退到旧图的路径）——
        // 只同步本地的话，重开抽屉会从引用投影合并回旧 mediaVersionId，下次状态/音色保存把旧图写回
        this.selectionMediaVersionId = result.current.imageUrl
        try {
          await v21.updateSelection(this.episodeId, {
            assetType: this.detail.assetType,
            assetId: this.detail.id,
            stateId: this.selectedStateId || '',
            mediaVersionId: result.current.imageUrl,
          })
        } catch (e) {
          this.notice = e.message || '本集选择指针同步失败'
        }
        this.load()
      } catch (e) {
        this.notice = e.message || '候选设为当前图失败'
      }
    },
    async uploadImage() {
      // C1：图片 URL 输入改走专用 Modal
      this.openImageUrl()
    },
    async enterStoryboard() {
      this.entering = true
      let failed = false
      try {
        const result = await v21.enterStoryboard(this.episodeId)
        if (result.readiness && result.readiness.status === 'script-unapproved') {
          this.notice = '确认剧本后才能生成本集媒体；仍可进入分镜查看结构'
        } else if (result.readiness && result.readiness.status === 'needs-attention') {
          this.notice = `有 ${result.readiness.missing.length} 项可稍后处理，已进入分镜`
        }
      } catch (e) {
        this.notice = e.message || '进入分镜失败'
        failed = true
      } finally {
        this.entering = false
      }
      // 评审修复：导航移出 try，路由跳转自身的异常不再误报为"进入分镜失败"
      if (!failed) this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`)
    },
  },
}
</script>

<style scoped>
.atoolbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; padding: 16px; }
.acard { cursor: pointer; overflow: hidden; }
.acard .thumb { position: relative; aspect-ratio: 16 / 9; height: auto; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard .st { position: absolute; left: 8px; top: 8px; z-index: 2; }
.acard .info { padding: 10px 12px 12px; }
.acard .info b { font-size: 13.5px; }
.acard .info p { margin: 3px 0 0; font-size: 11.5px; color: var(--muted); }
.ed-thumb { display: flex; gap: 14px; }
.ed-thumb .main { width: 168px; height: 224px; border-radius: 10px; overflow: hidden; flex: 0 0 auto; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; letter-spacing: .3px; }
.stchips { display: flex; gap: 6px; flex-wrap: wrap; }
.stchip {
  height: 26px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--panel2); color: var(--muted);
  font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
}
.stchip.on { border-color: var(--accent); background: var(--accent-subtle); color: #fff; }
.cand-row { display: flex; gap: 10px; flex-wrap: wrap; }
.cand { width: 120px; cursor: pointer; }
.cand .im { height: 114px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; overflow: hidden; }
.cand.cur .im { border: 2px solid var(--ok); }
.cand .cap { font-size: 10.5px; color: var(--muted); text-align: center; margin-top: 4px; }
.v-row .vn { font-size: 14px; }
</style>
