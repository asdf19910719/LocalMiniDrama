# Director V1 Vertical Slice Evidence

Date: 2026-08-23
Branch: `ai-director-v1`
Repository: `LocalMiniDrama`

## Scope

The offline contract slice now covers workflow gating, durable Director jobs,
artifact hashes/manifests, ComfyUI request normalization, GPU lease recovery,
candidate review/selection, continuity anchor derivation, and `timeline_v1`
validation/FFmpeg command generation.

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
database contained no Director artifact rows, so the positive candidate
creation/selection path was not exercised without fabricating test data.

## Known Limitations

- `state_anchor` and `composition_only` remain role-gated experimental paths.
- The browser smoke positive path still requires a populated candidate artifact
  set; the panel rendering and invalid-artifact error path are verified.
- `docs/research/go-no-go-review.md` remains a separate product-level review;
  this report now contains the complete Director V1 host evidence.
