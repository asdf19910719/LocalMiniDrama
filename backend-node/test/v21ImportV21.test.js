'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { validatePackageV21 } = require('../src/v21/import/packageContractV21.js');
const {
  createEpisodeImportV21,
} = require('../src/v21/import/episodeImportV21.js');
const { createExternalAiWizardService } = require('../src/v21/wizard/externalAiWizardService.js');

const log = { info() {}, warn() {}, error() {} };

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  const wizard = createExternalAiWizardService(db, { log });
  const importer = createEpisodeImportV21(db, { log });
  return { db, wizard, importer };
}

/** 构造合法的最小 episode-package@2.1 */
function validPackage() {
  return {
    schema: 'local-mini-drama.episode-package',
    version: '2.1',
    episode: {
      episode_number: 1,
      title: '客房来电',
      summary: '夜班服务员发现不存在的房间发来订单。',
      script: '内景·酒店走廊·深夜\n林夏走到 208 门前。',
      duration_target_seconds: 8,
    },
    assets: {
      characters: [
        {
          source_key: 'char_lin_xia',
          name: '林夏',
          role: 'main',
          description: '夜班服务员',
          personality: '谨慎而好奇',
          appearance: '深蓝色制服',
          voice_profile: '清亮女声',
          states: [
            {
              source_key: 'state_lin_xia_default',
              name: '默认',
              description: '夜班制服',
              appearance: '深蓝色制服',
              is_default: true,
            },
          ],
        },
      ],
      scene_assets: [
        {
          source_key: 'scene_corridor',
          name: '208 客房走廊',
          state: '深夜',
          description: '老酒店二层走廊尽头的客房门',
          atmosphere: '冷清、压迫',
        },
      ],
      props: [
        {
          source_key: 'prop_keycard',
          name: '13 层门卡',
          type: '钥匙',
          description: '刷不开 208 的门卡',
        },
      ],
    },
    story_scenes: [
      {
        source_key: 'story_scene_01',
        scene_number: 1,
        heading: '内景·酒店走廊·深夜',
        location_scene_ref: 'scene_corridor',
        summary: '林夏在空房门口听见电话铃声。',
      },
    ],
    shot_packages: [
      {
        source_key: 'shot_01',
        shot_number: 1,
        story_scene_refs: ['story_scene_01'],
        planned_duration_seconds: 8,
        story_intent: '林夏确认声音来自空房内部。',
        visual: {
          shot_size: 'medium',
          camera_angle: 'eye_level',
          camera_movement: 'slow_push_in',
          composition: '林夏位于右侧，房门占据左侧',
          lighting: '冷色走廊灯',
        },
        timed_segments: [
          {
            start_seconds: 0,
            end_seconds: 4,
            action: '林夏缓慢转头看向门口',
            scene_asset_refs: ['scene_corridor'],
            character_state_refs: ['state_lin_xia_default'],
            prop_refs: ['prop_keycard'],
            dialogue: [
              {
                speaker_ref: 'char_lin_xia',
                start_seconds: 1,
                end_seconds: 3,
                text: '谁在那里？',
              },
            ],
          },
          {
            start_seconds: 4,
            end_seconds: 8,
            action: '门卡指示灯由红转绿',
            scene_asset_refs: ['scene_corridor'],
            character_state_refs: ['state_lin_xia_default'],
            prop_refs: ['prop_keycard'],
          },
        ],
        continuity: { entry: {}, exit: {}, axis: null },
        audio: {
          dialogue: [],
          narration: [],
          ambience: ['走廊空调低鸣'],
          sound_effects: ['电话铃'],
          music_intent: null,
        },
      },
    ],
  };
}

test('validatePackageV21：合法包通过', () => {
  const result = validatePackageV21(validPackage());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validatePackageV21：未知 schema 名返回 PACKAGE_SCHEMA_UNSUPPORTED', () => {
  const pkg = validPackage();
  pkg.schema = 'local-mini-drama.unknown';
  const result = validatePackageV21(pkg);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'PACKAGE_SCHEMA_UNSUPPORTED'));
});

