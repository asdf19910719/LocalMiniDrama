const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const {
  buildConversationContext,
  createTaskBundle,
  getTaskBundle,
  buildTaskZip,
} = require('../src/services/externalAiTaskBundleService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY, title TEXT, description TEXT, genre TEXT, style TEXT, style_id TEXT,
      metadata TEXT, deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER, title TEXT,
      description TEXT, script_content TEXT, status TEXT, deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, drama_id INTEGER, source_key TEXT, name TEXT, role TEXT,
      description TEXT, personality TEXT, appearance TEXT, polished_prompt TEXT,
      negative_prompt TEXT, voice_style TEXT, sort_order INTEGER, updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_variants (
      id INTEGER PRIMARY KEY, character_id INTEGER, source_key TEXT, name TEXT,
      description TEXT, appearance TEXT, image_prompt TEXT, negative_prompt TEXT,
      is_default INTEGER, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT,
      location TEXT, state TEXT, description TEXT, prompt TEXT, atmosphere TEXT,
      negative_prompt TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT,
      name TEXT, type TEXT, description TEXT, prompt TEXT, negative_prompt TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE external_ai_package_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id TEXT NOT NULL UNIQUE,
      drama_id INTEGER NOT NULL,
      target_episode_id INTEGER,
      target_episode_number INTEGER NOT NULL,
      assets_digest TEXT NOT NULL,
      context_markdown TEXT NOT NULL,
      instructions_markdown TEXT NOT NULL,
      asset_manifest_json TEXT NOT NULL,
      asset_snapshot_json TEXT NOT NULL,
      response_schema_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      imported_at TEXT
    );
  `);
  db.prepare(`INSERT INTO dramas VALUES (1, ?, ?, ?, ?, ?, ?, NULL)`).run(
    '雨夜追凶',
    '记者林晚追查旧案。',
    '悬疑',
    'cinematic',
    'rh-101-cinematic',
    JSON.stringify({
      external_ai_continuity_notes: '林晚还不知道顾川的真实身份。',
      aspect_ratio: '16:9',
      style_prompt_zh: '冷峻写实电影感',
    }),
  );
  db.prepare(`INSERT INTO episodes VALUES (11, 1, 1, '雨夜来客', '陌生人送来线索。', '雨夜里，林晚收到一本残缺账本。', 'done', NULL)`).run();
  db.prepare(`INSERT INTO episodes VALUES (12, 1, 2, '空白第二集', NULL, NULL, 'draft', NULL)`).run();
  db.prepare(`INSERT INTO characters VALUES (21, 1, NULL, '林晚', 'main', ?, ?, ?, ?, ?, ?, 1, '2026-09-01T00:00:00.000Z', NULL)`).run(
    '调查记者，旧案受害者家属。', '冷静克制，观察力强。', '二十七岁，黑色短发。',
    '林晚角色定妆照', '避免改变五官', '偏低、清冷、语速慢',
  );
  db.prepare(`INSERT INTO character_variants VALUES (31, 21, NULL, '默认状态', '日常工作状态', '深灰风衣', '深灰风衣全身定妆', '避免雨水', 1, '2026-09-01T00:00:00.000Z', NULL)`).run();
  db.prepare(`INSERT INTO scenes VALUES (41, 1, 11, NULL, '便利店门口', '雨夜', '霓虹灯下的便利店入口', '雨夜便利店外景', '紧张', '无人群', '2026-09-01T00:00:00.000Z', NULL)`).run();
  db.prepare(`INSERT INTO props VALUES (51, 1, 11, NULL, '残缺账本', '线索', '缺失末页的旧账本', '旧账本棚拍', '无文字错误', '2026-09-01T00:00:00.000Z', NULL)`).run();
  return db;
}

describe('externalAiTaskBundleService', () => {
  it('builds new-session context from project facts and the latest prior episode', () => {
    const db = createDb();
    const result = buildConversationContext(db, 1, { targetEpisodeId: 12 });

    assert.equal(result.filename, '雨夜追凶_第2集_新会话剧情上下文.md');
    assert.match(result.markdown, /林晚还不知道顾川的真实身份/);
    assert.match(result.markdown, /第1集《雨夜来客》：陌生人送来线索/);
    assert.match(result.markdown, /雨夜里，林晚收到一本残缺账本/);
    assert.match(result.markdown, /冷静克制，观察力强/);
    assert.match(result.markdown, /二十七岁，黑色短发/);
    assert.match(result.markdown, /便利店门口/);
    assert.doesNotMatch(result.markdown, /空白第二集.*雨夜里/s);
  });

  it('creates a persisted task with stable keys, deterministic assets and no database ids in the public manifest', () => {
    const db = createDb();
    const first = createTaskBundle(db, 1, { targetEpisodeId: 12 });

    assert.match(first.package_id, /^extai_/);
    assert.equal(first.target_episode_number, 2);
    assert.match(first.assets_digest, /^[a-f0-9]{64}$/);
    assert.equal(first.asset_manifest.characters[0].source_key, 'char_21');
    assert.equal(first.asset_manifest.characters[0].variants[0].source_key, 'variant_31');
    assert.equal(first.asset_manifest.scenes[0].source_key, 'scene_41');
    assert.equal(first.asset_manifest.props[0].source_key, 'prop_51');
    assert.equal(first.asset_manifest.version, '2');
    assert.equal(first.asset_manifest.project.style.style_id, 'rh-101-cinematic');
    assert.equal(first.asset_manifest.project.style.readonly, true);
    assert.equal('style_prompt_zh' in first.asset_manifest.project, false);
    assert.equal(first.response_schema.properties.prompt_contract.const, 'base_prompt');
    assert.ok(first.response_schema.properties.assets_digest, '打包 Schema 必须声明 assets_digest（否则与说明的“原样复制”要求自相矛盾）');
    assert.match(first.instructions_markdown, /禁止返回 style\/style_id/);
    assert.match(first.instructions_markdown, /assets_digest[\s\S]*?原样复制/, '任务说明必须要求外部 AI 原样复制 assets_digest（防导入摘要失配）');
    assert.equal('id' in first.asset_manifest.characters[0], false);
    assert.equal('character_id' in first.asset_manifest.characters[0].variants[0], false);
    assert.equal(first.asset_snapshot.characters.char_21.id, 21);
    assert.equal(first.asset_snapshot.variants.variant_31.id, 31);
    assert.equal(getTaskBundle(db, first.package_id).package_id, first.package_id);

    const second = createTaskBundle(db, 1, { targetEpisodeId: 12 });
    assert.equal(second.assets_digest, first.assets_digest);
    assert.notEqual(second.package_id, first.package_id);
    assert.equal(db.prepare('SELECT source_key FROM characters WHERE id = 21').get().source_key, 'char_21');
  });

  it('packages exactly the four user-facing UTF-8 task files (含导入校验回执)', () => {
    const db = createDb();
    const task = createTaskBundle(db, 1, { targetEpisodeId: 12 });
    const zip = new AdmZip(buildTaskZip(task));
    const names = zip.getEntries().map((entry) => entry.entryName).sort();

    assert.deepEqual(names, ['任务回执.json', '任务说明.md', '当前项目资产.json', '返回格式.schema.json'].sort());
    assert.match(zip.readAsText('任务说明.md'), new RegExp(task.package_id));
    assert.match(zip.readAsText('任务说明.md'), new RegExp(task.assets_digest.slice(0, 16)), '任务说明顶部必须可见 assets_digest 回执值');
    assert.deepEqual(JSON.parse(zip.readAsText('当前项目资产.json')), task.asset_manifest);
    assert.equal(JSON.parse(zip.readAsText('返回格式.schema.json')).properties.package_id.type, 'string');
    const receipt = JSON.parse(zip.readAsText('任务回执.json'));
    assert.equal(receipt.package_id, task.package_id);
    assert.equal(receipt.assets_digest, task.assets_digest);
  });

  it('rejects a target episode that belongs to another project', () => {
    const db = createDb();
    db.prepare(`INSERT INTO episodes VALUES (99, 2, 1, '别的项目', NULL, NULL, 'draft', NULL)`).run();
    assert.throws(
      () => createTaskBundle(db, 1, { targetEpisodeId: 99 }),
      (error) => error.code === 'TARGET_EPISODE_INVALID',
    );
  });
});
