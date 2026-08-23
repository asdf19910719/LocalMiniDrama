const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const {
  createCandidateGroup,
  startCandidateGroup,
  moveCandidateGroupToReview,
  getCandidateGroup,
  selectCandidate,
  retryFailedCandidate,
} = require('../src/director/candidateGroupService');

function id() { return crypto.randomUUID(); }

describe('Director candidate groups', () => {
  let db;
  let readyArtifact;
  let failedArtifact;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY, job_id TEXT, attempt_number INTEGER, version INTEGER,
        status TEXT, artifact_path TEXT, parent_artifact_id TEXT, sha256 TEXT,
        file_size INTEGER, ffprobe_json TEXT, manifest_json TEXT, created_at TEXT, ready_at TEXT
      );
      CREATE TABLE director_candidate_groups (
        id TEXT PRIMARY KEY, shot_id TEXT NOT NULL, status TEXT NOT NULL,
        selected_candidate_id TEXT, selected_artifact_id TEXT, selected_by TEXT,
        selected_at TEXT, selection_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE director_candidates (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
        job_id TEXT, status TEXT NOT NULL, error_code TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(group_id, artifact_id)
      );
    `);
    readyArtifact = id();
    failedArtifact = id();
    db.prepare(`INSERT INTO director_artifacts (id,status,artifact_path,sha256,file_size,manifest_json,created_at)
      VALUES (?, 'ready', '/tmp/ready.mp4', 'ready-hash', 1, '{}', ?)`).run(readyArtifact, new Date().toISOString());
    db.prepare(`INSERT INTO director_artifacts (id,status,artifact_path,sha256,file_size,manifest_json,created_at)
      VALUES (?, 'failed', '/tmp/failed.mp4', '', 0, '{}', ?)`).run(failedArtifact, new Date().toISOString());
  });

  afterEach(() => db.close());

  it('moves pending to review and selects one independent artifact', () => {
    const group = createCandidateGroup(db, {
      shotId: 'shot-7',
      candidates: [{ artifactId: readyArtifact }, { artifactId: failedArtifact, jobId: 'job-failed' }],
    });
    assert.equal(group.status, 'pending');
    assert.equal(group.candidates.length, 2);
    startCandidateGroup(db, group.id);
    const review = moveCandidateGroupToReview(db, group.id);
    assert.equal(review.status, 'review');
    assert.equal(review.candidates.find((candidate) => candidate.artifact_id === readyArtifact).status, 'review');
    assert.equal(review.candidates.find((candidate) => candidate.artifact_id === failedArtifact).status, 'failed');

    const selected = selectCandidate(db, group.id, review.candidates.find((candidate) => candidate.artifact_id === readyArtifact).id, {
      selectedBy: 'director-user', reason: 'cleaner eyeline',
    });
    assert.equal(selected.status, 'selected');
    assert.equal(selected.selected_artifact_id, readyArtifact);
    assert.equal(selected.selected_by, 'director-user');
    assert.equal(selected.selection_reason, 'cleaner eyeline');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidates WHERE group_id = ?').get(group.id).count, 2);
  });

  it('rejects selecting pending or failed candidates and retries only failed candidates', () => {
    const group = createCandidateGroup(db, { shotId: 'shot-8', candidates: [{ artifactId: failedArtifact }] });
    startCandidateGroup(db, group.id);
    moveCandidateGroupToReview(db, group.id);
    const candidate = getCandidateGroup(db, group.id).candidates[0];
    assert.throws(() => selectCandidate(db, group.id, candidate.id), /not selectable/i);
    const retried = retryFailedCandidate(db, group.id, candidate.id);
    assert.equal(retried.status, 'pending');
    assert.equal(getCandidateGroup(db, group.id).status, 'running');
    assert.throws(() => retryFailedCandidate(db, group.id, candidate.id), /failed candidate/i);
  });
});