test('validatePackageV21：错误版本区分 VERSION_UNSUPPORTED 与 SCHEMA_INVALID', () => {
  const v1 = validPackage();
  v1.version = '1.1';
  const r1 = validatePackageV21(v1);
  assert.ok(r1.errors.some((e) => e.code === 'PACKAGE_VERSION_UNSUPPORTED'));

  const numeric = validPackage();
  numeric.version = 2.1;
  const r2 = validatePackageV21(numeric);
  assert.ok(r2.errors.some((e) => e.code === 'PACKAGE_SCHEMA_INVALID'));
  assert.match(r2.errors.find((e) => e.path === 'version').message, /字符串/);

  const missing = validPackage();
  delete missing.story_scenes;
  const r3 = validatePackageV21(missing);
  assert.ok(r3.errors.some((e) => e.code === 'PACKAGE_SCHEMA_INVALID' && e.path === 'story_scenes'));

  const unknown = validPackage();
  unknown.surprise = true;
  const r4 = validatePackageV21(unknown);
  assert.ok(r4.errors.some((e) => e.code === 'PACKAGE_SCHEMA_INVALID' && e.path === 'surprise'));
});

test('validatePackageV21：时段必须从 0 连续闭合到计划时长；台词必须在时段内', () => {
  const pkg = validPackage();
  pkg.shot_packages[0].planned_duration_seconds = 10;
  const r1 = validatePackageV21(pkg);
  assert.ok(r1.errors.some((e) => e.code === 'SEGMENT_CLOSURE_INVALID'));

  const pkg2 = validPackage();
  pkg2.shot_packages[0].timed_segments[0].dialogue[0].end_seconds = 6;
  const r2 = validatePackageV21(pkg2);
  assert.ok(r2.errors.some((e) => e.code === 'DIALOGUE_OUT_OF_SEGMENT'));
});

test('validatePackageV21：source_key 重复与未解析引用被拒', () => {
  const pkg = validPackage();
  pkg.shot_packages[0].timed_segments[1].prop_refs.push('prop_keycard');
  const r1 = validatePackageV21(pkg);
  assert.ok(r1.errors.some((e) => e.code === 'PACKAGE_SCHEMA_INVALID'));

  const pkg2 = validPackage();
  pkg2.shot_packages[0].timed_segments[0].scene_asset_refs = ['scene_ghost'];
  const r2 = validatePackageV21(pkg2);
  assert.ok(r2.errors.some((e) => e.code === 'REFERENCE_UNRESOLVED'));
});

test('buildImportPlan：create_new 目标与五步预览数据、零媒体任务', () => {
  const { db, importer } = setup();
  const pkg = validPackage();
  const plan = importer.buildImportPlan(db, pkg, { dramaId: 1, targetEpisodeId: null });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.mode, 'create_new');
  assert.equal(plan.target.episodeNumber, 1);
  assert.equal(plan.script.title, '客房来电');
  assert.equal(plan.script.sceneCount, 1);
  const reused = plan.assets.matches.filter((m) => m.action === 'reuse').length;
  const created = plan.assets.matches.filter((m) => m.action === 'create').length;
  assert.equal(plan.assets.matches.length, 4, '人物 + 人物状态 + 场景 + 道具 = 4 项匹配');
  assert.equal(created, 3);
  assert.equal(reused, 0);
  assert.equal(plan.shots.count, 1);
  assert.equal(plan.shots.segmentCount, 2);
  assert.equal(plan.summary.mediaTasks, 0);
});

test('buildImportPlan：填充非空剧集 → TARGET_NOT_BLANK', () => {
  const { db, importer } = setup();
  const info = db
    .prepare(
      "INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at) VALUES (1, 1, '已有', '内容', 'draft', datetime('now'), datetime('now'))"
    )
    .run();
  const plan = importer.buildImportPlan(db, validPackage(), { dramaId: 1, targetEpisodeId: info.lastInsertRowid });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors[0].code, 'TARGET_NOT_BLANK');
});

test('confirmImport（create_new）：事务写入草稿、场次、分镜与时段；零媒体任务', () => {
  const { db, importer } = setup();
  const pkg = validPackage();
  const sourceSha256 = sha256Text(JSON.stringify(pkg));
  const before = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  const result = importer.confirmImport(db, { pkg, dramaId: 1, targetEpisodeId: null, sourceSha256 });
  const after = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  assert.equal(after, before, '导入零媒体任务');

  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.episodeId);
  assert.equal(episode.episode_number, 1);
  assert.equal(episode.title, '客房来电');

  const revision = db
    .prepare('SELECT * FROM episode_script_revisions WHERE episode_id = ?')
    .get(result.episodeId);
  assert.equal(revision.status, 'draft', '剧本为草稿，未自动确认');
  assert.equal(revision.source, 'episode-package@2.1');

  const scenes = db
    .prepare('SELECT * FROM story_scenes WHERE episode_id = ?')
    .all(result.episodeId);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].scene_key, 'story_scene_01');

  const boards = db
    .prepare('SELECT * FROM storyboards WHERE episode_id = ?')
    .all(result.episodeId);
  assert.equal(boards.length, 1);
  const segments = db
    .prepare('SELECT * FROM storyboard_segments WHERE storyboard_id = ? ORDER BY seq')
    .all(boards[0].id);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].start_seconds, 0);
  assert.equal(segments[1].end_seconds, 8);

  const characters = db
    .prepare("SELECT * FROM characters WHERE source_key = 'char_lin_xia'")
    .all();
  assert.equal(characters.length, 1);
  const variants = db
    .prepare('SELECT * FROM character_variants WHERE character_id = ?')
    .all(characters[0].id);
  assert.equal(variants.length, 1);

  const links = db
    .prepare('SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?')
    .all(boards[0].id);
  assert.equal(links.length, 1, '分镜绑定人物状态引用');

  // 审计记录
  const record = db
    .prepare('SELECT * FROM episode_imports WHERE episode_id = ?')
    .get(result.episodeId);
  assert.equal(record.schema_version, '2.1');
  assert.equal(record.source_sha256, sourceSha256);

  // 幂等：同 source hash + 目标重复导入被拒
  assert.throws(
    () => importer.confirmImport(db, { pkg, dramaId: 1, targetEpisodeId: null, sourceSha256 }),
    (err) => err.code === 'PACKAGE_ALREADY_IMPORTED'
  );
});

