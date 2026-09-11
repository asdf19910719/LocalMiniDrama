<template>
  <div style="flex:1; display:flex; min-height:0; position:relative">
    <!-- 左：场次导航 -->
    <div class="sn">
      <div class="sn-h">
        <div class="input" style="width:100%; height:30px; font-size:12.5px">
          <svg><use href="#i-search"/></svg>
          <input v-model="sceneQuery" placeholder="搜索场次" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:12.5px">
        </div>
        <div class="row muted xs" style="margin-top:8px">
          <span>{{ sceneStats.totalScenes || 0 }} 场次 · {{ (sceneStats.totalChars || 0).toLocaleString() }} 字</span>
          <div class="spacer"></div>
          <span v-if="sceneStats.estimatedSeconds">预计 {{ sceneStats.estimatedSeconds }}s</span>
        </div>
      </div>
      <div class="sn-list">
        <div v-for="(s, i) in filteredScenes" :key="i" class="sn-item" :class="{ on: selectedSceneIdx === i }" @click="selectScene(i)">
          <div class="t">
            <span class="no">S{{ i + 1 }}</span>{{ shortHeading(s.heading) }}
            <span v-if="selectedSceneIdx === i && dirty" class="badge accent" style="height:18px;padding:0 6px">编辑中</span>
          </div>
          <div class="d">{{ s.interiorExterior || '—' }} · {{ s.chars }} 字<template v-if="s.suggestion"> · {{ s.suggestion }}</template></div>
        </div>
        <p v-if="filteredScenes.length === 0" class="muted xs" style="padding:8px 10px">暂无场次；保存正文后自动解析</p>
      </div>
      <div style="padding:10px">
        <button class="btn ghost sm" style="width:100%; border:1px dashed var(--line-strong)" @click="appendScene">
          <svg><use href="#i-plus"/></svg>新建场次
        </button>
      </div>
    </div>

    <!-- 中：正文编辑器 -->
    <div class="ed">
      <div class="ed-head">
        <span class="ttl">{{ selectedHeading || '正文' }}</span>
        <div class="chip" v-if="selectedScene">{{ selectedScene.chars }} 字</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="aiMenuOpen = !aiMenuOpen">
          <svg style="color:var(--accent)"><use href="#i-spark"/></svg>AI 辅助
          <svg class="chev" style="width:13px;height:13px"><use href="#i-chev-d"/></svg>
        </button>
        <span class="muted xs">{{ dirty ? '未保存' : '已保存' }}</span>
      </div>
      <div class="ed-body" style="display:flex; flex-direction:column">
        <div class="sc-head" v-if="selectedScene">
          <span class="chip bold">场次标题 · {{ selectedScene.heading }}</span>
          <span class="chip">字数 · {{ selectedScene.chars }}</span>
        </div>
        <textarea
          ref="editor"
          v-model="draftText"
          class="ed-text"
          :disabled="!model || !model.draft"
          placeholder="第一场 内景·地点·时间 …"
          @input="markDirty"
          @mouseup="onSelect"
          @keyup.up.down.left.right="onSelect"
        ></textarea>
        <!-- 选段 AI 浮层 -->
        <div v-if="aiPop.visible" class="ai-pop" :style="{ top: aiPop.top + 'px', right: aiPop.right + 'px' }">
          <span @click="selectionAi('rewrite')"><svg><use href="#i-spark"/></svg>改写</span>
          <span @click="selectionAi('expand')"><svg><use href="#i-spark"/></svg>扩写</span>
          <span @click="selectionAi('shorten')"><svg><use href="#i-spark"/></svg>缩写</span>
          <span style="color:var(--muted)" @click="aiPop.visible = false">取消</span>
        </div>
      </div>
    </div>

    <!-- 右：当前上下文 -->
    <div class="ctx">
      <div class="card pad" style="padding:13px 14px">
        <div class="row" style="margin-bottom:8px"><b style="font-size:13px">修订状态</b><div class="spacer"></div><button class="btn ghost sm" @click="historyOpen = true">历史版本</button></div>
        <div class="row" style="gap:6px; flex-wrap:wrap">
          <span class="badge accent">当前 草稿 v{{ model?.draft?.revision ?? '—' }}</span>
          <template v-if="model?.approved">
            <svg class="muted" style="width:13px;height:13px"><use href="#i-fwd"/></svg>
            <span class="badge ok">已确认 v{{ model.approved.revision }}</span>
          </template>
        </div>
        <div class="muted xs" style="margin-top:8px">
          <template v-if="model?.approved">再次确认将创建新版本 v{{ preview?.revisionChain?.nextRevision ?? '—' }}，已确认的 v{{ model.approved.revision }} 保留可回看。</template>
          <template v-else>确认后将创建首个已确认版本。</template>
        </div>
      </div>

      <div class="card pad" style="padding:13px 14px">
        <b style="font-size:13px">确认前检查</b>
        <div class="ck-row"><svg :style="{color: blockers ? 'var(--danger)' : 'var(--ok)'}"><use :href="blockers ? '#i-warn' : '#i-check-c'"/></svg>场次 {{ preview?.check?.scenes ?? 0 }} · 字数 {{ (preview?.check?.chars ?? 0).toLocaleString() }} · 预计 {{ preview?.check?.estimatedSeconds ?? 0 }}s</div>
        <div class="ck-row"><svg :style="{color: blockers ? 'var(--danger)' : 'var(--ok)'}"><use :href="blockers ? '#i-warn' : '#i-check-c'"/></svg>阻塞项 {{ blockers }} · {{ blockers ? '无法确认' : '可以确认' }}</div>
        <div v-for="s in preview?.check?.suggestions || []" :key="s" class="ck-row"><svg style="color:var(--warn)"><use href="#i-warn"/></svg>建议 · {{ s }}</div>
      </div>

      <div class="card pad" style="padding:13px 14px">
        <b style="font-size:13px">预计素材变化</b>
        <div class="ck-row"><svg style="color:var(--warn)"><use href="#i-plus"/></svg>新增 {{ preview?.assetChanges?.added ?? 0 }} 场</div>
        <div class="ck-row"><svg style="color:var(--warn)"><use href="#i-refresh"/></svg>变化 {{ preview?.assetChanges?.changed ?? 0 }} 场</div>
        <div class="ck-row"><svg style="color:var(--muted)"><use href="#i-check"/></svg>删除候选 {{ preview?.assetChanges?.removed ?? 0 }}</div>
      </div>

      <div class="card pad" style="padding:13px 14px">
        <b style="font-size:13px">下游影响</b>
        <div class="ck-row"><svg style="color:var(--warn)"><use href="#i-warn"/></svg>{{ preview?.downstream?.storyboardPackagesStale ?? 0 }} 个镜头的分镜包将过期</div>
        <div class="ck-row"><svg style="color:var(--muted)"><use href="#i-image"/></svg>{{ preview?.downstream?.shotImagesKeep ?? 0 }} 张镜头图可保留，建议复核</div>
      </div>

      <div style="margin-top:auto; display:flex; flex-direction:column; gap:8px">
        <button class="btn primary" style="width:100%" :disabled="!canConfirm || busy" @click="openConfirm">
          {{ confirmLabel }}
        </button>
        <div class="muted xs" style="text-align:center">确认只创建新版本并标记过期，不会自动重新生成媒体。</div>
      </div>
    </div>

    <!-- 空态：三起点 -->
    <div v-if="model && !model.draft" class="blank-wrap">
      <h2 style="margin:0 0 6px">空白剧本</h2>
      <p class="muted" style="font-size:13px">选择一种开始方式，三者写入同一份草稿</p>
      <div class="starts">
        <div class="start-card" @click="mode = 'paste'">
          <h4>粘贴或导入剧本</h4><p>把现成文本粘贴进来</p>
        </div>
        <div class="start-card" @click="aiStart">
          <h4>AI 生成剧本</h4><p>从一句话想法开始（无 Key 时为本地示例草稿）</p>
        </div>
        <div class="start-card" @click="startBlank">
          <h4>直接开始写</h4><p>从空白编辑器开始</p>
        </div>
      </div>
      <div v-if="mode === 'paste'" style="width:640px">
        <textarea v-model="pasteText" class="ed-text" rows="10" placeholder="第一场 内景·地点·时间 …"></textarea>
        <button class="btn primary" style="margin-top:12px" :disabled="!pasteText.trim()" @click="saveDraft(pasteText)">保存为草稿</button>
      </div>
    </div>

    <!-- AI 候选 diff Modal -->
    <div v-if="candidateOpen" class="scrim" style="z-index:80" @click="candidateOpen = false"></div>
    <div v-if="candidateOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:760px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-spark"/></svg>
          <h3>AI 候选（先比较后应用）</h3>
          <button class="icon-btn" @click="candidateOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b diff-cols-wrap">
          <div class="diff-cols">
            <div class="dcol">
              <div class="dh"><span class="badge neutral">当前草稿</span></div>
              <div class="db"><span v-for="(l, i) in diffOld" :key="'o' + i" :class="l.cls">{{ l.text }}&nbsp;</span></div>
            </div>
            <div class="dcol">
              <div class="dh"><span class="badge accent">AI 候选 · +{{ candidate?.diff?.added || 0 }} / -{{ candidate?.diff?.removed || 0 }}</span></div>
              <div class="db"><span v-for="(l, i) in diffNew" :key="'n' + i" :class="l.cls">{{ l.text }}&nbsp;</span></div>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="candidateOpen = false">放弃</button>
          <button class="btn primary" @click="applyCandidate">应用到草稿</button>
        </div>
      </div>
    </div>

    <!-- 确认影响摘要 Modal（18） -->
    <div v-if="confirmOpen" class="scrim" style="z-index:80" @click="confirmOpen = false"></div>
    <div v-if="confirmOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:540px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-book"/></svg>
          <h3>确认{{ confirmLabel }} · 影响摘要</h3>
          <button class="icon-btn" @click="confirmOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="overflow:hidden">
          <div class="row" style="margin-bottom:10px">
            <span class="badge accent">草稿 v{{ preview?.revisionChain?.draftRevision }}</span>
            <svg class="muted" style="width:13px;height:13px"><use href="#i-fwd"/></svg>
            <span class="badge ok">新版本 v{{ preview?.revisionChain?.nextRevision }}</span>
            <div class="spacer"></div>
            <span class="muted xs">场次 {{ preview?.check?.scenes }} · 字数 {{ (preview?.check?.chars || 0).toLocaleString() }} · 预计 {{ preview?.check?.estimatedSeconds }}s</span>
          </div>
          <div class="imp-row">
            <div class="ic" style="background:var(--neutral-subtle); color:var(--muted)"><svg><use href="#i-doc"/></svg></div>
            <div><b>{{ preview?.assetChanges?.changed }} 个场次已修改</b><span>另有 {{ preview?.assetChanges?.added }} 个新增 / {{ preview?.assetChanges?.removed }} 个删除</span></div>
          </div>
          <div class="imp-row">
            <div class="ic" style="background:var(--warn-subtle); color:var(--warn)"><svg><use href="#i-clap"/></svg></div>
            <div><b>{{ preview?.downstream?.storyboardPackagesStale }} 个镜头的分镜包将过期</b><span>需要复核后重新生成</span></div>
          </div>
          <div class="imp-row">
            <div class="ic" style="background:var(--panel2); color:var(--muted)"><svg><use href="#i-image"/></svg></div>
            <div><b>{{ preview?.downstream?.shotImagesKeep }} 张镜头图可保留</b><span>未被本次修改影响 · 建议复核后继续使用</span></div>
          </div>
          <div class="divider" style="margin:12px 0 10px"></div>
          <div class="xs muted" style="line-height:1.6">确认只创建新剧本版本并标记过期对象，不会自动删除媒体、不会触发任何重新生成；被过期的内容可随时从历史版本恢复。</div>
        </div>
        <div class="modal-f" style="justify-content:space-between">
          <button class="btn ghost" @click="confirmOpen = false">查看影响明细</button>
          <span class="row">
            <button class="btn ghost" @click="confirmOpen = false">取消</button>
            <button class="btn primary" :disabled="busy" @click="doConfirm">确认新修订</button>
          </span>
        </div>
      </div>
    </div>

    <!-- 历史版本 Drawer（30） -->
    <div v-if="historyOpen" class="scrim" style="z-index:80" @click="historyOpen = false"></div>
    <aside v-if="historyOpen" class="drawer narrow" style="z-index:90; width:440px">
      <div class="drawer-h">
        <h3>历史版本 <span class="muted" style="font-weight:400; font-size:12px">· 剧本</span></h3>
        <button class="icon-btn" @click="historyOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-for="rev in model?.history || []" :key="rev.id" class="v-row" :class="{ cur: rev.status === 'draft' }">
          <span class="vn">v{{ rev.revision }}</span>
          <div>
            <b style="font-size:13px">{{ statusLabel(rev.status) }}</b>
            <div class="vm">{{ rev.chars }} 字 · {{ (rev.created_at || '').slice(0, 16).replace('T', ' ') }}<br>{{ rev.scene_count || 0 }} 场次 · {{ rev.source }}</div>
          </div>
          <div class="acts">
            <span v-if="rev.status === 'draft'" class="badge accent">编辑中</span>
            <template v-else>
              <button class="btn sm ghost" style="border:1px solid var(--line)" @click="compareWith(rev)">比较差异</button>
              <button class="btn sm" @click="derive(rev.revision)">从此派生</button>
            </template>
          </div>
        </div>
        <div class="card pad" style="display:flex; gap:9px; padding:11px 12px; border-color:rgba(88,166,255,.3)">
          <svg style="width:14px;height:14px;color:var(--info);flex:0 0 auto;margin-top:2px"><use href="#i-shield"/></svg>
          <span class="xs" style="color:var(--info); line-height:1.6">「从此派生」会把该版本内容复制为新草稿，不覆盖任何已有版本，也不会改动已确认版本。</span>
        </div>
      </div>
      <div class="drawer-f">
        <span class="muted xs">版本由确认与导入动作创建</span>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="!canConfirm" @click="openConfirm">确认{{ model?.approved ? '修改' : '剧本' }}</button>
      </div>
    </aside>

    <!-- 版本比较 Modal（29） -->
    <div v-if="diffOpen" class="scrim" style="z-index:80" @click="diffOpen = false"></div>
    <div v-if="diffOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:940px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-hist"/></svg>
          <h3>版本比较</h3>
          <span class="badge ok">v{{ diffData?.fromRevision }}</span>
          <svg class="muted" style="width:13px;height:13px"><use href="#i-fwd"/></svg>
          <span class="badge accent">v{{ diffData?.toRevision }}</span>
          <button class="icon-btn" @click="diffOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="overflow:auto; max-height:60vh">
          <div class="diff-nav">
            <span v-for="s in diffData?.scenes || []" :key="s.no" class="chip" :class="{ missing: s.status === 'removed' }" @click="diffScene = s">
              场次 {{ s.no }} · {{ diffStatusLabel(s.status) }}
            </span>
          </div>
          <div class="diff-cols" v-if="diffScene">
            <div class="dcol">
              <div class="dh"><span class="badge neutral">v{{ diffData.fromRevision }}</span><span class="muted xs">{{ diffScene.heading }}</span></div>
              <div class="db">
                <template v-for="(l, i) in diffScene.lines" :key="'l' + i">
                  <span v-if="l.type !== 'add'" :class="l.type === 'del' ? 'ln-del' : 'ln-same'">{{ l.text }}</span>
                </template>
              </div>
            </div>
            <div class="dcol">
              <div class="dh"><span class="badge accent">v{{ diffData.toRevision }}</span><span class="muted xs">{{ diffScene.heading }}</span></div>
              <div class="db">
                <template v-for="(l, i) in diffScene.lines" :key="'r' + i">
                  <span v-if="l.type !== 'del'" :class="l.type === 'add' ? 'ln-add' : 'ln-same'">{{ l.text }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="diffOpen = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue'
import v21 from '@/v21/api.js'

export default {
  name: 'ScriptStage',
  props: { projectId: String, episodeId: String },
  setup() {
    const studioSave = inject('studioSave', null)
    return { studioSave }
  },
  data() {
    return {
      model: null, draftText: '', dirty: false, saving: false, lastSavedAt: '',
      mode: '', pasteText: '', candidate: null, candidateOpen: false, historyOpen: false, diffOpen: false,
      sceneStats: {}, preview: null, sceneQuery: '', selectedSceneIdx: 0,
      confirmOpen: false, busy: false,
      aiMenuOpen: false, aiPop: { visible: false, top: 0, right: 60, text: '' },
      diffData: null, diffScene: null,
      diffOld: [], diffNew: [],
    }
  },
  computed: {
    filteredScenes() {
      const list = this.sceneStats.scenes || []
      if (!this.sceneQuery) return list
      const q = this.sceneQuery.toLowerCase()
      return list.filter((s) => s.heading.toLowerCase().includes(q))
    },
    selectedScene() {
      return (this.sceneStats.scenes || [])[this.selectedSceneIdx] || null
    },
    selectedHeading() {
      if (!this.model?.draft) return ''
      return this.selectedScene ? this.selectedScene.heading : '正文'
    },
    blockers() {
      return this.preview?.check?.blockers || 0
    },
    canConfirm() {
      return Boolean(this.model?.draft && String(this.draftText || '').trim() && !this.dirty && !this.saving)
    },
    confirmLabel() {
      return this.model?.approved ? '确认新版本' : '确认剧本'
    },
    diffOld() {
      return this.buildInlineDiff(this.model?.draft?.content || '', this.candidate?.text || '', 'old')
    },
    diffNew() {
      return this.buildInlineDiff(this.model?.draft?.content || '', this.candidate?.text || '', 'new')
    },
  },
  mounted() {
    this.load()
    this.keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (this.dirty) this.saveDraft(this.draftText, this.model?.draft?.revision)
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  },
  unmounted() {
    window.removeEventListener('keydown', this.keyHandler)
  },
  methods: {
    setSave(text, error = false) {
      if (this.studioSave) {
        this.studioSave.text = text
        this.studioSave.error = error
      }
    },
    async load() {
      this.model = await v21.getScript(this.episodeId)
      this.draftText = this.model.draft ? this.model.draft.content : ''
      this.dirty = false
      this.sceneStats = await v21.getSceneStats(this.episodeId)
      this.refreshPreview()
      this.setSave(this.model.draft ? '已保存' : '更改会自动保存')
    },
    async refreshPreview() {
      if (!this.model?.draft) { this.preview = null; return }
      try {
        this.preview = await v21.getConfirmPreview(this.episodeId)
      } catch { this.preview = null }
    },
    shortHeading(h) {
      return String(h || '').replace(/^(内景|外景)[·\s]*/, '')
    },
    selectScene(i) {
      this.selectedSceneIdx = i
    },
    markDirty() {
      this.dirty = true
      this.setSave('有未保存修改 · Ctrl+S 立即保存')
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.saveDraft(this.draftText, this.model?.draft?.revision), 800)
    },
    onSelect() {
      const el = this.$refs.editor
      if (!el) return
      const text = el.value.substring(el.selectionStart, el.selectionEnd).trim()
      if (text.length > 4) {
        this.aiPop = { visible: true, top: 140 + Math.random() * 40, right: 120, text }
      } else {
        this.aiPop.visible = false
      }
    },
    async selectionAi(mode) {
      const map = { rewrite: 'polish', expand: 'continue', shorten: 'polish' }
      this.candidate = await v21.generateAiCandidate(this.episodeId, {
        mode: map[mode] || 'polish',
        selection: this.aiPop.text,
      })
      this.aiPop.visible = false
      this.candidateOpen = true
    },
    async aiStart() {
      const cand = await v21.generateAiCandidate(this.episodeId, { mode: 'continue' })
      this.candidate = cand
      this.candidateOpen = true
    },
    startBlank() {
      this.saveDraft('第一场 内景·地点·时间\n').then(() => { this.mode = '' })
    },
    async saveDraft(content, expectedRevision) {
      if (this.saving) return null
      this.saving = true
      this.setSave('保存中…')
      try {
        const result = await v21.saveScriptDraft(this.episodeId, {
          content: content ?? this.draftText,
          expectedRevision: expectedRevision ?? this.model?.draft?.revision ?? null,
        })
        this.dirty = false
        const now = new Date()
        this.lastSavedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        this.setSave(`已保存 · ${this.lastSavedAt}`)
        await this.load()
        return result
      } catch (e) {
        this.setSave(e.code === 'REVISION_CONFLICT' ? '保存冲突：另一窗口已更新，请刷新比较' : `保存失败 · ${e.message}`, true)
        return null
      } finally {
        this.saving = false
      }
    },
    async appendScene() {
      const text = (this.draftText || '') + `\n第${(this.sceneStats.totalScenes || 0) + 1}场 内景·地点·时间\n`
      this.draftText = text
      await this.saveDraft(text, this.model?.draft?.revision)
      this.selectedSceneIdx = (this.sceneStats.scenes?.length || 1) - 1
    },
    openConfirm() {
      this.refreshPreview().then(() => { this.confirmOpen = true })
    },
    async doConfirm() {
      this.busy = true
      try {
        await v21.confirmScript(this.episodeId, this.model?.draft?.revision ?? null)
        this.confirmOpen = false
        await this.load()
        this.$emit('refresh')
      } finally {
        this.busy = false
      }
    },
    async applyCandidate() {
      await v21.applyAiCandidate(this.episodeId, this.candidate)
      this.candidateOpen = false
      await this.load()
    },
    statusLabel(status) {
      return { draft: '当前草稿', approved: '已确认版本', superseded: '已被取代', ready_for_review: '待确认' }[status] || status
    },
    diffStatusLabel(status) {
      return { changed: '有修改', added: '新增', removed: '已删除', same: '无变化' }[status] || status
    },
    async compareWith(rev) {
      const toRevision = this.model?.draft?.revision || rev.revision
      const from = rev.status === 'approved' ? rev.revision : rev.revision
      this.diffData = await v21.getScriptDiff(this.episodeId, from, toRevision)
      this.diffScene = (this.diffData.scenes || [])[0] || null
      this.historyOpen = false
      this.diffOpen = true
    },
    async derive(revision) {
      await v21.copyScriptHistory(this.episodeId, revision)
      this.historyOpen = false
      await this.load()
    },
    buildInlineDiff(oldText, newText, side) {
      const oldLines = String(oldText).split(/(?<=。)|\n/).filter((s) => s.trim())
      const newLines = String(newText).split(/(?<=。)|\n/).filter((s) => s.trim())
      const oldSet = new Set(oldLines)
      const newSet = new Set(newLines)
      const out = []
      if (side === 'old') {
        for (const l of oldLines) out.push({ text: l, cls: newSet.has(l) ? '' : 'del-frag' })
      } else {
        for (const l of newLines) out.push({ text: l, cls: oldSet.has(l) ? '' : 'add-frag' })
      }
      return out
    },
  },
}
</script>

