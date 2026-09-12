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
        <div class="more-wrap" style="position:relative">
          <button class="btn sm" @click="aiMenuOpen = !aiMenuOpen">
            <svg style="color:var(--accent)"><use href="#i-spark"/></svg>AI 辅助
            <svg class="chev" style="width:13px;height:13px"><use href="#i-chev-d"/></svg>
          </button>
          <!-- C5：AI 辅助下拉（选区存在时追加改写/扩写/缩写） -->
          <div v-if="aiMenuOpen" class="card more-pop" style="position:absolute; right:0; top:calc(100% + 6px); z-index:70; width:170px" @click="aiMenuOpen = false">
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="aiMenuAction('continue')">续写</button>
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="aiMenuAction('polish')">润色</button>
            <template v-if="selectionText">
              <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="aiMenuAction('rewrite')">改写选段</button>
              <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="aiMenuAction('expand')">扩写选段</button>
              <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="aiMenuAction('shorten')">缩写选段</button>
            </template>
            <div v-else class="xs muted" style="padding:4px 10px">选中正文后可改写 / 扩写 / 缩写</div>
          </div>
        </div>
        <span class="muted xs">{{ dirty ? '未保存' : '已保存' }}</span>
      </div>
      <div class="ed-body" style="display:flex; flex-direction:column">
        <div class="sc-head" v-if="selectedScene">
          <span class="chip bold">场次标题 · {{ selectedScene.heading }}</span>
          <span class="chip">字数 · {{ selectedScene.chars }}</span>
          <div class="spacer"></div>
          <span class="seg" style="height:26px">
            <span :class="{ on: editMode === 'edit' }" @click="editMode = 'edit'">编辑</span>
            <span :class="{ on: editMode === 'layout' }" @click="editMode = 'layout'">排版</span>
          </span>
        </div>
        <!-- C2：排版视图（场景标题 chip 行 / 角色名加粗 / 选段高亮） -->
        <div v-if="editMode === 'layout' && model && model.draft" class="layout-view" title="点击返回编辑">
          <div v-for="(line, i) in layoutLines" :key="i" class="ln" :class="line.cls" @dblclick="editMode = 'edit'">
            <template v-if="line.dlg"><b class="dlg-name">{{ line.dlg }}</b>：{{ line.rest }}</template>
            <template v-else>{{ line.text }}</template>
          </div>
        </div>
        <textarea
          v-else
          ref="editor"
          v-model="draftText"
          class="ed-text"
          :disabled="!model"
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
        <button class="btn primary" style="width:100%" :disabled="mainCtaDisabled" @click="mainCtaClick">
          {{ mainCtaLabel }}
        </button>
        <div class="muted xs" style="text-align:center">确认只创建新版本并标记过期，不会自动重新生成媒体。</div>
      </div>
    </div>

    <!-- QA-002：已确认但无草稿 → 展示已确认内容（可直接编辑，保存自动创建新草稿） -->
    <div v-if="model && !model.draft && model.approved" class="notice-strip ok" style="margin:10px 24px 0; z-index:5">
      <span style="flex:1">正在查看已确认版本 v{{ model.approved.revision }} 的内容。直接修改并保存会创建新的草稿版本；已确认版本保留可回看。</span>
      <router-link class="btn primary sm" :to="`/projects/${projectId}/episodes/${episodeId}/assets`" style="text-decoration:none">进入设定</router-link>
    </div>
    <!-- 空态：三起点（仅在既无草稿也无已确认版本时展示；QA-002） -->
    <div v-if="model && !model.draft && !model.approved" class="blank-wrap">
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
          <h3>{{ confirmLabel }} · 影响摘要</h3>
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
          <div class="imp-row" v-if="preview?.assetChanges?.changed || preview?.assetChanges?.added || preview?.assetChanges?.removed">
            <div class="ic" style="background:var(--neutral-subtle); color:var(--muted)"><svg><use href="#i-doc"/></svg></div>
            <div><b>{{ preview?.assetChanges?.changed }} 个场次已修改</b><span>另有 {{ preview?.assetChanges?.added }} 个新增 / {{ preview?.assetChanges?.removed }} 个删除</span></div>
          </div>
          <div class="imp-row" v-if="preview?.downstream?.storyboardPackagesStale">
            <div class="ic" style="background:var(--warn-subtle); color:var(--warn)"><svg><use href="#i-clap"/></svg></div>
            <div><b>{{ preview?.downstream?.storyboardPackagesStale }} 个镜头的分镜包将过期</b><span>需要复核后重新生成</span></div>
          </div>
          <div class="imp-row">
            <div class="ic" style="background:var(--panel2); color:var(--muted)"><svg><use href="#i-image"/></svg></div>
            <div><b>{{ preview?.downstream?.shotImagesKeep }} 张镜头图可保留</b><span>未被本次修改影响 · 建议复核后继续使用</span></div>
          </div>
          <!-- B9：影响明细（展开后列出新增/修改/删除候选的逐场清单） -->
          <div v-if="confirmDetailOpen" class="cn-detail">
            <div v-for="cat in detailItems" :key="cat.key" style="margin-bottom:8px">
              <div class="xs" style="font-weight:600">{{ cat.label }}（{{ cat.rows.length }}）</div>
              <template v-if="cat.rows.length">
                <div v-for="(row, i) in cat.rows" :key="cat.key + i" class="xs" style="padding:2px 0">
                  场次 {{ row.sceneNumber }} · {{ row.heading }}
                </div>
              </template>
              <div v-else class="xs muted">无</div>
            </div>
          </div>
          <div class="divider" style="margin:12px 0 10px"></div>
          <div class="xs muted" style="line-height:1.6">确认只创建新剧本版本并标记过期对象，不会自动删除媒体、不会触发任何重新生成；被过期的内容可随时从历史版本恢复。</div>
          <div v-if="confirmError" class="xs" style="color:var(--danger); padding:8px 0 0">{{ confirmError }}</div>
        </div>
        <div class="modal-f" style="justify-content:space-between">
          <button class="btn ghost" @click="confirmDetailOpen = !confirmDetailOpen">{{ confirmDetailOpen ? '收起影响明细' : '查看影响明细' }}</button>
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

    <!-- 版本冲突 Modal（P0-14：本机 vs 服务端对比，三动作显式决策，不做静默覆盖） -->
    <div v-if="conflictModalOpen" class="scrim" style="z-index:95" @click.self></div>
    <div v-if="conflictModalOpen" class="modal-wrap" style="z-index:96">
      <div class="modal" style="width:560px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--warn)"><use href="#i-warn"/></svg>
          <h3>版本冲突</h3>
          <button class="icon-btn" @click="conflictModalOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small t2" style="margin-bottom:10px">另一窗口已保存{{ conflictServerRevision ? ' v' + conflictServerRevision : '新版本' }}。请比较两侧内容后选择如何处理；本机修改不会被自动丢弃。</p>
          <div class="row" style="align-items:stretch; gap:10px">
            <div class="grow">
              <div class="xs muted" style="margin-bottom:4px">本机修改（未保存）</div>
              <pre class="conflict-pane">{{ draftText || '（空）' }}</pre>
            </div>
            <div class="grow">
              <div class="xs muted" style="margin-bottom:4px">服务端最新{{ conflictServerRevision ? ' · v' + conflictServerRevision : '' }}</div>
              <pre class="conflict-pane">{{ conflictLoading ? '读取中…' : (conflictServerText || '（读取失败，无法对比）') }}</pre>
            </div>
          </div>
        </div>
        <div class="modal-f" style="justify-content:space-between">
          <button class="btn ghost" @click="conflictModalOpen = false">保留现状（稍后处理）</button>
          <div class="row" style="gap:8px">
            <button class="btn" :disabled="conflictLoading" @click="loadServerVersion">载入最新版本（放弃本机修改）</button>
            <button class="btn danger solid" :disabled="conflictLoading" @click="overwriteServerVersion">覆盖服务端版本</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue'
