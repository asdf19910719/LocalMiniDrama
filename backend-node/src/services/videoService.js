const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const storageLayout = require('./storageLayout');
const { getFfmpegPath, hasLocalFfmpeg } = require('../utils/ffmpegPath');

const lifecycleByDatabase = new WeakMap();

function hasProviderTaskId(row) {
  return Boolean(row?.provider_task_id && String(row.provider_task_id).trim());
}

function normalizeStoredVideoStatus(status) {
  if (status === 'processing') return 'running';
  if (status === 'completed') return 'review';
  return status;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function readStructuredError(value) {
  if (!value) return null;
  const parsed = parseObject(value);
  if (parsed?.code && parsed?.message) {
    return {
      code: String(parsed.code),
      message: String(parsed.message),
      stage: parsed.stage == null ? null : String(parsed.stage),
      details: parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
        ? parsed.details
        : {},
    };
  }
  const message = String(value);
  return {
    code: /^[A-Z][A-Z0-9_]{2,}$/.test(message) ? message : 'VIDEO_GENERATION_FAILED',
    message,
    stage: null,
    details: {},
  };
}

function fallbackProgress(status) {
  if (status === 'waiting') return 0;
  if (status === 'queued') return 5;
  if (status === 'running') return 10;
  if (status === 'review' || status === 'selected' || status === 'cancelled') return 100;
  return 0;
}

function rowToItem(row) {
  const status = normalizeStoredVideoStatus(row.status);
  const structuredError = readStructuredError(row.error_msg || row.task_error);
  const routingSnapshot = parseObject(row.config_snapshot);
  const joinedProgress = row.task_progress == null ? NaN : Number(row.task_progress);
  return {
    id: row.id,
    storyboard_id: row.storyboard_id,
    drama_id: row.drama_id,
    provider: row.provider,
    protocol: row.protocol,
    prompt: row.prompt,
    negative_prompt: row.negative_prompt,
    model: row.model,
    config_id: row.config_id,
    config_snapshot: routingSnapshot,
    routing_snapshot: routingSnapshot,
    duration: row.duration,
    aspect_ratio: row.aspect_ratio,
    resolution: row.resolution,
    width: row.width,
    height: row.height,
    frame_rate: row.frame_rate,
    seed: row.seed,
    camera_fixed: row.camera_fixed,
    watermark: row.watermark,
    continuity_mode: row.continuity_mode,
    anchor_id: row.anchor_id,
    candidate_group_id: row.candidate_group_id,
    image_gen_id: row.image_gen_id,
    image_url: row.image_url,
    first_frame_url: row.first_frame_url,
    last_frame_url: row.last_frame_url,
    video_url: row.video_url,
    local_path: row.local_path,
    status,
    progress: Number.isFinite(joinedProgress) ? joinedProgress : fallbackProgress(status),
    message: row.task_message || '',
    task_id: row.task_id,
    error_msg: structuredError ? structuredError.message : null,
    error: structuredError,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    can_resume_poll: (status === 'failed' || status === 'interrupted') && hasProviderTaskId(row),
  };
}

function queryParts(query = {}) {
  let sql = `FROM video_generations vg
    LEFT JOIN async_tasks task ON task.id = vg.task_id AND task.deleted_at IS NULL
    WHERE vg.deleted_at IS NULL`;
  const params = [];
  if (query.drama_id) {
    sql += ' AND vg.drama_id = ?';
    params.push(query.drama_id);
  }
  if (query.storyboard_id) {
    sql += ' AND vg.storyboard_id = ?';
    params.push(query.storyboard_id);
  }
  if (query.status === 'processing') {
    sql += ` AND (
      vg.status IN ('waiting', 'queued', 'running', 'processing')
      OR (vg.status IN ('review', 'selected', 'completed', 'failed', 'cancelled', 'interrupted')
          AND datetime(vg.updated_at) >= datetime('now', '-5 minutes'))
    )`;
  } else if (query.status === 'running') {
    sql += " AND vg.status IN ('running', 'processing')";
  } else if (query.status === 'review') {
    sql += " AND vg.status IN ('review', 'completed')";
  } else if (query.status === 'completed') {
    sql += " AND vg.status IN ('review', 'selected', 'completed')";
  } else if (query.status) {
    sql += ' AND vg.status = ?';
    params.push(query.status);
  }
  return { sql, params };
}

function list(db, query = {}) {
  const { sql, params } = queryParts(query);
  const total = db.prepare(`SELECT COUNT(*) AS total ${sql}`).get(...params).total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const rows = db.prepare(
    `SELECT vg.*, task.progress AS task_progress, task.message AS task_message, task.error AS task_error
     ${sql} ORDER BY vg.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map(rowToItem), total, page, pageSize };
}

function getById(db, id) {
  const row = db.prepare(
    `SELECT vg.*, task.progress AS task_progress, task.message AS task_message, task.error AS task_error
     FROM video_generations vg
     LEFT JOIN async_tasks task ON task.id = vg.task_id AND task.deleted_at IS NULL
     WHERE vg.id = ? AND vg.deleted_at IS NULL`
  ).get(Number(id));
  return row ? rowToItem(row) : null;
}

function resolveVideosDir(storagePath, projectSubdir) {
  const subdir = String(projectSubdir || '').trim();
  if (!subdir) return { dir: path.join(storagePath, 'videos'), relPrefix: 'videos' };
  return {
    dir: path.join(storagePath, subdir, 'videos'),
    relPrefix: `${subdir.replace(/\\/g, '/')}/videos`,
  };
}

async function downloadVideoToLocal(storagePath, videoUrl, videoGenerationId, log, projectSubdir) {
  if (!/^https?:\/\//i.test(String(videoUrl || '').trim())) return null;
  const { dir, relPrefix } = resolveVideosDir(storagePath, projectSubdir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const extension = (String(videoUrl).split('?')[0].match(/\.(mp4|webm|mov)$/i) || [])[1] || 'mp4';
    const name = `vg_${videoGenerationId}_${randomUUID().slice(0, 8)}.${extension}`;
    const response = await fetch(videoUrl);
    if (!response.ok) {
      log.warn('Download video failed', { status: response.status, videoGenerationId });
      return null;
    }
    fs.writeFileSync(path.join(dir, name), Buffer.from(await response.arrayBuffer()));
    return `${relPrefix}/${name}`.replace(/\\/g, '/');
  } catch (error) {
    log.warn('Download video error', { videoGenerationId, error: error.message });
    return null;
  }
}

function targetVideoPixelsForAspect(aspectRatio) {
  const normalized = String(aspectRatio || '16:9').trim();
  const known = {
    '16:9': { w: 2560, h: 1440 },
    '9:16': { w: 1440, h: 2560 },
    '1:1': { w: 1920, h: 1920 },
    '4:3': { w: 1920, h: 1440 },
    '3:4': { w: 1440, h: 1920 },
    '3:2': { w: 2560, h: 1708 },
    '2:3': { w: 1708, h: 2560 },
    '21:9': { w: 2560, h: 1080 },
  };
  if (known[normalized]) return known[normalized];
  const ratio = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!ratio) return { w: 1280, h: 720 };
  const widthRatio = Number(ratio[1]);
  const heightRatio = Number(ratio[2]);
  if (widthRatio <= 0 || heightRatio <= 0 || widthRatio === heightRatio) return { w: 1280, h: 720 };
  if (widthRatio > heightRatio) {
    return { w: 2560, h: Math.max(2, Math.round((2560 * heightRatio) / widthRatio / 2) * 2) };
  }
  return { w: Math.max(2, Math.round((2560 * widthRatio) / heightRatio / 2) * 2), h: 2560 };
}

function normalizeDownloadedVideo(absolutePath, width, height, log, videoGenerationId) {
  if (!absolutePath || !fs.existsSync(absolutePath) || !hasLocalFfmpeg()) return false;
  const tempOutput = `${absolutePath}.norm-${randomUUID().slice(0, 8)}${path.extname(absolutePath) || '.mp4'}`;
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  const baseArgs = [
    '-y', '-i', absolutePath, '-vf', filter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ];
  let result = spawnSync(getFfmpegPath(), [...baseArgs, '-c:a', 'copy', tempOutput], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    result = spawnSync(getFfmpegPath(), [...baseArgs, '-an', tempOutput], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  if (result.status !== 0) {
    try { fs.unlinkSync(tempOutput); } catch (_) {}
    log.warn('Normalize downloaded video failed', { videoGenerationId });
    return false;
  }
  try {
    fs.unlinkSync(absolutePath);
    fs.renameSync(tempOutput, absolutePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(tempOutput); } catch (_) {}
    log.warn('Replace normalized video failed', { videoGenerationId, error: error.message });
    return false;
  }
}

function resolveStoragePath(config) {
  const configured = config.storage?.local_path || './data/storage';
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

async function prepareSuccessfulVideoOutput(db, log, row, videoUrl) {
  try {
    const config = require('../config').loadConfig();
    const storagePath = resolveStoragePath(config);
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    const localPath = await downloadVideoToLocal(storagePath, videoUrl, row.id, log, projectSubdir);
    if (localPath) {
      const dimensions = targetVideoPixelsForAspect(row.aspect_ratio);
      normalizeDownloadedVideo(path.join(storagePath, localPath), dimensions.w, dimensions.h, log, row.id);
    }
    return localPath;
  } catch (_) {
    return null;
  }
}

async function importSuccessfulVideoArtifact(db, log, row, artifactPath, options = {}) {
  try {
    const sourcePath = String(artifactPath || '').trim();
    if (!sourcePath || !path.isAbsolute(sourcePath)) return null;
    const sourceStat = fs.statSync(sourcePath);
    if (!sourceStat.isFile()) return null;
    const config = options.storagePath ? null : require('../config').loadConfig();
    const storagePath = options.storagePath || resolveStoragePath(config);
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
    const { dir, relPrefix } = resolveVideosDir(storagePath, projectSubdir);
    fs.mkdirSync(dir, { recursive: true });
    const sourceExtension = path.extname(sourcePath).toLowerCase();
    const extension = /^\.(mp4|webm|mov|mkv)$/.test(sourceExtension) ? sourceExtension : '.mp4';
    const name = `vg_${row.id}_${randomUUID().slice(0, 8)}${extension}`;
    fs.copyFileSync(sourcePath, path.join(dir, name));
    return `${relPrefix}/${name}`.replace(/\\/g, '/');
  } catch (error) {
    log.warn('Import video artifact failed', { videoGenerationId: row?.id, error: error.message });
    return null;
  }
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare(
    'UPDATE video_generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(now, Number(id));
  if (result.changes) log.info('Video generation deleted', { videoGenerationId: Number(id) });
  return result.changes > 0;
}

function configureUnifiedVideoGenerationService(db, lifecycleService) {
  if (!db || !lifecycleService) throw new Error('Database and lifecycle service are required');
  lifecycleByDatabase.set(db, lifecycleService);
  return lifecycleService;
}

function configuredLifecycle(db, explicitService) {
  return explicitService || lifecycleByDatabase.get(db) || null;
}

async function processVideoGeneration(db, log, id, lifecycleService) {
  const lifecycle = configuredLifecycle(db, lifecycleService);
  if (!lifecycle) throw new Error('UNIFIED_VIDEO_LIFECYCLE_NOT_CONFIGURED');
  return lifecycle.processVideoGeneration(id);
}

async function resumePollForVideoGeneration(db, log, id, lifecycleService) {
  const lifecycle = configuredLifecycle(db, lifecycleService);
  if (!lifecycle) throw new Error('UNIFIED_VIDEO_LIFECYCLE_NOT_CONFIGURED');
  return lifecycle.processVideoGeneration(id, { operation: 'recover' });
}

async function resumeFailedVideoPoll(db, log, id, lifecycleService) {
  const lifecycle = configuredLifecycle(db, lifecycleService);
  if (!lifecycle) return { ok: false, status: 503, error: '统一视频任务服务尚未初始化' };
  try {
    const item = await lifecycle.retryVideoGeneration(id);
    return { ok: true, item };
  } catch (error) {
    return { ok: false, status: error.status || 400, error: error.message, code: error.code };
  }
}

function resumeProcessingVideoGenerations(db, log, lifecycleService) {
  const lifecycle = configuredLifecycle(db, lifecycleService);
  if (!lifecycle) {
    log.info('Unified video recovery deferred until provider registry initialization');
    return 0;
  }
  return lifecycle.recoverVideoGenerations();
}

module.exports = {
  configureUnifiedVideoGenerationService,
  deleteById,
  getById,
  importSuccessfulVideoArtifact,
  list,
  prepareSuccessfulVideoOutput,
  processVideoGeneration,
  resumeFailedVideoPoll,
  resumePollForVideoGeneration,
  resumeProcessingVideoGenerations,
  rowToItem,
};
