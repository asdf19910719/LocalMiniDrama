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
  insert("INSERT INTO dramas (id, title, metadata, status, created_at, updated_at, deleted_at) VALUES (3, '历史软删除项目', ?, 'draft', ?, ?, ?)", JSON.stringify({ storage_folder_label: 'legacy' }), now, now, now);
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
  insert("INSERT INTO image_generations (id, drama_id, storyboard_id, character_id, scene_id, task_id, status, created_at, updated_at) VALUES (16, 1, 111, 12, 13, 'image-task-target', 'completed', ?, ?), (26, 2, 211, 22, 23, 'image-task-keep', 'completed', ?, ?)", now, now, now, now);
  insert("INSERT INTO video_generations (id, drama_id, storyboard_id, scene_id, task_id, status, created_at, updated_at) VALUES (17, 1, 111, 13, 'video-task-target', 'completed', ?, ?), (27, 2, 211, 23, 'video-task-keep', 'completed', ?, ?)", now, now, now, now);
  insert("INSERT INTO video_merges (id, drama_id, episode_id, task_id, status, created_at) VALUES (18, 1, 11, 'merge-task-target', 'completed', ?), (28, 2, 21, 'merge-task-keep', 'completed', ?)", now, now);
  insert("INSERT INTO image_generation_batches (id, drama_id, resource_scope, generation_channel, created_at, updated_at) VALUES ('batch-1', 1, 'project', 'local', ?, ?), ('batch-2', 2, 'project', 'local', ?, ?)", now, now, now, now);
  insert("INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, batch_id, created_at, updated_at) VALUES ('task-1', 1, 'storyboard_main', 111, 'local', 'batch-1', ?, ?), ('task-2', 2, 'storyboard_main', 211, 'local', 'batch-2', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_jobs (id, drama_id, storyboard_id, site, prompt_snapshot, prompt_hash, created_at, updated_at) VALUES ('job-1', 1, 111, 'site', '目标', 'hash', ?, ?), ('job-2', 2, 211, 'site', '保留', 'hash', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_attempts (id, job_id, sequence, created_at, updated_at) VALUES ('attempt-1', 'job-1', 1, ?, ?), ('attempt-2', 'job-2', 1, ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_results (id, attempt_id, result_index, created_at, updated_at) VALUES ('result-1', 'attempt-1', 1, ?, ?), ('result-2', 'attempt-2', 1, ?, ?)", now, now, now, now);
  insert("INSERT INTO external_generation_events (id, attempt_id, idempotency_key, sequence, event_type, created_at) VALUES ('event-1', 'attempt-1', 'idem-1', 1, 'done', ?), ('event-2', 'attempt-2', 'idem-2', 1, 'done', ?)", now, now);
  insert("INSERT INTO external_generation_sessions (id, drama_id, site, created_at, updated_at) VALUES ('session-1', 1, 'site', ?, ?), ('session-2', 2, 'site', ?, ?)", now, now, now, now);
  insert("INSERT INTO external_ai_package_tasks (package_id, drama_id, target_episode_number, assets_digest, context_markdown, instructions_markdown, asset_manifest_json, asset_snapshot_json, response_schema_json, created_at) VALUES ('package-1', 1, 1, 'digest', 'context', 'instructions', '{}', '{}', '{}', ?), ('package-2', 2, 1, 'digest', 'context', 'instructions', '{}', '{}', '{}', ?)", now, now);
  insert("INSERT INTO director_jobs (id, status, created_at, updated_at) VALUES ('director-job-target', 'ready', ?, ?), ('director-job-keep', 'ready', ?, ?)", now, now, now, now);
  insert("INSERT INTO director_artifacts (id, job_id, attempt_number, version, artifact_path, sha256, file_size, manifest_json, created_at) VALUES ('artifact-target', 'director-job-target', 1, 1, 'target.mp4', 'hash', 1, '{}', ?), ('artifact-null-job', 'orphaned-director-job', 1, 1, 'target-null.mp4', 'hash', 1, '{}', ?), ('artifact-keep', 'director-job-keep', 1, 1, 'keep.mp4', 'hash', 1, '{}', ?)", now, now, now);
  insert("INSERT INTO director_candidate_groups (id, shot_id, created_at, updated_at) VALUES ('group-target', '111', ?, ?), ('group-keep', '211', ?, ?)", now, now, now, now);
  insert("INSERT INTO director_candidates (id, group_id, artifact_id, job_id, created_at, updated_at) VALUES ('candidate-target', 'group-target', 'artifact-target', 'director-job-target', ?, ?), ('candidate-null-job', 'group-target', 'artifact-null-job', NULL, ?, ?), ('candidate-keep', 'group-keep', 'artifact-keep', 'director-job-keep', ?, ?)", now, now, now, now, now, now);
  insert("INSERT INTO director_anchors (id, source_artifact_id, derived_artifact_id, frame_number, reference_role, reference_use, source_sha256, parameters_json, created_at) VALUES ('anchor-target-source', 'artifact-target', 'foreign-artifact', 1, 'source', 'reference', 'hash', '{}', ?), ('anchor-target-derived', 'foreign-artifact', 'artifact-null-job', 1, 'source', 'reference', 'hash', '{}', ?), ('anchor-keep', 'artifact-keep', 'foreign-artifact', 1, 'source', 'reference', 'hash', '{}', ?)", now, now, now);
  insert("INSERT INTO external_generation_idempotency (idempotency_key, operation, response_json, created_at) VALUES ('global-idempotency', 'global', '{}', ?)", now);
  insert("INSERT INTO async_tasks (id, type, status, resource_id, created_at, updated_at) VALUES ('image-task-target', 'image', 'completed', '16', ?, ?), ('video-task-target', 'video', 'completed', '17', ?, ?), ('merge-task-target', 'merge', 'completed', '18', ?, ?), ('async-resource-collision', 'global', 'completed', '16', ?, ?), ('image-task-keep', 'image', 'completed', '26', ?, ?), ('video-task-keep', 'video', 'completed', '27', ?, ?), ('merge-task-keep', 'merge', 'completed', '28', ?, ?)", now, now, now, now, now, now, now, now, now, now, now, now, now, now);

  const projectDir = path.join(storageRoot, 'projects', '0001_20260907_target');
  fs.mkdirSync(path.join(projectDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'cover.txt'), 'cover');
  fs.writeFileSync(path.join(projectDir, 'nested', 'clip.bin'), '1234');
  const neighboringProjectDir = path.join(storageRoot, 'projects', '0002_20260907_keep');
  fs.mkdirSync(neighboringProjectDir, { recursive: true });
  fs.writeFileSync(path.join(neighboringProjectDir, 'keep.txt'), 'keep');
  const legacyProjectDir = path.join(storageRoot, 'projects', '0003_20260907_legacy');
  fs.mkdirSync(legacyProjectDir, { recursive: true });
  fs.writeFileSync(path.join(legacyProjectDir, 'legacy.txt'), 'legacy');
  return { db, storageRoot, projectDir, neighboringProjectDir, legacyProjectDir };
}

