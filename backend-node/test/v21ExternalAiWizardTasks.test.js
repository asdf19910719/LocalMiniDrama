'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createExternalAiWizardService } = require('../src/v21/wizard/externalAiWizardService.js');
const { validateExternalAiResult } = require('../src/services/externalAiResultContract');

const log = { info() {}, warn() {}, error() {} };
const now = '2026-09-11T00:00:00Z';

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  const wizard = createExternalAiWizardService(db, { log });
  return { db, wizard };
}

/** 在建包前种一个既有人物（含默认状态）与既有场景，使其进入任务包冻结清单 */
function seedExistingAssets(db) {
  const charInfo = db
    .prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, polished_prompt, negative_prompt, voice_style, source_key, created_at, updated_at)
       VALUES (1, '林夏', 'main', '夜班服务员，责任心强。', '谨慎、敏感', '二十五岁，马尾辫，深色制服', '深夜酒店走廊的年轻女服务员，深色制服', '模糊', '清亮女声', 'char_lin', ?, ?)`
    )
    .run(now, now);
  const characterId = Number(charInfo.lastInsertRowid);
  db.prepare(
    `INSERT INTO character_variants (character_id, source_key, name, description, appearance, image_prompt, negative_prompt, is_default, created_at, updated_at)
     VALUES (?, 'variant_lin_default', '值班状态', '深夜值班', '深色制服，马尾辫', '深夜酒店走廊的年轻女服务员', '模糊', 1, ?, ?)`
  ).run(characterId, now, now);
  db.prepare(
    `INSERT INTO scenes (drama_id, location, state, description, prompt, atmosphere, negative_prompt, source_key, created_at, updated_at)
     VALUES (1, '208 客房走廊', '深夜', '老酒店二层走廊尽头的客房门', '老酒店二层走廊，尽头一扇客房门', '冷清、压迫', '模糊', 'scene_corridor', ?, ?)`
  ).run(now, now);
}

/** 构造严格符合任务包《返回格式.schema.json》的外部结果（storyboards/local_ref 形态） */
function packageFormatResult(task, { withDigest = true } = {}) {
  const result = {
    schema: 'local-mini-drama.external-ai-result',
    version: '2',
    prompt_contract: 'base_prompt',
    package_id: task.packageId,
    episode: {
      episode_number: task.targetEpisodeNumber,
      title: '客房来电',
      summary: '夜班服务员发现不存在的房间发来订单。',
      script: '内景·酒店走廊·深夜\n林夏走到 208 门前，房内传来陌生访客的声音。',
      duration_target_seconds: 8,
    },
    new_assets: {
      characters: [
        {
          local_ref: 'new_guest',
          name: '陌生访客',
          role: 'supporting',
          description: '深夜藏匿在空房中的神秘访客。',
          personality: '阴郁、捉摸不定',
          appearance: '黑色大衣，帽檐压得很低',
          base_image_prompt: '深夜客房内黑色大衣访客，电影写实',
          negative_prompt: '模糊、卡通',
          voice_profile: '低沉男声',
          variants: [
            {
              local_ref: 'new_guest_default',
              name: '默认',
              description: '雨夜到访',
              appearance: '湿透的黑色大衣',
              base_image_prompt: '黑色大衣访客站在客房阴影中',
              negative_prompt: '模糊',
              is_default: true,
            },
          ],
        },
      ],
      character_variants: [],
      scenes: [
        {
          local_ref: 'new_room',
          name: '208 客房内部',
          state: '深夜未开灯',
          description: '未入住的空房，只有走廊光渗入。',
          atmosphere: '压抑、寂静',
          base_image_prompt: '深夜空房，走廊光渗入，电影写实',
          negative_prompt: '模糊',
        },
      ],
      props: [
        {
          local_ref: 'new_keycard',
          name: '13 层门卡',
          type: '钥匙',
          description: '刷不开 208 的门卡。',
          base_image_prompt: '旧式酒店门卡特写',
          negative_prompt: '模糊',
        },
      ],
    },
    storyboards: [
      {
        local_ref: 'sb_01',
        storyboard_number: 1,
        title: '推开来电的空房',
        description: '林夏用刷不开的门卡推开了本应锁死的 208。',
        duration_seconds: 8,
        scene_ref: 'new_room',
        character_refs: [
          {
            character_ref: 'new_guest',
            variant_ref: 'new_guest_default',
            reference_role: 'primary',
            sort_order: 1,
            framing_note: '访客在门内阴影里',
          },
        ],
        prop_refs: ['new_keycard'],
        shot_type: '中景',
        camera_angle: '平视',
        camera_movement: '缓推',
        composition: '林夏位于右侧，门缝占据左侧',
        action: {
          start: '林夏握住门把，门卡指示灯转绿',
          progression: '房门缓缓打开，走廊光渗入黑暗',
          end: '门内阴影里站着一个黑衣访客',
        },
        dialogue: [{ speaker: '陌生访客', line: '你终于来了。', performance: '低沉、平静' }],
        narration: '凌晨两点，一通来自空房的订单。',
        audio_description: {
          ambience: ['走廊空调低鸣'],
          sound_effects: ['门轴吱呀'],
          dialogue_treatment: '对白清晰贴耳',
          silence: false,
          music_cue: { mode: 'stinger', prompt: '紧张弦乐', intensity: 0.6, start: '0s', end: '8s' },
        },
        transition: {
          type: 'cut',
          duration: 0,
          visual_description: '硬切',
          audio_bridge: { mode: 'none', duration_ms: 0, description: '无音频桥接' },
        },
        base_image_prompt: '深夜客房门口，林夏推门，门内黑衣访客，电影写实',
        base_video_prompt: '镜头自走廊缓推入房，林夏推开门，门内访客渐渐显形',
        universal_segment_text: '@图片1 深夜空房门内视角，@图片2 站在门口，@图片3 挂在林夏指间',
        is_primary: true,
      },
    ],
  };
  if (withDigest) result.assets_digest = task.assetsDigest;
  return result;
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

// ---------- 2. 包 schema 格式结果端到端导入（核心回归） ----------

test('包 schema 格式结果（storyboards/local_ref）可端到端 preview+confirm，提示词与结构落库', () => {
  const { db, wizard } = setup();
  seedExistingAssets(db);
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const result = packageFormatResult(task);
  // 既有人物追加状态（character_variants 仅用于既有人物）+ 分镜同时引用既有/新人物
  result.new_assets.character_variants.push({
    local_ref: 'lin_rain',
    character_ref: 'char_lin',
    name: '淋雨状态',
    description: '被雨淋湿',
    appearance: '制服湿透',
    base_image_prompt: '雨夜湿透的深色制服服务员',
    negative_prompt: '模糊',
    is_default: false,
  });
  result.storyboards[0].character_refs.push({
    character_ref: 'char_lin',
    variant_ref: 'variant_lin_default',
    reference_role: 'primary',
    sort_order: 2,
    framing_note: '林夏在门口中景',
  });

  // 结果本身必须先通过任务包自己的 Schema（防止测试夹具漂移）
  const contract = validateExternalAiResult(result);
  assert.deepEqual(contract, { ok: true, errors: [] });

  // 校验清单全绿（含 digest 回执）
  const checks = wizard.validateResult(created.taskId, JSON.stringify(result));
  assert.equal(checks.ok, true, `validateResult 应通过：${JSON.stringify(checks.errors)}`);

  const plan = wizard.previewImport(created.taskId, JSON.stringify(result));
  assert.equal(plan.ok, true, `导入计划应通过：${JSON.stringify(plan.errors)}`);
  assert.equal(plan.shots.count, 1);
  assert.equal(plan.summary.scenes, 1);
  assert.equal(plan.assetDigestStatus, 'current');

  const imported = wizard.confirmImport(created.taskId, JSON.stringify(result));
  const episodeId = imported.episodeId;
  assert.ok(episodeId);

  // 资产：既有复用（不重建），新建落库
  const guest = db.prepare(`SELECT * FROM characters WHERE name = '陌生访客'`).get();
  assert.ok(guest, '新人物应创建');
  assert.match(guest.source_key, /^ai_/);
  const lin = db.prepare(`SELECT * FROM characters WHERE source_key = 'char_lin'`).get();
  assert.ok(lin, '既有人物按冻结 source_key 复用，不重建');
  const room = db.prepare(`SELECT * FROM scenes WHERE source_key LIKE 'ai_%'`).get();
  assert.ok(room, '新场景应创建');
  const states = db
    .prepare('SELECT cv.* FROM character_variants cv WHERE cv.character_id IN (?, ?)')
    .all(guest.id, lin.id);
  assert.equal(states.filter((s) => s.character_id === lin.id).length, 2, '既有人物应有默认状态+新追加状态');

  // 场次：按 scene_ref 首次出现分组
  const storyScene = db.prepare('SELECT * FROM story_scenes WHERE episode_id = ?').get(episodeId);
  assert.ok(storyScene);
  assert.equal(storyScene.scene_number, 1);
  assert.match(storyScene.scene_key, /^ai_.*story_scene/);

  // 分镜：新人物/状态 key 解析、时码闭合、提示词落库
  const sb = db.prepare('SELECT * FROM storyboards WHERE episode_id = ?').get(episodeId);
  assert.ok(sb);
  assert.equal(sb.duration, 8);
  assert.match(sb.source_key, /^ai_.*sb_01$/);
  assert.equal(sb.image_prompt, result.storyboards[0].base_image_prompt, 'base_image_prompt 应写入 image_prompt');
  assert.equal(sb.video_prompt, result.storyboards[0].base_video_prompt, 'base_video_prompt 应写入 video_prompt');
  assert.equal(sb.universal_segment_text, result.storyboards[0].universal_segment_text, '万能提示词应落库');
  assert.equal(sb.transition, 'cut');
  assert.equal(sb.is_primary, 1);
  assert.ok(JSON.parse(sb.audio_description).ambience.includes('走廊空调低鸣'));

  const seg = db.prepare('SELECT * FROM storyboard_segments WHERE storyboard_id = ?').get(sb.id);
  assert.ok(seg);
  assert.equal(seg.start_seconds, 0);
  assert.equal(seg.end_seconds, 8);
  assert.ok(seg.dialogue.includes('你终于来了'), '台词应写入时段');
  const refs = JSON.parse(seg.asset_refs_json);
  assert.equal(refs.sceneRefs.length, 1);
  assert.equal(refs.characterRefs.length, 2, '两个引用状态都应解析');
  assert.equal(refs.propRefs.length, 1);

  // 分镜-状态/道具绑定
  const bindings = db.prepare('SELECT * FROM storyboard_character_variants WHERE storyboard_id = ?').all(sb.id);
  assert.equal(bindings.length, 2, '分镜应绑定两个人物状态');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storyboard_props WHERE storyboard_id = ?').get(sb.id).n, 1);

  // 审计
  const record = db.prepare('SELECT * FROM episode_imports WHERE episode_id = ?').get(episodeId);
  const report = JSON.parse(record.import_report);
  assert.equal(report.shots, 1);
  assert.equal(report.segments, 1);
  assert.equal(wizard.getTask(created.taskId).status, 'imported');
});

test('结果省略 assets_digest（按 Schema 合法）时校验通过且导入继续，计划标注 missing', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const resultJson = JSON.stringify(packageFormatResult(task, { withDigest: false }));

  const checks = wizard.validateResult(created.taskId, resultJson);
  assert.equal(checks.ok, true, `digest 缺失不应阻断：${JSON.stringify(checks.errors)}`);
  const digestCheck = checks.checks.find((c) => c.id === 'assets_digest');
  assert.equal(digestCheck.ok, true);
  assert.ok(digestCheck.detail.includes('未携带'), 'detail 应说明结果未携带回执');

  const plan = wizard.previewImport(created.taskId, resultJson);
  assert.equal(plan.ok, true);
  assert.equal(plan.assetDigestStatus, 'missing');
  assert.ok(plan.externalWarnings.some((w) => w.code === 'PACKAGE_ASSETS_DIGEST_MISSING'));

  const imported = wizard.confirmImport(created.taskId, resultJson);
  assert.ok(imported.episodeId);
});

// ---------- 3. 冻结快照导入选项（frozenSnapshot） ----------

test('frozenSnapshot：digest 提供但失配默认仍拒绝；带标志时 preview/confirm 成功且返回与审计均标注', () => {
  const { db, wizard } = setup();
  seedExistingAssets(db);
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const result = packageFormatResult(task);
  const resultJson = JSON.stringify(result);

  // 模拟建包后素材快照漂移：任务行 assets_digest 改变
  db.prepare('UPDATE external_ai_package_tasks SET assets_digest = ? WHERE package_id = ?').run(
    'f'.repeat(64),
    task.packageId
  );

  // 校验清单应标记 digest 失配（前端失配面板的触发条件）
  const checks = wizard.validateResult(created.taskId, resultJson);
  assert.equal(checks.ok, false);
  assert.ok(checks.checks.some((c) => c.id === 'assets_digest' && !c.ok));

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
  assert.equal(plan.assetDigestStatus, 'changed');

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

  const imported = wizard.confirmImport(created.taskId, JSON.stringify(packageFormatResult(task)));
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
  const resultJson = JSON.stringify(packageFormatResult(task));

  const plan = wizard.previewImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.frozenSnapshot, undefined, 'digest 匹配时不标注（无副作用）');

  const imported = wizard.confirmImport(created.taskId, resultJson, { frozenSnapshot: true });
  assert.equal(imported.frozenSnapshot, undefined, 'digest 匹配时返回不标注');
  const record = db.prepare('SELECT * FROM episode_imports WHERE episode_id = ?').get(imported.episodeId);
  const report = JSON.parse(record.import_report);
  assert.equal(report.frozenSnapshot, undefined, 'digest 匹配时审计不标注');
});

test('frozenSnapshot：其他校验失败（package_id / 集号 / schema / prompt_contract）即使带标志仍拒绝', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);

  const badPackageId = packageFormatResult(task);
  badPackageId.package_id = 'extai_wrong';
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badPackageId), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TASK_MISMATCH'
  );
  assert.throws(
    () => wizard.previewImport(created.taskId, JSON.stringify(badPackageId), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TASK_MISMATCH'
  );

  const badEpisode = packageFormatResult(task);
  badEpisode.episode.episode_number = 99;
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badEpisode), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_TARGET_MISMATCH'
  );

  const badSchema = packageFormatResult(task);
  badSchema.schema = 'local-mini-drama.unknown';
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badSchema), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_SCHEMA_UNSUPPORTED'
  );

  const badContract = packageFormatResult(task);
  badContract.prompt_contract = 'final_prompt';
  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(badContract), { frozenSnapshot: true }),
    (err) => err.code === 'PACKAGE_INVALID',
    'prompt_contract 违约应被任务包 Schema 拒绝'
  );
});

// ---------- 4. 引用完整性 ----------

test('storyboard 引用不存在的既有资产 → PACKAGE_REFERENCE_INVALID，不落库', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const result = packageFormatResult(task);
  result.storyboards[0].scene_ref = 'scene_missing';

  const checks = wizard.validateResult(created.taskId, JSON.stringify(result));
  assert.equal(checks.ok, false);
  assert.ok(checks.checks.some((c) => c.id === 'asset-mapping' && !c.ok), '校验清单应标记映射失败');

  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(result)),
    (err) => err.code === 'PACKAGE_REFERENCE_INVALID'
  );
  assert.equal(wizard.listProjectTasks(1).find((t) => t.packageId === created.taskId).status, 'waiting_external');
});

test('character_variants 指向新人物 → PACKAGE_REFERENCE_INVALID（新人物状态必须放 variants 内）', () => {
  const { wizard } = setup();
  const created = wizard.createPackage(1, { mode: 'create_new' });
  const task = wizard.getTask(created.taskId);
  const result = packageFormatResult(task);
  result.new_assets.character_variants.push({
    local_ref: 'new_guest_rain',
    character_ref: 'new_guest',
    name: '淋雨',
    description: '全身湿透',
    appearance: '湿透黑大衣',
    base_image_prompt: '雨夜湿透访客',
    negative_prompt: '模糊',
    is_default: false,
  });

  assert.throws(
    () => wizard.confirmImport(created.taskId, JSON.stringify(result)),
    (err) => err.code === 'PACKAGE_REFERENCE_INVALID'
  );
});
