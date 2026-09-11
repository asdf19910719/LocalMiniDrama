<template>
  <div style="flex:1; display:flex; flex-direction:column; min-height:0">
    <!-- 状态条 -->
    <div class="notice-strip" :class="readinessClass" v-if="readiness.status !== 'ready'">
      <svg style="width:14px;height:14px"><use :href="readiness.status === 'script-unapproved' ? '#i-warn' : '#i-warn'"/></svg>
      {{ readinessText }}
      <div class="spacer"></div>
      <button class="btn sm" @click="$router.push(`/projects/${projectId}/episodes/${episodeId}/assets`)">去处理</button>
    </div>
    <div class="notice-strip ok" v-else>
      <svg style="width:14px;height:14px"><use href="#i-check-c"/></svg>素材已准备
      <span class="xs muted" v-if="snapshotAt"> · 快照 {{ snapshotAt }}</span>
    </div>
    <div class="notice-strip warn" v-if="notice">
      <svg style="width:14px;height:14px"><use href="#i-warn"/></svg>{{ notice }}
      <span class="act" style="cursor:pointer; margin-left:auto; color:var(--muted)" @click="notice = ''">关闭</span>
    </div>

    <!-- 三分状态机：加载骨架 → 错误重试 → 内容（加载完成前不渲染空态；重载失败保留内容走 notice） -->
    <StateBlock v-if="loading && !loaded" state="loading" />
    <StateBlock v-else-if="loadError && !loaded" state="error" :message="'分镜加载失败：' + loadError" @retry="retryLoad" />
    <template v-else>
    <div v-if="shots.length === 0" class="empty-box">
      <p class="muted">本集还没有分镜</p>
      <button class="btn primary" @click="createFromScript">从已确认剧本创建分镜</button>
      <p class="xs muted" style="margin-top:8px">从已确认剧本创建镜头，或导入分镜结构</p>
    </div>

    <!-- current 未就绪（getShot 飞行期间/非法深链兜底中）不渲染依赖 current.* 的内容，避免渲染抛错 -->
    <template v-else-if="current">
      <!-- 一级工具栏 -->
      <div class="row" style="padding:8px 16px; border-bottom:1px solid var(--line); gap:8px">
        <div class="select" style="height:32px; cursor:pointer">
          <select v-model="sceneFilter" class="sort-native" style="max-width:180px">
            <option value="all">全部场次</option>
            <option v-for="s in scenes" :key="s.id" :value="s.id">场次 {{ s.scene_number }} · {{ shortHeading(s.heading) }}</option>
          </select>
          <svg class="chev"><use href="#i-chev-d"/></svg>
        </div>
        <div class="select" style="height:32px; width:110px; cursor:pointer">
          <select v-model="currentShotIdProxy" class="sort-native">
            <option v-for="s in visibleShots" :key="s.id" :value="s.id">镜头 {{ pad(s.storyboard_number ?? s.number) }}</option>
          </select>
          <svg class="chev"><use href="#i-chev-d"/></svg>
        </div>
        <div class="row" style="gap:2px">
          <button class="icon-btn" title="上一镜" @click="step(-1)"><svg><use href="#i-back"/></svg></button>
          <button class="icon-btn" title="下一镜" @click="step(1)"><svg><use href="#i-fwd"/></svg></button>
        </div>
        <span class="chip">{{ completion.adopted }}/{{ completion.total }} 已采用<span class="v" v-if="completion.missing?.length"> · {{ completion.missing.length }} 待生成</span><span class="v" v-if="completion.staleShots?.length"> · {{ completion.staleShots.length }} 旧图</span></span>
        <div class="spacer"></div>
        <button class="btn" @click="openBatch"><svg><use href="#i-layers"/></svg>批量生成</button>
        <div class="more-wrap">
          <button class="btn ghost" style="border:1px solid var(--line)" @click="moreOpen = !moreOpen">更新分镜结构 / 导入 / 导出<svg class="chev" style="width:13px;height:13px"><use href="#i-chev-d"/></svg></button>
          <div v-if="moreOpen" class="card more-pop" @click="moreOpen = false">
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="openStructureDiff">更新分镜结构（从已确认剧本重建）</button>
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="exportSrt">导出 SRT 字幕</button>
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="exportShotPackages">导出 Shot Package JSON</button>
            <button class="btn ghost sm" style="width:100%;justify-content:flex-start" @click="openAdvancedCanvas">高级画布</button>
          </div>
        </div>
      </div>

      <div class="sb-main">
        <!-- 左：镜头检查器 + 分镜图（输入） -->
        <div class="insp">
          <div class="row"><b style="font-size:13px">分镜 {{ pad(current.number) }}</b><span class="chip" style="height:22px">计划 {{ current.duration }}s</span><div class="spacer"></div><span class="xs ok-t" v-if="!dirty">已自动保存</span><span class="xs warn-t" v-else>有未保存修改</span></div>

          <div class="grp-t">出场角色</div>
          <div v-for="r in references.characters" :key="'c' + r.referenceId" class="ref-row" @click="previewAsset('character', r.assetId)">
            <span class="avatar">{{ (r.name || '?').slice(0, 1) }}</span><b>{{ r.name }}</b><span class="v">{{ r.variantId ? 'v' + r.variantId : '' }}</span>
          </div>
          <p v-if="!references.characters?.length" class="xs muted" style="padding:2px 6px">无</p>

          <div class="grp-t">分镜场景</div>
          <div v-for="r in references.scene?.refs || []" :key="'s' + r.assetId" class="ref-row" @click="previewAsset('scene', r.assetId)">
            <span class="mini ph"></span><b>{{ r.name }}</b>
          </div>
          <p v-if="!references.scene?.refs?.length" class="xs muted" style="padding:2px 6px">未绑定场景</p>

          <div class="grp-t">场景道具</div>
          <div v-for="r in references.props" :key="'p' + r.referenceId" class="ref-row" @click="previewAsset('prop', r.assetId)">
            <span class="mini ph c"></span><b>{{ r.name }}</b>
          </div>
          <p v-if="!references.props?.length" class="xs muted" style="padding:2px 6px">无</p>

          <div class="grp-t">首尾帧衔接</div>
          <div class="row" style="padding:2px 6px; gap:6px">
            <span class="badge" :class="frameChaining.state === 'linked' ? 'ok' : frameChaining.state === 'linkable' ? 'warn' : 'neutral'">
              <svg><use href="#i-link"/></svg>{{ frameChaining.stateLabel }}
            </span>
            <button v-if="frameChaining.state === 'linkable'" class="btn sm ghost" style="border:1px solid var(--line)" @click="confirmLink">确认衔接</button>
          </div>

          <div class="grp-t">分镜图（输入）</div>
          <div class="row" style="gap:6px; padding:0 4px; flex-wrap:wrap">
            <div v-for="c in imageCandidates" :key="c.candidateId" class="img-cand" :class="{ cur: currentImage && currentImage.url === c.url }" @click="previewImageCandidate(c)" :title="'候选 ' + c.candidateId">
              <img :src="c.url" style="width:100%;height:100%;object-fit:cover">
            </div>
          </div>
          <div class="row" style="padding:0 4px">
            <button class="btn sm grow" :loading="generatingImage" :disabled="generatingImage" @click="generateImage">
              <svg><use href="#i-spark"/></svg>生成分镜图
            </button>
            <button class="btn sm ghost" style="border:1px solid var(--line)" title="上传图片" @click="openImageUrl"><svg><use href="#i-upload"/></svg></button>
          </div>

          <div style="margin-top:auto" class="xs muted">引用变化会即时同步到中栏与 H3 草稿</div>
        </div>

        <!-- 中：时段提示词工作台 -->
        <div class="work">
          <div class="row" style="gap:6px; flex-wrap:nowrap">
            <span v-for="(chip, i) in referenceChips" :key="i" class="chip"><span class="at">@图片{{ i + 1 }}</span>{{ chip.name }}<span class="v" v-if="chip.version">{{ chip.version }}</span></span>
            <div class="spacer"></div>
            <button class="btn ghost sm" style="border:1px solid var(--line)" @click="openRefManage">管理镜头引用</button>
          </div>

          <div v-for="(seg, i) in segments" :key="seg.id" class="seg-card">
            <div class="sc-h">
              <span class="tc">时段 {{ i + 1 }} · {{ fmtTc(seg.start_seconds) }} – {{ fmtTc(seg.end_seconds) }}</span>
              <span v-if="segRefBadge(seg)" class="badge outline" style="height:19px">{{ segRefBadge(seg) }}</span>
              <div class="spacer"></div>
              <span class="card-act" title="拆分" @click="split(seg)"><svg><use href="#i-copy"/></svg></span>
              <span v-if="i < segments.length - 1" class="card-act" title="与下一段合并" @click="merge(seg)"><svg><use href="#i-layers"/></svg></span>
              <span v-if="i > 0" class="card-act" title="上移" @click="move(seg, 'up')"><svg style="transform:rotate(-90deg)"><use href="#i-back"/></svg></span>
              <span v-if="i < segments.length - 1" class="card-act" title="下移" @click="move(seg, 'down')"><svg style="transform:rotate(90deg)"><use href="#i-back"/></svg></span>
            </div>
            <div class="sc-b">
              <div><div class="f-label">画面与动作</div>
                <textarea class="f-ta" style="width:100%" rows="2" v-model="seg.visual" @change="saveSegment(seg)"></textarea>
              </div>
              <div><div class="f-label">对白与声音</div>
                <textarea class="f-ta" style="width:100%" rows="2" v-model="seg.dialogue" @change="saveSegment(seg)"></textarea>
              </div>
            </div>
          </div>

          <!-- 分镜图提示词 -->
          <div class="row" style="padding:6px 10px; border:1px solid var(--line); border-radius:9px; background:var(--panel); cursor:pointer" @click="imgPromptOpen = !imgPromptOpen">
            <svg style="width:13px;height:13px;color:var(--muted)"><use href="#i-fwd"/></svg>
            <span class="small t2">分镜图提示词</span>
            <span v-if="imagePrompt.manual" class="badge warn" style="height:19px">已手工覆盖</span>
            <span class="xs muted ellipsis grow">{{ imagePrompt.text }}</span>
            <span v-if="imagePrompt.manual" class="xs accent-t" style="cursor:pointer" @click.stop="resetImagePrompt">恢复自动拼装</span>
          </div>
          <div v-if="imgPromptOpen" style="padding:8px 10px; border:1px solid var(--line); border-radius:9px; background:var(--panel)">
            <textarea class="f-ta" style="width:100%" rows="3" v-model="imagePrompt.text" @change="saveImagePrompt"></textarea>
          </div>

          <!-- H3 提示词条 -->
          <div class="seg-card">
            <div class="h3bar" style="border-bottom:1px solid var(--line)">
              <svg style="width:14px;height:14px;color:var(--accent)"><use href="#i-spark"/></svg>
              <b style="font-size:12.5px">H3 提示词</b>
              <span class="badge" :class="h3Class" style="height:19px">{{ h3.statusLabel || '未生成' }}</span>
              <span class="xs muted" v-if="h3.validation">
                四项校验：<template v-for="(c, i) in h3.validation.checks" :key="c.id">{{ i > 0 ? ' · ' : '' }}{{ c.label }} {{ c.ok ? '✓' : '×' }}</template>
              </span>
              <div class="spacer"></div>
              <button class="btn ghost sm" style="border:1px solid var(--line)" @click="openH3Sheet">
                <svg><use href="#i-refresh"/></svg>{{ h3.draftId ? '重新生成 H3 提示词' : '生成 H3 提示词' }}
              </button>
            </div>
            <div v-if="h3.text" style="padding:7px 10px">
              <div v-if="!h3Open" class="row" style="cursor:pointer" @click="h3Open = true">
                <span class="xs muted mono ellipsis grow">{{ h3SummaryLine(h3.text) }}</span>
                <span class="xs accent-t" style="flex:0 0 auto">展开编辑</span>
              </div>
              <template v-else>
                <textarea class="f-ta mono" style="width:100%" rows="3" v-model="h3.text" @input="h3Dirty = true"></textarea>
                <div class="row" style="margin-top:6px">
                  <button class="btn sm primary" :disabled="!h3Dirty" @click="saveH3">保存并校验</button>
                  <span v-if="h3Dirty" class="xs warn-t">已修改未保存 · 保存前阻断视频提交</span>
                  <div class="spacer"></div>
                  <button class="btn sm ghost" @click="h3Open = false">收起</button>
                </div>
              </template>
            </div>
          </div>

          <!-- 生成条 -->
          <div class="genbar" style="margin-top:auto">
            <button class="btn primary" :disabled="!guard.canSubmit || h3Dirty" @click="openVideoSheet">
              <svg><use href="#i-film"/></svg>用 H3 生成视频
            </button>
            <span class="chip" style="height:28px">输出 {{ current.duration }}s</span>
            <span class="chip" style="height:28px">候选 {{ videoCount }} 个</span>
            <div class="spacer"></div>
            <span class="xs" :class="guard.canSubmit ? 'ok-t' : 'warn-t'">
              生成前联合检查 {{ passedChecks }}/{{ totalChecks }}{{ guard.canSubmit ? ' 通过' : ' · ' + failedCheckLabels }}
            </span>
          </div>
        </div>

        <!-- 右：视频审核（输出） -->
        <div class="rev">
          <div class="row">
            <b style="font-size:13px">视频审核</b><span class="badge outline" style="height:20px">输出</span>
            <div class="spacer"></div>
            <button class="btn ghost sm" style="border:1px solid var(--line)" @click="openHistory()"><svg><use href="#i-hist"/></svg>生成历史</button>
          </div>
          <div class="player" :class="previewUrl ? '' : 'ph'">
            <video v-if="previewUrl" :key="previewUrl" :src="previewUrl" controls style="width:100%;height:100%;border-radius:10px;object-fit:contain;background:#000"></video>
            <div v-else style="display:flex;align-items:center;justify-content:center;height:100%" class="muted xs">点击候选载入播放器</div>
            <span v-if="previewUrl" class="dur">{{ current.duration }}s</span>
            <span v-if="previewCandidate && previewCandidate.isAdopted && !isCandidateStale(previewCandidate)" class="src badge ok" style="height:22px">候选 · 用于本镜</span>
            <span v-else-if="previewCandidate" class="src badge outline" style="height:22px">候选 · 预览中</span>
            <span v-if="previewCandidate && isCandidateStale(previewCandidate)" class="src badge warn" style="height:22px">基于旧分镜图</span>
          </div>
          <div class="grp-t" style="margin:0">候选胶片条</div>
          <!-- 进行中任务（C3：异步轮询 + 取消） -->
          <div v-if="activeVideoTasks.length" class="col" style="gap:6px">
            <div v-for="t in activeVideoTasks" :key="t.taskId" class="row" style="gap:8px; align-items:center">
              <span class="xs mono" style="flex:0 0 auto; width:70px">{{ shortId(t.taskId) }}</span>
              <div class="grow" style="height:6px; border-radius:999px; background:var(--panel2); overflow:hidden">
                <div :style="{ width: (t.progress || 0) + '%', height: '100%', background: t.status === 'failed' ? 'var(--danger)' : 'var(--info)', transition: 'width .6s' }"></div>
              </div>
              <span class="xs" :style="{ color: t.status === 'failed' ? 'var(--danger)' : 'var(--info)' }">{{ taskStatusText(t) }}</span>
              <button class="btn sm ghost" style="border:1px solid var(--line)" :disabled="t.cancelling" @click="cancelTask(t)">{{ t.cancelling ? '取消中…' : '取消' }}</button>
            </div>
          </div>
          <div class="film">
            <div v-for="c in videoCandidates" :key="c.candidateId" class="fcand" :class="{ cur: c.isAdopted }" @click="preview(c)">
              <div class="im" :class="c.isAdopted ? '' : 'ph'">
                <video v-if="previewUrl === c.url && previewCandidate === c" :src="c.url" style="width:100%;height:100%;object-fit:cover"></video>
                <span v-if="c.isAdopted" style="position:absolute;left:5px;bottom:4px" class="badge ok">采用</span>
                <span v-if="isCandidateStale(c)" style="position:absolute;right:4px;top:4px" class="badge warn">旧图</span>
              </div>
              <div class="cap" :class="c.isAdopted ? 'ok-t' : ''">{{ shortId(c.candidateId) }}{{ c.isAdopted ? ' · 用于本镜' : '' }}{{ isCandidateStale(c) ? ' · 基于旧分镜图' : '' }}</div>
            </div>
            <p v-if="videoCandidates.length === 0" class="xs muted">尚无候选</p>
          </div>
          <div class="row">
            <button v-if="previewCandidate && !previewCandidate.isAdopted" class="btn sm primary" @click="adopt">用于本镜</button>
            <button v-if="previewCandidate && previewCandidate.isAdopted" class="btn sm ghost" style="border:1px solid var(--line)" @click="undoAdopt">撤销采用</button>
            <button v-if="previewCandidate" class="btn sm ghost" style="border:1px solid var(--line)" @click="retryCandidate(previewCandidate)"><svg><use href="#i-refresh"/></svg>按原输入重试</button>
          </div>
          <div class="xs muted" style="margin-top:auto">生成成功只追加候选，不自动采用；改用旧候选会退出完成计数。</div>
        </div>
      </div>

      <!-- 底部镜头轨 -->
      <div class="track">
        <span class="xs muted">镜头轨</span>
        <div class="seg">
          <span :class="{ on: trackFilter === 'all' }" @click="trackFilter = 'all'">全部 {{ completion.total }}</span>
          <span :class="{ on: trackFilter === 'missing' }" @click="trackFilter = 'missing'">未完成 {{ (completion.missing || []).length }}</span>
          <span :class="{ on: trackFilter === 'stale' }" @click="trackFilter = 'stale'">旧图 {{ (completion.staleShots || []).length }}</span>
          <span :class="{ on: trackFilter === 'failed' }" @click="trackFilter = 'failed'">失败 {{ (trackStats.failed || []).length }}</span>
          <span :class="{ on: trackFilter === 'processing' }" @click="trackFilter = 'processing'">处理中 {{ (trackStats.processing || []).length }}</span>
        </div>
        <div class="row" style="gap:6px">
          <div v-for="s in filteredShots" :key="s.id" class="shot" :class="shotClass(s)" @click="selectShot(s.id)">
            <div class="im ph"><span class="st-dot" :style="{ background: shotDotColor(s) }"></span></div>
            <div class="no" :class="shotNoClass(s)">{{ pad(s.storyboard_number ?? s.number) }}{{ shotSuffix(s) }}</div>
          </div>
          <span v-if="filteredShots.length === 0" class="xs muted" style="padding:4px 8px">当前筛选下没有镜头</span>
        </div>
        <div class="spacer"></div>
        <button class="btn sm" @click="openCutSummary">
          进入成片审核（{{ completion.adopted }}/{{ completion.total }}）
        </button>
      </div>
    </template>
    <div v-else class="empty-box">
      <p class="muted">正在载入镜头…</p>
    </div>
    </template>

    <!-- 生成确认 Sheet（16） -->
    <div v-if="videoSheetOpen" class="scrim" style="z-index:80" @click="videoSheetOpen = false"></div>
    <div v-if="videoSheetOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:620px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-film"/></svg>
          <h3>生成视频 · 分镜 {{ pad(current.number) }}</h3>
          <button class="icon-btn" @click="videoSheetOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="overflow:hidden">
          <div class="kv"><span class="k">对象</span><span class="v">{{ current.title || '分镜 ' + current.number }} · {{ current.duration }}s</span></div>
          <div class="kv" style="align-items:center"><span class="k">候选数量</span>
            <span class="row" style="gap:10px">
              <span class="seg">
                <span v-for="n in 3" :key="n" :class="{ on: videoCount === n }" @click="setVideoCount(n)">{{ n }}</span>
              </span>
              <span class="muted xs">费用按数量乘算 · 候选并行提交</span>
            </span>
          </div>
          <div class="divider" style="margin:10px 0"></div>
          <div class="kv"><span class="k">通道 / 模型</span><span class="v">{{ sheetChannelText }}</span></div>
          <div class="kv"><span class="k">输出时长</span><span class="v">{{ current.duration }}s · {{ segments.length }} 个时段</span></div>
          <div class="kv"><span class="k">引用素材</span>
            <span class="row" style="gap:6px; flex-wrap:wrap">
              <span v-for="(chip, i) in referenceChips" :key="i" class="chip" style="height:24px"><span class="at">@图片{{ i + 1 }}</span>{{ chip.name }}</span>
              <span v-if="referenceChips.length === 0" class="xs muted">无引用</span>
            </span>
          </div>
          <div class="divider" style="margin:10px 0"></div>
          <b class="small t2">生成前联合检查</b>
          <div style="margin-top:4px">
            <div v-for="c in guard.checks || []" :key="c.id" class="ck-line">
              <svg :style="{ color: c.ok ? 'var(--ok)' : 'var(--danger)' }"><use :href="c.ok ? '#i-check-c' : '#i-warn'"/></svg>
              {{ c.label }} · {{ c.detail || (c.ok ? '通过' : '未通过') }}
            </div>
          </div>
          <div class="divider" style="margin:10px 0"></div>
          <div class="row" style="background:var(--panel2); border:1px solid var(--line); border-radius:9px; padding:10px 14px">
            <div class="grow">
              <div class="row">
                <b style="font-size:14px">{{ sheetCostTitle }}</b>
                <span class="badge outline">{{ sheetQuote?.channel === 'real' ? '真实通道' : '不产生 API 费用' }}</span>
              </div>
              <div class="xs muted" style="margin-top:3px">{{ sheetQuote?.estimatedTime || '预计耗时 1–2 分钟（非承诺值）' }} · 失败时其余任务继续 · 成功只追加候选，不自动采用</div>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <label v-if="isDev" class="xs muted" style="display:flex; align-items:center; gap:5px; margin-right:auto">
            <input type="checkbox" v-model="sheetDemoDelay"> 演示运行态（mock 延迟 6s）
          </label>
          <button class="btn ghost" @click="videoSheetOpen = false">取消</button>
          <button class="btn primary" :disabled="busy" @click="submitVideo"><svg><use href="#i-film"/></svg>创建 {{ videoCount }} 个远端任务</button>
        </div>
      </div>
    </div>

    <!-- 图片 URL 输入 Modal（C1：分镜上传图片 URL） -->
    <div v-if="imgUrlOpen" class="modal-wrap" style="z-index:95">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <h3>上传分镜图</h3>
          <button class="icon-btn" @click="imgUrlOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <input class="input" style="width:100%" v-model="imgUrlText" placeholder="图片 URL 或本地 /static 路径">
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="imgUrlOpen = false">取消</button>
          <button class="btn primary" :disabled="!imgUrlText.trim()" @click="confirmImageUrl">确认</button>
        </div>
      </div>
    </div>

    <!-- 更新分镜结构 diff 向导（B1 / 设计稿 10 更多菜单 / STORYBOARD-016） -->
    <div v-if="diffOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:640px">
        <div class="modal-h">
          <h3>更新分镜结构 · 与已确认剧本对比</h3>
          <button class="icon-btn" @click="diffOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="max-height:420px; overflow:auto">
          <p v-if="diffLoading" class="muted small">正在推导结构差异…</p>
          <template v-if="diff">
            <div class="row" style="margin-bottom:10px">
              <span class="badge ok">未变 {{ diff.unchanged }}</span>
              <span class="badge warn">变更 {{ diff.changed.length }}</span>
              <span class="badge danger">删除 {{ diff.removed.length }}</span>
              <span class="badge outline">新增 {{ diff.added.length }}</span>
            </div>
            <div v-for="c in diff.changed" :key="'c' + c.shotId" class="imp-row">
              <span class="badge warn">变更</span>
              <span class="ellipsis grow">镜头 {{ c.number }} · {{ c.fields.join(' / ') }} → {{ c.expected.title }}</span>
              <label v-if="c.humanEdited" class="xs" style="white-space:nowrap">
                <input type="checkbox" v-model="diffSkips['c' + c.shotId]"> 跳过（保留人工改动）
              </label>
            </div>
            <div v-for="(a, i) in diff.added" :key="'a' + i" class="imp-row">
              <span class="badge ok">新增</span>
              <span class="ellipsis grow">镜头 {{ a.storyboardNumber }} · {{ a.title }}</span>
            </div>
            <div v-for="r in diff.removed" :key="'r' + r.shotId" class="imp-row">
              <span class="badge danger">删除</span>
              <span class="ellipsis grow">镜头 {{ r.number }} · {{ r.title }}（媒体候选保留）</span>
              <label v-if="r.humanEdited" class="xs" style="white-space:nowrap">
                <input type="checkbox" v-model="diffSkips['r' + r.shotId]"> 跳过（保留人工改动）
              </label>
            </div>
            <p class="xs muted" style="margin-top:8px">确认后创建新的结构版本：删除为回收站式软删，媒体历史不删除；人工改动镜头默认跳过。</p>
          </template>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="diffOpen = false">取消</button>
          <button class="btn primary" :disabled="diffLoading || diffApplying" @click="applyDiff">{{ diffApplying ? '应用中…' : '确认创建新结构版本' }}</button>
        </div>
      </div>
    </div>

    <!-- 批量生成预检抽屉（25） -->
    <div v-if="batchOpen" class="scrim" style="z-index:80" @click="batchOpen = false"></div>
    <aside v-if="batchOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>批量生成 <span class="muted" style="font-weight:400; font-size:12px">· 预检</span></h3>
        <button class="icon-btn" @click="batchOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="v-row"><span class="vn"><svg style="width:15px;height:15px"><use href="#i-image"/></svg></span>
          <div><b style="font-size:13px">生成缺失分镜图</b><div class="vm">{{ (batch.missingImages || []).length }} 个镜头缺当前图</div></div>
          <div class="acts"><button class="btn sm" :disabled="!(batch.missingImages || []).length || busy" @click="runBatch('missing-images')">执行</button></div>
        </div>
        <div class="v-row"><span class="vn"><svg style="width:15px;height:15px"><use href="#i-film"/></svg></span>
          <div><b style="font-size:13px">生成缺失镜头视频</b><div class="vm">{{ (batch.missingVideos || []).length }} 个镜头未生成（H3 就绪才可执行）</div></div>
          <div class="acts"><button class="btn sm" :disabled="!(batch.missingVideos || []).length || busy" @click="runBatch('missing-videos')">执行</button></div>
        </div>
        <div class="v-row"><span class="vn"><svg style="width:15px;height:15px"><use href="#i-refresh"/></svg></span>
          <div><b style="font-size:13px">重试失败任务</b><div class="vm">{{ (batch.failed || []).length }} 个失败/取消任务可按原输入重试</div></div>
          <div class="acts"><button class="btn sm" :disabled="!(batch.failed || []).length || busy" @click="runBatch('retry-failed')">执行</button></div>
        </div>
        <div v-if="batchResult" class="card pad" style="padding:11px 12px">
          <b style="font-size:12.5px">执行结果 · {{ batchResult.action }}</b>
          <div v-for="(r, i) in batchResult.results" :key="i" class="xs" style="margin-top:4px" :class="r.ok ? 'ok-t' : 'danger-t'">
            镜头 {{ r.shotId }} · {{ r.ok ? '成功' : '失败：' + r.error }}
          </div>
        </div>
      </div>
      <div class="drawer-f"><span class="muted xs">部分失败不影响成功项 · 成功只追加候选</span></div>
    </aside>

    <!-- 管理镜头引用抽屉（26） -->
    <div v-if="refManageOpen" class="scrim" style="z-index:80" @click="refManageOpen = false"></div>
    <aside v-if="refManageOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>管理镜头引用 <span class="muted" style="font-weight:400; font-size:12px">· 分镜 {{ pad(current.number) }}</span></h3>
        <button class="icon-btn" @click="refManageOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div class="grp-t">出场角色</div>
        <div v-for="r in references.characters" :key="'rc' + r.referenceId" class="ref-row">
          <span class="avatar">{{ (r.name || '?').slice(0, 1) }}</span><b>{{ r.name }}</b>
          <span class="v">固定版本</span>
          <button class="btn sm ghost" style="border:1px solid var(--line)" @click="removeRef(r.referenceId)">移除</button>
        </div>
        <div class="grp-t">分镜场景（不可移除）</div>
        <div v-for="r in references.scene?.refs || []" :key="'sc' + r.assetId" class="ref-row">
          <span class="mini ph"></span><b>{{ r.name }}</b><span class="v">结构性</span>
        </div>
        <div class="grp-t">场景道具</div>
        <div v-for="r in references.props" :key="'rp' + r.referenceId" class="ref-row">
          <span class="mini ph c"></span><b>{{ r.name }}</b>
          <button class="btn sm ghost" style="border:1px solid var(--line); margin-left:auto" @click="removeRef(r.referenceId)">移除</button>
        </div>
        <div class="divider"></div>
        <div class="grp-t">从项目素材添加</div>
        <div v-for="a in addableAssets" :key="a.assetType + a.id" class="ref-row">
          <span class="mini ph"></span><b>{{ a.name }}</b>
          <button class="btn sm ghost" style="border:1px solid var(--line); margin-left:auto" @click="addRef(a)">添加</button>
        </div>
        <p v-if="!addableAssets.length" class="xs muted" style="padding:2px 6px">没有可添加的素材（已在本镜引用或未就绪的素材不显示）</p>
      </div>
      <div class="drawer-f"><span class="muted xs">增删即时重排 @槽位并令 H3 标记「引用已变化」</span></div>
    </aside>

    <!-- 素材预览抽屉（27） -->
    <div v-if="assetPreviewOpen" class="scrim" style="z-index:80" @click="assetPreviewOpen = false"></div>
    <aside v-if="assetPreviewOpen" class="drawer" style="z-index:90; width:480px">
      <div class="drawer-h">
        <h3>{{ assetPreview?.name || '素材预览' }}</h3>
        <button class="icon-btn" @click="assetPreviewOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-if="assetPreview?.currentImage" style="border-radius:10px; overflow:hidden; margin-bottom:12px">
          <img :src="assetPreview.currentImage" style="width:100%; display:block">
        </div>
        <div class="kv"><span class="k">类型</span><span class="v">{{ typeLabel(assetPreview?.assetType) }}</span></div>
        <div class="kv"><span class="k">本集状态</span><span class="v">固定版本</span></div>
        <div class="kv"><span class="k">@槽位</span><span class="v accent-t">{{ assetSlotLabel }}</span></div>
        <div class="kv"><span class="k">出现时段</span><span class="v">{{ usedInSegmentsText }}</span></div>
        <div class="kv"><span class="k">最新候选</span><span class="v">{{ assetPreview?.candidates?.length ? '候选 ' + assetPreview.candidates[0].candidateId : '无' }}</span></div>
        <div class="row" style="margin-top:14px">
          <button class="btn sm" :disabled="!canUpdateToLatest" @click="updateToLatest" :title="canUpdateToLatest ? '' : '已是最新版本'">换绑到最新版</button>
          <button class="btn sm ghost" style="border:1px solid var(--line)" @click="$router.push(`/projects/${projectId}/assets`)">在素材库中查看</button>
        </div>
      </div>
    </aside>

    <!-- 生成历史抽屉（28） -->
    <div v-if="historyOpen" class="scrim" style="z-index:80" @click="historyOpen = false"></div>
    <aside v-if="historyOpen" class="drawer narrow" style="z-index:90">
      <div class="drawer-h">
        <h3>生成历史 <span class="muted" style="font-weight:400; font-size:12px">· 分镜 {{ pad(current.number) }}</span></h3>
        <button class="icon-btn" @click="historyOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-for="t in history.tasks" :key="t.taskId" class="v-row" style="cursor:default">
          <span class="vn"><svg style="width:15px;height:15px"><use href="#i-film"/></svg></span>
          <div>
            <div class="row" style="gap:6px">
              <b style="font-size:13px">{{ taskStatusLabel(t.status) }}</b>
              <span class="badge" :class="taskStatusBadge(t.status)" style="height:18px">{{ t.cancelRequested && t.status !== 'failed' ? '取消中' : taskStatusLabel(t.status) }}</span>
            </div>
            <div class="vm">提交 {{ fmtTime(t.createdAt) || '—' }}<template v-if="t.completedAt"> · 完成 {{ fmtTime(t.completedAt) }}</template><template v-if="t.error || t.message"><br>{{ t.error || t.message }}</template></div>
          </div>
          <div class="acts">
            <button v-if="['failed', 'cancelled'].includes(t.status)" class="btn sm" @click="retryTask(t.taskId)">按原输入重试</button>
          </div>
        </div>
        <p v-if="!history.tasks?.length" class="xs muted">本镜暂无生成任务</p>
      </div>
      <div class="drawer-f">
        <span class="muted xs">共 {{ (history.tasks || []).length }} 条 · 按时间倒序</span>
        <div class="spacer"></div>
        <span class="muted xs">按原输入重试创建新任务，不覆盖历史记录</span>
      </div>
    </aside>

    <!-- H3 生成确认抽屉（T2.5：生成前置确认 + 人工草稿保护） -->
    <div v-if="h3SheetOpen" class="scrim" style="z-index:80" @click="h3SheetOpen = false"></div>
    <div v-if="h3SheetOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-spark"/></svg>
          <h3>{{ h3.draftId ? '重新生成 H3 提示词' : '生成 H3 提示词' }} · 分镜 {{ pad(current.number) }}</h3>
          <button class="icon-btn" @click="h3SheetOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="kv"><span class="k">来源</span><span class="v">基于当前时段与引用状态</span></div>
          <div class="kv"><span class="k">结构输入</span><span class="v">时段数 {{ segments.length }} · 引用槽位数 {{ referenceChips.length }}</span></div>
          <div class="kv" v-if="referenceChips.length"><span class="k">引用素材</span>
            <span class="row" style="gap:6px; flex-wrap:wrap; justify-content:flex-end">
              <span v-for="(chip, i) in referenceChips" :key="i" class="chip" style="height:22px"><span class="at">@图片{{ i + 1 }}</span>{{ chip.name }}</span>
            </span>
          </div>
          <p class="xs muted" style="margin-top:8px">重新生成不会覆盖人工修改的词条草稿（需显式确认）。</p>
          <label v-if="h3.manuallyEdited" class="xs" style="display:flex; align-items:center; gap:5px; margin-top:8px; color:var(--warn)">
            <input type="checkbox" v-model="h3ConfirmOverwrite"> 我确认覆盖人工修改
          </label>
          <div v-if="h3SheetError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-top:8px">{{ h3SheetError }}</div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="h3SheetOpen = false">取消</button>
          <button class="btn primary" :disabled="h3Generating || (h3.manuallyEdited && !h3ConfirmOverwrite)" @click="confirmGenerateH3">
            {{ h3Generating ? '生成中…' : (h3.draftId ? '确认重新生成' : '确认生成') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 分镜图候选预览抽屉（T2.5：预览前置，确认后才设为当前） -->
    <div v-if="imgPreviewOpen" class="scrim" style="z-index:80" @click="imgPreviewOpen = false"></div>
    <aside v-if="imgPreviewOpen" class="drawer" style="z-index:90; width:480px">
      <div class="drawer-h">
        <h3>分镜图候选 <span class="muted" style="font-weight:400; font-size:12px">· 候选 {{ shortId(imgPreview?.candidateId) }}</span></h3>
        <button class="icon-btn" @click="imgPreviewOpen = false"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="drawer-b" style="overflow:auto">
        <div v-if="imgPreview?.url" style="border-radius:10px; overflow:hidden; margin-bottom:12px">
          <img :src="imgPreview.url" style="width:100%; display:block">
        </div>
        <div class="kv"><span class="k">候选</span><span class="v mono">{{ imgPreview?.candidateId || '—' }}</span></div>
        <div class="kv"><span class="k">生成时间</span><span class="v">{{ fmtTime(imgPreview?.createdAt) || '—' }}</span></div>
        <div class="kv"><span class="k">分镜图提示词</span><span class="v ellipsis" style="max-width:280px" :title="imagePrompt.text">{{ imagePrompt.text || '—' }}</span></div>
        <div v-if="imgPreviewError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-top:8px">{{ imgPreviewError }}</div>
      </div>
      <div class="drawer-f" style="justify-content:flex-end">
        <button class="btn ghost" @click="imgPreviewOpen = false">取消</button>
        <button class="btn primary" :disabled="imgPreviewBusy" @click="confirmSetCurrentImage">{{ imgPreviewBusy ? '设置中…' : '设为当前分镜图' }}</button>
      </div>
    </aside>

    <!-- 进入成片审核摘要抽屉（T2.5：三组计数确认前置） -->
    <div v-if="cutSummaryOpen" class="scrim" style="z-index:80" @click="cutSummaryOpen = false"></div>
    <div v-if="cutSummaryOpen" class="modal-wrap" style="z-index:90">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-film"/></svg>
          <h3>进入成片审核 · 摘要</h3>
          <button class="icon-btn" @click="cutSummaryOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <p class="xs muted" style="margin-bottom:6px">进入成片前请确认分镜完成度：</p>
          <template v-if="cutSummary">
            <div class="kv"><span class="k">候选未采用 · 需确认</span><span class="v">{{ cutSummary.notAdopted }} 镜</span></div>
            <div class="kv"><span class="k">尚未生成</span><span class="v">{{ cutSummary.missingVideos }} 镜</span></div>
            <div class="kv"><span class="k">生成失败</span><span class="v">{{ cutSummary.failed }} 镜</span></div>
          </template>
          <p v-else-if="cutSummaryLoading" class="muted small">正在统计…</p>
          <div v-if="cutSummaryError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-top:8px">{{ cutSummaryError }}</div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="cutSummaryOpen = false">留在分镜</button>
          <button class="btn primary" :disabled="cutSummaryLoading" @click="goCutReview">仍要进入成片审核</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import v21 from '@/v21/api.js'
import StateBlock from '@/components/v21/StateBlock.vue'
import escMixin from '@/v21/escMixin.js'

export default {
  name: 'StoryboardStage',
  mixins: [escMixin],
  components: { StateBlock },
  props: { projectId: String, episodeId: String },
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer)
  },
  data() {
    return {
      shots: [], scenes: [], sceneFilter: 'all', currentShotId: null, current: null,
      loading: false, loaded: false, loadError: '',
      references: { characters: [], props: [], scene: {} },
      segments: [], imagePrompt: { text: '', manual: false }, imageCandidates: [],
      h3: {}, h3Dirty: false, guard: {}, completion: { adopted: 0, total: 0, missing: [], staleShots: [] },
      trackStats: { failed: [], processing: [] },
      videoCandidates: [], previewCandidate: null, previewUrl: '', videoCount: 1,
      staleVideoIds: [],
      activeVideoTasks: [], pollTimer: null, sheetQuote: null, sheetDemoDelay: false, notice: '',
      imgUrlOpen: false, imgUrlText: '',
      generatingImage: false, readiness: { status: 'checking' },
      frameChaining: { state: 'none', stateLabel: '首镜' },
      trackFilter: 'all', moreOpen: false, batchOpen: false,
      batch: { missingImages: [], missingVideos: [], failed: [] }, batchResult: null, busy: false,
      diffOpen: false, diffLoading: false, diffApplying: false, diff: null, diffSkips: {},
      refManageOpen: false, assetPool: [],
      assetPreviewOpen: false, assetPreview: null, assetPreviewRefIndex: -1,
      historyOpen: false, history: {},
      imgPromptOpen: false, videoSheetOpen: false, snapshotAt: '',
      h3SheetOpen: false, h3SheetError: '', h3ConfirmOverwrite: false, h3Generating: false,
      imgPreviewOpen: false, imgPreview: null, imgPreviewBusy: false, imgPreviewError: '',
      cutSummaryOpen: false, cutSummary: null, cutSummaryLoading: false, cutSummaryError: '',
    }
  },
  computed: {
    visibleShots() {
      if (this.sceneFilter === 'all') return this.shots
      return this.shots.filter((s) => String(s.scene_id) === String(this.sceneFilter))
    },
    // 镜头轨筛选真实生效：场次筛选 ∩ 镜头状态筛选（全部/未完成/旧图/失败/处理中）
    filteredShots() {
      let list = this.visibleShots
      if (this.trackFilter === 'missing') {
        const ids = new Set((this.completion.missing || []).map(String))
        list = list.filter((s) => ids.has(String(s.id)))
      } else if (this.trackFilter === 'stale') {
        const ids = new Set((this.completion.staleShots || []).map((x) => String(x.shotId)))
        list = list.filter((s) => ids.has(String(s.id)))
      } else if (this.trackFilter === 'failed') {
        const ids = new Set((this.trackStats.failed || []).map((f) => String(f.shotId ?? f)))
        list = list.filter((s) => ids.has(String(s.id)))
      } else if (this.trackFilter === 'processing') {
        const ids = new Set((this.trackStats.processing || []).map(String))
        list = list.filter((s) => ids.has(String(s.id)))
      }
      return list
    },
    referenceChips() {
      const chars = (this.references.characters || []).map((r) => ({ name: r.name, version: r.variantId ? 'v' + r.variantId : '' }))
      const props = (this.references.props || []).map((r) => ({ name: r.name, version: '' }))
      return [...chars, ...props]
    },
    referencedAssetIds() {
      const chars = (this.references.characters || []).map((r) => String(r.assetId))
      const props = (this.references.props || []).map((r) => String(r.assetId))
      return new Set([...chars, ...props])
    },
    // 素材池：仅角色/道具（场景为结构性引用不可添加），且过滤已在本镜引用中的素材
    addableAssets() {
      return (this.assetPool || []).filter(
        (a) => (a.assetType === 'character' || a.assetType === 'prop') && !a.blocked && !this.referencedAssetIds.has(String(a.id))
      )
    },
    readinessText() {
      return {
        checking: '正在准备素材…',
        'needs-attention': '有待处理项：受影响镜头的生成已禁用',
        'snapshot-failed': '素材快照保存失败，媒体生成已暂停',
        'script-unapproved': '确认剧本后才能生成本集媒体',
      }[this.readiness.status] || '正在准备素材…'
    },
    readinessClass() {
      return { ready: 'ok', 'needs-attention': 'warn', 'snapshot-failed': 'warn', 'script-unapproved': 'warn', checking: '' }
    },
    h3Class() {
      return { 'ai-generated': 'ok', valid: 'ok', invalid: 'danger', stale: 'warn' }[this.h3.status] || 'neutral'
    },
    passedChecks() {
      return (this.guard.checks || []).filter((c) => c.ok).length
    },
    totalChecks() {
      return (this.guard.checks || []).length
    },
    failedCheckLabels() {
      return (this.guard.checks || []).filter((c) => !c.ok).map((c) => c.label).join('/')
    },
    currentImage() {
      return this.current ? { url: this.current.currentImage } : null
    },
    quote() {
      return { count: this.videoCount }
    },
    sheetChannelText() {
      const q = this.sheetQuote
      if (!q) return '读取通道中…'
      if (q.channel === 'real') return `${q.provider}${q.model ? ' · ' + q.model : ''}${q.h3 ? ' · H3' : ''}`
      return 'mock 本地通道 · 确定性输出'
    },
    sheetCostTitle() {
      const q = this.sheetQuote
      if (!q) return '生成报价'
      const cost = q.estimatedCost || {}
      if (q.channel === 'real') {
        const price = cost.estimated != null ? `¥${(Number(cost.estimated) * this.videoCount).toFixed(2)} · ${cost.currency || 'CNY'}` : (cost.note || 'Provider 未返回价格')
        return `${q.provider} 执行 · ${price}`
      }
      return 'mock 本地执行 · ¥0'
    },
    assetSlotLabel() {
      if (this.assetPreviewRefIndex < 0) return '未在本镜引用'
      return `@图片${this.assetPreviewRefIndex + 1}`
    },
    usedInSegmentsText() {
      const shot = this.current
      if (!shot) return '—'
      const segs = this.segments.filter((seg) => {
        try {
          const refs = JSON.parse(seg.asset_refs_json || '{}')
          const names = [...(refs.sceneRefs || []), ...(refs.characterRefs || []), ...(refs.propRefs || [])]
          return names.some((n) => String(n).includes(String(this.assetPreview?.name || '\u0000')))
        } catch { return false }
      })
      return segs.length ? `时段 ${segs.map((s) => s.seq).join('、')}` : '未直接提及'
    },
    canUpdateToLatest() {
      return (this.assetPreview?.candidates?.length || 0) > 0 &&
        this.assetPreview.candidates[0].url !== this.assetPreview.currentImage
    },
  },
  watch: {
    // 横切 B：切换场次时把 sceneFilter 持久化到 URL（replace，刷新可恢复）
    sceneFilter() { this.writeSceneShotUrl() },
  },
  mounted() {
    this.bindEsc(this.onEsc)
    this.keyHandler = (e) => {
      const tag = (e.target.tagName || '').toLowerCase()
      if (['input', 'textarea', 'select'].includes(tag)) return
      if (e.key === '[') this.step(-1)
      if (e.key === ']') this.step(1)
    }
    window.addEventListener('keydown', this.keyHandler)
    this.load().then(() => this.consumeShotQuery())
  },
  unmounted() {
    window.removeEventListener('keydown', this.keyHandler)
  },
  methods: {
    // Esc 自上而下关本视图的弹层（z95 的 URL 弹窗最先，其次各 Modal / 抽屉，最后非遮罩浮层）
    onEsc() {
      if (this.imgUrlOpen) { this.imgUrlOpen = false; return true }
      if (this.videoSheetOpen) { this.videoSheetOpen = false; return true }
      if (this.diffOpen) { this.diffOpen = false; return true }
      if (this.batchOpen) { this.batchOpen = false; return true }
      if (this.refManageOpen) { this.refManageOpen = false; return true }
      if (this.assetPreviewOpen) { this.assetPreviewOpen = false; return true }
      if (this.historyOpen) { this.historyOpen = false; return true }
      if (this.h3SheetOpen) { this.h3SheetOpen = false; return true }
      if (this.imgPreviewOpen) { this.imgPreviewOpen = false; return true }
      if (this.cutSummaryOpen) { this.cutSummaryOpen = false; return true }
      if (this.moreOpen) { this.moreOpen = false; return true }
      if (this.imgPromptOpen) { this.imgPromptOpen = false; return true }
      return false
    },
    async load() {
      this.loading = true
      try {
        const data = await v21.getStoryboard(this.episodeId)
        this.shots = data.shots || []
        this.completion = data.completion || this.completion
        try {
          const guard = await v21.getMediaGuard(this.episodeId)
          this.readiness = { status: guard.readiness }
          const assets = await v21.getEpisodeAssets(this.episodeId)
          if (assets.readiness?.status === 'ready') this.readiness = { status: 'ready' }
        } catch { /* keep */ }
        try {
          this.scenes = (await v21.getScript(this.episodeId)).scenes || []
        } catch { this.scenes = [] }
        // 镜头轨"失败/处理中"计数来源：批量预检（failed/processing），失败不阻断主列表
        try {
          this.trackStats = await v21.getBatchPrecheck(this.episodeId)
        } catch { this.trackStats = { failed: [], processing: [] } }
        this.loadError = ''
        this.loaded = true
      } catch (e) {
        if (this.loaded) {
          // 重载失败保留已有内容，错误走页内提示条（与成片页口径一致）
          this.notice = e.message || '刷新分镜失败'
        } else {
          this.loadError = e.message || '网络错误'
        }
      } finally {
        this.loading = false
      }
      // 评审修复：存在待消费的 ?shot= 深链时跳过默认选中——否则默认选中与深链 selectShot 并发
      // getShot，若第 1 镜响应后到会把选中与 URL 回落第 1 镜，深链（含成片页「回分镜处理」落点）静默失效
      if (this.currentShotId === null && this.shots.length > 0 && !this.$route.query.shot) this.selectShot(this.shots[0].id)
    },
    // 错误态重试：重载成功后继续消费挂起的深链参数（首次加载失败时 consumeShotQuery 已让位保留）
    async retryLoad() {
      await this.load()
      await this.consumeShotQuery()
    },
    async createFromScript() {
      await v21.createFromScript(this.episodeId)
      await this.load()
    },
    async openStructureDiff() {
      this.diffOpen = true
      this.diffLoading = true
      this.diff = null
      this.diffSkips = {}
      try {
        const diff = await v21.previewStructureDiff(this.episodeId)
        // 人工改动镜头默认勾选「跳过」
        const skips = {}
        for (const c of diff.changed || []) skips['c' + c.shotId] = !!c.humanEdited
        for (const r of diff.removed || []) skips['r' + r.shotId] = !!r.humanEdited
        this.diffSkips = skips
        this.diff = diff
      } catch (err) {
        this.diff = { added: [], changed: [], removed: [], unchanged: 0, error: err.message }
      } finally {
        this.diffLoading = false
      }
    },
    async applyDiff() {
      this.diffApplying = true
      try {
        await v21.applyStructureDiff(this.episodeId, {
          added: this.diff.added,
          changed: (this.diff.changed || []).map((c) => ({ ...c, skip: !!this.diffSkips['c' + c.shotId] })),
          removed: (this.diff.removed || []).map((r) => ({ ...r, skip: !!this.diffSkips['r' + r.shotId] })),
        })
        this.diffOpen = false
        await this.load()
        if (this.currentShotId != null) await this.selectShot(this.currentShotId)
      } finally {
        this.diffApplying = false
      }
    },
    async selectShot(shotId) {
      this.currentShotId = shotId
      const detail = await v21.getShot(shotId)
      this.current = detail.shot
      this.references = detail.references
      this.segments = detail.shot.segments
      this.imagePrompt = detail.imagePrompt
      this.imageCandidates = detail.imageCandidates
      this.h3 = detail.h3Draft || {}
      this.h3Dirty = false
      this.videoCandidates = detail.video.candidates
      this.previewCandidate = null
      this.previewUrl = ''
      this.staleVideoIds = []
      const fc = detail.frameChaining
      this.frameChaining = { ...fc, stateLabel: { linked: '已衔接', linkable: '可衔接', waiting: '等待上一镜完成', none: '首镜' }[fc.state] }
      this.refreshGuard()
      // T2.5：历史抽屉开着时切镜需重拉，避免展示上一镜的陈旧任务；关着时留给 openHistory 按需拉取
      if (this.historyOpen) await this.loadHistory()
      // 横切 B：切换镜头时把 shot 持久化到 URL（replace，刷新可恢复）
      this.writeSceneShotUrl()
    },
    async refreshGuard() {
      this.guard = await v21.getVideoGuard(this.currentShotId)
    },
    async loadHistory() {
      try {
        this.history = await v21.getVideoHistory(this.currentShotId)
      } catch { this.history = {} }
    },
    async openHistory() {
      // T2.5：开门前清空陈旧数据并重拉本镜历史，避免直连 historyOpen 展示上一镜内容
      this.history = {}
      await this.loadHistory()
      this.historyOpen = true
    },
    async consumeShotQuery() {
      // 首次加载失败（尚未 loaded）时让位：保留 ?shot=/?scene= 参数，待重试成功后再消费，
      // 避免在空列表上误判「镜头不存在」并清除深链（评审修复）
      if (!this.loaded) return
      // 深链消费：?shot=（成片页「回分镜处理」定位）+ ?scene=（横切 B 场次筛选恢复）。
      // 消费后不再单向清除参数——选中/筛选状态经 writeSceneShotUrl 写回 URL，刷新可恢复。
      const query = this.$route.query || {}
      const shotId = query.shot
      if (shotId) {
        const target = this.shots.find((s) => String(s.id) === String(shotId))
        if (target) {
          try {
            await this.selectShot(target.id)
          } catch (e) {
            this.notice = e.message || '定位镜头失败'
          }
        } else {
          // 评审修复轮 2：非法深链（如镜头已被「更新分镜结构」删除）不再让 current 悬空——
          // 回退选中第 1 镜（带 catch）；非法参数经末尾 writeSceneShotUrl replace 清除为合法值
          this.notice = '未找到该镜头，已回到第 1 镜'
          if (this.shots.length > 0) {
            try {
              await this.selectShot(this.shots[0].id)
            } catch (e) {
              this.notice = e.message || '定位镜头失败'
            }
          }
        }
      }
      const scene = query.scene
      if (scene && this.scenes.some((s) => String(s.id) === String(scene))) {
        this.sceneFilter = String(scene)
      }
      this.writeSceneShotUrl()
    },
    // 横切 B：场次/镜头选中状态写入 URL（保留其它参数；replace 不产生历史记录）
    writeSceneShotUrl() {
      const query = { ...this.$route.query }
      if (this.sceneFilter !== 'all') query.scene = String(this.sceneFilter)
      else delete query.scene
      if (this.currentShotId != null) query.shot = String(this.currentShotId)
      else delete query.shot
      this.$router.replace({ query })
    },
    async saveSegment(seg) {
      try {
        const result = await v21.editSegment(this.currentShotId, seg.id, { visual: seg.visual, dialogue: seg.dialogue })
        this.segments = result.segments
      } catch (e) {
        this.notice = e.message || '保存失败'
      }
    },
    async split(seg) {
      const mid = seg.start_seconds + (seg.end_seconds - seg.start_seconds) / 2
      const result = await v21.splitSegment(this.currentShotId, seg.id, mid)
      this.segments = result.segments
    },
    async merge(seg) {
      const result = await v21.mergeSegment(this.currentShotId, seg.id)
      this.segments = result.segments
    },
    async move(seg, direction) {
      // B3：direction 与后端 storyboardService.moveSegment 语义一致（'up' → seq-1，'down' → seq+1；越界返回 400）
      try {
        const result = await v21.moveSegment(this.currentShotId, seg.id, direction)
        this.segments = result.segments
      } catch (e) {
        this.notice = e.message || '移动时段失败'
      }
    },
    async saveImagePrompt() {
      const result = await v21.editImagePrompt(this.currentShotId, this.imagePrompt.text)
      this.imagePrompt = result
    },
    async resetImagePrompt() {
      this.imagePrompt = await v21.resetImagePrompt(this.currentShotId)
    },
    async generateImage() {
      this.generatingImage = true
      try {
        await v21.generateShotImage(this.currentShotId, {})
        const detail = await v21.getShot(this.currentShotId)
        this.imageCandidates = detail.imageCandidates
      } finally {
        this.generatingImage = false
      }
    },
    openImageUrl() {
      // C1：分镜图 URL 输入走专用 Modal
      this.imgUrlText = ''
      this.imgUrlOpen = true
    },
    async confirmImageUrl() {
      const url = this.imgUrlText.trim()
      if (!url) return
      this.imgUrlOpen = false
      await v21.uploadShotImage(this.currentShotId, { imageUrl: url })
      const detail = await v21.getShot(this.currentShotId)
      this.imageCandidates = detail.imageCandidates
    },
    previewImageCandidate(candidate) {
      // T2.5：候选缩略图点击只打开预览抽屉，采纳需在抽屉内显式确认
      this.imgPreviewError = ''
      this.imgPreview = candidate
      this.imgPreviewOpen = true
    },
    async confirmSetCurrentImage() {
      if (this.imgPreviewBusy || !this.imgPreview) return
      this.imgPreviewBusy = true
      this.imgPreviewError = ''
      try {
        await this.setCurrentImage(this.imgPreview)
        this.imgPreviewOpen = false
      } catch (e) {
        this.imgPreviewError = e.message || '设为当前分镜图失败'
      } finally {
        this.imgPreviewBusy = false
      }
    },
    async setCurrentImage(candidate) {
      const result = await v21.setShotImageCurrent(this.currentShotId, candidate.candidateId)
      this.h3 = result.h3Draft
      // 消费后端返回的 staleVideos：换图后基于旧图的视频候选即时标“基于旧分镜图”
      this.staleVideoIds = Array.isArray(result.staleVideos) ? result.staleVideos : []
      await this.selectShot(this.currentShotId)
      await this.load()
    },
    // 候选级 stale 判定：setImageCurrent 返回的 staleVideos（候选 id）∪ 该镜在 completion.staleShots
    // 中（getStoryboard 判定当前采用候选基于旧分镜图）
    isCandidateStale(c) {
      if (!c) return false
      if ((this.staleVideoIds || []).map(String).includes(String(c.candidateId))) return true
      const staleShots = this.completion.staleShots || []
      return !!c.isAdopted && staleShots.some((x) => String(x.shotId) === String(this.currentShotId))
    },
    openH3Sheet() {
      // T2.5：生成/重新生成 H3 前先经确认抽屉（展示结构输入与人工草稿保护语义）
      this.h3SheetError = ''
      this.h3ConfirmOverwrite = false
      this.h3SheetOpen = true
    },
    async confirmGenerateH3() {
      if (this.h3Generating) return
      // 后端 generateH3 对人工编辑过的草稿抛 H3_MANUAL_PROTECTED，需勾选后透传 confirmOverwrite
      const protectedDraft = this.h3.manuallyEdited === true
      if (protectedDraft && !this.h3ConfirmOverwrite) return
      this.h3Generating = true
      this.h3SheetError = ''
      try {
        this.h3 = await v21.generateH3(this.currentShotId, protectedDraft ? { confirmOverwrite: true } : {})
        this.h3Dirty = false
        this.h3SheetOpen = false
        this.refreshGuard()
      } catch (e) {
        this.h3SheetError = e.message || '生成失败'
      } finally {
        this.h3Generating = false
      }
    },
    async saveH3() {
      this.h3 = await v21.saveH3(this.currentShotId, this.h3.text)
      this.h3Dirty = false
      this.refreshGuard()
    },
    async submitVideo() {
      this.videoSheetOpen = false
      this.busy = true
      try {
        const submitted = await v21.submitVideo(this.currentShotId, { count: this.videoCount, delayMs: this.sheetDemoDelay ? 6000 : 0 })
        // C3：异步轮询代替立即 complete——任务进入进行中列表，状态由轮询推进
        this.activeVideoTasks = submitted.tasks.map((t) => ({ taskId: t.taskId, progress: 1, status: 'pending', message: '已提交' }))
        this.startPolling()
      } catch (e) {
        this.notice = e.message || '提交失败'
      } finally {
        this.busy = false
      }
    },
    setVideoCount(n) {
      this.videoCount = n
      this.loadSheetQuote()
    },
    async loadSheetQuote() {
      try {
        this.sheetQuote = await v21.getVideoQuote(this.currentShotId, this.videoCount)
      } catch {
        this.sheetQuote = null
      }
    },
    openVideoSheet() {
      this.videoSheetOpen = true
      this.loadSheetQuote()
    },
    startPolling() {
      if (this.pollTimer) return
      this.pollTimer = setInterval(async () => {
        if (!this.activeVideoTasks.length) {
          clearInterval(this.pollTimer)
          this.pollTimer = null
          return
        }
        let changed = false
        for (const t of this.activeVideoTasks) {
          if (t.done) continue
          try {
            const status = await v21.getVideoTaskStatus(t.taskId)
            t.progress = status.progress || 0
            t.status = status.videoStatus || status.status
            t.message = status.message || ''
            t.done = !!status.done
            if (status.done) {
              changed = true
              if (status.ok) await this.selectShot(this.currentShotId)
              else t.status = 'failed'
            }
          } catch { /* 下轮重试 */ }
        }
        if (changed) {
          await this.load()
          this.activeVideoTasks = this.activeVideoTasks.filter((t) => !t.done || t.status === 'failed')
        }
      }, 1500)
    },
    async cancelTask(t) {
      t.cancelling = true
      try {
        await v21.cancelVideoTask(t.taskId, '用户取消')
        t.status = 'cancelled'
        t.done = true
        this.activeVideoTasks = this.activeVideoTasks.filter((x) => x.taskId !== t.taskId)
      } catch (e) {
        t.message = e.message || '取消失败'
      } finally {
        t.cancelling = false
      }
    },
    taskStatusText(t) {
      if (t.status === 'failed') return '失败'
      if (t.status === 'cancelled') return '已取消'
      return `${t.progress || 0}%`
    },
    preview(candidate) {
      this.previewCandidate = candidate
      this.previewUrl = candidate.url
    },
    async adopt() {
      await v21.adoptVideo(this.currentShotId, this.previewCandidate.candidateId)
      await this.selectShot(this.currentShotId)
      await this.load()
    },
    async undoAdopt() {
      await v21.undoAdoptVideo(this.currentShotId)
      await this.selectShot(this.currentShotId)
      await this.load()
    },
    async retryCandidate(candidate) {
      // 评审修复：历史抽屉未开过时 this.history 为空——重试前先拉本镜历史；
      // 拉取失败或找不到原任务都给可读提示，不再静默按默认输入新建任务兜底
      try {
        this.history = await v21.getVideoHistory(this.currentShotId)
      } catch (e) {
        this.notice = e.message || '读取生成历史失败，已停止重试'
        return
      }
      const task = (this.history.tasks || []).find((t) => `cand_${t.taskId}` === candidate.candidateId)
      if (!task) {
        this.notice = '未找到该候选对应的原任务，可在生成历史抽屉中查看后重试'
        return
      }
      await this.retryTask(task.taskId)
    },
    async retryTask(taskId) {
      const created = await v21.retryVideoTask(taskId)
      await v21.completeVideoTask(created.taskId)
      await this.selectShot(this.currentShotId)
      await this.loadHistory()
    },
    async confirmLink() {
      await v21.confirmFrameLink(this.currentShotId)
      await this.selectShot(this.currentShotId)
    },
    step(delta) {
      const list = this.visibleShots
      const idx = list.findIndex((s) => s.id === this.currentShotId)
      const next = idx + delta
      if (next >= 0 && next < list.length) this.selectShot(list[next].id)
    },
    async openCutSummary() {
      // T2.5：进入成片审核前先展示三组计数摘要（数据源：批量预检 + 完成度统计）
      this.cutSummaryError = ''
      this.cutSummary = null
      this.cutSummaryOpen = true
      this.cutSummaryLoading = true
      try {
        const precheck = await v21.getBatchPrecheck(this.episodeId)
        const missingVideos = (precheck.missingVideos || []).length
        const failed = (precheck.failed || []).length
        // 未采用且有候选（需人工确认）= 未采用镜头数 - 从未生成过候选的镜头数
        const notAdopted = Math.max(0, (this.completion.missing || []).length - missingVideos)
        this.cutSummary = { notAdopted, missingVideos, failed }
      } catch (e) {
        this.cutSummaryError = e.message || '预检失败'
      } finally {
        this.cutSummaryLoading = false
      }
    },
    goCutReview() {
      this.cutSummaryOpen = false
      this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/cut`)
    },
    async openBatch() {
      // B1：先拉预检数据再开门；失败时 notice 提示且不打开抽屉
      try {
        const precheck = await v21.getBatchPrecheck(this.episodeId)
        this.batch = { missingImages: [], missingVideos: [], failed: [], ...precheck }
        this.batchResult = null
        this.batchOpen = true
      } catch (e) {
        this.notice = e.message || '批量预检失败'
      }
    },
    async runBatch(action) {
      this.busy = true
      try {
        this.batchResult = await v21.runBatch(this.episodeId, action)
        this.batch = await v21.getBatchPrecheck(this.episodeId)
        await this.load()
      } catch (e) {
        this.notice = e.message || '批量操作失败'
      } finally {
        this.busy = false
      }
    },
    async openRefManage() {
      // B2：先拉项目素材池再开门；失败时 notice 提示且不打开抽屉
      try {
        const data = await v21.listAssets(this.projectId, { type: 'all' })
        this.assetPool = data.items || []
        this.refManageOpen = true
      } catch (e) {
        this.notice = e.message || '加载素材池失败'
      }
    },
    async addRef(a) {
      try {
        const result = await v21.addReference(this.currentShotId, { assetType: a.assetType, assetId: a.id })
        this.references = result
        await this.selectShot(this.currentShotId)
      } catch (e) {
        this.notice = e.message || '添加引用失败'
      }
    },
    async removeRef(referenceId) {
      try {
        const result = await v21.removeReference(this.currentShotId, referenceId)
        this.references = result
        await this.selectShot(this.currentShotId)
      } catch (e) {
        this.notice = e.message || '移除引用失败'
      }
    },
    previewAsset(type, assetId) {
      const allRefs = [...(this.references.characters || []), ...(this.references.props || [])]
      this.assetPreviewRefIndex = allRefs.findIndex((r) => String(r.assetId) === String(assetId))
      v21.getAssetDetail(type, assetId).then((detail) => {
        this.assetPreview = detail
        this.assetPreviewOpen = true
      })
    },
    async updateToLatest() {
      if (!this.assetPreview?.candidates?.length) return
      const latest = this.assetPreview.candidates[0]
      const result = await v21.useCandidate({ type: this.assetPreview.assetType, assetId: this.assetPreview.id, candidateId: latest.candidateId })
      this.assetPreview.currentImage = result.current.imageUrl
      await this.selectShot(this.currentShotId)
    },
    async exportSrt() {
      const result = await v21.exportCut(this.episodeId, 'srt')
      this.notice = result.ok ? `SRT 已导出：${result.filePath}` : (result.reason || '导出失败')
    },
    async exportShotPackages() {
      // C4：schema 化 Shot Package 文档（shot-package-v2.1）
      const data = await v21.getShotPackage(this.episodeId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `episode-${this.episodeId}-shot-packages.json`
      a.click()
      URL.revokeObjectURL(url)
    },
    // 规格 §24.7：高级画布只从当前阶段（分镜）的高级画布入口进入
    openAdvancedCanvas() {
      this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/canvas`)
    },
    pad(n) {
      return String(n).padStart(2, '0')
    },
    shortId(id) {
      return String(id || '').slice(-4)
    },
    fmtTc(s) {
      return `00:${String(Math.floor(s)).padStart(2, '0')}`
    },
    fmtTime(t) {
      return t ? String(t).slice(11, 19) : ''
    },
    shortHeading(h) {
      return String(h || '').replace(/^(内景|外景)[·\s]*/, '')
    },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    shotClass(s) {
      const isStale = (this.completion.staleShots || []).some((x) => x.shotId === s.id)
      const isMissing = (this.completion.missing || []).includes(s.id)
      if (s.id === this.currentShotId) return isStale ? 'cur stale' : 'cur'
      if (isStale) return 'stale'
      if (isMissing) return ''
      return 'ok'
    },
    shotDotColor(s) {
      const isStale = (this.completion.staleShots || []).some((x) => x.shotId === s.id)
      if (isStale) return 'var(--warn)'
      if (s.id === this.currentShotId) return 'var(--accent)'
      const isMissing = (this.completion.missing || []).includes(s.id)
      return isMissing ? 'var(--neutral)' : 'var(--ok)'
    },
    shotNoClass(s) {
      if (s.id === this.currentShotId) return ''
      const isStale = (this.completion.staleShots || []).some((x) => x.shotId === s.id)
      if (isStale) return 'warn-t'
      const isMissing = (this.completion.missing || []).includes(s.id)
      return isMissing ? '' : 'ok-t'
    },
    shotSuffix(s) {
      const isStale = (this.completion.staleShots || []).some((x) => x.shotId === s.id)
      if (isStale) return ' 旧图'
      const isMissing = (this.completion.missing || []).includes(s.id)
      return isMissing ? ' —' : ' ✓'
    },
    taskStatusLabel(status) {
      return {
        pending: '排队中', running: '生成中', succeeded: '生成成功',
        failed: '生成失败', cancelled: '已取消',
      }[status] || status || '未知状态'
    },
    taskStatusBadge(status) {
      return {
        pending: 'info', running: 'info', succeeded: 'ok',
        failed: 'danger', cancelled: 'outline',
      }[status] || 'outline'
    },
    segRefBadge(seg) {
      // 时段卡头部的「@图片N 生效」徽标：把时段引用映射到本镜引用槽位序号
      try {
        const refs = JSON.parse(seg.asset_refs_json || '{}')
        const names = [...(refs.characterRefs || []), ...(refs.propRefs || []), ...(refs.sceneRefs || [])]
        if (!names.length) return ''
        const slots = []
        for (const n of names) {
          const i = this.referenceChips.findIndex((c) =>
            String(c.name).includes(String(n)) || String(n).includes(String(c.name)))
          if (i >= 0) slots.push(`@图片${i + 1}`)
        }
        return [...new Set(slots)].length ? [...new Set(slots)].join(' · ') + ' 生效' : ''
      } catch { return '' }
    },
    h3SummaryLine(text) {
      const line = String(text || '').split('\n').find((l) => l.trim())
      return line ? line.slice(0, 96) : ''
    },
  },
}
</script>

