'use strict';

const { normalizePackageForProjection } = require('./episodePackageProjection');
const { renderAction, renderDialogue } = require('./episodePackageValidator');

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseObject(value) {
  if (!hasText(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function legacyScenePrompt(scene) {
  const description = hasText(scene?.description) ? scene.description : '';
  if (!description) return scene?.image_prompt ?? null;
  const separator = /[。.!?！？~]$/.test(description) ? '' : '。';
  return `${description}${separator}${scene?.image_prompt ?? ''}`;
}

function normalizeForAudit(pkg) {
  const { normalizedPackage, report } = normalizePackageForProjection(pkg);
  for (const storyboard of normalizedPackage.storyboards || []) {
    storyboard.action = renderAction(storyboard.action);
    storyboard.dialogue = renderDialogue(storyboard.dialogue);
  }
  return { normalizedPackage, report };
}

function updateBlankFields(db, table, id, values) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return 0;
  const patch = Object.entries(values).filter(([field, value]) => value != null && isBlank(row[field]));
  if (patch.length === 0) return 0;
  const hasUpdatedAt = Object.hasOwn(row, 'updated_at');
  const assignments = patch.map(([field]) => `${field} = ?`);
  const args = patch.map(([, value]) => value);
  if (hasUpdatedAt) {
    assignments.push('updated_at = ?');
    args.push(new Date().toISOString());
  }
  args.push(id);
  db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ?`).run(...args);
  return patch.length;
}

function decisionIsCreate(decisions, group, sourceKey) {
  return decisions?.[group]?.[sourceKey] === 'create';
}

function applyOneImport(db, row, pkg, decisions) {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(row.episode_id);
  if (!episode) return { updatedFields: 0, skipped: true, reason: 'episode_not_found' };
  const { normalizedPackage, report } = normalizeForAudit(pkg);
  let updatedFields = 0;

  for (const character of normalizedPackage.characters || []) {
    if (!decisionIsCreate(decisions, 'characters', character.source_key)) continue;
    const target = db.prepare(`
      SELECT c.id FROM characters c
      JOIN episode_characters ec ON ec.character_id = c.id
      WHERE ec.episode_id = ? AND c.drama_id = ? AND c.source_key = ?
      ORDER BY c.id LIMIT 1
    `).get(row.episode_id, episode.drama_id, character.source_key);
    if (!target) continue;
    updatedFields += updateBlankFields(db, 'characters', target.id, {
      role: character.role,
      personality: character.personality,
      appearance: character.appearance,
      polished_prompt: character.image_prompt,
      negative_prompt: character.negative_prompt,
    });
  }

  for (const scene of normalizedPackage.scenes || []) {
    if (!decisionIsCreate(decisions, 'scenes', scene.source_key)) continue;
    const target = db.prepare(`
      SELECT * FROM scenes WHERE episode_id = ? AND drama_id = ? AND source_key = ? ORDER BY id LIMIT 1
    `).get(row.episode_id, episode.drama_id, scene.source_key);
    if (!target) continue;
    const values = { description: scene.description, state: scene.state, atmosphere: scene.atmosphere };
    if (target.prompt === legacyScenePrompt(scene)) values.prompt = scene.image_prompt;
    updatedFields += updateBlankFields(db, 'scenes', target.id, values);
    if (values.prompt != null && target.prompt === legacyScenePrompt(scene) && target.prompt !== values.prompt) {
      db.prepare('UPDATE scenes SET prompt = ?, updated_at = ? WHERE id = ?').run(values.prompt, new Date().toISOString(), target.id);
      updatedFields += 1;
    }
  }

  for (const prop of normalizedPackage.props || []) {
    if (!decisionIsCreate(decisions, 'props', prop.source_key)) continue;
    const target = db.prepare(`
      SELECT id FROM props WHERE episode_id = ? AND drama_id = ? AND source_key = ? ORDER BY id LIMIT 1
    `).get(row.episode_id, episode.drama_id, prop.source_key);
    if (target) updatedFields += updateBlankFields(db, 'props', target.id, { type: prop.type });
  }

  const profile = parseObject(episode.production_profile);
  if (isBlank(profile.source_key) && hasText(normalizedPackage.episode?.source_key)) {
    profile.source_key = normalizedPackage.episode.source_key;
    db.prepare('UPDATE episodes SET production_profile = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(profile), new Date().toISOString(), episode.id);
    updatedFields += 1;
  }

  for (const storyboard of normalizedPackage.storyboards || []) {
    if (!hasText(storyboard.notes)) continue;
    const target = db.prepare('SELECT * FROM storyboards WHERE episode_id = ? AND source_key = ? ORDER BY id LIMIT 1')
      .get(row.episode_id, storyboard.source_key);
    if (!target) continue;
    const metadata = parseObject(target.production_metadata);
    if (!isBlank(metadata.import_notes)) continue;
    metadata.import_notes = storyboard.notes;
    db.prepare('UPDATE storyboards SET production_metadata = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(metadata), new Date().toISOString(), target.id);
    updatedFields += 1;
  }

  report.projection = { status: 'verified', verified_at: new Date().toISOString() };
  report.backfill = { status: 'applied', updated_fields: updatedFields };
  db.prepare('UPDATE episode_imports SET normalized_json = ?, import_report = ? WHERE id = ?')
    .run(JSON.stringify(normalizedPackage), JSON.stringify(report), row.id);
  return { updatedFields, skipped: false };
}

function backfillEpisodePackageImports(db) {
  const result = { processed: 0, updated_fields: 0, skipped: 0, errors: [] };
  let rows;
  try {
    rows = db.prepare(`
      SELECT * FROM episode_imports
      WHERE import_report IS NULL OR TRIM(import_report) = ''
      ORDER BY imported_at, id
    `).all();
  } catch (_error) {
    return result;
  }

  for (const row of rows) {
    let pkg;
    try {
      pkg = JSON.parse(String(row.raw_json));
    } catch (_error) {
      const report = { version: 1, backfill: { status: 'skipped_invalid_json' } };
      db.prepare('UPDATE episode_imports SET import_report = ? WHERE id = ?').run(JSON.stringify(report), row.id);
      result.skipped += 1;
      result.errors.push({ import_id: row.id, code: 'INVALID_RAW_JSON' });
      continue;
    }
    const decisions = parseObject(row.match_decisions);
    try {
      const outcome = db.transaction(() => applyOneImport(db, row, pkg, decisions))();
      if (outcome.skipped) result.skipped += 1;
      else result.processed += 1;
      result.updated_fields += outcome.updatedFields;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({ import_id: row.id, code: 'BACKFILL_FAILED', message: error.message });
    }
  }
  return result;
}

module.exports = { backfillEpisodePackageImports };
