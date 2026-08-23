const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/director');

const SCHEMA = `
  CREATE TABLE storyboards (id INTEGER PRIMARY KEY, deleted_at TEXT);
  CREATE TABLE director_jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL, lease_expires_at TEXT, error_code TEXT,
    error_message TEXT, input_json TEXT NOT NULL, workflow_id TEXT,
    workflow_version TEXT, artifact_path TEXT, artifact_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
  );
  CREATE TABLE director_artifacts (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    version INTEGER NOT NULL, status TEXT NOT NULL, artifact_path TEXT NOT NULL,
    parent_artifact_id TEXT, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL,
    ffprobe_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL,
    ready_at TEXT
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
  CREATE TABLE director_timelines (
    id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL,
    input_json TEXT NOT NULL, manifest_json TEXT NOT NULL, ffmpeg_command TEXT NOT NULL,
    output_path TEXT, output_sha256 TEXT, ffprobe_json TEXT, created_at TEXT NOT NULL
  );
`;

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function registry() {
  return {
    version: 1,
    workflows: [
      { id: 'h3-continuity-v1', status: 'verified', workflowSha256: 'sha256:verified' },
      { id: 'invalid-workflow', status: 'invalid', workflowSha256: 'sha256:invalid' },
    ],
  };
}

describe('Director generation routes', () => {
  let db;
  let enqueued;
  let routes;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    db.prepare('INSERT INTO storyboards (id) VALUES (1)').run();
    enqueued = [];
    routes = createRoutes(db, { error() {} }, {
      registry: registry(),
      allowExperimental: false,
      runner: {
        enqueue(jobId) {
          assert.ok(db.prepare('SELECT id FROM director_jobs WHERE id = ?').get(jobId));
          enqueued.push(jobId);
          return jobId;
        },
      },
    });
  });

  afterEach(() => db.close());

  it('returns 202 and persists one pending job and candidate per requested output', () => {
    const res = responseCapture();
    routes.generateCandidates({
      params: { shotId: '1' },
      body: {
        workflowId: 'h3-continuity-v1',
        candidateCount: 2,
        prompt: { '5': { class_type: 'MiniMaxH3Director', inputs: {} } },
        inputs: { seed: 42 },
      },
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.group.shot_id, '1');
    assert.equal(res.body.data.group.status, 'pending');
    assert.equal(res.body.data.jobs.length, 2);
    assert.equal(enqueued.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidates').get().count, 2);
    for (const [candidateIndex, job] of res.body.data.jobs.entries()) {
      assert.equal(job.status, 'pending');
      assert.equal(job.workflow_id, 'h3-continuity-v1');
      assert.equal(job.input.shotId, '1');
      assert.equal(job.input.candidateIndex, candidateIndex);
      assert.deepEqual(job.input.inputs, { seed: 42 });
    }
  });

  it('rejects a missing shot or invalid workflow without writing a generation batch', () => {
    const missingShot = responseCapture();
    routes.generateCandidates({
      params: { shotId: '999' },
      body: { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: { '5': {} } },
    }, missingShot);
    assert.equal(missingShot.statusCode, 400);

    const invalidWorkflow = responseCapture();
    routes.generateCandidates({
      params: { shotId: '1' },
      body: { workflowId: 'invalid-workflow', candidateCount: 1, prompt: { '5': {} } },
    }, invalidWorkflow);
    assert.equal(invalidWorkflow.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
    assert.equal(enqueued.length, 0);
  });

  it('rejects invalid candidate, prompt, inputs, and retry values before writing', () => {
    const invalidBodies = [
      { workflowId: 'h3-continuity-v1', candidateCount: 0, prompt: { '5': {} } },
      { workflowId: 'h3-continuity-v1', candidateCount: 4, prompt: { '5': {} } },
      { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: 'not-an-object' },
      { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: { '5': {} }, inputs: [] },
      { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: { '5': {} }, maxAttempts: 0 },
    ];

    for (const body of invalidBodies) {
      const res = responseCapture();
      routes.generateCandidates({ params: { shotId: '1' }, body }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidate_groups').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 0);
  });

  it('returns durable job details and a not-found response', () => {
    const createRes = responseCapture();
    routes.generateCandidates({
      params: { shotId: '1' },
      body: { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: { '5': {} } },
    }, createRes);
    const jobId = createRes.body.data.jobs[0].id;

    const found = responseCapture();
    routes.getJob({ params: { jobId } }, found);
    assert.equal(found.statusCode, 200);
    assert.equal(found.body.data.id, jobId);
    assert.deepEqual(found.body.data.artifacts, []);

    const missing = responseCapture();
    routes.getJob({ params: { jobId: 'missing-job' } }, missing);
    assert.equal(missing.statusCode, 404);
  });

  it('keeps an accepted batch durable when enqueue fails after commit', () => {
    const failingRoutes = createRoutes(db, { error() {} }, {
      registry: registry(),
      runner: { enqueue() { throw new Error('queue unavailable'); } },
    });
    const res = responseCapture();

    failingRoutes.generateCandidates({
      params: { shotId: '1' },
      body: { workflowId: 'h3-continuity-v1', candidateCount: 1, prompt: { '5': {} } },
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.data.jobs[0].status, 'failed');
    assert.equal(res.body.data.jobs[0].error_code, 'DIRECTOR_QUEUE_ERROR');
    assert.equal(res.body.data.group.status, 'failed');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_jobs').get().count, 1);
  });
});
