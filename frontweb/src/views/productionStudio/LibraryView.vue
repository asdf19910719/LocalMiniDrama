<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>资产库</h1>
      <span class="sub">跨项目复用 · 本地素材</span>
      <div class="spacer"></div>
      <button class="btn primary" style="height:36px" @click="comingSoon('添加到资产库')"><svg><use href="#i-plus"/></svg>添加到资产库</button>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px">

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

      <div v-for="grp in grouped" :key="grp.key">
        <div class="sec-label">{{ grp.label }} <span class="hint muted">· {{ grp.items.length }} 项 · 点击打开详情抽屉</span></div>
        <div class="agrid">
          <div v-for="(item, i) in grp.items" :key="grp.key + item.id" class="card acard" :class="[grp.key, { offline: !item.local_path && !item.image_url }]" @click="openDetail(grp.key, item)">
            <div class="thumb" :class="item.image_url ? 'has-img' : 'ph ph-' + ((i + grp.key.length) % 6)">
              <img v-if="item.image_url" :src="item.image_url">
              <span v-if="!item.local_path && !item.image_url" class="st badge danger">文件不可访问</span>
              <span v-else class="st badge neutral">v1</span>
            </div>
            <div class="info"><b>{{ item.name }}</b><p>{{ descOf(item) }}</p></div>
          </div>
        </div>
      </div>
      <p v-if="grouped.length === 0 && loaded" class="muted" style="text-align:center; padding:60px 0">
        资产库为空 · 从项目素材或本地导入添加
      </p>
    </div>

    <!-- 资产库详情抽屉（33） -->
    <div v-if="detail" class="scrim" style="z-index:80" @click="detail = null"></div>
    <aside v-if="detail" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 资产库</span></h3>
        <button class="icon-btn" @click="detail = null"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-if="detail.image_url" style="border-radius:10px; overflow:hidden; margin-bottom:14px">
          <img :src="detail.image_url" style="width:100%; display:block">
        </div>
        <div class="sec-t">基本资料</div>
        <div class="kv"><span class="k">类型</span><span class="v">{{ typeLabel(detail._kind) }}</span></div>
        <div class="kv"><span class="k">描述</span><span class="v">{{ detail.description || '—' }}</span></div>
        <div class="sec-t">版本历史</div>
        <div class="kv"><span class="k">当前版本</span><span class="v">v1</span></div>
        <div class="sec-t">来源与许可</div>
        <div class="kv"><span class="k">来源</span><span class="v">{{ detail.source_type || '本地导入' }}</span></div>
        <div class="sec-t">文件状态</div>
        <div class="kv"><span class="k">本地路径</span><span class="v mono xs">{{ detail.local_path || detail.image_url || '—' }}</span></div>
        <div class="row" style="margin-top:14px; padding:9px 12px; border:1px solid var(--line); border-radius:8px">
          <svg style="width:14px;height:14px;color:var(--muted)"><use href="#i-shield"/></svg>
          <span class="xs muted" style="line-height:1.6">被项目引用的资产只能归档，不能物理删除；用于项目时选择「使用这个版本」固定当前版本，不随库更新漂移。</span>
        </div>
      </div>
      <div class="drawer-f">
        <button class="btn ghost" @click="comingSoon('归档')">归档</button>
        <div class="spacer"></div>
        <button class="btn primary" @click="useInProject">用于项目</button>
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
  </div>
</template>

<script>
import axios from 'axios'
import v21 from '@/v21/api.js'

export default {
  name: 'LibraryView',
  data() {
    return {
      type: 'all', q: '', loaded: false,
      chars: [], scenes: [], props: [],
      detail: null, useOpen: false, useTarget: '', projects: [],
    }
  },
  computed: {
    totalAll() { return this.chars.length + this.scenes.length + this.props.length },
    grouped() {
      const groups = []
      for (const [key, label, items] of [
        ['character', '人物', this.chars],
        ['scene', '场景', this.scenes],
        ['prop', '道具', this.props],
      ]) {
        if (this.type !== 'all' && this.type !== key) continue
        const filtered = this.q ? items.filter((i) => String(i.name || '').toLowerCase().includes(this.q.toLowerCase())) : items
        if (filtered.length === 0) continue
        groups.push({ key, label, items: filtered })
      }
      return groups
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.loaded = true
      try {
        const [c, s, p] = await Promise.all([
          axios.get('/api/v1/character-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
          axios.get('/api/v1/scene-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
          axios.get('/api/v1/prop-library', { params: { page: 1, page_size: 200 } }).then((r) => r.data?.data?.items || []),
        ])
        this.chars = c.map((x) => ({ ...x, _kind: 'character' }))
        this.scenes = s.map((x) => ({ ...x, _kind: 'scene' }))
        this.props = p.map((x) => ({ ...x, _kind: 'prop' }))
      } catch { /* 保留空态 */ }
      try {
        const proj = await v21.listProjects({})
        this.projects = proj.items || []
      } catch { this.projects = [] }
    },
    countOf(t) {
      return { character: this.chars.length, scene: this.scenes.length, prop: this.props.length }[t] || 0
    },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    descOf(item) {
      return item.description || item._kind
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
        alert(`已复制「${item.name}」到目标项目素材（复制独立副本，保留来源记录）`)
      } catch (e) {
        alert(e.message)
      }
    },
    comingSoon(name) {
      alert(`${name}将在本迭代内启用`)
    },
  },
}
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; }
.sec-label { font-size: 13px; font-weight: 600; margin: 4px 0 10px; }
.sec-label .hint { font-weight: 400; font-size: 11.5px; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 13px; margin-bottom: 20px; }
.acard { cursor: pointer; overflow: hidden; }
.acard .thumb { position: relative; overflow: hidden; }
.acard.character .thumb { height: 200px; }
.acard.scene .thumb { height: 144px; }
.acard.prop .thumb { height: 144px; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard.offline .thumb { filter: grayscale(.7) brightness(.6); }
.acard .st { position: absolute; left: 8px; bottom: 8px; z-index: 2; }
.acard .info { padding: 8px 12px 10px; }
.acard .info b { font-size: 13.5px; display: block; }
.acard .info p { font-size: 11.5px; color: var(--muted); margin-top: 2px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; letter-spacing: .3px; }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
.mono { font-family: Consolas, monospace; }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
.ph-0 { background: radial-gradient(120% 100% at 75% 15%, rgba(124,92,255,.30), transparent 55%), linear-gradient(155deg, #1c2440 0%, #0e1424 60%, #141b2e 100%); }
.ph-1 { background: radial-gradient(130% 100% at 70% 80%, rgba(255,182,92,.25), transparent 55%), linear-gradient(160deg, #2a1d33 0%, #10131f 60%, #191225 100%); }
.ph-2 { background: radial-gradient(120% 100% at 25% 20%, rgba(69,211,156,.22), transparent 55%), linear-gradient(150deg, #10281f 0%, #0c1622 65%, #122032 100%); }
.ph-3 { background: radial-gradient(120% 100% at 50% 10%, rgba(88,166,255,.30), transparent 55%), linear-gradient(165deg, #101b33 0%, #0b1220 60%, #0f1a2c 100%); }
.ph-4 { background: radial-gradient(110% 90% at 30% 75%, rgba(179,160,255,.22), transparent 55%), linear-gradient(150deg, #1d1830 0%, #0d101c 60%, #151228 100%); }
.ph-5 { background: radial-gradient(120% 90% at 75% 60%, rgba(69,211,156,.18), transparent 55%), linear-gradient(155deg, #14243a 0%, #0c1220 65%, #101c30 100%); }
</style>
