# Production Studio V2.1 Unified Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Project Hub and Production Studio prototypes into one URL-addressable prototype in which every user-visible V2.1 capability has a reachable view and reviewable state.

**Architecture:** Keep the prototype dependency-free and file-openable. A UMD model owns route definitions, scenarios, feature coverage, and deterministic transitions; one HTML file owns the shared shell and view renderers while reusing the two existing domain models.

**Tech Stack:** HTML, CSS, browser JavaScript, CommonJS/UMD, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-09-08-production-studio-v2.1-unified-prototype-design.md`

## Global Constraints

- This is a documentation prototype; it must not call real APIs, SQLite, the filesystem, browser automation, or paid Providers.
- The authoritative entry is `production-studio-v2.1-full-prototype.html`; the existing two HTML prototypes remain historical evidence.
- The prototype must open from a local file without a build step or remote dependency.
- All 52 product features in the migration matrix need a stable `data-feature-id`, a route or overlay, a scenario, and traceability metadata.
- `waiting_external`, task status, content status, Gate, and blocker remain separate concepts.
- Storyboard compiles and preflights video requests; only Cut creates official video tasks and candidates.
- Direct JSON and external-AI result import only create a new episode or fill a blank episode.
- Do not update `CHANGELOG.md`; this plan changes design artifacts, not verified product functionality.
- Preserve unrelated working-tree changes and do not create a Git commit unless the user explicitly requests one.
- After every confirmed page or flow review, update `docs/superpowers/specs/2026-09-08-production-studio-v2.1-page-review-decision-log.md` with the stable decision ID, rationale, affected artifacts, and separate specification/prototype/product-code status.

---

### Task 1: Close the protocol and wording blockers used by the prototype

**Files:**
- Create: `docs/research/localminidrama-product-baseline/production-studio-v2.1-schema-contract.test.cjs`
- Modify: `docs/superpowers/specs/schemas/episode-package-v2.1.schema.json`
- Modify: `docs/superpowers/specs/schemas/external-ai-result-v2.1.schema.json`
- Modify: `docs/superpowers/specs/schemas/shot-package-v2.1.schema.json`
- Modify: `docs/superpowers/specs/2026-09-07-external-ai-lightweight-workflow-design.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-interaction-flow-contracts.md`

**Interfaces:**
- Consumes: the three V2.1 JSON Schemas and the canonical error-code wording in the architecture master.
- Produces: string version `"2.1"`, one error-code taxonomy, and an unambiguous cancellation boundary.

- [x] **Step 1: Write the failing schema contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schemaDir = path.resolve(__dirname, '../../superpowers/specs/schemas');
const names = [
  'episode-package-v2.1.schema.json',
  'external-ai-result-v2.1.schema.json',
  'shot-package-v2.1.schema.json',
];

test('all V2.1 schemas use the canonical string version', () => {
  for (const name of names) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf8'));
    assert.equal(schema.properties.version.const, '2.1', name);
  }
});

```

- [x] **Step 2: Run the test and verify the current numeric constants and duplicate codes fail**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-schema-contract.test.cjs
```

Expected: FAIL on `2.1 !== '2.1'` when any machine contract still uses a numeric version.

- [x] **Step 3: Normalize the contracts**

Change each Schema property to:

```json
"version": { "const": "2.1" }
```

Replace `PACKAGE_INVALID` with `PACKAGE_SCHEMA_INVALID`; replace `PACKAGE_REFERENCE_INVALID` with `PACKAGE_BUSINESS_INVALID` plus a structured reference-error detail. Clarify cancellation as: cancelling a step makes no additional writes in that step, while a project shell explicitly created by an earlier step remains.

- [x] **Step 4: Run the schema contract test**

Run the command from Step 2. Expected: 1 test passes. Error-code wording and cancellation boundaries are reviewed as human-readable specification rather than asserted by brittle source-text tests.

Execution note: the working tree already contained the normalized string versions, canonical error-code table, and clarified cancellation boundary when execution started. The regression test therefore passed immediately and no additional contract mutation was necessary.

### Task 2: Build the unified route, scenario, and transition model

**Files:**
- Create: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Create: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: `ProductionStudioV21ProjectHubModel` and `ProductionStudioV21Model` as optional injected dependencies.
- Produces: `buildPrototypeRouteRegistry()`, `buildFeatureCoverageIndex()`, `parsePrototypeLocation(hash)`, `formatPrototypeLocation(routeId, params, scenarioId)`, `getPageModel(routeId, params, scenarioId)`, and `transitionPrototypeState(state, action)`.

- [x] **Step 1: Write failing route tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./production-studio-v2.1-full-prototype-model.js');

test('route registry exposes every top-level product destination', () => {
  const ids = model.buildPrototypeRouteRegistry().map(item => item.id);
  assert.deepEqual(ids, [
    'projects', 'project-new', 'project-import', 'project-overview',
    'project-bible', 'project-episodes', 'project-assets', 'project-data',
    'studio-script', 'studio-assets', 'studio-storyboard', 'studio-cut',
    'library', 'quick-create', 'canvas', 'settings-ai', 'settings-general',
  ]);
});

test('hash location preserves route params and scenario', () => {
  const hash = model.formatPrototypeLocation(
    'studio-storyboard',
    { projectId: '7', episodeId: '1' },
    'provider-blocked',
  );
  assert.equal(hash, '#/projects/7/episodes/1/storyboard?scenario=provider-blocked');
  assert.deepEqual(model.parsePrototypeLocation(hash), {
    routeId: 'studio-storyboard',
    params: { projectId: '7', episodeId: '1' },
    scenarioId: 'provider-blocked',
  });
});
```

