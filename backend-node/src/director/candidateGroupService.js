const crypto = require('node:crypto');

function id() { return crypto.randomUUID(); }
function timestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function candidateRow(row) {
  return row ? { ...row } : null;
}

function getCandidateGroup(db, groupId) {
  const group = db.prepare('SELECT * FROM director_candidate_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    ...group,
    candidates: db.prepare('SELECT * FROM director_candidates WHERE group_id = ? ORDER BY created_at, id').all(groupId).map(candidateRow),
  };
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
};
