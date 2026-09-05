const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const { executePostproduction } = require('../director/directorPostproductionService');

let configuredVideoUpscaleRuntime = null;

function configureVideoUpscaleRuntime(runtime) {
  configuredVideoUpscaleRuntime = runtime || null;
}

function normalizeUpscaleOptions(value) {
  const input = value && typeof value === 'object' ? value : {};
  const method = String(input.method || 'flash').toLowerCase();
  if (!['flash', 'seed'].includes(method)) throw new Error('超分模式必须是 flash 或 seed');
  return {
    enabled: input.enabled === true,
    method,
    failure_policy: 'wait_for_action',
  };
}

async function runFinalizationStages(input, deps) {
  let outputPath = input.baseVideoPath;
  let upscaleJobId = null;
  let upscaleSkipped = false;
  if (input.upscale?.enabled) {
    const upscale = await deps.runUpscale({ sourcePath: outputPath, method: input.upscale.method });
    upscaleJobId = upscale.jobId || upscale.id || null;
    if (upscale.status === 'skipped') {
      upscaleSkipped = true;
    } else if (upscale.status === 'cancelled') {
      return { status: 'cancelled', outputPath, upscaleJobId, upscaleSkipped: false };
    } else if (upscale.status !== 'completed') {
      return { status: 'waiting_upscale', outputPath, upscaleJobId, upscaleSkipped: false };
    } else {
      const completedOutput = upscale.outputPath || upscale.output_path;
      if (!completedOutput) {
        const error = new Error('云端超分已完成，但没有返回输出文件');
        error.code = 'UPSCALE_OUTPUT_MISSING';
        throw error;
      }
      outputPath = completedOutput;
    }
  }
  if (input.postProcessNeeded) {
    const post = await deps.runPostProcess(outputPath);
    if (!post?.ok) throw new Error(post?.error || '合并后处理失败');
    outputPath = post.outputPath || post.output_path || outputPath;
  }
  return { status: 'completed', outputPath, upscaleJobId, upscaleSkipped };
}

function list(db, query) {
  let sql = 'FROM video_merges WHERE deleted_at IS NULL';
  const params = [];
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(query.episode_id);
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC').all(...params);
  return rows.map(rowToItem);
}

function rowToItem(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    drama_id: r.drama_id,
    title: r.title,
    provider: r.provider,
    status: r.status,
    merged_url: r.merged_url,
    duration: r.duration ?? undefined,
    task_id: r.task_id,
    upscale_job_id: r.upscale_job_id || undefined,
    base_merged_url: r.base_merged_url || undefined,
    error_msg: r.error_msg ?? undefined,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const taskService = require('./taskService');
  const task = taskService.createTask(db, log, 'video_merge', String(req.episode_id || ''));
  const mergeOptionsJson = (() => {
    const o = req.merge_options;
    if (o && typeof o === 'object') return JSON.stringify(o);
    return '{}';
  })();
  const info = db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    Number(req.episode_id) || 0,
    Number(req.drama_id) || 0,
    req.title ?? null,
    req.provider || 'ffmpeg',
    req.model ?? null,
    req.scenes ? JSON.stringify(req.scenes) : '[]',
    mergeOptionsJson,
    task.id,
    now
  );
  return { merge_id: info.lastInsertRowid, task_id: task.id, ...getById(db, info.lastInsertRowid) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

function runProcess(file, args) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => resolve({ code: null, stdout, stderr, error: error.message }));
    child.once('exit', code => resolve({ code, stdout, stderr, error: null }));
  });
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function executePersistedTimeline(timeline, {
  runProcess: runner = runProcess,
  ffmpegPath = getFfmpegPath(),
  ffprobePath = getFfprobePath(),
} = {}) {
  let manifest;
  try {
    manifest = JSON.parse(timeline.manifest_json || '{}');
  } catch (error) {
    return { ok: false, error: `Invalid Director timeline manifest: ${error.message}` };
  }
  if (!Array.isArray(manifest.commandArgs)) {
    return { ok: false, error: 'Director timeline manifest is missing commandArgs' };
  }
  const ffmpeg = await runner(ffmpegPath, manifest.commandArgs);
  if (ffmpeg.code !== 0) {
    return { ok: false, error: ffmpeg.stderr || ffmpeg.error || `ffmpeg exited ${ffmpeg.code}` };
  }
  const probeArgs = ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', timeline.output_path];
  const probe = await runner(ffprobePath, probeArgs);
  if (probe.code !== 0) {
    return { ok: false, error: probe.stderr || probe.error || `ffprobe exited ${probe.code}` };
  }
  let ffprobe;
  try {
    ffprobe = JSON.parse(probe.stdout);
  } catch (error) {
    return { ok: false, error: `ffprobe returned invalid JSON: ${error.message}` };
  }
  if (!fs.existsSync(timeline.output_path)) {
    return { ok: false, error: `Director timeline output is missing: ${timeline.output_path}` };
  }
  return { ok: true, outputSha256: hashFile(timeline.output_path), ffprobe };
}

