# ChatGPT 生图候选自动挂载与自动定稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChatGPT 网页抓回的候选图在导入时自动挂载到任务目标并自动定稿首张,卡片即时显示并带图片更新时间;保留全手动开关与批量恢复。

**Architecture:** 后端在 `importExternalResult` 导入事务内做定稿决策(设置项 `chatgpt_web_auto_select` 默认开):首张候选经现有 `bindResult` 绑定目标并把任务置 `completed`,后续候选仅追加;不可归属时回退 `needs_review`。新增批量恢复路由复用抽取出的 `selectTaskResult` 服务函数。前端补通知、抽屉开关、队列胶囊"全部采用首选"按钮和卡片 `image_updated_at` 展示。扩展侧零改动。

**Tech Stack:** Express, better-sqlite3, Vue 3, Pinia, Element Plus, Node 内置 test runner。

**Spec:** `docs/superpowers/specs/2026-09-01-chatgpt-candidate-auto-binding-design.md`

## Global Constraints

- 设置键 `chatgpt_web_auto_select`,默认 `true`;关闭后行为与现状完全一致(needs_review 手动流)。
- 定稿只发生在任务状态 ∈ preparing/submitted/generating/needs_review;completed/cancelled/failed 不动。
- "首张"定义:该任务 external_job 下此前无 `status IN ('imported','bound')` 的结果行。
- 后续候选不得抢占已定稿主图,仅追加为可切换候选。
- `resolveTarget` 失败(目标已删除等)→ 回退 `needs_review`,候选保留可重绑。
- 所有绑定入口(auto/手动/批量)必须复用 `imageGenerationTargetService.bindResult`/`bindAsset`,并同步写 `image_updated_at`。
- 扩展(browser-extension)目录零改动。
- 每个任务:先写失败测试 → 跑红 → 最小实现 → 跑绿 → 提交。

---

### Task 1: 后端导入自动定稿决策

**Files:**
- Modify: `backend-node/src/services/externalGenerationImportService.js`
- Test: `backend-node/test/externalGenerationImportFinalize.test.js`(新建)

**Interfaces:**
- Consumes: `settingsService.getGlobalSetting(db, key, default)`;`targets.resolveTarget(db, task)` / `targets.bindResult(db, task, imageGenerationId)`;`tasks.transitionTask(db, id, next, patch)`;现有 `markUnifiedTaskNeedsReview(db, attemptId)`。
- Produces: 模块内 `finalizeImportedResult(db, { attempt, resultId, imageGenerationId })`(不导出,由 `importExternalResult` 事务内调用;后续任务不直接依赖)。

- [ ] **Step 1: 写失败测试**

新建 `backend-node/test/externalGenerationImportFinalize.test.js`:

