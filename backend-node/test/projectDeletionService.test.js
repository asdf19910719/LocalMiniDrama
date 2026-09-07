const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  previewProjectDeletion,
  deleteProjectPermanently,
} = require('../src/services/projectDeletionService');

function setup() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-delete-'));
  const now = '2026-09-07T00:00:00.000Z';
  const insert = (sql, ...params) => db.prepare(sql).run(...params);

  insert(`INSERT INTO dramas (id, title, metadata, status, created_at, updated_at)
    VALUES (1, '删除目标', ?, 'draft', ?, ?), (2, '保留项目', ?, 'draft', ?, ?)`,
  JSON.stringify({ storage_folder_label: 'target' }), now, now,
  JSON.stringify({ storage_folder_label: 'keep' }), now, now);
  insert("INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (11, 1, 1, '目标集', 'draft', ?, ?), (21, 2, 1, '保留集', 'draft', ?, ?)", now, now, now, now);
  insert("INSERT INTO storyboards (id, episode_id, storyboard_number, status, created_at, updated_at) VALUES (111, 11, 1, 'draft', ?, ?), (211, 21, 1, 'draft', ?, ?)", now, now, now, now);
  insert("INSERT INTO characters (id, drama_id, name, created_at, updated_at) VALUES (12, 1, '目标角色', ?, ?), (22, 2, '保留角色', ?, ?)", now, now, now, now);
  insert("INSERT INTO scenes (id, drama_id, episode_id, location, created_at, updated_at) VALUES (13, 1, 11, '目标场景', ?, ?), (23, 2, 21, '保留场景', ?, ?)", now, now, now, now);
  insert("INSERT INTO props (id, drama_id, episode_id, name, created_at, updated_at) VALUES (14, 1, 11, '目标道具', ?, ?), (24, 2, 21, '保留道具', ?, ?)", now, now, now, now);
  insert('INSERT INTO episode_characters (episode_id, character_id) VALUES (11, 12), (21, 22)');
  insert('INSERT INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (111, 12, ?), (211, 22, ?)', now, now);
  insert('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (111, 14), (211, 24)');
  insert("INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, created_at, updated_at) VALUES (111, 'first', '目标提示词', ?, ?), (211, 'first', '保留提示词', ?, ?)", now, now, now, now);
  insert("INSERT INTO storyboard_h3_prompt_drafts (storyboard_id, status, created_at, updated_at) VALUES (111, 'valid', ?, ?), (211, 'valid', ?, ?)", now, now, now, now);
  insert("INSERT INTO character_variants (id, character_id, name, created_at, updated_at) VALUES (15, 12, '目标变体', ?, ?), (25, 22, '保留变体', ?, ?)", now, now, now, now);
  insert('INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id) VALUES (111, 12, 15), (211, 22, 25)');
  insert("INSERT INTO character_libraries (drama_id, name, created_at, updated_at) VALUES (1, '目标库角色', ?, ?), (2, '保留库角色', ?, ?), (NULL, '公共角色', ?, ?)", now, now, now, now, now, now);
  insert("INSERT INTO scene_libraries (drama_id, location, created_at, updated_at) VALUES (1, '目标库场景', ?, ?), (2, '保留库场景', ?, ?), (NULL, '公共场景', ?, ?)", now, now, now, now, now, now);
  insert("INSERT INTO prop_libraries (drama_id, name, created_at, updated_at) VALUES (1, '目标库道具', ?, ?), (2, '保留库道具', ?, ?), (NULL, '公共道具', ?, ?)", now, now, now, now, now, now);
  insert("INSERT INTO assets (drama_id, name, created_at, updated_at) VALUES (1, '目标素材', ?, ?), (2, '保留素材', ?, ?), (NULL, '公共素材', ?, ?)", now, now, now, now, now, now);
  insert("INSERT INTO image_generations (id, drama_id, storyboard_id, character_id, scene_id, status, created_at, updated_at) VALUES (16, 1, 111, 12, 13, 'completed', ?, ?), (26, 2, 211, 22, 23, 'completed', ?, ?)", now, now, now, now);
  insert("INSERT INTO video_generations (id, drama_id, storyboard_id, scene_id, status, created_at, updated_at) VALUES (17, 1, 111, 13, 'completed', ?, ?), (27, 2, 211, 23, 'completed', ?, ?)", now, now, now, now);
  insert("INSERT INTO video_merges (id, drama_id, episode_id, status, created_at) VALUES (18, 1, 11, 'completed', ?), (28, 2, 21, 'completed', ?)", now, now);
  insert("INSERT INTO image_generation_batches (id, drama_id, resource_scope, generation_channel, created_at, updated_at) VALUES ('batch-1', 1, 'project', 'local', ?, ?), ('batch-2', 2, 'project', 'local', ?, ?)", now, now, now, now);
  insert("INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, batch_id, created_at, updated_at) VALUES ('task-1', 1, 'storyboard_main', 111, 'local', 'batch-1', ?, ?), ('task-2', 2, 'storyboard_main', 211, 'local', 'batch-2', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_jobs (id, drama_id, storyboard_id, site, prompt_snapshot, prompt_hash, created_at, updated_at) VALUES ('job-1', 1, 111, 'site', '目标', 'hash', ?, ?), ('job-2', 2, 211, 'site', '保留', 'hash', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_attempts (id, job_id, sequence, created_at, updated_at) VALUES ('attempt-1', 'job-1', 1, ?, ?), ('attempt-2', 'job-2', 1, ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_results (id, attempt_id, result_index, created_at, updated_at) VALUES ('result-1', 'attempt-1', 1, ?, ?), ('result-2', 'attempt-2', 1, ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_events (id, attempt_id, idempotency_key, sequence, event_type, created_at) VALUES ('event-1', 'attempt-1', 'idem-1', 1, 'done', ?), ('event-2', 'attempt-2', 'idem-2', 1, 'done', ?)", now, now);
  insert("INSERT INTO external_generation_sessions (id, drama_id, site, created_at, updated_at) VALUES ('session-1', 1, 'site', ?, ?), ('session-2', 2, 'site', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_ai_package_tasks (package_id, drama_id, target_episode_number, assets_digest, context_markdown, instructions_markdown, asset_manifest_json, asset_snapshot_json, response_schema_json, created_at) VALUES ('package-1', 1, 1, 'digest', 'context', 'instructions', '{}', '{}', '{}', ?), ('package-2', 2, 1, 'digest', 'context', 'instructions', '{}', '{}', '{}', ?)", now, now);
  insert("INSERT INTO async_tasks (id, type, status, resource_id, created_at, updated_at) VALUES ('async-1', 'image', 'completed', '16', ?, ?), ('async-2', 'image', 'completed', '26', ?, ?)", now, now, now, now);

  const projectDir = path.join(storageRoot, 'projects', '0001_20260907_target');
  fs.mkdirSync(path.join(projectDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'cover.txt'), 'cover');
  fs.writeFileSync(path.join(projectDir, 'nested', 'clip.bin'), '1234');
  return { db, storageRoot, projectDir };
}

