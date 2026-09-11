<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes`)"><svg><use href="#i-back"/></svg></button>
      <h1>导入制作包（V2.1 JSON）</h1>
      <span class="sub">五步预览导入 · 只写结构化草稿 · 全程零媒体任务</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">
      <div class="wsteps">
        <span v-for="(s, i) in ['选择目标与文件', '预览与资产决策', '写入草稿']" :key="s" class="wstep" :class="{ on: step === i, done: step > i }">
          <span class="wn">{{ step > i ? '✓' : i + 1 }}</span>{{ s }}
        </span>
      </div>

      <!-- 步骤 1：目标 + 文件身份 -->
      <div v-if="step === 0" class="card pad" style="max-width:780px">
        <div class="row" style="margin-bottom:12px">
          <span class="badge accent">episode-package@2.1</span>
          <span class="xs muted">唯一接受的制作包协议版本</span>
        </div>
        <b style="font-size:14px">选择写入目标</b>
        <p class="muted small" style="margin:6px 0 10px">只允许「创建新剧集」或「填充空白剧集」；非空剧集会被后端拒绝（TARGET_NOT_BLANK）。</p>
        <div class="seg">
          <span :class="{ on: targetMode === 'create_new' }" @click="targetMode = 'create_new'">创建下一集</span>
          <span :class="{ on: targetMode === 'fill_blank' }" @click="targetMode = 'fill_blank'">填充空白剧集</span>
        </div>
        <div v-if="targetMode === 'fill_blank'" style="margin-top:10px">
          <select v-model="targetEpisodeId" class="input" style="width:280px">
            <option value="" disabled>选择空白剧集</option>
            <option v-for="ep in blankEpisodes" :key="ep.id" :value="ep.id">第 {{ ep.episodeNumber }} 集 · {{ ep.title || '空白' }}</option>
          </select>
          <span v-if="blankEpisodes.length === 0" class="xs warn-t" style="margin-left:8px">当前项目没有空白剧集</span>
        </div>

        <div class="divider"></div>
        <b style="font-size:14px">粘贴制作包 JSON</b>
        <textarea v-model="rawText" rows="12" class="input" style="width:100%; margin-top:10px; font-family:ui-monospace,Consolas,monospace; line-height:1.6; resize:vertical" placeholder='粘贴 episode-package@2.1 结果文件内容（schema: local-mini-drama.episode-package, version: "2.1"）'></textarea>

        <div class="divider"></div>
        <b style="font-size:14px">文件身份（可选）</b>
        <p class="muted small" style="margin:6px 0 10px">用于导入来源追溯与防重复导入；两项都会随预览与确认提交给后端记录。</p>
        <div class="col" style="gap:8px">
          <label class="col" style="gap:4px"><span class="xs muted">来源文件名</span>
            <input v-model="sourceFilename" class="input" style="width:100%" placeholder="例如 ep03_package.json">
          </label>
          <label class="col" style="gap:4px"><span class="xs muted">SHA-256</span>
            <input v-model="sourceSha256" class="input" style="width:100%; font-family:ui-monospace,Consolas,monospace" placeholder="从导出方获取，用于来源追溯">
          </label>
        </div>

        <div v-if="targetNotice" class="warnbar" style="margin-top:12px">
          <svg><use href="#i-warn"/></svg>{{ targetNotice }}
        </div>
        <div v-if="previewError && !targetNotice" class="errbar" style="margin-top:12px">
          <svg><use href="#i-warn"/></svg>{{ previewError }}
        </div>
        <div class="row" style="margin-top:14px; justify-content:flex-end">
          <button class="btn primary" :disabled="!rawText.trim() || (targetMode === 'fill_blank' && !targetEpisodeId) || previewing" @click="preview">
            {{ previewing ? '解析中…' : '预览导入' }}
          </button>
        </div>
      </div>

      <!-- 步骤 2：预览与资产决策（四区块） -->
      <div v-else-if="step === 1" class="card pad" style="max-width:880px">
        <template v-if="plan && plan.ok">
          <!-- 区块 1：剧本与场次 -->
          <section class="imp-block">
            <div class="row" style="margin-bottom:8px">
              <svg style="width:15px;height:15px;color:var(--accent)"><use href="#i-doc"/></svg>
              <b style="font-size:13.5px">剧本与场次</b>
              <span class="chip">{{ plan.script.title || '未命名' }} · 场次 {{ plan.script.sceneCount }}</span>
            </div>
            <p v-if="plan.script.summary" class="small t2" style="line-height:1.6">{{ plan.script.summary }}</p>
            <p v-if="plan.script.scriptPreview" class="xs muted imp-preview">{{ plan.script.scriptPreview }}…</p>
            <p class="xs muted" style="margin-top:4px">正文字数 {{ plan.script.wordCount }}</p>
          </section>

          <div class="divider"></div>

          <!-- 区块 2：素材与对象（逐项匹配决策） -->
          <section class="imp-block">
            <div class="row" style="margin-bottom:8px">
              <svg style="width:15px;height:15px;color:var(--accent)"><use href="#i-box"/></svg>
              <b style="font-size:13.5px">素材与对象</b>
              <span class="chip">新建 {{ plan.assets.createCount }} · 复用 {{ plan.assets.reuseCount }}</span>
              <span class="spacer"></span>
              <span v-if="conflictCount" class="badge danger">请先处理 {{ conflictCount }} 项冲突</span>
            </div>
            <div v-for="m in plan.assets.matches" :key="m.type + ':' + m.sourceKey" class="match-row">
              <span class="badge outline"><svg><use :href="matchIcon(m.type)"/></svg>{{ matchTypeLabel(m.type) }}</span>
              <b class="small">{{ m.name || m.sourceKey }}</b>
              <span class="xs muted ellipsis imp-key">{{ m.sourceKey }}</span>
              <span class="badge" :class="{ ok: m.action === 'create', accent: m.action === 'reuse', info: m.action === 'match-with-character' }">{{ matchActionLabel(m) }}</span>
              <span class="spacer"></span>
              <label class="xs muted" style="display:inline-flex; align-items:center; gap:5px; cursor:pointer">
                <input v-model="ignoredMap[m.sourceKey]" type="checkbox">忽略此项
              </label>
            </div>
            <p v-if="plan.assets.matches.length === 0" class="muted small">该制作包不包含素材条目。</p>
            <p class="xs muted" style="margin-top:8px">
              勾选「忽略此项」的素材不会创建、也不会关联到本集（confirm 以 ignoredSourceKeys 提交）；
              已有素材按 source_key 精确匹配复用，不产生新记录。
            </p>
          </section>

          <div class="divider"></div>

          <!-- 区块 3：分镜与时段 -->
          <section class="imp-block">
            <div class="row" style="margin-bottom:8px">
              <svg style="width:15px;height:15px;color:var(--accent)"><use href="#i-film"/></svg>
              <b style="font-size:13.5px">分镜与时段</b>
              <span class="chip">分镜 {{ plan.shots.count }} · 时段 {{ plan.shots.segmentCount }} · 媒体任务 {{ plan.summary.mediaTasks }}</span>
              <span class="badge ok">零媒体任务</span>
            </div>
            <p class="xs muted">本向导只写结构化草稿（剧本/场次/资产/分镜/时段），不会创建任何图片、视频、音频任务。</p>
          </section>

          <div class="divider"></div>

          <!-- 区块 4：来源 -->
          <section class="imp-block">
            <div class="row" style="margin-bottom:8px">
              <svg style="width:15px;height:15px;color:var(--accent)"><use href="#i-link"/></svg>
              <b style="font-size:13.5px">来源</b>
            </div>
            <div class="kv"><span class="k">文件名</span><span class="v">{{ plan.source.filename || '—（未填写）' }}</span></div>
            <div class="kv"><span class="k">SHA-256</span><span class="v imp-mono">{{ plan.source.sha256 || '—（未填写）' }}</span></div>
            <div class="kv"><span class="k">协议版本</span><span class="v">episode-package@2.1</span></div>
          </section>
        </template>

        <template v-else>
          <div class="errbar">
            <svg><use href="#i-warn"/></svg>{{ (plan && plan.errors || []).map((e) => `${e.path || '(root)'}: ${e.message}`).join('；') || '校验未通过' }}
          </div>
        </template>

        <div v-if="confirmError" class="errbar" style="margin-top:12px">
          <svg><use href="#i-warn"/></svg>{{ confirmError }}
          <span class="spacer"></span>
          <button class="btn sm" @click="confirm" :disabled="confirming">重试</button>
        </div>

        <div class="row" style="margin-top:16px; justify-content:flex-end; gap:10px">
          <button class="btn ghost" @click="step = 0">上一步</button>
          <button class="btn primary" :disabled="!plan || !plan.ok || confirming || conflictCount > 0" @click="confirm">
            {{ confirming ? '写入中…' : '确认导入' }}
          </button>
        </div>
      </div>

      <!-- 步骤 3：成功与结果动作 -->
      <div v-else class="card pad" style="max-width:780px">
        <div class="row" style="margin-bottom:10px">
          <span class="badge ok">导入完成</span>
          <b style="font-size:14px">已写入第 {{ plan && plan.target ? plan.target.episodeNumber : '—' }} 集草稿（零媒体任务）</b>
        </div>
        <p class="xs muted" style="margin-bottom:14px">剧集 ID：{{ importedEpisodeId }} · 剧本以草稿修订写入，需在剧本页确认后才进入后续阶段。</p>
        <div class="col" style="gap:8px; max-width:420px">
          <button class="btn" style="justify-content:flex-start" @click="$router.push(`/projects/${projectId}/episodes/${importedEpisodeId}/script`)">
            <svg><use href="#i-doc"/></svg>打开剧本
          </button>
          <button class="btn" style="justify-content:flex-start" @click="$router.push(`/projects/${projectId}/episodes/${importedEpisodeId}/assets`)">
            <svg><use href="#i-box"/></svg>检查本集设定
          </button>
          <button class="btn" style="justify-content:flex-start" @click="$router.push(`/projects/${projectId}/episodes?highlight=${importedEpisodeId}`)">
            <svg><use href="#i-grid"/></svg>查看剧集行
          </button>
          <button class="btn ghost" style="justify-content:flex-start" @click="$router.push(`/projects/${projectId}`)">
            <svg><use href="#i-back"/></svg>返回项目
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { v21 } from '@/v21/api.js'
import { collectIgnoredSourceKeys, matchActionLabel, matchTypeLabel, unresolvedConflictCount } from '@/utils/episodeImportDecisions.js'

export default {
  name: 'EpisodePackageImportView',
  data() {
    return {
      step: 0,
      targetMode: 'create_new',
      targetEpisodeId: '',
      blankEpisodes: [],
      rawText: '',
      sourceFilename: '',
      sourceSha256: '',
      previewing: false,
      previewError: '',
      plan: null,
      ignoredMap: {},
      confirming: false,
      confirmError: '',
      targetNotice: '',
      importedEpisodeId: null,
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    matches() { return (this.plan && this.plan.assets && this.plan.assets.matches) || [] },
    ignoredKeys() { return collectIgnoredSourceKeys(this.matches, this.ignoredMap) },
    conflictCount() { return unresolvedConflictCount(this.matches, this.ignoredKeys) },
  },
  async mounted() {
    try {
      const data = await v21.listBlankEpisodes(this.projectId)
      this.blankEpisodes = (data && data.items) || []
    } catch { this.blankEpisodes = [] }
  },
  methods: {
    matchTypeLabel,
    matchActionLabel,
    matchIcon(type) {
      return { character: '#i-user', character_state: '#i-layers', scene: '#i-scene', prop: '#i-cube' }[type] || '#i-box'
    },
    async preview() {
      this.previewing = true
      this.previewError = ''
      this.targetNotice = ''
      try {
        const pkg = JSON.parse(this.rawText)
        this.plan = await v21.previewImportPackage(this.projectId, {
          pkg,
          dramaId: this.projectId,
          targetEpisodeId: this.targetMode === 'fill_blank' ? this.targetEpisodeId : null,
          sourceFilename: this.sourceFilename,
          sourceSha256: this.sourceSha256,
        })
        this.ignoredMap = {}
        if (!this.plan.ok) {
          this.previewError = (this.plan.errors || []).map((e) => `${e.path || '(root)'}: ${e.message}`).join('；')
          const first = (this.plan.errors || [])[0]
          if (first && first.code === 'TARGET_NOT_BLANK') {
            this.targetNotice = '目标剧集已包含内容，请选择空白剧集或创建新剧集'
            this.step = 0
            return
          }
        }
        this.step = 1
      } catch (e) {
        this.previewError = `JSON 解析失败：${e.message}`
      } finally {
        this.previewing = false
      }
    },
    async confirm() {
      if (this.confirming) return
      this.confirming = true
      this.confirmError = ''
      this.targetNotice = ''
      try {
        const pkg = JSON.parse(this.rawText)
        const result = await v21.confirmImportPackage(this.projectId, {
          pkg,
          targetEpisodeId: this.targetMode === 'fill_blank' ? this.targetEpisodeId : null,
          sourceFilename: this.sourceFilename,
          sourceSha256: this.sourceSha256,
          decisions: { ignoredSourceKeys: this.ignoredKeys },
        })
        this.importedEpisodeId = result.episodeId
        this.step = 2
      } catch (err) {
        if (err && err.code === 'TARGET_NOT_BLANK') {
          this.targetNotice = '目标剧集已包含内容，请选择空白剧集或创建新剧集'
          this.step = 0
        } else {
          this.confirmError = (err && err.message) || '导入失败，请重试'
        }
      } finally {
        this.confirming = false
      }
    },
  },
}
</script>

<style scoped>
.wsteps { display: flex; align-items: center; gap: 14px; padding: 4px 2px; }
.wstep { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.wstep .wn { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; }
.wstep.on { color: #fff; font-weight: 600; }
.wstep.on .wn { background: var(--accent); border-color: var(--accent); color: #fff; }
.wstep.done { color: var(--ok); }
.wstep.done .wn { background: var(--ok-subtle); border-color: var(--ok); color: var(--ok); }
.imp-block { display: block; }
.match-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
.match-row:last-of-type { border-bottom: none; }
.match-row svg { width: 12px; height: 12px; }
.imp-key { font-family: ui-monospace, Consolas, monospace; max-width: 260px; }
.imp-mono { font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.imp-preview { border-left: 2px solid var(--line-strong); padding-left: 10px; margin-top: 8px; line-height: 1.6; }
textarea.input { display: block; }
.errbar, .warnbar {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 8px;
  font-size: 12.5px;
}
.errbar { border: 1px solid rgba(255, 107, 120, .3); background: var(--danger-subtle); color: var(--danger); }
.warnbar { border: 1px solid rgba(255, 182, 92, .3); background: var(--warn-subtle); color: var(--warn); }
.errbar svg, .warnbar svg { width: 14px; height: 14px; flex: 0 0 auto; }
</style>
