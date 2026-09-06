# Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local `main` contain the latest verified production code. The initial pass excluded all `comfyui-workflow-switching*` and Dreamina branches; a subsequent user instruction explicitly authorized integrating `codex/comfyui-workflow-switching-v2`.

**Architecture:** Preserve the dirty source checkout by committing only product source, tests, migrations, configuration, and required documentation on `codex/cloud-video-upscale`. Integrate from a separate `main` worktree. Where a newer consolidated commit already contains an older branch's behavior, verify that behavior and use an `ours` merge to record ancestry without replacing the newer implementation or importing benchmark artifacts.

**Tech Stack:** Git worktrees, Node.js 22 test runner, Vue 3/Vite, JSON Schema/AJV.

**Spec:** `docs/superpowers/specs/2026-09-05-storyboard-av-prompt-integrity-design.md`, `docs/superpowers/specs/2026-09-05-cloud-video-upscale-postprocess-design.md`, `docs/superpowers/specs/2026-09-05-h3-te-speed-integration-design.md`

## Global Constraints

- Do not merge or cherry-pick `feat/comfyui-workflow-switching` or `feature/dreamina-cli-image-provider`. The newer `codex/comfyui-workflow-switching-v2` is authorized for integration.
- Preserve runtime data, exports, dependency mirrors, logs, temporary reports, screenshots, and unrelated research artifacts outside Git.
- Do not push `main` to the remote; this plan updates local `main` only.
- Run backend tests with Node.js 22, run the complete frontend tests, and build the frontend before declaring completion.

---

### Task 1: Capture the coherent dirty implementation

**Files:**

- Commit: `backend-node/src/**`, `backend-node/test/**`, required `backend-node/configs/**`, `backend-node/migrations/**`, and implementation scripts.
- Commit: `frontweb/src/**`, `frontweb/test/**`.
- Commit: current AV/upscale/TE-Speed plans, specifications, runbook, and changelog.
- Exclude: `.tmp-*`, `.worktree-deps-*`, `data/`, `exports/`, `frontweb/*.log`, benchmark image/report directories, and root scratch files.

- [x] **Step 1: Audit candidate files for credentials and machine-only output**

Run:

```powershell
git diff -- backend-node/configs/config.yaml
git status --short --untracked-files=normal
```

- [x] **Step 2: Stage only the product paths and inspect the index**

Run:

```powershell
git add -- backend-node/src backend-node/test backend-node/configs backend-node/migrations backend-node/scripts frontweb/src frontweb/test
git diff --cached --name-status
git diff --cached --check
```

- [x] **Step 3: Run both test suites and the frontend build**

Run:

```powershell
cd backend-node; npx -y node@22 --test test/*.test.js
cd ../frontweb; npx -y node@22 --test test/*.test.js
npm run build
```

- [x] **Step 4: Commit the captured implementation**

```powershell
git commit -m "feat: integrate production video and AV pipelines"
```

### Task 2: Preserve the external-web Director fallback fix

**Files:**

- Modify: `frontweb/src/utils/directorPersistence.js`
- Modify: `frontweb/test/directorPersistence.test.js`

- [x] **Step 1: Run the focused test in the existing worktree**

```powershell
cd E:/AI/references/LocalMiniDrama/.worktrees/external-web-single-session/frontweb
npx -y node@22 --test test/directorPersistence.test.js
```

- [x] **Step 2: Commit the two-file fallback fix**

```powershell
git add -- frontweb/src/utils/directorPersistence.js frontweb/test/directorPersistence.test.js
git commit -m "fix: default blank Director workflow selection"
```

### Task 3: Integrate into an isolated local main worktree

**Files:** Git history and conflict resolutions only.

- [x] **Step 1: Verify `.worktrees` is ignored and create the main worktree**

```powershell
git check-ignore .worktrees
git worktree add .worktrees/main-integration main
```

- [x] **Step 2: Merge the current production branch**

```powershell
git -C .worktrees/main-integration merge --no-ff codex/cloud-video-upscale
```

