const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createArtifactManifest } = require('./artifactManifest');

function id() { return crypto.randomUUID(); }
function timestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function candidateRow(row) {
  return row ? { ...row } : null;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function artifactMedia(ffprobe) {
  const video = ffprobe?.streams?.find((stream) => stream.codec_type === 'video')
    || ffprobe?.streams?.find((stream) => stream.width || stream.height)
    || null;
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    frame_rate: video?.avg_frame_rate || video?.r_frame_rate || null,
    duration: ffprobe?.format?.duration ?? null,
  };
}

function artifactRow(row, { includePath = false } = {}) {
  if (!row) return null;
  const ffprobe = parseJson(row.ffprobe_json);
  const { artifact_path: artifactPath, ...publicRow } = row;
  return {
    ...publicRow,
    ...(includePath ? { artifact_path: artifactPath } : {}),
    ffprobe,
    manifest: parseJson(row.manifest_json),
    media: artifactMedia(ffprobe),
    preview_url: row.status === 'ready' ? `/api/v1/director/artifacts/${row.id}/content` : null,
  };
}

function normalizeVideoStatus(status) {
  if (status === 'processing') return 'running';
  if (status === 'completed') return 'review';
  return status;
}

function candidateStatusForVideo(status) {
  const normalized = normalizeVideoStatus(status);
  if (['waiting', 'queued', 'pending'].includes(normalized)) return 'pending';
  if (normalized === 'running') return 'running';
  if (normalized === 'review') return 'review';
  if (normalized === 'selected') return 'selected';
  if (['failed', 'cancelled', 'interrupted'].includes(normalized)) return 'failed';
  return null;
}

function projectedCandidateStatus(candidate) {
  if (['selected', 'rejected'].includes(candidate.status)) return candidate.status;
  if (candidate.video_generation_id != null) {
    return candidateStatusForVideo(candidate.video_status) || candidate.status;
  }
  return candidate.status;
}

