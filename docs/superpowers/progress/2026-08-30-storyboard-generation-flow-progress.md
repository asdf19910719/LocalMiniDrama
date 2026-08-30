# Storyboard Generation Flow Progress

Plan: `docs/superpowers/plans/2026-08-30-storyboard-generation-flow.md`

## Status

- [x] Task 1: Separate universal and H3 prompt presentation
- [x] Task 2: Bind ChatGPT web image references to the target
- [x] Task 3: Persist and display accurate candidate timing
- [x] Task 4: Normalize storyboard main-image selection
- [x] Task 5: End-to-end local workflow verification

## Evidence Log

- 2026-08-30: Approved design and implementation plan committed as `fdf2dea`.
- 2026-08-30: Task 1 completed. Video drawer keeps the universal business prompt and shows the last compiled H3 prompt separately; candidate projections retain both source and compiled prompts. Frontend focus tests: 18 passed.
- 2026-08-30: Task 2 completed. Character/scene/prop image tasks no longer inherit their own historical image as a reference; ChatGPT task manifests are rebuilt server-side. Backend focus tests: 9 passed.
- 2026-08-30: Task 3 completed. Video generation records persist `started_at`; candidate UI shows exact start timestamp and execution elapsed time. Backend/frontend focus tests: 30/18 passed.
- 2026-08-30: Task 4 completed. Main-image selection now prefers an explicitly bound normal image, then a normal single image, then the configured grid panel, then panel 0; first/last frame selection remains type-bound. Storyboard media tests: 5 passed.
- 2026-08-30: Task 5 completed locally. Backend full suite: 316 passed; frontend full suite: 97 passed; browser-extension suite: 45 passed; frontend production build succeeded. Read-only API smoke flow verified `/health`, drama/storyboards, image history, director candidates, and completed video merge records. TTS request reached the route but correctly stopped with `未配置 TTS 模型`; no active `service_type=tts` configuration exists in the local environment.

- 2026-08-30: Follow-up `UNBOUND_RESULT` investigation found one old attempt emitting 18 duplicate adapter errors while its assistant identity drifted. The ChatGPT adapter now disconnects failed observers after the first error and lets a live `beginAttempt` rebind a replaced/renumbered assistant turn. Regression coverage added for single-error shutdown and identity drift recovery; browser-extension suite: 47 tests passed after rebuilding `content.bundle.js`.
- 2026-08-30: Queue-state follow-up found the live page's `submitted` count was an orphaned task whose external attempt was already `needs_review`; this blocked all six newer queued tasks. `claimNextChatgptTask` now reconciles that mismatch before applying the single-active-task lock, and adapter errors also transition active unified tasks to `needs_review`. Live API check released the orphaned task; unavailable extension sends are now surfaced as `failed` instead of leaving phantom active work.
- 2026-08-30: Investigated rapid multi-image generation report. The latest 7 tasks contained 2 successful attempts (3 imported rows each) and 5 `send_failed` tasks; both successful attempts had one distinct source URL and identical SHA-256 across all 3 rows, proving duplicate DOM `<img>` capture rather than 3 unique images. The queue completion probe also treated `needs_review`/`failed` as "全部完成" because it only checked for an active task. Added regression coverage and fixed ChatGPT result collection to deduplicate source URLs, while queue notifications now fetch the final summary and report review/failed counts instead of claiming success.
- 2026-08-30: Regression verification after the rapid-generation fix: browser-extension 48/48, backend 317/317, frontend 97/97; frontend production build and browser-extension bundle build both exited successfully.
- 2026-08-30: Follow-up on the five `send_failed` tasks: each external attempt remained `ready_to_send` with zero lifecycle events, while the two successful attempts emitted `SUBMITTED` and imported results. This isolates the failure to the workbench-to-extension bridge before ChatGPT submission. The extension already auto-injects the ChatGPT content script on completed provider tabs, reattaches/rebinds sessions, and the workbench bridge returns a bounded timeout; an already-open workbench tab still requires the extension content script to be loaded (reload the extension or workbench tab after installing/updating it).
- 2026-08-30: Image-generation environment checks completed. Added channel-aware backend diagnostics (`GET /api/v1/dramas/:dramaId/image-generation-environment`), browser-extension ChatGPT diagnostics, project status/popup UI, pre-create and pre-send gates, and queue pause/defer/resume behavior so unavailable environments do not fan out failures. Fresh verification: backend 318/318, browser-extension 50/50, frontend 100/100; frontend production build and browser-extension bundle build exited successfully. Live smoke requests for drama 3 returned `canProceed: true` for both `chatgpt_web` and `api` channels with the expected checks.
- 2026-08-30: Environment-check implementation committed on `main` as `17bd02f` (`feat: add image generation environment checks`). Backend/frontend dev servers can apply source changes through watch/Vite hot reload; extension background changes require reloading the unpacked extension and refreshing the workbench tab. Existing untracked workspace files were intentionally left untouched.

## Simulation Boundary

- Image generation and ChatGPT web capture require external provider credentials/browser login, so automated verification covers task creation, target-scoped reference manifests, assistant/attempt identity, and result import states rather than claiming a real ChatGPT image was generated.
- Video generation uses the configured provider and is covered by lifecycle/candidate tests plus existing local records; a fresh provider render was not started during smoke verification to avoid creating an uncontrolled external job.
- Merge routing and persisted timeline execution are covered by the Director/FFmpeg test fixtures and existing completed local merge record.
- TTS route and missing-configuration behavior were verified; actual audio synthesis requires adding an active TTS provider configuration.