- [x] **Step 2: Run the focused tests**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: FAIL because the unified model does not exist.

- [x] **Step 3: Implement the UMD model and exact route matcher**

The exported wrapper must support both browser globals and `require()`:

```js
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionStudioV21FullPrototypeModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const routes = [
    { id: 'projects', pattern: /^#\/projects$/, params: [], path: () => '/projects', scenarios: ['default', 'empty', 'loading', 'offline', 'no-results', 'task-paused'] },
    { id: 'project-new', pattern: /^#\/projects\/new$/, params: [], path: () => '/projects/new', scenarios: ['default', 'source-selected', 'validation-error', 'creating', 'name-conflict', 'path-unavailable', 'insufficient-space', 'source-cancelled', 'create-failed', 'success'] },
    { id: 'project-import', pattern: /^#\/projects\/import$/, params: [], path: () => '/projects/import', scenarios: ['default', 'unsupported-archive', 'failed', 'succeeded'] },
    { id: 'project-overview', pattern: /^#\/projects\/([^/]+)\/overview$/, params: ['projectId'], path: p => `/projects/${p.projectId}/overview`, scenarios: ['default', 'needs-attention', 'all-complete', 'loading', 'load-failed', 'storage-offline', 'missing'] },
    { id: 'project-bible', pattern: /^#\/projects\/([^/]+)\/bible$/, params: ['projectId'], path: p => `/projects/${p.projectId}/bible`, scenarios: ['default', 'empty', 'conflict'] },
    { id: 'project-episodes', pattern: /^#\/projects\/([^/]+)\/episodes$/, params: ['projectId'], path: p => `/projects/${p.projectId}/episodes`, scenarios: ['default', 'empty', 'source-picker', 'blank-manual', 'ai-script', 'novel-split', 'external-ai-context', 'external-ai-waiting', 'episode-json-import', 'source-video', 'json-target-not-blank', 'asset-match-conflict', 'import-failed', 'import-succeeded'] },
    { id: 'project-assets', pattern: /^#\/projects\/([^/]+)\/assets$/, params: ['projectId'], path: p => `/projects/${p.projectId}/assets`, scenarios: ['default', 'empty', 'library-update', 'publish-blocked'] },
    { id: 'project-data', pattern: /^#\/projects\/([^/]+)\/data$/, params: ['projectId'], path: p => `/projects/${p.projectId}/data`, scenarios: ['default', 'archive-export', 'archive-import', 'migration-failed', 'restore', 'cleanup-blocked'] },
    { id: 'studio-script', pattern: /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/script$/, params: ['projectId', 'episodeId'], path: p => `/projects/${p.projectId}/episodes/${p.episodeId}/script`, scenarios: ['default', 'blocked', 'stale', 'diff', 'save-failed'] },
    { id: 'studio-assets', pattern: /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/assets$/, params: ['projectId', 'episodeId'], path: p => `/projects/${p.projectId}/episodes/${p.episodeId}/assets`, scenarios: ['default', 'blocked', 'stale', 'candidate-compare', 'look-change'] },
    { id: 'studio-storyboard', pattern: /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/storyboard$/, params: ['projectId', 'episodeId'], path: p => `/projects/${p.projectId}/episodes/${p.episodeId}/storyboard`, scenarios: ['default', 'blocked', 'stale', 'multi-segment', 'provider-blocked', 'prompt-gate-failed', 'continuity'] },
    { id: 'studio-cut', pattern: /^#\/projects\/([^/]+)\/episodes\/([^/]+)\/cut$/, params: ['projectId', 'episodeId'], path: p => `/projects/${p.projectId}/episodes/${p.episodeId}/cut`, scenarios: ['default', 'blocked', 'stale', 'candidate-compare', 'retake-failed', 'picture-lock', 'audio-conflict', 'delivery-failed'] },
    { id: 'library', pattern: /^#\/library$/, params: [], path: () => '/library', scenarios: ['default', 'empty', 'offline', 'publish-conflict'] },
    { id: 'quick-create', pattern: /^#\/quick-create$/, params: [], path: () => '/quick-create', scenarios: ['default', 'generating', 'failed', 'succeeded'] },
    { id: 'canvas', pattern: /^#\/canvas$/, params: [], path: () => '/canvas', scenarios: ['default', 'restore-context', 'unsaved'] },
    { id: 'settings-ai', pattern: /^#\/settings\/ai$/, params: [], path: () => '/settings/ai', scenarios: ['default', 'credential-expired', 'connection-failed', 'import-conflict', 'chatgpt-waiting', 'chatgpt-rebind'] },
    { id: 'settings-general', pattern: /^#\/settings\/general$/, params: [], path: () => '/settings/general', scenarios: ['default', 'storage-offline', 'save-conflict'] },
  ];

  function buildPrototypeRouteRegistry() {
    return routes.map(({ pattern, path, ...publicFields }) => ({ ...publicFields }));
  }

  function buildFeatureCoverageIndex() {
    return [];
  }

  function parsePrototypeLocation(hash = '#/projects') {
    const [pathPart, query = ''] = hash.split('?');
    const scenarioId = new URLSearchParams(query).get('scenario') || 'default';
    for (const route of routes) {
      const match = pathPart.match(route.pattern);
      if (!match) continue;
      const params = Object.fromEntries(route.params.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      return { routeId: route.id, params, scenarioId };
    }
    return { routeId: 'projects', params: {}, scenarioId: 'default', notFound: true };
  }

  function formatPrototypeLocation(routeId, params = {}, scenarioId = 'default') {
    const route = routes.find(item => item.id === routeId);
    if (!route) throw new Error(`Unknown route: ${routeId}`);
    const suffix = scenarioId === 'default' ? '' : `?scenario=${encodeURIComponent(scenarioId)}`;
    return `#${route.path(params)}${suffix}`;
  }

  function getPageModel(routeId, params = {}, scenarioId = 'default') {
    return { routeId, params: { ...params }, scenarioId };
  }

  function transitionPrototypeState(state, action) {
    if (state.flow === 'external-ai' && action.type === 'select-result') {
      return { ...state, status: 'validating_result', selectedFile: action.file };
    }
    if (state.routeId === 'studio-storyboard' && action.type === 'save-compile-and-open-cut') {
      return { ...state, routeId: 'studio-cut' };
    }
    return { ...state };
  }

  return { buildPrototypeRouteRegistry, buildFeatureCoverageIndex, parsePrototypeLocation, formatPrototypeLocation, getPageModel, transitionPrototypeState };
}));
```

Unknown hashes resolve to `projects/default` and preserve the `notFound: true` diagnostic for the prototype help panel. Later tasks replace the initially empty coverage array and enrich `getPageModel()` without changing these signatures.

- [x] **Step 4: Add transition tests and implementation**

```js
test('external AI flow resumes the same package attempt', () => {
  const waiting = { flow: 'external-ai', status: 'waiting_external', packageId: 'pkg-21' };
  const validating = model.transitionPrototypeState(waiting, { type: 'select-result', file: 'episode.json' });
  assert.equal(validating.status, 'validating_result');
  assert.equal(validating.packageId, 'pkg-21');
});

