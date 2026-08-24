const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createRoutes = require('../src/routes/director');

function responseCapture() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

describe('Director continuity anchor routes', () => {
  let db;
  let routes;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, artifact_path TEXT NOT NULL,
        parent_artifact_id TEXT, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL,
        ffprobe_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, ready_at TEXT
      );
      CREATE TABLE director_candidate_groups (
        id TEXT PRIMARY KEY, shot_id TEXT NOT NULL, status TEXT NOT NULL,
        selected_artifact_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE director_anchors (
        id TEXT PRIMARY KEY, source_artifact_id TEXT NOT NULL, derived_artifact_id TEXT NOT NULL,
        frame_number INTEGER NOT NULL, reference_role TEXT NOT NULL, reference_use TEXT NOT NULL,
        prompt_label TEXT, source_sha256 TEXT NOT NULL, parameters_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    routes = createRoutes(db, { error() {} }, {
      anchorCreator: async (_db, input) => ({
        id: 'anchor-1', source_artifact_id: input.artifactId,
        derived_artifact_id: 'derived-1', frame_number: input.frameNumber,
        reference_role: input.referenceRole, reference_use: input.referenceUse,
      }),
    });
  });
  afterEach(() => db.close());

  it('creates an anchor from an explicit selected video frame', async () => {
    const res = responseCapture();
    await routes.createAnchor({ body: {
      artifactId: 'source-1', frameNumber: 48, referenceRole: 'state',
      referenceUse: 'state_anchor', operation: 'upscale_2x',
    } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.frame_number, 48);
    assert.equal(res.body.data.reference_role, 'state');
  });
});
