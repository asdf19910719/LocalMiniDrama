'use strict';

function sanitizeSourceFilename(value) {
  const cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '');
  const basename = cleaned.split(/[\\/]/).pop().trim();
  return basename || 'episode-package.json';
}

function summaryColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(episode_imports)').all().map((column) => column.name));
  const optional = ['task_package_id', 'task_created_at', 'task_assets_digest']
    .map((column) => columns.has(column) ? column : `NULL AS ${column}`);
  return [
    'source_filename', 'schema_name', 'schema_version', 'source_sha256', 'imported_at',
    ...optional,
  ].join(', ');
}

function mapSummary(row) {
  if (!row) return null;
  const summary = {
    source_filename: sanitizeSourceFilename(row.source_filename),
    schema_name: row.schema_name || null,
    schema_version: row.schema_version || null,
    source_sha256: row.source_sha256 || null,
    imported_at: row.imported_at || null,
  };
  if (row.task_package_id) {
    summary.task_package_id = row.task_package_id;
    summary.task_created_at = row.task_created_at || null;
    summary.task_assets_digest = row.task_assets_digest || null;
  }
  return summary;
}

function getEpisodeImportSummary(db, episodeId) {
  const row = db.prepare(`
    SELECT ${summaryColumns(db)}
    FROM episode_imports
    WHERE episode_id = ?
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get(episodeId);
  return mapSummary(row);
}

function getEpisodeImportSummaries(db, episodeIds) {
  const ids = [...new Set((episodeIds || [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0))];
  const result = new Map();
  if (ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT episode_id, ${summaryColumns(db)}
    FROM episode_imports
    WHERE episode_id IN (${placeholders})
    ORDER BY episode_id ASC, imported_at DESC, id DESC
  `).all(...ids);
  for (const row of rows) {
    if (!result.has(row.episode_id)) result.set(row.episode_id, mapSummary(row));
  }
  return result;
}

function parseJsonField(value, field, warnings) {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    warnings.push({
      code: 'IMPORT_SOURCE_AUDIT_PARSE_WARNING',
      field,
      message: `${field} 无法解析，已保留原始导入来源`,
    });
    return null;
  }
}

function getEpisodeImportSource(db, episodeId) {
  const row = db.prepare(`
    SELECT *
    FROM episode_imports
    WHERE episode_id = ?
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
  `).get(episodeId);
  if (!row) return null;

  const parseWarnings = [];
  return {
    id: row.id,
    episode_id: row.episode_id,
    schema_name: row.schema_name || null,
    schema_version: row.schema_version || null,
    source_filename: sanitizeSourceFilename(row.source_filename),
    source_sha256: row.source_sha256 || null,
    imported_at: row.imported_at || null,
    task_package_id: row.task_package_id || null,
    task_created_at: row.task_created_at || null,
    task_assets_digest: row.task_assets_digest || null,
    raw_json_text: row.raw_json == null ? '' : String(row.raw_json),
    normalized_json_text: row.normalized_json == null ? '' : String(row.normalized_json),
    match_decisions: parseJsonField(row.match_decisions, 'match_decisions', parseWarnings),
    generator_metadata: parseJsonField(row.generator_metadata, 'generator_metadata', parseWarnings),
    import_report: parseJsonField(row.import_report, 'import_report', parseWarnings),
    parse_warnings: parseWarnings,
  };
}

module.exports = {
  sanitizeSourceFilename,
  getEpisodeImportSummary,
  getEpisodeImportSummaries,
  getEpisodeImportSource,
};
