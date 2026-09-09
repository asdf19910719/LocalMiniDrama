# Production Studio V2.1 Phase 1 Studio Shell and Gates Implementation Plan

> **状态：不可执行，待重写。** 2026-09-08 已确认直接替换旧实现、一次性迁移现有本地数据，并明确禁止 feature flag、旧页面回退、运行期双写和长期 API 适配。本计划的“双轨 Studio”目标与权威规格冲突；仅可作为历史任务拆分参考，不能逐项照此执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可双轨运行的 Production Studio 四阶段壳、Script Gate、Look/角色/场景/道具批准状态、影响/阻塞面板和任务抽屉，解决“选择不等于确认、上游变化不可见、所有功能堆在一页”三个首要问题。

**Architecture:** 后端新增最小的阶段、剧本修订、Look 修订和资产批准表，现有 `episodes`、风格目录、角色/场景/道具及生成表继续作为兼容事实源。前端新增独立 `productionStudio` 视图/组件/store，通过 `/api/v2` 聚合 API 读取；旧 `FilmCreate` 保留并由 build-time feature flag 控制默认入口，避免一次性迁移。

**Tech Stack:** Node.js 22.22.3、Express 4、SQLite/better-sqlite3、Vue 3、Pinia、Vue Router、Element Plus、Node `node:test`。

**Spec:** 架构母稿 `docs/superpowers/specs/2026-09-05-production-studio-v2-design.md`；P0 权威附件 `docs/superpowers/specs/2026-09-08-production-studio-v2.1-state-gate-truth-table.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-scope-version-concurrency-invalidation.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md`、`docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`；页面规格 `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`；前置计划 `docs/superpowers/plans/2026-09-08-production-studio-v2.1-phase-0.md`

## Global Constraints

- Studio Shell 不放置“导入外部 JSON”主按钮；完整剧集制作包继续从项目详情/剧集列表进入，已导入剧集在 Studio 只显示只读“外部来源”。
- 目标集仅允许新建或空白；非空剧集保持 `TARGET_NOT_BLANK` 拒绝语义。Phase 1 不实现 JSON 合并、覆盖、追加或媒体自动生成。

- 仅在 Phase 0 全部测试和构建通过后执行本计划。
- 执行前使用 `superpowers:using-git-worktrees` 建立隔离 worktree；不得覆盖当前工作区的未提交改动。
- 所有 Node 命令固定使用 Node.js 22.22.3；后端原生模块必须与该 ABI 一致。
- 保持纯 JavaScript，不引入 TypeScript、状态机库、编辑器框架或第二套 UI 框架。
- 新主路由固定为 `/projects/:projectId/episodes/:episodeId/:stage`，其中 `stage = script | assets | storyboard | cut`。
- 标准模式默认；高级能力不得建立第二套数据和写入路径。
- 全部新 UI 文案区分“场次”和“场景资产”；Storyboard/Cut 占位页不得继续把 `scenes` 表对象称为剧本场次。
- 方案 B 的 `timed_segments`、多场景绑定和时长映射属于 Phase 3；Phase 1 不提前创建半套表，也不得把 15 秒写成默认分镜长度。
- 风格状态只展示 PromptStyleGate 的提交前结果；不设计或占位结果级 StyleConformanceGate、图片视觉评分或视频抽帧评分。
- 阶段状态只允许 `not_started/in_progress/ready_for_review/approved/stale`；`blocked` 是 Gate 结果，`queued/running/waiting_external/succeeded/failed/cancelled/unknown` 是任务状态，UI 必须分层显示。
- 自动采用和自动批准默认关闭；技术检测只能标记 `technically_eligible`，默认批准者是 `local-user`，兼容迁移批准者可以是 `system`。
- Look 解析顺序固定为 `Shot 特殊覆盖 > StoryScene 场次 Look > Project Look`，V2.1 不创建 Episode Look；本阶段只落 Project Look 版本，但 API shape 必须可容纳后续两层。
- 角色、角色状态、场景资产、道具是项目级实体；`production_asset_versions` 以项目和实体为作用域，剧集 readiness 只计算该集实际引用的准确版本。
- 未批准上游允许浏览下游，但禁止高资源批量生成、外部计费任务、Picture Lock 和最终交付。
- 本地编辑和本地零费用预览不被远端 Provider 状态整体禁用。
- 旧 `/film/:id` 与现有 API 保持兼容；feature flag 默认关闭，直接访问新路由仍可用于验收。
- 已确认 revision 不可原地覆盖；任何批准、重新打开和影响写入都要求 `expected_revision`。
- 保存未批准草稿不令现有批准链 stale；只有新上游 revision 获得批准或 adopted 指针变化才传播 stale。“稍后刷新”只是不立即执行下游重算，不能跳过 stale 记录。
- 所有 mutation 使用 `expected_revision`、`expected_version + expected_fingerprint` 或等价前置条件；不匹配统一返回 HTTP 409，后台任务不得覆盖 adopted/approved 指针。
- 只有所有功能实现并完成全量验证后才能更新 `CHANGELOG.md`。

---

## File Structure

### 后端新建

- `backend-node/migrations/36_production_studio_phase1.sql`
- `backend-node/src/services/productionStageService.js`
- `backend-node/src/services/scriptRevisionService.js`
- `backend-node/src/services/productionImpactService.js`
- `backend-node/src/services/productionAssetApprovalService.js`
- `backend-node/src/services/gateWaiverService.js`
- `backend-node/src/routes/v2/episodes.js`
- `backend-node/test/productionStudioMigration.test.js`
- `backend-node/test/productionStageService.test.js`
- `backend-node/test/scriptRevisionService.test.js`
- `backend-node/test/productionStageRoutes.test.js`
- `backend-node/test/productionAssetApproval.test.js`
- `backend-node/test/gateWaiverService.test.js`

### 后端修改

