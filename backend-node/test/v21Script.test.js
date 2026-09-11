'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');

const log = { info() {}, warn() {}, error() {} };

const SCRIPT_TEXT = [
  '第一场 内景·酒店走廊·深夜',
  '林夏走到 208 门前，脚步声在走廊回响。',
  '林夏：谁在那里？',
  '',
  '第二场 外景·停车场·凌晨',
  '经理从阴影中走出，手里拿着一串钥匙。',
].join('\n');

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);
  const svc = createScriptService(db, { log });
  return { db, svc };
}

test('saveDraft：首次保存创建 draft revision 并推进阶段状态；再次保存更新同一草稿', () => {
  const { db, svc } = setup();
  const first = svc.saveDraft(1, { content: SCRIPT_TEXT });
  assert.equal(first.status, 'draft');
  assert.equal(first.revision, 1);
  assert.equal(first.saveState, 'saved');

  const state = db
    .prepare("SELECT status FROM production_stage_states WHERE episode_id = 1 AND stage = 'script'")
    .get();
  assert.equal(state.status, 'in_progress');

  const second = svc.saveDraft(1, { content: SCRIPT_TEXT + '\n第三场 内景·前台·清晨', expectedRevision: 1 });
  assert.equal(second.revision, 1, '草稿内容更新不新增 revision');
});

test('saveDraft：expectedRevision 不匹配 → 409 REVISION_CONFLICT 且不覆盖', () => {
  const { db, svc } = setup();
  svc.saveDraft(1, { content: '第一版' });
  assert.throws(
    () => svc.saveDraft(1, { content: '另一窗口的版本', expectedRevision: 99 }),
    (err) => err.code === 'REVISION_CONFLICT' && err.status === 409
  );
  const row = db
    .prepare("SELECT content FROM episode_script_revisions WHERE episode_id = 1 AND status = 'draft'")
    .get();
  assert.equal(row.content, '第一版');
});

test('parseScenes：草稿保存后解析场次结构（标题/内外景/地点/时间）', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const scenes = svc.parseScenes(1);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].heading, '内景·酒店走廊·深夜');
  assert.equal(scenes[0].interiorExterior, '内景');
  assert.equal(scenes[0].location, '酒店走廊');
  assert.equal(scenes[0].timeOfDay, '深夜');
  assert.equal(scenes[1].interiorExterior, '外景');
  const stored = svc.getStageModel(1).scenes;
  assert.equal(stored.length, 2, '场次已持久化');
});

test('AI 候选（无 Key）：mock 生成候选 → 与草稿 diff → 应用后才修改正文', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const candidate = svc.generateAiCandidate(1, { mode: 'polish' });
  assert.ok(candidate.text.length > 0, '候选文本非空');
  assert.notEqual(candidate.text, SCRIPT_TEXT, 'mock 候选与原文不同');
  assert.ok(candidate.diff.added >= 0 && candidate.diff.removed >= 0);
  // 应用前草稿不变
  assert.equal(svc.getStageModel(1).draft.content, SCRIPT_TEXT);
  svc.applyAiCandidate(1, candidate);
  assert.equal(svc.getStageModel(1).draft.content, candidate.text);
});

/** 断言只有选区被替换为 middle，选区外文本逐字不变 */
function assertOnlySelectionChanged(base, text, sel, checkMiddle) {
  const at = base.indexOf(sel);
  assert.ok(at >= 0, '选区存在于原文');
  const prefix = base.slice(0, at);
  const suffix = base.slice(at + sel.length);
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix), '选区外文本逐字不变');
  const middle = text.slice(prefix.length, text.length - suffix.length);
  checkMiddle(middle);
}

test('AI 五模式 continue：续写只追加不改原文（选区外逐字不变）', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const candidate = svc.generateAiCandidate(1, { mode: 'continue' });
  assert.ok(candidate.text.startsWith(SCRIPT_TEXT), '原文逐字保留在前');
  assert.ok(candidate.text.length > SCRIPT_TEXT.length, '续写追加了新内容');
});

test('AI 五模式 polish：有选区时仅对选区行尾加润色标记，选区外逐字不变', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const sel = '林夏走到 208 门前，脚步声在走廊回响。';
  const candidate = svc.generateAiCandidate(1, { mode: 'polish', selection: sel });
  assertOnlySelectionChanged(SCRIPT_TEXT, candidate.text, sel, (middle) => {
    assert.notEqual(middle, sel, '选区被润色处理');
    assert.ok(middle.startsWith(sel), '润色保留选区原文');
    assert.ok(middle.includes('（润色）'), '选区带润色标记');
  });
});

test('AI 五模式 rewrite：选区被替换为改写结果，选区外逐字不变', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const sel = '林夏走到 208 门前，脚步声在走廊回响。';
  const candidate = svc.generateAiCandidate(1, { mode: 'rewrite', selection: sel });
  assertOnlySelectionChanged(SCRIPT_TEXT, candidate.text, sel, (middle) => {
    assert.notEqual(middle, sel, '选区被改写替换');
    assert.ok(middle.length > 0, '改写结果非空');
  });
});