function projectedGroupStatus(candidates) {
  const statuses = candidates.map(projectedCandidateStatus);
  if (statuses.every((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => ['pending', 'running'].includes(status))) return 'running';
  if (statuses.some((status) => ['review', 'selected'].includes(status))) return 'review';
  return 'failed';
}

function videoError(value) {
  const parsed = parseJson(value);
  if (parsed?.code || parsed?.message) {
    return { code: parsed.code || 'VIDEO_GENERATION_FAILED', message: parsed.message || String(value) };
  }
  return value ? { code: 'VIDEO_GENERATION_FAILED', message: String(value) } : { code: null, message: null };
}

function videoGenerationRow(row) {
  if (!row?.video_generation_id) return null;
  const status = normalizeVideoStatus(row.video_status);
  const localPath = row.video_local_path || null;
  const videoUrl = row.video_url || null;
  return {
    id: row.video_generation_id,
    storyboard_id: row.video_storyboard_id,
    provider: row.video_provider,
    protocol: row.video_protocol,
    model: row.video_model,
    video_url: videoUrl,
    local_path: localPath,
    status,
    error_msg: row.video_error_msg || null,
    created_at: row.video_created_at,
    updated_at: row.video_updated_at,
    completed_at: row.video_completed_at,
    prompt_snapshot: row.video_prompt_snapshot || null,
    preview_url: videoUrl || (localPath ? `/static/${String(localPath).replace(/^\/+/, '')}` : null),
  };
}

function configuredStorageRoot(override) {
  if (override) return path.resolve(String(override));
  try {
    const config = require('../config').loadConfig();
    const configured = config.storage?.local_path || './data/storage';
    return path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
  } catch (_) {
    return path.resolve(process.cwd(), 'data', 'storage');
  }
}

function storedVideoArtifactPath(localPath, storageRoot) {
  const value = String(localPath || '').trim();
  if (!value) return null;
  const root = configuredStorageRoot(storageRoot);
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch (_) {
    return null;
  }
}

function synthesizedVideoProbe(row, suppliedProbe) {
  if (suppliedProbe && typeof suppliedProbe === 'object' && !Array.isArray(suppliedProbe)) return suppliedProbe;
  const width = Number(row.video_width);
  const height = Number(row.video_height);
  const frameRate = Number(row.video_frame_rate);
  const duration = Number(row.video_duration);
  return {
    streams: [{
      codec_type: 'video',
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      avg_frame_rate: Number.isFinite(frameRate) && frameRate > 0 ? `${frameRate}/1` : null,
      r_frame_rate: Number.isFinite(frameRate) && frameRate > 0 ? `${frameRate}/1` : null,
    }],
    format: {
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    },
  };
}

function videoColumnExpression(db, column, alias) {
  return columnExists(db, 'video_generations', column)
    ? `video.${column} AS ${alias}`
    : `NULL AS ${alias}`;
}

function unifiedCandidateArtifactRow(db, videoGenerationId) {
  if (!columnExists(db, 'director_candidates', 'video_generation_id') || !tableExists(db, 'video_generations')) return null;
  return db.prepare(`SELECT candidate.id AS candidate_id, candidate.group_id,
      candidate.artifact_id, candidate.video_generation_id,
      video.status AS video_status, video.provider AS video_provider,
      ${videoColumnExpression(db, 'protocol', 'video_protocol')}, video.model AS video_model,
      video.video_url, video.local_path AS video_local_path,
      ${videoColumnExpression(db, 'width', 'video_width')},
      ${videoColumnExpression(db, 'height', 'video_height')},
      ${videoColumnExpression(db, 'frame_rate', 'video_frame_rate')},
      ${videoColumnExpression(db, 'duration', 'video_duration')},
      video.created_at AS video_created_at, video.updated_at AS video_updated_at,
      ${videoColumnExpression(db, 'completed_at', 'video_completed_at')}
    FROM director_candidates candidate
    JOIN video_generations video ON video.id = candidate.video_generation_id
    WHERE candidate.video_generation_id = ?`).get(Number(videoGenerationId)) || null;
}

function linkUnifiedCandidateArtifact(db, videoGenerationId, { storageRoot, ffprobe } = {}) {
  const row = unifiedCandidateArtifactRow(db, videoGenerationId);
  if (!row || !['review', 'completed', 'selected'].includes(normalizeVideoStatus(row.video_status))) return null;
  const current = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(row.artifact_id);
  if (current?.status === 'ready') return artifactRow(current, { includePath: true });

  const artifactPath = storedVideoArtifactPath(row.video_local_path, storageRoot);
  if (!artifactPath) return null;
  const artifactId = `unified-video-${row.video_generation_id}`;
  const jobId = artifactId;
  const existing = db.prepare('SELECT * FROM director_artifacts WHERE id = ? OR (job_id = ? AND version = 1) LIMIT 1')
    .get(artifactId, jobId);
  if (existing) {
    db.prepare('UPDATE director_candidates SET artifact_id = ? WHERE id = ?').run(existing.id, row.candidate_id);
    return artifactRow(existing, { includePath: true });
  }

  const readyAt = timestamp(row.video_completed_at || row.video_updated_at || row.video_created_at);
  const mediaProbe = synthesizedVideoProbe(row, ffprobe);
  const manifest = createArtifactManifest({
    artifactPath,
    kind: 'video',
    ffprobe: mediaProbe,
    metadata: {
      source: 'unified_video_generation',
      videoGenerationId: Number(row.video_generation_id),
      candidateGroupId: row.group_id,
      provider: row.video_provider || null,
      protocol: row.video_protocol || null,
      model: row.video_model || null,
      videoUrl: row.video_url || null,
      localPath: row.video_local_path,
    },
    now: readyAt,
  });
  db.transaction(() => {
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, parent_artifact_id,
       sha256, file_size, ffprobe_json, manifest_json, created_at, ready_at)
      VALUES (?, ?, 1, 1, 'ready', ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
      artifactId,
      jobId,
      artifactPath,
      manifest.sha256,
      manifest.fileSize,
      JSON.stringify(mediaProbe),
      manifest.manifestJson,
      readyAt,
      readyAt,
    );
    db.prepare('UPDATE director_candidates SET artifact_id = ?, updated_at = ? WHERE id = ?')
      .run(artifactId, readyAt, row.candidate_id);
  })();
  return getCandidateArtifact(db, artifactId);
}

