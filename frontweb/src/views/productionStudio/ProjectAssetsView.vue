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

    <!-- 素材详情 Drawer -->
    <div v-if="detailOpen" class="scrim" style="z-index:80" @click="detailOpen = false"></div>
    <aside v-if="detailOpen" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail?.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 项目素材</span></h3>
        <button class="icon-btn" @click="detailOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-if="detail?.currentImage" style="border-radius:10px; overflow:hidden; margin-bottom:12px; max-height:260px">
          <img :src="detail.currentImage" style="width:100%; display:block">
        </div>
        <div class="sec-t">候选 <span class="muted" style="font-weight:400">· 点击候选即设为当前图</span></div>
        <div class="cand-row">
          <div v-for="c in detail?.candidates || []" :key="c.candidateId" class="cand" :class="{ cur: c.isCurrent }" @click="useCandidate(c)">
            <div class="im"><img :src="c.url" style="width:100%;height:100%;object-fit:cover"></div>
            <div class="cap" :class="c.isCurrent ? 'ok-t' : ''">{{ c.isCurrent ? '当前图' : '候选' }}</div>
          </div>
          <div class="cand"><div class="im" style="border:1px dashed var(--line-strong); display:flex; align-items:center; justify-content:center; color:var(--muted); cursor:pointer" @click="generate"><svg style="width:18px;height:18px"><use href="#i-plus"/></svg></div><div class="cap">生成</div></div>
        </div>
        <div class="sec-t">简短资料</div>
        <div class="kv"><span class="k">描述</span><span class="v">{{ detail?.description || '—' }}</span></div>
        <div class="kv" v-if="detail?.states?.length"><span class="k">状态</span><span class="v">{{ detail.states.map((s) => s.name).join(' · ') }}</span></div>
      </div>
      <div class="drawer-f">
        <button class="btn danger" @click="remove"><svg><use href="#i-trash"/></svg>删除</button>
        <div class="spacer"></div>
        <button class="btn primary" :disabled="generating" @click="generate"><svg><use href="#i-spark"/></svg>生成候选</button>
      </div>
    </aside>
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
    async create() {
      await v21.createAsset(this.projectId, { type: this.createForm.type, fields: { name: this.createForm.name, description: this.createForm.description } })
      this.createOpen = false
      this.createForm = { type: this.createForm.type, name: '', description: '' }
      this.load()
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.id)
      this.detailOpen = true
    },
    async generate() {
      this.generating = true
      try {
        await v21.generateAssetCandidate(this.projectId, { type: this.detail.assetType, assetId: this.detail.id, prompt: this.detail.name })
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
    async remove() {
      const result = await v21.deleteAsset(this.detail.assetType, this.detail.id)
      if (result.blocked) {
        alert(result.message)
        return
      }
      if (!window.confirm('素材将移入回收站（可恢复）。确认删除？')) return
      await v21.deleteAsset(this.detail.assetType, this.detail.id)
      this.detailOpen = false
      this.load()
    },
    comingSoon(name) {
      alert(`${name}将在本迭代内启用`)
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
.ph-0 { background: radial-gradient(120% 100% at 75% 15%, rgba(124,92,255,.30), transparent 55%), linear-gradient(155deg, #1c2440 0%, #0e1424 60%, #141b2e 100%); }
.ph-1 { background: radial-gradient(130% 100% at 70% 80%, rgba(255,182,92,.25), transparent 55%), linear-gradient(160deg, #2a1d33 0%, #10131f 60%, #191225 100%); }
.ph-2 { background: radial-gradient(120% 100% at 25% 20%, rgba(69,211,156,.22), transparent 55%), linear-gradient(150deg, #10281f 0%, #0c1622 65%, #122032 100%); }
.ph-3 { background: radial-gradient(120% 100% at 50% 10%, rgba(88,166,255,.30), transparent 55%), linear-gradient(165deg, #101b33 0%, #0b1220 60%, #0f1a2c 100%); }
.ph-4 { background: radial-gradient(110% 90% at 30% 75%, rgba(179,160,255,.22), transparent 55%), linear-gradient(150deg, #1d1830 0%, #0d101c 60%, #151228 100%); }
.ph-5 { background: radial-gradient(120% 90% at 75% 60%, rgba(69,211,156,.18), transparent 55%), linear-gradient(155deg, #14243a 0%, #0c1220 65%, #101c30 100%); }
</style>
