'use strict';
/**
 * A1 真实 Provider 接入 · storyboardService 通道接线
 * 无 Key（通道 mock）时行为与既有 mock 全流程逐字节一致；配置真实 Key 时经
 * providerRouter 委托真实执行器，产出仍走候选→采用合同。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain, ensureAsyncTaskV21Columns, ensureStoryboardV21Columns } = require('../src/v21/db.js');
const { createStoryboardService } = require('../src/v21/storyboard/storyboardService.js');
const { createScriptService } = require('../src/v21/script/scriptService.js');
const { createAssetQueryService } = require('../src/v21/assets/assetQueryService.js');
const { createMockProvider } = require('../src/v21/mockProvider.js');
const { createProviderRouter } = require('../src/v21/providerRouter.js');

const log = { info() {}, warn() {}, error() {} };

function setup(dbRows = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21realprov-'));
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureStoryboardV21Columns(db);
  ensureAsyncTaskV21Columns(db);
  ensureV21Domain(db);
  const now = '2026-09-11T00:00:00Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, style_id, created_at, updated_at) VALUES (1, '午夜回廊', 'draft', 'rh-101-cinematic', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 1, 'EP01', 'draft', ?, ?)`
  ).run(now, now);

  const mock = createMockProvider({ db, log, storageDir: path.join(tmp, 'storage') });
  const script = createScriptService(db, { log });
  const assets = createAssetQueryService(db, { log, mockProvider: mock });
  const calls = { image: [], videoSubmit: [], videoWait: [], h3Compile: [], h3Save: [] };

  const imageExecutor = {
    generate: async (req) => {
      calls.image.push(req);
      const info = db
        .prepare(
          `INSERT INTO image_generations (storyboard_id, drama_id, provider, prompt, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`
        )
        .run(req.shotId, req.dramaId, req.config.provider, req.prompt, now, now);
      return { candidateId: Number(info.lastInsertRowid), url: `/static/real/${info.lastInsertRowid}.png`, localPath: null, sha256: 'deadbeef' };
    },
  };
  const videoExecutor = {
    submit: async (req) => {
      calls.videoSubmit.push(req);
      const n = calls.videoSubmit.length;
      const now2 = new Date().toISOString();
      const tasks = [];
      for (let i = 0; i < (req.count || 1); i += 1) {
        const taskId = `real-task-${n}-${i}`;
        db.prepare(
          `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
           VALUES (?, 'video_generation', 'pending', 0, '', '', ?, ?)`
        ).run(taskId, now2, now2);
        tasks.push({ taskId, videoGenerationId: 100 + n * 10 + i, candidateId: `cand_${taskId}` });
      }
      return { tasks };
    },
    waitForTask: async (taskId) => { calls.videoWait.push(taskId); return { candidateId: `cand_${taskId}`, artifactId: 'art_x', group: req_group(calls) }; },
    cancel: async () => ({ cancelState: 'cancelled' }),
    retry: async () => ({ taskId: 'real-task-new' }),
  };
  function req_group() { return 'grp_fake'; }
  const h3Executor = {
    compile: async (req) => {
      calls.h3Compile.push(req);
      const info = db
        .prepare(
          `INSERT INTO storyboard_h3_prompt_drafts
             (storyboard_id, video_config_id, workflow_id, source_prompt, source_fingerprint,
              ai_compiled_prompt, final_compiled_prompt, compiled_prompt_hash, manually_edited, status, created_at, updated_at)
           VALUES (?, ?, 'MiniMax-H3', '源文本', 'legacy-fp', '编译文本', 'H3 编译文本', 'hash', 0, 'valid', ?, ?)`
        )
        .run(req.shotId, String(req.resolved.config.id), now, now);
      return db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE id = ?').get(Number(info.lastInsertRowid));
    },
    saveText: async ({ draftId, text }) => {
      calls.h3Save.push({ draftId, text });
      db.prepare(
        `UPDATE storyboard_h3_prompt_drafts SET final_compiled_prompt = ?, manually_edited = 1, status = 'valid', updated_at = ? WHERE id = ?`
      ).run(text, new Date().toISOString(), draftId);
      return db.prepare('SELECT * FROM storyboard_h3_prompt_drafts WHERE id = ?').get(draftId);
    },
  };

  if (dbRows.image) {
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, default_model, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('storyboard_image', 'volces', '图', 'https://x', 'sk-img', '["seedream"]', 'seedream', 0, 1, 1, ?, ?, ?)`
    ).run(dbRows.imageSettings || null, now, now);
  }
  if (dbRows.video) {
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, default_model, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('video', 'minimax_h3', '视频', 'https://x', 'sk-vid', '["MiniMax-H3"]', 'MiniMax-H3', 0, 1, 1, ?, ?, ?)`
    ).run(dbRows.videoSettings || null, now, now);
  }

  const providerRouter = createProviderRouter({
    db,
    log,
    imageExecutor,
    videoExecutor,
    h3Executor,
  });
  const svc = createStoryboardService(db, { log, mockProvider: mock, providerRouter, cfg: {} });
  return { db, svc, script, assets, mock, calls, providerRouter };
}

async function prepareReadyEpisode(ctx) {
  const { db, script, assets } = ctx;
  script.saveDraft(1, { content: '第一场 内景·走廊·深夜\n林夏走到 208 门前。' });
  script.confirmScript(1, {});
  const info = db
    .prepare(`INSERT INTO characters (drama_id, name, created_at, updated_at) VALUES (1, '林夏', ?, ?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (1, ?)').run(info.lastInsertRowid);
  const cand = await assets.generateCandidate(1, { type: 'character', assetId: info.lastInsertRowid, prompt: '林夏' });
  assets.useCandidate({ type: 'character', assetId: info.lastInsertRowid, candidateId: cand.candidateId });
  ctx.characterId = info.lastInsertRowid;
  ctx.svc.createFromScript(1);
}

test('mock 回落：未配置任何 Key 时全流程与既有 mock 行为一致', async () => {
  const ctx = setup({});
  await prepareReadyEpisode(ctx);
  const { svc, mock, calls } = ctx;
  const shotId = svc.listShots(1)[0].id;
  const img = await svc.generateImage(shotId, {});
  assert.ok(img.candidateId > 0);
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  svc.generateH3(shotId);
  const submitted = await svc.submitVideo(shotId, { count: 1 });
  assert.equal(submitted.quote.provider, 'mock');
  const done = await svc.completeVideoTask(submitted.tasks[0].taskId);
  assert.ok(done.candidateId);
  assert.equal(calls.image.length, 0);
  assert.equal(calls.videoSubmit.length, 0);
  void mock;
});

test('图片真实通道：generateImage 委托执行器并复用其候选行（不重复落库）', async () => {
  const ctx = setup({ image: true });
  await prepareReadyEpisode(ctx);
  const { svc, calls } = ctx;
  const shotId = svc.listShots(1)[0].id;
  const result = await svc.generateImage(shotId, {});
  assert.equal(calls.image.length, 1);
  assert.equal(calls.image[0].shotId, shotId);
  assert.equal(calls.image[0].dramaId, 1);
  assert.equal(calls.image[0].config.provider, 'volces');
  assert.ok(calls.image[0].prompt.includes('画面'));
  const row = dbPrepareRow(ctx.db, result.candidateId);
  assert.equal(row.status, 'succeeded', '候选行来自执行器写入，服务层不重复插行');
  const candidates = svc.imageCandidates(shotId);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateId, result.candidateId);
});

function dbPrepareRow(db, id) {
  return db.prepare('SELECT * FROM image_generations WHERE id = ?').get(id);
}

test('视频真实通道：submitVideo 委托执行器；quote 展示真实 Provider 与费用口径', async () => {
  const ctx = setup({ image: true, video: true });
  await prepareReadyEpisode(ctx);
  const { svc, calls } = ctx;
  const shotId = svc.listShots(1)[0].id;
  const img = await svc.generateImage(shotId, {});
  svc.setImageCurrent(shotId, { candidateId: img.candidateId });
  await svc.generateH3(shotId);
  const guard = svc.jointGuard(shotId);
  assert.equal(guard.canSubmit, true, '真实通道下 H3 就绪即可提交');
  const quote = svc.getVideoQuote(shotId, 2);
  assert.equal(quote.provider, 'minimax_h3');
  assert.equal(quote.estimatedCost.estimated, null);
  assert.match(quote.estimatedCost.note, /Provider 未返回价格/);
  const submitted = await svc.submitVideo(shotId, { count: 2 });
  assert.equal(calls.videoSubmit.length, 1);
  assert.equal(calls.videoSubmit[0].count, 2);
  assert.equal(calls.videoSubmit[0].groupId, quote_count_group(ctx.db, shotId));
  assert.ok(calls.videoSubmit[0].h3PromptDraftId > 0, 'H3 通道提交必须携带草稿 id');
  assert.equal(submitted.tasks.length, 2);
  const done = await svc.completeVideoTask(submitted.tasks[0].taskId);
  assert.equal(done.candidateId, `cand_${submitted.tasks[0].taskId}`);
  assert.equal(calls.videoWait[0], submitted.tasks[0].taskId);
});

function quote_count_group(db, shotId) {
  return db.prepare('SELECT id FROM director_candidate_groups WHERE shot_id = ?').get(String(shotId)).id;
}

test('H3 真实通道：generateH3 经编译执行器写入真实配置行；getH3Draft/saveH3 读写同一行', async () => {
  const ctx = setup({ image: true, video: true });
  await prepareReadyEpisode(ctx);
  const { svc, calls } = ctx;
  const shotId = svc.listShots(1)[0].id;
  const generated = await svc.generateH3(shotId);
  assert.equal(calls.h3Compile.length, 1);
  assert.equal(generated.text, 'H3 编译文本');
  const draft = svc.getH3Draft(shotId);
  assert.equal(draft.draftId, generated.draftId);
  assert.equal(draft.text, 'H3 编译文本');
  assert.equal(draft.status, 'ai-generated');
  const saved = await svc.saveH3(shotId, { text: '人工修改后的 H3' });
  assert.equal(calls.h3Save.length, 1);
  assert.equal(saved.text, '人工修改后的 H3');
  assert.equal(saved.manuallyEdited, true);
  // 源列同步：编译前已把分段内容写入 universal_segment_text（legacy 指纹新鲜度依据）
  const sb = ctx.db.prepare('SELECT universal_segment_text FROM storyboards WHERE id = ?').get(shotId);
  assert.ok(sb.universal_segment_text && sb.universal_segment_text.length > 0);
});

test('能力检查：Provider 引用数上限驱动联合检查第 2 行', async () => {
  const ctx = setup({ image: true, video: true, videoSettings: JSON.stringify({ capabilities: { maxReferences: 0 } }) });
  await prepareReadyEpisode(ctx);
  const { svc } = ctx;
  const shotId = svc.listShots(1)[0].id;
  svc.addReference(shotId, { assetType: 'character', assetId: ctx.characterId });
  const guard = svc.jointGuard(shotId);
  const capCheck = guard.checks.find((c) => c.id === 'capability');
  assert.equal(capCheck.ok, false);
  const submitted = svc.submitVideo(shotId, { count: 1 });
  await assert.rejects(() => submitted, (err) => err.code === 'GENERATION_BLOCKED');
});
