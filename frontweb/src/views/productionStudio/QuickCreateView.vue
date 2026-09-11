<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg></button>
      <h1>自由创作</h1>
      <span class="sub">快速图片 / 快速视频 · 不参与四阶段 Gate</span>
      <div class="spacer"></div>
      <span class="badge warn">如果最终用于项目，请在保存时选择项目和剧集</span>
    </header>
    <div class="page-body" style="display:flex; flex-direction:column; gap:14px; max-width:900px; margin:0 auto">

      <div class="grid-2">
        <div class="card recipe" @click="openConfig('image')">
          <div class="ic" style="background:var(--accent-subtle); color:var(--accent)"><svg><use href="#i-image"/></svg></div>
          <b>快速图片</b>
          <p>输入提示词生成图片 · mock 通道 · ¥0</p>
        </div>
        <div class="card recipe" @click="openConfig('video')">
          <div class="ic" style="background:var(--info-subtle); color:var(--info)"><svg><use href="#i-film"/></svg></div>
          <b>快速视频</b>
          <p>提示词生成短视频 · mock 通道 · ¥0</p>
        </div>
      </div>

      <!-- 配置抽屉 -->
      <div v-if="configOpen" class="scrim" style="z-index:80" @click="configOpen = false"></div>
      <aside v-if="configOpen" class="drawer narrow" style="z-index:90">
        <div class="drawer-h">
          <h3>{{ kind === 'image' ? '快速图片' : '快速视频' }} · 配置</h3>
          <button class="icon-btn" @click="configOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="drawer-b" style="overflow:auto">
          <div class="col" style="gap:12px">
            <label class="col" style="gap:4px"><span class="xs muted">提示词</span>
              <textarea class="input" style="width:100%; height:80px; padding:8px" v-model="prompt"></textarea>
            </label>
            <div class="kv"><span class="k">通道</span><span class="v">mock 本地 · ¥0</span></div>
            <div class="kv" v-if="kind === 'video'"><span class="k">输出时长</span><span class="v">1s（mock 最短）</span></div>
            <div class="kv"><span class="k">预检</span><span class="v ok-t">能力 ✓ · 引用 ✓ · 费用 ✓</span></div>
          </div>
        </div>
        <div class="drawer-f">
          <div class="spacer"></div>
          <button class="btn primary" :disabled="!prompt.trim() || busy" @click="submit">确认提交</button>
        </div>
      </aside>

      <!-- 已生成 · 未归档 -->
      <div v-if="result" class="card pad" style="display:flex; gap:16px; align-items:center">
        <div class="ph" style="width:130px; height:90px; border-radius:8px; overflow:hidden; flex:0 0 auto">
          <img v-if="kind === 'image'" :src="result.url" style="width:100%;height:100%;object-fit:cover">
          <video v-else :src="result.url" controls style="width:100%;height:100%"></video>
        </div>
        <div class="grow col" style="gap:6px">
          <div class="row"><b style="font-size:14px">已生成 · 尚未归档</b><span class="badge warn">需选择去向</span></div>
          <div class="xs muted">任务 {{ result.taskId.slice(0, 8) }} · mock 本地执行 · ¥0.00 · {{ fmtTime(result.completedAt) }}</div>
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn sm" @click="download(result)">下载文件</button>
            <button class="btn sm ghost" style="border:1px solid var(--line)" @click="abandon">放弃</button>
          </div>
        </div>
      </div>
      <div v-if="result" class="card pad">
        <b style="font-size:13.5px">选择去向</b>
        <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center">
          <select class="input" style="height:32px" v-model="libraryKind">
            <option value="character">角色库</option>
            <option value="scene">场景库</option>
            <option value="prop">道具库</option>
          </select>
          <button class="btn sm" :disabled="librarySaving" @click="addToLibrary">{{ librarySaving ? '入库中…' : '加入个人资产库' }}</button>
          <select class="input" style="height:32px" v-model="destProject">
            <option value="">选择项目…</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select>
          <button class="btn sm primary" :disabled="!destProject" @click="bindToProject">绑定项目素材</button>
        </div>
        <p v-if="notice" class="small" :style="{ color: noticeOk ? 'var(--ok)' : 'var(--danger)' }" style="margin-top:8px">{{ notice }}</p>
      </div>
    </div>

    <!-- 放弃确认 Modal（C1：专用容器） -->
    <div v-if="abandonOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:440px">
        <div class="modal-h">
          <h3>放弃本次产物</h3>
          <button class="icon-btn" @click="abandonOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="small">放弃后该产物不进入任何库（本地文件保留在磁盘）。确认放弃？</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="abandonOpen = false">返回</button>
          <button class="btn danger" @click="confirmAbandon">确认放弃</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'

