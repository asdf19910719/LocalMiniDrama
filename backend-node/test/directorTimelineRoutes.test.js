const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const createRoutes = require('../src/routes/director');

function id() { return crypto.randomUUID(); }
function responseCapture() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

describe('Director timeline routes', () => {
  let db;
  let routes;
  let artifactId;
  let artifactRoot;

  beforeEach(() => {
    db = new Database(':memory:');
    artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'director-timeline-route-'));
    const artifactPath = path.join(artifactRoot, 'shot.mp4');
    fs.writeFileSync(artifactPath, 'video');
    db.exec(`
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY, status TEXT, artifact_path TEXT, sha256 TEXT,
        file_size INTEGER, ffprobe_json TEXT, manifest_json TEXT, created_at TEXT
      );
      CREATE TABLE director_candidate_groups (id TEXT PRIMARY KEY, status TEXT, selected_artifact_id TEXT);
      CREATE TABLE director_timelines (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL,
        manifest_json TEXT NOT NULL, ffmpeg_command TEXT NOT NULL, output_path TEXT,
        output_sha256 TEXT, ffprobe_json TEXT, created_at TEXT NOT NULL
      );
    `);
    artifactId = id();
    db.prepare(`INSERT INTO director_artifacts
      (id,status,artifact_path,sha256,file_size,ffprobe_json,manifest_json,created_at)
      VALUES (?, 'ready', ?, 'hash', 10, ?, '{}', ?)`).run(
      artifactId,
      artifactPath,
      JSON.stringify({ streams: [{ codec_type: 'video', r_frame_rate: '24/1', width: 864, height: 480, pix_fmt: 'yuv420p' }] }),
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO director_candidate_groups (id,status,selected_artifact_id) VALUES (?, \'selected\', ?)').run(id(), artifactId);
    routes = createRoutes(db, { error() {} }, { artifactRoot, allowedLocalRoots: [artifactRoot] });
  });

  afterEach(() => db.close());

  it('creates a validated timeline from selected clips', () => {
    const res = responseCapture();
    routes.createTimeline({ body: {
      output: { width: 864, height: 480, fps: 24, pixelFormat: 'yuv420p' },
      clips: [{ artifactId, startTime: 0, duration: 2, sourceOffset: 0, sourceDuration: 2 }],
      audioSources: [], outputPath: 'timeline.mp4',
    } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.version, 'timeline_v1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_timelines').get().count, 1);
  });

  it('rejects an invalid timeline before persistence', () => {
    const res = responseCapture();
    routes.createTimeline({ body: {
      clips: [{ artifactId, startTime: 1, duration: 2, sourceOffset: 0, sourceDuration: 2 }],
    } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_timelines').get().count, 0);
  });

  it('rejects timeline output paths outside configured roots', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'director-timeline-outside-'));
    const res = responseCapture();
    routes.createTimeline({ body: {
      clips: [{ artifactId, startTime: 0, duration: 2, sourceOffset: 0, sourceDuration: 2 }],
      outputPath: path.join(outside, 'timeline.mp4'),
    } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /allowed local roots/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM director_timelines').get().count, 0);
  });

  it('rejects postproduction media paths outside configured roots', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'director-audio-outside-'));
    const musicPath = path.join(outside, 'music.mp3');
    fs.writeFileSync(musicPath, 'audio');
    const res = responseCapture();
    routes.createTimeline({ body: {
      clips: [{ artifactId, startTime: 0, duration: 2, sourceOffset: 0, sourceDuration: 2 }],
      outputPath: 'timeline.mp4',
      postproduction: { musicPath },
    } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /allowed local roots/i);
  });
});
