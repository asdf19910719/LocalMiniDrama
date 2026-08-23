const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/director');
const { createCandidateGroup } = require('../src/director/candidateGroupService');

function id() { return crypto.randomUUID(); }

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('Director candidate routes', () => {
  let db;
  let artifactId;
  let routes;

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
    artifactId = id();
    db.prepare(`INSERT INTO director_artifacts
      (id, status, artifact_path, sha256, file_size, manifest_json, created_at)
      VALUES (?, 'ready', '/tmp/ready.mp4', 'ready-hash', 1, '{}', ?)`)
      .run(artifactId, new Date().toISOString());
    routes = createRoutes(db, { error() {} });
  });

  afterEach(() => db.close());

  it('advances a newly created candidate group into review', () => {
    const group = createCandidateGroup(db, {
      shotId: 'shot-3',
      candidates: [{ artifact_id: artifactId }],
    });
    const res = responseCapture();

    routes.reviewCandidates({ params: { groupId: group.id } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'review');
    assert.equal(res.body.data.candidates[0].status, 'review');
  });
});
