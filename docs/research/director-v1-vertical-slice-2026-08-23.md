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

The backend suite completed with 79 passing tests and 0 failures after the
Tasks 5-8 offline implementation. The frontend production build completed successfully with Vite after
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
remain pending. The offline tests cover those contracts, but they are not a
substitute for a host restart and a real composed timeline output.

## Known Limitations

- `state_anchor` and `composition_only` remain role-gated experimental paths.
- The browser smoke flow still requires a running backend plus a populated
  candidate artifact set.
- `docs/research/go-no-go-review.md` is intentionally not changed while the
  live restart/retry and composed timeline gates remain pending.