- `backend-node/src/db/migrate.js`：仅当自动 SQL migration 未覆盖新增结构校验时增加 `ensureColumns` 兼容；不重复建表。
- `backend-node/src/routes/v2/index.js`：注册 episode/stage/approval 路由。

### 前端新建

- `frontweb/src/utils/apiClient.js`
- `frontweb/src/utils/requestV2.js`
- `frontweb/src/api/productionStudio.js`
- `frontweb/src/stores/productionStudio.js`
- `frontweb/src/utils/productionStages.js`
- `frontweb/src/views/productionStudio/ProductionStudio.vue`
- `frontweb/src/views/productionStudio/ScriptStage.vue`
- `frontweb/src/views/productionStudio/AssetsStage.vue`
- `frontweb/src/views/productionStudio/StoryboardStagePlaceholder.vue`
- `frontweb/src/views/productionStudio/CutStagePlaceholder.vue`
- `frontweb/src/views/FilmEntry.vue`
- `frontweb/src/components/production/GlobalRail.vue`
- `frontweb/src/components/production/StudioHeader.vue`
- `frontweb/src/components/production/StageRail.vue`
- `frontweb/src/components/production/StageGatePanel.vue`
- `frontweb/src/components/production/DependencyImpactDialog.vue`
- `frontweb/src/components/production/TaskDrawer.vue`
- `frontweb/src/components/assets/AssetReadinessGrid.vue`
- `frontweb/src/components/look/LookApprovalCard.vue`
- `frontweb/test/productionStageRoutes.test.js`
- `frontweb/test/productionStudioStore.test.js`
- `frontweb/test/productionStudioShell.test.js`
- `frontweb/test/scriptStageGate.test.js`
- `frontweb/test/assetsStageApproval.test.js`
- `frontweb/test/filmEntryCompatibility.test.js`

### 前端修改

- `frontweb/src/utils/request.js`：改为使用共享 client factory，但 `/api/v1` 行为不变。
- `frontweb/src/router/index.js`：新增目标路由，旧 `/film/:id` 改由兼容入口承载。
- `frontweb/src/styles/theme.css`：只增加 `--studio-*` 语义令牌，不覆盖现有变量。

## Task 1: Phase 1 schema and migration compatibility

**Files:**

- Create: `backend-node/migrations/36_production_studio_phase1.sql`
- Create: `backend-node/test/productionStudioMigration.test.js`
- Modify: `backend-node/src/db/migrate.js` only if the migration test proves restart compatibility needs an ensure.

**Interfaces:**

- Produces tables: `production_stage_states`, `production_stage_events`, `episode_script_revisions`, `look_profiles`, `look_profile_versions`, `production_asset_versions`, `gate_waivers`.
- Existing tables remain readable and are not renamed or dropped.

- [ ] **Step 1: Write the failing migration test**

```js
test('phase 1 migration is idempotent and does not alter legacy episode data', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  db.prepare(`INSERT INTO dramas (id,title,style_id,created_at,updated_at)
    VALUES (1,'Demo','system:cinematic',?,?)`).run(now, now);
  db.prepare(`INSERT INTO episodes (id,drama_id,episode_number,title,script_content,status,created_at,updated_at)
    VALUES (10,1,1,'Episode 1','INT. HOTEL - NIGHT','draft',?,?)`).run(now, now);

  runMigrationsAndEnsure(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
  assert.ok(tables.includes('production_stage_states'));
  assert.ok(tables.includes('production_stage_events'));
  assert.ok(tables.includes('episode_script_revisions'));
  assert.ok(tables.includes('look_profile_versions'));
  assert.ok(tables.includes('production_asset_versions'));
  assert.ok(tables.includes('gate_waivers'));
  assert.equal(db.prepare('SELECT script_content FROM episodes WHERE id=10').pluck().get(), 'INT. HOTEL - NIGHT');
});
```

Also assert unique constraints reject duplicate `(episode_id, stage)` and duplicate `(episode_id, revision)`.

- [ ] **Step 2: Run and verify the missing-table failure**

```powershell
& $node22 --test test/productionStudioMigration.test.js
```

Expected: FAIL because the Phase 1 tables do not exist.

- [ ] **Step 3: Add the SQL migration**

Use this schema, preserving SQLite-compatible checks and indexes:

```sql
CREATE TABLE IF NOT EXISTS production_stage_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('script','assets','storyboard','cut')),
  content_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK(status IN ('not_started','in_progress','ready_for_review','approved','stale')),
  source_fingerprint TEXT NOT NULL DEFAULT '',
  blocker_json TEXT NOT NULL DEFAULT '[]',
  approved_revision INTEGER,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(episode_id, stage),
  FOREIGN KEY(episode_id) REFERENCES episodes(id),
  FOREIGN KEY(drama_id) REFERENCES dramas(id)
);

CREATE TABLE IF NOT EXISTS production_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_state_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('script','assets','storyboard','cut')),
  event_type TEXT NOT NULL CHECK(event_type IN (
    'started','submitted','approved','rejected','reopened','staled'
  )),
  from_status TEXT,
  to_status TEXT NOT NULL,
  content_revision INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(stage_state_id) REFERENCES production_stage_states(id),
  FOREIGN KEY(episode_id) REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS episode_script_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  parent_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  script_content TEXT NOT NULL DEFAULT '',
  source_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready_for_review','approved','superseded','stale')),
  change_summary_json TEXT NOT NULL DEFAULT '{}',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(episode_id, revision),
  FOREIGN KEY(episode_id) REFERENCES episodes(id),
  FOREIGN KEY(parent_id) REFERENCES episode_script_revisions(id)
);

CREATE TABLE IF NOT EXISTS look_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'project',
  scope_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  active_version_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(drama_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS look_profile_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  look_profile_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  parent_version_id INTEGER,
  definition_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready_for_review','approved','superseded','stale')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(look_profile_id, version)
);

CREATE TABLE IF NOT EXISTS production_asset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('character','scene','prop')),
  entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  parent_version_id INTEGER,
  snapshot_json TEXT NOT NULL,
  selected_artifact_json TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready_for_review','approved','superseded','stale')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(drama_id, entity_type, entity_id, version),
  FOREIGN KEY(drama_id) REFERENCES dramas(id)
);

CREATE TABLE IF NOT EXISTS gate_waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gate TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  owner_revision INTEGER NOT NULL,
  blocker_code TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_on_change INTEGER NOT NULL DEFAULT 1 CHECK(expires_on_change IN (0,1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
```

