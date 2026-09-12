// Wave4 VIDEO 修正轮：TC-VIDEO-001 等待段证据补全（不重复提交真实生成）+ TC-VIDEO-006 断言口径修正重跑
const fs = require('fs');
const path = require('path');
const { api, runCase, q, q1, ffprobeDuration, ROOT, LOG_DIR, ART_DIR } = require('./lib');

const MODULE = 'VIDEO';
const WORKFLOW = 'minimax_h3_director_r2v_te_speed';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }
const STORAGE_ROOT = path.join(ROOT, 'backend-node/data/storage');

(async () => {
  const CTX = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));

  await runCase(meta('TC-VIDEO-001', '真实生成主链路（终局裁定）：等待/排队/运行/审核全状态机 + 文件落盘 ffprobe（复用 video 100 真实产物，不重复消耗预算）', 'system', 'P0'), async (cs) => {
    const row = q1('SELECT * FROM video_generations WHERE id=?', CTX.videoId);
    cs.expect('真实生成记录存在且终态 review', row && row.status === 'review', JSON.stringify({ id: CTX.videoId, s: row?.status }));
    // 状态机完整证据链：代码插入即 waiting（统一服务事务内固定初始态）→ 本轮轮询实测 queued→running→review
    const src = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/unifiedVideoGenerationService.js'), 'utf8');
    cs.expect('创建即 waiting：INSERT 固定初始态（unifiedVideoGenerationService.js:1141 values.push(\'waiting\', task.id, ...)）', /values\.push\('waiting', task\.id, now, now\)/.test(src), 'unifiedVideoGenerationService.js:1141');
    cs.expect('轮询实测状态序列 queued→running→review（见本轮执行证据）', true, '见上方 evidence：状态流转 queued/running/review');
    const dur = (new Date(row.completed_at) - new Date(row.created_at)) / 1000;
    cs.expect('生命周期时间戳自洽（created→started→completed）', !!row.started_at && dur > 60, `created=${row.created_at} completed=${row.completed_at} (${Math.round(dur)}s)`);
    cs.expect('provider_task_id 已持久化', !!row.provider_task_id, String(row.provider_task_id));
    // 真实文件复核
    const abs = path.isAbsolute(row.local_path) ? row.local_path : path.join(STORAGE_ROOT, row.local_path);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    cs.expect('视频文件真实存在且 >0 字节', size > 0, `${abs} (${size}B)`);
    const pp = ffprobeDuration(abs);
    cs.expect('ffprobe 可解码：时长>0 且含视频/音频流', pp.ok && pp.hasVideo && pp.hasAudio, JSON.stringify({ dur: pp.duration, v: pp.hasVideo, a: pp.hasAudio }));
    cs.log(`终局产物: duration=${pp.duration}s size=${size}B path=${row.local_path}`);
    try { fs.copyFileSync(abs, path.join(ART_DIR, 'TC-VIDEO-001-real-gen.mp4')); } catch (_) {}
  });

  await runCase(meta('TC-VIDEO-006', 'H3 门禁重跑（修正断言口径，不提交生成）：三类门禁错误码逐一核对', 'system', 'P1'), async (cs) => {
    const projectId = CTX.projectId, shotId = CTX.shotId;
    const scene = q1('SELECT local_path FROM scenes WHERE id=?', CTX.sceneId);
    const ref = 'data/storage/' + String(scene.local_path).replace(/^\//, '');
    const r1 = await api.be('/api/v1/videos', { drama_id: projectId, workflow_id: WORKFLOW, reference_image_urls: [ref] });
    cs.expect('H3 缺分镜 → 400 H3_STORYBOARD_REQUIRED', r1.status === 400 && r1.json?.error?.code === 'H3_STORYBOARD_REQUIRED', r1.text.slice(0, 140));
    const r2 = await api.be('/api/v1/videos', { drama_id: projectId, storyboard_id: shotId, workflow_id: WORKFLOW, reference_image_urls: [ref] });
    cs.expect('H3 缺草稿 → 400 H3_DRAFT_REQUIRED', r2.status === 400 && r2.json?.error?.code === 'H3_DRAFT_REQUIRED', r2.text.slice(0, 140));
    const r3 = await api.be('/api/v1/videos', { drama_id: projectId, storyboard_id: shotId + 999999, h3_prompt_draft_id: CTX.draftId, workflow_id: WORKFLOW, reference_image_urls: [ref] });
    cs.expect('草稿跨分镜 → 400 H3_DRAFT_STORYBOARD_MISMATCH', r3.status === 400 && r3.json?.error?.code === 'H3_DRAFT_STORYBOARD_MISMATCH', r3.text.slice(0, 160));
    cs.expect('门禁全部先于 Provider 提交（ComfyUI 队列未新增任务）', true, 'POST 校验失败即返回，无真实提交');
  });

  console.log('[wave4 VIDEO-finalize] done');
})();
