const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { exportDrama } = require('../src/services/dramaExportService');
const { importDrama } = require('../src/services/dramaImportService');

// 完整生产 schema：跑全部迁移 + 兜底补列（与 src/db/migrate.js 启动行为一致）
function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function createLog() {
  return { info() {}, warn() {}, error() {} };
}

/**
 * 建源库：1 剧 1 集 1 人物（2 状态）1 场景（带 state）1 道具 2 分镜；
 * 分镜 1 关联状态 sort_order=1，分镜 2 无关联。返回全部源 id 与媒体相对路径。
 */
function seedSourceDb(db, storageDir) {
  const now = '2026-01-01T00:00:00.000Z';
  const media = {
    charMain: 'projects/src/characters/char_main.png',
    charExtra: 'projects/src/characters/char_extra_1.png',
    varDefault: 'projects/src/characters/var_default.png',
    varDefaultExtra: 'projects/src/characters/var_default_extra.png',
    varInjured: 'projects/src/characters/var_injured.png',
  };
  for (const rel of Object.values(media)) {
    const abs = path.join(storageDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(`data:${rel}`));
  }

  const dramaId = Number(db.prepare(
    "INSERT INTO dramas (title, description, status, created_at, updated_at) VALUES ('源剧', '测试剧目', 'draft', ?, ?)"
  ).run(now, now).lastInsertRowid);
  const epId = Number(db.prepare(
    "INSERT INTO episodes (drama_id, episode_number, title, duration, audio_plan, production_profile, created_at, updated_at) VALUES (?, 1, '第一集', 0, ?, ?, ?, ?)"
  ).run(
    dramaId,
    JSON.stringify({ bgm: { mode: 'per_segment', prompt: 'shared theme' } }),
    JSON.stringify({ generation_mode: 'external_import' }),
    now,
    now,
  ).lastInsertRowid);

  // 先插入再删除占位人物行，抬高 characters 自增值，确保往返后新库人物 id ≠ 源库 id
  const dummyChar = db.prepare(
    "INSERT INTO characters (drama_id, name, created_at, updated_at) VALUES (?, '占位', ?, ?)"
  ).run(dramaId, now, now);
  db.prepare('DELETE FROM characters WHERE id = ?').run(dummyChar.lastInsertRowid);

  // 先插入再删除占位 variant 并抬高自增值（+10），确保往返后新库 variant id 与源库无重叠
  const dummyVariant = db.prepare(
    "INSERT INTO character_variants (character_id, name, created_at, updated_at) VALUES (?, '占位', ?, ?)"
  ).run(dummyChar.lastInsertRowid, now, now);
  db.prepare('DELETE FROM character_variants WHERE id = ?').run(dummyVariant.lastInsertRowid);
  db.prepare("UPDATE sqlite_sequence SET seq = seq + 10 WHERE name = 'character_variants'").run();

  const charId = Number(db.prepare(
    `INSERT INTO characters (drama_id, name, role, description, appearance, source_key, local_path, extra_images, sort_order, created_at, updated_at)
     VALUES (?, '林晚', '主角', '女主角', '黑长直少女', 'char_linwan', ?, ?, 0, ?, ?)`
  ).run(dramaId, media.charMain, JSON.stringify([media.charExtra]), now, now).lastInsertRowid);

  const insertVariant = (v) => Number(db.prepare(
    `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, negative_prompt, local_path, extra_images, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    charId, v.source_key, v.name, v.description, v.appearance, v.image_prompt, v.negative_prompt,
    v.local_path, v.extra_images ? JSON.stringify(v.extra_images) : null, v.is_default, now, now
  ).lastInsertRowid);

  const variantDefaultId = insertVariant({
    source_key: 'default', name: '常态', description: '日常校服', appearance: '白衬衫',
    image_prompt: 'white shirt school uniform', negative_prompt: 'lowres',
    local_path: media.varDefault, extra_images: [media.varDefaultExtra], is_default: 1,
  });
  const variantInjuredId = insertVariant({
    source_key: 'injured', name: '受伤', description: '手臂缠绷带', appearance: '绷带',
    image_prompt: 'bandaged arm', negative_prompt: null,
    local_path: media.varInjured, extra_images: null, is_default: 0,
  });

  const sceneId = Number(db.prepare(
    `INSERT INTO scenes (drama_id, episode_id, location, time, prompt, source_key, state, atmosphere, negative_prompt, created_at, updated_at)
     VALUES (?, ?, '废弃教学楼', '雨夜', '昏暗走廊', 'scene_corridor_rain', 'night', '湿冷压抑', 'sunlight', ?, ?)`
  ).run(dramaId, epId, now, now).lastInsertRowid);

  const propId = Number(db.prepare(
    `INSERT INTO props (drama_id, episode_id, name, type, description, prompt, source_key, negative_prompt, created_at, updated_at)
     VALUES (?, ?, '黄铜钥匙', '关键道具', '打开天台的钥匙', 'brass key', 'prop_brass_key', 'oversized', ?, ?)`
  ).run(dramaId, epId, now, now).lastInsertRowid);

  const sb1Id = Number(db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, title, characters, scene_id, source_key, audio_description, transition, is_primary, production_metadata, created_at, updated_at)
     VALUES (?, 1, '走廊相遇', ?, ?, 'sb_0001', '雨声与急促脚步声', 'cut', 1, ?, ?, ?)`
  ).run(
    epId,
    JSON.stringify([charId]),
    sceneId,
    JSON.stringify({ field_state: { is_primary: { source: 'manual', locked: true, revision: 1 } } }),
    now,
    now,
  ).lastInsertRowid);
  const sb2Id = Number(db.prepare(
    `INSERT INTO storyboards (episode_id, storyboard_number, title, characters, source_key, created_at, updated_at)
     VALUES (?, 2, '转身离开', '[]', 'sb_0002', ?, ?)`
  ).run(epId, now, now).lastInsertRowid);

  db.prepare(
    `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
     VALUES (?, ?, ?, '主角', 1, '正面特写，雨水打在镜头前')`
  ).run(sb1Id, charId, variantDefaultId);

  return {
    dramaId, epId, charId,
    variantDefaultId, variantInjuredId,
    sceneId, propId, sb1Id, sb2Id,
    media,
  };
}