import v21 from '@/v21/api.js'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'ScriptStage',
  mixins: [escMixin],
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
      confirmOpen: false, confirmDetailOpen: false, confirmError: '', busy: false, saveConflict: false,
      conflictModalOpen: false, conflictServerText: '', conflictServerRevision: null, conflictLoading: false,
      aiMenuOpen: false, selectionText: '', editMode: 'edit', aiPop: { visible: false, top: 0, right: 60, text: '' },
      diffData: null, diffScene: null,
      diffOld: [], diffNew: [],
    }
  },
  computed: {
    layoutLines() {
      // C2 排版视图：场景标题行 / 角色名：台词行（加粗）/ 选段高亮
      const sel = (this.selectionText || '').trim()
      return String(this.draftText || '').split(/\r?\n/).map((raw) => {
        const text = raw
        const isScene = /^(第.{1,6}场|\s*第.{1,6}场|内景|外景)/.test(text.trim())
        const dlgMatch = text.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
        const cls = isScene ? 'ln-scene' : dlgMatch ? 'ln-dialogue' : ''
        const selHit = sel && text.includes(sel)
        return {
          text,
          cls: selHit ? `${cls} sel-hl`.trim() : cls,
          dlg: !isScene && dlgMatch ? dlgMatch[1] : null,
          rest: !isScene && dlgMatch ? dlgMatch[2] : '',
        }
      })
    },
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
    // B8：动作→mode 统一映射（下拉与浮层共用），缩写=condense、改写=rewrite、扩写=expand
    aiModeMap() {
      return { continue: 'continue', polish: 'polish', rewrite: 'rewrite', expand: 'expand', shorten: 'condense' }
    },
    // 409 保存冲突：主 CTA 变“解决版本冲突”，成功保存后恢复确认文案
    mainCtaLabel() {
      return this.saveConflict ? '解决版本冲突' : this.confirmLabel
    },
    mainCtaDisabled() {
      return this.busy || this.saving || (!this.saveConflict && !this.canConfirm)
    },
    // B9 影响明细：三类逐场清单（空类显示“无”）
    detailItems() {
      const items = this.preview?.assetChanges?.items || {}
      return [
        { key: 'added', label: '新增场次', rows: items.added || [] },
        { key: 'changed', label: '修改场次', rows: items.changed || [] },
        { key: 'removed', label: '删除候选', rows: items.removed || [] },
      ]
    },
    diffOld() {
      return this.buildInlineDiff(this.model?.draft?.content || '', this.candidate?.text || '', 'old')
    },
    diffNew() {
      return this.buildInlineDiff(this.model?.draft?.content || '', this.candidate?.text || '', 'new')
    },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.load()
    // 制作头切集守卫：向 studioSave 通道注册保存方法（StudioShell“保存并切换”调用）
    if (this.studioSave) {
      this.studioSave.save = () => this.saveDraft(this.draftText, this.model?.draft?.revision)
    }
    this.keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (this.dirty) this.saveDraft(this.draftText, this.model?.draft?.revision)
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  },
  // 卸载前清掉 800ms 自动保存定时器：切集（制作头 :key 重建）或离开制作台时，
  // 定时器若存活会在卸载后仍触发保存——把被放弃/未保存的草稿写回库（放弃并切换路径同样被此兜住）
  beforeUnmount() {
    clearTimeout(this.timer)
  },
  unmounted() {
    window.removeEventListener('keydown', this.keyHandler)
    // 卸载时清空通道上的脏标记与保存方法，避免残留状态误触守卫
    if (this.studioSave) {
      this.studioSave.dirty = false
      this.studioSave.save = null
    }
  },
  methods: {
    // Esc 自上而下关本视图的弹层（版本比较 → AI 候选 → 确认摘要 → 历史抽屉 → AI 浮层 / 菜单）
    onEsc() {
      if (this.diffOpen) { this.diffOpen = false; return true }
      if (this.candidateOpen) { this.candidateOpen = false; return true }
      if (this.confirmOpen) { this.confirmOpen = false; return true }
      if (this.historyOpen) { this.historyOpen = false; return true }
      if (this.aiPop.visible) { this.aiPop = { ...this.aiPop, visible: false }; return true }
      if (this.aiMenuOpen) { this.aiMenuOpen = false; return true }
      return false
    },
    setSave(text, error = false) {
      if (this.studioSave) {
        this.studioSave.text = text
        this.studioSave.error = error
      }
    },
    async load() {
      this.model = await v21.getScript(this.episodeId)
      // QA-002：无草稿但有已确认版本时，展示已确认正文（可直接编辑，保存即创建新草稿）
      this.draftText = this.model.draft ? this.model.draft.content : (this.model.approved ? String(this.model.approved.content || '') : '')
      this.dirty = false
      if (this.studioSave) this.studioSave.dirty = false
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
      if (this.studioSave) this.studioSave.dirty = true
      this.setSave('有未保存修改 · Ctrl+S 立即保存')
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.saveDraft(this.draftText, this.model?.draft?.revision), 800)
    },
    onSelect() {
      const el = this.$refs.editor
      if (!el) return
      const text = el.value.substring(el.selectionStart, el.selectionEnd).trim()
      this.selectionText = text
      if (text.length > 4) {
        // 锚定选中文本所在行：按选区前换行数 × 行高估算，同一选区位置稳定可复现
        const linesBefore = el.value.slice(0, el.selectionEnd).split('\n').length
        const lineHeight = 14.5 * 1.9
        const top = Math.max(56, Math.min((el.scrollHeight || 600) - 60, 24 + linesBefore * lineHeight - (el.scrollTop || 0)))
        this.aiPop = { visible: true, top, right: 120, text }
      } else {
        this.aiPop.visible = false
      }
    },
    async runAiCandidate(action, selection) {
      try {
        this.candidate = await v21.generateAiCandidate(this.episodeId, {
          mode: this.aiModeMap[action] || 'polish',
          selection: selection || '',
        })
        this.candidateOpen = true
      } catch (e) {
        this.setSave(e.message || 'AI 候选生成失败', true)
      }
    },
    async aiMenuAction(action) {
      this.aiMenuOpen = false
      const needSelection = action === 'rewrite' || action === 'expand' || action === 'shorten'
      const selection = needSelection ? this.selectionText : ''
      if (needSelection && !selection) {
        this.setSave('请先在正文中选择要处理的文本', true)
        return
      }
      await this.runAiCandidate(action, selection)
    },
    async selectionAi(action) {
      this.aiPop.visible = false
      const selection = this.aiPop.text || this.selectionText
      if (!selection) {
        this.setSave('请先在正文中选择要处理的文本', true)
        return
      }
      await this.runAiCandidate(action, selection)
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
        if (this.studioSave) this.studioSave.dirty = false
        this.saveConflict = false
        const now = new Date()
        this.lastSavedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        this.setSave(`已保存 · ${this.lastSavedAt}`)
        await this.load()
        return result
      } catch (e) {
        if (e.code === 'REVISION_CONFLICT' || e.status === 409) {
          this.saveConflict = true
          this.setSave('保存冲突：另一窗口已保存新版本，请比较后选择', true)
          // P0-14：拉取服务端草稿做真实对比，不再默认以本机内容覆盖
          this.conflictLoading = true
          this.conflictModalOpen = true
          try {
            const server = await v21.getScript(this.episodeId)
            this.conflictServerText = server?.draft?.content || ''
            this.conflictServerRevision = server?.draft?.revision ?? null
          } catch {
            this.conflictServerText = ''
            this.conflictServerRevision = null
          } finally {
            this.conflictLoading = false
          }
        } else {
          this.setSave(`保存失败 · ${e.message}`, true)
        }
        return null
      } finally {
        this.saving = false
      }
    },
    // 409 冲突三动作：载入最新（放弃本机）/ 明确确认后覆盖 / 保留现状继续编辑
    async loadServerVersion() {
      this.draftText = this.conflictServerText
      this.dirty = false
      this.saveConflict = false
      this.conflictModalOpen = false
      try {
        this.model = await v21.getScript(this.episodeId)
      } catch { /* 保留现有修订号视图 */ }
      this.setSave('已载入最新版本')
    },
    async overwriteServerVersion() {
      if (this.saving) return
      await this.saveDraft(this.draftText, this.model?.draft?.revision)
      if (!this.saveConflict) this.conflictModalOpen = false
    },
    mainCtaClick() {
      if (this.saveConflict) this.conflictModalOpen = true
      else this.openConfirm()
    },
    async appendScene() {
      const text = (this.draftText || '') + `\n第${(this.sceneStats.totalScenes || 0) + 1}场 内景·地点·时间\n`
      this.draftText = text
      await this.saveDraft(text, this.model?.draft?.revision)
      this.selectedSceneIdx = (this.sceneStats.scenes?.length || 1) - 1
    },
    openConfirm() {
      this.confirmDetailOpen = false
      this.confirmError = ''
      this.refreshPreview().then(() => { this.confirmOpen = true })
    },
    async doConfirm() {
      this.busy = true
      this.confirmError = ''
      try {
        await v21.confirmScript(this.episodeId, this.model?.draft?.revision ?? null)
        this.confirmOpen = false
        this.confirmDetailOpen = false
        await this.load()
        this.$emit('refresh')
      } catch (e) {
        // 确认失败：弹窗保持打开并给出提示，禁止无反馈
        this.confirmError = e.message || '确认失败，请重试'
        this.setSave(this.confirmError, true)
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
.ed-body { flex: 1; overflow: auto; padding: 20px 56px 20px 28px; position: relative; }
.layout-view { flex: 1; overflow: auto; padding: 18px 22px; cursor: text; line-height: 1.9; font-size: 14.5px; }
.layout-view .ln { white-space: pre-wrap; padding: 1px 6px; border-radius: 5px; max-width: 860px; }
.layout-view .ln-scene { font-weight: 600; color: var(--accent); margin: 10px 0 4px; }
.layout-view .ln-dialogue .dlg-name { font-weight: 700; color: var(--text); }
.layout-view .sel-hl { background: rgba(124, 92, 255, .30); border-radius: 3px; }
.ed-text {
  width: 100%; min-height: 320px; flex: 1; resize: none;
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
.cn-detail { border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; margin-top: 8px; max-height: 180px; overflow: auto; background: var(--bg); }
.cn-detail .xs { color: var(--text-2); }
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
/* 版本冲突对比窗格 */
.conflict-pane {
  flex: 1; min-width: 0; height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px;
  font-family: inherit; font-size: 12.5px; line-height: 1.8; color: var(--text-2); margin: 0;
}
</style>
