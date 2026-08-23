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

The backend suite completed with 91 passing tests and 0 failures after the
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
were then exercised by the repeatable host acceptance runner. The run recorded
the exact `running -> interrupted -> pending -> running` recovery sequence,
completed the retry successfully, composed two selected four-second clips into
an eight-second MP4, and probed the final output. Full evidence is in
[`host-acceptance.json`](./_artifacts/director-v1-vertical-slice/host-acceptance.json).

The final host-acceptance H3 output hash is
`abfbc44c48650051ed2bb990f61cf4aa15c53d91e00b11e6aeee8d26874dee4a` and the
timeline output hash is
`3722534d856a7f0a930fa9c6d3c35415e6f5cf0b1d289a52abcf8993eb4528cc`.

## Known Limitations

- `state_anchor` and `composition_only` remain role-gated experimental paths.
- The browser smoke flow still requires a running backend plus a populated
  candidate artifact set.
- `docs/research/go-no-go-review.md` remains a separate product-level review;
  this report now contains the complete Director V1 host evidence.
