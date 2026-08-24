const crypto = require('node:crypto');

function id() { return crypto.randomUUID(); }
function timestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function candidateRow(row) {
  return row ? { ...row } : null;
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

function candidatesForGroup(db, groupId) {
  const hasJobsTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'director_jobs'").get());
  const jobSelect = hasJobsTable
    ? 'job.status AS job_status, job.attempt_number AS job_attempt_number, job.max_attempts AS job_max_attempts, job.error_code AS job_error_code, job.error_message AS job_error_message,'
    : 'NULL AS job_status, NULL AS job_attempt_number, NULL AS job_max_attempts, NULL AS job_error_code, NULL AS job_error_message,';
  const jobJoin = hasJobsTable ? 'LEFT JOIN director_jobs job ON job.id = candidate.job_id' : '';
  return db.prepare(`SELECT candidate.*, ${jobSelect}
      artifact.id AS joined_artifact_id,
      artifact.job_id AS artifact_job_id, artifact.attempt_number AS artifact_attempt_number,
      artifact.version AS artifact_version, artifact.status AS artifact_status,
      artifact.artifact_path, artifact.parent_artifact_id, artifact.sha256,
      artifact.file_size, artifact.ffprobe_json, artifact.manifest_json,
      artifact.created_at AS artifact_created_at, artifact.ready_at AS artifact_ready_at
    FROM director_candidates candidate
    ${jobJoin}
    LEFT JOIN director_artifacts artifact ON artifact.id = candidate.artifact_id
    WHERE candidate.group_id = ? ORDER BY candidate.created_at, candidate.id`).all(groupId).map((row) => {
    const candidate = candidateRow({
      id: row.id,
      group_id: row.group_id,
      artifact_id: row.artifact_id,
      job_id: row.job_id,
      status: row.status,
      job_status: row.job_status,
      job_attempt_number: row.job_attempt_number,
      job_max_attempts: row.job_max_attempts,
      job_error_code: row.job_error_code || null,
      job_error_message: row.job_error_message || null,
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
    return candidate;
  });
}

function getCandidateGroup(db, groupId) {
  const group = db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    ...group,
    candidates: candidatesForGroup(db, groupId),
  };
}

function getCandidateGroupsByShot(db, shotId) {
  if (!shotId) return [];
  return db.prepare(`SELECT id FROM director_candidate_groups
    WHERE shot_id = ? ORDER BY created_at DESC, id DESC`).all(String(shotId))
    .map((row) => getCandidateGroup(db, row.id));
}

function getCandidateArtifact(db, artifactId) {
  return artifactRow(db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(artifactId), { includePath: true });
}

function requireGroup(db, groupId) {
  const group = getCandidateGroup(db, groupId);
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

function selectCandidate(db, groupId, candidateId, { selectedBy = 'user', reason = '', now } = {}) {
  const group = requireGroup(db, groupId);
  if (group.status !== 'review') throw new Error(`Candidate group cannot select from ${group.status}`);
  const candidate = db.prepare('SELECT * FROM director_candidates WHERE id = ? AND group_id = ?').get(candidateId, groupId);
  if (!candidate || candidate.status !== 'review') throw new Error('Candidate is not selectable');
  const artifact = db.prepare('SELECT status FROM director_artifacts WHERE id = ?').get(candidate.artifact_id);
  if (!artifact || artifact.status !== 'ready') throw new Error('Candidate artifact is not selectable');
  const selectedAt = timestamp(now);
  const transaction = db.transaction(() => {
    db.prepare("UPDATE director_candidates SET status = 'rejected', updated_at = ? WHERE group_id = ? AND id <> ? AND status IN ('pending', 'review')").run(selectedAt, groupId, candidateId);
    db.prepare("UPDATE director_candidates SET status = 'selected', updated_at = ? WHERE id = ?").run(selectedAt, candidateId);
    db.prepare(`UPDATE director_candidate_groups
      SET status = 'selected', selected_candidate_id = ?, selected_artifact_id = ?, selected_by = ?, selected_at = ?, selection_reason = ?, updated_at = ?
      WHERE id = ?`).run(candidateId, candidate.artifact_id, selectedBy, selectedAt, reason, selectedAt, groupId);
  });
  transaction();
  return getCandidateGroup(db, groupId);
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
  startCandidateGroup,
  moveCandidateGroupToReview,
  getCandidateGroup,
  selectCandidate,
  retryFailedCandidate,
  markCandidateFailed,
  finalizeCandidateGroup,
  getCandidateGroupsByShot,
  getCandidateArtifact,
};
