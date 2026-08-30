const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/services/episodeGenerationProgressService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER, deleted_at TEXT);
    CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, creation_mode TEXT,
      image_url TEXT, local_path TEXT, composed_image TEXT, first_frame_image_id INTEGER,
      last_frame_image_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER,
      character_id INTEGER, provider TEXT, frame_type TEXT, image_url TEXT, local_path TEXT,
      status TEXT, task_id TEXT, error_msg TEXT, created_at TEXT, updated_at TEXT
      ,deleted_at TEXT
    );
    CREATE TABLE image_generation_tasks (
      id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER,
      status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY, type TEXT, status TEXT, progress INTEGER, message TEXT,
      error TEXT, resource_id TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT
      ,deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, provider TEXT,
      model TEXT, status TEXT, video_url TEXT, local_path TEXT, task_id TEXT,
      error_msg TEXT, created_at TEXT, updated_at TEXT
      ,deleted_at TEXT
    );
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY, episode_id INTEGER, drama_id INTEGER, status TEXT,
      task_id TEXT, merged_url TEXT, error_msg TEXT, created_at TEXT, completed_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare("INSERT INTO dramas (id, metadata) VALUES (1, '{\"storyboard_use_first_last_frame\":true}')").run();
  db.prepare('INSERT INTO episodes (id, drama_id, episode_number) VALUES (10, 1, 2)').run();
  db.prepare('INSERT INTO episode_characters VALUES (10, 1), (10, 2)').run();
  db.prepare("INSERT INTO characters (id, drama_id, local_path) VALUES (1, 1, 'characters/one.jpg'), (2, 1, NULL)").run();
  db.prepare("INSERT INTO scenes (id, drama_id, episode_id, image_url) VALUES (3, 1, 10, 'https://img/scene.jpg')").run();
  db.prepare('INSERT INTO props (id, drama_id, episode_id) VALUES (4, 1, 10), (5, 1, NULL)').run();
  db.prepare('INSERT INTO storyboards (id, episode_id, storyboard_number, creation_mode) VALUES (100, 10, 1, \'classic\'), (101, 10, 2, \'universal\')').run();
  db.prepare('INSERT INTO storyboard_props VALUES (101, 5)').run();
  return db;
}

describe('episode generation progress aggregation', () => {
  test('derives image targets and separates bound, active, review, failed, and pending work', () => {
    const db = createDb();
    db.prepare("INSERT INTO image_generations (id, drama_id, character_id, status, local_path, created_at, updated_at) VALUES (11, 1, 1, 'completed', 'characters/one.jpg', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('char-active', 1, 'character', 1, 'generating', '2026-01-02', '2026-01-02')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('char-review', 1, 'character', 2, 'needs_review', '2026-01-02', '2026-01-02')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('scene-done', 1, 'scene', 3, 'completed', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO image_generations (id, drama_id, scene_id, status, image_url, created_at, updated_at) VALUES (12, 1, 3, 'completed', 'https://img/scene.jpg', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('prop-failed', 1, 'prop', 4, 'failed', '2026-01-02', '2026-01-02')").run();

    const result = service.getEpisodeGenerationProgress(db, 10);

    assert.equal(result.image.by_type.characters.total, 2);
    assert.equal(result.image.by_type.characters.completed, 1);
    assert.equal(result.image.by_type.characters.active, 1);
    assert.equal(result.image.by_type.characters.needs_review, 1);
    assert.equal(result.image.by_type.scenes.completed, 1);
    assert.equal(result.image.by_type.props.failed, 1);
    assert.equal(result.image.completed, 2);
    assert.equal(result.image.failed, 1);
    assert.equal(result.image.percent, 25);
    db.close();
  });

  test('counts first/last frame targets only for classic storyboards and keeps universal main target', () => {
    const db = createDb();
    db.prepare("INSERT INTO image_generations (id, drama_id, storyboard_id, frame_type, status, image_url, created_at, updated_at) VALUES (21, 1, 100, 'storyboard_first', 'completed', 'first.jpg', '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('last-active', 1, 'storyboard_last', 100, 'queued', '2026-01-02', '2026-01-02')").run();
    db.prepare("INSERT INTO image_generation_tasks VALUES ('universal-main', 1, 'storyboard_main', 101, 'queued', '2026-01-02', '2026-01-02')").run();

    const result = service.getEpisodeGenerationProgress(db, 10);

    assert.equal(result.image.by_type.storyboard_main.total, 1);
    assert.equal(result.image.by_type.storyboard_first.total, 1);
    assert.equal(result.image.by_type.storyboard_first.completed, 1);
    assert.equal(result.image.by_type.storyboard_last.total, 1);
    assert.equal(result.image.by_type.storyboard_last.active, 1);
    db.close();
  });

  test('requires a playable URL/path for video completion and exposes async progress and merge status', () => {
    const db = createDb();
    db.prepare("INSERT INTO async_tasks VALUES ('video-task', 'video_generation', 'processing', 42, 'provider running', NULL, '100', '2026-01-02', '2026-01-02', NULL, NULL)").run();
    db.prepare("INSERT INTO video_generations (id, drama_id, storyboard_id, provider, model, status, video_url, local_path, task_id, error_msg, created_at, updated_at) VALUES (31, 1, 100, 'provider-a', 'model-a', 'processing', NULL, NULL, 'video-task', NULL, '2026-01-02', '2026-01-02')").run();
    db.prepare("INSERT INTO video_generations (id, drama_id, storyboard_id, provider, model, status, video_url, local_path, task_id, error_msg, created_at, updated_at) VALUES (32, 1, 101, 'provider-b', 'model-b', 'completed', 'https://video/ok.mp4', NULL, NULL, NULL, '2026-01-02', '2026-01-02')").run();
    db.prepare("INSERT INTO video_merges VALUES (41, 10, 1, 'processing', 'merge-task', NULL, NULL, '2026-01-02', NULL, NULL)").run();
    db.prepare("INSERT INTO async_tasks VALUES ('merge-task', 'video_merge', 'processing', 66, 'merging', NULL, '10', '2026-01-02', '2026-01-02', NULL, NULL)").run();

    const result = service.getEpisodeGenerationProgress(db, 10);

    assert.equal(result.video.total, 2);
    assert.equal(result.video.completed, 1);
    assert.equal(result.video.active, 1);
    assert.equal(result.video.percent, 50);
    assert.equal(result.video.active_items[0].progress, 42);
    assert.equal(result.video.active_items[0].status, 'running');
    assert.equal(result.merge.status, 'processing');
    assert.equal(result.merge.progress, 66);
    db.close();
  });

  test('returns zeroed progress for an empty episode and rejects missing episodes', () => {
    const db = createDb();
    db.prepare('INSERT INTO episodes (id, drama_id, episode_number) VALUES (11, 1, 3)').run();
    const empty = service.getEpisodeGenerationProgress(db, 11);
    assert.equal(empty.image.total, 0);
    assert.equal(empty.image.percent, 0);
    assert.equal(empty.video.total, 0);
    assert.equal(empty.video.percent, 0);
    assert.equal(empty.merge, null);
    assert.throws(() => service.getEpisodeGenerationProgress(db, 999), (error) => error.code === 'EPISODE_NOT_FOUND');
    db.close();
  });
});
