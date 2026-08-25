# Director Production Governance

Date: 2026-08-24

Director workflow registry entries now require explicit provenance, license
status, a ComfyUI version lock, model file inventory, and custom-node file
hashes. Every generated Artifact persists an immutable governance snapshot in
its manifest.

The current `h3-continuity-v1` lock records ComfyUI `0.33.1`, SHA-256 values for
the two large model files, their byte sizes and relative paths, plus SHA-256
values for the three custom-node `__init__.py` entry files. Governance checks
reject a model whose filename, path, size, or digest differs from the lock.

MiniMax H3 model licensing remains `review_required`. `verified` in the
workflow registry means the technical workflow has real execution evidence;
it does not mean the model or every custom node is cleared for commercial use.

Director Timeline and postproduction accept local input/output paths only
under `director.allowed_local_roots`. The default roots are:

```yaml
director:
  allowed_local_roots:
    - ./data/director-artifacts
    - ./data/storage
```

Requests cannot override the FFmpeg executable. The application resolves it
through the shared local FFmpeg path utility.

The executable quality benchmark matrix is
`backend-node/configs/director-quality-benchmark.json`. It plans 90 runs across
five scenario types, two resolutions, three visual variants, and three repeats.
A resumable real-inference campaign was started on 2026-08-24 and intentionally
paused after 9 of 90 runs because each run took about ten minutes. All nine
artifacts have distinct SHA-256 values. H3 requires dimensions divisible by
32, so 1280x704 is the correct native target. The recorded 0 passed / 9 failed
`OUTPUT_SPEC_MISMATCH` result came from an invalid 1280x720 benchmark
expectation and is a benchmark false negative, not a generation failure. The
matrix must be corrected and the nine results re-evaluated. The remaining 81
runs and two-person semantic review remain deferred; the aggregate status
therefore remains `pending`.

For routine development, use a 26-run tiered core gate before considering the
full campaign: 15 single-repeat scenario/visual-variant coverage runs, 6 extra
repeats for the three highest-risk scenarios, and 5 1080p resolution spot
checks. Run all 90 for a release candidate, a model/workflow/runtime change, or
when the core gate detects a regression. Correct the native target to 704 and
re-evaluate the existing checkpoint before resuming either campaign.
# Unified video Provider governance

All new video tasks, including Director candidates, are routed through the one active default video configuration. The task stores a redacted configuration snapshot so retry and recovery use the original routing identity. Legacy rows remain readable; rows without a provable snapshot are reported as `historical_unknown` during migration and are not relabeled.

The shared Chinese generation panel is used in both normal drawer and canvas sidebar layouts. Layout changes do not change the available actions or request payload. Local ComfyUI connection checks are non-inference checks; production smoke is intentionally separate from automated tests.

Deferred acceptance work remains explicit: a short one-candidate `864x480` local smoke, long-running audio stability, GPU queue soak, backup/restore rehearsal, and the remaining H3 benchmark matrix. Cloud inference and long benchmark runs are not part of automatic verification.
