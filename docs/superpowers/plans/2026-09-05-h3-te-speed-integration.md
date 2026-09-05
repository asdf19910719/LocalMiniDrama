# H3 TE-Speed Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, reproducible MiniMax H3 Director R2V workflow variant that uses the original TE-Speed 3.3 node with SageAttention while preserving the existing official + Sage workflow as the default and rollback path.

**Architecture:** Probe the original binary in an isolated ComfyUI runtime, export its actual node schema, then register a second immutable API workflow. The existing ComfyUI provider and H3 adapter remain the execution boundary; adapter v2 validates the acceleration graph, snapshots record exact provenance, and no running task silently changes algorithms.

**Tech Stack:** Node.js 22, Express, Vue 3, ComfyUI 0.33.1, Python 3.13, PyTorch 2.13+cu130, MiniMax H3 Director, SageAttention, original TE-Speed 3.3.

**Spec:** `docs/superpowers/specs/2026-09-05-h3-te-speed-integration-design.md`

## Global Constraints

- Preserve `minimax_h3_director_r2v` unchanged as the default official + Sage workflow.
- Use 20 steps, `simple`, `res_multistep`, video shift 12, audio shift 3 for both A/B variants.
- Do not enable Spectrum, PDD, Turbo LoRA, 4-step, 8-step, or Sol-Attn in this implementation.
- Do not commit or redistribute the original `nodes.pyd`; record its repository commit and SHA-256 as runtime provenance only.
- Do not silently fall back from TE-Speed to the official workflow inside an existing task.
- Run the original binary only in an isolated ComfyUI copy until the compatibility and A/B gates pass.

---

### Task 1: Runtime probe and provenance capture

**Files:**
- Create: `backend-node/scripts/probeH3TeSpeedRuntime.js`
- Create: `backend-node/test/h3TeSpeedRuntimeProbe.test.js`
- Create after a successful probe: `docs/research/_artifacts/h3-te-speed-original-2026-09-05/runtime-manifest.json`

**Interfaces:**
- Consumes: a ComfyUI base URL and an installed `TE-Speed-MiniMaxH3` directory.
- Produces: `probeRuntime({ baseUrl, pluginDir, fetchImpl }) -> Promise<manifest>` and a JSON manifest containing commit, hashes, versions, node schema, and compatibility result.

- [ ] **Step 1: Write the failing runtime-probe tests**

Cover a valid `TESpeedMiniMaxH3` schema, missing node, failed `/object_info`, and secret-free manifest serialization. Use a temporary directory containing fixture `nodes.pyd` and `__init__.py` bytes, and inject a fake `fetchImpl`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/h3TeSpeedRuntimeProbe.test.js` from `backend-node`.

Expected: FAIL because `probeH3TeSpeedRuntime.js` does not exist.

- [ ] **Step 3: Implement the minimal probe**

Implement SHA-256 with `node:crypto`, commit discovery with `git -C $pluginDir rev-parse HEAD`, GET requests to `/object_info/TESpeedMiniMaxH3` and `/system_stats`, and validation that `TESpeedMiniMaxH3` has one MODEL input and one MODEL output. Redact URL credentials/query/fragment before writing the manifest.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/h3TeSpeedRuntimeProbe.test.js`.

Expected: all runtime-probe tests PASS.

- [ ] **Step 5: Prepare the isolated runtime and install the original node**

Create an isolated ComfyUI code copy using the execution-time worktree procedure, reuse model directories through `extra_model_paths.yaml`, clone `https://github.com/tl2012tl/TE-Speed-MiniMaxH3` into its `custom_nodes`, and record `git rev-parse HEAD`. Do not modify the production ComfyUI directory.

- [ ] **Step 6: Start the isolated ComfyUI and run the real probe**

Start on a non-production port, wait for `/system_stats`, then run the probe script. Expected: ComfyUI stays running, `TESpeedMiniMaxH3` appears in `/object_info`, and the manifest contains non-empty 64-character hashes and the exact node input schema.

- [ ] **Step 7: Commit the probe code and test**

Commit only the script, unit test, design/plan docs, and sanitized runtime manifest. Do not add `nodes.pyd`.

---

### Task 2: TE-Speed workflow and adapter v2 validation

**Files:**
- Create: `backend-node/configs/workflows/minimax_h3_director_r2v_te_speed.json`
- Modify: `backend-node/src/director/adapters/h3DirectorR2VAdapter.js`
- Modify: `backend-node/test/directorWorkflowRegistry.test.js`
- Create: `E:/AI/ComfyUI_windows_portable/ComfyUI/user/default/workflows/12-官方-H3-R2V-Sage-TE-Speed实验.json`

