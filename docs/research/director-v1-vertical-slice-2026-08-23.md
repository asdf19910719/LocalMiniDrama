# Director V1 Vertical Slice Evidence

Date: 2026-08-23
Branch: `ai-director-v1`
Repository: `LocalMiniDrama`

## Scope

The offline contract slice now covers workflow gating, durable Director jobs,
artifact hashes/manifests, ComfyUI request normalization with request-level
timeouts and media probing, GPU lease recovery, candidate review/selection,
continuity anchor derivation, and `timeline_v1` validation/FFmpeg command
generation.

## Evidence

Commands run from `backend-node`:

```text
node --test test/*.test.js
npm run build                         # from frontweb
```

The backend suite completed with 95 passing tests and 0 failures after the
Tasks 5-8 implementation and host-acceptance hardening. The frontend production build completed successfully with Vite after
installing the locked dependencies with `npm ci`.

Migration verification used an in-memory SQLite database and created:

```text
director_jobs
director_artifacts
director_candidate_groups
director_candidates
director_anchors
director_timelines
```

## External Checks

The configured ComfyUI portable host at `E:\\AI\\ComfyUI_windows_portable`
was available at `http://127.0.0.1:8188`. One real `h3-continuity-v1` job
completed successfully on an NVIDIA GeForce RTX 5070 Ti. Queue number 41,
prompt ID, workflow hash, output hash, and the full media probe are recorded
in [`real-h3-evidence.json`](./_artifacts/director-v1-vertical-slice/real-h3-evidence.json).

The output is a playable H.264/AAC MP4 (`864x480`, 24 fps, 15.292 s). The
repository's bundled FFmpeg 8.0.1 performed the playback/stream check; a
temporary FFmpeg Essentials 9.0.1 `ffprobe.exe` supplied the JSON metadata.
The probe binary is external and intentionally not committed.

Restart/retry recovery on the live host and an actual `timeline_v1` composition
were then exercised by the repeatable host acceptance runner. The final run used
seed `1726082341`, queue number 48, and prompt ID
`2eb0865b-ee2a-4591-9d64-e41e90fc4358`. Its ComfyUI history cached only model
loader nodes 1-4; `MiniMaxH3Director` node 5 executed freshly. The run recorded
the exact `running -> interrupted -> pending -> running` recovery sequence,
completed the retry successfully, composed two selected four-second clips into
an eight-second MP4, and probed the final output. Full evidence is in
[`host-acceptance.json`](./_artifacts/director-v1-vertical-slice/host-acceptance.json).

The final host-acceptance H3 output hash is
`cef5578d55f0ca17c1f53dbd9d7ea7b6a9af396cc95947f7d3696141d83ce166` and the
timeline output hash is
`5d71073c539edccf9333b09ba4f4fddcff7d1be9c7b4044b486dedd36c1c199d`.

## Browser Smoke

The local backend on port `5679` and Vite frontend on port `3013` were opened
at `/drama/2/canvas`. The canvas rendered the existing drama, and clicking the
real storyboard node opened the `Director candidate review` panel for shot 3.
Submitting a nonexistent artifact ID displayed the backend validation error
`Artifact not found` in the panel, confirming the UI error path. The local
database was temporarily populated with the two real r4 MP4 artifacts listed
above (then restored from an online SQLite backup after the smoke run). The UI
created a two-candidate group, automatically advanced it from `pending` through
`running` to `review`, and selecting the first candidate changed the group to
`selected`, with the selected candidate marked `selected` and the other marked
`rejected`. The browser network log confirmed the calls to
`POST /director/shots/3/candidates`, `POST /director/candidates/:groupId/review`,
and `POST /director/candidates/:groupId/select`. A final database check found
zero temporary Director jobs, artifacts, groups, or candidates.

## Direct Generation API Acceptance (2026-08-24)

The production Canvas form now submits `POST /director/shots/:shotId/generate`.
With backend `5679`, Vite `5174`, and ComfyUI `8188` running, shot `3`
submitted one candidate through verified `h3-continuity-v1`. The first attempt
was interrupted by backend restart and recovered with `retryDirectorJob`;
attempt 2 completed without creating a second group.

```text
group: 932a2efa-3daf-4bfc-bd24-64556a6158c2
job: 30a3dc8c-b9f7-4d46-9ede-93e31a20cd72
attempt: 2 / succeeded / candidate review / group review
artifact: bff6c3a6-47ed-464c-ba72-9bc403ce8076
sha256: 4caf0eef1f3de0ffbfc4257583c9a40a3631b62f568199318aae21858c0daddb
media: H.264 + AAC, 864x480, 24 fps, 15.29 s, 2449795 bytes
```

