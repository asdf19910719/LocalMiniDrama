# Director V1 Host Acceptance Design

## Goal

Provide a repeatable host-side acceptance runner for Director V1 that verifies
the live ComfyUI H3 path, durable job recovery across a simulated service
restart, and a real `timeline_v1` FFmpeg composition. The runner writes
machine-readable evidence without committing generated media binaries.

## Scope

The acceptance runner is an explicit, opt-in script under
`backend-node/scripts/`. It is not part of normal application startup and does
not add new production HTTP endpoints. It uses the existing Director services,
workflow registry, ComfyUI client, artifact manifest, job state machine, and
timeline service.

The runner verifies two layers:

1. **Host integration:** ComfyUI is reachable, the verified H3 workflow
   completes, the output exists, and FFmpeg/ffprobe can inspect it.
2. **Durability/composition:** an in-flight job is reconciled as interrupted,
   retried within its attempt limit, and two selected ready artifacts can be
   composed into a real MP4 using the persisted `timeline_v1` command.

The runner must not kill or restart an arbitrary user process. “Restart” is
represented by calling the existing `reconcileRunningJobs` function against a
fresh service boundary and recording the exact state transitions. A real
process restart is outside this implementation.

## Architecture

`director-v1-host-acceptance.js` will expose a small testable orchestration
function and a CLI entry point. Dependencies are injected for the database,
clock, ComfyUI client, command runner, and filesystem paths so unit tests can
exercise state transitions without GPU work.

The orchestration has four stages:

1. Check ComfyUI `/system_stats` and select the registry's verified
   `h3-continuity-v1` workflow.
2. Create a durable Director job, start it, call `reconcileRunningJobs` with an
   expired lease, retry it, then submit and poll the real H3 workflow. The
   successful output is recorded as a ready artifact with raw ffprobe metadata.
3. Create a second artifact reference from an existing verified MP4 when
   supplied, mark both candidates selected, validate and persist `timeline_v1`,
   execute its FFmpeg command, and probe the composed output.
4. Write a JSON report containing command arguments, state transitions, prompt
   IDs, workflow hash, artifact hashes, media metadata, and gate statuses. The
   report stores external absolute paths; no MP4 is copied into Git.

## CLI Contract

```text
node scripts/director-v1-host-acceptance.js \
  --comfyui http://127.0.0.1:8188 \
  --output-dir E:\\AI\\comfyui-outputs\\director-v1-acceptance-<date> \
  --evidence docs/research/_artifacts/director-v1-vertical-slice/host-acceptance.json \
  --source-artifact E:\\AI\\comfyui-outputs\\director-v1-real-2026-08-23\\director-v1-real.mp4
```

Required inputs are a reachable ComfyUI URL and an output directory. The
source artifact is required for a two-clip timeline unless the script is given
two newly generated outputs. The script exits non-zero on any failed gate and
prints the evidence path.

## Evidence and Failure Handling

The report uses explicit statuses: `passed`, `failed`, or `pending`. A missing
ComfyUI service, missing FFmpeg/ffprobe, failed history status, hash mismatch,
invalid timeline, or non-zero FFmpeg exit stops the relevant stage and records
the error, command, and input paths. Existing evidence files are never
overwritten unless `--force` is supplied.

The restart gate is passed only when the recorded job transitions exactly
through `running`, `interrupted`, `pending`, and `running` before completion.
The timeline gate is passed only after the output hash and raw ffprobe object
are recorded for the composed MP4.

## Testing Strategy

Tests are written before implementation in
`backend-node/test/directorHostAcceptance.test.js`:

- state-machine test for running-job reconciliation and retry;
- report-shape test requiring raw ffprobe `{ streams, format }`, hashes, and
  explicit gate statuses;
- command-runner test proving timeline FFmpeg arguments use the persisted
  artifact paths and output path.

The real CLI is then run against the configured E drive ComfyUI host. Final
verification runs the full backend test suite, frontend build, `git diff
--check`, and the CLI-produced FFmpeg/ffprobe checks.

## Non-goals

- No new production API endpoints.
- No automatic killing/restarting of the backend or ComfyUI processes.
- No committing generated MP4 files or downloaded tool binaries.
- No change to experimental anchor roles or existing legacy merge behavior.
