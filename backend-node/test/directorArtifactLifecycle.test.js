const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { archiveUnreferencedArtifacts, createArtifactBundle, getArtifactUsage, restoreArtifactBundle } = require('../src/director/directorArtifactLifecycle');

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

describe('Director artifact lifecycle', { concurrency: false }, () => {
  let db;
  let root;
  before(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, artifact_path TEXT NOT NULL,
        parent_artifact_id TEXT, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL,
        ffprobe_json TEXT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, ready_at TEXT
      );
      CREATE TABLE director_candidate_groups (id TEXT PRIMARY KEY, status TEXT, selected_artifact_id TEXT);
      CREATE TABLE director_anchors (id TEXT PRIMARY KEY, source_artifact_id TEXT, derived_artifact_id TEXT);
      CREATE TABLE director_jobs (id TEXT PRIMARY KEY, status TEXT, artifact_path TEXT, artifact_id TEXT);
      CREATE TABLE director_candidates (id TEXT PRIMARY KEY, group_id TEXT, artifact_id TEXT, job_id TEXT, status TEXT);
    `);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-lifecycle-'));
    db.exec(`
      DELETE FROM director_anchors;
      DELETE FROM director_candidates;
      DELETE FROM director_candidate_groups;
      DELETE FROM director_artifacts;
      DELETE FROM director_jobs;
    `);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  after(() => db.close());

  function addArtifact(id, content, selected = false) {
    const filePath = path.join(root, `${id}.mp4`);
    const bytes = Buffer.from(content);
    fs.writeFileSync(filePath, bytes);
    db.prepare(`INSERT INTO director_artifacts
      (id,job_id,attempt_number,version,status,artifact_path,sha256,file_size,manifest_json,created_at)
      VALUES (?, ?, 1, 1, 'ready', ?, ?, ?, '{}', ?)`).run(id, `job-${id}`, filePath, hash(bytes), bytes.length, new Date().toISOString());
    db.prepare("INSERT INTO director_jobs (id,status,artifact_path,artifact_id) VALUES (?, 'succeeded', ?, ?)").run(`job-${id}`, filePath, id);
    if (selected) {
      db.prepare("INSERT INTO director_candidate_groups (id,status,selected_artifact_id) VALUES (?, 'selected', ?)").run(`group-${id}`, id);
      db.prepare("INSERT INTO director_candidates (id,group_id,artifact_id,job_id,status) VALUES (?, ?, ?, ?, 'selected')")
        .run(`candidate-${id}`, `group-${id}`, id, `job-${id}`);
    }
    return filePath;
  }

  it('reports usage and recoverably archives only unreferenced artifacts', () => {
    const selectedPath = addArtifact('selected', 'selected-video', true);
    const disposablePath = addArtifact('disposable', 'old-candidate');
    assert.equal(getArtifactUsage(db).totalBytes, 27);
    const result = archiveUnreferencedArtifacts(db, { artifactRoot: root, targetBytes: 10 });
    assert.deepEqual(result.archivedArtifactIds, ['disposable']);
    assert.equal(fs.existsSync(selectedPath), true);
    assert.equal(fs.existsSync(disposablePath), false);
    const archived = db.prepare("SELECT * FROM director_artifacts WHERE id = 'disposable'").get();
    assert.equal(archived.status, 'archived');
    assert.equal(fs.existsSync(archived.artifact_path), true);
  });

  it('creates a hash-verified bundle and restores its files', () => {
    addArtifact('selected', 'selected-video', true);
    const bundlePath = path.join(root, 'backup.zip');
    createArtifactBundle(db, { artifactIds: ['selected'], outputPath: bundlePath, artifactRoot: root });
    const restoreRoot = path.join(root, 'restored');
    db.prepare("DELETE FROM director_candidates WHERE artifact_id = 'selected'").run();
    db.prepare("DELETE FROM director_candidate_groups WHERE selected_artifact_id = 'selected'").run();
    db.prepare("DELETE FROM director_artifacts WHERE id = 'selected'").run();
    db.prepare("DELETE FROM director_jobs WHERE id = 'job-selected'").run();
    const restored = restoreArtifactBundle({ db, bundlePath, restoreRoot });
    assert.equal(restored.artifacts.length, 1);
    assert.equal(fs.readFileSync(restored.artifacts[0].artifactPath, 'utf8'), 'selected-video');
    assert.equal(restored.artifacts[0].sha256, hash(Buffer.from('selected-video')));
    assert.equal(db.prepare("SELECT status FROM director_artifacts WHERE id = 'selected'").get().status, 'ready');
    assert.equal(db.prepare("SELECT artifact_path FROM director_jobs WHERE id = 'job-selected'").get().artifact_path, restored.artifacts[0].artifactPath);
    assert.equal(db.prepare("SELECT selected_artifact_id FROM director_candidate_groups WHERE id = 'group-selected'").get().selected_artifact_id, 'selected');
    assert.equal(db.prepare("SELECT status FROM director_candidates WHERE id = 'candidate-selected'").get().status, 'selected');
  });

  it('expands a bundle to include both ends of an anchor relationship', () => {
    addArtifact('source', 'source-video', true);
    addArtifact('derived', 'derived-frame');
    db.prepare('INSERT INTO director_anchors (id,source_artifact_id,derived_artifact_id) VALUES (?, ?, ?)')
      .run('anchor-1', 'source', 'derived');

    const bundle = createArtifactBundle(db, {
      artifactIds: ['source'],
      outputPath: path.join(root, 'anchor-backup.zip'),
      artifactRoot: root,
    });

    assert.deepEqual(bundle.artifacts.map((artifact) => artifact.id).sort(), ['derived', 'source']);
    assert.deepEqual(bundle.relationships.anchors.map((anchor) => anchor.id), ['anchor-1']);
  });

  it('rejects a relationship that points outside the bundle before writing files', () => {
    addArtifact('selected', 'selected-video', true);
    const bundlePath = path.join(root, 'tampered.zip');
    createArtifactBundle(db, { artifactIds: ['selected'], outputPath: bundlePath, artifactRoot: root });
    const zip = new AdmZip(bundlePath);
    const bundle = JSON.parse(zip.readAsText('bundle.json'));
    bundle.relationships.candidateGroups[0].selected_artifact_id = 'missing-artifact';
    zip.updateFile('bundle.json', Buffer.from(JSON.stringify(bundle), 'utf8'));
    zip.writeZip(bundlePath);
    const restoreRoot = path.join(root, 'tampered-restore');

    assert.throws(() => restoreArtifactBundle({ db, bundlePath, restoreRoot }), /relationship closure/i);
    assert.equal(fs.existsSync(path.join(restoreRoot, 'selected.mp4')), false);
  });

  it('rolls back database records and restored files when relationship persistence fails', () => {
    addArtifact('selected', 'selected-video', true);
    const bundlePath = path.join(root, 'failure.zip');
    createArtifactBundle(db, { artifactIds: ['selected'], outputPath: bundlePath, artifactRoot: root });
    db.exec(`
      DELETE FROM director_candidates;
      DELETE FROM director_candidate_groups;
      DELETE FROM director_artifacts;
      DELETE FROM director_jobs;
    `);
    const restoreRoot = path.join(root, 'failure-restore');
    const failingDb = {
      prepare(sql) {
        if (/INSERT INTO director_candidates/.test(sql)) throw new Error('injected candidate restore failure');
        return db.prepare(sql);
      },
      transaction(callback) { return db.transaction(callback); },
    };

    assert.throws(() => restoreArtifactBundle({ db: failingDb, bundlePath, restoreRoot }), /injected candidate restore failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM director_artifacts WHERE id = 'selected'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM director_jobs WHERE id = 'job-selected'").get().count, 0);
    assert.equal(fs.existsSync(path.join(restoreRoot, 'selected.mp4')), false);
  });

  it('does not bundle a symlink that resolves outside the artifact root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'director-lifecycle-outside-'));
    const outsidePath = path.join(outside, 'secret.mp4');
    fs.writeFileSync(outsidePath, 'secret');
    const linkPath = path.join(root, 'linked.mp4');
    try { fs.symlinkSync(outsidePath, linkPath, 'file'); } catch (error) { return; }
    db.prepare(`INSERT INTO director_artifacts
      (id,job_id,attempt_number,version,status,artifact_path,sha256,file_size,manifest_json,created_at)
      VALUES ('symlink','job-symlink',1,1,'ready',?,'${hash(Buffer.from('secret'))}',6,'{}',?)`).run(linkPath, new Date().toISOString());
    assert.throws(() => createArtifactBundle(db, { artifactIds: ['symlink'], outputPath: path.join(root, 'bad.zip'), artifactRoot: root }), /cannot be bundled/i);
  });
});
