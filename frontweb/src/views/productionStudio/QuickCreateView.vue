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

      <!-- 配置抽屉（第一步） -->
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
            <label class="col" style="gap:4px"><span class="xs muted">画幅</span>
              <div class="seg">
                <span :class="{ on: aspectRatio === '16:9' }" @click="aspectRatio = '16:9'">16:9 横屏</span>
                <span :class="{ on: aspectRatio === '9:16' }" @click="aspectRatio = '9:16'">9:16 竖屏</span>
              </div>
            </label>
            <label class="col" style="gap:4px"><span class="xs muted">分辨率</span>
              <div class="seg">
                <span :class="{ on: resolution === '720p' }" @click="resolution = '720p'">720p</span>
                <span :class="{ on: resolution === '1080p' }" @click="resolution = '1080p'">1080p</span>
              </div>
            </label>
            <label class="col" style="gap:4px"><span class="xs muted">生成数量</span>
              <div class="seg">
                <span :class="{ on: genCount === 1 }" @click="genCount = 1">1</span>
                <span :class="{ on: genCount === 2 }" @click="genCount = 2">2</span>
                <span :class="{ on: genCount === 3 }" @click="genCount = 3">3</span>
              </div>
            </label>
            <div class="kv"><span class="k">通道</span><span class="v">mock 本地 · ¥0</span></div>
            <div class="kv" v-if="kind === 'video'"><span class="k">输出时长</span><span class="v">1s（mock 最短）</span></div>
            <div class="kv"><span class="k">预检</span><span class="v ok-t">能力 ✓（本地 mock 通道）· 参数已校验</span></div>
            <p class="xs muted" style="margin:0">画幅 / 分辨率 / 数量暂仅本地保存，参数将随真实通道启用生效。</p>
          </div>
        </div>
        <div class="drawer-f">
          <div class="spacer"></div>
          <button class="btn primary" :disabled="!prompt.trim() || busy" @click="goConfirm">下一步</button>
        </div>
      </aside>

      <!-- 确认抽屉（第二步：费用 / 耗时确认） -->
      <div v-if="confirmOpen" class="scrim" style="z-index:80" @click="dismissConfirm"></div>
      <aside v-if="confirmOpen" class="drawer narrow" style="z-index:90">
        <div class="drawer-h">
          <h3>{{ kind === 'image' ? '快速图片' : '快速视频' }} · 确认生成</h3>
          <button class="icon-btn" @click="dismissConfirm"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="drawer-b" style="overflow:auto">
          <div class="col" style="gap:10px">
            <div class="kv"><span class="k">生成类型</span><span class="v">{{ kind === 'image' ? '快速图片' : '快速视频' }}</span></div>
            <div class="kv"><span class="k">画幅</span><span class="v">{{ aspectRatio }}</span></div>
            <div class="kv"><span class="k">分辨率</span><span class="v">{{ resolution }}</span></div>
            <div class="kv"><span class="k">数量</span><span class="v">{{ genCount }}</span></div>
            <div class="kv" v-if="kind === 'video'"><span class="k">输出时长</span><span class="v">1s（mock 最短）</span></div>
            <div class="kv"><span class="k">通道</span><span class="v">本地生成（mock）</span></div>
            <div class="kv"><span class="k">费用</span><span class="v ok-t">本地生成，不产生 API 费用</span></div>
            <p v-if="genCount > 1" class="small" style="color:var(--warn); margin:0">当前通道单次生成 1 个结果，数量将在真实通道生效。</p>
            <p class="xs muted" style="margin:0">mock 通道按默认口径执行；画幅 / 分辨率 / 数量参数将随真实通道启用生效。</p>
          </div>
        </div>
        <div class="drawer-f">
          <button class="btn ghost" :disabled="busy" @click="backToConfig">返回修改</button>
          <div class="spacer"></div>
          <button class="btn primary" :disabled="busy || !prompt.trim()" @click="confirmGenerate">确认生成<span v-if="busy"> · 执行中…</span></button>
        </div>
      </aside>

      <!-- 已生成 · 未归档 -->
      <div v-if="result" ref="resultArea" style="display:flex; flex-direction:column; gap:14px">
        <div class="card pad" style="display:flex; gap:16px; align-items:center">
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
        <div class="card pad">
          <b style="font-size:13.5px">选择去向</b>
          <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center">
            <select class="input" style="height:32px" v-model="libraryKind">
              <option value="character">角色库</option>
              <option value="scene">场景库</option>
              <option value="prop">道具库</option>
            </select>
            <button class="btn sm" :disabled="librarySaving" @click="addToLibrary">{{ librarySaving ? '入库中…' : '加入个人资产库' }}</button>
            <button class="btn sm primary" @click="openBind">绑定项目素材</button>
          </div>
          <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center">
            <button class="btn sm" :disabled="kind !== 'image'" @click="openShot">加入分镜候选</button>
            <span v-if="kind !== 'image'" class="xs muted">mock 视频暂无候选上传端点，暂不支持加入分镜候选</span>
            <button class="btn sm" disabled>加入短片时间线</button>
            <span class="xs muted">合成素材暂不支持直接加入短片，请在分镜页采用镜头后合成</span>
          </div>
          <p v-if="notice" class="small" :style="{ color: noticeOk ? 'var(--ok)' : 'var(--danger)' }" style="margin-top:8px">{{ notice }}</p>
        </div>
      </div>

      <!-- 本次会话生成历史（内存态，刷新即清） -->
      <div v-if="history.length" class="card pad">
        <div class="row" style="align-items:center">
          <b style="font-size:13.5px">本次会话生成历史</b>
          <span class="xs muted">仅保留本次会话记录</span>
        </div>
        <div v-for="h in history" :key="h.taskId" class="row hist-row">
          <span class="xs muted" style="flex:0 0 auto">{{ fmtTime(h.time) }}</span>
          <span class="badge" :class="h.kind === 'image' ? 'info' : 'accent'" style="flex:0 0 auto">{{ h.kind === 'image' ? '图片' : '视频' }}</span>
          <span class="badge" :class="{ warn: h.status === '已生成', ok: h.status === '已归档', danger: h.status === '已放弃' }" style="flex:0 0 auto">{{ h.status }}</span>
          <img v-if="h.kind === 'image' && h.url" :src="h.url" class="hist-thumb" alt="结果缩略">
          <video v-else-if="h.url" :src="h.url" muted preload="metadata" class="hist-thumb"></video>
          <div class="spacer"></div>
          <button class="btn sm ghost" style="border:1px solid var(--line)" :disabled="h.status === '已放弃' || !h.url" @click="openHistoryItem(h)">打开结果</button>
        </div>
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

    <!-- 绑定项目素材：两步目标选择 Modal -->
    <div v-if="bindOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:520px">
        <div class="modal-h">
          <h3>绑定项目素材 · 选择目标</h3>
          <button class="icon-btn" @click="bindOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b col" style="gap:10px">
          <label class="col" style="gap:4px"><span class="xs muted">第 1 步 · 项目</span>
            <select class="input" style="height:34px" v-model="bindProjectId" @change="onBindProject">
              <option value="">选择项目…</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <template v-if="bindProjectId">
            <span class="xs muted">第 2 步 · 素材（写入所选素材的新候选，或新建素材）</span>
            <div class="seg">
              <span :class="{ on: bindMode === 'existing' }" @click="bindMode = 'existing'">写入已有素材</span>
              <span :class="{ on: bindMode === 'new' }" @click="bindMode = 'new'">新建素材</span>
            </div>
            <template v-if="bindMode === 'existing'">
              <div v-if="bindLoading" class="xs muted">素材加载中…</div>
              <div v-else-if="!bindAssets.length" class="xs muted">该项目暂无可用素材，可切换「新建素材」自动创建。</div>
              <div v-else class="col" style="gap:6px; max-height:220px; overflow:auto">
                <label v-for="a in bindAssets" :key="a.assetType + '-' + a.id" class="row bind-row" :class="{ cur: bindAssetId === a.assetType + '-' + a.id }">
                  <input type="radio" name="bindAssetPick" :value="a.assetType + '-' + a.id" v-model="bindAssetId">
                  <span class="badge outline" style="flex:0 0 auto">{{ a.typeLabel }}</span>
                  <span class="small">{{ a.name || ('#' + a.id) }}</span>
                </label>
              </div>
            </template>
            <template v-else>
              <label class="col" style="gap:4px"><span class="xs muted">素材类型</span>
                <select class="input" style="height:34px" v-model="bindNewType">
                  <option value="scene">场景</option>
                  <option value="character">角色</option>
                  <option value="prop">道具</option>
                </select>
              </label>
              <label class="col" style="gap:4px"><span class="xs muted">名称</span>
                <input class="input" style="height:34px" v-model="bindNewName">
              </label>
              <label v-if="bindNewType === 'scene'" class="col" style="gap:4px"><span class="xs muted">地点（场景）</span>
                <input class="input" style="height:34px" v-model="bindNewLocation" placeholder="如：深夜便利店">
              </label>
            </template>
          </template>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="bindOpen = false">返回</button>
          <button class="btn primary" :disabled="bindSaving || !bindProjectId || (bindMode === 'existing' && !bindAssetId)" @click="bindConfirm">{{ bindSaving ? '绑定中…' : '确认绑定' }}</button>
        </div>
      </div>
    </div>

    <!-- 加入分镜候选：项目 → 剧集 → 镜头 Modal -->
    <div v-if="shotOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:520px">
        <div class="modal-h">
          <h3>加入分镜候选 · 选择镜头</h3>
          <button class="icon-btn" @click="shotOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b col" style="gap:10px">
          <label class="col" style="gap:4px"><span class="xs muted">项目</span>
            <select class="input" style="height:34px" v-model="shotProjectId" @change="onShotProject">
              <option value="">选择项目…</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <label v-if="shotProjectId" class="col" style="gap:4px"><span class="xs muted">剧集</span>
            <select class="input" style="height:34px" v-model="shotEpisodeId" @change="onShotEpisode">
              <option value="">选择剧集…</option>
              <option v-for="e in shotEpisodes" :key="e.id" :value="e.id">第 {{ e.episodeNumber }} 集{{ e.title ? ' · ' + e.title : '' }}</option>
            </select>
          </label>
          <template v-if="shotEpisodeId">
            <span class="xs muted">镜头（单选）</span>
            <div v-if="shotLoading" class="xs muted">镜头加载中…</div>
            <div v-else-if="!shotShots.length" class="xs muted">该剧集暂无分镜镜头，请先在分镜页生成。</div>
            <div v-else class="col" style="gap:6px; max-height:220px; overflow:auto">
              <label v-for="s in shotShots" :key="s.id" class="row bind-row" :class="{ cur: shotShotId === s.id }">
                <input type="radio" name="shotPick" :value="s.id" v-model="shotShotId">
                <span class="badge outline" style="flex:0 0 auto">镜头 {{ s.storyboard_number }}</span>
                <span class="small">{{ s.title || '未命名' }}</span>
              </label>
            </div>
          </template>
          <p class="xs muted" style="margin:0">确认后作为该镜头分镜图候选，可在分镜页设为当前。</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="shotOpen = false">返回</button>
          <button class="btn primary" :disabled="!shotShotId || shotSaving" @click="confirmShot">{{ shotSaving ? '上传中…' : '确认加入' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'
import { v21Toast } from '@/v21/ui.js'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'QuickCreateView',
  mixins: [escMixin],
  data() {
    return {
      configOpen: false, confirmOpen: false, kind: 'image', prompt: '', busy: false,
      aspectRatio: '16:9', resolution: '720p', genCount: 1,
      result: null, projects: [],
      history: [],
      libraryKind: 'character', librarySaving: false,
      abandonOpen: false, notice: '', noticeOk: false,
      bindOpen: false, bindProjectId: '', bindAssets: [], bindAssetId: '',
      bindMode: 'existing', bindNewType: 'scene', bindNewName: '', bindNewLocation: '',
      bindLoading: false, bindSaving: false,
      shotOpen: false, shotProjectId: '', shotEpisodes: [], shotEpisodeId: '',
      shotShots: [], shotShotId: '', shotLoading: false, shotSaving: false,
    }
  },
  mounted() {
    this.bindEsc(this.onEsc)
    v21.listProjects({}).then((d) => { this.projects = d.items || [] }).catch(() => {})
  },
  methods: {
    // Esc 自上而下关本视图的弹层（放弃确认 → 绑定 / 分镜弹窗 → 确认抽屉（busy 时不动）→ 配置抽屉）
    onEsc() {
      if (this.abandonOpen) { this.abandonOpen = false; return true }
      if (this.bindOpen) { this.bindOpen = false; return true }
      if (this.shotOpen) { this.shotOpen = false; return true }
      if (this.confirmOpen) { this.dismissConfirm(); return true }
      if (this.configOpen) { this.configOpen = false; return true }
      return false
    },
    openConfig(kind) {
      this.kind = kind
      this.prompt = ''
      this.aspectRatio = '16:9'
      this.resolution = '720p'
      this.genCount = 1
      this.configOpen = true
    },
    goConfirm() {
      if (!this.prompt.trim() || this.busy) return
      this.configOpen = false
      this.confirmOpen = true
    },
    backToConfig() {
      if (this.busy) return
      this.confirmOpen = false
      this.configOpen = true
    },
    dismissConfirm() {
      if (this.busy) return
      this.confirmOpen = false
    },
    async confirmGenerate() {
      if (this.busy) return
      if (!this.prompt.trim()) return
      this.busy = true
      try {
        const submitted = await v21.mockQuickGenerate(this.kind, this.prompt)
        const result = await v21.mockQuickComplete(submitted.taskId)
        this.result = { ...result, taskId: submitted.taskId }
        this.confirmOpen = false
        this.pushHistory('已生成')
      } catch (e) {
        this.notice = e.message || '生成失败'
        this.noticeOk = false
      } finally {
        this.busy = false
      }
    },
    pushHistory(status) {
      if (!this.result) return
      this.history.unshift({
        taskId: this.result.taskId,
        time: this.result.completedAt || new Date().toISOString(),
        kind: this.kind,
        status,
        url: this.result.url || '',
        result: { ...this.result },
      })
    },
    markCurrent(status) {
      if (!this.result) return
      const h = this.history.find((x) => x.taskId === this.result.taskId)
      if (h) h.status = status
    },
    openHistoryItem(h) {
      if (!h || h.status === '已放弃' || !h.url) return
      this.kind = h.kind
      this.result = { ...(h.result || {}), taskId: h.taskId }
      this.notice = ''
      this.noticeOk = true
      this.$nextTick(() => {
        const el = this.$refs.resultArea
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
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
        if (this.libraryKind === 'scene') {
          body.location = this.prompt.slice(0, 60) || '自由创作场景'
        }
        if (this.kind === 'video') body.description = `[视频] ${this.result.url} ${body.description}`
        await v21.addToLibrary(this.libraryKind, body)
        this.markCurrent('已归档')
        // 归档成功会清空 result，页内 notice 随之消失 → 用全局 toast 跨层反馈
        v21Toast('已加入个人资产库')
        this.notice = ''
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
      this.markCurrent('已放弃')
      this.result = null
    },
    openBind() {
      if (!this.result) return
      this.bindProjectId = ''
      this.bindAssets = []
      this.bindAssetId = ''
      this.bindMode = 'existing'
      this.bindNewType = this.kind === 'image' ? 'scene' : 'prop'
      this.bindNewName = `自由创作 ${this.kind === 'image' ? '图片' : '视频'}`
      this.bindNewLocation = ''
      this.bindOpen = true
    },
    async onBindProject() {
      this.bindAssets = []
      this.bindAssetId = ''
      if (!this.bindProjectId) return
      this.bindLoading = true
      try {
        const d = await v21.listAssets(this.bindProjectId, { type: 'all' })
        this.bindAssets = d.items || []
      } catch (e) {
        this.bindAssets = []
      } finally {
        this.bindLoading = false
      }
    },
    async bindConfirm() {
      if (this.bindSaving || !this.bindProjectId || !this.result) return
      if (this.bindMode === 'existing' && !this.bindAssetId) return
      this.bindSaving = true
      this.notice = ''
      try {
        if (this.bindMode === 'existing') {
          const target = this.bindAssets.find((a) => a.assetType + '-' + a.id === this.bindAssetId)
          if (!target) return
          // B6/4.5：URL 写入所选素材的新候选（仅入候选，不改当前图）
          await v21.uploadAssetCandidate(target.assetType, target.id, this.result.url)
          v21Toast(`已写入${target.typeLabel}素材「${target.name || target.id}」候选，可在项目素材页设为当前`)
          this.notice = ''
        } else {
          // 无合适素材：保留原自动创建路径作为回退；场景类型带 location
          const fields = {
            name: this.bindNewName.trim() || `自由创作 ${this.kind === 'image' ? '图片' : '视频'}`,
            description: this.prompt.slice(0, 50),
          }
          if (this.bindNewType === 'scene') fields.location = this.bindNewLocation.trim() || this.prompt.slice(0, 60) || '自由创作场景'
          const created = await v21.createAsset(this.bindProjectId, { type: this.bindNewType, fields })
          const cand = this.kind === 'image'
            ? await v21.generateAssetCandidate(this.bindProjectId, { type: this.bindNewType, assetId: created.id, prompt: this.prompt })
            : null
          if (cand) await v21.useCandidate({ type: this.bindNewType, assetId: created.id, candidateId: cand.candidateId })
          v21Toast('已在项目中新建素材并绑定')
          this.notice = ''
        }
        this.noticeOk = true
        this.markCurrent('已归档')
        this.result = null
        this.bindOpen = false
      } catch (e) {
        this.notice = e.message || '绑定失败'
        this.noticeOk = false
      } finally {
        this.bindSaving = false
      }
    },
    openShot() {
      if (!this.result || this.kind !== 'image') return
      this.shotProjectId = ''
      this.shotEpisodes = []
      this.shotEpisodeId = ''
      this.shotShots = []
      this.shotShotId = ''
      this.shotOpen = true
    },
    async onShotProject() {
      this.shotEpisodes = []
      this.shotEpisodeId = ''
      this.shotShots = []
      this.shotShotId = ''
      if (!this.shotProjectId) return
      this.shotLoading = true
      try {
        const d = await v21.listEpisodes(this.shotProjectId, { sort: 'episode' })
        this.shotEpisodes = d.items || []
      } catch (e) {
        this.shotEpisodes = []
      } finally {
        this.shotLoading = false
      }
    },
    async onShotEpisode() {
      this.shotShots = []
      this.shotShotId = ''
      if (!this.shotEpisodeId) return
      this.shotLoading = true
      try {
        const d = await v21.getStoryboard(this.shotEpisodeId)
        this.shotShots = d.shots || []
      } catch (e) {
        this.shotShots = []
      } finally {
        this.shotLoading = false
      }
    },
    async confirmShot() {
      if (this.shotSaving || !this.shotShotId || !this.result) return
      this.shotSaving = true
      this.notice = ''
      try {
        await v21.uploadShotImage(this.shotShotId, { imageUrl: this.result.url })
        this.markCurrent('已归档')
        v21Toast('已作为该镜头分镜图候选，可在分镜页设为当前')
        this.notice = ''
        this.noticeOk = true
        this.result = null
        this.shotOpen = false
      } catch (e) {
        this.notice = e.message || '加入分镜候选失败'
        this.noticeOk = false
      } finally {
        this.shotSaving = false
      }
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
.hist-row { gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); margin-top: 8px; }
.hist-thumb { width: 64px; height: 40px; object-fit: cover; border-radius: 6px; flex: 0 0 auto; background: var(--panel2); }
.bind-row { gap: 8px; align-items: center; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
.bind-row.cur { border-color: var(--accent); background: var(--accent-subtle); }
</style>