```js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt } = require('../src/services/externalGenerationService');
const { importExternalResult } = require('../src/services/externalGenerationImportService');

const TASK_SCHEMA = `CREATE TABLE IF NOT EXISTS image_generation_tasks (
  id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id INTEGER,
  generation_channel TEXT, status TEXT, batch_id TEXT, queue_position INTEGER,
  prompt_snapshot TEXT, reference_manifest TEXT, aspect_ratio TEXT, frame_type TEXT,
  image_generation_id INTEGER, external_job_id TEXT, error_code TEXT, error_message TEXT,
  created_at TEXT, updated_at TEXT, completed_at TEXT);
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, deleted_at TEXT,
    image_url TEXT, local_path TEXT, extra_images TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`;

async function pngBytes(color) {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
}

function makeCharacterTask(db, { id = 'task-1', targetId = 5 } = {}) {
  db.prepare("INSERT INTO characters (id, drama_id, name, deleted_at) VALUES (?, 7, '林晚晴', NULL)").run(targetId);
  const job = createExternalJob(db, { id: `job-${id}`, dramaId: 7, storyboardId: null, assetType: 'character', site: 'chatgpt', promptSnapshot: 'p', imageGenerationTaskId: id });
  db.prepare(`INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, status, external_job_id, created_at, updated_at)
    VALUES (?, 7, 'character', ?, 'chatgpt_web', 'submitted', ?, datetime('now'), datetime('now'))`).run(id, targetId, job.id);
  const attempt = createGenerationAttempt(db, job.id, { id: `attempt-${id}`, status: 'submitted' });
  return { job, attempt };
}

describe('chatgpt candidate auto finalize', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE image_generations (id INTEGER PRIMARY KEY AUTOINCREMENT, storyboard_id INTEGER, drama_id INTEGER, provider TEXT, prompt TEXT, image_url TEXT, local_path TEXT, width INTEGER, height INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, name TEXT, type TEXT, category TEXT, url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, image_gen_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER);
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, image_url TEXT, local_path TEXT, status TEXT, updated_at TEXT, deleted_at TEXT);
    `);
    db.exec(fs.readFileSync('migrations/24_external_web_generation.sql', 'utf8'));
    db.exec(fs.readFileSync('migrations/25_external_web_generation_hardening.sql', 'utf8'));
    db.exec(TASK_SCHEMA);
  });
  afterEach(() => db.close());

  it('auto-selects the first imported candidate and completes the task', async () => {
    const { attempt } = makeCharacterTask(db);
    const result = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    const task = db.prepare("SELECT status, image_generation_id FROM image_generation_tasks WHERE id='task-1'").get();
    assert.equal(task.status, 'completed');
    assert.equal(Number(task.image_generation_id), Number(result.imageGenerationId));
    const image = db.prepare('SELECT character_id FROM image_generations WHERE id=?').get(result.imageGenerationId);
    assert.equal(image.character_id, 5);
    const row = db.prepare("SELECT result.status, result.selected FROM external_generation_results result WHERE result.id=?").get(result.resultId);
    assert.equal(row.status, 'bound');
    assert.equal(row.selected, 1);
  });

  it('keeps later candidates switchable without stealing the primary', async () => {
    const { attempt } = makeCharacterTask(db);
    const first = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    const second = await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 1, sourceUrl: 'https://example.invalid/b.png', bytes: await pngBytes('#00ff00') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
    assert.equal(db.prepare('SELECT selected FROM external_generation_results WHERE id=?').get(first.resultId).selected, 1);
    assert.equal(db.prepare('SELECT selected, status FROM external_generation_results WHERE id=?').get(second.resultId).selected, 0);
    assert.equal(db.prepare('SELECT status FROM external_generation_results WHERE id=?').get(second.resultId).status, 'imported');
  });

  it('falls back to needs_review when the setting is off', async () => {
    db.prepare("INSERT INTO global_settings (key, value, updated_at) VALUES ('chatgpt_web_auto_select', 'false', datetime('now'))").run();
    const { attempt } = makeCharacterTask(db);
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
    assert.equal(db.prepare('SELECT character_id FROM image_generations ORDER BY id DESC LIMIT 1').get().character_id, null);
  });

  it('falls back to needs_review when the target is gone', async () => {
    const { attempt } = makeCharacterTask(db);
    db.prepare('DELETE FROM characters WHERE id=5').run();
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'needs_review');
  });

  it('routes a preparing task through submitted before completing', async () => {
    const { attempt } = makeCharacterTask(db);
    db.prepare("UPDATE image_generation_tasks SET status='preparing' WHERE id='task-1'").run();
    await importExternalResult(db, { attemptId: attempt.id, assistantMessageId: 'assistant-1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await pngBytes('#ff0000') });
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd backend-node; node --test test/externalGenerationImportFinalize.test.js`
Expected: FAIL — 首个用例任务仍是 `needs_review`、未绑定 `character_id`(功能不存在)。

- [ ] **Step 3: 实现定稿决策**

`backend-node/src/services/externalGenerationImportService.js` 顶部新增依赖,并在 `importExternalResult` 事务内把 `markUnifiedTaskNeedsReview(db, input.attemptId);` 替换为 `finalizeImportedResult(db, { attempt, resultId, imageGenerationId: ig.lastInsertRowid });`:

```js
const settingsService = require('./settingsService');
const targets = require('./imageGenerationTargetService');
const tasksService = require('./imageGenerationTaskService');

function autoSelectEnabled(db) {
  return settingsService.getGlobalSetting(db, 'chatgpt_web_auto_select', true) !== false;
}

function finalizeImportedResult(db, { attempt, resultId, imageGenerationId }) {
  const taskId = attempt.image_generation_task_id;
  if (!taskId) return;
  const task = db.prepare('SELECT * FROM image_generation_tasks WHERE id=?').get(taskId);
  if (!task || !['preparing', 'submitted', 'generating', 'needs_review'].includes(task.status)) return;
  const prior = db.prepare(`SELECT COUNT(*) AS n FROM external_generation_results r
    JOIN external_generation_attempts a ON a.id = r.attempt_id
    WHERE a.job_id = ? AND r.id != ? AND r.status IN ('imported','bound')`).get(attempt.job_id, resultId).n;
  if (!autoSelectEnabled(db) || prior > 0) { markUnifiedTaskNeedsReview(db, attempt.id); return; }
  try { targets.resolveTarget(db, task); } catch (_) { markUnifiedTaskNeedsReview(db, attempt.id); return; }
  if (task.status === 'preparing') tasksService.transitionTask(db, task.id, 'submitted');
  targets.bindResult(db, task, imageGenerationId);
  db.prepare("UPDATE external_generation_results SET selected=1, status='bound', updated_at=? WHERE id=?")
    .run(new Date().toISOString(), resultId);
  tasksService.transitionTask(db, task.id, 'completed', { imageGenerationId });
}
```

- [ ] **Step 4: 跑绿**

Run: `cd backend-node; node --test test/externalGenerationImportFinalize.test.js`
Expected: PASS(5/5)。

- [ ] **Step 5: 回归既有导入/外部生成测试**

Run: `cd backend-node; node --test test/externalGenerationHardening.test.js test/externalGenerationRecovery.test.js test/externalGenerationService.test.js`
Expected: 全部 PASS(开关默认开会让部分旧断言变化——凡断言 needs_review 的旧用例,先在该用例 `beforeEach`/用例内显式 `setGlobalSetting(db,'chatgpt_web_auto_select',false)` 再确认通过;逐个修改并在提交信息里注明)。

- [ ] **Step 6: 提交**

```bash
git add backend-node/src/services/externalGenerationImportService.js backend-node/test/externalGenerationImportFinalize.test.js
git commit -m "feat: auto-finalize first captured chatgpt candidate on import"
```

### Task 2: image_updated_at 列与绑定写入

**Files:**
- Modify: `backend-node/src/db/migrate.js`(storyboards/characters/scenes/props 四处 ensureColumns)
- Modify: `backend-node/src/services/imageGenerationTargetService.js`
- Test: `backend-node/test/imageGenerationTargetService.test.js`(追加用例)

**Interfaces:**
- Consumes: `ensureColumns(database, table, columns)`。
- Produces: 四表新增 `image_updated_at`(TEXT);`bindAsset` / `bindResult` 分镜分支写入该列(取绑定时刻 ISO 时间)。

- [ ] **Step 1: 写失败测试**

在 `backend-node/test/imageGenerationTargetService.test.js` 末尾追加(沿用该文件现有 db 夹具;若夹具未含 `image_updated_at` 列,在夹具建表 SQL 中加列):

```js
it('records image_updated_at on the target when binding a result', () => {
  // 在现有夹具上:创建 character 目标 + image_generations 行后
  const image = db.prepare(`INSERT INTO image_generations (drama_id, provider, image_url, local_path, status, created_at, updated_at)
    VALUES (7, 'external:chatgpt-web', 'u', 'p', 'completed', datetime('now'), datetime('now'))`).run();
  const task = { drama_id: 7, target_type: 'character', target_id: <现有夹具角色id> };
  targets.bindResult(db, task, image.lastInsertRowid);
  const row = db.prepare('SELECT image_updated_at FROM characters WHERE id=?').get(task.target_id);
  assert.ok(row.image_updated_at); // 非空即可,时间取绑定时刻
});
```

- [ ] **Step 2: 跑红**

Run: `cd backend-node; node --test test/imageGenerationTargetService.test.js`
Expected: FAIL — `image_updated_at` 为空(或列不存在)。

- [ ] **Step 3: 实现**

1. `migrate.js`:在 `ensureColumns(database, 'storyboards'|'characters'|'scenes'|'props', [...])` 四处数组各追加 `{ name: 'image_updated_at', type: 'TEXT' }`。
2. `imageGenerationTargetService.js` 的 `bindAsset`:

```js
function bindAsset(db, table, targetId, image) {
  const current = db.prepare(`SELECT image_url, local_path, extra_images FROM ${table} WHERE id=?`).get(targetId);
  const history = appendHistory(current);
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${table} SET image_url=?, local_path=?, extra_images=?, image_updated_at=?, updated_at=? WHERE id=?`)
    .run(image.image_url, image.local_path, history, now, now, targetId);
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(targetId);
}
```

3. `bindResult` 分镜分支(原 `UPDATE storyboards SET image_url=?, local_path=?, status='generated', updated_at=?`)同样加 `image_updated_at=?` 传同一 `now`。

- [ ] **Step 4: 跑绿 + 全量后端回归**

Run: `cd backend-node; node --test test/imageGenerationTargetService.test.js` → PASS;
Run: `cd backend-node; node --test test/*.test.js` → 全 PASS(迁移自动补列,旧库无破坏)。

- [ ] **Step 5: 提交**

```bash
git add backend-node/src/db/migrate.js backend-node/src/services/imageGenerationTargetService.js backend-node/test/imageGenerationTargetService.test.js
git commit -m "feat: record image_updated_at when binding generation results"
```

### Task 3: 批量"采用首选"服务与路由

**Files:**
- Create: `backend-node/src/services/imageGenerationResultSelection.js`
- Modify: `backend-node/src/routes/imageGenerationTasks.js`(select-result 改为调用服务;新增批量路由)
- Test: `backend-node/test/imageGenerationResultSelection.test.js`(新建)

**Interfaces:**
- Consumes: `targets.bindResult`、`tasks.transitionTask`、`queue.refreshBatch`。
- Produces: `selectTaskResult(db, task, result)` → `{ task, target, result }`;`batchSelectFirstResults(db, dramaId)` → `[{ task_id, status: 'selected'|'skipped'|'failed', ... }]`。路由 `POST /dramas/:dramaId/image-generation-tasks/review/batch-select-first`。

- [ ] **Step 1: 写失败测试**

```js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const sharp = require('sharp');
const { createExternalJob, createGenerationAttempt } = require('../src/services/externalGenerationService');
const { importExternalResult } = require('../src/services/externalGenerationImportService');
const { batchSelectFirstResults } = require('../src/services/imageGenerationResultSelection');

// 夹具与 externalGenerationImportFinalize.test.js 相同(复制 TASK_SCHEMA 与 beforeEach),另外:
// character 目标 id=5、drama_id=7;第二个任务 task-2 无任何候选。

describe('batch select first result', () => {
  let db;
  beforeEach(/* 同上夹具 */);
  afterEach(() => db.close());

  it('completes needs_review tasks that have candidates and skips those without', async () => {
    const mk = (id, targetId) => {
      const job = createExternalJob(db, { id: `job-${id}`, dramaId: 7, storyboardId: null, assetType: 'character', site: 'chatgpt', promptSnapshot: 'p', imageGenerationTaskId: id });
      db.prepare(`INSERT INTO image_generation_tasks (id, drama_id, target_type, target_id, generation_channel, status, external_job_id, created_at, updated_at)
        VALUES (?, 7, 'character', ?, 'chatgpt_web', 'submitted', ?, datetime('now'), datetime('now'))`).run(id, targetId, job.id);
      return createGenerationAttempt(db, job.id, { id: `attempt-${id}`, status: 'submitted' });
    };
    const attempt1 = mk('task-1', 5);
    db.prepare("INSERT INTO characters (id, drama_id, name, deleted_at) VALUES (5, 7, 'A', NULL), (6, 7, 'B', NULL)").run();
    const attempt2 = mk('task-2', 6);
    await importExternalResult(db, { attemptId: attempt1.id, assistantMessageId: 'a1', resultIndex: 0, sourceUrl: 'https://example.invalid/a.png', bytes: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer() });
    db.prepare("UPDATE image_generation_tasks SET status='needs_review' WHERE id IN ('task-1','task-2')");
    db.prepare("UPDATE external_generation_results SET status='imported', selected=0");

    const report = batchSelectFirstResults(db, 7);
    assert.deepEqual(report.map((r) => [r.task_id, r.status]), [['task-1', 'selected'], ['task-2', 'skipped']]);
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-1'").get().status, 'completed');
    assert.equal(db.prepare("SELECT status FROM image_generation_tasks WHERE id='task-2'").get().status, 'needs_review');
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd backend-node; node --test test/imageGenerationResultSelection.test.js`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现服务与路由**

新建 `backend-node/src/services/imageGenerationResultSelection.js`:

```js
const targets = require('./imageGenerationTargetService');
const tasks = require('./imageGenerationTaskService');
const queue = require('./imageGenerationQueueService');

function selectTaskResult(db, task, result) {
  if (!task) throw new Error('Image generation task not found');
  if (!result || result.image_generation_task_id !== task.id) throw new Error('External result does not belong to this image generation task');
  const target = targets.bindResult(db, task, result.image_generation_id);
  const now = new Date().toISOString();
  db.prepare(`UPDATE external_generation_results SET selected=0, updated_at=? WHERE attempt_id IN
    (SELECT id FROM external_generation_attempts WHERE job_id=?)`).run(now, task.external_job_id);
  db.prepare("UPDATE external_generation_results SET selected=1, status='bound', updated_at=? WHERE id=?").run(now, result.id);
  const completed = tasks.transitionTask(db, task.id, 'completed', { imageGenerationId: result.image_generation_id });
  if (task.batch_id) queue.refreshBatch(db, task.batch_id);
  return { task: completed, target, result: { ...result, selected: 1, status: 'bound' } };
}

function batchSelectFirstResults(db, dramaId) {
  const rows = db.prepare(`SELECT * FROM image_generation_tasks
    WHERE drama_id=? AND generation_channel='chatgpt_web' AND status='needs_review'
    ORDER BY created_at`).all(Number(dramaId));
  return rows.map((task) => {
    const result = db.prepare(`SELECT r.*, ? AS image_generation_task_id FROM external_generation_results r
      JOIN external_generation_attempts a ON a.id = r.attempt_id
      JOIN external_generation_jobs j ON j.id = a.job_id
      WHERE j.image_generation_task_id = ? AND r.status IN ('imported','bound')
      ORDER BY a.sequence, r.result_index LIMIT 1`).get(task.id, task.external_job_id);
    if (!result) return { task_id: task.id, status: 'skipped', reason: 'no_candidates' };
    try {
      const selected = selectTaskResult(db, task, result);
      return { task_id: task.id, status: 'selected', image_generation_id: result.image_generation_id, target: selected.target };
    } catch (error) {
      return { task_id: task.id, status: 'failed', reason: error.message };
    }
  });
}

module.exports = { selectTaskResult, batchSelectFirstResults };
```

`routes/imageGenerationTasks.js`:`select-result` 路由(190-207 行)整体改为调用 `selection.selectTaskResult(db, task, result)`(行为不变);新增路由:

```js
const selection = require('../services/imageGenerationResultSelection');
router.post('/dramas/:dramaId/image-generation-tasks/review/batch-select-first', (req, res) => handle(res, () => selection.batchSelectFirstResults(db, req.params.dramaId)));
```

- [ ] **Step 4: 跑绿 + 路由回归**

Run: `cd backend-node; node --test test/imageGenerationResultSelection.test.js test/imageGenerationTaskRoutes.test.js`
Expected: PASS(select-result 既有断言不回归)。

- [ ] **Step 5: 提交**

```bash
git add backend-node/src/services/imageGenerationResultSelection.js backend-node/src/routes/imageGenerationTasks.js backend-node/test/imageGenerationResultSelection.test.js
git commit -m "feat: batch select first candidate for needs_review tasks"
```

### Task 4: 设置项暴露(chatgpt_web_auto_select)

**Files:**
- Modify: `backend-node/src/routes/settings.js`
- Test: `backend-node/test/settingsImageGeneration.test.js`(新建)

**Interfaces:**
- Produces: `GET /settings/image-generation` 响应 `chatgpt_web` 内新增 `auto_select`(boolean);`PUT` 接受 `chatgpt_web.auto_select`。

- [ ] **Step 1: 写失败测试**

```js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const settingsRoutes = require('../src/routes/settings');

function capture(handler, req) {
  return new Promise((resolve, reject) => {
    handler(req || {}, { success: (res, data) => resolve(data), badRequest: (res, error) => reject(new Error(error)) });
  });
}

describe('image generation settings expose auto select', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); db.exec('CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)'); });
  afterEach(() => db.close());

  it('defaults auto_select to true and round-trips the value', async () => {
    const routes = settingsRoutes(db, {}, console);
    const first = await capture(routes.getImageGenerationSettings);
    assert.equal(first.chatgpt_web.auto_select, true);
    await capture(routes.updateImageGenerationSettings, { body: { chatgpt_web: { auto_select: false } } });
    const second = await capture(routes.getImageGenerationSettings);
    assert.equal(second.chatgpt_web.auto_select, false);
  });
});
```

- [ ] **Step 2: 跑红** — `cd backend-node; node --test test/settingsImageGeneration.test.js` → FAIL(`auto_select` 为 undefined)。

- [ ] **Step 3: 实现** — `settings.js` 的 `getImageGenerationSettings` 中 `chatgpt_web` 对象加 `auto_select: settingsService.getGlobalSetting(db, 'chatgpt_web_auto_select', true) !== false`;`updateImageGenerationSettings` 加 `if (chatgpt.auto_select !== undefined) settingsService.setGlobalSetting(db, 'chatgpt_web_auto_select', chatgpt.auto_select === true);`。

- [ ] **Step 4: 跑绿** — 同 Step 2 命令 → PASS。

- [ ] **Step 5: 提交**

```bash
git add backend-node/src/routes/settings.js backend-node/test/settingsImageGeneration.test.js
git commit -m "feat: expose chatgpt auto select setting"
```

### Task 5: 前端通知/开关/批量恢复

**Files:**
- Modify: `frontweb/src/utils/imageGenerationQueueDriver.js`(watch 发出 completed 事件)
- Modify: `frontweb/src/stores/imageGenerationStore.js`(completed 通知、autoSelect 状态、batchSelectFirst)
- Modify: `frontweb/src/api/imageGenerationTasks.js`(batchSelectFirst 封装)
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationTaskPill.vue`(全部采用首选按钮)
- Modify: `frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue`(自动采用开关)
- Test: `frontweb/test/imageGenerationQueueDriver.test.js`、`frontweb/test/imageGenerationQueueDriver.test.js` 内 store 源码断言、新建 `frontweb/test/imageGenerationAutoSelectUi.test.js`

**Interfaces:**
- Consumes: `GET/PUT /settings/image-generation`(ai.js 已有 `getImageGenerationSettings()/updateImageGenerationSettings(chatgptWeb)`,响应 `chatgpt_web.auto_select`)。
- Produces: store 新增 `autoSelect`(ref)、`loadAutoSelect()`、`setAutoSelect(value)`、`batchSelectFirst(dramaId)`;driver 新事件 `{ type: 'completed', taskId, task }`。

- [ ] **Step 1: 写失败测试**

`frontweb/test/imageGenerationQueueDriver.test.js` 追加行为测试:

```js
test('emits completed when the watched task auto-finalizes', async () => {
  const task = { id: 'tc', status: 'submitted' }
  let poll = 0
  const { driver, events } = makeDriver({
    claimNext: async () => ({ claimed: true, task }),
    prepareSend: async () => ({ task, attempt: { id: 'ac' }, already_submitted: false }),
    getTask: async () => (poll++ === 0 ? { id: 'tc', status: 'generating' } : { id: 'tc', status: 'completed' }),
    acknowledge: async () => ({ id: 'tc', status: 'generating' }),
  })
  await driver.tick()
  driver.stop()
  assert.deepEqual(events.map((e) => e.type), ['claimed', 'submitted', 'completed', 'terminal'])
})
```

新建 `frontweb/test/imageGenerationAutoSelectUi.test.js`(源码断言,沿用仓库惯例):

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('store wires auto select state, completion toast and batch recovery', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(source, /autoSelect/)
  assert.match(source, /getImageGenerationSettings\(/)
  assert.match(source, /updateImageGenerationSettings\(/)
  assert.match(source, /chatgpt_web_auto_select|auto_select/)
  assert.match(source, /event\.type === 'completed'/)
  assert.match(source, /已生成并挂载/)
  assert.match(source, /batchSelectFirst/)
  const api = fs.readFileSync(path.join(root, 'src/api/imageGenerationTasks.js'), 'utf8')
  assert.match(api, /batch-select-first/)
})

test('pill and drawer expose batch recovery and the auto select toggle', () => {
  const pill = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationTaskPill.vue'), 'utf8')
  assert.match(pill, /全部采用首选/)
  const drawer = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationDrawer.vue'), 'utf8')
  assert.match(drawer, /自动采用首个候选/)
})
```

- [ ] **Step 2: 跑红** — `cd frontweb; node --test test/imageGenerationQueueDriver.test.js test/imageGenerationAutoSelectUi.test.js` → 3 个新用例 FAIL。

- [ ] **Step 3: 实现**

1. driver `watch()` 状态变化分支加 `if (task.status === 'completed') onEvent({ type: 'completed', taskId, task })`。
2. `api/imageGenerationTasks.js` 增加 `batchSelectFirst(dramaId) { return request.post(\`/dramas/\${encodeURIComponent(dramaId)}/image-generation-tasks/review/batch-select-first\`) },`。
3. store:`const autoSelect = ref(true)`;`loadAutoSelect()` 调 `aiAPI.getImageGenerationSettings()` 取 `chatgpt_web.auto_select`(import 处加 `import { aiAPI } from '@/api/ai'`,若导出名不同以实际为准);`setAutoSelect(value)` 调 `updateImageGenerationSettings({ auto_select: value })` 并更新 ref;`batchSelectFirst(dramaId)` 调 API 后 `loadSummary(dramaId, { reattach: false })` 返回报告;`notifyQueueEvent` 增加 `else if (event.type === 'completed')` 分支:`ElNotification({ title: '生图完成', message: '已生成并挂载,点击查看', type: 'success', onClick: () => { openTaskById(event.taskId) } })`;`needs_review` 分支 message 改为 `count > 1 ? \`\${count} 张候选已挂载,请选择主图\` : '候选已导入,请选择'`。把这些新成员加入 store 返回的导出对象(`autoSelect, loadAutoSelect, setAutoSelect, batchSelectFirst`)。
4. Pill:`needs_review > 0` 时渲染 `<el-button size="small" type="warning" plain :loading="recovering" @click="recoverAll">全部采用首选</el-button>`;`recovering` ref;`recoverAll` 调 `store.batchSelectFirst(props.dramaId)` 后 `refresh()`。
5. Drawer:模板尾部加开关行 `<div class="auto-select-row"><el-switch :model-value="autoSelect" @change="onAutoSelect" /><span>自动采用首个候选</span></div>`;`import { useImageGenerationStore } from '@/stores/imageGenerationStore'`,`onMounted` 调 `store.loadAutoSelect()`,`onAutoSelect(v)` 调 `store.setAutoSelect(v)`。

- [ ] **Step 4: 跑绿 + 全量前端回归**

Run: `cd frontweb; node --test test/*.test.js` → 全 PASS。

- [ ] **Step 5: 提交**

```bash
git add frontweb/src/utils/imageGenerationQueueDriver.js frontweb/src/stores/imageGenerationStore.js frontweb/src/api/imageGenerationTasks.js frontweb/src/components/imageGeneration/ImageGenerationTaskPill.vue frontweb/src/components/imageGeneration/ImageGenerationDrawer.vue frontweb/test/imageGenerationQueueDriver.test.js frontweb/test/imageGenerationAutoSelectUi.test.js
git commit -m "feat: auto adopt completion toast, drawer toggle and batch recovery"
```

### Task 6: 卡片图片更新时间展示

**Files:**
- Create: `frontweb/src/components/ImageUpdatedAt.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`(分镜卡两处 + library-item 三处以上)
- Test: `frontweb/test/imageUpdatedAt.test.js`(新建)

**Interfaces:**
- Consumes: 目标行新字段 `image_updated_at`(后端 SELECT * 自动带出)。
- Produces: `<ImageUpdatedAt :value="item.image_updated_at" />` 组件,格式 `MM-DD HH:mm`,空值不渲染。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mount } from './helpers/mount.js'  // 若仓库无此 helper,改用源码断言+手写 format 抽取
```

> 仓库现有前端测试以源码断言为主;为保持一致,本任务测试写成源码断言:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('image updated at component renders formatted time and hides when empty', async () => {
  const source = fs.readFileSync(path.join(root, 'src/components/ImageUpdatedAt.vue'), 'utf8')
  assert.match(source, /image_updated_at|value/)
  assert.match(source, /padStart/)
  assert.match(source, /v-if/)
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.match(film, /ImageUpdatedAt/)
  assert.match(film, /image_updated_at/)
})
```

- [ ] **Step 2: 跑红** — `cd frontweb; node --test test/imageUpdatedAt.test.js` → FAIL。

- [ ] **Step 3: 实现**

1. 新建 `frontweb/src/components/ImageUpdatedAt.vue`:

```vue
<template>
  <div v-if="formatted" class="image-updated-at">图更新于 {{ formatted }}</div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ value: { type: String, default: '' } })
const formatted = computed(() => {
  if (!props.value) return ''
  const date = new Date(props.value)
  if (Number.isNaN(date.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
})
</script>

<style scoped>
.image-updated-at { font-size: 11px; color: #909399; line-height: 1.5; }
</style>
```

2. `FilmCreate.vue`:script 中 import 并注册组件;在以下位置图片节点后插入 `<ImageUpdatedAt :value="..." />`:
   - 分镜卡两处(约 1284 与 1377 行,`sb.image_url || sb.composed_image` 的 `<img>` 所在容器内)→ `:value="sb.image_updated_at"`;
   - `library-item-cover` 内 `<img ... :src="assetImageUrl(item)" />` 之后(charLibraryList、dramaAllCharList、propLibraryList 及场景对应列表,用 grep `library-item-cover` 定位全部出现处)→ `:value="item.image_updated_at"`。
   注意保持各列表卡片布局不破(时间行放封面图下方、`library-item-info` 之前或 info 内首行,以现有间距样式为准)。

- [ ] **Step 4: 跑绿 + 构建**

Run: `cd frontweb; node --test test/imageUpdatedAt.test.js` → PASS;`npm run build` → 成功。

- [ ] **Step 5: 提交**

```bash
git add frontweb/src/components/ImageUpdatedAt.vue frontweb/src/views/FilmCreate.vue frontweb/test/imageUpdatedAt.test.js
git commit -m "feat: show image updated time on drama asset cards"
```

### Task 7: 全量验证与进度文档

**Files:**
- Modify: `docs/superpowers/progress/2026-08-30-storyboard-generation-flow-progress.md`

- [ ] **Step 1: 全量回归**

Run: `cd backend-node; node --test test/*.test.js`;`cd frontweb; node --test test/*.test.js; npm run build`;`cd browser-extension; node --test test/*.test.js`(应零改动全绿)。
Expected: 全 PASS + 构建成功,记录数量。

- [ ] **Step 2: 只读冒烟**

后端 5679 运行时:`GET /settings/image-generation` 确认返回 `auto_select: true`;`GET /health` 正常。不主动触发真实生图。

- [ ] **Step 3: 更新进度文档**

在 progress 文档追加一条:实施提交列表、测试/构建证据、以及"画布视图(DramaCanvas)卡片的时间展示留作后续"的边界说明。

- [ ] **Step 4: 终检**

Run: `git diff --check; git status --short` → 仅预期文件变更;确认后提交文档:

```bash
git add docs/superpowers/progress/2026-08-30-storyboard-generation-flow-progress.md
git commit -m "docs: record candidate auto binding rollout"
```
