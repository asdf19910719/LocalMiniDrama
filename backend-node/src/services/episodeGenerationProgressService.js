const IMAGE_ACTIVE = new Set(['queued', 'preparing', 'submitted', 'generating', 'pending', 'processing']);
const VIDEO_ACTIVE = new Set(['waiting', 'pending', 'queued', 'running', 'processing']);
const PLAYABLE_VIDEO = new Set(['completed', 'review', 'selected']);
const FRAME_TYPES = {
  storyboard_first: 'storyboard_first',
  storyboard_last: 'storyboard_last',
};

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function rows(db, sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch (_) { return []; }
}

function one(db, sql, ...params) {
  try { return db.prepare(sql).get(...params) || null; } catch (_) { return null; }
}

function usableImage(value) {
  return Boolean(String(value?.image_url || '').trim() || String(value?.local_path || '').trim());
}

function usableVideo(value) {
  return Boolean(String(value?.video_url || '').trim() || String(value?.local_path || '').trim());
}

function normalizeVideoStatus(status) {
  return status === 'processing' ? 'running' : status;
}

function fallbackProgress(status) {
  if (status === 'queued') return 5;
  if (status === 'running') return 10;
  if (status === 'review' || status === 'selected' || status === 'cancelled') return 100;
  return 0;
}