The host had no `ffprobe.exe`; the runner now records structured metadata from
the bundled `ffmpeg -i` fallback. Request-level timeouts convert a stuck
ComfyUI call to `COMFYUI_TIMEOUT` instead of leaving a job indefinitely
`running`.

## Browser Real-Generation Acceptance (2026-08-24)

The real Canvas form was exercised at `http://127.0.0.1:5174/drama/1/canvas`.
After selecting storyboard `2`, the form submitted one candidate with the
verified workflow and the page recovered the durable result after the backend
restart/retry. The panel showed `review`, a playable video element with
`15.292` seconds duration, and structured metadata `864x480`, H.264/AAC, 24
fps. Clicking the panel select action changed both the panel and persisted
group `a1a0584b-a668-4bd1-99fa-520b27f0647c` to `selected`.

The browser evidence is stored in the main research repository as
`docs/research/_artifacts/director-browser-smoke.json` and
`director-browser-smoke.png`. The corresponding durable run is job
`ac392253-1940-4050-95d5-ce358d67b0f1`, attempt 2, artifact
`542c153c-d695-4b95-b319-d1b726278c5b`, SHA-256
`001e3e8039562165bad5c959db7646b168ad1226710dbdb5f9186e9775e45544`.

The generation route now enforces selected-source dependencies before enqueue:
`state_anchor`, `composition_only`, and explicit source artifact/candidate
inputs require a ready artifact selected by its candidate group. Focused route
tests cover rejected unselected/missing sources and accepted selected sources.

## Known Limitations

- `state_anchor` and `composition_only` remain role-gated experimental paths.
- The older manual review smoke used a temporary, backed-up artifact set; the
  real-generation browser smoke now populates and selects durable artifacts.
- `docs/research/go-no-go-review.md` remains a separate product-level review;
  this report now contains the complete Director V1 host evidence.

## Postproduction Acceptance (2026-08-24)

`backend-node/src/director/directorPostproductionService.js` now builds and
executes deterministic postproduction plans, and `videoMergeService.js` writes
the postproduction result, quality status, probe, and output hash into the
timeline manifest. A real smoke run used the durable H3 artifact as input,
burned a temporary UTF-8 SRT, mixed a generated sine track, applied color
correction, and upscaled with FFmpeg Lanczos. The host had no `ffprobe.exe`, so
the service exercised its `ffmpeg -i` fallback.

```text
output: 1280x720, H.264 + AAC, 24 fps, 15.3 s
sha256: f4f4d2118f2bb1ced98ab3b27f14fbb90f2ae6d4d9768002e5c1ec684d8b1cee
quality: passed
```

The SRT, generated audio, and smoke output were temporary and were removed
after verification; only the result metadata is retained here.

## Continuity A-E Matrix (2026-08-24)

The reproducible matrix evidence is stored in
`E:/project/AIStory/docs/research/_artifacts/director-v1-vertical-slice/continuity-ae-matrix-2026-08-24.json`.
It contains real A-E H3 measurements for both scenes, including queue and
prompt IDs, workflow hashes, output hashes, probes, anchor files, and boundary
metrics. The rainy bus-terminal E output is clearly stronger than B/C/D on the
pixel continuity proxy. The alien-scene outputs retain expected shot changes,
so pixel diff cannot independently prove identity continuity. The promotion
gate is explicitly **not met**; `state_anchor` and `composition_only` remain
experimental and are not registry defaults.

## TTS and Multi-Audio Postproduction (2026-08-24)

The existing `backend-node/src/services/ttsService.js` remains the provider
boundary. `directorPostproductionService.js` now accepts `ttsPath` together
with music and additional audio paths, emits a deterministic multi-input
`amix` plan, and records the inputs in the timeline manifest. Focused tests
pass. A configured-provider real TTS smoke remains open.

## Latent Upscale Baseline (2026-08-24)

The reproducible evidence is stored in
`E:/project/AIStory/docs/research/_artifacts/director-v1-vertical-slice/latent-upscale-baseline-2026-08-24.json`.
The actual workflow uses 10-step generation at 960x544, a 2x
`MinimaxH3LatentUpscaler3D` pass from latent 60x34 to 120x68 (1920x1088),
then a 4-step denoise/refine pass. ComfyUI logged 531.11 seconds; the output
is H.264/AAC, 24 fps, 5.17 seconds, SHA-256
`e521506924604b897f5fb0193ae8bda9ab953fc331d784f5cf504082bda9d33f`.
The host total VRAM is 16303 MB, but no per-prompt peak sample was retained;
1920x1088 is 1080P-class aligned output, not exact 1920x1080.
