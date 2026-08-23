# Director V1 Host Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Add a repeatable Node.js host-acceptance runner that proves Director V1 restart recovery and real `timeline_v1` composition against the configured E-drive ComfyUI/FFmpeg tools.

**Architecture:** Keep production APIs unchanged. Add a testable orchestration module under `backend-node/scripts/` that receives its database, ComfyUI client, command runner, and clock as dependencies; the CLI supplies real implementations, initializes the Director schema, and writes external evidence. Reuse the existing Director job, candidate, artifact, workflow, and timeline services so the evidence follows the same contracts as the application.

**Tech Stack:** Node.js 18+, `node:test`, `better-sqlite3`, existing ComfyUI client, existing FFmpeg path resolver, SQLite migration SQL, JSON evidence.

---

### Task 1: Add acceptance orchestration contract tests

**Files:**
- Create: `backend-node/test/directorHostAcceptance.test.js`
- Test target: `backend-node/scripts/directorHostAcceptance.js`

- [ ] **Step 1: Write the failing tests**

  Add tests for these exported functions:

  ```js
  const {
    reconcileAndRetry,
    buildTimelineAcceptance,
    createEvidenceReport,
  } = require('../scripts/directorHostAcceptance');

  it('records running -> interrupted -> pending -> running recovery', () => {
    const calls = [];
    const db = {
      prepare(sql) { return { get: () => ({ id: 'job-1', status: 'running', lease_expires_at: '2026-08-23T00:00:00.000Z' }) }; },
    };
    const service = {
      reconcileRunningJobs() { calls.push('interrupted'); return 1; },
      getDirectorJob() { calls.push('pending'); return { id: 'job-1', status: 'pending', attempt_number: 1 }; },
      retryDirectorJob() { calls.push('retry'); return { id: 'job-1', status: 'pending', attempt_number: 1 }; },
      startDirectorJob() { calls.push('running'); return { id: 'job-1', status: 'running', attempt_number: 2 }; },
    };
    const result = reconcileAndRetry(db, 'job-1', { service, now: '2026-08-23T00:01:00.000Z' });
    assert.deepEqual(result.transitions, ['running', 'interrupted', 'pending', 'running']);
    assert.deepEqual(calls, ['interrupted', 'pending', 'retry', 'running']);
  });

  it('builds a real timeline command from two selected clips', () => {
    const timeline = { version: 'timeline_v1', output: { width: 864, height: 480, fps: 24, pixelFormat: 'yuv420p' }, clips: [{ artifactId: 'a', startTime: 0, duration: 2, sourceOffset: 0, sourceDuration: 2 }, { artifactId: 'b', startTime: 2, duration: 2, sourceOffset: 0, sourceDuration: 2 }], audioSources: [] };
    const result = buildTimelineAcceptance(timeline, { validate: input => input, create: input => ({ id: 'timeline-1', input }), command: { args: ['-y', '-i', 'a.mp4', '-i', 'b.mp4', '-c:v', 'libx264', 'out.mp4'], command: 'ffmpeg ...' } });
    assert.equal(result.timelineId, 'timeline-1');
    assert.equal(result.version, 'timeline_v1');
    assert.equal(result.command.args.at(-1), 'out.mp4');
  });

  it('reports explicit gates and raw ffprobe metadata', () => {
    const report = createEvidenceReport({
      gates: { restartRetryOnHost: 'passed', timelineComposition: 'passed' },
      artifact: { sha256: 'a'.repeat(64), fileSize: 10 },
      ffprobe: { streams: [], format: { duration: '4' } },
    });
    assert.equal(report.gates.restart_retry_on_host, 'passed');
    assert.equal(report.gates.timeline_composition, 'passed');
    assert.deepEqual(report.timeline.ffprobe, { streams: [], format: { duration: '4' } });
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run `node --test test/directorHostAcceptance.test.js` from `backend-node`.
  Expected: FAIL because `scripts/directorHostAcceptance.js` does not exist.

- [ ] **Step 3: Commit the red test**

  Run `git add backend-node/test/directorHostAcceptance.test.js && git commit -m "test: define director host acceptance contract"`.

### Task 2: Implement pure orchestration helpers

**Files:**
- Create: `backend-node/scripts/directorHostAcceptance.js`
- Test: `backend-node/test/directorHostAcceptance.test.js`

- [ ] **Step 1: Implement recovery and report helpers**

  Export `reconcileAndRetry(db, jobId, { service, now, leaseMs })`. It must call `reconcileRunningJobs`, assert exactly one row was reconciled, call `getDirectorJob`, `retryDirectorJob`, and `startDirectorJob`, and return the four-state transition list plus the final job.

  Export `buildTimelineAcceptance(timelineInput, { validate, create, command })`. It must call `validate`, then `create`, and return the persisted timeline ID, version, normalized input, and command args/string.

  Export `createEvidenceReport({ startedAt, completedAt, host, workflow, recovery, artifact, timeline, ffprobe, gates, errors = [] })`. It must preserve raw `{ streams, format }` ffprobe objects and emit snake-case gate names: `restart_retry_on_host`, `timeline_composition`, `real_verified_h3`, and `mp4_and_ffprobe`.

- [ ] **Step 2: Run focused tests to verify they pass**

  Run `node --test test/directorHostAcceptance.test.js`.
  Expected: 3 passing tests.

- [ ] **Step 3: Commit the helper implementation**

  Run `git add backend-node/scripts/directorHostAcceptance.js backend-node/test/directorHostAcceptance.test.js && git commit -m "feat: add director host acceptance helpers"`.

### Task 3: Add the real CLI runner

**Files:**
- Modify: `backend-node/scripts/directorHostAcceptance.js`
- Create: `backend-node/test/directorHostAcceptanceCli.test.js`

- [ ] **Step 1: Write the failing CLI utility tests**

  Test `parseArgs` for `--comfyui`, `--output-dir`, `--evidence`, `--source-artifact`, and `--force`; test `probeMedia` command construction with an injected command runner; test that existing evidence is rejected unless `force` is true.

- [ ] **Step 2: Run the CLI utility tests and verify failure**

  Run `node --test test/directorHostAcceptanceCli.test.js`.
  Expected: FAIL because the CLI exports are not implemented.

- [ ] **Step 3: Implement CLI utilities and runner**

  Add `parseArgs(argv)`, `probeMedia(filePath, { ffprobePath, runCommand })`, `runFfmpeg(command, { runCommand })`, and `runAcceptance(options)`. Use `loadRegistry` with `backend-node/configs/director-workflows.json`, `createComfyUIClient`, `createArtifactManifest`, the Director job/candidate/timeline services, and `getFfmpegPath`/`getFfprobePath`.

  Initialize an in-memory `better-sqlite3` database with `migrations/23_director_v1.sql`. Import the prior source artifact as a succeeded synthetic job, run one new H3 job after recovery, create candidate groups for both artifacts, select them, validate/persist a two-clip timeline, execute its FFmpeg args with `spawn`, and probe the output as raw JSON.

  Write evidence only after all collected fields are assembled. Refuse to overwrite an existing evidence path unless `--force` is passed. Set process exit code to 1 for any failed gate.

- [ ] **Step 4: Run CLI utility tests and commit**

  Run `node --test test/directorHostAcceptanceCli.test.js` and expect all utility tests to pass. Commit with `git add backend-node/scripts/directorHostAcceptance.js backend-node/test/directorHostAcceptanceCli.test.js && git commit -m "feat: add director host acceptance cli"`.

### Task 4: Run real acceptance and update evidence

**Files:**
- Create externally: `E:\\AI\\comfyui-outputs\\director-v1-acceptance-<date>\\*.mp4`
- Create: `docs/research/_artifacts/director-v1-vertical-slice/host-acceptance.json`
- Modify: `docs/research/_artifacts/director-v1-vertical-slice/manifest.json`
- Modify: `docs/research/director-v1-vertical-slice-2026-08-23.md`

- [ ] **Step 1: Install worktree dependencies**

  Run `npm ci` in `backend-node` and `frontweb`. Do not modify lockfiles unless the package manager reports a reproducible lockfile issue.

- [ ] **Step 2: Run the focused and full automated suites**

  Run `node --test test/directorHostAcceptance.test.js test/directorHostAcceptanceCli.test.js` and then `node --test test/*.test.js`. Expected: all tests pass.

- [ ] **Step 3: Run the real CLI against E-drive ComfyUI**

  Use the existing external MP4 as `--source-artifact`, ComfyUI URL `http://127.0.0.1:8188`, and a new output directory under `E:\\AI\\comfyui-outputs`. Use a temporary external ffprobe path if the repository does not contain one.

- [ ] **Step 4: Verify evidence independently**

  Recompute both output hashes, parse both raw ffprobe JSON objects, check the composed duration equals the sum of clip durations within 0.1 seconds, and run `git diff --check`.

- [ ] **Step 5: Update manifest/report and commit**

  Set `restart_retry_on_host` and `timeline_composition` to `passed` only when the CLI evidence proves them. Keep `external_validation_partial` if any other gate remains pending. Commit with `git add docs/research/_artifacts/director-v1-vertical-slice docs/research/director-v1-vertical-slice-2026-08-23.md && git commit -m "docs: record director host acceptance"`.

### Task 5: Final verification

- [ ] Run `node --test test/*.test.js` from `backend-node`.
- [ ] Run `npm run build` from `frontweb`.
- [ ] Run `git diff --check` and `git status --short --branch`.
- [ ] Report any remaining pending gates; do not claim full acceptance unless every required live gate is passed.
