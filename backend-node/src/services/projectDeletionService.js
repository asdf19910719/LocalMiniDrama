const fs = require('node:fs');
const path = require('node:path');
const storageLayout = require('./storageLayout');

const COUNT_KEYS = [
  'dramas', 'episodes', 'storyboards', 'storyboard_characters', 'storyboard_props',
  'storyboard_character_variants', 'storyboard_h3_prompt_drafts', 'frame_prompts',
  'characters', 'character_variants', 'scenes', 'props', 'episode_characters',
  'episode_imports',
  'character_libraries', 'scene_libraries', 'prop_libraries', 'assets',
  'image_generations', 'video_generations', 'video_merges', 'video_upscale_segments',
  'video_upscale_jobs', 'async_tasks', 'image_generation_batches', 'image_generation_tasks',
  'external_generation_events', 'external_generation_results', 'external_generation_attempts',
  'external_generation_jobs', 'external_generation_sessions', 'external_ai_package_tasks',
  'director_anchors', 'director_artifacts', 'director_candidates', 'director_candidate_groups', 'director_jobs',
];

function ids(rows) {
  return rows.map((row) => row.id).filter((id) => id != null);
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db, table, column) {
  return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function selectIds(db, table, where, params) {
  if (!tableExists(db, table)) return [];
  return ids(db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...params));
}

function appendInClause(clauses, params, column, values) {
  if (!values.length) return;
  clauses.push(`${column} IN (${placeholders(values)})`);
  params.push(...values);
}

function deleteWhere(db, counts, table, where, params = []) {
  if (!tableExists(db, table)) return;
  const result = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params);
  counts[table] = (counts[table] || 0) + result.changes;
}

function emptyCounts() {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
}

function discoverProjectOwnedIds(db, dramaId) {
  const episodeIds = selectIds(db, 'episodes', 'drama_id = ?', [dramaId]);
  const storyboardIds = episodeIds.length ? selectIds(db, 'storyboards', `episode_id IN (${placeholders(episodeIds)})`, episodeIds) : [];
  const characterIds = selectIds(db, 'characters', 'drama_id = ?', [dramaId]);
  const sceneIds = selectIds(db, 'scenes', 'drama_id = ?', [dramaId]);
  const propIds = selectIds(db, 'props', 'drama_id = ?', [dramaId]);
  const variantIds = characterIds.length ? selectIds(db, 'character_variants', `character_id IN (${placeholders(characterIds)})`, characterIds) : [];
  const externalJobIds = selectIds(db, 'external_generation_jobs', 'drama_id = ?', [dramaId]);
  const externalAttemptIds = externalJobIds.length ? selectIds(db, 'external_generation_attempts', `job_id IN (${placeholders(externalJobIds)})`, externalJobIds) : [];
  const externalResultIds = externalAttemptIds.length ? selectIds(db, 'external_generation_results', `attempt_id IN (${placeholders(externalAttemptIds)})`, externalAttemptIds) : [];
  const videoMergeIds = tableExists(db, 'video_merges')
    ? ids(db.prepare(`SELECT id FROM video_merges WHERE drama_id = ?${episodeIds.length ? ` OR episode_id IN (${placeholders(episodeIds)})` : ''}`).all(dramaId, ...episodeIds))
    : [];
  const upscaleJobIds = tableExists(db, 'video_upscale_jobs')
    ? ids(db.prepare(`SELECT id FROM video_upscale_jobs WHERE ${episodeIds.length ? `episode_id IN (${placeholders(episodeIds)})` : '0'}${videoMergeIds.length ? `${episodeIds.length ? ' OR ' : ''}video_merge_id IN (${placeholders(videoMergeIds)})` : ''}`).all(...episodeIds, ...videoMergeIds))
    : [];
  const generationIdsFor = (table) => {
    if (!tableExists(db, table)) return [];
    const clauses = []; const params = [];
    if (columnExists(db, table, 'drama_id')) { clauses.push('drama_id = ?'); params.push(dramaId); }
    if (columnExists(db, table, 'storyboard_id')) appendInClause(clauses, params, 'storyboard_id', storyboardIds);
    if (columnExists(db, table, 'character_id')) appendInClause(clauses, params, 'character_id', characterIds);
    if (columnExists(db, table, 'scene_id')) appendInClause(clauses, params, 'scene_id', sceneIds);
    return clauses.length ? selectIds(db, table, clauses.join(' OR '), params) : [];
  };
  const directorGroupIds = storyboardIds.length
    ? selectIds(db, 'director_candidate_groups', `shot_id IN (${placeholders(storyboardIds)})`, storyboardIds.map(String))
    : [];
  const directorCandidateRows = directorGroupIds.length && tableExists(db, 'director_candidates')
    ? db.prepare(`SELECT id, job_id, artifact_id FROM director_candidates WHERE group_id IN (${placeholders(directorGroupIds)})`).all(...directorGroupIds)
    : [];
  const directorCandidateIds = ids(directorCandidateRows);
  const directorJobIds = [...new Set(directorCandidateRows.map((row) => row.job_id).filter(Boolean))];
  const directorArtifactIds = [...new Set(directorCandidateRows.map((row) => row.artifact_id).filter(Boolean))];
  if (directorJobIds.length && tableExists(db, 'director_artifacts')) {
    directorArtifactIds.push(...selectIds(db, 'director_artifacts', `job_id IN (${placeholders(directorJobIds)})`, directorJobIds));
  }
  return {
    episodeIds, storyboardIds, characterIds, sceneIds, propIds, variantIds,
    externalJobIds, externalAttemptIds, externalResultIds, videoMergeIds,
    upscaleJobIds,
    imageGenerationIds: generationIdsFor('image_generations'),
    videoGenerationIds: generationIdsFor('video_generations'),
    directorGroupIds, directorCandidateIds, directorJobIds,
    directorArtifactIds: [...new Set(directorArtifactIds)],
  };
}

