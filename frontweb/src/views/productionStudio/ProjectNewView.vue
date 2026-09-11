<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>新建项目</h1>
      <span class="sub">一次填写 · 一次创建</span>
    </header>
    <div class="page-body" style="padding:0">
      <div class="new-wrap">
        <div class="new-col">
          <div class="card pad">
            <div class="sec-title"><span class="n">1</span>项目资料</div>
            <div class="frow">
              <div class="flabel">项目名称</div>
              <div class="grow">
                <input class="input" style="width:100%" v-model="title" placeholder="给项目起个名字，如：青城夜巡人">
                <div class="fhint">创建后可随时在项目概览修改。</div>
              </div>
            </div>
            <div class="divider" style="margin:12px 0"></div>
            <div class="frow">
              <div class="flabel">题材</div>
              <div class="grow">
                <input class="input" style="width:100%" v-model="genre" placeholder="如：悬疑、都市奇幻、美食幻想">
                <div class="fhint">用于项目卡片展示与检索。</div>
              </div>
            </div>
            <div class="frow">
              <div class="flabel">画幅</div>
              <div class="grow">
                <div class="seg">
                  <span :class="{ on: aspectRatio === '9:16' }" @click="aspectRatio = '9:16'">9:16 竖屏</span>
                  <span :class="{ on: aspectRatio === '16:9' }" @click="aspectRatio = '16:9'">16:9 横屏</span>
                  <span :class="{ on: aspectRatio === '1:1' }" @click="aspectRatio = '1:1'">1:1 方形</span>
                </div>
                <div class="fhint">默认取自「常规设置 · 创作默认值」。</div>
              </div>
            </div>
            <div class="frow">
              <div class="flabel">单集目标时长</div>
              <div class="grow">
                <div class="row" style="gap:10px; align-items:center">
                  <input class="input" type="number" min="30" max="600" step="1" style="width:110px" v-model.number="episodeDurationSeconds">
                  <span class="xs muted">秒</span>
                  <div class="seg">
                    <span :class="{ on: episodeDurationSeconds === 60 }" @click="episodeDurationSeconds = 60">60</span>
                    <span :class="{ on: episodeDurationSeconds === 90 }" @click="episodeDurationSeconds = 90">90</span>
                    <span :class="{ on: episodeDurationSeconds === 120 }" @click="episodeDurationSeconds = 120">120</span>
                  </div>
                </div>
                <div class="fhint">默认取自全局设置，创建后可在每集设定中单独调整。</div>
              </div>
            </div>
          </div>

          <div class="card pad">
            <div class="sec-title"><span class="n">2</span>保存位置</div>
            <div class="frow" style="align-items:center">
              <div class="flabel">工作区目录</div>
              <div class="input grow" style="width:100%; color:var(--text-2); font-family:Consolas,monospace; font-size:12.5px">
                <svg><use href="#i-folder"/></svg>backend-node/data（本地工作区，只读）
              </div>
            </div>
            <div class="frow"><div class="flabel"></div><div class="fhint">项目媒体将保存在该目录下，可随时在设置中迁移。</div></div>
          </div>

          <div class="card pad">
            <div class="sec-title"><span class="n">3</span>开始方式</div>
            <div class="src-grid">
              <div v-for="src in sources" :key="src.key" class="src-card" :class="{ sel: source === src.key }" @click="source = src.key">
                <div class="ic"><svg><use :href="src.icon"/></svg></div>
                <b>{{ src.title }}</b>
                <p>{{ src.desc }}</p>
              </div>
            </div>
            <div class="more-src" style="margin-top:12px">更多开始方式：<a @click="source = 'blank'">空白创建</a> · <a @click="source = 'novel'">小说 / 长文本拆集</a> · <a @click="source = 'video'">从已有视频开始剪辑</a> · <a @click="source = 'external_ai'">外部 AI 协作</a></div>
          </div>

          <div class="row" style="padding: 2px 4px 18px">
            <span v-if="createError" class="small" style="color:var(--danger)">{{ createError }}</span>
            <span v-else-if="!title.trim()" class="muted xs">填写项目名称后可创建 · 创建前不会写入任何数据</span>
            <span v-else class="muted xs">创建前不会写入任何数据；取消可随时离开。</span>
            <div class="spacer"></div>
            <button class="btn ghost" @click="$router.push('/projects')">取消</button>
            <button class="btn primary lg" :disabled="!title.trim() || creating" @click="create">
              {{ ctaLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

const SOURCE_META = {
  script: { cta: '创建项目并导入剧本', icon: '#i-doc', title: '我有剧本', desc: '粘贴或导入已写好的剧本，自动拆分场次后进入编辑器。' },
  ai: { cta: '创建项目并由 AI 起草', icon: '#i-spark', title: '让 AI 帮我写', desc: '输入梗概与要求，AI 生成首集草稿，确认前可反复重写。' },
  package: { cta: '创建项目并导入制作包', icon: '#i-box', title: '我有制作包', desc: '导入 episode-package 制作包，剧本、分镜与素材一次进入。' },
  blank: { cta: '创建空白项目', icon: '#i-doc', title: '空白创建', desc: '创建空白剧集，从空白编辑器开始。' },
  novel: { cta: '创建项目并拆集', icon: '#i-doc', title: '小说 / 长文本拆集', desc: '按章节预览拆集与编号，逐集生成草稿。' },
  video: { cta: '创建项目并登记视频', icon: '#i-film', title: '从已有视频开始剪辑', desc: '登记原片后进入短片页，只读保护原文件。' },
  external_ai: { cta: '创建项目并创建任务包', icon: '#i-spark', title: '外部 AI 协作', desc: '创建任务包，外部会话结果 JSON 回流为草稿。' },
}

function clampDuration(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 30 && n <= 600 ? n : null
}

export default {
  name: 'ProjectNewView',
  data() {
    return {
      title: '', aspectRatio: '16:9', genre: '', description: '',
      episodeDurationSeconds: 90,
      source: 'script', creating: false, createError: '',
      sources: ['script', 'ai', 'package'].map((k) => ({ key: k, ...SOURCE_META[k] })),
    }
  },
  computed: {
    ctaLabel() {
      return SOURCE_META[this.source]?.cta || '创建项目'
    },
  },
  async mounted() {
    // 画幅与单集目标时长继承「常规设置 · 创作默认值」（§24.5）；拉取失败保持内置缺省
    try {
      const d = await v21.getSettingsDefaults()
      if (d && typeof d === 'object') {
        if (d.aspectRatio) this.aspectRatio = d.aspectRatio
        const dur = clampDuration(d.episodeDurationSeconds)
        if (dur !== null) this.episodeDurationSeconds = dur
      }
    } catch (_) { /* 默认值拉取失败时使用内置缺省 */ }
  },
  methods: {
    async create() {
      if (this.creating) return
      this.creating = true
      this.createError = ''
      try {
        const project = await v21.createProject({
          title: this.title.trim(),
          aspectRatio: this.aspectRatio,
          genre: this.genre.trim(),
          description: this.description.trim(),
          targetDurationSeconds: clampDuration(this.episodeDurationSeconds) || 90,
        })
        const pid = project.id
        if (this.source === 'script' || this.source === 'blank' || this.source === 'ai') {
          await v21.createEpisode(pid, { title: '第 1 集' })
          const list = await v21.listEpisodes(pid, {})
          const first = (list.items || [])[0]
          this.$router.replace(`/projects/${pid}/episodes/${first.id}/script`)
        } else if (this.source === 'package') {
          this.$router.replace(`/projects/${pid}/episodes/import-package`)
        } else if (this.source === 'external_ai') {
          this.$router.replace(`/projects/${pid}/episodes/external-ai`)
        } else if (this.source === 'novel' || this.source === 'video') {
          this.$router.replace(`/projects/${pid}/episodes`)
        } else {
          this.$router.replace(`/projects/${pid}`)
        }
      } catch (e) {
        this.createError = e.message || '创建失败'
        this.creating = false
      }
    },
  },
}
</script>

<style scoped>
.new-wrap { max-width: 828px; margin: 0 auto; padding: 22px 24px 0; }
.new-col { display: flex; flex-direction: column; gap: 14px; }
.sec-title { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; margin-bottom: 14px; }
.sec-title .n { width: 22px; height: 22px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent); font-size: 12px; display: inline-flex; align-items: center; justify-content: center; }
.frow { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 10px; }
.flabel { width: 90px; flex: 0 0 90px; font-size: 13px; color: var(--text-2); padding-top: 8px; }
.fhint { font-size: 11px; color: var(--muted); margin-top: 4px; }
.src-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.src-card { border: 1px solid var(--line); border-radius: 10px; padding: 16px 14px; cursor: pointer; background: var(--panel2); }
.src-card:hover { border-color: var(--line-strong); }
.src-card.sel { border-color: var(--accent); background: var(--accent-subtle); }
.src-card .ic { width: 34px; height: 34px; border-radius: 9px; background: var(--neutral-subtle); color: var(--muted); display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
.src-card.sel .ic { background: var(--accent); color: #fff; }
.src-card .ic svg { width: 17px; height: 17px; }
.src-card b { font-size: 13.5px; display: block; margin-bottom: 5px; }
.src-card p { font-size: 11.5px; color: var(--muted); line-height: 1.55; margin: 0; }
.more-src { font-size: 12.5px; color: var(--muted); }
.more-src a { color: var(--text-2); cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
.more-src a:hover { color: var(--text); }
</style>
