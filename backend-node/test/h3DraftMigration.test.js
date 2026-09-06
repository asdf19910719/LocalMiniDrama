const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

const H3_DRAFT_COLUMNS = [
  'id',
  'storyboard_id',
  'video_config_id',
  'workflow_id',
  'source_prompt',
  'source_fingerprint',
  'ai_compiled_prompt',
  'final_compiled_prompt',
  'compiled_prompt_hash',
  'prompt_format',
  'skill_version',
  'skill_provenance',
  'reference_snapshot',
  'generation_params',
  'manually_edited',
  'status',
  'validation_errors',
  'coverage_manifest',
  'semantic_review_status',
  'semantic_review_confirmed',
  'created_at',
  'updated_at',
];

describe('h3 prompt draft migration', () => {
  it('creates storyboard_h3_prompt_drafts table with the complete semantic-review schema', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    assert.ok(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get('storyboard_h3_prompt_drafts'),
      'table storyboard_h3_prompt_drafts'
    );
    const cols = db.prepare('PRAGMA table_info(storyboard_h3_prompt_drafts)').all().map((c) => c.name);
    for (const col of H3_DRAFT_COLUMNS) {
      assert.ok(cols.includes(col), `missing column: ${col}`);
    }
    assert.strictEqual(cols.length, H3_DRAFT_COLUMNS.length);
  });

  it('preserves legacy rows and adds the workflow lookup index', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE storyboard_h3_prompt_drafts (
      id INTEGER PRIMARY KEY, storyboard_id INTEGER NOT NULL, video_config_id TEXT,
      source_prompt TEXT, created_at TEXT, updated_at TEXT
    )`);
    db.prepare(`INSERT INTO storyboard_h3_prompt_drafts
      (id, storyboard_id, video_config_id, source_prompt, created_at, updated_at)
      VALUES (1, 3, '7', 'legacy', '2026-01-01', '2026-01-01')`).run();
    runMigrationsAndEnsure(db);
    const row = db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE id = 1').get();
    assert.equal(row.source_prompt, 'legacy');
    assert.equal(row.workflow_id, null);
    const columns = db.prepare('PRAGMA index_info(idx_h3_draft_workflow_lookup)').all().map((item) => item.name);
    assert.deepEqual(columns, ['storyboard_id', 'video_config_id', 'workflow_id', 'updated_at']);
    db.close();
  });

  it('creates idx_h3_draft_lookup index on (storyboard_id, video_config_id, updated_at)', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get('idx_h3_draft_lookup');
    assert.ok(idx, 'index idx_h3_draft_lookup');
    const idxCols = db.prepare('PRAGMA index_info(idx_h3_draft_lookup)').all().map((c) => c.name);
    assert.deepStrictEqual(idxCols, ['storyboard_id', 'video_config_id', 'updated_at']);
  });

  it('is idempotent when run twice and keeps defaults', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);
    db.prepare(
      `INSERT INTO storyboard_h3_prompt_drafts (storyboard_id, source_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(1, 'prompt text', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
    runMigrationsAndEnsure(db);
    const row = db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE storyboard_id = ?').get(1);
    assert.strictEqual(row.source_prompt, 'prompt text');
    assert.strictEqual(row.manually_edited, 0);
    assert.strictEqual(row.status, 'valid');
  });

  it('upgrades the legacy 18-column draft table without losing existing drafts', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE storyboard_h3_prompt_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storyboard_id INTEGER NOT NULL,
        video_config_id TEXT,
        source_prompt TEXT,
        source_fingerprint TEXT,
        ai_compiled_prompt TEXT,
        final_compiled_prompt TEXT,
        compiled_prompt_hash TEXT,
        prompt_format TEXT,
        skill_version TEXT,
        skill_provenance TEXT,
        reference_snapshot TEXT,
        generation_params TEXT,
        manually_edited INTEGER DEFAULT 0,
        status TEXT DEFAULT 'valid',
        validation_errors TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO storyboard_h3_prompt_drafts (
        storyboard_id, video_config_id, source_prompt, created_at, updated_at
      ) VALUES (1, '8', 'legacy prompt', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
    `);

    runMigrationsAndEnsure(db);

    const cols = db.prepare('PRAGMA table_info(storyboard_h3_prompt_drafts)').all().map((c) => c.name);
    const row = db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE storyboard_id = 1').get();
    const workflowIndex = db.prepare("PRAGMA index_info('idx_h3_draft_workflow_lookup')").all().map((c) => c.name);
    assert.ok(cols.includes('workflow_id'), 'legacy table should gain workflow_id');
    assert.strictEqual(row.source_prompt, 'legacy prompt');
    assert.strictEqual(row.workflow_id, null);
    assert.deepStrictEqual(workflowIndex, ['storyboard_id', 'video_config_id', 'workflow_id', 'updated_at']);
  });
});
