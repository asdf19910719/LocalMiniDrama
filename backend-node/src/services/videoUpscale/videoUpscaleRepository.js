const JOB_PATCH_FIELDS = new Set([
  'status', 'progress', 'current_stage', 'error_code', 'error_message', 'retry_count',
  'next_retry_at', 'waiting_since', 'cancel_requested_at', 'started_at', 'completed_at',
  'output_path', 'remote_input_name',
]);
const SEGMENT_PATCH_FIELDS = new Set([
  'status', 'progress', 'remote_input_name', 'client_id', 'prompt_id', 'filename_prefix',
  'remote_result_json', 'local_output_path', 'retry_count', 'error_code', 'error_message',
  'submitted_at', 'completed_at', 'requested_frame_count', 'overlap_frames', 'start_frame',
]);

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api[_-]?key|token|secret|authorization/i.test(key)) continue;
    output[key] = stripSecrets(item);
  }
  return output;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function segmentRow(row) {
  return row ? { ...row, remote_result: parseJson(row.remote_result_json, null) } : null;
}

function createVideoUpscaleRepository(db) {
  const create = db.transaction((input) => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO video_upscale_jobs (
      id, episode_id, video_merge_id, async_task_id, provider, method, workflow_id,
      config_snapshot_json, source_path, source_fingerprint, source_width, source_height,
      source_fps_num, source_fps_den, source_frame_count, source_has_audio,
      target_width, target_height, output_path, status, progress, current_stage, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 'pending', ?, ?)`)
      .run(
        input.id, input.episodeId || null, input.videoMergeId || null, input.asyncTaskId || null,
        input.provider || 'zealman', input.method, input.workflowId,
        JSON.stringify(stripSecrets(input.configSnapshot || {})), input.sourcePath, input.sourceFingerprint || null,
        input.source.width, input.source.height, input.source.fpsNumerator, input.source.fpsDenominator,
        input.source.frameCount, input.source.hasAudio ? 1 : 0,
        input.target.width, input.target.height, input.outputPath || null, now, now
      );
    const insertSegment = db.prepare(`INSERT INTO video_upscale_segments (
      job_id, segment_index, start_frame, requested_frame_count, overlap_frames,
      client_id, filename_prefix, status, progress, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`);
    for (const segment of input.segments) {
      insertSegment.run(
        input.id, segment.index, segment.startFrame, segment.frameCount, segment.trimLeadingFrames,
        `${input.id}:${segment.index}`, `${input.id}_${input.method}_part_${String(segment.index).padStart(4, '0')}`,
        now, now
      );
    }
    if (input.videoMergeId) {
      db.prepare('UPDATE video_merges SET upscale_job_id = ? WHERE id = ?').run(input.id, input.videoMergeId);
    }
  });

  function getJob(id) {
    const row = db.prepare('SELECT * FROM video_upscale_jobs WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      config_snapshot: parseJson(row.config_snapshot_json),
      source_has_audio: Boolean(row.source_has_audio),
      segments: db.prepare('SELECT * FROM video_upscale_segments WHERE job_id = ? ORDER BY segment_index').all(id).map(segmentRow),
    };
  }

  function patch(table, keys, whereSql, whereValues, values) {
    const entries = Object.entries(values || {}).filter(([key]) => keys.has(key));
    if (!entries.length) return 0;
    const now = new Date().toISOString();
    const assignments = entries.map(([key]) => `${key} = ?`).concat('updated_at = ?');
    const params = entries.map(([key, value]) => key === 'remote_result_json' && value && typeof value === 'object' ? JSON.stringify(value) : value);
    return db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE ${whereSql}`)
      .run(...params, now, ...whereValues).changes;
  }

  function transitionJob(id, fromStatuses, toStatus, values = {}) {
    const from = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
    if (!from.length) return false;
    const placeholders = from.map(() => '?').join(',');
    const entries = Object.entries({ ...values, status: toStatus }).filter(([key]) => JOB_PATCH_FIELDS.has(key));
    const assignments = entries.map(([key]) => `${key} = ?`).concat('updated_at = ?');
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE video_upscale_jobs SET ${assignments.join(', ')} WHERE id = ? AND status IN (${placeholders})`)
      .run(...entries.map(([, value]) => value), now, id, ...from);
    return result.changes === 1;
  }

  const replanRemaining = db.transaction((jobId, fromIndex, segments, method) => {
    db.prepare('DELETE FROM video_upscale_segments WHERE job_id = ? AND segment_index >= ?').run(jobId, fromIndex);
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO video_upscale_segments (
      job_id, segment_index, start_frame, requested_frame_count, overlap_frames,
      client_id, filename_prefix, status, progress, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`);
    for (const segment of segments) {
      insert.run(
        jobId, segment.index, segment.startFrame, segment.frameCount, segment.trimLeadingFrames,
        `${jobId}:${segment.index}`, `${jobId}_${method}_part_${String(segment.index).padStart(4, '0')}`,
        now, now
      );
    }
  });

  return {
    createJob(input) { create(input); return getJob(input.id); },
    getJob,
    transitionJob,
    updateJob(id, values) { return patch('video_upscale_jobs', JOB_PATCH_FIELDS, 'id = ?', [id], values) === 1; },
    updateSegment(jobId, segmentIndex, values) {
      return patch('video_upscale_segments', SEGMENT_PATCH_FIELDS, 'job_id = ? AND segment_index = ?', [jobId, segmentIndex], values) === 1;
    },
    replanRemaining(jobId, fromIndex, segments, method) {
      replanRemaining(jobId, fromIndex, segments, method);
      return getJob(jobId);
    },
    listRecoverable(now = new Date().toISOString()) {
      return db.prepare(`SELECT * FROM video_upscale_jobs
        WHERE (
          (status = 'waiting_provider' AND next_retry_at IS NOT NULL AND next_retry_at <= ?)
          OR (status IN ('pending','starting_provider','uploading','queued','running','downloading','stitching','validating')
              AND (next_retry_at IS NULL OR next_retry_at <= ?))
        )
        ORDER BY created_at ASC`).all(now, now);
    },
  };
}

module.exports = { createVideoUpscaleRepository, stripSecrets };