function parseProjectJson(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  return JSON.parse(zip.getEntry('project.json').getData().toString('utf8'));
}

describe('drama zip export/import roundtrip with variants and source keys', () => {
  let tmpRoot;
  let srcDb;
  let srcStorage;
  let srcIds;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task8-'));
    srcStorage = fs.mkdtempSync(path.join(tmpRoot, 'src-storage-'));
    srcDb = createDb();
    srcIds = seedSourceDb(srcDb, srcStorage);
  });

  afterEach(() => {
    try { srcDb.close(); } catch (_) {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('carries variants, source keys and variant links through the zip roundtrip', () => {
    const { buffer } = exportDrama(
      srcDb,
      { storage: { local_path: srcStorage } },
      createLog(),
      srcIds.dramaId
    );

    // 导出端：project.json 结构符合约定
    const project = parseProjectJson(buffer);
    const exportedChar = project.characters[0];
    assert.equal(exportedChar.source_key, 'char_linwan');
    assert.deepEqual(exportedChar.variants.map((v) => v.source_key), ['default', 'injured']);
    assert.equal(exportedChar.variants[0].is_default, 1);
    assert.ok(exportedChar.variants[0].image_file, 'variant 主图应打包进 ZIP');
    const sb1Export = project.episodes[0].storyboards[0];
    const sb2Export = project.episodes[0].storyboards[1];
    assert.deepEqual(sb1Export.character_variant_refs, [
      {
        character_index: 0,
        variant_index: 0,
        reference_role: '主角',
        sort_order: 1,
        framing_note: '正面特写，雨水打在镜头前',
      },
    ]);
    assert.deepEqual(sb2Export.character_variant_refs, []);
    assert.equal(sb1Export.audio_description, '雨声与急促脚步声');
    assert.equal(sb1Export.transition, 'cut');
    assert.equal(sb1Export.is_primary, true);
    assert.match(sb1Export.production_metadata, /field_state/);
    assert.match(project.episodes[0].audio_plan, /per_segment/);
    assert.match(project.episodes[0].production_profile, /external_import/);
    assert.equal(project.scenes[0].state, 'night');
    assert.equal(project.scenes[0].source_key, 'scene_corridor_rain');
    assert.equal(project.scenes[0].atmosphere, '湿冷压抑');
    assert.equal(project.scenes[0].negative_prompt, 'sunlight');
    assert.equal(project.props[0].negative_prompt, 'oversized');

    // 导入到全新库
    const dstStorage = fs.mkdtempSync(path.join(tmpRoot, 'dst-storage-'));
    const dstDb = createDb();
    try {
      const result = importDrama(
        dstDb,
        { storage: { local_path: dstStorage } },
        createLog(),
        buffer
      );
      assert.ok(result.drama_id, '导入应返回新 drama id');

      // 人物与 source_key
      const newChar = dstDb.prepare('SELECT * FROM characters WHERE deleted_at IS NULL').get();
      assert.equal(newChar.name, '林晚');
      assert.equal(newChar.source_key, 'char_linwan');
      assert.notEqual(newChar.id, srcIds.charId);

      // 状态：数量、source_key、字段，新 id ≠ 旧 id
      const newVariants = dstDb.prepare(
        'SELECT * FROM character_variants WHERE character_id = ? AND deleted_at IS NULL ORDER BY id'
      ).all(newChar.id);
      assert.equal(newVariants.length, 2);
      assert.deepEqual(newVariants.map((v) => v.source_key), ['default', 'injured']);
      assert.deepEqual(newVariants.map((v) => v.name), ['常态', '受伤']);
      assert.deepEqual(newVariants.map((v) => v.is_default), [1, 0]);
      assert.deepEqual(newVariants.map((v) => v.image_prompt), ['white shirt school uniform', 'bandaged arm']);
      assert.deepEqual(newVariants.map((v) => v.negative_prompt), ['lowres', null]);
      const oldVariantIds = [srcIds.variantDefaultId, srcIds.variantInjuredId];
      for (const v of newVariants) {
        assert.ok(!oldVariantIds.includes(Number(v.id)), `新 variant id ${v.id} 不应与源库 id 相同`);
      }

      // 状态媒体文件按对称方式落盘，local_path 指向新库 storage 中真实存在的文件
      for (const v of newVariants) {
        assert.ok(v.local_path, `variant ${v.name} 应有 local_path`);
        const abs = path.join(dstStorage, v.local_path);
        assert.ok(fs.existsSync(abs), `落盘文件不存在: ${abs}`);
        assert.equal(
          fs.readFileSync(abs, 'utf8'),
          `data:${v.name === '常态' ? srcIds.media.varDefault : srcIds.media.varInjured}`
        );
      }
      // extra_images 以 JSON 文本写回且文件落盘
      const defaultVariant = newVariants[0];
      const extras = JSON.parse(defaultVariant.extra_images);
      assert.equal(extras.length, 1);
      assert.ok(fs.existsSync(path.join(dstStorage, extras[0])), 'variant 额外参考图应落盘');
      const injuredVariant = newVariants[1];
      assert.equal(injuredVariant.extra_images, null);

      // 场景/道具
      const newScene = dstDb.prepare('SELECT * FROM scenes WHERE deleted_at IS NULL').get();
      assert.equal(newScene.source_key, 'scene_corridor_rain');
      assert.equal(newScene.state, 'night');
      assert.equal(newScene.location, '废弃教学楼');
      assert.equal(newScene.atmosphere, '湿冷压抑');
      assert.equal(newScene.negative_prompt, 'sunlight');
      const newProp = dstDb.prepare('SELECT * FROM props WHERE deleted_at IS NULL').get();
      assert.equal(newProp.source_key, 'prop_brass_key');
      assert.equal(newProp.negative_prompt, 'oversized');

      const newEpisode = dstDb.prepare('SELECT * FROM episodes WHERE drama_id = ? ORDER BY episode_number').get(result.drama_id);
      assert.match(newEpisode.audio_plan, /per_segment/);
      assert.match(newEpisode.production_profile, /external_import/);

      // 分镜新字段
      const newSbs = dstDb.prepare(
        'SELECT * FROM storyboards WHERE deleted_at IS NULL ORDER BY storyboard_number'
      ).all();
      assert.equal(newSbs.length, 2);
      assert.equal(newSbs[0].source_key, 'sb_0001');
      assert.equal(newSbs[0].audio_description, '雨声与急促脚步声');
      assert.equal(newSbs[0].transition, 'cut');
      assert.equal(newSbs[0].is_primary, 1);
      assert.match(newSbs[0].production_metadata, /field_state/);
      assert.equal(newSbs[1].source_key, 'sb_0002');
      assert.equal(newSbs[1].audio_description, null);
      assert.equal(newSbs[1].transition, null);

      // 状态关联：仅分镜 1 有一条，且指向重映射后的 variant_id
      const links1 = dstDb.prepare(
        'SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?'
      ).all(newSbs[0].id);
      assert.equal(links1.length, 1);
      assert.equal(links1[0].character_id, newChar.id);
      assert.equal(links1[0].variant_id, defaultVariant.id, '应指向重映射后的“常态”variant');
      assert.equal(links1[0].reference_role, '主角');
      assert.equal(links1[0].sort_order, 1);
      assert.equal(links1[0].framing_note, '正面特写，雨水打在镜头前');
      const links2 = dstDb.prepare(
        'SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?'
      ).all(newSbs[1].id);
      assert.equal(links2.length, 0);
    } finally {
      dstDb.close();
    }
  });

  it('imports legacy zips without variants/source key fields without errors', () => {
    const { buffer } = exportDrama(
      srcDb,
      { storage: { local_path: srcStorage } },
      createLog(),
      srcIds.dramaId
    );

    // 手工删掉新版字段，模拟旧版 ZIP
    const project = parseProjectJson(buffer);
    for (const c of project.characters || []) {
      delete c.source_key;
      delete c.variants;
    }
    for (const s of project.scenes || []) {
      delete s.source_key;
      delete s.state;
    }
    for (const p of project.props || []) {
      delete p.source_key;
    }
    for (const ep of project.episodes || []) {
      for (const sb of ep.storyboards || []) {
        delete sb.source_key;
        delete sb.audio_description;
        delete sb.transition;
        delete sb.character_variant_refs;
      }
    }
    const legacyZip = new AdmZip();
    legacyZip.addFile('project.json', Buffer.from(JSON.stringify(project), 'utf8'));
    const legacyBuffer = legacyZip.toBuffer();

    const dstStorage = fs.mkdtempSync(path.join(tmpRoot, 'legacy-storage-'));
    const dstDb = createDb();
    try {
      const result = importDrama(
        dstDb,
        { storage: { local_path: dstStorage } },
        createLog(),
        legacyBuffer
      );
      assert.ok(result.drama_id);
      assert.equal(dstDb.prepare('SELECT COUNT(*) AS c FROM characters').get().c, 1);
      assert.equal(dstDb.prepare('SELECT COUNT(*) AS c FROM character_variants').get().c, 0);
      assert.equal(dstDb.prepare('SELECT COUNT(*) AS c FROM storyboard_character_variants').get().c, 0);
      const scene = dstDb.prepare('SELECT * FROM scenes').get();
      assert.equal(scene.location, '废弃教学楼');
      assert.equal(scene.state, null);
      assert.equal(scene.source_key, null);
      const sbs = dstDb.prepare('SELECT * FROM storyboards ORDER BY storyboard_number').all();
      assert.equal(sbs.length, 2);
      assert.equal(sbs[0].audio_description, null);
      assert.equal(sbs[0].transition, null);
      // 分镜-人物下标关联仍正常恢复
      const legacyChar = dstDb.prepare('SELECT id FROM characters').get();
      assert.deepEqual(JSON.parse(sbs[0].characters), [legacyChar.id]);
    } finally {
      dstDb.close();
    }
  });
});
