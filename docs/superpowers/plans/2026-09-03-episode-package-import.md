# 单集制作包导入与多参考图 H3 视频生成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现严格 JSON 单集制作包导入（含人物多状态）与统一参考图解析、H3 提示词草稿门禁（设计文档两个阶段）。

**Architecture:** 后端新增迁移 30/31、四个服务模块（制作包校验/导入、人物状态、状态关联同步、参考槽位解析、H3 草稿）与对应路由；前端新增导入向导组件、人物状态卡片、视频抽屉 H3 草稿流程。全部纯 JavaScript，Node 内置 test runner。

**Tech Stack:** Express + better-sqlite3（内存库测试）、Vue 3 + Element Plus、node:test。

**Spec:** `docs/superpowers/specs/2026-09-02-single-episode-production-package-import-design.md`（含 2026-09-03 修订，执行者必须先读）。

## Global Constraints

- 纯 JavaScript，禁止 TypeScript；不新增 npm 依赖（无 ajv，结构校验手写）。
- 后端测试：`cd backend-node && node --test test/<file>.test.js`；前端测试：`cd frontweb && node --test test/<file>.test.js`。
- 迁移：新增 `backend-node/migrations/NN_name.sql`（CREATE TABLE IF NOT EXISTS / ALTER，运行器容忍重复列错误），并同步在 `backend-node/src/db/migrate.js` 的 `ensureAllColumns()` 补列（新表在 ensureAllColumns 末尾按 `migrate.js:532-589` 现有模式补 CREATE TABLE IF NOT EXISTS）。
- 路由处理器为工厂函数 `module.exports = (cfg, db, log) => {...}`，注册在 `src/routes/index.js`；响应用 `src/response.js` 的 `success/error/badRequest/notFound`。
- 服务测试骨架：`node:test` + `new Database(':memory:')` + 手建本测试涉及的最小表（参照 `test/candidateGroupService.test.js`）；路由测试用 `responseCapture()` 模式（参照 `test/directorRoutes.test.js:9-17`）。
- 错误以字符串错误码抛出（`const e = new Error(msg); e.code = 'XXX'`），HTTP 层映射 400/409。
- 数据库事务用 `db.transaction(() => {...})()`；导入接口禁止调用任何 AI/图片/视频任务。
- 结构化新字段（audio_description、transition、match_decisions 等）按项目约定存 JSON 文本，由服务层序列化。
- 提交信息用中文 опис + conventional 前缀（feat/fix/test/docs），每个任务一提交。工作区含用户未提交改动（frontweb/src/views/FilmCreate.vue 等）：**只 `git add` 本任务明确列出的文件**，绝不 `git add -A`。
- FilmCreate.vue 约 1.1 万行，编辑必须用唯一锚点字符串定位，改前先 grep 确认锚点唯一。

---

# 第一阶段：标准导入和数据模型

### Task 1: 迁移 30 —— 新表与增量列

**Files:**
- Create: `backend-node/migrations/30_episode_package_import.sql`
- Modify: `backend-node/src/db/migrate.js`（ensureAllColumns 补列 + 新表）
- Test: `backend-node/test/episodePackageMigration.test.js`

**Interfaces:**
- Produces: 表 `character_variants`、`storyboard_character_variants`、`episode_imports`；列 `characters.source_key`、`scenes.source_key`、`scenes.state`、`props.source_key`、`storyboards.source_key`、`storyboards.audio_description`、`storyboards.transition`。

- [ ] **Step 1: 写失败测试**（验证 ensureColumns 后新表新列存在）

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { createLogger } = require('../src/logger');

