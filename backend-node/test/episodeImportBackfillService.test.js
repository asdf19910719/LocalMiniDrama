const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { backfillEpisodePackageImports } = require('../src/services/episodeImportBackfillService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, production_profile TEXT, updated_at TEXT);
    CREATE TABLE episode_imports (
      id INTEGER PRIMARY KEY, episode_id INTEGER, raw_json TEXT, normalized_json TEXT,
      match_decisions TEXT, import_report TEXT, imported_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, drama_id INTEGER, source_key TEXT, role TEXT, personality TEXT,
      appearance TEXT, polished_prompt TEXT, negative_prompt TEXT, updated_at TEXT
    );
    CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT,
      description TEXT, prompt TEXT, state TEXT, atmosphere TEXT, updated_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT,
      type TEXT, updated_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, source_key TEXT,
      production_metadata TEXT, updated_at TEXT
    );
  `);
  return db;
}

function legacyPackage() {
  return {
    schema: 'local-mini-drama.episode-package',
    version: '1.0',
    episode: { source_key: 'ep_1' },
    characters: [{
      source_key: 'char_created', name: '甲', role: 'lead', personality: '沉着', variants: [{
        source_key: 'char_created_default', name: '默认', is_default: true,
        appearance: '黑色短发', image_prompt: '人物提示词', negative_prompt: '低清晰度',
      }],
    }, {
      source_key: 'char_reused', name: '乙', role: 'supporting', personality: '外向', variants: [{
        source_key: 'char_reused_default', name: '默认', is_default: true, appearance: '不应写入',
      }],
    }],
    scenes: [{
      source_key: 'scene_created', name: '大厅', state: 'night', description: '空旷大厅',
      atmosphere: '冷清', image_prompt: '大厅提示词',
    }],
    props: [{ source_key: 'prop_created', name: '钥匙', type: 'handheld' }],
    storyboards: [{ source_key: 'shot_1', notes: '保持雨水连续' }],
  };
}

describe('episode import historical backfill', () => {
  it('只回填明确 create 且为空的历史字段，并保持幂等', () => {
    const db = createDb();
    const pkg = legacyPackage();
    db.prepare('INSERT INTO episodes (id, drama_id, production_profile) VALUES (1, 9, ?)').run('{}');
    db.prepare(`INSERT INTO episode_imports
      (id, episode_id, raw_json, match_decisions, imported_at)
      VALUES (1, 1, ?, ?, '2026-09-01T00:00:00.000Z')`).run(JSON.stringify(pkg), JSON.stringify({
        characters: { char_created: 'create', char_reused: 'reuse' },
        scenes: { scene_created: 'create' },
        props: { prop_created: 'create' },
      }));
    db.prepare(`INSERT INTO characters
      (id, drama_id, source_key, role, personality, appearance, polished_prompt, negative_prompt)
      VALUES (10, 9, 'char_created', NULL, NULL, NULL, NULL, NULL),
             (11, 9, 'char_reused', 'existing', '已有', '已有外貌', NULL, NULL)`).run();
    db.prepare('INSERT INTO episode_characters VALUES (1, 10), (1, 11)').run();
    db.prepare(`INSERT INTO scenes
      (id, drama_id, episode_id, source_key, description, prompt, state, atmosphere)
      VALUES (20, 9, 1, 'scene_created', NULL, '空旷大厅。大厅提示词', 'night', '冷清')`).run();
    db.prepare("INSERT INTO props (id, drama_id, episode_id, source_key, type) VALUES (30, 9, 1, 'prop_created', NULL)").run();
    db.prepare("INSERT INTO storyboards (id, episode_id, source_key, production_metadata) VALUES (40, 1, 'shot_1', '{}')").run();

    const first = backfillEpisodePackageImports(db);
    assert.equal(first.processed, 1);
    assert.ok(first.updated_fields >= 10);
    assert.deepEqual(db.prepare('SELECT role, personality, appearance, polished_prompt, negative_prompt FROM characters WHERE id=10').get(), {
      role: 'lead', personality: '沉着', appearance: '黑色短发', polished_prompt: '人物提示词', negative_prompt: '低清晰度',
    });
    assert.deepEqual(db.prepare('SELECT role, personality, appearance FROM characters WHERE id=11').get(), {
      role: 'existing', personality: '已有', appearance: '已有外貌',
    });
    assert.deepEqual(db.prepare('SELECT description, prompt, state, atmosphere FROM scenes WHERE id=20').get(), {
      description: '空旷大厅', prompt: '大厅提示词', state: 'night', atmosphere: '冷清',
    });
    assert.equal(db.prepare('SELECT type FROM props WHERE id=30').get().type, 'handheld');
    assert.equal(JSON.parse(db.prepare('SELECT production_profile FROM episodes WHERE id=1').get().production_profile).source_key, 'ep_1');
    assert.equal(JSON.parse(db.prepare('SELECT production_metadata FROM storyboards WHERE id=40').get().production_metadata).import_notes, '保持雨水连续');
    const audit = db.prepare('SELECT normalized_json, import_report FROM episode_imports WHERE id=1').get();
    assert.equal(JSON.parse(audit.normalized_json).characters[0].appearance, '黑色短发');
    assert.equal(JSON.parse(audit.import_report).backfill.status, 'applied');

    const second = backfillEpisodePackageImports(db);
    assert.deepEqual(second, { processed: 0, updated_fields: 0, skipped: 0 });
  });

  it('原始 JSON 损坏时记录跳过状态且不阻断启动', () => {
    const db = createDb();
    db.prepare('INSERT INTO episodes (id, drama_id) VALUES (1, 9)').run();
    db.prepare("INSERT INTO episode_imports (id, episode_id, raw_json) VALUES (1, 1, '{bad')").run();
    assert.deepEqual(backfillEpisodePackageImports(db), { processed: 0, updated_fields: 0, skipped: 1 });
    const report = JSON.parse(db.prepare('SELECT import_report FROM episode_imports WHERE id=1').get().import_report);
    assert.equal(report.backfill.status, 'skipped_invalid_json');
  });
});
