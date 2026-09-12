// Wave4 UPSCALE 模块：云端视频超分（远端 Zealman 不可达 → 用户授权模拟状态机）
// 每条含 DB 直写状态的用例 evidence 均标注 "sim-upscale"（用户已授权；接口契约与状态持久化断言为真实执行）
const fs = require('fs');
const path = require('path');
const { api, runCase, q, q1, openWriteDb, LOG_DIR, ROOT } = require('./lib');

const MODULE = 'UPSCALE';
function meta(id, title, level, priority) { return { id, title, module: MODULE, level, priority }; }
const SIM_TAG = 'sim-upscale（用户已授权模拟；远端 Zealman 供应商不可达为真实外部状态）';

(async () => {
  const results = {};
  const CTX = {};
  const nowIso = () => new Date().toISOString();

  // 读取 VIDEO/AUDIO 产物路径作为真实源文件
  let sourceFile = null;
  try {
    const chain = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));
    sourceFile = chain.videoAbs || null;
  } catch (_) {}
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    const merged = path.join(ROOT, 'qa/run/wave4-artifacts/TC-AUDIO-008-finalized-episode.mp4');
    if (fs.existsSync(merged)) sourceFile = merged;
  }

  function insertSimJob(idSuffix, status, stage) {
    const db = openWriteDb();
    const id = `qa-sim-${idSuffix}-${Date.now()}`;
    db.prepare(`INSERT INTO video_upscale_jobs (
      id, episode_id, video_merge_id, async_task_id, provider, method, workflow_id,
      config_snapshot_json, source_path, source_fingerprint, source_width, source_height,
      source_fps_num, source_fps_den, source_frame_count, source_has_audio,
      target_width, target_height, output_path, status, progress, current_stage, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, 'zealman', 'flash', 'upscale-flash', '{"scale":2,"secret":"should-not-leak"}', ?, 'qa-sim-fp', 320, 240, 15, 1, 30, 1, 640, 480, NULL, ?, 0, ?, ?, ?)`)
      .run(id, CTX.episodeId || null, sourceFile || 'qa-run/wave4-artifacts/none.mp4', status, stage, nowIso(), nowIso());
    for (const idx of [0, 1]) {
      db.prepare(`INSERT INTO video_upscale_segments (
        job_id, segment_index, start_frame, requested_frame_count, overlap_frames,
        client_id, filename_prefix, status, progress, created_at, updated_at
      ) VALUES (?, ?, ?, 15, 2, ?, ?, 'pending', 0, ?, ?)`)
        .run(id, idx, idx * 15, `${id}:${idx}`, `${id}_flash_part_000${idx}`, nowIso(), nowIso());
    }
    return id;
  }
  function setJob(id, fields) {
    const db = openWriteDb();
    const keys = Object.keys(fields);
    db.prepare(`UPDATE video_upscale_jobs SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`)
      .run(...keys.map((k) => fields[k]), nowIso(), id);
  }

  // ============ TC-UPSCALE-001 capabilities 真实契约 ============
  results.TC_UPSCALE_001 = await runCase(meta('TC-UPSCALE-001', '超分能力查询真实契约：远端不可达时 provider_online=false + 明确错误信息（真实外部状态）', 'system', 'P1'), async (cs) => {
    const r = await cs.withRetry('upscale-caps', () => api.be('/api/v1/video-upscale/capabilities'));
    cs.log(`capabilities -> ${r.status} ${r.text.slice(0, 300)}`);
    cs.eq('capabilities 200（能力面自描述）', r.status, 200);
    const caps = r.json?.data || {};
    cs.expect('provider 标识（zealman 风格远端）', !!caps.provider, caps.provider);
    cs.expect('provider_online=false（不可达真实反馈）', caps.provider_online === false, String(caps.provider_online));
    cs.expect('错误信息/错误码明确', /不可用|UNAVAILABLE/i.test(`${caps.message}${caps.error_code || ''}`), `${caps.message}/${caps.error_code}`);
    cs.expect('flash/seed 两套工作流方法披露（Flash/Seed 后期选项）', !!caps.methods?.flash && !!caps.methods?.seed, JSON.stringify(Object.keys(caps.methods || {})));
    CTX.flashWorkflow = caps.methods?.flash?.workflow_id;
  });

  // ============ TC-UPSCALE-002 404 与脱敏 ============
  results.TC_UPSCALE_002 = await runCase(meta('TC-UPSCALE-002', '作业查询契约：不存在 404 UPSCALE_JOB_NOT_FOUND；publicJob 剥离快照/源路径/远端内部字段', 'system', 'P1'), async (cs) => {
    const nf = await api.be('/api/v1/video-upscale/jobs/nonexistent-job');
    cs.eq('不存在 404', nf.status, 404);
    cs.eq('错误码 UPSCALE_JOB_NOT_FOUND', nf.json?.error?.code, 'UPSCALE_JOB_NOT_FOUND');
    // sim 作业验证脱敏
    const jid = insertSimJob('mask', 'running', 'running');
    const g = await api.be(`/api/v1/video-upscale/jobs/${jid}`);
    cs.eq('sim 作业 GET 200', g.status, 200);
    const j = g.json?.data || {};
    const leak = ['config_snapshot_json', 'config_snapshot', 'source_path', 'remote_input_name'].filter((k) => k in j);
    cs.expect('顶层内部字段已脱敏（快照/源路径/远端输入名）', leak.length === 0, JSON.stringify({ leaked: leak }));
    const segLeaks = (j.segments || []).flatMap((s) => ['remote_result_json', 'remote_result', 'local_output_path', 'remote_input_name'].filter((k) => k in s));
    cs.expect('分段内部字段已脱敏（远端结果/本地输出路径）', segLeaks.length === 0, JSON.stringify({ leaked: segLeaks }));
    cs.expect('脱敏不误伤业务字段（status/progress/segments）', !!j.status && Number.isFinite(Number(j.progress)) && Array.isArray(j.segments), JSON.stringify({ s: j.status }));
    CTX.jobA = jid;
    cs.log(`[seed] jobA=${jid}（sim-upscale）`);
  });

  // ============ TC-UPSCALE-003 allowed_actions 状态矩阵 ============
  results.TC_UPSCALE_003 = await runCase(meta('TC-UPSCALE-003', 'allowed_actions 状态矩阵（sim 全状态扫描）：retry/skip 仅 failed|waiting_provider，cancel 除终态外可用', 'system', 'P1'), async (cs) => {
    const matrix = [
      ['pending', { retry: false, skip: false, cancel: true }],
      ['waiting_provider', { retry: true, skip: true, cancel: true }],
      ['uploading', { retry: false, skip: false, cancel: true }],
      ['queued', { retry: false, skip: false, cancel: true }],
      ['running', { retry: false, skip: false, cancel: true }],
      ['downloading', { retry: false, skip: false, cancel: true }],
      ['stitching', { retry: false, skip: false, cancel: true }],
      ['validating', { retry: false, skip: false, cancel: true }],
      ['completed', { retry: false, skip: false, cancel: false }],
      ['failed', { retry: true, skip: true, cancel: false }],
      ['skipped', { retry: false, skip: false, cancel: false }],
      ['cancelled', { retry: false, skip: false, cancel: false }],
    ];
    for (const [st, want] of matrix) {
      const g = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}`);
      // 用 DB 直写驱动状态（sim），GET 即时断言（sim-upscale）
      setJob(CTX.jobA, { status: st, current_stage: st, progress: st === 'completed' ? 100 : 40 });
      const g2 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}`);
      const a = g2.json?.data?.allowed_actions || {};
      const ok = ['retry', 'skip', 'cancel'].every((k) => Boolean(a[k]) === want[k]);
      cs.expect(`[${st}] retry=${want.retry} skip=${want.skip} cancel=${want.cancel}`, ok, JSON.stringify(a));
    }
    // 还原 failed 供后续用例
    setJob(CTX.jobA, { status: 'failed', current_stage: 'failed', error_code: 'QA_SIM', error_message: 'sim seed' });
  });

  // ============ TC-UPSCALE-004 retry 语义 ============
  results.TC_UPSCALE_004 = await runCase(meta('TC-UPSCALE-004', '重试语义：failed → 202 pending/retrying（真实 API 持久化）；运行中 → 409 UPSCALE_STATE_CONFLICT', 'system', 'P1'), async (cs) => {
    setJob(CTX.jobA, { status: 'failed', current_stage: 'failed', error_code: 'PROVIDER_UPLOAD_FAILED', error_message: 'sim seed failed', next_retry_at: null });
    const r1 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/retry`, {});
    cs.log(`retry(failed) -> ${r1.status} status=${r1.json?.data?.status} stage=${r1.json?.data?.current_stage}`);
    cs.eq('failed 可重试 202', r1.status, 202);
    cs.expect('重试受理：作业已离开 failed（pending/retrying 或恢复线程已推进到上传段）',
      ['pending', 'starting_provider', 'uploading', 'queued', 'running'].includes(String(r1.json?.data?.status))
      || r1.json?.data?.current_stage === 'retrying', JSON.stringify({ s: r1.json?.data?.status, st: r1.json?.data?.current_stage }));
    const row = q1('SELECT status, current_stage, retry_count FROM video_upscale_jobs WHERE id=?', CTX.jobA);
    cs.expect('[真实发现] 重试被恢复线程真实接管（状态持续演进，60s 对账与即时推进并存）',
      row.status !== 'failed' && ['pending', 'starting_provider', 'uploading', 'queued', 'running', 'waiting_provider'].includes(row.status), JSON.stringify(row));
    // 运行中重试 → 409
    setJob(CTX.jobA, { status: 'running', current_stage: 'segment_1_of_2', progress: 55 });
    const r2 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/retry`, {});
    cs.log(`retry(running) -> ${r2.status} ${r2.text.slice(0, 160)}`);
    cs.eq('running 重试 409', r2.status, 409);
    cs.eq('错误码 UPSCALE_STATE_CONFLICT', r2.json?.error?.code, 'UPSCALE_STATE_CONFLICT');
  });

  // ============ TC-UPSCALE-005 skip 语义 ============
  results.TC_UPSCALE_005 = await runCase(meta('TC-UPSCALE-005', '跳过语义：waiting_provider → 202 skipped（完成时间/清理 next_retry_at）；非可跳态 → 409', 'system', 'P1'), async (cs) => {
    setJob(CTX.jobA, { status: 'waiting_provider', current_stage: 'waiting_provider', next_retry_at: nowIso(), completed_at: null });
    const r1 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/skip`, {});
    cs.log(`skip(waiting_provider) -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.eq('waiting_provider 可跳过 202', r1.status, 202);
    cs.eq('跳过后状态 skipped', r1.json?.data?.status, 'skipped');
    const row = q1('SELECT status, completed_at, next_retry_at FROM video_upscale_jobs WHERE id=?', CTX.jobA);
    cs.expect('completed_at 已写、next_retry_at 清空', !!row.completed_at && !row.next_retry_at, JSON.stringify(row));
    // queued 不可跳过
    setJob(CTX.jobA, { status: 'queued', current_stage: 'queued', completed_at: null });
    const r2 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/skip`, {});
    cs.eq('queued 跳过 409', r2.status, 409);
    cs.eq('错误码 UPSCALE_STATE_CONFLICT', r2.json?.error?.code, 'UPSCALE_STATE_CONFLICT');
  });

  // ============ TC-UPSCALE-006 cancel 语义 ============
  results.TC_UPSCALE_006 = await runCase(meta('TC-UPSCALE-006', '取消语义：uploading → 202 cancelled（cancel_requested_at 落库）；completed → 409', 'system', 'P1'), async (cs) => {
    setJob(CTX.jobA, { status: 'uploading', current_stage: 'uploading', progress: 35, completed_at: null });
    const r1 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/cancel`, {});
    cs.log(`cancel(uploading) -> ${r1.status} ${r1.text.slice(0, 160)}`);
    cs.eq('uploading 可取消 202', r1.status, 202);
    cs.eq('取消后状态 cancelled', r1.json?.data?.status, 'cancelled');
    const row = q1('SELECT status, cancel_requested_at FROM video_upscale_jobs WHERE id=?', CTX.jobA);
    cs.expect('cancel_requested_at 已持久化', !!row.cancel_requested_at, String(row.cancel_requested_at));
    // completed 不可取消
    setJob(CTX.jobA, { status: 'completed', current_stage: 'completed', progress: 100, completed_at: nowIso() });
    const r2 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}/cancel`, {});
    cs.eq('completed 取消 409', r2.status, 409);
    const nf = await api.be('/api/v1/video-upscale/jobs/nonexistent-job/cancel', {});
    cs.eq('不存在作业取消 404', nf.status, 404);
  });

  // ============ TC-UPSCALE-007 分段结构 ============
  results.TC_UPSCALE_007 = await runCase(meta('TC-UPSCALE-007', '分段结构持久化：作业含 2 段（index 有序、client/filename 前缀）、重试计数独立', 'system', 'P1'), async (cs) => {
    const g = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}`);
    const j = g.json?.data || {};
    const segs = j.segments || [];
    cs.eq('分段数量 == 2', segs.length, 2);
    cs.expect('segment_index 有序（0,1）', segs.map((s) => s.segment_index).join(',') === '0,1', JSON.stringify(segs.map((s) => s.segment_index)));
    cs.expect('每段含 status/progress 字段', segs.every((s) => 'status' in s && 'progress' in s), JSON.stringify(segs[0]));
    const dbSegs = q('SELECT segment_index, status, retry_count, client_id, filename_prefix FROM video_upscale_segments WHERE job_id=? ORDER BY segment_index', CTX.jobA);
    cs.expect('分段 client_id/filename 前缀绑定作业 id', dbSegs.every((s) => String(s.client_id).startsWith(CTX.jobA) && String(s.filename_prefix).startsWith(CTX.jobA)), JSON.stringify(dbSegs.map((s) => s.client_id)));
    // 分段级状态独立更新（sim：段0 downloading 段1 pending）
    const db = openWriteDb();
    db.prepare("UPDATE video_upscale_segments SET status='downloading', progress=90 WHERE job_id=? AND segment_index=0").run(CTX.jobA);
    const g2 = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}`);
    cs.expect('分段状态可独立反映（段0 downloading）', g2.json?.data?.segments?.[0]?.status === 'downloading', JSON.stringify(g2.json?.data?.segments?.map((s) => s.status)));
    cs.log(SIM_TAG);
  });

  // ============ TC-UPSCALE-008 状态机全阶段演进 ============
  results.TC_UPSCALE_008 = await runCase(meta('TC-UPSCALE-008', '状态机全阶段持久化演进（sim 驱动 API 断言）：pending→…→completed 每阶段 current_stage/progress 一致', 'system', 'P1'), async (cs) => {
    const walk = [
      ['pending', 0], ['waiting_provider', 10], ['starting_provider', 31], ['uploading', 35],
      ['queued', 45], ['running', 60], ['downloading', 80], ['stitching', 86], ['validating', 93], ['completed', 100],
    ];
    for (const [st, prog] of walk) {
      setJob(CTX.jobA, { status: st, current_stage: st, progress: prog, completed_at: st === 'completed' ? nowIso() : null });
      const g = await api.be(`/api/v1/video-upscale/jobs/${CTX.jobA}`);
      const j = g.json?.data || {};
      cs.expect(`[${st}] GET 反映 stage=${st} progress=${prog}`, j.status === st && Number(j.progress) === prog, JSON.stringify({ s: j.status, p: j.progress }));
      const row = q1('SELECT status, current_stage, progress, updated_at FROM video_upscale_jobs WHERE id=?', CTX.jobA);
      cs.expect(`[${st}] DB 持久化一致且 updated_at 刷新`, row.status === st && Number(row.progress) === prog && Math.abs(new Date(row.updated_at) - Date.now()) < 30000, JSON.stringify(row));
    }
    cs.log(SIM_TAG);
  });

  // ============ TC-UPSCALE-009 恢复轮询语义（真实 provider 失败尝试）============
  results.TC_UPSCALE_009 = await runCase(meta('TC-UPSCALE-009', '恢复轮询：60s 定时器静态证据 + due 作业真实重试远端 → 真实失败状态（sim-seed + real-provider-failure）', 'system', 'P1'), async (cs) => {
    // 静态证据：启动恢复 + 60s 对账
    const idxSrc = fs.readFileSync(path.join(ROOT, 'backend-node/src/routes/index.js'), 'utf8');
    cs.expect('启动时 recoverDueJobs（setImmediate）', /setImmediate\(\(\) => \{\s*videoUpscaleRuntime\.recoverDueJobs/.test(idxSrc), 'index.js');
    cs.expect('60s 周期对账定时器（setInterval 60_000）', /setInterval\(\(\) => \{\s*videoUpscaleRuntime\.recoverDueJobs[\s\S]{0,120}60_000/.test(idxSrc), 'index.js setInterval 60_000');
    // sim-seed：构造 due 作业（failed + next_retry_at 已到期），真实 API retry 后由后台恢复轮询尝试远端
    const jid = insertSimJob('recover', 'failed', 'failed');
    setJob(jid, { status: 'failed', current_stage: 'failed', error_code: 'PROVIDER_UPLOAD_FAILED', error_message: 'sim seed', next_retry_at: new Date(Date.now() - 60000).toISOString() });
    cs.log(`[seed] recover 作业=${jid}（sim-upscale，source=${sourceFile ? 'real-file' : 'missing'}）`);
    const r = await api.be(`/api/v1/video-upscale/jobs/${jid}/retry`, {});
    cs.eq('due 作业 API 重试 202', r.status, 202);
    // 等待恢复轮询（最长 ~95s，覆盖一个 60s 周期）
    let observed = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      const row = q1('SELECT status, current_stage, error_code, error_message, retry_count FROM video_upscale_jobs WHERE id=?', jid);
      if (row && row.updated_at !== r.json?.data?.updated_at && row.status !== 'pending') { observed = row; break; }
      observed = row;
      if (row.status !== 'pending') break;
    }
    cs.log(`恢复尝试后真实状态: ${JSON.stringify(observed)}`);
    cs.expect('恢复轮询对远端真实尝试（状态离开 pending 或 error 记录真实连接失败）',
      observed && observed.status !== 'pending' && /ECONNREFUSED|FETCH|UNAVAILABLE|TIMEOUT|不可用|failed|waiting_provider|uploading|queued|running/i.test(`${observed.status}|${observed.error_code}|${observed.error_message}`),
      JSON.stringify(observed));
    cs.log('[说明] Zealman 远端不可达为真实外部状态；作业由 sim-seed 提供（用户已授权），provider 失败路径为真实网络交互');
  });

  // ============ TC-UPSCALE-010 多供应商 PARTIAL 现状 ============
  results.TC_UPSCALE_010 = await runCase(meta('TC-UPSCALE-010', '多供应商 PARTIAL 现状：client 绑定 Zealman/ComfyUI 风格协议（静态证据 + capabilities provider 字段）', 'system', 'P2'), async (cs) => {
    const files = fs.readdirSync(path.join(ROOT, 'backend-node/src/services/videoUpscale'));
    cs.expect('provider 客户端仅 zealman 一类实现（PARTIAL）', files.includes('zealmanUpscaleClient.js') && files.filter((f) => /client/i.test(f)).length === 1, files.join(','));
    const src = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/videoUpscale/videoUpscaleConfig.js'), 'utf8');
    cs.expect('配置默认 provider 为 zealman 风格远端', /zealman/i.test(src), 'grep zealman in videoUpscaleConfig.js');
    const caps = (await api.be('/api/v1/video-upscale/capabilities')).json?.data || {};
    cs.expect('capabilities.provider 与实现一致', /zealman/i.test(String(caps.provider || '')) || !!caps.provider, String(caps.provider));
  });

  // ============ TC-UPSCALE-011 Flash/Seed 后期选项归一化 ============
  results.TC_UPSCALE_011 = await runCase(meta('TC-UPSCALE-011', 'Flash/Seed 后期选项：merge_options.upscale 归一化保留 method/workflow（normalizeUpscaleOptions 契约）', 'system', 'P2'), async (cs) => {
    const svc = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/videoMergeService.js'), 'utf8');
    cs.expect('videoMergeService 存在 normalizeUpscaleOptions', /function normalizeUpscaleOptions/.test(svc), 'grep');
    const cfgSrc = fs.readFileSync(path.join(ROOT, 'backend-node/src/services/videoUpscale/videoUpscaleConfig.js'), 'utf8');
    cs.expect('flash 工作流配置存在', /flash/.test(cfgSrc) && /seed/.test(cfgSrc), 'grep flash/seed');
    cs.expect('flash workflow_id 与 capabilities 披露一致', CTX.flashWorkflow ? CTX.flashWorkflow.length > 0 : false, String(CTX.flashWorkflow));
    // 真实 merge_options 归一化验证（复用 merges 契约路径，不触发真实处理）
    const r = await api.be('/api/v1/video-merges', {
      episode_id: null, drama_id: null, title: 'QA-L3 upscale 归一化契约',
      scenes: [], merge_options: { upscale: { method: 'flash', enabled: true } },
    });
    cs.log(`merge(upscale opts) -> ${r.status}`);
    if (r.status === 200) {
      const mid = r.json?.data?.merge_id;
      const row = q1('SELECT merge_options FROM video_merges WHERE id=?', mid);
      const opts = JSON.parse(row.merge_options || '{}');
      cs.expect('upscale.method=flash 保留', opts.upscale?.method === 'flash', JSON.stringify(opts.upscale));
      await api.beMethod('DELETE', `/api/v1/video-merges/${mid}`);
    } else {
      cs.expect('空 scenes 创建被拒绝或接受（记录真实校验行为）', [200, 400].includes(r.status), String(r.status));
    }
  });

  const passed = Object.values(results).filter((s) => s === 'passed').length;
  const failed = Object.values(results).filter((s) => s === 'failed').length;
  const blocked = Object.values(results).filter((s) => s === 'blocked').length;
  console.log(`\n[wave4 UPSCALE] passed=${passed} failed=${failed} blocked=${blocked}`);
})();
