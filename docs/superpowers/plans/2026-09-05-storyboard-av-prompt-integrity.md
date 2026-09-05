# Storyboard Audiovisual Prompt Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve visual, audio, BGM, transition, continuity, reference, and production metadata across external JSON import and story-to-storyboard generation through H3 compilation and final episode mixing.

**Architecture:** Both entry flows map into one canonical audiovisual contract, persist through one repository boundary, and feed one storyboard generation-context builder. H3 generation remains fail-closed around validated drafts, while every UI entry uses a preparation service that creates or reuses the correct draft; final mixing treats generated clip audio as a base layer instead of replacing it.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3, Node.js test runner, Vue 3, Vite, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-09-05-storyboard-av-prompt-integrity-design.md`

**Review revision:** The plan incorporates the 2026-09-05 pre-implementation review covering speech ownership, field-level locks, H3 audio classification, cross-language coverage evidence, Canvas and FreeCreate entry boundaries, legacy explicit-null behavior, Director base audio, and ordinary visual-transition/subtitle timing.

## Global Constraints

- Preserve existing user changes in the dirty worktree and stage only files belonging to the current task.
- Use additive, idempotent SQLite migrations; do not rewrite existing episode or storyboard rows.
- Default legacy episodes with no explicit music information to `bgm.mode = "none"`.
- Never infer that BGM is enabled from atmosphere, emotion, genre, or visual prompt text.
- Keep `createVideoGeneration()` fail-closed for H3; only the higher-level preparation service may compile a missing or stale draft.
- Preserve original H3/generated-video audio whenever dialogue, narration, subtitles, watermarking, or BGM post-processing is enabled.
- Do not invoke a paid or remote music-generation service as part of this implementation.
- Run backend tests with `cd backend-node && node --test test/*.test.js`, frontend tests with `cd frontweb && node --test test/*.test.js`, and the frontend build with `cd frontweb && npm run build`.

---

## File Structure

**New backend files**

- `backend-node/migrations/34_storyboard_av_contract.sql`: additive episode, storyboard, and scene columns.
- `backend-node/src/services/storyboardAvContractService.js`: lossless JSON normalization and validation.
- `backend-node/src/services/storyboardCanonicalRepository.js`: canonical storyboard projection and persistence.
- `backend-node/src/services/episodeAudioPlanService.js`: episode-wide audio planning and persistence.
- `backend-node/src/services/storyboardGenerationContextService.js`: complete context for universal and H3 prompt generation.
- `backend-node/src/services/h3PromptSemanticValidator.js`: deterministic cross-field H3 checks.
- `backend-node/src/services/h3PromptSemanticReviewService.js`: cross-language audio-event coverage review and persisted evidence.
- `backend-node/src/services/preparedVideoGenerationService.js`: create/reuse H3 draft before strict generation submission.
- `backend-node/src/services/episodeAudioMixService.js`: deterministic FFmpeg audio-layer planning.

**New frontend files**

- `frontweb/src/api/episodeAudio.js`: episode audio-plan endpoints.
- `frontweb/src/components/episode/AudioPlanPanel.vue`: episode and per-shot audio controls.

**New primary tests**

- `backend-node/test/storyboardAvContractService.test.js`
- `backend-node/test/storyboardCanonicalRepository.test.js`
- `backend-node/test/episodePackageAvRoundtrip.test.js`
- `backend-node/test/episodeAudioPlanService.test.js`
- `backend-node/test/storyboardGenerationContextService.test.js`
- `backend-node/test/h3PromptSemanticValidator.test.js`
- `backend-node/test/preparedVideoGenerationService.test.js`
- `backend-node/test/episodeAudioMixService.test.js`
- `backend-node/test/storyboardAvPipelineIntegration.test.js`
- `backend-node/test/helpers/storyboardAvFixtures.js`: in-memory migrated database plus deterministic episode, package, context, and valid-H3 fixture builders shared by the new backend tests.
- `frontweb/test/episodeAudioPlan.test.js`
- `frontweb/test/h3GenerationEntryPoints.test.js`

---

### Task 1: Add the canonical audiovisual schema and normalizers

**Files:**

- Create: `backend-node/migrations/34_storyboard_av_contract.sql`
- Modify: `backend-node/src/db/migrate.js`
- Create: `backend-node/src/services/storyboardAvContractService.js`
- Create: `backend-node/test/storyboardAvContractService.test.js`
- Modify: `backend-node/test/episodePackageMigration.test.js`

**Interfaces:**

- Produces: `normalizeEpisodeAudioPlan(value, options) -> object`
- Produces: `normalizeStoryboardAudioDescription(value, options) -> object`
- Produces: `normalizeStoryboardTransition(value) -> object`
- Produces: `serializeCanonicalJson(value) -> string`
- Produces: `normalizeFieldState(value) -> object`
- Produces columns: `episodes.audio_plan`, `episodes.production_profile`, `storyboards.is_primary`, `storyboards.production_metadata`, `scenes.atmosphere`, `storyboard_h3_prompt_drafts.coverage_manifest`, `storyboard_h3_prompt_drafts.semantic_review_status`, `storyboard_h3_prompt_drafts.semantic_review_confirmed`

- [ ] **Step 1: Write failing normalization tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEpisodeAudioPlan,
  normalizeStoryboardAudioDescription,
  normalizeStoryboardTransition,
  normalizeFieldState,
  serializeCanonicalJson,
} = require('../src/services/storyboardAvContractService');

test('legacy text audio is retained losslessly', () => {
  assert.deepEqual(normalizeStoryboardAudioDescription('雨声与脚步声'), {
    version: 1,
    ambience: [],
    sound_effects: [],
    dialogue_treatment: null,
    diegetic_music: null,
    silence: false,
    music_cue: { mode: 'mute', prompt: null, intensity: 0, start: null, end: null },
    raw_description: '雨声与脚步声',
    extensions: {},
    provenance: { source: 'legacy' },
  });
});

test('episode BGM accepts exactly three modes', () => {
  for (const mode of ['none', 'episode_track', 'per_segment']) {
    assert.equal(normalizeEpisodeAudioPlan({ bgm: { mode } }).bgm.mode, mode);
  }
  assert.throws(() => normalizeEpisodeAudioPlan({ bgm: { mode: 'ambient_guess' } }), /AUDIO_PLAN_INVALID/);
});

test('canonical serialization is key-order stable', () => {
  assert.equal(serializeCanonicalJson({ b: 2, a: 1 }), serializeCanonicalJson({ a: 1, b: 2 }));
});

test('unknown audio and transition keys survive in extensions', () => {
  assert.deepEqual(normalizeStoryboardAudioDescription({ ambient: '雨声', vendor_gain: 3 }).extensions, { vendor_gain: 3 });
  assert.deepEqual(normalizeStoryboardTransition({ to_next: '硬切', vendor_curve: 'x' }).extensions, { vendor_curve: 'x' });
});

test('dialogue and narration owners are independent validated fields', () => {
  const plan = normalizeEpisodeAudioPlan({ speech: { dialogue_owner: 'h3_native', narration_owner: 'post_tts' } });
  assert.equal(plan.speech.dialogue_owner, 'h3_native');
  assert.equal(plan.speech.narration_owner, 'post_tts');
  assert.throws(() => normalizeEpisodeAudioPlan({ speech: { dialogue_owner: 'both' } }), /AUDIO_PLAN_INVALID/);
});

test('field state preserves source lock and revision', () => {
  assert.deepEqual(normalizeFieldState({
    'audio_description.music_cue.prompt': { source: 'manual', locked: true, revision: 4 },
  })['audio_description.music_cue.prompt'], { source: 'manual', locked: true, revision: 4, updated_at: null });
});
```

- [ ] **Step 2: Run the new tests and verify the module/columns are missing**

Run:

```powershell
cd backend-node
node --test test/storyboardAvContractService.test.js test/episodePackageMigration.test.js
```

Expected: FAIL because `storyboardAvContractService` and the four additive columns do not exist.

- [ ] **Step 3: Add the idempotent migration**

```sql
ALTER TABLE episodes ADD COLUMN audio_plan TEXT;
ALTER TABLE episodes ADD COLUMN production_profile TEXT;
ALTER TABLE storyboards ADD COLUMN is_primary INTEGER DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN production_metadata TEXT;
ALTER TABLE scenes ADD COLUMN atmosphere TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN coverage_manifest TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN semantic_review_status TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN semantic_review_confirmed INTEGER DEFAULT 0;
```

Also add matching `ensureColumns()` entries in `src/db/migrate.js` so databases created outside the migration runner converge to the same schema.

- [ ] **Step 4: Implement strict, lossless normalizers**

Implement defaults exactly as the spec defines. Parse object values directly, parse JSON object strings, wrap ordinary strings in `raw_description`, move unknown keys to `extensions`, clamp `music_cue.intensity` to `0..1`, validate independent dialogue/narration owners against `h3_native|post_tts|none`, normalize field-level source/lock/revision state, and throw an error with `code = 'AUDIO_PLAN_INVALID'` for invalid modes or shapes.

- [ ] **Step 5: Run focused tests**

```powershell
cd backend-node
node --test test/storyboardAvContractService.test.js test/episodePackageMigration.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add backend-node/migrations/34_storyboard_av_contract.sql backend-node/src/db/migrate.js backend-node/src/services/storyboardAvContractService.js backend-node/test/storyboardAvContractService.test.js backend-node/test/episodePackageMigration.test.js
git commit -m "feat: add canonical storyboard audiovisual contract"
```

---

### Task 2: Make canonical projection and PATCH persistence the only read/write boundary

**Files:**

- Create: `backend-node/src/services/storyboardCanonicalRepository.js`
- Modify: `backend-node/src/services/storyboardService.js`
- Modify: `backend-node/src/services/dramaService.js`
- Modify: `backend-node/src/routes/storyboards.js`
- Modify: `backend-node/src/routes/drama.js`
- Create: `backend-node/test/storyboardCanonicalRepository.test.js`
- Modify: `backend-node/test/dramaStoryboardVariantLinks.test.js`

**Interfaces:**

- Consumes: Task 1 normalizers and serializers.
- Produces: `projectStoryboardRow(row, links) -> canonical API object`
- Produces: `saveCanonicalStoryboard(db, episodeId, input, options) -> projected storyboard`
- Produces: `patchStoryboard(db, storyboardId, patch, { clearFields }) -> projected storyboard`
- Produces: `applyFieldStatePatch(currentState, valuePatch, { source, lock, unlockFields, now }) -> fieldState`
- Produces: `projectEpisodeRow(row) -> episode object with parsed audio_plan and production_profile`

- [ ] **Step 1: Write failing repository tests**

```js
test('projection returns parsed AV fields and primary marker', () => {
  const projected = projectStoryboardRow({
    id: 7,
    audio_description: JSON.stringify({ version: 1, ambience: ['rain'] }),
    transition: JSON.stringify({ version: 1, type: 'cut', duration: 0 }),
    layout_description: 'left/right anchor',
    is_primary: 1,
    characters: '[]',
  }, []);
  assert.deepEqual(projected.audio_description.ambience, ['rain']);
  assert.equal(projected.transition.type, 'cut');
  assert.equal(projected.layout_description, 'left/right anchor');
  assert.equal(projected.is_primary, true);
});

test('patch does not null fields absent from the request', () => {
  patchStoryboard(db, storyboardId, { title: 'renamed' }, { clearFields: [] });
  const row = db.prepare('SELECT title, layout_description, audio_description, transition FROM storyboards WHERE id = ?').get(storyboardId);
  assert.equal(row.title, 'renamed');
  assert.equal(row.layout_description, 'anchor');
  assert.match(row.audio_description, /rain/);
  assert.match(row.transition, /cut/);
});

test('explicit clear_fields clears only named nullable fields', () => {
  patchStoryboard(db, storyboardId, {}, { clearFields: ['transition'] });
  const row = db.prepare('SELECT audio_description, transition FROM storyboards WHERE id = ?').get(storyboardId);
  assert.notEqual(row.audio_description, null);
  assert.equal(row.transition, null);
});

test('legacy explicit null still clears existing nullable scalar fields', () => {
  patchStoryboard(db, storyboardId, { video_url: null, first_frame_image_id: null }, { clearFields: [] });
  const row = db.prepare('SELECT video_url, first_frame_image_id, audio_description FROM storyboards WHERE id = ?').get(storyboardId);
  assert.equal(row.video_url, null);
  assert.equal(row.first_frame_image_id, null);
  assert.notEqual(row.audio_description, null);
});

test('manual patch atomically locks only changed leaf paths', () => {
  patchStoryboard(db, storyboardId, {
    audio_description: { music_cue: { prompt: 'manual piano' } },
  }, { source: 'manual', clearFields: [] });
  const row = db.prepare('SELECT audio_description, production_metadata FROM storyboards WHERE id = ?').get(storyboardId);
  const meta = JSON.parse(row.production_metadata);
  assert.equal(meta.field_state['audio_description.music_cue.prompt'].locked, true);
  assert.equal(meta.field_state['audio_description.music_cue.prompt'].source, 'manual');
});
```

- [ ] **Step 2: Run the repository tests and verify failure**

```powershell
cd backend-node
node --test test/storyboardCanonicalRepository.test.js test/dramaStoryboardVariantLinks.test.js
```

Expected: FAIL because the canonical repository and complete API projection do not exist.

- [ ] **Step 3: Implement canonical projection and persistence**

Use an explicit column map for scalar fields and Task 1 serializers for JSON fields. `saveCanonicalStoryboard()` must be used by create, incremental-save, final overwrite, and import callers. `patchStoryboard()` must distinguish an absent property from an explicit `null`; existing nullable scalar and sidecar fields keep their `field: null` clear behavior, while `clear_fields` is an additive alternative. Nested AV objects use leaf-level merge semantics and atomically update `production_metadata.field_state`.

- [ ] **Step 4: Replace incomplete projections**

Change `dramaService.rowToStoryboard()` and single-storyboard responses to include parsed `layout_description`, `audio_description`, `transition`, `emotion`, `emotion_intensity`, `is_primary`, `continuity_snapshot`, and canonical `character_variant_links`. Change episode projection to include parsed `audio_plan` and `production_profile`.

- [ ] **Step 5: Extend the storyboard update route**

Accept `audio_description`, `transition`, `is_primary`, `clear_fields`, and `unlock_fields`; normalize JSON inputs before writing. PATCH values authored by the user set changed leaf paths to `source=manual, locked=true` and increment their revision. `unlock_fields` returns named paths to AI management without changing their current values. Reject unknown clear/unlock paths with HTTP 400 and `code: 'STORYBOARD_PATCH_INVALID'`.

- [ ] **Step 6: Run focused tests**

```powershell
cd backend-node
node --test test/storyboardCanonicalRepository.test.js test/dramaStoryboardVariantLinks.test.js test/universalBundleSlots.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add backend-node/src/services/storyboardCanonicalRepository.js backend-node/src/services/storyboardService.js backend-node/src/services/dramaService.js backend-node/src/routes/storyboards.js backend-node/src/routes/drama.js backend-node/test/storyboardCanonicalRepository.test.js backend-node/test/dramaStoryboardVariantLinks.test.js
git commit -m "fix: preserve complete storyboard AV projection"
```

---

### Task 3: Route external episode packages through the canonical contract

**Files:**

- Modify: `backend-node/src/services/episodePackageSchema.js`
- Modify: `backend-node/src/services/episodePackageValidator.js`
- Modify: `backend-node/src/services/episodePackageService.js`
- Modify: `backend-node/src/services/dramaExportService.js`
- Modify: `backend-node/src/services/dramaImportService.js`
- Create: `backend-node/test/episodePackageAvRoundtrip.test.js`
- Modify: `backend-node/test/episodePackageService.test.js`
- Modify: `backend-node/test/dramaPackageRoundtrip.test.js`

**Interfaces:**

- Consumes: Task 1 contract and Task 2 repository.
- Produces: package `audio_plan` and `is_primary` schema support.
- Produces: deterministic legacy per-shot music compatibility conversion.
- Produces: import report entries `{ path, action, severity, message }`.

- [ ] **Step 1: Write failing package round-trip tests**

```js
test('package AV fields survive import, API projection, export, and re-import', async () => {
  const pkg = makePackage({
    audio_plan: { bgm: { mode: 'per_segment', prompt: 'low strings' } },
    character: { voice_profile: '低沉克制的成年女声' },
    scene: { atmosphere: '湿冷压抑', negative_prompt: 'sunlight' },
    storyboard: {
      composition: 'subject frame-right',
      audio_description: { ambience: ['rain'], sound_effects: ['door scrape'] },
      transition: { type: 'cut', audio_bridge: { mode: 'carry', duration_ms: 300 } },
      is_primary: true,
    },
  });
  const first = await importPackage(db, pkg);
  const projected = loadDrama(db, first.drama_id);
  assert.equal(projected.episodes[0].audio_plan.bgm.mode, 'per_segment');
  assert.equal(projected.characters[0].voice_style, '低沉克制的成年女声');
  assert.deepEqual(projected.storyboards[0].audio_description.sound_effects, ['door scrape']);
  assert.equal(projected.storyboards[0].transition.audio_bridge.mode, 'carry');
  assert.equal(projected.storyboards[0].is_primary, true);
  const exported = exportDrama(db, first.drama_id);
  const second = await importDrama(db2, exported);
  assert.deepEqual(loadDrama(db2, second.drama_id).episodes[0].audio_plan, projected.episodes[0].audio_plan);
});

test('legacy explicit shot music enables per_segment without AI inference', async () => {
  const pkg = makePackageWithTwoShots();
  pkg.storyboards[0].audio_description = { non_diegetic_music: 'restrained piano' };
  const imported = await importPackage(db, pkg);
  const episode = loadEpisode(db, imported.episode_id);
  assert.equal(episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(loadShot(db, imported.episode_id, 1).audio_description.music_cue.mode, 'override');
  assert.equal(loadShot(db, imported.episode_id, 2).audio_description.music_cue.mode, 'mute');
});
```

- [ ] **Step 2: Run package tests and verify failure**

```powershell
cd backend-node
node --test test/episodePackageAvRoundtrip.test.js test/episodePackageService.test.js test/dramaPackageRoundtrip.test.js
```

Expected: FAIL because `audio_plan`, `voice_profile`, scene atmosphere, and canonical AV projections are incomplete.

- [ ] **Step 3: Extend schema and validation**

Add optional top-level `audio_plan`, optional storyboard `is_primary`, and strict enum validation for BGM and music-cue modes. Continue accepting string or object `audio_description` and `transition` for compatibility.

- [ ] **Step 4: Replace direct storyboard INSERT mapping**

Map each package storyboard with `mapPackageStoryboardToCanonical()` and save through `saveCanonicalStoryboard()`. Persist `generation_profile` to `episodes.production_profile`, `audio_plan` to `episodes.audio_plan`, `voice_profile` to `characters.voice_style`, scene atmosphere/negative prompt, and prop negative prompt.

- [ ] **Step 5: Add import projection verification and report output**

Before transaction commit, reload imported entities through canonical projections and compare counts, ordering, AV fields, voice style, production profile, and reference-link semantics. Throw `PACKAGE_PROJECTION_MISMATCH` on a lossy mismatch.

- [ ] **Step 6: Extend full-project ZIP round-trip**

Export and import `episodes.audio_plan`, `episodes.production_profile`, `storyboards.is_primary`, and `scenes.atmosphere` alongside existing AV and reference fields.

- [ ] **Step 7: Run focused tests**

```powershell
cd backend-node
node --test test/episodePackageSchema.test.js test/episodePackageValidator.test.js test/episodePackageService.test.js test/episodePackageAvRoundtrip.test.js test/dramaPackageRoundtrip.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add backend-node/src/services/episodePackageSchema.js backend-node/src/services/episodePackageValidator.js backend-node/src/services/episodePackageService.js backend-node/src/services/dramaExportService.js backend-node/src/services/dramaImportService.js backend-node/test/episodePackageAvRoundtrip.test.js backend-node/test/episodePackageService.test.js backend-node/test/dramaPackageRoundtrip.test.js
git commit -m "fix: preserve package audiovisual production data"
```

---

### Task 4: Preserve story-generated production fields and plan episode audio once

**Files:**

- Create: `backend-node/src/services/episodeAudioPlanService.js`
- Modify: `backend-node/src/services/storyGenerationService.js`
- Modify: `backend-node/src/services/backgroundExtractionService.js`
- Modify: `backend-node/src/services/episodeStoryboardService.js`
- Modify: `backend-node/src/services/promptI18n.js`
- Create: `backend-node/test/episodeAudioPlanService.test.js`
- Create: `backend-node/test/episodeStoryboardAvMapping.test.js`

**Interfaces:**

- Consumes: Task 1 contract and Task 2 repository.
- Produces: `createEpisodeAudioPlanService({ generateText })`.
- Produces: `ensureEpisodeAudioPlan(db, log, { episodeId, force }) -> audioPlan`.
- Produces: `mapAiStoryboardToCanonical(aiStoryboard, context) -> canonicalStoryboard`.

- [ ] **Step 1: Write failing AI mapping tests**

```js
test('AI storyboard production fields are persisted structurally', () => {
  const canonical = mapAiStoryboardToCanonical({
    shot_number: 2,
    layout_description: 'woman left, door right',
    bgm_prompt: 'restrained strings',
    sound_effect: 'metal door scrape',
    emotion: 'tense',
    emotion_intensity: 3,
    is_primary: true,
  }, { episodeAudioPlan: { bgm: { mode: 'per_segment' } } });
  assert.equal(canonical.layout_description, 'woman left, door right');
  assert.deepEqual(canonical.audio_description.sound_effects, ['metal door scrape']);
  assert.equal(canonical.audio_description.music_cue.prompt, 'restrained strings');
  assert.equal(canonical.emotion_intensity, 3);
  assert.equal(canonical.is_primary, true);
});

test('background extraction persists atmosphere', async () => {
  await processBackgroundExtractionWithResult(db, [{ location: 'warehouse', time: 'night', prompt: '...', atmosphere: 'cold and damp' }]);
  assert.equal(db.prepare('SELECT atmosphere FROM scenes').get().atmosphere, 'cold and damp');
});
```

- [ ] **Step 2: Write the failing episode-wide planning test**

```js
test('AI audio planning is one episode-wide call and persists every cue', async () => {
  let calls = 0;
  const service = createEpisodeAudioPlanService({ generateText: async (_db, _log, input) => {
    calls += 1;
    assert.match(input, /SHOT 1/);
    assert.match(input, /SHOT 2/);
    return JSON.stringify({
      episode_bgm: { prompt: 'shared low strings', continuity_key: 'main_theme' },
      storyboard_cues: [
        { storyboard_number: 1, mode: 'inherit', intensity: 0.3, start: 'fade_in', end: 'continue' },
        { storyboard_number: 2, mode: 'mute', intensity: 0, start: 'cut', end: 'silence' },
      ],
    });
  }});
  await service.ensureEpisodeAudioPlan(db, log, { episodeId, force: false });
  await service.ensureEpisodeAudioPlan(db, log, { episodeId, force: false });
  assert.equal(calls, 1);
  assert.equal(loadShot(db, episodeId, 2).audio_description.music_cue.mode, 'mute');
});

test('AI replanning refreshes prior AI fields but preserves manually locked leaves', async () => {
  seedShotWithFieldState(db, {
    musicPrompt: 'manual piano',
    soundEffects: ['old AI door sound'],
    fieldState: {
      'audio_description.music_cue.prompt': { source: 'manual', locked: true, revision: 2 },
      'audio_description.sound_effects': { source: 'story_ai', locked: false, revision: 1 },
    },
  });
  await service.ensureEpisodeAudioPlan(db, log, { episodeId, force: true });
  const shot = loadShot(db, episodeId, 1);
  assert.equal(shot.audio_description.music_cue.prompt, 'manual piano');
  assert.deepEqual(shot.audio_description.sound_effects, ['new planned door sound']);
});
```

- [ ] **Step 3: Run new tests and verify failure**

```powershell
cd backend-node
node --test test/episodeAudioPlanService.test.js test/episodeStoryboardAvMapping.test.js
```

Expected: FAIL because the mapper and audio-plan service do not exist and current INSERT/UPDATE paths omit production fields.

- [ ] **Step 4: Implement canonical AI mapping in every save path**

Replace the divergent incremental INSERT, final UPDATE, fallback INSERT, and split-row persistence with `mapAiStoryboardToCanonical()` plus `saveCanonicalStoryboard()`. Preserve layout, BGM prompt, sound effect, emotion intensity, primary marker, lighting, depth of field, characters, props, and narration.

- [ ] **Step 5: Persist scene atmosphere and retain richer story metadata**

Pass `atmosphere` into scene creation. Extend episode story normalization to retain recognized production metadata under `production_profile.extensions` instead of deleting it, while continuing to expose `episode`, `title`, and `content` to existing callers.

- [ ] **Step 6: Implement episode-wide audio planning**

Only call the text model when `audio_plan.bgm.mode === 'per_segment'`, `planning === 'ai'`, and a complete plan is absent or `force === true`. Validate that each returned storyboard number exists exactly once; persist the episode plan and all cues in one transaction. Never infer BGM mode inside this service. Apply AI results leaf by leaf: refresh unlocked prior-AI fields and leave every manually locked path unchanged.

- [ ] **Step 7: Enrich the storyboard AI prompt context**

Supply the current episode script/segment, detailed current-episode characters and variants, scenes with atmosphere and negative prompts, props with scale/state/negative prompts, production profile, audio plan, and previous-shot ending state. Preserve existing language and style behavior.

- [ ] **Step 8: Run focused tests**

```powershell
cd backend-node
node --test test/episodeAudioPlanService.test.js test/episodeStoryboardAvMapping.test.js test/episodeGenerationProgressService.test.js test/universalBundleSlots.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```powershell
git add backend-node/src/services/episodeAudioPlanService.js backend-node/src/services/storyGenerationService.js backend-node/src/services/backgroundExtractionService.js backend-node/src/services/episodeStoryboardService.js backend-node/src/services/promptI18n.js backend-node/test/episodeAudioPlanService.test.js backend-node/test/episodeStoryboardAvMapping.test.js
git commit -m "fix: preserve story-generated AV planning fields"
```

---

### Task 5: Build one complete Generation Context for universal and H3 prompts

**Files:**

- Create: `backend-node/src/services/storyboardGenerationContextService.js`
- Modify: `backend-node/src/services/universalSegmentPromptBundle.js`
- Modify: `backend-node/src/services/referenceSlotService.js`
- Modify: `backend-node/src/routes/storyboards.js`
- Create: `backend-node/test/storyboardGenerationContextService.test.js`
- Modify: `backend-node/test/universalBundleSlots.test.js`

**Interfaces:**

- Consumes: Tasks 1-4 data and repositories.
- Produces: `buildStoryboardGenerationContext(db, storyboardId, options) -> GenerationContextV1`.
- Produces: `generationContextFingerprint(context) -> sha256 hex`.
- Produces reference slots with `entity_type`, `entity_id`, `entity_name`, `reference_role`, `variant`, `framing_note`, `image_url`, optional `audio_url`, and version data.

- [ ] **Step 1: Write a failing full-context test**

```js
test('universal prompt presence does not hide AV sidecars', () => {
  seedEpisode(db, { audio_plan: { bgm: { mode: 'per_segment', prompt: 'shared theme' } } });
  seedStoryboard(db, {
    universal_segment_text: 'woman opens the door @图片1',
    video_prompt: 'legacy visual prompt。音效：door scrape',
    audio_description: { ambience: ['rain'], sound_effects: ['door scrape'], music_cue: { mode: 'inherit', intensity: 0.7 } },
    transition: { type: 'cut', audio_bridge: { mode: 'carry', duration_ms: 300 } },
  });
  const context = buildStoryboardGenerationContext(db, storyboardId);
  assert.equal(context.storyboard.visual_prompt, 'woman opens the door @图片1');
  assert.deepEqual(context.audio.sound_effects, ['door scrape']);
  assert.equal(context.episode.audio_plan.bgm.mode, 'per_segment');
  assert.equal(context.transition.audio_bridge.mode, 'carry');
});
```

- [ ] **Step 2: Write failing reference-semantic and fingerprint tests**

```js
test('reference role and framing note participate in the context fingerprint', () => {
  const before = buildStoryboardGenerationContext(db, storyboardId);
  db.prepare('UPDATE storyboard_character_variants SET framing_note = ? WHERE storyboard_id = ?').run('keep wet coat', storyboardId);
  const after = buildStoryboardGenerationContext(db, storyboardId);
  assert.notEqual(generationContextFingerprint(before), generationContextFingerprint(after));
  assert.equal(after.references[0].framing_note, 'keep wet coat');
});
```

- [ ] **Step 3: Run tests and verify failure**

```powershell
cd backend-node
node --test test/storyboardGenerationContextService.test.js test/universalBundleSlots.test.js
```

Expected: FAIL because no unified context exists and current slot fingerprints omit semantic metadata.

- [ ] **Step 4: Implement the context builder**

Load the storyboard, episode, drama style, parsed AV fields, previous/next storyboard summaries, continuity snapshot, scene/prop/character negative prompts, and canonical reference slots in one service. Apply visual prompt priority only to `storyboard.visual_prompt`; never remove sidecars.

- [ ] **Step 5: Make universal prompt generation consume the context**

Replace its independent field query with the context builder. Before the universal prompt route builds context, call `ensureEpisodeAudioPlan()` when the episode explicitly uses `per_segment` plus `planning=ai` and has not been planned. Add structured `AUDIO_PLAN`, `AUDIO_DESCRIPTION`, `TRANSITION_PLAN`, and `REFERENCE_SLOT_MAP` blocks to the model input, while keeping the saved `universal_segment_text` format backward compatible.

- [ ] **Step 6: Extend slot fingerprinting**

Include reference role, variant/state identity, framing note, entity name/type, asset timestamps, normalized image URL, reference-audio URL, and audio version. Keep the existing scene → character variant → prop ordering and nine-image limit for pictures; audio labels use an independent sequence.

- [ ] **Step 7: Run focused tests**

```powershell
cd backend-node
node --test test/storyboardGenerationContextService.test.js test/universalBundleSlots.test.js test/dramaStoryboardVariantLinks.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add backend-node/src/services/storyboardGenerationContextService.js backend-node/src/services/universalSegmentPromptBundle.js backend-node/src/services/referenceSlotService.js backend-node/src/routes/storyboards.js backend-node/test/storyboardGenerationContextService.test.js backend-node/test/universalBundleSlots.test.js
git commit -m "feat: build complete storyboard generation context"
```

---

### Task 6: Compile and validate H3 prompts against AV policy

**Files:**

- Create: `backend-node/src/services/h3PromptSemanticValidator.js`
- Create: `backend-node/src/services/h3PromptSemanticReviewService.js`
- Modify: `backend-node/src/services/h3PromptCompiler.js`
- Modify: `backend-node/src/services/h3PromptDraftService.js`
- Modify: `backend-node/src/director/adapters/h3DirectorR2VAdapter.js`
- Modify: `backend-node/src/routes/storyboards.js`
- Modify: `frontweb/src/api/h3Draft.js`
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `backend-node/test/h3PromptCompiler.test.js`
- Modify: `backend-node/test/h3PromptDraftService.test.js`
- Create: `backend-node/test/h3PromptSemanticValidator.test.js`
- Modify: `backend-node/test/h3DraftGating.test.js`
- Modify: `backend-node/test/directorWorkflowRegistry.test.js`

**Interfaces:**

- Consumes: `GenerationContextV1` and `generationContextFingerprint()` from Task 5.
- Produces: `validateH3PromptSemantics(compiledPrompt, context, options) -> { ok, errors }`.
- Produces: `reviewH3AudioCoverage(db, log, { compiledPrompt, context }) -> { status, manifest }`, where status is `covered|missing|uncertain`.
- Produces error codes: `H3_AUDIO_POLICY_MISMATCH`, `H3_REFERENCE_SEMANTICS_INVALID`, `H3_DIALOGUE_MISMATCH`, `H3_SPEECH_OWNERSHIP_MISMATCH`, `H3_TIMELINE_INVALID`, `H3_SEMANTIC_REVIEW_REQUIRED`.

- [ ] **Step 1: Write failing BGM policy tests**

```js
test('none and episode_track reject invented non-diegetic music', () => {
  for (const mode of ['none', 'episode_track']) {
    const context = makeContext({ bgmMode: mode });
    const result = validateH3PromptSemantics(validH3Prompt({ music: 'A tense string score.' }), context);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'H3_AUDIO_POLICY_MISMATCH');
  }
});

test('per_segment inherit requires a concrete music description', () => {
  const context = makeContext({ bgmMode: 'per_segment', cueMode: 'inherit', episodePrompt: 'low strings' });
  assert.equal(validateH3PromptSemantics(validH3Prompt({ music: 'N/A' }), context).ok, false);
  assert.equal(validateH3PromptSemantics(validH3Prompt({ music: 'Low strings with a restrained rise.' }), context).ok, true);
});

test('audio disabled requires N/A soundscape and music', () => {
  const context = makeContext({ audioEnabled: false });
  assert.equal(validateH3PromptSemantics(validH3Prompt({ soundscape: 'Rain.', music: 'N/A' }), context).ok, false);
});

test('reference audio uses the same Audio label in context, draft, and runtime snapshot', async () => {
  const context = makeContext({ referenceAudio: { audio_url: '/static/voices/lin-xia.wav', entity_name: 'Lin Xia' } });
  const draft = await compileFromContext(context);
  assert.match(draft.final_compiled_prompt, /<Audio 1>.*Lin Xia/s);
  assert.equal(JSON.parse(draft.reference_snapshot).audio[0].audio_url, '/static/voices/lin-xia.wav');
});
```

- [ ] **Step 2: Write failing preservation tests**

```js
test('deterministic validator rejects missing native dialogue and reference semantics', () => {
  const context = makeContext({
    dialogue: '有人在里面吗？',
    dialogueOwner: 'h3_native',
    references: [{ slot: 1, entity_name: 'Lin Xia', reference_role: 'character_identity' }],
  });
  const result = validateH3PromptSemantics(validH3Prompt({ body: '[Shot 1] A door opens.' }), context);
  assert.deepEqual(new Set(result.errors.map((item) => item.code)), new Set([
    'H3_DIALOGUE_MISMATCH',
    'H3_REFERENCE_SEMANTICS_INVALID',
  ]));
});

test('post_tts forbids audible H3 dialogue and prevents duplicate ownership', () => {
  const context = makeContext({ dialogue: '有人在里面吗？', dialogueOwner: 'post_tts' });
  const result = validateH3PromptSemantics(validH3Prompt({ body: '[Shot 1] (S1) says <d>[Chinese] 有人在里面吗？</d>.' }), context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'H3_SPEECH_OWNERSHIP_MISMATCH');
});

test('cross-language sound coverage is reviewed through a manifest, not substring matching', async () => {
  const review = await reviewH3AudioCoverage(db, log, {
    context: makeContext({ sounds: [{ id: 'sfx_1', source_text: '金属门摩擦声', target_shot: 1 }] }),
    compiledPrompt: validH3Prompt({ body: '[Shot 1] The rusty door produces a harsh metallic scrape.' }),
  });
  assert.equal(review.status, 'covered');
  assert.deepEqual(review.manifest.events[0], {
    id: 'sfx_1', source_text: '金属门摩擦声', canonical_en: 'harsh metallic door scrape', target_shot: 1, status: 'covered', evidence: 'harsh metallic scrape',
  });
});
```

- [ ] **Step 3: Run H3 tests and verify failure**

```powershell
cd backend-node
node --test test/h3PromptSemanticValidator.test.js test/h3PromptCompiler.test.js test/h3PromptDraftService.test.js test/h3DraftGating.test.js
```

Expected: FAIL because H3 compilation currently receives only prompt text, duration, and URL strings.

- [ ] **Step 4: Change compiler input to Generation Context**

Generate compiler guidance for `subject_definitions`, stable `<Picture N>/<Subject N>/<Audio N>` bindings, `overall_soundscape`, and `non_diegetic_music`. Put dialogue, narration, singing, diegetic music, and shot-synchronized sound bridges in the relevant `[Shot N]` of `detailed_description`; restrict `overall_soundscape` to ambience, physical sounds, and non-verbal vocal sound summaries. For `h3_native`, preserve the owned language text in its original language; for `post_tts|none`, omit audible language content and add an explicit no-audible-speech constraint. Keep H3 Ref2VA section order unchanged.

- [ ] **Step 5: Add semantic validation after structural validation**

Deterministically validate structure order, reference labels, BGM policy, speech ownership, native-dialogue exact text, timing, and audio switch. Do not use substring matching to compare Chinese source events with English H3 prose. Run the model-backed coverage reviewer for ambience, effects, diegetic music, and synchronized bridges; persist its event-level evidence in `coverage_manifest`. Mark `missing` as `invalid` and `uncertain` as `needs_review`. Add a confirmation operation that sets `semantic_review_confirmed=1` only for the current compiled prompt hash; any edit, recompile, or source-fingerprint change clears it. Manual draft save must repeat both validation levels. Do not submit invalid, stale, or unconfirmed `needs_review` drafts.

- [ ] **Step 6: Replace the source fingerprint**

Use the complete context fingerprint plus video config, workflow hash, dimensions, audio flag, and compiler version. Persist the full normalized context and semantic reference snapshot in the draft for audit.

- [ ] **Step 7: Make the H3 adapter honor the audio switch**

Map `audioEnabled=false` to the workflow's disabled/no-audio mode instead of always hardcoding `audioMode = "generate"`. Pass ordered reference-audio inputs from the validated draft snapshot to the workflow adapter; reject a mismatch between `<Audio N>` labels and submitted audio assets.

- [ ] **Step 8: Expose uncertain semantic review without bypassing the gate**

Show event-level `coverage_manifest` evidence in the H3 panel when status is `needs_review`. The confirmation action sends the displayed draft ID and compiled prompt hash; the backend rejects a stale/hash-mismatched confirmation. After confirmation, candidate generation may proceed only while the same source fingerprint and prompt hash remain current.

- [ ] **Step 9: Run focused H3 tests**

```powershell
cd backend-node
node --test test/h3PromptSemanticValidator.test.js test/h3PromptCompiler.test.js test/h3PromptDraftService.test.js test/h3DraftGating.test.js test/h3DraftMigration.test.js test/directorWorkflowRegistry.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit Task 6**

```powershell
git add backend-node/src/services/h3PromptSemanticValidator.js backend-node/src/services/h3PromptSemanticReviewService.js backend-node/src/services/h3PromptCompiler.js backend-node/src/services/h3PromptDraftService.js backend-node/src/director/adapters/h3DirectorR2VAdapter.js backend-node/src/routes/storyboards.js frontweb/src/api/h3Draft.js frontweb/src/components/video/VideoGenerationPanel.vue frontweb/src/composables/useVideoGenerationPanel.js backend-node/test/h3PromptSemanticValidator.test.js backend-node/test/h3PromptCompiler.test.js backend-node/test/h3PromptDraftService.test.js backend-node/test/h3DraftGating.test.js backend-node/test/directorWorkflowRegistry.test.js frontweb/test/videoGenerationPanel.test.js
git commit -m "fix: enforce H3 audiovisual prompt semantics"
```

---

### Task 7: Unify all video generation entries behind H3 draft preparation

**Files:**

- Create: `backend-node/src/services/preparedVideoGenerationService.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/src/routes/videos.js`
- Modify: `backend-node/src/routes/director.js`
- Modify: `backend-node/src/routes/index.js`
- Modify: `frontweb/src/api/videos.js`
- Modify: `frontweb/src/api/director.js`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/src/composables/useCanvasWorkflowRunner.js`
- Modify: `frontweb/src/composables/useCanvasEpisodeGenerate.js`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/views/FreeCreate.vue`
- Create: `backend-node/test/preparedVideoGenerationService.test.js`
- Create: `frontweb/test/h3GenerationEntryPoints.test.js`
- Modify: `backend-node/test/unifiedVideoGenerationService.test.js`

**Interfaces:**

- Consumes: strict `createVideoGeneration()` and Task 6 draft service.
- Produces: `prepareAndCreateVideoGeneration(input) -> { generation, draft, reusedDraft }`.
- Produces: `prepareAndCreateMany(inputs, options) -> per-item results`.

- [ ] **Step 1: Write a failing backend preparation test**

```js
test('H3 preparation compiles once, reuses fresh draft, and submits its id', async () => {
  const calls = { compile: 0, create: [] };
  const drafts = {
    getFresh: () => null,
    compile: async () => { calls.compile += 1; return { id: 42, status: 'valid' }; },
  };
  const service = createPreparedVideoGenerationService({
    resolveRuntime: () => ({ isH3: true }),
    drafts,
    createVideoGeneration: async (input) => { calls.create.push(input); return { id: 9 }; },
  });
  await service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'business prompt' });
  assert.equal(calls.compile, 1);
  assert.equal(calls.create[0].h3_prompt_draft_id, 42);
});

test('non-H3 preparation never invokes the H3 compiler', async () => {
  let compiled = false;
  const service = makePreparedService({ isH3: false, onCompile: () => { compiled = true; } });
  await service.prepareAndCreateVideoGeneration({ storyboard_id: 7, prompt: 'cloud prompt' });
  assert.equal(compiled, false);
});
```

- [ ] **Step 2: Write a failing frontend entry-point test**

```js
test('all storyboard-bound callers use the prepared endpoint', async () => {
  const files = [
    '../src/views/FilmCreate.vue',
    '../src/composables/useCanvasWorkflowRunner.js',
    '../src/composables/useCanvasEpisodeGenerate.js',
    '../src/composables/useVideoGenerationPanel.js',
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.equal(sources.some((source) => /videosAPI\.create\(/.test(source)), false);
  assert.equal(sources.some((source) => /prepareAndCreate/.test(source)), true);
});

test('FreeCreate rejects storyboard-bound H3 but preserves non-H3 generation', async () => {
  const h3 = await submitFreeCreate({ providerCapabilities: { requiresStoryboardH3Draft: true } });
  assert.equal(h3.error.code, 'H3_STORYBOARD_REQUIRED');
  const cloud = await submitFreeCreate({ providerCapabilities: { requiresStoryboardH3Draft: false } });
  assert.equal(cloud.submitted, true);
});
```

- [ ] **Step 3: Run focused tests and verify failure**

```powershell
cd backend-node
node --test test/preparedVideoGenerationService.test.js test/unifiedVideoGenerationService.test.js
cd ..\frontweb
node --test test/h3GenerationEntryPoints.test.js test/videoGenerationPanel.test.js
```

Expected: FAIL because quick and batch paths still bypass a unified preparation boundary.

- [ ] **Step 4: Implement the preparation service**

Resolve the configured provider once. For H3, reuse a fresh valid draft or compile one, then pass its ID, validated image order, validated audio-reference order, and required generation parameters into strict generation. For non-H3, keep current behavior. Deduplicate concurrent preparation by `(storyboardId, videoConfigId, workflowId, sourceFingerprint)`.

- [ ] **Step 5: Add prepared single and batch routes**

Expose prepared generation through the existing videos route family. Batch results must be ordered like inputs and contain `{ storyboard_id, status, generation_id, error }`; one failure must not abort unrelated items.

- [ ] **Step 6: Migrate all frontend callers**

Replace direct calls in `FilmCreate.vue`, both Canvas workflow composables, the video panel composable, and Director candidate submission with the prepared API. Preserve the panel's manually edited valid draft: preparation must reuse it when its fingerprint is current. Make `FreeCreate.vue` filter or reject capabilities that require a storyboard-bound H3 draft; add a backend `H3_STORYBOARD_REQUIRED` check so direct API calls cannot bypass the UI.

- [ ] **Step 7: Run focused tests**

```powershell
cd backend-node
node --test test/preparedVideoGenerationService.test.js test/unifiedVideoGenerationService.test.js test/h3DraftGating.test.js test/directorGenerationRoutes.test.js
cd ..\frontweb
node --test test/h3GenerationEntryPoints.test.js test/videoGenerationPanel.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```powershell
git add backend-node/src/services/preparedVideoGenerationService.js backend-node/src/services/unifiedVideoGenerationService.js backend-node/src/routes/videos.js backend-node/src/routes/director.js backend-node/src/routes/index.js frontweb/src/api/videos.js frontweb/src/api/director.js frontweb/src/composables/useVideoGenerationPanel.js frontweb/src/composables/useCanvasWorkflowRunner.js frontweb/src/composables/useCanvasEpisodeGenerate.js frontweb/src/views/FilmCreate.vue frontweb/src/views/FreeCreate.vue backend-node/test/preparedVideoGenerationService.test.js frontweb/test/h3GenerationEntryPoints.test.js backend-node/test/unifiedVideoGenerationService.test.js
git commit -m "fix: prepare H3 drafts for every generation entry"
```

---

### Task 8: Preserve generated audio and implement all three BGM mix modes

**Files:**

- Create: `backend-node/src/services/episodeAudioMixService.js`
- Modify: `backend-node/src/services/mergedEpisodePostProcess.js`
- Modify: `backend-node/src/services/videoMergeService.js`
- Modify: `backend-node/src/routes/videoMerges.js`
- Modify: `backend-node/src/director/timelineService.js`
- Modify: `backend-node/src/director/directorPostproductionService.js`
- Create: `backend-node/test/episodeAudioMixService.test.js`
- Modify: `backend-node/test/videoMergeDirectorTimeline.test.js`
- Modify: `backend-node/test/videoMergeUpscaleIntegration.test.js`
- Modify: `backend-node/test/timelineService.test.js`
- Modify: `backend-node/test/directorPostproductionService.test.js`

**Interfaces:**

- Consumes: episode `audio_plan`, normalized transitions, merged input, dialogue tracks, and narration tracks.
- Produces: `buildEpisodeAudioMixPlan(input) -> { inputs, filterComplex, maps, codecArgs }`.
- Produces: `runEpisodeAudioMix(plan, deps) -> outputPath`.

- [ ] **Step 1: Write failing deterministic plan tests**

```js
test('dialogue and narration are mixed over base audio instead of replacing it', () => {
  const plan = buildEpisodeAudioMixPlan({
    baseHasAudio: true,
    bgmMode: 'none',
    dialoguePath: 'dialogue.wav',
    narrationPath: 'narration.wav',
    durationSeconds: 6,
  });
  assert.match(plan.filterComplex, /\[0:a\]/);
  assert.match(plan.filterComplex, /amix/);
  assert.doesNotDeepEqual(plan.maps, ['1:a']);
});

test('episode_track adds one BGM input while per_segment does not', () => {
  const episode = buildEpisodeAudioMixPlan({ baseHasAudio: true, bgmMode: 'episode_track', bgmPath: 'score.wav', durationSeconds: 6 });
  const segments = buildEpisodeAudioMixPlan({ baseHasAudio: true, bgmMode: 'per_segment', bgmPath: 'score.wav', durationSeconds: 6 });
  assert.equal(episode.inputs.includes('score.wav'), true);
  assert.equal(segments.inputs.includes('score.wav'), false);
});

test('missing base audio creates a silent base layer', () => {
  const plan = buildEpisodeAudioMixPlan({ baseHasAudio: false, bgmMode: 'none', durationSeconds: 6 });
  assert.match(plan.filterComplex, /anullsrc/);
});

test('speech ownership selects exactly one source per language layer', () => {
  const native = buildEpisodeAudioMixPlan({ baseHasAudio: true, dialogueOwner: 'h3_native', dialoguePath: 'dialogue.wav', durationSeconds: 6 });
  assert.equal(native.inputs.includes('dialogue.wav'), false);
  const post = buildEpisodeAudioMixPlan({ baseHasAudio: true, dialogueOwner: 'post_tts', dialoguePath: 'dialogue.wav', durationSeconds: 6 });
  assert.equal(post.inputs.includes('dialogue.wav'), true);
});
```

- [ ] **Step 2: Add an FFmpeg spectral integration test**

Generate three six-second sine tracks at 220 Hz (base), 440 Hz (dialogue), and 880 Hz (BGM), mux the base into a synthetic video, execute the production mix, and use `ffmpeg -af astats` or decoded PCM frequency analysis to assert that all expected frequencies remain present. Repeat with `per_segment` and assert that the 880 Hz episode track is absent. Run ownership variants and assert `h3_native` does not add the 440 Hz TTS track while `post_tts` adds it once.

- [ ] **Step 3: Run audio tests and verify failure**

```powershell
cd backend-node
node --test test/episodeAudioMixService.test.js test/videoMergeDirectorTimeline.test.js test/videoMergeUpscaleIntegration.test.js
```

Expected: FAIL because current post-processing maps the generated dialogue/narration track as the only output audio.

- [ ] **Step 4: Implement a pure mix-plan builder**

Build FFmpeg inputs and filters without executing them. Preserve `[0:a]` when present; otherwise synthesize silence. Add each dialogue/narration layer only when its owner is `post_tts`, use sidechain ducking, add episode BGM only for `episode_track`, apply configured fades, then normalize to target LUFS and true peak.

- [ ] **Step 5: Use one audio timeline for transitions and mixing**

Replace Director's video-only timeline with paired video/audio chains: each clip uses `trim,setpts` plus `atrim,asetpts`; missing audio gets an equal-duration silent stream. Hard cuts concat both chains, while timed visual `xfade` uses matching `acrossfade` or the explicit `audio_bridge`. Apply the same normalized boundaries in ordinary episode merge. For `per_segment`, crossfade existing clip audio; for `none` and `episode_track`, preserve physical sound continuity without inventing music.

- [ ] **Step 6: Replace the destructive audio mapping in merged post-processing**

Route ordinary and Director dialogue, narration, subtitle, watermark, and BGM post-processing through `episodeAudioMixService`. Director postproduction must include `[0:a]` in its mix. Keep watermark-only audio stream copying behavior and preserve input files until the new output is probed successfully.

- [ ] **Step 7: Add ordinary visual-transition and subtitle-timeline coverage**

For compatible all-hard-cut inputs with identical audio topology, retain the current concat-copy fast path. Otherwise build the filtered timeline and test `xfade`, transition-overlap total duration, matching audio boundaries, silent replacement for a clip without audio, and narration subtitle timestamps computed from the overlapped output timeline rather than the raw sum of clip durations.

- [ ] **Step 8: Run focused audio tests**

```powershell
cd backend-node
node --test test/episodeAudioMixService.test.js test/videoMergeDirectorTimeline.test.js test/videoMergeUpscaleIntegration.test.js test/timelineService.test.js test/directorPostproductionService.test.js
```

Expected: PASS when FFmpeg is available; platform tests must skip with an explicit reason only when `ffmpeg` or `ffprobe` is unavailable.

- [ ] **Step 9: Commit Task 8**

```powershell
git add backend-node/src/services/episodeAudioMixService.js backend-node/src/services/mergedEpisodePostProcess.js backend-node/src/services/videoMergeService.js backend-node/src/routes/videoMerges.js backend-node/src/director/timelineService.js backend-node/src/director/directorPostproductionService.js backend-node/test/episodeAudioMixService.test.js backend-node/test/videoMergeDirectorTimeline.test.js backend-node/test/videoMergeUpscaleIntegration.test.js backend-node/test/timelineService.test.js backend-node/test/directorPostproductionService.test.js
git commit -m "fix: preserve generated audio in episode mixes"
```

---

### Task 9: Add episode audio controls and complete end-to-end regression coverage

**Files:**

- Create: `frontweb/src/api/episodeAudio.js`
- Create: `frontweb/src/components/episode/AudioPlanPanel.vue`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `backend-node/src/routes/drama.js`
- Modify: `backend-node/src/routes/index.js`
- Create: `frontweb/test/episodeAudioPlan.test.js`
- Create: `backend-node/test/storyboardAvPipelineIntegration.test.js`
- Modify: `docs/changelog.md`

**Interfaces:**

- Consumes: episode audio-plan service, canonical PATCH API, H3 preparation, and audio mix from Tasks 1-8.
- Produces: `PATCH /api/episodes/:id/audio-plan`.
- Produces: `POST /api/episodes/:id/audio-plan/plan`.
- Produces: user-facing BGM modes `none`, `episode_track`, and `per_segment`.

- [ ] **Step 1: Write failing frontend state tests**

```js
test('mode switching preserves inactive configuration and marks H3 drafts stale', async () => {
  const harness = createAudioPlanHarness({
    bgm: { mode: 'episode_track', local_path: 'music/main.wav', prompt: 'shared theme' },
  });
  await harness.setMode('per_segment');
  assert.equal(harness.model.bgm.local_path, 'music/main.wav');
  assert.equal(harness.model.bgm.mode, 'per_segment');
  assert.equal(harness.events.some((event) => event.name === 'h3-stale'), true);
});

test('dialogue and narration ownership controls are saved independently', async () => {
  const harness = createAudioPlanHarness();
  await harness.saveEpisode({ speech: { dialogue_owner: 'post_tts', narration_owner: 'none' } });
  assert.equal(harness.lastEpisodePatch.speech.dialogue_owner, 'post_tts');
  assert.equal(harness.lastEpisodePatch.speech.narration_owner, 'none');
});

test('per-shot audio editor sends normalized patch fields', async () => {
  const harness = createAudioPlanHarness();
  await harness.saveShot({
    ambience: ['rain'],
    sound_effects: ['door scrape'],
    music_cue: { mode: 'override', prompt: 'low piano', intensity: 0.5 },
  });
  assert.deepEqual(harness.lastShotPatch.audio_description.sound_effects, ['door scrape']);
});
```

- [ ] **Step 2: Write two failing end-to-end backend flow tests**

```js
test('external package preserves AV context through H3 draft compilation', async () => {
  const imported = await importExternalFixture(db, externalPackageFixture());
  const draft = await compileH3Draft(db, imported.storyboardIds[0]);
  assert.match(draft.final_compiled_prompt, /rain/i);
  assert.match(draft.final_compiled_prompt, /door scrape/i);
  assert.match(draft.final_compiled_prompt, /non_diegetic_music:\s+N\/A/i);
});

test('story outline preserves planned per-segment BGM through H3 compilation', async () => {
  const episode = await runStoryFixture(db, storyOutlineFixture(), { bgmMode: 'per_segment' });
  const draft = await compileH3Draft(db, episode.storyboardIds[0]);
  assert.match(draft.final_compiled_prompt, /non_diegetic_music:\s+(?!N\/A)/i);
  assert.equal(loadEpisode(db, episode.id).audio_plan.bgm.continuity_key, 'episode_main_theme');
});
```

- [ ] **Step 3: Run new tests and verify failure**

```powershell
cd backend-node
node --test test/storyboardAvPipelineIntegration.test.js
cd ..\frontweb
node --test test/episodeAudioPlan.test.js
```

Expected: FAIL because the UI controls and end-to-end route wiring are not complete.

- [ ] **Step 4: Add episode audio-plan routes**

PATCH validates and persists a user-authored plan. POST `/plan` invokes `ensureEpisodeAudioPlan(..., { force: true })` only after the user explicitly requests AI planning. Return the updated episode and per-shot cues. Validate any local BGM path against the configured storage/media roots before persistence and again before FFmpeg execution; reject traversal and arbitrary absolute paths.

- [ ] **Step 5: Implement the audio-plan panel**

Provide Chinese controls for the three BGM modes, episode prompt, continuity key, BGM file/media path, levels/fades, independent dialogue/narration ownership, and per-shot ambience/effects/diegetic music/cue mode/intensity/ownership overrides. Keep inactive mode configuration in the model. Show locked/manual field state and provide “恢复 AI 管理”. Show a clear stale-draft badge after audio or speech ownership changes.

- [ ] **Step 6: Complete both end-to-end fixtures**

Inject deterministic text-model/compiler doubles; assert stored canonical data, universal bundle contents, H3 context, final draft music policy, reference semantics, and stale behavior without running real AI or H3 inference.

- [ ] **Step 7: Update changelog and run the complete verification suite**

```powershell
cd backend-node
node --test test/*.test.js
cd ..\frontweb
node --test test/*.test.js
npm run build
```

Expected: all tests PASS and Vite build exits 0.

- [ ] **Step 8: Perform one local manual acceptance pass**

Use one imported episode and one story-generated episode. For each, verify the normal project page shows saved audio and transition fields, compile one H3 draft, confirm the expected `non_diegetic_music` policy, create or reuse a short local candidate without invoking a paid cloud Provider, and merge synthetic/local media to confirm base audio remains audible.

- [ ] **Step 9: Commit Task 9**

```powershell
git add frontweb/src/api/episodeAudio.js frontweb/src/components/episode/AudioPlanPanel.vue frontweb/src/views/FilmCreate.vue backend-node/src/routes/drama.js backend-node/src/routes/index.js frontweb/test/episodeAudioPlan.test.js backend-node/test/storyboardAvPipelineIntegration.test.js docs/changelog.md
git commit -m "feat: expose episode audiovisual production controls"
```

---

## Final Verification

- [ ] Confirm `git diff --check` reports no whitespace errors.
- [ ] Confirm both complete test suites pass.
- [ ] Confirm `npm run build` succeeds.
- [ ] Confirm the implementation did not stage unrelated pre-existing files.
- [ ] Confirm imported and story-generated fixtures both retain AV data through H3 compilation.
- [ ] Confirm each BGM mode produces the specified H3 and merge behavior.
- [ ] Confirm dialogue/narration post-processing preserves generated base audio.
- [ ] Confirm every storyboard-bound video-generation entry uses prepared H3 drafts.
- [ ] Confirm Canvas uses prepared H3 drafts and FreeCreate rejects storyboard-bound H3 without affecting non-H3 generation.
- [ ] Confirm Director and ordinary merge both preserve per-clip audio, visual transition overlap, and subtitle timing.
- [ ] Confirm each dialogue/narration layer has exactly one active owner and AI replanning preserves locked manual fields.