Add indexes for stage status, stage event history, latest script revision, active Look version, latest project asset version and active Gate waivers. Do not insert/backfill rows in SQL; on-demand projection in services can report exact validation errors and avoids inventing approvals.

- [ ] **Step 4: Run migration and existing package tests**

```powershell
& $node22 --test test/productionStudioMigration.test.js test/dramaPackageRoundtrip.test.js test/episodePackageMigration.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend-node/migrations/36_production_studio_phase1.sql backend-node/test/productionStudioMigration.test.js backend-node/src/db/migrate.js
git commit -m "feat: add production studio phase one schema"
```

Only include `migrate.js` if it changed.

## Task 2: Script revisions, stage transitions, blockers and impact

**Files:**

- Create: `backend-node/src/services/scriptRevisionService.js`
- Create: `backend-node/src/services/productionStageService.js`
- Create: `backend-node/src/services/productionImpactService.js`
- Create: `backend-node/src/services/gateWaiverService.js`
- Create: `backend-node/test/scriptRevisionService.test.js`
- Create: `backend-node/test/productionStageService.test.js`
- Create: `backend-node/test/gateWaiverService.test.js`

**Interfaces:**

- Produces: `ensureScriptDraft(db, episodeId)`.
- Produces: `saveScriptDraft(db, { episodeId, expectedRevision, title, scriptContent })`.
- Produces: `submitScriptForReview(db, { episodeId, expectedRevision })`.
- Produces: `approveStage(db, { episodeId, stage, expectedRevision, approvedBy })`.
- Produces: `reopenStage(db, { episodeId, stage, expectedRevision })`.
- Produces: `listStages(db, episodeId)` and `getImpact(db, { episodeId, fromRevision })`.
- Produces: `createGateWaiver(db, { gate, ownerType, ownerId, ownerRevision, blockerCode, expectedFingerprint, reason, createdBy })` and `revokeGateWaiver(db, { waiverId, expectedFingerprint, revokedBy })`.

- [ ] **Step 1: Write state-machine tests**

Cover these exact transitions and failures:

```js
assert.equal(ensureScriptDraft(db, 10).revision, 1);
assert.equal(ensureScriptDraft(db, 10).script_content, 'legacy text');

const saved = saveScriptDraft(db, {
  episodeId: 10, expectedRevision: 1, title: 'Episode 1', scriptContent: 'new text',
});
assert.equal(saved.revision, 1);
assert.equal(db.prepare('SELECT script_content FROM episodes WHERE id=10').pluck().get(), 'new text');

submitScriptForReview(db, { episodeId: 10, expectedRevision: 1 });
const approved = approveStage(db, {
  episodeId: 10, stage: 'script', expectedRevision: 1, approvedBy: 'local-user',
});
assert.equal(approved.status, 'approved');

assert.throws(() => saveScriptDraft(db, {
  episodeId: 10, expectedRevision: 1, scriptContent: 'stale client write',
}), error => error.code === 'REVISION_CONFLICT');
```

After approval, the next legitimate save creates revision 2 with `parent_id` pointing at revision 1 and never updates revision 1.

Also assert `production_stage_events` receives ordered `started → submitted → approved` rows with the matching revision, fingerprint and actor. A failed transition or 409 conflict must write no event.

- [ ] **Step 2: Write blocker and impact tests**

For an empty script, `submitScriptForReview` must throw `STAGE_BLOCKED` with blocker code `SCRIPT_EMPTY`; the persisted stage remains `in_progress`, and the API computes `gate.result = 'block'` instead of storing `status='blocked'`. For an approved script edited into revision 2, `getImpact` returns:

```js
{
  precision: 'stage',
  fromRevision: 1,
  toRevision: 2,
  affectedStages: ['assets', 'storyboard', 'cut'],
  affectedObjects: [],
  note: 'Shot Package 尚未启用，Phase 1 使用保守的阶段级影响范围',
}
```

This explicit `precision` prevents the UI from pretending it already has shot-level invalidation.

Assert save and submit of revision 2 do not mark downstream stages stale. Only approval of revision 2 writes `staled` events and changes affected approved stage states to `stale`; choosing “稍后刷新” suppresses immediate recompute tasks but does not suppress those state/event writes.

- [ ] **Step 3: Write Gate waiver tests**

Create a `waivable=true` blocker fixture and a non-waivable structural blocker. Assert reason is mandatory, `expectedFingerprint` must match, only waivable blocker codes may create a waiver, a waiver is appended rather than updating blocker state, and an input fingerprint change makes an `expires_on_change=1` waiver inactive. Revocation writes `revoked_at/revoked_by` without deleting the row.

- [ ] **Step 4: Run and verify missing-service failures**

```powershell
& $node22 --test test/scriptRevisionService.test.js test/productionStageService.test.js test/gateWaiverService.test.js
```

Expected: FAIL because the services do not exist.

- [ ] **Step 5: Implement transaction, event and fingerprint rules**

Use `sha256(JSON.stringify({ title: normalizedTitle, scriptContent: normalizedScript }))`. Normalize CRLF to LF and trim trailing whitespace per line; do not collapse meaningful blank lines.

All of these happen in one SQLite transaction:

