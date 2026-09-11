<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <span class="t2 bold">{{ projectTitle }}</span>
      <nav class="ptabs">
        <span class="ptab" @click="$router.push(`/projects/${projectId}`)">概览</span>
        <span class="ptab on">剧集</span>
        <span class="ptab" @click="$router.push(`/projects/${projectId}/assets`)">项目素材</span>
      </nav>
      <div class="spacer"></div>
      <div class="input" style="width:220px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="集号 / 标题" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13.5px" @input="load">
      </div>
    </header>
    <div class="page-body">

      <div class="ep-toolbar">
        <div class="seg">
          <span :class="{ on: status === 'all' }" @click="setStatus('all')">全部 {{ counts.all }}</span>
          <span :class="{ on: status === 'making' }" @click="setStatus('making')">制作中 {{ counts.making }}</span>
          <span :class="{ on: status === 'needs-attention' }" @click="setStatus('needs-attention')">需要处理 {{ counts.needsAttention }}</span>
          <span :class="{ on: status === 'completed' }" @click="setStatus('completed')">已完成 {{ counts.completed }}</span>
          <span :class="{ on: status === 'blank' }" @click="setStatus('blank')">空白 {{ counts.blank }}</span>
          <span :class="{ on: status === 'archived' }" @click="setStatus('archived')">已归档 {{ counts.archived }}</span>
        </div>
        <div class="spacer"></div>
        <div class="more-wrap" style="position:relative">
          <button class="btn" @click="importOpen = !importOpen">
            <svg><use href="#i-download"/></svg>导入 / 协作<svg class="chev" style="width:14px;height:14px"><use href="#i-chev-d"/></svg>
          </button>
          <div v-if="importOpen" class="card popover" @click="importOpen = false">
            <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-package`)">
              <div class="ic"><svg><use href="#i-box"/></svg></div>
              <div><b>导入制作包</b><p>episode-package@2.1 · 五步预览导入</p></div>
            </div>
            <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/external-ai`)">
              <div class="ic"><svg><use href="#i-spark"/></svg></div>
              <div><b>外部 AI 制作</b><p>创建任务包，外部会话结果 JSON 回流为草稿</p></div>
            </div>
            <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-novel`)">
              <div class="ic"><svg><use href="#i-doc"/></svg></div>
              <div><b>小说 / 长文本拆集</b><p>按章节预览拆集与编号，逐集生成草稿</p></div>
            </div>
            <div class="pop-sep"></div>
            <div class="pop-item" @click="$router.push(`/projects/${projectId}/episodes/import-video`)">
              <div class="ic" style="background:var(--neutral-subtle); color:var(--muted)"><svg><use href="#i-film"/></svg></div>
              <div><b>从已有视频开始剪辑</b><p>登记原片后进入短片页，只读保护原文件</p></div>
            </div>
          </div>
        </div>
        <button class="btn primary" style="height:36px" @click="newEpisode">
          <svg><use href="#i-plus"/></svg>新建剧集
        </button>
      </div>

      <!-- 第二层：阶段筛选 + 排序 + 集序管理 -->
      <div class="ep-toolbar" style="margin-top:10px">
        <div class="seg">
          <span :class="{ on: stageFilter === '' }" @click="setStageFilter('')">全部阶段</span>
          <span :class="{ on: stageFilter === 'script' }" @click="setStageFilter('script')">剧本</span>
          <span :class="{ on: stageFilter === 'assets' }" @click="setStageFilter('assets')">设定</span>
          <span :class="{ on: stageFilter === 'storyboard' }" @click="setStageFilter('storyboard')">分镜</span>
          <span :class="{ on: stageFilter === 'cut' }" @click="setStageFilter('cut')">成片</span>
        </div>
        <div class="spacer"></div>
        <div class="select" style="cursor:pointer" title="列表排序">
          <select v-model="sort" class="sort-native" @change="load">
            <option value="episode">集号升序（默认）</option>
            <option value="recent">最近工作</option>
          </select>
          <svg class="chev"><use href="#i-chev-d"/></svg>
        </div>
        <button class="btn" @click="openReorderPanel()">
          <svg><use href="#i-more"/></svg>排序与管理
        </button>
      </div>

      <div v-if="notice" class="notice-strip warn" style="margin:0 0 14px">
        <svg style="width:14px;height:14px"><use href="#i-warn"/></svg>
        {{ notice }}
        <div class="spacer"></div>
        <span style="cursor:pointer" @click="notice = ''">关闭</span>
      </div>

      <!-- 导入成功回写横幅（?imported=<episodeId>） -->
      <div v-if="importedBanner" class="notice-strip ok" style="margin-bottom:14px">
        <svg style="width:14px;height:14px"><use href="#i-check-c"/></svg>
        <span>{{ importedBanner }}</span>
        <div class="spacer"></div>
        <button class="btn sm" @click="openImportedScript">打开剧本</button>
        <button class="icon-btn" title="关闭" @click="importedId = ''"><svg><use href="#i-close"/></svg></button>
      </div>

      <!-- 外部 AI 任务卡（离页恢复入口；空状态不显示） -->
      <div v-if="externalTasks.length" class="card ext-tasks" style="margin-bottom:14px">
        <div class="ext-tasks-h">
          <svg style="width:14px;height:14px;color:var(--accent)"><use href="#i-spark"/></svg>
          <b class="xs" style="font-size:13px">外部 AI 任务</b>
          <span class="xs muted">任务已持久化，可离页；完成后回流为草稿</span>
        </div>
        <div v-for="t in externalTasks" :key="t.packageId" class="ext-task-row">
          <span class="badge" :class="extStatusBadge(t.status)">{{ extStatusLabel(t.status) }}</span>
          <b class="xs" style="font-size:13px">第 {{ t.targetEpisodeNumber }} 集</b>
          <span class="xs muted mono">{{ String(t.packageId).slice(0, 8) }}</span>
          <span class="xs muted">创建于 {{ relTime(t.createdAt) }}</span>
          <div class="spacer"></div>
          <template v-if="t.status === 'waiting_external'">
            <button class="btn primary sm" @click="$router.push(`/projects/${projectId}/episodes/external-ai?taskId=${t.packageId}`)">打开向导</button>
            <button class="btn ghost sm" :disabled="cancellingTaskId === t.packageId" @click="cancelExternal(t)">取消</button>
          </template>
          <button v-else-if="t.status === 'imported' && t.targetEpisodeId" class="btn sm" @click="$router.push(`/projects/${projectId}/episodes/${t.targetEpisodeId}/script`)">打开剧本</button>
        </div>
      </div>

      <div class="ep-list">
        <div v-for="ep in items" :key="ep.id" class="card ep-row" :class="{ current: isHighlighted(ep), attention: ep.needsAttention && !isHighlighted(ep) }">
          <span class="ep-no">E{{ String(ep.episodeNumber).padStart(2, '0') }}</span>
          <div class="ep-title">
            <b>{{ ep.title || '未命名' }}</b>
            <span v-if="ep.targetDuration">目标 {{ ep.targetDuration }}s</span>
          </div>
          <div class="ep-src">
            <span v-if="ep.hasImportSource" class="badge accent">外部 AI 导入</span>
            <span v-else class="badge outline">{{ sourceLabel(ep) }}</span>
          </div>
          <div class="stage-cells">
            <div class="s-cell" :class="cellClass(ep, 'script')"><svg><use :href="cellIcon(ep, 'script')"/></svg>剧本 {{ cellText(ep, 'script') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'assets')"><svg><use :href="cellIcon(ep, 'assets')"/></svg>设定 {{ cellText(ep, 'assets') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'storyboard')"><svg><use :href="cellIcon(ep, 'storyboard')"/></svg>分镜 {{ cellText(ep, 'storyboard') }}</div>
            <div class="s-cell" :class="cellClass(ep, 'cut')"><svg><use :href="cellIcon(ep, 'cut')"/></svg>成片 {{ cellText(ep, 'cut') }}</div>
          </div>
          <div class="ep-last">上次 · {{ stageLabel(ep.stage) }}<br>{{ relTime(ep.lastWorkedAt) }}</div>
          <div class="row">
            <template v-if="status === 'archived'">
              <span class="xs muted">归档于 {{ relTime(ep.deletedAt) }}</span>
              <button class="btn sm" @click="restoreEp(ep)"><svg><use href="#i-refresh"/></svg>恢复</button>
            </template>
            <template v-else>
              <button v-if="ep.status !== 'blank' && (isHighlighted(ep) || ep.needsAttention)" class="btn primary sm" @click="open(ep)">继续制作</button>
              <button v-else-if="ep.status === 'blank'" class="btn sm" @click="open(ep)">开始创建</button>
              <div class="more-wrap" style="position:relative">
                <button class="icon-btn" @click.stop="rowMenuId = rowMenuId === ep.id ? null : ep.id"><svg><use href="#i-more"/></svg></button>
                <div v-if="rowMenuId === ep.id" class="card more-pop" style="position:absolute; right:0; top:calc(100% + 4px); z-index:70; width:170px" @click="rowMenuId = null">
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="startRename(ep)">重命名</button>
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="copyDraft(ep)">复制为草稿</button>
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="startTargetDuration(ep)">设置目标时长<span v-if="ep.targetDuration" class="xs muted" style="margin-left:auto">{{ ep.targetDuration }}s</span></button>
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="openReorderPanel()">调整集序</button>
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start; color:var(--danger)" @click="startDelete(ep)">删除（回收站）</button>
                  <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="openImportSource(ep)">查看导入来源</button>
                </div>
              </div>
            </template>
          </div>
        </div>
        <p v-if="items.length === 0" class="muted" style="text-align:center; padding:60px 0">{{ emptyText }}</p>
      </div>
    </div>

    <!-- 删除确认 Modal（32） -->
    <div v-if="deleteTarget" class="scrim" style="z-index:80" @click="deleteTarget = null"></div>
    <div v-if="deleteTarget" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:540px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>删除剧集 · E{{ String(deleteTarget.episodeNumber).padStart(2, '0') }}</h3>
          <button class="icon-btn" @click="deleteTarget = null"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <b style="font-size:13.5px">将移入回收站的内容：</b>
          <div class="imp-rows" style="margin-top:10px">
            <div class="kv"><span class="k">剧本版本</span><span class="v">{{ deleteImpact.scriptRevisions }} 个</span></div>
            <div class="kv"><span class="k">分镜</span><span class="v">{{ deleteImpact.storyboards }} 个</span></div>
            <div class="kv"><span class="k">时段</span><span class="v">{{ deleteImpact.segments }} 个</span></div>
            <div class="kv"><span class="k">候选（镜头组建）</span><span class="v">{{ deleteImpact.candidates }} 组</span></div>
            <div class="kv"><span class="k">导入来源记录</span><span class="v">{{ deleteImpact.imports }} 条（只读审计，保留）</span></div>
          </div>
          <div class="divider" style="margin:12px 0"></div>
          <div class="xs" style="color:var(--warn); line-height:1.6">
            <svg style="width:12px;height:12px;vertical-align:-1px"><use href="#i-warn"/></svg>
            回收站保护：30 天内可从回收站筛选恢复。运行中任务需先取消；导出成片与外部来源审计记录随项目保留。
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="deleteTarget = null">取消</button>
          <button class="btn primary" style="background:var(--danger); border-color:var(--danger)" @click="doDelete">确认删除（可恢复）</button>
        </div>
      </div>
    </div>

    <!-- 新建剧集 · 目标选择器（创建下一集 / 复用空白剧集） -->
    <div v-if="newEpOpen" class="scrim" style="z-index:80" @click="newEpOpen = false"></div>
    <div v-if="newEpOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:420px">
        <div class="modal-h"><h3>新建剧集</h3><button class="icon-btn" @click="newEpOpen = false"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-b">
          <p class="xs muted" style="margin-bottom:10px">选择目标：创建下一集空白草稿，或复用已有空白剧集。非空剧集不会被覆盖。</p>
          <label class="row" style="gap:8px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; cursor:pointer; align-items:center" :style="newEpChoice === 'create' ? 'border-color:var(--accent)' : ''">
            <input type="radio" value="create" v-model="newEpChoice">
            <span class="xs"><b>创建第 {{ newEpNextNumber }} 集</b>（空白草稿，直达剧本页）</span>
          </label>
          <template v-if="blankEpisodes.length">
            <div class="xs muted" style="margin:12px 0 6px">或复用已有空白剧集：</div>
            <label v-for="b in blankEpisodes" :key="b.id" class="row" style="gap:8px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; cursor:pointer; margin-bottom:6px; align-items:center" :style="newEpChoice === 'blank-' + b.id ? 'border-color:var(--accent)' : ''">
              <input type="radio" :value="'blank-' + b.id" v-model="newEpChoice">
              <span class="xs">E{{ String(b.episodeNumber).padStart(2, '0') }} {{ b.title || '未命名' }}</span>
            </label>
          </template>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="newEpOpen = false">取消</button>
          <button class="btn primary" :disabled="!newEpChoice" @click="confirmNewEpisode">{{ newEpChoice === 'create' ? '创建并进入剧本' : '进入该空白集' }}</button>
        </div>
      </div>
    </div>

    <!-- 重命名 Modal（C1） -->
    <div v-if="renameTarget" class="scrim" style="z-index:80" @click="renameTarget = null"></div>
    <div v-if="renameTarget" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:400px">
        <div class="modal-h"><h3>重命名剧集</h3><button class="icon-btn" @click="renameTarget = null"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-b">
          <label class="col" style="gap:4px"><span class="xs muted">新标题（E{{ String(renameTarget.episodeNumber).padStart(2, '0') }}）</span>
            <input class="input" v-model="renameTitle" @keyup.enter="confirmRename">
          </label>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="renameTarget = null">取消</button>
          <button class="btn primary" :disabled="!renameTitle.trim()" @click="confirmRename">保存</button>
        </div>
      </div>
    </div>

    <!-- 设置目标时长 Modal（60/90/120 预设 + 清除） -->
    <div v-if="targetTarget" class="scrim" style="z-index:80" @click="targetTarget = null"></div>
    <div v-if="targetTarget" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:400px">
        <div class="modal-h"><h3>设置目标时长</h3><button class="icon-btn" @click="targetTarget = null"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-b">
          <p class="xs muted" style="margin-bottom:8px">「{{ targetTarget.title || '未命名' }}」的单集目标时长（10-3600 秒），用于规划分镜与成片节奏。</p>
          <label class="col" style="gap:4px"><span class="xs muted">秒</span>
            <input class="input" type="number" min="10" max="3600" v-model.number="targetDurationInput">
          </label>
          <div class="row" style="gap:8px; margin-top:10px">
            <button class="btn sm" @click="targetDurationInput = 60">60 秒</button>
            <button class="btn sm" @click="targetDurationInput = 90">90 秒</button>
            <button class="btn sm" @click="targetDurationInput = 120">120 秒</button>
          </div>
          <p v-if="targetDurationInput !== null && targetDurationInput !== '' && !validTargetDuration" class="xs" style="color:var(--danger); margin-top:8px">目标时长需在 10-3600 秒之间</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="clearTargetDuration">清除</button>
          <button class="btn ghost" @click="targetTarget = null">取消</button>
          <button class="btn primary" :disabled="!validTargetDuration" @click="confirmTargetDuration">保存</button>
        </div>
      </div>
    </div>

    <!-- 调整集序 · 排序与管理面板（全列表上移/下移） -->
    <div v-if="reorderPanelOpen" class="scrim" style="z-index:80" @click="reorderPanelOpen = false"></div>
    <div v-if="reorderPanelOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:480px">
        <div class="modal-h"><h3>排序与管理</h3><button class="icon-btn" @click="reorderPanelOpen = false"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-b">
          <p class="xs muted" style="margin-bottom:8px">按当前顺序对全列表上移/下移；保存后集号将按新顺序重排为 1..N。</p>
          <div style="max-height:320px; overflow:auto">
            <div v-for="(ep, idx) in reorderDraft" :key="ep.id" class="row" style="gap:8px; padding:7px 0; border-bottom:1px solid var(--line); align-items:center">
              <b class="xs" style="width:36px; color:var(--text-2)">E{{ String(idx + 1).padStart(2, '0') }}</b>
              <span class="xs" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ ep.title || '未命名' }}</span>
              <button class="icon-btn" title="上移" :disabled="idx === 0" @click="moveReorder(idx, -1)">↑</button>
              <button class="icon-btn" title="下移" :disabled="idx === reorderDraft.length - 1" @click="moveReorder(idx, 1)">↓</button>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="reorderPanelOpen = false">取消</button>
          <button class="btn primary" :disabled="reorderDraft.length === 0" @click="confirmReorder">保存集序</button>
        </div>
      </div>
    </div>

    <!-- 查看导入来源 · 只读抽屉 -->
    <div v-if="importSourceOpen" class="scrim" style="z-index:80" @click="importSourceOpen = false"></div>
    <aside v-if="importSourceOpen" class="card" style="position:fixed; right:0; top:0; bottom:0; width:440px; max-width:94vw; z-index:90; border-radius:0; border-top:none; border-bottom:none; border-right:none; overflow:auto">
      <div class="modal-h" style="padding:16px 18px">
        <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-doc"/></svg>
        <h3>导入来源<template v-if="importSourceEp"> · E{{ String(importSourceEp.episodeNumber).padStart(2, '0') }}</template></h3>
        <button class="icon-btn" @click="importSourceOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div style="padding:0 18px 18px">
        <template v-if="importSource">
          <p class="xs muted" style="margin-bottom:10px">最近一次成功导入的只读审计记录。</p>
          <div class="imp-rows">
            <div class="kv"><span class="k">协议</span><span class="v">{{ importSource.schemaName || '—' }}{{ importSource.schemaVersion ? ` v${importSource.schemaVersion}` : '' }}</span></div>
            <div class="kv"><span class="k">任务包</span><span class="v mono">{{ importSource.packageId || '—' }}</span></div>
            <div class="kv"><span class="k">文件名</span><span class="v">{{ importSource.sourceFilename || '—' }}</span></div>
            <div class="kv"><span class="k">SHA-256</span><span class="v mono" style="word-break:break-all; font-size:11px">{{ importSource.sourceSha256 || '—' }}</span></div>
            <div class="kv"><span class="k">导入时间</span><span class="v">{{ importSource.importedAt || '—' }}</span></div>
          </div>
          <p class="xs muted" style="margin-top:10px">来源记录随项目保留，不可编辑或删除。</p>
        </template>
        <p v-else-if="!importSourceLoading" class="muted" style="padding:24px 0">本集为直接创建，无导入来源</p>
        <p v-else class="muted" style="padding:24px 0">加载中…</p>
      </div>
    </aside>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

const STAGE_ORDER = ['script', 'assets', 'storyboard', 'cut']

export default {
  name: 'ProjectEpisodesView',
  data() {
    return {
      items: [], q: '', status: 'all', sort: 'episode', stageFilter: '', importOpen: false,
      projectTitle: '', deleteTarget: null, deleteImpact: {},
      rowMenuId: null,
      newEpOpen: false, newEpChoice: 'create', newEpNextNumber: 1, blankEpisodes: [],
      renameTarget: null, renameTitle: '', notice: '',
      targetTarget: null, targetDurationInput: null,
      reorderPanelOpen: false, reorderDraft: [],
      importSourceOpen: false, importSourceEp: null, importSource: null, importSourceLoading: false,
      flashId: '', importedId: '',
      externalTasks: [], cancellingTaskId: '',
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    // 导入成功页「查看剧集行」等入口带 ?highlight=<episodeId> 时，对应行复用 current 高亮（不自动清除）
    highlightId() {
      const h = this.$route.query.highlight
      return h ? String(h) : ''
    },
    importedBanner() {
      if (!this.importedId) return ''
      const ep = this.allItems.find((i) => String(i.id) === this.importedId)
      return ep ? `导入完成：《${ep.title || '未命名'}》已创建` : ''
    },
    counts() {
      return {
        all: this.allItems.length,
        making: this.allItems.filter((i) => i.status === 'making').length,
        needsAttention: this.allItems.filter((i) => i.status === 'needs-attention').length,
        completed: this.allItems.filter((i) => i.status === 'completed').length,
        blank: this.allItems.filter((i) => i.status === 'blank').length,
        archived: this.archivedItems.length,
      }
    },
    allItems() { return this._allItems || [] },
    archivedItems() { return this._archivedItems || [] },
    validTargetDuration() {
      const n = Number(this.targetDurationInput)
      return Number.isFinite(n) && n >= 10 && n <= 3600
    },
    emptyText() {
      if (this.status === 'archived') return '回收站为空：被删除的剧集会在这里保留 30 天，可随时恢复'
      if (this.status === 'blank') return '没有空白剧集：所有剧集都已有内容'
      if (this.stageFilter) return '当前阶段筛选下没有剧集：切回「全部阶段」查看'
      return this.status === 'all' ? '还没有剧集，点击「新建剧集」直达空白剧本' : '当前筛选下没有剧集'
    },
  },
  mounted() {
    // 消费 ?imported=<episodeId>：顶部横幅 + 高亮该行
    const imported = this.$route.query.imported
    if (imported) this.importedId = String(imported)
    // 消费 ?stage=（P3.5 概览深链）：设置第二层阶段筛选
    const stage = this.$route.query.stage
    if (stage && STAGE_ORDER.includes(String(stage))) this.stageFilter = String(stage)
    if (imported || stage) this.consumeQuery(['imported', 'stage'])
    this.load()
  },
  methods: {
    async load() {
      const params = { q: this.q, sort: this.sort }
      if (this.status === 'archived') params.status = 'archived'
      const data = await v21.listEpisodes(this.projectId, params)
      if (this.status === 'archived') {
        this._archivedItems = data.items || []
      } else {
        this._allItems = data.items || []
        try {
          const archived = await v21.listEpisodes(this.projectId, { status: 'archived' })
          this._archivedItems = archived.items || []
        } catch { /* 徽标计数失败不影响主列表 */ }
      }
      this.applyFilters()
      try {
        this.externalTasks = (await v21.listExternalTasks(this.projectId)) || []
      } catch { this.externalTasks = [] }
      try {
        const overview = await v21.getOverview(this.projectId)
        this.projectTitle = overview.hero.title
      } catch { /* ignore */ }
    },
    applyFilters() {
      let list
      if (this.status === 'archived') list = this.archivedItems
      else if (this.status === 'all') list = this.allItems
      else list = this.allItems.filter((i) => i.status === this.status)
      if (this.stageFilter && this.status !== 'archived') {
        // 筛「有该阶段工作的集」：阶段单元格为「未开始」的不显示
        list = list.filter((ep) => ep.stage && STAGE_ORDER.indexOf(this.stageFilter) <= STAGE_ORDER.indexOf(ep.stage))
      }
      this.items = list
    },
    consumeQuery(keys) {
      const query = { ...this.$route.query }
      let changed = false
      keys.forEach((k) => {
        if (k in query) { delete query[k]; changed = true }
      })
      if (changed) this.$router.replace({ query })
    },
    isHighlighted(ep) {
      return (
        String(ep.id) === String(this.highlightId || '') ||
        String(ep.id) === String(this.flashId || '') ||
        String(ep.id) === String(this.importedId || '')
      )
    },
    setStatus(s) { this.status = s; this.load() },
    setStageFilter(s) { this.stageFilter = s; this.applyFilters() },
    extStatusLabel(s) {
      return { waiting_external: '等待外部结果', imported: '已导入', cancelled: '已取消' }[s] || s
    },
    extStatusBadge(s) {
      return { waiting_external: 'warn', imported: 'accent', cancelled: 'outline' }[s] || 'outline'
    },
    async cancelExternal(t) {
      this.cancellingTaskId = t.packageId
      try {
        await v21.cancelExternalTask(t.packageId)
        this.notice = ''
        await this.load()
      } catch (e) {
        this.notice = e.message || '取消失败'
      } finally {
        this.cancellingTaskId = ''
      }
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '本集设定', storyboard: '分镜', cut: '成片' }[stage] || '—'
    },
    sourceLabel(ep) {
      if (ep.status === 'blank') return '空白创建'
      return '手工创建'
    },
    cellState(ep, stage) {
      if (ep.stage === null || ep.status === 'blank') {
        return stage === 'script' ? 'empty-start' : 'locked'
      }
      if (ep.needsAttention) return 'warn-cell'
      const order = STAGE_ORDER
      const idx = order.indexOf(ep.stage)
      const stageIdx = order.indexOf(stage)
      if (stageIdx < idx) return 'ok'
      if (stageIdx === idx) return 'info'
      return 'empty'
    },
    cellClass(ep, stage) {
      const state = this.cellState(ep, stage)
      return { ok: 'ok', info: 'info', 'warn-cell': 'warn', empty: 'empty', 'empty-start': 'empty', locked: 'empty' }[state] || 'empty'
    },
    cellIcon(ep, stage) {
      const state = this.cellState(ep, stage)
      if (state === 'ok') return '#i-check-c'
      if (state === 'info') return '#i-refresh'
      if (state === 'warn-cell') return '#i-warn'
      return '#i-clock'
    },
    cellText(ep, stage) {
      const state = this.cellState(ep, stage)
      if (state === 'locked') return '未解锁'
      if (state === 'empty') return stage === 'script' ? '空白' : '未开始'
      if (state === 'ok') {
        if (stage === 'script') return '已确认'
        if (stage === 'assets') return '已准备'
        if (stage === 'storyboard') return '已完成'
        if (stage === 'cut') return '已完成'
      }
      if (state === 'info') {
        if (stage === 'script') return '编辑中'
        return '进行中'
      }
      if (state === 'warn-cell') return '需处理'
      return '—'
    },
    relTime(t) {
      if (!t) return '—'
      const diff = Date.now() - new Date(t).getTime()
      const h = Math.floor(diff / 3600000)
      if (h < 1) return '刚刚'
      if (h < 24) return `${h} 小时前`
      return String(t).slice(0, 10)
    },
    open(ep) {
      const stage = ep.stage || 'script'
      this.$router.push(`/projects/${this.projectId}/episodes/${ep.id}/${stage}`)
    },
    openImportedScript() {
      if (!this.importedId) return
      this.$router.push(`/projects/${this.projectId}/episodes/${this.importedId}/script`)
    },
    async newEpisode() {
      this.newEpChoice = 'create'
      this.blankEpisodes = []
      this.newEpNextNumber = Math.max(0, ...this.allItems.map((i) => Number(i.episodeNumber) || 0)) + 1
      this.newEpOpen = true
      try {
        const [blanks, all] = await Promise.all([
          v21.listBlankEpisodes(this.projectId),
          v21.listEpisodes(this.projectId, { sort: 'episode' }),
        ])
        this.blankEpisodes = blanks.items || []
        this.newEpNextNumber = Math.max(0, ...(all.items || []).map((i) => Number(i.episodeNumber) || 0)) + 1
      } catch { /* 用本地估算兜底 */ }
    },
    async confirmNewEpisode() {
      if (!this.newEpChoice) return
      try {
        if (this.newEpChoice === 'create') {
          const created = await v21.createEpisode(this.projectId, { episodeNumber: this.newEpNextNumber })
          this.newEpOpen = false
          this.$router.push(`/projects/${this.projectId}/episodes/${created.id}/script`)
        } else {
          const id = Number(String(this.newEpChoice).replace('blank-', ''))
          const target = this.blankEpisodes.find((b) => b.id === id)
          if (!target) throw new Error('该集已不再空白，请刷新后重试')
          this.newEpOpen = false
          this.$router.push(`/projects/${this.projectId}/episodes/${id}/script`)
        }
      } catch (e) {
        this.notice = e.message || '创建失败'
        this.newEpOpen = false
      }
    },
    startRename(ep) {
      this.rowMenuId = null
      this.renameTarget = ep
      this.renameTitle = ep.title || ''
    },
    async confirmRename() {
      if (!this.renameTarget) return
      try {
        await v21.renameEpisode(this.renameTarget.id, this.renameTitle)
        this.renameTarget = null
        this.load()
      } catch (e) {
        this.notice = e.message || '重命名失败'
        this.renameTarget = null
      }
    },
    async copyDraft(ep) {
      this.rowMenuId = null
      try {
        const created = await v21.copyEpisodeDraft(ep.id)
        this.flashId = String(created.id)
        this.notice = `已复制为草稿副本：E${String(created.episodeNumber).padStart(2, '0')}（承接剧本内容，零媒体任务）`
        await this.load()
      } catch (e) {
        this.notice = e.message || '复制失败'
      }
    },
    startTargetDuration(ep) {
      this.rowMenuId = null
      this.targetTarget = ep
      this.targetDurationInput = ep.targetDuration || null
    },
    async confirmTargetDuration() {
      if (!this.targetTarget || !this.validTargetDuration) return
      try {
        await v21.setEpisodeTargetDuration(this.targetTarget.id, Number(this.targetDurationInput))
        this.targetTarget = null
        this.load()
      } catch (e) {
        this.notice = e.message || '设置失败'
        this.targetTarget = null
      }
    },
    async clearTargetDuration() {
      if (!this.targetTarget) return
      try {
        await v21.setEpisodeTargetDuration(this.targetTarget.id, null)
        this.targetTarget = null
        this.load()
      } catch (e) {
        this.notice = e.message || '清除失败'
        this.targetTarget = null
      }
    },
    async openReorderPanel() {
      this.rowMenuId = null
      try {
        const data = await v21.listEpisodes(this.projectId, { sort: 'episode' })
        this.reorderDraft = (data.items || []).map((i) => ({ id: i.id, episodeNumber: i.episodeNumber, title: i.title }))
        this.reorderPanelOpen = true
      } catch (e) {
        this.notice = e.message || '加载剧集失败'
      }
    },
    moveReorder(idx, delta) {
      const to = idx + delta
      if (to < 0 || to >= this.reorderDraft.length) return
      const arr = this.reorderDraft.slice()
      const moved = arr.splice(idx, 1)[0]
      arr.splice(to, 0, moved)
      this.reorderDraft = arr
    },
    async confirmReorder() {
      if (!this.reorderDraft.length) return
      try {
        await v21.reorderEpisodes(this.projectId, this.reorderDraft.map((i) => i.id))
        this.reorderPanelOpen = false
        this.load()
      } catch (e) {
        this.notice = e.message || '调整失败'
        this.reorderPanelOpen = false
      }
    },
    async restoreEp(ep) {
      try {
        await v21.restoreEpisode(ep.id)
        this.flashId = String(ep.id)
        this.notice = ''
        await this.load()
      } catch (e) {
        this.notice = e.message || '恢复失败'
      }
    },
    startDelete(ep) {
      this.rowMenuId = null
      v21.getDeleteImpact(ep.id).then((impact) => {
        this.deleteImpact = impact
        this.deleteTarget = ep
      })
    },
    async doDelete() {
      if (!this.deleteTarget) return
      await v21.deleteEpisode(this.deleteTarget.id)
      this.deleteTarget = null
      this.load()
    },
    async openImportSource(ep) {
      this.rowMenuId = null
      this.importSourceEp = ep
      this.importSource = null
      this.importSourceLoading = true
      this.importSourceOpen = true
      try {
        this.importSource = await v21.getImportSource(ep.id)
      } catch {
        this.importSource = null
      } finally {
        this.importSourceLoading = false
      }
    },
  },
}
</script>

<style scoped>
.ep-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.sort-native {
  background: transparent; border: none; outline: none; color: var(--text);
  font-size: 13.5px; appearance: none; cursor: pointer; padding-right: 4px;
}
.sort-native option { background: var(--panel2); color: var(--text); }
.ext-tasks-h { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; }
.ext-task-row { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .4px; }
.ep-list { display: flex; flex-direction: column; gap: 8px; }
.ep-row { display: flex; align-items: center; gap: 14px; padding: 12px 16px; cursor: pointer; }
.ep-row:hover { border-color: var(--line-strong); }
.ep-row.current {
  border-color: var(--accent);
  background: linear-gradient(90deg, rgba(124, 92, 255, .08), transparent 40%);
}
.ep-row.attention { border-color: rgba(255, 182, 92, .45); }
.ep-no { font-weight: 700; font-size: 14px; color: var(--text-2); width: 44px; flex: 0 0 44px; }
.ep-title { width: 190px; flex: 0 0 190px; min-width: 0; }
.ep-title b { font-size: 13.5px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-title span { font-size: 11px; color: var(--muted); }
.ep-src { width: 108px; flex: 0 0 108px; }
.stage-cells { display: flex; gap: 8px; flex: 1; min-width: 0; }
.s-cell {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px;
  border: 1px solid var(--line); border-radius: 7px; padding: 4px 9px; color: var(--text-2);
  flex: 1; max-width: 150px; min-width: 0; overflow: hidden; white-space: nowrap;
}
.s-cell svg { width: 12px; height: 12px; flex: 0 0 auto; }
.s-cell.ok { border-color: rgba(69,211,156,.28); background: var(--ok-subtle); color: var(--ok); }
.s-cell.info { border-color: rgba(88,166,255,.28); background: var(--info-subtle); color: var(--info); }
.s-cell.warn { border-color: rgba(255,182,92,.28); background: var(--warn-subtle); color: var(--warn); }
.s-cell.empty { color: var(--muted); opacity: .75; border-style: dashed; background: transparent; }
.ep-last { font-size: 11px; color: var(--muted); text-align: right; line-height: 1.55; width: 150px; flex: 0 0 150px; }
.popover { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; padding: 8px; min-width: 300px; }
.pop-item { display: flex; gap: 11px; padding: 10px; border-radius: 8px; cursor: pointer; }
.pop-item:hover { background: var(--panel2); }
.pop-item .ic { width: 32px; height: 32px; border-radius: 8px; background: var(--accent-subtle); color: var(--accent); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.pop-item .ic svg { width: 15px; height: 15px; }
.pop-item b { font-size: 13px; display: block; }
.pop-item p { font-size: 11.5px; color: var(--muted); margin: 2px 0 0; }
.pop-sep { height: 1px; background: var(--line); margin: 6px 0; }
.ptabs { display: flex; gap: 2px; }
.ptab { padding: 6px 14px; border-radius: 999px; font-size: 13px; color: var(--muted); cursor: pointer; }
.ptab.on { background: var(--accent-subtle); color: #fff; font-weight: 600; }
.imp-rows .kv { border-bottom: 1px solid var(--line); padding: 7px 0; }
.imp-rows .kv:last-of-type { border-bottom: none; }
</style>
