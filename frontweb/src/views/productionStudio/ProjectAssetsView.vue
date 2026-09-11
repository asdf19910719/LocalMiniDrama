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

      <div v-if="notice" class="notice-strip warn" style="margin-bottom:12px">
        <span style="flex:1">{{ notice }}</span>
        <span style="text-decoration:underline dotted; text-underline-offset:3px; cursor:pointer" @click="notice = ''">关闭</span>
      </div>

      <!-- 三分状态机：加载骨架 → 错误重试 → 内容（加载完成前不渲染空态） -->
      <StateBlock v-if="loading && !loaded" state="loading" />
      <StateBlock v-else-if="loadError && !loaded" state="error" :message="'项目素材加载失败：' + loadError" @retry="retryLoad" />
      <template v-else>

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
        <button class="btn ghost" style="border:1px solid var(--line)" @click="toggleSelectMode"><svg><use href="#i-check"/></svg>{{ selectMode ? '退出选择' : '选择多个' }}</button>
        <span class="muted xs" style="margin-left:auto">缩略比例：人物 3:4 · 场景 16:9 · 道具 1:1</span>
      </div>

      <template v-for="grp in grouped" :key="grp.key">
        <div class="sec-label">{{ grp.label }} <span class="hint muted">· {{ grp.items.length }} 项 · {{ selectMode ? '点击卡片切换选中' : '点击卡片打开详情抽屉' }}</span></div>
        <div class="agrid">
          <div v-for="(item, i) in grp.items" :key="item.assetType + item.id" class="card acard" :class="[item.assetType, { miss: item.blocked, picked: isSelected(item) }]" @click="onCardClick(item)">
            <span v-if="selectMode" class="pick-box" :class="{ on: isSelected(item) }" @click.stop="toggleSelect(item)"><svg><use href="#i-check"/></svg></span>
            <div class="thumb" :class="item.currentImage ? 'has-img' : 'ph ph-' + ((i + grp.key.length) % 6)">
              <img v-if="item.currentImage" :src="item.currentImage">
              <span class="st badge" :class="item.offline ? 'danger' : (item.blocked ? 'warn' : 'ok')">{{ item.offline ? '媒体离线' : (item.blocked ? '缺少当前图' : '已确认') }}</span>
            </div>
            <div class="info"><b>{{ item.name }}</b><p>{{ typeLabel(item.assetType) }} · {{ item.description || '—' }}</p></div>
          </div>
        </div>
      </template>
      <div v-if="grouped.length === 0" class="empty-box">
        <svg style="width:38px;height:38px;color:var(--muted)"><use :href="q ? '#i-search' : '#i-cube'"/></svg>
        <div style="text-align:center">
          <p style="font-size:13.5px">{{ q ? '没有匹配的素材' : '还没有项目素材' }}</p>
          <p class="xs muted" style="margin-top:4px">{{ q ? '换个关键词，或清除搜索后重试' : '人物、场景、道具会在这里建档，供剧本与分镜引用' }}</p>
        </div>
        <button v-if="q" class="btn" @click="q = ''; load()">清除搜索</button>
        <button v-else class="btn primary" @click="createOpen = true">新增第一个素材</button>
      </div>
      </template>
    </div>

    <!-- 批量操作栏（Task 3.3 / P0-10）：多选态且有选中时固定在页面底部 -->
    <div v-if="selectMode && selectedItems.length" class="batch-bar">
      <span class="count">已选 {{ selectedItems.length }} 项</span>
      <button class="btn ghost sm" @click="selectAllFiltered">全选当前筛选结果</button>
      <button class="btn ghost sm" @click="clearSelection">清空</button>
      <button class="btn primary sm" @click="openBatchSheet">批量生成候选</button>
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

    <!-- 素材详情 Drawer（P0-5：五标签结构；关闭入口统一走 closeDetail 以清除 ?asset=） -->
    <div v-if="detailOpen" class="scrim" style="z-index:80" @click="closeDetail"></div>
    <aside v-if="detailOpen" class="drawer" style="z-index:90">
      <div class="drawer-h">
        <h3>{{ detail?.name || '素材' }} <span class="muted" style="font-weight:400; font-size:12px">· 项目素材</span></h3>
        <button class="icon-btn" @click="closeDetail"><svg><use href="#i-close"/></svg></button>
      </div>
      <div class="tabs" style="padding:0 16px">
        <span v-for="t in drawerTabs" :key="t.key" class="tab" :class="{ on: activeTab === t.key }" @click="activeTab = t.key">{{ t.label }}</span>
      </div>
      <div class="drawer-b" style="overflow:auto">

        <!-- 标签 1：概览：当前图大图 + 资料编辑 -->
        <div v-if="activeTab === 'overview'">
          <div v-if="detail?.currentImage" style="border-radius:10px; overflow:hidden; margin-bottom:12px; max-height:280px">
            <img :src="detail.currentImage" style="width:100%; display:block">
          </div>
          <div v-else class="ph-big">当前图空缺——到「版本与候选」标签点击候选或先生成一张</div>
          <div class="sec-t">资料编辑</div>
          <div v-if="profileError" class="err-line">{{ profileError }}</div>
          <div v-if="profileSaved" class="ok-line">资料已保存</div>
          <label class="col" style="gap:4px; margin-bottom:8px"><span class="xs muted">名称</span>
            <input class="input" style="width:100%" v-model="editForm.name">
          </label>
          <label class="col" style="gap:4px; margin-bottom:10px"><span class="xs muted">描述</span>
            <textarea class="input" style="width:100%; height:64px; padding:8px" v-model="editForm.description"></textarea>
          </label>
          <button class="btn primary" :disabled="savingProfile" @click="saveProfile">{{ savingProfile ? '保存中…' : '保存资料' }}</button>
        </div>

        <!-- 标签 2：版本与候选：候选缩略图 + 撤销横条 + 人物状态切换条 -->
        <div v-if="activeTab === 'versions'">
          <div v-if="undoStrip" class="undo-strip">
            <span>已设为当前图</span>
            <button class="btn ghost undo-btn" @click="undoUseCandidate">撤销</button>
          </div>
          <div class="sec-t cand-head">候选 <span class="muted" style="font-weight:400">· 点击候选即设为当前图</span>
            <button class="btn ghost head-gen-btn" :disabled="generating" @click="openGenSheet"><svg style="width:13px;height:13px"><use href="#i-spark"/></svg>生成候选</button>
          </div>
          <div class="cand-row">
            <div v-for="c in detail?.candidates || []" :key="c.candidateId" class="cand" :class="{ cur: c.isCurrent }" @click="useCandidate(c)">
              <div class="im"><img :src="c.url" style="width:100%;height:100%;object-fit:cover"></div>
              <div class="cap" :class="c.isCurrent ? 'ok-t' : ''">{{ c.isCurrent ? '当前图' : providerLabel(c.provider) }} · {{ shortTime(c.createdAt) }}</div>
            </div>
            <div class="cand"><div class="im" style="border:1px dashed var(--line-strong); display:flex; align-items:center; justify-content:center; color:var(--muted); cursor:pointer" @click="openGenSheet"><svg style="width:18px;height:18px"><use href="#i-plus"/></svg></div><div class="cap">生成</div></div>
          </div>
          <template v-if="detail?.assetType === 'character'">
            <div class="sec-t">人物状态 <span class="muted" style="font-weight:400">· 点击状态卡把该状态图设为人物当前图</span></div>
            <div class="state-row" v-if="(detail?.states || []).length">
              <div v-for="s in detail?.states || []" :key="s.id" class="state-card" @click="applyStateToCurrent(s)">
                <div class="im">
                  <img v-if="s.imageUrl" :src="s.imageUrl" style="width:100%;height:100%;object-fit:cover">
                  <span v-else class="ph-txt">无图</span>
                </div>
                <div class="cap">{{ s.name }}<span v-if="s.isDefault" class="badge ok def-badge">默认</span></div>
                <button class="mini-btn" @click.stop="openStateGenSheet(s)">生成该状态候选</button>
              </div>
            </div>
            <p v-else class="muted" style="font-size:12px">该人物还没有状态（如"常服 / 夜班服"），可经制作包导入或状态管理创建</p>
            <!-- 人物音色（Task 3.2 / P0-9）：项目级音色管理最小闭环 -->
            <div class="sec-t">人物音色</div>
            <p class="muted" style="font-size:11.5px; margin:0 0 8px">本集使用音色在单集设定中另行选择</p>
            <div class="voice-box">
              <template v-if="detail?.voice">
                <div class="voice-cur">
                  <span class="voice-name">{{ detail.voice.name || '未命名音色' }}</span>
                  <audio v-if="detail.voice.url" controls :src="detail.voice.url" class="voice-audio"></audio>
                </div>
                <div class="voice-acts">
                  <button class="btn ghost sm" @click="openVoiceSheet">设置音色</button>
                  <button class="btn ghost sm" @click="askClearVoice">清除</button>
                </div>
              </template>
              <template v-else>
                <span class="muted" style="font-size:12.5px">未设置音色</span>
                <button class="btn ghost sm" @click="openVoiceSheet">设置音色</button>
              </template>
            </div>
          </template>
        </div>

        <!-- 标签 3：使用位置（软删剧集：episodeNumber 为 null 时显示“已删除剧集”且不可点击，P3.1 deferred） -->
        <div v-if="activeTab === 'usage'">
          <p v-if="(detail?.usage || []).length === 0" class="muted empty-tip">尚未被任何剧集使用</p>
          <template v-else>
            <template v-for="u in detail?.usage || []" :key="u.kind + '-' + u.episodeId">
              <router-link v-if="u.episodeNumber != null" class="usage-row" :to="`/projects/${projectId}/episodes/${u.episodeId}/script`">
                <b>第 {{ u.episodeNumber }} 集</b>
                <span class="badge">{{ usageLabel(u.kind) }}</span>
                <span class="muted go-tip">打开剧本 ›</span>
              </router-link>
              <div v-else class="usage-row deleted">
                <b>已删除剧集</b>
                <span class="badge">{{ usageLabel(u.kind) }}</span>
                <span class="muted go-tip">已删除 · 不可打开</span>
              </div>
            </template>
          </template>
        </div>

        <!-- 标签 4：生成记录 -->
        <div v-if="activeTab === 'records'">
          <p v-if="(detail?.records || []).length === 0" class="muted empty-tip">还没有生成或上传记录——到「版本与候选」标签生成第一张候选图</p>
          <div v-for="r in detail?.records || []" :key="r.candidateId" class="record-row">
            <div class="kv"><span class="k">时间</span><span class="v">{{ shortTime(r.createdAt) || '—' }}</span></div>
            <div class="kv"><span class="k">通道</span><span class="v">{{ providerLabel(r.provider) }}</span></div>
            <div class="kv"><span class="k">结果</span><span class="v" :class="r.status === 'succeeded' ? 'ok-t' : ''">{{ recordStatusLabel(r.status) }}</span></div>
            <div class="kv" v-if="r.prompt"><span class="k">提示词</span><span class="v prompt-txt">{{ r.prompt }}</span></div>
          </div>
        </div>

        <!-- 标签 5：高级：只读信息 + 危险区 -->
        <div v-if="activeTab === 'advanced'">
          <div class="sec-t">只读信息</div>
          <div class="kv"><span class="k">素材 ID</span><span class="v">{{ detail?.id }}</span></div>
          <div class="kv"><span class="k">类型</span><span class="v">{{ typeLabel(detail?.assetType) }}</span></div>
          <div class="kv"><span class="k">创建时间</span><span class="v">{{ shortTime(detail?.createdAt) || '—' }}</span></div>
          <div class="kv"><span class="k">更新时间</span><span class="v">{{ shortTime(detail?.updatedAt) || '—' }}</span></div>
          <div class="kv"><span class="k">候选数</span><span class="v">{{ (detail?.candidates || []).length }}</span></div>
          <div class="kv"><span class="k">状态数</span><span class="v">{{ (detail?.states || []).length }}</span></div>
          <div class="sec-t" style="color:var(--danger)">危险区</div>
          <div class="danger-zone">
            <p class="muted" style="margin:0; font-size:12px; line-height:1.6">移入回收站后素材不再出现在项目素材列表，可在高级数据工具中恢复删除。</p>
            <button class="btn danger" @click="askRemove"><svg><use href="#i-trash"/></svg>移入回收站</button>
          </div>
        </div>
      </div>
    </aside>

    <!-- 删除确认 Modal（B7：确认先行，确认后才调用删除） -->
    <div v-if="removeOpen" class="scrim" style="z-index:100" @click="removeOpen = false"></div>
    <div v-if="removeOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>移入回收站</h3>
          <button class="icon-btn" @click="removeOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div v-if="removeError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-bottom:12px">{{ removeError }}</div>
          <p style="margin:0; line-height:1.6">素材「{{ detail?.name || '—' }}」会移入回收站，可恢复删除。确认移入？</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="removeOpen = false">取消</button>
          <button class="btn danger" :disabled="removing" @click="confirmRemove">{{ removing ? '删除中…' : '确认删除' }}</button>
        </div>
      </div>
    </div>

    <!-- 生成确认 Sheet（P0-7：生成前确认对象 / 通道 / 参数 / 费用） -->
    <div v-if="genSheetOpen" class="scrim" style="z-index:100" @click="genSheetOpen = false"></div>
    <div v-if="genSheetOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:480px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-spark"/></svg>
          <h3>生成候选</h3>
          <button class="icon-btn" @click="genSheetOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="col" style="gap:12px">
            <div v-if="genError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px">{{ genError }}</div>
            <div class="kv"><span class="k">对象</span><span class="v">{{ typeLabel(detail?.assetType) }} · {{ detail?.name || '—' }}<template v-if="genStateName"> · 状态：{{ genStateName }}</template></span></div>
            <div class="kv"><span class="k">生成通道</span><span class="v">本地生成（mock 通道）</span></div>
            <div class="kv"><span class="k">画布尺寸</span><span class="v">{{ genSize }}</span></div>
            <label class="col" style="gap:4px"><span class="xs muted">提示词（可编辑）</span>
              <textarea class="input" style="width:100%; height:64px; padding:8px" v-model="genPrompt"></textarea>
            </label>
            <div class="kv"><span class="k">任务与费用</span><span class="v">1 个生成任务 · 本地生成，不产生 API 费用</span></div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="genSheetOpen = false">取消</button>
          <button class="btn primary" :disabled="generating" @click="confirmGenerate">{{ generating ? '生成中…' : '确认生成' }}</button>
        </div>
      </div>
    </div>

    <!-- 批量生成抽屉（Task 3.3 / P0-10）：确认前置 → 逐项顺序执行 → 结果呈现 -->
    <div v-if="batchOpen" class="scrim" style="z-index:100" @click="closeBatch"></div>
    <div v-if="batchOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:520px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-spark"/></svg>
          <h3>批量生成候选</h3>
          <button class="icon-btn" :disabled="batchRunning" @click="closeBatch"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b" style="max-height:60vh; overflow:auto">
          <div class="col" style="gap:10px">
            <div class="kv"><span class="k">已选素材</span><span class="v">{{ batchItems.length }} 项 · 每项 1 个生成任务</span></div>
            <div class="kv"><span class="k">生成通道</span><span class="v">本地生成（mock 通道）</span></div>
            <div class="kv"><span class="k">费用</span><span class="v">本地生成，不产生 API 费用</span></div>
            <div class="kv"><span class="k">执行方式</span><span class="v">逐项顺序执行</span></div>
            <p class="muted" style="margin:0; font-size:12px; line-height:1.6">无当前图与有当前图的素材都会生成——生成只新增候选，不会改动当前图。</p>
            <div class="batch-list">
              <div v-for="(it, idx) in batchItems" :key="it.assetType + it.id" class="batch-row">
                <span class="idx">{{ idx + 1 }}</span>
                <span class="nm">{{ it.name }}</span>
                <span class="muted">{{ typeLabel(it.assetType) }} · {{ batchSize(it) }}</span>
              </div>
            </div>
            <div v-if="batchRunning" class="batch-prog">正在生成 {{ batchIndex + 1 }}/{{ batchItems.length }}：{{ batchItems[batchIndex] ? batchItems[batchIndex].name : '—' }}</div>
            <template v-if="batchPhase === 'done'">
              <div class="kv"><span class="k">结果</span><span class="v">成功 {{ batchSuccess }} 项 / 失败 {{ batchFailures.length }} 项</span></div>
              <div v-for="f in batchFailures" :key="f.name" class="err-line" style="margin-bottom:0">{{ f.name }}：{{ f.message }}</div>
            </template>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" :disabled="batchRunning" @click="closeBatch">取消</button>
          <button v-if="batchPhase !== 'done'" class="btn primary" :disabled="batchRunning" @click="confirmBatchGenerate">{{ batchRunning ? '生成中…' : '开始生成（' + batchItems.length + ' 项）' }}</button>
          <button v-else class="btn primary" @click="finishBatch">完成</button>
        </div>
      </div>
    </div>

    <!-- 音色设置 Modal（Task 3.2 / P0-9）：上传 / 手动两个来源；提取置灰待 Provider -->
    <div v-if="voiceSheetOpen" class="scrim" style="z-index:100" @click="voiceSheetOpen = false"></div>
    <div v-if="voiceSheetOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:440px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--accent)"><use href="#i-vol"/></svg>
          <h3>设置音色</h3>
          <button class="icon-btn" @click="voiceSheetOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div class="col" style="gap:10px">
            <div v-if="voiceError" class="err-line">{{ voiceError }}</div>
            <div class="tabs" style="padding:0">
              <span class="tab" :class="{ on: voiceTab === 'upload' }" @click="voiceTab = 'upload'">上传音频</span>
              <span class="tab" :class="{ on: voiceTab === 'manual' }" @click="voiceTab = 'manual'">手动填写</span>
            </div>
            <div v-if="voiceTab === 'upload'" class="col" style="gap:8px">
              <label class="upload-pick">
                <svg><use href="#i-vol"/></svg>选择音频文件（mp3 / wav / m4a / ogg）
                <input type="file" accept="audio/*" style="display:none" @change="uploadVoiceFile">
              </label>
              <p v-if="voiceUploading" class="xs muted">音频上传中…</p>
              <p v-if="voiceForm.url" class="ok-line" style="margin:0">已上传「{{ voiceForm.name }}」，可试听确认</p>
              <audio v-if="voiceForm.url" controls :src="voiceForm.url" class="voice-audio"></audio>
            </div>
            <div v-else class="col" style="gap:8px">
              <label class="col" style="gap:4px"><span class="xs muted">音色名称</span>
                <input class="input" style="width:100%" v-model="voiceForm.name" placeholder="如：温柔女声">
              </label>
              <label class="col" style="gap:4px"><span class="xs muted">音频 URL</span>
                <input class="input" style="width:100%" v-model="voiceForm.url" placeholder="https:// 或 /static/ 路径">
              </label>
            </div>
            <div class="extract-row">
              <button class="btn ghost sm" disabled>从音视频提取</button>
              <span class="xs muted">依赖语音 Provider，暂未开放</span>
            </div>
          </div>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="voiceSheetOpen = false">取消</button>
          <button class="btn primary" :disabled="voiceSaving || voiceUploading || !voiceForm.url" @click="saveVoice">{{ voiceSaving ? '保存中…' : '保存音色' }}</button>
        </div>
      </div>
    </div>

    <!-- 清除音色确认 Modal（Task 3.2：确认先行，确认后才 PATCH voice=null） -->
    <div v-if="voiceClearOpen" class="scrim" style="z-index:100" @click="voiceClearOpen = false"></div>
    <div v-if="voiceClearOpen" class="modal-wrap" style="z-index:110">
      <div class="modal" style="width:420px">
        <div class="modal-h">
          <svg style="width:18px;height:18px;color:var(--danger)"><use href="#i-trash"/></svg>
          <h3>清除音色</h3>
          <button class="icon-btn" @click="voiceClearOpen = false"><svg><use href="#i-close"/></svg></button>
        </div>
        <div class="modal-b">
          <div v-if="voiceClearError" style="background:var(--danger-subtle); color:var(--danger); border-radius:8px; padding:8px 12px; font-size:12.5px; margin-bottom:12px">{{ voiceClearError }}</div>
          <p style="margin:0; line-height:1.6">将清除人物「{{ detail?.name || '—' }}」的当前音色设置。确认清除？</p>
        </div>
        <div class="modal-f">
          <button class="btn ghost" @click="voiceClearOpen = false">取消</button>
          <button class="btn danger" :disabled="voiceClearing" @click="confirmClearVoice">{{ voiceClearing ? '清除中…' : '确认清除' }}</button>
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
  name: 'ProjectAssetsView',
  mixins: [escMixin],
  components: { StateBlock },
  data() {
    return {
      items: [], type: 'all', q: '',
      loading: false, loaded: false, loadError: '',
      createOpen: false, createForm: { type: 'character', name: '', description: '' },
      detailOpen: false, detail: null, generating: false, projectTitle: '',
      notice: '',
      removeOpen: false, removing: false, removeError: '',
      genSheetOpen: false, genPrompt: '', genSize: '720x480', genError: '',
      // P0-5：五标签结构（当前标签名存组件 state；URL 深链 Phase 5 统一做）
      activeTab: 'overview',
      drawerTabs: [
        { key: 'overview', label: '概览' },
        { key: 'versions', label: '版本与候选' },
        { key: 'usage', label: '使用位置' },
        { key: 'records', label: '生成记录' },
        { key: 'advanced', label: '高级' },
      ],
      editForm: { name: '', description: '' },
      savingProfile: false, profileError: '', profileSaved: false,
      // P0-8：候选撤销横条（5 秒或下次操作前可撤销）
      undoStrip: null, undoTimer: null,
      // P0-6：状态候选生成（打开既有生成 Sheet，prompt 注入状态名并透传 stateId）
      genStateId: null, genStateName: '',
      // Task 3.2（P0-9）：人物音色管理
      voiceSheetOpen: false, voiceTab: 'upload',
      voiceForm: { name: '', url: '' },
      voiceUploading: false, voiceSaving: false, voiceError: '',
      voiceClearOpen: false, voiceClearing: false, voiceClearError: '',
      // Task 3.3（P0-10）：批量选择与批量生成（多选 → 批量栏 → 预检抽屉 → 逐项执行）
      selectMode: false, selectedKeys: [],
      batchOpen: false, batchItems: [], batchPhase: 'confirm',
      batchIndex: 0, batchSuccess: 0, batchFailures: [], batchRunning: false,
    }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    allItems() { return this._all || [] },
    allCount() { return this.allItems.length },
    // P0-10：已选项映射回素材对象（selectedKeys 存「类型:id」键，跨类型防 id 撞车）
    selectedItems() { return this.allItems.filter((it) => this.selectedKeys.includes(this.itemKey(it))) },
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
    this.bindEsc(this.onEsc)
    // 横切 B：?asset=<type>:<id> 深链在列表加载后消费（命中即打开详情抽屉并写回 URL）
    this.load().then(() => this.consumeAssetQuery())
    v21.getOverview(this.projectId).then((o) => { this.projectTitle = o.hero.title }).catch(() => {})
  },
  methods: {
    // Esc 自上而下关本视图的弹层（清除音色确认 → 音色弹窗 → 批量抽屉（执行中不关不穿透）→ 生成 Sheet → 删除确认 → 详情抽屉 → 新增弹窗）
    onEsc() {
      if (this.voiceClearOpen) { this.voiceClearOpen = false; return true }
      if (this.voiceSheetOpen) { this.voiceSheetOpen = false; return true }
      if (this.batchOpen) {
        if (this.batchRunning) return true // 批量执行中不提供 Esc 中断，也不允许穿透关闭底层
        this.closeBatch()
        return true
      }
      if (this.genSheetOpen) { this.genSheetOpen = false; return true }
      if (this.removeOpen) { this.removeOpen = false; return true }
      if (this.detailOpen) { this.closeDetail(); return true }
      if (this.createOpen) { this.createOpen = false; return true }
      return false
    },
    async load() {
      this.loading = true
      try {
        const data = await v21.listAssets(this.projectId, { type: this.type, q: this.q })
        this.items = data.items || []
        this._all = await v21.listAssets(this.projectId, { type: 'all', q: this.q }).then((d) => d.items || [])
        this.loadError = ''
        this.loaded = true
      } catch (e) {
        // 首次失败呈现为可重试错误态（原为无兜底裸 await，失败页面白板）；
        // 已有内容后的重载失败保留列表，错误走页内提示（与分镜/成片页口径一致）
        if (this.loaded) {
          this.notice = e.message || '刷新素材列表失败'
        } else {
          this.loadError = e.message || '网络错误'
        }
      } finally {
        this.loading = false
      }
    },
    // 错误态重试：重载成功后继续消费挂起的 ?asset= 深链（首次加载失败时 consumeAssetQuery 已让位保留）
    async retryLoad() {
      await this.load()
      await this.consumeAssetQuery()
    },
    // ---- 横切 B：?asset=<type>:<id> URL 恢复（规格 ASSETS-030 本期最小：只做 asset 参数） ----
    // 列表加载后消费深链：命中素材打开详情抽屉；未命中清除参数，不留死链
    async consumeAssetQuery() {
      // 评审修复：首次加载失败（尚未 loaded）时让位：保留 ?asset= 参数待重试成功后再消费，
      // 不在空列表上误判「素材不存在」而清除深链
      if (!this.loaded) return
      const asset = this.$route.query.asset
      if (!asset) return
      const raw = String(asset)
      const idx = raw.indexOf(':')
      const type = idx > 0 ? raw.slice(0, idx) : ''
      const id = idx > 0 ? raw.slice(idx + 1) : ''
      const item = type && id
        ? this.allItems.find((i) => i.assetType === type && String(i.id) === id)
        : null
      if (item) {
        try {
          await this.openDetail(item)
        } catch {
          this.clearAssetQuery()
        }
      } else {
        this.clearAssetQuery()
      }
    },
    // 打开详情时写入 ?asset=<type>:<id>（replace 不产生历史记录）
    writeAssetUrl() {
      if (!this.detail) return
      const query = { ...this.$route.query }
      query.asset = `${this.detail.assetType}:${this.detail.id}`
      this.$router.replace({ query })
    },
    // 关闭详情时清除 ?asset=（保留列表筛选等其它参数）
    clearAssetQuery() {
      const query = { ...this.$route.query }
      if ('asset' in query) {
        delete query.asset
        this.$router.replace({ query })
      }
    },
    setType(t) { this.type = t; this.load() },
    countOf(t) { return this.allItems.filter((i) => i.assetType === t).length },
    typeLabel(t) {
      return { character: '角色', scene: '场景', prop: '道具' }[t] || t
    },
    providerLabel(p) {
      return { mock: '本地生成', upload: 'URL 上传' }[p] || p || '—'
    },
    usageLabel(kind) {
      return { cast: '出演', scene: '场景', prop: '道具', selection: '本集引用' }[kind] || kind
    },
    recordStatusLabel(s) {
      return { succeeded: '成功', failed: '失败', pending: '进行中', running: '进行中', cancelled: '已取消' }[s] || s || '—'
    },
    shortTime(t) {
      return typeof t === 'string' ? t.slice(0, 16).replace('T', ' ') : ''
    },
    async create() {
      await v21.createAsset(this.projectId, { type: this.createForm.type, fields: { name: this.createForm.name, description: this.createForm.description } })
      this.createOpen = false
      this.createForm = { type: this.createForm.type, name: '', description: '' }
      this.load()
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.id)
      this.activeTab = 'overview'
      this.editForm = { name: this.detail.name || '', description: this.detail.description || '' }
      this.profileError = ''
      this.profileSaved = false
      this.undoStrip = null
      this.genStateId = null
      this.genStateName = ''
      this.voiceSheetOpen = false
      this.voiceClearOpen = false
      this.voiceForm = { name: '', url: '' }
      this.voiceError = ''
      this.voiceClearError = ''
      this.detailOpen = true
      this.writeAssetUrl()
    },
    // 关闭详情抽屉：清除 ?asset= 参数（保留列表筛选，规格 ASSETS-030）
    closeDetail() {
      this.detailOpen = false
      this.clearAssetQuery()
    },
    // 概览标签：资料编辑保存（PATCH /assets/:type/:assetId），保存中/失败在标签内呈现
    async saveProfile() {
      if (!this.detail || this.savingProfile) return
      this.savingProfile = true
      this.profileError = ''
      this.profileSaved = false
      try {
        await v21.updateAsset(this.detail.assetType, this.detail.id, { name: this.editForm.name, description: this.editForm.description })
        this.detail.name = this.editForm.name
        this.detail.description = this.editForm.description
        this.profileSaved = true
        this.load()
      } catch (e) {
        this.profileError = e.message || '保存失败，请重试'
      } finally {
        this.savingProfile = false
      }
    },
    // 换图后统一本地同步 + 弹出「已设为当前图｜撤销」横条（5 秒或下次操作前可撤销）
    applyCurrentResult(result) {
      this.detail.currentImage = result.current.imageUrl
      for (const c of this.detail.candidates || []) c.isCurrent = c.url === result.current.imageUrl
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.undoStrip = { previousUrl: result.previous.imageUrl }
      this.undoTimer = setTimeout(() => { this.undoStrip = null }, 5000)
    },
    async useCandidate(candidate) {
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
        this.applyCurrentResult(result)
        this.load()
      } catch (e) {
        this.notice = e.message || '候选设为当前图失败'
      }
    },
    // P0-8：撤销 = useCandidate 传回旧指针（响应 previous 字段）
    async undoUseCandidate() {
      if (!this.undoStrip || !this.detail) return
      const previousUrl = this.undoStrip.previousUrl
      if (this.undoTimer) clearTimeout(this.undoTimer)
      this.undoStrip = null
      if (!previousUrl) return
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, imageUrl: previousUrl })
        this.applyCurrentResult(result)
        if (this.undoTimer) clearTimeout(this.undoTimer)
        this.undoStrip = null
        this.load()
      } catch (e) {
        this.notice = e.message || '撤销失败，可在候选列表重新选择'
      }
    },
    // P0-6：点击状态卡 = 把该状态图应用为人物当前图（useCandidate 传状态 imageUrl）
    async applyStateToCurrent(s) {
      if (!this.detail || !s || !s.imageUrl) return
      try {
        const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, imageUrl: s.imageUrl })
        this.applyCurrentResult(result)
        this.load()
      } catch (e) {
        this.notice = e.message || '状态图设为当前图失败'
      }
    },
    // P0-7：生成入口只负责打开确认 Sheet，确认后才真正生成
    openGenSheet() {
      if (!this.detail) return
      this.genStateId = null
      this.genStateName = ''
      this.genPrompt = this.detail.name || ''
      // 画布尺寸按素材类型的展示比例取默认值（人物 3:4 · 场景 16:9 · 道具 1:1）
      this.genSize = { character: '720x960', scene: '1280x720', prop: '720x720' }[this.detail.assetType] || '720x480'
      this.genError = ''
      this.genSheetOpen = true
    },
    // P0-6：为指定状态生成候选——打开既有生成 Sheet，prompt 注入状态名并透传 stateId
    openStateGenSheet(s) {
      if (!this.detail || !s) return
      this.genStateId = s.id
      this.genStateName = s.name
      this.genPrompt = `${this.detail.name || ''}，状态：${s.name}`
      this.genSize = { character: '720x960', scene: '1280x720', prop: '720x720' }[this.detail.assetType] || '720x480'
      this.genError = ''
      this.genSheetOpen = true
    },
    async confirmGenerate() {
      if (!this.detail || this.generating) return
      this.generating = true
      this.genError = ''
      try {
        await v21.generateAssetCandidate(this.projectId, { type: this.detail.assetType, assetId: this.detail.id, prompt: this.genPrompt, size: this.genSize, stateId: this.genStateId || null })
        this.genStateId = null
        this.genStateName = ''
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.load()
        this.genSheetOpen = false
        this.notice = '已生成候选'
      } catch (e) {
        // 失败时 Sheet 仍打开，错误必须呈现在 Sheet 体内（页面 notice 会被遮罩遮挡）
        this.genError = e.message || '候选生成失败'
      } finally {
        this.generating = false
      }
    },
    // B7：删除确认先行——弹窗确认后才调一次 deleteAsset；失败/阻塞时素材保留
    askRemove() {
      if (!this.detail) return
      this.removeError = ''
      this.removeOpen = true
    },
    async confirmRemove() {
      if (!this.detail || this.removing) return
      this.removing = true
      this.removeError = ''
      try {
        const result = await v21.deleteAsset(this.detail.assetType, this.detail.id)
        if (result.blocked) {
          // 弹窗仍打开，阻塞原因呈现在弹窗体内（页面 notice 会被遮罩遮挡）
          this.removeError = result.message || '该素材仍被引用，暂不能删除'
          return
        }
        this.removeOpen = false
        this.closeDetail()
        this.load()
        this.notice = '已移入回收站'
      } catch (e) {
        this.removeError = e.message || '删除失败，素材已保留'
      } finally {
        this.removing = false
      }
    },
    comingSoon(name) {
      this.notice = `${name}将在本迭代内启用`
    },
    // ---- Task 3.3（P0-10）：批量选择与批量生成 ----
    // 多选模式切换：进入/退出多选态；退出时清空已选并关闭批量抽屉
    toggleSelectMode() {
      this.selectMode = !this.selectMode
      this.selectedKeys = []
      if (!this.selectMode) this.batchOpen = false
    },
    // 多选态点卡 = 切换选中（不再打开详情）；非多选态保持打开详情抽屉
    onCardClick(item) {
      if (this.selectMode) {
        this.toggleSelect(item)
        return
      }
      this.openDetail(item)
    },
    itemKey(item) {
      return `${item.assetType}:${item.id}`
    },
    isSelected(item) {
      return this.selectedKeys.includes(this.itemKey(item))
    },
    toggleSelect(item) {
      const key = this.itemKey(item)
      const at = this.selectedKeys.indexOf(key)
      if (at >= 0) this.selectedKeys.splice(at, 1)
      else this.selectedKeys.push(key)
    },
    selectAllFiltered() {
      for (const grp of this.grouped) {
        for (const item of grp.items) {
          const key = this.itemKey(item)
          if (!this.selectedKeys.includes(key)) this.selectedKeys.push(key)
        }
      }
    },
    clearSelection() {
      this.selectedKeys = []
    },
    // 批量抽屉（确认前置）：打开时对已选项做快照，执行不受后续选择变化影响
    openBatchSheet() {
      if (!this.selectedItems.length) return
      this.batchItems = this.selectedItems.slice()
      this.batchPhase = 'confirm'
      this.batchIndex = 0
      this.batchSuccess = 0
      this.batchFailures = []
      this.batchOpen = true
    },
    closeBatch() {
      if (this.batchRunning) return
      this.batchOpen = false
      this.batchItems = []
      this.batchPhase = 'confirm'
      this.batchIndex = 0
      this.batchSuccess = 0
      this.batchFailures = []
    },
    // 完成：关闭抽屉、清空已选并刷新列表
    finishBatch() {
      this.batchOpen = false
      this.batchItems = []
      this.batchPhase = 'confirm'
      this.batchIndex = 0
      this.batchSuccess = 0
      this.batchFailures = []
      this.selectedKeys = []
      this.load()
    },
    // 与单项生成 Sheet 默认口径一致：prompt 取素材名称（名称/描述派生）
    batchPrompt(item) {
      return item.name || item.description || ''
    },
    // 与 T2.2 单项生成 Sheet 口径一致：画布尺寸按素材类型默认
    batchSize(item) {
      return { character: '720x960', scene: '1280x720', prop: '720x720' }[item.assetType] || '720x480'
    },
    // 逐项顺序执行：单项失败不中断批次（失败逐项收集呈现）；完成后刷新列表
    async confirmBatchGenerate() {
      if (this.batchRunning || !this.batchItems.length) return
      this.batchRunning = true
      this.batchPhase = 'running'
      this.batchIndex = 0
      this.batchSuccess = 0
      this.batchFailures = []
      for (let i = 0; i < this.batchItems.length; i++) {
        const item = this.batchItems[i]
        this.batchIndex = i
        try {
          await v21.generateAssetCandidate(this.projectId, { type: item.assetType, assetId: item.id, prompt: this.batchPrompt(item), size: this.batchSize(item), stateId: null })
          this.batchSuccess++
        } catch (e) {
          this.batchFailures.push({ name: item.name, message: e.message || '候选生成失败' })
        }
      }
      this.batchRunning = false
      this.batchPhase = 'done'
      this.load()
    },
    // ---- Task 3.2（P0-9）：人物音色管理 ----
    // 打开音色设置弹窗：回填当前音色，来源 tab 按既有 source 归位
    openVoiceSheet() {
      if (!this.detail) return
      this.voiceForm = { name: this.detail.voice?.name || '', url: this.detail.voice?.url || '' }
      this.voiceTab = this.detail.voice?.source === 'manual' ? 'manual' : 'upload'
      this.voiceError = ''
      this.voiceSheetOpen = true
    },
    // 上传音频 → /api/v1/upload/audio，成功后回填 url + 文件名
    async uploadVoiceFile(event) {
      const file = event.target.files && event.target.files[0]
      if (!file || this.voiceUploading) return
      this.voiceUploading = true
      this.voiceError = ''
      try {
        const data = await v21.uploadAudio(file)
        this.voiceForm.url = data?.url || ''
        if (!this.voiceForm.url) throw new Error('上传响应缺少 url')
        this.voiceForm.name = data?.filename || file.name
      } catch (e) {
        this.voiceError = e.message || '音频上传失败'
      } finally {
        this.voiceUploading = false
        event.target.value = ''
      }
    },
    // 保存音色：PATCH voice；成功提示、失败呈现在弹窗体内
    async saveVoice() {
      if (!this.detail || this.voiceSaving || !this.voiceForm.url) return
      this.voiceSaving = true
      this.voiceError = ''
      try {
        const voice = {
          name: this.voiceForm.name || '未命名音色',
          url: this.voiceForm.url,
          source: this.voiceTab === 'upload' ? 'upload' : 'manual',
        }
        const result = await v21.updateAsset(this.detail.assetType, this.detail.id, { voice })
        this.detail.voice = result.voice || voice
        this.voiceSheetOpen = false
        this.notice = '音色已更新'
      } catch (e) {
        this.voiceError = e.message || '保存失败，请重试'
      } finally {
        this.voiceSaving = false
      }
    },
    // 清除音色：确认弹窗先行，确认后才 PATCH voice=null
    askClearVoice() {
      if (!this.detail) return
      this.voiceClearError = ''
      this.voiceClearOpen = true
    },
    async confirmClearVoice() {
      if (!this.detail || this.voiceClearing) return
      this.voiceClearing = true
      this.voiceClearError = ''
      try {
        await v21.updateAsset(this.detail.assetType, this.detail.id, { voice: null })
        this.detail.voice = null
        this.voiceClearOpen = false
        this.notice = '音色已更新'
      } catch (e) {
        this.voiceClearError = e.message || '清除失败，请重试'
      } finally {
        this.voiceClearing = false
      }
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
.sec-label { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .4px; margin: 4px 0 10px; }
.sec-label .hint { font-weight: 400; font-size: 11.5px; letter-spacing: 0; }
.agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-bottom: 20px; }
.acard { cursor: pointer; overflow: hidden; position: relative; }
.acard .thumb { position: relative; overflow: hidden; }
.acard.character .thumb { aspect-ratio: 3 / 4; height: auto; }
.acard.scene .thumb { aspect-ratio: 16 / 9; height: auto; }
.acard.prop .thumb { aspect-ratio: 1 / 1; height: auto; display: flex; align-items: center; justify-content: center; background: #10131b; }
.acard .thumb img { width: 100%; height: 100%; object-fit: cover; }
.acard .st { position: absolute; left: 8px; top: 8px; z-index: 2; }
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
/* 五标签抽屉 */
.cand-head { display: flex; align-items: center; gap: 6px; }
.head-gen-btn { margin-left: auto; height: 26px; padding: 0 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.undo-strip { display: flex; align-items: center; gap: 12px; background: var(--ok-subtle); color: var(--ok); border-radius: 8px; padding: 7px 12px; font-size: 12.5px; margin-bottom: 10px; }
.undo-btn { height: 24px; padding: 0 12px; font-size: 12px; color: var(--ok); border-color: rgba(69, 211, 156, .4); }
.state-row { display: flex; gap: 10px; flex-wrap: wrap; }
.state-card { width: 110px; cursor: pointer; }
.state-card .im { height: 84px; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; display: flex; align-items: center; justify-content: center; background: #10131b; }
.state-card .im .ph-txt { font-size: 11px; color: var(--muted); }
.state-card .cap { font-size: 11.5px; margin-top: 5px; display: flex; align-items: center; gap: 5px; }
.def-badge { font-size: 10px; padding: 0 6px; }
.mini-btn { margin-top: 4px; width: 100%; height: 22px; font-size: 10.5px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
.mini-btn:hover { color: var(--text-2); border-color: var(--line-strong); }
/* 人物音色（Task 3.2 / P0-9） */
.voice-box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.voice-cur { display: flex; flex-direction: column; gap: 6px; }
.voice-name { font-size: 13px; font-weight: 500; }
.voice-audio { width: 100%; height: 32px; }
.voice-acts { display: flex; gap: 8px; }
.upload-pick { display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px dashed var(--line-strong); border-radius: 8px; padding: 14px 12px; font-size: 12.5px; color: var(--muted); cursor: pointer; }
.upload-pick:hover { color: var(--text-2); border-color: var(--line-strong); }
.upload-pick svg { width: 14px; height: 14px; }
.extract-row { display: flex; align-items: center; gap: 8px; }
.usage-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 8px; color: var(--text); text-decoration: none; font-size: 13px; }
.usage-row:hover { border-color: var(--line-strong); }
.usage-row.deleted { opacity: .6; cursor: default; }
.usage-row.deleted:hover { border-color: var(--line); }
.usage-row .go-tip { margin-left: auto; font-size: 11.5px; }
.record-row { border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; margin-bottom: 8px; }
.record-row .prompt-txt { max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; vertical-align: bottom; }
.err-line { background: var(--danger-subtle); color: var(--danger); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
.ok-line { background: var(--ok-subtle); color: var(--ok); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 10px; }
.empty-tip { text-align: center; padding: 32px 0; font-size: 12.5px; }
.ph-big { border: 1px dashed var(--line-strong); border-radius: 10px; padding: 40px 16px; text-align: center; font-size: 12.5px; color: var(--muted); margin-bottom: 12px; }
.danger-zone { border: 1px solid rgba(255, 107, 120, .35); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
/* 批量选择与批量生成（Task 3.3 / P0-10） */
.pick-box { position: absolute; top: 8px; left: 8px; z-index: 3; width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid rgba(255,255,255,.8); background: rgba(5,7,12,.55); display: flex; align-items: center; justify-content: center; color: transparent; cursor: pointer; }
.pick-box svg { width: 14px; height: 14px; }
.pick-box.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.acard.picked { border-color: var(--accent); }
.batch-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 20px; z-index: 70; display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px; padding: 10px 14px; box-shadow: var(--shadow); }
.batch-bar .count { font-size: 13px; font-weight: 600; margin-right: 2px; }
.batch-list { display: flex; flex-direction: column; gap: 6px; }
.batch-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; }
.batch-row .idx { width: 20px; height: 20px; border-radius: 6px; background: var(--accent-subtle); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; flex: 0 0 auto; }
.batch-row .nm { font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.batch-prog { background: var(--accent-subtle); color: var(--accent); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; }
.empty-box { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 72px 0; }
</style>