- update/create script draft;
- mirror current draft into legacy `episodes.title/script_content`;
- update script stage revision/status/fingerprint;
- append a `production_stage_events` row for every successful transition;
- only when a new script revision is approved, mark downstream approved stages `stale`, append their `staled` events and retain every artifact.

`production_stage_states.blocker_json` is an optional last-evaluation cache only; Gate response remains computed truth and may disappear without a stage transition. Gate waiver creation/revocation uses the same transaction and 409 fingerprint precondition, never mutates object or stage status, and never permits structural/integrity/provider-capability blockers.

Use an error helper with stable `code`, `status` and `details`; route code must not parse message strings.

- [ ] **Step 6: Run focused tests**

```powershell
& $node22 --test test/scriptRevisionService.test.js test/productionStageService.test.js test/gateWaiverService.test.js test/dramaPackageRoundtrip.test.js
```

Expected: all PASS, legacy episode projection remains current.

- [ ] **Step 7: Commit**

```powershell
git add backend-node/src/services/scriptRevisionService.js backend-node/src/services/productionStageService.js backend-node/src/services/productionImpactService.js backend-node/src/services/gateWaiverService.js backend-node/test/scriptRevisionService.test.js backend-node/test/productionStageService.test.js backend-node/test/gateWaiverService.test.js
git commit -m "feat: add script revisions and production stage gates"
```

## Task 3: Stage and script V2 API

**Files:**

- Create: `backend-node/src/routes/v2/episodes.js`
- Create: `backend-node/test/productionStageRoutes.test.js`
- Modify: `backend-node/src/routes/v2/index.js`

**Interfaces:**

- Consumes Task 2 services.
- Produces:

```text
GET  /api/v2/episodes/:episodeId/stages
GET  /api/v2/episodes/:episodeId/stages/:stage
GET  /api/v2/episodes/:episodeId/script-revisions/current
PUT  /api/v2/episodes/:episodeId/script-revisions/current
POST /api/v2/episodes/:episodeId/stages/script/submit-review
POST /api/v2/episodes/:episodeId/stages/:stage/approve
POST /api/v2/episodes/:episodeId/stages/:stage/reopen
POST /api/v2/episodes/:episodeId/gate-waivers
POST /api/v2/episodes/:episodeId/gate-waivers/:waiverId/revoke
GET  /api/v2/episodes/:episodeId/impact?from_revision=1
```

- [ ] **Step 1: Write HTTP contract tests**

Use an Express server on port 0. Assert response envelope, exact 409 conflict behavior and no implicit approval:

```js
const save = await json('PUT', '/api/v2/episodes/10/script-revisions/current', {
  expected_revision: 1,
  title: 'Episode 1',
  script_content: 'changed',
});
assert.equal(save.status, 200);
assert.equal(save.body.data.status, 'draft');

const stale = await json('PUT', '/api/v2/episodes/10/script-revisions/current', {
  expected_revision: 0,
  script_content: 'stale',
});
assert.equal(stale.status, 409);
assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
```

Also cover invalid stage, unknown episode, empty script blocker, waiver create/revoke, and approval with `approved_by` omitted defaulting to `local-user`. Verify blockers remain a separate `gate` object and never overwrite the stage status.

- [ ] **Step 2: Run and verify route failure**

```powershell
& $node22 --test test/productionStageRoutes.test.js
```

Expected: FAIL/404 before route registration.

- [ ] **Step 3: Implement thin handlers**

Handlers only parse ids/body, call services and map known errors:

- 400 `BAD_REQUEST`, `INVALID_STAGE`;
- 404 `EPISODE_NOT_FOUND`;
- 409 `REVISION_CONFLICT`, `INVALID_STAGE_TRANSITION`;
- 422 `STAGE_BLOCKED` with blocker details.

Do not duplicate state transition logic in routes.

- [ ] **Step 4: Register exact routes before parameter catch-alls**

Mount the episode factory in `routes/v2/index.js`. Verify `/providers/capabilities` and `/storyboards/:id/preflight` from Phase 0 are unchanged.

- [ ] **Step 5: Run the V2 route slice**

```powershell
& $node22 --test test/productionStageRoutes.test.js test/productionV2Routes.test.js test/productionPreflightService.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend-node/src/routes/v2/episodes.js backend-node/src/routes/v2/index.js backend-node/test/productionStageRoutes.test.js
git commit -m "feat: expose production stage and script revision api"
```

## Task 4: Look and asset approval projection

**Files:**

- Create: `backend-node/src/services/productionAssetApprovalService.js`
- Create: `backend-node/test/productionAssetApproval.test.js`
- Modify: `backend-node/src/routes/v2/episodes.js`
- Modify: `backend-node/test/productionStageRoutes.test.js`

**Interfaces:**

- Produces: `getEpisodeAssetReadiness(db, episodeId)`.
- Produces: `submitAssetForReview(db, { episodeId, entityType, entityId, expectedVersion, expectedFingerprint })`.
- Produces: `approveAssetVersion(db, { episodeId, entityType, entityId, expectedVersion, expectedFingerprint, approvedBy })`.
- Produces: `submitLookForReview(db, { episodeId, expectedVersion, expectedFingerprint })` and `approveLookVersion(...)`.

- [ ] **Step 1: Write projection tests against legacy rows**

Create one project style, two episode characters, one scene and one prop. On first read, assert no item is magically approved:

```js
const readiness = getEpisodeAssetReadiness(db, 10);
assert.equal(readiness.look.status, 'draft');
assert.equal(readiness.characters.total, 2);
assert.equal(readiness.characters.approved, 0);
assert.equal(readiness.blockers.length, 4);
```

After approving only the Look and all assets referenced by current storyboards, assert `ready_for_stage_approval` is true. Unused project-library assets must not block the episode.

- [ ] **Step 2: Test fingerprinted version behavior**