/** Execute a persisted Director timeline without changing the legacy scene merge path. */
async function processDirectorTimeline(db, log, timelineId, options = {}) {
  const timeline = db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId);
  if (!timeline) throw new Error(`Director timeline not found: ${timelineId}`);
  const result = options.runCommand
    ? await options.runCommand({ timeline, command: timeline.ffmpeg_command })
    : await executePersistedTimeline(timeline, options);
  const now = new Date().toISOString();
  if (!result?.ok) {
    db.prepare("UPDATE director_timelines SET status = 'failed', manifest_json = ?, created_at = created_at WHERE id = ?")
      .run(JSON.stringify({ error: result?.error || 'FFmpeg failed', failedAt: now }), timelineId);
    if (log?.warn) log.warn('Director timeline failed', { timeline_id: timelineId, error: result?.error });
    return db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId);
  }
  let finalResult = result;
  let finalOutputPath = timeline.output_path;
  let manifest = {};
  try { manifest = JSON.parse(timeline.manifest_json || '{}'); } catch (_) { manifest = {}; }
  if (manifest.postproduction) {
    try {
      const post = await executePostproduction({
        plan: manifest.postproduction,
        ffmpegPath: options.ffmpegPath || getFfmpegPath(),
        probePath: options.ffprobePath || getFfprobePath(),
        runCommand: async (file, args) => {
          if (options.runProcess) return options.runProcess(file, args);
          return runProcess(file, args);
        },
      });
      finalResult = { ok: true, outputSha256: post.outputSha256 || result.outputSha256, ffprobe: result.ffprobe, postproduction: post };
      finalOutputPath = post.outputPath;
    } catch (error) {
      db.prepare("UPDATE director_timelines SET status = 'failed', manifest_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...manifest, postproductionError: error.message }), timelineId);
      if (log?.warn) log.warn('Director timeline postproduction failed', { timeline_id: timelineId, error: error.message });
      return db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId);
    }
  }
  const outputSha256 = finalResult.outputSha256;
  const outputProbe = finalResult.postproduction?.probe || finalResult.ffprobe;
  if (finalResult.postproduction) {
    manifest.postproductionResult = {
      outputPath: finalResult.postproduction.outputPath,
      outputSha256: finalResult.postproduction.outputSha256,
      quality: finalResult.postproduction.quality,
    };
    db.prepare('UPDATE director_timelines SET manifest_json = ? WHERE id = ?')
      .run(JSON.stringify(manifest), timelineId);
  }
  if (finalOutputPath !== timeline.output_path) {
    db.prepare('UPDATE director_timelines SET output_path = ? WHERE id = ?').run(finalOutputPath, timelineId);
  }
  db.prepare("UPDATE director_timelines SET status = 'completed', output_sha256 = ?, ffprobe_json = ? WHERE id = ?")
    .run(outputSha256 || null, outputProbe ? JSON.stringify(outputProbe) : null, timelineId);
  if (log?.info) log.info('Director timeline completed', { timeline_id: timelineId, output: timeline.output_path });
  return db.prepare('SELECT * FROM director_timelines WHERE id = ?').get(timelineId);
}