**Interfaces:**
- Consumes: the actual node schema captured by Task 1 and the existing API workflow.
- Produces: adapter v2 validation for `{ variant, workflow }` semantics and a TE workflow whose model path is `UNETLoader -> PathchSageAttentionKJ -> TESpeedMiniMaxH3 -> MiniMaxH3Director`.

- [ ] **Step 1: Add failing adapter/workflow tests**

Add tests that assert the TE graph contains exactly one `TESpeedMiniMaxH3`, the Director model input comes from it, its model input comes from Sage, and Sage comes from UNET. Add rejection cases for missing TE, TE before Sage, more than one TE node, a Spectrum node, and mutation of TE parameters through business input.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test test/directorWorkflowRegistry.test.js`.

Expected: the new TE graph and v2 validation assertions FAIL.

- [ ] **Step 3: Create the API workflow from the confirmed schema**

Clone the current official API graph, insert `TESpeedMiniMaxH3` after node 8 (`PathchSageAttentionKJ`), connect node 5 (`MiniMaxH3Director`) to its output, and populate Standard/20-Step plus `device=auto` using only values accepted by Task 1's schema. Keep all generation and encoding parameters equal to the official baseline.

- [ ] **Step 4: Implement adapter v2 validation**

Add graph helpers that resolve MODEL edges by node ID. Keep the existing base validation, then branch on the workflow variant supplied by registry metadata: official Sage forbids TE; official Sage TE requires the exact chain and forbids class names containing `Spectrum`. `buildPrompt` must continue to bind only the existing safe business fields.

- [ ] **Step 5: Run focused adapter tests**

Run: `node --test test/directorWorkflowRegistry.test.js`.

Expected: all registry and adapter tests PASS.

- [ ] **Step 6: Export the numbered UI workflow**

Load the verified graph in the experimental ComfyUI, save the UI workflow as `12-官方-H3-R2V-Sage-TE-Speed实验.json`, save API format, and compare its executable nodes/inputs with the project API workflow.

- [ ] **Step 7: Commit the workflow and adapter changes**

Commit the project API workflow, adapter, tests, and UI workflow JSON. The external binary remains untracked outside the project.

---

### Task 3: Registry, capabilities, and immutable snapshots

**Files:**
- Modify: `backend-node/configs/director-workflows.json`
- Modify: `backend-node/src/services/videoGenerationSnapshot.js`
- Modify: `backend-node/src/services/unifiedVideoGenerationService.js`
- Modify: `backend-node/test/videoGenerationSnapshot.test.js`
- Modify: `backend-node/test/videoCapabilitiesService.test.js`
- Modify: `backend-node/test/comfyuiVideoProvider.test.js`

**Interfaces:**
- Consumes: `runtime-manifest.json` and the TE API workflow from Tasks 1–2.
- Produces: a configured registry entry and `snapshot.acceleration` with kind, implementation, version, commit, binary hash, mode, device, and `approximate: true`.

- [ ] **Step 1: Add failing registry/snapshot/capability tests**

Assert that the TE entry is initially `configured`, includes `TESpeedMiniMaxH3`, exposes `supportsTESpeed` and `approximateAcceleration`, rejects selection without experimental permission, and produces a secret-free acceleration snapshot. Assert the official snapshot has `acceleration: null`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test test/videoGenerationSnapshot.test.js test/videoCapabilitiesService.test.js test/comfyuiVideoProvider.test.js test/directorWorkflowRegistry.test.js`.

Expected: new acceleration assertions FAIL.

- [ ] **Step 3: Register the TE workflow**

Calculate the workflow SHA-256, add the registry entry, include exact original repository commit and binary hash in `runtimeLock.customNodes`, and set `variant` to `official_sage_te_speed_original_3_3`. Preserve the official entry and default config.

- [ ] **Step 4: Add acceleration snapshot projection**

Derive acceleration exclusively from registered workflow metadata. Do not accept acceleration provenance or raw node parameters from a request. Return `null` for the official workflow.

- [ ] **Step 5: Expose current workflow acceleration capabilities**

Include `supportsTESpeed`, `approximateAcceleration`, and a human-readable workflow label in `GET /videos/capabilities`. Keep configured workflows inaccessible to ordinary production requests until host verification promotes them.

- [ ] **Step 6: Run focused tests**

Run the same focused test command from Step 2.

Expected: all focused tests PASS.

- [ ] **Step 7: Commit registry and snapshot changes**

Commit only the registry, snapshot/service code, and tests.

---

