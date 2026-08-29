const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createCandidateGroup,
  startCandidateGroup,
  moveCandidateGroupToReview,
  getCandidateGroup,
  selectCandidate,
  retryFailedCandidate,
  getCandidateGroupsByShot,
  createVideoCandidateGroup,
  getCandidateArtifact,
} = require('../src/director/candidateGroupService');
const { createContinuityAnchor } = require('../src/director/continuityAnchorService');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

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
        job_id TEXT, video_generation_id INTEGER, status TEXT NOT NULL, error_code TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(group_id, artifact_id)
      );
      CREATE TABLE director_anchors (
        id TEXT PRIMARY KEY, source_artifact_id TEXT NOT NULL, derived_artifact_id TEXT NOT NULL,
        frame_number INTEGER NOT NULL, reference_role TEXT NOT NULL, reference_use TEXT NOT NULL,
        prompt_label TEXT, source_sha256 TEXT NOT NULL, parameters_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY, video_url TEXT, local_path TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY, storyboard_id INTEGER, provider TEXT, protocol TEXT, model TEXT,
        prompt TEXT,
        video_url TEXT, local_path TEXT, status TEXT, progress INTEGER, error_msg TEXT,
        width INTEGER, height INTEGER, frame_rate REAL, duration REAL,
        created_at TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT
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
    assert.equal(review.candidates.find((candidate) => candidate.artifact_id === failedArtifact).artifact.preview_url, null);

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

  it('returns all candidate groups for a shot with the newest group first', () => {
    const older = createCandidateGroup(db, { shotId: 'shot-persisted', candidates: [{ artifactId: readyArtifact }], now: '2026-08-23T00:00:00.000Z' });
    const newer = createCandidateGroup(db, { shotId: 'shot-persisted', candidates: [{ artifactId: readyArtifact }], now: '2026-08-23T00:01:00.000Z' });

    const groups = getCandidateGroupsByShot(db, 'shot-persisted');

    assert.deepEqual(groups.map((group) => group.id), [newer.id, older.id]);
    assert.equal(getCandidateGroupsByShot(db, 'missing-shot').length, 0);
  });

  it('selects a unified video as the storyboard current video without deleting candidate history', () => {
    db.prepare('INSERT INTO storyboards (id) VALUES (9)').run();
    db.prepare(`INSERT INTO video_generations
      (id, storyboard_id, provider, model, video_url, local_path, status, created_at, updated_at)
      VALUES
        (101, 9, 'cloud', 'cloud-model', 'https://cdn.example.test/cloud.mp4', NULL, 'review', ?, ?),
        (102, 9, 'cloud', 'cloud-model', NULL, 'projects/demo/videos/local.mp4', 'review', ?, ?)`)
      .run(
        '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z',
        '2026-08-25T00:00:01.000Z', '2026-08-25T00:00:01.000Z',
      );
    const group = createVideoCandidateGroup(db, {
      shotId: '9',
      videoGenerationIds: [101, 102],
      now: '2026-08-25T00:00:02.000Z',
    });

    const selectedCandidate = group.candidates.find((candidate) => candidate.video_generation_id === 102);
    const selected = selectCandidate(db, group.id, selectedCandidate.id, {
      selectedBy: 'director-user',
      reason: 'best motion',
      now: '2026-08-25T00:00:03.000Z',
    });

    assert.equal(selected.status, 'selected');
    assert.equal(selected.selected_candidate_id, selectedCandidate.id);
    assert.equal(selected.selected_artifact_id, null);
    assert.equal(selected.candidates.find((candidate) => candidate.id === selectedCandidate.id).status, 'selected');
    assert.equal(selected.candidates.find((candidate) => candidate.id !== selectedCandidate.id).status, 'rejected');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_candidates WHERE group_id = ?').get(group.id).count, 2);
    assert.deepEqual(db.prepare('SELECT video_url, local_path FROM storyboards WHERE id = 9').get(), {
      video_url: null,
      local_path: 'projects/demo/videos/local.mp4',
    });
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = 102').get().status, 'selected');
    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = 101').get().status, 'review');
  });

  it('records Director selection when the unified lifecycle already reports selected', () => {
    db.prepare('INSERT INTO storyboards (id) VALUES (10)').run();
    db.prepare(`INSERT INTO video_generations
      (id, storyboard_id, provider, model, video_url, status, created_at, updated_at)
      VALUES (103, 10, 'cloud', 'cloud-model', 'https://cdn.example.test/already-selected.mp4',
        'selected', ?, ?)`)
      .run('2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const group = createVideoCandidateGroup(db, { shotId: '10', videoGenerationIds: [103] });

    const selected = selectCandidate(db, group.id, group.candidates[0].id);

    assert.equal(selected.status, 'selected');
    assert.equal(selected.selected_candidate_id, group.candidates[0].id);
    assert.equal(db.prepare('SELECT video_url FROM storyboards WHERE id = 10').get().video_url,
      'https://cdn.example.test/already-selected.mp4');
  });

  it('bridges a playable unified candidate to one ready QC artifact and a selected anchor source', async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-unified-artifact-'));
    try {
      const localPath = 'projects/demo/videos/candidate.mp4';
      const absolutePath = path.join(storageRoot, ...localPath.split('/'));
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, 'canonical-video-bytes');
      db.prepare('INSERT INTO storyboards (id) VALUES (11)').run();
      db.prepare(`INSERT INTO video_generations
        (id, storyboard_id, provider, protocol, model, video_url, local_path, status,
         width, height, frame_rate, duration, created_at, updated_at, completed_at)
        VALUES (104, 11, 'cloud', 'cloud-v1', 'cloud-model', ?, ?, 'review',
          1280, 704, 24, 5, ?, ?, ?)`)
        .run(
          'https://cdn.example.test/candidate.mp4',
          localPath,
          '2026-08-25T00:00:00.000Z',
          '2026-08-25T00:01:00.000Z',
          '2026-08-25T00:01:00.000Z',
        );
      const created = createVideoCandidateGroup(db, { shotId: '11', videoGenerationIds: [104] });

      const review = getCandidateGroup(db, created.id, { storageRoot });
      const candidate = review.candidates[0];
      assert.equal(review.status, 'review');
      assert.equal(candidate.status, 'review');
      assert.doesNotMatch(candidate.artifact_id, /^pending-video-/);
      assert.equal(candidate.artifact.status, 'ready');
      assert.deepEqual(candidate.artifact.media, {
        width: 1280,
        height: 704,
        codec: null,
        frame_rate: '24/1',
        duration: 5,
      });
      const qcArtifact = getCandidateArtifact(db, candidate.artifact_id);
      assert.equal(qcArtifact.artifact_path, absolutePath);
      assert.equal(qcArtifact.status, 'ready');
      assert.deepEqual(qcArtifact.manifest.metadata, {
        source: 'unified_video_generation',
        videoGenerationId: 104,
        candidateGroupId: created.id,
        provider: 'cloud',
        protocol: 'cloud-v1',
        model: 'cloud-model',
        videoUrl: 'https://cdn.example.test/candidate.mp4',
        localPath,
      });

      const secondRead = getCandidateGroup(db, created.id, { storageRoot });
      assert.equal(secondRead.candidates[0].artifact_id, candidate.artifact_id);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_artifacts WHERE id = ?')
        .get(candidate.artifact_id).count, 1);

      const selected = selectCandidate(db, created.id, candidate.id, { storageRoot });
      assert.equal(selected.selected_artifact_id, candidate.artifact_id);
      const anchor = await createContinuityAnchor(db, {
        artifactId: candidate.artifact_id,
        frameNumber: 12,
        referenceRole: 'state',
        outputDir: storageRoot,
        frameExtractor: async ({ outputPath }) => fs.writeFileSync(outputPath, 'anchor-frame'),
      });
      assert.equal(anchor.source_artifact_id, candidate.artifact_id);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('adds the nullable unified video link idempotently without changing legacy candidates', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE director_candidates (
        id TEXT PRIMARY KEY, group_id TEXT, artifact_id TEXT, job_id TEXT, status TEXT
      );
      INSERT INTO director_candidates (id, group_id, artifact_id, job_id, status)
      VALUES ('legacy-candidate', 'legacy-group', 'legacy-artifact', 'legacy-job', 'review');
    `);

    runMigrationsAndEnsure(legacyDb);
    runMigrationsAndEnsure(legacyDb);

    assert.deepEqual(
      legacyDb.prepare(`SELECT id, artifact_id, job_id, video_generation_id, status
        FROM director_candidates WHERE id = 'legacy-candidate'`).get(),
      {
        id: 'legacy-candidate',
        artifact_id: 'legacy-artifact',
        job_id: 'legacy-job',
        video_generation_id: null,
        status: 'review',
      },
    );
    legacyDb.close();
  });

  it('exposes prompt snapshots and generation timing on candidates', () => {
    db.exec(`CREATE TABLE director_jobs (
      id TEXT PRIMARY KEY, status TEXT, attempt_number INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3, error_code TEXT, error_message TEXT,
      input_json TEXT NOT NULL DEFAULT '{}', started_at TEXT, completed_at TEXT,
      created_at TEXT, updated_at TEXT)`);
    const jobId = id();
    db.prepare(`INSERT INTO director_jobs (id, status, input_json, started_at, completed_at, created_at, updated_at)
      VALUES (?, 'succeeded', ?, '2026-08-29T00:00:00.000Z', '2026-08-29T00:03:12.000Z', ?, ?)`)
      .run(jobId, JSON.stringify({ prompt: 'H3 提示词快照', workflowId: 'minimax_h3_director_r2v' }), '2026-08-29T00:00:00.000Z', '2026-08-29T00:03:12.000Z');
    const h3Artifact = id();
    db.prepare(`INSERT INTO director_artifacts (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at)
      VALUES (?, ?, 1, 1, 'ready', '/tmp/h3.mp4', 'h3-hash', 1, '{}', ?)`).run(h3Artifact, jobId, '2026-08-29T00:03:12.000Z');
    const h3Group = createCandidateGroup(db, {
      shotId: 'shot-h3',
      candidates: [{ artifactId: h3Artifact, jobId }],
    });

    const unifiedVideoId = Number(db.prepare(`INSERT INTO video_generations
      (storyboard_id, provider, prompt, video_url, local_path, status, created_at, updated_at, completed_at)
      VALUES (501, 'comfyui', '统一通道提示词快照', '/v/u.mp4', 'data/u.mp4', 'completed', '2026-08-29T01:00:00.000Z', '2026-08-29T01:04:30.000Z', '2026-08-29T01:04:30.000Z')`)
      .run().lastInsertRowid);
    const unifiedGroup = createVideoCandidateGroup(db, {
      shotId: 'shot-unified',
      candidateCount: 1,
      videoGenerationIds: [Number(unifiedVideoId)],
    });

    const groups = getCandidateGroupsByShot(db, 'shot-h3');
    const h3Candidate = groups.find((g) => g.id === h3Group.id).candidates[0];
    assert.equal(h3Candidate.job_input_json, JSON.stringify({ prompt: 'H3 提示词快照', workflowId: 'minimax_h3_director_r2v' }));
    assert.equal(h3Candidate.job_started_at, '2026-08-29T00:00:00.000Z');
    assert.equal(h3Candidate.job_completed_at, '2026-08-29T00:03:12.000Z');

    const unifiedGroups = getCandidateGroupsByShot(db, 'shot-unified');
    const unifiedCandidate = unifiedGroups.find((g) => g.id === unifiedGroup.id).candidates[0];
    assert.equal(unifiedCandidate.video_generation.prompt_snapshot, '统一通道提示词快照');
    assert.equal(unifiedCandidate.video_generation.created_at, '2026-08-29T01:00:00.000Z');
    assert.equal(unifiedCandidate.video_generation.completed_at, '2026-08-29T01:04:30.000Z');
  });
});
