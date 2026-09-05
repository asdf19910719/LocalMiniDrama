const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const { validateTimeline, buildFfmpegCommand, createTimeline } = require('../src/director/timelineService');

function id() { return crypto.randomUUID(); }

describe('Director timeline v1', () => {
  let db;
  let artifacts;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE director_artifacts (
        id TEXT PRIMARY KEY, status TEXT, artifact_path TEXT, sha256 TEXT,
        file_size INTEGER, ffprobe_json TEXT, manifest_json TEXT, created_at TEXT
      );
      CREATE TABLE director_candidate_groups (
        id TEXT PRIMARY KEY, status TEXT, selected_artifact_id TEXT
      );
      CREATE TABLE director_timelines (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL,
        manifest_json TEXT NOT NULL, ffmpeg_command TEXT NOT NULL, output_path TEXT,
        output_sha256 TEXT, ffprobe_json TEXT, created_at TEXT NOT NULL
      );
    `);
    artifacts = [id(), id()];
    for (const artifactId of artifacts) {
      db.prepare(`INSERT INTO director_artifacts
        (id,status,artifact_path,sha256,file_size,ffprobe_json,manifest_json,created_at)
        VALUES (?, 'ready', ?, 'hash', 10, ?, '{}', ?)`).run(
        artifactId, `/media/${artifactId}.mp4`, JSON.stringify({
          streams: [{ codec_type: 'video', r_frame_rate: '24/1', width: 1080, height: 1920, pix_fmt: 'yuv420p' }],
          format: { duration: 2 },
        }), new Date().toISOString()
      );
      db.prepare('INSERT INTO director_candidate_groups (id,status,selected_artifact_id) VALUES (?, \'selected\', ?)').run(id(), artifactId);
    }
  });
  afterEach(() => db.close());

  function clip(artifactId, startTime, duration = 2) {
    return { artifactId, startTime, duration, sourceOffset: 0, sourceDuration: duration };
  }

  it('accepts selected clips with explicit timing and creates a reproducible command', () => {
    const timeline = validateTimeline(db, {
      version: 'timeline_v1', output: { width: 1080, height: 1920, fps: 24, pixelFormat: 'yuv420p' },
      clips: [clip(artifacts[0], 0), clip(artifacts[1], 2)], audioSources: [],
    });
    assert.equal(timeline.clips.length, 2);
    const command = buildFfmpegCommand(timeline, { ffmpegPath: 'ffmpeg', outputPath: '/tmp/timeline.mp4' });
    assert.match(command.command, /-i .*\.mp4/);
    assert.match(command.command, /timeline\.mp4/);
    const row = createTimeline(db, timeline, { outputPath: '/tmp/timeline.mp4' });
    assert.equal(row.version, 'timeline_v1');
    assert.equal(JSON.parse(row.input_json).clips[1].startTime, 2);
    assert.deepEqual(JSON.parse(row.manifest_json).commandArgs, command.args);
  });

  it('rejects gaps, overlaps, non-selected artifacts, duplicate audio, and mismatched media', () => {
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', clips: [clip(artifacts[0], 1)], audioSources: [] }), /gap|start at 0/i);
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', clips: [clip(artifacts[0], 0), clip(artifacts[1], 1)], audioSources: [] }), /overlap|gap/i);
    const pending = id();
    db.prepare(`INSERT INTO director_artifacts (id,status,artifact_path,sha256,file_size,ffprobe_json,manifest_json,created_at)
      VALUES (?, 'pending', '/media/pending.mp4', 'hash', 1, '{}', '{}', ?)`).run(pending, new Date().toISOString());
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', clips: [clip(pending, 0)], audioSources: [] }), /selected|ready/i);
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', clips: [clip(artifacts[0], 0)], audioSources: ['audio.wav', 'audio.wav'] }), /duplicate audio/i);
    const mismatched = id();
    db.prepare(`INSERT INTO director_artifacts
      (id,status,artifact_path,sha256,file_size,ffprobe_json,manifest_json,created_at)
      VALUES (?, 'ready', '/media/mismatch.mp4', 'hash', 1, ?, '{}', ?)`).run(
      mismatched, JSON.stringify({ streams: [{ codec_type: 'video', r_frame_rate: '30/1', width: 720, height: 1280, pix_fmt: 'yuv420p' }] }), new Date().toISOString()
    );
    db.prepare('INSERT INTO director_candidate_groups (id,status,selected_artifact_id) VALUES (?, \'selected\', ?)').run(id(), mismatched);
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', output: { width: 1080, height: 1920, fps: 24, pixelFormat: 'yuv420p' }, clips: [clip(mismatched, 0)], audioSources: [] }), /mismatch/i);
  });

  it('rejects invalid transitions', () => {
    assert.throws(() => validateTimeline(db, { version: 'timeline_v1', clips: [{ ...clip(artifacts[0], 0), transition: { type: 'teleport', duration: 1 } }], audioSources: [] }), /transition/i);
  });

  it('rejects a clip source range beyond the probed media duration', () => {
    assert.throws(() => validateTimeline(db, {
      clips: [{ ...clip(artifacts[0], 0, 2), sourceOffset: 1.5, sourceDuration: 2 }],
      audioSources: [],
    }), /source range|media duration/i);
  });

  it('rejects stale declared source duration metadata', () => {
    assert.throws(() => validateTimeline(db, {
      clips: [{ ...clip(artifacts[0], 0, 1), sourceDuration: 99 }],
      audioSources: [],
    }), /source duration.*probe/i);
  });

  it('rejects timeline audio inputs that the video-only renderer would ignore', () => {
    assert.throws(() => validateTimeline(db, {
      clips: [clip(artifacts[0], 0)],
      audioSources: ['/media/dialogue.wav'],
      audioPolicy: 'mix',
    }), /postproduction/i);
  });

  it('builds real FFmpeg xfade filters and accounts for transition overlap', () => {
    const timeline = validateTimeline(db, {
      version: 'timeline_v1',
      clips: [
        { ...clip(artifacts[0], 0), transition: { type: 'dissolve', duration: 0.5 } },
        clip(artifacts[1], 2),
      ],
      audioSources: [],
    });
    const command = buildFfmpegCommand(timeline, { outputPath: '/tmp/dissolve.mp4' });
    assert.equal(timeline.totalDuration, 3.5);
    assert.match(command.args.join(' '), /xfade=transition=fade:duration=0\.5:offset=1\.5/);
    assert.match(command.args.join(' '), /acrossfade=d=0\.5/);
    assert.match(command.args.join(' '), /anullsrc/);
    assert.doesNotMatch(command.args.join(' '), /concat=n=2/);
  });

  it('rejects a transition on the last clip or one longer than the adjacent clip', () => {
    assert.throws(() => validateTimeline(db, {
      clips: [clip(artifacts[0], 0), { ...clip(artifacts[1], 2), transition: { type: 'fade', duration: 0.5 } }],
      audioSources: [],
    }), /last clip/i);
    assert.throws(() => validateTimeline(db, {
      clips: [{ ...clip(artifacts[0], 0), transition: { type: 'dissolve', duration: 2.1 } }, clip(artifacts[1], 2)],
      audioSources: [],
    }), /transition/i);
  });
});
