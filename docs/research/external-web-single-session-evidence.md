# External Web Single-Session Evidence

## Implemented production contract

- One session is registered by `dramaId + site`; each send has its own Attempt.
- Every write endpoint requires `Idempotency-Key`; the backend persists replay responses in `external_generation_idempotency`.
- Imported images are validated with `sharp`, hashed, written under `data/external-web/{dramaId}/{storyboardId}/{resultId}`, and linked to `image_generations` and `assets`.
- Result identity is `attemptId + resultSetId + resultIndex + provider/source fingerprint`; a different byte payload for an existing result index is rejected.
- Rebind is transactional, rejects cross-drama targets, updates the selected result, image generation, and storyboard image reference together.
- The Bridge is loopback-only and exposes only manifest-scoped Job files. The extension stores unacknowledged events locally and replays them after reconnect.
- ChatGPT capture is scoped to the registered assistant response. Missing or conflicting identity pauses capture as `UNBOUND_RESULT` or `NEEDS_REVIEW`.

## Verification evidence

| Area | Command | Result |
|---|---|---|
| Backend | `node --test test/*.test.js` with Node 22 | 174 passed, 0 failed |
| Bridge | `node --test test/*.test.js` with Node 22 | 4 passed, 0 failed |
| Extension | `node --test test/*.test.js` with Node 22 | 8 passed, 0 failed |
| Frontend | `node --test test/*.test.js` with Node 22 | 23 passed, 0 failed |
| Frontend build | `npm run build` | succeeded |
| Formatting | `git diff --check` | clean |

## Required deployment settings

- Set `EXTERNAL_GENERATION_PACKAGE_ROOT` to the application data root.
- Keep the Bridge bound to `127.0.0.1`; never expose it through a LAN interface or reverse proxy.
- Pair the extension with a one-time Bridge pairing token and store only the resulting access token in extension storage.
- Use a persistent database file and run migrations before starting the backend.

## Real-site acceptance

The automated suite uses DOM fixtures and mocked authenticated fetches. Before enabling automatic submit for a real account, validate one ChatGPT conversation with three Attempts (`SH021`, `SH022`, and an `SH021` revision), verify the provider conversation ID and assistant message IDs, and confirm every imported result appears under the intended Shot. Record redacted IDs and screenshots here; do not claim this step from fixture tests alone. This live acceptance is intentionally not marked complete by automated tests.