/** 获取 storage 根目录（绝对路径） */
function getStorageRoot() {
  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function toStorageReference(filePath, storageRoot) {
  const relative = path.relative(storageRoot, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replace(/\\/g, '/');
  return filePath;
}

function fromStorageReference(value, storageRoot) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(storageRoot, String(value).replace(/\//g, path.sep));
}

async function finalizeMergedLocalVideo(db, log, {
  mergeRow, scenes, mergeOpts, storageRoot, baseVideoPath, totalDuration,
}) {
  const taskService = require('./taskService');
  const taskId = mergeRow.task_id;
  const baseReference = toStorageReference(baseVideoPath, storageRoot);
  const upscale = normalizeUpscaleOptions(mergeOpts.upscale);
  let episodeTrackRequested = false;
  try {
    const episode = db.prepare('SELECT audio_plan FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(mergeRow.episode_id));
    const audioPlan = JSON.parse(episode?.audio_plan || '{}');
    episodeTrackRequested = audioPlan?.bgm?.mode === 'episode_track';
  } catch (_) {}
  db.prepare('UPDATE video_merges SET base_merged_url = ? WHERE id = ?').run(baseReference, mergeRow.id);
  const postNeed =
    !!mergeOpts.burn_narration_subtitles
    || !!mergeOpts.burn_dialogue_audio
    || episodeTrackRequested
    || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());

  const stage = await runFinalizationStages({
    baseVideoPath,
    upscale,
    postProcessNeeded: postNeed,
  }, {
    runUpscale: async ({ sourcePath, method }) => {
      if (!configuredVideoUpscaleRuntime) throw new Error('云端超分运行时未初始化');
      let job = mergeRow.upscale_job_id ? configuredVideoUpscaleRuntime.getJob(mergeRow.upscale_job_id) : null;
      if (!job) {
        const ext = path.extname(sourcePath) || '.mp4';
        const outputPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, ext)}_${method}_2x${ext}`);
        job = await configuredVideoUpscaleRuntime.createAndRun({
          episodeId: mergeRow.episode_id,
          videoMergeId: mergeRow.id,
          asyncTaskId: taskId,
          sourcePath,
          outputPath,
          method,
        });
      }
      return {
        status: job.status,
        jobId: job.id,
        outputPath: job.output_path,
      };
    },
    runPostProcess: async (inputPath) => {
      const mergedPP = require('./mergedEpisodePostProcess');
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath: inputPath,
        storageRoot,
        scenes,
        episodeId: mergeRow.episode_id,
        mergeOpts,
        preserveInput: true,
      });
      return {
        ...post,
        outputPath: post.relativePath ? fromStorageReference(post.relativePath, storageRoot) : inputPath,
      };
    },
  });

  if (stage.status === 'waiting_upscale') {
    const job = stage.upscaleJobId ? configuredVideoUpscaleRuntime.getJob(stage.upscaleJobId) : null;
    const message = job?.status === 'failed'
      ? `云端超分失败：${job.error_message || job.error_code || '未知错误'}，可重试或跳过`
      : '等待云端超分设备，设备启动后将自动恢复';
    db.prepare('UPDATE video_merges SET status = ?, upscale_job_id = ?, error_msg = ? WHERE id = ?')
      .run('waiting_upscale', stage.upscaleJobId, message, mergeRow.id);
    if (taskId) taskService.updateTaskStatus(db, taskId, 'processing', Math.max(35, Number(job?.progress || 0)), message);
    return { deferred: true, upscaleJobId: stage.upscaleJobId };
  }

  if (stage.status === 'cancelled') {
    const message = '云端超分已取消；基础合并视频已保留，可重新发起合并或超分';
    db.prepare('UPDATE video_merges SET status = ?, upscale_job_id = ?, error_msg = ? WHERE id = ?')
      .run('failed', stage.upscaleJobId, message, mergeRow.id);
    if (taskId) taskService.updateTaskError(db, taskId, message);
    return { deferred: false, cancelled: true, error: message };
  }

  const finalReference = toStorageReference(stage.outputPath, storageRoot);
  const now = new Date().toISOString();
  db.prepare(`UPDATE video_merges SET status = 'completed', merged_url = ?, duration = ?, completed_at = ?,
    error_msg = NULL, upscale_job_id = ? WHERE id = ?`)
    .run(finalReference, Math.round(totalDuration) || null, now, stage.upscaleJobId, mergeRow.id);
  db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(finalReference, 'completed', now, mergeRow.episode_id);
  if (taskId) {
    taskService.updateTaskResult(db, taskId, {
      merge_id: mergeRow.id,
      video_url: finalReference,
      duration: Math.round(totalDuration),
      upscale_job_id: stage.upscaleJobId,
      upscale_skipped: stage.upscaleSkipped,
    });
  }
  return { deferred: false, videoUrl: finalReference };
}

async function resumeVideoMergeAfterUpscale(db, log, mergeId) {
  const mergeRow = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(mergeId));
  if (!mergeRow || !mergeRow.base_merged_url) return null;
  let scenes = [];
  let mergeOpts = {};
  try { scenes = JSON.parse(mergeRow.scenes || '[]'); } catch (_) {}
  try { mergeOpts = JSON.parse(mergeRow.merge_options || '{}'); } catch (_) {}
  const storageRoot = getStorageRoot();
  const baseVideoPath = fromStorageReference(mergeRow.base_merged_url, storageRoot);
  if (!fs.existsSync(baseVideoPath)) {
    const message = '基础合并视频不存在，无法恢复超分后处理';
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', message, mergeRow.id);
    if (mergeRow.task_id) require('./taskService').updateTaskError(db, mergeRow.task_id, message);
    return { deferred: false, error: message };
  }
  return finalizeMergedLocalVideo(db, log, {
    mergeRow,
    scenes,
    mergeOpts,
    storageRoot,
    baseVideoPath,
    totalDuration: Number(mergeRow.duration) || scenes.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
  });
}

/** 将 video_url 解析为本地文件路径，或下载到 temp 返回路径 */
async function resolveVideoToLocalPath(videoUrl, baseUrl, storageRoot, tempDir, index, log) {
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const u = videoUrl.trim();
  // 1) URL 以 baseUrl 开头（如 http://localhost:5679/static）-> 对应 storageRoot 下相对路径
  if (baseUrl && (u.startsWith(baseUrl) || u.startsWith(baseUrl.replace(/\/$/, '')))) {
    const base = baseUrl.replace(/\/$/, '');
    const rel = u.startsWith(base + '/') ? u.slice(base.length + 1) : u.slice(base.length).replace(/^\//, '');
    if (rel && !rel.startsWith('http')) {
      const localPath = path.join(storageRoot, rel.replace(/\//g, path.sep));
      if (fs.existsSync(localPath)) {
        log.info('Video merge: using local static file', { index, path: localPath });
        return localPath;
      }
    }
  }
  // 2) 已是本地绝对路径且存在
  if (path.isAbsolute(u) && fs.existsSync(u)) {
    log.info('Video merge: using absolute path', { index, path: u });
    return u;
  }
  // 3) 相对路径（相对 storageRoot）
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    const localPath = path.join(storageRoot, u.replace(/^\//, '').replace(/\//g, path.sep));
    if (fs.existsSync(localPath)) {
      log.info('Video merge: using relative path', { index, path: localPath });
      return localPath;
    }
  }
  // 4) 远程 URL：下载到 temp
  const ext = u.includes('.mp4') ? '.mp4' : u.includes('.webm') ? '.webm' : '.mp4';
  const destPath = path.join(tempDir, `dl_${Date.now()}_${index}${ext}`);
  try {
    const res = await fetch(u, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    log.info('Video merge: downloaded to temp', { index, dest: destPath });
    return destPath;
  } catch (e) {
    log.warn('Video merge: download failed', { index, url: u, error: e.message });
    return null;
  }
}

/** 使用 ffmpeg concat 合并多个视频文件 */
function runFfmpegConcat(localPaths, outputPath, log) {
  const ffmpegBin = getFfmpegPath();
  const isWin = process.platform === 'win32';
  const listFile = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
  try {
    const lines = localPaths.map((p) => {
      const normalized = p.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    const { spawnSync } = require('child_process');
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      outputPath,
    ];
    const result = spawnSync(ffmpegBin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.error) {
      log.warn('Video merge: ffmpeg spawn error', { error: result.error.message });
      return false;
    }
    if (result.status !== 0) {
      log.warn('Video merge: ffmpeg failed', { stderr: result.stderr?.slice(-500) });
      return false;
    }
    return true;
  } finally {
    try { if (fs.existsSync(listFile)) fs.unlinkSync(listFile); } catch (_) {}
  }
}

function transitionDurationSeconds(scene) {
  const transition = scene?.transition && typeof scene.transition === 'object' ? scene.transition : {};
  const type = String(transition.type || 'cut').toLowerCase();
  if (type === 'cut') return 0;
  const seconds = Number(transition.duration ?? transition.duration_seconds);
  const milliseconds = Number(transition.duration_ms);
  const value = Number.isFinite(seconds) ? seconds : (Number.isFinite(milliseconds) ? milliseconds / 1000 : 0);
  return Math.max(0, value);
}

function localVideoHasAudio(filePath) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(getFfprobePath(), [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return result.status === 0 && String(result.stdout || '').trim().length > 0;
}

function hardCutAudioBridgeSeconds(scene) {
  if (transitionDurationSeconds(scene) > 0) return 0;
  const bridge = scene?.transition?.audio_bridge;
  if (!bridge || String(bridge.mode || 'none').toLowerCase() === 'none') return 0;
  return Math.max(0, Number(bridge.duration_ms) || 0) / 1000;
}

function buildFfmpegTimelineArgs(localPaths, scenes, outputPath, { audioFadeSeconds = 0 } = {}) {
  const args = ['-y'];
  const filters = [];
  const durations = scenes.map((scene) => Math.max(0.2, Number(scene.duration) || 5));
  localPaths.forEach((filePath, index) => {
    args.push('-i', filePath);
    filters.push(`[${index}:v]trim=duration=${durations[index]},setpts=PTS-STARTPTS[v${index}]`);
    const defaultFade = Math.max(0, Number(audioFadeSeconds) || 0);
    const inSeconds = index > 0
      ? Math.max(defaultFade, hardCutAudioBridgeSeconds(scenes[index - 1])) : 0;
    const outSeconds = index < localPaths.length - 1
      ? Math.max(defaultFade, hardCutAudioBridgeSeconds(scenes[index])) : 0;
    const fadeInDuration = Math.min(inSeconds, durations[index] / 2);
    const fadeOutDuration = Math.min(outSeconds, durations[index] / 2);
    const fadeIn = fadeInDuration > 0 && transitionDurationSeconds(scenes[index - 1]) === 0
      ? `,afade=t=in:st=0:d=${fadeInDuration}` : '';
    const fadeOut = fadeOutDuration > 0 && transitionDurationSeconds(scenes[index]) === 0
      ? `,afade=t=out:st=${Math.max(0, durations[index] - fadeOutDuration)}:d=${fadeOutDuration}` : '';
    if (localVideoHasAudio(filePath)) {
      filters.push(`[${index}:a]atrim=duration=${durations[index]},asetpts=PTS-STARTPTS${fadeIn}${fadeOut}[a${index}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${durations[index]},asetpts=PTS-STARTPTS${fadeIn}${fadeOut}[a${index}]`);
    }
  });
  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let elapsed = durations[0];
  for (let index = 1; index < localPaths.length; index += 1) {
    const seconds = transitionDurationSeconds(scenes[index - 1]);
    const videoOut = index === localPaths.length - 1 ? 'vout' : `vx${index}`;
    const audioOut = index === localPaths.length - 1 ? 'aout' : `ax${index}`;
    if (seconds > 0) {
      const type = String(scenes[index - 1]?.transition?.type || 'dissolve').toLowerCase();
      const visual = type === 'fade' ? 'fadeblack' : 'fade';
      filters.push(`[${videoLabel}][v${index}]xfade=transition=${visual}:duration=${seconds}:offset=${Math.max(0, elapsed - seconds)}[${videoOut}]`);
      filters.push(`[${audioLabel}][a${index}]acrossfade=d=${seconds}:c1=tri:c2=tri[${audioOut}]`);
      elapsed += durations[index] - seconds;
    } else {
      filters.push(`[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${videoOut}]`);
      filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${audioOut}]`);
      elapsed += durations[index];
    }
    videoLabel = videoOut;
    audioLabel = audioOut;
  }
  if (localPaths.length === 1) {
    filters.push('[v0]null[vout]');
    filters.push('[a0]anull[aout]');
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outputPath);
  return args;
}

function runFfmpegTimeline(localPaths, scenes, outputPath, log, options = {}) {
  const { spawnSync } = require('node:child_process');
  const args = buildFfmpegTimelineArgs(localPaths, scenes, outputPath, options);
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    log.warn('Video merge: transition timeline failed', { error: result.error?.message, stderr: result.stderr?.slice(-800) });
    return false;
  }
  return true;
}

/**
 * 异步处理视频合成：优先使用 ffmpeg 真正合并多段视频；失败或无 ffmpeg 时用首段作为 merged_url。
 */
async function processVideoMerge(db, log, mergeId, baseUrl) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
  const taskId = r.task_id;
  const episodeId = r.episode_id;
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes || '[]');
  } catch (_) {
    log.warn('video merge parse scenes failed', { merge_id: mergeId });
  }
  // Older clients did not send transition metadata in the merge payload.
  // Hydrate it before any duration calculation or FFmpeg topology decision.
  scenes = scenes.map((scene) => {
    if (scene?.transition || !Number.isFinite(Number(scene?.scene_id))) return scene;
    try {
      const row = db.prepare('SELECT transition FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(scene.scene_id));
      const transition = row?.transition ? JSON.parse(row.transition) : null;
      return transition ? { ...scene, transition } : scene;
    } catch (_) {
      return scene;
    }
  });
  const now = new Date().toISOString();
  db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  const taskService = require('./taskService');
  let mergeOpts = {};
  try { mergeOpts = JSON.parse(r.merge_options || '{}'); } catch (_) { mergeOpts = {}; }
  if (mergeOpts.timeline_id) {
    const timeline = await processDirectorTimeline(db, log, mergeOpts.timeline_id);
    const completed = timeline.status === 'completed';
    const outputUrl = timeline.output_path || null;
    if (completed && outputUrl && fs.existsSync(outputUrl)) {
      try {
        await finalizeMergedLocalVideo(db, log, {
          mergeRow: r, scenes, mergeOpts, storageRoot: getStorageRoot(), baseVideoPath: outputUrl,
          totalDuration: Number(r.duration) || scenes.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
        });
      } catch (error) {
        db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', error.message, mergeId);
        if (taskId) taskService.updateTaskError(db, taskId, error.message);
      }
    } else {
      db.prepare('UPDATE video_merges SET status = ?, merged_url = ?, completed_at = ?, error_msg = ? WHERE id = ?')
        .run('failed', null, null, 'Director timeline failed', mergeId);
      if (taskId) taskService.updateTaskError(db, taskId, 'Director timeline failed');
    }
    return;
  }
  if (scenes.length === 0) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '无有效视频片段', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '无有效视频片段');
    return;
  }
  const first = scenes[0];
  const mergedUrlFallback = first && first.video_url ? first.video_url : null;
  if (!mergedUrlFallback) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '首段无视频地址', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '首段无视频地址');
    return;
  }

  const transitionOverlap = scenes.slice(0, -1).reduce((sum, scene) => sum + transitionDurationSeconds(scene), 0);
  const totalDuration = Math.max(0, scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0) - transitionOverlap);
  let perSegmentAudioFadeSeconds = 0;
  try {
    const episode = db.prepare('SELECT audio_plan FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
    const audioPlan = JSON.parse(episode?.audio_plan || '{}');
    if (audioPlan?.bgm?.mode === 'per_segment') {
      perSegmentAudioFadeSeconds = Math.max(0, Number(audioPlan.bgm.crossfade_ms) || 0) / 1000;
    }
  } catch (_) {}
  const storageRoot = getStorageRoot();
  const tempDir = path.join(require('os').tmpdir(), 'drama-video-merge');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localPaths = [];
  const toCleanup = [];
  for (let i = 0; i < scenes.length; i++) {
    const p = await resolveVideoToLocalPath(
      scenes[i].video_url,
      baseUrl,
      storageRoot,
      tempDir,
      i,
      log
    );
    if (p) {
      localPaths.push(p);
      if (p.startsWith(tempDir)) toCleanup.push(p);
    }
  }

  const ffmpegAvailable = hasLocalFfmpeg();
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(mergedDir, outputFileName);
    const hasTimedTransitions = scenes.slice(0, -1).some((scene) => transitionDurationSeconds(scene) > 0);
    const hasAudioBridge = scenes.slice(0, -1).some((scene) => hardCutAudioBridgeSeconds(scene) > 0);
    const audioTopology = localPaths.map((filePath) => localVideoHasAudio(filePath));
    const hasMixedAudioTopology = new Set(audioTopology).size > 1;
    const needsFilteredTimeline = hasTimedTransitions || hasAudioBridge || perSegmentAudioFadeSeconds > 0 || hasMixedAudioTopology;
    const ok = needsFilteredTimeline && localPaths.length === scenes.length
      ? runFfmpegTimeline(localPaths, scenes, outputPath, log, { audioFadeSeconds: perSegmentAudioFadeSeconds })
      : runFfmpegConcat(localPaths, outputPath, log);
    if (ok && fs.existsSync(outputPath)) {
      mergedRelativePath = sub
        ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
        : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
      log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
    }
  }

  for (const p of toCleanup) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
  if (mergedRelativePath && ffmpegAvailable) {
    const mergedAbsPath = fromStorageReference(mergedRelativePath, storageRoot);
    try {
      await finalizeMergedLocalVideo(db, log, {
        mergeRow: r, scenes, mergeOpts, storageRoot, baseVideoPath: mergedAbsPath, totalDuration,
      });
    } catch (error) {
      log.warn('Video merge finalization failed', { merge_id: mergeId, error: error.message });
      db.prepare('UPDATE video_merges SET status = ?, base_merged_url = ?, error_msg = ? WHERE id = ?')
        .run('failed', mergedRelativePath, error.message, mergeId);
      if (taskId) taskService.updateTaskError(db, taskId, error.message);
    }
    return;
  }

  if (normalizeUpscaleOptions(mergeOpts.upscale).enabled) {
    const message = '云端超分要求先生成可访问的本地基础合并视频';
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', message, mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, message);
    return;
  }

  const finalMergedUrl = mergedRelativePath || mergedUrlFallback;
  db.prepare(
    'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
  ).run('completed', finalMergedUrl, Math.round(totalDuration) || null, now, null, mergeId);
  db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(finalMergedUrl, 'completed', now, episodeId);
  if (taskId) {
    taskService.updateTaskResult(db, taskId, { merge_id: mergeId, video_url: finalMergedUrl, duration: Math.round(totalDuration) });
  }
  if (!mergedRelativePath) {
    log.info('Video merge completed (first-clip fallback)', { merge_id: mergeId, episode_id: episodeId });
  }
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  processVideoMerge,
  processDirectorTimeline,
  finalizeMergedLocalVideo,
  resumeVideoMergeAfterUpscale,
  configureVideoUpscaleRuntime,
  normalizeUpscaleOptions,
  runFinalizationStages,
  buildFfmpegTimelineArgs,
};