function projectStorageSummary(cfg, project) {
  const storageRoot = path.resolve(cfg?.storage?.local_path || './data/storage');
  const projectsRoot = path.resolve(storageRoot, storageLayout.PROJECTS);
  const relativePath = storageLayout.buildProjectRelativeDir(project);
  const directory = path.resolve(storageRoot, relativePath);
  const relativeToProjects = path.relative(projectsRoot, directory);
  const safe = Boolean(relativeToProjects)
    && !relativeToProjects.startsWith('..')
    && !path.isAbsolute(relativeToProjects)
    && path.dirname(directory) === projectsRoot;
  const summary = {
    directory,
    relative_path: relativePath.replace(/\\/g, '/'),
    exists: safe && fs.existsSync(directory),
    file_count: 0,
    bytes: 0,
    cleanup_status: safe ? 'pending' : 'unsafe',
  };
  if (!summary.exists) {
    summary.cleanup_status = safe ? 'missing' : 'unsafe';
    return summary;
  }
  const scan = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) scan(target);
      else {
        const stat = fs.lstatSync(target);
        summary.file_count += 1;
        summary.bytes += stat.size;
      }
    }
  };
  scan(directory);
  return summary;
}

function previewProjectDeletion(db, cfg, dramaId) {
  const id = Number(dramaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const project = db.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
  if (!project) return null;
  const owned = discoverProjectOwnedIds(db, id);
  const counts = emptyCounts();
  counts.dramas = 1;
  counts.episodes = owned.episodeIds.length;
  counts.storyboards = owned.storyboardIds.length;
  counts.characters = owned.characterIds.length;
  counts.scenes = owned.sceneIds.length;
  counts.props = owned.propIds.length;
  counts.character_variants = owned.variantIds.length;
  counts.external_generation_jobs = owned.externalJobIds.length;
  counts.external_generation_attempts = owned.externalAttemptIds.length;
  counts.external_generation_results = owned.externalResultIds.length;
  if (owned.externalAttemptIds.length && tableExists(db, 'external_generation_events')) {
    counts.external_generation_events = db.prepare(`SELECT COUNT(*) AS total FROM external_generation_events WHERE attempt_id IN (${placeholders(owned.externalAttemptIds)})`).get(...owned.externalAttemptIds).total;
  }
  counts.video_merges = owned.videoMergeIds.length;
  counts.video_upscale_jobs = owned.upscaleJobIds.length;
  if (owned.upscaleJobIds.length && tableExists(db, 'video_upscale_segments')) {
    counts.video_upscale_segments = db.prepare(`SELECT COUNT(*) AS total FROM video_upscale_segments WHERE job_id IN (${placeholders(owned.upscaleJobIds)})`).get(...owned.upscaleJobIds).total;
  }
  counts.director_candidate_groups = owned.directorGroupIds.length;
  counts.director_candidates = owned.directorCandidateIds.length;
  counts.director_jobs = owned.directorJobIds.length;
  counts.director_artifacts = owned.directorArtifactIds.length;
  for (const table of ['character_libraries', 'scene_libraries', 'prop_libraries', 'assets', 'image_generation_batches', 'image_generation_tasks', 'external_generation_sessions', 'external_ai_package_tasks']) {
    if (tableExists(db, table) && columnExists(db, table, 'drama_id')) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE drama_id = ?`).get(id).total;
    }
  }
  for (const [table, idColumn, values] of [
    ['storyboard_characters', 'storyboard_id', owned.storyboardIds], ['storyboard_props', 'storyboard_id', owned.storyboardIds],
    ['storyboard_character_variants', 'storyboard_id', owned.storyboardIds], ['storyboard_h3_prompt_drafts', 'storyboard_id', owned.storyboardIds],
    ['frame_prompts', 'storyboard_id', owned.storyboardIds], ['episode_characters', 'episode_id', owned.episodeIds],
    ['episode_imports', 'episode_id', owned.episodeIds],
  ]) {
    if (values.length && tableExists(db, table) && columnExists(db, table, idColumn)) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${idColumn} IN (${placeholders(values)})`).get(...values).total;
    }
  }
  for (const table of ['image_generations', 'video_generations']) {
    if (!tableExists(db, table)) continue;
    counts[table] = table === 'image_generations' ? owned.imageGenerationIds.length : owned.videoGenerationIds.length;
  }
  const asyncResourceIds = [
    ...owned.externalJobIds, ...owned.externalAttemptIds, ...owned.externalResultIds,
    ...owned.imageGenerationIds, ...owned.videoGenerationIds,
  ].map(String);
  if (asyncResourceIds.length && tableExists(db, 'async_tasks')) {
    counts.async_tasks = db.prepare(`SELECT COUNT(*) AS total FROM async_tasks WHERE resource_id IN (${placeholders(asyncResourceIds)})`).get(...asyncResourceIds).total;
  }
  return { project, counts, storage: projectStorageSummary(cfg, project) };
}

