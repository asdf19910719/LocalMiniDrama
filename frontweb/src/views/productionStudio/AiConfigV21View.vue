<template>
  <div style="display:flex; flex-direction:column; height:100vh">
    <header class="page-head">
      <h1>AI 配置</h1>
      <span class="sub">通道 · 解析顺序 · 业务映射</span>
      <div class="spacer"></div>
      <span class="badge outline">密钥只存本机 · 不进入项目与导出</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px; overflow:auto">

      <!-- 解析顺序链 -->
      <div class="card pad">
        <b style="font-size:13.5px">通道解析顺序</b>
        <div class="chain" style="margin-top:10px">
          <span class="chip">本次任务覆盖</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">项目默认</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">全局默认</span>
          <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
          <span class="chip">安装默认</span>
          <div class="spacer"></div>
          <span class="xs muted">任务创建后冻结 Provider/模型/费用快照，不随设置漂移</span>
        </div>
      </div>

      <!-- 三通道卡 -->
      <div class="grid-3">
        <div class="card pad chan">
          <div class="row"><b style="font-size:14px">API 中转站</b><span class="badge info">联网</span></div>
          <p class="muted small" style="margin:7px 0 10px">OpenAI 兼容接口 · 图片 / 视频 / 剧本文本 · 按 Provider 计费</p>
          <div class="kv"><span class="k">已配置</span><span class="v">{{ configs.length }} 项</span></div>
          <div class="kv"><span class="k">费用</span><span class="v">Provider 返回价</span></div>
          <div class="kv"><span class="k">可信进度</span><span class="v">支持（轮询）</span></div>
        </div>
        <div class="card pad chan">
          <div class="row"><b style="font-size:14px">ChatGPT 网页</b><span class="badge ok">零费用</span></div>
          <p class="muted small" style="margin:7px 0 10px">网页自动化出图 · 需要本机浏览器会话与登录状态</p>
          <div class="kv"><span class="k">环境检查</span><span class="v">浏览器 / 登录 / 捕获 / 桥接</span></div>
          <div class="kv"><span class="k">费用</span><span class="v">¥0（不计费）</span></div>
          <div class="kv"><span class="k">用户在场</span><span class="v">生成期间需要</span></div>
        </div>
        <div class="card pad chan">
          <div class="row"><b style="font-size:14px">ComfyUI 本地</b><span class="badge outline">本地</span></div>
          <p class="muted small" style="margin:7px 0 10px">本机工作流执行 · 显存与队列由本机 GPU 决定</p>
          <div class="kv"><span class="k">费用</span><span class="v">本地执行 · ¥0 API 费用</span></div>
          <div class="kv"><span class="k">依赖</span><span class="v">本机 ComfyUI 服务在线</span></div>
        </div>
      </div>

      <!-- 已配置通道列表 -->
      <div class="card">
        <div class="card-h"><h3>已配置通道</h3><div class="spacer"></div>
          <a class="btn ghost sm" style="border:1px solid var(--line); text-decoration:none" href="/ai-config/advanced">高级配置（旧页 · 全量操作）</a>
        </div>
        <div class="card-b" style="padding:8px 16px 12px">
          <div v-for="c in configs" :key="c.id" class="cfg-row">
            <span class="badge outline">{{ c.service_type || c.serviceType || 'provider' }}</span>
            <b style="font-size:13px">{{ c.provider || c.name || c.id }}</b>
            <span class="v muted xs">{{ c.model || '' }}</span>
            <span class="badge" :class="c.enabled === false ? 'neutral' : 'ok'" style="margin-left:auto">{{ c.enabled === false ? '已停用' : '启用' }}</span>
          </div>
          <p v-if="configs.length === 0" class="muted small" style="padding:8px 0">暂无已配置通道 · 无 Key 时 mock 通道可运行全部核心流程</p>
        </div>
      </div>

      <!-- 业务映射分组 -->
      <div class="card pad">
        <b style="font-size:13.5px">业务映射</b>
        <div class="grid-3" style="margin-top:10px">
          <div class="map-card"><b>创作与协作</b><p>剧本 · 外部 AI · 制作包</p></div>
          <div class="map-card"><b>图片 / 视频 / 声音</b><p>资产生图 · 分镜图 · 镜头视频 · TTS</p></div>
          <div class="map-card"><b>后期处理</b><p>整集合片 · 超分 · 音频后期</p></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'AiConfigV21View',
  data() {
    return { configs: [] }
  },
  mounted() { this.load() },
  methods: {
    async load() {
      try {
        const res = await axios.get('/api/v1/ai-configs')
        const data = res.data?.data
        this.configs = Array.isArray(data) ? data : (data?.items || [])
      } catch { this.configs = [] }
    },
  },
}
</script>

<style scoped>
.chain { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.chan .kv { border-top: 1px solid var(--line); padding: 6px 0; }
.chan .kv:first-of-type { border-top: none; margin-top: 4px; }
.cfg-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
.cfg-row:last-of-type { border-bottom: none; }
.map-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: var(--panel2); }
.map-card b { font-size: 13px; display: block; margin-bottom: 4px; }
.map-card p { margin: 0; font-size: 11.5px; color: var(--muted); }
.badge.neutral { background: var(--neutral-subtle); color: var(--muted); }
</style>
