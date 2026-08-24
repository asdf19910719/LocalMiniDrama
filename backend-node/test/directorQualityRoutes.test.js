const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/director');

function responseCapture() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

describe('Director artifact quality route', () => {
  let db;
  let routes;
  let root;
  let artifactPath;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-quality-route-'));
    artifactPath = path.join(root, 'shot.mp4');
    fs.writeFileSync(artifactPath, 'quality-video');
    const artifactHash = crypto.createHash('sha256').update('quality-video').digest('hex');
    db = new Database(':memory:');
    db.exec(`CREATE TABLE director_artifacts (
      id TEXT PRIMARY KEY, status TEXT, artifact_path TEXT, sha256 TEXT, file_size INTEGER,
      ffprobe_json TEXT, manifest_json TEXT, created_at TEXT
    )`);
    db.prepare(`INSERT INTO director_artifacts
      (id,status,artifact_path,sha256,file_size,ffprobe_json,manifest_json,created_at)
      VALUES ('ready-artifact','ready',?,?,?,'{"streams":[]}','{"source":"test"}','2026-08-24')`).run(artifactPath, artifactHash, fs.statSync(artifactPath).size);
    routes = createRoutes(db, { error() {} }, {
      allowedLocalRoots: [root],
      qualityAnalyzer: async ({ artifactPath }) => ({
        version: 'director_quality_v1', status: 'warning',
        issues: [{ code: 'FROZEN_VIDEO', severity: 'warning' }], artifactPath,
      }),
    });
  });
  afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

  it('runs quality analysis and persists the review in the artifact manifest', async () => {
    const res = responseCapture();
    await routes.analyzeArtifact({ params: { artifactId: 'ready-artifact' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'warning');
    const manifest = JSON.parse(db.prepare("SELECT manifest_json FROM director_artifacts WHERE id = 'ready-artifact'").get().manifest_json);
    assert.equal(manifest.source, 'test');
    assert.equal(manifest.qualityReview.issues[0].code, 'FROZEN_VIDEO');
    assert.match(manifest.qualityReview.analyzedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns not found without calling the analyzer for a missing artifact', async () => {
    const res = responseCapture();
    await routes.analyzeArtifact({ params: { artifactId: 'missing' } }, res);
    assert.equal(res.statusCode, 404);
  });

  it('rejects a ready artifact whose file no longer matches its persisted hash', async () => {
    fs.writeFileSync(artifactPath, 'tampered-video');
    const res = responseCapture();

    await routes.analyzeArtifact({ params: { artifactId: 'ready-artifact' } }, res);

    assert.equal(res.statusCode, 400);
    assert.match(String(res.body?.error?.message || ''), /hash/i);
  });
});