export default {
  name: 'QuickCreateView',
  data() {
    return {
      configOpen: false, kind: 'image', prompt: '', busy: false,
      result: null, projects: [], destProject: '',
      libraryKind: 'character', librarySaving: false,
      abandonOpen: false, notice: '', noticeOk: false,
    }
  },
  mounted() {
    v21.listProjects({}).then((d) => { this.projects = d.items || [] }).catch(() => {})
  },
  methods: {
    openConfig(kind) {
      this.kind = kind
      this.prompt = ''
      this.configOpen = true
    },
    async submit() {
      this.busy = true
      try {
        const submitted = await v21.mockQuickGenerate(this.kind, this.prompt)
        const result = await v21.mockQuickComplete(submitted.taskId)
        this.result = { ...result, taskId: submitted.taskId }
        this.configOpen = false
      } catch (e) {
        this.notice = e.message || '生成失败'
        this.noticeOk = false
      } finally {
        this.busy = false
      }
    },
    async addToLibrary() {
      if (!this.result) return
      this.librarySaving = true
      this.notice = ''
      try {
        const body = {
          name: `${this.kind === 'video' ? '自由视频' : '自由图片'} · ${this.prompt.slice(0, 24) || this.result.taskId.slice(0, 8)}`,
          image_url: this.kind === 'image' ? this.result.url : '',
          local_path: this.result.artifactPath || null,
          description: this.prompt.slice(0, 200),
          source_type: 'quick-create',
          source_id: this.result.taskId,
        }
        if (this.kind === 'video') body.description = `[视频] ${this.result.url} ${body.description}`
        await v21.addToLibrary(this.libraryKind, body)
        this.notice = '已加入个人资产库'
        this.noticeOk = true
        this.result = null
      } catch (e) {
        this.notice = e.message || '入库失败'
        this.noticeOk = false
      } finally {
        this.librarySaving = false
      }
    },
    download(result) {
      const a = document.createElement('a')
      a.href = result.url
      a.download = result.url.split('/').pop()
      a.click()
    },
    abandon() {
      this.abandonOpen = true
    },
    confirmAbandon() {
      this.abandonOpen = false
      this.result = null
    },
    async bindToProject() {
      const assetType = this.kind === 'image' ? 'scene' : 'prop'
      const created = await v21.createAsset(this.destProject, { type: assetType, fields: { name: `自由创作 ${this.kind}` , description: this.prompt.slice(0, 50) } })
      const cand = this.kind === 'image'
        ? await v21.generateAssetCandidate(this.destProject, { type: assetType, assetId: created.id, prompt: this.prompt })
        : null
      if (cand) await v21.useCandidate({ type: assetType, assetId: created.id, candidateId: cand.candidateId })
      this.notice = '已绑定到项目素材'
      this.noticeOk = true
      this.result = null
    },
    fmtTime(t) { return t ? String(t).slice(11, 19) : '' },
  },
}
</script>

<style scoped>
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.recipe { padding: 22px 20px; cursor: pointer; display: flex; flex-direction: column; gap: 9px; }
.recipe:hover { border-color: var(--accent); }
.recipe .ic { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.recipe .ic svg { width: 19px; height: 19px; }
.recipe b { font-size: 14.5px; }
.recipe p { margin: 0; font-size: 12px; color: var(--muted); }
.kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 4px 0; }
.kv .k { color: var(--muted); flex: 0 0 auto; }
.kv .v { color: var(--text-2); text-align: right; }
</style>