test('storyboard compile navigation never creates an official video task', () => {
  const next = model.transitionPrototypeState(
    { routeId: 'studio-storyboard', officialVideoTasks: 0 },
    { type: 'save-compile-and-open-cut' },
  );
  assert.equal(next.routeId, 'studio-cut');
  assert.equal(next.officialVideoTasks, 0);
});
```

Run the focused test after implementation. Expected: all route and transition tests pass.

### Task 3: Add the shared shell and URL-driven renderer

**Files:**
- Create: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: the unified model from Task 2 and the two existing UMD domain models.
- Produces: `renderLocation()`, `navigate(routeId, params, scenarioId)`, `openPrototypeTool(name)`, and one stable DOM root `#prototypePage`.

- [x] **Step 1: Add failing shell contract tests**

```js
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').resolve(
  __dirname,
  'production-studio-v2.1-full-prototype.html',
), 'utf8');

test('unified HTML loads all three models and one page root', () => {
  assert.match(html, /production-studio-v2\.1-project-hub-prototype-model\.js/);
  assert.match(html, /production-studio-v2\.1-prototype-model\.js/);
  assert.match(html, /production-studio-v2\.1-full-prototype-model\.js/);
  assert.equal((html.match(/id="prototypePage"/g) || []).length, 1);
});

test('shell exposes product navigation and prototype tools separately', () => {
  for (const label of ['项目', '资产库', '快速创作', '高级画布', '设置']) assert.match(html, new RegExp(label));
  assert.match(html, /功能覆盖/);
  assert.match(html, /场景切换/);
  assert.match(html, /原型模拟/);
});
```