<style scoped>
.sb-main { flex: 1; display: flex; min-height: 0; }
.imp-row { display: flex; align-items: flex-start; gap: 11px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.insp { width: 272px; flex: 0 0 272px; border-right: 1px solid var(--line); background: var(--panel); padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.insp .grp-t { font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: .4px; margin-top: 2px; }
.ref-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 7px; cursor: pointer; }
.ref-row:hover { background: var(--panel2); }
.ref-row .avatar { width: 26px; height: 26px; font-size: 11px; }
.ref-row .mini { width: 26px; height: 26px; border-radius: 6px; }
.ref-row b { font-size: 12.5px; font-weight: 500; }
.ref-row .v { font-size: 11px; color: var(--muted); margin-left: auto; }
.work { flex: 1; min-width: 0; padding: 10px 14px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.seg-card { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.seg-card .sc-h { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.seg-card .sc-h .tc { font-size: 12px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; }
.seg-card .sc-b { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.f-label { font-size: 10.5px; color: var(--muted); margin-bottom: 3px; }
.f-ta { border: 1px solid var(--line); border-radius: 7px; background: var(--bg); padding: 7px 9px; font-size: 12.5px; line-height: 1.6; color: var(--text-2); resize: vertical; font-family: inherit; }
.f-ta:focus { outline: none; border-color: var(--focus); }
.card-act { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--muted); cursor: pointer; border: 1px solid transparent; }
.card-act:hover { background: var(--panel2); color: var(--text); }
.card-act svg { width: 13px; height: 13px; }
.rev { width: 348px; flex: 0 0 348px; border-left: 1px solid var(--line); background: var(--panel); padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.player { position: relative; height: 178px; border-radius: 10px; overflow: hidden; }
.player .src { position: absolute; left: 8px; bottom: 8px; z-index: 3; }
.player .dur { position: absolute; right: 8px; top: 8px; z-index: 3; font-size: 11px; background: rgba(10,12,18,.6); border-radius: 5px; padding: 2px 7px; }
.film { display: flex; gap: 8px; flex-wrap: wrap; }
.fcand { flex: 1; min-width: 90px; cursor: pointer; }
.fcand .im { height: 62px; border-radius: 7px; border: 1px solid var(--line); position: relative; overflow: hidden; }
.fcand.cur .im { border: 2px solid var(--ok); }
.fcand .cap { font-size: 10.5px; color: var(--muted); margin-top: 4px; text-align: center; }
.genbar { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid rgba(124,92,255,.4); background: linear-gradient(90deg, rgba(124,92,255,.10), rgba(124,92,255,.03)); border-radius: 10px; }
.track { flex: 0 0 92px; border-top: 1px solid var(--line); background: var(--panel); display: flex; align-items: center; gap: 10px; padding: 0 14px; overflow-x: auto; }
.shot { width: 66px; cursor: pointer; flex: 0 0 auto; }
.shot .im { height: 42px; border-radius: 6px; border: 1px solid var(--line); position: relative; }
.shot.cur .im { border: 2px solid var(--accent); }
.shot.ok .im { border-color: rgba(69,211,156,.55); }
.shot .no { font-size: 10px; color: var(--muted); text-align: center; margin-top: 3px; }
.shot .st-dot { position: absolute; right: 4px; top: 4px; width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--bg); }
.h3bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; flex-wrap: wrap; }
.mono { font-family: Consolas, monospace; }
.img-cand { width: 64px; height: 38px; border-radius: 6px; overflow: hidden; cursor: pointer; outline: 2px solid transparent; outline-offset: -2px; }
.img-cand.cur { outline-color: var(--ok); }
.more-wrap { position: relative; }
.more-pop { position: absolute; right: 0; top: 38px; z-index: 30; padding: 6px; min-width: 260px; display: flex; flex-direction: column; gap: 2px; }
.sort-native { background: transparent; border: none; outline: none; color: var(--text); font-size: 13px; appearance: none; cursor: pointer; }
.sort-native option { background: var(--panel2); color: var(--text); }
.empty-box { text-align: center; padding: 90px 0; display: flex; flex-direction: column; gap: 16px; align-items: center; }
.grp-t { font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: .4px; margin-top: 2px; }
</style>