```js
const sourceFingerprintV1 = getEpisodeAssetReadiness(db, 10)
  .characters.items.find(item => item.entity_id === 7).source_fingerprint;
const v1 = submitAssetForReview(db, {
  episodeId: 10, entityType: 'character', entityId: 7,
  expectedVersion: 0, expectedFingerprint: sourceFingerprintV1,
});
approveAssetVersion(db, {
  episodeId: 10, entityType: 'character', entityId: 7,
  expectedVersion: 1, expectedFingerprint: v1.fingerprint, approvedBy: 'local-user',
});
db.prepare("UPDATE characters SET appearance='new coat' WHERE id=7").run();
const sourceFingerprintV2 = getEpisodeAssetReadiness(db, 10)
  .characters.items.find(item => item.entity_id === 7).source_fingerprint;
const v2 = submitAssetForReview(db, {
  episodeId: 10, entityType: 'character', entityId: 7,
  expectedVersion: 1, expectedFingerprint: sourceFingerprintV2,
});
assert.equal(v2.version, 2);
assert.equal(v2.parent_version_id, v1.id);
assert.equal(getEpisodeAssetReadiness(db, 10).characters.stale, 1);
```

Create episode 11 in the same project and reference character 7 there. Assert both episodes resolve the same approved `production_asset_versions.id`. Create an identically named character in another project and assert it cannot be submitted through episode 10; project ownership, not name or episode-local duplication, defines identity.

- [ ] **Step 3: Run and verify the missing-service failure**

