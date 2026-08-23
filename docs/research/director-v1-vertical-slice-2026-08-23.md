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

The backend suite completed with 79 passing tests and 0 failures after Tasks
5-6. The frontend production build completed successfully with Vite after
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

The real H3 and MP4 gates are not marked as passed in this report. This
environment does not expose a ComfyUI service and `ffmpeg`/`ffprobe` are not
available on PATH. Consequently there is no truthful queue/history response,
real output hash, ffprobe result, or playable MP4 to record here.

The remaining acceptance work is to run one verified `h3-continuity-v1` job on
the configured GPU host, exercise restart/retry recovery, render the explicit
`timeline_v1`, and append the queue/history/output/ffprobe evidence.

## Known Limitations

- `state_anchor` and `composition_only` remain role-gated experimental paths.
- The browser smoke flow still requires a running backend plus a populated
  candidate artifact set.
- `docs/research/go-no-go-review.md` is intentionally not changed until the
  external H3, restart, and playable MP4 gates pass.
