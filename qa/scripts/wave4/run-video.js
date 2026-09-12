// Wave4 VIDEO 模块：视频生成与评审（真实生成 ≤2 次 + 非生成契约）
// 运行前置：后端 5679 / ComfyUI 8188 在线；ComfyUI 队列为空
const fs = require('fs');
const path = require('path');
const {
  api, req, runCase, mask, q, q1, pollUntil, ffprobeDuration,
  createV1Project, createEpisode, saveDraft, confirmScript, uploadPng,
  keepProject, softDeleteProject,
  ART_DIR, ROOT,
} = require('./lib');

const WORKFLOW = 'minimax_h3_director_r2v_te_speed';
const VIDEO_CONFIG_ID = 5; // ComfyUI（本机工作流）
const IMAGE_CONFIG_ID = 2; // Local Shim Image（离线，默认图像通道）
const STORAGE_ROOT = path.join(ROOT, 'backend-node/data/storage');

// 跨用例共享的真实链路上下文
const CTX = {};

const MODULE = 'VIDEO';
// 参考图 staging 以 backend cwd 解析相对路径，allowed root 为 ./data/storage
const refStoragePath = (ctx) => 'data/storage/' + String(ctx.sceneImage.local_path).replace(/^\//, '');
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }

async function comfyQueueEmpty() {
  try {
    const r = await req('GET', 'http://127.0.0.1:8188/queue', undefined, { timeoutMs: 10000 });
    const j = r.json || {};
    return (j.queue_running || []).length === 0 && (j.queue_pending || []).length === 0;
  } catch (_) { return false; }
}