```powershell
& $node22 --test test/productionAssetApproval.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement snapshots without duplicating source entities**

Look `definition_json` comes from canonical `styleRegistryService` fields and current `style_id`. Asset `snapshot_json` uses stable business fields:

- character: name, appearance/description, prompt, stage/variant selection, image_url/local_path;
- scene: name/location, description, prompt, time/state, image_url/local_path;
- prop: name/type, description, prompt/negative prompt, image_url/local_path.

The version row is an immutable project-level approval snapshot, not a replacement for source entity editing. Resolve `drama_id` through the episode, reject entities owned by another project, and let every episode/StoryScene/Shot reference the exact same version id. If the fingerprint matches latest version, return it instead of adding duplicates. `getEpisodeAssetReadiness` computes only the current episode's referenced version set; unused project-library assets do not block it.

- [ ] **Step 5: Add routes and route tests**

```text
GET  /api/v2/episodes/:episodeId/assets/readiness
POST /api/v2/episodes/:episodeId/look/submit-review
POST /api/v2/episodes/:episodeId/look/approve
POST /api/v2/episodes/:episodeId/assets/:entityType/:entityId/submit-review
POST /api/v2/episodes/:episodeId/assets/:entityType/:entityId/approve
```

All mutation bodies require `expected_version` and `expected_fingerprint`; approval defaults `approved_by` to `local-user`. Invalid entity types return 400, cross-project assets return 404, version/fingerprint conflicts return 409 and return the current safe-refresh snapshot.

- [ ] **Step 6: Run focused and existing asset tests**

```powershell
& $node22 --test test/productionAssetApproval.test.js test/productionStageRoutes.test.js test/dramaProjectStyle.test.js test/characterVariantsService.test.js test/sceneRoutes.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add backend-node/src/services/productionAssetApprovalService.js backend-node/src/routes/v2/episodes.js backend-node/test/productionAssetApproval.test.js backend-node/test/productionStageRoutes.test.js
git commit -m "feat: add look and production asset approvals"
```

## Task 5: V2 API client, store, routes and Studio Shell

**Files:**

- Create: `frontweb/src/utils/apiClient.js`
- Create: `frontweb/src/utils/requestV2.js`
- Create: `frontweb/src/api/productionStudio.js`
- Create: `frontweb/src/stores/productionStudio.js`
- Create: `frontweb/src/utils/productionStages.js`
- Create: `frontweb/src/views/productionStudio/ProductionStudio.vue`
- Create: `frontweb/src/views/productionStudio/StoryboardStagePlaceholder.vue`
- Create: `frontweb/src/views/productionStudio/CutStagePlaceholder.vue`
- Create: `frontweb/src/components/production/GlobalRail.vue`
- Create: `frontweb/src/components/production/StudioHeader.vue`
- Create: `frontweb/src/components/production/StageRail.vue`
- Create: `frontweb/src/components/production/StageGatePanel.vue`
- Create: `frontweb/test/productionStageRoutes.test.js`
- Create: `frontweb/test/productionStudioStore.test.js`
- Create: `frontweb/test/productionStudioShell.test.js`
- Modify: `frontweb/src/utils/request.js`
- Modify: `frontweb/src/router/index.js`
- Modify: `frontweb/src/styles/theme.css`

**Interfaces:**

- Produces `STAGES = ['script','assets','storyboard','cut']` and helpers `isProductionStage`, `stageLabel`, `normalizeStage`, `productionStagePath`, `productionAdvancedPath`.
- Produces Pinia store actions `loadContext`, `loadStages`, `saveScript`, `submitStage`, `approveStage`, `reopenStage`, `loadAssetReadiness`; store keeps `stageState`、`gateEvaluation` and `taskSummary` as separate fields.
- Produces shell slots/child routing for four stage components.

- [ ] **Step 1: Write pure route utility tests**

```js
assert.deepEqual(STAGES, ['script', 'assets', 'storyboard', 'cut']);
assert.equal(stageLabel('assets'), '设定');
assert.equal(normalizeStage('unknown', 'storyboard'), 'storyboard');
assert.equal(productionStagePath(7, 10, 'cut'), '/projects/7/episodes/10/cut');
assert.equal(productionAdvancedPath(7, 10, 'storyboard'), '/projects/7/episodes/10/storyboard?mode=advanced');
```

Also read router source and assert the route path, param names and lazy-loaded `ProductionStudio.vue` are present. Add compatibility tests proving `/projects/:projectId/episodes/:episodeId/canvas`、`/film/:id/canvas` and `/drama/:id/canvas` only resolve context and `replace` to the current stage URL with `?mode=advanced`; none may own a separate save path.

- [ ] **Step 2: Run and verify missing utilities/routes**

```powershell
& $node22 --test test/productionStageRoutes.test.js
```

Expected: FAIL because production routes do not exist.

- [ ] **Step 3: Refactor API clients without behavior drift**

`apiClient.js` exports `createApiClient(baseURL)` and contains the current timeout, JSON header and response/error interceptors verbatim. `request.js` becomes:

```js
import { createApiClient } from './apiClient';
export default createApiClient('/api/v1');
```

`requestV2.js` becomes:

```js
import { createApiClient } from './apiClient';
export default createApiClient('/api/v2');
```

Existing API modules keep importing `@/utils/request`.

- [ ] **Step 4: Implement the production API module and store**

The API module maps every endpoint from Tasks 3–4 with snake_case request payloads. The store owns only Studio context/states; it may reuse `dramaAPI.get(projectId)` but must verify `episodeId` belongs to the returned project before setting context.

Store initial state:

```js
const project = ref(null);
const episode = ref(null);
const stages = ref([]);
const currentStage = ref('script');
const scriptRevision = ref(null);
const assetReadiness = ref(null);
const gateEvaluation = ref(null);
const taskSummary = ref({ running: 0, failed: 0 });
const loading = ref(false);
const error = ref(null);
```

Async actions use a monotonically increasing `loadSerial` like the existing FilmCreate protection, so switching routes cannot apply stale responses.

- [ ] **Step 5: Implement the shell and placeholders**

Shell layout follows UI spec §§4–5:

- 64px global rail;
- 56px Studio header with project/episode/save/task controls;
- 48px four-stage rail;
- blocker panel below the stage rail;
- `<router-view>` or deterministic stage component mapping in the remaining area.

Storyboard/Cut placeholders are read-only readiness views with links back to blockers; they must not expose fake generation or Picture Lock buttons.

- [ ] **Step 6: Add semantic theme variables**

Add `--studio-bg-canvas`, `--studio-bg-surface`, `--studio-text-primary`, `--studio-text-muted`, `--studio-border`, `--studio-accent`, `--studio-warning`, `--studio-danger`, `--studio-success` for both existing themes. Components use these variables and must not copy RunningHub hex values.

- [ ] **Step 7: Run frontend unit slice and build**

```powershell
& $node22 --test test/productionStageRoutes.test.js test/productionStudioStore.test.js test/productionStudioShell.test.js test/projectLifecycleContracts.test.js
& $npm22 run build
```

Expected: tests and build PASS.

- [ ] **Step 8: Commit**

```powershell
git add frontweb/src/utils/apiClient.js frontweb/src/utils/request.js frontweb/src/utils/requestV2.js frontweb/src/api/productionStudio.js frontweb/src/stores/productionStudio.js frontweb/src/utils/productionStages.js frontweb/src/views/productionStudio frontweb/src/components/production/GlobalRail.vue frontweb/src/components/production/StudioHeader.vue frontweb/src/components/production/StageRail.vue frontweb/src/components/production/StageGatePanel.vue frontweb/src/router/index.js frontweb/src/styles/theme.css frontweb/test/productionStageRoutes.test.js frontweb/test/productionStudioStore.test.js frontweb/test/productionStudioShell.test.js
git commit -m "feat: add production studio shell and stage routing"
```

## Task 6: Script Stage autosave, review, approval and impact dialog

**Files:**

- Create: `frontweb/src/views/productionStudio/ScriptStage.vue`
- Create: `frontweb/src/components/production/DependencyImpactDialog.vue`
- Create: `frontweb/test/scriptStageGate.test.js`
- Modify: `frontweb/src/stores/productionStudio.js`
- Modify: `frontweb/src/views/productionStudio/ProductionStudio.vue`

**Interfaces:**

- Consumes Task 5 store and Task 3 APIs.
- Emits no legacy FilmCreate events; all writes go through script revision endpoints.

- [ ] **Step 1: Write source-contract and store tests**

Test the pure debounced save scheduling separately from the component. Assert:

- save delay is 800ms;
- `expected_revision` comes from loaded `scriptRevision.revision`;
- a 409 conflict sets `conflict` state and does not overwrite local text;
- `approveStage` cannot be invoked before successful `submitStage`;
- impact dialog receives `fromRevision`, `toRevision`, `precision`, affected stages and note.

Source contract assertions:

```js
assert.match(source, /检查并提交/);
assert.match(source, /确认剧本/);
assert.match(source, /Ctrl|metaKey/);
assert.doesNotMatch(source, /router\.push\(['"]\/film\//);
```

- [ ] **Step 2: Run and verify failure**

```powershell
& $node22 --test test/scriptStageGate.test.js test/productionStudioStore.test.js
```

Expected: FAIL until Script Stage behavior exists.

- [ ] **Step 3: Build the three-column stage**

Implement scene/structure navigation at 240px, central plain-text editor, and 320px checks panel. For Phase 1, scene headings may be derived client-side only for navigation; they are not persisted as a new truth.

Autosave rules:

- 800ms after input;
- immediate `Ctrl/Cmd+S`;
- non-blocking saving state;
- browser draft backup keyed by `production-script-draft:<episodeId>:<revision>`;
- clear backup only after server returns matching fingerprint;
- on leave with failed save, show the UI-spec retry/stay/discard choices.

- [ ] **Step 4: Implement submit-review and approval flow**

`检查并提交` calls submit-review. If 422, show blocker codes/messages in `StageGatePanel`. If successful, button becomes `确认剧本`. Confirm first loads impact; if revision follows an approval, open `DependencyImpactDialog`, then call approve with `expected_revision` only after user confirms.

The impact dialog must say `阶段级影响` when `precision === 'stage'`; it may not display fabricated object counts. 保存草稿与提交待审只更新当前 revision，不传播 stale；批准新 revision 的事务必须先写 stale 及事件，再按用户的“立即刷新/稍后刷新”选择决定是否创建重算任务。

- [ ] **Step 5: Run tests and build**

```powershell
& $node22 --test test/scriptStageGate.test.js test/productionStudioStore.test.js test/productionStudioShell.test.js
& $npm22 run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontweb/src/views/productionStudio/ScriptStage.vue frontweb/src/components/production/DependencyImpactDialog.vue frontweb/src/stores/productionStudio.js frontweb/src/views/productionStudio/ProductionStudio.vue frontweb/test/scriptStageGate.test.js frontweb/test/productionStudioStore.test.js
git commit -m "feat: add script review and approval gate"
```

## Task 7: Assets Stage readiness and approvals

**Files:**

- Create: `frontweb/src/views/productionStudio/AssetsStage.vue`
- Create: `frontweb/src/components/assets/AssetReadinessGrid.vue`
- Create: `frontweb/src/components/look/LookApprovalCard.vue`
- Create: `frontweb/test/assetsStageApproval.test.js`
- Modify: `frontweb/src/stores/productionStudio.js`

**Interfaces:**

- Consumes `GET assets/readiness` and Look/asset submit/approve endpoints.
- Produces standard-mode cards only; full detail drawer and candidate generation remain Phase 2.

- [ ] **Step 1: Write readiness UI tests**

Use fixture data with one approved Look, two approved characters, one stale scene and one unapproved prop. Assert render helpers produce:

```js
assert.deepEqual(summary, {
  approved: 3,
  pending: 1,
  stale: 1,
  blockers: 2,
});
```

Read component source and assert object status labels `草稿/待确认/已确认/已过期` exist as text, and blocker uses the separate label `阻塞 2`；不得把“被阻塞”实现为对象或阶段状态。

- [ ] **Step 2: Run and verify missing-component failure**

```powershell
& $node22 --test test/assetsStageApproval.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement overview and filter tabs**

Build readiness cards for Look、角色、场景、道具. Each item shows preview, name, version, status text and usage count. Tabs filter existing response data; no new network call per tab.

Clicking an item opens an inline side panel for Phase 1 with snapshot diff and source links. It must not restore the old horizontally scrolling wide card.

- [ ] **Step 4: Implement explicit approval actions**

Rules:

- `提交确认` creates/reuses a fingerprinted version and moves to `ready_for_review`;
- `确认版本` requires the returned current version;
- stale items show old approved snapshot vs current source fields;
- approving an item reloads readiness and stages;
- selecting an image or style in legacy data never auto-approves it.

The stage `确认设定` button is enabled only when `ready_for_stage_approval` is true, then calls the generic stage approval API.

- [ ] **Step 5: Run tests and build**

```powershell
& $node22 --test test/assetsStageApproval.test.js test/productionStudioStore.test.js test/styleCatalogUi.test.js test/characterVariantStudio.test.js
& $npm22 run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontweb/src/views/productionStudio/AssetsStage.vue frontweb/src/components/assets/AssetReadinessGrid.vue frontweb/src/components/look/LookApprovalCard.vue frontweb/src/stores/productionStudio.js frontweb/test/assetsStageApproval.test.js
git commit -m "feat: add production asset readiness and approvals"
```

## Task 8: Task drawer, blocker navigation and legacy feature flag

**Files:**

- Create: `frontweb/src/components/production/TaskDrawer.vue`
- Create: `frontweb/src/views/FilmEntry.vue`
- Create: `frontweb/test/filmEntryCompatibility.test.js`
- Modify: `frontweb/src/views/productionStudio/ProductionStudio.vue`
- Modify: `frontweb/src/components/production/StudioHeader.vue`
- Modify: `frontweb/src/components/production/StageGatePanel.vue`
- Modify: `frontweb/src/router/index.js`

**Interfaces:**

- Task drawer initially consumes existing episode generation progress and task APIs; it does not create a new job table.
- Feature flag: `import.meta.env.VITE_PRODUCTION_STUDIO_V2 === '1'`.

- [ ] **Step 1: Write compatibility tests**

Assert:

- `/film/:id` still exists and loads `FilmEntry.vue`;
- flag off dynamically renders old `FilmCreate.vue` without redirect;
- flag on loads the drama, honors a valid `?episode=`, otherwise selects the first non-deleted episode, and redirects to `/projects/:projectId/episodes/:episodeId/script`;
- project with no episodes redirects to `/projects/:projectId`;
- direct V2 route is available regardless of flag;
- invalid V2 episode shows the project-level error state rather than selecting a different episode.

- [ ] **Step 2: Run and verify failure**

```powershell
& $node22 --test test/filmEntryCompatibility.test.js test/projectLifecycleContracts.test.js
```

Expected: FAIL until compatibility entry exists.

- [ ] **Step 3: Implement the task drawer**

Drawer width 420px and filters `运行/排队/失败/已完成`. Normalize existing states into `queued/running/succeeded/failed/cancelled/unknown`, but retain raw state in details. Show object, Provider/model, progress, error and jump link. Only show cancel/retry if the underlying API declares that action; do not render nonfunctional buttons.

- [ ] **Step 4: Wire blockers to exact destinations**

Each blocker carries `{ code, message, targetStage, targetQuery }`. Clicking navigates with Vue Router to the target stage/asset/shot. If target data is unavailable, keep the blocker visible and explain it cannot be opened; never silently clear it.

- [ ] **Step 5: Implement `FilmEntry.vue` and flag behavior**

Use one load serial to avoid cross-project response races. Do not change `FilmCreate.vue` internals. Old links, bookmarks and tests continue to reach V1 when the flag is off.

- [ ] **Step 6: Run compatibility and build checks**

```powershell
& $node22 --test test/filmEntryCompatibility.test.js test/projectLifecycleContracts.test.js test/filmCreateScrollPerformance.test.js test/productionStudioShell.test.js
& $npm22 run build
```

Expected: PASS with flag absent/off. Repeat build with flag enabled:

```powershell
$env:VITE_PRODUCTION_STUDIO_V2='1'
& $npm22 run build
Remove-Item Env:VITE_PRODUCTION_STUDIO_V2
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add frontweb/src/components/production/TaskDrawer.vue frontweb/src/components/production/StudioHeader.vue frontweb/src/components/production/StageGatePanel.vue frontweb/src/views/productionStudio/ProductionStudio.vue frontweb/src/views/FilmEntry.vue frontweb/src/router/index.js frontweb/test/filmEntryCompatibility.test.js
git commit -m "feat: add studio task drawer and legacy entry flag"
```

## Task 9: End-to-end Phase 1 acceptance and changelog

**Files:**

- Modify: `CHANGELOG.md`
- Create: `docs/research/_artifacts/localminidrama-production-studio-v2.1-phase1-acceptance/README.md`
- Create screenshots in the same acceptance directory; filenames listed below.

**Interfaces:** None; this task is the release evidence gate.

- [ ] **Step 1: Run all backend tests**

```powershell
Set-Location backend-node
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
```

Expected: exit 0, zero failed.

- [ ] **Step 2: Run all frontend tests and both builds**

```powershell
Set-Location ..\frontweb
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\node.exe' --test test/*.test.js
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\npm.cmd' run build
$env:VITE_PRODUCTION_STUDIO_V2='1'
& 'C:\Users\26373\AppData\Local\Temp\codex-node-v22.22.3\node-v22.22.3-win-x64\npm.cmd' run build
Remove-Item Env:VITE_PRODUCTION_STUDIO_V2
```

Expected: all exit 0.

- [ ] **Step 3: Execute local UI acceptance without paid generation**

Use sample project/episode and verify:

1. direct V2 Script route opens correct project and episode;
2. all four stages are browsable;
3. empty script blocks submit with visible reason;
4. saving a draft updates legacy episode text;
5. submit does not auto-approve;
6. approval records `local-user` and revision;
7. editing approved text creates a new revision and shows stage-level impact;
8. Look/asset selection remains unapproved until explicit action;
9. stale asset shows old/current difference;
10. task drawer survives stage navigation;
11. flag off keeps old FilmCreate; flag on redirects old entry;
12. `approved + failed task + warning` can display simultaneously without overwriting stage status;
13. old canvas URLs replace to the current stage `?mode=advanced` canonical URL;
14. no page-level horizontal overflow at 1280px in shallow/deep theme.

Acceptance evidence must map each result to `A-ST01～A-ST06`、`A-S01/A-S04/A-S05`、`A-L01` 基础和 `A-X01`；static source assertions are supporting evidence only, not substitutes for API/SQLite/UI closure.

- [ ] **Step 4: Capture acceptance evidence**

Save these exact screenshots:

```text
01-script-stage.png
02-script-impact-dialog.png
03-assets-readiness.png
04-asset-stale-comparison.png
05-storyboard-blocked-placeholder.png
06-task-drawer.png
07-studio-dark.png
08-studio-light.png
```

The acceptance README records URL, viewport, visible state, SHA-256 and evidence boundary. Do not capture API keys.

- [ ] **Step 5: Run final diff and sensitive-data checks**

```powershell
Set-Location ..
git diff --check
rg -n "sk-[A-Za-z0-9]|api_key\s*[:=]\s*['\"][^'\"]+|Bearer\s+[A-Za-z0-9]" docs/research/_artifacts/localminidrama-production-studio-v2.1-phase1-acceptance backend-node/src frontweb/src
```

Expected: diff check exit 0; sensitive scan has no credential value.

- [ ] **Step 6: Update `[未发布]` with implemented, verified behavior**

Add entries under “新增/优化/文档与工程” describing:

- 可双轨使用的四阶段 Production Studio；
- 剧本修订、检查、批准、乐观锁和影响提示；
- Look/角色/场景/道具的明确批准与 stale 状态；
- 全局任务抽屉、阻塞跳转和 V1 兼容开关；
- Node 22 全量测试、双模式构建和 UI 验收截图。

Do not claim Storyboard/Cut 的生成、时间线或交付已经迁移；Phase 1 这两页是只读 readiness 占位。

- [ ] **Step 7: Commit acceptance evidence**

```powershell
git add CHANGELOG.md docs/research/_artifacts/localminidrama-production-studio-v2.1-phase1-acceptance
git commit -m "docs: record production studio phase one acceptance"
```

## Self-review results

- Spec coverage: Phase 1 的新路由、四阶段壳、阶段状态、Script Gate、影响预览、Look/资产批准、任务抽屉、blocker、feature flag 和旧 FilmCreate 兼容都有独立任务。
- Scope boundary: Storyboard/Cut 在本阶段仅提供真实 readiness 和阻塞页面；不会伪装为已迁移工作台。方案 B 的场次—分镜—时段、Shot Package、候选工作台、时间线、Picture Lock 和 Delivery 属于后续计划。
- Data consistency: 剧本文本仍事务性投影到 `episodes`；阶段事件、Gate waiver、Look/项目级资产版本保存不可变事实；现有风格、资产和生成表只承担兼容投影，不被替换。
- State separation: 阶段内容、Gate 评估和任务状态分别建模；任何 blocker 或任务失败都不能覆盖阶段状态。
- Concurrency: 所有 mutation 使用 `expected_revision` 或 `expected_version + expected_fingerprint`；前端路由加载使用 `loadSerial`。
- Local-first: 默认 `local-user`、无强制账户、无钱包、无远端自动执行。