- [x] **Step 3: Verify and record the superseded unified ChatGPT image fix**

```powershell
cd .worktrees/main-integration/frontweb
npx -y node@22 --test test/imageGenerationUi.test.js test/imageGenerationStore.test.js test/imageGenerationTaskState.test.js
git -C .. merge -s ours --no-ff feat/unified-chatgpt-image-generation
```

- [x] **Step 4: Verify and record the Director fallback fix from Task 2**

```powershell
cd .worktrees/main-integration/frontweb
npx -y node@22 --test test/directorPersistence.test.js
git -C .. merge -s ours --no-ff local-external/external-web-single-session
```

- [x] **Step 5: Record the integrated H3 histories without replacing the consolidated tree**

```powershell
git -C .worktrees/main-integration merge -s ours --no-ff codex/h3-te-speed
git -C .worktrees/main-integration merge -s ours --no-ff feature/h3-skill-agent
```

- [x] **Step 6: Confirm excluded branches are not ancestors of main**

```powershell
git -C .worktrees/main-integration merge-base --is-ancestor codex/comfyui-workflow-switching-v2 main
git -C .worktrees/main-integration merge-base --is-ancestor feat/comfyui-workflow-switching main
git -C .worktrees/main-integration merge-base --is-ancestor feature/dreamina-cli-image-provider main
```

Each command must return nonzero.

### Task 4: Verify and close

**Files:** Update this plan status only after verification.

- [x] **Step 1: Run complete backend tests on final main**

```powershell
cd .worktrees/main-integration/backend-node
npx -y node@22 --test test/*.test.js
```

- [x] **Step 2: Run complete frontend tests and build on final main**

```powershell
cd ../frontweb
npx -y node@22 --test test/*.test.js
npm run build
```

- [x] **Step 3: Validate repository state and branch containment**

```powershell
git diff --check
git status --short
git branch --no-merged main
git log --oneline --decorate -10 main
```

- [x] **Step 4: Record final commit IDs and keep all user-owned worktrees intact**

No worktree or branch is deleted by this plan.

### Task 5: Integrate ComfyUI workflow switching v2 after follow-up authorization

- [x] Merge `codex/comfyui-workflow-switching-v2` into the isolated local `main` worktree.
- [x] Resolve H3 audio/semantic-review, TE-Speed, retry-recovery, immutable workflow snapshot, migration, API, and UI conflicts without dropping either side's behavior.
- [x] Preserve the official H3 ↔ TE-Speed paired switch in the generic workflow catalog and derive H3 behavior from the workflow execution contract.
- [x] Align the registration helper with the repository's cross-platform, line-ending-stable workflow SHA rule.
- [x] Run focused regression tests, complete backend and frontend tests, and the Vite production build before committing.

## Completion Record

- Production snapshot: `93f022a feat: integrate production video and AV pipelines`
- Production merge into `main`: `599b580 Merge branch 'codex/cloud-video-upscale'`
- Superseded histories recorded with tree-preserving `ours` merges: unified ChatGPT image generation, H3 TE-Speed, H3 Skill Agent, and the external Director fallback fix.
- Final verification discovered and fixed a Windows worktree regression: workflow SHA-256 validation now normalizes line endings before hashing, with an LF/CRLF regression test.
- Pre-commit review found and fixed three merge regressions: unidentified legacy drafts now fail closed across workflows, workflow defaults no longer overwrite storyboard duration, and generic H3 execution contracts preserve the validated `audio_enabled` policy in immutable task snapshots.
- Final backend tests, frontend tests, and `npm run build` passed on local `main` using Node.js 22 for the test suites.
- The follow-up integration includes `codex/comfyui-workflow-switching-v2`; `git branch -a --no-merged main` should retain only the deliberately excluded legacy `feat/comfyui-workflow-switching` and `feature/dreamina-cli-image-provider` branches.
- Local runtime data, exports, dependency mirrors, logs, benchmark artifacts, other worktrees, and all existing branches were preserved.