function syncUnifiedCandidateGroup(db, groupId, options = {}) {
  if (!columnExists(db, 'director_candidates', 'video_generation_id') || !tableExists(db, 'video_generations')) return;
  const group = db.prepare('SELECT status FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!group) return;
  const rows = db.prepare(`SELECT candidate.id, candidate.status, candidate.video_generation_id,
      video.status AS video_status, video.error_msg AS video_error_msg
    FROM director_candidates candidate
    JOIN video_generations video ON video.id = candidate.video_generation_id
    WHERE candidate.group_id = ?`).all(groupId);
  if (!rows.length) return;

  for (const row of rows) {
    linkUnifiedCandidateArtifact(db, row.video_generation_id, options);
  }

  const updatedAt = timestamp();
  const updateCandidate = db.prepare(`UPDATE director_candidates
    SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`);
  const transaction = db.transaction(() => {
    for (const row of rows) {
      if (['selected', 'rejected'].includes(row.status)) continue;
      const status = candidateStatusForVideo(row.video_status);
      if (!status) continue;
      const error = status === 'failed' ? videoError(row.video_error_msg) : { code: null, message: null };
      if (status !== row.status || error.code || error.message) {
        updateCandidate.run(status, error.code, error.message, updatedAt, row.id);
      }
    }

    if (group.status === 'selected') return;
    const candidates = db.prepare('SELECT status FROM director_candidates WHERE group_id = ?').all(groupId);
    const status = projectedGroupStatus(candidates);
    if (status !== group.status) {
      db.prepare('UPDATE director_candidate_groups SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, updatedAt, groupId);
    }
  });
  transaction();
}

function candidatesForGroup(db, groupId) {
  const hasJobsTable = tableExists(db, 'director_jobs');
  const hasVideoLink = columnExists(db, 'director_candidates', 'video_generation_id');
  const hasVideoTable = tableExists(db, 'video_generations');
  const jobSelect = hasJobsTable
    ? 'job.status AS job_status, job.attempt_number AS job_attempt_number, job.max_attempts AS job_max_attempts, job.error_code AS job_error_code, job.error_message AS job_error_message, job.input_json AS job_input_json, job.started_at AS job_started_at, job.completed_at AS job_completed_at,'
    : 'NULL AS job_status, NULL AS job_attempt_number, NULL AS job_max_attempts, NULL AS job_error_code, NULL AS job_error_message, NULL AS job_input_json, NULL AS job_started_at, NULL AS job_completed_at,';
  const jobJoin = hasJobsTable ? 'LEFT JOIN director_jobs job ON job.id = candidate.job_id' : '';
  const videoSelect = hasVideoLink && hasVideoTable
    ? `candidate.video_generation_id,
      video.storyboard_id AS video_storyboard_id, video.provider AS video_provider,
      video.protocol AS video_protocol, video.model AS video_model, video.video_url,
      video.local_path AS video_local_path, video.status AS video_status,
      video.error_msg AS video_error_msg, video.created_at AS video_created_at,
      video.updated_at AS video_updated_at, video.completed_at AS video_completed_at,
      video.prompt AS video_prompt_snapshot,`
    : `NULL AS video_generation_id, NULL AS video_storyboard_id, NULL AS video_provider,
      NULL AS video_protocol, NULL AS video_model, NULL AS video_url,
      NULL AS video_local_path, NULL AS video_status, NULL AS video_error_msg,
      NULL AS video_created_at, NULL AS video_updated_at, NULL AS video_completed_at,
      NULL AS video_prompt_snapshot,`;
  const videoJoin = hasVideoLink && hasVideoTable
    ? 'LEFT JOIN video_generations video ON video.id = candidate.video_generation_id'
    : '';
  return db.prepare(`SELECT candidate.*, ${jobSelect} ${videoSelect}
      artifact.id AS joined_artifact_id,
      artifact.job_id AS artifact_job_id, artifact.attempt_number AS artifact_attempt_number,
      artifact.version AS artifact_version, artifact.status AS artifact_status,
      artifact.artifact_path, artifact.parent_artifact_id, artifact.sha256,
      artifact.file_size, artifact.ffprobe_json, artifact.manifest_json,
      artifact.created_at AS artifact_created_at, artifact.ready_at AS artifact_ready_at
    FROM director_candidates candidate
    ${jobJoin}
    ${videoJoin}
    LEFT JOIN director_artifacts artifact ON artifact.id = candidate.artifact_id
    WHERE candidate.group_id = ? ORDER BY candidate.created_at, candidate.id`).all(groupId).map((row) => {
    const candidate = candidateRow({
      id: row.id,
      group_id: row.group_id,
      artifact_id: row.artifact_id,
      job_id: row.job_id,
      video_generation_id: row.video_generation_id,
      status: row.status,
      job_status: row.job_status || candidateStatusForVideo(row.video_status),
      job_attempt_number: row.job_attempt_number,
      job_max_attempts: row.job_max_attempts,
      job_error_code: row.job_error_code || null,
      job_error_message: row.job_error_message || null,
      job_input_json: row.job_input_json || null,
      job_started_at: row.job_started_at || null,
      job_completed_at: row.job_completed_at || null,
      error_code: row.error_code,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    candidate.artifact = artifactRow(row.joined_artifact_id ? {
      id: row.joined_artifact_id,
      job_id: row.artifact_job_id,
      attempt_number: row.artifact_attempt_number,
      version: row.artifact_version,
      status: row.artifact_status,
      artifact_path: row.artifact_path,
      parent_artifact_id: row.parent_artifact_id,
      sha256: row.sha256,
      file_size: row.file_size,
      ffprobe_json: row.ffprobe_json,
      manifest_json: row.manifest_json,
      created_at: row.artifact_created_at,
      ready_at: row.artifact_ready_at,
    } : null);
    candidate.video_generation = videoGenerationRow(row);
    return candidate;
  });
}

function getCandidateGroup(db, groupId, options = {}) {
  syncUnifiedCandidateGroup(db, groupId, options);
  const group = db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    ...group,
    candidates: candidatesForGroup(db, groupId),
  };
}

function getCandidateGroupsByShot(db, shotId, options = {}) {
  if (!shotId) return [];
  return db.prepare(`SELECT id FROM director_candidate_groups
    WHERE shot_id = ? ORDER BY created_at DESC, id DESC`).all(String(shotId))
    .map((row) => getCandidateGroup(db, row.id, options));
}

function getCandidateArtifact(db, artifactId) {
  return artifactRow(db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(artifactId), { includePath: true });
}

function requireGroup(db, groupId, options = {}) {
  const group = getCandidateGroup(db, groupId, options);
  if (!group) throw new Error(`Candidate group not found: ${groupId}`);
  return group;
}

function createCandidateGroup(db, { shotId, candidates = [], now } = {}) {
  if (!shotId) throw new Error('shotId is required');
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('At least one candidate is required');
  const createdAt = timestamp(now);
  const groupId = id();
  const insertGroup = db.prepare(`INSERT INTO director_candidate_groups (id, shot_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`);
  const insertCandidate = db.prepare(`INSERT INTO director_candidates (id, group_id, artifact_id, job_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const transaction = db.transaction(() => {
    insertGroup.run(groupId, String(shotId), createdAt, createdAt);
    for (const candidate of candidates) {
      const artifact = db.prepare('SELECT id, status FROM director_artifacts WHERE id = ?').get(candidate.artifactId || candidate.artifact_id);
      if (!artifact) throw new Error(`Artifact not found: ${candidate.artifactId || candidate.artifact_id}`);
      const status = artifact.status === 'failed' ? 'failed' : 'pending';
      insertCandidate.run(id(), groupId, artifact.id, candidate.jobId || candidate.job_id || null, status, createdAt, createdAt);
    }
  });
  transaction();
  return getCandidateGroup(db, groupId);
}

function createVideoCandidateGroup(db, {
  shotId,
  candidateCount,
  videoGenerationIds = [],
  now,
} = {}) {
  if (!shotId) throw new Error('shotId is required');
  if (!columnExists(db, 'director_candidates', 'video_generation_id')) {
    throw new Error('Director unified video candidate link is not migrated');
  }
  const count = videoGenerationIds.length || Number(candidateCount);
  if (!Number.isInteger(count) || count < 1) throw new Error('At least one video candidate is required');
  const createdAt = timestamp(now);
  const groupId = id();
  const insertGroup = db.prepare(`INSERT INTO director_candidate_groups
    (id, shot_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`);
  const insertCandidate = db.prepare(`INSERT INTO director_candidates
    (id, group_id, artifact_id, job_id, video_generation_id, status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, 'pending', ?, ?)`);
  const transaction = db.transaction(() => {
    insertGroup.run(groupId, String(shotId), createdAt, createdAt);
    for (let index = 0; index < count; index += 1) {
      const candidateId = id();
      insertCandidate.run(
        candidateId,
        groupId,
        `pending-video-${candidateId}`,
        videoGenerationIds[index] ?? null,
        createdAt,
        createdAt,
      );
    }
  });
  transaction();
  return getCandidateGroup(db, groupId);
}

function linkCandidateVideoGeneration(db, groupId, candidateId, videoGenerationId, now) {
  if (!Number.isInteger(Number(videoGenerationId))) throw new Error('videoGenerationId is required');
  const updatedAt = timestamp(now);
  const result = db.prepare(`UPDATE director_candidates
    SET video_generation_id = ?, updated_at = ? WHERE id = ? AND group_id = ?`)
    .run(Number(videoGenerationId), updatedAt, candidateId, groupId);
  if (!result.changes) throw new Error(`Candidate not found: ${candidateId}`);
  return db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(candidateId);
}

function getCandidateByVideoGenerationId(db, videoGenerationId) {
  if (!columnExists(db, 'director_candidates', 'video_generation_id')) return null;
  return db.prepare('SELECT * FROM director_candidates WHERE video_generation_id = ?')
    .get(Number(videoGenerationId)) || null;
}

function getCandidateSelectionState(db, groupId, candidateId) {
  const group = db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  const hasVideo = columnExists(db, 'director_candidates', 'video_generation_id')
    && tableExists(db, 'video_generations');
  const videoSelect = hasVideo ? 'video.status AS video_status' : 'NULL AS video_status';
  const videoJoin = hasVideo
    ? 'LEFT JOIN video_generations video ON video.id = candidate.video_generation_id'
    : '';
  const candidates = db.prepare(`SELECT candidate.*, ${videoSelect}
    FROM director_candidates candidate ${videoJoin} WHERE candidate.group_id = ?`).all(groupId);
  const candidate = candidates.find((entry) => entry.id === candidateId) || null;
  return {
    group,
    candidate,
    group_status: group.status === 'selected' ? 'selected' : projectedGroupStatus(candidates),
    candidate_status: candidate ? projectedCandidateStatus(candidate) : null,
  };
}

function startCandidateGroup(db, groupId, now) {
  const group = requireGroup(db, groupId);
  if (group.status !== 'pending') throw new Error(`Candidate group cannot start from ${group.status}`);
  const updatedAt = timestamp(now);
  db.prepare("UPDATE director_candidate_groups SET status = 'running', updated_at = ? WHERE id = ?").run(updatedAt, groupId);
  return getCandidateGroup(db, groupId);
}

function moveCandidateGroupToReview(db, groupId, now) {
  const group = requireGroup(db, groupId);
  if (group.status !== 'running') throw new Error(`Candidate group cannot enter review from ${group.status}`);
  const updatedAt = timestamp(now);
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE director_candidates SET status = 'review', updated_at = ?
      WHERE group_id = ? AND status = 'pending'
      AND artifact_id IN (SELECT id FROM director_artifacts WHERE status = 'ready')`).run(updatedAt, groupId);
    db.prepare("UPDATE director_candidate_groups SET status = 'review', updated_at = ? WHERE id = ?").run(updatedAt, groupId);
  });
  transaction();
  return getCandidateGroup(db, groupId);
}

function selectCandidate(db, groupId, candidateId, { selectedBy = 'user', reason = '', now, storageRoot } = {}) {
  const group = requireGroup(db, groupId, { storageRoot });
  if (group.status !== 'review') throw new Error(`Candidate group cannot select from ${group.status}`);
  const candidate = db.prepare('SELECT * FROM director_candidates WHERE id = ? AND group_id = ?').get(candidateId, groupId);
  if (!candidate) throw new Error('Candidate is not selectable');
  const isUnified = candidate.video_generation_id != null;
  if (isUnified ? !['review', 'selected'].includes(candidate.status) : candidate.status !== 'review') {
    throw new Error('Candidate is not selectable');
  }
  const video = isUnified
    ? db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(candidate.video_generation_id)
    : null;
  const artifact = db.prepare('SELECT status FROM director_artifacts WHERE id = ?').get(candidate.artifact_id);
  if (isUnified && !video) throw new Error('Candidate video is not selectable');
  if (isUnified && !['review', 'completed', 'selected'].includes(video.status)) {
    throw new Error('Candidate video is not selectable');
  }
  if (!isUnified && (!artifact || artifact.status !== 'ready')) throw new Error('Candidate artifact is not selectable');
  const selectedAt = timestamp(now);
  const transaction = db.transaction(() => {
    db.prepare("UPDATE director_candidates SET status = 'rejected', updated_at = ? WHERE group_id = ? AND id <> ? AND status IN ('pending', 'review')").run(selectedAt, groupId, candidateId);
    db.prepare("UPDATE director_candidates SET status = 'selected', updated_at = ? WHERE id = ?").run(selectedAt, candidateId);
    db.prepare(`UPDATE director_candidate_groups
      SET status = 'selected', selected_candidate_id = ?, selected_artifact_id = ?, selected_by = ?, selected_at = ?, selection_reason = ?, updated_at = ?
      WHERE id = ?`).run(candidateId, artifact?.status === 'ready' ? candidate.artifact_id : null, selectedBy, selectedAt, reason, selectedAt, groupId);
    if (isUnified) {
      db.prepare(`UPDATE video_generations SET status = 'selected', updated_at = ?
        WHERE id = ? AND status IN ('review', 'completed', 'selected')`).run(selectedAt, video.id);
      db.prepare(`UPDATE storyboards SET video_url = ?, local_path = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`)
        .run(video.video_url || null, video.local_path || null, selectedAt, Number(group.shot_id));
    }
  });
  transaction();
  return getCandidateGroup(db, groupId, { storageRoot });
}

function retryFailedCandidate(db, groupId, candidateId, now) {
  const group = requireGroup(db, groupId);
  const candidate = db.prepare('SELECT * FROM director_candidates WHERE id = ? AND group_id = ?').get(candidateId, groupId);
  if (!candidate || candidate.status !== 'failed') throw new Error('Only a failed candidate can be retried');
  const updatedAt = timestamp(now);
  db.prepare("UPDATE director_candidates SET status = 'pending', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(updatedAt, candidateId);
  if (group.status === 'review' || group.status === 'failed') {
    db.prepare("UPDATE director_candidate_groups SET status = 'running', updated_at = ? WHERE id = ?").run(updatedAt, groupId);
  }
  return db.prepare('SELECT * FROM director_candidates WHERE id = ?').get(candidateId);
}

function markCandidateFailed(db, jobId, error = {}, now) {
  const updatedAt = timestamp(now);
  const code = error.code || 'DIRECTOR_JOB_FAILED';
  const message = error.message || String(error || 'Director job failed');
  db.prepare(`UPDATE director_candidates
    SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
    WHERE job_id = ?`).run(code, message, updatedAt, jobId);
  return db.prepare('SELECT * FROM director_candidates WHERE job_id = ?').get(jobId) || null;
}

function finalizeCandidateGroup(db, groupId, now) {
  const group = requireGroup(db, groupId);
  if (group.status === 'selected') return group;
  if (group.candidates.some((candidate) => candidate.video_generation_id != null)) return group;

  const candidates = db.prepare(`SELECT candidate.*, artifact.status AS artifact_status
    FROM director_candidates candidate
    LEFT JOIN director_artifacts artifact ON artifact.id = candidate.artifact_id
    WHERE candidate.group_id = ?`).all(groupId);
  if (candidates.some((candidate) => ['pending', 'running'].includes(candidate.status))) {
    return getCandidateGroup(db, groupId);
  }

  const updatedAt = timestamp(now);
  const hasReady = candidates.some((candidate) => candidate.artifact_status === 'ready');
  const transaction = db.transaction(() => {
    if (hasReady) {
      db.prepare(`UPDATE director_candidates SET status = 'review', updated_at = ?
        WHERE group_id = ? AND artifact_id IN
          (SELECT id FROM director_artifacts WHERE status = 'ready')`).run(updatedAt, groupId);
      db.prepare("UPDATE director_candidate_groups SET status = 'review', updated_at = ? WHERE id = ? AND status <> 'selected'")
        .run(updatedAt, groupId);
    } else {
      db.prepare("UPDATE director_candidate_groups SET status = 'failed', updated_at = ? WHERE id = ? AND status <> 'selected'")
        .run(updatedAt, groupId);
    }
  });
  transaction();
  return getCandidateGroup(db, groupId);
}

module.exports = {
  createCandidateGroup,
  createVideoCandidateGroup,
  linkCandidateVideoGeneration,
  startCandidateGroup,
  moveCandidateGroupToReview,
  getCandidateGroup,
  selectCandidate,
  retryFailedCandidate,
  markCandidateFailed,
  finalizeCandidateGroup,
  getCandidateGroupsByShot,
  getCandidateArtifact,
  getCandidateByVideoGenerationId,
  getCandidateSelectionState,
  linkUnifiedCandidateArtifact,
};
