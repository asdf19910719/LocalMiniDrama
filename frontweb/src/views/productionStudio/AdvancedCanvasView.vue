<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <button class="icon-btn" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/storyboard`)"><svg><use href="#i-back"/></svg></button>
      <h1>高级画布</h1>
      <span class="sub">只读关系视图 · 引用实线 / 生成蓝 / 过期虚线 · 所有修改回到标准页执行</span>
      <div class="spacer"></div>
      <span class="badge outline">只读 · 标准页数据的投影</span>
    </header>
    <div class="page-body" style="display:flex; gap:14px; overflow:auto">
      <div class="card grow cv-canvas">
        <svg style="width:100%; height:100%" viewBox="0 0 900 480" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)"/>
            </marker>
            <marker id="arrow-info" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--info)"/>
            </marker>
          </defs>
          <!-- 剧本 → 场次/角色 -->
          <line x1="240" y1="90" x2="430" y2="60" stroke="var(--muted)" stroke-width="1.4" marker-end="url(#arrow)"/>
          <line x1="240" y1="90" x2="430" y2="140" stroke="var(--muted)" stroke-width="1.4" marker-end="url(#arrow)"/>
          <!-- 场景 → 分镜（生成=蓝） -->
          <line x1="520" y1="60" x2="640" y2="120" stroke="var(--info)" stroke-width="1.4" marker-end="url(#arrow-info)"/>
          <!-- 角色 → 分镜（生成=蓝） -->
          <line x1="520" y1="140" x2="640" y2="140" stroke="var(--info)" stroke-width="1.4" marker-end="url(#arrow-info)"/>
          <!-- 分镜 → 候选（生成=蓝） -->
          <line x1="730" y1="140" x2="790" y2="220" stroke="var(--info)" stroke-width="1.4" marker-end="url(#arrow-info)"/>
          <!-- 候选 → 成片 -->
          <line x1="790" y1="260" x2="700" y2="340" stroke="var(--info)" stroke-width="1.4" marker-end="url(#arrow-info)"/>
          <!-- 过期关系（虚线） -->
          <line x1="240" y1="90" x2="700" y2="340" stroke="var(--warn)" stroke-width="1.2" stroke-dasharray="5 4"/>
          <text x="330" y="240" fill="var(--warn)" font-size="11" paint-order="stroke" stroke="var(--bg)" stroke-width="4">剧本更新 → 成片待复核</text>

          <g v-for="n in nodes" :key="n.id">
            <rect :x="n.x" :y="n.y" width="150" height="46" rx="9" fill="var(--panel2)" stroke="var(--line-strong)"/>
            <text :x="n.x + 14" :y="n.y + 21" fill="var(--text)" font-size="12.5" font-weight="600">{{ n.title }}</text>
            <text :x="n.x + 14" :y="n.y + 36" fill="var(--muted)" font-size="10.5">{{ n.sub }}</text>
          </g>
        </svg>
      </div>

      <div class="col" style="width:260px; flex:0 0 260px; gap:10px">
        <div class="card pad">
          <b style="font-size:13.5px">影响路径</b>
          <div class="kv" style="margin-top:8px"><span class="k">直接影响</span><span class="v">分镜 / 候选</span></div>
          <div class="kv"><span class="k">间接影响</span><span class="v">成片版本</span></div>
          <div class="kv"><span class="k">不会影响</span><span class="v">已确认剧本 / 快照</span></div>
        </div>
        <div class="card pad">
          <b style="font-size:13.5px">批量重编译</b>
          <p class="xs muted" style="margin:6px 0 10px">从画布发起的批量重编译需要影响预览与确认；入口在分镜页「批量生成」。</p>
          <button class="btn sm" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/storyboard`)">去分镜批量生成</button>
        </div>
        <div class="card pad">
          <b style="font-size:13.5px">图例</b>
          <div class="kv"><span class="k leg"><i class="ls ls-ref"></i>引用</span><span class="v">实线</span></div>
          <div class="kv"><span class="k leg"><i class="ls ls-gen"></i>生成</span><span class="v">实线</span></div>
          <div class="kv"><span class="k leg"><i class="ls ls-stale"></i>过期</span><span class="v">虚线</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

export default {
  name: 'AdvancedCanvasView',
  props: { projectId: String, episodeId: String },
  data() {
    return { nodes: [] }
  },
  async mounted() {
    const nodes = [
      { id: 'script', x: 90, y: 60, title: '剧本', sub: '场次结构' },
      { id: 'scene', x: 430, y: 35, title: '场景资产', sub: '青石巷 · 夜' },
      { id: 'char', x: 430, y: 115, title: '角色状态', sub: '林夏 · 夜巡制服' },
      { id: 'shot', x: 640, y: 115, title: '分镜 05', sub: '2 时段 · 7s' },
      { id: 'cand', x: 790, y: 195, title: '视频候选', sub: '候选 A · 用于本镜' },
      { id: 'cut', x: 620, y: 340, title: '成片版本', sub: '成片 v1' },
    ]
    this.nodes = nodes
    try {
      const storyboard = await v21.getStoryboard(this.episodeId)
      const completion = storyboard.completion || {}
      const cut = nodes.find((n) => n.id === 'cut')
      if (cut) cut.sub = `成片 v${(storyboard.versions?.items?.[0]?.version) || '?'}`
      const shot = nodes.find((n) => n.id === 'shot')
      if (shot && completion.total) shot.sub = `${completion.adopted}/${completion.total} 已采用`
    } catch { /* 设计稿投影 */ }
  },
}
</script>

<style scoped>
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
/* 画布：点阵背景 + 线样图例（对标节点编辑器的工作台感） */
.cv-canvas {
  position: relative; min-height: 480px; overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, #1c2230 1px, transparent 0) 0 0 / 26px 26px,
    var(--bg);
}
.leg { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); }
.ls { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--muted); }
.ls-gen { border-top-color: var(--info); }
.ls-stale { border-top-style: dashed; border-top-color: var(--warn); }
</style>
