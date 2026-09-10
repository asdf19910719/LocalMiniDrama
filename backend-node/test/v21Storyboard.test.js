'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns } = require('../src/v21/db.js');
const { createStoryboardService } = require('../src/v21/storyboard/storyboardService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');

const log = { info() {}, warn() {}, error() {} };

const SCRIPT_TEXT = [
  '第一场 内景·酒店走廊·深夜',
  '林夏走到 208 门前。',
  '第二场 外景·停车场·凌晨',
  '经理从阴影中走出。',
].join('\n');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21sb-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  ensureAsyncTaskV21Columns(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);
  const storageDir = path.join(tmp, 'storage');
  const mock = createMockProvider({ db, log, storageDir });
  const script = createScriptService(db, { log });
  script.saveDraft(1, { content: SCRIPT_TEXT });
  script.confirmScript(1, {});
  const svc = createStoryboardService(db, { log, mockProvider: mock });
  return { db, svc, script, mock };
}

test('createFromScript：从已确认剧本创建分镜结构（每场一镜，单时段合法）', () => {
  const { db, svc } = setup();
  const result = svc.createFromScript(1);
  assert.equal(result.created, 2);
  const shots = svc.listShots(1);
  assert.equal(shots.length, 2);
  const first = svc.getShotDetail(shots[0].id);
  assert.equal(first.segments.length, 1, '每镜默认单时段');
  assert.equal(first.segments[0].start_seconds, 0);
  assert.ok(first.segments[0].end_seconds > 0);
  assert.ok(first.expectedRevision >= 1);
  // 分镜阶段推进
  const stage = db
    .prepare("SELECT status FROM production_stage_states WHERE episode_id = 1 AND stage = 'storyboard'")
    .get();
  assert.equal(stage.status, 'in_progress');
});

test('createFromScript：剧本未确认时拒绝', () => {
  const { db, svc } = setup();
  db.prepare('DELETE FROM episode_script_revisions').run();
  assert.throws(() => svc.createFromScript(1), (err) => err.code === 'SCRIPT_NOT_APPROVED');
});

test('时段编辑：拆分/合并保持时码连续闭合与总时长', () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const detail = svc.getShotDetail(shots[0].id);
  const seg = detail.segments[0];
  const total = seg.end_seconds - seg.start_seconds;
  const split = svc.splitSegment(shots[0].id, seg.id, seg.start_seconds + total / 2);
  assert.equal(split.segments.length, 2);
  const s0 = split.segments[0];
  const s1 = split.segments[1];
  assert.equal(s0.end_seconds, s1.start_seconds, '拆分后时码连续');
  assert.equal(s1.end_seconds - s0.start_seconds, total, '总时长不变');
  const merged = svc.mergeSegment(shots[0].id, s0.id);
  assert.equal(merged.segments.length, 1);
  assert.equal(merged.segments[0].end_seconds - merged.segments[0].start_seconds, total);
});

test('时段编辑：expected_revision 不匹配 → SHOT_REVISION_CONFLICT', () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  assert.throws(
    () => svc.editSegment(shots[0].id, 'seg-x', { visual: 'x', expectedRevision: 999 }),
    (err) => err.code === 'SHOT_REVISION_CONFLICT' && err.status === 409
  );
});