test('confirmImport：预览后目标被并发写入 → 事务内重检 TARGET_NOT_BLANK 且零部分写入', () => {
  const { db, importer } = setup();
  const info = db
    .prepare(
      "INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, '空白集', 'draft', datetime('now'), datetime('now'))"
    )
    .run();
  const targetEpisodeId = Number(info.lastInsertRowid);
  const pkg = validPackage();
  // 模拟预览后另一窗口写入了内容
  db.prepare('UPDATE episodes SET script_content = ? WHERE id = ?').run('并发写入', targetEpisodeId);
  const boardsBefore = db.prepare('SELECT COUNT(*) AS n FROM storyboards').get().n;
  assert.throws(
    () => importer.confirmImport(db, { pkg, dramaId: 1, targetEpisodeId, sourceSha256: sha256Text('x') }),
    (err) => err.code === 'TARGET_NOT_BLANK'
  );
  const boardsAfter = db.prepare('SELECT COUNT(*) AS n FROM storyboards').get().n;
  assert.equal(boardsAfter, boardsBefore, '失败零部分写入');
});

/** 外部 AI 结果的镜头包：把既有人物引用替换为结果声明的新人物 */
function resultShotPackages() {
  return JSON.parse(JSON.stringify(validPackage().shot_packages)).map((shot) => {
    for (const seg of shot.timed_segments) {
      seg.character_state_refs = ['state_guest_default'];
      for (const line of seg.dialogue || []) line.speaker_ref = 'char_new_guest';
    }
    return shot;
  });
}

/** 外部 AI 结果声明的新人物（含默认状态） */
function guestCharacterWithStates() {
  return [
    {
      source_key: 'char_new_guest',
      name: '陌生访客',
      role: 'supporting',
      description: '深夜到访',
      personality: '神秘',
      appearance: '黑色大衣',
      base_image_prompt: '黑色大衣访客',
      negative_prompt: '模糊',
      voice_profile: '低沉男声',
      states: [
        {
          source_key: 'state_guest_default',
          name: '默认',
          description: '雨夜',
          appearance: '湿透黑大衣',
          is_default: true,
        },
      ],
    },
  ];
}

