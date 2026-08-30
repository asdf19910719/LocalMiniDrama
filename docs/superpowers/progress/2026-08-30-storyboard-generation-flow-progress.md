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

## Simulation Boundary

- Image generation and ChatGPT web capture require external provider credentials/browser login, so automated verification covers task creation, target-scoped reference manifests, assistant/attempt identity, and result import states rather than claiming a real ChatGPT image was generated.
- Video generation uses the configured provider and is covered by lifecycle/candidate tests plus existing local records; a fresh provider render was not started during smoke verification to avoid creating an uncontrolled external job.
- Merge routing and persisted timeline execution are covered by the Director/FFmpeg test fixtures and existing completed local merge record.
- TTS route and missing-configuration behavior were verified; actual audio synthesis requires adding an active TTS provider configuration.