### Task 4: Frontend status and safe selection semantics

**Files:**
- Modify: `frontweb/src/components/video/VideoGenerationPanel.vue`
- Modify: `frontweb/src/composables/useVideoGenerationPanel.js`
- Modify: `frontweb/test/videoGenerationPanel.test.js`
- Modify: `frontweb/test/videoModeCompatibility.test.js`

**Interfaces:**
- Consumes: `GET /videos/capabilities` response from Task 3.
- Produces: dynamic labels for official Sage and TE-Speed, plus an explicit “近似加速/实验” warning when the selected default configuration points at TE-Speed.

- [ ] **Step 1: Add failing frontend tests**

Test official capability rendering, TE-Speed rendering, the approximate-acceleration warning, and absence of low-level threshold/mcs/cache-depth inputs.

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run: `node --test test/videoGenerationPanel.test.js test/videoModeCompatibility.test.js` from `frontweb`.

Expected: TE-Speed label/warning assertions FAIL.

- [ ] **Step 3: Replace the hard-coded workflow label**

Compute the label from `capabilities.workflow.label` or its variant. Show `官方多参考图（Sage + TE-Speed 实验）` and a warning that output is approximate when `approximateAcceleration` is true. Keep the default model/config as the only workflow selection source in this iteration.

- [ ] **Step 4: Run focused frontend tests**

Run the command from Step 2.

Expected: all focused frontend tests PASS.

- [ ] **Step 5: Commit frontend status changes**

Commit the Vue/composable changes and tests.

---

### Task 5: Host A/B, promotion decision, and operations documentation

**Files:**
- Create: `backend-node/scripts/compareH3TeSpeed.js`
- Create: `backend-node/test/h3TeSpeedComparison.test.js`
- Create: `docs/research/H3官方Sage与原版TE-Speed对照报告-2026-09-05.md`
- Create: `docs/research/_artifacts/h3-te-speed-original-2026-09-05/run-report.json`
- Modify after passing every gate: `backend-node/configs/director-workflows.json`
- Modify: `docs/changelog.md`

**Interfaces:**
- Consumes: official and TE workflow IDs, one prompt/reference/seed fixture, ComfyUI API, ffprobe, and nvidia-smi telemetry.
- Produces: deterministic A/B artifacts, timing/media/telemetry report, visual comparison inputs, and a registry promotion only when all gates pass.

- [ ] **Step 1: Add failing comparison-runner tests**

Test construction of paired requests with identical generation fields, rejection when any controlled field differs, ffprobe normalization, timing reduction calculation, five-run stability evaluation, and secret-free report output.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/h3TeSpeedComparison.test.js` from `backend-node`.

Expected: FAIL because the comparison runner does not exist.

- [ ] **Step 3: Implement the comparison runner**

Submit official then TE prompts serially, poll to terminal state, collect execution timing, ffprobe, nvidia-smi CSV samples, TE console statistics when available, and output paths. Require exact equality for prompt, references, seed, width, height, FPS, duration, steps, scheduler, sampler, shifts, Sage and codec before accepting a pair.

- [ ] **Step 4: Run the smoke A/B**

Use one 864x480, approximately 3-second job to prove load, sampling, decode, audio and save. If it fails, capture logs, leave the TE entry configured, keep production unchanged, and execute the OSS fallback investigation described in the spec.

- [ ] **Step 5: Run the controlled 1280x736 A/B set**

Run static dialogue, fast action, and multi-reference samples at 24 FPS and approximately 5 seconds. Then run five consecutive short TE jobs and one 10-second TE job. Do not run official and TE inference concurrently on the single GPU.

- [ ] **Step 6: Evaluate the hard gates**

Require at least 25% end-to-end reduction, five successful consecutive runs, a successful 10-second run, valid video/audio streams, matching output timing, and no obvious identity/motion/background/lip-sync regression in contact sheets and synchronized comparisons.

- [ ] **Step 7: Promote or retain experimental status**

If every gate passes, change the TE registry status from `configured` to `verified` and update its workflow hash. If any gate fails, retain `configured`, document the exact failing gate, and keep the official workflow as the only production-selectable path.

- [ ] **Step 8: Run full verification**

Run: `node --test test/*.test.js` from `backend-node`.

Run: `node --test test/*.test.js` and `npm run build` from `frontweb`.

Expected: every backend/frontend test passes and the production build succeeds.

- [ ] **Step 9: Commit reports and final registry state**

Commit the comparison runner/tests, sanitized report, changelog, and final registry decision. Do not commit generated MP4 files unless they are already governed research artifacts explicitly intended for repository retention.