describe('episode package migration', () => {
  it('creates package tables and columns', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db, createLogger());
    for (const t of ['character_variants', 'storyboard_character_variants', 'episode_imports']) {
      assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t), t);
    }
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(cols('characters').includes('source_key'));
    assert.ok(cols('scenes').includes('state'));
    assert.ok(cols('storyboards').includes('audio_description'));
    assert.ok(cols('storyboards').includes('transition'));
  });
});
```

注意：先确认 `runMigrationsAndEnsure(db, log)` 的真实签名（`src/db/migrate.js:596-599`），若参数不同按实际调整；logger 用项目真实构造方式（参照其它测试）。

- [ ] **Step 2: 运行确认失败**：`cd backend-node && node --test test/episodePackageMigration.test.js` → FAIL
- [ ] **Step 3: 写迁移 SQL**

```sql
-- 30_episode_package_import.sql
CREATE TABLE IF NOT EXISTS character_variants (
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_variants_key ON character_variants(character_id, source_key);
CREATE TABLE IF NOT EXISTS storyboard_character_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  reference_role TEXT,
  sort_order INTEGER,
  framing_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbv_variant ON storyboard_character_variants(storyboard_id, variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbv_sort ON storyboard_character_variants(storyboard_id, sort_order) WHERE sort_order IS NOT NULL;
CREATE TABLE IF NOT EXISTS episode_imports (
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
ALTER TABLE characters ADD COLUMN source_key TEXT;
ALTER TABLE scenes ADD COLUMN source_key TEXT;
ALTER TABLE scenes ADD COLUMN state TEXT;
ALTER TABLE props ADD COLUMN source_key TEXT;
ALTER TABLE storyboards ADD COLUMN source_key TEXT;
ALTER TABLE storyboards ADD COLUMN audio_description TEXT;
ALTER TABLE storyboards ADD COLUMN transition TEXT;
```

- [ ] **Step 4: 同步 ensureAllColumns**：在 `migrate.js` 对应表数组补 `{ name: 'source_key', type: 'TEXT' }`（characters/scenes/props/storyboards）、`{ name: 'state', type: 'TEXT' }`（scenes）、`{ name: 'audio_description', type: 'TEXT' }`、`{ name: 'transition', type: 'TEXT' }`（storyboards）；新表 CREATE TABLE IF NOT EXISTS 加在 `migrate.js:532-589` 现有建表段之后，SQL 与迁移文件一致。
- [ ] **Step 5: 测试通过** 后 `git add` 仅列出的 3 个文件，`git commit -m "feat: episode package data model migration"`

### Task 2: characterVariantsService —— 人物状态 CRUD 与默认状态

**Files:**
- Create: `backend-node/src/services/characterVariantsService.js`
- Test: `backend-node/test/characterVariantsService.test.js`

**Interfaces:**
- Produces（后续任务依赖的签名）:
  - `listVariants(db, characterId)` → 行数组（`extra_images` 已 JSON.parse 为数组，`deleted_at IS NULL`，按 `is_default DESC, id ASC`）
  - `createVariant(db, { character_id, source_key, name, description, appearance, image_prompt, negative_prompt, is_default })` → 行；`source_key` 缺省时：该人物第一个状态为 `'default'`，否则 `` `variant_${count+1}` ``；`is_default=1` 时先 `UPDATE character_variants SET is_default=0 WHERE character_id=?`
  - `updateVariant(db, id, patch)` → 行；patch 仅接受 name/description/appearance/image_prompt/negative_prompt/is_default/image_url/local_path/extra_images/source_key；`is_default` 切换同上
  - `deleteVariant(db, id)` → 被 `storyboard_character_variants` 引用时抛 `e.code='VARIANT_IN_USE'`，否则软删（`deleted_at`）
  - `ensureDefaultVariant(db, characterId)` → 已有 `is_default=1` 直接返回；否则创建 `source_key='default'`、`name='默认'`、从 `characters` 表复制 `description`/`appearance`
  - `variantUsageCount(db, variantId)` → number
- Consumes: Task 1 的表。

- [ ] **Step 1: 写失败测试**（最小表：characters、character_variants、storyboard_character_variants），覆盖：create 默认 source_key 规则；同一人物唯一默认（新建默认后旧默认清零）；delete 被引用时 VARIANT_IN_USE；ensureDefaultVariant 幂等。
- [ ] **Step 2: 运行失败** → **Step 3: 实现** → **Step 4: 通过**
- [ ] **Step 5: Commit** `feat: character variants service`

### Task 3: storyboardVariantService —— 分镜状态关联与投影同步

**Files:**
- Create: `backend-node/src/services/storyboardVariantService.js`
- Modify: `backend-node/src/services/storyboardService.js`（`updateStoryboard` 支持可选 `character_variant_links` 字段：存在时调用 sync 后仍走既有 characters/prod 同步逻辑）
- Test: `backend-node/test/storyboardVariantService.test.js`

**Interfaces:**
- Produces:
  - `syncStoryboardVariantLinks(db, storyboardId, links)`；links 元素 `{ character_id, variant_id, reference_role, sort_order, framing_note }`；校验：variant 存在且 `variant.character_id === link.character_id`（否则 `e.code='VARIANT_CHARACTER_MISMATCH'`），sort_order 非空且集内不重复（`'VARIANT_SORT_ORDER_DUPLICATE'`）；全删全插；随后把 `storyboards.characters` 投影更新为 `JSON.stringify(links.map(l => l.character_id))`（与 `storyboardService.js:97-99` 现格式一致：ID 数组）。
  - `listStoryboardVariantLinks(db, storyboardId)` → 行数组，JOIN character_variants 与 characters 带出 `variant_name`、`character_name`、`image_url`、`local_path`，按 `sort_order IS NULL, sort_order, id` 排序。

- [ ] **Step 1-4: TDD**（最小表 storyboards/characters/character_variants/storyboard_character_variants；用例：正常写入与回读、错配抛错、sort_order 重复抛错、投影数组与 links 顺序一致、重复调用幂等）
- [ ] **Step 5: Commit** `feat: storyboard character variant links`

### Task 4: 制作包 Schema 文档 + 结构校验器

**Files:**
- Create: `backend-node/src/services/episodePackageSchema.js`
- Create: `docs/superpowers/specs/episode-package.schema.json`
- Create: `docs/superpowers/specs/episode-package.example.json`
- Create: `docs/superpowers/specs/episode-package-upstream-prompt.md`（上游 AI 生成提示词模板，约束其输出严格符合 schema，禁止 Markdown 围栏）
- Test: `backend-node/test/episodePackageSchema.test.js`

**Interfaces:**
- Produces:
  - `PACKAGE_SCHEMA_NAME = 'local-mini-drama.episode-package'`，`PACKAGE_SCHEMA_VERSION = '1.0'`
  - `validatePackageStructure(pkg)` → `{ ok, errors: [{ path, message }] }`；校验：schema/version 字面量；必填 `episode`、`storyboards`；顶层字段类型（generator/generation_profile 对象可选；数组字段缺省视为 `[]`，出现则必须是数组）；episode.source_key/title/summary 为非空 string、episode_number 为正整数；characters[].source_key/name/description 必填、variants 为至少 1 个元素的数组、variant 的 source_key/name/description/appearance/image_prompt 必填；scenes[]/props[] 必填字段；storyboards[].source_key/title/description 必填、storyboard_number/duration_seconds 正数、scene_ref 必填 string、character_refs[] 元素必须含 character_ref/variant_ref 字符串与 number 的 sort_order；`generation_profile.max_reference_images` 若存在必须是正整数。
  - `packageJsonSchema`：与 schema.json 文件同构的 JS 对象（供文档与将来工具使用）。
- example.json 必须能通过 `validatePackageStructure`（测试断言）。

- [ ] **Step 1-4: TDD**（合法 example 通过；逐类违规：缺 schema、错误 version、缺 episode、非正整数 episode_number、variants 空数组、character_refs 缺 variant_ref → 错误 path 精确）
- [ ] **Step 5: Commit** `feat: episode package schema and structural validator`

### Task 5: 业务校验器 + 确定性归一化（5.6.1 映射）

**Files:**
- Create: `backend-node/src/services/episodePackageValidator.js`
- Test: `backend-node/test/episodePackageValidator.test.js`

**Interfaces:**
- Produces:
  - `logicalSlots(storyboard)` → 1-based `[{ index, type: 'scene'|'character_variant'|'prop', ref }]`；顺序 scene → character_refs（按 sort_order 升序）→ prop_refs（数组序）。phase 2 解析器复用同一函数。
  - `validateBusinessRules(pkg)` → `{ errors, warnings }`；错误码（同时是 path 精确的 message）：`PACKAGE_KEY_DUPLICATE`（人物/场景/道具/分镜各自范围、状态在人物内）、`PACKAGE_REF_MISSING`（scene_ref/character_ref/prop_ref 无目标）、`VARIANT_CHARACTER_MISMATCH`（character_refs 的 variant_ref 不属于 character_ref）、`PACKAGE_NUMBER_DUPLICATE`（storyboard_number）、`PACKAGE_DURATION_INVALID`（≤0）、`PACKAGE_SLOT_OVERFLOW`（draft 的 `@图片N` 中 N > 该分镜 logicalSlots 总数）；警告：`SCRIPT_MISSING`、`AUDIO_MISSING`、`TRANSITION_MISSING`、`UNIVERSAL_DRAFT_MISSING`、`UNIVERSAL_DRAFT_SLOT_GAP`（N ≤ 总数但中间槽位未被引用）。
  - `renderAction(action)`：string 原样返回；`{start, progression, end}` → `['开始：'+start, '推进：'+progression, '结束：'+end].filter(v=>有值).join('\n')`；null → `''`。同输入永远同输出。
  - `renderDialogue(dialogue)`：数组 → 逐行 `『'+speaker+'』'+(performance ? '（'+performance+'）' : '')+'：'+line`，无 speaker 用『旁白』；string 原样；null → `''`。
  - `generateScriptFromStoryboards(storyboards)`：逐镜 `【镜N·场景名】title\n动作：renderAction\n对白：renderDialogue\n旁白：narration`，空段跳行，两镜间空行。
  - `validateUniversalDraftRefs(text, slotCount)` → `{ refs: [N...], overflow: [N...] }`，正则 `/@(?:图片|image)\s*(\d+)/gi`。

- [ ] **Step 1-4: TDD**（重点用例：renderAction/renderDialogue 确定性（同一输入两次输出逐字节相同，见 spec 14.1）；跨引用错误 path 含分镜 source_key；draft 引用 3 号槽但只有 2 槽 → PACKAGE_SLOT_OVERFLOW）
- [ ] **Step 5: Commit** `feat: episode package business validator and normalizer`

### Task 6: episodePackageService —— 预览与原子导入

**Files:**
- Create: `backend-node/src/services/episodePackageService.js`
- Test: `backend-node/test/episodePackageService.test.js`

**Interfaces:**
- Consumes: Task 2/3/4/5 全部签名。
- Produces:
  - `sha256Text(text)` → hex。
  - `episodeBlankStatus(db, episodeId)` → `{ status: 'blank'|'non_blank'|'not_found', reasons: [] }`；blank 条件（spec 8.3）：script_content 与 description 均空、无未删分镜、分镜无 image_url/local_path/video_url、episode_imports 无记录。episodes 行不存在 → not_found。
  - `previewPackageImport(db, { rawText, filename, dramaId, targetEpisodeId })` → `{ normalized_package, source_sha256, target_status, asset_matches, errors, warnings, stats }`；**只读**。asset_matches：对 characters/scenes/props 每项 `{ type, source_key, name, decision: 'create'|'reuse'|'conflict', existing_id, candidates: [{id, name}] }`；dramaId 范围内 `source_key` 精确相等 → reuse；无 source_key 匹配但同名 → conflict + name candidates；否则 create。normalized_package 内的 action/dialogue 已渲染为落库文本。
  - `importEpisodePackage(db, { rawText, sourceSha256, dramaId, targetEpisodeId, filename, decisions })`；decisions 形如 `{ characters: { [source_key]: 'create'|'reuse' }, scenes: {...}, props: {...} }`。步骤（spec 8.4，全部在一个 `db.transaction` 内）：重解析+结构+业务校验（errors 非空 → `e.code='PACKAGE_INVALID'`）→ `sha256Text(rawText) !== sourceSha256` → `'PACKAGE_HASH_MISMATCH'` → 目标集（targetEpisodeId 给定时）blank 重查，非空 → `'TARGET_NOT_BLANK'` → 新建集（dramaId、`episode_number = max+1`、title、description=summary、script_content = script || generateScriptFromStoryboards）→ 按 decisions 建或复用 characters（写 source_key）/scenes（name→location、state→state、image_prompt→prompt，description 前缀拼接“{description}。{image_prompt}”）/props → 人物状态全部 create-if-absent（`(character_id, source_key)` 唯一，已存在则复用不覆盖）→ 分镜插入（5.6.1 映射：scene_id 解析、storyboard_number、duration、rendered action/dialogue、shot_type/angle/movement→movement、composition→layout_description、narration、image_prompt、universal_segment_text、audio_description/transition JSON.stringify、creation_mode='universal'、source_key）→ storyboard_props 插入 → syncStoryboardVariantLinks（sort_order 取 character_refs.sort_order，reference_role/framing_note 带入）→ ensureDefaultVariant 不需要（包内必有 variants）→ 写 episode_imports。失败抛错回滚。decisions 中 'reuse' 但预览判 create（键不存在）→ `'PACKAGE_DECISION_INVALID'`；存在未处理 conflict（无 decision 项）→ `'CONFLICT_UNRESOLVED'`。
  - 重复导入防护：目标集已导入过 → episodeBlankStatus 为 non_blank → TARGET_NOT_BLANK（spec 6.4 语义）。

- [ ] **Step 1-4: TDD**。代表性用例（全部必须写）：
  1. 新建导入：最小合法包（1 人物 1 状态 1 场景 1 道具 2 分镜）→ 返回 `{ episode_id, stats }`；断言 episodes/storyboards/scenes/props/character_variants/storyboard_character_variants/episode_imports 行数与关键字段（含渲染后的 action 多行文本、storyboards.characters 投影）。
  2. 填充空白集（预建 script_content 为空的集）成功且集号不变。
  3. 非空集（有 script_content）→ TARGET_NOT_BLANK 且零写入。
  4. 哈希不符 → PACKAGE_HASH_MISMATCH 且零写入。
  5. 回滚：包内两个分镜 storyboard_number 相同（业务校验本应拦截；改为在 decisions 注入后直接手工往包里塞重复 source_key 分镜并绕过——直接构造 DB 层冲突：场景 source_key 与包重复且 decisions=create → UNIQUE 冲突）→ 断言 episodes 无新行。
  6. 复用不覆盖：预置同名同 source_key 场景（不同 prompt），decisions=reuse → 导入后 prompt 保持原值。
  7. preview 前后库内各表计数不变（只读）。
  8. conflict 未决策 → CONFLICT_UNRESOLVED。
- [ ] **Step 5: Commit** `feat: episode package preview and atomic import`

### Task 7: 路由 —— 导入包 + 人物状态 + 分镜状态关联

**Files:**
- Create: `backend-node/src/routes/episodePackage.js`
- Modify: `backend-node/src/routes/index.js`（注册 + 引入工厂）
- Modify: `backend-node/src/routes/characters.js`（variants 子路由）
- Modify: `backend-node/src/routes/storyboards.js`（`PUT /storyboards/:id/character-variant-links`）
- Test: `backend-node/test/episodePackageRoutes.test.js`（responseCapture 模式，最小表 + 手建路由所需表）

**Interfaces:**
- Produces:
  - `POST /episodes/import-package/preview` body `{ raw_json_text, filename, drama_id, target_episode_id? }` → 200 `{ success, data: previewPackageImport 结果 }`；校验失败 400 `error(res, 400, code, message)`。
  - `POST /episodes/import-package` body `{ raw_json_text, source_sha256, drama_id, target_episode_id?, filename, decisions }` → 200 `{ success, data: { episode_id, stats, warnings } }`；`TARGET_NOT_BLANK`/`PACKAGE_HASH_MISMATCH` → 409；其余 400。
  - `GET /characters/:characterId/variants` → success(listVariants)；`POST /characters/:characterId/variants` → created(createVariant)；`PUT /character-variants/:variantId` → success(updateVariant)；`DELETE /character-variants/:variantId` → success；VARIANT_IN_USE → 409。
  - `POST /character-variants/:variantId/generate-image`：本任务仅返回 501 `{ code: 'NOT_IMPLEMENTED' }`（生图接入在 Task 11）。
  - `PUT /storyboards/:id/character-variant-links` body `{ links }` → success(listStoryboardVariantLinks 重查结果)。
- routes/index.js 注册方式与现有 `r.post('/dramas/import', ...)` 一致（`src/routes/index.js:150-152` 附近）。

- [ ] **Step 1-4: TDD**（预览 200 且数据形状正确；导入 200；非空集 409；variants CRUD 走通；links PUT 后 GET 数据库验证）。路由工厂内直接拿 `(cfg, db, log)`，测试里 `createRoutes({ cfg: {}, db, log })` 后调用 `routes.post(...)` 不可行——参照 `test/directorRoutes.test.js` 如何从工厂提取 handler 调用（读该测试文件确认调用约定后照做）。
- [ ] **Step 5: 全量回归** `cd backend-node && node --test test/*.test.js` 必须全绿（此时跑一次，作为阶段性验证）。
- [ ] **Step 6: Commit** `feat: episode package and variant routes`

### Task 8: ZIP 项目导出/导入扩展

**Files:**
- Modify: `backend-node/src/services/dramaExportService.js`（characters 增 `source_key` + `variants[]`；scenes 增 `source_key/state`；props 增 `source_key`；storyboards 增 `source_key/audio_description/transition/character_variant_refs`）
- Modify: `backend-node/src/services/dramaImportService.js`（对应回导；variants.character_id 按 character index→新 id 重映射；storyboards.character_variant_refs 元素 `{ character_index, variant_index, reference_role, sort_order, framing_note }` 重映射后调用 syncStoryboardVariantLinks）
- Test: `backend-node/test/dramaPackageRoundtrip.test.js`

**Interfaces:**
- Produces: 导出 project.json episode.storyboards[] 新增字段 `character_variant_refs`；导入后分镜的状态关联与源库一致。

- [ ] **Step 1-4: TDD**：建内存库写入 1 人物（2 状态）1 分镜（1 状态关联 sort_order=1）→ 调 exportDrama 拿 project.json 解析 → 新内存库 importDrama → 断言 variants 数、关联的 variant 重映射正确（新 id ≠ 旧 id 但 source_key 相同）、scenes.state 保留。
- [ ] **Step 5: Commit** `feat: carry variants and source keys through project zip`

### Task 9: characters.stages 废弃 + 变体生图端点

**Files:**
- Modify: `backend-node/src/services/characterLibraryService.js`（`updateCharacter` 不再接收/写入 `stages`）
- Modify: `backend-node/src/services/characterVariantsService.js`（新增 `generateVariantImage(db, cfg, log, variantId, options)`：照 `propImageGenerationService.generatePropImage` 的流程实现——取 `character_variants.image_prompt` 为空抛 `'VARIANT_PROMPT_MISSING'`，调用与道具生图相同的 image 生成服务，结果写 variant 行 `image_url/local_path/extra_images`）
- Modify: `backend-node/src/routes/episodePackage.js`（Task 7 的 501 占位替换为真实调用）
- Test: `backend-node/test/characterVariantImage.test.js`（生图用测试替身 stub image client，参照 `propImageGenerationService` 现有测试或 comfyui/agnes 测试的替身方式）

- [ ] **Step 1-4: TDD**（updateCharacter 传 stages 不再落库；generateVariantImage 成功写回 image_url、prompt 缺失抛错）
- [ ] **Step 5: Commit** `feat: variant image generation and stages deprecation`

### Task 10: 前端导入向导 + DramaDetail 入口

**Files:**
- Create: `frontweb/src/api/episodePackage.js`
- Create: `frontweb/src/utils/episodePackageMatch.js`（纯函数：`canProceedMatches(matches)` → conflict 且未决策时 false；`summarizeStats(matches)`）
- Create: `frontweb/src/components/EpisodePackageImportDialog.vue`
- Modify: `frontweb/src/views/DramaDetail.vue`（“导入单集制作包”按钮 + 挂对话框；成功后刷新分集列表）
- Modify: `frontweb/src/api/characters.js`（variants CRUD + generate-image 封装）
- Test: `frontweb/test/episodePackageMatch.test.js`

**Interfaces:**
- api 封装（axios 走 `@/utils/request`，参照 `frontweb/src/api/drama.js:61-68`）：
  - `episodePackageAPI.preview({ raw_json_text, filename, drama_id, target_episode_id })`
  - `episodePackageAPI.import({ raw_json_text, source_sha256, drama_id, target_episode_id, filename, decisions })`
- Dialog 交互（Element Plus，spec 8.2 三步）：Step1 文件读取（FileReader text、`.json` 后缀校验、大小 >10MB 拒绝）+ 展示协议版本/生成器/集号/标题/梗概/统计 + 单选“创建新剧集 / 填充空白剧集（下拉选该剧本下的空白集，选项来自 preview.target_status）”；Step2 资产匹配表（每行 radio create/reuse，conflict 行必须选择才能 next，由 `canProceedMatches` 控制）；Step3 分镜预览（按镜号表格：场景/人物状态/道具/动作/对白/时长 + errors 红字阻断、warnings 可勾选确认）；确认调 import，成功 emit `imported(episode_id)`。
- DramaDetail.vue 按钮放“新增一集”旁（`DramaDetail.vue:1064` 附近的操作区），drama_id 取路由参数。

- [ ] **Step 1-4: TDD**（纯函数测试：conflict 未决策 false、全决策 true、stats 汇总正确）。组件本身靠人工验收（无组件测试框架）。
- [ ] **Step 5: Commit** `feat: episode package import wizard`

### Task 11: FilmCreate 人物状态卡片 + 分镜状态选择 + 移除 stages textarea

**Files:**
- Create: `frontweb/src/composables/filmCreate/useCharacterVariants.js`
- Modify: `frontweb/src/views/FilmCreate.vue`（角色区：每张角色卡加“状态”折叠区，列出状态卡（名称/外观/生图按钮/上传/设默认）；分镜区 universal 模式：角色勾选旁加状态下拉（默认“默认状态”），保存时调 `PUT /storyboards/:id/character-variant-links`；删除 `FilmCreate.vue:1798-1812` 的 stages JSON textarea 及相关 ref/提交字段）
- Modify: `frontweb/src/composables/filmCreate/useCharacters.js`（提交 payload 去掉 stages：`useCharacters.js:169,224`）

**Interfaces:**
- Consumes: Task 7 的 variants API、Task 3 的 links API。
- useCharacterVariants(deps) 返回：`variantsByCharacterId`（懒加载 map）、`loadVariants(characterId)`、`openVariantEditor(characterId, variant?)`、`saveVariant()`、`removeVariant(variantId)`、`generateVariantImage(variantId)`、`setVariantDefault(variantId)`。deps 形如现有 `useCharacters.js:18-30` 的注入模式（store、dramaId、pollTask、hasAssetImage 等）。
- 分镜状态选择数据流：分镜行选中角色后，从 `variantsByCharacterId` 取该角色状态列表渲染 el-select（默认值 = 该角色 default 状态 id），变更即调 links API 全量保存（收集该分镜全部角色当前选择）。

- [ ] **Step 1: 实现 composable（带 frontweb 纯逻辑测试：`frontweb/test/useCharacterVariants.test.js` 测默认状态选择与 links 组装的纯函数部分——把“由角色勾选+状态选择组装 links”抽成导出的纯函数 `buildVariantLinks(selections, sortStart=1)` 测试）**
- [ ] **Step 2: FilmCreate 接线**（锚点编辑，每处先 grep 唯一性）
- [ ] **Step 3: 回归** `cd frontweb && node --test test/*.test.js` 全绿；`npm run build` 成功。
- [ ] **Step 4: Commit** `feat: character variant cards and storyboard variant selection`

---

# 第二阶段：统一参考解析和 H3 门禁

### Task 12: 迁移 31 + H3 草稿表

**Files:**
- Create: `backend-node/migrations/31_storyboard_h3_prompt_drafts.sql`
- Modify: `backend-node/src/db/migrate.js`
- Test: `backend-node/test/h3DraftMigration.test.js`

SQL（与迁移文件一致；ensureAllColumns 同步建表）：

```sql
CREATE TABLE IF NOT EXISTS storyboard_h3_prompt_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  video_config_id TEXT,
  source_prompt TEXT,
  source_fingerprint TEXT,
  ai_compiled_prompt TEXT,
  final_compiled_prompt TEXT,
  compiled_prompt_hash TEXT,
  prompt_format TEXT,
  skill_version TEXT,
  skill_provenance TEXT,
  reference_snapshot TEXT,
  generation_params TEXT,
  manually_edited INTEGER DEFAULT 0,
  status TEXT DEFAULT 'valid',
  validation_errors TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_h3_draft_lookup ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, updated_at DESC);
```

- [ ] **Step 1-4: TDD**（同 Task 1 模式） **Step 5: Commit** `feat: h3 prompt draft table`

### Task 13: referenceSlotService + 槽位查询 API

**Files:**
- Create: `backend-node/src/services/referenceSlotService.js`
- Modify: `backend-node/src/routes/storyboards.js`（`GET /storyboards/:id/reference-slots`）
- Test: `backend-node/test/referenceSlotService.test.js`

**Interfaces:**
- Produces:
  - `resolveStoryboardSlots(db, storyboardId, { maxSlots = 9 } = {})` → `{ slots, total, overflow }`；slot `{ index(1-based), type: 'scene'|'character_variant'|'prop', asset_id, variant_id?, name, image_url, image_available, image_version }`。顺序：场景（`storyboards.scene_id`）→ 状态关联（`storyboard_character_variants` 按 sort_order，`listStoryboardVariantLinks`）→ 道具（`storyboard_props` 按 rowid）。图片解析优先级与图生链路一致：`local_path || image_url`（状态用 variant 行，场景/道具用各自行）；`image_version` 取 `image_updated_at`（storyboard 无则资产行 `updated_at`）。**缺图不跳过**（image_available=false 占位）。total > maxSlots 时 overflow = 超出槽位数组。
  - `slotsFingerprint(slots)` → sha256(canonical JSON of slots 的 [index,type,asset_id,variant_id,image_url,image_version])。
- spec 7 的全部规则在此落地；万能提示词 bundle（Task 14）与 H3 编译（Task 15）都调它。

- [ ] **Step 1-4: TDD**（顺序固定；缺图占位；sort_order 排序；9 张溢出 overflow；指纹确定性——同输入两次相同、图片 url 变则变）
- [ ] **Step 5: Commit** `feat: unified reference slot resolver and api`

### Task 14: 万能提示词槽位适配 + field_overrides 修复 + 上限统一

**Files:**
- Modify: `backend-node/src/services/universalSegmentPromptBundle.js`（IMAGE_SLOT_MAP 槽位来源改为 `resolveStoryboardSlots`：编号=槽位 index，**缺图槽位保留占位**不再跳过重排；`force_without_reference_images` 行为不变；接收并消费 `field_overrides`——在构建 bundle 前用 overrides 覆盖 db 读出的分镜字段（title/description/action/dialogue/narration/duration 等，白名单同 storyboardService allowed 的文本字段））
- Modify: `backend-node/src/routes/storyboards.js`（三个 universal 端点把 `req.body.field_overrides` 透传给 bundle）
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js:96-105`（`referenceImages()` 不再 slice(0,10)，改为校验：H3 配置时 >9 抛 `VIDEO_REFERENCE_COUNT_INVALID`，非 H3 保持原语义不变）
- Modify: `frontweb/src/views/FilmCreate.vue`（`collectSbOmniReferenceAbsoluteUrls` 移除 `slice(0, 10)`，注释同步更新）
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js:28-47`（错误映射表加 `VIDEO_REFERENCE_COUNT_INVALID: '参考图数量超出上限（1-9 张），请移除部分参考图后重试'`）
- Test: `backend-node/test/universalBundleSlots.test.js`

**Interfaces:**
- Consumes: Task 13 `resolveStoryboardSlots`。
- 行为契约：某分镜 3 槽位（场景有图、状态缺图、道具有图）→ 生成提示词含 `@图片1/2/3`，`@图片2` 指向缺图状态（现状是只有 2 槽且道 occupied 重编为 2——测试断言新行为）。

- [ ] **Step 1-4: TDD**（slot 固定编号；field_overrides 覆盖 db 值；refs >9 H3 抛错、非 H3 不抛）
- [ ] **Step 5: 前后端全量测试 + build → Commit** `feat: fixed reference slots for universal prompts`

### Task 15: h3PromptDraftService —— 指纹、编译、保存、失效

**Files:**
- Create: `backend-node/src/services/h3PromptDraftService.js`
- Test: `backend-node/test/h3PromptDraftService.test.js`

**Interfaces:**
- Consumes: `h3PromptCompiler`（`backend-node/src/services/h3PromptCompiler.js`）、`h3SkillAgent`、Task 13。
- Produces:
  - `computeSourceFingerprint({ sourcePrompt, slotsFingerprint, durationSeconds, width, height, audioEnabled, videoConfigSnapshot, workflowSha, skillVersion })` → sha256 of canonical JSON（键排序）。
  - `getLatestDraft(db, storyboardId, videoConfigId)` → 行或 null。
  - `compileDraft(db, cfg, log, { storyboardId, videoConfigId })` → draft 行。流程（spec 11.1）：取业务提示词（universal_segment_text 优先，否则 video_prompt）非空校验（`'UNIVERSAL_PROMPT_EMPTY'`）→ `resolveStoryboardSlots`：有缺图槽位 → `'MISSING_REFERENCE_IMAGE'`（details 列明槽位），0 张 → `'REFERENCE_COUNT_INVALID'`，>9 → `'REFERENCE_COUNT_OVERFLOW'` → 组 sourceBundle（复用 `h3PromptCompiler.sourceBundle` 的入参形状）调 `h3SkillAgent` 生成 → `h3PromptCompiler.validateH3Prompt` 校验六段与标签（失败 `'H3_PROMPT_FORMAT_INVALID'`）→ 固化 `reference_snapshot`（slots JSON）与 `generation_params`（duration/resolution/audio/config snapshot）→ 计算 fingerprint 与 `compiled_prompt_hash` → INSERT status='valid' → 返回。
  - `saveDraftText(db, { draftId, finalText, manuallyEdited })` → 仅确定性校验（`validateH3Prompt`）：通过 → status='valid'，否则 'invalid' 且 `validation_errors` 记录；更新 `final_compiled_prompt`/`compiled_prompt_hash`/`manually_edited`；**不改 source_fingerprint**。
  - `evaluateDraftFreshness(db, draft)` → `{ stale: boolean, reasons: [] }`：重算当前 fingerprint 与行内 source_fingerprint 比较；不一致 reasons 列出变化维度（prompt/slots/params/config/skill）。
- fingerprint 输入的 videoConfigSnapshot 与 workflowSha 取自现有 `unifiedVideoGenerationService` 解析结果形状；编译时用与候选生成相同的解析函数，避免两处实现漂移（从 `unifiedVideoGenerationService.js` 导出可复用的 `resolveVideoRuntime(db, cfg, { configId })`，若已有等价函数则复用）。

- [ ] **Step 1-4: TDD**（替身 h3SkillAgent 返回固定六段文本；缺图阻止；9 张上限；指纹变化 → stale；saveDraftText 不改指纹、非法文本 → invalid）
- [ ] **Step 5: Commit** `feat: h3 prompt draft service`

### Task 16: H3 草稿路由 + 候选生成门禁

**Files:**
- Modify: `backend-node/src/routes/storyboards.js`（`GET /storyboards/:id/h3-prompt-draft?video_config_id=`、`POST /storyboards/:id/h3-prompt-draft/compile`、`PUT /storyboards/:id/h3-prompt-draft` body `{ draft_id, final_text, manually_edited }`）
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`（`createVideoGeneration`：`isH3VideoConfig(resolved)` 时**不再内部编译**；要求 `input.h3_prompt_draft_id`（缺失 → `'H3_DRAFT_REQUIRED'`）→ `getLatestDraft` + `evaluateDraftFreshness`（stale → 409 语义 `'H3_DRAFT_STALE'`）→ `draft.status !== 'valid'` → `'H3_DRAFT_INVALID'` → `prompt = draft.final_compiled_prompt`；非 H3 配置完全走旧路径，忽略 h3_prompt_draft_id）
- Modify: `backend-node/src/routes/director.js`（`generationInput` 透传 `h3_prompt_draft_id`：`director.js:120-157`）
- Test: `backend-node/test/h3DraftGating.test.js`

**Interfaces:**
- 候选接口 body 增加 `h3_prompt_draft_id`；后端绝不调用编译器（spec 11.4）。

- [ ] **Step 1-4: TDD**（H3 无 draft → H3_DRAFT_REQUIRED；draft stale → H3_DRAFT_STALE；valid → 提交的 prompt 逐字节等于 final_compiled_prompt 且技能替身调用次数为 0；非 H3 配置无 draft 也能生成）
- [ ] **Step 5: 后端全量回归 → Commit** `feat: h3 draft gating for candidate generation`

### Task 17: 视频抽屉 H3 草稿 UI + 漂移警告

**Files:**
- Modify: `frontweb/src/api/videos.js`（draft 三接口封装 + generate-candidate 透传 h3_prompt_draft_id）
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`（“预览 H3 提示词”按钮改为“生成 H3 提示词”→ 调 compile；H3 文本区可编辑、防抖 800ms 自动保存 PUT、离开抽屉立即补存；状态 chips：AI 生成/已人工修改/来源已变化/结构校验失败；顶部展示当前配置名+ID；`@图片N` 与 reference-slots 不一致时黄色警告条（不阻塞））
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`（打开时 H3 配置则 GET draft 恢复；`evaluateDraftFreshness` 结果映射 stale chip；generate candidate 携带 draft_id 且仅在 valid+指纹一致时可用）
- Modify: `frontweb/src/views/FilmCreate.vue`（`videoGenerationContext` computed 增加从 `GET /storyboards/:id/reference-slots` 拉取的槽位数据传入面板——或由面板自行拉取，二选一按现有 props 流动方向定：面板已收 `generation-context`，推荐由面板在打开时自行拉取槽位，避免扩大 props）
- Test: `frontweb/test/videoPanelH3Draft.test.js`（纯逻辑：防抖保存状态机、stale 判定映射、draft 可用性门禁布尔函数）

**Interfaces:**
- 面板状态机（抽为 `frontweb/src/utils/h3DraftState.js` 纯函数供测试）：`deriveH3DraftUiState({ draft, freshness, saving, structureValid })` → `{ chip, canGenerate }`；`canGenerate = draft && draft.status==='valid' && !freshness.stale && !saving && structureValid !== false`。

- [ ] **Step 1-4: TDD（纯函数）+ 组件接线**
- [ ] **Step 5: 全量回归（前后端）+ `npm run build` → Commit** `feat: h3 draft drawer flow`

### Task 18: 人工验收清单执行与收尾

- [ ] 后端 `node --test test/*.test.js` 全绿；前端 `node --test test/*.test.js` 全绿；`npm run build` 成功。
- [ ] 按 spec 14.4 用 `docs/superpowers/specs/episode-package.example.json` 走一遍手工闭环（启动 dev server，浏览器操作；无法自动化 ComfyUI 的部分验证到“候选请求 payload 组装正确”为止）。
- [ ] `git status` 确认只包含本计划文件；向用户报告改动清单与验证证据，提交与否由用户决定（工作区原含用户未提交改动）。

## Self-Review 记录

- Spec 覆盖：spec §5-§11 → Task 4-7/10-11/13-17；§6.4 episode_imports → Task 1/6；§13 兼容（stages/ZIP/field_overrides/9 张统一/友好文案）→ Task 8/9/14；§14 测试策略分布在各任务。缺口：spec §5.3 voice_profile 未入 variants 表——接受（列留在 characters，导入忽略该字段并计入 warnings，由 Task 5 在 warnings 加 `VOICE_PROFILE_IGNORED`）。
- 类型一致性：`syncStoryboardVariantLinks`、`resolveStoryboardSlots`、`compileDraft` 签名在各任务间已对齐；错误码统一大写下划线。
