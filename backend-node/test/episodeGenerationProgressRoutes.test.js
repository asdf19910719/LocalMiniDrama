const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const routes = require('../src/routes/episodeGenerationProgress');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER, deleted_at TEXT);
    CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, storyboard_number INTEGER, creation_mode TEXT, image_url TEXT, local_path TEXT, first_frame_image_id INTEGER, last_frame_image_id INTEGER, deleted_at TEXT);
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, drama_id INTEGER, scene_id INTEGER, character_id INTEGER, frame_type TEXT, image_url TEXT, local_path TEXT, status TEXT, deleted_at TEXT);
    CREATE TABLE image_generation_tasks (id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER, status TEXT);
    CREATE TABLE async_tasks (id TEXT PRIMARY KEY, status TEXT, progress INTEGER, message TEXT, error TEXT, deleted_at TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, drama_id INTEGER, storyboard_id INTEGER, status TEXT, video_url TEXT, local_path TEXT, task_id TEXT, provider TEXT, model TEXT, error_msg TEXT, deleted_at TEXT);
    CREATE TABLE video_merges (id INTEGER PRIMARY KEY, episode_id INTEGER, status TEXT, task_id TEXT, error_msg TEXT, created_at TEXT, deleted_at TEXT);
    INSERT INTO dramas VALUES (1, '{}', NULL);
    INSERT INTO episodes VALUES (10, 1, 1, NULL);
    INSERT INTO storyboards VALUES (100, 10, 1, 'classic', NULL, NULL, NULL, NULL, NULL);
  `);
  return db;
}

test('returns the current episode progress envelope', async () => {
  const db = createDb();
  const app = express();
  app.use('/api/v1', express.Router().get('/episodes/:episodeId/generation-progress', routes(db).get));
  const server = app.listen(0);
  try {
    const result = await (await fetch(`http://127.0.0.1:${server.address().port}/api/v1/episodes/10/generation-progress`)).json();
    assert.equal(result.success, true);
    assert.equal(result.data.episode_id, 10);
    assert.equal(result.data.video.total, 1);
    assert.ok(result.data.generated_at);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});

test('returns 404 for an unknown episode', async () => {
  const db = createDb();
  const app = express();
  app.use('/api/v1', express.Router().get('/episodes/:episodeId/generation-progress', routes(db).get));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/episodes/999/generation-progress`);
    const result = await response.json();
    assert.equal(response.status, 404);
    assert.equal(result.error.code, 'NOT_FOUND');
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});

test('rejects an invalid episode id', async () => {
  const db = createDb();
  const app = express();
  app.use('/api/v1', express.Router().get('/episodes/:episodeId/generation-progress', routes(db).get));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/episodes/not-a-number/generation-progress`);
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.error.code, 'BAD_REQUEST');
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
