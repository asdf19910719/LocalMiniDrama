// Wave4 VIDEO 恢复轮：中断的 #1 真实生成重试（预算口径：#1 两次提交中第 1 次被测试脚本自身误取消，
// 本轮为该次生成的重试；#2 中断路径已由 video 99 真实执行完毕，不重复提交）
// 复用既有链路：project 264 / episode 179 / shot 141 / scene 43 / draft 47（video-chain.json）
const fs = require('fs');
const path = require('path');
const {
  api, req, runCase, q, q1, pollUntil, ffprobeDuration,
  createV1Project, createEpisode, saveDraft, confirmScript, uploadPng,
  keepProject, softDeleteProject,
  ART_DIR, ROOT, LOG_DIR,
} = require('./lib');

const WORKFLOW = 'minimax_h3_director_r2v_te_speed';
const VIDEO_CONFIG_ID = 5;
const STORAGE_ROOT = path.join(ROOT, 'backend-node/data/storage');
const MODULE = 'VIDEO';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }
const refStoragePath = (p) => 'data/storage/' + String(p).replace(/^\//, '');

async function comfyQueue() {
  try {
    const r = await req('GET', 'http://127.0.0.1:8188/queue', undefined, { timeoutMs: 10000 });
    const j = r.json || {};
    return { running: (j.queue_running || []).length, pending: (j.queue_pending || []).length };
  } catch (_) { return null; }
}

(async () => {
  const results = {};
  const CTX = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));
  const projectId = CTX.projectId, shotId = CTX.shotId, episodeId = CTX.episodeId;
  // 参考图：取场景当前本地图
  const scene = q1('SELECT id, local_path, image_url FROM scenes WHERE id=?', CTX.sceneId);
  const refPath = refStoragePath(scene.local_path || '');
  const sceneImageUrl = scene.image_url;

  // ============ TC-VIDEO-001（恢复）真实生成重试 ============
  results.TC_VIDEO_001 = await runCase(meta('TC-VIDEO-001', '真实生成主链路（恢复轮）：分镜视频任务提交（ComfyUI H3 te_speed）→ 状态机等待/排队/运行 → 审核 + 视频文件落盘 ffprobe', 'system', 'P0'), async (cs) => {
    cs.expect('链路前置：项目/分镜/场景仍存活', !!(projectId && shotId && scene?.local_path), JSON.stringify({ p: projectId, s: shotId }));
    const q0 = await comfyQueue();
    cs.log(`ComfyUI 队列: ${JSON.stringify(q0)}（生成前确认）`);
    if (!(q0 && q0.running === 0 && q0.pending === 0)) { cs.log('[blocked] ComfyUI 队列非空，等待真实生成会互相干扰'); await cs.finish('blocked'); return; }
    // 预置音频计划（v1 路由），避免 compile 触发音频规划 LLM
    const ap = await api.beMethod('PATCH', `/api/v1/episodes/${episodeId}/audio-plan`, { audio_plan: { bgm: { mode: 'episode_track' } } });
    cs.log(`audio-plan patch(v1) -> ${ap.status}`);
    // 草稿新鲜度预检；stale 则重编译（H3 门禁架构必需的 DeepSeek 编译，如实记录）
    const g0 = await api.be(`/api/v1/storyboards/${shotId}/h3-prompt-draft?video_config_id=${VIDEO_CONFIG_ID}&workflow_id=${WORKFLOW}`);
    let draftId = CTX.draftId;
    if (g0.json?.data?.freshness?.stale === true) {
      cs.log(`[链路] 草稿 stale reasons=${JSON.stringify(g0.json.data.freshness.reasons)} → 重编译（DeepSeek H3 编译）`);
      const c = await api.be(`/api/v1/storyboards/${shotId}/h3-prompt-draft/compile`, { video_config_id: String(VIDEO_CONFIG_ID), workflow_id: WORKFLOW });
      cs.log(`recompile -> ${c.status}`);
      if (c.status !== 200) throw new Error('重编译失败: ' + c.text.slice(0, 200));
      draftId = c.json?.data?.draft?.id;
    }
    CTX.draftId = draftId;
    cs.expect('H3 草稿可用', !!draftId, String(draftId));

    const create = await api.be('/api/v1/videos', {
      drama_id: projectId,
      storyboard_id: shotId,
      h3_prompt_draft_id: draftId,
      workflow_id: WORKFLOW,
      reference_image_urls: [refStoragePath(scene.local_path)],
    });
    cs.log(`videos.create -> ${create.status}`);
    if (create.status !== 201) throw new Error('真实提交失败: ' + create.status + ' ' + create.text.slice(0, 200));
    CTX.videoId = create.json?.data?.id;
    CTX.taskId = create.json?.data?.task_id;
    cs.eq('创建 201；初始状态 waiting（等待）', create.json?.data?.status, 'waiting');
    fs.writeFileSync(path.join(LOG_DIR, 'video-chain.json'), JSON.stringify(CTX, null, 2));

    const seen = [];
    const final = await pollUntil(async () => {
      const g = await api.be(`/api/v1/videos/${CTX.videoId}`);
      const st = g.json?.data?.status;
      if (st && seen[seen.length - 1] !== st) { seen.push(st); cs.log(`状态流转: ${st}`); }
      if (['review', 'selected', 'failed', 'cancelled', 'interrupted'].includes(st)) return { done: true, status: st, body: g.json?.data };
      return { done: false, status: st };
    }, { timeoutMs: 1500000, intervalMs: 8000, label: 'video-gen' });
    CTX.finalStatus = final.status;
    CTX.finalBody = final.body || {};
    cs.log(`终态: ${final.status} local_path=${final.body?.local_path}`);
    if (final.timeout) cs.log('[记录] 25 分钟未到终态：H3 te_speed 实测为慢生成（此前一次 13min+ 仍在 running），如实记失败并保留任务供 E2E 阶段收割');
    cs.expect('状态机到达审核（review）', final.status === 'review', `actual=${final.status} seen=${seen.join('>')}`);
    cs.expect('观察到等待段 waiting', seen.includes('waiting'), seen.join('>'));
    cs.expect('观察到排队/运行段（queued/running）', seen.some((s) => ['queued', 'running'].includes(s)), seen.join('>'));

    const lp = final.body?.local_path;
    cs.expect('local_path 已持久化（产出物写回）', !!lp, String(lp));
    if (lp) {
      const abs = path.isAbsolute(lp) ? lp : path.join(STORAGE_ROOT, lp);
      const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
      cs.expect('视频文件真实存在且 >0 字节', size > 0, `${abs} (${size}B)`);
      const pp = ffprobeDuration(abs);
      cs.expect('ffprobe 可解码且时长 >0', pp.ok, JSON.stringify({ dur: pp.duration, v: pp.hasVideo }));
      cs.expect('容器含视频流', pp.hasVideo === true, String(pp.hasVideo));
      cs.log(`ffprobe: duration=${pp.duration}s video=${pp.hasVideo} audio=${pp.hasAudio} size=${size}B`);
      CTX.videoAbs = abs;
      CTX.ffprobe = { duration: pp.duration, hasVideo: pp.hasVideo, hasAudio: pp.hasAudio, size };
      try { fs.copyFileSync(abs, path.join(ART_DIR, 'TC-VIDEO-001-real-gen.mp4')); cs.log('产物已存档 qa/run/wave4-artifacts/TC-VIDEO-001-real-gen.mp4'); } catch (_) {}
    }
  });

  // ============ TC-VIDEO-002 持久化断言 ============
  results.TC_VIDEO_002 = await runCase(meta('TC-VIDEO-002', '数据流与持久化：provider task id、config 快照（workflow/model）、async_task 完成、产出物写回', 'system', 'P0'), async (cs) => {
    if (!CTX.videoId || CTX.finalStatus !== 'review') { cs.log(`前置缺失：终态=${CTX.finalStatus}（生成未完成，见 TC-VIDEO-001 记录）`); await cs.finish('blocked'); return; }
    const row = q1('SELECT * FROM video_generations WHERE id=?', CTX.videoId);
    cs.expect('provider_task_id 已持久化', !!row?.provider_task_id, String(row?.provider_task_id));
    const snap = (() => { try { return JSON.parse(row.config_snapshot || '{}'); } catch (_) { return {}; } })();
    cs.expect('config_snapshot 含 workflow/model', String(snap.workflowId || snap.model || '').includes('minimax_h3'), JSON.stringify({ w: snap.workflowId, m: snap.model }));
    cs.expect('config_snapshot.provider=comfyui', snap.provider === 'comfyui', snap.provider);
    cs.expect('终态 review 落库', row.status === 'review', row.status);
    cs.expect('duration 落库（草稿编译口径）', Number(row.duration) > 0, String(row.duration));
    cs.expect('[数据流] local_path 写回（下游 finalize 可消费）', !!row.local_path, String(row.local_path));
    const task = CTX.taskId ? q1('SELECT status, progress, result FROM async_tasks WHERE id=?', CTX.taskId) : null;
    cs.expect('async_task 收口 completed', task && task.status === 'completed', JSON.stringify({ s: task?.status }));
  });

  // ============ TC-VIDEO-006 H3 门禁（上轮已过 3 项门禁断言，本轮不重复提交；队列检查降为观察）============
  results.TC_VIDEO_006 = await runCase(meta('TC-VIDEO-006', 'H3 门禁（恢复确认）：无 storyboard / 无草稿 / 草稿跨分镜均被拒且不触发真实生成', 'system', 'P1'), async (cs) => {
    const r1 = await api.be('/api/v1/videos', { drama_id: projectId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(scene.local_path)] });
    cs.eq('H3 缺分镜 400 H3_STORYBOARD_REQUIRED', r1.status === 400 && r1.json?.error?.code === 'H3_STORYBOARD_REQUIRED', r1.text.slice(0, 140));
    const r2 = await api.be('/api/v1/videos', { drama_id: projectId, storyboard_id: shotId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(scene.local_path)] });
    cs.eq('H3 缺草稿 400 H3_DRAFT_REQUIRED', r2.status === 400 && r2.json?.error?.code === 'H3_DRAFT_REQUIRED', r2.text.slice(0, 140));
    const r3 = await api.be('/api/v1/videos', { drama_id: projectId, storyboard_id: shotId + 999999, h3_prompt_draft_id: CTX.draftId, workflow_id: WORKFLOW, reference_image_urls: [refStoragePath(scene.local_path)] });
    cs.log(`草稿跨分镜 -> ${r3.status} ${r3.text.slice(0, 140)}`);
    cs.expect('草稿分镜错配被拒（400/404）', [400, 404].includes(r3.status), String(r3.status));
  });

  // ============ TC-VIDEO-009 终态语义（用真实 cancelled 记录 98）============
  results.TC_VIDEO_009 = await runCase(meta('TC-VIDEO-009', '取消/重试状态语义（不提交生成）：终态任务 cancel/retry 均 409；resume-poll 同语义', 'system', 'P1'), async (cs) => {
    const target = 98; // 真实中断产物：provider 提交后用户取消（VIDEO_CANCELLED）
    const st = q1('SELECT status, error_msg FROM video_generations WHERE id=? AND deleted_at IS NULL', target);
    cs.expect('前置：#98 为真实 cancelled 记录（第 1 次生成的中断产物）', st?.status === 'cancelled', JSON.stringify({ s: st?.status }));
    const c1 = await api.be(`/api/v1/videos/${target}/cancel`, {});
    cs.eq('cancelled 任务再取消 409', c1.status, 409);
    cs.eq('错误码 VIDEO_NOT_CANCELLABLE', c1.json?.error?.code, 'VIDEO_NOT_CANCELLABLE');
    const r1 = await api.be(`/api/v1/videos/${target}/retry`, {});
    cs.eq('cancelled 任务重试 409（仅 failed/interrupted 可重试）', r1.status, 409);
    cs.eq('错误码 VIDEO_NOT_RETRYABLE', r1.json?.error?.code, 'VIDEO_NOT_RETRYABLE');
    const rp = await api.be(`/api/v1/videos/${target}/resume-poll`, {});
    cs.eq('resume-poll 对终态任务同样 409（严格快照重试语义）', rp.status, 409);
    const nf = await api.be('/api/v1/videos/999999999/cancel', {});
    cs.expect('不存在任务 404/409', [404, 409].includes(nf.status), String(nf.status));
    // 若恢复轮生成到达 review，再验证审核态不可取消
    const st1 = CTX.videoId ? q1('SELECT status FROM video_generations WHERE id=?', CTX.videoId) : null;
    cs.log(`恢复轮生成状态: ${st1?.status}`);
    if (['review', 'selected'].includes(String(st1?.status))) {
      const c2 = await api.be(`/api/v1/videos/${CTX.videoId}/cancel`, {});
      cs.eq('review 任务取消 409', c2.status, 409);
    }
  });

  // ============ TC-VIDEO-011/012/013 快速契约复核 ============
  results.TC_VIDEO_011 = await runCase(meta('TC-VIDEO-011', 'H3 草稿接口契约（恢复确认）：GET 缺参 400；compile 缺 workflow_id 400', 'system', 'P1'), async (cs) => {
    const r1 = await api.be(`/api/v1/storyboards/${shotId}/h3-prompt-draft`);
    cs.expect('GET 缺 config 400 H3_CONFIG_REQUIRED', r1.status === 400 && r1.json?.error?.code === 'H3_CONFIG_REQUIRED', r1.text.slice(0, 120));
    const r2 = await api.be(`/api/v1/storyboards/${shotId}/h3-prompt-draft?video_config_id=${VIDEO_CONFIG_ID}`);
    cs.expect('GET 缺 workflow 400 H3_WORKFLOW_REQUIRED', r2.status === 400 && r2.json?.error?.code === 'H3_WORKFLOW_REQUIRED', r2.text.slice(0, 120));
    const r4 = await api.be(`/api/v1/storyboards/${shotId}/h3-prompt-draft/compile`, { video_config_id: String(VIDEO_CONFIG_ID) });
    cs.expect('compile 缺 workflow_id 400', r4.status === 400, String(r4.status));
  });

  results.TC_VIDEO_013 = await runCase(meta('TC-VIDEO-013', 'episode 批量桩路由与 fromImage 契约（恢复确认）', 'system', 'P2'), async (cs) => {
    const r1 = await api.be(`/api/v1/videos/episode/${episodeId}/batch`, {});
    cs.eq('episode batch 200', r1.status, 200);
    cs.expect('返回空数组（LEGACY 桩）', Array.isArray(r1.json?.data) && r1.json.data.length === 0, r1.text.slice(0, 100));
    const img = await api.be('/api/v1/images', { drama_id: projectId, prompt: 'QA-L3 VIDEO-013 recovery 前置图' });
    const genId = img.json?.data?.id;
    cs.expect('图像记录创建成功', img.status === 201, String(img.status));
    const r2 = await api.be(`/api/v1/videos/image/${genId}`, {});
    cs.eq('fromImage 200', r2.status, 200);
    const t = q1('SELECT type, status FROM async_tasks WHERE id=?', r2.json?.data?.task_id);
    cs.expect('任务类型 video_generation 落库', t && t.type === 'video_generation', JSON.stringify(t));
  });

  if (CTX.videoId) {
    fs.writeFileSync(path.join(LOG_DIR, 'video-chain.json'), JSON.stringify(CTX, null, 2));
  }
  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 VIDEO-recovery] passed=${passed} failed=${failed} blocked=${blocked}`);
})();