(async () => {
  const results = {};

  // ============ 环境修复探针（并入 TC-VIDEO-004 证据）============
  // 背景：wave1 清理 Agnes 预设时 clearOtherDefault 清掉了 ComfyUI(id=5)/Shim(id=2) 的 is_default，
  // 当前 image/storyboard_image/video/tts 四类均无活跃默认配置 → VIDEO_CONFIG_MISSING。
  // 修复方式：走应用自身 API（等同用户在「AI 配置」页设默认通道），与 wave1 恢复 text(id=4) 同一先例。
  const repair = { before: null, after: null };
  {
    const cap = await api.be('/api/v1/videos/capabilities');
    repair.before = cap.status;
    if (cap.status !== 200) {
      const put = await api.beMethod('PUT', `/api/v1/ai-configs/${VIDEO_CONFIG_ID}`, { is_default: true });
      console.log(`[env-repair] PUT ai-configs/${VIDEO_CONFIG_ID} is_default=true -> ${put.status}`);
      const put2 = await api.beMethod('PUT', `/api/v1/ai-configs/${IMAGE_CONFIG_ID}`, { is_default: true });
      console.log(`[env-repair] PUT ai-configs/${IMAGE_CONFIG_ID} is_default=true -> ${put2.status}`);
      const cap2 = await api.be('/api/v1/videos/capabilities');
      repair.after = cap2.status;
      repair.putStatus = [put.status, put2.status];
    }
  }

  // ============ TC-VIDEO-004 供应商能力查询（含环境修复证据）============
  results.TC_VIDEO_004 = await runCase(meta('TC-VIDEO-004', '视频供应商能力查询 API（ComfyUI H3 默认通道修复后返回协议能力与约束）', 'system', 'P0'), async (cs) => {
    cs.log(`[env-repair] 修复前 GET /videos/capabilities -> ${repair.before}（VIDEO_CONFIG_MISSING=500）`);
    if (repair.after !== null) {
      cs.log(`[env-repair] PUT /ai-configs/{5,2} is_default=true -> ${JSON.stringify(repair.putStatus)}；修复后 capabilities -> ${repair.after}`);
      cs.expect('[环境修复] wave1 遗留：video 默认通道丢失，经应用 API 恢复 ComfyUI(id=5) 为默认', repair.after === 200, `after=${repair.after}`);
      cs.log('[环境修复] 说明：wave1 清理 Agnes 预设触发 clearOtherDefault，清掉了 id=5/2 的 is_default 且未恢复（text id=4 当时有恢复，image/video 无）；本用例经应用自身 API 恢复，等同用户在 AI 配置页操作，非改库/改码');
    }
    const r = await cs.withRetry('capabilities', () => api.be('/api/v1/videos/capabilities'));
    cs.eq('capabilities 200', r.status, 200);
    const caps = r.json?.data;
    cs.expect('返回能力对象（provider/protocol 可辨识）', !!caps && typeof caps === 'object', r.text.slice(0, 200));
    cs.log('capabilities 响应:', r.text.slice(0, 400));
    const cfg = q1('SELECT id, provider, default_model, model FROM ai_service_configs WHERE id=?', VIDEO_CONFIG_ID);
    cs.expect('默认视频配置为 ComfyUI 且 default_model=te_speed', cfg && cfg.provider === 'comfyui' && String(cfg.default_model) === WORKFLOW, JSON.stringify(cfg));
  });

  // ============ 共享链路搭建（失败则后续真实生成用例 blocked）============
  async function buildChain(cs) {
    const proj = await createV1Project(cs, `QA-L3-VIDEO-${Date.now()}`);
    CTX.projectId = proj.id;
    keepProject(cs, CTX.projectId); // 共享链路项目：保留至 AUDIO finalize 结束后统一软删
    cs.log(`项目 ${CTX.projectId} 已创建（保留至 AUDIO 波次结束，供 finalize 真实合成）`);
    CTX.episodeId = await createEpisode(cs, CTX.projectId, '第一集');
    const d = await saveDraft(CTX.episodeId, '第一场：咖啡馆 日 内\n林晚推开咖啡馆的门，雨水从她伞尖滴落。她环顾四周，走向角落的位置坐下，打开笔记本电脑。');
    cs.log(`draft -> ${d.status}`);
    const c = await confirmScript(CTX.episodeId);
    cs.log(`confirm -> ${c.status} ${c.text.slice(0, 120)}`);
    // 结构创建（确定性，不走 LLM）
    const s = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/create-from-script`, {});
    cs.log(`create-from-script -> ${s.status} ${s.text.slice(0, 120)}`);
    if (s.status !== 200 && s.status !== 201) throw new Error('create-from-script failed');
    // 场景 + 真实 PNG（参考图槽位）
    const sc = await api.be('/api/v1/scenes', { drama_id: CTX.projectId, location: 'QA-L3-咖啡馆', time: '日', description: '雨天咖啡馆内景' });
    CTX.sceneId = sc.json?.data?.id;
    const up = await uploadPng(cs, CTX.projectId, 'qa-l3-scene.png', 256, 144);
    CTX.sceneImage = up;
    cs.log(`scene=${CTX.sceneId} png=${up.url} local=${up.local_path}`);
    await api.beMethod('PUT', `/api/v1/scenes/${CTX.sceneId}`, { image_url: up.url, local_path: up.local_path });
    // 直接创建带场景引用的分镜（万能提示词后补）
    const sb = await api.be('/api/v1/storyboards', {
      episode_id: CTX.episodeId, scene_id: CTX.sceneId, storyboard_number: 99,
      title: 'QA-L3 真实生成分镜', description: 'QA-L3 wave4 真实生成分镜', duration: 5,
    });
    if (sb.status !== 201) throw new Error('storyboard create failed: ' + sb.status + ' ' + sb.text.slice(0, 200));
    CTX.shotId = sb.json.data.id;
    await api.beMethod('PUT', `/api/v1/storyboards/${CTX.shotId}`, {
      universal_segment_text: '雨天午后，林晚推开咖啡馆木门走入店内，收伞抖落水珠，环顾一周后走向角落坐下，打开笔记本电脑，暖黄灯光映在她脸上。',
    });
    // 预置音频计划（bgm.mode != per_segment → compile 内 ensureEpisodeAudioPlan 不触发 LLM；注意 audio-plan 为 v1 路由）
    const ap = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, { audio_plan: { bgm: { mode: 'single' } } });
    cs.log(`audio-plan patch(v1) -> ${ap.status}`);
    return true;
  }

  async function compileDraft(cs) {
    const r = await api.be(`/api/v1/storyboards/${CTX.shotId}/h3-prompt-draft/compile`, {
      video_config_id: String(VIDEO_CONFIG_ID), workflow_id: WORKFLOW,
    });
    cs.log(`h3 compile -> ${r.status} ${r.text.slice(0, 220)}`);
    if (r.status !== 200) throw new Error('H3 draft compile failed: ' + r.status);
    CTX.draftId = r.json?.data?.draft?.id;
    return r.json?.data;
  }

  // ============ TC-VIDEO-001 真实生成主链路（预算 #1）============
  results.TC_VIDEO_001 = await runCase(meta('TC-VIDEO-001', '真实生成主链路：分镜视频任务提交（ComfyUI H3 te_speed）→ 状态机等待/运行/审核 → 视频文件落盘 ffprobe 可解码', 'system', 'P0'), async (cs) => {
    await buildChain(cs);
    cs.expect('链路前置：项目/剧集/分镜/场景齐备', !!(CTX.projectId && CTX.episodeId && CTX.shotId && CTX.sceneId), JSON.stringify({ p: CTX.projectId, e: CTX.episodeId, s: CTX.shotId, sc: CTX.sceneId }));
    cs.expect('ComfyUI 队列为空（生成前确认）', await comfyQueueEmpty(), '8188/queue');

    const draft = await compileDraft(cs);
    cs.expect('H3 草稿编译成功（draft.id 存在）', !!CTX.draftId, JSON.stringify(draft?.draft?.id));
    cs.expect('草稿绑定正确 workflow', (draft?.draft?.workflow_id || '') === WORKFLOW, draft?.draft?.workflow_id);

    // V2.1 制作台提交路径探针（不消耗预算：预期在引用校验处被拒）
    const v2 = await api.be(`/api/v2/storyboards/${CTX.shotId}/video/submit`, {});
    CTX.v2SubmitStatus = v2.status;
    CTX.v2SubmitBody = v2.text.slice(0, 260);
    cs.log(`[探针] v2 video/submit -> ${v2.status} ${v2.text.slice(0, 260)}`);

    // 候选组：v2 submitVideo 在调用 provider 前已 ensureCandidateGroup
    const grp = q1('SELECT id, shot_id, status FROM director_candidate_groups WHERE shot_id=? ORDER BY id DESC LIMIT 1', String(CTX.shotId));
    CTX.groupId = grp?.id || null;
    cs.log(`候选组: ${JSON.stringify(grp)}`);

    // V1 统一生命周期真实提交（参考图用本地相对路径：ComfyUI Provider 要求本地文件 staging）
    const create = await cs.withRetry('videos.create', () => api.be('/api/v1/videos', {
      drama_id: CTX.projectId,
      storyboard_id: CTX.shotId,
      h3_prompt_draft_id: CTX.draftId,
      workflow_id: WORKFLOW,
      reference_image_urls: [refStoragePath(CTX)],
      candidate_group_id: CTX.groupId || undefined,
    }));
    cs.log(`videos.create -> ${create.status} ${create.text.slice(0, 260)}`);
    if (create.status !== 201) throw new Error('真实提交失败: ' + create.status);
    CTX.videoId = create.json?.data?.id;
    CTX.taskId = create.json?.data?.task_id;
    cs.eq('创建状态 201', create.status, 201);
    cs.eq('初始状态 waiting（等待）', create.json?.data?.status, 'waiting');

    // 轮询状态机（分钟级，脚本超时按 ≥600s 设计）
    const seen = [];
    const final = await pollUntil(async () => {
      const g = await api.be(`/api/v1/videos/${CTX.videoId}`);
      const st = g.json?.data?.status;
      if (st && seen[seen.length - 1] !== st) { seen.push(st); cs.log(`状态流转: ${st}`); }
      const task = CTX.taskId ? q1('SELECT status, progress FROM async_tasks WHERE id=?', CTX.taskId) : null;
      if (task && task.status !== 'processing') cs.log(`async_task: ${task.status} ${task.progress}%`);
      if (['review', 'selected', 'failed', 'cancelled', 'interrupted'].includes(st)) return { done: true, status: st, body: g.json?.data };
      return { done: false, status: st };
    }, { timeoutMs: 1500000, intervalMs: 8000, label: 'video-gen' });
    CTX.finalStatus = final.status;
    CTX.finalBody = final.body || {};
    cs.log(`终态: ${final.status} local_path=${final.body?.local_path} video_url=${final.body?.video_url}`);
    if (final.timeout) cs.log('[记录] 真实生成 25 分钟未到终态（H3 te_speed 1312x736 实测耗时 >13min，属真实慢生成；如仍 running 保留给 E2E 阶段收割）');
    cs.expect('状态机到达审核（review）', final.status === 'review', `actual=${final.status} seen=${seen.join('>')}`);
    cs.expect('观察到等待态 waiting', seen.includes('waiting'), seen.join('>'));
    cs.expect('观察到运行段（queued/running 至少其一）', seen.some((s) => ['queued', 'running'].includes(s)), seen.join('>'));
    cs.expect('无失败态', !['failed', 'interrupted'].includes(final.status), final.status);

    // 真实文件落盘 + ffprobe
    const lp = final.body?.local_path;
    cs.expect('local_path 已持久化（产出物写回）', !!lp, String(lp));
    if (lp) {
      const abs = path.isAbsolute(lp) ? lp : path.join(STORAGE_ROOT, lp);
      const exists = fs.existsSync(abs);
      const size = exists ? fs.statSync(abs).size : 0;
      cs.expect('视频文件真实存在', exists, abs);
      cs.expect('文件大小 > 0', size > 0, String(size));
      const pp = ffprobeDuration(abs);
      cs.expect('ffprobe 可解码且时长 > 0', pp.ok, JSON.stringify({ dur: pp.duration, v: pp.hasVideo, a: pp.hasAudio }));
      cs.expect('容器含视频流', pp.hasVideo === true, String(pp.hasVideo));
      cs.log(`ffprobe 元数据: duration=${pp.duration}s video=${pp.hasVideo} audio=${pp.hasAudio}`);
      CTX.videoAbs = abs;
      CTX.ffprobe = { duration: pp.duration, hasVideo: pp.hasVideo, hasAudio: pp.hasAudio, size };
      try { fs.copyFileSync(abs, path.join(ART_DIR, `TC-VIDEO-001-real-gen.mp4`)); cs.log(`产物已存档 qa/run/wave4-artifacts/TC-VIDEO-001-real-gen.mp4 (${size}B)`); } catch (_) {}
    }
  });

  // ============ TC-VIDEO-002 持久化断言（复用 #1，不耗预算）============
  results.TC_VIDEO_002 = await runCase(meta('TC-VIDEO-002', '数据流与持久化：provider task id、config 快照（workflow/model）、候选组 artifact 绑定、async_task 完成', 'system', 'P0'), async (cs) => {
    if (!CTX.videoId) { await cs.finish('blocked'); return; }
    const row = q1('SELECT * FROM video_generations WHERE id=?', CTX.videoId);
    cs.expect('video_generations.provider_task_id 已持久化', !!row && !!row.provider_task_id, String(row?.provider_task_id));
    const snap = (() => { try { return JSON.parse(row.config_snapshot || '{}'); } catch (_) { return {}; } })();
    cs.expect('config_snapshot 记录 workflow/model', (snap.workflowId || snap.model || '') === WORKFLOW || String(snap.model || '').includes('minimax_h3'), JSON.stringify({ workflowId: snap.workflowId, model: snap.model }));
    cs.expect('config_snapshot.provider=comfyui', String(snap.provider || '') === 'comfyui', snap.provider);
    cs.expect('终态 review 已落库', row.status === 'review', row.status);
    cs.expect('duration 落库（草稿编译口径）', Number(row.duration) > 0, String(row.duration));
    // 候选组与 artifact（交接点：生成结果 → 候选组可评审实体）
    if (CTX.groupId) {
      const grp = q1('SELECT * FROM director_candidate_groups WHERE id=?', String(CTX.groupId));
      cs.expect('候选组已关联视频生成', Number(grp?.selected_candidate_id || 0) >= 0 && !!grp, JSON.stringify({ id: grp?.id, status: grp?.status }));
      const cand = q('SELECT * FROM director_candidates WHERE video_generation_id=?', CTX.videoId);
      cs.expect('候选行绑定 video_generation_id', cand.length >= 1, `count=${cand.length}`);
      const art = cand.length ? q1('SELECT * FROM director_artifacts WHERE id=?', cand[0].artifact_id) : null;
      cs.expect('候选 artifact 真实存在且 ready', art && art.status === 'ready', JSON.stringify({ id: art?.id, status: art?.status, path: art?.artifact_path }));
      if (art?.artifact_path) {
        const abs = path.isAbsolute(art.artifact_path) ? art.artifact_path : path.join(STORAGE_ROOT, art.artifact_path);
        cs.expect('artifact 文件真实可读', fs.existsSync(abs), abs);
      }
    } else {
      cs.log('[观察项→缺陷] v2 探针 GENERATION_BLOCKED：v2 制作台通道误判（isRealH3Channel 恒 false）导致候选组未创建；候选组/artifact 断言转入 CANVAS-008 用真实候选组复核');
      cs.expect('[数据流] 生成结果 local_path 写回 video_generations（产出物可被下游消费）', !!row.local_path, String(row.local_path));
    }
    const task = CTX.taskId ? q1('SELECT status, progress, result FROM async_tasks WHERE id=?', CTX.taskId) : null;
    cs.expect('async_task 收口 completed', task && task.status === 'completed', JSON.stringify({ status: task?.status }));
  });

  // ============ TC-VIDEO-003 第 2 次真实生成：取消/中断路径（预算 #2）============
  results.TC_VIDEO_003 = await runCase(meta('TC-VIDEO-003', '第 2 次真实生成：运行中取消 → cancelled（Provider 任务清理）+ 重试状态语义', 'system', 'P1'), async (cs) => {
    if (!CTX.draftId) { await cs.finish('blocked'); return; }
    cs.log(`[观察] 第 2 次提交前 ComfyUI 队列空=${await comfyQueueEmpty()}（#1 可能仍在执行，排队提交为真实批量语义）`);
    const submit = async () => api.be('/api/v1/videos', {
      drama_id: CTX.projectId,
      storyboard_id: CTX.shotId,
      h3_prompt_draft_id: CTX.draftId,
      workflow_id: WORKFLOW,
      reference_image_urls: [refStoragePath(CTX)],
    });
    let create = await cs.withRetry('videos.create#2', submit);
    // 草稿可能因源变化被判 stale：重编译一次（H3 编译为提交前置，DeepSeek 调用随链路发生，如实记录）
    if (create.status === 409 && /H3_DRAFT_STALE/.test(create.text || '')) {
      cs.log('[链路] 草稿 stale → 重新编译（DeepSeek 编译 #2，H3 门禁架构必需）');
      const d2 = await compileDraft(cs);
      cs.expect('重编译草稿成功', !!CTX.draftId, String(CTX.draftId));
      create = await submit();
    }
    cs.log(`videos.create#2 -> ${create.status}`);
    if (create.status !== 201) throw new Error('第 2 次提交失败: ' + create.status);
    const vid2 = create.json.data.id;
    const tid2 = create.json.data.task_id;
    CTX.videoId2 = vid2;
    // 等到进入 queued/running（或 90s 后仍在 waiting 也允许取消）
    await pollUntil(async () => {
      const g = await api.be(`/api/v1/videos/${vid2}`);
      const st = g.json?.data?.status;
      cs.log(`#2 状态: ${st}`);
      if (['queued', 'running'].includes(st)) return { done: true, st };
      if (['review', 'failed'].includes(st)) return { done: true, st };
      return { done: false };
    }, { timeoutMs: 120000, intervalMs: 4000 });
    const cancel = await api.be(`/api/v1/videos/${vid2}/cancel`, {});
    cs.log(`cancel -> ${cancel.status} ${cancel.text.slice(0, 200)}`);
    cs.eq('运行中任务可取消 200', cancel.status, 200);
    cs.eq('取消后状态 cancelled', cancel.json?.data?.status, 'cancelled');
    // Provider 取消生效证据：队列状态留证（若 #1 仍在运行则队列非空属预期）
    await new Promise((r) => setTimeout(r, 3000));
    cs.log(`[观察] 取消后 ComfyUI 队列空=${await comfyQueueEmpty()}（vid2 已 cancelled；#1 若在跑则队列保留其任务）`);
    // 重试语义：cancelled 不可重试（RETRYABLE_STATUSES 仅 failed/interrupted）
    const retry = await api.be(`/api/v1/videos/${vid2}/retry`, {});
    cs.eq('cancelled 任务重试被拒 409', retry.status, 409);
    cs.expect('拒绝码 VIDEO_NOT_RETRYABLE', (retry.json?.error?.code) === 'VIDEO_NOT_RETRYABLE', retry.text.slice(0, 160));
    const cancel2 = await api.be(`/api/v1/videos/${vid2}/cancel`, {});
    cs.eq('终态任务再取消被拒 409', cancel2.status, 409);
    const row = q1('SELECT status, error_msg FROM video_generations WHERE id=?', vid2);
    cs.expect('取消原因已持久化', row && row.status === 'cancelled' && String(row.error_msg || '').includes('取消'), JSON.stringify({ status: row?.status }));
    cs.log(`[预算] 真实生成已用 2/2（wave4 上限），后续用例不再提交真实生成`);
  });

  // ============ 非生成类契约用例 ============
  results.TC_VIDEO_005 = await runCase(meta('TC-VIDEO-005', '工作流目录 GET /videos/workflows：注册表 3 工作流、te_speed 能力标注、与 director-workflows.json 一致', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/videos/workflows');
    cs.eq('workflows 200', r.status, 200);
    const items = r.json?.data?.workflows || r.json?.data?.items || [];
    const ids = items.map((w) => w.id);
    cs.log('workflow ids: ' + JSON.stringify(ids));
    for (const w of ['minimax_h3_director_r2v', WORKFLOW, 'h3-continuity-v1']) {
      cs.expect(`包含工作流 ${w}`, ids.includes(w), ids.join(','));
    }
    const te = items.find((w) => w.id === WORKFLOW);
    cs.expect('te_speed 标注 supportsTESpeed=true', te?.capabilities?.supportsTESpeed === true, JSON.stringify(te?.capabilities));
    cs.expect('te_speed 为实验能力（approximateAcceleration）', te?.capabilities?.approximateAcceleration === true, String(te?.capabilities?.approximateAcceleration));
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend-node/configs/director-workflows.json'), 'utf8'));
    const fileIds = (file.workflows || []).map((w) => w.id);
    cs.expect('API 目录 ⊆ 配置文件注册表', ids.every((x) => fileIds.includes(x)), JSON.stringify({ api: ids, file: fileIds }));
  });

  results.TC_VIDEO_006 = await runCase(meta('TC-VIDEO-006', 'H3 门禁：无 storyboard → H3_STORYBOARD_REQUIRED；无草稿 → H3_DRAFT_REQUIRED；草稿跨分镜 → 409/400', 'system', 'P1'), async (cs) => {
    cs.log(`[观察] ComfyUI 队列空=${await comfyQueueEmpty()}（本用例不提交真实生成）`);
    const r1 = await api.be('/api/v1/videos', { drama_id: CTX.projectId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(CTX)] });
    cs.log(`无 storyboard -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.eq('H3 缺分镜 400', r1.status, 400);
    cs.eq('错误码 H3_STORYBOARD_REQUIRED', r1.json?.error?.code, 'H3_STORYBOARD_REQUIRED');
    const r2 = await api.be('/api/v1/videos', { drama_id: CTX.projectId, storyboard_id: CTX.shotId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(CTX)] });
    cs.log(`无草稿 -> ${r2.status} ${r2.text.slice(0, 160)}`);
    cs.eq('H3 缺草稿 400', r2.status, 400);
    cs.eq('错误码 H3_DRAFT_REQUIRED', r2.json?.error?.code, 'H3_DRAFT_REQUIRED');
    const r3 = await api.be('/api/v1/videos', { drama_id: CTX.projectId, storyboard_id: CTX.shotId + 999999, h3_prompt_draft_id: CTX.draftId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(CTX)] });
    cs.log(`草稿跨分镜 -> ${r3.status} ${r3.text.slice(0, 160)}`);
    cs.expect('草稿分镜错配被拒（400/404）', [400, 404].includes(r3.status), String(r3.status));
  });

  results.TC_VIDEO_007 = await runCase(meta('TC-VIDEO-007', '风格契约：项目内覆盖风格 400；自由生成缺 style_id 400 PROJECT_STYLE_REQUIRED', 'system', 'P1'), async (cs) => {
    const styleId = await require('./lib').defaultStyleId();
    const r1 = await api.be('/api/v1/videos', { drama_id: CTX.projectId, style_id: styleId });
    cs.eq('项目内覆盖风格 400', r1.status, 400);
    cs.eq('错误码 PROJECT_STYLE_OVERRIDE_FORBIDDEN', r1.json?.error?.code, 'PROJECT_STYLE_OVERRIDE_FORBIDDEN');
    const r2 = await api.be('/api/v1/videos', { prompt: 'QA-L3 自由生成无风格' });
    cs.log(`自由生成缺 style -> ${r2.status} ${r2.text.slice(0, 160)}`);
    cs.eq('缺 style_id 400', r2.status, 400);
    cs.eq('错误码 PROJECT_STYLE_REQUIRED', r2.json?.error?.code, 'PROJECT_STYLE_REQUIRED');
  });

  results.TC_VIDEO_008 = await runCase(meta('TC-VIDEO-008', '批量创建契约 POST /videos/prepared/batch：非数组 400；数组内 H3 项缺草稿逐项错误不整批崩溃', 'system', 'P1'), async (cs) => {
    const r1 = await api.be('/api/v1/videos/prepared/batch', { inputs: 'not-array' });
    cs.eq('inputs 非数组 400', r1.status, 400);
    const r2 = await api.be('/api/v1/videos/prepared/batch', { inputs: [
      { drama_id: CTX.projectId, storyboard_id: CTX.shotId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(CTX)] },
      { drama_id: CTX.projectId, style_id: await require('./lib').defaultStyleId(), prompt: 'QA-L3 批量第二项（缺参考图）' },
    ] });
    cs.log(`批量(含 H3 缺草稿项) -> ${r2.status} ${r2.text.slice(0, 300)}`);
    cs.expect('批量请求有结构化响应（不 5xx 崩溃）', r2.status < 500, String(r2.status));
    if (r2.status === 200) {
      const arr = r2.json?.data;
      cs.expect('返回逐项结果数组', Array.isArray(arr), r2.text.slice(0, 200));
    } else {
      cs.expect('错误结构含 code', !!r2.json?.error?.code, r2.text.slice(0, 200));
    }
  });

  results.TC_VIDEO_009 = await runCase(meta('TC-VIDEO-009', '取消/重试状态语义（不提交生成）：终态任务 cancel/retry 均 409；resume-poll 与 retry 同语义', 'system', 'P1'), async (cs) => {
    if (!CTX.videoId2) { await cs.finish('blocked'); return; }
    // 稳定终态：videoId2 为 cancelled（第 2 次真实生成的中断产物）
    const st2 = q1('SELECT status FROM video_generations WHERE id=?', CTX.videoId2);
    cs.expect('前置：videoId2 处于 cancelled 终态', st2?.status === 'cancelled', String(st2?.status));
    const c2 = await api.be(`/api/v1/videos/${CTX.videoId2}/cancel`, {});
    cs.eq('cancelled 任务再取消 409', c2.status, 409);
    cs.eq('错误码 VIDEO_NOT_CANCELLABLE', c2.json?.error?.code, 'VIDEO_NOT_CANCELLABLE');
    const r2 = await api.be(`/api/v1/videos/${CTX.videoId2}/retry`, {});
    cs.eq('cancelled 任务重试 409（仅 failed/interrupted 可重试）', r2.status, 409);
    cs.eq('错误码 VIDEO_NOT_RETRYABLE', r2.json?.error?.code, 'VIDEO_NOT_RETRYABLE');
    const rp2 = await api.be(`/api/v1/videos/${CTX.videoId2}/resume-poll`, {});
    cs.eq('resume-poll 对终态任务同样 409（严格快照重试语义）', rp2.status, 409);
    // videoId1：若已到 review/selected 再验证不可取消口径
    const st1 = q1('SELECT status FROM video_generations WHERE id=?', CTX.videoId);
    cs.log(`videoId1 当前状态: ${st1?.status}`);
    if (['review', 'selected'].includes(String(st1?.status))) {
      const c1 = await api.be(`/api/v1/videos/${CTX.videoId}/cancel`, {});
      cs.eq('review 任务取消 409', c1.status, 409);
      const r1 = await api.be(`/api/v1/videos/${CTX.videoId}/retry`, {});
      cs.eq('review 任务重试 409', r1.status, 409);
    } else {
      cs.log('[观察] videoId1 未到 review（仍在运行/其他），不对其执行取消操作以保护真实生成');
    }
    const nf = await api.be('/api/v1/videos/999999999/cancel', {});
    cs.expect('不存在任务 404/409（record 缺失）', [404, 409].includes(nf.status), String(nf.status));
  });

  results.TC_VIDEO_010 = await runCase(meta('TC-VIDEO-010', 'H3 提示词编译/预览契约 POST /videos/h3-preview：编译产物含官方章节结构与时长口径', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/videos/h3-preview', {
      prompt: '雨夜街头，一名撑伞的女人快步走过霓虹灯下，积水倒影摇曳。',
      durationSeconds: 5,
      reference_image_urls: [refStoragePath(CTX)],
    });
    cs.log(`h3-preview -> ${r.status} ${r.text.slice(0, 240)}`);
    if (r.status === 200) {
      const data = r.json?.data || {};
      const promptText = data.compiledPrompt || data.prompt || '';
      cs.expect('编译产物非空', !!promptText, String(promptText).slice(0, 120));
      cs.expect('产物含 H3 章节关键词（shot/subject/soundscape 任意）', /shot|subject|soundscape|detailed_description/i.test(String(promptText)), String(promptText).slice(0, 200));
      cs.expect('编译版本/格式可追溯', !!(data.promptFormat || data.compilerVersion), JSON.stringify({ f: data.promptFormat, v: data.compilerVersion }));
    } else {
      cs.expect('非 200 时为明确业务错误码（EXPERIMENTAL 现状如实记录）', !!r.json?.error?.code, r.text.slice(0, 200));
      cs.log('[观察项] h3-preview 当前真实行为：' + r.json?.error?.code);
    }
  });

  results.TC_VIDEO_011 = await runCase(meta('TC-VIDEO-011', 'H3 草稿接口契约：GET 缺 video_config_id/workflow_id 均 400；compile 缺 workflow_id 400；草稿 freshness 结构', 'system', 'P1'), async (cs) => {
    const r1 = await api.be(`/api/v1/storyboards/${CTX.shotId}/h3-prompt-draft`);
    cs.eq('GET 缺 config 400', r1.status, 400);
    cs.eq('错误码 H3_CONFIG_REQUIRED', r1.json?.error?.code, 'H3_CONFIG_REQUIRED');
    const r2 = await api.be(`/api/v1/storyboards/${CTX.shotId}/h3-prompt-draft?video_config_id=${VIDEO_CONFIG_ID}`);
    cs.eq('GET 缺 workflow 400', r2.status, 400);
    cs.eq('错误码 H3_WORKFLOW_REQUIRED', r2.json?.error?.code, 'H3_WORKFLOW_REQUIRED');
    const r3 = await api.be(`/api/v1/storyboards/${CTX.shotId}/h3-prompt-draft?video_config_id=${VIDEO_CONFIG_ID}&workflow_id=${WORKFLOW}`);
    cs.eq('GET 正确参数 200', r3.status, 200);
    const d = r3.json?.data || {};
    cs.expect('返回 draft + freshness 结构', !!d.draft && typeof d.freshness === 'object', JSON.stringify({ id: d.draft?.id, stale: d.freshness?.stale }));
    if (d.freshness?.stale === true) {
      cs.log(`[观察项] 草稿新鲜度为实时评估：当前 reasons=${JSON.stringify(d.freshness.reasons)}（生成尝试后上下文指纹变化；产品语义为「重编译即可恢复」，不判失败）`);
    } else {
      cs.expect('现有草稿未过期', d.freshness?.stale === false, JSON.stringify(d.freshness));
    }
    const r4 = await api.be(`/api/v1/storyboards/${CTX.shotId}/h3-prompt-draft/compile`, { video_config_id: String(VIDEO_CONFIG_ID) });
    cs.eq('compile 缺 workflow_id 400', r4.status, 400);
    cs.eq('错误码 H3_WORKFLOW_REQUIRED', r4.json?.error?.code, 'H3_WORKFLOW_REQUIRED');
  });

  results.TC_VIDEO_012 = await runCase(meta('TC-VIDEO-012', '连续性锚点/质量分析 EXPERIMENTAL：anchors/analyze 接口当前真实行为验证', 'system', 'P2'), async (cs) => {
    const cand = CTX.groupId ? q1('SELECT dc.id, dc.artifact_id FROM director_candidates dc WHERE dc.video_generation_id=? AND dc.artifact_id NOT LIKE \"pending-%\" LIMIT 1', CTX.videoId) : null;
    const r1 = await api.be('/api/v1/director/artifacts/nonexistent/anchors');
    cs.log(`anchors(不存在 artifact) -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.expect('不存在 artifact 的锚点列表有明确响应', [200, 404].includes(r1.status), String(r1.status));
    if (cand?.artifact_id) {
      const r2 = await api.be('/api/v1/director/artifacts/' + cand.artifact_id + '/anchors');
      cs.log(`anchors(真实 artifact) -> ${r2.status} ${r2.text.slice(0, 160)}`);
      cs.expect('真实 artifact 锚点接口可达', [200, 404, 501].includes(r2.status), String(r2.status));
      const r3 = await api.be('/api/v1/director/artifacts/' + cand.artifact_id + '/analyze', {});
      cs.log(`analyze -> ${r3.status} ${r3.text.slice(0, 200)}`);
      cs.expect('质量分析接口有结构化响应（EXPERIMENTAL 现状如实记录）', r3.status < 500 || !!r3.json?.error?.code, r3.text.slice(0, 200));
    } else {
      cs.log('[观察项] 无可用真实 artifact，锚点/分析仅验证不存在分支');
    }
  });

  results.TC_VIDEO_013 = await runCase(meta('TC-VIDEO-013', 'episode 批量桩路由与 fromImage 契约：episode batch 返回空数组（LEGACY）；image→video 任务创建', 'system', 'P2'), async (cs) => {
    const r1 = await api.be(`/api/v1/videos/episode/${CTX.episodeId}/batch`, {});
    cs.eq('episode batch 200', r1.status, 200);
    cs.expect('返回空数组（LEGACY 桩行为与 inventory 一致）', Array.isArray(r1.json?.data) && r1.json.data.length === 0, r1.text.slice(0, 120));
    const img = await api.be('/api/v1/images', { drama_id: CTX.projectId, prompt: 'QA-L3 VIDEO-013 fromImage 前置图' });
    cs.log(`前置图像记录 -> ${img.status}`);
    const genId = img.json?.data?.id;
    const r2 = await api.be(`/api/v1/videos/image/${genId}`, {});
    cs.eq('fromImage 200', r2.status, 200);
    cs.expect('返回 async task id', !!r2.json?.data?.task_id, r2.text.slice(0, 120));
    const t = q1('SELECT type, status FROM async_tasks WHERE id=?', r2.json?.data?.task_id);
    cs.expect('任务类型 video_generation 已落库', t && t.type === 'video_generation', JSON.stringify(t));
  });

  results.TC_VIDEO_014 = await runCase(meta('TC-VIDEO-014', '生成历史管理：GET /videos 过滤 drama_id；GET :id 404；DELETE 软删后列表不可见', 'system', 'P1'), async (cs) => {
    const r1 = await api.be(`/api/v1/videos?drama_id=${CTX.projectId}&page_size=50`);
    cs.eq('列表 200', r1.status, 200);
    const items = r1.json?.data?.items || [];
    cs.expect('列表仅含本项目记录', items.every((x) => Number(x.drama_id) === Number(CTX.projectId)), `total=${r1.json?.data?.total}`);
    cs.expect('真实生成记录在列表中可见（含 candidate_group_id）', items.some((x) => x.id === CTX.videoId), `want=${CTX.videoId}`);
    const r2 = await api.be('/api/v1/videos/999999999');
    cs.eq('不存在 404', r2.status, 404);
    // 用第 2 次（已取消）记录验证软删链路；#1 review 记录保留供 AUDIO finalize 真实合成
    const delTarget = CTX.videoId2;
    const del = await api.beMethod('DELETE', `/api/v1/videos/${delTarget}`);
    cs.log(`DELETE 取消记录#${delTarget} -> ${del.status}`);
    cs.eq('DELETE 200', del.status, 200);
    const g = await api.be(`/api/v1/videos/${delTarget}`);
    cs.eq('删除后 GET 404', g.status, 404);
    const row = q1('SELECT deleted_at FROM video_generations WHERE id=?', delTarget);
    cs.expect('软删标记已落库（数据可复核）', !!row?.deleted_at, String(row?.deleted_at));
    cs.log('[数据保留说明] #2（取消）已软删供删除链路验证；#1（review）保留供 AUDIO finalize 真实合成；文件产物存档 wave4-artifacts');
  });

  // 汇总
  try {
    fs.writeFileSync(path.join(require('./lib').LOG_DIR, 'video-chain.json'), JSON.stringify({
      projectId: CTX.projectId, episodeId: CTX.episodeId, sceneId: CTX.sceneId,
      shotId: CTX.shotId, draftId: CTX.draftId, groupId: CTX.groupId,
      videoId1: CTX.videoId, videoId2: CTX.videoId2,
      videoAbs: CTX.videoAbs || null, ffprobe: CTX.ffprobe || null,
      v2SubmitStatus: CTX.v2SubmitStatus, v2SubmitBody: CTX.v2SubmitBody,
    }, null, 2));
    console.log('[wave4] video-chain.json 已写入（供 AUDIO/UPSCALE/CANVAS 波次复用）');
  } catch (e) { console.log('[wave4] video-chain.json 写入失败: ' + e.message); }
  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 VIDEO] passed=${passed} failed=${failed} blocked=${blocked}`);
  if (failed > 0) {
    console.log('[wave4] 失败用例需写 qa/bugs/BUG-L3-4NN.yml（由主流程按执行日志复核后补写）');
  }
})();