<style scoped>
.sn { width: 240px; flex: 0 0 240px; border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; }
.sn-h { padding: 12px 14px 8px; }
.sn-list { flex: 1; overflow: auto; padding: 4px 8px; }
.sn-item { border: 1px solid transparent; border-radius: 8px; padding: 9px 10px; cursor: pointer; margin-bottom: 2px; }
.sn-item:hover { background: var(--panel2); }
.sn-item.on { border-color: var(--accent); background: var(--accent-subtle); }
.sn-item .t { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.sn-item .t .no { color: var(--muted); font-weight: 500; font-size: 12px; }
.sn-item .d { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
.ed { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ed-head { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.ed-head .ttl { font-weight: 600; font-size: 14px; }
.ed-body { flex: 1; overflow: auto; padding: 20px 28px; position: relative; }
.ed-text {
  width: 100%; min-height: 320px; flex: 1; resize: vertical;
  background: transparent; border: none; outline: none; color: var(--text-2);
  font-size: 14.5px; line-height: 1.9; font-family: inherit;
}
.sc-head { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; }
.sc-head .chip { background: var(--bg); }
.ai-pop { position: absolute; z-index: 20; display: flex; align-items: center; gap: 2px; background: var(--panel2); border: 1px solid var(--line-strong); border-radius: 9px; padding: 4px; box-shadow: var(--shadow); }
.ai-pop span { font-size: 12px; padding: 5px 9px; border-radius: 6px; cursor: pointer; color: var(--text-2); display: flex; align-items: center; gap: 5px; }
.ai-pop span:hover { background: var(--accent-subtle); color: #fff; }
.ai-pop span svg { width: 13px; height: 13px; color: var(--accent); }
.ctx { width: 320px; flex: 0 0 320px; border-left: 1px solid var(--line); background: var(--panel); padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.ck-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 5px 0; }
.ck-row svg { width: 14px; height: 14px; flex: 0 0 auto; }
.blank-wrap { position: absolute; inset: 0; background: var(--bg); z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
.starts { display: flex; gap: 16px; justify-content: center; margin: 20px 0; }
.start-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px 24px; cursor: pointer; width: 220px; text-align: left; }
.start-card:hover { border-color: var(--accent); }
.start-card h4 { margin: 0 0 6px; font-size: 14px; }
.start-card p { margin: 0; color: var(--muted); font-size: 12.5px; }
.imp-row { display: flex; align-items: flex-start; gap: 11px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.imp-row:last-of-type { border-bottom: none; }
.imp-row .ic { width: 30px; height: 30px; border-radius: 8px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
.imp-row .ic svg { width: 15px; height: 15px; }
.imp-row b { font-size: 13px; display: block; }
.imp-row span { font-size: 11.5px; color: var(--muted); display: block; margin-top: 2px; }
.v-row { display: flex; align-items: flex-start; gap: 12px; padding: 13px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 9px; background: var(--panel2); }
.v-row.cur { border-color: var(--accent); background: var(--accent-subtle); }
.v-row .vn { font-size: 14px; font-weight: 700; width: 34px; }
.v-row .vm { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
.v-row .acts { margin-left: auto; display: flex; flex-direction: column; gap: 5px; }
.diff-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.diff-cols-wrap { overflow: auto; }
.dcol { border: 1px solid var(--line); border-radius: 10px; background: var(--bg); overflow: hidden; }
.dcol .dh { padding: 9px 13px; border-bottom: 1px solid var(--line); font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.dcol .db { padding: 11px 13px; font-size: 12px; line-height: 1.75; color: var(--text-2); }
.ln-add { background: rgba(69,211,156,.14); border-radius: 4px; padding: 1px 5px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.ln-del { background: rgba(255,107,120,.12); border-radius: 4px; padding: 1px 6px; display: block; margin: 2px -6px; color: #d98b93; text-decoration: line-through; text-decoration-color: rgba(255,107,120,.5); }
.ln-same { display: block; padding: 1px 6px; }
.diff-nav { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.add-frag { background: rgba(69,211,156,.14); border-radius: 3px; padding: 0 2px; }
.del-frag { background: rgba(255,107,120,.12); border-radius: 3px; padding: 0 2px; text-decoration: line-through; }
</style>
