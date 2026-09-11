<template>
  <div style="flex:1; display:flex; flex-direction:column; min-height:0; overflow:auto">
    <div class="notice-strip" :class="readinessClass" style="margin-top:12px">
      <svg style="width:14px;height:14px"><use :href="readiness.status === 'ready' ? '#i-check-c' : '#i-warn'"/></svg>
      {{ readinessText }}
      <div class="spacer"></div>
      <span style="text-decoration:underline dotted; text-underline-offset:3px; cursor:pointer" @click="recheck">重新检查</span>
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
      <div v-for="(item, i) in referenced[tab] || []" :key="item.assetId" class="card acard" :class="{ miss: item.blocked }" @click="openDetail(item, i)">
        <div class="thumb" :class="[item.currentImage ? '' : 'ph', 'ph-' + (i % 6)]">
          <img v-if="item.currentImage" :src="item.currentImage" style="width:100%;height:100%;object-fit:cover">
          <span class="st badge" :class="item.blocked ? 'danger' : 'ok'">{{ item.blocked ? '缺当前图' : '已准备' }}</span>
        </div>
        <div class="info"><b>{{ item.name }}</b><p>{{ item.description || typeLabel(item.assetType) + ' · 本集引用' }}</p></div>
      </div>
      <p v-if="(referenced[tab] || []).length === 0" class="xs muted" style="padding:12px">本集剧本没有引用{{ tabLabel }}</p>
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
                <span v-for="st in detail?.states || []" :key="st.id" class="stchip" :class="{ on: st.id === selectedStateId }" @click="selectedStateId = st.id">{{ st.name }}</span>
                <span class="stchip" style="border-style:dashed"><svg style="width:11px;height:11px"><use href="#i-plus"/></svg>新增状态</span>
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
        <button class="icon-btn" @click="voiceOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="card pad" style="display:flex; gap:9px; padding:11px 12px; border-color:rgba(88,166,255,.3)">
          <svg style="width:14px;height:14px;color:var(--info);flex:0 0 auto;margin-top:2px"><use href="#i-mic"/></svg>
          <span class="xs" style="color:var(--info); line-height:1.6">本集对白将参考人物音色生成配音；未设置时使用模型默认声音，不阻断进入分镜。</span>
        </div>
        <div class="sec-t">预设音色</div>
        <div v-for="(p, i) in voicePresets" :key="p.id" class="v-row" :class="{ cur: selectedVoice === p.id }" @click="selectedVoice = p.id">
          <span class="vn"><svg style="width:15px;height:15px"><use href="#i-wave"/></svg></span>
          <div><b style="font-size:13px">{{ p.name }}</b><div class="vm">{{ p.desc }}</div></div>
          <div class="acts"><button class="btn sm ghost" style="border:1px solid var(--line)" @click.stop="selectedVoice = p.id">试听</button></div>
        </div>
        <div class="sec-t">其他来源</div>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <button class="btn sm" @click="comingSoon('素材库音色')">从素材库选择</button>
          <button class="btn sm" @click="comingSoon('本地上传')">上传音频</button>
          <button class="btn sm" @click="comingSoon('从音视频提取')">从音视频提取</button>
        </div>
        <div class="divider"></div>
        <button class="btn ghost sm" style="border:1px solid var(--line)" @click="selectedVoice = 'model-default'">改用模型默认声音</button>
      </div>
      <div class="drawer-f">
        <span class="muted xs">音色选择只影响本集配音生成</span>
        <div class="spacer"></div>
        <button class="btn primary" @click="voiceOpen = false">完成</button>
      </div>
    </aside>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

