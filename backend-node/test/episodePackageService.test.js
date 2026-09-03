const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const {
  sha256Text,
  episodeBlankStatus,
  previewPackageImport,
  importEpisodePackage,
} = require('../src/services/episodePackageService');
const {
  renderAction,
  renderDialogue,
  generateScriptFromStoryboards,
} = require('../src/services/episodePackageValidator');

const EXAMPLE_PATH = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'specs', 'episode-package.example.json');

// 用 node:crypto 独立计算哈希,避免与被测函数互相印证
function shaOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// 内存库手建全部涉及的表:基础表裁剪自 migrations/01_init.sql,
// 增量列来自 03/18/19/30 等迁移,变体相关表与 migrations/30_episode_package_import.sql 一致(含唯一索引)。
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_number INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      script_content TEXT,
      description TEXT,
      duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT,
      appearance TEXT,
      image_url TEXT,
      local_path TEXT,
      source_key TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      location TEXT,
      time TEXT,
      prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      status TEXT DEFAULT 'draft',
      source_key TEXT,
      state TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    -- 仅测试用:生产库 scenes.source_key 无唯一索引;此处加索引是为了按 brief 用例 5
    -- 构造"DB 层 UNIQUE 冲突"以验证事务回滚。
    CREATE UNIQUE INDEX idx_scenes_source_key ON scenes(source_key);
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      name TEXT NOT NULL DEFAULT '',
      type TEXT,
      description TEXT,
      prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      source_key TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      scene_id INTEGER,
      storyboard_number INTEGER DEFAULT 0,
      title TEXT,
      description TEXT,
      duration REAL,
      dialogue TEXT,
      action TEXT,
      atmosphere TEXT,
      image_prompt TEXT,
      video_prompt TEXT,
      characters TEXT,
      shot_type TEXT,
      angle TEXT,
      movement TEXT,
      image_url TEXT,
      local_path TEXT,
      video_url TEXT,
      layout_description TEXT,
      narration TEXT,
      universal_segment_text TEXT,
      creation_mode TEXT DEFAULT 'classic',
      status TEXT DEFAULT 'draft',
      source_key TEXT,
      audio_description TEXT,
      transition TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, prop_id)
    );
    CREATE TABLE character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      source_key TEXT,
      name TEXT NOT NULL,
      description TEXT,
      appearance TEXT,
      image_prompt TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_character_variants_key ON character_variants(character_id, source_key);
    CREATE TABLE storyboard_character_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      reference_role TEXT,
      sort_order INTEGER,
      framing_note TEXT
    );
    CREATE UNIQUE INDEX idx_sbv_variant ON storyboard_character_variants(storyboard_id, variant_id);
    CREATE UNIQUE INDEX idx_sbv_sort ON storyboard_character_variants(storyboard_id, sort_order) WHERE sort_order IS NOT NULL;
    CREATE TABLE episode_imports (
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
      imported_at TEXT
    );
  `);
  return db;
}

function insertDrama(db) {
  return Number(db.prepare("INSERT INTO dramas (title, created_at) VALUES ('测试剧', '2026-09-03T00:00:00.000Z')").run().lastInsertRowid);
}

function insertEpisode(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, script_content, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z')`
  ).run(
    overrides.drama_id ?? 1,
    overrides.episode_number ?? 1,
    overrides.title ?? '空白集',
    overrides.script_content ?? null,
    overrides.description ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertScene(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO scenes (drama_id, episode_id, location, prompt, source_key, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z')`
  ).run(
    overrides.drama_id ?? 1,
    overrides.episode_id ?? null,
    overrides.location ?? '场景甲',
    overrides.prompt ?? '原提示词',
    overrides.source_key ?? 'scene_other',
    overrides.state ?? null
  );
  return Number(info.lastInsertRowid);
}

function insertCharacter(db, overrides = {}) {
  const info = db.prepare(
    `INSERT INTO characters (drama_id, name, description, source_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z')`
  ).run(overrides.drama_id ?? 1, overrides.name ?? '人物甲', overrides.description ?? '已有人物', overrides.source_key ?? 'char_other');
  return Number(info.lastInsertRowid);
}

const COUNT_TABLES = [
  'episodes',
  'characters',
  'character_variants',
  'scenes',
  'props',
  'storyboards',
  'storyboard_props',
  'storyboard_character_variants',
  'episode_imports',
];

function tableCounts(db) {
  const counts = {};
  for (const t of COUNT_TABLES) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
  return counts;
}

// 最小合法包:1 人物 1 状态 1 场景 1 道具 2 分镜(通过结构与业务双重校验)
function buildMinimalPackage() {
  return {
    schema: 'local-mini-drama.episode-package',
    version: '1.0',
    generator: { name: 'unit-test', model: 'none', generated_at: '2026-09-03T00:00:00+08:00' },
    episode: {
      source_key: 'ep_test_01',
      episode_number: 1,
      title: '测试集',
      summary: '测试梗概',
    },
    characters: [
      {
        source_key: 'char_a',
        name: '人物甲',
        description: '测试人物',
        variants: [
          {
            source_key: 'char_a_default',
            name: '默认状态',
            description: '默认',
            appearance: '黑色短发',
            image_prompt: 'variant-prompt',
            negative_prompt: 'np',
            is_default: true,
          },
        ],
      },
    ],
    scenes: [
      {
        source_key: 'scene_a',
        name: '场景甲',
        state: '白天',
        description: '场景描述',
        image_prompt: 'scene-prompt',
      },
    ],
    props: [
      {
        source_key: 'prop_a',
        name: '道具甲',
        description: '道具描述',
        image_prompt: 'prop-prompt',
      },
    ],
    storyboards: [
      {
        source_key: 'sb_01',
        storyboard_number: 1,
        title: '镜一',
        description: '第一镜',
        duration_seconds: 4,
        scene_ref: 'scene_a',
        character_refs: [
          {
            character_ref: 'char_a',
            variant_ref: 'char_a_default',
            reference_role: 'primary',
            sort_order: 1,
            framing_note: '中景构图',
          },
        ],
        prop_refs: ['prop_a'],
        shot_type: '中景',
        camera_angle: '平视',
        camera_movement: '固定机位',
        composition: '构图一',
        action: { start: '开始动作', progression: '推进动作', end: '结束动作' },
        dialogue: [{ speaker: '人物甲', line: '台词一', performance: '平静地' }],
        narration: '旁白一',
        audio_description: { ambient: '雨声' },
        transition: { to_next: '硬切' },
        image_prompt: 'sb1-image-prompt',
        universal_segment_text: '@图片1 是场景,@图片2 是人物,@图片3 是道具',
      },
      {
        source_key: 'sb_02',
        storyboard_number: 2,
        title: '镜二',
        description: '第二镜',
        duration_seconds: 3.5,
        scene_ref: 'scene_a',
        character_refs: [],
        prop_refs: [],
        shot_type: '近景',
        camera_angle: '俯视',
        camera_movement: '缓推',
        composition: '构图二',
        action: '直接动作文本',
        dialogue: [],
        image_prompt: 'sb2-image-prompt',
        universal_segment_text: '@图片1 是场景',
      },
    ],
  };
}

const CREATE_ALL_DECISIONS = {
  characters: { char_a: 'create' },
  scenes: { scene_a: 'create' },
  props: { prop_a: 'create' },
};

describe('episodePackageService', () => {
  let db;

  beforeEach(() => {
    db = createDb();
    insertDrama(db);
  });

  // —— 补充用例:sha256Text 与 episodeBlankStatus(produces 接口覆盖) ——
  describe('sha256Text / episodeBlankStatus', () => {
    it('sha256Text 返回 sha256 hex,与 node:crypto 一致', () => {
      assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      assert.equal(sha256Text('你好'), shaOf('你好'));
    });

    it('episodeBlankStatus 区分 not_found/blank/non_blank', () => {
      assert.equal(episodeBlankStatus(db, 999).status, 'not_found');

      const emptyId = insertEpisode(db, { episode_number: 2 });
      const blank = episodeBlankStatus(db, emptyId);
      assert.equal(blank.status, 'blank');
      assert.deepEqual(blank.reasons, []);

      // 空字符串与 null 同样视为空
      const blankStrId = insertEpisode(db, { episode_number: 3, script_content: '', description: '' });
      assert.equal(episodeBlankStatus(db, blankStrId).status, 'blank');

      const withScriptId = insertEpisode(db, { episode_number: 4, script_content: '已有剧本' });
      const withScript = episodeBlankStatus(db, withScriptId);
      assert.equal(withScript.status, 'non_blank');
      assert.ok(withScript.reasons.some((r) => r.includes('script_content')));

      const withDescId = insertEpisode(db, { episode_number: 5, description: '已有梗概' });
      assert.equal(episodeBlankStatus(db, withDescId).status, 'non_blank');

      const sbEpisodeId = insertEpisode(db, { episode_number: 6 });
      db.prepare(
        "INSERT INTO storyboards (episode_id, storyboard_number, image_url, created_at) VALUES (?, 1, '/a.png', '2026-09-03T00:00:00.000Z')"
      ).run(sbEpisodeId);
      const withSb = episodeBlankStatus(db, sbEpisodeId);
      assert.equal(withSb.status, 'non_blank');
      assert.ok(withSb.reasons.some((r) => r.includes('storyboard')));

      const impEpisodeId = insertEpisode(db, { episode_number: 7 });
      db.prepare('INSERT INTO episode_imports (episode_id, imported_at) VALUES (?, ?)').run(impEpisodeId, '2026-09-03T00:00:00.000Z');
      const withImport = episodeBlankStatus(db, impEpisodeId);
      assert.equal(withImport.status, 'non_blank');
      assert.ok(withImport.reasons.some((r) => r.includes('import')));
    });
  });

  // 用例 1:新建导入(最小合法包)
  it('1. 新建导入:写入全部表、字段映射与统计正确', () => {
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);
    const result = importEpisodePackage(db, {
      rawText,
      sourceSha256: shaOf(rawText),
      dramaId: 1,
      filename: 'test.json',
      decisions: CREATE_ALL_DECISIONS,
    });

    assert.equal(typeof result.episode_id, 'number');
    assert.deepEqual(result.stats, {
      characters_created: 1,
      characters_reused: 0,
      variants_created: 1,
      variants_reused: 0,
      scenes_created: 1,
      scenes_reused: 0,
      props_created: 1,
      props_reused: 0,
      storyboards_created: 2,
    });

    // episodes:新建集,max+1(空剧为 1),title/description/script_content
    const ep = db.prepare('SELECT * FROM episodes').get();
    assert.equal(ep.id, result.episode_id);
    assert.equal(ep.drama_id, 1);
    assert.equal(ep.episode_number, 1);
    assert.equal(ep.title, '测试集');
    assert.equal(ep.description, '测试梗概');
    const expectedScript = generateScriptFromStoryboards(pkg.storyboards);
    assert.equal(ep.script_content, expectedScript);
    assert.ok(ep.script_content.includes('【镜1·scene_a】镜一'));

    // characters
    const char = db.prepare('SELECT * FROM characters').get();
    assert.equal(char.name, '人物甲');
    assert.equal(char.description, '测试人物');
    assert.equal(char.source_key, 'char_a');
    assert.equal(char.drama_id, 1);

    // character_variants:全部字段直映,is_default=1
    const variant = db.prepare('SELECT * FROM character_variants').get();
    assert.equal(variant.character_id, char.id);
    assert.equal(variant.source_key, 'char_a_default');
    assert.equal(variant.name, '默认状态');
    assert.equal(variant.description, '默认');
    assert.equal(variant.appearance, '黑色短发');
    assert.equal(variant.image_prompt, 'variant-prompt');
    assert.equal(variant.negative_prompt, 'np');
    assert.equal(variant.is_default, 1);

    // scenes:name→location、state→state、prompt 拼接 description 前缀
    const scene = db.prepare('SELECT * FROM scenes').get();
    assert.equal(scene.location, '场景甲');
    assert.equal(scene.state, '白天');
    assert.equal(scene.prompt, '（场景描述）scene-prompt');
    assert.equal(scene.source_key, 'scene_a');
    assert.equal(scene.drama_id, 1);
    assert.equal(scene.episode_id, result.episode_id);

    // props
    const prop = db.prepare('SELECT * FROM props').get();
    assert.equal(prop.name, '道具甲');
    assert.equal(prop.description, '道具描述');
    assert.equal(prop.prompt, 'prop-prompt');
    assert.equal(prop.source_key, 'prop_a');
    assert.equal(prop.drama_id, 1);
    assert.equal(prop.episode_id, result.episode_id);

    // storyboards:5.6.1 映射
    const sbs = db.prepare('SELECT * FROM storyboards ORDER BY storyboard_number').all();
    assert.equal(sbs.length, 2);
    const sb1 = sbs[0];
    assert.equal(sb1.episode_id, result.episode_id);
    assert.equal(sb1.scene_id, scene.id);
    assert.equal(sb1.storyboard_number, 1);
    assert.equal(sb1.title, '镜一');
    assert.equal(sb1.description, '第一镜');
    assert.equal(sb1.duration, 4);
    // 渲染后的多行 action 文本
    assert.equal(sb1.action, renderAction(pkg.storyboards[0].action));
    assert.equal(sb1.action, '开始：开始动作\n推进：推进动作\n结束：结束动作');
    assert.equal(sb1.dialogue, renderDialogue(pkg.storyboards[0].dialogue));
    assert.equal(sb1.dialogue, '『人物甲』（平静地）：台词一');
    assert.equal(sb1.shot_type, '中景');
    assert.equal(sb1.angle, '平视');
    assert.equal(sb1.movement, '固定机位');
    assert.equal(sb1.layout_description, '构图一');
    assert.equal(sb1.narration, '旁白一');
    assert.equal(sb1.image_prompt, 'sb1-image-prompt');
    assert.equal(sb1.universal_segment_text, '@图片1 是场景,@图片2 是人物,@图片3 是道具');
    assert.equal(sb1.audio_description, JSON.stringify({ ambient: '雨声' }));
    assert.equal(sb1.transition, JSON.stringify({ to_next: '硬切' }));
    assert.equal(sb1.creation_mode, 'universal');
    assert.equal(sb1.status, 'draft');
    assert.equal(sb1.source_key, 'sb_01');
    // storyboards.characters 投影为人物 ID 数组 JSON
    assert.equal(sb1.characters, JSON.stringify([char.id]));

    const sb2 = sbs[1];
    assert.equal(sb2.action, '直接动作文本');
    assert.equal(sb2.dialogue, '');
    assert.equal(sb2.duration, 3.5);
    assert.equal(sb2.audio_description, null);
    assert.equal(sb2.transition, null);
    assert.equal(sb2.characters, '[]');

    // storyboard_character_variants / storyboard_props
    const links = db.prepare('SELECT * FROM storyboard_character_variants').all();
    assert.equal(links.length, 1);
    assert.equal(links[0].storyboard_id, sb1.id);
    assert.equal(links[0].character_id, char.id);
    assert.equal(links[0].variant_id, variant.id);
    assert.equal(links[0].reference_role, 'primary');
    assert.equal(links[0].sort_order, 1);
    assert.equal(links[0].framing_note, '中景构图');
    const propLinks = db.prepare('SELECT storyboard_id, prop_id FROM storyboard_props ORDER BY storyboard_id').all();
    // 仅 sb_01 引用了道具(sb_02 的 prop_refs 为空)
    assert.deepEqual(propLinks, [
      { storyboard_id: sb1.id, prop_id: prop.id },
    ]);

    // episode_imports 审计快照
    const imp = db.prepare('SELECT * FROM episode_imports').get();
    assert.equal(imp.episode_id, result.episode_id);
    assert.equal(imp.schema_name, 'local-mini-drama.episode-package');
    assert.equal(imp.schema_version, '1.0');
    assert.equal(imp.source_filename, 'test.json');
    assert.equal(imp.source_sha256, shaOf(rawText));
    assert.equal(imp.raw_json, rawText);
    const normalized = JSON.parse(imp.normalized_json);
    assert.equal(normalized.storyboards[0].action, '开始：开始动作\n推进：推进动作\n结束：结束动作');
    assert.equal(normalized.storyboards[0].dialogue, '『人物甲』（平静地）：台词一');
    assert.deepEqual(JSON.parse(imp.match_decisions), CREATE_ALL_DECISIONS);
    assert.deepEqual(JSON.parse(imp.generator_metadata), pkg.generator);
  });

  // 用例 2:填充空白集,集号不变
  it('2. 填充空白集:成功且集号不变', () => {
    const targetId = insertEpisode(db, { episode_number: 5, title: '待填充' });
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);
    const result = importEpisodePackage(db, {
      rawText,
      sourceSha256: shaOf(rawText),
      dramaId: 1,
      targetEpisodeId: targetId,
      decisions: CREATE_ALL_DECISIONS,
    });

    assert.equal(result.episode_id, targetId);
    const eps = db.prepare('SELECT * FROM episodes').all();
    assert.equal(eps.length, 1);
    assert.equal(eps[0].episode_number, 5);
    assert.equal(eps[0].title, '测试集');
    assert.equal(eps[0].description, '测试梗概');
    assert.equal(eps[0].script_content, generateScriptFromStoryboards(pkg.storyboards));
    const sbs = db.prepare('SELECT * FROM storyboards').all();
    assert.equal(sbs.length, 2);
    assert.ok(sbs.every((s) => s.episode_id === targetId));
    assert.equal(db.prepare('SELECT episode_id FROM episode_imports').get().episode_id, targetId);
  });

  // 用例 3:非空集拒绝,零写入
  it('3. 非空集(script_content)→ TARGET_NOT_BLANK 且零写入', () => {
    const targetId = insertEpisode(db, { episode_number: 3, script_content: '已有剧本内容' });
    const before = tableCounts(db);
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);

    assert.throws(
      () => importEpisodePackage(db, {
        rawText,
        sourceSha256: shaOf(rawText),
        dramaId: 1,
        targetEpisodeId: targetId,
        decisions: CREATE_ALL_DECISIONS,
      }),
      (e) => e.code === 'TARGET_NOT_BLANK'
    );
    assert.deepEqual(tableCounts(db), before);
  });

  // 用例 4:哈希不符拒绝,零写入
  it('4. 哈希不符 → PACKAGE_HASH_MISMATCH 且零写入', () => {
    const before = tableCounts(db);
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);

    assert.throws(
      () => importEpisodePackage(db, {
        rawText,
        sourceSha256: '0'.repeat(64),
        dramaId: 1,
        decisions: CREATE_ALL_DECISIONS,
      }),
      (e) => e.code === 'PACKAGE_HASH_MISMATCH'
    );
    assert.deepEqual(tableCounts(db), before);
  });

  // 用例 5:事务中途 DB 层 UNIQUE 冲突 → 完整回滚,episodes 无新行
  it('5. 场景 source_key 重复且 decisions=create 触发 UNIQUE 冲突 → 全部回滚', () => {
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);
    // 预置同 source_key 场景;用户强行 decisions=create → 插入场景时触发 UNIQUE 冲突
    const existingSceneId = insertScene(db, { source_key: 'scene_a', location: '旧场景' });
    const before = tableCounts(db);

    assert.throws(
      () => importEpisodePackage(db, {
        rawText,
        sourceSha256: shaOf(rawText),
        dramaId: 1,
        decisions: { characters: { char_a: 'create' }, scenes: { scene_a: 'create' }, props: { prop_a: 'create' } },
      }),
      (e) => /UNIQUE/i.test(e.message || '')
    );
    // episodes 无新行,其余表也无写入
    const after = tableCounts(db);
    assert.equal(after.episodes, before.episodes);
    assert.equal(after.scenes, before.scenes);
    assert.equal(after.characters, before.characters);
    assert.equal(after.character_variants, before.character_variants);
    assert.equal(after.storyboards, before.storyboards);
    assert.equal(after.storyboard_character_variants, before.storyboard_character_variants);
    assert.equal(after.episode_imports, before.episode_imports);
    // 预置场景未被改动
    assert.equal(db.prepare('SELECT location FROM scenes WHERE id = ?').get(existingSceneId).location, '旧场景');
  });

  // 用例 6:reuse 不覆盖现有内容
  it('6. 预置同 source_key 场景 decisions=reuse → prompt 保持原值', () => {
    const existingSceneId = insertScene(db, { source_key: 'scene_a', location: '场景甲', prompt: '原提示词' });
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);
    const result = importEpisodePackage(db, {
      rawText,
      sourceSha256: shaOf(rawText),
      dramaId: 1,
      decisions: { characters: { char_a: 'create' }, scenes: { scene_a: 'reuse' }, props: { prop_a: 'create' } },
    });

    const scenes = db.prepare('SELECT * FROM scenes').all();
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].id, existingSceneId);
    assert.equal(scenes[0].prompt, '原提示词');
    assert.equal(scenes[0].state, null);
    assert.equal(result.stats.scenes_reused, 1);
    assert.equal(result.stats.scenes_created, 0);
    // 新集的分镜仍正确关联到被复用场景
    const sb = db.prepare('SELECT * FROM storyboards ORDER BY storyboard_number').all();
    assert.equal(sb.length, 2);
    assert.ok(sb.every((s) => s.scene_id === existingSceneId));
  });

  // 用例 7:preview 只读,前后各表计数不变
  it('7. preview 前后库内各表计数不变,且返回渲染后归一化包与资产匹配', () => {
    // 预置:同 source_key 场景(reuse)、同名异 key 人物(conflict)
    const reusedSceneId = insertScene(db, { source_key: 'scene_a', location: '场景甲' });
    const conflictCharId = insertCharacter(db, { name: '人物甲', source_key: 'char_other' });

    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);
    const before = tableCounts(db);

    const preview = previewPackageImport(db, { rawText, filename: 'test.json', dramaId: 1 });

    assert.deepEqual(tableCounts(db), before);
    assert.equal(preview.source_sha256, shaOf(rawText));
    assert.deepEqual(preview.target_status, { status: 'new_episode' });
    assert.deepEqual(preview.errors, []);
    assert.ok(Array.isArray(preview.warnings));
    // normalized_package:action/dialogue 已渲染为落库文本
    assert.equal(preview.normalized_package.storyboards[0].action, '开始：开始动作\n推进：推进动作\n结束：结束动作');
    assert.equal(preview.normalized_package.storyboards[0].dialogue, '『人物甲』（平静地）：台词一');
    assert.equal(preview.normalized_package.storyboards[1].action, '直接动作文本');
    // 原始包对象不被改动
    assert.equal(typeof pkg.storyboards[0].action, 'object');

    // asset_matches
    const sceneMatch = preview.asset_matches.find((m) => m.type === 'scene');
    assert.equal(sceneMatch.decision, 'reuse');
    assert.equal(sceneMatch.existing_id, reusedSceneId);
    const charMatch = preview.asset_matches.find((m) => m.type === 'character');
    assert.equal(charMatch.decision, 'conflict');
    assert.equal(charMatch.existing_id, null);
    assert.deepEqual(charMatch.candidates, [{ id: conflictCharId, name: '人物甲' }]);
    const propMatch = preview.asset_matches.find((m) => m.type === 'prop');
    assert.equal(propMatch.decision, 'create');

    // stats(conflict 未决策,计入待创建桶;reuse 计入复用桶)
    assert.equal(preview.stats.storyboards_created, 2);
    assert.equal(preview.stats.characters_created, 1);
    assert.equal(preview.stats.characters_reused, 0);
    assert.equal(preview.stats.variants_created, 1);
    assert.equal(preview.stats.scenes_created, 0);
    assert.equal(preview.stats.scenes_reused, 1);
    assert.equal(preview.stats.props_created, 1);

    // 无 targetEpisodeId → new_episode;有 targetEpisodeId → blank 判定
    const targetId = insertEpisode(db, { episode_number: 2 });
    const preview2 = previewPackageImport(db, { rawText, dramaId: 1, targetEpisodeId: targetId });
    assert.equal(preview2.target_status.status, 'blank');
  });

  // 用例 8:conflict 未决策 → CONFLICT_UNRESOLVED
  it('8. 同名异 source_key 场景未给决策 → CONFLICT_UNRESOLVED 且零写入', () => {
    insertScene(db, { source_key: 'scene_other', location: '场景甲' });
    const before = tableCounts(db);
    const pkg = buildMinimalPackage();
    const rawText = JSON.stringify(pkg);

    assert.throws(
      () => importEpisodePackage(db, {
        rawText,
        sourceSha256: shaOf(rawText),
        dramaId: 1,
        decisions: {},
      }),
      (e) => e.code === 'CONFLICT_UNRESOLVED'
    );
    assert.deepEqual(tableCounts(db), before);
  });

  // 示例包基准:合法包全链路(结构与业务校验、渲染、导入)可用
  it('示例包基准可通过预览校验并成功导入', () => {
    const rawText = fs.readFileSync(EXAMPLE_PATH, 'utf8');
    const preview = previewPackageImport(db, { rawText, dramaId: 1 });
    assert.deepEqual(preview.errors, []);

    const result = importEpisodePackage(db, {
      rawText,
      sourceSha256: sha256Text(rawText),
      dramaId: 1,
      filename: 'episode-package.example.json',
      decisions: {
        characters: { char_lin_wan: 'create' },
        scenes: { scene_store_entrance_rain: 'create', scene_store_night: 'create' },
        props: { prop_hot_coffee: 'create' },
      },
    });
    assert.equal(typeof result.episode_id, 'number');
    assert.deepEqual(result.stats, {
      characters_created: 1,
      characters_reused: 0,
      variants_created: 2,
      variants_reused: 0,
      scenes_created: 2,
      scenes_reused: 0,
      props_created: 1,
      props_reused: 0,
      storyboards_created: 2,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboards').get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboard_character_variants').get().c, 2);
    // 决策缺省时按 source_key/同名匹配自动判定:create/reuse 直接执行,conflict 才要求显式决策
    const raw2 = JSON.stringify(buildMinimalPackage());
    const result2 = importEpisodePackage(db, {
      rawText: raw2,
      sourceSha256: sha256Text(raw2),
      dramaId: 1,
      decisions: {},
    });
    assert.deepEqual(result2.stats, {
      characters_created: 1,
      characters_reused: 0,
      variants_created: 1,
      variants_reused: 0,
      scenes_created: 1,
      scenes_reused: 0,
      props_created: 1,
      props_reused: 0,
      storyboards_created: 2,
    });
  });
});
