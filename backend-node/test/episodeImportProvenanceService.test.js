const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  getEpisodeImportSummary,
  getEpisodeImportSummaries,
  getEpisodeImportSource,
  sanitizeSourceFilename,
} = require('../src/services/episodeImportProvenanceService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE episode_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    schema_name TEXT,
    schema_version TEXT,
    source_filename TEXT,
    source_sha256 TEXT,
    raw_json TEXT,
    normalized_json TEXT,
    match_decisions TEXT,
    generator_metadata TEXT,
    import_report TEXT,
    imported_at TEXT
  )`);
  return db;
}

function insertImport(db, values = {}) {
  db.prepare(`INSERT INTO episode_imports (
    episode_id, schema_name, schema_version, source_filename, source_sha256,
    raw_json, normalized_json, match_decisions, generator_metadata, import_report, imported_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    values.episode_id ?? 7,
    values.schema_name ?? 'local-mini-drama.episode-package',
    values.schema_version ?? '1.0',
    values.source_filename ?? 'source.json',
    values.source_sha256 ?? 'abc123',
    values.raw_json ?? '{"raw":true}',
    values.normalized_json ?? '{"normalized":true}',
    values.match_decisions ?? '{"characters":{}}',
    Object.hasOwn(values, 'generator_metadata') ? values.generator_metadata : '{"name":"AI"}',
    values.import_report ?? '{"version":1}',
    values.imported_at ?? '2026-09-04T00:00:00.000Z',
  );
}

describe('episode import provenance service', () => {
  it('返回最新导入摘要且不携带大文本', () => {
    const db = createDb();
    insertImport(db, { source_filename: 'old.json', imported_at: '2026-09-03T00:00:00.000Z' });
    insertImport(db, { source_filename: 'new.json', imported_at: '2026-09-04T00:00:00.000Z' });
    insertImport(db, { episode_id: 8, source_filename: 'eight.json' });

    assert.deepEqual(getEpisodeImportSummary(db, 7), {
      source_filename: 'new.json',
      schema_name: 'local-mini-drama.episode-package',
      schema_version: '1.0',
      source_sha256: 'abc123',
      imported_at: '2026-09-04T00:00:00.000Z',
    });
    const summaries = getEpisodeImportSummaries(db, [7, 8, 999]);
    assert.equal(summaries.get(7).source_filename, 'new.json');
    assert.equal(summaries.get(8).source_filename, 'eight.json');
    assert.equal(summaries.has(999), false);
    assert.equal(Object.hasOwn(summaries.get(7), 'raw_json_text'), false);
  });

  it('完整来源逐字返回原文并解析辅助 JSON', () => {
    const db = createDb();
    const raw = '{\n  "title": "原始格式"\n}\n';
    insertImport(db, { raw_json: raw });
    const source = getEpisodeImportSource(db, 7);
    assert.equal(source.raw_json_text, raw);
    assert.equal(source.normalized_json_text, '{"normalized":true}');
    assert.deepEqual(source.match_decisions, { characters: {} });
    assert.deepEqual(source.generator_metadata, { name: 'AI' });
    assert.deepEqual(source.import_report, { version: 1 });
    assert.deepEqual(source.parse_warnings, []);
  });

  it('辅助 JSON 损坏时保留来源并返回可定位警告', () => {
    const db = createDb();
    insertImport(db, { match_decisions: '{bad', generator_metadata: null, import_report: '[bad' });
    const source = getEpisodeImportSource(db, 7);
    assert.equal(source.raw_json_text, '{"raw":true}');
    assert.equal(source.match_decisions, null);
    assert.equal(source.generator_metadata, null);
    assert.equal(source.import_report, null);
    assert.deepEqual(source.parse_warnings.map((item) => item.field), ['match_decisions', 'import_report']);
  });

  it('文件名只保留安全 basename，从不解释为本地路径', () => {
    assert.equal(sanitizeSourceFilename('..\\folder/control.json'), 'control.json');
    assert.equal(sanitizeSourceFilename('../folder/source.json'), 'source.json');
    assert.equal(sanitizeSourceFilename('bad\u0000name.json'), 'badname.json');
    assert.equal(sanitizeSourceFilename(''), 'episode-package.json');
  });
});
