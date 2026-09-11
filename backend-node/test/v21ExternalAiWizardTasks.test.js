'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createExternalAiWizardService } = require('../src/v21/wizard/externalAiWizardService.js');

const log = { info() {}, warn() {}, error() {} };

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
  return { db, wizard };
}

/** 构造合法的最小 episode-package@2.1（与 v21ImportV21.test.js 同形，供结果适配复用） */
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
      characters: [],
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
            character_state_refs: ['state_guest_default'],
            prop_refs: ['prop_keycard'],
            dialogue: [
              {
                speaker_ref: 'char_new_guest',
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
            character_state_refs: ['state_guest_default'],
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

/** 结果声明的新人物（含默认状态） */
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

/** 构造合法的 external-ai-result@2.1（digest 与任务包冻结值一致） */
function validResult(task) {
  return {
    schema: 'local-mini-drama.external-ai-result',
    version: '2.1',
    package_id: task.packageId,
    assets_digest: task.assetsDigest,
    episode: {
      episode_number: task.targetEpisodeNumber,
      title: '客房来电',
      summary: '夜班服务员发现不存在的房间发来订单。',
      script: '内景·酒店走廊·深夜',
      duration_target_seconds: 8,
    },
    new_assets: {
      characters: guestCharacterWithStates(),
      character_states: [],
      scene_assets: validPackage().assets.scene_assets,
      props: validPackage().assets.props,
    },
    story_scenes: validPackage().story_scenes,
    shot_packages: validPackage().shot_packages,
  };
}

// ---------- 1. 项目外部任务列表端点（listProjectTasks） ----------

test('listProjectTasks：三种状态判定 + created_at 倒序 + 字段齐全 + 项目隔离', () => {
  const { db, wizard } = setup();
  const a = wizard.createPackage(1, { mode: 'create_new', taskNote: '等待中' });
  const b = wizard.createPackage(1, { mode: 'create_new' });
  const c = wizard.createPackage(1, { mode: 'create_new' });

  // b → imported（模拟已成功回流）；c → cancelled
  db.prepare('UPDATE external_ai_package_tasks SET imported_at = ? WHERE package_id = ?').run(
    '2026-09-11T01:00:00Z',
    b.packageId
  );
  wizard.cancelTask(c.packageId);

  const list = wizard.listProjectTasks(1);
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((t) => t.packageId),
    [c.packageId, b.packageId, a.packageId],
    '应按 created_at DESC（同刻按 id DESC）返回最新在前'
  );

  const byId = Object.fromEntries(list.map((t) => [t.packageId, t]));
  assert.equal(byId[a.packageId].status, 'waiting_external');
  assert.equal(byId[b.packageId].status, 'imported');
  assert.equal(byId[b.packageId].importedAt, '2026-09-11T01:00:00Z');
  assert.equal(byId[c.packageId].status, 'cancelled');
  assert.ok(byId[c.packageId].cancelledAt, 'cancelled 应带 cancelledAt');

  for (const key of ['packageId', 'targetEpisodeId', 'targetEpisodeNumber', 'status', 'taskNote', 'contextVersion', 'createdAt', 'importedAt', 'cancelledAt']) {
    assert.ok(key in byId[a.packageId], `列表项应含字段 ${key}`);
  }
  assert.equal(byId[a.packageId].taskNote, '等待中');
  assert.match(byId[a.packageId].contextVersion, /^[a-f0-9]{64}$/);
  assert.equal(typeof byId[a.packageId].targetEpisodeNumber, 'number');

  // 项目隔离：其他项目看不到
  assert.equal(wizard.listProjectTasks(999).length, 0);
});

// ---------- 2. 冻结快照导入选项（frozenSnapshot） ----------

test('frozenSnapshot：digest 失配默认仍拒绝；带标志时 preview/confirm 成功且返回与审计均标注', () => {
  const { db, wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const result = validResult(task);
  const resultJson = JSON.stringify(result);

  // 模拟建包后素材快照漂移：任务行 assets_digest 改变
  db.prepare('UPDATE external_ai_package_tasks SET assets_digest = ? WHERE package_id = ?').run(
    'f'.repeat(64),
    task.packageId
  );

  // 默认路径：preview 与 confirm 均抛 ASSETS_DIGEST_MISMATCH
  assert.throws(
    () => wizard.previewImport(created.taskId, resultJson),
    (err) => err.code === 'ASSETS_DIGEST_MISMATCH'
  );
  assert.throws(
    () => wizard.confirmImport(created.taskId, resultJson),
    (err) => err.code === 'ASSETS_DIGEST_MISMATCH'
  );

  // frozenSnapshot=true：preview 成功并标注
  const plan = wizard.previewImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.frozenSnapshot, true, 'preview 返回应标注 frozenSnapshot');

  // confirm 成功：返回 + 审计记录 import_report 均标注
  const imported = wizard.confirmImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(imported.frozenSnapshot, true, 'confirm 返回应标注 frozenSnapshot');
  const record = db.prepare('SELECT * FROM episode_imports WHERE episode_id = ?').get(imported.episodeId);
  const report = JSON.parse(record.import_report);
  assert.equal(report.frozenSnapshot, true, 'import 审计记录应写入 frozenSnapshot 标注');
  assert.equal(wizard.getTask(created.taskId).status, 'imported');
});

test('confirmImport：create_new 导入后回填 target_episode_id（剧集中心打开剧本 / 离页恢复依赖）', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  assert.equal(task.targetEpisodeId, null, 'create_new 建包时尚无目标剧集');

  const imported = wizard.confirmImport(created.taskId, JSON.stringify(validResult(task)));
  const after = wizard.getTask(created.taskId);
  assert.ok(after.targetEpisodeId, '导入后 targetEpisodeId 应回填，不得为空');
  assert.equal(Number(after.targetEpisodeId), Number(imported.episodeId), '回填值应等于导入创建的剧集 id');

  // 列表端点同步可见（剧集中心 imported 行「打开剧本」依赖 targetEpisodeId）
  const row = wizard.listProjectTasks(1).find((t) => t.packageId === created.taskId);
  assert.equal(Number(row.targetEpisodeId), Number(imported.episodeId));
  assert.equal(row.status, 'imported');
});

test('frozenSnapshot：digest 匹配时该标志无副作用', () => {
  const { db, wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const resultJson = JSON.stringify(validResult(task));

  const plan = wizard.previewImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.frozenSnapshot, undefined, 'digest 匹配时不标注（无副作用）');

  const imported = wizard.confirmImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(imported.frozenSnapshot, undefined, 'digest 匹配时返回不标注');
  const record = db.prepare('SELECT * FROM episode_imports WHERE episode_id = ?').get(imported.episodeId);
  const report = JSON.parse(record.import_report);
  assert.equal(report.frozenSnapshot, undefined, 'digest 匹配时审计不标注');
});

test('frozenSnapshot：其他校验失败（package_id / 集号不符）即使带标志仍拒绝', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);

  const badPackageId = validResult(task);
  badPackageId.package_id = 'extai_wrong';
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badPackageId), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TASK_MISMATCH'
  );
  assert.throws(
    () => wizard.previewImport(created.taskId, JSON.stringify(badPackageId), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TASK_MISMATCH'
  );

  const badEpisode = validResult(task);
  badEpisode.episode.episode_number = 99;
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badEpisode), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TARGET_MISMATCH'
  );

  const badSchema = validResult(task);
  badSchema.schema = 'local-mini-drama.unknown';
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badSchema), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_SCHEMA_UNSUPPORTED'
  );
});