function deleteProjectRows(db, dramaId, owned, counts) {
  const removeByIds = (table, column, values) => {
    if (values.length) deleteWhere(db, counts, table, `${column} IN (${placeholders(values)})`, values);
  };
  removeByIds('external_generation_events', 'attempt_id', owned.externalAttemptIds);
  removeByIds('external_generation_results', 'attempt_id', owned.externalAttemptIds);
  removeByIds('external_generation_attempts', 'job_id', owned.externalJobIds);
  deleteWhere(db, counts, 'external_generation_sessions', 'drama_id = ?', [dramaId]);
  removeByIds('video_upscale_segments', 'job_id', owned.upscaleJobIds);
  removeByIds('video_upscale_jobs', 'id', owned.upscaleJobIds);
  removeByIds('director_anchors', 'source_artifact_id', owned.directorArtifactIds);
  removeByIds('director_artifacts', 'job_id', owned.directorJobIds);
  removeByIds('director_candidates', 'group_id', owned.directorGroupIds);
  removeByIds('director_candidate_groups', 'id', owned.directorGroupIds);
  removeByIds('director_jobs', 'id', owned.directorJobIds);
  removeByIds('storyboard_character_variants', 'storyboard_id', owned.storyboardIds);
  removeByIds('storyboard_characters', 'storyboard_id', owned.storyboardIds);
  removeByIds('storyboard_props', 'storyboard_id', owned.storyboardIds);
  removeByIds('storyboard_h3_prompt_drafts', 'storyboard_id', owned.storyboardIds);
  removeByIds('frame_prompts', 'storyboard_id', owned.storyboardIds);
  removeByIds('episode_characters', 'episode_id', owned.episodeIds);
  removeByIds('episode_imports', 'episode_id', owned.episodeIds);
  removeByIds('character_variants', 'character_id', owned.characterIds);
  for (const table of ['image_generations', 'video_generations']) {
    if (!tableExists(db, table)) continue;
    removeByIds(table, 'id', table === 'image_generations' ? owned.imageGenerationIds : owned.videoGenerationIds);
  }
  removeByIds('video_merges', 'id', owned.videoMergeIds);
  deleteWhere(db, counts, 'image_generation_tasks', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'image_generation_batches', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'external_ai_package_tasks', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'external_generation_jobs', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'assets', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'character_libraries', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'scene_libraries', 'drama_id = ?', [dramaId]);
  deleteWhere(db, counts, 'prop_libraries', 'drama_id = ?', [dramaId]);
  removeByIds('storyboards', 'id', owned.storyboardIds);
  removeByIds('episodes', 'id', owned.episodeIds);
  removeByIds('characters', 'id', owned.characterIds);
  removeByIds('scenes', 'id', owned.sceneIds);
  removeByIds('props', 'id', owned.propIds);
  const asyncResourceIds = [
    ...owned.externalJobIds, ...owned.externalAttemptIds, ...owned.externalResultIds,
    ...owned.imageGenerationIds, ...owned.videoGenerationIds,
  ];
  if (tableExists(db, 'async_tasks')) {
    if (asyncResourceIds.length) deleteWhere(db, counts, 'async_tasks', `resource_id IN (${placeholders(asyncResourceIds)})`, asyncResourceIds.map(String));
  }
  deleteWhere(db, counts, 'dramas', 'id = ?', [dramaId]);
}