- [x] **Step 2: Run tests and verify the missing HTML fails**

Run the Task 2 test command. Expected: FAIL reading the missing HTML.

- [x] **Step 3: Implement the shell**

Create semantic regions `<nav>`, `<header>`, `<main id="prototypePage">`, task drawer, coverage drawer, scenario menu, modal layer, toast live region, and `<noscript>`. Product navigation uses `data-route-id`; prototype-only controls use `data-prototype-tool` and a visually distinct dotted border.

`hashchange` and initial `DOMContentLoaded` both call `renderLocation()`. Escape closes the topmost non-dangerous overlay; dangerous confirms ignore backdrop clicks.

- [x] **Step 4: Run tests**

Expected: the shell tests and route tests pass.

### Task 4: Migrate Project Hub and all six source flows

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: existing `buildProjectCards()`, `buildEpisodeRows()`, `buildCreationSources()`, `evaluateImportTarget()`, and `canAdvanceAssetMatches()`.
- Produces: renderers for projects, project detail five-tab shell, creation source picker, direct JSON import, external AI, AI script, novel split, blank/manual, and source video flows.

- [ ] **Step 1: Add coverage and transition tests for six sources**

```js
test('six sources have distinct reachable flow scenarios', () => {
  const coverage = model.buildFeatureCoverageIndex();
  const sources = coverage.filter(item => item.group === 'creation-source');
  assert.deepEqual(sources.map(item => item.id).sort(), [
    'source-ai-script', 'source-blank', 'source-episode-json',
    'source-external-ai', 'source-novel', 'source-video',
  ]);
  assert.equal(new Set(sources.map(item => `${item.routeId}:${item.scenarioId}`)).size, 6);
});

test('non-empty JSON target exposes only safe recovery actions', () => {
  const page = model.getPageModel('project-episodes', { projectId: '7' }, 'json-target-not-blank');
  assert.equal(page.errorCode, 'TARGET_NOT_BLANK');
  assert.deepEqual(page.actions, ['choose-blank-episode', 'create-new-episode', 'cancel']);
});
```

- [ ] **Step 2: Run tests and observe missing coverage**

Expected: FAIL because the coverage index and page model do not yet include all source flows.

- [ ] **Step 3: Implement Project Hub views and source flows**

Use full-page steps for project creation and archive import. Use one modal/sheet for episode source selection. Direct JSON and external-AI result reuse the five-step renderer with source-specific intro, package binding, and error summary. Every source ends at its documented destination and has cancel/failure recovery; no source card may terminate at a generic toast.

- [ ] **Step 4: Run unified and existing Project Hub tests**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-project-hub-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: all tests pass.

### Task 5: Migrate all four Studio stages and their critical branches

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: the existing storyboard model functions and unified navigation.
- Produces: Script, Assets, Storyboard, and Cut renderers with URL-addressable critical states.

- [ ] **Step 1: Add stage-boundary tests**

