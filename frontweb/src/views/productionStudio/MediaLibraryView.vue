<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>媒体素材库</h1>
      <span class="sub">项目媒体 · 使用位置 · 来源追溯</span>
      <div class="spacer"></div>
      <div class="input" style="width:220px">
        <svg><use href="#i-search"/></svg>
        <input v-model="q" placeholder="搜索业务名称 / 文件名" style="background:transparent;border:none;outline:none;color:var(--text);width:100%;font-size:13px">
      </div>
    </header>
    <div class="page-body" style="overflow:auto">
      <div class="toolbar">
        <div class="seg">
          <span :class="{ on: type === 'all' }" @click="type = 'all'">全部</span>
          <span :class="{ on: type === 'image' }" @click="type = 'image'">图片</span>
          <span :class="{ on: type === 'video' }" @click="type = 'video'">视频</span>
        </div>
        <div class="spacer"></div>
        <span class="muted xs">卡片标题优先显示业务名称；文件名作为次级信息</span>
      </div>
      <div class="agrid">
        <div v-for="(m, i) in filtered" :key="m.key" class="card acard" @click="openDetail(m)">
          <div class="thumb" :class="m.url ? '' : 'ph ph-' + (i % 6)">
            <img v-if="m.url" :src="m.url">
            <svg v-else style="width:22px;height:22px;color:var(--muted)"><use :href="m.kind === 'video' ? '#i-film' : '#i-image'"/></svg>
          </div>
          <div class="info"><b>{{ m.title }}</b><p class="mono xs">{{ m.fileName }}</p></div>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="muted" style="text-align:center; padding:50px 0">暂无媒体</p>
    </div>

    <div v-if="detail" class="scrim" style="z-index:80" @click="detail = null"></div>
    <aside v-if="detail" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3 style="font-size:14px">{{ detail.title }}</h3>
        <button class="icon-btn" @click="detail = null"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-if="detail.url" style="border-radius:10px; overflow:hidden; margin-bottom:12px">
          <img v-if="detail.kind === 'image'" :src="detail.url" style="width:100%; display:block">
          <video v-else :src="detail.url" controls style="width:100%"></video>
        </div>
        <div class="kv"><span class="k">类型</span><span class="v">{{ detail.kind }}</span></div>
        <div class="kv"><span class="k">文件名</span><span class="v mono xs">{{ detail.fileName }}</span></div>
        <div class="kv"><span class="k">URL</span><span class="v mono xs ellipsis" style="max-width:220px">{{ detail.url }}</span></div>
        <div class="sec-t">使用位置</div>
        <div class="xs muted">媒体与项目/剧集的精确绑定关系由引用该媒体的分镜/候选记录追溯。</div>
      </div>
    </aside>
  </div>
</template>

<script>
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'MediaLibraryView',
  mixins: [escMixin],
  data() {
    return { type: 'all', q: '', media: [], detail: null }
  },
  computed: {
    filtered() {
      let list = this.media
      if (this.type !== 'all') list = list.filter((m) => m.kind === this.type)
      if (this.q) {
        const needle = this.q.toLowerCase()
        list = list.filter((m) => m.title.toLowerCase().includes(needle) || m.fileName.toLowerCase().includes(needle))
      }
      return list
    },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.load()
  },
  methods: {
    // Esc 关媒体详情抽屉
    onEsc() {
      if (this.detail) { this.detail = null; return true }
      return false
    },
    async load() {
      // 从项目素材 + 成片导出目录聚合（经 /api/v2 项目资产与已知导出路径）
      const media = []
      try {
        const dramas = await fetch('/api/v1/dramas').then((r) => r.json())
        const items = dramas?.data?.items || []
        for (const d of items) {
          try {
            const assets = await fetch(`/api/v2/projects/${d.id}/assets`).then((r) => r.json())
            for (const a of assets?.data?.items || []) {
              if (a.currentImage) {
                media.push({
                  key: `a-${a.assetType}-${a.id}`,
                  kind: 'image',
                  url: a.currentImage,
                  title: a.name || `素材 ${a.id}`,
                  fileName: a.currentImage.split('/').pop(),
                })
              }
            }
          } catch { /* 跳过项目 */ }
        }
      } catch { /* ignore */ }
      this.media = media
    },
    openDetail(m) { this.detail = m },
  },
}
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 13px; }
.acard { cursor: pointer; overflow: hidden; }
.acard .thumb { height: 140px; display: flex; align-items: center; justify-content: center; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard .info { padding: 8px 12px 10px; }
.acard .info b { font-size: 13px; display: block; }
.acard .info p { margin-top: 2px; }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
.sec-t { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 7px; }
.mono { font-family: Consolas, monospace; }
.ph-0 { background: radial-gradient(120% 100% at 75% 15%, rgba(124,92,255,.30), transparent 55%), linear-gradient(155deg, #1c2440 0%, #0e1424 60%, #141b2e 100%); }
.ph-1 { background: radial-gradient(130% 100% at 70% 80%, rgba(255,182,92,.25), transparent 55%), linear-gradient(160deg, #2a1d33 0%, #10131f 60%, #191225 100%); }
.ph-2 { background: radial-gradient(120% 100% at 25% 20%, rgba(69,211,156,.22), transparent 55%), linear-gradient(150deg, #10281f 0%, #0c1622 65%, #122032 100%); }
.ph-3 { background: radial-gradient(120% 100% at 50% 10%, rgba(88,166,255,.30), transparent 55%), linear-gradient(165deg, #101b33 0%, #0b1220 60%, #0f1a2c 100%); }
</style>