function cleanupProjectDirectory(storage) {
  if (storage.cleanup_status === 'unsafe') return { ...storage };
  if (!storage.exists) return { ...storage, cleanup_status: 'missing' };
  const projectsRoot = path.dirname(storage.directory);
  try {
    const realRoot = fs.realpathSync(projectsRoot);
    const realDirectory = fs.realpathSync(storage.directory);
    const relative = path.relative(realRoot, realDirectory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(realDirectory) !== realRoot) {
      return { ...storage, cleanup_status: 'unsafe' };
    }
    fs.rmSync(storage.directory, { recursive: true, force: false });
    return { ...storage, exists: false, cleanup_status: 'deleted' };
  } catch (error) {
    return { ...storage, cleanup_status: 'failed', error: error.message };
  }
}

function deleteProjectPermanently(db, cfg, log, dramaId) {
  const preview = previewProjectDeletion(db, cfg, dramaId);
  if (!preview) return null;
  const owned = discoverProjectOwnedIds(db, Number(dramaId));
  const counts = emptyCounts();
  db.transaction(() => deleteProjectRows(db, Number(dramaId), owned, counts))();
  const storage = cleanupProjectDirectory(preview.storage);
  if (storage.cleanup_status === 'failed' || storage.cleanup_status === 'unsafe') {
    log?.error?.('Project database deletion completed but storage cleanup did not', { drama_id: Number(dramaId), storage });
  }
  return { deleted: true, counts, storage };
}

module.exports = { previewProjectDeletion, deleteProjectPermanently };