function count(db, table, where = '', ...params) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).total;
}

test('preview is non-mutating and permanent deletion removes only target project ownership', (t) => {
  const { db, storageRoot, projectDir, neighboringProjectDir, legacyProjectDir } = setup();
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
  assert.equal(preview.counts.async_tasks, 3);
  assert.equal(preview.counts.director_anchors, 2);
  assert.equal(preview.counts.director_artifacts, 2);
  assert.equal(preview.storage.directory, projectDir);
  assert.equal(preview.storage.file_count, 2);
  assert.equal(preview.storage.bytes, 9);
  assert.equal(count(db, 'dramas'), 3);
  assert.equal(count(db, 'external_generation_jobs'), 2);
  assert.equal(fs.existsSync(projectDir), true);
  assert.equal(fs.existsSync(neighboringProjectDir), true);

  const result = deleteProjectPermanently(db, cfg, { error() {} }, 1);
  assert.equal(result.deleted, true);
  assert.equal(result.counts.dramas, 1);
  assert.equal(result.counts.episodes, 1);
  assert.equal(result.counts.external_generation_jobs, 1);
  assert.equal(result.counts.async_tasks, 3);
  assert.equal(result.counts.director_anchors, 2);
  assert.equal(result.counts.director_artifacts, 2);
  assert.equal(result.storage.cleanup_status, 'deleted');
  assert.equal(fs.existsSync(projectDir), false);
  assert.equal(fs.existsSync(neighboringProjectDir), true);
  for (const table of [
    'episodes', 'storyboards', 'characters', 'scenes', 'props', 'frame_prompts',
    'character_variants', 'image_generations', 'video_generations', 'video_merges',
    'external_generation_jobs', 'external_generation_attempts', 'external_generation_results',
    'external_generation_events', 'external_generation_sessions', 'external_ai_package_tasks',
  ]) assert.equal(count(db, table), 1, `${table} should retain only the other project`);
  assert.equal(count(db, 'dramas'), 2);
  assert.equal(count(db, 'dramas', 'id = ?', 3), 1);
  assert.equal(fs.existsSync(legacyProjectDir), true);
  assert.deepEqual(db.prepare('SELECT name FROM character_libraries ORDER BY name').all(), [{ name: '保留库角色' }, { name: '公共角色' }]);
  assert.deepEqual(db.prepare('SELECT location FROM scene_libraries ORDER BY location').all(), [{ location: '保留库场景' }, { location: '公共场景' }]);
  assert.deepEqual(db.prepare('SELECT name FROM prop_libraries ORDER BY name').all(), [{ name: '保留库道具' }, { name: '公共道具' }]);
  assert.equal(count(db, 'assets'), 2);
  assert.deepEqual(db.prepare('SELECT id FROM async_tasks ORDER BY id').all(), [
    { id: 'async-resource-collision' }, { id: 'image-task-keep' }, { id: 'merge-task-keep' }, { id: 'video-task-keep' },
  ]);
  assert.equal(count(db, 'director_anchors'), 1);
  assert.equal(count(db, 'director_artifacts'), 1);
  assert.equal(count(db, 'director_candidates'), 1);
  assert.equal(count(db, 'director_candidate_groups'), 1);
  assert.equal(count(db, 'director_jobs'), 1);
  assert.equal(count(db, 'external_generation_idempotency'), 1);
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
  db.prepare("UPDATE video_upscale_jobs SET async_task_id = 'upscale-task-target' WHERE id = 'upscale-target'").run();
  db.prepare("INSERT INTO async_tasks (id, type, status, resource_id, created_at, updated_at) VALUES ('upscale-task-target', 'upscale', 'completed', '18', ?, ?), ('upscale-task-keep', 'upscale', 'completed', '28', ?, ?)").run(now, now, now, now);
  db.prepare(`INSERT INTO video_upscale_segments (job_id, segment_index, start_frame, requested_frame_count, created_at, updated_at)
    VALUES ('upscale-target', 0, 0, 10, ?, ?), ('upscale-keep', 0, 0, 10, ?, ?)`).run(now, now, now, now);

  deleteProjectPermanently(db, { storage: { local_path: storageRoot } }, { error() {} }, 1);

  assert.equal(count(db, 'episode_imports'), 1);
  assert.equal(count(db, 'video_upscale_jobs'), 1);
  assert.equal(count(db, 'video_upscale_segments'), 1);
  assert.equal(count(db, 'async_tasks', "id = 'upscale-task-target'"), 0);
  assert.equal(count(db, 'async_tasks', "id = 'upscale-task-keep'"), 1);
});

test('soft-deleted projects require explicit includeDeleted opt-in', (t) => {
  const { db, storageRoot, legacyProjectDir } = setup();
  t.after(() => { db.close(); fs.rmSync(storageRoot, { recursive: true, force: true }); });
  const cfg = { storage: { local_path: storageRoot } };

  assert.equal(previewProjectDeletion(db, cfg, 3), null);
  assert.equal(deleteProjectPermanently(db, cfg, { error() {} }, 3), null);
  assert.equal(count(db, 'dramas', 'id = ?', 3), 1);
  assert.equal(fs.existsSync(legacyProjectDir), true);

  const preview = previewProjectDeletion(db, cfg, 3, { includeDeleted: true });
  assert.equal(preview.project.id, 3);
  const result = deleteProjectPermanently(db, cfg, { error() {} }, 3, { includeDeleted: true });
  assert.equal(result.deleted, true);
  assert.equal(count(db, 'dramas', 'id = ?', 3), 0);
  assert.equal(fs.existsSync(legacyProjectDir), false);
});