test('引用管理：本镜场景不可移除；增删引用即时生效并令 H3 标脏', () => {
  const { db, svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const manager = svc.getReferenceManager(shotId);
  assert.ok(manager.scene.locked, '本镜场景结构性不可移除');

  // 添加一个人物引用（需要项目素材中存在）
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, image_url, created_at, updated_at) VALUES (5, 1, '经理', 'http://x/m.png', '2026-09-11', '2026-09-11')`
  ).run();
  const afterAdd = svc.addReference(shotId, { assetType: 'character', assetId: 5 });
  assert.equal(afterAdd.characters.some((r) => r.assetId === 5), true);

  // H3 生成后引用变化 → stale
  svc.generateH3(shotId);
  const beforeRef = svc.getH3Draft(shotId);
  assert.equal(beforeRef.status, 'ai-generated');
  const afterRemove = svc.removeReference(shotId, afterAdd.characters.find((r) => r.assetId === 5).referenceId);
  assert.equal(afterRemove.characters.some((r) => r.assetId === 5), false);
  const draft = svc.getH3Draft(shotId);
  assert.equal(draft.status, 'stale', '引用变化令 H3 需要更新');
});

test('分镜图：自动拼装提示词/手工覆盖/恢复自动；生成候选与设为当前', async () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const auto = svc.getImagePrompt(shotId);
  assert.ok(auto.text.length > 0);
  assert.equal(auto.manual, false);
  svc.editImagePrompt(shotId, { text: '手工提示词' });
  const manual = svc.getImagePrompt(shotId);
  assert.equal(manual.manual, true);
  assert.equal(manual.text, '手工提示词');
  const reset = svc.resetImagePrompt(shotId);
  assert.equal(reset.manual, false);

  const cand = await svc.generateImage(shotId, { prompt: null });
  assert.ok(cand.candidateId > 0);
  assert.ok(cand.url.startsWith('/static/'), 'mock 图片候选可访问');
  const adopted = svc.setImageCurrent(shotId, { candidateId: cand.candidateId });
  assert.equal(adopted.currentImage.url, cand.url);
});

test('改选分镜图：H3 标 stale；已采用旧视频标记"基于旧分镜图"并退出完成计数', async () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const img1 = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img1.candidateId });
  svc.generateH3(shotId);
  const submitted = await svc.submitVideo(shotId, { count: 1 });
  assert.equal(submitted.tasks.length, 1);
  const done = await svc.completeVideoTask(submitted.tasks[0].taskId);
  const adopted = svc.adoptVideo(shotId, done.candidateId);
  assert.equal(adopted.adoptedCandidateId, done.candidateId);

  // 改选另一张分镜图
  const img2 = await svc.generateImage(shotId, { prompt: '不同构图' });
  const after = svc.setImageCurrent(shotId, { candidateId: img2.candidateId });
  assert.equal(after.h3Draft.status, 'stale', 'H3 需要更新');
  assert.equal(after.staleVideos.length, 1, '旧视频标记基于旧分镜图');

  const gate = svc.getCompletion(1);
  assert.equal(gate.adopted, 0, '退出完成计数');
  assert.equal(gate.total, 2);
  assert.equal(gate.staleShots.length, 1);
});

test('H3 草稿：生成/编辑保存/校验四项/来源变化标 stale/dirty 与 stale 阻断提交且不覆盖人工文本', async () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  const shotId = shots[0].id;
  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });

  const draft = svc.generateH3(shotId);
  assert.equal(draft.status, 'ai-generated');
  assert.deepEqual(draft.validation.checks.map((c) => c.id), ['structure', 'slots', 'audio', 'style']);
  assert.equal(draft.validation.valid, true);

  // 编辑 → dirty；保存并校验 → valid
  const edited = svc.editH3(shotId, { text: `${draft.text}\n（人工补充：保持低调布光）` });
  assert.equal(edited.status, 'dirty');
  const saved = svc.saveH3(shotId, { text: edited.text });
  assert.equal(saved.status, 'valid');
  assert.equal(saved.manuallyEdited, true);

  // 重新生成不得静默覆盖人工文本
  assert.throws(
    () => svc.generateH3(shotId),
    (err) => err.code === 'H3_MANUAL_PROTECTED'
  );

  // 来源变化 → stale，阻断提交
  const shots2 = svc.listShots(1);
  svc.editSegment(shots2[0].id, saved.segments[0].id, { visual: '动作变化', expectedRevision: saved.expectedRevision });
  const afterChange = svc.getH3Draft(shotId);
  assert.equal(afterChange.status, 'stale');

  // 保存非法文本 → invalid（缺引用槽位）
  const invalid = svc.saveH3(shotId, { text: '完全没有引用槽位的文本' });
  assert.equal(invalid.status, 'invalid');
  assert.ok(invalid.validation.errors.length > 0);
});

test('批量预检与完成度投影：x/y 已采用、缺失/失败分组', async () => {
  const { svc } = setup();
  svc.createFromScript(1);
  const shots = svc.listShots(1);
  for (const shot of shots.slice(0, 1)) {
    const img = await svc.generateImage(shot.id, {});
    svc.setImageCurrent(shot.id, { candidateId: img.candidateId });
    svc.generateH3(shot.id);
    const t = await svc.submitVideo(shot.id, { count: 1 });
    const done = await svc.completeVideoTask(t.tasks[0].taskId);
    svc.adoptVideo(shot.id, done.candidateId);
  }
  const completion = svc.getCompletion(1);
  assert.equal(completion.total, 2);
  assert.equal(completion.adopted, 1);
  assert.ok(completion.blockers.some((b) => b.label.includes('尚未生成')));
});
