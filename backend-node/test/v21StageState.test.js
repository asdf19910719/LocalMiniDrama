'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const fs = require('node:fs');
const path = require('node:path');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createStageStateService } = require('../src/v21/stage/stageStateService.js');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  // 基础表（dramas/episodes 等）来自 01_init.sql
  const initSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '01_init.sql'),
    'utf8'
  );
  db.exec(initSql);
  ensureV21Domain(db);
  db.prepare(
    `INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, '测试项目', datetime('now'), datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
     VALUES (1, 1, 1, '第一集', datetime('now'), datetime('now'))`
  ).run();
  return db;
}

function eventsOf(db, episodeId = 1) {
  return db
    .prepare('SELECT * FROM production_stage_events WHERE episode_id = ? ORDER BY id')
    .all(episodeId);
}

test('首次保存草稿：not_started → in_progress 并创建 current revision', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  const state = svc.markInProgress(1, 'script', { contentRevision: 1 });
  assert.equal(state.status, 'in_progress');
  assert.equal(state.content_revision, 1);
  const evts = eventsOf(db).filter((e) => e.event_type !== 'created');
  assert.equal(evts.length, 1);
  assert.equal(evts[0].event_type, 'first-draft-saved');
  assert.equal(evts[0].to_status, 'in_progress');
});

test('submit-review 无 blocker：in_progress → ready_for_review 并冻结 fingerprint', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  const state = svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  assert.equal(state.status, 'ready_for_review');
  assert.equal(state.source_fingerprint, 'fp-1');
});

test('submit-review 有 blocker：保持 in_progress 并返回 STAGE_BLOCKED', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  assert.throws(
    () => svc.submitReview(1, 'script', { blockers: [{ code: 'EMPTY_SCRIPT' }] }),
    (err) => err.code === 'STAGE_BLOCKED'
  );
  assert.equal(svc.getStage(1, 'script').status, 'in_progress');
});

test('ready_for_review 下编辑：→ in_progress（待审快照保留为历史）', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  const state = svc.edit(1, 'script', { contentRevision: 2 });
  assert.equal(state.status, 'in_progress');
  assert.equal(state.content_revision, 2);
});

test('approve：expected revision 匹配且 Gate pass → approved 并写批准事件', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  const state = svc.approve(1, 'script', {
    expectedRevision: 1,
    expectedFingerprint: 'fp-1',
    actor: 'local-user',
  });
  assert.equal(state.status, 'approved');
  assert.equal(state.approved_revision, 1);
  assert.equal(state.approved_by, 'local-user');
  assert.ok(state.approved_at);
  const evts = eventsOf(db);
  assert.equal(evts[evts.length - 1].event_type, 'approved');
});

test('approve：expected revision 不匹配 → 409 REVISION_CONFLICT 且不改状态', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  assert.throws(
    () => svc.approve(1, 'script', { expectedRevision: 99, expectedFingerprint: 'fp-1' }),
    (err) => err.code === 'REVISION_CONFLICT' && err.status === 409
  );
  assert.equal(svc.getStage(1, 'script').status, 'ready_for_review');
});

test('approve：fingerprint 不匹配 → 409', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  assert.throws(
    () => svc.approve(1, 'script', { expectedRevision: 1, expectedFingerprint: 'fp-other' }),
    (err) => err.code === 'REVISION_CONFLICT'
  );
});

test('reject：原因必填，ready_for_review → in_progress 并写退回事件', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  assert.throws(() => svc.reject(1, 'script', { reason: '' }), /原因/);
  const state = svc.reject(1, 'script', { reason: '场次三需要重写' });
  assert.equal(state.status, 'in_progress');
  const evts = eventsOf(db);
  assert.equal(evts[evts.length - 1].event_type, 'rejected');
});

test('upstream-changed：approved → stale 并保留批准 revision', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  svc.approve(1, 'script', { expectedRevision: 1, expectedFingerprint: 'fp-1' });
  const state = svc.markStale(1, 'script', { newFingerprint: 'fp-2' });
  assert.equal(state.status, 'stale');
  assert.equal(state.approved_revision, 1, '批准 revision 保留');
});

test('无关任务失败不影响 approved（仅 badge，不改状态）', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'storyboard');
  svc.markInProgress(1, 'storyboard', { contentRevision: 1 });
  svc.submitReview(1, 'storyboard', { fingerprint: 'fp-1' });
  svc.approve(1, 'storyboard', { expectedRevision: 1, expectedFingerprint: 'fp-1' });
  const state = svc.recordUnrelatedTaskFailure(1, 'storyboard');
  assert.equal(state.status, 'approved');
  const evts = eventsOf(db);
  assert.ok(!evts.some((e) => e.event_type === 'upstream-changed'), '无关任务失败不得触发 stale');
});

test('stale → create-revision：基于旧批准版派生回 in_progress', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  svc.approve(1, 'script', { expectedRevision: 1, expectedFingerprint: 'fp-1' });
  svc.markStale(1, 'script', { newFingerprint: 'fp-2' });
  const state = svc.markInProgress(1, 'script', { contentRevision: 2 });
  assert.equal(state.status, 'in_progress');
  assert.equal(state.approved_revision, 1, '旧批准版可查看');
});

test('stale 状态低风险预览保持 stale 并记录事件', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  svc.approve(1, 'script', { expectedRevision: 1, expectedFingerprint: 'fp-1' });
  svc.markStale(1, 'script', { newFingerprint: 'fp-2' });
  const state = svc.keepApprovedForPreview(1, 'script');
  assert.equal(state.status, 'stale');
  const evts = eventsOf(db);
  assert.equal(evts[evts.length - 1].event_type, 'keep-approved-for-preview');
});

test('stale → submit-review（新 revision Gate pass）→ ready_for_review', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  svc.submitReview(1, 'script', { fingerprint: 'fp-1' });
  svc.approve(1, 'script', { expectedRevision: 1, expectedFingerprint: 'fp-1' });
  svc.markStale(1, 'script', { newFingerprint: 'fp-2' });
  svc.markInProgress(1, 'script', { contentRevision: 2 });
  const state = svc.submitReview(1, 'script', { fingerprint: 'fp-3' });
  assert.equal(state.status, 'ready_for_review');
});

test('非法转换被拒绝：not_started 直接 approve 抛 INVALID_TRANSITION', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  assert.throws(
    () => svc.approve(1, 'script', { expectedRevision: 0, expectedFingerprint: 'x' }),
    (err) => err.code === 'INVALID_TRANSITION'
  );
});

test('listStages 返回四阶段投影，未创建的阶段的阶段状态可懒创建', () => {
  const db = createDb();
  const svc = createStageStateService(db);
  svc.ensureStage(1, 1, 'script');
  svc.markInProgress(1, 'script', { contentRevision: 1 });
  const rows = svc.listStages(1);
  assert.deepEqual(
    rows.map((r) => r.stage),
    ['script', 'assets', 'storyboard', 'cut']
  );
  const script = rows.find((r) => r.stage === 'script');
  assert.equal(script.status, 'in_progress');
  const assets = rows.find((r) => r.stage === 'assets');
  assert.equal(assets.status, 'not_started');
});