```js
test('every Studio stage has default, blocked, and stale review states', () => {
  const routes = model.buildPrototypeRouteRegistry().filter(item => item.id.startsWith('studio-'));
  for (const route of routes) {
    assert.ok(route.scenarios.includes('default'), route.id);
    assert.ok(route.scenarios.some(id => id.includes('blocked')), route.id);
    assert.ok(route.scenarios.some(id => id.includes('stale')), route.id);
  }
});

test('official video generation appears only in Cut coverage', () => {
  const items = model.buildFeatureCoverageIndex().filter(item => item.id === 'official-video-generation');
  assert.equal(items.length, 1);
  assert.equal(items[0].routeId, 'studio-cut');
});
```

- [ ] **Step 2: Run tests and verify missing scenarios fail**

Expected: FAIL for incomplete stage scenarios and Cut-only coverage.

- [ ] **Step 3: Implement the four renderers**

Script includes editing, diff, approval, invalidation, and recovery. Assets includes Project Look, character states, scene assets, props, voices, candidates, approval, personal-library entry, and advanced-canvas entry. Storyboard reuses timed-segment and compile logic and adds image candidates, continuity, batch actions, stale and capability-blocked scenarios. Cut includes official video generation, candidates, retake, stable frames, timeline, audio ownership, Picture Lock, post and delivery.

- [ ] **Step 4: Run both existing model tests and the unified tests**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: all tests pass and the original storyboard behavior remains unchanged.

### Task 6: Add global creation, configuration, task, library, and maintenance views

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: shared page cards, drawers, generation sheets, confirmation dialogs, and status components from Tasks 3–5.
- Produces: personal library, quick creation, advanced canvas, AI settings, task center, ChatGPT web generation, migration, deletion, recovery, archive, and cleanup scenarios.

- [ ] **Step 1: Add interaction-contract coverage tests**

```js
test('all ten interaction-contract groups have a reachable demonstration', () => {
  const groups = new Set(model.buildFeatureCoverageIndex().map(item => item.contractGroup));
  assert.deepEqual([...groups].sort(), [
    'ai-config', 'archive', 'chatgpt-web', 'creation-sources', 'external-ai',
    'library', 'migration-delete-cleanup', 'retake-continuity', 'sound-ownership', 'task-queue',
  ]);
});

test('task scenarios expose actions from backend capability flags', () => {
  const paused = model.getPageModel('projects', {}, 'task-paused').taskDrawer.items[0];
  assert.equal(paused.canResume, true);
  assert.equal(paused.actions.includes('resume'), true);
  assert.equal(paused.actions.includes('reorder'), false);
});
```

- [ ] **Step 2: Run tests and verify missing groups fail**

Expected: FAIL until every contract group has at least one reachable feature item.

- [ ] **Step 3: Implement the global views and overlays**

Render every action from the interaction-flow contracts. Connection tests explicitly say they do not generate media. ChatGPT web sessions retain attempt and prompt hashes. Migration uses journal steps and recovery actions. Cleanup shows dry-run paths and blocks referenced artifacts. All destructive actions operate only on simulated state and show a persistent simulation label.

- [ ] **Step 4: Run unified tests**

Expected: all interaction-contract coverage and task-capability tests pass.

### Task 7: Complete feature traceability, navigation, and accessibility behavior

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype-model.js`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs`

**Interfaces:**
- Consumes: all route and feature entries from Tasks 2–6.
- Produces: searchable coverage drawer, scenario deep links, coverage validation, keyboard navigation, focus restoration, and safe overlay closing.

- [ ] **Step 1: Add referential-integrity tests**