test('外部 AI 回流：adaptExternalAiResultV21 合并新资产并生成规范 2.1 包', () => {
  const { db, wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new', taskNote: '本集保持雨夜氛围' });
  const task = wizard.getTask(created.taskId);
  assert.equal(task.status, 'waiting');
  assert.match(task.packageId, /^extai_/);
  assert.equal(task.taskNote, '本集保持雨夜氛围');
  assert.match(task.contextVersion, /^[a-f0-9]{64}$/);

  const result = {
    schema: 'local-mini-drama.external-ai-result',
    version: '2.1',
    package_id: task.packageId,
    assets_digest: task.assetsDigest,
    generator: { name: 'ChatGPT' },
    episode: {
      episode_number: task.targetEpisodeNumber,
      title: '客房来电',
      summary: '夜班服务员发现不存在的房间发来订单。',
      script: '内景·酒店走廊·深夜',
      duration_target_seconds: 8,
    },
    new_assets: {
      characters: [
        {
          source_key: 'char_new_guest',
          name: '陌生访客',
          role: 'supporting',
          description: '深夜到访',
          personality: '神秘',
          appearance: '黑色大衣',
          base_image_prompt: '黑色大衣访客',
          negative_prompt: '模糊',
          voice_profile: '低沉男声',
          states: [
            {
              source_key: 'state_guest_default',
              name: '默认',
              description: '雨夜',
              appearance: '湿透黑大衣',
              is_default: true,
            },
          ],
        },
      ],
      character_states: [
        {
          character_ref: 'char_new_guest',
          source_key: 'state_guest_wet',
          name: '更湿',
          description: '更湿的大衣',
          appearance: '滴水',
          is_default: false,
        },
      ],
      scene_assets: validPackage().assets.scene_assets,
      props: validPackage().assets.props,
    },
    story_scenes: validPackage().story_scenes,
    shot_packages: resultShotPackages(),
  };
  const adapted = wizard.adaptResult(created.taskId, result);
  assert.equal(adapted.schema, 'local-mini-drama.episode-package');
  assert.equal(adapted.version, '2.1');
  assert.equal(adapted.assets.characters.length, 1, '既有项目无人物，合并结果只有新人物');
  assert.equal(adapted.assets.characters[0].states.length, 2, 'character_states 追加为状态');
  const guestRefs = JSON.stringify(adapted.shot_packages);
  assert.ok(guestRefs.includes('state_guest_default'), '镜头引用指向结果声明的人物状态');
  assert.equal(adapted.story_scenes.length, 1);
  assert.equal(adapted.shot_packages.length, 1);
});

test('外部 AI 回流：篡改 package_id 或 assets_digest 被拒', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const base = {
    schema: 'local-mini-drama.external-ai-result',
    version: '2.1',
    package_id: task.packageId,
    assets_digest: task.assetsDigest,
    episode: {
      episode_number: task.targetEpisodeNumber,
      title: 'T',
      summary: 'S',
      script: 'X',
      duration_target_seconds: 8,
    },
    new_assets: { characters: [], character_states: [], scene_assets: validPackage().assets.scene_assets, props: validPackage().assets.props },
    story_scenes: validPackage().story_scenes,
    shot_packages: validPackage().shot_packages,
  };

  assert.throws(
    () => wizard.adaptResult(created.taskId, { ...base, package_id: 'extai_wrong' }),
    (err) => err.code === 'PACKAGE_TASK_MISMATCH'
  );
  assert.throws(
    () => wizard.adaptResult(created.taskId, { ...base, assets_digest: 'f'.repeat(64) }),
    (err) => err.code === 'ASSETS_DIGEST_MISMATCH'
  );
});

test('外部 AI 回流端到端：任务包 → 校验 → 预览 → 导入（草稿、零媒体任务）', () => {
  const { db, wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new', taskNote: '' });
  const task = wizard.getTask(created.taskId);
  const result = {
    schema: 'local-mini-drama.external-ai-result',
    version: '2.1',
    package_id: task.packageId,
    assets_digest: task.assetsDigest,
    episode: {
      episode_number: task.targetEpisodeNumber,
      title: '客房来电',
      summary: '夜班服务员发现不存在的房间发来订单。',
      script: '内景·酒店走廊·深夜\n林夏走到 208 门前。',
      duration_target_seconds: 8,
    },
    new_assets: {
      characters: guestCharacterWithStates(),
      character_states: [],
      scene_assets: validPackage().assets.scene_assets,
      props: validPackage().assets.props,
    },
    story_scenes: validPackage().story_scenes,
    shot_packages: resultShotPackages(),
  };
  const validation = wizard.validateResult(created.taskId, JSON.stringify(result));
  assert.equal(validation.ok, true, JSON.stringify(validation.checks));
  const checkMap = Object.fromEntries(validation.checks.map((c) => [c.id, c.ok]));
  for (const id of ['schema', 'package_id', 'project', 'episode', 'assets_digest', 'asset-mapping', 'nonempty-target']) {
    assert.equal(checkMap[id], true, `校验项 ${id} 应通过`);
  }

  const preview = wizard.previewImport(created.taskId, JSON.stringify(result));
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.mediaTasks, 0);

  const imported = wizard.confirmImport(created.taskId, JSON.stringify(result));
  const revision = db
    .prepare('SELECT * FROM episode_script_revisions WHERE episode_id = ?')
    .get(imported.episodeId);
  assert.equal(revision.status, 'draft', '导入只写草稿');
  const tasks = db.prepare('SELECT COUNT(*) AS n FROM async_tasks').get().n;
  assert.equal(tasks, 0, '全程零媒体任务');
  const importedTask = wizard.getTask(created.taskId);
  assert.equal(importedTask.status, 'imported');

  // 重复回流：幂等拒绝
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(result)),
    (err) => err.code === 'PACKAGE_ALREADY_IMPORTED'
  );
});