test('AI 五模式 expand：选区原文保留并在其后追加扩写，选区外逐字不变', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const sel = '林夏走到 208 门前，脚步声在走廊回响。';
  const candidate = svc.generateAiCandidate(1, { mode: 'expand', selection: sel });
  assertOnlySelectionChanged(SCRIPT_TEXT, candidate.text, sel, (middle) => {
    assert.ok(middle.startsWith(sel), '扩写保留选区原文');
    assert.ok(middle.length > sel.length, '选区后追加了扩写内容');
  });
});

test('AI 五模式 condense：选区压缩为更短文本，选区外逐字不变', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const sel = '林夏走到 208 门前，脚步声在走廊回响。';
  const candidate = svc.generateAiCandidate(1, { mode: 'condense', selection: sel });
  assertOnlySelectionChanged(SCRIPT_TEXT, candidate.text, sel, (middle) => {
    assert.ok(middle.length > 0, '缩写结果非空');
    assert.ok(middle.length < sel.length, '缩写结果比选区更短');
  });
});

test('AI 五模式：rewrite/expand/condense 缺少选区 → 400 SELECTION_REQUIRED（用户语言提示）', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  for (const mode of ['rewrite', 'expand', 'condense']) {
    assert.throws(
      () => svc.generateAiCandidate(1, { mode }),
      (err) =>
        err.code === 'SELECTION_REQUIRED' &&
        err.status === 400 &&
        /请先在正文中选择/.test(err.message),
      `${mode} 缺选区应返回 SELECTION_REQUIRED`
    );
  }
});

test('confirmScript：草稿批准为 approved；再次编辑派生新草稿；确认修改使旧版 superseded', () => {
  const { db, svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  const approved = svc.confirmScript(1, { expectedRevision: 1 });
  assert.equal(approved.status, 'approved');

  const stage = db
    .prepare("SELECT status, approved_revision FROM production_stage_states WHERE episode_id = 1 AND stage = 'script'")
    .get();
  assert.equal(stage.status, 'approved');
  assert.equal(stage.approved_revision, 1);

  // 已确认后编辑 → 新草稿派生，批准版保留
  const draft2 = svc.saveDraft(1, { content: SCRIPT_TEXT + '\n第三场 内景·前台·清晨' });
  assert.equal(draft2.revision, 2);
  assert.equal(draft2.status, 'draft');
  const hist = svc.listHistory(1);
  assert.ok(hist.some((r) => r.revision === 1 && r.status === 'approved'));

  // 确认修改
  const approved2 = svc.confirmScript(1, { expectedRevision: 2 });
  assert.equal(approved2.status, 'approved');
  const r1 = db
    .prepare('SELECT status FROM episode_script_revisions WHERE episode_id = 1 AND revision = 1')
    .get();
  assert.equal(r1.status, 'superseded', '旧批准版被标记取代而非删除');
});

test('confirmScript：下游已批准阶段在剧本再次确认后标记 stale', () => {
  const { db, svc } = setup();
  svc.saveDraft(1, { content: SCRIPT_TEXT });
  svc.confirmScript(1, { expectedRevision: 1 });
  // 设定阶段批准
  const { createStageStateService } = require('../src/v21/stage/stageStateService.js');
  const stages = createStageStateService(db);
  stages.ensureStage(1, 1, 'assets');
  stages.markInProgress(1, 'assets', {});
  stages.submitReview(1, 'assets', { fingerprint: 'fp' });
  stages.approve(1, 'assets', { expectedRevision: 1, expectedFingerprint: 'fp' });
  // 剧本改并再次确认
  svc.saveDraft(1, { content: SCRIPT_TEXT + '\n第三场 内景·前台·清晨' });
  svc.confirmScript(1, { expectedRevision: 2 });
  const assets = db
    .prepare("SELECT status FROM production_stage_states WHERE episode_id = 1 AND stage = 'assets'")
    .get();
  assert.equal(assets.status, 'stale', '下游设定阶段被标记需要更新');
});

test('confirmScript：空剧本不能确认', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: '   ' });
  assert.throws(
    () => svc.confirmScript(1, { expectedRevision: 1 }),
    (err) => err.code === 'EMPTY_SCRIPT'
  );
});

test('历史版本只读；复制历史为新草稿不覆盖任何旧版本', () => {
  const { svc } = setup();
  svc.saveDraft(1, { content: '版本A' });
  svc.confirmScript(1, { expectedRevision: 1 });
  svc.saveDraft(1, { content: '版本B' });
  svc.confirmScript(1, { expectedRevision: 2 });
  const hist = svc.listHistory(1);
  assert.equal(hist.filter((r) => r.status === 'approved').length, 1);
  const copied = svc.copyFromHistory(1, 1);
  assert.equal(copied.status, 'draft');
  assert.equal(copied.content, '版本A');
  assert.equal(svc.listHistory(1).filter((r) => r.status === 'approved').length, 1, '旧批准版不受影响');
});
