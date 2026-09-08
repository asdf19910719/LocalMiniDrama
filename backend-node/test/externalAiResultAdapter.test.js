const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { adaptExternalAiResult } = require('../src/services/externalAiResultAdapter');
const { validateBusinessRules } = require('../src/services/episodePackageValidator');
const { validExternalAiResult: validResult } = require('./fixtures/externalAiResultFixture');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, description TEXT, genre TEXT, style TEXT, style_id TEXT, metadata TEXT, deleted_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, source_key TEXT, name TEXT, role TEXT, description TEXT, personality TEXT, appearance TEXT, polished_prompt TEXT, negative_prompt TEXT, voice_style TEXT, sort_order INTEGER, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE character_variants (id INTEGER PRIMARY KEY, character_id INTEGER, source_key TEXT, name TEXT, description TEXT, appearance TEXT, image_prompt TEXT, negative_prompt TEXT, is_default INTEGER, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT, location TEXT, time TEXT, state TEXT, description TEXT, prompt TEXT, atmosphere TEXT, negative_prompt TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, source_key TEXT, name TEXT, type TEXT, description TEXT, prompt TEXT, negative_prompt TEXT, updated_at TEXT, deleted_at TEXT);
  `);
  db.prepare(`INSERT INTO dramas VALUES (1, '雨夜追凶', '记者追查旧案', '悬疑', 'cinematic', 'rh-101-cinematic', '{}', NULL)`).run();
  db.prepare(`INSERT INTO characters VALUES (21, 1, 'char_lin_wan', '林晚', 'main', '调查记者', '冷静克制', '二十七岁，黑色短发', '林晚定妆照', '避免改脸', '清冷女声', 1, '2026-09-01', NULL)`).run();
  db.prepare(`INSERT INTO character_variants VALUES (31, 21, 'variant_lin_wan_default', '默认状态', '日常状态', '深灰风衣', '深灰风衣定妆', '避免改脸', 1, '2026-09-01', NULL)`).run();
  db.prepare(`INSERT INTO scenes VALUES (41, 1, 1, 'scene_store', '便利店', '深夜', '雨夜', '冷白灯便利店', '便利店空镜', '紧张', '人物', '2026-09-01', NULL)`).run();
  db.prepare(`INSERT INTO props VALUES (51, 1, 1, 'prop_ledger', '残缺账本', '线索', '缺少末页', '账本棚拍', '手', '2026-09-01', NULL)`).run();
  return db;
}

function task() {
  return {
    package_id: 'extai_task-1',
    drama_id: 1,
    target_episode_id: 12,
    target_episode_number: 2,
    assets_digest: 'old-digest',
    asset_snapshot: {
      characters: { char_lin_wan: { id: 21, updated_at: '2026-09-01' } },
      variants: { variant_lin_wan_default: { id: 31, character_id: 21, character_source_key: 'char_lin_wan', updated_at: '2026-09-01' } },
      scenes: { scene_store: { id: 41, updated_at: '2026-09-01' } },
      props: { prop_ledger: { id: 51, updated_at: '2026-09-01' } },
    },
  };
}

describe('externalAiResultAdapter', () => {
  it('expands existing references without allowing external data to overwrite assets', () => {
    const db = createDb();
    const adapted = adaptExternalAiResult(db, validResult(), task());

    assert.equal(adapted.package.schema, 'local-mini-drama.episode-package');
    assert.equal(adapted.package.version, '1.1');
    assert.equal(adapted.package.characters[0].personality, '冷静克制');
    assert.equal(adapted.package.characters[0].appearance, '二十七岁，黑色短发');
    assert.equal(adapted.package.storyboards[0].scene_ref, 'scene_store');
    assert.equal(adapted.package.storyboards[0].character_refs[0].variant_ref, 'variant_lin_wan_default');
    assert.equal(adapted.package.storyboards[0].source_key.startsWith('ai_task1_'), true);
  });

  it('converts semantic universal prompt references to canonical image slots', () => {
    const db = createDb();
    const value = validResult();
    value.storyboards[0].universal_segment_text =
      '@场景 scene_store；@人物 char_lin_wan/variant_lin_wan_default 正面；@道具 prop_ledger。';

    const adapted = adaptExternalAiResult(db, value, task());

    assert.equal(
      adapted.package.storyboards[0].universal_segment_text,
      '@图片1；@图片2 正面；@图片3。',
    );
    assert.equal(
      validateBusinessRules(adapted.package).warnings.some((item) => item.code === 'UNIVERSAL_DRAFT_SLOT_GAP'),
      false,
    );
  });

  it('converts display-name references from an external prompt', () => {
    const db = createDb();
    const value = validResult();
    value.storyboards[0].universal_segment_text = '@便利店里，@林晚拿起@残缺账本。';

    const adapted = adaptExternalAiResult(db, value, task());

    assert.equal(adapted.package.storyboards[0].universal_segment_text, '@图片1里，@图片2拿起@图片3。');
  });

  it('maps new local refs and attaches a new variant to an existing character', () => {
    const db = createDb();
    const value = validResult();
    value.new_assets.character_variants.push({
      local_ref: 'new_variant_lin_wan_rain',
      character_ref: 'char_lin_wan',
      name: '雨夜淋湿',
      description: '短暂淋雨后的状态',
      appearance: '风衣肩部被雨水打湿',
      base_image_prompt: '同一林晚，风衣肩部湿透',
      negative_prompt: '改变五官',
      is_default: false,
    });
    value.storyboards[0].character_refs[0].variant_ref = 'new_variant_lin_wan_rain';
    const adapted = adaptExternalAiResult(db, value, task());

    const character = adapted.package.characters.find((item) => item.source_key === 'char_lin_wan');
    const created = character.variants.find((item) => item.name === '雨夜淋湿');
    assert.ok(created.source_key.startsWith('ai_task1_'));
    assert.equal(adapted.package.storyboards[0].character_refs[0].variant_ref, created.source_key);
  });

  it('rejects a reference that was not present in the generated task', () => {
    const db = createDb();
    const value = validResult();
    value.storyboards[0].scene_ref = 'scene_unknown';
    assert.throws(
      () => adaptExternalAiResult(db, value, task()),
      (error) => error.code === 'PACKAGE_REFERENCE_INVALID' && /scene_unknown/.test(error.message),
    );
  });

  it('rejects an existing variant used with the wrong character', () => {
    const db = createDb();
    db.prepare(`INSERT INTO characters VALUES (22, 1, 'char_gu_chuan', '顾川', 'supporting', '医生', '谨慎', '三十岁', '顾川定妆', '避免改脸', '低沉男声', 2, '2026-09-01', NULL)`).run();
    const value = validResult();
    value.storyboards[0].character_refs[0].character_ref = 'char_gu_chuan';
    const valueTask = task();
    valueTask.asset_snapshot.characters.char_gu_chuan = { id: 22, updated_at: '2026-09-01' };
    assert.throws(
      () => adaptExternalAiResult(db, value, valueTask),
      (error) => error.code === 'PACKAGE_REFERENCE_INVALID' && /不属于人物/.test(error.message),
    );
  });

  it('rejects a task asset that has been deleted after package generation', () => {
    const db = createDb();
    db.prepare(`UPDATE scenes SET deleted_at = '2026-09-07' WHERE id = 41`).run();
    assert.throws(
      () => adaptExternalAiResult(db, validResult(), task()),
      (error) => error.code === 'PACKAGE_REFERENCE_INVALID' && /已删除/.test(error.message),
    );
  });
});
