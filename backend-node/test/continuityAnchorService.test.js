const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createContinuityAnchor } = require('../src/director/continuityAnchorService');

function id() { return crypto.randomUUID(); }

describe('Director continuity anchors', () => {
  let db;
  let tempDir;
  let sourceArtifact;

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
        selected_candidate_id TEXT, selected_artifact_id TEXT, selected_by TEXT,
        selected_at TEXT, selection_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE director_anchors (
        id TEXT PRIMARY KEY, source_artifact_id TEXT NOT NULL, derived_artifact_id TEXT NOT NULL,
        frame_number INTEGER NOT NULL, reference_role TEXT NOT NULL, reference_use TEXT NOT NULL,
        prompt_label TEXT, source_sha256 TEXT NOT NULL, parameters_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director-anchor-'));
    const sourcePath = path.join(tempDir, 'source.mp4');
    fs.writeFileSync(sourcePath, 'source-video');
    sourceArtifact = { id: id(), jobId: id(), path: sourcePath };
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at)
      VALUES (?, ?, 1, 1, 'ready', ?, 'source-sha', 12, '{}', ?)`).run(
      sourceArtifact.id, sourceArtifact.jobId, sourcePath, new Date().toISOString()
    );
    db.prepare(`INSERT INTO director_candidate_groups
      (id, shot_id, status, selected_artifact_id, created_at, updated_at)
      VALUES (?, 'shot-1', 'selected', ?, ?, ?)`).run(id(), sourceArtifact.id, new Date().toISOString(), new Date().toISOString());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts a selected frame and records source hash plus derived artifact', async () => {
    const result = await createContinuityAnchor(db, {
      artifactId: sourceArtifact.id,
      frameNumber: 12,
      referenceRole: 'state',
      referenceUse: 'state_anchor',
      promptLabel: 'PREV_STATE',
      frameExtractor: async ({ outputPath, frameNumber }) => {
        assert.equal(frameNumber, 12);
        fs.writeFileSync(outputPath, 'frame-12');
      },
      ffprobe: { streams: [{ codec_type: 'video', r_frame_rate: '24/1' }], format: { duration: '2' } },
    });

    assert.equal(result.frame_number, 12);
    assert.equal(result.reference_role, 'state');
    assert.equal(result.reference_use, 'state_anchor');
    assert.equal(result.prompt_label, 'PREV_STATE');
    assert.equal(result.source_artifact_id, sourceArtifact.id);
    assert.equal(result.source_sha256, 'source-sha');
    const derived = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(result.derived_artifact_id);
    assert.equal(derived.status, 'ready');
    assert.equal(derived.parent_artifact_id, sourceArtifact.id);
    assert.equal(derived.file_size, 8);
    assert.equal(derived.sha256.length, 64);
  });

  it('validates reference roles and rejects composition-only as a direct I2V first frame', async () => {
    await assert.rejects(
      () => createContinuityAnchor(db, {
        artifactId: sourceArtifact.id,
        frameNumber: 0,
        referenceRole: 'unknown',
        frameExtractor: async () => {},
      }),
      /reference role/i
    );
    await assert.rejects(
      () => createContinuityAnchor(db, {
        artifactId: sourceArtifact.id,
        frameNumber: 0,
        referenceRole: 'composition',
        referenceUse: 'composition_only',
        isFirstFrame: true,
        frameExtractor: async () => {},
      }),
      /composition_only.*first frame/i
    );
  });

  it('runs a declared derived-image operation and records its parameters', async () => {
    const calls = [];
    const result = await createContinuityAnchor(db, {
      artifactId: sourceArtifact.id,
      frameNumber: 7,
      referenceRole: 'composition',
      referenceUse: 'composition_only',
      operation: 'line_art',
      parameters: { edgeLow: 0.12, edgeHigh: 0.42 },
      frameExtractor: async ({ outputPath }) => fs.writeFileSync(outputPath, 'frame-7'),
      derivedImageProcessor: async ({ operation, inputPath, outputPath, parameters }) => {
        calls.push({ operation, inputPath, outputPath, parameters });
        fs.copyFileSync(inputPath, outputPath);
      },
      ffprobe: { streams: [{ codec_type: 'video', r_frame_rate: '24/1' }], format: { duration: '2' } },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'line_art');
    assert.deepEqual(calls[0].parameters, { edgeLow: 0.12, edgeHigh: 0.42 });
    const derived = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(result.derived_artifact_id);
    const manifest = JSON.parse(derived.manifest_json);
    assert.equal(manifest.metadata.operation, 'line_art');
    assert.equal(manifest.metadata.edgeLow, 0.12);
  });
});