export default {
  name: 'AssetsStage',
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
      readiness: { status: 'checking' },
      detailOpen: false, detail: null, generating: false, entering: false,
      selectedStateId: '', techOpen: false,
      voiceOpen: false, selectedVoice: '',
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
      if (this.selectedVoice === 'model-default') return '模型默认声音'
      const p = this.voicePresets.find((x) => x.id === this.selectedVoice)
      return p ? p.name : '未设置 · 点击选择'
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.getEpisodeAssets(this.episodeId)
      this.referenced = data.referenced
      this.readiness = data.readiness
    },
    async recheck() {
      await this.load()
    },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.assetId)
      this.selectedStateId = item.stateId || (this.detail.states?.[0]?.id ?? '')
      this.detailOpen = true
    },
    async generate() {
      this.generating = true
      try {
        await v21.generateAssetCandidate(this.projectId, {
          type: this.detail.assetType,
          assetId: this.detail.id,
          prompt: this.detail.name,
        })
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.load()
      } finally {
        this.generating = false
      }
    },
    async useCandidate(candidate) {
      const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
      this.detail.currentImage = result.current.imageUrl
      for (const c of this.detail.candidates || []) c.isCurrent = c.candidateId === candidate.candidateId
      this.load()
    },
    async uploadImage() {
      const url = window.prompt('输入图片 URL：')
      if (!url) return
      await v21.uploadShotImage(this.detail.id, { imageUrl: url })
      this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
    },
    comingSoon(name) {
      alert(`${name}将在本迭代内启用`)
    },
    async enterStoryboard() {
      this.entering = true
      try {
        const result = await v21.enterStoryboard(this.episodeId)
        if (result.readiness && result.readiness.status === 'script-unapproved') {
          alert('确认剧本后才能生成本集媒体；仍可进入分镜查看结构')
        } else if (result.readiness && result.readiness.status === 'needs-attention') {
          console.info(`有 ${result.readiness.missing.length} 项可稍后处理，已进入分镜`)
        }
        this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`)
      } finally {
        this.entering = false
      }
    },
  },
}
</script>

<style scoped>
.atoolbar { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; margin-top: 14px; }
.acard { cursor: pointer; overflow: hidden; }
.acard.miss { border-color: rgba(255,107,120,.4); }
.acard .thumb { position: relative; height: 150px; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard .st { position: absolute; left: 8px; bottom: 8px; z-index: 2; }
.acard .info { padding: 10px 12px 12px; }
.acard .info b { font-size: 13.5px; }
.acard .info p { margin: 3px 0 0; font-size: 11.5px; color: var(--muted); }
.ed-thumb { display: flex; gap: 14px; }
.ed-thumb .main { width: 170px; height: 200px; border-radius: 10px; overflow: hidden; flex: 0 0 auto; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; letter-spacing: .3px; }
.stchips { display: flex; gap: 6px; flex-wrap: wrap; }
.stchip {
  height: 26px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line);
  font-size: 12px; color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
}
.stchip.on { border-color: var(--accent); background: var(--accent-subtle); color: #fff; }
.cand-row { display: flex; gap: 10px; flex-wrap: wrap; }
.cand { width: 120px; cursor: pointer; }
.cand .im { height: 114px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; overflow: hidden; }
.cand.cur .im { border: 2px solid var(--ok); }
.cand .cap { font-size: 10.5px; color: var(--muted); text-align: center; margin-top: 4px; }
.v-row { display: flex; align-items: flex-start; gap: 12px; padding: 13px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 9px; background: var(--panel2); cursor: pointer; }
.v-row.cur { border-color: var(--accent); background: var(--accent-subtle); }
.v-row .vn { font-size: 14px; }
.v-row .vm { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
.v-row .acts { margin-left: auto; display: flex; flex-direction: column; gap: 5px; }
.ph-0 { background: radial-gradient(120% 100% at 75% 15%, rgba(124,92,255,.30), transparent 55%), linear-gradient(155deg, #1c2440 0%, #0e1424 60%, #141b2e 100%); }
.ph-1 { background: radial-gradient(130% 100% at 70% 80%, rgba(255,182,92,.25), transparent 55%), linear-gradient(160deg, #2a1d33 0%, #10131f 60%, #191225 100%); }
.ph-2 { background: radial-gradient(120% 100% at 25% 20%, rgba(69,211,156,.22), transparent 55%), linear-gradient(150deg, #10281f 0%, #0c1622 65%, #122032 100%); }
.ph-3 { background: radial-gradient(120% 100% at 50% 10%, rgba(88,166,255,.30), transparent 55%), linear-gradient(165deg, #101b33 0%, #0b1220 60%, #0f1a2c 100%); }
.ph-4 { background: radial-gradient(110% 90% at 30% 75%, rgba(179,160,255,.22), transparent 55%), linear-gradient(150deg, #1d1830 0%, #0d101c 60%, #151228 100%); }
.ph-5 { background: radial-gradient(120% 90% at 75% 60%, rgba(69,211,156,.18), transparent 55%), linear-gradient(155deg, #14243a 0%, #0c1220 65%, #101c30 100%); }
</style>
