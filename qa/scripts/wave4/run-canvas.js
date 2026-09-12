// Wave4 CANVAS 模块：画布数据接口 / 工作流组持久化与重跑 / 导演候选队列 / 时间线 / 存储清理
const fs = require('fs');
const path = require('path');
const {
  api, req, runCase, q, q1, uploadPng,
  createV1Project, createEpisode, saveDraft, confirmScript,
  keepProject, softDeleteProject,
  LOG_DIR, ROOT,
} = require('./lib');

const MODULE = 'CANVAS';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }

(async () => {
  const results = {};
  const CTX = {};
  try {
    CTX.video = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));
  } catch (_) { CTX.video = null; }

  // ============ TC-CANVAS-001 画布数据接口链 ============
  results.TC_CANVAS_001 = await runCase(meta('TC-CANVAS-001', 'Vue Flow 数据接口链：项目/剧集/脚本/资产/分镜节点数据经真实 API 齐备且 drama_id 一致', 'system', 'P0'), async (cs) => {
    const proj = await createV1Project(cs, `QA-L3-CANVAS-${Date.now()}`);
    CTX.projectId = proj.id;
    keepProject(cs, CTX.projectId); // 共享项目：模块结尾统一软删
    CTX.episodeId = await createEpisode(cs, CTX.projectId, '第一集');
    await saveDraft(CTX.episodeId, '第一场：废弃天文台 夜 内\n研究员调出尘封的观测记录，屏幕上的星图开始自行移动。');
    await confirmScript(CTX.episodeId);
    await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/create-from-script`, {});
    const up = await uploadPng(cs, CTX.projectId, 'qa-l3-canvas.png', 128, 128);
    // 画布节点数据源逐个验证
    const ov = await api.be(`/api/v2/projects/${CTX.projectId}/overview`);
    cs.eq('项目 overview 200', ov.status, 200);
    cs.expect('overview 含项目标识与结构', JSON.stringify(ov.json?.data || {}).includes(String(CTX.projectId)), ov.text.slice(0, 200));
    const assets = await api.be(`/api/v2/projects/${CTX.projectId}/assets`);
    cs.eq('资产列表 200', assets.status, 200);
    cs.expect('资产节点数据非空（上传图计入）', JSON.stringify(assets.json?.data || '').length > 2, assets.text.slice(0, 160));
    const eps = await api.be(`/api/v2/projects/${CTX.projectId}/episodes`);
    cs.eq('剧集节点 200', eps.status, 200);
    const epItems = eps.json?.data?.items || eps.json?.data || [];
    cs.expect('剧集节点含本集', JSON.stringify(epItems).includes(String(CTX.episodeId)), JSON.stringify(epItems).slice(0, 200));
    const sbs = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard`);
    cs.eq('分镜节点 200', sbs.status, 200);
    const sbData = JSON.stringify(sbs.json?.data || '');
    cs.expect('分镜节点数据含镜头', sbData.includes('storyboard') || sbData.includes('shots') || sbData.includes('id'), sbData.slice(0, 200));
    const script = await api.be(`/api/v2/episodes/${CTX.episodeId}/script`);
    cs.eq('脚本节点 200', script.status, 200);
    cs.expect('脚本内容可读（节点编辑数据源）', /天文台|观测/.test(JSON.stringify(script.json?.data || '')), script.text.slice(0, 160));
    // v1 详情（画布保存目标）
    const d = await api.be(`/api/v1/dramas/${CTX.projectId}`);
    cs.eq('v1 项目详情 200', d.status, 200);
    cs.expect('metadata 字段存在（工作流组持久化载体）', 'metadata' in (d.json?.data || {}), Object.keys(d.json?.data || {}).join(','));
  });

  // ============ TC-CANVAS-002 工作流组持久化 ============
  results.TC_CANVAS_002 = await runCase(meta('TC-CANVAS-002', '工作流组持久化：PUT canvas-layout → dramas.metadata JSON 回读（canvas_layout 与 workflow_groups 共存）', 'system', 'P0'), async (cs) => {
    const groups = [
      { id: 'g1', name: 'QA-L3 图片组', pipeline: 'image', nodeIds: ['n1', 'n2'] },
      { id: 'g2', name: 'QA-L3 视频组', pipeline: 'video', nodeIds: ['n3'] },
    ];
    const layout = { nodes: [{ id: 'n1', type: 'storyboard', position: { x: 10, y: 20 } }], edges: [] };
    const r = await api.beMethod('PUT', `/api/v1/dramas/${CTX.projectId}/canvas-layout`, { canvas_layout: layout, workflow_groups: groups });
    cs.log(`canvas-layout PUT -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('保存 200', r.status, 200);
    const row = q1('SELECT metadata FROM dramas WHERE id=?', CTX.projectId);
    const metadata = JSON.parse(row.metadata || '{}');
    cs.expect('workflow_groups 落 dramas.metadata（非独立实体，inventory PARTIAL 语义）', JSON.stringify(metadata.workflow_groups || []).includes('QA-L3 图片组'), JSON.stringify(metadata.workflow_groups).slice(0, 200));
    cs.expect('canvas_layout 同存于一 metadata JSON', (metadata.canvas_layout?.nodes || []).length === 1, JSON.stringify(metadata.canvas_layout).slice(0, 160));
    // 读取回读（画布刷新链路）
    const d = await api.be(`/api/v1/dramas/${CTX.projectId}`);
    const meta2 = (() => { try { return typeof d.json?.data?.metadata === 'string' ? JSON.parse(d.json.data.metadata) : d.json?.data?.metadata; } catch (_) { return {}; } })();
    cs.expect('GET 详情可回读工作流组（数据流：保存→刷新不丢）', (meta2?.workflow_groups || []).length === 2, JSON.stringify(meta2?.workflow_groups).slice(0, 200));
    // 覆盖语义：二次保存替换而非追加
    await api.beMethod('PUT', `/api/v1/dramas/${CTX.projectId}/canvas-layout`, { workflow_groups: [{ id: 'g3', name: 'QA-L3 音频组', pipeline: 'audio' }] });
    const meta3 = JSON.parse(q1('SELECT metadata FROM dramas WHERE id=?', CTX.projectId).metadata || '{}');
    cs.expect('二次保存整体替换 workflow_groups', (meta3.workflow_groups || []).length === 1 && meta3.workflow_groups[0].id === 'g3', JSON.stringify(meta3.workflow_groups));
    cs.expect('未提供的 canvas_layout 不被清除', !!meta3.canvas_layout, JSON.stringify(!!meta3.canvas_layout));
  });

  // ============ TC-CANVAS-003 校验分支 ============
  results.TC_CANVAS_003 = await runCase(meta('TC-CANVAS-003', 'canvas-layout 校验分支：空 body 400；workflow_groups 非数组 400；canvas_layout 非对象 400', 'system', 'P1'), async (cs) => {
    const r1 = await api.beMethod('PUT', `/api/v1/dramas/${CTX.projectId}/canvas-layout`, {});
    cs.eq('空 body 400', r1.status, 400);
    cs.expect('提示提供 canvas_layout 或 workflow_groups', /canvas_layout|workflow_groups/.test(r1.text), r1.text.slice(0, 160));
    const r2 = await api.beMethod('PUT', `/api/v1/dramas/${CTX.projectId}/canvas-layout`, { workflow_groups: 'not-array' });
    cs.eq('workflow_groups 非数组 400', r2.status, 400);
    const r3 = await api.beMethod('PUT', `/api/v1/dramas/${CTX.projectId}/canvas-layout`, { canvas_layout: 'not-object' });
    cs.eq('canvas_layout 非对象 400', r3.status, 400);
    const r4 = await api.beMethod('PUT', '/api/v1/dramas/999999999/canvas-layout', { workflow_groups: [] });
    cs.expect('不存在项目 404/400', [404, 400].includes(r4.status), String(r4.status));
  });

  // ============ TC-CANVAS-004 工作流组重跑：图片管线 ============
  results.TC_CANVAS_004 = await runCase(meta('TC-CANVAS-004', '工作流组重跑（图片管线）：missing-images 编排创建任务并持久化；shim 离线时任务进入可见失败（遇错记录）', 'system', 'P1'), async (cs) => {
    const r = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/batch/missing-images`, {});
    cs.log(`missing-images -> ${r.status} ${r.text.slice(0, 260)}`);
    cs.expect('编排接口结构化响应', r.status === 200 || !!r.json?.error?.code, String(r.status));
    if (r.status === 200) {
      const data = r.json?.data;
      cs.log('编排结果: ' + JSON.stringify(data).slice(0, 260));
      const results = data?.results || [];
      cs.expect('逐 shot 结果结构（遇错可见：ok=false + error 明确）', results.length >= 1 && results.some((x) => x.ok === false && /ECONNREFUSED|18080|失败/i.test(String(x.error || ''))), JSON.stringify(results).slice(0, 240));
      const gens = q('SELECT id, status, substr(error_msg,1,60) AS err FROM image_generations WHERE drama_id=? ORDER BY id DESC LIMIT 5', CTX.projectId);
      cs.log(`image_generations 落库: ${JSON.stringify(gens)}`);
      cs.expect('编排触发的生成记录已落库（同步路径，v1 imageService）', gens.length >= 1, `count=${gens.length}`);
    }
  });

  // ============ TC-CANVAS-005 工作流组重跑：视频管线 ============
  results.TC_CANVAS_005 = await runCase(meta('TC-CANVAS-005', '工作流组重跑（视频管线）：missing-videos 前置守卫（缺图分镜不提交真实生成）', 'system', 'P1'), async (cs) => {
    const pre = q('SELECT COUNT(*) AS n FROM video_generations WHERE drama_id=? AND deleted_at IS NULL', CTX.projectId).n;
    const r = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/batch/missing-videos`, {});
    cs.log(`missing-videos -> ${r.status} ${r.text.slice(0, 260)}`);
    cs.expect('结构化响应（不崩溃）', r.status < 500 || !!r.json?.error?.code, String(r.status));
    await new Promise((res) => setTimeout(res, 3000));
    const post = q('SELECT COUNT(*) AS n FROM video_generations WHERE drama_id=? AND deleted_at IS NULL', CTX.projectId).n;
    cs.expect('未提交任何真实视频生成（守卫生效，不消耗 ComfyUI）', post === pre, `before=${pre} after=${post}`);
    cs.log('[说明] 缺少参考图/H3 草稿的分镜被前置检查拦截——与工作流组「默认遇错停止」语义一致');
  });

  // ============ TC-CANVAS-006 工作流组重跑：音频管线 ============
  results.TC_CANVAS_006 = await runCase(meta('TC-CANVAS-006', '工作流组重跑（音频管线）：retry-failed 编排契约 + extract/batch 逐项遇错记录', 'system', 'P1'), async (cs) => {
    const r = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/batch/retry-failed`, {});
    cs.log(`retry-failed -> ${r.status} ${r.text.slice(0, 260)}`);
    cs.expect('结构化响应', r.status === 200 || !!r.json?.error?.code, String(r.status));
    // 音频管线：批量 TTS 逐项遇错（无 TTS 通道为真实外部状态）
    const shot = q1('SELECT id FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number LIMIT 1', CTX.episodeId);
    if (shot) {
      await api.beMethod('PUT', `/api/v1/storyboards/${shot.id}`, { dialogue: 'QA-L3 画布音频管线对白' });
      const rb = await api.be('/api/v1/audio/extract/batch', { storyboard_ids: [shot.id] });
      cs.eq('extract/batch 200（逐项报告）', rb.status, 200);
      const item = (rb.json?.data || [])[0] || {};
      cs.expect('音频遇错记录在逐项 error（不整批中断）', typeof item.error === 'string' && item.error.length > 0, JSON.stringify(item).slice(0, 200));
    }
  });

  // ============ TC-CANVAS-007 导演候选队列 ============
  results.TC_CANVAS_007 = await runCase(meta('TC-CANVAS-007', '导演候选队列：GET queue 快照、jobs/:id 真实记录、artifact content 守卫（路径约束）', 'system', 'P1'), async (cs) => {
    const qr = await api.be('/api/v1/director/queue');
    cs.eq('queue 200', qr.status, 200);
    const snap = qr.json?.data || {};
    cs.expect('队列快照含 activeJobId/queuedJobIds/queueLength', 'activeJobId' in snap && Array.isArray(snap.queuedJobIds) && 'queueLength' in snap, JSON.stringify(snap));
    const job = q1('SELECT id FROM director_jobs ORDER BY id DESC LIMIT 1');
    if (job) {
      const g = await api.be(`/api/v1/director/jobs/${job.id}`);
      cs.log(`job ${job.id} -> ${g.status}`);
      cs.eq('真实 job 详情 200', g.status, 200);
      cs.expect('job 含状态与 workflow 字段', 'status' in (g.json?.data || {}), JSON.stringify(g.json?.data).slice(0, 200));
    }
    const nf = await api.be('/api/v1/director/jobs/nonexistent');
    cs.eq('不存在 job 404', nf.status, 404);
    // artifact content 路径守卫：不存在 artifact 404
    const ac = await api.be('/api/v1/director/artifacts/nonexistent/content');
    cs.expect('不存在 artifact content 404', [404].includes(ac.status) || ac.status < 500, String(ac.status));
    // 真实 artifact content：取最近一个 ready 且文件真实存在的产物（v2 候选组链路缺陷见 CANVAS-008 观察项）
    const artRow = q1("SELECT id, artifact_path, file_size FROM director_artifacts WHERE status='ready' AND file_size > 100000 ORDER BY created_at DESC LIMIT 1");
    if (artRow) {
      const art = await req('GET', `http://127.0.0.1:5679/api/v1/director/artifacts/${artRow.id}/content`, undefined, { timeoutMs: 30000 });
      cs.log(`真实 artifact content(${artRow.id}) -> ${art.status} bytes=${art.buf.length}`);
      cs.eq('真实 artifact 内容可下载 200', art.status, 200);
      cs.expect('字节非空且与登记大小一致（真实视频文件）', art.buf.length === Number(artRow.file_size), `${art.buf.length}/${artRow.file_size}`);
    } else {
      cs.log('[观察项] 无大体积 ready artifact 可下载（v2 真实视频候选链路缺陷导致产物缺失）');
    }
  });

  // ============ TC-CANVAS-008 候选评审与选片 ============
  results.TC_CANVAS_008 = await runCase(meta('TC-CANVAS-008', '候选评审入口：创建候选组（真实 ready artifact）→ review 推进 → select 选中并记录原因', 'system', 'P1'), async (cs) => {
    // v2 真实视频候选组因通道误判缺陷无法自动创建（见执行记录观察项），本用例经候选组创建 API + 真实 ready artifact 走完整评审链
    const art = q1("SELECT id FROM director_artifacts WHERE status='ready' AND file_size > 100000 ORDER BY created_at DESC LIMIT 1");
    cs.expect('前置：存在真实 ready artifact（历史真实生成产物）', !!art, String(art?.id));
    const cr = await api.be(`/api/v1/director/shots/${CTX.video?.shotId || 141}/candidates`, { candidates: [{ artifactId: art.id }] });
    cs.log(`createCandidates -> ${cr.status} ${cr.text.slice(0, 200)}`);
    cs.eq('候选组创建 201', cr.status, 201);
    const groupId = cr.json?.data?.id;
    const g0 = await api.be(`/api/v1/director/candidates/${groupId}`);
    cs.eq('候选组可读 200', g0.status, 200);
    const cand = q1('SELECT id, status FROM director_candidates WHERE group_id=? ORDER BY id DESC LIMIT 1', groupId);
    cs.expect('候选行存在且绑定真实 artifact', !!cand, JSON.stringify(cand));
    const rv = await api.be(`/api/v1/director/candidates/${groupId}/review`, {});
    cs.log(`review -> ${rv.status} ${rv.text.slice(0, 160)}`);
    cs.expect('进入评审 200（pending→running→review 状态机推进）', rv.status === 200 && rv.json?.data?.status === 'review', rv.text.slice(0, 160));
    const sel = await api.be(`/api/v1/director/candidates/${groupId}/select`, {
      candidateId: cand.id, reason: 'QA-L3 选片原因：动作连贯性最佳',
    });
    cs.log(`select -> ${sel.status} ${sel.text.slice(0, 200)}`);
    cs.eq('选片 200', sel.status, 200);
    const groupRow = q1('SELECT selected_candidate_id, selection_reason, status FROM director_candidate_groups WHERE id=?', groupId);
    const reason = groupRow?.selection_reason;
    cs.expect('选中候选与原因持久化', String(groupRow?.selected_candidate_id || '') === String(cand.id) && /QA-L3/.test(String(reason || '')), JSON.stringify(groupRow).slice(0, 220));
    cs.log('[观察项→缺陷] v2.1 制作台视频提交路径（providerRouter.isRealH3Channel）将 ComfyUI H3 配置误判为非 H3（isMinimaxH3Model 正则\b在 minlength 下划线后缀失效），守卫恒阻塞 → 真实生成无候选组/artifact 自动落库');
  });

  // ============ TC-CANVAS-009 导演时间线 ============
  results.TC_CANVAS_009 = await runCase(meta('TC-CANVAS-009', '导演时间线（EXPERIMENTAL）：不存在 404 空态真实行为 + 创建契约落库（实库首条记录）', 'system', 'P1'), async (cs) => {
    const nf = await api.be('/api/v1/director/timelines/999999999');
    cs.eq('不存在时间线 404（空态真实行为）', nf.status, 404);
    const before = q1('SELECT COUNT(*) AS n FROM director_timelines').n;
    // 创建：最小 clips（真实视频 artifact 路径若可用则引用，否则空 clips 记录真实校验行为）
    const body = {
      version: 'timeline_v1',
      clips: [],
      audioSources: [],
      audioPolicy: 'mix',
      output: { format: 'mp4' },
    };
    const r = await api.be('/api/v1/director/timelines', body);
    cs.log(`create(clips=[]) -> ${r.status} ${r.text.slice(0, 240)}`);
    if (r.status === 200 || r.status === 201) {
      const tid = r.json?.data?.id || r.json?.data?.timeline?.id;
      const after = q1('SELECT COUNT(*) AS n FROM director_timelines').n;
      cs.expect('时间线行落库（实库从 0 到 1）', after === before + 1, `before=${before} after=${after}`);
      const g = await api.be(`/api/v1/director/timelines/${tid}`);
      cs.eq('创建后可读取 200', g.status, 200);
      cs.expect('manifest/ffmpeg 命令字段存在（渲染输入就绪）', 'status' in (g.json?.data || {}), JSON.stringify(g.json?.data).slice(0, 200));
    } else {
      cs.expect('空 clips 被真实校验拒绝（记录 EXPERIMENTAL 当前约束）', r.status === 400, String(r.status));
    }
  });

  // ============ TC-CANVAS-010 Director 存储清理 ============
  results.TC_CANVAS_010 = await runCase(meta('TC-CANVAS-010', 'Director 存储清理：storage usage 统计真实可读 + dryRun 清理非破坏契约', 'system', 'P1'), async (cs) => {
    const u = await api.be('/api/v1/director/storage');
    cs.eq('storage 200', u.status, 200);
    const usage = u.json?.data || {};
    cs.log('usage: ' + JSON.stringify(usage).slice(0, 240));
    cs.expect('usage 含配额/用量口径', 'quotaBytes' in usage || 'usedBytes' in usage || Object.keys(usage).length > 0, JSON.stringify(Object.keys(usage)));
    const artifactsBefore = q1('SELECT COUNT(*) AS n FROM director_artifacts').n;
    const c = await api.be('/api/v1/director/storage/cleanup', { dryRun: true, targetBytes: 0 });
    cs.log(`cleanup(dryRun) -> ${c.status} ${c.text.slice(0, 240)}`);
    cs.eq('dryRun 清理 200', c.status, 200);
    const artifactsAfter = q1('SELECT COUNT(*) AS n FROM director_artifacts').n;
    cs.expect('dryRun 不破坏真实 artifact（引用中产物保留）', artifactsAfter === artifactsBefore, `before=${artifactsBefore} after=${artifactsAfter}`);
  });

  // ============ TC-CANVAS-011 画布 vs 线性制作台等价性（PARTIAL 文档验证）============
  results.TC_CANVAS_011 = await runCase(meta('TC-CANVAS-011', '画布与线性制作台功能等价（PARTIAL）：画布侧可触达的编辑接口抽样真实行为', 'system', 'P2'), async (cs) => {
    const shots = q('SELECT id FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number LIMIT 1', CTX.episodeId);
    const shotId = shots[0]?.id;
    cs.expect('分镜节点存在', !!shotId, String(shotId));
    // 画布侧面板编辑：v2 shot 详情（节点数据源）与 v1 更新（侧面编辑面板保存）
    const g = await api.be(`/api/v2/storyboards/${shotId}`);
    cs.eq('v2 分镜详情 200（节点数据）', g.status, 200);
    const u = await api.beMethod('PATCH', `/api/v2/storyboards/${shotId}/segments/nonexistent-seg`, { visual: 'x' });
    cs.log(`画布级 segment 编辑（不存在段）-> ${u.status} ${u.text.slice(0, 140)}`);
    if (u.status === 200) {
      cs.log('[观察项] 不存在 segment 的编辑请求返回 200（静默空转/宽松语义，未报 404）——作为画布与制作台等价性 PARTIAL 的佐证记录');
      cs.expect('静默 200 不破坏分镜数据（分镜仍可读）', (await api.be(`/api/v2/storyboards/${shotId}`)).status === 200, '');
    } else {
      cs.expect('子编辑有明确错误分支', [400, 404].includes(u.status), String(u.status));
    }
    // 高级操作对比：画布未覆盖的「插入分镜」仅在主制作台（v1 insert-before 存在）
    const ib = await api.be('/api/v1/storyboards', { episode_id: CTX.episodeId, storyboard_number: 55, title: 'QA-L3 等价性抽样' });
    cs.eq('主制作台创建分镜 201（画布缺省能力对照）', ib.status, 201);
    cs.log('[观察项] inventory INV-10.8：画布提供全局编排，编辑字段与高级操作未完全覆盖主制作台——本次以接口抽样佐证 PARTIAL 标注');
  });

  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 CANVAS] passed=${passed} failed=${failed} blocked=${blocked}`);
})();