function percent(completed, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function emptyBucket() {
  return { total: 0, completed: 0, active: 0, needs_review: 0, failed: 0, pending: 0, percent: 0 };
}

function finishBucket(bucket) {
  bucket.percent = percent(bucket.completed, bucket.total);
  return bucket;
}

function imageTargetKey(type, id) { return `${type}:${id}`; }

function addImageTarget(targets, type, id, bound) {
  if (id == null) return;
  targets.set(imageTargetKey(type, id), { type, id: Number(id), bound: Boolean(bound), statuses: [] });
}

function classifyImageTarget(target) {
  const statuses = target.statuses;
  const active = statuses.some((status) => IMAGE_ACTIVE.has(status));
  const review = statuses.includes('needs_review');
  const failed = statuses.includes('failed');
  return {
    completed: target.bound,
    active,
    needs_review: review,
    failed: !target.bound && failed,
    pending: !target.bound && !active && !review && !failed,
  };
}

function targetMatchesImage(target, image) {
  if (target.type === 'character') return Number(image.character_id) === target.id;
  if (target.type === 'scene') return Number(image.scene_id) === target.id;
  if (target.type.startsWith('storyboard_')) {
    if (Number(image.storyboard_id) !== target.id) return false;
    const frame = String(image.frame_type || '').trim().toLowerCase();
    if (target.type === 'storyboard_first') return frame === FRAME_TYPES.storyboard_first || frame === 'first' || frame === 'first_frame';
    if (target.type === 'storyboard_last') return frame === FRAME_TYPES.storyboard_last || frame === 'last' || frame === 'last_frame' || frame === 'tail';
    return !['storyboard_first', 'storyboard_last', 'first', 'last', 'first_frame', 'last_frame', 'tail'].includes(frame);
  }
  return false;
}

function buildImageProgress(db, episode, storyboards) {
  const byType = {
    characters: emptyBucket(), scenes: emptyBucket(), props: emptyBucket(),
    storyboard_main: emptyBucket(), storyboard_first: emptyBucket(), storyboard_last: emptyBucket(),
  };
  const targetTypes = new Map();
  const targets = new Map();
  const characters = rows(db, `SELECT c.id, c.image_url, c.local_path
    FROM characters c JOIN episode_characters ec ON ec.character_id = c.id
    WHERE ec.episode_id = ? AND c.deleted_at IS NULL`, episode.id);
  const scenes = rows(db, 'SELECT id, image_url, local_path FROM scenes WHERE episode_id = ? AND deleted_at IS NULL', episode.id);
  const episodeProps = rows(db, 'SELECT id, image_url, local_path FROM props WHERE episode_id = ? AND deleted_at IS NULL', episode.id);
  const storyboardProps = rows(db, `SELECT DISTINCT p.id, p.image_url, p.local_path FROM props p
    JOIN storyboard_props sp ON sp.prop_id = p.id
    JOIN storyboards sb ON sb.id = sp.storyboard_id AND sb.episode_id = ? AND sb.deleted_at IS NULL
    WHERE p.deleted_at IS NULL`, episode.id);
  const propsById = new Map([...episodeProps, ...storyboardProps].map((item) => [Number(item.id), item]));
  for (const item of characters) { addImageTarget(targets, 'character', item.id, usableImage(item)); targetTypes.set(imageTargetKey('character', item.id), 'characters'); }
  for (const item of scenes) { addImageTarget(targets, 'scene', item.id, usableImage(item)); targetTypes.set(imageTargetKey('scene', item.id), 'scenes'); }
  for (const item of propsById.values()) { addImageTarget(targets, 'prop', item.id, usableImage(item)); targetTypes.set(imageTargetKey('prop', item.id), 'props'); }

  const metadata = parseObject(episode.metadata);
  const dramaMetadata = parseObject(episode.drama_metadata);
  const useFirstLast = Boolean(metadata.storyboard_use_first_last_frame ?? dramaMetadata.storyboard_use_first_last_frame);
  for (const sb of storyboards) {
    const classicFrameMode = useFirstLast && String(sb.creation_mode || 'classic').toLowerCase() !== 'universal';
    if (classicFrameMode) {
      addImageTarget(targets, 'storyboard_first', sb.id, Boolean(sb.first_frame_image_id || sb.first_frame_image_url || sb.first_frame_local_path));
      addImageTarget(targets, 'storyboard_last', sb.id, Boolean(sb.last_frame_image_id || sb.last_frame_image_url || sb.last_frame_local_path));
      targetTypes.set(imageTargetKey('storyboard_first', sb.id), 'storyboard_first');
      targetTypes.set(imageTargetKey('storyboard_last', sb.id), 'storyboard_last');
    } else {
      addImageTarget(targets, 'storyboard_main', sb.id, usableImage(sb));
      targetTypes.set(imageTargetKey('storyboard_main', sb.id), 'storyboard_main');
    }
  }

  const images = rows(db, 'SELECT * FROM image_generations WHERE drama_id = ? AND deleted_at IS NULL', episode.drama_id);
  for (const image of images) {
    for (const target of targets.values()) {
      if (!targetMatchesImage(target, image)) continue;
      if (image.status) target.statuses.push(String(image.status).toLowerCase());
      if (String(image.status).toLowerCase() === 'completed' && usableImage(image)) target.bound = true;
    }
  }
  const tasks = rows(db, 'SELECT * FROM image_generation_tasks WHERE drama_id = ?', episode.drama_id);
  for (const task of tasks) {
    const target = targets.get(imageTargetKey(task.target_type, task.target_id));
    if (target && task.status) target.statuses.push(String(task.status).toLowerCase());
  }
  for (const target of targets.values()) {
    const bucket = byType[targetTypes.get(imageTargetKey(target.type, target.id))];
    if (!bucket) continue;
    bucket.total += 1;
    const state = classifyImageTarget(target);
    for (const key of Object.keys(state)) if (state[key]) bucket[key] += 1;
  }
  for (const bucket of Object.values(byType)) finishBucket(bucket);
  const image = emptyBucket();
  for (const bucket of Object.values(byType)) {
    for (const key of ['total', 'completed', 'active', 'needs_review', 'failed', 'pending']) image[key] += bucket[key];
  }
  finishBucket(image);
  image.by_type = byType;
  return image;
}

function buildVideoProgress(db, episode, storyboards) {
  const video = { total: storyboards.length, completed: 0, active: 0, failed: 0, pending: 0, percent: 0, active_items: [] };
  const asyncTasks = new Map(rows(db, 'SELECT * FROM async_tasks WHERE deleted_at IS NULL').map((task) => [String(task.id), task]));
  const records = rows(db, 'SELECT * FROM video_generations WHERE drama_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC', episode.drama_id);
  for (const sb of storyboards) {
    const list = records.filter((record) => Number(record.storyboard_id) === Number(sb.id));
    const playable = list.find((record) => PLAYABLE_VIDEO.has(String(record.status || '').toLowerCase()) && usableVideo(record));
    const active = list.find((record) => VIDEO_ACTIVE.has(String(record.status || '').toLowerCase()));
    const failed = list.find((record) => String(record.status || '').toLowerCase() === 'failed');
    if (playable) video.completed += 1;
    if (active) {
      video.active += 1;
      const task = active.task_id ? asyncTasks.get(String(active.task_id)) : null;
      const status = normalizeVideoStatus(String(active.status || '').toLowerCase());
      const progress = Number.isFinite(Number(task?.progress)) ? Number(task.progress) : fallbackProgress(status);
      video.active_items.push({
        storyboard_id: sb.id,
        storyboard_number: sb.storyboard_number,
        status,
        progress,
        provider: active.provider || null,
        model: active.model || null,
        message: task?.message || '',
        error: active.error_msg || task?.error || null,
      });
    } else if (!playable && failed) {
      video.failed += 1;
    } else if (!playable) {
      video.pending += 1;
    }
  }
  video.percent = percent(video.completed, video.total);
  return video;
}

function buildMergeProgress(db, episode) {
  const merge = one(db, `SELECT * FROM video_merges
    WHERE episode_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`, episode.id);
  if (!merge) return null;
  const task = merge.task_id ? one(db, 'SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL', merge.task_id) : null;
  const status = String(merge.status || task?.status || 'pending').toLowerCase();
  return {
    status,
    progress: Number.isFinite(Number(task?.progress)) ? Number(task.progress) : (status === 'completed' ? 100 : 0),
    task_id: merge.task_id || task?.id || null,
    message: task?.message || '',
    error: merge.error_msg || task?.error || null,
  };
}

function getEpisodeGenerationProgress(db, episodeId) {
  const episode = one(db, `SELECT e.id, e.drama_id, e.episode_number, NULL AS metadata,
    d.metadata AS drama_metadata FROM episodes e
    LEFT JOIN dramas d ON d.id = e.drama_id
    WHERE e.id = ? AND e.deleted_at IS NULL`, Number(episodeId));
  if (!episode) {
    const error = new Error('Episode not found');
    error.code = 'EPISODE_NOT_FOUND';
    throw error;
  }
  const storyboards = rows(db, `SELECT * FROM storyboards
    WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC`, episode.id);
  return {
    episode_id: episode.id,
    image: buildImageProgress(db, episode, storyboards),
    video: buildVideoProgress(db, episode, storyboards),
    merge: buildMergeProgress(db, episode),
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getEpisodeGenerationProgress,
  percent,
  usableImage,
  usableVideo,
};