```js
test('every feature points to an existing route and scenario', () => {
  const routes = new Map(model.buildPrototypeRouteRegistry().map(item => [item.id, item]));
  const e2eDoc = require('node:fs').readFileSync(require('node:path').resolve(
    __dirname,
    '../../superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md',
  ), 'utf8');
  const knownE2eIds = new Set([...e2eDoc.matchAll(/^\|\s*(A-[A-Z]+\d{2})\s*\|/gm)].map(match => match[1]));
  for (const feature of model.buildFeatureCoverageIndex()) {
    const route = routes.get(feature.routeId);
    assert.ok(route, `${feature.id}: unknown route ${feature.routeId}`);
    assert.ok(route.scenarios.includes(feature.scenarioId), `${feature.id}: unknown scenario ${feature.scenarioId}`);
    assert.ok(feature.e2eIds.length > 0, `${feature.id}: missing E2E link`);
    for (const id of feature.e2eIds) assert.ok(knownE2eIds.has(id), `${feature.id}: unknown E2E ${id}`);
  }
});

test('coverage index includes every legacy capability row', () => {
  const matrix = require('node:fs').readFileSync(require('node:path').resolve(
    __dirname,
    '../../superpowers/specs/2026-09-08-production-studio-v2.1-legacy-feature-migration-matrix.md',
  ), 'utf8');
  const expected = [...matrix.matchAll(/^\|\s*([A-Z]+-\d{2})\s*\|/gm)].map(match => match[1]).sort();
  const covered = [...new Set(model.buildFeatureCoverageIndex().flatMap(item => item.capabilityIds))].sort();
  assert.equal(expected.length, 52);
  assert.deepEqual(covered, expected);
});

test('feature ids and generated deep links are unique', () => {
  const features = model.buildFeatureCoverageIndex();
  assert.equal(new Set(features.map(item => item.id)).size, features.length);
  assert.equal(new Set(features.map(item => item.href)).size, features.length);
});
```

- [ ] **Step 2: Run tests and inspect duplicate or missing links**

Expected: FAIL until all entries have unique routes/scenarios and E2E associations.

- [ ] **Step 3: Implement the coverage drawer and interaction details**

Search indexes label, feature ID, capability ID, E2E ID, page, and scenario. Selecting an item closes the drawer, navigates to its hash, focuses the page heading, and highlights the demonstrated control. Escape closes ordinary overlays; focus returns to the invoking element; dangerous confirms require explicit buttons.

- [ ] **Step 4: Run the complete prototype test set**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/production-studio-v2.1-project-hub-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-prototype.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-schema-contract.test.cjs docs/research/localminidrama-product-baseline/production-studio-v2.1-full-prototype.test.cjs
```

Expected: all existing and unified tests pass.

### Task 8: Switch the documentation entry and verify the review baseline

**Files:**
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-interaction-ui-spec.md`
- Modify: `docs/research/localminidrama-product-baseline/localminidrama-screenshot-catalog.md`
- Modify: `docs/research/localminidrama-product-baseline/README.md`
- Modify: `docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-project-hub-prototype.html`
- Modify: `docs/research/localminidrama-product-baseline/production-studio-v2.1-prototype.html`

**Interfaces:**
- Consumes: the tested full prototype and coverage index.
- Produces: one authoritative documentation link, historical labels on old prototypes, and the page-by-page review starting point.

- [ ] **Step 1: Add a documentation-link assertion**

```js
test('UI spec names the full prototype as authoritative', () => {
  const spec = require('node:fs').readFileSync(require('node:path').resolve(
    __dirname,
    'production-studio-v2.1-interaction-ui-spec.md',
  ), 'utf8');
  assert.match(spec, /production-studio-v2\.1-full-prototype\.html/);
  assert.match(spec, /所有用户可见功能/);
});
```

- [ ] **Step 2: Run the unified tests and verify the old links fail the assertion**

Expected: FAIL because the UI spec still names two partial prototypes.

- [ ] **Step 3: Update documentation and historical labels**

Point the UI spec, README, screenshot catalog, and E2E prototype evidence to the full prototype. State that old HTML files are historical evidence and add a visible link from each old file to the authoritative prototype. Replace the old “prototype only needs high-risk branches” wording with the completion definition from the unified-prototype design while preserving the distinction between prototype and product implementation.

- [ ] **Step 4: Perform browser interaction inspection**

Open the full prototype from its local file and verify:

```text
projects/default → project episodes → all six sources
project episodes/external-ai-waiting → validating → five-step import
studio storyboard/provider-blocked → split or switch model
studio storyboard/default → save compile → studio cut/default
studio cut/retake-failed → retry → candidate comparison
settings AI/credential-expired → waiting_external → recovered
project data/migration-failed → report → restore instructions
```

For each route, refresh and confirm the hash restores the same state.

- [ ] **Step 5: Run final verification**

Run:

```powershell
node --test docs/research/localminidrama-product-baseline/*.test.cjs
git diff --check
```

Expected: all tests pass; `git diff --check` exits 0; no product source file or `CHANGELOG.md` is modified.
