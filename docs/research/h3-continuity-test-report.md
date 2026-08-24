# H3 Continuity Evidence

## 2026-08-24 resumable quality benchmark progress

The real H3 benchmark was intentionally paused after 9 of 90 planned runs to
avoid an approximately 15-hour uninterrupted campaign. The checkpoint is
`backend-node/data/director-quality-benchmark/results.json`; its nine artifacts
are under `backend-node/data/director-quality-benchmark/artifacts/`.

- Recorded: 9/90; remaining: 81.
- Recorded machine QC: 0 passed, 9 failed, pending correction and re-evaluation.
- All nine artifact SHA-256 values are distinct.
- H3 dimensions must be divisible by 32; 1280x704 is the correct native target.
  The nine `OUTPUT_SPEC_MISMATCH` results are false negatives caused by the
  invalid 1280x720 matrix expectation, not H3 generation failures.
- Run 10 (the first 1920x1080 case) was interrupted and is not counted.
- Semantic review is not complete; overall status remains `pending`.

Recommended continuation is a 26-run tiered core gate, with the full 90-run
matrix reserved for release/runtime changes or regression follow-up. Existing
results remain resumable and must not be rewritten as passing evidence.

This repository's verified Director workflow is based on the H3 continuity
validation record maintained with the AIStory research docs and the checked-in
host-acceptance artifacts. The default V1 strategy is independent prompts with
22-frame overlap and deduplicated timeline composition. Tail-frame and
reference-image experimental variants are not the default registry strategy.

For production acceptance, pair this technical workflow evidence with the
runtime governance record in `director-production-governance.md` and the real
host evidence under `docs/research/_artifacts/director-v1-vertical-slice/`.
