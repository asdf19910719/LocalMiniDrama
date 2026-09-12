// Wave4 AUDIO 模块：TTS 真实错误路径 / 音频计划 / FFmpeg 真实合成与 finalize / 成片下载
// 前置：run-video.js 已执行（video-chain.json 提供真实生成分镜）
const fs = require('fs');
const path = require('path');
const {
  api, runCase, mask, q, q1, pollUntil, ffprobeDuration, makeWav, makeMp4ViaFfmpeg,
  createV1Project, createEpisode, saveDraft, confirmScript, postMultipart,
  keepProject, softDeleteProject,
  LOG_DIR, ART_DIR, ROOT,
} = require('./lib');

const MODULE = 'AUDIO';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }
const STORAGE_ROOT = path.join(ROOT, 'backend-node/data/storage');

(async () => {
  const results = {};
  const CTX = {};

  // 读取 VIDEO 链路（真实生成分镜）
  try {
    CTX.video = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));
  } catch (_) { CTX.video = null; }

  // 共享项目（音频计划/上传/无视频 finalize 用）
  results.TC_AUDIO_000_setup = await runCase(meta('TC-AUDIO-000', '（前置）音频共享项目与分镜搭建', 'system', 'P1'), async (cs) => {
    const proj = await createV1Project(cs, `QA-L3-AUDIO-${Date.now()}`);
    CTX.projectId = proj.id;
    keepProject(cs, CTX.projectId); // 共享项目：模块结尾统一软删
    CTX.episodeId = await createEpisode(cs, CTX.projectId, '第一集');
    await saveDraft(CTX.episodeId, '第一场：山顶路口 黄昏 外\n少年背起行囊回头望向山下的村庄，炊烟四起。他深吸一口气，转身踏上盘山路。\n第二场：老屋门前 夜 外\n老人把一盏油灯放在门槛上，火光摇曳，照出满脸皱纹。');
    const c = await confirmScript(CTX.episodeId);
    const s = await api.be(`/api/v2/episodes/${CTX.episodeId}/storyboard/create-from-script`, {});
    cs.log(`confirm=${c.status} create-from-script=${s.status}`);
    const shots = q('SELECT id, storyboard_number FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number', CTX.episodeId);
    CTX.shotIds = shots.map((x) => x.id);
    // 给第一条分镜写对白（供批量 TTS 结构验证）
    if (CTX.shotIds[0]) await api.beMethod('PUT', `/api/v1/storyboards/${CTX.shotIds[0]}`, { dialogue: 'QA-L3 对白：我一定会回来的。' });
    // 空视频剧集（无任何真实视频）用于 finalize 降级分支
    CTX.emptyEpisodeId = await createEpisode(cs, CTX.projectId, '空集');
    await saveDraft(CTX.emptyEpisodeId, '第一场：空屋 夜 内\n尘封的房间，只有一张木椅。');
    await confirmScript(CTX.emptyEpisodeId);
    await api.be(`/api/v2/episodes/${CTX.emptyEpisodeId}/storyboard/create-from-script`, {});
    cs.expect('前置搭建完成', CTX.shotIds.length >= 1, JSON.stringify({ shots: CTX.shotIds }));
  });

  // ============ TC-AUDIO-001 TTS 真实错误路径 ============
  results.TC_AUDIO_001 = await runCase(meta('TC-AUDIO-001', 'TTS 真实错误路径：无 service_type=tts 配置 → 明确「未配置 TTS」错误；批量接口逐项错误不整批崩溃', 'system', 'P0'), async (cs) => {
    const ttsCfg = q1("SELECT COUNT(*) AS n FROM ai_service_configs WHERE service_type='tts' AND deleted_at IS NULL AND is_active=1");
    cs.expect('前置事实：应用无活跃 TTS 通道配置', ttsCfg.n === 0, `count=${ttsCfg.n}`);
    const r = await cs.withRetry('tts', () => api.be('/api/v1/audio/extract', { text: 'QA-L3 TTS 通道验证文本' }));
    cs.log(`extract -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('无 TTS 通道时 500（真实错误路径）', r.status, 500);
    cs.expect('错误信息明确指出未配置 TTS', /未配置 TTS/i.test(r.text), r.text.slice(0, 200));
    // 批量：对白非空项走到 TTS 配置检查 → 逐项 error；对白为空项 → 逐项 error
    const rb = await api.be('/api/v1/audio/extract/batch', { storyboard_ids: [CTX.shotIds[0], CTX.shotIds[1], 999999999] });
    cs.log(`extract/batch -> ${rb.status} ${rb.text.slice(0, 300)}`);
    cs.eq('批量接口 200（逐项报告）', rb.status, 200);
    const arr = rb.json?.data || [];
    cs.expect('返回逐项结果数组（含 error 字段）', Array.isArray(arr) && arr.length === 3 && arr.every((x) => typeof x.error === 'string'), JSON.stringify(arr).slice(0, 260));
    cs.log('[观察项] 当前配置无真实 TTS 通道（MiniMax/OpenAI 协议均未配置 key），成功路径属外部依赖，按真实外部状态记录');
  });

  // ============ TC-AUDIO-002 TTS 参数校验 ============
  results.TC_AUDIO_002 = await runCase(meta('TC-AUDIO-002', 'TTS 参数校验：无 storyboard_id 且无 text 400；空对白分镜 400「分镜对白为空」', 'system', 'P1'), async (cs) => {
    const r1 = await api.be('/api/v1/audio/extract', {});
    cs.eq('缺参 400', r1.status, 400);
    const r2 = await api.be('/api/v1/audio/extract', { storyboard_id: CTX.shotIds[1] });
    cs.log(`空对白分镜 -> ${r2.status} ${r2.text.slice(0, 160)}`);
    cs.eq('空对白 400', r2.status, 400);
    cs.expect('错误信息提及对白为空', /对白为空/.test(r2.text), r2.text.slice(0, 160));
    const r3 = await api.be('/api/v1/audio/extract', { text: 'QA-L3 narration', tts_kind: 'narration' });
    cs.log(`narration kind -> ${r3.status}`);
    cs.eq('narration 类型同样到达 TTS 配置检查（500）', r3.status, 500);
    const rb = await api.be('/api/v1/audio/extract/batch', { storyboard_ids: [] });
    cs.eq('批量空数组 400', rb.status, 400);
  });

  // ============ TC-AUDIO-003 音频计划闭环 ============
  results.TC_AUDIO_003 = await runCase(meta('TC-AUDIO-003', '剧集音频计划：PATCH 更新 → 响应投影回读 → DB 落库（field_state 锁定）→ 分镜 music_cue 投影', 'system', 'P0'), async (cs) => {
    const r = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: { bgm: { mode: 'episode_track', prompt: 'QA-L3 全集 BGM：舒缓钢琴' } },
    });
    cs.eq('PATCH 200', r.status, 200);
    const payload = r.json?.data || {};
    cs.expect('响应含 episode + storyboards 投影', !!payload.episode && Array.isArray(payload.storyboards), JSON.stringify(Object.keys(payload)));
    const row = q1('SELECT audio_plan FROM episodes WHERE id=?', CTX.episodeId);
    const plan = JSON.parse(row.audio_plan || '{}');
    cs.eq('bgm.mode 落库 episode_track', plan.bgm?.mode, 'episode_track');
    cs.expect('bgm.prompt 落库', plan.bgm?.prompt === 'QA-L3 全集 BGM：舒缓钢琴', plan.bgm?.prompt);
    cs.expect('手动修改被 field_state 锁定（source=manual locked=true）', plan.field_state?.['bgm.mode']?.locked === true && plan.field_state?.['bgm.mode']?.source === 'manual', JSON.stringify(plan.field_state?.['bgm.mode']));
    cs.expect('provenance.source=manual', plan.provenance?.source === 'manual', JSON.stringify(plan.provenance));
    // 分镜投影：mode != per_segment 时所有 shot music_cue 置 mute（存储于 storyboards.audio_description 列）
    const sb = q1('SELECT audio_description FROM storyboards WHERE id=?', CTX.shotIds[0]);
    const audioDesc = JSON.parse(sb.audio_description || '{}');
    const cue = audioDesc?.music_cue;
    cs.expect('分镜 music_cue 被 reconcile 为 mute', cue && cue.mode === 'mute', JSON.stringify(cue));
    cs.expect('投影来源可追溯（provenance.source=episode_audio_plan）', audioDesc?.provenance?.source === 'episode_audio_plan', JSON.stringify(audioDesc?.provenance));
    // 再次读取（读取接口语义）
    const r2 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, { audio_plan: {} });
    const plan2 = JSON.parse(q1('SELECT audio_plan FROM episodes WHERE id=?', CTX.episodeId).audio_plan || '{}');
    cs.eq('空 PATCH 不破坏既有计划（mode 保持 episode_track）', plan2.bgm?.mode, 'episode_track');
  });

  // ============ TC-AUDIO-004 音频计划 LLM 生成接口边界（不消耗 LLM 预算）============
  results.TC_AUDIO_004 = await runCase(meta('TC-AUDIO-004', '音频计划 AI 生成接口边界：不存在剧集与无分镜剧集的明确错误（LLM 主路径超 DeepSeek 预算记观察项）', 'system', 'P1'), async (cs) => {
    const r1 = await api.be('/api/v1/episodes/999999999/audio-plan/plan', {});
    cs.log(`不存在剧集 plan -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.expect('不存在剧集有明确错误（4xx/5xx 均非崩溃）', r1.status >= 400, String(r1.status));
    const r2 = await api.be(`/api/v1/episodes/${CTX.emptyEpisodeId}/audio-plan/plan`, { force: false });
    cs.log(`空剧集 plan -> ${r2.status} ${r2.text.slice(0, 200)}`);
    if (r2.status === 200) {
      cs.expect('[真实行为] bgm.mode 非 per_segment 时 plan 为无操作（早退返回当前计划，不调 LLM、不校验分镜）',
        !!r2.json?.data?.episode && Array.isArray(r2.json?.data?.storyboards), r2.text.slice(0, 160));
      cs.log('[观察项] LLM 音频规划仅在 bgm.mode=per_segment 且 planning=ai 时触发；本 wave DeepSeek 预算 0 次，未真实触发（wave2/3 已覆盖文本链路）');
    } else {
      cs.expect('无分镜剧集被业务校验拦截（400 EPISODE_AUDIO_PLAN_INVALID）', r2.status === 400, String(r2.status));
    }
    cs.log('[观察项] plan(force=true) LLM 生成主路径依赖 DeepSeek，本 wave 文本预算 0 次，未真实触发（wave2/wave3 已覆盖文本链路）');
  });

  // ============ TC-AUDIO-005 BGM 路径校验 ============
  results.TC_AUDIO_005 = await runCase(meta('TC-AUDIO-005', 'BGM 本地文件路径校验：目录穿越（../）被拒 400 EPISODE_AUDIO_PATH_INVALID', 'system', 'P1'), async (cs) => {
    const r1 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: { bgm: { local_path: '../../../etc/passwd.mp3' } },
    });
    cs.log(`目录穿越 -> ${r1.status} ${r1.text.slice(0, 200)}`);
    cs.eq('越界路径 400', r1.status, 400);
    cs.eq('错误码 EPISODE_AUDIO_PATH_INVALID', r1.json?.error?.code, 'EPISODE_AUDIO_PATH_INVALID');
    const r2 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: { bgm: { local_path: 'audio/not-exists.mp3' } },
    });
    cs.log(`存储内不存在文件 -> ${r2.status}`);
    cs.expect('存储内相对路径被接受（存在性不强制，登记语义）', r2.status === 200, String(r2.status));
  });

  // ============ TC-AUDIO-006 unlock_fields 校验 ============
  results.TC_AUDIO_006 = await runCase(meta('TC-AUDIO-006', 'unlock_fields 契约：非法字段名 400 STORYBOARD_AV_CONTRACT_INVALID；合法解锁后可再修改', 'system', 'P1'), async (cs) => {
    const r1 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: {}, unlock_fields: ['bgm.非法字段!'],
    });
    cs.log(`非法字段 -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.eq('非法字段 400', r1.status, 400);
    cs.eq('错误码 STORYBOARD_AV_CONTRACT_INVALID', r1.json?.error?.code, 'STORYBOARD_AV_CONTRACT_INVALID');
    const r2 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: {}, unlock_fields: ['bgm.mode'],
    });
    cs.eq('合法解锁 200', r2.status, 200);
    const plan = JSON.parse(q1('SELECT audio_plan FROM episodes WHERE id=?', CTX.episodeId).audio_plan || '{}');
    cs.expect('解锁后 field_state.locked=false 且 revision+1', plan.field_state?.['bgm.mode']?.locked === false && Number(plan.field_state?.['bgm.mode']?.revision) >= 1, JSON.stringify(plan.field_state?.['bgm.mode']));
    // unlock_fields 非数组
    const r3 = await api.beMethod('PATCH', `/api/v1/episodes/${CTX.episodeId}/audio-plan`, {
      audio_plan: {}, unlock_fields: 'bgm.mode',
    });
    cs.eq('unlock_fields 非数组 400', r3.status, 400);
  });

  // ============ TC-AUDIO-007 真实媒体文件与来源登记 ============
  results.TC_AUDIO_007 = await runCase(meta('TC-AUDIO-007', '真实媒体合成与来源登记：ffmpeg 合成 2s mp4（含音轨）→ source-video 登记 → ffprobe 真实解码', 'system', 'P0'), async (cs) => {
    const mp4 = makeMp4ViaFfmpeg(2, true);
    cs.expect('系统 ffmpeg 可用且合成真实 mp4', !!mp4, mp4 ? `${mp4.file} (${mp4.buf.length}B)` : 'ffmpeg 失败');
    if (!mp4) return;
    const pp = ffprobeDuration(mp4.file);
    cs.expect('合成产物 ffprobe 可解码：时长≈2s 且含音频流', pp.ok && Math.abs(pp.duration - 2) < 0.5 && pp.hasAudio, JSON.stringify({ dur: pp.duration, a: pp.hasAudio }));
    CTX.mp4 = mp4;
    // 登记到 AUDIO 项目（source-video 契约）
    const r = await api.be(`/api/v2/projects/${CTX.projectId}/episodes/source-video`, {
      episodeId: CTX.episodeId,
      name: 'QA-L3-合成片段2s.mp4',
      localPath: mp4.file,
      fileSize: mp4.buf.length,
      mimeType: 'video/mp4',
      mediaInfo: 'QA-L3 ffmpeg testsrc 320x240 15fps aac 440Hz',
    });
    cs.log(`source-video -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('登记 201', r.status, 201);
    const assetId = r.json?.data?.assetId;
    const row = q1("SELECT * FROM assets WHERE id=? AND type='video' AND category='source-video'", assetId);
    cs.expect('来源媒体落库 assets（source_meta 关联剧集）', !!row && JSON.parse(row.source_meta || '{}').episodeId === Number(CTX.episodeId), JSON.stringify({ id: row?.id }));
    cs.expect('登记引用真实文件（local_path 可读）', row && fs.existsSync(row.local_path), String(row?.local_path));
    // 校验分支：缺 name / episodeId 非法
    const e1 = await api.be(`/api/v2/projects/${CTX.projectId}/episodes/source-video`, { episodeId: CTX.episodeId });
    cs.eq('缺 name 400', e1.status, 400);
    const e2 = await api.be(`/api/v2/projects/${CTX.projectId}/episodes/source-video`, { episodeId: -1, name: 'x', localPath: mp4.file });
    cs.eq('episodeId 非法 400', e2.status, 400);
  });

  // ============ TC-AUDIO-008 finalize 真实合成（用 VIDEO 波次真实生成视频）============
  results.TC_AUDIO_008 = await runCase(meta('TC-AUDIO-008', 'finalize 真实成片合成：分镜真实视频 → ffmpeg 合并 → completed + merged_url + episodes.video_url + ffprobe', 'system', 'P0'), async (cs) => {
    if (!CTX.video?.episodeId) { cs.log('前置缺失：video-chain.json 不可用'); await cs.finish('blocked'); return; }
    const epId = CTX.video.episodeId;
    const realVideoId = CTX.video.videoId || CTX.video.videoId1;
    const vg = q1('SELECT id, status, local_path FROM video_generations WHERE id=?', realVideoId);
    // finalize 前将 BGM 模式归零（episode_track 需要真实 BGM 文件；本用例验证合成主链路本身）
    const bp = await api.beMethod('PATCH', `/api/v1/episodes/${epId}/audio-plan`, { audio_plan: { bgm: { mode: 'none' } } });
    cs.log(`finalize 前音频计划 bgm.mode=none -> ${bp.status}`);
    cs.expect('前置：VIDEO 波次真实生成记录为 review（合成输入就绪）', vg && vg.status === 'review', JSON.stringify({ id: vg?.id, s: vg?.status }));
    const f = await api.be(`/api/v1/episodes/${epId}/finalize`, {});
    cs.log(`finalize -> ${f.status} ${f.text.slice(0, 240)}`);
    cs.eq('finalize 200（任务受理）', f.status, 200);
    const mergeId = f.json?.data?.merge_id;
    cs.expect('返回 merge_id 与 task_id', !!mergeId && !!f.json?.data?.task_id, f.text.slice(0, 200));
    // 轮询合并任务（后台 ffmpeg）
    const fin = await pollUntil(async () => {
      const g = await api.be(`/api/v1/video-merges/${mergeId}`);
      const st = g.json?.data?.status;
      if (['completed', 'failed'].includes(st)) return { done: true, st, body: g.json?.data };
      return { done: false, st };
    }, { timeoutMs: 300000, intervalMs: 3000, label: 'merge' });
    cs.log(`merge 终态: ${fin.st} merged_url=${fin.body?.merged_url} err=${String(fin.body?.error_msg || '').slice(0, 160)}`);
    cs.expect('合并任务 completed', fin.st === 'completed', String(fin.st));
    const mergedUrl = fin.body?.merged_url;
    cs.expect('merged_url 已产出', !!mergedUrl, String(mergedUrl));
    const ep = q1('SELECT video_url, status FROM episodes WHERE id=?', epId);
    cs.expect('episodes.video_url 回写（数据流交接点：成片 → 剧集）', !!ep?.video_url, String(ep?.video_url));
    cs.eq('剧集状态 completed', ep?.status, 'completed');
    const mergeRow = q1('SELECT duration, upscale_job_id FROM video_merges WHERE id=?', mergeId);
    cs.expect('合并时长落库', Number(mergeRow?.duration) > 0, String(mergeRow?.duration));
    // 真实文件 ffprobe
    const rel = String(mergedUrl || '').replace(/^https?:\/\/[^/]+\/static\//, '').replace(/^\//, '');
    const abs = path.join(STORAGE_ROOT, rel);
    cs.expect('成片文件真实存在', fs.existsSync(abs), abs);
    const pp = ffprobeDuration(abs);
    cs.expect('成片 ffprobe 可解码且时长 > 0', pp.ok, JSON.stringify({ dur: pp.duration }));
    cs.expect('成片含视频流', pp.hasVideo === true, String(pp.hasVideo));
    cs.log(`成片元数据: duration=${pp.duration}s size=${fs.existsSync(abs) ? fs.statSync(abs).size : 0}B`);
    try { fs.copyFileSync(abs, path.join(ART_DIR, 'TC-AUDIO-008-finalized-episode.mp4')); } catch (_) {}
    CTX.finalUrl = mergedUrl; CTX.finalEpisode = epId;
  });

  // ============ TC-AUDIO-009 成片下载契约 ============
  results.TC_AUDIO_009 = await runCase(meta('TC-AUDIO-009', '成片下载契约：GET /episodes/:id/download 返回真实 video_url 且字节可访问', 'system', 'P1'), async (cs) => {
    if (!CTX.finalEpisode) { cs.log('前置缺失：finalize 未产出成片'); await cs.finish('blocked'); return; }
    const d = await api.be(`/api/v1/episodes/${CTX.finalEpisode}/download`);
    cs.eq('download 200', d.status, 200);
    const body = d.json?.data || {};
    cs.expect('返回 video_url 与标题', !!body.video_url && !!body.title, JSON.stringify(body).slice(0, 200));
    const u = String(body.video_url || '').replace(/^\/static\//, 'http://127.0.0.1:5679/static/');
    const fetchRes = await fetch(u.startsWith('http') ? u : 'http://127.0.0.1:5679' + (body.video_url.startsWith('/') ? body.video_url : '/' + body.video_url));
    const buf = Buffer.from(await fetchRes.arrayBuffer());
    cs.eq('成片 URL 字节可访问 200', fetchRes.status, 200);
    cs.expect('下载字节非空（真实文件）', buf.length > 0, `${buf.length}B`);
    const nf = await api.be('/api/v1/episodes/999999999/download');
    cs.eq('不存在剧集下载 404', nf.status, 404);
  });

  // ============ TC-AUDIO-010 merge_options 持久化（字幕/水印/混音配置面）============
  results.TC_AUDIO_010 = await runCase(meta('TC-AUDIO-010', '合并配置契约：字幕/水印/混音选项经 POST /video-merges 持久化并可回读', 'system', 'P1'), async (cs) => {
    const r = await api.be('/api/v1/video-merges', {
      episode_id: CTX.episodeId, drama_id: CTX.projectId,
      title: 'QA-L3 合并配置契约',
      scenes: [{ scene_id: 1, video_url: 'http://127.0.0.1:5679/static/nonexist.mp4', duration: 2 }],
      merge_options: {
        burn_narration_subtitles: true,
        burn_dialogue_audio: true,
        watermark_text: 'QA-L3 水印',
        bgm_mix: { enable: true, gain: 0.8 },
        upscale: { method: 'flash' },
      },
    });
    cs.log(`merge create -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.eq('创建 200', r.status, 200);
    const mergeId = r.json?.data?.merge_id;
    const row = q1('SELECT merge_options, status FROM video_merges WHERE id=?', mergeId);
    const opts = JSON.parse(row.merge_options || '{}');
    cs.expect('字幕烧录选项持久化', opts.burn_narration_subtitles === true, JSON.stringify(opts).slice(0, 200));
    cs.expect('对白混音选项持久化', opts.burn_dialogue_audio === true, '');
    cs.expect('水印文本持久化', opts.watermark_text === 'QA-L3 水印', opts.watermark_text);
    cs.expect('upscale 选项归一化保留', !!opts.upscale, JSON.stringify(opts.upscale));
    cs.expect('状态停在 pending（无 finalize 触发不消费）', row.status === 'pending', row.status);
    // 清理：删除该契约记录
    const del = await api.beMethod('DELETE', `/api/v1/video-merges/${mergeId}`);
    cs.eq('删除 200', del.status, 200);
  });

  // ============ TC-AUDIO-011 video-merges CRUD ============
  results.TC_AUDIO_011 = await runCase(meta('TC-AUDIO-011', 'video-merges 列表/详情/删除与 404：软删后不可见', 'system', 'P1'), async (cs) => {
    const l = await api.be('/api/v1/video-merges');
    cs.eq('list 200', l.status, 200);
    const items = l.json?.data?.items || l.json?.data || [];
    cs.expect('列表含 finalize 产出记录', Array.isArray(items) && items.length >= 1, `count=${Array.isArray(items) ? items.length : '?'}`);
    const target = Array.isArray(items) ? items[0] : null;
    if (target?.merge_id || target?.id) {
      const id = target.merge_id || target.id;
      const g = await api.be(`/api/v1/video-merges/${id}`);
      cs.eq('详情 200', g.status, 200);
      cs.eq('详情 id 回读', Number(g.json?.data?.id), Number(id));
    }
    const nf = await api.be('/api/v1/video-merges/999999999');
    cs.eq('不存在 404', nf.status, 404);
    const r = await api.be('/api/v1/video-merges', { episode_id: CTX.episodeId, drama_id: CTX.projectId, title: 'QA-L3 待删' });
    const mid = r.json?.data?.merge_id;
    const del = await api.beMethod('DELETE', `/api/v1/video-merges/${mid}`);
    cs.eq('删除 200', del.status, 200);
    const g2 = await api.be(`/api/v1/video-merges/${mid}`);
    cs.eq('删除后 404', g2.status, 404);
  });

  // ============ TC-AUDIO-012 TTS 日志打印密钥（documented PARTIAL）============
  results.TC_AUDIO_012 = await runCase(meta('TC-AUDIO-012', 'TTS 供应商覆盖 PARTIAL 现状：openai 分支日志打印 api_key（静态证据）；仅两类协议', 'system', 'P2'), async (cs) => {
    const src = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/ttsService.js'), 'utf8');
    const line = src.split('\n').findIndex((l) => l.includes('==c sxy synthesizeWithOpenai') && l.includes('api_key'));
    cs.expect('ttsService.js 存在打印 api_key 的 console.log（inventory INV-8.5 记录的严重问题，现状未修复）', line >= 0, `ttsService.js:${line + 1}`);
    const providers = [];
    if (/provider === 'minimax'/.test(src)) providers.push('minimax');
    if (/provider === 'openai'/.test(src)) providers.push('openai');
    cs.expect('协议覆盖仅 minimax/openai 两类（PARTIAL）', providers.length === 2, providers.join(','));
    cs.expect('其余 provider 抛「不支持的 TTS provider」', /不支持的 TTS provider/.test(src), 'grep');
    cs.log('[观察项] 运行时未触发该日志路径：当前无 TTS 配置（TC-AUDIO-001 已验证错误路径先于 provider 分支）');
  });

  // ============ TC-AUDIO-013 音频上传 ============
  results.TC_AUDIO_013 = await runCase(meta('TC-AUDIO-013', '音频上传接口：真实 WAV 上传成功落盘；非音频 MIME 拒绝', 'system', 'P2'), async (cs) => {
    const wav = makeWav(1);
    const r = await postMultipart('/api/v1/upload/audio', {}, 'file', 'qa-l3-voice.wav', wav, 'audio/wav');
    cs.log(`wav upload -> ${r.status} ${r.text.slice(0, 200)}`);
    cs.expect('真实 WAV 上传成功（200/201）', [200, 201].includes(r.status), String(r.status));
    const rel = r.json?.data?.local_path;
    if (rel) {
      const abs = path.join(STORAGE_ROOT, String(rel));
      cs.expect('音频文件真实落盘且大小一致', fs.existsSync(abs) && fs.statSync(abs).size === wav.length, `${fs.existsSync(abs) ? fs.statSync(abs).size : 0}/${wav.length}B`);
    }
    const bad = await postMultipart('/api/v1/upload/audio', {}, 'file', 'qa-l3-note.txt', Buffer.from('not audio'), 'text/plain');
    cs.log(`txt upload -> ${bad.status} ${bad.text.slice(0, 160)}`);
    cs.expect('非音频 MIME 被拒绝', bad.status >= 400, String(bad.status));
  });

  // ============ TC-AUDIO-014 finalize 无视频片段降级 ============
  results.TC_AUDIO_014 = await runCase(meta('TC-AUDIO-014', 'finalize 降级路径：剧集无任何视频片段 → 明确返回「本集没有可合成的视频片段」（不崩溃不悬挂）', 'system', 'P1'), async (cs) => {
    const f = await api.be(`/api/v1/episodes/${CTX.emptyEpisodeId}/finalize`, {});
    cs.log(`finalize(空集) -> ${f.status} ${f.text.slice(0, 240)}`);
    cs.eq('200 + 明确提示', f.status, 200);
    cs.expect('message 说明无可合成片段', /没有可合成的视频片段/.test(f.text), f.text.slice(0, 200));
    cs.expect('不产生 merge 记录', f.json?.data?.merge_id === null, JSON.stringify(f.json?.data));
    const ep = q1('SELECT status, video_url FROM episodes WHERE id=?', CTX.emptyEpisodeId);
    cs.expect('剧集状态未被误置 completed', ep?.status !== 'completed' && !ep?.video_url, JSON.stringify({ s: ep?.status }));
  });

  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 AUDIO] passed=${passed} failed=${failed} blocked=${blocked}`);
})();