function count(db, table, where = '', ...params) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).total;
}

test('preview is non-mutating and permanent deletion removes only target project ownership', (t) => {
  const { db, storageRoot, projectDir } = setup();
  t.after(() => {
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  const cfg = { storage: { local_path: storageRoot } };

  const preview = previewProjectDeletion(db, cfg, 1);
  assert.equal(preview.project.id, 1);
  assert.equal(preview.counts.dramas, 1);
  assert.equal(preview.counts.episodes, 1);
  assert.equal(preview.counts.external_generation_jobs, 1);
  assert.equal(preview.counts.external_generation_events, 1);
  assert.equal(preview.counts.async_tasks, 1);
  assert.equal(preview.storage.directory, projectDir);
  assert.equal(preview.storage.file_count, 2);
  assert.equal(preview.storage.bytes, 9);
  assert.equal(count(db, 'dramas'), 2);
  assert.equal(count(db, 'external_generation_jobs'), 2);
  assert.equal(fs.existsSync(projectDir), true);

  const result = deleteProjectPermanently(db, cfg, { error() {} }, 1);
  assert.equal(result.deleted, true);
  assert.equal(result.counts.dramas, 1);
  assert.equal(result.counts.episodes, 1);
  assert.equal(result.counts.external_generation_jobs, 1);
  assert.equal(result.storage.cleanup_status, 'deleted');
  assert.equal(fs.existsSync(projectDir), false);
  for (const table of [
    'dramas', 'episodes', 'storyboards', 'characters', 'scenes', 'props', 'frame_prompts',
    'character_variants', 'image_generations', 'video_generations', 'video_merges',
    'external_generation_jobs', 'external_generation_attempts', 'external_generation_results',
    'external_generation_events', 'external_generation_sessions', 'external_ai_package_tasks',
  ]) assert.equal(count(db, table), 1, `${table} should retain only the other project`);
  assert.equal(count(db, 'character_libraries'), 2);
  assert.equal(count(db, 'scene_libraries'), 2);
  assert.equal(count(db, 'prop_libraries'), 2);
  assert.equal(count(db, 'assets'), 2);
  assert.equal(count(db, 'async_tasks'), 1);
  assert.equal(count(db, 'image_generation_batches'), 1);
  assert.equal(count(db, 'image_generation_tasks'), 1);
  assert.equal(deleteProjectPermanently(db, cfg, { error() {} }, 1), null);
});

test('permanent deletion removes episode import and upscale leaf records', (t) => {
  const { db, storageRoot } = setup();
  t.after(() => { db.close(); fs.rmSync(storageRoot, { recursive: true, force: true }); });
  const now = '2026-09-07T00:00:00.000Z';
  db.prepare("INSERT INTO episode_imports (episode_id, schema_name, imported_at) VALUES (11, 'episode-package', ?), (21, 'episode-package', ?)").run(now, now);
  db.prepare(`INSERT INTO video_upscale_jobs (id, episode_id, video_merge_id, method, workflow_id, source_path, created_at, updated_at)
    VALUES ('upscale-target', 11, 18, 'cloud', 'workflow', 'target.mp4', ?, ?), ('upscale-keep', 21, 28, 'cloud', 'workflow', 'keep.mp4', ?, ?)`).run(now, now, now, now);
  db.prepare(`INSERT INTO video_upscale_segments (job_id, segment_index, start_frame, requested_frame_count, created_at, updated_at)
    VALUES ('upscale-target', 0, 0, 10, ?, ?), ('upscale-keep', 0, 0, 10, ?, ?)`).run(now, now, now, now);

  deleteProjectPermanently(db, { storage: { local_path: storageRoot } }, { error() {} }, 1);

  assert.equal(count(db, 'episode_imports'), 1);
  assert.equal(count(db, 'video_upscale_jobs'), 1);
  assert.equal(count(db, 'video_upscale_segments'), 1);
});
